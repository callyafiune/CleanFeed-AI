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
} from "../cross-validation.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
import { validateBenchmarkRecordV3, type BenchmarkRecord } from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3Ai,
  v3Human,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

// Read from the policy rather than from the module under test, so a test asserting
// the frozen number cannot be satisfied by the module agreeing with itself.
const FOLDS = REBUILD_V3_POLICY.calibrator.crossValidationFolds;
const CV_SEED = REBUILD_V3_POLICY.seeds.crossValidation;
const TIE_TOLERANCE = REBUILD_V3_POLICY.calibrator.tieToleranceAbsolute;
const TIE_BREAK_ORDER = REBUILD_V3_POLICY.calibrator.tieBreakOrder;
const ECE_MAXIMUM = REBUILD_V3_POLICY.calibrationGate.eceMax;

// ---------------------------------------------------------------------------
// TWO record fixtures, because one cannot answer both questions this file asks.
//
// `chainedClusters` is the REALISTIC one, used for everything about folds: five
// split/exposure clusters of three record-lines each, where a cluster shares an
// `author`/`source` chain AND a per-cluster `domainSource` and `collectionBatch`.
// Per-cluster is what a corpus really looks like — a collection batch belongs to one
// stratum — and it is also what keeps the five components from collapsing into one:
// those two axes are shared by design across many rows, so a fixture giving EVERY
// row the same value describes a corpus that is one indivisible cluster and cannot
// be cross-validated at all.
//
// But precisely because `domainSource` and `collectionBatch` are `GROUP_KEYS` value
// axes, a per-cluster value ALREADY unions each trio through a single axis. Measured
// on this fixture with `author` and `source` made distinct per row: still one root
// per trio. So it cannot show that the CONNECTED COMPONENT is the atom rather than
// some one axis — the chain in it is load-bearing for nothing, and an earlier comment
// here claiming "rows 0 and 2 share no axis value at all" was false against the four
// lines below it.
//
// `isolatedChain` is the discriminating one, used only for that claim: every
// non-chain axis is per-ROW, so the ONLY relation joining row 0 to row 2 is
// author(0,1) + source(1,2). All three of `domainSource`, `collectionBatch` and
// `nearDuplicate` admit `known` and nothing else in every class (schema
// AXIS_STATE_RULE), so per-row distinct values are the only way to neutralise them —
// `notApplicable` is refused by the validator, which was measured before writing
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
    expect(REBUILD_V3_POLICY.calibrator.candidates).toEqual(TIE_BREAK_ORDER);
    // And the ECE admission's budget, which is NOT frozen as a selection rule: it is
    // adopted from the release gate so the selection never prefers a calibrator the
    // gate would reject. The gate's BOUND is deliberately not adopted.
    expect(ECE_MAXIMUM).toBe(0.05);
    expect(REBUILD_V3_POLICY.calibrationGate.eceBound).toBe(
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
    // chain AND a per-cluster `domainSource` and `collectionBatch`, either of which
    // alone would already union the trio. That makes it the right fixture for fold
    // behaviour and the wrong one for the connected-component claim above.
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
    expect(aggregate.eceBins).toBe(REBUILD_V3_POLICY.calibrationGate.eceBins);
    expect(aggregate.eceBinning).toBe(
      REBUILD_V3_POLICY.calibrationGate.eceBinning,
    );
    expect(aggregate.ece).toBeCloseTo(0, 12);
  });

  it("does not depend on the order the out-of-fold rows arrive in", () => {
    const rows = [
      { id: "r_a", clusterRoot: "c_a", prediction: 0.2, label: 1 as const },
      { id: "r_b", clusterRoot: "c_b", prediction: 0.2, label: 0 as const },
      { id: "r_c", clusterRoot: "c_c", prediction: 0.9, label: 1 as const },
    ];
    expect(aggregateOutOfFold([...rows].reverse())).toEqual(
      aggregateOutOfFold(rows),
    );
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
