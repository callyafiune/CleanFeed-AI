import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertHoldoutAvailable,
  beginHoldoutConsumption,
  BLOCK_IDENTITY_FIELDS,
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

  it("blocks a second consumption of the same block even after a crash left it started", async () => {
    const { ledger, activeSessionPath } = await workspace();
    await beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
      activeSessionPath,
    });
    // No terminal event was ever written (simulated crash): the started lease
    // still consumes the block.
    await expect(assertHoldoutAvailable(ledger, identity())).rejects.toThrow(
      /holdout block was already consumed/,
    );
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout block was already consumed/);
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

  it("completes a started session terminally and marks the block consumed", async () => {
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
    await expect(stat(activeSessionPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    // Terminal states remain consumed: neither begin nor resume reopens it.
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout block was already consumed/);
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
    await expect(stat(activeSessionPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(shardPath, "utf8")).toBe('{"id":"r1"}\n');

    // Consumed forever: begin and resume both refuse.
    await expect(
      beginHoldoutConsumption(ledger, identity(), LATER_TIME, {
        activeSessionPath,
      }),
    ).rejects.toThrow(/holdout block was already consumed/);
    await expect(
      resumeHoldoutConsumption(ledger, session.consumptionId, identity()),
    ).rejects.toThrow(/holdout session is terminal/);
  });

  it("allows a genuinely different block to open its own session", async () => {
    const { ledger, activeSessionPath } = await workspace();
    await beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
      activeSessionPath,
    });
    // Different blind material, so nothing was measured twice. Without this case a
    // guard that refused every second run would look correct.
    const other = await beginHoldoutConsumption(
      ledger,
      identity({ splitDigest: hex("other-split") }),
      LATER_TIME,
      { activeSessionPath },
    );
    expect(other.status).toBe("started");
    const alsoOther = await beginHoldoutConsumption(
      ledger,
      identity({ datasetDigest: hex("other-dataset") }),
      LATER_TIME,
      { activeSessionPath },
    );
    expect(alsoOther.status).toBe("started");
  });

  // --- integridade do arquivo do ledger ------------------------------------------
  //
  // Uma auditoria de mutacao mostrou que estas duas guardas nao eram exercitadas por
  // teste nenhum. Nao protegem a identidade do lease — essa e coberta —, e sim a
  // integridade do arquivo que registra o lease: um ledger corrompido lido como valido, ou
  // duas transicoes concorrentes sobre o mesmo arquivo.

  it("refuses a ledger whose bytes are not valid JSONL, naming the line", async () => {
    const { ledger } = await workspace();
    // Uma linha valida e uma corrompida: o parser tem de recusar em vez de ignorar a
    // segunda, senao um ledger truncado por escrita interrompida passa por completo.
    await writeFile(
      ledger,
      '{"consumptionId":"c1","status":"started"}\nisto nao e json\n',
      "utf8",
    );
    await expect(
      assertHoldoutAvailable(ledger, identity()),
    ).rejects.toMatchObject({ code: "HOLDOUT_LEDGER_CORRUPT" });
    await expect(assertHoldoutAvailable(ledger, identity())).rejects.toThrow(
      /line 2/u,
    );
  });

  it("refuses a transition while another holds the lock", async () => {
    const { ledger, activeSessionPath } = await workspace();
    // O lock e um arquivo criado com `wx`, entao pre-criar equivale a outra transicao em
    // curso. Sem esta guarda, dois processos escreveriam o mesmo lease.
    await mkdir(dirname(ledger), { recursive: true });
    await writeFile(`${ledger}.lock`, "", "utf8");
    await expect(
      beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
        activeSessionPath,
      }),
    ).rejects.toMatchObject({ code: "HOLDOUT_LEDGER_LOCKED" });
  });
});

// The one-use guarantee is over the blind BLOCK, not over the pair
// (block, candidate). Swapping a bundle, an evaluator or a model version buys no
// second measurement of the same material, and the ledger stays untouched when it
// is tried.
describe("holdout block identity", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  async function ledgerPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cf-ledger-block-"));
    created.push(dir);
    const privateDir = join(dir, "private");
    await mkdir(privateDir, { recursive: true });
    return join(privateDir, "holdout-ledger.jsonl");
  }

  function events(raw: string): { consumptionId: string; status: string }[] {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map(
        (line) => JSON.parse(line) as { consumptionId: string; status: string },
      );
  }

  it("names exactly the two digests over the blind material", () => {
    // Pinned because every field admitted here narrows the refusal: a later edit
    // that adds one silently hands back part of the one-use guarantee.
    expect([...BLOCK_IDENTITY_FIELDS]).toEqual([
      "datasetDigest",
      "splitDigest",
    ]);
  });

  const candidateSwaps: Partial<HoldoutIdentity>[] = [
    { bundleDigest: hex("other-bundle") },
    { evaluatorDigest: hex("other-evaluator") },
    { modelVersion: "1.0.1" },
    { modelId: "cleanfeed-ptbr-v2" },
    { calibrationArtifactDigest: hex("other-calibration") },
    { tokenizerDigest: hex("other-tokenizer") },
    { runtimeParityDigest: hex("other-parity") },
    { extensionBuildDigest: hex("other-build") },
    { aggregationVersion: "tmr-aggregation-v4" },
    { contentCompositionVersion: "lexical-content-v3" },
    // The two attestations ABOUT the same material. They are deliberately NOT
    // block fields: evaluator code recomputes them from the bytes datasetDigest
    // already covers, so a change in that code could otherwise reopen a block
    // whose material never moved.
    { datasetAuditDigest: hex("other-audit") },
    { sourceReadinessDigest: hex("other-readiness") },
  ];

  for (const swap of candidateSwaps) {
    const field = Object.keys(swap)[0];
    it(`refuses the same block under a different ${field}, writing no event`, async () => {
      const ledger = await ledgerPath();
      const activeSessionPath = join(dirname(ledger), "active-session.json");
      await beginHoldoutConsumption(ledger, identity(), FIXED_TIME, {
        activeSessionPath,
      });
      const afterFirst = await readFile(ledger, "utf8");
      expect(events(afterFirst)).toHaveLength(1);

      await expect(
        assertHoldoutAvailable(ledger, identity(swap)),
      ).rejects.toThrow(/holdout block was already consumed/);
      await expect(
        beginHoldoutConsumption(ledger, identity(swap), LATER_TIME, {
          activeSessionPath,
        }),
      ).rejects.toThrow(/holdout block was already consumed/);

      // Refused before the append: the ledger is byte-identical.
      expect(await readFile(ledger, "utf8")).toBe(afterFirst);
    });
  }

  it("keeps resume matched to the exact execution, not a neighbouring one", async () => {
    const ledger = await ledgerPath();
    const activeSessionPath = join(dirname(ledger), "active-session.json");
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      { activeSessionPath },
    );

    await expect(
      resumeHoldoutConsumption(ledger, session.consumptionId, identity()),
    ).resolves.toMatchObject({ status: "started" });
    // Same block, different candidate: the block is spent AND the run is not this
    // one, so a resume must not hand the session over either.
    await expect(
      resumeHoldoutConsumption(
        ledger,
        session.consumptionId,
        identity({ bundleDigest: hex("other-bundle") }),
      ),
    ).rejects.toThrow(/tuple/);
  });

  it("refuses a spent block after a terminal event too", async () => {
    const ledger = await ledgerPath();
    const activeSessionPath = join(dirname(ledger), "active-session.json");
    const session = await beginHoldoutConsumption(
      ledger,
      identity(),
      FIXED_TIME,
      { activeSessionPath },
    );
    await completeHoldoutConsumption(
      ledger,
      session.consumptionId,
      identity(),
      hex("report"),
      LATER_TIME,
      { activeSessionPath },
    );
    // Every terminal session had a `started` before it, so checking `started`
    // already covers `completed` and `failed`.
    await expect(
      beginHoldoutConsumption(
        ledger,
        identity({ evaluatorDigest: hex("other-evaluator") }),
        LATER_TIME,
        { activeSessionPath },
      ),
    ).rejects.toThrow(/holdout block was already consumed/);
  });
});
