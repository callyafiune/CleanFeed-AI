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
} from "../cross-validation.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
import { validateBenchmarkRecordV3, type BenchmarkRecord } from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3Human,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

const FOLDS = REBUILD_V3_POLICY.calibrator.crossValidationFolds;
const CV_SEED = REBUILD_V3_POLICY.seeds.crossValidation;

// ---------------------------------------------------------------------------
// Record fixture: five split/exposure clusters of three record-lines each, and
// every cluster is held together by a CHAIN of two DIFFERENT axes rather than by
// one shared identity:
//
//   row 0 and row 1 share an `author`; row 1 and row 2 share a `source`; rows 0
//   and 2 share no axis value at all.
//
// So folds built on any single axis would split the trio, and only the connected
// component of the union keeps it whole. `domainSource` and `collectionBatch` are
// per-cluster here (a collection batch belongs to one stratum), which is what
// keeps the five components from collapsing into one: those two axes are shared by
// design across many rows, so a fixture giving every row the same value describes
// a corpus that is ONE cluster and cannot be cross-validated at all.
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
  it("selects lowest Brier among ECE-valid candidates and prefers Platt within 0.002", () => {
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece15: 0.03 },
      { kind: "platt", brier: 0.1019, ece15: 0.04 },
      { kind: "beta", brier: 0.099, ece15: 0.06 },
    ]);
    expect(selected.kind).toBe("platt");
  });

  it("drops a lower-Brier candidate whose ECE-15 exceeds 0.05 and keeps the best admissible one", () => {
    // beta has the lowest Brier but ECE-15 0.06 removes it; platt is more than
    // 0.002 worse than isotonic, so the lowest admissible Brier (isotonic) wins.
    const selected = selectCandidateSummary([
      { kind: "isotonic", brier: 0.1, ece15: 0.03 },
      { kind: "platt", brier: 0.2, ece15: 0.04 },
      { kind: "beta", brier: 0.05, ece15: 0.06 },
    ]);
    expect(selected.kind).toBe("isotonic");
  });

  it("throws a coded error when no candidate satisfies ECE-15 <= 0.05", () => {
    expect(() =>
      selectCandidateSummary([
        { kind: "platt", brier: 0.1, ece15: 0.09 },
        { kind: "beta", brier: 0.1, ece15: 0.2 },
        { kind: "isotonic", brier: 0.1, ece15: 0.051 },
      ]),
    ).toThrow(CalibrationSelectionError);
  });
});

describe("clusterRootsOf", () => {
  it("atomises by the CONNECTED COMPONENT of two axes, not by either axis alone", () => {
    const rootById = clusterRootsOf(chainedRecords);
    // Rows 0 and 2 of a cluster share no axis value; only the chain through row 1
    // joins them, so a matching root proves the component is the atom.
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

  it("stratifies by class within the deviation the atom sizes leave attainable", () => {
    const { stratification } = createClusteredFolds(chainedSamples, CV_SEED);
    expect(stratification.clusters).toBe(FOLDS);
    expect(stratification.seed).toBe(CV_SEED);
    expect(stratification.balance).toHaveLength(2);
    for (const balance of stratification.balance) {
      expect(balance.perFold).toHaveLength(FOLDS);
      expect(balance.deviation).toBeLessThanOrEqual(balance.attainable);
      expect(balance.withinAttainable).toBe(true);
    }
    // This fixture admits a perfect packing, so the measured deviation is zero.
    expect(stratification.balance.map((balance) => balance.deviation)).toEqual([
      0, 0,
    ]);
    expect(stratification.oversizedClusters).toEqual([]);
  });

  it("names a cluster too large for even balancing instead of accepting it silently", () => {
    // Six clusters, but one of them carries three positives while the other five
    // carry one each: no packing can give five folds an equal share of label 1, and
    // the atom that makes it impossible is published rather than absorbed.
    const skewed: ClusteredCalibrationSample[] = [
      ...samplesFrom(chainedClusters(FOLDS + 1)),
      { id: "extra_a", clusterRoot: "h_0_0", rawScore: 0.9, label: 1 },
      { id: "extra_b", clusterRoot: "h_0_0", rawScore: 0.9, label: 1 },
    ];
    const { stratification } = createClusteredFolds(skewed, CV_SEED);
    expect(stratification.oversizedClusters).toHaveLength(1);
    expect(stratification.oversizedClusters[0]).toMatchObject({
      clusterRoot: "h_0_0",
      label: 1,
      records: 3,
    });
    const positives = stratification.balance.find(
      (balance) => balance.label === 1,
    );
    expect(positives?.deviation).toBeGreaterThan(0);
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
    expect(aggregate.ece15).toBeCloseTo(0.5, 12);
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

    // The admitted winner obeys the ECE-15 <= 0.05 rule...
    expect(first.selection.ece15).toBeLessThanOrEqual(0.05);
    // ...and the returned model is a refit on ALL calibration samples, not one
    // of the per-fold models.
    expect(first.model).toEqual(
      fitCalibrator(first.selection.kind, chainedSamples),
    );
  });
});
