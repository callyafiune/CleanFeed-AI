// The frozen pre-registration of the v1 model release, as data.
//
// The claim this file pre-registers is SCOPED: ONE declared cell (encyclopedic text,
// Wikipedia pt dump 2022-03-01), its FPR ceiling, recall at the frozen threshold, one
// global calibration statistic and integrity — four hypotheses, Bonferroni at
// alpha_family = 0.05. There is no claim about "pt-BR text in general", because
// without a sampling frame there is no estimand.
//
// The frame is one cell and not four because the material of the other three did not
// carry the provenance the claim needs: the Carolina typologies are single-institution
// corpora (judicial = 5 hosts, all *.stf.jus.br; university = jornal.usp.br alone;
// social media = wattpad.com alone), they declare no author on any document, and
// between "one unit" and "38 187 units" the package offers no basis for choosing. A
// cell whose independence cannot be established at the scale the interval assumes is
// not a narrower claim, it is an unsupported one.
//
// This module is the only place the benchmark may read those values from, and
// `benchmark/preregistration-v4.json` is the only place they are written down.
//
// What is in the JSON and what is not: every decision with a MECHANICAL consequence
// is here as structured data (a number, an enum, a list or a boolean flag). Rows
// that are prose-only obligations are here ONLY as the mechanical flag behind them —
// `productTarget` plus `infersAuthorship: false` for "indicate textual
// compatibility, never infer authorship", and `localization.authorizesVisualAction:
// false` for the localization row. Nothing is paraphrased into a sentence.
//
// The parser fails closed on a missing key, an unknown key, a wrong type, a value
// outside its domain and — for the decisions whose whole point is that they are
// settled — on any value other than the frozen one. There is no default anywhere: a
// policy that does not declare a value is invalid, never "the usual number".
//
// Which rows are pinned to their exact value, and which are only shape-checked:
//   * SCALARS pinned by `literal` / `frozenNumber`: every settled enum and flag
//     (`commercialUse`, `backbone`, `threshold.probabilisticCalibrator`,
//     `connectivity.splitUnionsOnDependencyAxis`, `parity.operationalMaximumInversions`,
//     `powerFloors.criticalFprHumanNegatives`, ...).
//   * LISTS pinned by `frozenList`, content and order: the core strata, the four
//     primary hypotheses, the quota cells, the human snapshots, the hard-negative
//     families, the profile bands, the rollout stages, the two mixed generation
//     modes and the split-union axes. A reordered family or a dropped stratum is a
//     different decision, not a formatting variant.
//   * SHAPE-CHECKED ONLY, because they are magnitudes rather than closed
//     vocabularies: the remaining numeric thresholds, seeds, replicate counts and
//     tolerances (validated for type, integrality and domain), and
//     `predictiveValuePrevalences` (distinct values in (0, 1)).
//   * `lengthBands`, pinned on its keys AND refused unless the bands partition the
//     measured population: they start at the abstain floor, they neither overlap nor
//     leave a gap, the top one is unbounded and their shares sum to the blind block.
//     The bands are a DIAGNOSTIC and are frozen here for the same reason the
//     hypotheses are — a slice chosen after seeing the result is post-hoc even when it
//     spends no alpha.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-side by construction — it reads its own JSON once, at module load, with
// `readFileSync`, so every consumer sees one immutable, deeply frozen object and no
// function in this package has to thread the policy through its signature. There is
// no Date and no randomness: the parsed policy is a pure function of the file's
// bytes, which the evaluator digest covers (see EVALUATOR_FILES).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Coded, fail-closed error naming the exact path that is invalid. */
export class PreregistrationV4Error extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`PREREGISTRATION_V4_INVALID: ${path} ${detail}`);
    this.name = "PreregistrationV4Error";
    this.path = path;
  }
}

export type ResamplingUnitKind = "hierarchical" | "multiway";

/**
 * The four rows of the frozen resampling table, named by what they estimate.
 *
 *   * `human-specificity` — FPR and specificity over human text: the author, falling
 *     back to the origin document.
 *   * `ai-recall` — recall over AI text: generator, then prompt template, then
 *     generation batch, nested in that order.
 *   * `mixed` — statistics over mixed text: the human parent CROSSED with the edit
 *     operation, never nested, because nesting what is crossed understates the
 *     variance.
 *   * `calibration` — ECE and Brier inherit the unit of the population under
 *     analysis, so the row names that unit and lets it fall back per row.
 *
 * Neither human row nests the STRATUM any more, and that is the one-cell frame read
 * onto the table: `groups.domainSource` holds a single value over the whole corpus, a
 * level with one value draws the same unit in every replicate, and a table that names
 * it would read as if the published bound had accounted for between-stratum variation
 * it never saw. The level comes back with the second cell, which is the arithmetic
 * cost of adding one.
 */
export type ResamplingEstimandClass =
  "ai-recall" | "calibration" | "human-specificity" | "mixed";

/**
 * One level of a resampling unit: the axis the source declares FIRST, plus the axes
 * it declares after it. `fallbacks` is consulted only when a record-line is
 * `notApplicable` on the axis before it — an `unknown` state fails instead
 * (benchmark/bootstrap.ts), because the two states mean different things.
 */
export interface ResamplingLevelRow {
  readonly axis: string;
  readonly fallbacks: readonly string[];
  /**
   * The factor of the FROZEN TABLE this axis stands in for, when the table names a
   * factor the record schema has no axis for. Present only on a substitution, and
   * the substitution is then published everywhere the unit is, because a reader of
   * this file would otherwise see the row as implemented while what runs is a
   * different factor.
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

/**
 * How the published bound of a rate is chosen when both estimators produced one.
 *
 * `wider-of-analytic-and-resampled` — the published limit is the outer of the
 * analytic Wilson bound and the percentile bound over the declared unit, on each
 * side. The two fail in opposite directions and neither dominates: the analytic
 * bound counts correlated record-lines as independent and is too narrow on a corpus
 * with shared authors, documents, prompts and generators; the percentile bound sees
 * that dependence but collapses to ZERO WIDTH whenever the statistic is constant
 * across replicates, which is exactly a rate with no events at all. A zero-width
 * interval claims certainty from a finite sample and is NARROWER than the analytic
 * bound, so publishing it would make a gate easier to pass with less evidence (R3).
 * The outer of the two can only move a limit away from the budget, so it never buys
 * a pass, and it is never narrower than the resampled bound, so the dependence the
 * design captures is always honoured. What it is NOT is an exact-coverage interval:
 * it is conservative by construction.
 */
export type PublishedBoundRule = "wider-of-analytic-and-resampled";

/**
 * An estimand that inherits a row's unit WITHOUT the row naming it.
 *
 * Both fields are required together, and the key must also appear in
 * `resampling.estimands`: an extension of a mapping that does not exist is a typo,
 * not a declaration.
 */
export interface ResamplingEstimandExtension {
  /** The row's OWN subject, verbatim from the frozen table. */
  readonly standsInFor: string;
  /** Why the row is stretched, and what the stretch does and does not buy. */
  readonly reason: string;
}

export type LabelBasisValue = "date-cutoff" | "observed-process";

/**
 * One pre-registered length band of the FPR diagnostic.
 *
 * `maximumWords` is `null` on the LAST band and only there: the top band runs to
 * infinity, because a corpus of lead sections has no pre-registrable maximum and a
 * band with an upper edge would leave the longest documents unnamed.
 *
 * `expectedBlindBlockLines` is the band's share of the blind block the collection
 * target implies, and `diagnosticCeilingAtExpectedLines` is the zero-event ceiling
 * at that share. They travel WITH the band because a band's `n` is a fraction of the
 * headline's: reading a band ceiling as if it had the headline's precision is the
 * misreading the whole block exists to prevent.
 */
export interface LengthBandRow {
  readonly key: string;
  readonly minimumWords: number;
  readonly maximumWords: number | null;
  readonly expectedBlindBlockLines: number;
  readonly diagnosticCeilingAtExpectedLines: number;
}

/**
 * HOW the human/AI mixture of a `mixed` record came about, and therefore which
 * cohort it belongs to.
 *
 *   * `mechanistic` — WE chose and executed the edits. The provenance per stretch is
 *     known exactly, but the coauthorship DISTRIBUTION is ours, not any real
 *     person's. Everything this project produces is mechanistic.
 *   * `ecological` — observed human coauthorship, i.e. a sample whose writing
 *     process was watched rather than staged. Reserved; nothing carries it yet.
 *
 * `cohortsAggregated: false` is the mechanical consequence: the two are separate
 * slices wherever both can occur, and pooling them would report a coauthorship
 * distribution we manufactured as if it had been observed.
 */
export type GenerationMode = "mechanistic" | "ecological";
export type CalibratorKind = "platt" | "beta" | "isotonic";

/**
 * The channel a generated record's text came OUT of. Not a synonym for the
 * provider: three of the four core families are served by ONE agent CLI (`agy`), so
 * provider and channel vary independently.
 *
 * A CLI is a HARNESS: it injects a system prompt of its own, has a binary version,
 * loops over tools, retries and post-processes. `benchmark/lab/generate_ai.py` has
 * to strip banner/telemetry lines the gemini CLI prints around the answer and to
 * tell an authentication failure apart from the model's own prose, which is proof
 * that the harness leaves a mark on the text.
 *
 * The risk this exists to make visible: `agy` serves 3 of 4 core families and is
 * ABSENT from the OOD family, so a detector that learned the harness signature
 * instead of the generator's would fail the OOD family for the wrong reason, and the
 * report would attribute the drop to "unseen generator" when the cause was "unseen
 * harness".
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
 * `harnessVersionRequired` is NOT a field: it is `channel !== "api"`, derived in one
 * place ({@link laneRunsHarness}) so the two facts cannot disagree.
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
 * Measured by direct probing of `agy` on 2026-07-27: `--effort` is NOT supported on
 * `claude-sonnet-4-6` or `claude-opus-4-6-thinking`, and CONFLICTS with models whose
 * id embeds the tier (`gpt-oss-120b-medium`, `gemini-3.1-pro-high`). So on the `agy`
 * lane the effort either IS the model id or does not exist — never an independent
 * flag. Where it is real is `codex` (`model_reasoning_effort`, which accepts up to
 * `xhigh`).
 */
export type EffortSource =
  "model-id" | "flag" | "not-supported" | "provider-default";

/**
 * One row of the frozen lane table: what the lane accepts, and on which scale it
 * reports effort.
 *
 * `effortScale` is nullable and is NOT decoration: `effort` is not comparable across
 * providers (`codex` reaches `xhigh`, `agy` stops at `high`), so a level is
 * meaningless without the scale it was measured on. The scale is named per lane here
 * and stored beside every recorded level, and `compareEffortWithinScale` in
 * benchmark/schema.ts refuses a cross-scale comparison.
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
 * Bonferroni percentile at alpha_family / m, which is a different and wider bound
 * than the individual 95% one. benchmark/gates.ts derives the gate's direction from
 * this value through an exhaustive switch, so a new value here is a type error there
 * rather than a silent divergence.
 */
export type EceGateBound = "bootstrap-simultaneous-upper";

/**
 * WHICH score every calibration and threshold statement is about.
 *
 * `document-raw-score` is the head's own softmax after document aggregation — the
 * SAME number the frozen threshold cuts. It exists without a calibrator, lives in
 * [0, 1], and ECE-15 equal-mass over it is a pre-registrable hypothesis. What it
 * does NOT license is probability language anywhere: a raw softmax bounded in ECE is
 * still not a calibrated probability, and the v1 publishes no confidence figure.
 */
export type ScoreBasis = "document-raw-score";

export interface PreregistrationV4 {
  readonly attributionRequired: true;
  /**
   * The frozen base encoder. The served path is BERT-shaped and cannot carry a
   * RoBERTa: the graph `benchmark/lab/export_onnx.py` publishes takes exactly three
   * inputs (`input_ids`, `attention_mask`, `token_type_ids`) and ships `vocab.txt`,
   * while a RoBERTa has no segment ids and a SentencePiece model instead of a
   * WordPiece vocabulary. `public/models/cleanfeed-ptbr-v1/` delivers `vocab.txt`,
   * and `src/inference/model-runtime.ts` splits every CJK ideograph into its own
   * basic word because THIS vocabulary holds no bare ideograph.
   *
   * The shape is refused HERE, not just checked downstream: only the exporter's
   * fallback names the three inputs itself — the `optimum` path delegates the graph
   * to the library and is asked afterwards what it produced.
   */
  readonly backbone: "neuralmind/bert-base-portuguese-cased";
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
    /**
     * The global calibration hypothesis is measured on the raw document score, and
     * the parser refuses a policy where this and {@link PreregistrationV4.threshold}
     * name different scores: a calibration statement about a score the threshold
     * does not cut says nothing about the decision the release publishes.
     */
    readonly scoreBasis: ScoreBasis;
  };
  /**
   * The calibrator competition, RESERVED for the v2 and not run by the v1: the v1
   * freezes no probabilistic calibrator at all
   * ({@link PreregistrationV4.threshold}.probabilisticCalibrator is `"none"`). The
   * parameters stay pre-registered rather than deleted so the v2 cannot pick them
   * after seeing which candidate wins.
   */
  readonly calibrator: {
    readonly candidates: readonly CalibratorKind[];
    readonly crossValidationFolds: number;
    readonly reservedFor: "v2";
    readonly tieBreakOrder: readonly CalibratorKind[];
    readonly tieToleranceAbsolute: number;
  };
  /**
   * What the corpus has to hold per cell for the FPR denominators to reach their
   * floor, and the one-line-per-origin-document rule that keeps the draws
   * exchangeable.
   *
   * `humanLinesPerCellTarget` is ABOVE `humanLinesPerCellMinimum` on purpose: the
   * split is a random draw, the per-cell count in `test` has a standard deviation of
   * roughly 15 lines at these sizes, and a collection that stops exactly at the
   * floor fails the composition gate on sampling noise alone.
   *
   * The two per-cell numbers answer different questions, and with one cell the gap
   * between them is the whole published ceiling: the MINIMUM is the collection floor
   * whose 20 % blind block is exactly the 300-line FPR denominator
   * (`powerFloors.criticalFprHumanNegatives`), and the TARGET is what the collection
   * aims at, whose blind block is `zeroEventCeiling.blindBlockLinesAtCollectionTarget`
   * — the `n` the published ceiling under zero events is read at.
   */
  readonly collection: {
    readonly humanLinesPerCellMinimum: number;
    readonly humanLinesPerCellTarget: number;
    readonly humanLinesTotal: number;
    readonly maximumLinesPerOriginDocument: number;
  };
  readonly commercialUse: false;
  /**
   * Split conformal, RESERVED for the v2. The v1 publishes no conformal guarantee
   * and no per-band threshold; the population is pre-registered here so the v2
   * cannot choose it after seeing `cal-B`.
   */
  readonly conformal: {
    readonly population: "cal-b-humans";
    readonly reservedFor: "v2";
  };
  /**
   * WHICH axes carry dependence, and which of them the splitter is allowed to union
   * on. The two are not the same list, and that is the whole content of the block.
   *
   * `dependencyAxis` is the declared unit of dependence BETWEEN acquisitions, and it
   * is deliberately NOT a union axis (`splitUnionsOnDependencyAxis: false`): there is
   * one acquisition event per source and one stratum per quota cell, so unioning on
   * either would make each cell a single indivisible component. THIS frame declares
   * ONE cell (`preRegistration.quotaAxis.cells`), so that component is the whole
   * `human` class — its fraction is 100 % of the class, `dev`'s 0.05 is unreachable by
   * construction, the preflight refuses on its LARGEST-component branch, and a floor
   * counted in independent units reads 1 per cell forever.
   *
   * The four-cell arithmetic is COUNTERFACTUAL: no frame declares four cells. It is
   * kept because it IS the argument rather than an illustration of it — more cells
   * soften the fractions without repairing any, so these two axes stay out of the
   * union under every frame and not merely this one. The refusing BRANCH moves with n,
   * though. With n cells each fraction is 1/n: at n = 2 it still exceeds the largest
   * target plus tolerance (0.47) and the refusal is the largest component's; from
   * n = 3 to n = 14 it fits the largest and exceeds the smallest target plus tolerance
   * (0.07), so the refusal becomes the SMALLEST component's — four cells read ~25 %
   * each, inside that band; at n = 15 (6.67 %) this preflight stops refusing at all.
   * Not refusing is NOT feasibility:
   * `assert_components_can_fill_five_partitions` (benchmark/lab/assemble_corpus.py)
   * decides two NECESSARY conditions and declares that the complete assignment is
   * subset sum, which it does not decide.
   *
   * `splitUnionAxes` mirrors `GROUP_KEYS` in benchmark/split.ts. It is not imported
   * from there — the splitter reads this file, and importing back would be a cycle —
   * so the agreement is held by test.
   */
  readonly connectivity: {
    readonly dependencyAxis: "sourceMaterialBatch";
    /** Re-extracting one dump produces no new material, so it unions nothing. */
    readonly diagnosticAxes: readonly string[];
    readonly independentUnit: typeof FROZEN_INDEPENDENT_UNIT;
    readonly reportedAxes: readonly string[];
    readonly splitUnionAxes: readonly string[];
    readonly splitUnionsOnDependencyAxis: false;
  };
  /**
   * The identity of the corpus this pre-registration is about, plus the identifiers
   * it refuses BY NAME.
   *
   * A dataset id that leaves by being deleted leaves no trace, and a pipeline handed
   * the old id would silently build the corpus of a claim nobody makes any more.
   * Naming the refusal is what makes reusing the id a failure with a diagnosis.
   */
  readonly dataset: {
    /**
     * LITERAL and not `string`, so a consumer that compares against this identity is
     * held by the compiler and not only at runtime: `corpus-import.ts` used to carry the
     * old id as a literal type, and widening it to `string` let a caller name any
     * identity the refusal list did not happen to mention.
     */
    readonly id: "cleanfeed-ptbr-cells-v1";
    readonly intendedDomain: "scoped-cells";
    readonly refusedIds: readonly {
      readonly id: string;
      readonly refusedBecause: string;
    }[];
  };
  readonly fprBudgets: {
    readonly visualAction: number;
    readonly warning: number;
  };
  /**
   * The closed lane vocabulary with what each lane accepts. It lives HERE and not as
   * a loose constant in benchmark/schema.ts because the schema, the assembler and
   * the generator matrix must read ONE table: a lane added in one of them without
   * the others is then a type error rather than a silent divergence.
   */
  readonly generationLanes: {
    readonly [L in GenerationLane]: GenerationLaneRow;
  };
  readonly hardNegativeFamilies: readonly string[];
  readonly humanCoreStrata: readonly string[];
  readonly humanSources: {
    /**
     * Snapshots refused BY NAME, with the reason and what would lift it.
     *
     * A source that leaves the corpus by being deleted from `snapshots` leaves no
     * trace, and the audit that used to reason about its records goes quiet instead
     * of failing. Naming the refusal is what makes re-adding the source a failure
     * with a diagnosis (`access-terms-unresolved`) rather than a one-line edit that
     * works.
     */
    readonly blockedSnapshots: readonly {
      readonly blockedBy: "access-terms-unresolved";
      readonly snapshot: string;
      readonly unblockRequires: string;
    }[];
    readonly newDownloadsAllowed: false;
    readonly snapshots: readonly string[];
  };
  readonly infersAuthorship: false;
  readonly integralPositive: {
    readonly label: "ai";
    readonly requiresRegisteredPipeline: true;
    // The action ceiling of the integral-generation target: visual action is
    // authorized only when the DOCUMENT gates pass. The other two targets have their
    // ceilings on their own blocks (`materialAssistance.authorizes` and
    // `localization.authorizesVisualAction`), so no ceiling is written twice.
    readonly visualActionRequiresDocumentGates: true;
  };
  readonly labelBasis: {
    readonly allowed: readonly LabelBasisValue[];
    readonly appliesToLabel: "human";
    readonly pooledClaimAllowed: false;
    readonly underPoweredRole: "supplementary-diagnostic";
  };
  /**
   * The length bands the FPR is published over, and nothing else: they are a
   * DIAGNOSTIC that decides nothing and holds no share of `alpha_família`.
   *
   * WHY THE BAND TABLE EXISTS. Short text probably FLATTERS the FPR. With little
   * text the model has little signal, hesitates and fires less, so the measured rate
   * is low by uncertainty rather than by competence — and a reader who scores 600
   * words gets a more confident model whose rate the measurement never estimated.
   * The number would not be false; it would not TRANSFER, which is the hardest kind
   * of misleading number to notice. Publishing the rate per band is what makes the
   * number that transfers visible.
   *
   * WHY THE BANDS ARE PRE-REGISTERED. A diagnostic slice chosen AFTER seeing the
   * result is post-hoc even when it spends no alpha: whoever picks the cut afterwards
   * picks the cut that tells the story they want. So the edges are frozen here, and
   * that is legitimate precisely because nothing has been measured yet.
   *
   * The first band starts at `wordFloor.abstainBelow` and the parser refuses any
   * other value: the measurement ABSTAINS below that count, so a band starting lower
   * would name a population the measurement never measures, and a band starting
   * higher would leave the shortest measured rows in no band at all.
   */
  readonly lengthBands: {
    readonly bands: readonly LengthBandRow[];
    readonly decides: false;
    /** The population the band shares were measured over, named not paraphrased. */
    readonly measuredPopulation: string;
    readonly role: "diagnostic";
    readonly spendsAlpha: false;
  };
  readonly localization: {
    readonly authorizesVisualAction: false;
    // Span IoU, token precision/recall and localized-path recall are DIAGNOSTIC:
    // they explain and locate a warning, and no gate reads them.
    readonly metricsRole: "diagnostic";
    readonly standaloneClaim: false;
    readonly trainsAuxiliaryHead: true;
  };
  readonly materialAssistance: {
    readonly authorizes: "warning-only";
    // Frozen false: `mechanistic` and `ecological` are separate slices wherever both
    // occur and are never added together.
    readonly cohortsAggregated: false;
    // The cohort THIS project produces.
    readonly generationMode: "mechanistic";
    // The closed vocabulary the schema validates a mixture against.
    readonly generationModes: readonly GenerationMode[];
    readonly minimumAiFraction: number;
    readonly minimumWarningRecall: number;
  };
  readonly mixedBelowHalfAiRole: "diagnostic-curve-only";
  readonly multiplicity: {
    /** `familyAlpha / primaryFamilySize`, recomputed at load and never trusted. */
    readonly perHypothesisAlpha: number;
    /** The hypotheses the correction is over. Everything else is diagnostic. */
    readonly primaryFamily: readonly string[];
    readonly primaryFamilySize: number;
    readonly correction: "bonferroni";
    readonly descriptiveConfidence: number;
    readonly familyAlpha: number;
    readonly frozenAt: "G0.2";
  };
  /**
   * The ceiling on the INT8 ONNX export, in bytes. A CEILING and not a target: an
   * export smaller than this passes, and no artifact is required to approach it.
   *
   * Anchored on a measurement, with the slack declared. A real int8 export of this
   * architecture — `neuralmind/bert-base-portuguese-cased` with a 2-label
   * sequence-classification head, dynamic quantization — measures 109 681 931
   * bytes, and 130 000 000 leaves 20 318 069 bytes of headroom (18.5% of the
   * measured size). The slack exists because an exact-fit ceiling would fail a
   * legitimate re-export that differs by a few KB: opset version, per-channel
   * versus per-tensor quantization parameters, and the head's own shape all move the
   * byte count without changing which weights the artifact carries. That anchor's own
   * `opset_import` is 18 (ir_version 8, producer `onnx.quantize`), while the fallback
   * path of `benchmark/lab/export_onnx.py` emits opset 14 — the headroom covers
   * exactly that kind of difference, and the ceiling asserts nothing about the opset.
   *
   * What it still refuses, which is why it is not simply generous. The 29 794 x 768
   * embedding matrix is 22 881 792 int8 bytes and 91 527 168 in fp32, so an export
   * that leaves the embedding table unquantized measures ~1.78e8 bytes and FAILS.
   * And a RoBERTa-family encoder with a 250 002-row embedding matrix is ~2.8e8 bytes
   * int8 — more than twice this ceiling — so the number names ONE architecture
   * rather than admitting whichever one happens to get exported.
   */
  readonly onnxMaximumInt8Bytes: number;
  readonly parity: {
    readonly operationalMaximumInversions: 0;
    readonly rawMaximumMeanAbsDelta: number;
  };
  readonly policyVersion: string;
  readonly powerFloors: {
    /** Floor on RECORD-LINES: the denominator of a per-cell FPR in `test`. */
    readonly criticalFprHumanNegatives: number;
    readonly criticalRecallPositives: number;
    /**
     * Floor on INDEPENDENT SAMPLING UNITS per cell, which is connected components
     * and not rows (`preRegistration.powerInventoryUnit`). It is a DIFFERENT
     * quantity from the line floor above and the composition gate counts both: 300
     * lines inside one component is 300 lines and one unit.
     */
    readonly samplingUnits: number;
  };
  /**
   * Recall floor at the frozen threshold, over all eligible AI positives.
   *
   * FROZEN, not merely a proportion: `gates.ts` reads it as the bound of
   * `recall-at-threshold`, which is a member of the certifying family, so a value
   * inside (0,1) that is not THIS value moves a published gate.
   */
  readonly recallFloor: number;
  readonly predictiveValuePrevalences: readonly number[];
  readonly preRegistration: {
    /**
     * WHICH candidate the measurement certifies: the weights hash the F6 training
     * receipt names, bound at `fit`. The v1 certifies one hash and only that hash —
     * retraining produces a new hash and every published ceiling dies with it.
     */
    readonly eligibleCandidate: "weights-hash-from-f6-receipt";
    readonly frozenBefore: "v1-publication";
    readonly partitionFractions: {
      readonly calA: number;
      readonly calB: number;
      readonly dev: number;
      readonly test: number;
      readonly train: number;
    };
    /**
     * ONE. Note that `blindReserveCompleteAttempts` above is still 2: it sizes the
     * reserve, and the divergence between the reserve sizing and the declared
     * objective is recorded rather than silently resolved.
     */
    readonly plannedCertifyingMeasurements: 1;
    readonly powerInventoryUnit: typeof FROZEN_INDEPENDENT_UNIT;
    /**
     * 95 % one-sided, FAMILY-WISE over the four primary hypotheses of ONE version.
     *
     * The two families are different and both are declared. WITHIN a version the
     * four certifying hypotheses are corrected by Bonferroni, so the 95 % is
     * family-wise and the per-hypothesis level is 1 - 0.05/4. ACROSS versions there
     * is no adjustment at all — see {@link crossVersionAdjustment} — which is the
     * concession Regime 2 makes: each release certifies only its own versioned
     * hypothesis, and the claim of error control over the product's history is
     * expressly abandoned.
     */
    readonly primaryAnalysis: "one-sided-95-familywise-within-version";
    /**
     * Regime 2, as data: no multiplicity adjustment ACROSS versions or attempts.
     *
     * What buys this is publication, not silence — every certifying execution is
     * published, pass or fail, so a reader sees the whole sequence and judges the
     * history themselves. `alpha` is a bound on ONE version's decision; it was never
     * a bound over K of them, and K is not knowable in advance anyway.
     */
    readonly crossVersionAdjustment: "none";
    /** Regime 2: no adaptation to public feedback between versions. */
    readonly publicFeedbackAdaptation: "none";
    readonly quotaAxis: {
      readonly axis: "cell";
      readonly cells: readonly string[];
      /**
       * ONE cell over ONE surviving snapshot, so there is nothing left to pool and
       * this flag has no comparison to make TODAY. It stays frozen at `true` because
       * it is the rule a second cell would arrive under: cells enter the frame only
       * when they are comparable registers, and a release that pooled two of them
       * would publish one rate over two populations whose resolution the frame paid
       * for. A flag that leaves when the situation it governs is vacuous is a
       * decision a later amendment gets to make silently.
       */
      readonly poolingIsResolutionLoss: true;
    };
    /**
     * The ceiling a cell with ZERO false positives publishes, at TWO values of `n`,
     * because the two answer different questions and publishing only one of them is
     * how a reader ends up with the wrong number.
     *
     *   * `adoptedFloorPerCell` / `ceilingAtAdoptedFloor` — the REFUSAL criterion. The
     *     floor is what the composition gate enforces before sealing, so this ceiling
     *     is the worst one the release can publish and still be sealed at all.
     *   * `blindBlockLinesAtCollectionTarget` / `ceilingAtCollectionTarget` — the
     *     EXPECTATION. The collection aims at `collection.humanLinesPerCellTarget`,
     *     of which `partitionFractions.test` lands in the blind block, and that is
     *     the `n` the model card is expected to print. It is an expectation and not a
     *     promise: what the corpus actually holds is measured at sealing time.
     *
     * Both are recomputed from the formula at load, and the line count is recomputed
     * from the target and the test fraction, so no third value can drift in.
     */
    readonly zeroEventCeiling: {
      readonly adoptedFloorPerCell: number;
      readonly blindBlockLinesAtCollectionTarget: number;
      readonly ceilingAtAdoptedFloor: number;
      readonly ceilingAtCollectionTarget: number;
      readonly formula: "1 - perHypothesisAlpha^(1/n)";
      readonly unitsBelowFloorFailBeforeSealing: true;
    };
  };
  readonly productTarget: "textual-compatibility-with-ai-generation";
  readonly profileBands: readonly string[];
  readonly profileValidityDays: number;
  readonly resampling: {
    readonly allowedUnitKinds: readonly ResamplingUnitKind[];
    // The four rows of the frozen estimand table. They are CLASSES, not gate ids:
    // the unit of resampling is a property of what is being estimated, so every gate
    // over the same estimand shares one row.
    readonly estimandClasses: {
      readonly [C in ResamplingEstimandClass]: ResamplingClassRow;
    };
    // The estimands of `estimands` whose row does NOT name them, and why the row is
    // being stretched. Empty for every estimand the table covers on its own.
    readonly estimandExtensions: Readonly<
      Record<string, ResamplingEstimandExtension>
    >;
    // Published estimand name -> the class whose unit it inherits.
    readonly estimands: Readonly<Record<string, ResamplingEstimandClass>>;
    readonly fallbackToIndependentRows: false;
    readonly publishedBound: PublishedBoundRule;
    readonly required: true;
  };
  readonly rollout: {
    readonly actionsPromoted: false;
    readonly maximumStage: "indicator";
    readonly stages: readonly string[];
  };
  readonly runtimeComparator: "score-ge-next-up-quantile";
  readonly seeds: {
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
  /**
   * The ONE provisional threshold the v1 freezes, and what it is a quantile of.
   *
   * `probabilisticCalibrator: "none"` is the decision, not an omission: the v1 fits
   * no calibrator, runs no candidate competition and publishes no probability. The
   * cut is a one-sided quantile of the raw document score over the HUMAN NEGATIVES
   * of `dev` and `cal-A`, and `quantile` is checked at load against
   * `1 - fprBudgets.warning` — the budget IS the tail the quantile leaves.
   */
  readonly threshold: {
    readonly basis: ScoreBasis;
    readonly population: "human-negatives";
    readonly probabilisticCalibrator: "none";
    readonly quantile: number;
    readonly quantilePartitions: readonly string[];
    readonly side: "upper";
    readonly version: string;
  };
  readonly training: {
    readonly batchDocuments: number;
    readonly epochs: number;
    readonly learningRate: number;
    readonly optimizer: "adamw";
    readonly warmupFraction: number;
    readonly weightDecay: number;
  };
  /**
   * Core strata this corpus has no source for. Subset of `humanCoreStrata`, checked
   * at load. EMPTY here, and the empty list is a value the parser accepts rather
   * than a missing key: every cell of the frame has a declared snapshot.
   */
  readonly uncoveredCoreStrata: readonly string[];
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
    throw new PreregistrationV4Error(path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(at(path, key), "must be a finite number");
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
    throw new PreregistrationV4Error(
      at(path, key),
      `must be an integer >= ${minimum}`,
    );
  }
  return value;
}

// A rate, budget, epsilon or alpha: strictly above 0 and at most 1. Zero is
// rejected on purpose — a budget of exactly 0 is not a frozen decision anywhere in
// this pre-registration, and reading one would mean a mis-transcription.
function proportion(
  record: Record<string, unknown>,
  path: string,
  key: string,
): number {
  const value = number(record, path, key);
  if (value <= 0 || value > 1) {
    throw new PreregistrationV4Error(at(path, key), "must be in (0, 1]");
  }
  return value;
}

function text(
  record: Record<string, unknown>,
  path: string,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PreregistrationV4Error(
      at(path, key),
      "must be a non-empty string",
    );
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
    throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(
      at(path, key),
      `is frozen at ${frozen} and cannot be changed here`,
    );
  }
  return frozen;
}

// A non-empty list of distinct non-empty strings. Duplicates are rejected because a
// repeated stratum or family silently changes a denominator.
function textList(
  record: Record<string, unknown>,
  path: string,
  key: string,
  allowed?: readonly string[],
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new PreregistrationV4Error(
      at(path, key),
      "must be a non-empty array",
    );
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new PreregistrationV4Error(
        at(path, key),
        "must hold non-empty strings",
      );
    }
    if (seen.has(entry)) {
      throw new PreregistrationV4Error(
        at(path, key),
        `repeats the entry ${JSON.stringify(entry)}`,
      );
    }
    if (allowed !== undefined && !allowed.includes(entry)) {
      throw new PreregistrationV4Error(
        at(path, key),
        `must hold only ${allowed.join(", ")}`,
      );
    }
    seen.add(entry);
  }
  return Object.freeze([...(value as string[])]);
}

// A list whose exact CONTENT AND ORDER are frozen, the list counterpart of
// `literal` and `frozenNumber`. The order is part of the decision for some rows and
// for the rest the membership is: dropping a core stratum, a quota cell or a
// hard-negative family silently narrows what the evaluation covers.
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
    throw new PreregistrationV4Error(
      at(path, key),
      `is frozen at ${JSON.stringify(frozen)} (exact content and order) and ` +
        "cannot be changed here",
    );
  }
  return Object.freeze([...frozen]);
}

/**
 * The snapshots refused by name, with the reason and the condition that lifts it.
 *
 * A blocked snapshot may NOT also be a stocked one. That check is the whole reason
 * this is a function and not a `frozenList`: a policy that names the same base in
 * both lists says the source is simultaneously refused and in use, and whichever
 * list a given consumer happens to read decides the answer.
 */
function blockedSnapshots(
  humanSources: Record<string, unknown>,
  stocked: readonly string[],
): readonly {
  readonly blockedBy: "access-terms-unresolved";
  readonly snapshot: string;
  readonly unblockRequires: string;
}[] {
  const path = "humanSources.blockedSnapshots";
  const value = humanSources.blockedSnapshots;
  if (!Array.isArray(value)) {
    throw new PreregistrationV4Error(path, "must be an array");
  }
  const seen = new Set<string>();
  const rows = value.map((entry, index) => {
    const rowPath = `${path}[${index}]`;
    const row = object(entry, rowPath, [
      "blockedBy",
      "snapshot",
      "unblockRequires",
    ]);
    const snapshot = text(row, rowPath, "snapshot");
    if (stocked.includes(snapshot)) {
      throw new PreregistrationV4Error(
        rowPath,
        `blocks "${snapshot}", which humanSources.snapshots still stocks: a source cannot be both refused and in use`,
      );
    }
    if (seen.has(snapshot)) {
      throw new PreregistrationV4Error(
        rowPath,
        `repeats the snapshot "${snapshot}"`,
      );
    }
    seen.add(snapshot);
    return Object.freeze({
      blockedBy: literal(row, rowPath, "blockedBy", "access-terms-unresolved"),
      snapshot,
      unblockRequires: text(row, rowPath, "unblockRequires"),
    });
  });
  if (!seen.has(FROZEN_BLOCKED_SNAPSHOT)) {
    throw new PreregistrationV4Error(
      path,
      `must still block "${FROZEN_BLOCKED_SNAPSHOT}" by name: the access terms that refuse it are unresolved, and a base that stops being named stops failing`,
    );
  }
  return Object.freeze(rows);
}

/**
 * The dataset identity, and the identifiers refused by name.
 *
 * The live id may NOT appear among the refused ones, for the same reason a blocked
 * snapshot may not also be stocked: whichever list a consumer reads would decide
 * whether the corpus is buildable.
 */
function dataset(value: unknown): PreregistrationV4["dataset"] {
  const block = object(value, "dataset", [
    "id",
    "intendedDomain",
    "refusedIds",
  ]);
  const id = literal(block, "dataset", "id", FROZEN_DATASET_ID);
  const intendedDomain = literal(
    block,
    "dataset",
    "intendedDomain",
    FROZEN_INTENDED_DOMAIN,
  );
  const raw = block.refusedIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PreregistrationV4Error(
      "dataset.refusedIds",
      "must be a non-empty array: a dead dataset id is refused by name, not deleted",
    );
  }
  const seen = new Set<string>();
  const refusedIds = raw.map((entry, index) => {
    const rowPath = `dataset.refusedIds[${index}]`;
    const row = object(entry, rowPath, ["id", "refusedBecause"]);
    const refused = text(row, rowPath, "id");
    if (refused === id) {
      throw new PreregistrationV4Error(
        rowPath,
        `refuses "${refused}", which dataset.id also declares: an identifier cannot be both live and dead`,
      );
    }
    if (seen.has(refused)) {
      throw new PreregistrationV4Error(
        rowPath,
        `repeats the identifier "${refused}"`,
      );
    }
    seen.add(refused);
    return Object.freeze({
      id: refused,
      refusedBecause: text(row, rowPath, "refusedBecause"),
    });
  });
  if (!seen.has(FROZEN_REFUSED_DATASET_ID)) {
    throw new PreregistrationV4Error(
      "dataset.refusedIds",
      `must still refuse "${FROZEN_REFUSED_DATASET_ID}" by name: a dead identifier that stops being named stops failing`,
    );
  }
  return Object.freeze({
    id,
    intendedDomain,
    refusedIds: Object.freeze(refusedIds),
  });
}

/**
 * The core strata with no source, checked to be a SUBSET of `humanCoreStrata` and
 * then pinned to the frozen value — which is the EMPTY list.
 *
 * The subset check runs first on purpose: an entry that is not a stratum at all gets
 * the subset diagnosis, and an entry that IS a stratum gets the frozen-value one.
 * Two different mistakes, two different messages.
 */
function uncoveredCoreStrata(root: Record<string, unknown>): readonly string[] {
  const path = "uncoveredCoreStrata";
  const value = root[path];
  if (!Array.isArray(value)) {
    throw new PreregistrationV4Error(
      path,
      "must be an array (empty when every core stratum has a source)",
    );
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new PreregistrationV4Error(path, "must hold non-empty strings");
    }
    if (seen.has(entry)) {
      throw new PreregistrationV4Error(
        path,
        `repeats the entry ${JSON.stringify(entry)}`,
      );
    }
    seen.add(entry);
    if (!FROZEN_HUMAN_CORE_STRATA.includes(entry as never)) {
      throw new PreregistrationV4Error(
        path,
        `names "${entry}", which is not one of the core strata`,
      );
    }
  }
  if (value.length !== FROZEN_UNCOVERED_CORE_STRATA.length) {
    throw new PreregistrationV4Error(
      path,
      `is frozen at ${JSON.stringify(FROZEN_UNCOVERED_CORE_STRATA)} (exact content and order) and cannot be changed here`,
    );
  }
  return Object.freeze([]);
}

// Floating-point slack for the derived numbers below. They are written in the JSON
// rounded to six decimals, which is how a human reads a pre-registration, so an
// exact comparison against the recomputed value would fail on the rounding and not
// on a wrong decision.
//
// 1e-6 and not 5e-7. Rounding to six decimals moves a value by at most 5e-7, so a
// tolerance OF 5e-7 is exactly the boundary: the ceiling at n = 300 is
// 0.0145005943 stored as 0.014501, which is 4.06e-7 away — already inside the
// boundary — and a future frozen n whose true value sits nearer the half-ulp would be
// rejected for how it was rounded rather than for being wrong. A gate that fails on
// presentation teaches the next author to widen it under pressure.
const DERIVED_TOLERANCE = 1e-6;

/**
 * `perHypothesisAlpha`, RECOMPUTED from `familyAlpha / primaryFamilySize` instead of
 * trusted.
 *
 * The file's own contract is that no value is written down twice, and this one
 * unavoidably is: the per-hypothesis alpha has to be readable straight from the
 * pre-registration, because a reader checking whether the published quota is honest
 * should not have to divide. So it is written AND derived, and a disagreement
 * between the two is a hard failure rather than a value that wins.
 *
 * This is the check that catches the defect an external audit found once already:
 * the family alpha stayed 0.05 while `m` moved, so the per-hypothesis alpha and the
 * ceilings computed from it silently belonged to a different family size than the
 * one the plan was claiming.
 */
function derivedAlpha(multiplicity: Record<string, unknown>): number {
  const familyAlpha = proportion(multiplicity, "multiplicity", "familyAlpha");
  const size = integer(multiplicity, "multiplicity", "primaryFamilySize", 1);
  const declared = proportion(
    multiplicity,
    "multiplicity",
    "perHypothesisAlpha",
  );
  const derived = familyAlpha / size;
  if (Math.abs(declared - derived) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(
      "multiplicity.perHypothesisAlpha",
      `is ${declared} but familyAlpha ${familyAlpha} over a family of ${size} is ${derived}: a Bonferroni alpha may not disagree with its own m`,
    );
  }
  return declared;
}

/**
 * The zero-event ceiling block, with BOTH ceilings RECOMPUTED from
 * `1 - perHypothesisAlpha^(1/n)` and the second `n` recomputed from the collection
 * target.
 *
 * A quota with no `n` is not a pre-registration, and a quota whose `n` and whose
 * ceiling were computed at different times is worse than none — it reads as
 * arithmetic and is not. The numbers in the file are the ones a model card will
 * publish, so they are checked against the formula the file itself names.
 *
 * Two points and not one, because the release publishes two different statements: the
 * ceiling at the FLOOR is what the gate will still accept, and the ceiling at the
 * COLLECTION TARGET is what the collection is sized for. Deriving only the first would
 * leave the number the model card actually prints unchecked.
 */
function zeroEventCeiling(
  block: Record<string, unknown>,
  perHypothesisAlpha: number,
  powerFloorSamplingUnits: number,
  powerFloorFprLines: number,
  humanLinesPerCellTarget: number,
  testFraction: number,
): PreregistrationV4["preRegistration"]["zeroEventCeiling"] {
  const path = "preRegistration.zeroEventCeiling";
  const adoptedFloorPerCell = frozenNumber(
    block,
    path,
    "adoptedFloorPerCell",
    FROZEN_FLOOR_PER_CELL,
  );
  if (powerFloorSamplingUnits !== adoptedFloorPerCell) {
    throw new PreregistrationV4Error(
      at(path, "adoptedFloorPerCell"),
      `is ${adoptedFloorPerCell} but powerFloors.samplingUnits is ${powerFloorSamplingUnits}: the floor per cell is one decision and may not be written twice with two values`,
    );
  }
  const declared = proportion(block, path, "ceilingAtAdoptedFloor");
  // WHICH quantity the `n` of `1 - alpha^(1/n)` is, named rather than left to the
  // reader: it is the FPR DENOMINATOR, so it is the floor on record-LINES
  // (`powerFloors.criticalFprHumanNegatives`) and NOT the floor on sampling units.
  // The two are a different quantity — 300 lines inside one component is 300 lines and
  // one unit — and they carry the same number only because all three are frozen against
  // one constant here. Reading the unit floor instead would publish a ceiling tighter
  // than its denominator supports the moment a re-derivation moved one of them, which is
  // the over-claim direction R3 forbids. No runtime cross-check, because with all three
  // pinned to `FROZEN_FLOOR_PER_CELL` no policy can make them disagree: a comparison
  // there would be a branch no input reaches, which reads as a defence and is not one.
  const derived = 1 - perHypothesisAlpha ** (1 / powerFloorFprLines);
  if (Math.abs(declared - derived) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(
      at(path, "ceilingAtAdoptedFloor"),
      `is ${declared} but 1 - ${perHypothesisAlpha}^(1/${powerFloorFprLines}) is ${derived}`,
    );
  }
  // The second point: the blind-block size the COLLECTION target implies, and the
  // ceiling at it. The line count is derived from the target and the test fraction
  // rather than written independently — a third number for the same quantity is the
  // drift this whole block exists to refuse.
  const targetLines = integer(
    block,
    path,
    "blindBlockLinesAtCollectionTarget",
    1,
  );
  const derivedTargetLines = humanLinesPerCellTarget * testFraction;
  if (Math.abs(targetLines - derivedTargetLines) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(
      at(path, "blindBlockLinesAtCollectionTarget"),
      `is ${targetLines} but ${humanLinesPerCellTarget} lines per cell at a test fraction of ${testFraction} is ${derivedTargetLines}: the blind block of the collection target is derived, never declared beside it`,
    );
  }
  const declaredAtTarget = proportion(block, path, "ceilingAtCollectionTarget");
  const derivedAtTarget = 1 - perHypothesisAlpha ** (1 / targetLines);
  if (Math.abs(declaredAtTarget - derivedAtTarget) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(
      at(path, "ceilingAtCollectionTarget"),
      `is ${declaredAtTarget} but 1 - ${perHypothesisAlpha}^(1/${targetLines}) is ${derivedAtTarget}`,
    );
  }
  // The ceiling at the target is STRICTLY tighter than the ceiling at the floor, and
  // nothing here compares them because no admissible policy can make it false: the
  // collection floor is frozen at 1500 lines, the target is refused unless it exceeds
  // the floor (`collection`), the `test` fraction is frozen, and `1 - alpha^(1/n)` is
  // strictly decreasing in `n`. The relation the ordering actually rests on is the one
  // between three separately frozen scalars — floor lines x `test` fraction = the FPR
  // denominator — and that one is pinned by test against the shipped literals, where
  // moving any of the three breaks the equality; a comparison here would be a branch no
  // input reaches.
  return Object.freeze({
    adoptedFloorPerCell,
    blindBlockLinesAtCollectionTarget: targetLines,
    ceilingAtAdoptedFloor: declared,
    ceilingAtCollectionTarget: declaredAtTarget,
    formula: literal(block, path, "formula", "1 - perHypothesisAlpha^(1/n)"),
    unitsBelowFloorFailBeforeSealing: literal(
      block,
      path,
      "unitsBelowFloorFailBeforeSealing",
      true,
    ),
  });
}

const LENGTH_BAND_KEYS = [
  "diagnosticCeilingAtExpectedLines",
  "expectedBlindBlockLines",
  "key",
  "maximumWords",
  "minimumWords",
] as const;

/**
 * The pre-registered length bands, refused unless they PARTITION the measured
 * population: they start exactly at the abstain floor, they leave no gap and no
 * overlap between neighbours, and the last one runs to infinity.
 *
 * A band table that is not a partition is worse than no table. A gap hides rows in no
 * published band; an overlap counts the same row twice, so the shares no longer sum
 * to the block and a reader adding the bands up gets a number larger than the
 * denominator; a first band below the floor names a population the measurement
 * abstains on; a bounded top band leaves the longest documents — the ones whose rate
 * is least likely to transfer — out of every published row.
 *
 * The bands may not become hypotheses: a band inside `multiplicity.primaryFamily`
 * would move `m`, and with it the per-hypothesis alpha and every ceiling derived from
 * it, so the diagnostic would silently re-price the headline. That rule is NOT checked
 * here — `primaryFamily` and the band keys are both pinned to shipped literals, so no
 * admissible policy can make them collide and a comparison would be a branch no input
 * reaches. It is pinned by test against the two literals instead, where editing either
 * one breaks it.
 */
function lengthBands(
  value: unknown,
  perHypothesisAlpha: number,
  wordFloorAbstainBelow: number,
  blindBlockLines: number,
): PreregistrationV4["lengthBands"] {
  const path = "lengthBands";
  const block = object(value, path, [
    "bands",
    "decides",
    "measuredPopulation",
    "role",
    "spendsAlpha",
  ]);
  const raw = block.bands;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PreregistrationV4Error(
      at(path, "bands"),
      "must be a non-empty array",
    );
  }
  const bands: LengthBandRow[] = raw.map((entry, index) => {
    const rowPath = `${path}.bands[${index}]`;
    const row = object(entry, rowPath, LENGTH_BAND_KEYS);
    const minimumWords = integer(row, rowPath, "minimumWords", 1);
    const last = index === raw.length - 1;
    // `null` is the top band's upper edge and only the top band's: a middle band
    // without one would swallow every band after it, and a bounded top band would
    // stop the table from covering the population.
    const maximumWords = last
      ? (literalNull(row, rowPath, "maximumWords") as null)
      : integer(row, rowPath, "maximumWords", minimumWords);
    const expectedBlindBlockLines = integer(
      row,
      rowPath,
      "expectedBlindBlockLines",
      1,
    );
    const declaredCeiling = proportion(
      row,
      rowPath,
      "diagnosticCeilingAtExpectedLines",
    );
    const derivedCeiling =
      1 - perHypothesisAlpha ** (1 / expectedBlindBlockLines);
    if (Math.abs(declaredCeiling - derivedCeiling) > DERIVED_TOLERANCE) {
      throw new PreregistrationV4Error(
        at(rowPath, "diagnosticCeilingAtExpectedLines"),
        `is ${declaredCeiling} but 1 - ${perHypothesisAlpha}^(1/${expectedBlindBlockLines}) is ${derivedCeiling}`,
      );
    }
    return Object.freeze({
      key: text(row, rowPath, "key"),
      minimumWords,
      maximumWords,
      expectedBlindBlockLines,
      diagnosticCeilingAtExpectedLines: declaredCeiling,
    });
  });

  const keys = bands.map((band) => band.key);
  const sameKeys =
    keys.length === FROZEN_LENGTH_BAND_KEYS.length &&
    keys.every((key, index) => key === FROZEN_LENGTH_BAND_KEYS[index]);
  if (!sameKeys) {
    throw new PreregistrationV4Error(
      at(path, "bands"),
      `names ${JSON.stringify(keys)} but the bands are frozen at ${JSON.stringify(FROZEN_LENGTH_BAND_KEYS)} (exact content and order)`,
    );
  }
  if (bands[0].minimumWords !== wordFloorAbstainBelow) {
    throw new PreregistrationV4Error(
      `${path}.bands[0].minimumWords`,
      `is ${bands[0].minimumWords} but wordFloor.abstainBelow is ${wordFloorAbstainBelow}: the first band starts exactly at the abstain floor, because a band below it names a population the measurement abstains on and a band above it leaves the shortest measured rows in no band`,
    );
  }
  for (let index = 1; index < bands.length; index += 1) {
    const previous = bands[index - 1];
    const expected = (previous.maximumWords as number) + 1;
    if (bands[index].minimumWords !== expected) {
      throw new PreregistrationV4Error(
        `${path}.bands[${index}].minimumWords`,
        `is ${bands[index].minimumWords} but the band before it ends at ${previous.maximumWords}, so it must be ${expected}: the bands partition the population and may neither overlap nor leave a gap`,
      );
    }
  }
  const declaredLines = bands.reduce(
    (total, band) => total + band.expectedBlindBlockLines,
    0,
  );
  if (declaredLines !== blindBlockLines) {
    throw new PreregistrationV4Error(
      at(path, "bands"),
      `expects ${declaredLines} blind-block lines across the bands but preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget is ${blindBlockLines}: the shares of a partition sum to the block`,
    );
  }
  return Object.freeze({
    bands: Object.freeze(bands),
    decides: literal(block, path, "decides", false),
    measuredPopulation: text(block, path, "measuredPopulation"),
    role: literal(block, path, "role", "diagnostic"),
    spendsAlpha: literal(block, path, "spendsAlpha", false),
  });
}

/** The top band's `maximumWords`: absent bound written as `null`, never omitted. */
function literalNull(
  record: Record<string, unknown>,
  path: string,
  key: string,
): null {
  if (record[key] !== null) {
    throw new PreregistrationV4Error(
      at(path, key),
      "must be null on the last band: the top band runs to infinity",
    );
  }
  return null;
}

/**
 * The five partition fractions, pinned to their exact values AND refused unless they
 * sum to one.
 *
 * A sum check alone accepts any permutation, so a policy with `test: 0.05` would
 * load clean and publish a quota computed for a test partition four times its real
 * size. The sum check stays, because it is what catches a fifth fraction being
 * edited without the others.
 */
function partitionFractions(
  block: Record<string, unknown>,
): PreregistrationV4["preRegistration"]["partitionFractions"] {
  const path = "preRegistration.partitionFractions";
  const fractions = {
    calA: frozenNumber(block, path, "calA", 0.1),
    calB: frozenNumber(block, path, "calB", 0.2),
    dev: frozenNumber(block, path, "dev", 0.05),
    test: frozenNumber(block, path, "test", 0.2),
    train: frozenNumber(block, path, "train", 0.45),
  };
  const total = Object.values(fractions).reduce((sum, part) => sum + part, 0);
  if (Math.abs(total - 1) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(path, `sums to ${total}, not 1`);
  }
  return fractions;
}

/**
 * The human-line total a collection of `quotaCells` cells at `perCellTarget` lines each
 * comes to.
 *
 * The quota is PER CELL because the claim is per cell: a line collected in one cell does
 * not stand in for a line missing from another, so the total is the per-cell target
 * summed over the cells and never the per-cell target itself. Exported because with one
 * declared cell the two coincide, and a derivation whose only exercised input makes it
 * an identity is a derivation no policy can disagree with — the factor is pinned by
 * test at more than one cell instead.
 */
export function derivedHumanLinesTotal(
  perCellTarget: number,
  quotaCells: number,
): number {
  return perCellTarget * quotaCells;
}

/**
 * The collection targets, with the total DERIVED from the per-cell TARGET and the
 * number of quota cells.
 *
 * Two per-cell numbers, and which one the total rests on is the whole decision. The
 * FLOOR is what the composition gate reads on `test`; the TARGET is what the
 * collection aims at, and it is strictly above the floor because the per-cell count in
 * `test` is a random draw. The corpus is sealed against the total for exact equality,
 * so a total derived from the FLOOR would refuse every corpus that carries the margin
 * — legislating away the very slack the target exists to create.
 */
function collection(
  value: unknown,
  cells: number,
): PreregistrationV4["collection"] {
  const path = "collection";
  const block = object(value, path, [
    "humanLinesPerCellMinimum",
    "humanLinesPerCellTarget",
    "humanLinesTotal",
    "maximumLinesPerOriginDocument",
  ]);
  const minimum = frozenNumber(
    block,
    path,
    "humanLinesPerCellMinimum",
    FROZEN_HUMAN_LINES_PER_CELL_MINIMUM,
  );
  const target = integer(block, path, "humanLinesPerCellTarget", 1);
  if (target <= minimum) {
    throw new PreregistrationV4Error(
      at(path, "humanLinesPerCellTarget"),
      `is ${target}, at or below the per-cell floor of ${minimum}: the per-cell count in the blind block is a random draw with a standard deviation of roughly 15 lines at these sizes, so a target that does not exceed the floor fails the composition gate on sampling noise alone`,
    );
  }
  const total = integer(block, path, "humanLinesTotal", 1);
  const derivedTotal = derivedHumanLinesTotal(target, cells);
  if (total !== derivedTotal) {
    throw new PreregistrationV4Error(
      at(path, "humanLinesTotal"),
      `is ${total} but ${cells} quota cells at the TARGET of ${target} lines each is ${derivedTotal}; the total the corpus is sealed against is the target, not the floor of ${minimum} — sealing at the floor would refuse the very margin the target exists to create`,
    );
  }
  return Object.freeze({
    humanLinesPerCellMinimum: minimum,
    humanLinesPerCellTarget: target,
    humanLinesTotal: total,
    maximumLinesPerOriginDocument: frozenNumber(
      block,
      path,
      "maximumLinesPerOriginDocument",
      1,
    ),
  });
}

/**
 * The connectivity block. `splitUnionAxes` is pinned by content AND order because it
 * mirrors `GROUP_KEYS`, and the dependency axis is refused inside it: the whole
 * decision is that the axis carrying dependence between acquisitions is NOT a union
 * axis, and a policy that unions on it anyway would say both things at once.
 */
function connectivity(value: unknown): PreregistrationV4["connectivity"] {
  const path = "connectivity";
  const block = object(value, path, [
    "dependencyAxis",
    "diagnosticAxes",
    "independentUnit",
    "reportedAxes",
    "splitUnionAxes",
    "splitUnionsOnDependencyAxis",
  ]);
  const dependencyAxis = literal(
    block,
    path,
    "dependencyAxis",
    "sourceMaterialBatch",
  );
  const splitUnionAxes = frozenList(
    block,
    path,
    "splitUnionAxes",
    FROZEN_SPLIT_UNION_AXES,
  );
  if (splitUnionAxes.includes(dependencyAxis)) {
    throw new PreregistrationV4Error(
      at(path, "splitUnionAxes"),
      `names the dependency axis "${dependencyAxis}", which splitUnionsOnDependencyAxis refuses`,
    );
  }
  const diagnosticAxes = frozenList(
    block,
    path,
    "diagnosticAxes",
    FROZEN_DIAGNOSTIC_AXES,
  );
  for (const axis of diagnosticAxes) {
    if (splitUnionAxes.includes(axis)) {
      throw new PreregistrationV4Error(
        at(path, "diagnosticAxes"),
        `names "${axis}", which splitUnionAxes also unions on: an axis cannot be diagnostic and a unit at once`,
      );
    }
  }
  return Object.freeze({
    dependencyAxis,
    diagnosticAxes,
    independentUnit: literal(
      block,
      path,
      "independentUnit",
      FROZEN_INDEPENDENT_UNIT,
    ),
    reportedAxes: frozenList(block, path, "reportedAxes", FROZEN_REPORTED_AXES),
    splitUnionAxes,
    splitUnionsOnDependencyAxis: literal(
      block,
      path,
      "splitUnionsOnDependencyAxis",
      false,
    ),
  });
}

/**
 * The provisional threshold block, with `quantile` DERIVED from the FPR budget.
 *
 * The budget IS the tail the one-sided quantile leaves above the cut, so a policy
 * whose quantile and budget disagree freezes a threshold aimed at a false-positive
 * rate it does not publish.
 */
function threshold(
  value: unknown,
  warningFprBudget: number,
): PreregistrationV4["threshold"] {
  const path = "threshold";
  const block = object(value, path, [
    "basis",
    "population",
    "probabilisticCalibrator",
    "quantile",
    "quantilePartitions",
    "side",
    "version",
  ]);
  const declared = proportion(block, path, "quantile");
  const derived = 1 - warningFprBudget;
  if (Math.abs(declared - derived) > DERIVED_TOLERANCE) {
    throw new PreregistrationV4Error(
      at(path, "quantile"),
      `is ${declared} but 1 - fprBudgets.warning ${warningFprBudget} is ${derived}: the budget is the tail the quantile leaves`,
    );
  }
  return Object.freeze({
    basis: literal(block, path, "basis", "document-raw-score"),
    population: literal(block, path, "population", "human-negatives"),
    probabilisticCalibrator: literal(
      block,
      path,
      "probabilisticCalibrator",
      "none",
    ),
    quantile: declared,
    quantilePartitions: frozenList(
      block,
      path,
      "quantilePartitions",
      FROZEN_THRESHOLD_PARTITIONS,
    ),
    side: literal(block, path, "side", "upper"),
    version: text(block, path, "version"),
  });
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
    throw new PreregistrationV4Error(
      at(path, key),
      "must be a non-empty array",
    );
  }
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry) || !check(entry)) {
      throw new PreregistrationV4Error(at(path, key), detail);
    }
    if (seen.has(entry)) {
      throw new PreregistrationV4Error(
        at(path, key),
        `repeats the entry ${entry}`,
      );
    }
    seen.add(entry);
  }
  return Object.freeze([...(value as number[])]);
}

// The rows whose exact content AND order are the decision. Repeating them here is
// not duplication of the JSON: it is what makes the JSON checkable, the same way
// `literal` repeats a frozen scalar.
// The recall floor is the bound of `recall-at-threshold`, one of the four members of
// the certifying family, so it is a DECISION and not a magnitude: 0.55 is inside the
// (0,1) a proportion check admits and would move a gate the family publishes.
const FROZEN_RECALL_FLOOR = 0.6;
const FROZEN_DATASET_ID = "cleanfeed-ptbr-cells-v1";
const FROZEN_INTENDED_DOMAIN = "scoped-cells";
const FROZEN_REFUSED_DATASET_ID = "ptbr-generic-v1";
const FROZEN_CALIBRATOR_CANDIDATES = ["platt", "beta", "isotonic"] as const;
const FROZEN_CALIBRATOR_TIE_BREAK = ["platt", "beta", "isotonic"] as const;
// The ONE cell of the declared frame, and the ONE string that reaches a record's
// `humanSourceType`.
//
// There used to be two spellings of this list — register words in `humanCoreStrata`
// (`encyclopedic`, `judicial`, ...) and cell ids in `preRegistration.quotaAxis.cells`
// (`ptwiki`, `carolina-judicial`, ...) — and neither side measured the other, so the
// lab wrote one vocabulary while every gate read the other and counted zero lines in
// every cell. The two are now ONE constant, and the surviving spelling is the CELL id
// because three authorities already read it: the slice value of `CELL_FPR_AXIS`
// (benchmark/gates.ts), this `cells` list, and the `fpr-<cell>` suffix of
// `multiplicity.primaryFamily`. `humanCoreStrata` had no gate consumer at all, so it
// is the side that yields.
//
// Shared by both fields rather than cross-checked at runtime: with one constant behind
// both `frozenList` calls no policy can make them disagree, and a comparison no input
// can fail reads as a defence without being one.
const FROZEN_QUOTA_AXIS_CELLS = ["ptwiki"] as const;
const FROZEN_HUMAN_CORE_STRATA = FROZEN_QUOTA_AXIS_CELLS;
// EMPTY: the one core stratum of this frame has a declared snapshot. The list stays a
// field rather than being deleted, because a future frame that loses a source has to
// be able to say so instead of shrinking its own vocabulary.
//
// The three Carolina typologies are NOT here, and the parser is what settles that:
// this list is checked to be a SUBSET of `humanCoreStrata`, so it can only name a
// stratum the frame still declares. "Declared cell whose material is missing" and
// "population the frame does not draw on" are different facts with different remedies
// — the first is a collection problem, the second is an amendment — and the second
// lives in `OUT_OF_FRAME_HUMAN_SOURCES` / `OUT_OF_FRAME_TYPOLOGIES`.
const FROZEN_UNCOVERED_CORE_STRATA: readonly string[] = [];
// The four hypotheses that carry a certifying claim, and therefore the four the
// Bonferroni correction is over: one FPR ceiling per quota cell, recall at the
// frozen threshold, the global calibration statistic and integrity. Everything else
// the evaluation publishes is a non-certifying diagnostic, published without
// adjustment and labelled as such.
//
// `m` is the whole point of this list existing: with alpha_family = 0.05 the
// per-hypothesis alpha and the zero-event ceiling move with the family size, so
// naming the members is what fixes the denominator. Per-cell rather than
// worst-stratum, because a worst-stratum headline punishes coverage — adding a cell
// can only lower it — while a table of cells lets a later release add a row without
// degrading the rows already published.
//
// Narrowing the frame from four cells to one TIGHTENED the published ceiling instead
// of loosening it, which is worth stating because it reads backwards: `m` fell from 7
// to 4, so the per-hypothesis alpha rose from 0.05/7 to 0.05/4, and the whole
// collection budget now lands in one cell (4 000 lines instead of 1 750), so the `n`
// of the ceiling grew while its alpha grew too.
const FROZEN_PRIMARY_FAMILY = [
  "calibration-global",
  "fpr-ptwiki",
  "integrity",
  "recall-at-threshold",
] as const;
const FROZEN_HARD_NEGATIVE_FAMILIES = [
  "corporate-structure",
  "formulaic",
  "highly-polished",
  "motivational",
  "non-native",
  "repetitive",
] as const;
// The RUNTIME calibration profile bands, which are a different table from
// `lengthBands` and stay separate: these name the profiles the served bundle carries
// (contracts/calibration-profile.ts, `LengthBucketV1`), and the v1 freezes no
// per-band threshold at all. `FROZEN_LENGTH_BAND_KEYS` names the bands the FPR
// DIAGNOSTIC is published over.
const FROZEN_PROFILE_BANDS = ["50-79", "80-199", "200-plus"] as const;
// The four bands the FPR diagnostic is published over, content AND order.
//
// The edges are ROUND — 50, 80, 150, 300 — and not the measured percentiles of the
// population (p25 = 72, p50 = 120, p75 = 221 over 25 036 admissible lead sections of
// the ptwiki dump). Quartile edges would buy near-equal `n` per band (≈200 each,
// ceiling ≈2.2 % each) at the price of edges that are a function of one 60 000-page
// sample: draw the sample again and p25 moves, so the band definition would be a
// measured quantity rather than a decision, and no reader could restate it. Round
// edges cost the top band its power — it holds ~15 % of the population — and that
// cost is DECLARED per band instead of hidden in an average.
//
// 100 is deliberately NOT an edge, unlike the unregistered buckets these replace:
// [80, 99] holds 11.25 % of the population, so at the collection target it would be
// a band of 90 lines whose diagnostic ceiling is 4.75 % — a published band with less
// power than the widest one here.
const FROZEN_LENGTH_BAND_KEYS = [
  "50_79",
  "80_149",
  "150_299",
  "300_PLUS",
] as const;
// ONE snapshot. `b2w-reviews01` and `carolina` are not in the frame — product review
// and the three single-institution Carolina typologies are outside the declared cell —
// and `pt-stackoverflow` is refused BY NAME in `blockedSnapshots` rather than deleted,
// with the condition that would lift it. The two kinds of exit are not the same: a
// blocked snapshot could come back on a legal disposition, an out-of-frame one only on
// an amendment that names the cell it would add, and `OUT_OF_FRAME_HUMAN_SOURCES`
// (benchmark/source-manifest.ts) is where the second kind stays named.
const FROZEN_HUMAN_SNAPSHOTS = ["ptwiki"] as const;
const FROZEN_ROLLOUT_STAGES = [
  "bundle-verified",
  "shadow",
  "indicator",
] as const;
// Content AND order: `mechanistic` first because it is the cohort this project
// produces and the one the material-assistance target is defined over. Dropping
// `ecological` would let a future observed-process sample be pooled into the
// mechanistic cohort by omission.
const FROZEN_GENERATION_MODES = ["mechanistic", "ecological"] as const;
// The mirror of `GROUP_KEYS` in benchmark/split.ts, held by test rather than by
// import (the splitter reads this file).
const FROZEN_SPLIT_UNION_AXES = [
  "author",
  "source",
  "promptTemplate",
  "generationBatch",
  "nearDuplicate",
  "derivationRoot",
] as const;
const FROZEN_DIAGNOSTIC_AXES = ["extractionRun"] as const;
// The unit of independence, behind BOTH fields that name it: `connectivity.independentUnit`
// (the unit the connectivity block declares and the release publishes) and
// `preRegistration.powerInventoryUnit` (the unit the power inventory is COUNTED in, cited by
// name as the floor's quantity at benchmark/composition-gate.ts). Two different subjects, one
// value, and the coincidence is the point of the floor: the floor is counted in the unit
// independence is claimed over.
//
// Shared by both `literal` calls rather than compared afterwards, and both interface fields
// are typed `typeof` this constant: no policy can make them disagree and no runtime check is
// needed, for the reason `FROZEN_HUMAN_CORE_STRATA` states: a comparison no input can fail
// reads as a defence without being one.
//
// RESIDUE: a later frame that wanted the power inventory counted in a COARSER unit than
// independence is claimed over would have to SPLIT this constant, and splitting it is a
// decision the partition forces someone to write down rather than drift into.
//
// The unit is NOT one per origin document: the component closes over all six of
// `GROUP_KEYS` — `author`, `promptTemplate`,
// `generationBatch`, `nearDuplicate` and `derivationRoot` as well as `source` — so naming the
// unit after one of them would invite reading it as ONE PER DOCUMENT, which over-states power
// in the direction benchmark/composition-gate.ts refuses in writing. Origin documents are a
// THIRD quantity and not this unit: the gate publishes both, and they diverge — measured at
// "reads a component that spans two partitions as ONE unit inside the blind block" in
// benchmark/tests/composition-gate.test.ts, where `independentUnits` is 1 against
// `originDocuments` 2.
const FROZEN_INDEPENDENT_UNIT = "connected-components" as const;
// The mirror of `REPORTED_GROUP_AXES` in benchmark/split-audit.ts: the MATERIAL pair,
// then the APPARATUS axis. Every entry must be absent from `FROZEN_SPLIT_UNION_AXES` — an
// axis published with `connectivity.sharedValue: false` that the splitter grouped by
// would be a false independence claim in the sealed artifact — and a test holds the
// disjointness against the splitter's own list, plus the EQUALITY against
// `REPORTED_GROUP_AXES` itself.
const FROZEN_REPORTED_AXES = [
  "domainSource",
  "sourceMaterialBatch",
  "generatorVersion",
] as const;
const FROZEN_THRESHOLD_PARTITIONS = ["dev", "cal-A"] as const;
// Refused BY NAME rather than deleted: the 2024 access terms of the Stack Exchange
// dump exclude LLM-training projects, and that is a legal condition that could be
// satisfied — unlike B2W, whose base is simply outside the frame.
const FROZEN_BLOCKED_SNAPSHOT = "pt-stackoverflow";
const FROZEN_FLOOR_PER_CELL = 300;
const FROZEN_HUMAN_LINES_PER_CELL_MINIMUM = 1500;
// The base encoder, and the export ceiling that belongs to it. The two are ONE
// decision and are frozen next to each other because the ceiling is architecture
// specific: a policy that named this backbone with a ceiling sized for a
// 250 002-row embedding matrix would admit an artifact whose weights nobody
// measured, and the export gate would pass it.
//
// The ceiling is a `frozenNumber` and not a positive integer: a magnitude the parser
// admits by shape is a magnitude any value can occupy, and this one decides whether
// the Phase 4 export is publishable at all.
const FROZEN_BACKBONE = "neuralmind/bert-base-portuguese-cased";
const FROZEN_ONNX_MAXIMUM_INT8_BYTES = 130_000_000;

// The lane names, frozen as a SET (the JSON block is keyed by them, and object key
// order is not a decision the way a list's is). Four lanes: one API and three CLIs,
// which is exactly the confounding the row exists to expose.
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
    throw new PreregistrationV4Error(at(path, key), "must be a boolean");
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
    throw new PreregistrationV4Error(
      at(path, key),
      `must be one of ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

// One lane row. The cross-field rule is the point of the row and not shape hygiene:
// a scale and its levels stand or fall together, because a level list with no scale
// is a shared ordinal by another name, and a scale with no levels admits any string.
//
// `not-supported` DOES sit beside another source, deliberately: on `agy` the effort
// either IS the model id (`gemini-3.5-flash-medium`) or does not exist at all, since
// `--effort` is refused on `claude-sonnet-4-6` and on `claude-opus-4-6-thinking`. So
// one lane legitimately produces records under both sources, and it is the RECORD
// that must say which one applies to it.
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
    throw new PreregistrationV4Error(
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

// The empty list is a legitimate value ONLY here: a lane with no effort scale has no
// levels. `textList` refuses an empty array everywhere else on purpose, so this is a
// separate function rather than a flag on it.
function emptyStringList(
  record: Record<string, unknown>,
  path: string,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== 0) {
    throw new PreregistrationV4Error(
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
      throw new PreregistrationV4Error(
        `generationLanes.${lane}`,
        "is missing: the lane vocabulary is frozen and every lane needs a row",
      );
    }
    rows[lane] = laneRow(block[lane], `generationLanes.${lane}`);
  }
  // A harness lane whose decoding is configurable, or an API lane whose decoding is
  // not, would contradict the measurement the row records.
  for (const lane of FROZEN_GENERATION_LANES) {
    const row = rows[lane];
    if (laneRunsHarness(row) && row.decodingConfigurable) {
      throw new PreregistrationV4Error(
        `generationLanes.${lane}.decodingConfigurable`,
        "must be false on a lane that runs a harness: a CLI accepts no temperature or top_p",
      );
    }
    if (row.effortConfigurable && !row.effortSources.includes("flag")) {
      throw new PreregistrationV4Error(
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
  "collection",
  "commercialUse",
  "conformal",
  "connectivity",
  "dataset",
  "fprBudgets",
  "generationLanes",
  "hardNegativeFamilies",
  "humanCoreStrata",
  "humanSources",
  "infersAuthorship",
  "integralPositive",
  "labelBasis",
  "lengthBands",
  "localization",
  "materialAssistance",
  "mixedBelowHalfAiRole",
  "multiplicity",
  "onnxMaximumInt8Bytes",
  "parity",
  "policyVersion",
  "powerFloors",
  "preRegistration",
  "predictiveValuePrevalences",
  "productTarget",
  "profileBands",
  "profileValidityDays",
  "recallFloor",
  "resampling",
  "rollout",
  "runtimeComparator",
  "seeds",
  "shareAlikeRequired",
  "temporalCohort",
  "threshold",
  "training",
  "uncoveredCoreStrata",
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
const RESAMPLING_EXTENSION_KEYS = ["reason", "standsInFor"] as const;
// A resampling axis names a grouping axis of the record schema. The prefix is
// required so a level can never be confused with a synthetic per-row key, which is
// the one thing R6 forbids outright.
const RESAMPLING_AXIS_PATTERN = /^groups\.[A-Za-z][A-Za-z0-9]*$/u;

function resamplingAxis(value: unknown, path: string): string {
  if (typeof value !== "string" || !RESAMPLING_AXIS_PATTERN.test(value)) {
    throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(at(path, "fallbacks"), "must be an array");
  }
  const seen = new Set<string>([axis]);
  const fallbacks = raw.map((entry, index) => {
    const next = resamplingAxis(entry, `${at(path, "fallbacks")}[${index}]`);
    if (seen.has(next)) {
      throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(
      at(path, "levels"),
      "must be a non-empty array of levels",
    );
  }
  const levels = raw.map((entry, index) =>
    resamplingLevel(entry, `${at(path, "levels")}[${index}]`),
  );
  // The cross-field rule that IS the decision: crossing needs two factors. A
  // one-factor "multiway" design is a one-level hierarchical design wearing the
  // wrong name, and it would be read as evidence that the crossed pair of the frozen
  // table was honoured.
  if (unitKind === "multiway" && levels.length < 2) {
    throw new PreregistrationV4Error(
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
    throw new PreregistrationV4Error(
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
      throw new PreregistrationV4Error(
        `resampling.estimands.${estimand}`,
        `must be one of ${FROZEN_RESAMPLING_CLASSES.join(", ")}`,
      );
    }
    mapped[estimand] = declared as ResamplingEstimandClass;
  }
  return Object.freeze(mapped);
}

// The declared stretches of a row, cross-checked against the mapping they stretch.
// Both fields are mandatory together, and an extension of an estimand that has no
// row at all is refused: it would read as a covered estimand while nothing maps it.
function resamplingEstimandExtensions(
  value: unknown,
  estimands: Readonly<Record<string, ResamplingEstimandClass>>,
): Readonly<Record<string, ResamplingEstimandExtension>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PreregistrationV4Error(
      "resampling.estimandExtensions",
      "must be an object mapping estimand names to a declared extension " +
        "(empty when the frozen table covers every estimand on its own)",
    );
  }
  const block = value as Record<string, unknown>;
  const mapped: Record<string, ResamplingEstimandExtension> = {};
  for (const estimand of Object.keys(block)) {
    const path = `resampling.estimandExtensions.${estimand}`;
    if (!Object.hasOwn(estimands, estimand)) {
      throw new PreregistrationV4Error(
        path,
        "declares an extension for an estimand that resampling.estimands does " +
          "not map to any row of the frozen table",
      );
    }
    const row = object(block[estimand], path, RESAMPLING_EXTENSION_KEYS);
    mapped[estimand] = Object.freeze({
      standsInFor: text(row, path, "standsInFor"),
      reason: text(row, path, "reason"),
    });
  }
  return Object.freeze(mapped);
}

/**
 * Validates an already-parsed JSON value against the frozen contract and returns a
 * deeply frozen policy. Throws `PreregistrationV4Error` naming the offending path on
 * the first problem; it never coerces and never fills a value in.
 */
export function parsePreregistrationV4(value: unknown): PreregistrationV4 {
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
    "scoreBasis",
  ]);
  const calibrator = object(root.calibrator, "calibrator", [
    "candidates",
    "crossValidationFolds",
    "reservedFor",
    "tieBreakOrder",
    "tieToleranceAbsolute",
  ]);
  const conformal = object(root.conformal, "conformal", [
    "population",
    "reservedFor",
  ]);
  const fprBudgets = object(root.fprBudgets, "fprBudgets", [
    "visualAction",
    "warning",
  ]);
  const humanSources = object(root.humanSources, "humanSources", [
    "blockedSnapshots",
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
    "perHypothesisAlpha",
    "primaryFamily",
    "primaryFamilySize",
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
  const preRegistration = object(root.preRegistration, "preRegistration", [
    "eligibleCandidate",
    "frozenBefore",
    "partitionFractions",
    "plannedCertifyingMeasurements",
    "powerInventoryUnit",
    "crossVersionAdjustment",
    "primaryAnalysis",
    "publicFeedbackAdaptation",
    "quotaAxis",
    "zeroEventCeiling",
  ]);
  const quotaAxis = object(
    preRegistration.quotaAxis,
    "preRegistration.quotaAxis",
    ["axis", "cells", "poolingIsResolutionLoss"],
  );
  const resampling = object(root.resampling, "resampling", [
    "allowedUnitKinds",
    "estimandClasses",
    "estimandExtensions",
    "estimands",
    "fallbackToIndependentRows",
    "publishedBound",
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
      throw new PreregistrationV4Error(
        `resampling.estimandClasses.${row}`,
        "is missing: the four rows of the frozen resampling table are all required",
      );
    }
    estimandClasses[row] = resamplingClass(
      estimandClassBlock[row],
      `resampling.estimandClasses.${row}`,
    );
  }
  // Parsed before the extensions so an extension can be cross-checked against the
  // mapping it stretches instead of against an unvalidated object.
  const parsedEstimands = resamplingEstimands(resampling.estimands);
  const rollout = object(root.rollout, "rollout", [
    "actionsPromoted",
    "maximumStage",
    "stages",
  ]);
  const seeds = object(root.seeds, "seeds", [
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

  const warningFprBudget = proportion(fprBudgets, "fprBudgets", "warning");
  const cells = frozenList(
    quotaAxis,
    "preRegistration.quotaAxis",
    "cells",
    FROZEN_QUOTA_AXIS_CELLS,
  );
  const samplingUnits = frozenNumber(
    powerFloors,
    "powerFloors",
    "samplingUnits",
    FROZEN_FLOOR_PER_CELL,
  );
  const scoreBasis = literal(
    calibrationGate,
    "calibrationGate",
    "scoreBasis",
    "document-raw-score",
  );
  // Parsed here rather than inline in the policy literal below: the zero-event ceiling
  // is derived from the collection TARGET and the `test` fraction, so both have to be
  // validated before the block that reads them.
  const parsedCollection = collection(root.collection, cells.length);
  const parsedPartitionFractions = partitionFractions(
    object(
      preRegistration.partitionFractions,
      "preRegistration.partitionFractions",
      ["calA", "calB", "dev", "test", "train"],
    ),
  );
  // Hoisted out of the policy literal because the length bands read all three: the
  // abstain floor is where the first band starts, the blind block is what the band
  // shares sum to, and the family is the list a band may not join. `lengthBands`
  // sorts BEFORE `preRegistration` and `wordFloor` in the literal, so leaving them
  // inline would read them before they were validated.
  const abstainBelow = integer(wordFloor, "wordFloor", "abstainBelow", 1);
  const primaryFamily = frozenList(
    multiplicity,
    "multiplicity",
    "primaryFamily",
    FROZEN_PRIMARY_FAMILY,
  );
  const parsedZeroEventCeiling = zeroEventCeiling(
    object(
      preRegistration.zeroEventCeiling,
      "preRegistration.zeroEventCeiling",
      [
        "adoptedFloorPerCell",
        "blindBlockLinesAtCollectionTarget",
        "ceilingAtAdoptedFloor",
        "ceilingAtCollectionTarget",
        "formula",
        "unitsBelowFloorFailBeforeSealing",
      ],
    ),
    derivedAlpha(multiplicity),
    // The floor is ONE decision written in THREE places, so all three are joined
    // here. `powerFloors.samplingUnits` is where a power gate reads it,
    // `powerFloors.criticalFprHumanNegatives` is the denominator the ceiling's `n`
    // actually is, and `adoptedFloorPerCell` is what the ceiling is computed from.
    // A policy in which they disagree publishes a quota for an n it does not
    // require, or a ceiling tighter than its denominator supports.
    samplingUnits,
    frozenNumber(
      powerFloors,
      "powerFloors",
      "criticalFprHumanNegatives",
      FROZEN_FLOOR_PER_CELL,
    ),
    parsedCollection.humanLinesPerCellTarget,
    parsedPartitionFractions.test,
  );
  const parsedThreshold = threshold(root.threshold, warningFprBudget);
  if (parsedThreshold.basis !== scoreBasis) {
    throw new PreregistrationV4Error(
      "calibrationGate.scoreBasis",
      `is "${scoreBasis}" but threshold.basis is "${parsedThreshold.basis}": a calibration statement about a score the threshold does not cut says nothing about the published decision`,
    );
  }

  const policy: PreregistrationV4 = {
    attributionRequired: literal(root, "", "attributionRequired", true),
    backbone: literal(root, "", "backbone", FROZEN_BACKBONE),
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
      // Equal-mass, not equal-width: the gate must not be sensitive to a bin grid
      // the data does not populate.
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
      scoreBasis,
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
      reservedFor: literal(calibrator, "calibrator", "reservedFor", "v2"),
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
    collection: parsedCollection,
    commercialUse: literal(root, "", "commercialUse", false),
    conformal: {
      population: literal(conformal, "conformal", "population", "cal-b-humans"),
      reservedFor: literal(conformal, "conformal", "reservedFor", "v2"),
    },
    connectivity: connectivity(root.connectivity),
    dataset: dataset(root.dataset),
    fprBudgets: {
      visualAction: proportion(fprBudgets, "fprBudgets", "visualAction"),
      warning: warningFprBudget,
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
      blockedSnapshots: blockedSnapshots(humanSources, FROZEN_HUMAN_SNAPSHOTS),
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
    lengthBands: lengthBands(
      root.lengthBands,
      derivedAlpha(multiplicity),
      abstainBelow,
      parsedZeroEventCeiling.blindBlockLinesAtCollectionTarget,
    ),
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
      frozenAt: literal(multiplicity, "multiplicity", "frozenAt", "G0.2"),
      perHypothesisAlpha: derivedAlpha(multiplicity),
      primaryFamily,
      primaryFamilySize: frozenNumber(
        multiplicity,
        "multiplicity",
        "primaryFamilySize",
        FROZEN_PRIMARY_FAMILY.length,
      ),
    },
    onnxMaximumInt8Bytes: frozenNumber(
      root,
      "",
      "onnxMaximumInt8Bytes",
      FROZEN_ONNX_MAXIMUM_INT8_BYTES,
    ),
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
      criticalFprHumanNegatives: frozenNumber(
        powerFloors,
        "powerFloors",
        "criticalFprHumanNegatives",
        FROZEN_FLOOR_PER_CELL,
      ),
      criticalRecallPositives: integer(
        powerFloors,
        "powerFloors",
        "criticalRecallPositives",
        1,
      ),
      samplingUnits,
    },
    recallFloor: frozenNumber(root, "", "recallFloor", FROZEN_RECALL_FLOOR),
    predictiveValuePrevalences: numberList(
      root,
      "",
      "predictiveValuePrevalences",
      (entry) => entry > 0 && entry < 1,
      "must hold prevalences in (0, 1)",
    ),
    preRegistration: {
      eligibleCandidate: literal(
        preRegistration,
        "preRegistration",
        "eligibleCandidate",
        "weights-hash-from-f6-receipt",
      ),
      frozenBefore: literal(
        preRegistration,
        "preRegistration",
        "frozenBefore",
        "v1-publication",
      ),
      partitionFractions: parsedPartitionFractions,
      plannedCertifyingMeasurements: frozenNumber(
        preRegistration,
        "preRegistration",
        "plannedCertifyingMeasurements",
        1,
      ) as 1,
      powerInventoryUnit: literal(
        preRegistration,
        "preRegistration",
        "powerInventoryUnit",
        FROZEN_INDEPENDENT_UNIT,
      ),
      crossVersionAdjustment: literal(
        preRegistration,
        "preRegistration",
        "crossVersionAdjustment",
        "none",
      ),
      primaryAnalysis: literal(
        preRegistration,
        "preRegistration",
        "primaryAnalysis",
        "one-sided-95-familywise-within-version",
      ),
      publicFeedbackAdaptation: literal(
        preRegistration,
        "preRegistration",
        "publicFeedbackAdaptation",
        "none",
      ),
      quotaAxis: {
        axis: literal(quotaAxis, "preRegistration.quotaAxis", "axis", "cell"),
        cells,
        poolingIsResolutionLoss: literal(
          quotaAxis,
          "preRegistration.quotaAxis",
          "poolingIsResolutionLoss",
          true,
        ),
      },
      zeroEventCeiling: parsedZeroEventCeiling,
    },
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
      estimandExtensions: resamplingEstimandExtensions(
        resampling.estimandExtensions,
        parsedEstimands,
      ),
      estimands: parsedEstimands,
      // Frozen false: without a declared plan the gate fails for missing evidence.
      fallbackToIndependentRows: literal(
        resampling,
        "resampling",
        "fallbackToIndependentRows",
        false,
      ),
      // Frozen: the estimator reads this instead of choosing for itself, so the rule
      // that shapes a release verdict is a contract value (see `PublishedBoundRule`
      // for the measured reason it is the wider of the two).
      publishedBound: literal(
        resampling,
        "resampling",
        "publishedBound",
        "wider-of-analytic-and-resampled",
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
      bootstrap: integer(seeds, "seeds", "bootstrap", 1),
      crossValidation: integer(seeds, "seeds", "crossValidation", 1),
      publishableCheckpoint: frozenNumber(
        seeds,
        "seeds",
        "publishableCheckpoint",
        712019,
      ),
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
    threshold: parsedThreshold,
    training: {
      batchDocuments: integer(training, "training", "batchDocuments", 1),
      epochs: integer(training, "training", "epochs", 1),
      learningRate: proportion(training, "training", "learningRate"),
      optimizer: literal(training, "training", "optimizer", "adamw"),
      warmupFraction: proportion(training, "training", "warmupFraction"),
      weightDecay: proportion(training, "training", "weightDecay"),
    },
    uncoveredCoreStrata: uncoveredCoreStrata(root),
    wordFloor: {
      abstainBelow,
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
 * Built with `join`, not with `new URL("./x.json", import.meta.url)`: Vite rewrites
 * that literal pattern into an asset URL, which then is not a `file:` URL and cannot
 * be read from disk under vitest.
 */
export const PREREGISTRATION_V4_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "preregistration-v4.json",
);

/**
 * The frozen pre-registration, read and validated once. Every benchmark module that
 * needs a frozen value imports THIS instead of writing the number down again.
 */
export const PREREGISTRATION_V4: PreregistrationV4 = parsePreregistrationV4(
  JSON.parse(readFileSync(PREREGISTRATION_V4_PATH, "utf8")),
);
