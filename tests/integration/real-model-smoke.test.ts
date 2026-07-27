import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MockClassifier } from "@/inference/mock-classifier";
import {
  parseModelManifest,
  type CleanFeedModelManifest,
} from "@/inference/model-bundle";
import {
  MOCK_MODEL_PROFILE,
  STYLOMETRIC_MODEL_PROFILE,
  profileClassifier,
  resolveActiveModelProfile,
} from "@/inference/model-profile";
import {
  OnnxTextClassifier,
  type ModelTokens,
  type TransformersModelGateway,
} from "@/inference/onnx-classifier";
import { CleanFeedError } from "@/shared/errors";
import type { ModelStatus } from "@/shared/types";

// IMPORTANT: nothing in THIS Vitest file is the real-model gate. These cases
// exercise only the ORCHESTRATION around the classifier — manifest parsing from
// a temp file, the profiling harness and the active-model resolver — with an
// INJECTED gateway. They deliberately do NOT load Transformers.js or ONNX, and a
// green run here is NOT evidence that the real model runs. The real gate is the
// offline Chrome smoke in tests/e2e/real-model-smoke.spec.ts, driven by
// `npm run test:model:smoke`. See docs/model-validation.md.

const HEX64 = "a".repeat(64);

/**
 * Five Portuguese sanity texts. The orchestration only checks that the pipeline
 * produces a well-formed distribution; it never asserts ground truth about
 * whether any of these were written by a person or an AI.
 */
const SANITY_TEXTS: readonly string[] = [
  "A adoção de inteligência artificial no mercado brasileiro cresceu de forma acelerada nos últimos anos, exigindo novas competências das equipes.",
  "Compartilho hoje uma reflexão sobre liderança: ouvir o time com atenção genuína costuma render mais resultados do que qualquer plano imposto de cima para baixo.",
  "Depois de meses de trabalho, finalmente lançamos o produto. Agradeço a cada pessoa que acreditou nessa jornada e contribuiu com ideias e revisões.",
  "O relatório trimestral aponta um aumento consistente na retenção de clientes, impulsionado por melhorias graduais na experiência de uso da plataforma.",
  "Participei de um evento sobre privacidade de dados e saí convencido de que transparência com o usuário deixou de ser diferencial e passou a ser requisito.",
];

/** A minimal, valid v1 manifest object, written to a temp file per test. */
function manifestObject(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "orchestration-fixture",
    name: "Orchestration Fixture",
    version: "1.0.0",
    task: "ai_text_detection",
    architecture: "roberta",
    modelPath: "onnx/model_int8.onnx",
    tokenizerPath: "tokenizer.json",
    configPath: "config.json",
    supportedLanguages: ["pt", "pt-BR"],
    maximumTokens: 512,
    quantization: "int8",
    labels: { human: 0, ai: 1 },
    output: { name: "logits", kind: "logits" },
    license: "MIT",
    source: "local-fixture",
    calibrationVersion: "tmr-aggregation-v3",
    sha256: { model: HEX64, tokenizer: HEX64, config: HEX64 },
  };
}

/**
 * A deterministic in-memory gateway. It NEVER loads Transformers.js or ONNX: it
 * fabricates one token id per word plus two special tokens and returns fixed
 * logits, so the orchestration around it can be exercised offline. Using it is
 * the whole point — a green run does not prove the real model runs.
 */
class InMemoryGateway implements TransformersModelGateway {
  loadCount = 0;
  disposeCount = 0;

  async load(): Promise<void> {
    this.loadCount += 1;
  }

  async tokenize(text: string): Promise<ModelTokens> {
    const words = text.trim().split(/\s+/u).filter(Boolean);
    const contentIds = words.map((_, index) => index + 5);
    const inputIds = [0, ...contentIds, 2];
    return {
      inputIds,
      specialTokenCount: 2,
      tokenOffsets: [],
      inputs: { input_ids: [inputIds] },
    };
  }

  async run(tokens: ModelTokens): Promise<Record<string, unknown>> {
    const content = tokens.inputIds.length - tokens.specialTokenCount;
    // A stable, content-length-dependent logit pair; softmax keeps it in (0,1).
    const aiLogit = 0.25 + (content % 7) * 0.1;
    return { logits: [[0.4, aiLogit]] };
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

/** A gateway whose load fails, standing in for a broken/absent local bundle. */
class FailingGateway extends InMemoryGateway {
  override async load(): Promise<void> {
    throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
  }
}

const tempDirs: string[] = [];

function writeTempManifest(): CleanFeedModelManifest {
  const dir = mkdtempSync(join(tmpdir(), "cleanfeed-smoke-orch-"));
  tempDirs.push(dir);
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifestObject()));
  return parseModelManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("real-model smoke ORCHESTRATION — injected gateway, no real Transformers/ONNX", () => {
  it("parses a temp manifest and profiles the classifier through the injected gateway", async () => {
    const manifest = writeTempManifest();
    const gateway = new InMemoryGateway();
    const classifier = new OnnxTextClassifier(manifest, gateway, "wasm");

    try {
      const profile = await profileClassifier(classifier, SANITY_TEXTS, {
        language: "pt",
      });

      expect(gateway.loadCount).toBe(1);
      expect(profile.results).toHaveLength(SANITY_TEXTS.length);
      for (const result of profile.results) {
        expect(result.aiScore + result.humanScore).toBeCloseTo(1, 3);
        // The injected gateway reports the wasm backend, never the mock.
        expect(result.backend).not.toBe("mock");
      }
      expect(profile.latency.coldMs).toBeGreaterThanOrEqual(0);
      expect(profile.latency.warmMs).toBeGreaterThanOrEqual(0);
      // jsdom does not expose measureUserAgentSpecificMemory.
      expect(profile.memory.bytes).toBeNull();
    } finally {
      await classifier.dispose();
    }
    expect(gateway.disposeCount).toBe(1);
  });

  it("surfaces a structured MODEL_LOAD_FAILED when the injected gateway load fails", async () => {
    const manifest = writeTempManifest();
    const classifier = new OnnxTextClassifier(
      manifest,
      new FailingGateway(),
      "wasm",
    );

    await expect(
      profileClassifier(classifier, SANITY_TEXTS, { language: "pt" }),
    ).rejects.toBeInstanceOf(CleanFeedError);
    await classifier.dispose();
  });
});

// Always runs: proves the profiling harness and the active-model resolver used
// by the smoke and by Options are correct without needing a real artifact.
describe("model profiling harness", () => {
  it("profiles a classifier and reports latency, memory, and every result", async () => {
    const profile = await profileClassifier(
      new MockClassifier(),
      SANITY_TEXTS,
      { language: "pt" },
    );

    expect(profile.results).toHaveLength(SANITY_TEXTS.length);
    for (const result of profile.results) {
      expect(result.aiScore + result.humanScore).toBeCloseTo(1, 3);
    }
    expect(Number.isFinite(profile.latency.coldMs)).toBe(true);
    expect(profile.latency.coldMs).toBeGreaterThanOrEqual(0);
    expect(profile.latency.warmMs).toBeGreaterThanOrEqual(0);
    // jsdom does not expose measureUserAgentSpecificMemory.
    expect(profile.memory.bytes).toBeNull();
  });

  it("requires at least one text", async () => {
    await expect(profileClassifier(new MockClassifier(), [])).rejects.toThrow();
  });
});

describe("resolveActiveModelProfile", () => {
  const readyStatus: ModelStatus = {
    state: "ready",
    backend: "wasm",
    runtimeIdentity: {
      kind: "bundle",
      modelId: "candidate",
      modelVersion: "1.0.0",
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
    reasonCodes: [],
  };

  // Adjusted after the honesty review: with no status, the identity that will
  // actually serve results is the worker's stylometric fallback, not the hash
  // mock — Options must never display "mock / text hash" semantics while
  // stylometric-v1 results are being produced.
  it("falls back to the stylometric heuristic when no model status is available", () => {
    expect(resolveActiveModelProfile()).toEqual(STYLOMETRIC_MODEL_PROFILE);
    expect(STYLOMETRIC_MODEL_PROFILE).toMatchObject({
      modelId: "stylometric-v1",
      calibrated: false,
      isMock: true,
    });
  });

  it("honours the mock fallback even when a real model is ready", () => {
    expect(
      resolveActiveModelProfile({
        useMockModel: true,
        status: readyStatus,
        calibrated: true,
      }),
    ).toEqual(MOCK_MODEL_PROFILE);
  });

  it("distinguishes the hash mock from the stylometric fallback by identity", () => {
    expect(
      resolveActiveModelProfile({
        status: {
          state: "ready",
          backend: "mock",
          runtimeIdentity: {
            kind: "builtin",
            modelId: "stylometric",
            modelVersion: "1.0.0",
            implementationVersion: "stylometric-v1",
          },
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          reasonCodes: [],
        },
      }),
    ).toEqual(STYLOMETRIC_MODEL_PROFILE);
    expect(
      resolveActiveModelProfile({
        status: {
          state: "ready",
          backend: "mock",
          runtimeIdentity: {
            kind: "builtin",
            modelId: "mock",
            modelVersion: "1.0.0",
            implementationVersion: "mock",
          },
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          reasonCodes: [],
        },
      }),
    ).toEqual(MOCK_MODEL_PROFILE);
  });

  it("reports the ready model and its calibration status", () => {
    expect(
      resolveActiveModelProfile({
        status: readyStatus,
        calibrated: true,
        calibrationVersion: "2026.07",
      }),
    ).toEqual({
      modelId: "candidate",
      modelVersion: "1.0.0",
      backend: "wasm",
      calibrated: true,
      calibrationVersion: "2026.07",
      isMock: false,
    });
  });

  it("marks a ready but unbenchmarked model as not calibrated", () => {
    expect(resolveActiveModelProfile({ status: readyStatus }).calibrated).toBe(
      false,
    );
  });
});
