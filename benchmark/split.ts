// Group-time dataset split. This prevents two kinds of leakage that would
// inflate benchmark scores:
//   1. Author leakage: the same authorGroup must never appear in more than one
//      partition, so the model cannot memorise an author's style.
//   2. Temporal leakage: every test record must be strictly newer than every
//      calibration record, so calibration cannot peek at future data.
//
// Both guarantees hold for any input. Whole author groups are assigned to a
// single partition (guaranteeing author disjointness), and a group is only
// placed in test/calibration when all of its records fall cleanly on the
// correct side of the time boundary. Groups that straddle a boundary fall back
// to train, which keeps the calibration/test cut strict.
//
// Standalone module: MUST NOT import from the extension bundle (src/).

export interface SplitFractions {
  train: number;
  calibration: number;
  test: number;
}

export interface GroupTimeSplitOptions<T> {
  groupBy: keyof T & string;
  timeBy: keyof T & string;
  fractions?: SplitFractions;
}

export interface DatasetSplit<T> {
  train: T[];
  calibration: T[];
  test: T[];
}

const DEFAULT_FRACTIONS: SplitFractions = {
  train: 0.6,
  calibration: 0.2,
  test: 0.2,
};

export function groupTimeSplit<T>(
  records: readonly T[],
  options: GroupTimeSplitOptions<T>,
): DatasetSplit<T> {
  const split: DatasetSplit<T> = { train: [], calibration: [], test: [] };
  if (records.length === 0) return split;

  const fractions = normaliseFractions(options.fractions ?? DEFAULT_FRACTIONS);
  const times = records
    .map((record) => toTime(record, options.timeBy))
    .sort((a, b) => a - b);

  // Records strictly after testCut are eligible for test; records in
  // (calibrationCut, testCut] are eligible for calibration.
  const testCut = quantile(times, 1 - fractions.test);
  const calibrationCut = quantile(
    times,
    1 - fractions.test - fractions.calibration,
  );

  for (const bucket of groupRecords(records, options.groupBy).values()) {
    const bucketTimes = bucket.map((record) => toTime(record, options.timeBy));
    const min = Math.min(...bucketTimes);
    const max = Math.max(...bucketTimes);

    if (min > testCut) {
      split.test.push(...bucket);
    } else if (max <= testCut && min > calibrationCut) {
      split.calibration.push(...bucket);
    } else {
      split.train.push(...bucket);
    }
  }

  return split;
}

function groupRecords<T>(
  records: readonly T[],
  groupBy: keyof T & string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = String(record[groupBy]);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [record]);
    } else {
      bucket.push(record);
    }
  }
  return groups;
}

function normaliseFractions(fractions: SplitFractions): SplitFractions {
  const { train, calibration, test } = fractions;
  if (
    !Number.isFinite(train) ||
    !Number.isFinite(calibration) ||
    !Number.isFinite(test) ||
    train <= 0 ||
    calibration <= 0 ||
    test <= 0
  ) {
    throw new Error("SPLIT_FRACTIONS_INVALID: fractions must be positive");
  }
  const total = train + calibration + test;
  return {
    train: train / total,
    calibration: calibration / total,
    test: test / total,
  };
}

function quantile(sortedAscending: readonly number[], p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.floor(clamped * (sortedAscending.length - 1));
  return sortedAscending[index];
}

function toTime<T>(record: T, timeBy: keyof T & string): number {
  const value = Number(record[timeBy]);
  if (!Number.isFinite(value)) {
    throw new Error(`SPLIT_TIME_INVALID: ${timeBy} is not a finite number`);
  }
  return value;
}
