// The composition gate: whether the blind block a release would be sealed over has
// the power the pre-registration promised, per quota cell.
//
// THREE quantities per cell, and the conjunction is what makes the verdict honest:
//
//   * HUMAN-NEGATIVE RECORD-LINES — the denominator of that cell's FPR ceiling. The
//     published zero-event ceiling is `1 - (alpha/m)^(1/n)`, so `n` is a number the
//     model card prints; a cell short of the floor would publish a ceiling read off a
//     sample size the corpus never had. Counted over the rows the MEASUREMENT will
//     admit (`isEligible` in benchmark/metrics.ts, at the pre-registered
//     `wordFloor.abstainBelow`): a line the scorer abstains on is not in that
//     denominator, so counting it here would defend a population that never gets
//     measured.
//   * INDEPENDENT SAMPLING UNITS — connected components
//     (`preRegistration.powerInventoryUnit`), and NOT rows. The interval assumes
//     exchangeable draws; 300 lines sliced out of one origin document are 300 lines
//     and one unit, and no correction applied afterwards recovers the information
//     that was never sampled.
//   * RECORD-LINES PER ORIGIN DOCUMENT — at most
//     `collection.maximumLinesPerOriginDocument`. It is the rule that makes a floor
//     counted in LINES also a floor counted in draws: without it a cell can hold 600
//     lines over 300 documents, clear both floors, and still publish a ceiling at
//     n = 600 over 300 independent draws. The floors alone cannot catch that — 300
//     documents ARE 300 components — so the cap is its own comparison.
//
// A row whose `source` axis is not `known` has no recoverable origin document, and all
// such rows of a cell share ONE bucket: two lines that cannot be shown to come from
// different documents cannot be counted as two draws. Reading them as distinct
// documents is the direction that over-states power.
//
// Only `test`. The floors bound the denominator of a per-cell FPR, and that rate is
// measured on the blind block alone: `dev` and `cal-A` fit the threshold, `train`
// trains, `cal-B` is reserved. Reading the floors as per-partition would demand a
// corpus several times the collected one to satisfy quantities no published claim
// rests on.
//
// The cell of a record-line is its `humanSourceType`, the same axis the per-cell
// ceilings are measured over (`CELL_FPR_AXIS` in benchmark/gates.ts), because the
// count this gate defends IS that slice's denominator. A key outside
// `preRegistration.quotaAxis.cells` carries no quota, so it fills no cell's floor.
//
// The policy's `zeroEventCeiling.unitsBelowFloorFailBeforeSealing` is pinned to the
// literal `true`, so this gate is the unconditional enforcement of it and reads no
// switch: a comparison against a value no policy can change would be a branch no input
// reaches, which reads as a defence and is not one.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { CELL_FPR_AXIS } from "./gates.ts";
import { isEligible, isHumanNegative } from "./metrics.ts";
import {
  PREREGISTRATION_V4,
  type PreregistrationV4,
} from "./preregistration-v4.ts";
import { groupAxisIdentity, type BenchmarkRecord } from "./schema.ts";
import {
  PARTITIONS,
  connectedComponentRoots,
  type DatasetSplit,
  type GroupKey,
  type Partition,
} from "./split.ts";

/**
 * The one partition the bounds are about. A literal rather than a `Partition`-typed
 * variable so the vocabulary check happens at compile time.
 */
export const COMPOSITION_GATE_PARTITION = "test" as const satisfies Partition;

/** The coded refusal a release seal outside any pre-registered bound produces. */
export const COMPOSITION_BOUNDS_NOT_MET = "COMPOSITION_BOUNDS_NOT_MET";

/**
 * The union axis that IS the origin document. `satisfies GroupKey` on purpose: the
 * per-document cap only bounds the correlation the splitter also unions on, so an axis
 * the splitter ignores could not be the one this cap is about.
 */
const ORIGIN_DOCUMENT_AXIS = "source" as const satisfies GroupKey;

/**
 * The three quantities, kept apart because two of them carry the same number by
 * coincidence and the third is a maximum: lines answer "how much text", units answer
 * "how many independent observations", and the per-document count answers "was one
 * page sliced into many draws".
 */
export type CompositionQuantity =
  | "human-negative-record-lines"
  | "independent-sampling-units"
  | "record-lines-per-origin-document";

export interface CellComposition {
  readonly cell: string;
  readonly humanNegativeLines: number;
  /**
   * Lines of this cell the measurement would abstain on (below the word floor), so a
   * cell collected at the floor but short after the filter says WHY.
   */
  readonly ineligibleLines: number;
  readonly independentUnits: number;
  /** Distinct `known` origin documents. */
  readonly originDocuments: number;
  readonly linesWithoutOriginDocument: number;
  /**
   * The largest number of lines any ONE origin document contributes to this cell — the
   * unrecoverable-origin bucket counting as one document.
   */
  readonly linesInBusiestOriginDocument: number;
}

export interface CompositionBoundBreach {
  readonly cell: string;
  readonly quantity: CompositionQuantity;
  readonly measured: number;
  readonly bound: number;
  readonly direction: "minimum" | "maximum";
}

export interface CompositionReport {
  readonly partition: typeof COMPOSITION_GATE_PARTITION;
  /** One row per DECLARED quota cell, in the pre-registered order. */
  readonly cells: readonly CellComposition[];
  readonly lineFloor: number;
  readonly unitFloor: number;
  readonly maximumLinesPerOriginDocument: number;
  readonly breaches: readonly CompositionBoundBreach[];
  readonly passed: boolean;
}

interface CellTally {
  lines: number;
  ineligibleLines: number;
  readonly units: Set<string>;
  /** `null` is the one bucket every line with an unrecoverable origin shares. */
  readonly linesByOriginDocument: Map<string | null, number>;
}

/**
 * Counts the three quantities per declared quota cell over the assignment the splitter
 * just produced, and reports which bounds the cells miss.
 *
 * Takes the SPLIT and not a separate record list: connectivity is derived from the
 * union of the five partitions, which is the corpus by construction, so no test row
 * can lack a component and there is no third opinion about which rows the split
 * describes.
 *
 * `connectedComponentRoots` is the single source of connectivity truth
 * (benchmark/split.ts) and it is called over the WHOLE corpus, then restricted to the
 * cell's rows. Re-deriving it inside the restriction would cut a component whose rows
 * span two cells into one unit per cell, counting dependent draws as independent —
 * the direction that over-states power.
 */
export function auditReleaseComposition(
  split: DatasetSplit<BenchmarkRecord>,
  policy: PreregistrationV4 = PREREGISTRATION_V4,
): CompositionReport {
  const declaredCells = policy.preRegistration.quotaAxis.cells;
  const lineFloor = policy.powerFloors.criticalFprHumanNegatives;
  const unitFloor = policy.powerFloors.samplingUnits;
  const lineCap = policy.collection.maximumLinesPerOriginDocument;
  const wordFloor = policy.wordFloor.abstainBelow;

  const corpus: BenchmarkRecord[] = [];
  for (const partition of PARTITIONS) corpus.push(...split[partition]);
  const rootById = connectedComponentRoots(corpus);

  // `Map`, never an object literal: the keys are cell names read out of a parsed
  // policy, and `__proto__` used as a key on a plain object mutates
  // `Object.prototype` instead of creating an entry.
  const tallies = new Map<string, CellTally>();
  for (const cell of declaredCells) {
    tallies.set(cell, {
      lines: 0,
      ineligibleLines: 0,
      units: new Set<string>(),
      linesByOriginDocument: new Map<string | null, number>(),
    });
  }

  for (const record of split[COMPOSITION_GATE_PARTITION]) {
    // The negative class of the measurement, read through its own predicate: the
    // schema lets a generated row carry a `humanSourceType`, and a positive counted
    // here would fill the denominator of a false-positive rate with a row that cannot
    // produce a false positive.
    if (!isHumanNegative(record)) continue;
    const cell = record[CELL_FPR_AXIS];
    if (cell === undefined) continue;
    const tally = tallies.get(cell);
    if (tally === undefined) continue;
    if (!isEligible(record, wordFloor)) {
      tally.ineligibleLines += 1;
      continue;
    }
    tally.lines += 1;
    const root = rootById.get(record.id);
    if (root === undefined) {
      // Unreachable: the connectivity map covers every row of the corpus it was
      // handed, and that corpus is the union of the five partitions. It throws rather
      // than skipping because `Map.get` is typed partial and a silent skip would
      // under-count units, which is the one direction that reads as more power than
      // the corpus has.
      throw new Error(
        `record ${record.id} of partition ${COMPOSITION_GATE_PARTITION} has no ` +
          "connected component: the connectivity map was derived from the union of " +
          "the five partitions and must cover every row of each",
      );
    }
    tally.units.add(root);
    const document = groupAxisIdentity(record, ORIGIN_DOCUMENT_AXIS) ?? null;
    tally.linesByOriginDocument.set(
      document,
      (tally.linesByOriginDocument.get(document) ?? 0) + 1,
    );
  }

  // Iterated off the tally map and not off `declaredCells`: a `Map` keeps insertion
  // order, so the rows come out in the pre-registered order without a second lookup
  // whose absent case no input reaches.
  const cells: CellComposition[] = [...tallies].map(([cell, tally]) => {
    const buckets = tally.linesByOriginDocument;
    return {
      cell,
      humanNegativeLines: tally.lines,
      ineligibleLines: tally.ineligibleLines,
      independentUnits: tally.units.size,
      originDocuments: [...buckets.keys()].filter((key) => key !== null).length,
      linesWithoutOriginDocument: buckets.get(null) ?? 0,
      linesInBusiestOriginDocument: Math.max(0, ...buckets.values()),
    };
  });

  // INCLUSIVE on both floors: the pre-registration adopts 300 as the floor, so a cell
  // holding exactly 300 satisfies it. Every count is an integer, so `>=` needs no
  // tolerance — the float epsilon the class fractions carry has no business here.
  const breaches: CompositionBoundBreach[] = [];
  for (const row of cells) {
    if (row.humanNegativeLines < lineFloor) {
      breaches.push({
        cell: row.cell,
        quantity: "human-negative-record-lines",
        measured: row.humanNegativeLines,
        bound: lineFloor,
        direction: "minimum",
      });
    }
    if (row.independentUnits < unitFloor) {
      breaches.push({
        cell: row.cell,
        quantity: "independent-sampling-units",
        measured: row.independentUnits,
        bound: unitFloor,
        direction: "minimum",
      });
    }
    if (row.linesInBusiestOriginDocument > lineCap) {
      breaches.push({
        cell: row.cell,
        quantity: "record-lines-per-origin-document",
        measured: row.linesInBusiestOriginDocument,
        bound: lineCap,
        direction: "maximum",
      });
    }
  }

  return {
    partition: COMPOSITION_GATE_PARTITION,
    cells,
    lineFloor,
    unitFloor,
    maximumLinesPerOriginDocument: lineCap,
    breaches,
    passed: breaches.length === 0,
  };
}

/**
 * The refusal message: every breach names its cell, the count MEASURED and the bound
 * it was compared against. A message that named only the bound would leave the reader
 * unable to tell a cell that is two lines short from one that is empty.
 */
export function describeCompositionBreaches(report: CompositionReport): string {
  return report.breaches
    .map(
      (breach) =>
        `cell "${breach.cell}" holds ${breach.measured} ${breach.quantity} in ` +
        `${report.partition}, ${
          breach.direction === "minimum"
            ? "below the pre-registered floor of"
            : "above the pre-registered maximum of"
        } ${breach.bound}`,
    )
    .join("; ");
}
