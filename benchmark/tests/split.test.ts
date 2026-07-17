import { describe, expect, it } from "vitest";

import type { BenchmarkRecord } from "../schema";
import { validateBenchmarkRecord } from "../schema";
import { groupTimeSplit } from "../split";

function record(overrides: Partial<BenchmarkRecord> = {}): BenchmarkRecord {
  return {
    id: "rec-1",
    text: "Texto de exemplo para avaliar o índice de detecção na versão atual.",
    label: "human",
    authorGroup: "author-a",
    createdAt: 1,
    platform: "linkedin",
    language: "pt",
    topic: "carreira",
    license: "CC-BY-4.0",
    ...overrides,
  };
}

// Author groups are temporally clustered, mirroring how a real dataset is
// captured over time. A correct group-time split must never let one author
// leak across partitions and must keep every test record strictly newer than
// every calibration record.
const DATASET: BenchmarkRecord[] = [
  record({ id: "a1", authorGroup: "author-a", createdAt: 1 }),
  record({ id: "a2", authorGroup: "author-a", createdAt: 2 }),
  record({ id: "b1", authorGroup: "author-b", createdAt: 3 }),
  record({ id: "b2", authorGroup: "author-b", createdAt: 4 }),
  record({ id: "c1", authorGroup: "author-c", createdAt: 5 }),
  record({ id: "c2", authorGroup: "author-c", createdAt: 6 }),
  record({ id: "d1", authorGroup: "author-d", createdAt: 7 }),
  record({ id: "d2", authorGroup: "author-d", createdAt: 8 }),
  record({ id: "e1", authorGroup: "author-e", createdAt: 9 }),
  record({ id: "e2", authorGroup: "author-e", createdAt: 10 }),
];

function authors(rows: BenchmarkRecord[]): string[] {
  return [...new Set(rows.map((row) => row.authorGroup))];
}

function intersection(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

describe("groupTimeSplit", () => {
  it("keeps authors disjoint and test records later than calibration records", () => {
    const split = groupTimeSplit(DATASET, {
      groupBy: "authorGroup",
      timeBy: "createdAt",
    });

    expect(
      intersection(authors(split.train), authors(split.calibration)),
    ).toEqual([]);
    expect(intersection(authors(split.train), authors(split.test))).toEqual([]);
    expect(
      intersection(authors(split.calibration), authors(split.test)),
    ).toEqual([]);
    expect(Math.min(...split.test.map((row) => row.createdAt))).toBeGreaterThan(
      Math.max(...split.calibration.map((row) => row.createdAt)),
    );
  });

  it("assigns every record to exactly one partition", () => {
    const split = groupTimeSplit(DATASET, {
      groupBy: "authorGroup",
      timeBy: "createdAt",
    });
    const assigned = [...split.train, ...split.calibration, ...split.test];

    expect(assigned).toHaveLength(DATASET.length);
    expect(new Set(assigned.map((row) => row.id)).size).toBe(DATASET.length);
  });
});

describe("validateBenchmarkRecord", () => {
  it("accepts a licensed, pseudonymised record", () => {
    expect(validateBenchmarkRecord(record())).toMatchObject({
      id: "rec-1",
      label: "human",
      authorGroup: "author-a",
      license: "CC-BY-4.0",
    });
  });

  it("rejects a record without a license", () => {
    const withoutLicense: Record<string, unknown> = { ...record() };
    delete withoutLicense.license;
    expect(() => validateBenchmarkRecord(withoutLicense)).toThrow();
  });

  it("rejects author groups that are not pseudonymised", () => {
    expect(() =>
      validateBenchmarkRecord(
        record({ authorGroup: "maria.silva@example.com" }),
      ),
    ).toThrow();
    expect(() =>
      validateBenchmarkRecord(record({ authorGroup: "Maria Silva" })),
    ).toThrow();
  });

  it("rejects an unknown label", () => {
    expect(() =>
      validateBenchmarkRecord({ ...record(), label: "robot" }),
    ).toThrow();
  });

  it("rejects a non-finite createdAt", () => {
    expect(() =>
      validateBenchmarkRecord({ ...record(), createdAt: Number.NaN }),
    ).toThrow();
  });
});
