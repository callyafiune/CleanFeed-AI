import { describe, expect, it } from "vitest";

import type {
  ReferenceEnvironmentFacts,
  ReleasePerformanceEvidence,
  ReleasePerformanceReport,
} from "../../../tests/e2e/helpers/release-performance";
import {
  assertPerformanceReport,
  assertReferenceEnvironment,
  assertReleasePerformanceEvidence,
  referenceBrowserLockDigest,
  ReleasePerformanceRecorder,
} from "../../../tests/e2e/helpers/release-performance";
import type { RuntimeModelIdentity } from "@/shared/types";

/** The sealed bundle identity of the canonical descriptor under measurement. */
const identity: Extract<RuntimeModelIdentity, { kind: "bundle" }> = {
  kind: "bundle",
  modelId: "cleanfeed-ptbr-v1",
  modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
  bundleDigest:
    "2d47d6f3e0a6f2c7836b03c9a47b1b81f6c34159aa35ae1bdffe3507e4dc25bc",
  tokenizerDigest:
    "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135",
  aggregationVersion: "tmr-aggregation-v3",
  contentCompositionVersion: "lexical-content-v2",
  calibrationSetDigest:
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
};

/** A different bundle identity (different calibration set) — must be rejected. */
const otherIdentity: Extract<RuntimeModelIdentity, { kind: "bundle" }> = {
  ...identity,
  calibrationSetDigest: "0".repeat(64),
};

function recorderWithColdAnd100Warm(): ReleasePerformanceRecorder {
  const recorder = new ReleasePerformanceRecorder();
  recorder.recordCold({
    durationMs: 9_500,
    failed: false,
    runtimeIdentity: identity,
    backend: "wasm",
  });
  for (const duration of [...Array(95).fill(1_000), ...Array(5).fill(1_900)]) {
    recorder.recordWarm({
      durationMs: duration,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
  }
  return recorder;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("ReleasePerformanceRecorder", () => {
  it("aggregates cold, warm p95 and error rate from scalar samples", () => {
    expect(recorderWithColdAnd100Warm().snapshot()).toMatchObject({
      coldStartMs: 9_500,
      warmInferenceCount: 100,
      warmInferenceP95Ms: 1_000,
      inferenceErrorRate: 0,
    });
  });

  it("fixes the p95 at the nearest-rank index ceil(0.95*n)-1", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 100,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    // 10 warm durations 1..10; ceil(0.95*10)-1 = 9 (0-based) -> the maximum, 10.
    for (let value = 1; value <= 10; value += 1) {
      recorder.recordWarm({
        durationMs: value,
        failed: false,
        runtimeIdentity: identity,
        backend: "wasm",
      });
    }
    expect(recorder.snapshot().warmInferenceP95Ms).toBe(10);
  });

  it("computes an error rate of exactly 1/100 = 0.01 for one failed warm", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 9_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    for (let index = 0; index < 99; index += 1) {
      recorder.recordWarm({
        durationMs: 1_000,
        failed: false,
        runtimeIdentity: identity,
        backend: "wasm",
      });
    }
    recorder.recordWarm({
      durationMs: 1_000,
      failed: true,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    const snapshot = recorder.snapshot();
    expect(snapshot.warmInferenceCount).toBe(100);
    expect(snapshot.inferenceErrorRate).toBeCloseTo(0.01, 12);
  });

  it("rejects a non-finite duration", () => {
    const recorder = new ReleasePerformanceRecorder();
    expect(
      codeOf(() =>
        recorder.recordCold({
          durationMs: Number.POSITIVE_INFINITY,
          failed: false,
          runtimeIdentity: identity,
          backend: "wasm",
        }),
      ),
    ).toBe("SAMPLE_DURATION_INVALID");
  });

  it("throws when the cold sample is missing at snapshot time", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordWarm({
      durationMs: 1_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    expect(codeOf(() => recorder.snapshot())).toBe("COLD_SAMPLE_MISSING");
  });

  it("rejects a duplicate cold sample", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 9_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    expect(
      codeOf(() =>
        recorder.recordCold({
          durationMs: 9_100,
          failed: false,
          runtimeIdentity: identity,
          backend: "wasm",
        }),
      ),
    ).toBe("COLD_SAMPLE_DUPLICATE");
  });

  it("rejects a divergent runtime identity", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 9_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    expect(
      codeOf(() =>
        recorder.recordWarm({
          durationMs: 1_000,
          failed: false,
          runtimeIdentity: otherIdentity,
          backend: "wasm",
        }),
      ),
    ).toBe("RUNTIME_IDENTITY_MISMATCH");
  });

  it("rejects a divergent backend", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 9_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    expect(
      codeOf(() =>
        recorder.recordWarm({
          durationMs: 1_000,
          failed: false,
          runtimeIdentity: identity,
          backend: "webgpu",
        }),
      ),
    ).toBe("BACKEND_MISMATCH");
  });

  it("rejects a builtin (non-bundle) identity", () => {
    const recorder = new ReleasePerformanceRecorder();
    expect(
      codeOf(() =>
        recorder.recordCold({
          durationMs: 9_000,
          failed: false,
          runtimeIdentity: {
            kind: "builtin",
            modelId: "mock",
            modelVersion: "1.0.0",
            implementationVersion: "mock-v1",
          },
          backend: "wasm",
        }),
      ),
    ).toBe("RUNTIME_IDENTITY_NOT_BUNDLE");
  });

  it("caps warm samples at 1000", () => {
    const recorder = new ReleasePerformanceRecorder();
    recorder.recordCold({
      durationMs: 9_000,
      failed: false,
      runtimeIdentity: identity,
      backend: "wasm",
    });
    for (let index = 0; index < 1_000; index += 1) {
      recorder.recordWarm({
        durationMs: 1_000,
        failed: false,
        runtimeIdentity: identity,
        backend: "wasm",
      });
    }
    expect(
      codeOf(() =>
        recorder.recordWarm({
          durationMs: 1_000,
          failed: false,
          runtimeIdentity: identity,
          backend: "wasm",
        }),
      ),
    ).toBe("WARM_SAMPLE_LIMIT_EXCEEDED");
  });

  it("copies only the five scalar fields into the snapshot", () => {
    const snapshot = recorderWithColdAnd100Warm().snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "backend",
        "coldStartMs",
        "inferenceErrorRate",
        "runtimeIdentity",
        "warmInferenceCount",
        "warmInferenceP95Ms",
      ].sort(),
    );
  });
});

function validReport(): ReleasePerformanceReport {
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

describe("assertPerformanceReport — budgets are enforced with teeth", () => {
  it("accepts a within-budget report", () => {
    expect(() => assertPerformanceReport(validReport())).not.toThrow();
  });

  it("blocks a cold start over 10s", () => {
    expect(() =>
      assertPerformanceReport({ ...validReport(), coldStartMs: 10_001 }),
    ).toThrow("COLD_START_BUDGET_EXCEEDED");
  });

  it("blocks a warm p95 over 2s", () => {
    expect(() =>
      assertPerformanceReport({ ...validReport(), warmInferenceP95Ms: 2_001 }),
    ).toThrow("WARM_P95_BUDGET_EXCEEDED");
  });

  it("blocks an incremental memory over 512 MiB", () => {
    expect(() =>
      assertPerformanceReport({
        ...validReport(),
        incrementalMemoryBytes: 512 * 1024 * 1024 + 1,
      }),
    ).toThrow("MEMORY_BUDGET_EXCEEDED");
  });

  it("blocks an inference error rate at the strict 1% boundary", () => {
    expect(() =>
      assertPerformanceReport({ ...validReport(), inferenceErrorRate: 0.01 }),
    ).toThrow("ERROR_RATE_BUDGET_EXCEEDED");
  });

  it("blocks a main-thread task over 50ms", () => {
    expect(() =>
      assertPerformanceReport({
        ...validReport(),
        maximumMainThreadTaskMs: 50.001,
      }),
    ).toThrow("MAIN_THREAD_BUDGET_EXCEEDED");
  });

  it("rejects a null incremental memory measurement", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          incrementalMemoryBytes: null as unknown as number,
        }),
      ),
    ).toBe("PERFORMANCE_REPORT_INVALID");
  });

  it("rejects a negative incremental memory delta (never clamped)", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          incrementalMemoryBytes: -1,
        }),
      ),
    ).toBe("MEMORY_DELTA_NEGATIVE");
  });

  it("rejects a backend other than wasm", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({ ...validReport(), backend: "webgpu" }),
      ),
    ).toBe("BACKEND_NOT_WASM");
  });

  it("rejects fewer than 100 warm inferences", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({ ...validReport(), warmInferenceCount: 99 }),
      ),
    ).toBe("WARM_SAMPLE_COUNT_INSUFFICIENT");
  });

  it("rejects fewer than 100 inference attempts", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({ ...validReport(), inferenceAttempts: 99 }),
      ),
    ).toBe("INFERENCE_ATTEMPTS_INSUFFICIENT");
  });

  it("rejects an environment that is not Windows 11", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: {
            ...validReport().environment,
            operatingSystem: "linux 6.1.0",
          },
        }),
      ),
    ).toBe("OS_NOT_WINDOWS_11");
  });

  it("rejects an environment with fewer than four logical processors", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: { ...validReport().environment, logicalProcessors: 2 },
        }),
      ),
    ).toBe("INSUFFICIENT_LOGICAL_PROCESSORS");
  });

  it("rejects an environment with less than 8 GiB of memory", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: {
            ...validReport().environment,
            totalMemoryBytes: 4 * 1024 ** 3,
          },
        }),
      ),
    ).toBe("INSUFFICIENT_TOTAL_MEMORY");
  });

  it("rejects a browserKind other than chrome-for-testing", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: {
            ...validReport().environment,
            browserKind: "playwright-bundled-chromium" as never,
          },
        }),
      ),
    ).toBe("BROWSER_KIND_INVALID");
  });

  it("rejects a browser version other than the pinned 150.0.7871.129", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: {
            ...validReport().environment,
            browserVersion: "151.0.0.0" as never,
          },
        }),
      ),
    ).toBe("BROWSER_VERSION_INVALID");
  });

  it("rejects a browserLockDigest that is not the canonical closed-lock digest", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          environment: {
            ...validReport().environment,
            browserLockDigest: "f".repeat(64),
          },
        }),
      ),
    ).toBe("BROWSER_LOCK_DIGEST_MISMATCH");
  });

  it("rejects a memoryMeasurement other than cdp-runtime-heap-v1", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport({
          ...validReport(),
          memoryMeasurement: "performance.memory" as never,
        }),
      ),
    ).toBe("MEMORY_MEASUREMENT_INVALID");
  });

  it("cross-checks the release descriptor digest when expectations are given", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          releaseDescriptorDigest: "9".repeat(64),
        }),
      ),
    ).toBe("RELEASE_DESCRIPTOR_DIGEST_MISMATCH");
  });

  it("cross-checks the runtime-parity digest when expectations are given", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          runtimeParityDigest: "9".repeat(64),
        }),
      ),
    ).toBe("RUNTIME_PARITY_DIGEST_MISMATCH");
  });

  it("cross-checks the browser executable SHA-256 when expectations are given", () => {
    expect(
      codeOf(() =>
        assertPerformanceReport(validReport(), {
          browserExecutableSha256: "d".repeat(64),
        }),
      ),
    ).toBe("BROWSER_EXECUTABLE_SHA256_MISMATCH");
  });
});

describe("assertReferenceEnvironment", () => {
  function validFacts(): ReferenceEnvironmentFacts {
    return validReport().environment;
  }

  it("returns the closed facts for a valid reference environment", () => {
    expect(assertReferenceEnvironment(validFacts())).toEqual(validFacts());
  });

  it("rejects an unknown extra key", () => {
    expect(
      codeOf(() =>
        assertReferenceEnvironment({
          ...validFacts(),
          hostname: "reference-machine",
        } as unknown as ReferenceEnvironmentFacts),
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

describe("assertReleasePerformanceEvidence — release union", () => {
  const measured: ReleasePerformanceEvidence = {
    status: "measured",
    report: validReport(),
  };
  const notApplicable: ReleasePerformanceEvidence = {
    status: "not-applicable",
    gateDecision: "reject",
    rolloutState: "bundle-verified",
    descriptorDigest: "a".repeat(64),
  };

  it("accepts measured evidence for a promoted descriptor", () => {
    expect(() =>
      assertReleasePerformanceEvidence(measured, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "indicator-only",
        rolloutState: "indicator",
        tmrDirectoryPresent: true,
      }),
    ).not.toThrow();
  });

  it("accepts not-applicable evidence for a reject / bundle-verified descriptor", () => {
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "reject",
        rolloutState: "bundle-verified",
        tmrDirectoryPresent: false,
      }),
    ).not.toThrow();
  });

  it("rejects not-applicable evidence for an indicator-only descriptor", () => {
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "indicator-only",
        rolloutState: "indicator",
        tmrDirectoryPresent: false,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
  });

  it("rejects not-applicable evidence when the TMR model is still present", () => {
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "a".repeat(64),
        gateDecision: "reject",
        rolloutState: "bundle-verified",
        tmrDirectoryPresent: true,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
  });

  it("rejects not-applicable evidence with a divergent descriptor digest", () => {
    expect(() =>
      assertReleasePerformanceEvidence(notApplicable, {
        descriptorDigest: "e".repeat(64),
        gateDecision: "reject",
        rolloutState: "bundle-verified",
        tmrDirectoryPresent: false,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
  });

  it("rejects measured evidence whose descriptor digest diverges", () => {
    expect(() =>
      assertReleasePerformanceEvidence(measured, {
        descriptorDigest: "e".repeat(64),
        gateDecision: "pass",
        rolloutState: "actions",
        tmrDirectoryPresent: true,
      }),
    ).toThrow("PERFORMANCE_EVIDENCE_INVALID");
  });
});
