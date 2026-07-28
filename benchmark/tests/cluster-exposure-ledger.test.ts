// The eight named acceptance tests of C3's exposure ledger, plus the boundary
// checks the ledger owes its callers.
//
// Every test runs against a TEMPORARY fixture directory. Nothing here touches
// `benchmark/data/private/`: freezing a real split is E2's, and a real exposure
// event written from a test would burn eligibility for the whole project.

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../cli.ts";
import {
  CLUSTER_EXPOSURE_KEYRING_FILE,
  CLUSTER_EXPOSURE_LEDGER_FILE,
  ClusterLedgerError,
  EXPOSURE_IDENTITY_AXES,
  backupClusterLedger,
  commitSplitFreeze,
  initClusterLedger,
  preflightExposure,
  readClusterLedger,
  recordPilotExposure,
  restoreClusterLedger,
  rotateClusterExposureKey,
  verifyClusterLedger,
  type ClusterLedgerPaths,
  type ExposureRecordInput,
  type ExposureRequest,
} from "../cluster-exposure-ledger.ts";

// ~200 tokens, so a single changed token leaves a 5-token-shingle Jaccard of
// 191/201 = 0.950 — far enough above the frozen 0.82 that the MinHash estimate
// cannot straddle the threshold.
function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(
    " ",
  );
}

const BASE_TEXT = words("alpha", 200);
const NEAR_TEXT = `${words("alpha", 199)} omega`;
const FAR_TEXT = words("zeta", 200);

const DATASET_A = "a".repeat(64);
const DATASET_B = "b".repeat(64);
const SPLIT_A = "1".repeat(64);
const SPLIT_B = "2".repeat(64);
const RESERVE = "f".repeat(64);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cleanfeed-cluster-ledger-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function paths(): ClusterLedgerPaths {
  return {
    ledgerPath: join(root, "private", CLUSTER_EXPOSURE_LEDGER_FILE),
    keyringPath: join(root, "private", CLUSTER_EXPOSURE_KEYRING_FILE),
    backupRoot: join(root, "ledger-backups"),
  };
}

interface RecordSpec {
  id: string;
  text?: string;
  partition?: ExposureRecordInput["partition"];
  author?: string;
  source?: string;
}

function record(spec: RecordSpec): ExposureRecordInput {
  return {
    id: spec.id,
    text: spec.text ?? BASE_TEXT,
    partition: spec.partition ?? "dev",
    groups: {
      author: spec.author ?? "person_0123456789abcdef",
      source: spec.source ?? "th_ptso_140233",
      domainSource: "ds_ptso_qa",
      collectionBatch: "cb_ptso_20260727",
      nearDuplicate: `nd_${spec.id}`,
    },
  };
}

function request(overrides: Partial<ExposureRequest> = {}): ExposureRequest {
  return {
    eventType: "split-freeze",
    occurredAt: "2026-07-28T10:00:00.000Z",
    runId: "run-1",
    datasetDigest: DATASET_A,
    splitDigest: SPLIT_A,
    reserveManifestDigest: RESERVE,
    records: [record({ id: "r1" })],
    ...overrides,
  };
}

async function init(): Promise<void> {
  await initClusterLedger(paths(), { createdAt: "2026-07-28T09:00:00.000Z" });
}

describe("cluster-exposure ledger — keyring and initialisation", () => {
  it("mints one 32-byte key as v1 and refuses to overwrite existing state", async () => {
    const keyring = await initClusterLedger(paths(), {
      createdAt: "2026-07-28T09:00:00.000Z",
    });
    expect(keyring.keys).toHaveLength(1);
    expect(keyring.keys[0].keyVersion).toBe("v1");
    expect(keyring.keys[0].secret).toMatch(/^[0-9a-f]{64}$/);
    // C2's `pseudonymize.py` reads `secrets.person`; init must leave that
    // interface satisfiable rather than mint a second, incompatible file.
    expect(keyring.secrets.person).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      initClusterLedger(paths(), { createdAt: "2026-07-28T09:30:00.000Z" }),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_ALREADY_INITIALISED" });
  });

  it("adopts a pre-existing person keyring without rewriting its secret", async () => {
    // Exactly the shape C2 minted before C3 existed: a person secret, no keys.
    const existing = {
      keyringVersion: "c2-run-v1",
      secrets: { person: "7".repeat(64) },
    };
    await mkdir(join(root, "private"), { recursive: true });
    await writeFile(
      paths().keyringPath,
      `${JSON.stringify(existing, null, 2)}\n`,
      "utf8",
    );

    const keyring = await initClusterLedger(paths(), {
      createdAt: "2026-07-28T09:00:00.000Z",
    });
    expect(keyring.secrets.person).toBe("7".repeat(64));
    expect(keyring.keyringVersion).toBe("c2-run-v1");
    expect(keyring.keys).toHaveLength(1);
  });
});

describe("acceptance 1 — a new id or a new tuple does not restore test eligibility", () => {
  it("refuses a previously exposed cluster for test under a fresh id and a fresh tuple", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", partition: "dev" })],
      }),
    );

    // Everything an operator could change to "restore" eligibility: a new
    // record-line id, a new datasetDigest, a new splitDigest, and text that is
    // not even a near-duplicate. Only the sampling unit is the same.
    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          record({ id: "brand-new-id", text: FAR_TEXT, partition: "test" }),
        ],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("still admits that cluster into a non-test partition", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", partition: "dev" })],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [record({ id: "r2", text: FAR_TEXT, partition: "cal-A" })],
      }),
    );

    expect(decision.refusals).toEqual([]);
    expect(decision.eligible).toBe(true);
  });
});

describe("acceptance 2 — swapping a keyVersion without migration fails", () => {
  it("refuses to verify or mutate when a key an event referenced is gone", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );

    const before = await verifyClusterLedger(paths());
    expect(before.referencedKeyVersions).toEqual(["v1"]);

    // The operator "rotates" by REPLACING v1 instead of appending v2.
    const swapped = {
      keyringVersion: "v1",
      secrets: { person: "7".repeat(64) },
      keys: [
        {
          keyVersion: "v2",
          secret: "9".repeat(64),
          createdAt: "2026-07-28T12:00:00.000Z",
        },
      ],
    };
    await writeFile(
      paths().keyringPath,
      `${JSON.stringify(swapped, null, 2)}\n`,
      "utf8",
    );

    await expect(verifyClusterLedger(paths())).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_KEY_VERSION_MISSING",
    });
    await expect(
      recordPilotExposure(paths(), request({ eventType: "pilot-exposure" })),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_KEY_VERSION_MISSING" });
  });

  it("accepts an appended key and never re-exposes an already exposed cluster", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", partition: "dev" })],
      }),
    );

    await rotateClusterExposureKey(paths(), {
      keyVersion: "v2",
      createdAt: "2026-07-28T12:00:00.000Z",
    });
    const verified = await verifyClusterLedger(paths());
    expect(verified.keyVersions).toEqual(["v1", "v2"]);

    // The rotation adds a digest; the comparison uses any digest in common, so
    // the cluster does NOT reappear as never-exposed.
    const decision = await preflightExposure(
      paths(),
      request({
        records: [record({ id: "r9", text: FAR_TEXT, partition: "test" })],
      }),
    );
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );

    // And a genuinely new cluster is HMACed under BOTH versions.
    const fresh = await preflightExposure(
      paths(),
      request({
        records: [
          {
            id: "fresh",
            text: FAR_TEXT,
            partition: "test",
            groups: { source: "th_new_1", author: "person_fedcba9876543210" },
          },
        ],
      }),
    );
    expect(fresh.eligible).toBe(true);
    expect(
      fresh.event.records[0].groupDigests.source.map(
        (digest) => digest.keyVersion,
      ),
    ).toEqual(["v1", "v2"]);
  });
});

describe("acceptance 3 — a historical near-duplicate is barred even under a new id", () => {
  it("refuses a near-duplicate of exposed text and admits unrelated text", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", text: BASE_TEXT, partition: "dev" })],
      }),
    );

    const nearDuplicate = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          {
            id: "totally-different-id",
            text: NEAR_TEXT,
            partition: "test",
            // A different sampling unit too, so only the CONTENT can catch it.
            groups: { source: "th_other_77", author: "person_aaaabbbbccccdddd" },
          },
        ],
      }),
    );
    expect(nearDuplicate.refusals.map((refusal) => refusal.reason)).toContain(
      "historical-near-duplicate",
    );

    const unrelated = await preflightExposure(
      paths(),
      request({
        records: [
          {
            id: "unrelated",
            text: FAR_TEXT,
            partition: "test",
            groups: { source: "th_other_78", author: "person_aaaabbbbcccceeee" },
          },
        ],
      }),
    );
    expect(unrelated.refusals).toEqual([]);
  });
});

describe("acceptance 4 — a consumed test record-line returns to no partition", () => {
  it("refuses it for every one of the five partitions", async () => {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "t1", partition: "test" })] }),
    );

    for (const partition of ["train", "dev", "cal-A", "cal-B", "test"] as const) {
      const decision = await preflightExposure(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [record({ id: "t1-renamed", partition })],
        }),
      );
      expect(decision.eligible, `partition ${partition}`).toBe(false);
      expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
        "record-line-exposed-in-test",
      );
    }
  });
});

describe("acceptance 5 — the future reserve appears in no partition", () => {
  it("records only the reserve manifest digest and refuses a reserve partition", async () => {
    await init();
    const event = await commitSplitFreeze(
      paths(),
      request({
        records: [
          record({ id: "a1", partition: "train" }),
          record({ id: "a2", partition: "dev", source: "th_2" }),
          record({ id: "a3", partition: "cal-A", source: "th_3" }),
          record({ id: "a4", partition: "cal-B", source: "th_4" }),
          record({ id: "a5", partition: "test", source: "th_5" }),
        ],
      }),
    );

    expect(event.reserveManifestDigest).toBe(RESERVE);
    expect(new Set(event.records.map((entry) => entry.partition))).toEqual(
      new Set(["train", "dev", "cal-A", "cal-B", "test"]),
    );

    await expect(
      commitSplitFreeze(
        paths(),
        request({
          records: [
            {
              ...record({ id: "reserved" }),
              partition: "future-holdout-reserve" as never,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_PARTITION_INVALID" });
  });
});

describe("acceptance 6 — the split and its exposure event are written together or not at all", () => {
  it("writes no event when the split write fails", async () => {
    await init();
    const before = await readFile(paths().ledgerPath, "utf8");

    await expect(
      commitSplitFreeze(paths(), request(), async () => {
        throw new Error("disk full while writing split-artifact.json");
      }),
    ).rejects.toThrow(/disk full/);

    expect(await readFile(paths().ledgerPath, "utf8")).toBe(before);
    expect((await readClusterLedger(paths().ledgerPath)).length).toBe(0);
  });

  it("never runs the split write when the exposure is refused", async () => {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "t1", partition: "test" })] }),
    );

    let finalized = false;
    await expect(
      commitSplitFreeze(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [record({ id: "t1-again", partition: "dev" })],
        }),
        async () => {
          finalized = true;
        },
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_EXPOSURE_REFUSED" });
    expect(finalized).toBe(false);
    expect((await readClusterLedger(paths().ledgerPath)).length).toBe(1);
  });

  it("writes both when the split write succeeds", async () => {
    await init();
    const splitPath = join(root, "split-artifact.json");
    const event = await commitSplitFreeze(paths(), request(), async () => {
      await writeFile(splitPath, "{}\n", "utf8");
    });
    expect(await readFile(splitPath, "utf8")).toBe("{}\n");
    const events = await readClusterLedger(paths().ledgerPath);
    expect(events).toHaveLength(1);
    expect(events[0].eventDigest).toBe(event.eventDigest);
    expect(events[0].previousEventDigest).toBeNull();
  });
});

describe("acceptance 9 — a LINEAGE edge is caught from both of its ends", () => {
  // The commonest sampling unit of v3 is a human row in one partition and the
  // generation it seeded in another. The two rows share NO axis value: the human
  // carries `author`/`source`, the generation carries `humanSeed` naming the
  // human's ID. So the comparison has to index the exposed row's own lineage
  // identity in the same MAC domain a child uses when it names that id —
  // otherwise the seed -> generation half of every lineage walks straight through
  // the ledger, which is the exact blindness 02ea363 fixed in the splitter.
  const SEED_TEXT = words("beta", 200);
  const CHILD_TEXT = words("gamma", 200);

  function generation(
    id: string,
    partition: ExposureRecordInput["partition"],
    lineage: { humanSeed?: string; derivationRoot?: string },
    text = CHILD_TEXT,
  ): ExposureRecordInput {
    return {
      id,
      text,
      partition,
      // Generated text has no human author and no thread (R6: those axes are
      // `notApplicable`, never a synthetic identity), so the lineage axes are the
      // only thing that can tie it to anything.
      groups: {
        ...lineage,
        promptTemplate: `pt_${id}`,
        generatorFamily: "gemini-3_5-flash-medium",
      },
    };
  }

  it("refuses a generation for test when the human seed was already exposed", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [
          record({ id: "h1", partition: "dev", text: SEED_TEXT, source: "th_h1" }),
        ],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [generation("g1", "test", { humanSeed: "h1" })],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("refuses the human seed for test when the generation it seeded was exposed", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [generation("g1", "dev", { humanSeed: "h1" })],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          record({ id: "h1", partition: "test", text: SEED_TEXT, source: "th_h1" }),
        ],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("refuses a derivative for test when its parent was already exposed", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [
          record({ id: "p1", partition: "dev", text: SEED_TEXT, source: "th_p1" }),
        ],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [generation("d1", "test", { derivationRoot: "p1" })],
      }),
    );

    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("admits a generation whose seed the history never saw", async () => {
    // The negative half: the refusal must come from the lineage MATCHING, not
    // from the mere presence of a lineage axis.
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [
          record({ id: "h1", partition: "dev", text: SEED_TEXT, source: "th_h1" }),
        ],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [generation("g2", "test", { humanSeed: "h-never-seen" })],
      }),
    );

    expect(decision.refusals).toEqual([]);
    expect(decision.eligible).toBe(true);
  });
});

describe("acceptance 8 — the CLI-level lifecycle on a temporary fixture", () => {
  it("backs up, restores over absent state and refuses to restore over divergence", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );

    const receipt = await backupClusterLedger(
      paths(),
      "2026-07-28T13:00:00.000Z",
    );
    const entries = await readdir(receipt.directory);
    expect(entries.sort()).toEqual(
      [
        CLUSTER_EXPOSURE_KEYRING_FILE,
        CLUSTER_EXPOSURE_LEDGER_FILE,
        "backup-manifest.json",
      ].sort(),
    );

    const original = await readFile(paths().ledgerPath, "utf8");

    // Restoring over identical state is a no-op that still verifies.
    const unchanged = await restoreClusterLedger(paths(), receipt.directory);
    expect(unchanged.ledger).toBe("identical");

    // Restoring over ABSENT state rewrites it byte-identically.
    await rm(paths().ledgerPath);
    const restored = await restoreClusterLedger(paths(), receipt.directory);
    expect(restored.ledger).toBe("written");
    expect(await readFile(paths().ledgerPath, "utf8")).toBe(original);

    // Divergence fails closed: the ledger has moved on since the backup.
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        runId: "run-2",
        records: [record({ id: "r2", text: FAR_TEXT, source: "th_9" })],
      }),
    );
    await expect(
      restoreClusterLedger(paths(), receipt.directory),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_RESTORE_DIVERGENT" });
  });

  it("recovers from an interrupted write: the last consistent state stands", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    const consistent = await readFile(paths().ledgerPath, "utf8");

    // What a crash between the temp write and the rename leaves behind.
    const stray = `${paths().ledgerPath}.999.1.tmp`;
    await writeFile(stray, `${consistent}{"truncated":`, "utf8");

    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(1);
    expect(verified.strayTempFiles).toHaveLength(1);

    // The next mutation still works, and the stray file was never read as an
    // event: the chain continues from the one event that was committed.
    const next = await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        runId: "run-2",
        records: [record({ id: "r2", text: FAR_TEXT, source: "th_9" })],
      }),
    );
    const events = await readClusterLedger(paths().ledgerPath);
    expect(events).toHaveLength(2);
    expect(next.previousEventDigest).toBe(events[0].eventDigest);
  });

  it("detects a tampered chain and refuses every mutation", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        runId: "run-2",
        records: [record({ id: "r2", text: FAR_TEXT, source: "th_9" })],
      }),
    );

    const lines = (await readFile(paths().ledgerPath, "utf8"))
      .split("\n")
      .filter((line) => line !== "");
    // Drop the FIRST event: the second's previousEventDigest now dangles.
    await writeFile(paths().ledgerPath, `${lines[1]}\n`, "utf8");

    await expect(verifyClusterLedger(paths())).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_CHAIN_BROKEN",
    });
  });
});

describe("preflight writes nothing", () => {
  it("leaves the ledger and the backup root untouched", async () => {
    await init();
    const before = await readFile(paths().ledgerPath, "utf8");
    await preflightExposure(paths(), request());
    expect(await readFile(paths().ledgerPath, "utf8")).toBe(before);
    await expect(readdir(paths().backupRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("the identity boundary the ledger enforces itself", () => {
  it("refuses a raw person identifier on the author axis", async () => {
    await init();
    await expect(
      preflightExposure(
        paths(),
        request({
          records: [record({ id: "r1", author: "12345" })],
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_IDENTITY_NOT_PSEUDONYM" });
  });

  it("refuses an axis name the schema does not declare", async () => {
    await init();
    await expect(
      preflightExposure(
        paths(),
        request({
          records: [
            {
              id: "r1",
              text: BASE_TEXT,
              partition: "dev",
              groups: { invented: "x_1" },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_AXIS_UNKNOWN" });
  });

  it("compares only the sampling-unit axes, never a stratum or a batch", () => {
    // A stratum (`domainSource`) or a batch (`collectionBatch`) is shared by
    // design across the whole corpus: comparing it would make every future
    // record test-ineligible after the first exposure, which is a shutdown and
    // not a control.
    expect([...EXPOSURE_IDENTITY_AXES]).toEqual([
      "author",
      "source",
      "humanSeed",
      "derivationRoot",
    ]);
  });

  it("records every declared axis even though it compares four", async () => {
    await init();
    const decision = await preflightExposure(paths(), request());
    expect(Object.keys(decision.event.records[0].groupDigests).sort()).toEqual(
      [
        "author",
        "collectionBatch",
        "domainSource",
        "nearDuplicate",
        "source",
      ].sort(),
    );
  });
});

describe("a new directory does not restart eligibility", () => {
  it("refuses a cluster the canonical ledger already exposed, from a fresh path", async () => {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "t1", partition: "test" })] }),
    );

    // The operator points the ledger at a brand-new directory. The canonical
    // artifact is single and project-wide, so a fresh path is not a fresh
    // ledger: verifying the new location against the same keyring must show the
    // history it is missing, and `init` must refuse to mint a second keyring
    // over the one the events reference.
    const fresh: ClusterLedgerPaths = {
      ledgerPath: join(root, "elsewhere", CLUSTER_EXPOSURE_LEDGER_FILE),
      keyringPath: paths().keyringPath,
      backupRoot: paths().backupRoot,
    };
    await expect(
      initClusterLedger(fresh, { createdAt: "2026-07-28T14:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_ALREADY_INITIALISED" });
  });
});

describe("acceptance 8 — driven through the real CLI on a temporary fixture", () => {
  // `runCli` is the parser and dispatcher the operator actually invokes. Driving
  // it (rather than the command function) is what proves the subcommand, its
  // closed action set and its flags are wired, not merely present.
  function cli(action: string, ...flags: string[]): Promise<void> {
    return runCli([
      "cluster-ledger",
      action,
      "--ledger",
      paths().ledgerPath,
      "--keyring",
      paths().keyringPath,
      "--backup-root",
      paths().backupRoot,
      ...flags,
    ]);
  }

  it("initialises once, verifies, preflights without writing, records, backs up and restores", async () => {
    await cli("init", "--occurred-at", "2026-07-28T09:00:00.000Z");
    await expect(
      cli("init", "--occurred-at", "2026-07-28T09:05:00.000Z"),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_ALREADY_INITIALISED" });

    await cli("verify");

    const requestPath = join(root, "request.json");
    await writeFile(
      requestPath,
      JSON.stringify(request({ eventType: "pilot-exposure" }), null, 2),
      "utf8",
    );

    const emptyLedger = await readFile(paths().ledgerPath, "utf8");
    await cli("preflight", "--request", requestPath);
    expect(await readFile(paths().ledgerPath, "utf8")).toBe(emptyLedger);

    await cli("record-pilot", "--request", requestPath);
    expect((await readClusterLedger(paths().ledgerPath)).length).toBe(1);

    await cli("backup", "--occurred-at", "2026-07-28T13:00:00.000Z");
    const backups = await readdir(paths().backupRoot);
    const directory = join(
      paths().backupRoot,
      backups.find((entry) => entry.startsWith("2026-07-28T13-00-00")) as string,
    );

    const committed = await readFile(paths().ledgerPath, "utf8");
    await rm(paths().ledgerPath);
    await cli("restore", "--backup", directory);
    expect(await readFile(paths().ledgerPath, "utf8")).toBe(committed);

    // And a split freeze publishes the staged artifact and the event together.
    const splitRequest = join(root, "split-request.json");
    await writeFile(
      splitRequest,
      JSON.stringify(
        request({
          runId: "run-freeze",
          records: [
            record({ id: "f1", text: FAR_TEXT, partition: "train", source: "th_f1" }),
          ],
        }),
        null,
        2,
      ),
      "utf8",
    );
    const staged = join(root, "split-artifact.staged.json");
    await writeFile(staged, '{"splitDigest":"staged"}\n', "utf8");
    await cli(
      "commit-split",
      "--request",
      splitRequest,
      "--staged-split",
      staged,
      "--split-out",
      join(root, "split-artifact.json"),
    );
    expect(await readFile(join(root, "split-artifact.json"), "utf8")).toBe(
      '{"splitDigest":"staged"}\n',
    );
    expect((await readClusterLedger(paths().ledgerPath)).length).toBe(2);
  });
});

describe("ClusterLedgerError", () => {
  it("is coded and fail-closed", async () => {
    const error = await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ClusterLedgerError);
    expect((error as ClusterLedgerError).code).toBe(
      "CLUSTER_LEDGER_KEYRING_ABSENT",
    );
  });
});
