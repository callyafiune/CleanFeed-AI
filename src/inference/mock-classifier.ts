import type {
  ClassificationOptions,
  ClassificationResult,
  ClassificationStatus,
  ClassifierMetadata,
  TextClassifier,
} from "@/shared/types";
import {
  buildBuiltinDecision,
  buildBuiltinEvidence,
  buildBuiltinIdentity,
} from "@/inference/builtin-runtime";
import { CleanFeedError } from "@/shared/errors";
import { sha256 } from "@/shared/hashing";
import { normalizeText } from "@/shared/text-normalization";
import { getTextLengthInfo } from "@/shared/word-count";

const MAX_UINT32 = 0xffffffff;
const metadata: ClassifierMetadata = {
  id: "mock",
  name: "Mock classifier (demo)",
  version: "1.0.0",
  backend: "mock",
  supportedLanguages: ["pt"],
  maximumTokens: 256,
  supportsBatching: false,
};

export interface MockClassifierOptions {
  latencyMs?: number;
  failureRate?: number;
}

/**
 * Deterministic development-only classifier. Its output is derived from a
 * text hash and is not evidence that a text was written by a person or AI.
 */
export class MockClassifier implements TextClassifier {
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private initialized = false;

  constructor(options: MockClassifierOptions = {}) {
    this.latencyMs = validateLatency(options.latencyMs ?? 0);
    this.failureRate = validateFailureRate(options.failureRate ?? 0);
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async classify(
    text: string,
    options: ClassificationOptions = {},
  ): Promise<ClassificationResult> {
    const startedAt = performance.now();
    await waitForLatency(this.latencyMs, options.signal);

    if (!this.initialized) {
      throw new CleanFeedError(
        "INFERENCE_FAILED",
        "Mock classifier must be initialized before classification.",
      );
    }

    const normalizedText = normalizeText(text);
    const hash = await sha256(normalizedText);

    if (scoreFromHash(hash.slice(8, 16)) < this.failureRate) {
      throw new CleanFeedError(
        "INFERENCE_FAILED",
        "Mock classifier simulated a deterministic inference failure.",
      );
    }

    const aiScore = scoreFromHash(hash.slice(0, 8));
    const length = getTextLengthInfo(normalizedText);
    const status = statusFromScore(aiScore);

    return {
      aiScore,
      humanScore: 1 - aiScore,
      confidence: "low",
      status,
      wordCount: length.wordCount,
      tokenCount: length.wordCount,
      ...(options.language === undefined ? {} : { language: options.language }),
      runtimeIdentity: buildBuiltinIdentity(metadata),
      evidence: buildBuiltinEvidence(normalizedText),
      decision: buildBuiltinDecision({ status, calibratedScore: aiScore }),
      modelVersion: metadata.version,
      modelId: metadata.id,
      backend: metadata.backend,
      processingTimeMs: performance.now() - startedAt,
      demo: true,
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  getMetadata(): ClassifierMetadata {
    return {
      ...metadata,
      supportedLanguages: [...metadata.supportedLanguages],
    };
  }
}

function scoreFromHash(hashBlock: string): number {
  return Number.parseInt(hashBlock, 16) / MAX_UINT32;
}

/**
 * Shared uncalibrated status banding for demo-grade classifiers. Exported so
 * the stylometric heuristic derives its status exactly like the mock does.
 */
export function statusFromScore(score: number): ClassificationStatus {
  if (score < 0.4) {
    return "probably_human";
  }

  if (score < 0.8) {
    return "inconclusive";
  }

  if (score < 0.92) {
    return "possibly_ai";
  }

  return "strong_ai_indication";
}

function validateLatency(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "Mock classifier latency must be a non-negative number.",
    );
  }

  return value;
}

function validateFailureRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      "Mock classifier failure rate must be between 0 and 1.",
    );
  }

  return value;
}

function waitForLatency(
  latencyMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(createAbortError());
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, latencyMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createAbortError(): DOMException {
  return new DOMException("The classification was aborted.", "AbortError");
}
