import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelStatus, StorageArea } from "@/shared/types";
import { DiagnosticsRepository } from "@/storage/diagnostics";
import { MetricsRepository } from "@/storage/metrics";

const HASH = "a".repeat(64);
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
      aggregationVersion: "tmr-aggregation-v2",
      contentCompositionVersion: "lexical-content-v1",
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
    // A rogue field carrying post text is smuggled onto the model-status
    // source to prove buildReport copies ONLY the allowlisted fields and never
    // spreads the whole source object — this gives the "no post text" assertion
    // real teeth against a shallow-copy regression.
    getModelStatus: () =>
      ({ ...fullModelStatus(), leakedNote: PORTUGUESE_TEXT }) as ModelStatus,
    getPlatformIds: () => ["linkedin"],
  });
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
    expect(serialized).not.toMatch(/[a-f0-9]{64}/u);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain(PORTUGUESE_TEXT.slice(0, 20));
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

  it("reduces model status to a sanitized, url-free allowlist", async () => {
    const diagnostics = await buildRepository();

    const report = await diagnostics.buildReport();
    expect(report.modelStatus).not.toBeNull();
    expect(Object.keys(report.modelStatus ?? {}).sort()).toEqual([
      "backend",
      "classifierId",
      "modelVersion",
      "state",
      "supportsBatching",
    ]);
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
