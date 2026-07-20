import { describe, expect, it } from "vitest";

import { groupTimeSplit } from "../split";

// groupTimeSplit is generic and only reads the group and time keys, so these
// tests use a minimal local row shape rather than the full closed benchmark
// record schema (validated in schema.test.ts). This keeps the split contract
// decoupled from the record schema, which carries its author under groups.*.
interface SplitRow {
  id: string;
  authorGroup: string;
  createdAt: number;
}

function record(overrides: Partial<SplitRow> = {}): SplitRow {
  return {
    id: "rec-1",
    authorGroup: "author-a",
    createdAt: 1,
    ...overrides,
  };
}

// Author groups are temporally clustered, mirroring how a real dataset is
// captured over time. A correct group-time split must never let one author
// leak across partitions and must keep every test record strictly newer than
// every calibration record.
const DATASET: SplitRow[] = [
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

function authors(rows: SplitRow[]): string[] {
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
