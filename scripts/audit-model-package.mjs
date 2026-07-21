#!/usr/bin/env node
// Audits a BUILT dist against the scientific decision it must carry. It proves
// the package inventory, integrity, licence and network posture, and binds the
// package to the sanitized Phase 3 evidence and the shared runtime-parity
// digest. It never trusts a mode flag: it re-derives the policy from the
// versioned descriptor and checks the real bytes on disk.
//
//   node scripts/audit-model-package.mjs \
//     --dist dist --metadata models/tmr-ai-text-detector \
//     --evidence benchmark/evidence/tmr-ptbr-v1
//
//   - reject  -> `dist/models/tmr-ai-text-detector` must be entirely absent.
//   - indicator/pass -> exactly the twelve authorized files, each intact, with
//     the two canonical descriptors byte-identical to the versioned sources.
//   Any un-inventoried file fails UNEXPECTED_MODEL_FILE; a runtime-parity digest
//   that disagrees with the benchmark report fails RUNTIME_PARITY_MISMATCH; a
//   broken evidence chain fails EVIDENCE_DIGEST_MISMATCH.

import console from "node:console";
import { readdir, readFile as nodeReadFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { parseCalibrationProfilesFileV1 } from "../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../contracts/model-release.ts";
import { readSourceLock } from "./model-lock.mjs";
import { resolveReleasePolicy } from "./release-policy.mjs";
import { computeRuntimeParityDigest } from "./runtime-parity.mjs";
import {
  RELEASE_INVENTORY,
  verifyReleaseModelDirectory,
} from "./verify-model-bundle.mjs";

function fail(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  throw error;
}

async function readJson(readFile, path, code) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    fail(code, `cannot read ${path}: ${error}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(code, `${path} is not valid JSON: ${error}`);
  }
}

/** Every file under `directory` as posix-relative paths (empty if absent). */
async function listRelativePosixFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await listRelativePosixFiles(
          join(directory, entry.name),
          relative,
        )),
      );
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function defaultVerifyRuntimeParity({ distDir, evidenceDir, readFile }) {
  const parity = await readJson(
    readFile,
    join(distDir, "runtime-parity.json"),
    "RUNTIME_PARITY_MISMATCH",
  );
  const { runtimeParityDigest, ...fields } = parity;
  const recomputed = computeRuntimeParityDigest(fields);
  if (recomputed !== runtimeParityDigest) {
    fail(
      "RUNTIME_PARITY_MISMATCH",
      "dist/runtime-parity.json self-digest does not recompute",
    );
  }
  const report = await readJson(
    readFile,
    join(evidenceDir, "benchmark-report.json"),
    "RUNTIME_PARITY_MISMATCH",
  );
  if (report.runtimeParityDigest !== runtimeParityDigest) {
    fail(
      "RUNTIME_PARITY_MISMATCH",
      `dist runtime parity (${runtimeParityDigest}) != benchmark report (${String(report.runtimeParityDigest)})`,
    );
  }
}

async function defaultVerifyEvidenceChain({
  evidenceDir,
  metadataDir,
  release,
  readFile,
  verifyPublishedEvidence,
}) {
  const evidenceDigestFile = await readJson(
    readFile,
    join(evidenceDir, "evidence-digest.json"),
    "EVIDENCE_UNREADABLE",
  );
  const report = await readJson(
    readFile,
    join(evidenceDir, "benchmark-report.json"),
    "EVIDENCE_UNREADABLE",
  );
  if (evidenceDigestFile.scientificEvidenceDigest !== release.evidenceDigest) {
    fail(
      "EVIDENCE_DIGEST_MISMATCH",
      "evidence-digest.scientificEvidenceDigest != release.evidenceDigest",
    );
  }
  if (report.reportDigest !== release.evidenceDigest) {
    fail(
      "EVIDENCE_DIGEST_MISMATCH",
      "benchmark-report.reportDigest != release.evidenceDigest",
    );
  }
  if (verifyPublishedEvidence !== undefined) {
    await verifyPublishedEvidence({
      evidenceDirectory: evidenceDir,
      modelDirectory: metadataDir,
    });
  }
}

async function defaultVerifyPublishedEvidence({
  evidenceDirectory,
  modelDirectory,
}) {
  const { runVerifyPublishedEvidence } =
    await import("../benchmark/commands/verify-published-evidence.ts");
  await runVerifyPublishedEvidence({ evidenceDirectory, modelDirectory });
}

/**
 * Audits the built package. Resolves throwing on the first violation; resolves
 * with `undefined` when the dist matches the authorized decision exactly.
 */
export async function auditModelPackage({
  distDir,
  metadataDir,
  evidenceDir,
  now = Date.now(),
  dependencies = {},
}) {
  const readFile = dependencies.readFile ?? nodeReadFile;
  const lock =
    dependencies.lock ??
    (await readSourceLock(join(metadataDir, "source-lock.json")));
  const verifyRuntimeParity =
    dependencies.verifyRuntimeParity ??
    ((args) => defaultVerifyRuntimeParity({ ...args, readFile }));
  const verifyEvidenceChain =
    dependencies.verifyEvidenceChain ??
    ((args) =>
      defaultVerifyEvidenceChain({
        ...args,
        readFile,
        verifyPublishedEvidence:
          dependencies.verifyPublishedEvidence ??
          defaultVerifyPublishedEvidence,
      }));

  const release = await parseModelReleaseDescriptorV1(
    await readJson(
      readFile,
      join(metadataDir, "release.json"),
      "RELEASE_UNREADABLE",
    ),
  );
  const profilesFile = await parseCalibrationProfilesFileV1(
    await readJson(
      readFile,
      join(metadataDir, "calibration-profiles.json"),
      "PROFILES_UNREADABLE",
    ),
  );

  const policy = resolveReleasePolicy(release, profilesFile, now);
  const target = join(distDir, "models", "tmr-ai-text-detector");

  if (!policy.includeTmr) {
    const stray = await listRelativePosixFiles(target);
    if (stray.length > 0) {
      fail(
        "MODEL_MUST_BE_ABSENT",
        `reject package must not ship the TMR bundle; found ${stray.length} file(s)`,
      );
    }
  } else {
    const files = await listRelativePosixFiles(target);
    const allowed = new Set(RELEASE_INVENTORY);
    for (const file of files) {
      if (!allowed.has(file)) {
        fail(
          "UNEXPECTED_MODEL_FILE",
          `package contains a non-inventoried file: "${file}"`,
        );
      }
    }
    await verifyReleaseModelDirectory(target, { lock, metadataDir });
  }

  await verifyRuntimeParity({ distDir, evidenceDir });
  await verifyEvidenceChain({ evidenceDir, metadataDir, release });
}

function parseCliArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    const assign = (key) => {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", `${flag} needs a value`);
      options[key] = value;
      index += 1;
    };
    if (flag === "--dist") assign("distDir");
    else if (flag === "--metadata") assign("metadataDir");
    else if (flag === "--evidence") assign("evidenceDir");
    else fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  if (
    options.distDir === undefined ||
    options.metadataDir === undefined ||
    options.evidenceDir === undefined
  ) {
    fail("MISSING_FLAG", "--dist, --metadata and --evidence are required");
  }
  return options;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  auditModelPackage(parseCliArgs(argv.slice(2)))
    .then(() => {
      console.log("audit:model OK — package matches the authorized decision.");
      exit(0);
    })
    .catch((error) => {
      console.error(
        `audit:model FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
