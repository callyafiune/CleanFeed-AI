import { describe, expect, it } from "vitest";

import { fitCalibrator } from "../calibrators.ts";
import {
  CalibrationSelectionError,
  createGroupedFolds,
  selectCalibrator,
  selectCandidateSummary,
  type GroupedCalibrationSample,
} from "../cross-validation.ts";

// Deterministic, well-separated author-grouped samples. Negatives sit at raw
// 0.1 and positives at 0.9, so any monotonic calibrator recovers near-perfect,
// low-ECE probabilities and the ECE-15 admission rule is stable across folds.
function buildGroupedSamples(): GroupedCalibrationSample[] {
  const authors = [
    "ana",
    "bruno",
    "carla",
    "davi",
    "elis",
    "fabio",
    "gil",
    "hana",
    "igor",
    "julia",
    "kaue",
    "livia",
  ];
  const samples: GroupedCalibrationSample[] = [];
  let counter = 0;
  for (let a = 0; a < authors.length; a += 1) {
    const records = 2 + (a % 3); // 2..4 records per author
    for (let r = 0; r < records; r += 1) {
      counter += 1;
      const positive = counter % 2 === 0;
      samples.push({
        id: `rec-${counter}`,
        authorGroup: authors[a],
        rawScore: positive ? 0.9 : 0.1,
        label: (positive ? 1 : 0) as 0 | 1,
      });
    }
  }
  return samples;
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

describe("createGroupedFolds", () => {
  const samples = buildGroupedSamples();

  it("keeps every id once in validation and never leaks an author across train/validation", () => {
    const folds = createGroupedFolds(samples, 5, 42);
    expect(folds).toHaveLength(5);

    const validationIds = folds.flatMap((fold) =>
      fold.validation.map((sample) => sample.id),
    );
    expect(validationIds).toHaveLength(samples.length);
    expect(new Set(validationIds).size).toBe(samples.length);

    for (const fold of folds) {
      const validationAuthors = new Set(
        fold.validation.map((sample) => sample.authorGroup),
      );
      const trainAuthors = new Set(
        fold.train.map((sample) => sample.authorGroup),
      );
      for (const author of validationAuthors) {
        expect(trainAuthors.has(author)).toBe(false);
      }
      expect(fold.train.length + fold.validation.length).toBe(samples.length);
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(createGroupedFolds(samples, 5, 42)).toEqual(
      createGroupedFolds(samples, 5, 42),
    );
  });
});

describe("selectCalibrator", () => {
  const samples = buildGroupedSamples();

  it("runs grouped CV deterministically and refits the winner on the full calibration split", () => {
    const first = selectCalibrator(samples, 7);
    const second = selectCalibrator(samples, 7);
    expect(first).toEqual(second);

    expect(first.candidates).toHaveLength(3);
    expect(
      first.candidates.every((candidate) => candidate.foldCount === 5),
    ).toBe(true);
    expect(first.candidates.map((candidate) => candidate.kind)).toContain(
      first.selection.kind,
    );

    // The admitted winner obeys the ECE-15 <= 0.05 rule...
    expect(first.selection.ece15).toBeLessThanOrEqual(0.05);
    // ...and the returned model is a refit on ALL calibration samples, not one
    // of the per-fold models.
    expect(first.model).toEqual(fitCalibrator(first.selection.kind, samples));
  });
});
