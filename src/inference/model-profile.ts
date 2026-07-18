import type {
  Backend,
  ClassificationResult,
  ModelStatus,
  TextClassifier,
} from "@/shared/types";

/**
 * The identity and calibration status of the model that is currently serving
 * classifications. This is what the Options page renders so the user always
 * knows whether they are looking at a benchmark-verified detector or the
 * demonstration mock.
 */
export interface ModelProfile {
  modelId: string;
  modelVersion: string;
  backend: Backend;
  /** True only when a benchmark-verified calibration governs presentation. */
  calibrated: boolean;
  calibrationVersion?: string;
  /** The mock is a deterministic demo, never evidence of authorship. */
  isMock: boolean;
}

/**
 * The deterministic hash-based demonstration classifier (`MockClassifier`).
 * It is deliberately reported as uncalibrated: its scores are derived from a
 * text hash and must never be presented as a real detection. It is only
 * active when the user forces the mock fallback in Options.
 */
export const MOCK_MODEL_PROFILE: ModelProfile = {
  modelId: "mock",
  modelVersion: "1.0.0",
  backend: "mock",
  calibrated: false,
  isMock: true,
};

/**
 * The transparent stylometric heuristic that actually serves classifications
 * in the MVP (`StylometricClassifier`). Its scores are explainable text
 * statistics — not a text hash and not a validated detection. It is reported
 * as uncalibrated, so presentation stays at the indicator-only ceiling, and
 * it remains demonstration-grade (`isMock`): never evidence of authorship.
 */
export const STYLOMETRIC_MODEL_PROFILE: ModelProfile = {
  modelId: "stylometric-v1",
  modelVersion: "1.0.0",
  backend: "mock",
  calibrated: false,
  isMock: true,
};

export interface ActiveModelProfileInput {
  /** The user forced the mock fallback in Options. */
  useMockModel?: boolean;
  /** The live status reported by the background worker, if any. */
  status?: ModelStatus | null;
  /** Whether the reported model has a verified calibration in the registry. */
  calibrated?: boolean;
  calibrationVersion?: string;
}

/**
 * Resolves the profile the UI should display. In the MVP no real bundle
 * ships, so the stylometric heuristic is the active model unless a verified
 * model status is supplied. A "mock"-backend status is disambiguated by the
 * classifier id/version it reports: the hash mock keeps the mock profile,
 * everything else (the worker's actual fallback) is the stylometric profile.
 */
export function resolveActiveModelProfile(
  input: ActiveModelProfileInput = {},
): ModelProfile {
  const {
    useMockModel = false,
    status = null,
    calibrated = false,
    calibrationVersion,
  } = input;

  if (useMockModel) {
    return MOCK_MODEL_PROFILE;
  }

  if (status === null) {
    return STYLOMETRIC_MODEL_PROFILE;
  }

  if (status.backend === "mock") {
    return status.classifierId === MOCK_MODEL_PROFILE.modelId &&
      status.modelVersion === MOCK_MODEL_PROFILE.modelVersion
      ? MOCK_MODEL_PROFILE
      : STYLOMETRIC_MODEL_PROFILE;
  }

  return {
    modelId: status.classifierId,
    modelVersion: status.modelVersion,
    backend: status.backend,
    calibrated,
    ...(calibrationVersion === undefined ? {} : { calibrationVersion }),
    isMock: false,
  };
}

export interface LatencyProfile {
  coldMs: number;
  warmMs: number;
}

export interface MemoryEstimate {
  /** Approximate heap footprint in bytes, or null when unmeasurable. */
  bytes: number | null;
}

export interface ClassifierRunProfile {
  latency: LatencyProfile;
  memory: MemoryEstimate;
  results: ClassificationResult[];
}

export interface ProfileClassifierOptions {
  language?: string;
}

/**
 * Profiles a classifier over a set of texts: the first run is treated as the
 * cold latency and the remaining runs as warm samples. This backs the real
 * model smoke procedure (warm/cold latency and approximate memory) and is
 * agnostic to the concrete backend.
 */
export async function profileClassifier(
  classifier: TextClassifier,
  texts: readonly string[],
  options: ProfileClassifierOptions = {},
): Promise<ClassifierRunProfile> {
  if (texts.length === 0) {
    throw new RangeError("profileClassifier requires at least one text.");
  }

  await classifier.initialize();
  const classifyOptions =
    options.language === undefined ? undefined : { language: options.language };

  const results: ClassificationResult[] = [];
  const warmSamples: number[] = [];
  let coldMs = 0;

  for (const [index, text] of texts.entries()) {
    const startedAt = performance.now();
    const result = await classifier.classify(text, classifyOptions);
    const elapsedMs = performance.now() - startedAt;
    results.push(result);
    if (index === 0) {
      coldMs = elapsedMs;
    } else {
      warmSamples.push(elapsedMs);
    }
  }

  return {
    latency: {
      coldMs,
      warmMs: warmSamples.length === 0 ? coldMs : median(warmSamples),
    },
    memory: await estimateApproximateMemory(),
    results,
  };
}

/**
 * Reads an approximate memory footprint when the browser exposes
 * `performance.measureUserAgentSpecificMemory`; returns null otherwise so the
 * smoke report degrades gracefully instead of failing.
 */
export async function estimateApproximateMemory(): Promise<MemoryEstimate> {
  const measure = (
    performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    }
  ).measureUserAgentSpecificMemory;

  if (typeof measure !== "function") {
    return { bytes: null };
  }

  try {
    const measurement = await measure.call(performance);
    return {
      bytes: typeof measurement.bytes === "number" ? measurement.bytes : null,
    };
  } catch {
    return { bytes: null };
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}
