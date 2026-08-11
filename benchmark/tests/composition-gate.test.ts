// O gate de composição (D32): por célula de cota × `test`, linhas negativas humanas,
// unidades independentes e linhas por documento de origem contra os três limites
// pré-inscritos.
//
// Contar `test` não é LER `test`. Todas as linhas aqui são sintéticas e a atribuição é a
// que o teste monta em memória, do mesmo formato que `createBlockedSplit` devolve; nada
// abre arquivo de partição cega.

import { describe, expect, it } from "vitest";

import {
  auditReleaseComposition,
  compositionBoundsOf,
  compositionBreachesOf,
  describeCompositionBreaches,
  type CellComposition,
} from "../composition-gate.ts";
import { CELL_FPR_AXIS } from "../gates.ts";
import {
  PREREGISTRATION_V4,
  type PreregistrationV4,
} from "../preregistration-v4.ts";
import { validateBenchmarkRecordV4, type BenchmarkRecord } from "../schema.ts";
import { PARTITIONS, type DatasetSplit } from "../split.ts";
import {
  known,
  notApplicable,
  v4Ai,
  v4Human,
  v4Mixed,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

const CELLS = PREREGISTRATION_V4.preRegistration.quotaAxis.cells;
// A `humanSourceType` value the frame does NOT declare, and deliberately the register
// word the frame amendment retired: it is the spelling a corpus written against the old
// vocabulary would carry, which is the mismatch that once counted every cell as empty.
const UNDECLARED_KEY = "encyclopedic";
const LINE_FLOOR = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
const UNIT_FLOOR = PREREGISTRATION_V4.powerFloors.samplingUnits;
const LINE_CAP = PREREGISTRATION_V4.collection.maximumLinesPerOriginDocument;
const WORD_FLOOR = PREREGISTRATION_V4.wordFloor.abstainBelow;

/**
 * A human negative of one quota cell, drawn out of one origin document.
 *
 * `source` IS the origin document and it is a v4 union axis, so two rows naming the
 * same document are one component AND one bucket of the per-document cap — which is
 * the whole difference between the three quantities the gate counts. `author` and
 * `nearDuplicate` default to per-row values so no OTHER axis glues rows that the
 * document does not; a caller that wants a cluster passes `author`.
 */
function humanNegative(
  id: string,
  cell: string,
  document: string,
  overrides: { author?: string; wordCount?: number } = {},
): BenchmarkRecord {
  let raw: Record<string, unknown> = {
    ...v4Human(),
    id,
    [CELL_FPR_AXIS]: cell,
  };
  if (overrides.wordCount !== undefined) raw.wordCount = overrides.wordCount;
  raw = withAxis(raw, "author", known(overrides.author ?? `au_hmac_${id}`));
  raw = withAxis(raw, "source", known(document));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

/** A human negative whose origin document was not recovered. */
function humanNegativeWithoutOrigin(id: string, cell: string): BenchmarkRecord {
  let raw: Record<string, unknown> = {
    ...v4Human(),
    id,
    [CELL_FPR_AXIS]: cell,
  };
  raw = withAxis(raw, "author", known(`au_hmac_${id}`));
  raw = withAxis(
    raw,
    "source",
    notApplicable(
      "the extraction run recorded no origin document for this line",
    ),
  );
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

/** An AI positive: it carries no `humanSourceType`, so it fills no cell's floor. */
function aiPositive(id: string): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v4Ai(), id };
  raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
  raw = withAxis(raw, "generatorVersion", known(`gv_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  raw = withAxis(raw, "generationBatch", known(`gb_${id}`));
  raw = withAxis(raw, "humanSeed", known(`h_absent_${id}`));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

/**
 * A positive that DOES carry a declared quota cell. The schema couples
 * `humanSourceType` to no label, so this shape is admissible and is the one the label
 * filter exists for.
 */
function positiveInCell(id: string, cell: string, label: "ai" | "mixed") {
  let raw: Record<string, unknown> = {
    ...(label === "ai" ? v4Ai() : v4Mixed()),
    id,
    [CELL_FPR_AXIS]: cell,
  };
  raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
  raw = withAxis(raw, "generatorVersion", known(`gv_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  raw = withAxis(raw, "generationBatch", known(`gb_${id}`));
  if (label === "ai") raw = withAxis(raw, "humanSeed", known(`h_absent_${id}`));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

/**
 * `lines` human negatives of one cell, one origin document each: the three quantities
 * come out as `lines` lines, `lines` units and one line per document.
 */
function cellRows(cell: string, lines: number, tag: string): BenchmarkRecord[] {
  return Array.from({ length: lines }, (_, index) =>
    humanNegative(
      `h_${tag}_${cell}_${index}`,
      cell,
      `th_doc_${tag}_${cell}_${index}`,
    ),
  );
}

/**
 * `lines` human negatives of one cell, ONE origin document each but their authors
 * shared round-robin over `units` people: documents stay one line apiece and the
 * components collapse to `units`. It sets the unit count INDEPENDENTLY of the other
 * two.
 */
function clusteredCellRows(
  cell: string,
  lines: number,
  units: number,
  tag: string,
): BenchmarkRecord[] {
  return Array.from({ length: lines }, (_, index) =>
    humanNegative(
      `h_${tag}_${cell}_${index}`,
      cell,
      `th_doc_${tag}_${cell}_${index}`,
      { author: `au_hmac_${tag}_${cell}_${index % units}` },
    ),
  );
}

/**
 * `lines` human negatives of one cell spread over FEWER origin documents,
 * round-robin: the pre-registered cap of one line per document is broken by
 * construction, while both floors stay clear.
 */
function oversubscribedCellRows(
  cell: string,
  lines: number,
  documents: number,
  tag: string,
): BenchmarkRecord[] {
  return Array.from({ length: lines }, (_, index) =>
    humanNegative(
      `h_${tag}_${cell}_${index}`,
      cell,
      `th_doc_${tag}_${cell}_${index % documents}`,
    ),
  );
}

/**
 * A split whose FIVE partitions are populated. An empty `cal-B` or `train` would leave
 * the union the gate derives connectivity from smaller than the corpus, so a gate that
 * silently read only the blind block would still pass every assertion.
 */
function splitWith(
  testRows: readonly BenchmarkRecord[],
): DatasetSplit<BenchmarkRecord> {
  const filler = (partition: string): BenchmarkRecord[] => [
    humanNegative(`h_${partition}_0`, CELLS[0], `th_doc_${partition}_0`),
    // A key with NO quota in every partition: the gate has to ignore it wherever it
    // appears, and a fixture that never carried one could not tell "ignored" from
    // "absent".
    humanNegative(`h_${partition}_1`, UNDECLARED_KEY, `th_doc_${partition}_1`),
    aiPositive(`a_${partition}_0`),
  ];
  return {
    train: filler("train"),
    dev: filler("dev"),
    "cal-A": filler("cal_a"),
    "cal-B": filler("cal_b"),
    test: [...testRows],
  };
}

/** Every declared cell at `lines` lines, one document each, plus an AI positive. */
function blindBlock(lines: number): BenchmarkRecord[] {
  return [
    ...CELLS.flatMap((cell) => cellRows(cell, lines, "t")),
    aiPositive("a_test_0"),
  ];
}

/** Every declared cell but `except` at the floor in all three quantities. */
function restAtFloor(except: string): BenchmarkRecord[] {
  return CELLS.filter((cell) => cell !== except).flatMap((cell) =>
    cellRows(cell, LINE_FLOOR, "t"),
  );
}

function breachOf(
  report: ReturnType<typeof auditReleaseComposition>,
  cell: string,
  quantity: string,
) {
  return report.breaches.find(
    (breach) => breach.cell === cell && breach.quantity === quantity,
  );
}

function rowOf(
  report: ReturnType<typeof auditReleaseComposition>,
  cell: string,
) {
  return report.cells.find((entry) => entry.cell === cell);
}

describe("composition gate — the three bounds per quota cell in test", () => {
  it("counts only the blind block, and the five partitions are all populated", () => {
    const split = splitWith(blindBlock(4));
    for (const partition of PARTITIONS) {
      expect(split[partition].length, partition).toBeGreaterThan(0);
    }
    // The gate is about `test` and nothing else: the filler rows of the other four
    // partitions carry the same two cells, so a gate that pooled partitions would
    // report more than four lines per cell here.
    const report = auditReleaseComposition(split);
    expect(report.partition).toBe("test");
    expect(report.cells.map((row) => row.cell)).toEqual([...CELLS]);
    for (const row of report.cells) {
      expect(row.humanNegativeLines, row.cell).toBe(4);
      expect(row.independentUnits, row.cell).toBe(4);
      expect(row.originDocuments, row.cell).toBe(4);
      expect(row.linesInBusiestOriginDocument, row.cell).toBe(1);
    }
  });

  // T10, primeira metade: 299 reprova nomeando célula, contagem e piso; 300 passa.
  it("refuses a cell one line below the floor, naming the cell, the count and the floor", () => {
    const short = CELLS[0];
    const report = auditReleaseComposition(
      splitWith([
        ...cellRows(short, LINE_FLOOR - 1, "t"),
        ...restAtFloor(short),
        aiPositive("a_test_0"),
      ]),
    );

    expect(report.passed).toBe(false);
    expect(breachOf(report, short, "human-negative-record-lines")).toEqual({
      cell: short,
      quantity: "human-negative-record-lines",
      measured: LINE_FLOOR - 1,
      bound: LINE_FLOOR,
      direction: "minimum",
    });
    // The message, not only the structure: it is the whole refusal a reader sees.
    const message = describeCompositionBreaches(report);
    expect(message).toContain(`cell "${short}"`);
    expect(message).toContain(`${LINE_FLOOR - 1} human-negative-record-lines`);
    expect(message).toContain(`floor of ${LINE_FLOOR}`);
    // The three cells AT the floor contribute nothing to the refusal, so the failure
    // is the short cell and not the fixture.
    for (const cell of CELLS.slice(1)) {
      expect(report.breaches.filter((breach) => breach.cell === cell)).toEqual(
        [],
      );
    }
  });

  it("accepts a cell holding exactly the floor: the comparison is inclusive", () => {
    const report = auditReleaseComposition(splitWith(blindBlock(LINE_FLOOR)));
    expect(report.breaches).toEqual([]);
    expect(report.passed).toBe(true);
    for (const row of report.cells) {
      expect(row.humanNegativeLines, row.cell).toBe(LINE_FLOOR);
      expect(row.independentUnits, row.cell).toBe(UNIT_FLOOR);
    }
  });

  // T10, segunda metade: linhas no piso e unidades abaixo dele reprova POR UNIDADES.
  it("refuses on units when the lines reach the floor and the documents do not", () => {
    const clustered = CELLS[0];
    const units = 250;
    const report = auditReleaseComposition(
      splitWith([
        ...clusteredCellRows(clustered, LINE_FLOOR, units, "t"),
        ...restAtFloor(clustered),
        aiPositive("a_test_0"),
      ]),
    );

    expect(report.passed).toBe(false);
    // Non-vacuous in the two directions that matter: the cell IS at the line floor and
    // its documents hold one line each, so a gate that counted lines twice and never
    // components would see nothing wrong here.
    const row = rowOf(report, clustered);
    expect(row?.humanNegativeLines).toBe(LINE_FLOOR);
    expect(row?.independentUnits).toBe(units);
    expect(row?.linesInBusiestOriginDocument).toBe(1);
    expect(breachOf(report, clustered, "human-negative-record-lines")).toBe(
      undefined,
    );
    expect(
      breachOf(report, clustered, "record-lines-per-origin-document"),
    ).toBe(undefined);
    expect(breachOf(report, clustered, "independent-sampling-units")).toEqual({
      cell: clustered,
      quantity: "independent-sampling-units",
      measured: units,
      bound: UNIT_FLOOR,
      direction: "minimum",
    });
    const message = describeCompositionBreaches(report);
    expect(message).toContain(`${units} independent-sampling-units`);
    expect(message).toContain(`floor of ${UNIT_FLOOR}`);
    expect(message).not.toContain("human-negative-record-lines");
  });

  // A regra `collection.maximumLinesPerOriginDocument`: os dois pisos NÃO a pegam.
  it("refuses a cell whose lines are sliced two to an origin document, with both floors clear", () => {
    const sliced = CELLS[0];
    const documents = LINE_FLOOR;
    const report = auditReleaseComposition(
      splitWith([
        ...oversubscribedCellRows(sliced, LINE_FLOOR * 2, documents, "t"),
        ...restAtFloor(sliced),
        aiPositive("a_test_0"),
      ]),
    );

    // Both floors are CLEAR — this is the case the pair of floors cannot see: 600
    // lines over 300 documents is 300 components, and the published ceiling would be
    // read off n = 600.
    const row = rowOf(report, sliced);
    expect(row?.humanNegativeLines).toBe(LINE_FLOOR * 2);
    expect(row?.independentUnits).toBe(documents);
    expect(row?.originDocuments).toBe(documents);
    expect(breachOf(report, sliced, "human-negative-record-lines")).toBe(
      undefined,
    );
    expect(breachOf(report, sliced, "independent-sampling-units")).toBe(
      undefined,
    );

    expect(report.passed).toBe(false);
    expect(
      breachOf(report, sliced, "record-lines-per-origin-document"),
    ).toEqual({
      cell: sliced,
      quantity: "record-lines-per-origin-document",
      measured: 2,
      bound: LINE_CAP,
      direction: "maximum",
    });
    const message = describeCompositionBreaches(report);
    expect(message).toContain("2 record-lines-per-origin-document");
    expect(message).toContain(
      `above the pre-registered maximum of ${LINE_CAP}`,
    );
  });

  // O denominador é a população ELEGÍVEL: abaixo do piso de palavras o escore abstém.
  it("does not count a line the measurement abstains on, and says how many it dropped", () => {
    const thin = CELLS[0];
    const abstained = 100;
    const report = auditReleaseComposition(
      splitWith([
        ...cellRows(thin, LINE_FLOOR - abstained, "t"),
        ...Array.from({ length: abstained }, (_, index) =>
          humanNegative(
            `h_thin_${thin}_${index}`,
            thin,
            `th_doc_thin_${thin}_${index}`,
            { wordCount: WORD_FLOOR - 1 },
          ),
        ),
        ...restAtFloor(thin),
        aiPositive("a_test_0"),
      ]),
    );

    // The cell HOLDS 300 record-lines; the gate defends the 200 the FPR would be
    // measured over, and the dropped hundred is published so the operator can tell a
    // short cell from a thin one.
    const row = rowOf(report, thin);
    expect(row?.humanNegativeLines).toBe(LINE_FLOOR - abstained);
    expect(row?.ineligibleLines).toBe(abstained);
    expect(row?.independentUnits).toBe(LINE_FLOOR - abstained);
    expect(report.passed).toBe(false);
    expect(breachOf(report, thin, "human-negative-record-lines")).toEqual({
      cell: thin,
      quantity: "human-negative-record-lines",
      measured: LINE_FLOOR - abstained,
      bound: LINE_FLOOR,
      direction: "minimum",
    });
  });

  it("gives a positive carrying a declared cell no quota at all", () => {
    const cell = CELLS[0];
    const report = auditReleaseComposition(
      splitWith([
        positiveInCell("a_cell_0", cell, "ai"),
        positiveInCell("m_cell_0", cell, "mixed"),
      ]),
    );
    // A positive cannot produce a false positive, so it cannot fill the denominator of
    // a false-positive rate — however the axis is spelled on it.
    const row = rowOf(report, cell);
    expect(row?.humanNegativeLines).toBe(0);
    expect(row?.ineligibleLines).toBe(0);
    expect(row?.independentUnits).toBe(0);
    expect(row?.originDocuments).toBe(0);
  });

  it("counts a cell filled out of one document as one unit, however many lines it has", () => {
    const cell = CELLS[0];
    const report = auditReleaseComposition(
      splitWith([
        ...oversubscribedCellRows(cell, LINE_FLOOR, 1, "t"),
        aiPositive("a_test_0"),
      ]),
    );
    const row = rowOf(report, cell);
    expect(row?.humanNegativeLines).toBe(LINE_FLOOR);
    expect(row?.independentUnits).toBe(1);
    expect(row?.originDocuments).toBe(1);
    expect(breachOf(report, cell, "independent-sampling-units")?.measured).toBe(
      1,
    );
    expect(
      breachOf(report, cell, "record-lines-per-origin-document")?.measured,
    ).toBe(LINE_FLOOR);
  });

  it("holds every line with an unrecoverable origin in ONE document bucket", () => {
    const cell = CELLS[0];
    const report = auditReleaseComposition(
      splitWith([
        humanNegativeWithoutOrigin("h_no_origin_0", cell),
        humanNegativeWithoutOrigin("h_no_origin_1", cell),
      ]),
    );
    // Two lines that cannot be shown to come from different documents are not two
    // draws: reading them as distinct documents is the direction that over-states
    // power, so the cap refuses them.
    const row = rowOf(report, cell);
    expect(row?.humanNegativeLines).toBe(2);
    expect(row?.originDocuments).toBe(0);
    expect(row?.linesWithoutOriginDocument).toBe(2);
    expect(breachOf(report, cell, "record-lines-per-origin-document")).toEqual({
      cell,
      quantity: "record-lines-per-origin-document",
      measured: 2,
      bound: LINE_CAP,
      direction: "maximum",
    });
  });

  it("reads the word floor and the per-document cap off the policy as well", () => {
    // The two bounds that are NOT floors would be invisible if the gate spelled them:
    // the frozen policy carries 50 and 1, so only a policy that carries other values
    // separates "read from the input" from "compiled in".
    const cell = CELLS[0];
    const fixtureWordCount = 100;
    const split = splitWith(oversubscribedCellRows(cell, 4, 2, "t"));

    const strictWordFloor: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      wordFloor: {
        ...PREREGISTRATION_V4.wordFloor,
        abstainBelow: fixtureWordCount * 2,
      },
    };
    const underStrictWordFloor = auditReleaseComposition(
      split,
      strictWordFloor,
    );
    const thinRow = rowOf(underStrictWordFloor, cell);
    expect(thinRow?.humanNegativeLines).toBe(0);
    expect(thinRow?.ineligibleLines).toBe(4);

    const twoPerDocument: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      collection: {
        ...PREREGISTRATION_V4.collection,
        maximumLinesPerOriginDocument: 2,
      },
    };
    const underTwoPerDocument = auditReleaseComposition(split, twoPerDocument);
    expect(underTwoPerDocument.maximumLinesPerOriginDocument).toBe(2);
    expect(rowOf(underTwoPerDocument, cell)?.linesInBusiestOriginDocument).toBe(
      2,
    );
    // Two lines per document is inside a cap of two, so the cap contributes nothing —
    // while the frozen cap of one refuses the same block.
    expect(
      breachOf(underTwoPerDocument, cell, "record-lines-per-origin-document"),
    ).toBe(undefined);
    expect(
      breachOf(
        auditReleaseComposition(split),
        cell,
        "record-lines-per-origin-document",
      )?.measured,
    ).toBe(2);
  });

  it("reads a component that spans two partitions as ONE unit inside the blind block", () => {
    const cell = CELLS[0];
    const shared = "th_doc_shared";
    const coauthor = "au_hmac_shared";
    // r1 and r3 are both in `test` and share NO axis with each other: they are one
    // component only through r2, which sits in `train`. Connectivity is derived over the
    // UNION of the five partitions and then restricted, so the blind block holds one
    // unit; re-deriving it inside the blind block would read them as two, which is the
    // direction that over-states power.
    const r1 = humanNegative("h_span_1", cell, "th_doc_span_1", {
      author: coauthor,
    });
    const r2 = humanNegative("h_span_2", cell, shared, { author: coauthor });
    const r3 = humanNegative("h_span_3", cell, shared);
    const split = splitWith([r1, r3]);
    const report = auditReleaseComposition({
      ...split,
      train: [...split.train, r2],
    });

    const row = rowOf(report, cell);
    // Two lines of the blind block, ONE unit, two distinct origin documents: the three
    // quantities disagree here, which is what makes the assertion about the unit.
    expect(row?.humanNegativeLines).toBe(2);
    expect(row?.independentUnits).toBe(1);
    expect(row?.originDocuments).toBe(2);
    // Non-vacuous: without the bridge row in `train` the same two lines are two units.
    const withoutBridge = auditReleaseComposition(splitWith([r1, r3]));
    expect(rowOf(withoutBridge, cell)?.humanNegativeLines).toBe(2);
    expect(rowOf(withoutBridge, cell)?.independentUnits).toBe(2);
  });

  // T11: os pisos vêm da política CARREGADA, e cada um do SEU campo.
  it("reads every bound off the policy it was handed, each from its own field", () => {
    const relaxedLineFloor = 3;
    const relaxedUnitFloor = 5;
    const relaxed: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      powerFloors: {
        ...PREREGISTRATION_V4.powerFloors,
        criticalFprHumanNegatives: relaxedLineFloor,
        samplingUnits: relaxedUnitFloor,
      },
      preRegistration: {
        ...PREREGISTRATION_V4.preRegistration,
        // Kept coherent with the floors it is written beside: the parser pins
        // `adoptedFloorPerCell` to `powerFloors.samplingUnits` and derives the ceiling
        // from the LINE floor. The frozen file pins all three to 300, so a policy with
        // other floors is hypothetical by necessity — what this fixture must not be is
        // self-contradictory.
        zeroEventCeiling: {
          ...PREREGISTRATION_V4.preRegistration.zeroEventCeiling,
          adoptedFloorPerCell: relaxedUnitFloor,
          ceilingAtAdoptedFloor:
            1 -
            PREREGISTRATION_V4.multiplicity.perHypothesisAlpha **
              (1 / relaxedLineFloor),
        },
      },
    };
    // Five lines, one document each, over four authors: above the relaxed LINE floor
    // and below the relaxed UNIT floor, so the two bounds cannot be swapped without a
    // verdict changing.
    const split = splitWith(
      CELLS.flatMap((cell) => clusteredCellRows(cell, 5, 4, "t")),
    );

    const underRelaxed = auditReleaseComposition(split, relaxed);
    expect(underRelaxed.lineFloor).toBe(relaxedLineFloor);
    expect(underRelaxed.unitFloor).toBe(relaxedUnitFloor);
    expect(underRelaxed.maximumLinesPerOriginDocument).toBe(LINE_CAP);
    expect(underRelaxed.passed).toBe(false);
    for (const cell of CELLS) {
      expect(breachOf(underRelaxed, cell, "human-negative-record-lines")).toBe(
        undefined,
      );
      expect(
        breachOf(underRelaxed, cell, "independent-sampling-units"),
      ).toEqual({
        cell,
        quantity: "independent-sampling-units",
        measured: 4,
        bound: relaxedUnitFloor,
        direction: "minimum",
      });
    }

    // THE SAME BLOCK, under the frozen policy: the line floor now bites too, so the
    // floors are inputs and not literals compiled into the gate.
    const underFrozen = auditReleaseComposition(split);
    expect(underFrozen.lineFloor).toBe(LINE_FLOOR);
    expect(underFrozen.passed).toBe(false);
    expect(
      breachOf(underFrozen, CELLS[0], "human-negative-record-lines"),
    ).toEqual({
      cell: CELLS[0],
      quantity: "human-negative-record-lines",
      measured: 5,
      bound: LINE_FLOOR,
      direction: "minimum",
    });
  });

  it("gives a key outside the declared vocabulary no quota at all", () => {
    // A corpus whose axis carries the core-stratum names instead of the quota cells
    // fills no cell, so every declared cell reads zero and the seal is refused. The
    // vocabulary mismatch surfaces as an empty cell, never as a satisfied one.
    // `humanCoreStrata` IS the cell list since the frame amendment, so the undeclared
    // key can no longer be read out of the policy: it is the retired register word,
    // written down here because that is the spelling a corpus built before the amendment
    // carries.
    const undeclared = UNDECLARED_KEY;
    expect(CELLS).not.toContain(undeclared);
    expect([...PREREGISTRATION_V4.humanCoreStrata]).not.toContain(undeclared);
    const report = auditReleaseComposition(
      splitWith([
        ...cellRows(undeclared, LINE_FLOOR, "t"),
        aiPositive("a_test_0"),
      ]),
    );
    expect(report.cells.every((row) => row.humanNegativeLines === 0)).toBe(
      true,
    );
    // Two bounds per empty cell: both floors, and no per-document cap to break.
    expect(report.breaches).toHaveLength(CELLS.length * 2);
    expect(report.passed).toBe(false);
  });
});

// O CRITERIO, extraido: `compositionBreachesOf` e a unica grafia dos tres limites, e
// `compositionBoundsOf` a unica leitura deles. O gate chama as duas, e a guarda sem dataset do
// artefato selado (benchmark/split-artifact.ts) chama as MESMAS — nenhum espelho por copia.
describe("o criterio dos tres limites, sobre as celulas contadas", () => {
  const BOUNDS = compositionBoundsOf(PREREGISTRATION_V4);

  /** Uma celula contada NO piso em todas as tres quantidades. */
  function countedCell(
    cell: string,
    overrides: Partial<CellComposition> = {},
  ): CellComposition {
    return {
      cell,
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: UNIT_FLOOR,
      originDocuments: LINE_FLOOR,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: LINE_CAP,
      ...overrides,
    };
  }

  it("le os tres limites, cada um do SEU campo da politica", () => {
    expect(compositionBoundsOf(PREREGISTRATION_V4)).toEqual({
      lineFloor: LINE_FLOOR,
      unitFloor: UNIT_FLOOR,
      maximumLinesPerOriginDocument: LINE_CAP,
    });
    // Dois dos tres numeros congelados coincidem, entao so uma politica com valores distintos
    // separa "lido do proprio campo" de "lido do vizinho".
    const distinct: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      powerFloors: {
        ...PREREGISTRATION_V4.powerFloors,
        criticalFprHumanNegatives: 7,
        samplingUnits: 11,
      },
      collection: {
        ...PREREGISTRATION_V4.collection,
        maximumLinesPerOriginDocument: 3,
      },
    };
    expect(compositionBoundsOf(distinct)).toEqual({
      lineFloor: 7,
      unitFloor: 11,
      maximumLinesPerOriginDocument: 3,
    });
  });

  it("nomeia a celula curta onde ela estiver, e nao so a primeira", () => {
    const cells = [
      countedCell("alpha"),
      countedCell("beta"),
      countedCell("omega", { humanNegativeLines: LINE_FLOOR - 1 }),
    ];
    expect(compositionBreachesOf(cells, BOUNDS)).toEqual([
      {
        cell: "omega",
        quantity: "human-negative-record-lines",
        measured: LINE_FLOOR - 1,
        bound: LINE_FLOOR,
        direction: "minimum",
      },
    ]);
  });

  it("as tres quantidades, uma brecha cada, no mesmo corpo", () => {
    // Duas linhas de um documento so: abaixo dos dois pisos E acima do cap, de uma vez.
    const cells = [
      countedCell("alpha", {
        humanNegativeLines: 2,
        independentUnits: 1,
        originDocuments: 1,
        linesInBusiestOriginDocument: 2,
      }),
    ];
    expect(compositionBreachesOf(cells, BOUNDS)).toEqual([
      {
        cell: "alpha",
        quantity: "human-negative-record-lines",
        measured: 2,
        bound: LINE_FLOOR,
        direction: "minimum",
      },
      {
        cell: "alpha",
        quantity: "independent-sampling-units",
        measured: 1,
        bound: UNIT_FLOOR,
        direction: "minimum",
      },
      {
        cell: "alpha",
        quantity: "record-lines-per-origin-document",
        measured: 2,
        bound: LINE_CAP,
        direction: "maximum",
      },
    ]);
  });

  it("conta e compara TODAS as celulas declaradas, com a curta em ultimo lugar", () => {
    // Politica hipotetica de TRES celulas: o frame congelado declara uma so, entao sobre um
    // corpus real nada distingue um laco de um lookup na primeira.
    const threeCells: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      preRegistration: {
        ...PREREGISTRATION_V4.preRegistration,
        quotaAxis: {
          ...PREREGISTRATION_V4.preRegistration.quotaAxis,
          cells: ["alpha", "beta", "omega"],
        },
      },
    };
    const report = auditReleaseComposition(
      splitWith([
        ...cellRows("alpha", LINE_FLOOR, "t"),
        ...cellRows("beta", LINE_FLOOR, "t"),
        ...cellRows("omega", LINE_FLOOR - 1, "t"),
        aiPositive("a_test_0"),
      ]),
      threeCells,
    );

    expect(report.cells.map((row) => row.cell)).toEqual([
      "alpha",
      "beta",
      "omega",
    ]);
    // Uma celula curta em ULTIMO lugar, e as duas primeiras no piso: um criterio que so olhasse
    // a primeira celula devolveria `passed` sobre este bloco.
    expect(
      report.breaches.map((breach) => `${breach.cell}:${breach.quantity}`),
    ).toEqual([
      "omega:human-negative-record-lines",
      "omega:independent-sampling-units",
    ]);
    expect(report.passed).toBe(false);
  });
});
