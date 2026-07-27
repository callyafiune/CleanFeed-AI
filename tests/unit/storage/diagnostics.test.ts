import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ModelDiagnosticsSource,
  ModelDiagnosticsView,
} from "@/shared/diagnostic-types";
import type { ModelStatus, StorageArea } from "@/shared/types";
import { DiagnosticsRepository } from "@/storage/diagnostics";
import { MetricsRepository } from "@/storage/metrics";

const HASH = "a".repeat(64);
const BUNDLE_DIGEST = "b".repeat(64);
const TOKENIZER_DIGEST =
  "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135";
const CALIBRATION_SET_DIGEST = "c".repeat(64);
const PROFILE_DIGEST = "d".repeat(64);
/** A content hash distinct from every technical digest above, so the
 * not-contained assertion has teeth (a technical digest is allowed to appear). */
const CONTENT_HASH = "e".repeat(64);
const PORTUGUESE_TEXT =
  "Este é um texto de publicação em português que jamais deveria vazar num relatório de diagnóstico.";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

function fullModelStatus(): ModelStatus {
  return {
    state: "ready",
    backend: "mock",
    runtimeIdentity: {
      kind: "bundle",
      modelId: "onnx-classifier",
      modelVersion: "mock-v1",
      bundleDigest: "a".repeat(64),
      tokenizerDigest: "b".repeat(64),
      aggregationVersion: "tmr-aggregation-v3",
      contentCompositionVersion: "lexical-content-v2",
      calibrationSetDigest:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    },
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes: ["WEBGPU_FALLBACK"],
    initializedAt: 1_700_000_000_000,
    supportsBatching: true,
  };
}

async function buildRepository(): Promise<DiagnosticsRepository> {
  const metrics = new MetricsRepository(new MemoryStorageArea());
  await metrics.recordLatency(42);
  await metrics.record({ status: "possibly_ai", backend: "mock" });

  return new DiagnosticsRepository({
    getSettings: async () => DEFAULT_SETTINGS,
    getMetrics: () => metrics.get(),
    getEnvironment: () => ({
      version: "0.1.0",
      chromeVersion: "Chrome 128",
      operatingSystem: "Windows",
      // Host match patterns and feedback hashes are deliberately fed in to
      // prove the allowlist strips anything that is not a bare permission.
      manifestPermissions: [
        "storage",
        "contextMenus",
        "activeTab",
        "scripting",
        "offscreen",
        "https://www.linkedin.com/*",
        HASH,
      ],
    }),
    // Rogue fields carrying post text are smuggled onto the model-diagnostics
    // source — on the runtime status AND at the top level — to prove buildReport
    // copies ONLY the allowlisted fields and never spreads the whole source
    // object. This gives the "no post text" assertion real teeth against a
    // shallow-copy regression.
    getModelDiagnostics: () =>
      ({
        status: { ...fullModelStatus(), leakedNote: PORTUGUESE_TEXT },
        release: { gateDecision: "pending", rolloutState: "bundle-verified" },
        leakedTop: PORTUGUESE_TEXT,
      }) as unknown as ModelDiagnosticsSource,
    getPlatformIds: () => ["linkedin"],
  });
}

/** A repository whose only model-diagnostics source is the hostile object. */
function diagnosticsWithStatus(
  source: ModelDiagnosticsSource,
): DiagnosticsRepository {
  const metrics = new MetricsRepository(new MemoryStorageArea());
  return new DiagnosticsRepository({
    getSettings: async () => DEFAULT_SETTINGS,
    getMetrics: () => metrics.get(),
    getEnvironment: () => ({
      version: "0.1.0",
      manifestPermissions: ["storage"],
    }),
    getPlatformIds: () => [],
    getModelDiagnostics: () => source,
  });
}

function fullReleaseDescriptor() {
  return {
    schemaVersion: 1 as const,
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
    bundleDigest: BUNDLE_DIGEST,
    tokenizerDigest: TOKENIZER_DIGEST,
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    calibrationSetDigest: CALIBRATION_SET_DIGEST,
    profileDigests: [PROFILE_DIGEST],
    rolloutState: "indicator" as const,
    gateDecision: "indicator-only" as const,
    issuedAt: "2026-01-01T00:00:00.000Z",
    evidenceDigest: "f".repeat(64),
  };
}

describe("DiagnosticsRepository", () => {
  it("diagnostics include only allowlisted aggregate fields", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(Object.keys(report).sort()).toEqual([
      "extension",
      "manifestPermissions",
      "metrics",
      "modelStatus",
      "platforms",
      "settingsSummary",
    ]);

    const serialized = JSON.stringify(report);
    // Technical digests (bundle, tokenizer, calibration set) are allowed; post
    // text, URLs and smuggled rogue fields are not.
    expect(serialized).not.toContain(PORTUGUESE_TEXT.slice(0, 20));
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toMatch(/leakedNote|leakedTop/u);
  });

  it("excludes manifest host patterns and hashes from the permission list", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(report.manifestPermissions).toEqual([
      "activeTab",
      "contextMenus",
      "offscreen",
      "scripting",
      "storage",
    ]);
  });

  it("reduces model status to a sanitized runtime + release view", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(report.modelStatus).not.toBeNull();
    expect(Object.keys(report.modelStatus ?? {}).sort()).toEqual([
      "release",
      "status",
    ]);
    const view = report.modelStatus as ModelDiagnosticsView;
    expect(Object.keys(view.status).sort()).toEqual([
      "backend",
      "calibrationCoverage",
      "calibrationSetDigest",
      "earliestExpiry",
      "initializedAt",
      "profileCount",
      "reasonCodes",
      "runtimeIdentity",
      "state",
      "supportsBatching",
    ]);
    expect(Object.keys(view.release).sort()).toEqual([
      "gateDecision",
      "rolloutState",
    ]);
    expect(view.status.runtimeIdentity).not.toHaveProperty("leakedNote");
  });

  it("copies only the closed allowlist and strips every rogue field", async () => {
    const source = {
      status: {
        ...fullModelStatus(),
        state: "ready" as const,
        backend: "wasm" as const,
        runtimeIdentity: {
          kind: "bundle" as const,
          modelId: "cleanfeed-ptbr-v1",
          modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
          bundleDigest: BUNDLE_DIGEST,
          tokenizerDigest: TOKENIZER_DIGEST,
          aggregationVersion: "tmr-aggregation-v3",
          contentCompositionVersion: "lexical-content-v2",
          calibrationSetDigest: CALIBRATION_SET_DIGEST,
        },
        calibrationCoverage: "partial" as const,
        calibrationSetDigest: CALIBRATION_SET_DIGEST,
        profileCount: 3,
        earliestExpiry: "2027-01-15T00:00:00.000Z",
        reasonCodes: [],
        initializedAt: 1_784_000_000_000,
        supportsBatching: true,
        selectedProfileDigest: PROFILE_DIGEST,
        cacheValidUntil: "2026-08-01T00:00:00.000Z",
      },
      release: fullReleaseDescriptor(),
      aiScore: 0.97,
      calibratedScore: 0.96,
      postText: PORTUGUESE_TEXT,
      author: "Pessoa",
      url: "https://www.linkedin.com/in/pessoa",
      contentHash: CONTENT_HASH,
    };

    const report = await diagnosticsWithStatus(
      source as unknown as ModelDiagnosticsSource,
    ).buildReport();
    expect(report.modelStatus).toEqual({
      status: {
        state: "ready",
        backend: "wasm",
        runtimeIdentity: {
          kind: "bundle",
          modelId: "cleanfeed-ptbr-v1",
          modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
          bundleDigest: BUNDLE_DIGEST,
          tokenizerDigest: TOKENIZER_DIGEST,
          aggregationVersion: "tmr-aggregation-v3",
          contentCompositionVersion: "lexical-content-v2",
          calibrationSetDigest: CALIBRATION_SET_DIGEST,
        },
        calibrationCoverage: "partial",
        calibrationSetDigest: CALIBRATION_SET_DIGEST,
        profileCount: 3,
        earliestExpiry: "2027-01-15T00:00:00.000Z",
        reasonCodes: [],
        initializedAt: 1_784_000_000_000,
        supportsBatching: true,
      },
      release: {
        gateDecision: "indicator-only",
        rolloutState: "indicator",
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(
      /aiScore|calibratedScore|selectedProfileDigest|cacheValidUntil|postText|author|https:\/\//u,
    );
    expect(serialized).not.toContain(CONTENT_HASH);
    expect(serialized).not.toContain(PORTUGUESE_TEXT.slice(0, 20));
  });

  it("summarizes settings as booleans, limits and modes only", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(report.settingsSummary.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(report.settingsSummary.presentationMode).toBe(
      DEFAULT_SETTINGS.presentationMode,
    );
    expect(report.settingsSummary.maximumQueueSize).toBe(
      DEFAULT_SETTINGS.maximumQueueSize,
    );
    for (const value of Object.values(report.settingsSummary)) {
      expect(["boolean", "number", "string"]).toContain(typeof value);
    }
  });

  it("reports the extension version with an aggregate runtime string", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(report.extension.version).toBe("0.1.0");
    expect(report.extension.runtime).toBe("Chrome 128 / Windows");
    expect(report.platforms).toEqual(["linkedin"]);
  });

  it("reduces the circuit breaker to bounded, text-free counters and a reason code", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());
    const diagnostics = new DiagnosticsRepository({
      getSettings: async () => DEFAULT_SETTINGS,
      getMetrics: () => metrics.get(),
      getEnvironment: () => ({
        version: "0.1.0",
        manifestPermissions: ["storage"],
      }),
      getPlatformIds: () => [],
      // A far-oversized timestamp list plus a smuggled string prove the report
      // copies only allowlisted numeric fields and caps the timestamps.
      getCircuitBreaker: () =>
        ({
          open: true,
          failureCount: 3,
          failureTimestamps: Array.from({ length: 50 }, (_unused, i) => i),
          leakedNote: PORTUGUESE_TEXT,
        }) as unknown as {
          open: boolean;
          failureCount: number;
          failureTimestamps: number[];
        },
    });

    const report = await diagnostics.buildReport();
    expect(report.circuitBreaker).toBeDefined();
    expect(Object.keys(report.circuitBreaker ?? {}).sort()).toEqual([
      "failureCount",
      "open",
      "reasonCode",
      "recentFailureTimestamps",
    ]);
    expect(report.circuitBreaker?.open).toBe(true);
    expect(report.circuitBreaker?.reasonCode).toBe("CIRCUIT_BREAKER_OPEN");
    expect(report.circuitBreaker?.recentFailureTimestamps.length).toBe(16);
    const serialized = JSON.stringify(report.circuitBreaker);
    expect(serialized).not.toContain(PORTUGUESE_TEXT.slice(0, 20));
    expect(serialized).not.toContain("https://");
  });

  it("omits the circuit breaker entirely when no breaker source is wired", async () => {
    const diagnostics = await buildRepository();
    const report = await diagnostics.buildReport();
    expect(report.circuitBreaker).toBeUndefined();
    expect(report).not.toHaveProperty("circuitBreaker");
  });

  it("omits model status and runtime when the sources are unavailable", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());
    const diagnostics = new DiagnosticsRepository({
      getSettings: async () => DEFAULT_SETTINGS,
      getMetrics: () => metrics.get(),
      getEnvironment: () => ({
        version: "0.1.0",
        manifestPermissions: ["storage"],
      }),
      getPlatformIds: () => [],
    });

    const report = await diagnostics.buildReport();
    expect(report.modelStatus).toBeNull();
    expect(report.extension.runtime).toBeUndefined();
    expect(report.platforms).toEqual([]);
  });
});
