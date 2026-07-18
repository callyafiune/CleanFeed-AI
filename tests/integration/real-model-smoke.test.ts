import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MockClassifier } from "@/inference/mock-classifier";
import {
  MOCK_MODEL_PROFILE,
  STYLOMETRIC_MODEL_PROFILE,
  profileClassifier,
  resolveActiveModelProfile,
} from "@/inference/model-profile";
import type { ModelStatus, TextClassifier } from "@/shared/types";

const modelDir = process.env.CLEANFEED_TEST_MODEL_DIR;
const hasModel =
  typeof modelDir === "string" && modelDir.length > 0 && existsSync(modelDir);

/**
 * Five Portuguese sanity texts. The smoke only checks that the model runs
 * offline and produces a well-formed distribution; it never asserts ground
 * truth about whether any of these were written by a person or an AI.
 */
const SANITY_TEXTS: readonly string[] = [
  "A adoção de inteligência artificial no mercado brasileiro cresceu de forma acelerada nos últimos anos, exigindo novas competências das equipes.",
  "Compartilho hoje uma reflexão sobre liderança: ouvir o time com atenção genuína costuma render mais resultados do que qualquer plano imposto de cima para baixo.",
  "Depois de meses de trabalho, finalmente lançamos o produto. Agradeço a cada pessoa que acreditou nessa jornada e contribuiu com ideias e revisões.",
  "O relatório trimestral aponta um aumento consistente na retenção de clientes, impulsionado por melhorias graduais na experiência de uso da plataforma.",
  "Participei de um evento sobre privacidade de dados e saí convencido de que transparência com o usuário deixou de ser diferencial e passou a ser requisito.",
];

async function createSmokeClassifier(
  directory: string,
): Promise<TextClassifier> {
  const { parseModelManifest } = await import("@/inference/model-bundle");
  const { OnnxTextClassifier, TransformersJsModelGateway } =
    await import("@/inference/onnx-classifier");
  const manifest = parseModelManifest(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  return new OnnxTextClassifier(
    manifest,
    new TransformersJsModelGateway(),
    "wasm",
  );
}

// Skipped, not failed, when no artifact is supplied: this is a documented gap,
// never a scientific PASS. See docs/model-validation.md for the full procedure.
describe.skipIf(!hasModel)(
  "real model smoke — skipped: real model artifact not supplied (set CLEANFEED_TEST_MODEL_DIR)",
  () => {
    it("validates the candidate manifest and binary labels offline", async () => {
      const { parseModelManifest } = await import("@/inference/model-bundle");
      const manifest = parseModelManifest(
        JSON.parse(await readFile(join(modelDir!, "manifest.json"), "utf8")),
      );

      expect([manifest.labels.human, manifest.labels.ai].sort()).toEqual([
        0, 1,
      ]);
      expect(manifest.supportedLanguages.length).toBeGreaterThan(0);
    });

    it("ships every referenced file locally with no remote source", async () => {
      const { parseModelManifest } = await import("@/inference/model-bundle");
      const manifest = parseModelManifest(
        JSON.parse(await readFile(join(modelDir!, "manifest.json"), "utf8")),
      );

      for (const path of [
        manifest.modelPath,
        manifest.tokenizerPath,
        manifest.configPath,
      ]) {
        expect(existsSync(join(modelDir!, path))).toBe(true);
      }
      expect(/^https?:/iu.test(manifest.source)).toBe(false);
    });

    it("classifies Portuguese sanity texts and records warm/cold latency", async () => {
      const classifier = await createSmokeClassifier(modelDir!);
      try {
        const profile = await profileClassifier(classifier, SANITY_TEXTS, {
          language: "pt",
        });

        expect(profile.results).toHaveLength(SANITY_TEXTS.length);
        for (const result of profile.results) {
          expect(result.aiScore + result.humanScore).toBeCloseTo(1, 3);
          expect(result.backend).not.toBe("mock");
        }
        expect(profile.latency.coldMs).toBeGreaterThanOrEqual(0);
        expect(profile.latency.warmMs).toBeGreaterThanOrEqual(0);
        expect(profile.memory.bytes === null || profile.memory.bytes > 0).toBe(
          true,
        );
      } finally {
        await classifier.dispose();
      }
    });
  },
);

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
    classifierId: "candidate",
    modelVersion: "1.0.0",
    backend: "wasm",
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
          classifierId: "stylometric-v1",
          modelVersion: "1.0.0",
          backend: "mock",
        },
      }),
    ).toEqual(STYLOMETRIC_MODEL_PROFILE);
    expect(
      resolveActiveModelProfile({
        status: {
          state: "ready",
          classifierId: "mock",
          modelVersion: "1.0.0",
          backend: "mock",
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
