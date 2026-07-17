import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../cli.ts";

interface RecordOverrides {
  id: string;
  authorGroup: string;
  createdAt: number;
}

function record({ id, authorGroup, createdAt }: RecordOverrides) {
  return {
    id,
    text: "Um texto de exemplo suficientemente longo para o registro.",
    label: "human" as const,
    authorGroup,
    createdAt,
    platform: "linkedin",
    language: "pt",
    topic: "geral",
    license: "CC-BY-4.0",
  };
}

// A dataset whose id order (the random baseline's slice order) puts the same
// author in what becomes train and test, and whose timestamps are not monotonic
// by id. Under group-time leakage rules this split IS leaky by construction —
// which is exactly what a random comparison baseline is allowed to be.
const LEAKY_BY_ID_ORDER = [
  record({ id: "r1", authorGroup: "author_a", createdAt: 500 }),
  record({ id: "r2", authorGroup: "author_b", createdAt: 400 }),
  record({ id: "r3", authorGroup: "author_c", createdAt: 300 }),
  record({ id: "r4", authorGroup: "author_d", createdAt: 900 }),
  record({ id: "r5", authorGroup: "author_a", createdAt: 100 }),
];

describe("benchmark CLI split gating", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  async function workspace(records: unknown[]): Promise<{
    input: string;
    output: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), "cf-bench-cli-"));
    created.push(dir);
    const input = join(dir, "dataset.jsonl");
    const output = join(dir, "out");
    await writeFile(
      input,
      records.map((row) => JSON.stringify(row)).join("\n"),
    );
    return { input, output };
  }

  it("runs the random comparison-only baseline even when the split carries leakage", async () => {
    const { input, output } = await workspace(LEAKY_BY_ID_ORDER);

    await expect(
      main([
        "--input",
        input,
        "--output",
        output,
        "--split",
        "random",
        "--comparison-only",
      ]),
    ).resolves.toBeUndefined();

    const audit = JSON.parse(
      await readFile(join(output, "split-audit.json"), "utf8"),
    );
    expect(audit.split).toBe("random");
    expect(audit.releaseDecisionEligible).toBe(false);
    expect(audit.sizes).toEqual({ train: 3, calibration: 1, test: 1 });
  });

  it("still enforces leakage safety on the release-eligible group-time split", async () => {
    // group-time clusters by author, so the same dataset yields a clean split
    // and is release-eligible without --comparison-only.
    const { input, output } = await workspace(LEAKY_BY_ID_ORDER);

    await expect(
      main(["--input", input, "--output", output, "--split", "group-time"]),
    ).resolves.toBeUndefined();

    const audit = JSON.parse(
      await readFile(join(output, "split-audit.json"), "utf8"),
    );
    expect(audit.split).toBe("group-time");
    expect(audit.releaseDecisionEligible).toBe(true);
  });

  it("refuses the random split unless comparison-only is set", async () => {
    const { input, output } = await workspace(LEAKY_BY_ID_ORDER);

    await expect(
      main(["--input", input, "--output", output, "--split", "random"]),
    ).rejects.toThrow(/comparison-only/u);
  });
});
