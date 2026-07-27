import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertHoldoutAvailable,
  beginHoldoutConsumption,
  completeHoldoutConsumption,
  failHoldoutConsumption,
  HoldoutLedgerError,
  resumeHoldoutConsumption,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";

// A distinct, deterministic 64-char lowercase hex per label so every digest in
// the scientific tuple is a valid sha256 the ledger will accept.
function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

const FIXED_TIME = "2026-07-19T00:00:00.000Z";
const LATER_TIME = "2026-07-19T01:00:00.000Z";

function identity(overrides: Partial<HoldoutIdentity> = {}): HoldoutIdentity {
  return {
    datasetDigest: hex("dataset"),
    datasetAuditDigest: hex("dataset-audit"),
    sourceReadinessDigest: hex("source-readiness"),
    splitDigest: hex("split"),
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "1.0.0",
    bundleDigest: hex("bundle"),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest: hex("tokenizer"),
    runtimeParityDigest: hex("runtime-parity"),
    extensionBuildDigest: hex("extension-build"),
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    evaluatorDigest: hex("evaluator"),
    calibrationArtifactDigest: hex("calibration"),
    ...overrides,
  };
}

describe("holdout ledger one-way lease", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  async function workspace(): Promise<{
    ledger: string;
    activeSessionPath: string;
    shardPath: string;
    holdoutDir: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), "cf-ledger-"));
    created.push(dir);
    const holdoutDir = join(dir, "work", "holdout");
    await mkdir(holdoutDir, { recursive: true });
    const privateDir = join(dir, "private");
    await mkdir(privateDir, { recursive: true });
    return {
      ledger: join(privateDir, "holdout-ledger.jsonl"),
      activeSessionPath: join(holdoutDir, "active-session.json"),
      shardPath: join(holdoutDir, "shard-000.jsonl"),
      holdoutDir,
    };
  }

  it("derives a stable 24-char consumptionId from the tuple and startedAt", async () => {
    const { ledger, activeSessionPath } = await workspace();
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      {
        activeSessionPath,
      },
    );
    expect(session.consumptionId).toMatch(/^[0-9a-f]{24}$/u);
    expect(session.status).toBe("started");
    expect(session.reportDigest).toBeNull();
    expect(session.failureCode).toBeNull();
    // active-session.json is written before any scoring, carrying the id.
    const active = JSON.parse(await readFile(activeSessionPath, "utf8"));
    expect(active.consumptionId).toBe(session.consumptionId);
  });

  it("blocks a second consumption of the same tuple even after a crash left it started", async () => {
    const { ledger, activeSessionPath } = await workspace();
    await beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
      activeSessionPath,
    });
    // No terminal event was ever written (simulated crash): the started lease
    // still consumes the tuple.
    await expect(assertHoldoutAvailable(ledger, identity())).rejects.toThrow(
      /holdout tuple was already consumed/,
    );
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout tuple was already consumed/);
  });

  it("resumes only the same started session with an identical tuple, never minting a new id", async () => {
    const { ledger, activeSessionPath } = await workspace();
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      {
        activeSessionPath,
      },
    );

    const resumed = await resumeHoldoutConsumption(
      ledger,
      session.consumptionId,
      identity(),
    );
    expect(resumed).toMatchObject({
      consumptionId: session.consumptionId,
      status: "started",
    });

    // A diverging tuple never reopens the session.
    await expect(
      resumeHoldoutConsumption(ledger, session.consumptionId, {
        ...identity(),
        splitDigest: hex("other-split"),
      }),
    ).rejects.toThrow(/tuple/);

    // An unknown id never resumes.
    await expect(
      resumeHoldoutConsumption(ledger, "0".repeat(24), identity()),
    ).rejects.toThrow(/no started holdout session/);
  });

  it("completes a started session terminally and marks the tuple consumed", async () => {
    const { ledger, activeSessionPath } = await workspace();
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      {
        activeSessionPath,
      },
    );
    const done = await completeHoldoutConsumption(
      ledger,
      session.consumptionId,
      identity(),
      hex("report"),
      LATER_TIME,
      { activeSessionPath },
    );
    expect(done.status).toBe("completed");
    expect(done.reportDigest).toBe(hex("report"));
    expect(done.terminalAt).toBe(LATER_TIME);

    // active-session.json is removed once terminal.
    await expect(stat(activeSessionPath)).rejects.toThrow();

    // Terminal states remain consumed: neither begin nor resume reopens it.
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout tuple was already consumed/);
    await expect(
      resumeHoldoutConsumption(ledger, session.consumptionId, identity()),
    ).rejects.toThrow(/holdout session is terminal/);
    await expect(
      completeHoldoutConsumption(
        ledger,
        session.consumptionId,
        identity(),
        hex("report-2"),
        LATER_TIME,
        { activeSessionPath },
      ),
    ).rejects.toThrow(/terminal/);
  });

  it("fails a started session with a closed reason code, keeps shards, and stays consumed", async () => {
    const { ledger, activeSessionPath, shardPath } = await workspace();
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      {
        activeSessionPath,
      },
    );
    // A shard already produced by the (crashed) scorer must survive a failure.
    await writeFile(shardPath, '{"id":"r1"}\n', "utf8");

    // Free-text reasons are refused; only the closed reason codes are allowed.
    await expect(
      failHoldoutConsumption(
        ledger,
        session.consumptionId,
        identity(),
        "something went wrong" as never,
        LATER_TIME,
        { activeSessionPath },
      ),
    ).rejects.toThrow(HoldoutLedgerError);

    const failed = await failHoldoutConsumption(
      ledger,
      session.consumptionId,
      identity(),
      "scorer-crash",
      LATER_TIME,
      { activeSessionPath },
    );
    expect(failed.status).toBe("failed");
    expect(failed.failureCode).toBe("scorer-crash");
    expect(failed.reportDigest).toBeNull();

    // active-session.json gone, shard intact.
    await expect(stat(activeSessionPath)).rejects.toThrow();
    expect(await readFile(shardPath, "utf8")).toBe('{"id":"r1"}\n');

    // Consumed forever: begin and resume both refuse.
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout tuple was already consumed/);
    await expect(
      resumeHoldoutConsumption(ledger, session.consumptionId, identity()),
    ).rejects.toThrow(/holdout session is terminal/);
  });

  it("allows a genuinely different tuple to open its own session", async () => {
    const { ledger, activeSessionPath } = await workspace();
    await beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
      activeSessionPath,
    });
    // A different evaluator digest is a different scientific tuple.
    const other = await beginHoldoutConsumption(
      ledger,
      identity({ evaluatorDigest: hex("evaluator-2") }),
      LATER_TIME,
      { activeSessionPath },
    );
    expect(other.status).toBe("started");
  });
});
