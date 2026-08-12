import { describe, expect, it } from "vitest";

import { fitCalibrator } from "../calibrators.ts";
import {
  aggregateOutOfFold,
  CalibrationSelectionError,
  ClusterFoldError,
  clusterRootsOf,
  createClusteredFolds,
  selectCalibrator,
  selectCandidateSummary,
  type ClusteredCalibrationSample,
  type FoldClassBalance,
  type OutOfFoldPrediction,
} from "../cross-validation.ts";
import { eceEqualMass } from "../metrics.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkRecord,
} from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3Ai,
  v3Human,
  v4MixedEcological,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

// Read from the policy rather than from the module under test, so a test asserting
// the frozen number cannot be satisfied by the module agreeing with itself.
const FOLDS = PREREGISTRATION_V4.calibrator.crossValidationFolds;
const CV_SEED = PREREGISTRATION_V4.seeds.crossValidation;
const TIE_TOLERANCE = PREREGISTRATION_V4.calibrator.tieToleranceAbsolute;
const TIE_BREAK_ORDER = PREREGISTRATION_V4.calibrator.tieBreakOrder;
const ECE_MAXIMUM = PREREGISTRATION_V4.calibrationGate.eceMax;

// ---------------------------------------------------------------------------
// TWO record fixtures, because one cannot answer both questions this file asks.
//
// `chainedClusters` is the REALISTIC one, used for everything about folds: five
// split/exposure clusters of three record-lines each, where a cluster shares an
// `author`/`source` chain AND a per-cluster `domainSource` and `collectionBatch`.
// Per-cluster is what a corpus really looks like — a collection batch belongs to one
// stratum — and giving EVERY row of a corpus the same value on those two would
// describe a corpus that is one indivisible cluster and cannot be cross-validated at
// all.
//
// The CHAIN is what unions each trio here: `domainSource` and `collectionBatch` are
// not axes the splitter unions on (benchmark/split.ts `GROUP_KEYS`), so a per-cluster
// value on either of them groups nothing. The trio is one atom because
// author(0,1) + source(1,2) closes transitively, and the atom is the connected
// component of that union.
//
// `isolatedChain` is the discriminating one, used only for that claim: every
// non-chain axis is per-ROW, so the ONLY relation joining row 0 to row 2 is
// author(0,1) + source(1,2). All three of `domainSource`, `collectionBatch` and
// `nearDuplicate` admit `known` and nothing else in every class (schema
// AXIS_STATE_RULE), so per-row distinct values are the only way to write them at all
// — `notApplicable` is refused by the validator, which was measured before writing
// this. Distinct-per-row here models "each row came from its own source and batch"
// in a three-row fixture; it is not the R6 defect of minting a synthetic id per
// record-line to make a real corpus splittable.
// ---------------------------------------------------------------------------

function humanRow(
  id: string,
  cluster: number,
  author: string,
  source: string,
): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v3Human(), id };
  raw = withAxis(raw, "author", known(author));
  raw = withAxis(raw, "source", known(source));
  raw = withAxis(raw, "domainSource", known(`ds_${cluster}`));
  raw = withAxis(raw, "collectionBatch", known(`cb_${cluster}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV3(raw);
}

function chainedClusters(clusterCount: number): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    records.push(
      humanRow(`h_${cluster}_0`, cluster, `au_${cluster}_a`, `th_${cluster}_a`),
      humanRow(`h_${cluster}_1`, cluster, `au_${cluster}_a`, `th_${cluster}_b`),
      humanRow(`h_${cluster}_2`, cluster, `au_${cluster}_b`, `th_${cluster}_b`),
    );
  }
  return records;
}

/** A row whose every axis EXCEPT `author`/`source` is unshareable. */
function isolatedRow(
  id: string,
  author: string,
  source: string,
): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v3Human(), id };
  raw = withAxis(raw, "author", known(author));
  raw = withAxis(raw, "source", known(source));
  raw = withAxis(raw, "domainSource", known(`ds_${id}`));
  raw = withAxis(raw, "collectionBatch", known(`cb_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV3(raw);
}

// row 0 --author-- row 1 --source-- row 2, and nothing else anywhere.
function isolatedChain(tag: string): BenchmarkRecord[] {
  return [
    isolatedRow(`h_${tag}_0`, `au_${tag}_a`, `th_${tag}_p`),
    isolatedRow(`h_${tag}_1`, `au_${tag}_a`, `th_${tag}_q`),
    isolatedRow(`h_${tag}_2`, `au_${tag}_b`, `th_${tag}_q`),
  ];
}

// One positive and two negatives per cluster, so a perfectly stratified packing
// exists and any measured imbalance is the packer's, not the fixture's.
function samplesFrom(
  records: readonly BenchmarkRecord[],
): ClusteredCalibrationSample[] {
  const rootById = clusterRootsOf(records);
  return records.map((record, index) => {
    const positive = index % 3 === 0;
    return {
      id: record.id,
      clusterRoot: rootById.get(record.id) as string,
      rawScore: positive ? 0.9 : 0.1,
      label: (positive ? 1 : 0) as 0 | 1,
    };
  });
}

const chainedRecords = chainedClusters(FOLDS);
const chainedSamples = samplesFrom(chainedRecords);

// Ten atoms of THREE record-lines each — identical in size, opposite in class. The
// roots are written directly rather than derived from records because the question is
// about the PACKER and not about connectivity: what matters is that a packer reading
// only sizes sees ten interchangeable atoms.
const classSkewedAtoms: ClusteredCalibrationSample[] = [
  ...[0, 1, 2, 3, 4].flatMap((atom) =>
    [0, 1, 2].map((row) => ({
      id: `h_pos_${atom}_${row}`,
      clusterRoot: `h_pos_${atom}`,
      rawScore: 0.9,
      label: 1 as const,
    })),
  ),
  ...[0, 1, 2, 3, 4].flatMap((atom) =>
    [0, 1, 2].map((row) => ({
      id: `h_neg_${atom}_${row}`,
      clusterRoot: `h_neg_${atom}`,
      rawScore: 0.1,
      label: 0 as const,
    })),
  ),
];

function labelledAtom(
  root: string,
  label: 0 | 1,
  rows: number,
): ClusteredCalibrationSample[] {
  return Array.from({ length: rows }, (_unused, row) => ({
    id: `${root}_${row}`,
    clusterRoot: root,
    rawScore: label === 1 ? 0.9 : 0.1,
    label,
  }));
}

function singletons(
  prefix: string,
  label: 0 | 1,
  count: number,
): ClusteredCalibrationSample[] {
  return Array.from({ length: count }, (_unused, index) =>
    labelledAtom(`${prefix}${index}`, label, 1),
  ).flat();
}

// UNEQUAL atom sizes with CLUMPED class composition — the shape `classSkewedAtoms`
// cannot express, because its ten atoms are interchangeable in size and its
// composition alternates, which is exactly where a class-aware heuristic looks
// perfect. Each of these four aborted with FOLD_HALF_EMPTY under the receiving-fold
// squared-error rule this replaced (measured; see `bestFoldIndex`).
const unevenAtomShapes: Record<string, ClusteredCalibrationSample[]> = {
  "one fat negative lineage against equal singleton counts": [
    ...labelledAtom("big_neg", 0, 12),
    ...singletons("p_", 1, 5),
    ...singletons("n_", 0, 5),
  ],
  "the same fat lineage with more negative singletons than folds": [
    ...labelledAtom("big_neg", 0, 12),
    ...singletons("p_", 1, 5),
    ...singletons("n_", 0, 8),
  ],
  "a fat negative lineage under a negative-majority population": [
    ...labelledAtom("big_neg", 0, 8),
    ...singletons("p_", 1, 6),
    ...singletons("n_", 0, 10),
  ],
  "two fat positive lineages against a negative-majority tail": [
    ...labelledAtom("lin_a", 1, 6),
    ...labelledAtom("lin_b", 1, 6),
    ...singletons("p_", 1, 5),
    ...singletons("n_", 0, 6),
  ],
};

/** One atom carrying both classes, which the fixture below needs and no other has. */
function mixedAtom(
  root: string,
  positives: number,
  negatives: number,
): ClusteredCalibrationSample[] {
  return [
    ...Array.from({ length: positives }, (_unused, row) => ({
      id: `${root}_p${row}`,
      clusterRoot: root,
      rawScore: 0.9,
      label: 1 as const,
    })),
    ...Array.from({ length: negatives }, (_unused, row) => ({
      id: `${root}_n${row}`,
      clusterRoot: root,
      rawScore: 0.1,
      label: 0 as const,
    })),
  ];
}

// Seven atoms of MIXED class over an UNEQUAL class total — 10 positives against 14
// negatives. Both properties are needed for the fold cost to be observable at all,
// which is why no other fixture in this file can stand in:
//
//   * the class weights are `atom[c] / total[c] ** 2`, so the ratio between the two
//     class terms is `(atom[pos]/atom[neg]) * (total[neg]/total[pos]) ** 2`.
//     Re-scaling the two terms by different constants can only move the argmin when an
//     atom carries BOTH classes — a single-class atom's cost is one term times a
//     positive constant, whose minimiser is the same whatever the constant — and when
//     `total[pos] !== total[neg]`, since otherwise the two normalisations coincide;
//   * `unevenAtomShapes` is class-CLUMPED (its fat atoms are single-class) and
//     `classSkewedAtoms` is balanced 15/15, so both are blind to the normalisation.
const imbalancedMixedAtoms: ClusteredCalibrationSample[] = [
  ...mixedAtom("sk_0", 3, 1),
  ...mixedAtom("sk_1", 2, 1),
  ...mixedAtom("sk_2", 0, 2),
  ...mixedAtom("sk_3", 1, 1),
  ...mixedAtom("sk_4", 0, 4),
  ...mixedAtom("sk_5", 1, 1),
  ...mixedAtom("sk_6", 3, 4),
];

// Six clusters, one of them carrying three positives while the other five carry one
// each: no packing can give five folds an equal share of label 1.
const skewedAtoms: ClusteredCalibrationSample[] = [
  ...samplesFrom(chainedClusters(FOLDS + 1)),
  { id: "extra_a", clusterRoot: "h_0_0", rawScore: 0.9, label: 1 },
  { id: "extra_b", clusterRoot: "h_0_0", rawScore: 0.9, label: 1 },
];

function balanceOf(
  stratification: { balance: readonly { label: 0 | 1 }[] },
  label: 0 | 1,
): FoldClassBalance {
  const found = stratification.balance.find(
    (balance) => balance.label === label,
  );
  if (found === undefined) throw new Error(`no balance for label ${label}`);
  return found as FoldClassBalance;
}

function foldIndexById(
  samples: readonly ClusteredCalibrationSample[],
  seed: number,
): Map<string, number> {
  return new Map(
    createClusteredFolds(samples, seed).folds.flatMap((fold, index) =>
      fold.validation.map((sample) => [sample.id, index] as const),
    ),
  );
}

describe("selectCandidateSummary", () => {
  it("reads its bound, tolerance and tie-break order from the frozen policy", () => {
    // The rule used to carry a 0.002 "Platt preference margin" as a loose constant,
    // 20x the frozen tolerance, while the policy module's own contract says the
    // settled values may not be repeated in code. These are the frozen ones it needs.
    expect(TIE_TOLERANCE).toBe(1e-4);
    expect(TIE_BREAK_ORDER).toEqual(["platt", "beta", "isotonic"]);
    expect(PREREGISTRATION_V4.calibrator.candidates).toEqual(TIE_BREAK_ORDER);
    // And the ECE admission's budget, which is NOT frozen as a selection rule: it is
    // adopted from the release gate so the selection never prefers a calibrator the
    // gate would reject. The gate's BOUND is deliberately not adopted.
    expect(ECE_MAXIMUM).toBe(0.05);
    expect(PREREGISTRATION_V4.calibrationGate.eceBound).toBe(
      "bootstrap-simultaneous-upper",
    );
  });

  it("breaks a Brier tie inside the frozen tolerance by the frozen order", () => {
    // isotonic is nominally lowest, platt is 5e-5 behind it — inside 1e-4, so the
    // two are TIED and `tieBreakOrder` puts platt first. beta is dropped on ECE.
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece: 0.03 },
      { kind: "platt", brier: 0.10005, ece: 0.04 },
      { kind: "beta", brier: 0.099, ece: 0.06 },
    ]);
    expect(selected.kind).toBe("platt");
  });

  it("does NOT hand a tie to Platt for a gap the frozen tolerance calls a real difference", () => {
    // The exact case the replaced rule got wrong: platt is 0.0019 behind isotonic,
    // inside the old 0.002 margin and 19x OUTSIDE the frozen 1e-4 tolerance. It is
    // not a tie, so the smallest Brier wins outright.
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece: 0.03 },
      { kind: "platt", brier: 0.1019, ece: 0.04 },
    ]);
    expect(selected.kind).toBe("isotonic");
  });

  it("lets beta win a tie against a marginally lower isotonic", () => {
    // The other half of `tieBreakOrder`, which a Platt-only preference could not
    // express at all: beta precedes isotonic, so a tie between them goes to beta
    // even though isotonic's Brier is the smaller number.
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece: 0.03 },
      { kind: "beta", brier: 0.10005, ece: 0.03 },
      { kind: "platt", brier: 0.3, ece: 0.03 },
    ]);
    expect(selected.kind).toBe("beta");
  });

  it("lets the module's ECE admission override the frozen smallest-Brier rule", () => {
    // Stated as the override it is: beta has the smallest Brier by a wide margin and
    // still loses, because its ECE is inadmissible. The frozen calibrator row says
    // only "vence menor Brier OOF" — this constraint is imposed by cross-validation.ts
    // and takes its budget from `calibrationGate.eceMax` rather than inventing one.
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece: 0.03 },
      { kind: "platt", brier: 0.2, ece: 0.04 },
      { kind: "beta", brier: 0.05, ece: 0.06 },
    ]);
    expect(selected.kind).toBe("isotonic");
  });

  it("refuses a non-finite score instead of returning undefined under its own return type", () => {
    // `Math.min` over a NaN yields NaN, `NaN <= tolerance` is false, the tie set comes
    // out empty and `[...tied].sort(...)[0]` is `undefined` — which the signature says
    // is a `T`. Measured before the guard: `selectCalibrator` would then throw a bare
    // TypeError reading `.kind` instead of this module's coded error.
    expect(() =>
      selectCandidateSummary([
        { kind: "platt", brier: Number.NaN, ece: 0.01 },
        { kind: "isotonic", brier: 0.1, ece: 0.01 },
      ]),
    ).toThrow(CalibrationSelectionError);
    expect(() =>
      selectCandidateSummary([
        { kind: "platt", brier: Number.POSITIVE_INFINITY, ece: 0.01 },
        { kind: "beta", brier: Number.POSITIVE_INFINITY, ece: 0.01 },
        { kind: "isotonic", brier: Number.POSITIVE_INFINITY, ece: 0.01 },
      ]),
    ).toThrow(/non-finite/u);
    expect(() =>
      selectCandidateSummary([
        { kind: "platt", brier: 0.1, ece: Number.NaN },
        { kind: "isotonic", brier: 0.2, ece: 0.01 },
      ]),
    ).toThrow(/non-finite/u);
  });

  it("throws a coded error when no candidate satisfies the ECE admission this module imposes", () => {
    expect(() =>
      selectCandidateSummary([
        { kind: "platt", brier: 0.1, ece: 0.09 },
        { kind: "beta", brier: 0.1, ece: 0.2 },
        { kind: "isotonic", brier: 0.1, ece: 0.051 },
      ]),
    ).toThrow(CalibrationSelectionError);
  });
});

describe("clusterRootsOf", () => {
  // The module header names the relation `domainSource` and `sourceMaterialBatch` are
  // REGISTERED to carry — the one between acquisitions — instead of a cell-to-cell one,
  // which under a one-cell frame has no pair to hold between. The retired phrasing is
  // avoided here on purpose: the sweep in benchmark/tests/split-audit.test.ts refuses it in
  // ANY casing, and prose that quotes it to reject it would be reported as a site. A named
  // field is
  // read here so that sentence cannot go stale while the suite stays green: a frame
  // that renamed its dependency axis, or that unioned on it, would leave the header
  // describing a registration the policy no longer makes.
  it("names the registered dependence the header defers to, read from the policy", () => {
    expect(PREREGISTRATION_V4.connectivity.dependencyAxis).toBe(
      "sourceMaterialBatch",
    );
    expect(PREREGISTRATION_V4.connectivity.splitUnionsOnDependencyAxis).toBe(
      false,
    );
    // And the axis is absent from the union list, which is what makes "they span every
    // fold" true rather than merely asserted: an axis the splitter grouped by could not
    // span a fold at all.
    expect(
      PREREGISTRATION_V4.connectivity.splitUnionAxes as readonly string[],
    ).not.toContain(PREREGISTRATION_V4.connectivity.dependencyAxis);
  });

  it("reads the TWO premises the header rests on: one quota cell and one stocked snapshot", () => {
    // The header says "This frame declares one quota cell and one stocked snapshot", and
    // everything it concludes from that — one identity per axis across `human`, a registered
    // relation with no live pair, readmission as what activates it — is false the moment
    // either count moves. Neither premise was read by anything, so the paragraph could have
    // gone stale with the whole suite green.
    //
    // The reach, stated rather than overclaimed: these are DOCUMENTATION pins, not the
    // discriminating guard. An incomplete amendment never reaches them — the parser refuses a
    // frame whose json and frozen literals disagree, and measured, a two-cell json plus a
    // two-cell `FROZEN_QUOTA_AXIS_CELLS` still fails to import because other frozen literals
    // of the same block reject it first. What these two assertions buy is that a COMPLETE
    // amendment, one that satisfied every literal, still cannot land without this paragraph
    // being read: the sentence is handed to whoever moved the frame instead of surviving as
    // prose about a frame that is gone.
    expect(PREREGISTRATION_V4.preRegistration.quotaAxis.cells).toHaveLength(1);
    expect(PREREGISTRATION_V4.humanSources.snapshots).toHaveLength(1);
  });

  it("atomises by the CONNECTED COMPONENT of two axes, not by either axis alone", () => {
    // On `isolatedChain` the ONLY relation between row 0 and row 2 is the two-hop
    // chain: author joins 0-1, source joins 1-2, and every other axis is per-row.
    const trio = isolatedChain("iso");
    const joined = clusterRootsOf(trio);
    const first = joined.get("h_iso_0");
    expect(first).toBeDefined();
    expect(joined.get("h_iso_1")).toBe(first);
    expect(joined.get("h_iso_2")).toBe(first);

    // ...and REMOVING the middle row is what makes the chain load-bearing rather
    // than decorative: without row 1, rows 0 and 2 share nothing and must fall into
    // different atoms. Without this half, a fixture that unions the trio through one
    // shared axis would pass the assertions above just as well.
    const broken = clusterRootsOf([trio[0], trio[2]]);
    expect(broken.get("h_iso_0")).not.toBe(broken.get("h_iso_2"));

    // Two such trios stay two atoms, so the union is not simply collapsing the
    // whole record set.
    const twoTrios = clusterRootsOf([...trio, ...isolatedChain("jso")]);
    expect(new Set(twoTrios.values()).size).toBe(2);
  });

  it("keeps the realistic per-cluster fixture whole, through the axes it really shares", () => {
    // The fold fixture, stated for what it IS: each trio shares an author/source
    // chain, and the per-cluster `domainSource` and `collectionBatch` union nothing
    // because the splitter does not group by them. So the trio is whole through the
    // chain's transitive closure, which is the same relation the claim above rests on.
    const rootById = clusterRootsOf(chainedRecords);
    for (let cluster = 0; cluster < FOLDS; cluster += 1) {
      const first = rootById.get(`h_${cluster}_0`);
      expect(first).toBeDefined();
      expect(rootById.get(`h_${cluster}_1`)).toBe(first);
      expect(rootById.get(`h_${cluster}_2`)).toBe(first);
    }
    expect(new Set(rootById.values()).size).toBe(FOLDS);
  });

  it("refuses a mandatory axis in state unknown and accepts notApplicable", () => {
    const withUnknown = [
      validateBenchmarkRecordV3(
        withAxis(
          { ...v3Human(), id: "h_unknown_1" },
          "source",
          unknownAxis("the thread id was not recovered from the dump"),
        ),
      ),
      ...chainedRecords,
    ];
    expect(() => clusterRootsOf(withUnknown)).toThrow(ClusterFoldError);
    expect(() => clusterRootsOf(withUnknown)).toThrow(/source/u);

    // `notApplicable` is legitimate and must NOT fail: a collectively written page
    // has no single author, and generated text has no human author at all.
    const withNotApplicable = [
      validateBenchmarkRecordV3(
        withAxis(
          { ...v3Human(), id: "h_anonymous_1" },
          "author",
          notApplicable("collectively written page: no single author"),
        ),
      ),
      ...chainedRecords,
    ];
    expect(() => clusterRootsOf(withNotApplicable)).not.toThrow();
  });

  it("refuses the generation batch left unknown, because it is a v4 union axis too", () => {
    // `CLUSTER_ATOM_AXES` is `CONNECTIVITY_AXES`: six names, the five value axes plus
    // the linkage-only `humanSeed`. `generationBatch` is the one v4 added to them, so it
    // has to make the atom unknowable exactly like the other five. Written
    // over `mixed-ecological` because that is the ONE cohort the state table lets write
    // `unknown` on this axis: on an `ai` row it is a validator error, so a fixture there
    // would be refused a stage earlier and would measure the validator instead.
    let raw: Record<string, unknown> = {
      ...v4MixedEcological(),
      id: "m_eco_batch_unknown",
    };
    raw = withAxis(
      raw,
      "generationBatch",
      unknownAxis(
        "the coauthor's tool ran outside our recipes and named no batch",
      ),
    );
    const ecological = validateBenchmarkRecordV4(
      raw,
    ) as unknown as BenchmarkRecord;

    expect(() => clusterRootsOf([ecological])).toThrow(ClusterFoldError);
    expect(() => clusterRootsOf([ecological])).toThrow(
      /groups\.generationBatch/u,
    );
    expect(() => clusterRootsOf([ecological])).toThrow(/m_eco_batch_unknown/u);
    // Non-vacuous in the other direction: `notApplicable` on the same axis and cohort
    // is legitimate and must pass, so the refusal is about the STATE and not the axis.
    const notOurs = validateBenchmarkRecordV4(
      v4MixedEcological(),
    ) as unknown as BenchmarkRecord;
    expect(() => clusterRootsOf([notOurs])).not.toThrow();
  });

  it("does NOT join two rows grown from the same ABSENT lineage seed, and that is measured here rather than assumed away", () => {
    // The atom is `connectedComponentRoots`, where `humanSeed` and `derivationRoot`
    // are PARENT LINKAGE: they union a row with the row they name, and only when
    // that row is present in the same record set. C2 measured 782 of 783 parent
    // references resolving to no assembled row, so for the corpus that exists this
    // relation usually unions nothing. The exposure ledger uses the STRONGER
    // reading for those two axes — a value axis in a lineage MAC domain, where two
    // rows naming the same absent seed collide on purpose.
    //
    // The cross-validation therefore inherits the weaker notion, and this test
    // exists so nobody reads sampling independence off the fold construction: two
    // generations from one human prompt whose row was never assembled can land in
    // different folds. Whether `humanSeed` should also be a value axis is E2/E3's,
    // and is deliberately not decided here.
    const shared = "h_absent_parent";
    const generated = [0, 1].map((index) => {
      let raw: Record<string, unknown> = {
        ...v3Ai(),
        id: `a_lineage_${index}`,
      };
      raw = withAxis(raw, "humanSeed", known(shared));
      raw = withAxis(raw, "domainSource", known(`ds_lineage_${index}`));
      raw = withAxis(raw, "promptTemplate", known(`pt_lineage_${index}`));
      raw = withAxis(raw, "generatorVersion", known(`gv_lineage_${index}`));
      raw = withAxis(raw, "collectionBatch", known(`cb_lineage_${index}`));
      raw = withAxis(raw, "nearDuplicate", known(`nd_lineage_${index}`));
      return validateBenchmarkRecordV3(raw);
    });

    const rootById = clusterRootsOf(generated);
    expect(rootById.get("a_lineage_0")).not.toBe(rootById.get("a_lineage_1"));

    // With the parent row PRESENT the same two rows become one atom, which is what
    // makes the sentence above a statement about co-presence and not about the axis.
    const withParent = [
      ...generated,
      validateBenchmarkRecordV3({ ...v3Human(), id: shared }),
    ];
    const joined = clusterRootsOf(withParent);
    expect(joined.get("a_lineage_0")).toBe(joined.get("a_lineage_1"));
  });
});

describe("createClusteredFolds", () => {
  it("refuses an empty population, and says so as a population fact", () => {
    // Populacao vazia nao e "corpus pequeno para cinco dobras" — essa recusa e
    // CLUSTERS_BELOW_FOLDS. Aqui nao ha atomo algum, entao nao existe dobramento a definir.
    expect(() => createClusteredFolds([], CV_SEED)).toThrow(ClusterFoldError);
    expect(() => createClusteredFolds([], CV_SEED)).toThrow(
      /at least one record-line/u,
    );
  });

  it("never lets a split/exposure cluster span a fold's train and validation halves", () => {
    const { folds } = createClusteredFolds(chainedSamples, CV_SEED);

    const validationIds = folds.flatMap((fold) =>
      fold.validation.map((sample) => sample.id),
    );
    expect(validationIds).toHaveLength(chainedSamples.length);
    expect(new Set(validationIds).size).toBe(chainedSamples.length);

    for (const fold of folds) {
      const validationClusters = new Set(
        fold.validation.map((sample) => sample.clusterRoot),
      );
      const trainClusters = new Set(
        fold.train.map((sample) => sample.clusterRoot),
      );
      for (const cluster of validationClusters) {
        expect(trainClusters.has(cluster)).toBe(false);
      }
      expect(fold.train.length + fold.validation.length).toBe(
        chainedSamples.length,
      );
      expect(fold.validation.length).toBeGreaterThan(0);
      expect(fold.train.length).toBeGreaterThan(0);
    }
  });

  it("forms exactly the frozen number of folds and takes no fold-count argument", () => {
    expect(FOLDS).toBe(5);
    const { folds, stratification } = createClusteredFolds(
      chainedSamples,
      CV_SEED,
    );
    expect(folds).toHaveLength(FOLDS);
    expect(stratification.folds).toBe(FOLDS);
    // `(samples, seed)` and nothing else: there is no argument through which a
    // caller could ask for another number of folds.
    expect(createClusteredFolds).toHaveLength(2);
  });

  it("is deterministic under the frozen cross-validation seed, and the seed is load-bearing", () => {
    expect(CV_SEED).toBe(20260727);
    expect(createClusteredFolds(chainedSamples, CV_SEED)).toEqual(
      createClusteredFolds(chainedSamples, CV_SEED),
    );
    // Permuting the input cannot move a cluster: the assignment is a function of
    // the hashed pseudonymised cluster id and the seed, never of arrival order.
    const byId = foldIndexById(chainedSamples, CV_SEED);
    expect(foldIndexById([...chainedSamples].reverse(), CV_SEED)).toEqual(byId);
    expect(foldIndexById(chainedSamples, CV_SEED + 1)).not.toEqual(byId);
  });

  it("returns the same object bit for bit under a permuted input, halves included", () => {
    // MEMBERSHIP invariance (the test above) is the weaker claim, and the header used
    // to state the stronger one while only the weaker was true: member order inside a
    // half followed arrival order, so the whole object was not equal under reversal —
    // measured `false` before both halves were sorted by record-line id.
    for (const samples of [chainedSamples, classSkewedAtoms]) {
      expect(createClusteredFolds([...samples].reverse(), CV_SEED)).toEqual(
        createClusteredFolds(samples, CV_SEED),
      );
    }
  });

  it("refuses a repeated record-line id, which would make the member order arbitrary", () => {
    const duplicated = [...chainedSamples, chainedSamples[0]];
    expect(() => createClusteredFolds(duplicated, CV_SEED)).toThrow(
      ClusterFoldError,
    );
    expect(() => createClusteredFolds(duplicated, CV_SEED)).toThrow(
      /DUPLICATE_ID/u,
    );
  });

  it("stratifies by class where a class-blind packing of the same atoms could not", () => {
    // THE test of requirement 1/4, and the one this file did not have. Ten atoms of
    // the SAME size — five carrying three positives and nothing else, five carrying
    // three negatives and nothing else — so a packer balancing record COUNT balances
    // nothing about class, while a class-aware one can reach a perfect split.
    //
    // On the earlier packer, which compared the folds' running load and never looked
    // at what it was placing, this fixture measured negatives per fold of
    // [3, 3, 6, 3, 0] at a deviation of 0.2: one validation half with no negative in
    // it at all. Any fixture whose atoms share a class composition — and both of the
    // others in this file do — reports 0 for a class-blind packer just as happily.
    const { stratification } = createClusteredFolds(classSkewedAtoms, CV_SEED);
    expect(stratification.clusters).toBe(10);
    expect(stratification.items).toBe(30);
    expect(stratification.perRecordLineAtoms).toBe(false);

    const positives = balanceOf(stratification, 1);
    const negatives = balanceOf(stratification, 0);
    // Exact per-fold counts, not a tolerance: one all-positive and one all-negative
    // atom per fold is the only packing that reaches these numbers.
    expect(positives.perFold).toEqual([3, 3, 3, 3, 3]);
    expect(negatives.perFold).toEqual([3, 3, 3, 3, 3]);
    expect(positives.deviation).toBe(0);
    expect(negatives.deviation).toBe(0);
    expect(stratification.oversizedClusters).toEqual([]);
  });

  it.each(Object.keys(unevenAtomShapes))(
    "fills every fold with every present class when the atoms are UNEQUAL in size: %s",
    (shape) => {
      // The regression the previous packing rule needed and the suite could not see.
      // `classSkewedAtoms` above has ten same-size atoms of alternating composition,
      // which is the one shape where scoring only the receiving fold's squared error
      // is perfect. Give the atoms unequal sizes and clumped class composition and
      // that rule scored each fold on the class deficit the atom could NOT reduce —
      // an empty fold looked worst — so it filled one fold at a time. All four of
      // these threw CROSS_VALIDATION_FOLD_HALF_EMPTY under it.
      const samples = unevenAtomShapes[shape];
      const { folds, stratification } = createClusteredFolds(samples, CV_SEED);
      const present = ([0, 1] as const).filter((label) =>
        samples.some((sample) => sample.label === label),
      );
      expect(present).toEqual([0, 1]);
      expect(folds).toHaveLength(FOLDS);
      for (const fold of folds) {
        expect(fold.validation.length).toBeGreaterThan(0);
        expect(fold.train.length).toBeGreaterThan(0);
        for (const label of present) {
          // Both halves: a validation half with no negative measures the FPR of
          // nothing, and a training half with one class fits a constant.
          expect(fold.validation.some((sample) => sample.label === label)).toBe(
            true,
          );
          expect(fold.train.some((sample) => sample.label === label)).toBe(
            true,
          );
        }
      }
      // ...and whatever imbalance is left is the atoms', not the packer's. No slack:
      // the published field is clamped at zero, and the ulp by which `deviation` and
      // `deviationFloor` can cross when the packing sits exactly at the floor is the
      // subject of its own test below.
      for (const balance of stratification.balance) {
        expect(balance.excessOverFloor).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it("puts both classes in every validation half under class imbalance, and the cost weights are what do it", () => {
    // The pin the packing rule did not have. Two mutations of `bestFoldIndex` that
    // MOVE which fold a record-line lands in left the whole file green, so the
    // determinism this module contracts rested on nothing:
    //
    //   * dropping the equal-cost tie-break on the smaller resulting fold, keeping
    //     `cost < bestCost` alone;
    //   * normalising a class weight by `total` instead of `total ** 2`.
    //
    // Both need a population with mixed-class atoms and unequal class totals to be
    // visible at all (see `imbalancedMixedAtoms`), and on this one both empty fold 1 of
    // positives — `[3, 0, 3, 2, 2]` without the tie-break, `[3, 0, 3, 3, 1]` under the
    // linear weight — which is a validation half that measures the recall of nothing.
    const { folds, stratification } = createClusteredFolds(
      imbalancedMixedAtoms,
      CV_SEED,
    );
    expect(stratification.clusters).toBe(7);
    expect(stratification.items).toBe(24);

    const positives = balanceOf(stratification, 1);
    const negatives = balanceOf(stratification, 0);
    expect(positives.total).toBe(10);
    expect(negatives.total).toBe(14);
    // Exact counts in fold order, in the style of the `[3, 3, 3, 3, 3]` above: fold
    // membership is contracted as a function of the population and the seed alone, so
    // there is nothing here to state as a tolerance.
    expect(positives.perFold).toEqual([3, 1, 3, 2, 1]);
    expect(negatives.perFold).toEqual([4, 5, 1, 1, 3]);

    // ...and the consequence that makes those counts worth pinning.
    for (const fold of folds) {
      expect(fold.validation.some((sample) => sample.label === 1)).toBe(true);
      expect(fold.validation.some((sample) => sample.label === 0)).toBe(true);
    }
  });

  it("leaves no fold empty while atoms remain, which is a property of the cost and not a tendency", () => {
    // `bestFoldIndex`'s second documented property, asserted directly: every term of
    // its cost is non-negative and an empty fold's counts are all zero, so an empty
    // fold's cost is exactly 0 — the minimum available — and it also wins the
    // smaller-fold tie-break. With `CLUSTERS_BELOW_FOLDS` already refusing fewer
    // atoms than folds, the first FOLDS atoms therefore land one per fold.
    //
    // The witness is the hardest case for it: ONE atom carrying almost everything,
    // with exactly FOLDS atoms in total, so there is no slack anywhere. Every atom
    // carries both classes because `CLASS_CLUSTERS_BELOW_FOLDS` needs each class in
    // at least FOLDS atoms, and with FOLDS atoms in total that leaves no choice.
    const whale = [
      ...labelledAtom("whale", 0, 38),
      {
        id: "whale_p0",
        clusterRoot: "whale",
        rawScore: 0.9,
        label: 1 as const,
      },
      {
        id: "whale_p1",
        clusterRoot: "whale",
        rawScore: 0.9,
        label: 1 as const,
      },
    ];
    const barelyEnough = [
      ...whale,
      ...[1, 2, 3, 4].flatMap((atom) => [
        {
          id: `pair_${atom}_p`,
          clusterRoot: `pair_${atom}`,
          rawScore: 0.9,
          label: 1 as const,
        },
        {
          id: `pair_${atom}_n`,
          clusterRoot: `pair_${atom}`,
          rawScore: 0.1,
          label: 0 as const,
        },
      ]),
    ];
    const { folds } = createClusteredFolds(barelyEnough, CV_SEED);
    expect(
      folds.map((fold) => fold.validation.length).sort((a, b) => a - b),
    ).toEqual([2, 2, 2, 2, 40]);
  });

  it("keeps the deviation floor BELOW the deviation actually achieved, on every fixture", () => {
    // The invariant that makes `deviationFloor` a floor at all, and the one the field
    // it replaced broke: `attainable` was the SUM of two lower bounds, so it read
    // 0.08 (label 0) and 0.16 (label 1) on `chainedSamples` whose measured deviation
    // is 0 — a floor above an achieved value, published next to a `withinAttainable`
    // flag that therefore meant nothing.
    for (const samples of [chainedSamples, classSkewedAtoms, skewedAtoms]) {
      const { stratification } = createClusteredFolds(samples, CV_SEED);
      for (const balance of stratification.balance) {
        expect(balance.perFold).toHaveLength(FOLDS);
        expect(balance.deviation).toBeGreaterThanOrEqual(
          balance.deviationFloor,
        );
        expect(balance.excessOverFloor).toBeCloseTo(
          balance.deviation - balance.deviationFloor,
          12,
        );
      }
    }

    // And it is 0, not merely small, where the atoms divide evenly: five atoms of one
    // positive and two negatives over five folds have no residue and no oversized
    // atom, so nothing is unavoidable.
    const { stratification } = createClusteredFolds(chainedSamples, CV_SEED);
    expect(stratification.clusters).toBe(FOLDS);
    expect(stratification.seed).toBe(CV_SEED);
    expect(
      stratification.balance.map((balance) => [
        balance.deviation,
        balance.deviationFloor,
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("publishes an excess of exactly zero where the packing sits ON the floor, which the raw subtraction does not give", () => {
    // `deviation` and `deviationFloor` reach the same rational number through DIFFERENT
    // expressions — `2/6 - 1/5` against `4/(5*6)` — so on a packing that sits exactly at
    // the floor their difference lands one ulp BELOW zero
    // (-2.7755575615628914e-17). Two of the four uneven shapes do exactly that, and the
    // published field used to carry that negative number while its own docstring said
    // "Zero means the packing matched the bound" and `deviationFloor`'s said the
    // invariant is `deviation >= deviationFloor`. A reader cannot hold both against a
    // negative value.
    const onTheFloor: [string, 0 | 1][] = [
      ["a fat negative lineage under a negative-majority population", 1],
      ["two fat positive lineages against a negative-majority tail", 0],
    ];
    for (const [shape, label] of onTheFloor) {
      const { stratification } = createClusteredFolds(
        unevenAtomShapes[shape],
        CV_SEED,
      );
      const balance = balanceOf(stratification, label);
      // The raw subtraction really is negative on these two, without which the clamp
      // below would be asserting nothing.
      expect(balance.deviation - balance.deviationFloor).toBeLessThan(0);
      expect(balance.deviation - balance.deviationFloor).toBeGreaterThan(
        -1e-12,
      );
      expect(balance.excessOverFloor).toBe(0);
    }

    // And nowhere across this file's populations is the published field negative.
    for (const samples of [
      chainedSamples,
      classSkewedAtoms,
      skewedAtoms,
      imbalancedMixedAtoms,
      ...Object.values(unevenAtomShapes),
    ]) {
      for (const balance of createClusteredFolds(samples, CV_SEED)
        .stratification.balance) {
        expect(balance.excessOverFloor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("names a cluster too large for even balancing instead of accepting it silently", () => {
    // The atom that makes the balance unreachable is published rather than absorbed,
    // and the deviation it forces is exactly the floor: three of eight positives in
    // one fold is 0.175 of excess share, which no packing can undercut while the atom
    // stays whole. So this is a corpus fact and NOT the packer's failure, and
    // `excessOverFloor === 0` is what says so.
    const { stratification } = createClusteredFolds(skewedAtoms, CV_SEED);
    expect(stratification.oversizedClusters).toHaveLength(1);
    expect(stratification.oversizedClusters[0]).toMatchObject({
      clusterRoot: "h_0_0",
      label: 1,
      records: 3,
    });
    const positives = balanceOf(stratification, 1);
    expect(positives.total).toBe(8);
    expect(positives.deviation).toBeGreaterThan(0);
    expect(positives.deviationFloor).toBeCloseTo(3 / 8 - 1 / FOLDS, 12);
    expect(positives.excessOverFloor).toBeCloseTo(0, 12);
  });

  it("publishes an all-singleton population as the per-record-line degeneration it is", () => {
    // A caller that synthesises `clusterRoot` from the record-line id gets exactly
    // this, and no guard here can refuse it: R6 allows a legitimately all-singleton
    // axis, so the fold builder publishes the fact instead of throwing.
    const singletons = chainedSamples.map((sample) => ({
      ...sample,
      clusterRoot: sample.id,
    }));
    const { stratification } = createClusteredFolds(singletons, CV_SEED);
    expect(stratification.clusters).toBe(stratification.items);
    expect(stratification.perRecordLineAtoms).toBe(true);
    // ...and a genuinely grouped population says the opposite.
    expect(
      createClusteredFolds(chainedSamples, CV_SEED).stratification
        .perRecordLineAtoms,
    ).toBe(false);
  });

  it("refuses fewer clusters than folds instead of degrading to a smaller design", () => {
    const collapsed = chainedSamples.map((sample) => ({
      ...sample,
      clusterRoot: "h_0_0",
    }));
    expect(() => createClusteredFolds(collapsed, CV_SEED)).toThrow(
      ClusterFoldError,
    );
    expect(() => createClusteredFolds(collapsed, CV_SEED)).toThrow(
      /1 cluster/u,
    );
  });

  it("refuses a class that lives in fewer clusters than folds", () => {
    // Every positive inside one atom: label 1 can reach at most one validation
    // half, so four folds would validate no positive at all.
    const skewed = chainedSamples.map((sample) => ({
      ...sample,
      clusterRoot: sample.label === 1 ? "h_0_0" : sample.clusterRoot,
    }));
    expect(() => createClusteredFolds(skewed, CV_SEED)).toThrow(
      ClusterFoldError,
    );
    expect(() => createClusteredFolds(skewed, CV_SEED)).toThrow(/label 1/u);
  });
});

describe("aggregateOutOfFold", () => {
  it("weights every cluster equally, so a fat cluster cannot dominate the Brier", () => {
    // One cluster of 99 perfect rows and one cluster of a single wrong row. Row
    // weighting would report a Brier near 0.01; equal weights per cluster report
    // the mean of the two cluster Briers, which is near 0.5.
    const rows = [
      ...Array.from({ length: 99 }, (_unused, index) => ({
        id: `big_${index}`,
        clusterRoot: "c_big",
        prediction: 1,
        label: 1 as const,
      })),
      {
        id: "small_0",
        clusterRoot: "c_small",
        prediction: 0,
        label: 1 as const,
      },
    ];
    const aggregate = aggregateOutOfFold(rows);
    expect(aggregate.clusters).toBe(2);
    expect(aggregate.brier).toBeCloseTo(0.5, 12);
    expect(aggregate.ece).toBeCloseTo(0.5, 12);
  });

  it("measures the ECE with the frozen bin count AND the frozen binning", () => {
    // Sixteen equally weighted rows, one cluster each. Under EQUAL-MASS binning with
    // the frozen fifteen bins, sixteen rows cannot each own a bin: ranks 7 and 8 share
    // bin 7 (their weight-interval midpoints are 7.03/15 and 7.97/15). Those two rows
    // are chosen to cancel exactly inside that bin — mean score 0.5 against mean label
    // 0.5 — while every other bin holds one perfectly calibrated row. So the expected
    // ECE is 0.
    //
    // It is 0 for one bin count and one binning only, which is the point:
    //   * fixed-width over [0,1] with the same fifteen bins puts 0.4 and 0.6 in bins 6
    //     and 9, each alone, and measures 0.075 — this test was green under that
    //     estimator, which took its bin COUNT from a policy block that pins
    //     `eceBinning: "equal-mass"`;
    //   * equal-mass with EIGHT bins separates ranks 7 and 8 (3.75/8 and 4.25/8) and
    //     measures 0.075 as well.
    // A bin count silently regressing to a literal, or the binning diverging from the
    // policy, therefore fails here rather than passing unnoticed.
    const rows = [
      ...Array.from({ length: 7 }, (_unused, index) => ({
        id: `r_0${index}`,
        clusterRoot: `c_0${index}`,
        prediction: 0,
        label: 0 as const,
      })),
      { id: "r_07", clusterRoot: "c_07", prediction: 0.4, label: 1 as const },
      { id: "r_08", clusterRoot: "c_08", prediction: 0.6, label: 0 as const },
      ...Array.from({ length: 7 }, (_unused, index) => ({
        id: `r_${9 + index}`,
        clusterRoot: `c_${9 + index}`,
        prediction: 1,
        label: 1 as const,
      })),
    ];
    const aggregate = aggregateOutOfFold(rows);
    expect(aggregate.clusters).toBe(16);
    expect(aggregate.eceBins).toBe(PREREGISTRATION_V4.calibrationGate.eceBins);
    expect(aggregate.eceBinning).toBe(
      PREREGISTRATION_V4.calibrationGate.eceBinning,
    );
    expect(aggregate.ece).toBeCloseTo(0, 12);
  });

  it("does not depend on the order the out-of-fold rows arrive in, on a fixture big enough to tell", () => {
    // The three-row fixture this replaced could not tell: its sums are FP-exact either
    // way, so it was green while `aggregateOutOfFold` accumulated the Brier in Map
    // insertion order and each score group in arrival order — invariant only up to
    // floating point, which is the very thing `createClusteredFolds` sorts its halves
    // to avoid. 111 rows over 23 clusters of unequal size, with predictions on a /97
    // grid, is a fixture where it matters: measured before the fix, reversing the input
    // moved the Brier (0.27438300414394073 vs 0.2743830041439407) AND the ECE
    // (0.2306558735850531 vs 0.23065587358505313).
    const rows: {
      id: string;
      clusterRoot: string;
      prediction: number;
      label: 0 | 1;
    }[] = [];
    for (let cluster = 0; cluster < 23; cluster += 1) {
      const size = 1 + ((cluster * 7) % 9);
      for (let row = 0; row < size; row += 1) {
        rows.push({
          id: `w_${cluster}_${row}`,
          clusterRoot: `cw_${cluster}`,
          prediction: ((cluster * 31 + row * 17) % 97) / 97,
          label: (cluster + row) % 3 === 0 ? 1 : 0,
        });
      }
    }
    expect(rows).toHaveLength(111);
    const forward = aggregateOutOfFold(rows);
    expect(forward.clusters).toBe(23);
    // Bit-for-bit, not `toBeCloseTo`: the whole point is the last digit.
    expect(aggregateOutOfFold([...rows].reverse())).toEqual(forward);
    expect(
      aggregateOutOfFold([...rows].sort((a, b) => (a.id < b.id ? 1 : -1))),
    ).toEqual(forward);

    // A THIRD permutation, which the 111 rows above cannot see: reversing the rows
    // INSIDE each cluster while leaving the grouping — and the order the clusters appear
    // in — untouched. Two sorts make this function order-invariant, the sorted visit of
    // roots and the sorted visit of rows within a root, and only the first is load-bearing
    // for the two permutations above: with the in-cluster sort removed and the root sort
    // kept, both stay green, because the fixture's clusters run 1 to 9 rows and their sums
    // of squared residuals are FP-exact in either direction. That is the same weakness the
    // three-row fixture had, one size up.
    //
    // Seven clusters of 2 to 23 rows, predictions on a /9973 grid, is where it bites:
    // the per-cluster sum of squared residuals moves in the last digit
    // (0.4043546072652704 against 0.40435460726527045) when the rows arrive reversed
    // inside the cluster. The ECE cannot see this permutation at all — its groups are
    // keyed by exact score and every row of one cluster carries the same weight, so the
    // addends of a group are re-ordered only by the cluster visit — which is why the
    // in-cluster sort is what the BRIER needs.
    const deep: OutOfFoldPrediction[] = [];
    for (let cluster = 0; cluster < 7; cluster += 1) {
      const size = 2 + ((cluster * 7) % 24);
      for (let row = 0; row < size; row += 1) {
        deep.push({
          id: `d_${cluster}_${String(row).padStart(2, "0")}`,
          clusterRoot: `cd_${cluster}`,
          // Integer arithmetic and one division by a prime: the value is the same on
          // every engine, and it is NOT a dyadic rational, so the sums are inexact.
          prediction: ((cluster * 7919 + row * 104729) % 9973) / 9973,
          label: ((cluster * 5 + row * 3) % 4 === 0 ? 1 : 0) as 0 | 1,
        });
      }
    }
    expect(deep).toHaveLength(89);
    const deepForward = aggregateOutOfFold(deep);
    expect(deepForward.clusters).toBe(7);

    const reverseInsideClusters = (
      original: readonly OutOfFoldPrediction[],
    ): OutOfFoldPrediction[] => {
      const byCluster = new Map<string, OutOfFoldPrediction[]>();
      for (const row of original) {
        const bucket = byCluster.get(row.clusterRoot);
        if (bucket === undefined) byCluster.set(row.clusterRoot, [row]);
        else bucket.push(row);
      }
      return [...byCluster.values()].flatMap((bucket) => [...bucket].reverse());
    };
    const inCluster = reverseInsideClusters(deep);
    // The permutation is the one claimed: every position still holds the same cluster,
    // so nothing here is testing a regrouping.
    expect(inCluster.map((row) => row.clusterRoot)).toEqual(
      deep.map((row) => row.clusterRoot),
    );
    expect(inCluster.map((row) => row.id)).not.toEqual(
      deep.map((row) => row.id),
    );
    expect(aggregateOutOfFold(inCluster)).toEqual(deepForward);
    expect(aggregateOutOfFold([...deep].reverse())).toEqual(deepForward);
  });

  it("is NOT the estimator the release gate reads, and the difference has no reliable sign", () => {
    // Pins the claim this module's header used to get wrong — that adopting
    // `eceBins`/`eceBinning` made the selection "measure the same quantity the gate
    // does under the same binning". The gate reads
    // `metrics.calibration.eceEqualMass15`, computed by `metrics.ts::eceEqualMass`,
    // which SPLITS tied scores at index cut points and weights per ROW. This module
    // groups ties and weights per CLUSTER.
    //
    // Two fixtures, opposite signs, so neither "same quantity" nor "a lower bound on
    // the gate's estimator" can be restated without failing here.
    const asPoints = (
      rows: readonly { prediction: number; label: 0 | 1 }[],
    ): { probability: number; label: 0 | 1 }[] =>
      rows.map((row) => ({ probability: row.prediction, label: row.label }));

    // (1) TIES. Twenty rows all scored 0.5, half positive, one cluster each — so the
    // weights are uniform and only the tie handling differs. Grouped, the tie is one
    // bin whose mean score and mean label are both 0.5, so the ECE is 0. Split across
    // fifteen bins, the alternating label pattern makes bins that are label-pure for
    // rows the model scored identically, and the estimator reports 0.25.
    const tied = Array.from({ length: 20 }, (_unused, index) => ({
      id: `t_${index}`,
      clusterRoot: `ct_${index}`,
      prediction: 0.5,
      label: (index % 2 === 0 ? 1 : 0) as 0 | 1,
    }));
    expect(aggregateOutOfFold(tied).ece).toBeCloseTo(0, 12);
    expect(
      eceEqualMass(asPoints(tied), PREREGISTRATION_V4.calibrationGate.eceBins),
    ).toBeCloseTo(0.25, 12);

    // (2) WEIGHTS, in the other direction. One well-calibrated cluster of sixty rows
    // and five badly calibrated singletons: per-row weights give the singletons 5/65 of
    // the mass and report 0.1, per-cluster weights give them 5/6 and report 0.75. This
    // module's number is the LARGER one here, which is why the direction cannot be
    // stated once and for all.
    const fatCluster = [
      ...Array.from({ length: 60 }, (_unused, index) => ({
        id: `f_${index}`,
        clusterRoot: "c_fat",
        prediction: 0.5,
        label: (index % 2 === 0 ? 1 : 0) as 0 | 1,
      })),
      ...Array.from({ length: 5 }, (_unused, index) => ({
        id: `s_${index}`,
        clusterRoot: `c_s_${index}`,
        prediction: 0.9,
        label: 0 as 0 | 1,
      })),
    ];
    expect(aggregateOutOfFold(fatCluster).ece).toBeCloseTo(0.75, 12);
    expect(
      eceEqualMass(
        asPoints(fatCluster),
        PREREGISTRATION_V4.calibrationGate.eceBins,
      ),
    ).toBeCloseTo(0.1, 12);
  });
});

describe("selectCalibrator", () => {
  it("runs cluster-grouped CV under the frozen seed and refits the winner on the full split", () => {
    const first = selectCalibrator(chainedSamples);
    const second = selectCalibrator(chainedSamples);
    expect(first).toEqual(second);

    expect(first.candidates).toHaveLength(3);
    expect(
      first.candidates.every((candidate) => candidate.foldCount === FOLDS),
    ).toBe(true);
    expect(first.candidates.map((candidate) => candidate.kind)).toContain(
      first.selection.kind,
    );

    // The seed is the frozen CV seed and not a caller-chosen one: `selectCalibrator`
    // has no seed parameter at all.
    expect(selectCalibrator).toHaveLength(1);
    expect(first.stratification.seed).toBe(CV_SEED);
    expect(first.stratification).toEqual(
      createClusteredFolds(chainedSamples, CV_SEED).stratification,
    );

    // The admitted winner obeys the ECE admission...
    expect(first.selection.ece).toBeLessThanOrEqual(ECE_MAXIMUM);
    // ...and the returned model is a refit on ALL calibration samples, not one
    // of the per-fold models. The comparison is against the population in
    // record-line id order, which is the order `selectCalibrator` refits over.
    expect(first.model).toEqual(
      fitCalibrator(
        first.selection.kind,
        [...chainedSamples].sort((a, b) => (a.id < b.id ? -1 : 1)),
      ),
    );
  });

  it("returns the same calibrator bit for bit under a permuted population", () => {
    // The claim the header used to make and the code did not support. Measured before
    // the fix, on `classSkewedAtoms`: reversing the input moved the beta calibrator's
    // coefficients in the last two digits (3.096515557863789 vs 3.0965155578637895),
    // because the fits accumulate floating-point sums over the array and FP addition
    // is not associative. That moves the sealed `calibrators` block, and therefore
    // `artifactDigest`, for one and the same corpus.
    for (const samples of [chainedSamples, classSkewedAtoms]) {
      expect(selectCalibrator([...samples].reverse())).toEqual(
        selectCalibrator(samples),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// `TRAIN_MISSING_LABEL`: busca limitada por testemunha.
//
// A guarda estava listada como dívida sem prova de inalcançabilidade. A leitura do empacotador dá
// um argumento — para um átomo de classe pura o custo é
// `peso_da_classe × acumulado_daquela_classe_na_dobra`, então o guloso põe cada um onde há MENOS
// daquela classe, o que os espalha — mas o fechamento depende de uma propriedade ao longo de uma
// SEQUÊNCIA de colocações, e `bestFoldIndex` declara que otimalidade global não é reivindicada.
//
// Então em vez de declarar prova, mede-se: busca EXAUSTIVA num espaço declarado. Não achar
// testemunha é evidência, não prova, e o teste diz isso no nome e no comentário.
// ---------------------------------------------------------------------------

describe("TRAIN_MISSING_LABEL — busca limitada por testemunha", () => {
  it("não encontra população admissível que deixe uma dobra sem classe no treino", () => {
    // O espaço: N átomos, de FOLDS a FOLDS+3, cada um puro-positivo, puro-negativo ou misto.
    // Cada classe tem de aparecer em pelo menos FOLDS átomos — senão a recusa vem de
    // `CLASS_CLUSTERS_BELOW_FOLDS` e a busca mediria outra guarda.
    const MAX_ATOMOS = FOLDS + 3;
    let admissiveis = 0;
    let aceitas = 0;
    const porCodigo = new Map<string, number>();
    const testemunhas: string[] = [];

    for (let n = FOLDS; n <= MAX_ATOMOS; n += 1) {
      const combinacoes = 3 ** n;
      for (let mascara = 0; mascara < combinacoes; mascara += 1) {
        const tipos: number[] = [];
        let resto = mascara;
        for (let i = 0; i < n; i += 1) {
          tipos.push(resto % 3);
          resto = Math.floor(resto / 3);
        }
        // 0 = puro-positivo, 1 = puro-negativo, 2 = misto.
        const comPositivo = tipos.filter((tipo) => tipo !== 1).length;
        const comNegativo = tipos.filter((tipo) => tipo !== 0).length;
        if (comPositivo < FOLDS || comNegativo < FOLDS) continue;
        admissiveis += 1;

        const amostras: ClusteredCalibrationSample[] = [];
        tipos.forEach((tipo, indice) => {
          const raiz = `atomo_${n}_${mascara}_${indice}`;
          const adicionar = (rotulo: 0 | 1, sufixo: string): void => {
            amostras.push({
              id: `${raiz}_${sufixo}`,
              clusterRoot: raiz,
              rawScore: rotulo === 1 ? 0.9 : 0.1,
              label: rotulo,
            });
          };
          if (tipo === 0) adicionar(1, "p");
          else if (tipo === 1) adicionar(0, "n");
          else {
            adicionar(1, "p");
            adicionar(0, "n");
          }
        });

        try {
          createClusteredFolds(amostras, CV_SEED);
          aceitas += 1;
        } catch (erro) {
          const codigo = (erro as { code?: string }).code ?? "SEM_CODIGO";
          porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + 1);
          if (codigo === "TRAIN_MISSING_LABEL") {
            testemunhas.push(
              `n=${n} mascara=${mascara} tipos=${tipos.join("")}`,
            );
          }
        }
      }
    }

    // O espaço medido, fixado em número exato em vez de piso: as 3800 populações admissíveis
    // foram TODAS aceitas, e nenhuma guarda recusou nenhuma. Fixar o número faz qualquer mudança
    // no espaço aparecer como falha em vez de passar em silêncio.
    expect(admissiveis).toBe(3_800);
    expect(aceitas).toBe(3_800);
    expect([...porCodigo]).toEqual([]);

    expect(testemunhas).toEqual([]);

    // CONTROLE POSITIVO. Sem ele o resultado acima não valeria nada: um arnês que nunca capturou
    // recusa alguma não demonstrou que VERIA uma testemunha. Aqui uma população deliberadamente
    // inadmissível — uma classe com menos de FOLDS clusters — passa pelo MESMO caminho de captura,
    // e o código dela tem de chegar ao mapa.
    const controle = new Map<string, number>();
    try {
      createClusteredFolds(
        [
          { id: "c_p", clusterRoot: "c_p", rawScore: 0.9, label: 1 },
          ...Array.from({ length: FOLDS }, (_, i) => ({
            id: `c_n_${i}`,
            clusterRoot: `c_n_${i}`,
            rawScore: 0.1,
            label: 0 as const,
          })),
        ],
        CV_SEED,
      );
    } catch (erro) {
      const codigo = (erro as { code?: string }).code ?? "SEM_CODIGO";
      controle.set(codigo, (controle.get(codigo) ?? 0) + 1);
    }
    expect([...controle.keys()]).toEqual(["CLASS_CLUSTERS_BELOW_FOLDS"]);
    expect(porCodigo.get("TRAIN_MISSING_LABEL")).toBeUndefined();
  });
});
