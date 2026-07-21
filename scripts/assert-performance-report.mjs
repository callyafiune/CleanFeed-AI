#!/usr/bin/env node
// The CI mirror of the performance GATE (byte-for-byte with the codes and
// thresholds in tests/e2e/helpers/release-performance.ts) so the release lane
// can enforce the budgets WITHOUT importing the Playwright helper. A value over
// budget throws a coded error; the publish job treats a throw as BLOCKED even
// when accuracy passed.
//
// Budgets (spec §10, pinned Chrome-for-Testing 150.0.7871.129 / WASM):
//   50 ms sync · 10 s cold · 2 s warm-p95 · 512 MiB incremental · < 1% error.
//
//   node scripts/assert-performance-report.mjs test-results/tmr-release-performance.json \
//     --release models/tmr-ai-text-detector/release.json \
//     --parity dist/runtime-parity.json \
//     --browser-lock tests/browser-lock.json

import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { assertReferenceEnvironment } from "./assert-reference-environment.mjs";
import { LOCKED_TOKENIZER_DIGEST } from "./release-policy.mjs";

export { referenceBrowserLockDigest } from "./assert-reference-environment.mjs";

export const PERFORMANCE_BUDGETS = Object.freeze({
  coldStartMs: 10_000,
  warmInferenceP95Ms: 2_000,
  incrementalMemoryBytes: 512 * 1024 * 1024,
  inferenceErrorRate: 0.01,
  maximumMainThreadTaskMs: 50,
  minimumWarmInferences: 100,
  minimumInferenceAttempts: 100,
});

const MEMORY_MEASUREMENT = "cdp-runtime-heap-v1";
const HEX64 = /^[0-9a-f]{64}$/u;
const BUNDLE_IDENTITY_KEYS = Object.freeze([
  "kind",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "calibrationSetDigest",
]);
const REPORT_KEYS = Object.freeze([
  "schemaVersion",
  "runtimeIdentity",
  "backend",
  "coldStartMs",
  "warmInferenceCount",
  "warmInferenceP95Ms",
  "inferenceErrorRate",
  "measuredAt",
  "releaseDescriptorDigest",
  "runtimeParityDigest",
  "memoryMeasurement",
  "incrementalMemoryBytes",
  "environment",
  "maximumMainThreadTaskMs",
  "inferenceAttempts",
]);

/** Coded, fail-closed error every guard throws. */
export class PerformanceReportError extends Error {
  constructor(code, message) {
    super(`${code} — ${message}`);
    this.name = "PerformanceReportError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PerformanceReportError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return isFiniteNonNegative(value) && Number.isInteger(value);
}

function isHex64(value) {
  return typeof value === "string" && HEX64.test(value);
}

function isBundleIdentity(value) {
  if (!hasExactKeys(value, BUNDLE_IDENTITY_KEYS)) return false;
  return (
    value.kind === "bundle" &&
    typeof value.modelId === "string" &&
    typeof value.modelVersion === "string" &&
    typeof value.bundleDigest === "string" &&
    value.tokenizerDigest === LOCKED_TOKENIZER_DIGEST &&
    typeof value.aggregationVersion === "string" &&
    typeof value.contentCompositionVersion === "string" &&
    typeof value.calibrationSetDigest === "string"
  );
}

function sameBundleIdentity(a, b) {
  return BUNDLE_IDENTITY_KEYS.every((key) => a[key] === b[key]);
}

/** Validates a report's shape, EVERY budget, then optional cross-checks. */
export function assertPerformanceReport(value, expectations = {}) {
  if (!hasExactKeys(value, REPORT_KEYS)) {
    fail("PERFORMANCE_REPORT_INVALID", "report must carry the closed key set");
  }
  if (value.schemaVersion !== 1) {
    fail("PERFORMANCE_REPORT_INVALID", "schemaVersion must be 1");
  }
  if (typeof value.measuredAt !== "string" || value.measuredAt.length === 0) {
    fail("PERFORMANCE_REPORT_INVALID", "measuredAt must be a timestamp");
  }
  if (!isHex64(value.releaseDescriptorDigest)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "releaseDescriptorDigest must be 64-hex",
    );
  }
  if (!isHex64(value.runtimeParityDigest)) {
    fail("PERFORMANCE_REPORT_INVALID", "runtimeParityDigest must be 64-hex");
  }
  if (value.memoryMeasurement !== MEMORY_MEASUREMENT) {
    fail(
      "MEMORY_MEASUREMENT_INVALID",
      `memoryMeasurement must be ${MEMORY_MEASUREMENT}`,
    );
  }
  if (!isBundleIdentity(value.runtimeIdentity)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "runtimeIdentity must be a sealed bundle identity with the locked tokenizer",
    );
  }
  if (value.backend !== "wasm") {
    fail("BACKEND_NOT_WASM", "the release lane measures the WASM backend only");
  }

  assertReferenceEnvironment(value.environment, "PERFORMANCE_REPORT_INVALID");

  if (!isFiniteNonNegative(value.coldStartMs)) {
    fail("PERFORMANCE_REPORT_INVALID", "coldStartMs must be finite and >= 0");
  }
  if (value.coldStartMs > PERFORMANCE_BUDGETS.coldStartMs) {
    fail(
      "COLD_START_BUDGET_EXCEEDED",
      `coldStartMs ${value.coldStartMs} > ${PERFORMANCE_BUDGETS.coldStartMs}`,
    );
  }
  if (!isFiniteNonNegative(value.warmInferenceP95Ms)) {
    fail("PERFORMANCE_REPORT_INVALID", "warmInferenceP95Ms must be finite");
  }
  if (value.warmInferenceP95Ms > PERFORMANCE_BUDGETS.warmInferenceP95Ms) {
    fail(
      "WARM_P95_BUDGET_EXCEEDED",
      `warmInferenceP95Ms ${value.warmInferenceP95Ms} > ${PERFORMANCE_BUDGETS.warmInferenceP95Ms}`,
    );
  }
  if (
    !isNonNegativeInteger(value.warmInferenceCount) ||
    value.warmInferenceCount < PERFORMANCE_BUDGETS.minimumWarmInferences
  ) {
    fail(
      "WARM_SAMPLE_COUNT_INSUFFICIENT",
      `warmInferenceCount must be an integer >= ${PERFORMANCE_BUDGETS.minimumWarmInferences}`,
    );
  }
  if (!isFiniteNonNegative(value.inferenceErrorRate)) {
    fail("PERFORMANCE_REPORT_INVALID", "inferenceErrorRate must be finite");
  }
  if (value.inferenceErrorRate >= PERFORMANCE_BUDGETS.inferenceErrorRate) {
    fail(
      "ERROR_RATE_BUDGET_EXCEEDED",
      `inferenceErrorRate ${value.inferenceErrorRate} >= ${PERFORMANCE_BUDGETS.inferenceErrorRate}`,
    );
  }
  if (
    typeof value.incrementalMemoryBytes !== "number" ||
    !Number.isFinite(value.incrementalMemoryBytes)
  ) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "incrementalMemoryBytes must be a finite number",
    );
  }
  if (value.incrementalMemoryBytes < 0) {
    fail(
      "MEMORY_DELTA_NEGATIVE",
      "incrementalMemoryBytes is negative; the measurement is never clamped",
    );
  }
  if (
    value.incrementalMemoryBytes > PERFORMANCE_BUDGETS.incrementalMemoryBytes
  ) {
    fail(
      "MEMORY_BUDGET_EXCEEDED",
      `incrementalMemoryBytes ${value.incrementalMemoryBytes} > ${PERFORMANCE_BUDGETS.incrementalMemoryBytes}`,
    );
  }
  if (!isFiniteNonNegative(value.maximumMainThreadTaskMs)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "maximumMainThreadTaskMs must be finite",
    );
  }
  if (
    value.maximumMainThreadTaskMs > PERFORMANCE_BUDGETS.maximumMainThreadTaskMs
  ) {
    fail(
      "MAIN_THREAD_BUDGET_EXCEEDED",
      `maximumMainThreadTaskMs ${value.maximumMainThreadTaskMs} > ${PERFORMANCE_BUDGETS.maximumMainThreadTaskMs}`,
    );
  }
  if (
    !isNonNegativeInteger(value.inferenceAttempts) ||
    value.inferenceAttempts < PERFORMANCE_BUDGETS.minimumInferenceAttempts
  ) {
    fail(
      "INFERENCE_ATTEMPTS_INSUFFICIENT",
      `inferenceAttempts must be an integer >= ${PERFORMANCE_BUDGETS.minimumInferenceAttempts}`,
    );
  }

  if (
    expectations.releaseDescriptorDigest !== undefined &&
    value.releaseDescriptorDigest !== expectations.releaseDescriptorDigest
  ) {
    fail(
      "RELEASE_DESCRIPTOR_DIGEST_MISMATCH",
      "releaseDescriptorDigest does not match the canonical descriptor",
    );
  }
  if (
    expectations.runtimeParityDigest !== undefined &&
    value.runtimeParityDigest !== expectations.runtimeParityDigest
  ) {
    fail(
      "RUNTIME_PARITY_DIGEST_MISMATCH",
      "runtimeParityDigest does not match dist/runtime-parity.json",
    );
  }
  if (
    expectations.runtimeIdentity !== undefined &&
    !sameBundleIdentity(value.runtimeIdentity, expectations.runtimeIdentity)
  ) {
    fail(
      "RUNTIME_IDENTITY_MISMATCH",
      "runtimeIdentity does not match the measured descriptor",
    );
  }
  if (
    expectations.browserExecutableSha256 !== undefined &&
    value.environment.browserExecutableSha256 !==
      expectations.browserExecutableSha256
  ) {
    fail(
      "BROWSER_EXECUTABLE_SHA256_MISMATCH",
      "browserExecutableSha256 does not match the locally resolved executable",
    );
  }
}

/** Validates the release-eligibility receipt against the canonical descriptor. */
export function assertReleasePerformanceEvidence(value, context) {
  if (!isRecord(value)) {
    fail("PERFORMANCE_EVIDENCE_INVALID", "evidence must be an object");
  }

  if (value.status === "measured") {
    if (!hasExactKeys(value, ["status", "report"])) {
      fail("PERFORMANCE_EVIDENCE_INVALID", "measured evidence has extra keys");
    }
    if (
      context.gateDecision !== "indicator-only" &&
      context.gateDecision !== "pass"
    ) {
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        "measured evidence requires a promoted descriptor",
      );
    }
    if (!context.tmrDirectoryPresent) {
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        "measured evidence requires the TMR model to be present",
      );
    }
    try {
      assertPerformanceReport(value.report);
    } catch (error) {
      fail("PERFORMANCE_EVIDENCE_INVALID", `report invalid: ${error.message}`);
    }
    if (value.report.releaseDescriptorDigest !== context.descriptorDigest) {
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        "measured report descriptor digest diverges from the canonical descriptor",
      );
    }
    return;
  }

  if (value.status === "not-applicable") {
    if (
      !hasExactKeys(value, [
        "status",
        "gateDecision",
        "rolloutState",
        "descriptorDigest",
      ])
    ) {
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        "not-applicable evidence has extra keys",
      );
    }
    if (
      value.gateDecision !== "reject" ||
      value.rolloutState !== "bundle-verified" ||
      context.gateDecision !== "reject" ||
      context.rolloutState !== "bundle-verified" ||
      value.descriptorDigest !== context.descriptorDigest ||
      context.tmrDirectoryPresent
    ) {
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        "not-applicable is only valid for a reject/bundle-verified descriptor with the TMR absent",
      );
    }
    return;
  }

  fail("PERFORMANCE_EVIDENCE_INVALID", "unknown evidence status");
}

function readJson(path, code) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(code, `cannot read ${path}: ${error}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(code, `${path} is not valid JSON: ${error}`);
  }
}

function parseCliArgs(args) {
  const options = {};
  let reportPath;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) {
      if (reportPath !== undefined) {
        fail("UNKNOWN_FLAG", `unexpected positional argument "${flag}"`);
      }
      reportPath = flag;
      continue;
    }
    const value = args[index + 1];
    const assign = (key) => {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", `${flag} needs a value`);
      options[key] = value;
      index += 1;
    };
    if (flag === "--release") assign("releasePath");
    else if (flag === "--parity") assign("parityPath");
    else if (flag === "--browser-lock") assign("browserLockPath");
    else fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  if (reportPath === undefined) {
    fail("MISSING_ARGUMENT", "the report path is required");
  }
  return { reportPath, ...options };
}

/**
 * Derives the optional cross-check expectations from the CLI paths. When
 * `--release` is supplied, the release descriptor is parsed and hashed EXACTLY as
 * the report producer hashes it (`canonicalSha256` of the whole descriptor, per
 * tests/e2e/tmr-performance.spec.ts), so a report whose `releaseDescriptorDigest`
 * diverges from the supplied release.json is reprovado with
 * RELEASE_DESCRIPTOR_DIGEST_MISMATCH — closing the CLI no-op where the descriptor
 * cross-check never ran (plan line 1364).
 */
export async function deriveExpectations(options) {
  const expectations = {};
  if (options.releasePath !== undefined) {
    const release = readJson(
      options.releasePath,
      "RELEASE_DESCRIPTOR_UNREADABLE",
    );
    const { canonicalSha256 } = await import("../contracts/canonical-json.ts");
    expectations.releaseDescriptorDigest = await canonicalSha256(release);
  }
  if (options.parityPath !== undefined) {
    const parity = readJson(options.parityPath, "RUNTIME_PARITY_UNREADABLE");
    if (!isHex64(parity.runtimeParityDigest)) {
      fail(
        "RUNTIME_PARITY_UNREADABLE",
        "parity file has no runtimeParityDigest",
      );
    }
    expectations.runtimeParityDigest = parity.runtimeParityDigest;
  }
  if (options.browserLockPath !== undefined) {
    const [{ loadTestBrowserLock, resolveLockedTestBrowser }] =
      await Promise.all([import("./test-browser-lock.mjs")]);
    const lock = await loadTestBrowserLock(options.browserLockPath);
    const { executablePath } = await resolveLockedTestBrowser(lock);
    expectations.browserExecutableSha256 = createHash("sha256")
      .update(readFileSync(executablePath))
      .digest("hex");
  }
  return expectations;
}

async function runCli() {
  const options = parseCliArgs(argv.slice(2));
  const report = readJson(options.reportPath, "PERFORMANCE_REPORT_UNREADABLE");
  const expectations = await deriveExpectations(options);
  assertPerformanceReport(report, expectations);
  console.log(
    `performance report OK — cold ${report.coldStartMs}ms, warm-p95 ` +
      `${report.warmInferenceP95Ms}ms, mem ${report.incrementalMemoryBytes}B, ` +
      `error ${report.inferenceErrorRate}, main-thread ${report.maximumMainThreadTaskMs}ms`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `performance report BLOCKED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
