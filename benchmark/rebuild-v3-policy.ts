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
//     profile bands, the human snapshots, the rollout stages and the two mixed
//     generation modes. Those are rows of
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

/**
 * The four rows of the frozen resampling table, named by what they estimate.
 *
 *   * `human-specificity` — FPR and specificity over human text: source, then
 *     author/donor inside the drawn source.
 *   * `ai-recall` — recall over AI text: generator, then prompt template, then
 *     seed/batch, nested in that order.
 *   * `mixed` — statistics over mixed text: the human parent CROSSED with the
 *     edit operation, never nested, because nesting what is crossed understates
 *     the variance.
 *   * `calibration` — ECE and Brier inherit the unit of the stratum under
 *     analysis, so the row nests the stratum outside the stratum's own unit and
 *     lets the inner level fall back per row.
 */
export type ResamplingEstimandClass =
  "ai-recall" | "calibration" | "human-specificity" | "mixed";

/**
 * One level of a resampling unit: the axis the source declares FIRST, plus the
 * axes it declares after it. `fallbacks` is consulted only when a record-line is
 * `notApplicable` on the axis before it — an `unknown` state fails instead
 * (benchmark/bootstrap.ts), because the two states mean different things.
 */
export interface ResamplingLevelRow {
  readonly axis: string;
  readonly fallbacks: readonly string[];
  /**
   * The factor of the FROZEN TABLE this axis stands in for, when the table names
   * a factor the record schema has no axis for. Present only on a substitution,
   * and the substitution is then published everywhere the unit is (the plan entry
   * and the report), because a reader of this file would otherwise see the row as
   * implemented while what runs is a different factor.
   */
  readonly proxyFor?: string;
  /** Why the table's own factor cannot be read, and what the stand-in costs. */
  readonly proxyReason?: string;
}

export interface ResamplingClassRow {
  /** Outer level first for `hierarchical`; crossed factors for `multiway`. */
  readonly levels: readonly ResamplingLevelRow[];
  readonly unitKind: ResamplingUnitKind;
}

export type LabelBasisValue = "date-cutoff" | "observed-process";
/**
 * HOW the human/AI mixture of a `mixed` record came about, and therefore which
 * cohort it belongs to.
 *
 *   * `mechanistic` — WE chose and executed the edits. The provenance per stretch
 *     is known exactly, but the coauthorship DISTRIBUTION is ours, not any real
 *     person's. Everything this project produces is mechanistic.
 *   * `ecological` — observed human coauthorship, i.e. a sample whose writing
 *     process was watched rather than staged. Reserved; nothing carries it yet.
 *
 * The vocabulary lives in the policy (`materialAssistance.generationModes`) and
 * `cohortsAggregated: false` is the mechanical consequence: the two are separate
 * slices wherever both can occur, and pooling them would report a coauthorship
 * distribution we manufactured as if it had been observed.
 */
export type GenerationMode = "mechanistic" | "ecological";
export type CalibratorKind = "platt" | "beta" | "isotonic";

/**
 * The channel a generated record's text came OUT of. Not a synonym for the
 * provider: three of the four core families are served by ONE agent CLI (`agy`),
 * so provider and channel vary independently.
 *
 * Operator decision of 2026-07-27, amending the D3 table. A CLI is a HARNESS: it
 * injects a system prompt of its own, has a binary version, loops over tools,
 * retries and post-processes. `benchmark/lab/generate_ai.py` has to strip
 * "banner/telemetry lines the gemini CLI prints around the answer" and to tell an
 * authentication failure apart from the model's own prose, which is proof that the
 * harness leaves a mark on the text.
 *
 * The risk this exists to make visible: `agy` serves 3 of 4 core families and is
 * ABSENT from the OOD family, so a detector that learned the harness signature
 * instead of the generator's would fail the OOD family for the wrong reason, and
 * the report would attribute the drop to "unseen generator" when the cause was
 * "unseen harness" — assessment §3.3's confounding in a new dimension.
 */
export type GenerationLane = "agy" | "codex" | "gemini-api" | "gemini-cli";

/**
 * WHAT KIND of channel a lane is, and therefore whether a harness binary stands
 * between the prompt and the text.
 *
 *   * `agent-cli` — a CLI that loops over tools and post-processes (`agy`, `codex`).
 *   * `cli` — a CLI wrapper around one call (`gemini-cli`).
 *   * `api` — a direct HTTP call, no binary of ours in the path.
 *
 * `harnessVersionRequired` is NOT a field: it is `channel !== "api"`, derived in
 * one place ({@link laneRunsHarness}) so the two facts cannot disagree.
 */
export type GenerationChannel = "agent-cli" | "cli" | "api";

/**
 * WHERE a recorded reasoning-effort value came from. Without this, a recorded
 * `effort` is indistinguishable from an inferred one, and inferring is what R6
 * forbids.
 *
 *   * `model-id` — the effort IS the model identifier (`gemini-3.5-flash-medium`).
 *   * `flag` — an independent flag we passed (`codex`'s `model_reasoning_effort`).
 *   * `not-supported` — the lane has no notion of effort at all.
 *   * `provider-default` — the provider applied a tier we did not choose, and we
 *     observed which one.
 *
 * Measured by direct probing of `agy` on 2026-07-27: `--effort` is NOT supported
 * on `claude-sonnet-4-6` or `claude-opus-4-6-thinking`, and CONFLICTS with models
 * whose id embeds the tier (`gpt-oss-120b-medium`, `gemini-3.1-pro-high`). So on
 * the `agy` lane the effort either IS the model id or does not exist — never an
 * independent flag. Where it is real is `codex` (`model_reasoning_effort`, which
 * accepts up to `xhigh`).
 */
export type EffortSource =
  "model-id" | "flag" | "not-supported" | "provider-default";

/**
 * One row of the frozen lane table: what the lane accepts, and on which scale it
 * reports effort.
 *
 * `effortScale` is nullable and is NOT decoration: `effort` is not comparable
 * across providers (`codex` reaches `xhigh`, `agy` stops at `high`), so a level is
 * meaningless without the scale it was measured on. The scale is named per lane
 * here and stored beside every recorded level, and
 * `compareEffortWithinScale` in benchmark/schema.ts refuses a cross-scale
 * comparison — the same rule that keeps `mechanistic` from being pooled with
 * `ecological`.
 */
export interface GenerationLaneRow {
  readonly channel: GenerationChannel;
  /** False on every CLI lane: a CLI accepts no `temperature`/`top_p`. */
  readonly decodingConfigurable: boolean;
  /** True only where effort is an independent flag, i.e. only on `codex`. */
  readonly effortConfigurable: boolean;
  readonly effortScale: string | null;
  /** The levels of `effortScale`, in increasing order. Empty iff no scale. */
  readonly effortLevels: readonly string[];
  readonly effortSources: readonly EffortSource[];
}

/** Does this lane put a harness binary between the prompt and the text? */
export function laneRunsHarness(row: GenerationLaneRow): boolean {
  return row.channel !== "api";
}
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
  /**
   * The closed lane vocabulary with what each lane accepts. It lives HERE and not
   * as a loose constant in benchmark/schema.ts for the reason the frozen contract
   * gives for every other settled row: the schema, the assembler (C2) and the
   * generator matrix (D3) must read one table, and a lane added in one of them
   * without the others is then a type error rather than a silent divergence.
   */
  readonly generationLanes: {
    readonly [L in GenerationLane]: GenerationLaneRow;
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
    // The action ceiling of the integral-generation target: visual action is
    // authorized only when the DOCUMENT gates pass. The other two targets have
    // their ceilings on their own blocks (`materialAssistance.authorizes` and
    // `localization.authorizesVisualAction`), so no ceiling is written twice.
    readonly visualActionRequiresDocumentGates: true;
  };
  readonly labelBasis: {
    readonly allowed: readonly LabelBasisValue[];
    readonly appliesToLabel: "human";
    readonly pooledClaimAllowed: false;
    readonly underPoweredRole: "supplementary-diagnostic";
  };
  readonly localization: {
    readonly authorizesVisualAction: false;
    // Span IoU, token precision/recall and localized-path recall are DIAGNOSTIC
    // in v3: they explain and locate a warning, and no gate reads them.
    readonly metricsRole: "diagnostic";
    readonly standaloneClaim: false;
    readonly trainsAuxiliaryHead: true;
  };
  readonly materialAssistance: {
    readonly authorizes: "warning-only";
    // Frozen false: `mechanistic` and `ecological` are separate slices wherever
    // both occur and are never added together.
    readonly cohortsAggregated: false;
    // The cohort THIS project produces.
    readonly generationMode: "mechanistic";
    // The closed vocabulary the schema validates a mixture against.
    readonly generationModes: readonly GenerationMode[];
    readonly minimumAiFraction: number;
    // The floor of the `warning.mixed-recall` gate. It is a row of the frozen
    // three-target table (B2), so it lives here and not as a constant in
    // benchmark/gates.ts.
    readonly minimumWarningRecall: number;
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
    // The four rows of the frozen estimand table. They are CLASSES, not gate
    // ids: the unit of resampling is a property of what is being estimated, so
    // every gate over the same estimand shares one row.
    readonly estimandClasses: {
      readonly [C in ResamplingEstimandClass]: ResamplingClassRow;
    };
    // Published estimand name -> the class whose unit it inherits.
    readonly estimands: Readonly<Record<string, ResamplingEstimandClass>>;
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
// Content AND order: `mechanistic` first because it is the cohort this project
// produces and the one the material-assistance target is defined over. Dropping
// `ecological` would let a future observed-process sample be pooled into the
// mechanistic cohort by omission, which is the aggregation the table forbids.
const FROZEN_GENERATION_MODES = ["mechanistic", "ecological"] as const;

// The lane names, frozen as a SET (the JSON block is keyed by them, and object
// key order is not a decision the way a list's is). Four lanes: one API and three
// CLIs, which is exactly the confounding the row exists to expose.
const FROZEN_GENERATION_LANES: readonly GenerationLane[] = [
  "agy",
  "codex",
  "gemini-api",
  "gemini-cli",
];
const LANE_ROW_KEYS = [
  "channel",
  "decodingConfigurable",
  "effortConfigurable",
  "effortLevels",
  "effortScale",
  "effortSources",
] as const;
const GENERATION_CHANNELS: readonly GenerationChannel[] = [
  "agent-cli",
  "cli",
  "api",
];
const EFFORT_SOURCES: readonly EffortSource[] = [
  "model-id",
  "flag",
  "not-supported",
  "provider-default",
];

function boolean(
  record: Record<string, unknown>,
  path: string,
  key: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new RebuildV3PolicyError(at(path, key), "must be a boolean");
  }
  return value;
}

function member<T extends string>(
  record: Record<string, unknown>,
  path: string,
  key: string,
  allowed: readonly T[],
): T {
  const value = record[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new RebuildV3PolicyError(
      at(path, key),
      `must be one of ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

// One lane row. The cross-field rule is the point of the row and not shape
// hygiene: a scale and its levels stand or fall together, because a level list
// with no scale is a shared ordinal by another name, and a scale with no levels
// admits any string.
//
// `not-supported` DOES sit beside another source, deliberately — an earlier
// version of this function refused that combination and the frozen `agy` row
// immediately failed it, which is recorded here because the refusal was the wrong
// half of a real measurement. On `agy` the effort either IS the model id
// (`gemini-3.5-flash-medium`) or does not exist at all: `--effort` is refused on
// `claude-sonnet-4-6` and on `claude-opus-4-6-thinking`. So one lane legitimately
// produces records under both sources, and it is the RECORD that must say which
// one applies to it, which is exactly what `effort.source` is for.
function laneRow(value: unknown, path: string): GenerationLaneRow {
  const row = object(value, path, LANE_ROW_KEYS);
  const scale =
    row.effortScale === null ? null : text(row, path, "effortScale");
  const levels =
    scale === null
      ? emptyStringList(row, path, "effortLevels")
      : textList(row, path, "effortLevels");
  const sources = textList(
    row,
    path,
    "effortSources",
    EFFORT_SOURCES,
  ) as readonly EffortSource[];
  if (scale === null && !sources.includes("not-supported")) {
    throw new RebuildV3PolicyError(
      at(path, "effortScale"),
      'is null, so effortSources must be exactly ["not-supported"]',
    );
  }
  return Object.freeze({
    channel: member(row, path, "channel", GENERATION_CHANNELS),
    decodingConfigurable: boolean(row, path, "decodingConfigurable"),
    effortConfigurable: boolean(row, path, "effortConfigurable"),
    effortScale: scale,
    effortLevels: levels,
    effortSources: sources,
  });
}

// The empty list is a legitimate value ONLY here: a lane with no effort scale has
// no levels. `textList` refuses an empty array everywhere else on purpose, so this
// is a separate function rather than a flag on it.
function emptyStringList(
  record: Record<string, unknown>,
  path: string,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== 0) {
    throw new RebuildV3PolicyError(
      at(path, key),
      "must be an empty array when effortScale is null",
    );
  }
  return Object.freeze([]);
}

function generationLanes(value: unknown): {
  readonly [L in GenerationLane]: GenerationLaneRow;
} {
  const block = object(value, "generationLanes", FROZEN_GENERATION_LANES);
  const rows = {} as { [L in GenerationLane]: GenerationLaneRow };
  for (const lane of FROZEN_GENERATION_LANES) {
    if (!Object.hasOwn(block, lane)) {
      throw new RebuildV3PolicyError(
        `generationLanes.${lane}`,
        "is missing: the lane vocabulary is frozen and every lane needs a row",
      );
    }
    rows[lane] = laneRow(block[lane], `generationLanes.${lane}`);
  }
  // A harness lane whose decoding is configurable, or an API lane whose decoding
  // is not, would contradict the measurement the row records.
  for (const lane of FROZEN_GENERATION_LANES) {
    const row = rows[lane];
    if (laneRunsHarness(row) && row.decodingConfigurable) {
      throw new RebuildV3PolicyError(
        `generationLanes.${lane}.decodingConfigurable`,
        "must be false on a lane that runs a harness: a CLI accepts no temperature or top_p",
      );
    }
    if (row.effortConfigurable && !row.effortSources.includes("flag")) {
      throw new RebuildV3PolicyError(
        `generationLanes.${lane}.effortConfigurable`,
        'is true, so effortSources must offer "flag": a configurable effort is one passed as a flag',
      );
    }
  }
  return Object.freeze(rows);
}

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
  "generationLanes",
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
// Content AND membership: the frozen table has exactly these four rows, so a row
// added or dropped in the JSON is a change to the table and stops here.
const FROZEN_RESAMPLING_CLASSES: readonly ResamplingEstimandClass[] = [
  "ai-recall",
  "calibration",
  "human-specificity",
  "mixed",
];
const RESAMPLING_LEVEL_KEYS = [
  "axis",
  "fallbacks",
  "proxyFor",
  "proxyReason",
] as const;
const RESAMPLING_CLASS_KEYS = ["levels", "unitKind"] as const;
// A resampling axis names a grouping axis of the record schema. The prefix is
// required so a level can never be confused with a synthetic per-row key, which
// is the one thing R6 forbids outright.
const RESAMPLING_AXIS_PATTERN = /^groups\.[A-Za-z][A-Za-z0-9]*$/u;

function resamplingAxis(value: unknown, path: string): string {
  if (typeof value !== "string" || !RESAMPLING_AXIS_PATTERN.test(value)) {
    throw new RebuildV3PolicyError(
      path,
      'must name a record grouping axis as "groups.<axis>"',
    );
  }
  return value;
}

function resamplingLevel(value: unknown, path: string): ResamplingLevelRow {
  const row = object(value, path, RESAMPLING_LEVEL_KEYS);
  const axis = resamplingAxis(row.axis, at(path, "axis"));
  const raw = row.fallbacks;
  if (!Array.isArray(raw)) {
    throw new RebuildV3PolicyError(at(path, "fallbacks"), "must be an array");
  }
  const seen = new Set<string>([axis]);
  const fallbacks = raw.map((entry, index) => {
    const next = resamplingAxis(entry, `${at(path, "fallbacks")}[${index}]`);
    if (seen.has(next)) {
      throw new RebuildV3PolicyError(
        `${at(path, "fallbacks")}[${index}]`,
        `repeats the axis ${next} already declared in this level`,
      );
    }
    seen.add(next);
    return next;
  });
  // A stand-in factor has to say BOTH what it replaces and why the table's own
  // factor cannot be read. One without the other is how a substitution becomes
  // invisible: `proxyFor` alone reads as a synonym, and `proxyReason` alone leaves
  // the table row looking implemented.
  const proxyFor = optionalProxyField(row, path, "proxyFor");
  const proxyReason = optionalProxyField(row, path, "proxyReason");
  if ((proxyFor === undefined) !== (proxyReason === undefined)) {
    throw new RebuildV3PolicyError(
      at(path, proxyFor === undefined ? "proxyFor" : "proxyReason"),
      "is required whenever the other is present: a substituted factor declares " +
        "both what it stands in for and why the table's own factor cannot be read",
    );
  }
  return Object.freeze({
    axis,
    fallbacks: Object.freeze(fallbacks),
    ...(proxyFor === undefined ? {} : { proxyFor }),
    ...(proxyReason === undefined ? {} : { proxyReason }),
  });
}

function optionalProxyField(
  row: Record<string, unknown>,
  path: string,
  key: "proxyFor" | "proxyReason",
): string | undefined {
  const value = row[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RebuildV3PolicyError(
      at(path, key),
      "must be a non-empty string when present",
    );
  }
  return value;
}

function resamplingClass(value: unknown, path: string): ResamplingClassRow {
  const row = object(value, path, RESAMPLING_CLASS_KEYS);
  const unitKind = member(row, path, "unitKind", RESAMPLING_UNIT_KINDS);
  const raw = row.levels;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RebuildV3PolicyError(
      at(path, "levels"),
      "must be a non-empty array of levels",
    );
  }
  const levels = raw.map((entry, index) =>
    resamplingLevel(entry, `${at(path, "levels")}[${index}]`),
  );
  // The cross-field rule that IS the decision: crossing needs two factors. A
  // one-factor "multiway" design is a one-level hierarchical design wearing the
  // wrong name, and it would be read as evidence that the crossed pair of the
  // frozen table was honoured.
  if (unitKind === "multiway" && levels.length < 2) {
    throw new RebuildV3PolicyError(
      at(path, "levels"),
      "declares unitKind multiway with fewer than two factors: crossing needs two",
    );
  }
  return Object.freeze({ levels: Object.freeze(levels), unitKind });
}

function resamplingEstimands(
  value: unknown,
): Readonly<Record<string, ResamplingEstimandClass>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    throw new RebuildV3PolicyError(
      "resampling.estimands",
      "must be a non-empty object mapping estimand names to table rows",
    );
  }
  const block = value as Record<string, unknown>;
  const mapped: Record<string, ResamplingEstimandClass> = {};
  for (const estimand of Object.keys(block)) {
    const declared = block[estimand];
    if (
      typeof declared !== "string" ||
      !FROZEN_RESAMPLING_CLASSES.includes(declared as ResamplingEstimandClass)
    ) {
      throw new RebuildV3PolicyError(
        `resampling.estimands.${estimand}`,
        `must be one of ${FROZEN_RESAMPLING_CLASSES.join(", ")}`,
      );
    }
    mapped[estimand] = declared as ResamplingEstimandClass;
  }
  return Object.freeze(mapped);
}

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
    "visualActionRequiresDocumentGates",
  ]);
  const labelBasis = object(root.labelBasis, "labelBasis", [
    "allowed",
    "appliesToLabel",
    "pooledClaimAllowed",
    "underPoweredRole",
  ]);
  const localization = object(root.localization, "localization", [
    "authorizesVisualAction",
    "metricsRole",
    "standaloneClaim",
    "trainsAuxiliaryHead",
  ]);
  const materialAssistance = object(
    root.materialAssistance,
    "materialAssistance",
    [
      "authorizes",
      "cohortsAggregated",
      "generationMode",
      "generationModes",
      "minimumAiFraction",
      "minimumWarningRecall",
    ],
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
    "estimandClasses",
    "estimands",
    "fallbackToIndependentRows",
    "required",
  ]);
  const estimandClassBlock = object(
    resampling.estimandClasses,
    "resampling.estimandClasses",
    FROZEN_RESAMPLING_CLASSES,
  );
  const estimandClasses = {} as {
    [C in ResamplingEstimandClass]: ResamplingClassRow;
  };
  for (const row of FROZEN_RESAMPLING_CLASSES) {
    if (!Object.hasOwn(estimandClassBlock, row)) {
      throw new RebuildV3PolicyError(
        `resampling.estimandClasses.${row}`,
        "is missing: the four rows of the frozen resampling table are all required",
      );
    }
    estimandClasses[row] = resamplingClass(
      estimandClassBlock[row],
      `resampling.estimandClasses.${row}`,
    );
  }
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
    generationLanes: generationLanes(root.generationLanes),
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
      visualActionRequiresDocumentGates: literal(
        integralPositive,
        "integralPositive",
        "visualActionRequiresDocumentGates",
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
      metricsRole: literal(
        localization,
        "localization",
        "metricsRole",
        "diagnostic",
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
      cohortsAggregated: literal(
        materialAssistance,
        "materialAssistance",
        "cohortsAggregated",
        false,
      ),
      generationMode: literal(
        materialAssistance,
        "materialAssistance",
        "generationMode",
        "mechanistic",
      ),
      generationModes: frozenList(
        materialAssistance,
        "materialAssistance",
        "generationModes",
        FROZEN_GENERATION_MODES,
      ) as readonly GenerationMode[],
      minimumAiFraction: proportion(
        materialAssistance,
        "materialAssistance",
        "minimumAiFraction",
      ),
      minimumWarningRecall: proportion(
        materialAssistance,
        "materialAssistance",
        "minimumWarningRecall",
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
      estimandClasses: Object.freeze(estimandClasses),
      estimands: resamplingEstimands(resampling.estimands),
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
