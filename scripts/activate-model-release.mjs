#!/usr/bin/env node
// The ONE monotonic release-activation step. It consumes only artifacts already
// published by the benchmark and may change EXACTLY one thing: advance a
// `pass` release from `rolloutState: "indicator"` to `"actions"`. It NEVER
// rewrites thresholds, gateDecision, tokenizerDigest, profile digests, the
// calibration set digest, evidence or any other scientific field — a guard
// proves the input and output differ in nothing but `rolloutState`, and the
// write is a canonical temp file plus an atomic rename so a crash can never
// leave a torn descriptor.
//
//   node scripts/activate-model-release.mjs \
//     --release models/tmr-ai-text-detector/release.json \
//     --profiles models/tmr-ai-text-detector/calibration-profiles.json \
//     --evidence-dir benchmark/evidence/tmr-ptbr-v1 \
//     --expected-evidence-digest <digest>

import console from "node:console";
import { randomUUID } from "node:crypto";
import {
  readFile as nodeReadFile,
  rename as nodeRename,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { parseCalibrationProfilesFileV1 } from "../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../contracts/model-release.ts";
import { resolveReleasePolicy } from "./release-policy.mjs";

function fail(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  throw error;
}

async function defaultVerifyPublishedEvidence({
  evidenceDirectory,
  modelDirectory,
}) {
  const { runVerifyPublishedEvidence } =
    await import("../benchmark/commands/verify-published-evidence.ts");
  await runVerifyPublishedEvidence({ evidenceDirectory, modelDirectory });
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

function requireEqualEvidence(label, actual, expected) {
  if (actual !== expected) {
    fail(
      "EVIDENCE_DIGEST_MISMATCH",
      `${label} does not match the descriptor evidence digest (${String(actual)} != ${String(expected)})`,
    );
  }
}

/**
 * Activates a published release. Returns the activation outcome; only mutates
 * `release.json` (via a canonical temp file + atomic rename) when a `pass`
 * release is advanced from `indicator` to `actions`.
 */
export async function activateModelRelease({
  releasePath,
  profilesPath,
  evidenceDir,
  expectedEvidenceDigest,
  now = Date.now(),
  dependencies = {},
}) {
  const readFile = dependencies.readFile ?? nodeReadFile;
  const writeFile = dependencies.writeFile ?? nodeWriteFile;
  const rename = dependencies.rename ?? nodeRename;
  const remove = dependencies.rm ?? nodeRm;
  const verifyPublishedEvidence =
    dependencies.verifyPublishedEvidence ?? defaultVerifyPublishedEvidence;

  const rawRelease = await readJson(
    readFile,
    releasePath,
    "RELEASE_UNREADABLE",
  );
  const release = await parseModelReleaseDescriptorV1(rawRelease);
  const rawProfiles = await readJson(
    readFile,
    profilesPath,
    "PROFILES_UNREADABLE",
  );
  const profilesFile = await parseCalibrationProfilesFileV1(rawProfiles);

  // The policy runs first: it fails closed on pending/shadow, an expired
  // profile, an unlocked tokenizer or a profile-set that is not exact.
  resolveReleasePolicy(release, profilesFile, now);

  // The published evidence must bind to the descriptor without a cycle.
  const evidenceDigestFile = await readJson(
    readFile,
    join(evidenceDir, "evidence-digest.json"),
    "EVIDENCE_UNREADABLE",
  );
  const benchmarkReport = await readJson(
    readFile,
    join(evidenceDir, "benchmark-report.json"),
    "EVIDENCE_UNREADABLE",
  );
  requireEqualEvidence(
    "evidence-digest.scientificEvidenceDigest",
    evidenceDigestFile.scientificEvidenceDigest,
    release.evidenceDigest,
  );
  requireEqualEvidence(
    "benchmark-report.reportDigest",
    benchmarkReport.reportDigest,
    release.evidenceDigest,
  );
  if (expectedEvidenceDigest !== undefined) {
    requireEqualEvidence(
      "--expected-evidence-digest",
      expectedEvidenceDigest,
      release.evidenceDigest,
    );
  }

  // Separately re-validate the publication digest and the closed evidence set.
  await verifyPublishedEvidence({
    evidenceDirectory: evidenceDir,
    modelDirectory: dirname(releasePath),
  });

  // The monotonic transition map.
  if (release.gateDecision !== "pass") {
    return {
      activated: false,
      rolloutState: release.rolloutState,
      code: "NO_ACTIVATION",
    };
  }
  if (release.rolloutState === "actions") {
    return {
      activated: false,
      rolloutState: "actions",
      code: "ALREADY_ACTIVE",
    };
  }
  if (release.rolloutState !== "indicator") {
    fail(
      "RELEASE_NOT_ACTIVATABLE",
      `pass release cannot advance from ${release.rolloutState}`,
    );
  }

  const activated = { ...rawRelease, rolloutState: "actions" };

  // Prove nothing but rolloutState changed.
  const { rolloutState: _before, ...beforeRest } = rawRelease;
  const { rolloutState: _after, ...afterRest } = activated;
  void _before;
  void _after;
  if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
    fail(
      "ACTIVATION_MUTATED_SCIENTIFIC_FIELDS",
      "activation changed a field other than rolloutState",
    );
  }

  const tempPath = join(
    dirname(releasePath),
    `.release.json.${randomUUID()}.tmp`,
  );
  await writeFile(tempPath, `${JSON.stringify(activated, null, 2)}\n`);
  try {
    await rename(tempPath, releasePath);
  } catch (error) {
    await remove(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return { activated: true, rolloutState: "actions", code: "ACTIVATED" };
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
    if (flag === "--release") assign("releasePath");
    else if (flag === "--profiles") assign("profilesPath");
    else if (flag === "--evidence-dir") assign("evidenceDir");
    else if (flag === "--expected-evidence-digest")
      assign("expectedEvidenceDigest");
    else fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  if (
    options.releasePath === undefined ||
    options.profilesPath === undefined ||
    options.evidenceDir === undefined
  ) {
    fail(
      "MISSING_FLAG",
      "--release, --profiles and --evidence-dir are required",
    );
  }
  return options;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  activateModelRelease(parseCliArgs(argv.slice(2)))
    .then((result) => {
      console.log(
        `activate OK — ${result.code} (rolloutState ${result.rolloutState})`,
      );
      exit(0);
    })
    .catch((error) => {
      console.error(
        `activate FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
