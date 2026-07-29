// The eight named acceptance tests of C3's exposure ledger, plus the boundary
// checks the ledger owes its callers.
//
// Every test runs against a TEMPORARY fixture directory. Nothing here touches
// `benchmark/data/private/`: freezing a real split is E2's, and a real exposure
// event written from a test would burn eligibility for the whole project.

import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import { runCli } from "../cli.ts";
import { sha256BytesHex } from "../digests.ts";
import { validateBenchmarkRecordV3, type BenchmarkRecord } from "../schema.ts";
import {
  known,
  unknownAxis,
  v3Ai,
  v3Human,
  withAxis,
} from "./helpers/v3-record-fixture.ts";
import {
  CLUSTER_EXPOSURE_KEYRING_FILE,
  CLUSTER_EXPOSURE_LEDGER_FILE,
  ClusterLedgerError,
  EXPOSURE_IDENTITY_AXES,
  backupClusterLedger,
  clusterAssignments,
  commitSplitFreeze,
  exposureInputsFromRecords,
  initClusterLedger,
  preflightExposure,
  readClusterLedger,
  recordPilotExposure,
  restoreClusterLedger,
  rotateClusterExposureKey,
  verifyClusterLedger,
  type ClusterExposureCommit,
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
            groups: {
              source: "th_other_77",
              author: "person_aaaabbbbccccdddd",
            },
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
            groups: {
              source: "th_other_78",
              author: "person_aaaabbbbcccceeee",
            },
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

    for (const partition of [
      "train",
      "dev",
      "cal-A",
      "cal-B",
      "test",
    ] as const) {
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
    const { event } = await commitSplitFreeze(
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
    const { event } = await commitSplitFreeze(paths(), request(), async () => {
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
          record({
            id: "h1",
            partition: "dev",
            text: SEED_TEXT,
            source: "th_h1",
          }),
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
          record({
            id: "h1",
            partition: "test",
            text: SEED_TEXT,
            source: "th_h1",
          }),
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
          record({
            id: "p1",
            partition: "dev",
            text: SEED_TEXT,
            source: "th_p1",
          }),
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
          record({
            id: "h1",
            partition: "dev",
            text: SEED_TEXT,
            source: "th_h1",
          }),
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

  it("holds both ends of one edge to one rule, however long the parent id is", async () => {
    // The two ends of a lineage edge are THE SAME STRING in THE SAME MAC domain:
    // the parent's own `id`, and the child's `derivationRoot`. `benchmark/schema.ts`
    // validates both with one uncapped alphabet, so validating them here by two
    // different rules cannot be right in both directions — and the direction it
    // was wrong in aborted E2's freeze on the axis end one record AFTER accepting
    // the id end.
    //
    // The parent also carries its own id on `groups.nearDuplicate`, which is what
    // C2's assembler really writes (`assemble_corpus.near_duplicate_axis`: "THE
    // ROW'S OWN ID, because pruning left it alone here"). So a cap on the value
    // axes alone would not have fixed this: a long id reaches this module on three
    // fields, only one of which is called `id`.
    await init();
    const longParent = "r".repeat(200);
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [
          {
            id: longParent,
            text: SEED_TEXT,
            partition: "dev",
            groups: {
              author: "person_0123456789abcdef",
              source: "th_long_parent",
              nearDuplicate: longParent,
            },
          },
        ],
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          generation("child_1", "test", { derivationRoot: longParent }),
        ],
      }),
    );

    // Accepted at both ends, and the edge is still CAUGHT: the refusal has to come
    // from the exposure history, never from a shape rule the schema does not have.
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
    expect(decision.eligible).toBe(false);
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
    const { event: next } = await recordPilotExposure(
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

  it("reports an interrupted KEYRING write too, not only an interrupted ledger one", async () => {
    // The transaction writes the keyring as well (it carries the attestation), and a
    // staged copy of it is a full copy of `secrets.person` and every exposure key.
    // A temp nobody reports is a temp nobody deletes, and the module's crash story
    // leans on `verify` reporting interrupted writes.
    await init();
    const stray = `${paths().keyringPath}.4242.1.tmp`;
    await writeFile(stray, "{}\n", "utf8");

    const verified = await verifyClusterLedger(paths());
    expect(verified.strayTempFiles).toEqual([stray]);
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

  it("refuses a reserve manifest digest that is not a digest, and accepts null", async () => {
    await init();
    // The reserve's manifest digest is the only trace the blind reserve leaves.
    // A path or an empty string would be written into an append-only event and
    // would keep verifying, and the link would be found useless only when the
    // second holdout attempt had to prove which reserve it came from.
    for (const bad of [
      "",
      "benchmark/data/private/reserve-manifest.json",
      "F".repeat(64),
    ]) {
      await expect(
        preflightExposure(paths(), request({ reserveManifestDigest: bad })),
        `reserveManifestDigest ${JSON.stringify(bad)}`,
      ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_DIGEST_INVALID" });
    }
    // `null` is the legitimate "this event concerns no reserve" statement.
    const decision = await preflightExposure(
      paths(),
      request({ reserveManifestDigest: null }),
    );
    expect(decision.event.reserveManifestDigest).toBeNull();
    // And the tuple is held to the same shape, for the same reason.
    await expect(
      preflightExposure(paths(), request({ splitDigest: "split-1" })),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_DIGEST_INVALID" });
  });

  it("checks the record id as an ID, and against the shape the schema allows", async () => {
    await init();

    // A long id is SCHEMA-VALID: `benchmark/schema.ts` validates a record id with
    // the uncapped `/^[A-Za-z0-9_-]+$/`. Borrowing the group-identity check
    // imported a 128-character cap the schema does not have, so a valid corpus
    // would have aborted E2's freeze — and with a message about `groups`.
    //
    // The record is built AROUND the long id rather than beside it, so the same
    // string arrives on `id` AND on `groups.nearDuplicate` — the two fields C2's
    // assembler really fills with a row's id. A fix that uncapped only the field
    // called `id` would be red here.
    const long = "r".repeat(200);
    const decision = await preflightExposure(
      paths(),
      request({
        records: [record({ id: long })],
      }),
    );
    expect(decision.event.records).toHaveLength(1);
    expect(Object.keys(decision.event.records[0].groupDigests)).toContain(
      "nearDuplicate",
    );

    // The alphabet still holds, and the message names the field that is wrong.
    await expect(
      preflightExposure(
        paths(),
        request({ records: [record({ id: "r1@example.com" })] }),
      ),
    ).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_RECORD_ID_INVALID",
      message: expect.stringMatching(/record id/),
    });
    await expect(
      preflightExposure(
        paths(),
        request({ records: [record({ id: "r1@example.com" })] }),
      ),
    ).rejects.toMatchObject({
      message: expect.not.stringMatching(/groups\./),
    });
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

// --- the C2 <-> C3 keyring coupling, exercised for real ----------------------
//
// `initClusterLedger` WRITES the very file `benchmark/lab/pseudonymize.py` reads,
// and C2's extractors write `pseudonym(PERSON_PURPOSE, owner)` straight into
// `groups.author`. If the two sides ever disagree — the loader tightened to
// refuse an unknown field, `init` normalising `keyringVersion` or re-minting
// `secrets.person` — the TypeScript suite and C2's Python tests both stay green
// and the break appears only in the real assembly, or worse: every person
// pseudonym changes and the ledger answers "never exposed" for people it already
// exposed. Shape checks cannot see that. Only running both sides can.

const LAB_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lab",
);

const PSEUDONYM_PROBE = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from pathlib import Path",
  "from pseudonymize import PERSON_PURPOSE, load_cluster_keyring",
  "keyring = load_cluster_keyring(Path(sys.argv[2]))",
  "print(json.dumps({",
  '  "keyringVersion": keyring.keyring_version,',
  '  "pseudonym": keyring.pseudonym(PERSON_PURPOSE, sys.argv[3]),',
  "}))",
].join("\n");

/** The interpreter, or undefined on a machine that has no Python at all. */
function resolvePython(): string | undefined {
  for (const candidate of ["python", "python3"]) {
    try {
      execFileSync(candidate, ["-c", "pass"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Keep looking; a missing interpreter is not a failure of this module.
    }
  }
  return undefined;
}

const PYTHON = resolvePython();

function personPseudonymViaPython(
  keyringPath: string,
  raw: string,
): { keyringVersion: string; pseudonym: string } {
  const output = execFileSync(
    PYTHON as string,
    ["-c", PSEUDONYM_PROBE, LAB_DIRECTORY, keyringPath, raw],
    { encoding: "utf8" },
  );
  return JSON.parse(output.trim()) as {
    keyringVersion: string;
    pseudonym: string;
  };
}

describe("the keyring C2's pseudonymizer reads is the keyring init writes", () => {
  if (PYTHON === undefined) {
    // Loud rather than silent: the coupling is unverified on this machine, and
    // the operator's machine (which has Python, because the extractors are
    // Python) is where it must hold.
    console.warn(
      "cluster-exposure-ledger.test.ts: no Python interpreter found, so the " +
        "C2 keyring coupling was NOT verified in this run",
    );
  }
  const withPython = PYTHON === undefined ? it.skip : it;

  withPython(
    "indexes a pseudonym Python produced and refuses it for test on a second run",
    async () => {
      await init();

      const probe = personPseudonymViaPython(paths().keyringPath, "40");
      // `keyringVersion` travels into C2's axis report, so a corpus records WHICH
      // keyring pseudonymised it. `init` must leave it readable and stable.
      expect(probe.keyringVersion).toBe("v1");
      expect(probe.pseudonym).toMatch(/^person_[0-9a-f]{16}$/);

      // Run 1: C2's extractor output enters the ledger as `groups.author`.
      await recordPilotExposure(
        paths(),
        request({
          eventType: "pilot-exposure",
          records: [
            record({
              id: "ptso_140233",
              partition: "dev",
              author: probe.pseudonym,
              source: "th_ptso_140233",
            }),
          ],
        }),
      );

      // Run 2: the same account, re-extracted from the same snapshot under the
      // same keyring, offered to test with a new id, a new tuple and unrelated
      // text. Recognised as exposed — which is only possible if both sides
      // derived the same pseudonym from the same file.
      const second = personPseudonymViaPython(paths().keyringPath, "40");
      expect(second.pseudonym).toBe(probe.pseudonym);

      const decision = await preflightExposure(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [
            record({
              id: "ptso_998877",
              partition: "test",
              text: FAR_TEXT,
              author: second.pseudonym,
              source: "th_ptso_998877",
            }),
          ],
        }),
      );
      expect(decision.eligible).toBe(false);
      expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
        "cluster-exposed-previously",
      );

      // And a DIFFERENT account is not caught by it.
      const other = personPseudonymViaPython(paths().keyringPath, "41");
      expect(other.pseudonym).not.toBe(probe.pseudonym);
      const admitted = await preflightExposure(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [
            record({
              id: "ptso_112233",
              partition: "test",
              text: FAR_TEXT,
              author: other.pseudonym,
              source: "th_ptso_112233",
            }),
          ],
        }),
      );
      expect(admitted.refusals).toEqual([]);
    },
  );

  withPython(
    "adopting C2's keyring leaves every person pseudonym unchanged",
    async () => {
      // The failure this guards is the one C2's note in the plan predicted and
      // this implementation deliberately avoids: if `init` re-minted or
      // normalised `secrets.person`, every person cluster would be renumbered,
      // the corpus would need re-extraction, and the ledger would report
      // "never exposed" for every person it had already exposed.
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

      const before = personPseudonymViaPython(paths().keyringPath, "40");
      expect(before.keyringVersion).toBe("c2-run-v1");

      await init();

      const after = personPseudonymViaPython(paths().keyringPath, "40");
      expect(after.pseudonym).toBe(before.pseudonym);
      expect(after.keyringVersion).toBe("c2-run-v1");
    },
  );

  withPython(
    "recording an event rewrites the keyring and still leaves C2's side intact",
    async () => {
      // The witness of the ledger's height lives IN the keyring, so every event now
      // rewrites the file C2's extractors read. If that write dropped or normalised
      // `secrets.person` — or `keyringVersion`, which travels into the axis report —
      // every person cluster would be renumbered and the corpus would need
      // re-extraction. Only running C2's real loader over the rewritten file can
      // see that.
      await init();
      const before = personPseudonymViaPython(paths().keyringPath, "40");

      await recordPilotExposure(
        paths(),
        request({ eventType: "pilot-exposure" }),
      );

      const after = personPseudonymViaPython(paths().keyringPath, "40");
      expect(after.pseudonym).toBe(before.pseudonym);
      expect(after.keyringVersion).toBe(before.keyringVersion);
    },
  );
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

describe("the ledger reads as empty only when it is provably new", () => {
  // The requirement above ("a new directory does not restart eligibility") used to
  // be enforced on the `init` path ALONE, and `init` is the one command an operator
  // pointing `--ledger` at the wrong path never runs. Every other command read an
  // absent or truncated file as "nothing was ever exposed" and handed back test
  // eligibility for every consumed cluster, with `verify` passing green over it.
  //
  // So the checks below are of CONTENT and not of name: each one drives the three
  // commands that decide eligibility (`preflight`, `record-pilot`, `commit-split`)
  // plus `verify`, against a ledger state that lost history the keyring attests.

  /** A path the operator could plausibly mistype, with the SAME keyring. */
  function freshLedger(): ClusterLedgerPaths {
    return {
      ledgerPath: join(root, "elsewhere", CLUSTER_EXPOSURE_LEDGER_FILE),
      keyringPath: paths().keyringPath,
      backupRoot: paths().backupRoot,
    };
  }

  /** The exposure a lost history would hand back: the cluster test consumed. */
  function reoffer(): ExposureRequest {
    return request({
      datasetDigest: DATASET_B,
      splitDigest: SPLIT_B,
      records: [record({ id: "t1-renamed", partition: "test" })],
    });
  }

  async function refusesEveryPath(
    target: ClusterLedgerPaths,
    code: string,
    exposure: ExposureRequest = reoffer(),
  ): Promise<void> {
    await expect(preflightExposure(target, exposure)).rejects.toMatchObject({
      code,
    });
    await expect(
      recordPilotExposure(target, {
        ...exposure,
        eventType: "pilot-exposure",
      }),
    ).rejects.toMatchObject({ code });
    await expect(commitSplitFreeze(target, exposure)).rejects.toMatchObject({
      code,
    });
    // And `verify` must not pass green over the same state.
    const verified = await verifyClusterLedger(target).catch(
      (caught: unknown) => caught,
    );
    expect(verified).toBeInstanceOf(ClusterLedgerError);
  }

  async function consumeOneTestCluster(): Promise<void> {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "t1", partition: "test" })] }),
    );
  }

  it("refuses every eligibility path when the ledger is missing from the path given", async () => {
    await consumeOneTestCluster();
    await refusesEveryPath(freshLedger(), "CLUSTER_LEDGER_HISTORY_ABSENT");
  });

  it("refuses every eligibility path when the ledger was truncated to zero bytes", async () => {
    await consumeOneTestCluster();
    await writeFile(paths().ledgerPath, "", "utf8");
    await refusesEveryPath(paths(), "CLUSTER_LEDGER_HISTORY_DIVERGED");
  });

  /**
   * The tail burns a cluster NOTHING ELSE in the ledger names, so losing the tail
   * really does hand that cluster's test eligibility back — the two tests below
   * would pass vacuously against a cluster the head also exposes.
   */
  const TAIL_AUTHOR = "person_aaaabbbbccccdddd";
  const TAIL_SOURCE = "th_9";

  async function burnATestClusterInTheTail(): Promise<ClusterExposureCommit> {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    return commitSplitFreeze(
      paths(),
      request({
        runId: "run-2",
        records: [
          record({
            id: "t1",
            text: FAR_TEXT,
            author: TAIL_AUTHOR,
            source: TAIL_SOURCE,
            partition: "test",
          }),
        ],
      }),
    );
  }

  /** That cluster re-offered to `test` under a new id, a new tuple, new text. */
  function reofferTheTailCluster(): ExposureRequest {
    return request({
      datasetDigest: DATASET_B,
      splitDigest: SPLIT_B,
      records: [
        record({
          id: "t1-renamed",
          text: words("kappa", 200),
          author: TAIL_AUTHOR,
          source: TAIL_SOURCE,
          partition: "test",
        }),
      ],
    });
  }

  async function ledgerLines(): Promise<string[]> {
    return (await readFile(paths().ledgerPath, "utf8"))
      .split("\n")
      .filter((line) => line !== "");
  }

  /** The chain digest, recomputed over the same key set the module hashes. */
  function eventDigestOf(event: Record<string, unknown>): string {
    const hashed = { ...event };
    delete hashed.eventDigest;
    return sha256BytesHex(new TextEncoder().encode(canonicalJson(hashed)));
  }

  it("refuses every eligibility path when the LAST line was removed", async () => {
    // The tail is where the newest exposures live, and it is the one direction the
    // hash chain cannot see: dropping the last line leaves a prefix whose every
    // `previousEventDigest` still matches, so `readClusterLedger` accepts it. Only
    // the attested height and tail digest catch it.
    await burnATestClusterInTheTail();

    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    await writeFile(paths().ledgerPath, `${lines[0]}\n`, "utf8");
    // The truncated file is intrinsically valid — which is the whole point.
    expect(await readClusterLedger(paths().ledgerPath)).toHaveLength(1);

    await refusesEveryPath(paths(), "CLUSTER_LEDGER_HISTORY_DIVERGED");
  });

  it("names a repair a TRUNCATED ledger can follow, and following it reaches the attested height", async () => {
    // Refusing is half a defence: the ledger on disk is PRESENT and short, and
    // `restore` writes only over state that is absent or byte-identical, so
    // "restore the ledger" on its own is an action this state always refuses. A
    // truncation and a stale `--ledger` copy are the realistic shapes of the
    // corruption this whole attestation exists to catch, so the refusal has to
    // name the sequence that actually recovers from them.
    const commit = await burnATestClusterInTheTail();
    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    await writeFile(paths().ledgerPath, `${lines[0]}\n`, "utf8");

    const failure = (await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_HISTORY_DIVERGED");
    // Measured, and the reason the message may not stop at "restore": the pair the
    // transaction itself returned is refused over the short file.
    await expect(
      restoreClusterLedger(paths(), commit.restorePoint.directory),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_RESTORE_DIVERGENT" });
    expect(failure.message).toContain("move the ledger aside");

    // The named sequence, run exactly as written.
    await rename(paths().ledgerPath, `${paths().ledgerPath}.diverged`);
    const outcome = await restoreClusterLedger(
      paths(),
      commit.restorePoint.directory,
    );
    expect(outcome.ledger).toBe("written");
    expect(outcome.keyring).toBe("identical");
    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(2);
    expect(verified.lastEventDigest).toBe(commit.event.eventDigest);
    // And the protection the truncation removed is back: the cluster the tail
    // burned is refused for `test` again.
    const decision = await preflightExposure(paths(), reofferTheTailCluster());
    expect(decision.eligible).toBe(false);
  });

  it("names the staged ledger a dead run left, in the very refusal that needs it", async () => {
    // The residue the write ORDER deliberately prefers: the keyring was re-attested
    // to N+1 and the crash lost the ledger's rename, so the fsynced bytes are still
    // staged next to it. `verify` reports interrupted writes only on the way OUT of a
    // consistent ledger, so in every state where the report is the repair it was
    // never produced — and the two halves of the module's crash story (refuse the
    // disagreement, report the staged file) could not both happen in one call.
    const commit = await burnATestClusterInTheTail();
    const published = await readFile(paths().ledgerPath, "utf8");
    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    const staged = `${paths().ledgerPath}.4242.1.tmp`;
    await writeFile(staged, published, "utf8");
    await writeFile(paths().ledgerPath, `${lines[0]}\n`, "utf8");

    const failure = (await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_HISTORY_DIVERGED");
    expect(failure.message).toContain(staged);
    // Not a property of `verify` alone: every command that decides eligibility hits
    // this refusal, and the operator reads whichever one they ran.
    const refused = (await preflightExposure(
      paths(),
      reofferTheTailCluster(),
    ).catch((caught: unknown) => caught)) as ClusterLedgerError;
    expect(refused.message).toContain(staged);

    // The repair the message names is real, and it is the whole repair.
    await rename(staged, paths().ledgerPath);
    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(2);
    expect(verified.attestedEventCount).toBe(2);
    expect(verified.lastEventDigest).toBe(commit.event.eventDigest);
    expect(verified.strayTempFiles).toEqual([]);
  });

  it("refuses a tail REWRITTEN in place, at the very height the keyring attests", async () => {
    // Height and tail digest are two halves of one comparison, and only the DIGEST
    // half sees this: the last event is replaced rather than removed, and its own
    // `eventDigest` is recomputed, so the file still holds two events, every
    // `previousEventDigest` still matches, and the attested height still agrees.
    // Emptying `records` is the cheapest edit that returns a burned cluster to
    // `test` — the blocker's exact failure mode, reached through the content of the
    // tail instead of its absence.
    await burnATestClusterInTheTail();

    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    const tail = JSON.parse(lines[1]) as Record<string, unknown>;
    tail.records = [];
    tail.eventDigest = eventDigestOf(tail);
    await writeFile(
      paths().ledgerPath,
      `${lines[0]}\n${JSON.stringify(tail)}\n`,
      "utf8",
    );

    // Intrinsically valid AT the attested height: nothing the file can check about
    // itself is violated, and the height comparison alone would let this through.
    const reread = await readClusterLedger(paths().ledgerPath);
    expect(reread).toHaveLength(2);
    expect(reread[1].records).toEqual([]);

    await refusesEveryPath(
      paths(),
      "CLUSTER_LEDGER_HISTORY_DIVERGED",
      reofferTheTailCluster(),
    );

    // And the diagnosis names THIS divergence: at equal heights the ledger holds no
    // surplus event, so the message about a stale pair of files would misdirect.
    const failure = (await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.message).toContain("at the attested HEIGHT");
  });

  it("hands the burned cluster back once the rewritten tail is itself attested", async () => {
    // The guard on the test above: it must refuse because the ledger DIVERGED from
    // the attestation, not because the re-offer was refusable anyway. Re-attest the
    // keyring to the rewritten tail and the very same re-offer becomes fully
    // eligible — which is what an accepted tail rewrite costs, and the reason the
    // digest half of the comparison is load-bearing rather than defence in depth.
    await burnATestClusterInTheTail();

    const lines = await ledgerLines();
    const tail = JSON.parse(lines[1]) as Record<string, unknown>;
    tail.records = [];
    tail.eventDigest = eventDigestOf(tail);
    await writeFile(
      paths().ledgerPath,
      `${lines[0]}\n${JSON.stringify(tail)}\n`,
      "utf8",
    );
    const keyring = JSON.parse(
      await readFile(paths().keyringPath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      paths().keyringPath,
      `${JSON.stringify(
        {
          ...keyring,
          ledgerWitness: {
            ...(keyring.ledgerWitness as Record<string, unknown>),
            lastEventDigest: tail.eventDigest,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const decision = await preflightExposure(paths(), reofferTheTailCluster());
    expect(decision.refusals).toEqual([]);
    expect(decision.eligible).toBe(true);
  });

  it("keeps accepting a ledger that is legitimately new", async () => {
    // Without this the fix could simply forbid every empty ledger, which would
    // break `init` and the project's first use.
    const virgin = await mkdtemp(join(tmpdir(), "cleanfeed-cluster-virgin-"));
    try {
      const fresh: ClusterLedgerPaths = {
        ledgerPath: join(virgin, "private", CLUSTER_EXPOSURE_LEDGER_FILE),
        keyringPath: join(virgin, "private", CLUSTER_EXPOSURE_KEYRING_FILE),
        backupRoot: join(virgin, "ledger-backups"),
      };
      await initClusterLedger(fresh, { createdAt: "2026-07-28T09:00:00.000Z" });
      const verified = await verifyClusterLedger(fresh);
      expect(verified.eventCount).toBe(0);
      const decision = await preflightExposure(
        fresh,
        request({ records: [record({ id: "t1", partition: "test" })] }),
      );
      expect(decision.eligible).toBe(true);
    } finally {
      await rm(virgin, { recursive: true, force: true });
    }
  });

  it("attests the height and the tail digest inside the writing transaction", async () => {
    await init();
    const { event: first } = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    const afterFirst = JSON.parse(
      await readFile(paths().keyringPath, "utf8"),
    ) as Record<string, unknown>;
    expect(afterFirst.ledgerWitness).toMatchObject({
      eventCount: 1,
      lastEventDigest: first.eventDigest,
    });

    // A refused or failed transaction must not move the witness: the attestation
    // and the event are written together or neither is.
    await expect(
      commitSplitFreeze(paths(), request(), async () => {
        throw new Error("disk full while writing split-artifact.json");
      }),
    ).rejects.toThrow(/disk full/);
    expect(
      (
        JSON.parse(await readFile(paths().keyringPath, "utf8")) as Record<
          string,
          unknown
        >
      ).ledgerWitness,
    ).toMatchObject({ eventCount: 1, lastEventDigest: first.eventDigest });
  });

  it("refuses a keyring that carries keys but attests no history at all", async () => {
    // A hand-stripped witness is the obvious way around the check, so absence of
    // the attestation is itself a hard failure — never "assume zero".
    await consumeOneTestCluster();
    const keyring = JSON.parse(
      await readFile(paths().keyringPath, "utf8"),
    ) as Record<string, unknown>;
    delete keyring.ledgerWitness;
    await writeFile(
      paths().keyringPath,
      `${JSON.stringify(keyring, null, 2)}\n`,
      "utf8",
    );
    await refusesEveryPath(paths(), "CLUSTER_LEDGER_WITNESS_ABSENT");
  });

  it("refuses a witness that is not a height plus a tail digest", async () => {
    await consumeOneTestCluster();
    const keyring = JSON.parse(
      await readFile(paths().keyringPath, "utf8"),
    ) as Record<string, unknown>;
    for (const broken of [
      { eventCount: 1, lastEventDigest: null, updatedAt: "2026-07-28" },
      { eventCount: 0, lastEventDigest: "a".repeat(64), updatedAt: "x" },
      { eventCount: -1, lastEventDigest: "a".repeat(64), updatedAt: "x" },
      { eventCount: 1.5, lastEventDigest: "a".repeat(64), updatedAt: "x" },
      { eventCount: 1, lastEventDigest: "not-a-digest", updatedAt: "x" },
      { eventCount: 1, lastEventDigest: "a".repeat(64) },
      // Stringifies to 64 hex characters, so a check that coerced instead of
      // testing the type would accept it and then blame the LEDGER for diverging.
      { eventCount: 1, lastEventDigest: ["a".repeat(64)], updatedAt: "x" },
    ]) {
      await writeFile(
        paths().keyringPath,
        `${JSON.stringify({ ...keyring, ledgerWitness: broken }, null, 2)}\n`,
        "utf8",
      );
      await expect(
        preflightExposure(paths(), reoffer()),
        JSON.stringify(broken),
      ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_KEYRING_INVALID" });
    }
  });

  it("refuses to init over a keyring that attests a history, on any path", async () => {
    // `init` mints a key only when the keyring has none — so a keyring stripped of
    // its `keys` but still attesting a height would otherwise pass, and the newly
    // minted key family would read every exposed cluster as never exposed.
    await consumeOneTestCluster();
    const keyring = JSON.parse(
      await readFile(paths().keyringPath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      paths().keyringPath,
      `${JSON.stringify({ ...keyring, keys: [] }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      initClusterLedger(freshLedger(), {
        createdAt: "2026-07-28T14:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_ALREADY_INITIALISED" });
  });
});

describe("the state a mutation commits stays restorable", () => {
  // `writeBackup` also runs BEFORE the event is published, so that earlier pair sits
  // at height N while the committed state is N+1 — and with the height attested on
  // the keyring, restoring it over a lost ledger is refused as divergent. Without a
  // backup taken AFTER the ledger is published, the frozen split (E2) and the
  // consumed holdout (H1) would have no restore point at all.

  it("backs up the pair it committed, and that is the one a lost ledger restores from", async () => {
    await init();
    const commit = await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "t1", partition: "test" })] }),
    );

    const directories = await readdir(paths().backupRoot);
    expect(directories).toHaveLength(2);
    const beforeTheMutation = directories
      .map((entry) => join(paths().backupRoot, entry))
      .find((directory) => directory !== commit.restorePoint.directory);
    expect(beforeTheMutation).toBeDefined();

    // Losing the ledger is the case the authenticated backup exists for.
    await rm(paths().ledgerPath, { force: true });
    await expect(
      restoreClusterLedger(paths(), beforeTheMutation as string),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_RESTORE_DIVERGENT" });

    const outcome = await restoreClusterLedger(
      paths(),
      commit.restorePoint.directory,
    );
    expect(outcome.ledger).toBe("written");
    expect(outcome.keyring).toBe("identical");
    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(1);
    expect(verified.lastEventDigest).toBe(commit.event.eventDigest);
  });

  it("does the same for a pilot exposure, and the receipt names the committed bytes", async () => {
    await init();
    const commit = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    // The receipt's digest is of the ledger AS PUBLISHED, which is what makes the
    // directory name distinguish it from the pre-mutation backup.
    const published = await readFile(paths().ledgerPath, "utf8");
    expect(commit.restorePoint.ledgerSha256).toBe(
      sha256BytesHex(new TextEncoder().encode(published)),
    );
    expect(commit.restorePoint.directory).toContain(
      commit.restorePoint.ledgerSha256.slice(0, 8),
    );
  });

  it("says the exposure IS recorded when the post-commit backup cannot be written", async () => {
    // The event is already published by then, so a raw filesystem error would let
    // the operator conclude the split was never frozen — and re-running the command
    // would be refused, because the clusters are now exposed.
    await init();
    const exposure = request({
      records: [record({ id: "t1", partition: "test" })],
    });
    // The event is a pure function of the request, the keyring and the history, so
    // preflight yields the exact line the commit will publish — and therefore the
    // exact backup directory name, which carries the ledger digest.
    const { event } = await preflightExposure(paths(), exposure);
    const willPublish = `${JSON.stringify(event)}\n`;
    const digest = sha256BytesHex(new TextEncoder().encode(willPublish));
    await mkdir(paths().backupRoot, { recursive: true });
    // A FILE where the post-commit backup's directory must go. The pre-mutation
    // backup carries a different ledger digest, so it still succeeds.
    await writeFile(
      join(
        paths().backupRoot,
        `2026-07-28T10-00-00.000Z-${digest.slice(0, 8)}`,
      ),
      "",
      "utf8",
    );

    await expect(commitSplitFreeze(paths(), exposure)).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_COMMITTED_UNBACKED",
    });

    // The claim in that message has to be true: the event is on disk and attested.
    expect(await readFile(paths().ledgerPath, "utf8")).toBe(willPublish);
    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(1);
    expect(verified.attestedEventCount).toBe(1);
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
      backups.find((entry) =>
        entry.startsWith("2026-07-28T13-00-00"),
      ) as string,
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
            record({
              id: "f1",
              text: FAR_TEXT,
              partition: "train",
              source: "th_f1",
            }),
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

// --- the cluster notion C4 and C6 import, and the record adapter E2 will ------

/** A v3 human row with the axes this test controls, schema-validated. */
function humanRow(
  id: string,
  axes: { author: string; source: string },
): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v3Human(), id };
  raw = withAxis(raw, "author", known(axes.author));
  raw = withAxis(raw, "source", known(axes.source));
  // Everything else that GROUP_KEYS unions on is made per-row, so the only
  // connectivity in the fixture is the connectivity the test asks for.
  raw = withAxis(raw, "domainSource", known(`ds_${id}`));
  raw = withAxis(raw, "collectionBatch", known(`cb_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV3(raw);
}

/** A v3 generated row: no author, no source, tied to its seed and nothing else. */
function generatedRow(id: string, humanSeedId: string): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v3Ai(), id };
  raw = withAxis(raw, "humanSeed", known(humanSeedId));
  raw = withAxis(raw, "domainSource", known(`ds_${id}`));
  raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
  raw = withAxis(raw, "generatorVersion", known(`gv_${id}`));
  raw = withAxis(raw, "collectionBatch", known(`cb_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV3(raw);
}

describe("clusterAssignments — the cluster notion C4 and C6 import", () => {
  it("groups by shared value and by lineage, and leaves an isolated row alone", () => {
    const records = [
      humanRow("h_a1", { author: "au_1", source: "th_1" }),
      humanRow("h_a2", { author: "au_2", source: "th_1" }), // same thread as h_a1
      humanRow("h_b1", { author: "au_3", source: "th_2" }), // shares nothing
      generatedRow("g_a1", "h_a1"), // glued to h_a1 by lineage ONLY
    ];

    const { rootById, membersByRoot } = clusterAssignments(records);

    // Three clusters: {h_a1, h_a2, g_a1}, {h_b1}. The generated row shares no
    // axis VALUE with its seed, so only the lineage edge can put it there.
    expect(rootById.get("h_a2")).toBe(rootById.get("h_a1"));
    expect(rootById.get("g_a1")).toBe(rootById.get("h_a1"));
    expect(rootById.get("h_b1")).not.toBe(rootById.get("h_a1"));
    expect(membersByRoot.size).toBe(2);

    // Members are ascending, so a consumer can compare two runs byte for byte.
    expect(membersByRoot.get(rootById.get("h_a1") as string)).toEqual([
      "g_a1",
      "h_a1",
      "h_a2",
    ]);
    expect(membersByRoot.get(rootById.get("h_b1") as string)).toEqual(["h_b1"]);

    // Every record is placed exactly once: the members partition the corpus.
    const placed = [...membersByRoot.values()].flat().sort();
    expect(placed).toEqual(records.map((row) => row.id).sort());
  });
});

describe("exposureInputsFromRecords — R6's three states at the boundary", () => {
  it("carries a known identity and omits notApplicable and unknown alike", () => {
    const human = humanRow("h_a1", { author: "au_1", source: "th_1" });
    const generated = generatedRow("g_a1", "h_a1");
    const withUnknown = validateBenchmarkRecordV3(
      withAxis(
        { ...v3Human(), id: "h_a2" },
        "author",
        unknownAxis("the source row carried no owner"),
      ),
    );

    const inputs = exposureInputsFromRecords(
      [human, generated, withUnknown],
      (record) => (record.label === "ai" ? "train" : "dev"),
    );

    expect(inputs.map((input) => input.id)).toEqual(["h_a1", "g_a1", "h_a2"]);
    expect(inputs.map((input) => input.partition)).toEqual([
      "dev",
      "train",
      "dev",
    ]);

    // `known` -> the identity itself.
    expect(inputs[0].groups.author).toBe("au_1");
    expect(inputs[1].groups.humanSeed).toBe("h_a1");
    // `notApplicable` -> the axis is ABSENT, never a synthetic per-row id: a
    // generated row has no human author, and inventing one would mint a cluster.
    expect(inputs[1].groups.author).toBeUndefined();
    expect(inputs[0].groups.humanSeed).toBeUndefined();
    // `unknown` -> also absent. It means "this row joins no other here"; the
    // ELIGIBILITY consequence of `unknown` belongs to selection, not to the
    // ledger's index.
    expect(inputs[2].groups.author).toBeUndefined();

    // The text travels so the fingerprint can be computed, and nothing else does.
    expect(Object.keys(inputs[0]).sort()).toEqual([
      "groups",
      "id",
      "partition",
      "text",
    ]);
  });

  it("produces inputs the ledger accepts and indexes as one lineage", async () => {
    // The adapter and the ledger are one path, so the pair is exercised as one:
    // the human seed in `dev`, then the generation offered to `test`.
    await init();
    const human = humanRow("h_a1", {
      author: "person_0123456789abcdef",
      source: "th_1",
    });
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: exposureInputsFromRecords([human], () => "dev"),
      }),
    );

    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: exposureInputsFromRecords(
          [generatedRow("g_a1", "h_a1")],
          () => "test",
        ),
      }),
    );
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
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
