// The REAL reference-performance harness: a test-only recorder fed ONLY by the
// scalar fields of the sealed CLASSIFY_TEXT protocol, plus the closed parsers
// that turn a measurement into a release GATE. A value over budget throws a
// coded error, which blocks promotion even when accuracy passes.
//
// Budgets (spec §10, on the pinned reference environment):
//   - no synchronous task > 50 ms,
//   - cold start <= 10 s,
//   - warm p95 <= 2 s/post,
//   - incremental memory <= 512 MiB,
//   - inference error rate < 1% (STRICT),
// enforced against the pinned Chrome-for-Testing 150.0.7871.129 / WASM lane.
//
// The recorder retains NO post text, URL, hash or score — only the five scalar
// outcome fields — and the report/environment carry no path, hostname or user.
// The REAL numbers are produced by running this on the reference machine; that
// is a documented OPERATOR step and no number here is ever fabricated.

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Page } from "@playwright/test";

import { LOCKED_TOKENIZER_DIGEST } from "../../../scripts/release-policy.mjs";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { UserSettings } from "@/shared/settings-types";
import type {
  Backend,
  ClassificationResult,
  RuntimeModelIdentity,
} from "@/shared/types";

/** The sealed bundle identity a promoted measurement must carry. */
export type BundleIdentity = Extract<RuntimeModelIdentity, { kind: "bundle" }>;

/** The aggregate, privacy-safe snapshot the recorder produces. */
export interface HarnessPerformanceSnapshot {
  runtimeIdentity: BundleIdentity;
  backend: Backend;
  coldStartMs: number;
  warmInferenceCount: number;
  warmInferenceP95Ms: number;
  inferenceErrorRate: number;
}

/** The full, canonical performance report sealed as release evidence. */
export interface ReleasePerformanceReport extends HarnessPerformanceSnapshot {
  schemaVersion: 1;
  measuredAt: string;
  releaseDescriptorDigest: string;
  runtimeParityDigest: string;
  memoryMeasurement: "cdp-runtime-heap-v1";
  incrementalMemoryBytes: number;
  environment: {
    operatingSystem: string;
    logicalProcessors: number;
    totalMemoryBytes: number;
    browserKind: "chrome-for-testing";
    browserVersion: "150.0.7871.129";
    browserExecutableSha256: string;
    browserLockDigest: string;
  };
  maximumMainThreadTaskMs: number;
  inferenceAttempts: number;
}

export type ReferenceEnvironmentFacts = ReleasePerformanceReport["environment"];

/** The release-eligibility receipt: a measured report, or a reject-only receipt. */
export type ReleasePerformanceEvidence =
  | { status: "measured"; report: ReleasePerformanceReport }
  | {
      status: "not-applicable";
      gateDecision: "reject";
      rolloutState: "bundle-verified";
      descriptorDigest: string;
    };

/** The enforced budgets. Every bound blocks the release lane on a regression. */
export const PERFORMANCE_BUDGETS = Object.freeze({
  coldStartMs: 10_000,
  warmInferenceP95Ms: 2_000,
  incrementalMemoryBytes: 512 * 1024 * 1024,
  inferenceErrorRate: 0.01,
  maximumMainThreadTaskMs: 50,
  minimumWarmInferences: 100,
  minimumInferenceAttempts: 100,
  maximumWarmSamples: 1_000,
});

/** The pinned reference-environment coordinates (spec §10). */
export const REFERENCE_BROWSER_KIND = "chrome-for-testing" as const;
export const REFERENCE_BROWSER_VERSION = "150.0.7871.129" as const;
export const REFERENCE_MINIMUM_LOGICAL_PROCESSORS = 4;
export const REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES = 8 * 1024 ** 3;
export const REFERENCE_WINDOWS_MINIMUM_BUILD = 22_000;
export const MEMORY_MEASUREMENT = "cdp-runtime-heap-v1" as const;

/** The CLOSED test browser lock the reference lane pins, byte-for-byte. */
const REFERENCE_BROWSER_LOCK = Object.freeze({
  schemaVersion: 1,
  product: "chrome",
  channel: "stable",
  version: REFERENCE_BROWSER_VERSION,
});

/** Coded, fail-closed error thrown by every guard in this harness. */
export class ReleasePerformanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} — ${message}`);
    this.name = "ReleasePerformanceError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ReleasePerformanceError(code, message);
}

// ---------------------------------------------------------------------------
// Canonical closed-lock digest (sync — the runtime hashes the same 4-key JSON).
// ---------------------------------------------------------------------------

function sortedStringify(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`)
    .join(",")}}`;
}

/** SHA-256 (hex) of the canonical JSON of the closed 4-key browser lock. */
export function referenceBrowserLockDigest(): string {
  return createHash("sha256")
    .update(sortedStringify(REFERENCE_BROWSER_LOCK), "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/u;
const WINDOWS_RELEASE = /^win32 10\.0\.(\d+)$/u;
const BUNDLE_IDENTITY_KEYS = [
  "kind",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "calibrationSetDigest",
] as const;
const ENVIRONMENT_KEYS = [
  "operatingSystem",
  "logicalProcessors",
  "totalMemoryBytes",
  "browserKind",
  "browserVersion",
  "browserExecutableSha256",
  "browserLockDigest",
] as const;
const REPORT_KEYS = [
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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const own = Object.keys(value);
  return (
    own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegative(value) && Number.isInteger(value);
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value);
}

function isBundleIdentity(value: unknown): value is BundleIdentity {
  if (!hasExactKeys(value, BUNDLE_IDENTITY_KEYS)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "bundle" &&
    typeof record.modelId === "string" &&
    typeof record.modelVersion === "string" &&
    typeof record.bundleDigest === "string" &&
    record.tokenizerDigest === LOCKED_TOKENIZER_DIGEST &&
    typeof record.aggregationVersion === "string" &&
    typeof record.contentCompositionVersion === "string" &&
    typeof record.calibrationSetDigest === "string"
  );
}

function sameBundleIdentity(a: BundleIdentity, b: BundleIdentity): boolean {
  return BUNDLE_IDENTITY_KEYS.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** One measured outcome, reduced to the five scalar fields the recorder keeps. */
export interface PerformanceSample {
  durationMs: number;
  failed: boolean;
  runtimeIdentity: RuntimeModelIdentity;
  backend: Backend;
}

/**
 * Accumulates cold + warm samples and derives the privacy-safe snapshot. It
 * accepts ONLY the five scalar fields of an outcome — never a
 * {@link ClassificationResult}, post text or metadata — and locks onto the first
 * sample's bundle identity + backend so a divergence fails closed.
 */
export class ReleasePerformanceRecorder {
  #cold: PerformanceSample | undefined;
  readonly #warm: PerformanceSample[] = [];
  #identity: BundleIdentity | undefined;
  #backend: Backend | undefined;

  recordCold(sample: PerformanceSample): void {
    if (this.#cold !== undefined) {
      fail("COLD_SAMPLE_DUPLICATE", "a cold sample was already recorded");
    }
    this.#validate(sample);
    this.#cold = sample;
  }

  recordWarm(sample: PerformanceSample): void {
    if (this.#warm.length >= PERFORMANCE_BUDGETS.maximumWarmSamples) {
      fail(
        "WARM_SAMPLE_LIMIT_EXCEEDED",
        `at most ${PERFORMANCE_BUDGETS.maximumWarmSamples} warm samples are retained`,
      );
    }
    this.#validate(sample);
    this.#warm.push(sample);
  }

  #validate(sample: PerformanceSample): void {
    if (!isFiniteNonNegative(sample.durationMs)) {
      fail("SAMPLE_DURATION_INVALID", "durationMs must be finite and >= 0");
    }
    if (!isBundleIdentity(sample.runtimeIdentity)) {
      fail(
        "RUNTIME_IDENTITY_NOT_BUNDLE",
        "the recorder only accepts a sealed bundle identity",
      );
    }
    if (this.#identity === undefined) {
      this.#identity = sample.runtimeIdentity;
      this.#backend = sample.backend;
      return;
    }
    if (!sameBundleIdentity(this.#identity, sample.runtimeIdentity)) {
      fail(
        "RUNTIME_IDENTITY_MISMATCH",
        "every sample must share one bundle identity",
      );
    }
    if (this.#backend !== sample.backend) {
      fail("BACKEND_MISMATCH", "every sample must share one backend");
    }
  }

  snapshot(): HarnessPerformanceSnapshot {
    if (this.#cold === undefined || this.#identity === undefined) {
      fail("COLD_SAMPLE_MISSING", "no cold sample was recorded");
    }
    const durations = this.#warm
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    const failures = this.#warm.filter((sample) => sample.failed).length;
    return {
      runtimeIdentity: this.#identity,
      backend: this.#backend as Backend,
      coldStartMs: this.#cold.durationMs,
      warmInferenceCount: this.#warm.length,
      warmInferenceP95Ms: nearestRankP95(durations),
      inferenceErrorRate:
        this.#warm.length === 0 ? 0 : failures / this.#warm.length,
    };
  }
}

/** Nearest-rank p95: index = ceil(0.95 * n) - 1 over the ascending durations. */
export function nearestRankP95(sortedAscending: readonly number[]): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.max(
    0,
    Math.min(
      sortedAscending.length - 1,
      Math.ceil(0.95 * sortedAscending.length) - 1,
    ),
  );
  return sortedAscending[index] as number;
}

// ---------------------------------------------------------------------------
// Environment + report gate
// ---------------------------------------------------------------------------

function validateEnvironment(value: unknown, invalidCode: string): void {
  if (!hasExactKeys(value, ENVIRONMENT_KEYS)) {
    fail(invalidCode, "environment must carry exactly the closed key set");
  }
  const env = value as Record<string, unknown>;
  if (env.browserKind !== REFERENCE_BROWSER_KIND) {
    fail(
      "BROWSER_KIND_INVALID",
      `browserKind must be ${REFERENCE_BROWSER_KIND}`,
    );
  }
  if (env.browserVersion !== REFERENCE_BROWSER_VERSION) {
    fail(
      "BROWSER_VERSION_INVALID",
      `browserVersion must be the pinned ${REFERENCE_BROWSER_VERSION}`,
    );
  }
  const osMatch =
    typeof env.operatingSystem === "string"
      ? WINDOWS_RELEASE.exec(env.operatingSystem)
      : null;
  const build = osMatch ? Number(osMatch[1]) : Number.NaN;
  if (!Number.isFinite(build) || build < REFERENCE_WINDOWS_MINIMUM_BUILD) {
    fail(
      "OS_NOT_WINDOWS_11",
      `operatingSystem must be Windows 11 (win32 build >= ${REFERENCE_WINDOWS_MINIMUM_BUILD})`,
    );
  }
  if (
    !isNonNegativeInteger(env.logicalProcessors) ||
    env.logicalProcessors < REFERENCE_MINIMUM_LOGICAL_PROCESSORS
  ) {
    fail(
      "INSUFFICIENT_LOGICAL_PROCESSORS",
      `logicalProcessors must be >= ${REFERENCE_MINIMUM_LOGICAL_PROCESSORS}`,
    );
  }
  if (
    !isFiniteNonNegative(env.totalMemoryBytes) ||
    env.totalMemoryBytes < REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES
  ) {
    fail(
      "INSUFFICIENT_TOTAL_MEMORY",
      `totalMemoryBytes must be >= ${REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES}`,
    );
  }
  if (!isHex64(env.browserExecutableSha256)) {
    fail(
      "BROWSER_EXECUTABLE_SHA256_INVALID",
      "browserExecutableSha256 must be a 64-hex digest",
    );
  }
  if (env.browserLockDigest !== referenceBrowserLockDigest()) {
    fail(
      "BROWSER_LOCK_DIGEST_MISMATCH",
      "browserLockDigest must equal the canonical closed-lock digest",
    );
  }
}

/** Validates the closed reference-environment facts and returns them. */
export function assertReferenceEnvironment(
  value: unknown,
): ReferenceEnvironmentFacts {
  validateEnvironment(value, "REFERENCE_ENVIRONMENT_INVALID");
  return value as ReferenceEnvironmentFacts;
}

/** Optional cross-checks against the canonical descriptor / parity / executable. */
export interface PerformanceReportExpectations {
  releaseDescriptorDigest?: string;
  runtimeParityDigest?: string;
  runtimeIdentity?: BundleIdentity;
  browserExecutableSha256?: string;
}

/**
 * The GATE: validates a report's shape, then EVERY budget, then optional
 * cross-checks. A single value over budget throws — the release lane treats a
 * throw as blocked even if accuracy passed.
 */
export function assertPerformanceReport(
  value: unknown,
  expectations: PerformanceReportExpectations = {},
): asserts value is ReleasePerformanceReport {
  if (!hasExactKeys(value, REPORT_KEYS)) {
    fail("PERFORMANCE_REPORT_INVALID", "report must carry the closed key set");
  }
  const report = value as Record<string, unknown>;

  if (report.schemaVersion !== 1) {
    fail("PERFORMANCE_REPORT_INVALID", "schemaVersion must be 1");
  }
  if (typeof report.measuredAt !== "string" || report.measuredAt.length === 0) {
    fail("PERFORMANCE_REPORT_INVALID", "measuredAt must be a timestamp");
  }
  if (!isHex64(report.releaseDescriptorDigest)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "releaseDescriptorDigest must be 64-hex",
    );
  }
  if (!isHex64(report.runtimeParityDigest)) {
    fail("PERFORMANCE_REPORT_INVALID", "runtimeParityDigest must be 64-hex");
  }
  if (report.memoryMeasurement !== MEMORY_MEASUREMENT) {
    fail(
      "MEMORY_MEASUREMENT_INVALID",
      `memoryMeasurement must be ${MEMORY_MEASUREMENT}`,
    );
  }
  if (!isBundleIdentity(report.runtimeIdentity)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "runtimeIdentity must be a sealed bundle identity with the locked tokenizer",
    );
  }
  if (report.backend !== "wasm") {
    fail("BACKEND_NOT_WASM", "the release lane measures the WASM backend only");
  }

  validateEnvironment(report.environment, "PERFORMANCE_REPORT_INVALID");

  // Cold start.
  if (!isFiniteNonNegative(report.coldStartMs)) {
    fail("PERFORMANCE_REPORT_INVALID", "coldStartMs must be finite and >= 0");
  }
  if (report.coldStartMs > PERFORMANCE_BUDGETS.coldStartMs) {
    fail(
      "COLD_START_BUDGET_EXCEEDED",
      `coldStartMs ${report.coldStartMs} > ${PERFORMANCE_BUDGETS.coldStartMs}`,
    );
  }
  // Warm p95.
  if (!isFiniteNonNegative(report.warmInferenceP95Ms)) {
    fail("PERFORMANCE_REPORT_INVALID", "warmInferenceP95Ms must be finite");
  }
  if (report.warmInferenceP95Ms > PERFORMANCE_BUDGETS.warmInferenceP95Ms) {
    fail(
      "WARM_P95_BUDGET_EXCEEDED",
      `warmInferenceP95Ms ${report.warmInferenceP95Ms} > ${PERFORMANCE_BUDGETS.warmInferenceP95Ms}`,
    );
  }
  // Warm sample count.
  if (
    !isNonNegativeInteger(report.warmInferenceCount) ||
    report.warmInferenceCount < PERFORMANCE_BUDGETS.minimumWarmInferences
  ) {
    fail(
      "WARM_SAMPLE_COUNT_INSUFFICIENT",
      `warmInferenceCount must be an integer >= ${PERFORMANCE_BUDGETS.minimumWarmInferences}`,
    );
  }
  // Error rate (STRICT < 1%).
  if (!isFiniteNonNegative(report.inferenceErrorRate)) {
    fail("PERFORMANCE_REPORT_INVALID", "inferenceErrorRate must be finite");
  }
  if (report.inferenceErrorRate >= PERFORMANCE_BUDGETS.inferenceErrorRate) {
    fail(
      "ERROR_RATE_BUDGET_EXCEEDED",
      `inferenceErrorRate ${report.inferenceErrorRate} >= ${PERFORMANCE_BUDGETS.inferenceErrorRate}`,
    );
  }
  // Incremental memory: shape, then never-clamped negative, then budget.
  if (
    typeof report.incrementalMemoryBytes !== "number" ||
    !Number.isFinite(report.incrementalMemoryBytes)
  ) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "incrementalMemoryBytes must be a finite number",
    );
  }
  if (report.incrementalMemoryBytes < 0) {
    fail(
      "MEMORY_DELTA_NEGATIVE",
      "incrementalMemoryBytes is negative; the measurement is never clamped",
    );
  }
  if (
    report.incrementalMemoryBytes > PERFORMANCE_BUDGETS.incrementalMemoryBytes
  ) {
    fail(
      "MEMORY_BUDGET_EXCEEDED",
      `incrementalMemoryBytes ${report.incrementalMemoryBytes} > ${PERFORMANCE_BUDGETS.incrementalMemoryBytes}`,
    );
  }
  // Main-thread task budget.
  if (!isFiniteNonNegative(report.maximumMainThreadTaskMs)) {
    fail(
      "PERFORMANCE_REPORT_INVALID",
      "maximumMainThreadTaskMs must be finite",
    );
  }
  if (
    report.maximumMainThreadTaskMs > PERFORMANCE_BUDGETS.maximumMainThreadTaskMs
  ) {
    fail(
      "MAIN_THREAD_BUDGET_EXCEEDED",
      `maximumMainThreadTaskMs ${report.maximumMainThreadTaskMs} > ${PERFORMANCE_BUDGETS.maximumMainThreadTaskMs}`,
    );
  }
  // Total attempts.
  if (
    !isNonNegativeInteger(report.inferenceAttempts) ||
    report.inferenceAttempts < PERFORMANCE_BUDGETS.minimumInferenceAttempts
  ) {
    fail(
      "INFERENCE_ATTEMPTS_INSUFFICIENT",
      `inferenceAttempts must be an integer >= ${PERFORMANCE_BUDGETS.minimumInferenceAttempts}`,
    );
  }

  // Optional cross-checks against the canonical job inputs.
  if (
    expectations.releaseDescriptorDigest !== undefined &&
    report.releaseDescriptorDigest !== expectations.releaseDescriptorDigest
  ) {
    fail(
      "RELEASE_DESCRIPTOR_DIGEST_MISMATCH",
      "releaseDescriptorDigest does not match the canonical descriptor",
    );
  }
  if (
    expectations.runtimeParityDigest !== undefined &&
    report.runtimeParityDigest !== expectations.runtimeParityDigest
  ) {
    fail(
      "RUNTIME_PARITY_DIGEST_MISMATCH",
      "runtimeParityDigest does not match dist/runtime-parity.json",
    );
  }
  if (
    expectations.runtimeIdentity !== undefined &&
    !sameBundleIdentity(
      report.runtimeIdentity as BundleIdentity,
      expectations.runtimeIdentity,
    )
  ) {
    fail(
      "RUNTIME_IDENTITY_MISMATCH",
      "runtimeIdentity does not match the measured descriptor",
    );
  }
  const env = report.environment as ReferenceEnvironmentFacts;
  if (
    expectations.browserExecutableSha256 !== undefined &&
    env.browserExecutableSha256 !== expectations.browserExecutableSha256
  ) {
    fail(
      "BROWSER_EXECUTABLE_SHA256_MISMATCH",
      "browserExecutableSha256 does not match the locally resolved executable",
    );
  }
}

/** The canonical descriptor facts the evidence union is checked against. */
export interface ReleasePerformanceEvidenceContext {
  descriptorDigest: string;
  gateDecision: "pending" | "reject" | "indicator-only" | "pass";
  rolloutState: "bundle-verified" | "shadow" | "indicator" | "actions";
  tmrDirectoryPresent: boolean;
}

/**
 * Validates the release-eligibility receipt against the canonical descriptor.
 * `measured` is accepted only for a promoted (indicator-only/pass) descriptor
 * whose TMR is present and whose digest matches; `not-applicable` is accepted
 * only for a reject / bundle-verified descriptor with the TMR absent.
 */
export function assertReleasePerformanceEvidence(
  value: unknown,
  context: ReleasePerformanceEvidenceContext,
): asserts value is ReleasePerformanceEvidence {
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
      fail(
        "PERFORMANCE_EVIDENCE_INVALID",
        `report invalid: ${(error as Error).message}`,
      );
    }
    if (
      (value.report as ReleasePerformanceReport).releaseDescriptorDigest !==
      context.descriptorDigest
    ) {
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

// ---------------------------------------------------------------------------
// Report composition + atomic write (used by the reference spec)
// ---------------------------------------------------------------------------

/** The inputs the spec composes into a full report after measurement. */
export interface ComposeReportInput {
  snapshot: HarnessPerformanceSnapshot;
  environment: ReferenceEnvironmentFacts;
  incrementalMemoryBytes: number;
  maximumMainThreadTaskMs: number;
  inferenceAttempts: number;
  releaseDescriptorDigest: string;
  runtimeParityDigest: string;
  measuredAt?: string;
}

/** Composes a full {@link ReleasePerformanceReport} from a snapshot + facts. */
export function composeReleasePerformanceReport(
  input: ComposeReportInput,
): ReleasePerformanceReport {
  return {
    schemaVersion: 1,
    runtimeIdentity: input.snapshot.runtimeIdentity,
    backend: input.snapshot.backend,
    coldStartMs: input.snapshot.coldStartMs,
    warmInferenceCount: input.snapshot.warmInferenceCount,
    warmInferenceP95Ms: input.snapshot.warmInferenceP95Ms,
    inferenceErrorRate: input.snapshot.inferenceErrorRate,
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    releaseDescriptorDigest: input.releaseDescriptorDigest,
    runtimeParityDigest: input.runtimeParityDigest,
    memoryMeasurement: MEMORY_MEASUREMENT,
    incrementalMemoryBytes: input.incrementalMemoryBytes,
    environment: input.environment,
    maximumMainThreadTaskMs: input.maximumMainThreadTaskMs,
    inferenceAttempts: input.inferenceAttempts,
  };
}

/** Deterministic key-sorted JSON for the evidence receipt. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (isRecord(nested)) {
      const ordered: Record<string, unknown> = {};
      for (const key of Object.keys(nested).sort()) ordered[key] = nested[key];
      return ordered;
    }
    return nested;
  });
}

/** Atomically writes the canonical evidence JSON to `outputPath`. */
export function writeReleasePerformanceEvidence(
  evidence: ReleasePerformanceEvidence,
  outputPath: string,
): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = join(
    dirname(outputPath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  writeFileSync(temporary, `${canonicalJson(evidence)}\n`);
  renameSync(temporary, outputPath);
}

// ---------------------------------------------------------------------------
// Measurement primitives (reference lane only; driven by the sealed protocol)
// ---------------------------------------------------------------------------

/** The canonical WASM-only settings the reference lane fixes before measuring. */
export function referenceRuntimeSettings(): Partial<UserSettings> {
  return {
    enabled: true,
    backendPreference: "wasm",
    webGpuEnabled: false,
    wasmEnabled: true,
    useMockModel: false,
    historyEnabled: false,
    storeFullText: false,
    manualAnalysisEnabled: true,
  };
}

/** Pushes the canonical reference settings from the options page. */
export async function configureReferenceSettings(
  optionsPage: Page,
): Promise<void> {
  await optionsPage.evaluate((settings) => {
    return chrome.runtime.sendMessage({
      source: "options",
      target: "background",
      type: "UPDATE_SETTINGS",
      payload: settings,
    });
  }, referenceRuntimeSettings());
}

/**
 * Classifies one text through the EXISTING sealed `CLASSIFY_TEXT` envelope and
 * returns the validated {@link ClassificationResult}. It adds no message, route
 * or instrumentation to the sealed core.
 */
export async function classifyText(
  manualPage: Page,
  text: string,
  requestId: string,
): Promise<ClassificationResult> {
  const response = await manualPage.evaluate(
    ({ text: body, requestId: id }) =>
      chrome.runtime.sendMessage({
        source: "manual",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId: id,
        payload: { text: body, platform: "linkedin", manual: true },
      }),
    { text, requestId },
  );
  const message = parseExtensionMessage(response);
  if (message.type !== "CLASSIFICATION_RESULT") {
    fail(
      "PERFORMANCE_CLASSIFICATION_RESULT_REQUIRED",
      `expected CLASSIFICATION_RESULT, got ${message.type}`,
    );
  }
  return message.payload as ClassificationResult;
}

/**
 * Builds `count` unique, eligible PT-BR/LinkedIn texts (>= 80 words each) so no
 * two requests can hit the classification cache. The text never enters the
 * recorder or the report — only its resulting scalar timing does.
 */
export function buildEligiblePortugueseTexts(count: number): string[] {
  const base = [
    "Compartilho hoje uma reflexão sincera sobre disciplina, aprendizado contínuo",
    "e a importância de processos claros dentro de qualquer equipe madura de tecnologia.",
    "Ao longo dos últimos anos percebi que resultados sustentáveis nascem de rotinas",
    "simples, de comunicação honesta e da revisão constante das nossas próprias decisões.",
    "Cada projeto entregue trouxe lições práticas sobre prioridade, foco e colaboração",
    "com respeito ao tempo das pessoas envolvidas em cada etapa dessa jornada compartilhada.",
    "Acredito que a transparência gera confiança, e que a confiança acelera qualquer",
    "iniciativa coletiva que realmente pretenda durar e evoluir com método e clareza.",
  ].join(" ");
  return Array.from(
    { length: count },
    (_unused, index) =>
      `${base} Registro único número ${index + 1} para evitar qualquer acerto de cache durante a medição de desempenho.`,
  );
}
