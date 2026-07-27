// The frozen execution contract of the v3 detector rebuild, as data.
//
// `docs/superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md` has a
// section named "Contrato de execução sem decisões pendentes" whose table is the
// source of truth for every settled decision of the rebuild — FPR budgets,
// conformal epsilons, seeds, strata, hard-negative families, profile bands,
// bootstrap replicates, the ONNX size ceiling, the calibrator competition and its
// tie-break order, the family-wise alpha, parity tolerances and the profile
// validity window. That section says, literally, that the values are materialized
// here and that "código não pode repeti-los como constantes soltas". So this
// module is the only place the benchmark may read them from, and
// `benchmark/rebuild-v3-policy.json` is the only place they are written down.
//
// What is in the JSON and what is not: every row of the frozen table that has a
// mechanical consequence is here as structured data (a number, an enum, a list or
// a boolean flag). Rows that are prose-only obligations are here ONLY as the
// mechanical flag behind them — `productTarget` plus `infersAuthorship: false`
// for "indicar compatibilidade textual, nunca inferir autoria", and
// `localization.authorizesVisualAction: false` for the localization row. Nothing
// is paraphrased into a sentence: a consumer that needs the prose reads the plan.
//
// The parser fails closed on a missing key, an unknown key, a wrong type, a value
// outside its domain and — for the decisions whose whole point is that they are
// settled — on any value other than the frozen one. There is no default anywhere: a
// policy that does not declare a value is invalid, never "the usual number".
//
// Which rows are pinned to their exact value, and which are only shape-checked:
//   * SCALARS pinned by `literal` / `frozenNumber`: every settled enum and flag
//     (`commercialUse`, `resampling.fallbackToIndependentRows`,
//     `labelBasis.pooledClaimAllowed`, `rollout.actionsPromoted`,
//     `calibrationGate.eceBinning`, `parity.operationalMaximumInversions`, ...).
//   * LISTS pinned by `frozenList`, content and order: the calibrator candidates
//     and tie-break order, the human core strata, the hard-negative families, the
//     profile bands, the human snapshots and the rollout stages. Those are rows of
//     the frozen table, and a reordered tie-break or a dropped stratum is a
//     different decision, not a formatting variant.
//   * SHAPE-CHECKED ONLY, because they are magnitudes the plan sets rather than
//     closed vocabularies: the numeric thresholds, seeds, replicate counts, epsilons
//     and tolerances (validated for type, integrality and domain), and
//     `predictiveValuePrevalences` (distinct values in (0, 1)).
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-side by construction — it reads its own JSON once, at module load, with
// `readFileSync`, so every consumer sees one immutable, deeply frozen object and
// no function in this package has to thread the policy through its signature.
// There is no Date and no randomness: the parsed policy is a pure function of the
// file's bytes, which the evaluator digest covers (see EVALUATOR_FILES).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Coded, fail-closed error naming the exact path that is invalid. */
export class RebuildV3PolicyError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`REBUILD_V3_POLICY_INVALID: ${path} ${detail}`);
    this.name = "RebuildV3PolicyError";
    this.path = path;
  }
}

export type ResamplingUnitKind = "hierarchical" | "multiway";
export type LabelBasisValue = "date-cutoff" | "observed-process";
export type CalibratorKind = "platt" | "beta" | "isotonic";
/**
 * WHICH bound the ECE gate reads. Not "bootstrap-upper95": the gate reads a
 * Bonferroni percentile at alpha_família / m, which is a different and wider bound
 * than the individual 95% one, and the file that is designated the single source of
 * truth may not say something the code contradicts. benchmark/gates.ts derives the
 * gate's direction from this value through an exhaustive switch, so a new value
 * here is a type error there rather than a silent divergence.
 */
export type EceGateBound = "bootstrap-simultaneous-upper";

export interface RebuildV3Policy {
  readonly attributionRequired: true;
  readonly backbone: string;
  readonly backboneBakeOff: false;
  readonly blindReserveCompleteAttempts: number;
  readonly bootstrapReplicates: {
    readonly pilot: number;
    readonly release: number;
  };
  readonly calibrationGate: {
    readonly eceBinning: "equal-mass";
    readonly eceBins: number;
    readonly eceBound: EceGateBound;
    readonly eceMax: number;
  };
  readonly calibrator: {
    readonly candidates: readonly CalibratorKind[];
    readonly crossValidationFolds: number;
    readonly lengthResultsAre: "diagnostic";
    readonly scope: "global-per-path";
    readonly selectionMetric: "brier-out-of-fold";
    readonly thresholdsAre: "per-profile-band";
    readonly tieBreakOrder: readonly CalibratorKind[];
    readonly tieToleranceAbsolute: number;
  };
  readonly commercialUse: false;
  readonly conformal: {
    readonly action: {
      readonly documentEpsilon: number;
      readonly localizedEpsilon: number | null;
    };
    readonly method: "one-sided-split-conformal";
    readonly perProfileBand: true;
    readonly population: "cal-b-humans";
    readonly warning: {
      readonly documentEpsilon: number;
      readonly localizedEpsilon: number | null;
    };
    readonly worstStratum: true;
  };
  readonly fprBudgets: {
    readonly visualAction: number;
    readonly warning: number;
  };
  readonly hardNegativeFamilies: readonly string[];
  readonly humanCoreStrata: readonly string[];
  readonly humanSources: {
    readonly newDownloadsAllowed: false;
    readonly snapshots: readonly string[];
  };
  readonly infersAuthorship: false;
  readonly integralPositive: {
    readonly label: "ai";
    readonly requiresRegisteredPipeline: true;
  };
  readonly labelBasis: {
    readonly allowed: readonly LabelBasisValue[];
    readonly appliesToLabel: "human";
    readonly pooledClaimAllowed: false;
    readonly underPoweredRole: "supplementary-diagnostic";
  };
  readonly localization: {
    readonly authorizesVisualAction: false;
    readonly standaloneClaim: false;
    readonly trainsAuxiliaryHead: true;
  };
  readonly materialAssistance: {
    readonly authorizes: "warning-only";
    readonly generationMode: "mechanistic";
    readonly minimumAiFraction: number;
  };
  readonly mixedBelowHalfAiRole: "diagnostic-curve-only";
  readonly multiplicity: {
    readonly correction: "bonferroni";
    readonly descriptiveConfidence: number;
    readonly familyAlpha: number;
    readonly frozenAt: "G5";
  };
  readonly onnxMaximumInt8Bytes: number;
  readonly parity: {
    readonly operationalMaximumInversions: 0;
    readonly rawMaximumMeanAbsDelta: number;
  };
  readonly policyVersion: string;
  readonly powerFloors: {
    readonly criticalFprHumanNegatives: number;
    readonly criticalRecallPositives: number;
    // Deliberately absent: no floor on the NUMBER OF SAMPLING UNITS has been
    // pre-registered. The count is published (A6) but never used as a pass
    // criterion, because inventing the number here would be inventing evidence.
    readonly samplingUnits: number | null;
  };
  readonly predictiveValuePrevalences: readonly number[];
  readonly productTarget: "textual-compatibility-with-ai-generation";
  readonly profileBands: readonly string[];
  readonly profileValidityDays: number;
  readonly resampling: {
    readonly allowedUnitKinds: readonly ResamplingUnitKind[];
    readonly fallbackToIndependentRows: false;
    readonly required: true;
  };
  readonly rollout: {
    readonly actionsPromoted: false;
    readonly maximumStage: "indicator";
    readonly stages: readonly string[];
  };
  readonly runtimeComparator: "score-ge-next-up-quantile";
  readonly seeds: {
    readonly ablation: readonly number[];
    readonly bootstrap: number;
    readonly crossValidation: number;
    readonly publishableCheckpoint: number;
    readonly split: number;
  };
  readonly shareAlikeRequired: true;
  readonly temporalCohort: {
    readonly insufficientPowerLabel: "notApplicable";
    readonly minimumDistinctTimestamps: number;
    readonly perSource: true;
    readonly quartilesOf: "createdAt";
  };
  readonly training: {
    readonly batchDocuments: number;
    readonly epochs: number;
    readonly learningRate: number;
    readonly optimizer: "adamw";
    readonly warmupFraction: number;
    readonly weightDecay: number;
  };
  readonly wordFloor: {
    readonly abstainBelow: number;
  };
}

// --- primitive validators --------------------------------------------------

function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RebuildV3PolicyError(path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new RebuildV3PolicyError(
        path === "" ? key : `${path}.${key}`,
        "is not a policy key",
      );
    }
  }
  return record;
}

function at(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function number(
  record: Record<string, unknown>,
  path: string,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RebuildV3PolicyError(at(path, key), "must be a finite number");
  }
  return value;
}

function integer(
  record: Record<string, unknown>,
  path: string,
  key: string,
  minimum: number,
): number {
  const value = number(record, path, key);
  if (!Number.isInteger(value) || value < minimum) {
    throw new RebuildV3PolicyError(
      at(path, key),
      `must be an integer >= ${minimum}`,
    );
  }
  return value;
}

// A rate, budget, epsilon or alpha: strictly above 0 and at most 1. Zero is
// rejected on purpose — a budget of exactly 0 is not a frozen decision anywhere
// in the table, and reading one would mean a mis-transcription.
function proportion(
  record: Record<string, unknown>,
  path: string,
  key: string,
): number {
  const value = number(record, path, key);
  if (value <= 0 || value > 1) {
    throw new RebuildV3PolicyError(at(path, key), "must be in (0, 1]");
  }
  return value;
}

function nullableProportion(
  record: Record<string, unknown>,
  path: string,
  key: string,
): number | null {
  if (!(key in record)) {
    throw new RebuildV3PolicyError(at(path, key), "is missing");
  }
  if (record[key] === null) return null;
  return proportion(record, path, key);
}

function nullableCount(
  record: Record<string, unknown>,
  path: string,
  key: string,
): number | null {
  if (!(key in record)) {
    throw new RebuildV3PolicyError(at(path, key), "is missing");
  }
  if (record[key] === null) return null;
  return integer(record, path, key, 1);
}

function text(
  record: Record<string, unknown>,
  path: string,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RebuildV3PolicyError(at(path, key), "must be a non-empty string");
  }
  return value;
}

function literal<T extends string | boolean>(
  record: Record<string, unknown>,
  path: string,
  key: string,
  frozen: T,
): T {
  if (record[key] !== frozen) {
    throw new RebuildV3PolicyError(
      at(path, key),
      `is frozen at ${JSON.stringify(frozen)} and cannot be changed here`,
    );
  }
  return frozen;
}

// A number frozen at one exact value (a maximum of zero inversions is a decision,
// not a tolerance a caller may nudge).
function frozenNumber(
  record: Record<string, unknown>,
  path: string,
  key: string,
  frozen: number,
): number {
  if (record[key] !== frozen) {
    throw new RebuildV3PolicyError(
      at(path, key),
      `is frozen at ${frozen} and cannot be changed here`,
    );
  }
  return frozen;
}

// A non-empty list of distinct non-empty strings. Duplicates are rejected because
// a repeated stratum or family silently changes a denominator.
function textList(
  record: Record<string, unknown>,
  path: string,
  key: string,
  allowed?: readonly string[],
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new RebuildV3PolicyError(at(path, key), "must be a non-empty array");
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new RebuildV3PolicyError(
        at(path, key),
        "must hold non-empty strings",
      );
    }
    if (seen.has(entry)) {
      throw new RebuildV3PolicyError(
        at(path, key),
        `repeats the entry ${JSON.stringify(entry)}`,
      );
    }
    if (allowed !== undefined && !allowed.includes(entry)) {
      throw new RebuildV3PolicyError(
        at(path, key),
        `must hold only ${allowed.join(", ")}`,
      );
    }
    seen.add(entry);
  }
  return Object.freeze([...(value as string[])]);
}

// A list whose exact CONTENT AND ORDER are frozen, the list counterpart of
// `literal` and `frozenNumber`. The order is part of the decision for some of these
// rows (the calibrator tie-break is "empate -> Platt, beta, isotônico", and a
// reordering is a different rule), and for the rest the membership is: dropping a
// core stratum or a hard-negative family silently narrows what the evaluation
// covers. Validating only "non-empty array of distinct strings" would accept
// `tieBreakOrder: ["isotonic"]` and `humanCoreStrata: ["foo"]`, which is exactly
// what this module's own contract says it refuses.
function frozenList(
  record: Record<string, unknown>,
  path: string,
  key: string,
  frozen: readonly string[],
): readonly string[] {
  // Shape first, so a malformed list still gets the specific shape message.
  const value = textList(record, path, key);
  const same =
    value.length === frozen.length &&
    value.every((entry, index) => entry === frozen[index]);
  if (!same) {
    throw new RebuildV3PolicyError(
      at(path, key),
      `is frozen at ${JSON.stringify(frozen)} (exact content and order) and ` +
        "cannot be changed here",
    );
  }
  return Object.freeze([...frozen]);
}

function numberList(
  record: Record<string, unknown>,
  path: string,
  key: string,
  check: (value: number) => boolean,
  detail: string,
): readonly number[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new RebuildV3PolicyError(at(path, key), "must be a non-empty array");
  }
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry) || !check(entry)) {
      throw new RebuildV3PolicyError(at(path, key), detail);
    }
    if (seen.has(entry)) {
      throw new RebuildV3PolicyError(
        at(path, key),
        `repeats the entry ${entry}`,
      );
    }
    seen.add(entry);
  }
  return Object.freeze([...(value as number[])]);
}

// The rows of the frozen table whose exact content AND order are the decision.
// Repeating them here is not duplication of the JSON: it is what makes the JSON
// checkable, the same way `literal` repeats a frozen scalar.
const FROZEN_CALIBRATOR_CANDIDATES = ["platt", "beta", "isotonic"] as const;
const FROZEN_CALIBRATOR_TIE_BREAK = ["platt", "beta", "isotonic"] as const;
const FROZEN_HUMAN_CORE_STRATA = [
  "encyclopedic",
  "institutional",
  "qa-informal",
  "social-media",
  "university",
] as const;
const FROZEN_HARD_NEGATIVE_FAMILIES = [
  "corporate-structure",
  "formulaic",
  "highly-polished",
  "motivational",
  "non-native",
  "repetitive",
] as const;
const FROZEN_PROFILE_BANDS = ["50-79", "80-199", "200-plus"] as const;
const FROZEN_HUMAN_SNAPSHOTS = [
  "b2w-reviews01",
  "carolina",
  "pt-stackoverflow",
  "ptwiki",
] as const;
const FROZEN_ROLLOUT_STAGES = [
  "bundle-verified",
  "shadow",
  "indicator",
] as const;

const POLICY_KEYS = [
  "attributionRequired",
  "backbone",
  "backboneBakeOff",
  "blindReserveCompleteAttempts",
  "bootstrapReplicates",
  "calibrationGate",
  "calibrator",
  "commercialUse",
  "conformal",
  "fprBudgets",
  "hardNegativeFamilies",
  "humanCoreStrata",
  "humanSources",
  "infersAuthorship",
  "integralPositive",
  "labelBasis",
  "localization",
  "materialAssistance",
  "mixedBelowHalfAiRole",
  "multiplicity",
  "onnxMaximumInt8Bytes",
  "parity",
  "policyVersion",
  "powerFloors",
  "predictiveValuePrevalences",
  "productTarget",
  "profileBands",
  "profileValidityDays",
  "resampling",
  "rollout",
  "runtimeComparator",
  "seeds",
  "shareAlikeRequired",
  "temporalCohort",
  "training",
  "wordFloor",
] as const;

const LABEL_BASIS_VALUES: readonly LabelBasisValue[] = [
  "date-cutoff",
  "observed-process",
];
const RESAMPLING_UNIT_KINDS: readonly ResamplingUnitKind[] = [
  "hierarchical",
  "multiway",
];

/**
 * Validates an already-parsed JSON value against the frozen contract and returns
 * a deeply frozen policy. Throws `RebuildV3PolicyError` naming the offending path
 * on the first problem; it never coerces and never fills a value in.
 */
export function parseRebuildV3Policy(value: unknown): RebuildV3Policy {
  const root = object(value, "", POLICY_KEYS);

  const bootstrapReplicates = object(
    root.bootstrapReplicates,
    "bootstrapReplicates",
    ["pilot", "release"],
  );
  const calibrationGate = object(root.calibrationGate, "calibrationGate", [
    "eceBinning",
    "eceBins",
    "eceBound",
    "eceMax",
  ]);
  const calibrator = object(root.calibrator, "calibrator", [
    "candidates",
    "crossValidationFolds",
    "lengthResultsAre",
    "scope",
    "selectionMetric",
    "thresholdsAre",
    "tieBreakOrder",
    "tieToleranceAbsolute",
  ]);
  const conformal = object(root.conformal, "conformal", [
    "action",
    "method",
    "perProfileBand",
    "population",
    "warning",
    "worstStratum",
  ]);
  const conformalAction = object(conformal.action, "conformal.action", [
    "documentEpsilon",
    "localizedEpsilon",
  ]);
  const conformalWarning = object(conformal.warning, "conformal.warning", [
    "documentEpsilon",
    "localizedEpsilon",
  ]);
  const fprBudgets = object(root.fprBudgets, "fprBudgets", [
    "visualAction",
    "warning",
  ]);
  const humanSources = object(root.humanSources, "humanSources", [
    "newDownloadsAllowed",
    "snapshots",
  ]);
  const integralPositive = object(root.integralPositive, "integralPositive", [
    "label",
    "requiresRegisteredPipeline",
  ]);
  const labelBasis = object(root.labelBasis, "labelBasis", [
    "allowed",
    "appliesToLabel",
    "pooledClaimAllowed",
    "underPoweredRole",
  ]);
  const localization = object(root.localization, "localization", [
    "authorizesVisualAction",
    "standaloneClaim",
    "trainsAuxiliaryHead",
  ]);
  const materialAssistance = object(
    root.materialAssistance,
    "materialAssistance",
    ["authorizes", "generationMode", "minimumAiFraction"],
  );
  const multiplicity = object(root.multiplicity, "multiplicity", [
    "correction",
    "descriptiveConfidence",
    "familyAlpha",
    "frozenAt",
  ]);
  const parity = object(root.parity, "parity", [
    "operationalMaximumInversions",
    "rawMaximumMeanAbsDelta",
  ]);
  const powerFloors = object(root.powerFloors, "powerFloors", [
    "criticalFprHumanNegatives",
    "criticalRecallPositives",
    "samplingUnits",
  ]);
  const resampling = object(root.resampling, "resampling", [
    "allowedUnitKinds",
    "fallbackToIndependentRows",
    "required",
  ]);
  const rollout = object(root.rollout, "rollout", [
    "actionsPromoted",
    "maximumStage",
    "stages",
  ]);
  const seeds = object(root.seeds, "seeds", [
    "ablation",
    "bootstrap",
    "crossValidation",
    "publishableCheckpoint",
    "split",
  ]);
  const temporalCohort = object(root.temporalCohort, "temporalCohort", [
    "insufficientPowerLabel",
    "minimumDistinctTimestamps",
    "perSource",
    "quartilesOf",
  ]);
  const training = object(root.training, "training", [
    "batchDocuments",
    "epochs",
    "learningRate",
    "optimizer",
    "warmupFraction",
    "weightDecay",
  ]);
  const wordFloor = object(root.wordFloor, "wordFloor", ["abstainBelow"]);

  const ablation = numberList(
    seeds,
    "seeds",
    "ablation",
    (entry) => Number.isInteger(entry) && entry > 0,
    "must hold positive integer seeds",
  );
  const publishableCheckpoint = integer(
    seeds,
    "seeds",
    "publishableCheckpoint",
    1,
  );
  if (!ablation.includes(publishableCheckpoint)) {
    throw new RebuildV3PolicyError(
      "seeds.publishableCheckpoint",
      "must be one of the ablation seeds",
    );
  }

  const policy: RebuildV3Policy = {
    attributionRequired: literal(root, "", "attributionRequired", true),
    backbone: text(root, "", "backbone"),
    backboneBakeOff: literal(root, "", "backboneBakeOff", false),
    blindReserveCompleteAttempts: integer(
      root,
      "",
      "blindReserveCompleteAttempts",
      1,
    ),
    bootstrapReplicates: {
      pilot: integer(bootstrapReplicates, "bootstrapReplicates", "pilot", 1),
      release: integer(
        bootstrapReplicates,
        "bootstrapReplicates",
        "release",
        1,
      ),
    },
    calibrationGate: {
      // Equal-mass, not equal-width: the gate must not be sensitive to a bin
      // grid the data does not populate (assessment §4.4).
      eceBinning: literal(
        calibrationGate,
        "calibrationGate",
        "eceBinning",
        "equal-mass",
      ),
      eceBins: integer(calibrationGate, "calibrationGate", "eceBins", 2),
      eceBound: literal(
        calibrationGate,
        "calibrationGate",
        "eceBound",
        "bootstrap-simultaneous-upper",
      ),
      eceMax: proportion(calibrationGate, "calibrationGate", "eceMax"),
    },
    calibrator: {
      candidates: frozenList(
        calibrator,
        "calibrator",
        "candidates",
        FROZEN_CALIBRATOR_CANDIDATES,
      ) as readonly CalibratorKind[],
      crossValidationFolds: integer(
        calibrator,
        "calibrator",
        "crossValidationFolds",
        2,
      ),
      lengthResultsAre: literal(
        calibrator,
        "calibrator",
        "lengthResultsAre",
        "diagnostic",
      ),
      scope: literal(calibrator, "calibrator", "scope", "global-per-path"),
      selectionMetric: literal(
        calibrator,
        "calibrator",
        "selectionMetric",
        "brier-out-of-fold",
      ),
      thresholdsAre: literal(
        calibrator,
        "calibrator",
        "thresholdsAre",
        "per-profile-band",
      ),
      tieBreakOrder: frozenList(
        calibrator,
        "calibrator",
        "tieBreakOrder",
        FROZEN_CALIBRATOR_TIE_BREAK,
      ) as readonly CalibratorKind[],
      tieToleranceAbsolute: proportion(
        calibrator,
        "calibrator",
        "tieToleranceAbsolute",
      ),
    },
    commercialUse: literal(root, "", "commercialUse", false),
    conformal: {
      action: {
        documentEpsilon: proportion(
          conformalAction,
          "conformal.action",
          "documentEpsilon",
        ),
        localizedEpsilon: nullableProportion(
          conformalAction,
          "conformal.action",
          "localizedEpsilon",
        ),
      },
      method: literal(
        conformal,
        "conformal",
        "method",
        "one-sided-split-conformal",
      ),
      perProfileBand: literal(conformal, "conformal", "perProfileBand", true),
      population: literal(conformal, "conformal", "population", "cal-b-humans"),
      warning: {
        documentEpsilon: proportion(
          conformalWarning,
          "conformal.warning",
          "documentEpsilon",
        ),
        localizedEpsilon: nullableProportion(
          conformalWarning,
          "conformal.warning",
          "localizedEpsilon",
        ),
      },
      worstStratum: literal(conformal, "conformal", "worstStratum", true),
    },
    fprBudgets: {
      visualAction: proportion(fprBudgets, "fprBudgets", "visualAction"),
      warning: proportion(fprBudgets, "fprBudgets", "warning"),
    },
    hardNegativeFamilies: frozenList(
      root,
      "",
      "hardNegativeFamilies",
      FROZEN_HARD_NEGATIVE_FAMILIES,
    ),
    humanCoreStrata: frozenList(
      root,
      "",
      "humanCoreStrata",
      FROZEN_HUMAN_CORE_STRATA,
    ),
    humanSources: {
      newDownloadsAllowed: literal(
        humanSources,
        "humanSources",
        "newDownloadsAllowed",
        false,
      ),
      snapshots: frozenList(
        humanSources,
        "humanSources",
        "snapshots",
        FROZEN_HUMAN_SNAPSHOTS,
      ),
    },
    infersAuthorship: literal(root, "", "infersAuthorship", false),
    integralPositive: {
      label: literal(integralPositive, "integralPositive", "label", "ai"),
      requiresRegisteredPipeline: literal(
        integralPositive,
        "integralPositive",
        "requiresRegisteredPipeline",
        true,
      ),
    },
    labelBasis: {
      allowed: textList(
        labelBasis,
        "labelBasis",
        "allowed",
        LABEL_BASIS_VALUES,
      ) as readonly LabelBasisValue[],
      appliesToLabel: literal(
        labelBasis,
        "labelBasis",
        "appliesToLabel",
        "human",
      ),
      pooledClaimAllowed: literal(
        labelBasis,
        "labelBasis",
        "pooledClaimAllowed",
        false,
      ),
      underPoweredRole: literal(
        labelBasis,
        "labelBasis",
        "underPoweredRole",
        "supplementary-diagnostic",
      ),
    },
    localization: {
      authorizesVisualAction: literal(
        localization,
        "localization",
        "authorizesVisualAction",
        false,
      ),
      standaloneClaim: literal(
        localization,
        "localization",
        "standaloneClaim",
        false,
      ),
      trainsAuxiliaryHead: literal(
        localization,
        "localization",
        "trainsAuxiliaryHead",
        true,
      ),
    },
    materialAssistance: {
      authorizes: literal(
        materialAssistance,
        "materialAssistance",
        "authorizes",
        "warning-only",
      ),
      generationMode: literal(
        materialAssistance,
        "materialAssistance",
        "generationMode",
        "mechanistic",
      ),
      minimumAiFraction: proportion(
        materialAssistance,
        "materialAssistance",
        "minimumAiFraction",
      ),
    },
    mixedBelowHalfAiRole: literal(
      root,
      "",
      "mixedBelowHalfAiRole",
      "diagnostic-curve-only",
    ),
    multiplicity: {
      correction: literal(
        multiplicity,
        "multiplicity",
        "correction",
        "bonferroni",
      ),
      descriptiveConfidence: proportion(
        multiplicity,
        "multiplicity",
        "descriptiveConfidence",
      ),
      familyAlpha: proportion(multiplicity, "multiplicity", "familyAlpha"),
      frozenAt: literal(multiplicity, "multiplicity", "frozenAt", "G5"),
    },
    onnxMaximumInt8Bytes: integer(root, "", "onnxMaximumInt8Bytes", 1),
    parity: {
      operationalMaximumInversions: frozenNumber(
        parity,
        "parity",
        "operationalMaximumInversions",
        0,
      ) as 0,
      rawMaximumMeanAbsDelta: proportion(
        parity,
        "parity",
        "rawMaximumMeanAbsDelta",
      ),
    },
    policyVersion: text(root, "", "policyVersion"),
    powerFloors: {
      criticalFprHumanNegatives: integer(
        powerFloors,
        "powerFloors",
        "criticalFprHumanNegatives",
        1,
      ),
      criticalRecallPositives: integer(
        powerFloors,
        "powerFloors",
        "criticalRecallPositives",
        1,
      ),
      samplingUnits: nullableCount(powerFloors, "powerFloors", "samplingUnits"),
    },
    predictiveValuePrevalences: numberList(
      root,
      "",
      "predictiveValuePrevalences",
      (entry) => entry > 0 && entry < 1,
      "must hold prevalences in (0, 1)",
    ),
    productTarget: literal(
      root,
      "",
      "productTarget",
      "textual-compatibility-with-ai-generation",
    ),
    profileBands: frozenList(root, "", "profileBands", FROZEN_PROFILE_BANDS),
    profileValidityDays: integer(root, "", "profileValidityDays", 1),
    resampling: {
      allowedUnitKinds: textList(
        resampling,
        "resampling",
        "allowedUnitKinds",
        RESAMPLING_UNIT_KINDS,
      ) as readonly ResamplingUnitKind[],
      // Frozen false: without C4's plan the gate fails for missing evidence.
      fallbackToIndependentRows: literal(
        resampling,
        "resampling",
        "fallbackToIndependentRows",
        false,
      ),
      required: literal(resampling, "resampling", "required", true),
    },
    rollout: {
      actionsPromoted: literal(rollout, "rollout", "actionsPromoted", false),
      maximumStage: literal(rollout, "rollout", "maximumStage", "indicator"),
      stages: frozenList(rollout, "rollout", "stages", FROZEN_ROLLOUT_STAGES),
    },
    runtimeComparator: literal(
      root,
      "",
      "runtimeComparator",
      "score-ge-next-up-quantile",
    ),
    seeds: {
      ablation,
      bootstrap: integer(seeds, "seeds", "bootstrap", 1),
      crossValidation: integer(seeds, "seeds", "crossValidation", 1),
      publishableCheckpoint,
      split: integer(seeds, "seeds", "split", 1),
    },
    shareAlikeRequired: literal(root, "", "shareAlikeRequired", true),
    temporalCohort: {
      insufficientPowerLabel: literal(
        temporalCohort,
        "temporalCohort",
        "insufficientPowerLabel",
        "notApplicable",
      ),
      minimumDistinctTimestamps: integer(
        temporalCohort,
        "temporalCohort",
        "minimumDistinctTimestamps",
        2,
      ),
      perSource: literal(temporalCohort, "temporalCohort", "perSource", true),
      quartilesOf: literal(
        temporalCohort,
        "temporalCohort",
        "quartilesOf",
        "createdAt",
      ),
    },
    training: {
      batchDocuments: integer(training, "training", "batchDocuments", 1),
      epochs: integer(training, "training", "epochs", 1),
      learningRate: proportion(training, "training", "learningRate"),
      optimizer: literal(training, "training", "optimizer", "adamw"),
      warmupFraction: proportion(training, "training", "warmupFraction"),
      weightDecay: proportion(training, "training", "weightDecay"),
    },
    wordFloor: {
      abstainBelow: integer(wordFloor, "wordFloor", "abstainBelow", 1),
    },
  };

  return deepFreeze(policy);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/**
 * Absolute filesystem path of the JSON file this module validates. Exported so a
 * test can read its raw bytes and check the on-disk form.
 *
 * Built with `join`, not with `new URL("./x.json", import.meta.url)`: Vite
 * rewrites that literal pattern into an asset URL, which then is not a `file:`
 * URL and cannot be read from disk under vitest.
 */
export const REBUILD_V3_POLICY_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "rebuild-v3-policy.json",
);

/**
 * The frozen contract, read and validated once. Every benchmark module that needs
 * a frozen value imports THIS instead of writing the number down again.
 */
export const REBUILD_V3_POLICY: RebuildV3Policy = parseRebuildV3Policy(
  JSON.parse(readFileSync(REBUILD_V3_POLICY_PATH, "utf8")),
);
