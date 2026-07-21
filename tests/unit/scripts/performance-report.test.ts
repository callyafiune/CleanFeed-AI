import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../../contracts/canonical-json";
import {
  assertReferenceEnvironment,
  referenceBrowserLockDigest as environmentLockDigest,
} from "../../../scripts/assert-reference-environment.mjs";
import {
  assertPerformanceReport,
  assertReleasePerformanceEvidence,
  deriveExpectations,
  referenceBrowserLockDigest,
} from "../../../scripts/assert-performance-report.mjs";

/**
 * The Node re-implementation of the report/evidence parsers (mirroring
 * tests/e2e/helpers/release-performance.ts) so CI can enforce the budgets
 * WITHOUT importing the Playwright helper. Its codes and thresholds must match
 * the TS parser byte-for-byte; a value over budget must block the release lane.
 */

const identity = {
  kind: "bundle",
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  bundleDigest:
    "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c",
  tokenizerDigest:
    "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  calibrationSetDigest:
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
};

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runtimeIdentity: identity,
    backend: "wasm",
    coldStartMs: 9_500,
    warmInferenceCount: 100,
    warmInferenceP95Ms: 1_000,
    inferenceErrorRate: 0,
    measuredAt: "2026-07-19T12:00:00.000Z",
    releaseDescriptorDigest: "a".repeat(64),
    runtimeParityDigest: "b".repeat(64),
    memoryMeasurement: "cdp-runtime-heap-v1",
    incrementalMemoryBytes: 128 * 1024 * 1024,
    environment: {
      operatingSystem: "win32 10.0.26200",
      logicalProcessors: 4,
      totalMemoryBytes: 8 * 1024 ** 3,
      browserKind: "chrome-for-testing",
      browserVersion: "150.0.7871.129",
      browserExecutableSha256: "c".repeat(64),
      browserLockDigest: referenceBrowserLockDigest(),
    },
    maximumMainThreadTaskMs: 42,
    inferenceAttempts: 101,
  };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const temporaryDirs: string[] = [];

afterAll(() => {
  for (const dir of temporaryDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("assert-performance-report.mjs (CI mirror)", () => {
  it("agrees with the TS parser on the closed-lock digest", () => {
    expect(referenceBrowserLockDigest()).toBe(environmentLockDigest());
  });

  it("accepts a within-budget report", () => {
    expect(() => assertPerformanceReport(validReport())).not.toThrow();
  });

  it("blocks each individual budget regression", () => {
    expect(() =>
      assertPerformanceReport({ ...validReport(), coldStartMs: 10_001 }),
    ).toThrow("COLD_START_BUDGET_EXCEEDED");
    expect(() =>
      assertPerformanceReport({ ...validReport(), warmInferenceP95Ms: 2_001 }),
    ).toThrow("WARM_P95_BUDGET_EXCEEDED");
    expect(() =>
      assertPerformanceReport({
        ...validReport(),
        incrementalMemoryBytes: 512 * 1024 * 1024 + 1,
      }),
    ).toThrow("MEMORY_BUDGET_EXCEEDED");
    expect(() =>
      assertPerformanceReport({ ...validReport(), inferenceErrorRate: 0.01 }),
    ).toThrow("ERROR_RATE_BUDGET_EXCEEDED");
    expect(() =>
      assertPerformanceReport({
        ...validReport(),
        maximumMainThreadTaskMs: 50.001,
      }),
    ).toThrow("MAIN_THREAD_BUDGET_EXCEEDED");
  });

  it("rejects a null incremental memory and a negative delta", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          incrementalMemoryBytes: null,
        }),
      ),
    ).toBe("PERFORMANCE_REPORT_INVALID");
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          incrementalMemoryBytes: -1,
        }),
      ),
    ).toBe("MEMORY_DELTA_NEGATIVE");
  });

  it("rejects a non-wasm backend and fewer than 100 inferences", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({ ...validReport(), backend: "webgpu" }),
      ),
    ).toBe("BACKEND_NOT_WASM");
    expect(
      codeOf(() =>
        assertPerformanceReport({ ...validReport(), warmInferenceCount: 99 }),
      ),
    ).toBe("WARM_SAMPLE_COUNT_INSUFFICIENT");
  });

  it("rejects a non-reference environment or drifted browser lock", () => {
    const base = validReport();
    const env = base.environment as Record<string, unknown>;
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...base,
          environment: { ...env, operatingSystem: "linux 6.1.0" },
        }),
      ),
    ).toBe("OS_NOT_WINDOWS_11");
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...base,
          environment: { ...env, browserKind: "playwright-bundled-chromium" },
        }),
      ),
    ).toBe("BROWSER_KIND_INVALID");
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...base,
          environment: { ...env, browserVersion: "151.0.0.0" },
        }),
      ),
    ).toBe("BROWSER_VERSION_INVALID");
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...base,
          environment: { ...env, browserLockDigest: "f".repeat(64) },
        }),
      ),
    ).toBe("BROWSER_LOCK_DIGEST_MISMATCH");
  });

  it("binds the --release descriptor digest so a divergent report is reprovado", async () => {
    // A stand-in release descriptor; the digest is canonicalSha256 of the WHOLE
    // parsed descriptor, exactly as the report producer computes it.
    const release = {
      schemaVersion: 1,
      modelId: "tmr-ai-text-detector",
      modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
      bundleDigest: "3".repeat(64),
      tokenizerDigest:
        "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
      aggregationVersion: "tmr-aggregation-v2",
      contentCompositionVersion: "lexical-content-v1",
      calibrationSetDigest: "4".repeat(64),
      profileDigests: ["a".repeat(64)],
      rolloutState: "actions",
      gateDecision: "pass",
      issuedAt: "2026-07-19T12:00:00.000Z",
      evidenceDigest: "f".repeat(64),
    };
    const dir = mkdtempSync(join(tmpdir(), "cleanfeed-release-"));
    temporaryDirs.push(dir);
    const releasePath = join(dir, "release.json");
    writeFileSync(releasePath, JSON.stringify(release), "utf8");

    const digest = await canonicalSha256(release);
    const expectations = await deriveExpectations({ releasePath });

    // The CLI now actually derives the descriptor digest from --release ...
    expect(expectations.releaseDescriptorDigest).toBe(digest);

    // ... so a report whose digest matches the supplied release.json passes ...
    expect(() =>
      assertPerformanceReport(
        { ...validReport(), releaseDescriptorDigest: digest },
        expectations,
      ),
    ).not.toThrow();

    // ... and one that diverges from it is reprovado (the pre-fix CLI no-op).
    expect(
      codeOf(() =>
        assertPerformanceReport(
          { ...validReport(), releaseDescriptorDigest: "9".repeat(64) },
          expectations,
        ),
      ),
    ).toBe("RELEASE_DESCRIPTOR_DIGEST_MISMATCH");
  });

  it("cross-checks descriptor, parity and executable expectations", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          releaseDescriptorDigest: "9".repeat(64),
        }),
      ),
    ).toBe("RELEASE_DESCRIPTOR_DIGEST_MISMATCH");
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          runtimeParityDigest: "9".repeat(64),
        }),
      ),
    ).toBe("RUNTIME_PARITY_DIGEST_MISMATCH");
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          browserExecutableSha256: "d".repeat(64),
        }),
      ),
    ).toBe("BROWSER_EXECUTABLE_SHA256_MISMATCH");
  });
});

describe("assert-performance-report.mjs — release evidence union", () => {
  it("accepts measured evidence for a promoted descriptor", () => {
    expect(() =>
      assertReleasePerformanceEvidence(
        { status: "measured", report: validReport() },
        {
          descriptorDigest: "a".repeat(64),
          gateDecision: "pass",
          rolloutState: "actions",
          tmrDirectoryPresent: true,
        },
      ),
    ).not.toThrow();
  });

  it("accepts not-applicable only for reject / bundle-verified with TMR absent", () => {
    const notApplicable = {
      status: "not-applicable",
      gateDecision: "reject",
      rolloutState: "bundle-verified",
      descriptorDigest: "a".repeat(64),
    };
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "reject",
        rolloutState: "bundle-verified",
        tmrDirectoryPresent: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "indicator-only",
        rolloutState: "indicator",
        tmrDirectoryPresent: false,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "reject",
        rolloutState: "bundle-verified",
        tmrDirectoryPresent: true,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
  });
});

describe("assert-reference-environment.mjs (CI mirror)", () => {
  function validFacts(): Record<string, unknown> {
    return validReport().environment as Record<string, unknown>;
  }

  it("returns the closed facts for a valid reference environment", () => {
    expect(assertReferenceEnvironment(validFacts())).toEqual(validFacts());
  });

  it("rejects an unknown extra key", () => {
    expect(
      codeOf(() =>
        assertReferenceEnvironment({ ...validFacts(), hostname: "ref" }),
      ),
    ).toBe("REFERENCE_ENVIRONMENT_INVALID");
  });

  it("rejects a non-Windows-11 operating system", () => {
    expect(
      codeOf(() =>
        assertReferenceEnvironment({
          ...validFacts(),
          operatingSystem: "win32 10.0.19045",
        }),
      ),
    ).toBe("OS_NOT_WINDOWS_11");
  });
});
