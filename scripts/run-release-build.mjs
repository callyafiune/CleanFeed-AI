#!/usr/bin/env node
// The `build:release` gate. Fail-closed, no Unix-shell dependency.
//
//   node scripts/run-release-build.mjs
//
// The release descriptor's gateDecision drives everything:
//   - "pending"            -> MODEL_RELEASE_NOT_PROMOTED (never builds).
//   - "reject" (scientific)-> requires rolloutState "bundle-verified", a
//     non-null evidenceDigest and NO profiles; smokes the candidate, then a
//     fallback build, then a reject-mode audit that requires the TMR dir to be
//     entirely absent from dist.
//   - "indicator"/"actions"-> requires an APPROVED license, an intact bundle,
//     non-empty profiles and a coherent calibrationSetDigest; smokes, then a
//     package build, then a package-mode audit.
//
// Every child process is spawned with `process.execPath` + `npm_execpath`, so
// no `sh`/`bash` is ever required (Windows-safe). If `npm_execpath` is missing
// the gate returns NPM_EXEC_PATH_MISSING. Because `test:model:smoke` does not
// exist until a later task, a real release fails closed the moment it tries to
// smoke — exactly the intended behavior.

import { spawn } from "node:child_process";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, env, execPath as nodeExecPath, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { readSourceLock } from "./model-lock.mjs";
import {
  computeCalibrationSetDigest,
  verifyMaterializedBundle,
} from "./verify-model-bundle.mjs";

/** Spawns `command args`, resolving on exit 0 and rejecting otherwise. */
function defaultRunNode(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `command failed (exit ${code}): ${command} ${args.join(" ")}`,
          ),
        );
    });
  });
}

/**
 * Runs the release gate for a parsed release descriptor. Returns a coded result
 * object for every gate decision; only propagates (throws) when an actual child
 * process fails, so callers can distinguish "the gate said no" from "a step
 * broke".
 */
export async function runReleaseBuild({
  release,
  licenseReview,
  lock,
  bundleDir,
  dependencies = {},
}) {
  const runNode = dependencies.runNode ?? defaultRunNode;
  const execPath = dependencies.execPath ?? nodeExecPath;
  // Distinguish "the caller did not inject npmExecPath" (fall back to the
  // environment) from "the caller injected it as undefined" (simulate a missing
  // npm_execpath, which must fail closed).
  const npmExecPath =
    "npmExecPath" in dependencies ? dependencies.npmExecPath : env.npm_execpath;
  const verifyBundle =
    dependencies.verifyBundle ??
    ((dir) => verifyMaterializedBundle(dir, { lock }));

  const gateDecision = release?.gateDecision;

  if (gateDecision === "pending") {
    return { ok: false, code: "MODEL_RELEASE_NOT_PROMOTED" };
  }

  let mode;
  if (gateDecision === "reject") {
    const profileCount = Array.isArray(release.profileDigests)
      ? release.profileDigests.length
      : 0;
    if (
      release.rolloutState !== "bundle-verified" ||
      release.evidenceDigest === null ||
      profileCount !== 0
    ) {
      return { ok: false, code: "MODEL_RELEASE_DESCRIPTOR_INVALID" };
    }
    mode = "reject";
  } else if (gateDecision === "indicator" || gateDecision === "actions") {
    if (licenseReview?.status !== "approved") {
      return { ok: false, code: "MODEL_LICENSE_NOT_APPROVED" };
    }
    if (
      !Array.isArray(release.profileDigests) ||
      release.profileDigests.length === 0
    ) {
      return { ok: false, code: "MODEL_RELEASE_DESCRIPTOR_INVALID" };
    }
    if (
      typeof release.calibrationSetDigest !== "string" ||
      release.calibrationSetDigest !==
        computeCalibrationSetDigest(release.profileDigests)
    ) {
      return { ok: false, code: "MODEL_RELEASE_DESCRIPTOR_INVALID" };
    }
    mode = "package";
  } else {
    return { ok: false, code: "MODEL_RELEASE_DESCRIPTOR_INVALID" };
  }

  if (!npmExecPath) {
    return { ok: false, code: "NPM_EXEC_PATH_MISSING" };
  }

  if (mode === "package") {
    await verifyBundle(bundleDir);
  }

  // Smoke the exact candidate FIRST, without a release-mode env.
  await runNode(execPath, [npmExecPath, "run", "test:model:smoke"], {
    stdio: "inherit",
  });
  await runNode(execPath, [npmExecPath, "run", "build"], {
    stdio: "inherit",
    env: { ...env, CLEANFEED_MODEL_RELEASE_MODE: mode },
  });
  await runNode(execPath, [npmExecPath, "run", "audit"], {
    stdio: "inherit",
    env: { ...env, CLEANFEED_MODEL_RELEASE_MODE: mode },
  });

  return { ok: true, code: "RELEASE_COMPLETED", mode };
}

async function runCli() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const modelsDir = join(scriptDir, "..", "models", "tmr-ai-text-detector");
  const lock = await readSourceLock(join(modelsDir, "source-lock.json"));
  const manifest = JSON.parse(
    await readFile(join(modelsDir, "cleanfeed-model.json"), "utf8"),
  );
  const release = JSON.parse(
    await readFile(join(modelsDir, "release.json"), "utf8"),
  );
  const licenseReview = JSON.parse(
    await readFile(join(modelsDir, "license-review.json"), "utf8"),
  );
  const bundleDir = join(
    scriptDir,
    "..",
    "public",
    "models",
    "tmr-ai-text-detector",
  );

  const result = await runReleaseBuild({
    release,
    licenseReview,
    manifest,
    lock,
    bundleDir,
  });

  if (!result.ok) {
    console.error(`release BLOCKED — ${result.code}`);
    exit(1);
  }
  console.log(`release OK — ${result.code} (${result.mode})`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `release FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
