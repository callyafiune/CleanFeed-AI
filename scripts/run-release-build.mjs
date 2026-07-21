#!/usr/bin/env node
// The single `build:release` gate — extended in Phase 4 to APPLY the scientific
// decision to the package. There is exactly one runner: the release descriptor's
// gate decision drives it through the pure policy matrix, and only then does it
// smoke the candidate, run the base Vite build, seal the shared runtime-parity
// manifest and either strip the model (reject -> fallback) or materialize the
// twelve-file package (indicator/pass). Every fail-closed guard from Phase 1 is
// preserved: pending never builds, an unapproved licence blocks a packaged
// release, and the real smoke must pass before the Vite build even starts.
//
//   node scripts/run-release-build.mjs
//
// Cross-platform and fail-closed: every child process is spawned with
// `process.execPath` + `npm_execpath`, so no `sh`/`bash` is ever required.

import { spawn } from "node:child_process";
import console from "node:console";
import { readdir, readFile, rm as nodeRm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { argv, env, execPath as nodeExecPath, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { readSourceLock } from "./model-lock.mjs";
import { resolveReleasePolicy as defaultResolvePolicy } from "./release-policy.mjs";
import {
  buildRuntimeParityManifest,
  writeRuntimeParityManifest,
} from "./runtime-parity.mjs";
import {
  verifyMaterializedBundle,
  verifyReleaseModelDirectory,
} from "./verify-model-bundle.mjs";

function coded(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  return error;
}

/** Spawns `command args`, resolving on exit 0 and rejecting otherwise. */
function defaultRunNode(command, args, options = {}) {
  return new Promise((resolve_, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve_();
      else
        reject(
          new Error(
            `command failed (exit ${code}): ${command} ${args.join(" ")}`,
          ),
        );
    });
  });
}

/** Resolves `target` and proves it is inside `distDirectory`. */
function assertChildPath(distDirectory, target) {
  const resolvedTarget = resolve(target);
  const rel = relative(resolve(distDirectory), resolvedTarget);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw coded("DIST_PATH_ESCAPE", `${target} is not inside ${distDirectory}`);
  }
  return resolvedTarget;
}

async function listRelativeFilesIfPresent(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await listRelativeFilesIfPresent(join(directory, entry.name), rel)),
      );
    } else {
      files.push(rel);
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Runs the extended release gate. Returns the resolved policy plus the packaged
 * inventory; throws (fail-closed) on any policy violation or broken step. Every
 * side-effecting step is injectable so the release-gate test can prove the order
 * and the branch behavior without touching the real model, evidence or Vite.
 */
export async function runReleaseBuild({
  repositoryRoot,
  publicDirectory,
  distDirectory,
  now = Date.now(),
  dependencies = {},
}) {
  const runNode = dependencies.runNode ?? defaultRunNode;
  const execPath = dependencies.execPath ?? nodeExecPath;
  const npmExecPath =
    "npmExecPath" in dependencies ? dependencies.npmExecPath : env.npm_execpath;
  const variantMetadataDir =
    "variantMetadataDir" in dependencies
      ? dependencies.variantMetadataDir
      : env.CLEANFEED_E2E_VARIANT_METADATA_DIR;

  const modelsDirectoryDefault = join(
    repositoryRoot,
    "models",
    "tmr-ai-text-detector",
  );
  const evidenceDirectoryDefault = join(
    repositoryRoot,
    "benchmark",
    "evidence",
    "tmr-ptbr-v1",
  );

  const loadReleaseMetadata =
    dependencies.loadReleaseMetadata ??
    (async () => {
      const release = JSON.parse(
        await readFile(join(modelsDirectoryDefault, "release.json"), "utf8"),
      );
      const profilesFile = JSON.parse(
        await readFile(
          join(modelsDirectoryDefault, "calibration-profiles.json"),
          "utf8",
        ),
      );
      const licenseReview = JSON.parse(
        await readFile(
          join(modelsDirectoryDefault, "license-review.json"),
          "utf8",
        ),
      );
      const sourceLock = await readSourceLock(
        join(modelsDirectoryDefault, "source-lock.json"),
      );
      return {
        release,
        profilesFile,
        licenseReview,
        sourceLock,
        publicModelDirectory: join(
          publicDirectory ?? join(repositoryRoot, "public"),
          "models",
          "tmr-ai-text-detector",
        ),
        modelsDirectory: modelsDirectoryDefault,
        evidenceDirectory: evidenceDirectoryDefault,
        modelManifestPath: join(modelsDirectoryDefault, "cleanfeed-model.json"),
        benchmarkReportPath: join(
          evidenceDirectoryDefault,
          "benchmark-report.json",
        ),
      };
    });

  const resolvePolicy =
    dependencies.resolveReleasePolicy ?? defaultResolvePolicy;
  const assertDistributionLicense =
    dependencies.assertDistributionLicense ??
    ((licenseReview, policy) => {
      if (policy.includeTmr && licenseReview?.status !== "approved") {
        throw coded(
          "MODEL_LICENSE_NOT_APPROVED",
          "a packaged release requires an approved licence review",
        );
      }
    });
  const verifySanitizedEvidence =
    dependencies.verifySanitizedEvidence ??
    (async (evidenceDirectory, modelDirectory) => {
      const { runVerifyPublishedEvidence } =
        await import("../benchmark/commands/verify-published-evidence.ts");
      await runVerifyPublishedEvidence({
        evidenceDirectory,
        modelDirectory,
      });
    });
  const verifyBundle =
    dependencies.verifyBundle ??
    ((publicModelDir, input) =>
      verifyMaterializedBundle(publicModelDir, input));
  const runSmoke =
    dependencies.runSmoke ??
    (async () => {
      if (!npmExecPath) throw coded("NPM_EXEC_PATH_MISSING");
      await runNode(execPath, [npmExecPath, "run", "test:model:smoke"], {
        stdio: "inherit",
      });
    });
  const runViteBuild =
    dependencies.runViteBuild ??
    (async () => {
      if (!npmExecPath) throw coded("NPM_EXEC_PATH_MISSING");
      const buildEnv = { ...env };
      delete buildEnv.CLEANFEED_E2E_VARIANT_METADATA_DIR;
      await runNode(execPath, [npmExecPath, "run", "build"], {
        stdio: "inherit",
        env: buildEnv,
      });
    });
  const buildParity =
    dependencies.buildParity ?? ((args) => buildRuntimeParityManifest(args));
  const writeParity =
    dependencies.writeParity ??
    ((manifest, distDir) => writeRuntimeParityManifest(manifest, distDir));
  const assertParity =
    dependencies.assertParity ??
    (async (manifest, benchmarkReportPath) => {
      const { parseRuntimeParityManifestV1 } =
        await import("../contracts/runtime-parity.ts");
      await parseRuntimeParityManifestV1(manifest);
      const report = JSON.parse(await readFile(benchmarkReportPath, "utf8"));
      if (manifest.runtimeParityDigest !== report.runtimeParityDigest) {
        throw coded(
          "RUNTIME_PARITY_MISMATCH",
          "dist runtime-parity digest disagrees with the benchmark report",
        );
      }
    });
  const materializeMetadata =
    dependencies.materializeMetadata ??
    (async ({ sourceDirectory, targetDirectory }) => {
      for (const name of ["release.json", "calibration-profiles.json"]) {
        const bytes = await readFile(join(sourceDirectory, name));
        await writeFile(join(targetDirectory, name), bytes);
      }
    });
  const verifyReleaseDir =
    dependencies.verifyReleaseDir ??
    ((target, metadata) =>
      verifyReleaseModelDirectory(target, {
        lock: metadata.sourceLock,
        metadataDir: metadata.modelsDirectory,
      }));
  const removePath = dependencies.removePath ?? nodeRm;
  const listPackagedFiles =
    dependencies.listPackagedFiles ?? listRelativeFilesIfPresent;

  const metadata = await loadReleaseMetadata(repositoryRoot);
  const policy = resolvePolicy(metadata.release, metadata.profilesFile, now);

  await assertDistributionLicense(metadata.licenseReview, policy);
  await verifySanitizedEvidence(
    metadata.evidenceDirectory,
    metadata.modelsDirectory,
    metadata.release,
  );
  await verifyBundle(metadata.publicModelDirectory, {
    lock: metadata.sourceLock,
  });

  if (variantMetadataDir !== undefined) {
    throw coded(
      "RELEASE_TEST_METADATA_FORBIDDEN",
      "release-only test variant metadata must never be present in a release build",
    );
  }

  await runSmoke();
  await runViteBuild();

  const parityManifest = await buildParity({
    repoRoot: repositoryRoot,
    modelManifestPath: metadata.modelManifestPath,
  });
  await writeParity(parityManifest, distDirectory);
  await assertParity(parityManifest, metadata.benchmarkReportPath);

  const target = assertChildPath(
    distDirectory,
    join(distDirectory, "models", "tmr-ai-text-detector"),
  );

  if (!policy.includeTmr) {
    await removePath(target, { recursive: true, force: true });
  } else {
    await materializeMetadata({
      sourceDirectory: metadata.modelsDirectory,
      targetDirectory: target,
    });
    await verifyReleaseDir(target, metadata);
  }

  // The acquisition bundle in `public` stays exactly the ten files, before AND
  // after the build.
  await verifyBundle(metadata.publicModelDirectory, {
    lock: metadata.sourceLock,
  });

  return { ...policy, packagedFiles: await listPackagedFiles(target) };
}

async function runCli() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = join(scriptDir, "..");
  const result = await runReleaseBuild({
    repositoryRoot,
    publicDirectory: join(repositoryRoot, "public"),
    distDirectory: join(repositoryRoot, "dist"),
  });
  console.log(
    `release OK — includeTmr=${result.includeTmr} runtime=${result.activeRuntimeKind} ceiling=${result.maximumActionCeiling}`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli()
    .then(() => exit(0))
    .catch((error) => {
      console.error(
        `release BLOCKED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
