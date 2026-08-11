// The named acceptance tests of C3's exposure ledger, plus the boundary checks
// the ledger owes its callers.
//
// Every test runs against a TEMPORARY fixture directory. Nothing here touches
// `benchmark/data/private/`: freezing a real split is E2's, and a real exposure
// event written from a test would burn eligibility for the whole project.

import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import { runCli } from "../cli.ts";
import { sha256BytesHex } from "../digests.ts";
import {
  ALL_GROUP_AXES,
  V3_GROUP_AXES,
  V4_GROUP_AXES,
  recordGroupAxes,
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkRecord,
} from "../schema.ts";
import {
  known,
  unknownAxis,
  v3Ai,
  v3Human,
  v4Human,
  withAxis,
} from "./helpers/v3-record-fixture.ts";
import {
  BLIND_PARTITIONS,
  CLUSTER_EXPOSURE_KEYRING_FILE,
  CLUSTER_EXPOSURE_LEDGER_FILE,
  ClusterLedgerError,
  EXPOSURE_IDENTITY_AXES,
  LEDGER_AXIS_VOCABULARIES,
  LEDGER_PARTITIONS,
  backupClusterLedger,
  clusterAssignments,
  commitSplitFreeze,
  exposureInputsFromRecords,
  initClusterLedger,
  parseExposureRequest,
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

/**
 * A groups map that ANSWERS a whole version tuple: the identities the caller names,
 * and `null` — the spelling of "this row has no identity here" — on every other axis
 * the version declares.
 *
 * ONE operation, and deliberately: the ledger accepts only a total map, and eight
 * fixtures completed by hand would be eight copies of the vocabulary, drifting apart
 * the moment the schema adds an axis. The vocabulary is read from `../schema.ts` for
 * the same reason the guard reads it.
 *
 * An identity naming an axis the vocabulary does not declare THROWS here rather than
 * being dropped: a fixture that means to exercise `collectionBatch` under the v4
 * tuple is a mistake in the fixture, and silently ignoring it would make the test
 * pass for the wrong reason.
 */
function answers(
  identities: Record<string, string | undefined>,
  vocabulary: readonly string[] = V3_GROUP_AXES,
): Record<string, string | null> {
  const stray = Object.keys(identities).filter(
    (axis) => !vocabulary.includes(axis),
  );
  if (stray.length > 0) {
    throw new Error(
      `the fixture names [${stray.join(", ")}], which this ${vocabulary.length}-axis vocabulary does not declare`,
    );
  }
  const groups: Record<string, string | null> = {};
  for (const axis of vocabulary) groups[axis] = identities[axis] ?? null;
  return groups;
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
    groups: answers({
      author: spec.author ?? "person_0123456789abcdef",
      source: spec.source ?? "th_ptso_140233",
      domainSource: "ds_ptso_qa",
      collectionBatch: "cb_ptso_20260727",
      nearDuplicate: `nd_${spec.id}`,
    }),
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

/** The chain digest, recomputed over the same key set the module hashes. */
function chainDigestOf(event: Record<string, unknown>): string {
  const hashed = { ...event };
  delete hashed.eventDigest;
  return sha256BytesHex(new TextEncoder().encode(canonicalJson(hashed)));
}

function recordsOf(event: Record<string, unknown>): Record<string, unknown>[] {
  return event.records as Record<string, unknown>[];
}

/**
 * Rewrites the ledger from `edit` and leaves it CONSISTENT: the hash chain is
 * re-closed and the keyring re-attested, so every eligibility path accepts the file
 * and what the test measures is the edit and not a divergence.
 *
 * It is the only way to put a record shape on disk that today's writer cannot
 * produce, and two of those matter here: a LEGACY record, written before a request
 * had to answer a whole axis tuple, and a record whose persisted form is broken. The
 * writer can no longer make either, so a test that forged neither would be pinning
 * the reader against the writer's current output alone.
 */
async function rewriteLedger(
  edit: (events: Record<string, unknown>[]) => void,
): Promise<void> {
  const events = (await readFile(paths().ledgerPath, "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  edit(events);
  let previous: string | null = null;
  for (const event of events) {
    event.previousEventDigest = previous;
    event.eventDigest = chainDigestOf(event);
    previous = event.eventDigest as string;
  }
  await writeFile(
    paths().ledgerPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
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
          eventCount: events.length,
          lastEventDigest: previous,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Exactly the axes the writer used to persist: the ones that carried an id. */
const LEGACY_AXES = [
  "author",
  "source",
  "domainSource",
  "collectionBatch",
  "nearDuplicate",
];

/**
 * One event's record trimmed back to the shape the old writer produced: the axes it
 * had an identity on, and silence about the rest. It reaches disk through
 * `rewriteLedger` because the writer answers a whole tuple now and can no longer
 * produce it.
 */
function trimToLegacy(event: Record<string, unknown>): void {
  const digests = recordsOf(event)[0].groupDigests as Record<string, unknown>;
  for (const axis of Object.keys(digests)) {
    if (!LEGACY_AXES.includes(axis)) delete digests[axis];
  }
}

/**
 * Drives the real CLI over the fixture and returns the bytes it WROTE.
 *
 * Going through `runCli` rather than the command function is what proves the
 * subcommand, its closed action set and its flags are wired, not merely present.
 * Capturing `stdout` is what makes the printed answer assertable, and the printed
 * answer is the whole of what an operator gets: a sentence the command composes and
 * nothing prints is a sentence nobody reads.
 *
 * `stdout.write` is restored in a `finally` — a leaked stub silences every later
 * test's output.
 */
async function clusterLedgerCli(
  action: string,
  ...flags: string[]
): Promise<string> {
  const written: string[] = [];
  const write = stdout.write.bind(stdout);
  (stdout as unknown as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ) => {
    written.push(chunk);
    return true;
  };
  try {
    await runCli([
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
  } finally {
    (stdout as unknown as { write: typeof write }).write = write;
  }
  return written.join("");
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

describe("acceptance 1 — a new id or a new tuple does not restore blind-partition eligibility", () => {
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

  it("still admits that cluster into every looked-at partition", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", partition: "dev" })],
      }),
    );

    // The asymmetry IS the control: barred from the blind partitions, open
    // wherever development already reads. Widened to all five it closes the
    // corpus and buys blindness nowhere.
    for (const partition of ["train", "dev", "cal-A"] as const) {
      const decision = await preflightExposure(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [record({ id: "r2", text: FAR_TEXT, partition })],
        }),
      );

      expect(decision.refusals).toEqual([]);
      expect(decision.eligible).toBe(true);
    }
  });
});

describe("acceptance 1b — cal-B is blind too, and the asymmetry survives", () => {
  const SEED_TEXT = words("beta", 200);
  const CHILD_TEXT = words("gamma", 200);

  function generation(
    id: string,
    partition: ExposureRecordInput["partition"],
    humanSeed: string,
  ): ExposureRecordInput {
    return {
      id,
      text: CHILD_TEXT,
      partition,
      groups: answers({
        humanSeed,
        promptTemplate: `pt_${id}`,
        generatorFamily: "gemini-3_5-flash-medium",
      }),
    };
  }

  it("names exactly the two partitions sealed until v2.0, both of them active", () => {
    expect([...BLIND_PARTITIONS].sort()).toEqual(["cal-B", "test"]);
    for (const partition of BLIND_PARTITIONS) {
      expect(LEDGER_PARTITIONS).toContain(partition);
    }
    expect(BLIND_PARTITIONS).not.toContain("cal-A");
  });

  it("refuses a previously exposed cluster for cal-B under a fresh id, tuple and far text", async () => {
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
        records: [
          record({ id: "brand-new-id", text: FAR_TEXT, partition: "cal-B" }),
        ],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("refuses a near-duplicate of exposed text for cal-B under a fresh cluster", async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({
        eventType: "pilot-exposure",
        records: [record({ id: "r1", partition: "dev" })],
      }),
    );

    // A disjoint sampling unit, so the refusal can only come from the content
    // screen — the second check the same gate carries.
    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          record({
            id: "r2",
            text: NEAR_TEXT,
            partition: "cal-B",
            author: "person_fedcba9876543210",
            source: "th_ptso_999999",
          }),
        ],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "historical-near-duplicate",
    );
  });

  it("still admits a near-duplicate into cal-A", async () => {
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
        records: [
          record({
            id: "r2",
            text: NEAR_TEXT,
            partition: "cal-A",
            author: "person_fedcba9876543210",
            source: "th_ptso_999999",
          }),
        ],
      }),
    );

    expect(decision.refusals).toEqual([]);
    expect(decision.eligible).toBe(true);
  });

  it("refuses the lineage child of an exposed seed for cal-B", async () => {
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
        records: [generation("g1", "cal-B", "h1")],
      }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
  });

  it("does not consume a record-line frozen into cal-B", async () => {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "b1", partition: "cal-B" })] }),
    );

    // Only a line that sat in `test` leaves all five partitions. Reading `cal-B`
    // as consuming would give events already on disk a meaning they were not
    // written with.
    const decision = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [record({ id: "b1", partition: "dev" })],
      }),
    );

    expect(decision.refusals).toEqual([]);
    expect(decision.eligible).toBe(true);
  });

  it("bars the cluster of a cal-B line from the next blind block", async () => {
    await init();
    await commitSplitFreeze(
      paths(),
      request({ records: [record({ id: "b1", partition: "cal-B" })] }),
    );

    // Hardcoded rather than iterating `BLIND_PARTITIONS`: driving the loop from
    // the production constant would make an empty constant pass vacuously and a
    // swapped one track the swap.
    for (const partition of ["cal-B", "test"] as const) {
      const decision = await preflightExposure(
        paths(),
        request({
          datasetDigest: DATASET_B,
          splitDigest: SPLIT_B,
          records: [record({ id: "b2", text: FAR_TEXT, partition })],
        }),
      );

      expect(decision.eligible).toBe(false);
      expect(decision.refusals.map((refusal) => refusal.reason)).toContain(
        "cluster-exposed-previously",
      );
    }
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
            groups: answers({
              source: "th_new_1",
              author: "person_fedcba9876543210",
            }),
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
            groups: answers({
              source: "th_other_77",
              author: "person_aaaabbbbccccdddd",
            }),
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
            groups: answers({
              source: "th_other_78",
              author: "person_aaaabbbbcccceeee",
            }),
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
      // only thing that can tie it to anything — and `null` is how the map says so
      // while still answering the whole tuple.
      groups: answers({
        ...lineage,
        promptTemplate: `pt_${id}`,
        generatorFamily: "gemini-3_5-flash-medium",
      }),
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
            groups: answers({
              author: "person_0123456789abcdef",
              source: "th_long_parent",
              nearDuplicate: longParent,
            }),
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
    // design across the whole corpus: comparing it would bar every future record
    // from the blind partitions after the first exposure, which is a shutdown and
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
    // The whole tuple the request answered, and not the subset that carried an
    // identity: the module's promise is that widening EXPOSURE_IDENTITY_AXES later
    // needs no re-derivation of history, and that is only true if every axis the
    // record answered is in the event.
    expect(Object.keys(decision.event.records[0].groupDigests).sort()).toEqual(
      [...V3_GROUP_AXES].sort(),
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
   * really does hand that cluster's blind-partition eligibility back — the two
   * tests below would pass vacuously against a cluster the head also exposes.
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

  it("refuses an event edited WITHOUT touching its declared eventDigest", async () => {
    // A cadeia fecha contra o `eventDigest` DECLARADO do evento anterior
    // (`expected = events[index - 1].eventDigest`), nao contra um recalculo dele. Logo o
    // unico lugar que amarra o CONTEUDO de um evento ao seu digest e a checagem
    // `computeEventDigest(event) !== event.eventDigest` em `validateEventShape`.
    //
    // Esta forja explora exatamente essa divisao: esvazia os `records` de um evento
    // `holdout-consumed` e NAO mexe no `eventDigest` declarado. A cadeia continua fechada, a
    // testemunha do keyring continua citando o mesmo digest de cauda, e o indice passaria a
    // ver zero unidades queimadas — toda unidade que o test consumiu voltaria elegivel.
    await burnATestClusterInTheTail();

    const linhas = await ledgerLines();
    const eventos = linhas.map(
      (linha) => JSON.parse(linha) as Record<string, unknown>,
    );
    let alvo = -1;
    for (let i = eventos.length - 1; i >= 0; i -= 1) {
      const candidato = eventos[i] as Record<string, unknown>;
      if (Array.isArray(candidato.records) && candidato.records.length > 0) {
        alvo = i;
        break;
      }
    }
    expect(alvo).toBeGreaterThanOrEqual(0);
    const evento = eventos[alvo] as Record<string, unknown>;
    const digestDeclarado = evento.eventDigest;

    // Esvazia o conteudo, preserva o digest declarado.
    evento.records = [];
    expect(evento.eventDigest).toBe(digestDeclarado);
    // E a forja e COMPETENTE: o digest declarado deixou de casar o conteudo, mas a cadeia
    // continua intacta, porque ninguem recalcula o elo anterior.
    expect(eventDigestOf(evento)).not.toBe(digestDeclarado);

    await writeFile(
      paths().ledgerPath,
      `${eventos.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf8",
    );

    await refusesEveryPath(paths(), "CLUSTER_LEDGER_EVENT_DIGEST_MISMATCH");
  });

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
    // Nothing was interrupted here, so no staged file is offered as the shortcut.
    expect(failure.message).toContain("No interrupted write is on disk.");

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
    // And the staged file is offered BEFORE the backup, because the backup is the
    // wrong repair here: every backup keyring attests the pre-mutation height, so
    // an operator who reaches for it first is refused.
    expect(failure.message).toContain("FIRST thing to check");
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

  it("names the staged ledger when the ledger is ABSENT, which is the state verify promised to diagnose", async () => {
    // `verify` is the command whose docstring promises the attested height and the
    // interrupted writes, and a generic "no ledger here" refusal used to run BEFORE
    // the attested check — so for the shape a mistyped `--ledger` actually produces
    // it reported neither the lost history nor the fsynced bytes that are the repair.
    const commit = await burnATestClusterInTheTail();
    const published = await readFile(paths().ledgerPath, "utf8");
    const target = freshLedger();
    await mkdir(dirname(target.ledgerPath), { recursive: true });
    const staged = `${target.ledgerPath}.4242.1.tmp`;
    await writeFile(staged, published, "utf8");

    const failure = (await verifyClusterLedger(target).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_HISTORY_ABSENT");
    expect(failure.message).toContain(staged);

    // And the repair it names is the whole repair, from `verify` alone.
    await rename(staged, target.ledgerPath);
    const verified = await verifyClusterLedger(target);
    expect(verified.eventCount).toBe(2);
    expect(verified.lastEventDigest).toBe(commit.event.eventDigest);
  });

  it("still refuses an absent ledger plainly when the keyring attests no history", async () => {
    // The other direction: a keyring at height zero has no history to have lost, so
    // the refusal must stay "there is no ledger at this path" and not accuse the
    // operator of losing events a project this new never wrote.
    const virgin = await mkdtemp(join(tmpdir(), "cleanfeed-cluster-absent-"));
    try {
      const fresh: ClusterLedgerPaths = {
        ledgerPath: join(virgin, "private", CLUSTER_EXPOSURE_LEDGER_FILE),
        keyringPath: join(virgin, "private", CLUSTER_EXPOSURE_KEYRING_FILE),
        backupRoot: join(virgin, "ledger-backups"),
      };
      await initClusterLedger(fresh, { createdAt: "2026-07-28T09:00:00.000Z" });
      // The one crash window `init` leaves: the keyring is published before the
      // empty ledger, so "zero attested, no file" is a state that really occurs.
      await rm(fresh.ledgerPath, { force: true });

      const failure = (await verifyClusterLedger(fresh).catch(
        (caught: unknown) => caught,
      )) as ClusterLedgerError;
      expect(failure.code).toBe("CLUSTER_LEDGER_ABSENT");
      expect(failure.message).toContain("nothing was lost");
      expect(failure.message).not.toContain("already burned");
    } finally {
      await rm(virgin, { recursive: true, force: true });
    }
  });

  it("keeps the backup as the repair when the only temp on disk is a KEYRING one", async () => {
    // A staged keyring is not a candidate for the ledger's missing state — it is a
    // copy of `secrets.person` and every exposure key — so it must not displace the
    // repair that does work. Reordering on it sends the operator to check bytes that
    // provably cannot hold the events the ledger lost.
    await burnATestClusterInTheTail();
    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    await writeFile(paths().ledgerPath, `${lines[0]}\n`, "utf8");
    const strayKeyring = `${paths().keyringPath}.777.1.tmp`;
    await writeFile(strayKeyring, "{}", "utf8");

    const failure = (await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_HISTORY_DIVERGED");
    // Still NAMED, because a temp nobody reports is a temp nobody deletes.
    expect(failure.message).toContain(strayKeyring);
    expect(failure.message).toContain("To recover:");
    expect(failure.message).not.toContain("FIRST thing to check");
  });

  it("names the temps without offering a rename when the ledger holds SURPLUS events", async () => {
    // The mirror residue: the ledger published and the attestation did not. The
    // ledger's tail may be a real exposure, so renaming a staged file over it would
    // destroy the very events the diagnosis says not to discard — and the staged
    // file here carries exactly the attested tail digest, so the candidate half of
    // the note reads as an instruction rather than a hypothesis.
    await burnATestClusterInTheTail();
    const lines = await ledgerLines();
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
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
            eventCount: 1,
            lastEventDigest: first.eventDigest,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const staged = `${paths().ledgerPath}.4242.1.tmp`;
    await writeFile(staged, `${lines[0]}\n`, "utf8");

    const failure = (await verifyClusterLedger(paths()).catch(
      (caught: unknown) => caught,
    )) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_HISTORY_DIVERGED");
    expect(failure.message).toContain("Do NOT discard the surplus");
    expect(failure.message).toContain(staged);
    expect(failure.message).not.toContain("renaming it over the ledger");
    expect(failure.message).not.toContain("CANDIDATE");
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

  it("refuses a witness whose HEIGHT was bumped while its tail digest stayed correct", async () => {
    // The HEIGHT half of the comparison, on its own. On an honestly appended ledger
    // the digest half implies it — losing height moves the tail — but a HAND-WRITTEN
    // witness has no such discipline: `parseWitness` ties only a height of zero to a
    // null digest, so a keyring can claim three events while naming the true tail of
    // a one-event ledger. Deleting `events.length !== witness.eventCount` leaves
    // every other test in this file green.
    await consumeOneTestCluster();
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
            eventCount: 3,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await refusesEveryPath(paths(), "CLUSTER_LEDGER_HISTORY_DIVERGED");
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

  /** A restore point at height 1 against a disk that has moved on to height 2. */
  async function bothFilesMovedOn(): Promise<ClusterExposureCommit> {
    await init();
    const first = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await commitSplitFreeze(
      paths(),
      request({
        runId: "run-2",
        records: [
          record({
            id: "t1",
            text: FAR_TEXT,
            author: "person_aaaabbbbccccdddd",
            source: "th_9",
            partition: "test",
          }),
        ],
      }),
    );
    return first;
  }

  it("reports the LEDGER's divergence, and reports the same one on every run", async () => {
    // Both halves of the pair diverge from that restore point — the ledger by an
    // event, the keyring by the attestation of it — and only the ledger's refusal
    // carries the move-aside repair. Deciding which one the operator reads by which
    // read finishes first spends an operator's night on a message that changes.
    const first = await bothFilesMovedOn();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const failure = (await restoreClusterLedger(
        paths(),
        first.restorePoint.directory,
      ).catch((caught: unknown) => caught)) as ClusterLedgerError;
      expect(failure.code).toBe("CLUSTER_LEDGER_RESTORE_DIVERGENT");
      expect(failure.message).toContain("the ledger on disk differs");
      expect(failure.message).toContain("move the ledger aside");
    }
  });

  it("checks the ledger's plan before the keyring's, whichever plan fails sooner", async () => {
    // Pinned WITHOUT a race: the keyring side of this backup is now unreadable,
    // which fails on its first await, while the ledger side still has to digest the
    // backup and read the file on disk. Concurrent plans report the keyring; ordered
    // plans report the ledger, which is the refusal that names a repair.
    const first = await bothFilesMovedOn();
    await rm(
      join(first.restorePoint.directory, CLUSTER_EXPOSURE_KEYRING_FILE),
      {
        force: true,
      },
    );

    const failure = (await restoreClusterLedger(
      paths(),
      first.restorePoint.directory,
    ).catch((caught: unknown) => caught)) as ClusterLedgerError;
    expect(failure.code).toBe("CLUSTER_LEDGER_RESTORE_DIVERGENT");
    expect(failure.message).toContain("the ledger on disk differs");
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
  const cli = clusterLedgerCli;

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
  // Every other axis is made per-row, so the only connectivity in the fixture is the
  // connectivity the test asks for. `domainSource` and `collectionBatch` are not axes
  // the splitter unions on, and both admit `known` and nothing else in every class
  // (schema AXIS_STATE_RULE), so per-row values are the only way to write them.
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
    // `notApplicable` -> `null`, never a synthetic per-row id: a generated row has
    // no human author, and inventing one would mint a cluster. `null` and not an
    // absent key, because the axis was ANSWERED — the record does declare it, and
    // what it declares is that there is nothing here.
    expect(inputs[1].groups.author).toBeNull();
    expect(inputs[0].groups.humanSeed).toBeNull();
    // `unknown` -> also `null`. It means "this row joins no other here"; the
    // ELIGIBILITY consequence of `unknown` belongs to selection, not to the
    // ledger's index.
    expect(inputs[2].groups.author).toBeNull();

    // The text travels so the fingerprint can be computed, and nothing else does.
    expect(Object.keys(inputs[0]).sort()).toEqual([
      "groups",
      "id",
      "partition",
      "text",
    ]);
  });

  it("answers every axis of the record version, with null where the axis is not known", async () => {
    // TOTAL over the tuple the record's own version declares, and that is the whole
    // adapter's contract now: emitting only the `known` axes produced exactly the
    // partial map the ledger refuses, so the one sanctioned way of building a request
    // from a corpus could not build an acceptable one.
    await init();
    const human = humanRow("h_a1", {
      author: "person_0123456789abcdef",
      source: "th_1",
    });
    const v4 = validateBenchmarkRecordV4(
      withAxis(v4Human(), "author", known("person_0123456789abcdef")),
    );

    const [fromV3] = exposureInputsFromRecords([human], () => "dev");
    expect(Object.keys(fromV3.groups).sort()).toEqual(
      [...V3_GROUP_AXES].sort(),
    );
    const [fromV4] = exposureInputsFromRecords([v4], () => "dev");
    expect(Object.keys(fromV4.groups).sort()).toEqual(
      [...V4_GROUP_AXES].sort(),
    );

    // `null` where the record says nothing is there: a human row has no seed, and the
    // generation it seeded has no human author.
    expect(fromV3.groups.humanSeed).toBeNull();
    const [fromGenerated] = exposureInputsFromRecords(
      [generatedRow("g_a1", "h_a1")],
      () => "train",
    );
    expect(fromGenerated.groups.author).toBeNull();
  });

  it("produces inputs the ledger accepts", async () => {
    // The adapter and the guard are one path: a map the adapter emits has to be a map
    // the writer takes, on BOTH record versions, or the corpus -> request path is
    // broken for the version nobody tested.
    await init();
    for (const row of [
      humanRow("h_a1", { author: "person_0123456789abcdef", source: "th_1" }),
      validateBenchmarkRecordV4(
        withAxis(v4Human(), "author", known("person_0123456789abcdef")),
      ),
    ]) {
      const decision = await preflightExposure(
        paths(),
        request({ records: exposureInputsFromRecords([row], () => "dev") }),
      );
      expect(decision.eligible, row.id).toBe(true);
      expect(
        Object.keys(decision.event.records[0].groupDigests).sort(),
      ).toEqual([...recordGroupAxes(row)].sort());
    }
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

// The ledger's two v4 halves, and the reason each needs a fixture of its own: the
// adapter DECIDES which axes an event carries, the loader DECIDES which axis names a
// stored event may name, and on v2/v3 corpora the v3 tuple and the union are
// extensionally identical — only a v4 record separates them. The module's own promise
// is that "the event still RECORDS every axis a record fills", and a lost axis is
// unrecoverable: history would have to be re-derived from a corpus that no longer
// exists.
describe("the exposure ledger reads a v4 record by the axes v4 declares", () => {
  it("carries the three axes v4 introduces and not the one it retired", () => {
    const inputs = exposureInputsFromRecords(
      [validateBenchmarkRecordV4(v4Human())],
      () => "dev",
    );
    expect(inputs[0].groups.sourceMaterialBatch).toBe("smb_ptwiki_20220301");
    expect(inputs[0].groups.extractionRun).toBe("er_ptwiki_20260727");
    // `generationBatch` is `notApplicable` on a human row, so it is answered `null`
    // rather than with a synthetic id — the same rule the three-states test above
    // pins.
    expect(inputs[0].groups.generationBatch).toBeNull();
    // `collectionBatch` is the axis v4 RETIRED, so it is ABSENT and not `null`: a v4
    // record does not declare it at all, and answering it would put a key in the
    // event that no version's tuple has.
    expect(inputs[0].groups.collectionBatch).toBeUndefined();
  });

  it("stores the three axes in the event's groupDigests", async () => {
    await init();
    // The keyed person pseudonym the ledger requires on `groups.author`; the fixture
    // pool's shorter token is refused there, and that refusal is another test's.
    const row = validateBenchmarkRecordV4(
      withAxis(v4Human(), "author", known("person_0123456789abcdef")),
    );
    const decision = await preflightExposure(
      paths(),
      request({ records: exposureInputsFromRecords([row], () => "dev") }),
    );
    const digests = decision.event.records[0].groupDigests;
    // The v4 TUPLE, whole: the three axes v4 introduced included, `collectionBatch`
    // excluded because v4 retired it.
    expect(Object.keys(digests).sort()).toEqual([...V4_GROUP_AXES].sort());
    expect(digests.sourceMaterialBatch.length).toBeGreaterThan(0);
    expect(digests.extractionRun.length).toBeGreaterThan(0);
    // Answered without an identity, and that is what the empty list records.
    expect(digests.generationBatch).toEqual([]);
  });

  it("writes an event that answers the v4 tuple, and only a version's tuple", async () => {
    await init();
    // The WRITER's half. It closes against ONE version, so a map of the three v4-only
    // axes alone is refused here and the loader's tolerance for it has to be shown on
    // a stored event instead (the test below).
    const v4Only = {
      sourceMaterialBatch: "smb_ptwiki_20220301",
      generationBatch: "gb_agy_20260724",
      extractionRun: "er_ptwiki_20260727",
    };
    const decision = await preflightExposure(
      paths(),
      request({
        records: [
          {
            id: "r_v4",
            text: BASE_TEXT,
            partition: "dev",
            groups: answers(v4Only, V4_GROUP_AXES),
          },
        ],
      }),
    );
    expect(Object.keys(decision.event.records[0].groupDigests).sort()).toEqual(
      [...V4_GROUP_AXES].sort(),
    );

    await expect(
      preflightExposure(
        paths(),
        request({
          records: [
            {
              id: "r_v4_partial",
              text: BASE_TEXT,
              partition: "dev",
              groups: v4Only,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_GROUPS_INCOMPLETE" });
  });

  it("accepts a stored event naming an axis only v4 declares", async () => {
    await init();
    // The LOADER's half, and it has to be shown on a line already on disk: the
    // loader's vocabulary is the UNION and not one version's tuple, because a ledger
    // outlives a schema bump — an event written from a v4 corpus and read back after,
    // or before, must not be a `CLUSTER_LEDGER_AXIS_UNKNOWN`. The line is forged
    // rather than written, since the writer now answers one whole tuple and could
    // never produce this partial shape again.
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await rewriteLedger((events) => {
      const record = recordsOf(events[0])[0];
      const digests = record.groupDigests as Record<string, unknown>;
      const kept = digests.source;
      for (const axis of Object.keys(digests)) delete digests[axis];
      digests.sourceMaterialBatch = kept;
      digests.generationBatch = [];
      digests.extractionRun = [];
    });

    const events = await readClusterLedger(paths().ledgerPath);
    expect(Object.keys(events[0].records[0].groupDigests).sort()).toEqual([
      "extractionRun",
      "generationBatch",
      "sourceMaterialBatch",
    ]);
  });
});

// ---------------------------------------------------------------------------
// A `groups` map that answers NOTHING used to be accepted, and the exposure it
// recorded compared nothing: `{}` is an object and is not null, which was the only
// thing asked of it. Everything below pins the criterion that replaced that check —
// the map answers exactly the axes ONE version declares — and pins it on both paths,
// because the parser guards a hand-written file and the library path guards the code.
// ---------------------------------------------------------------------------

describe("a groups map answers one version's axis tuple, or it is refused", () => {
  function caught(action: () => unknown): ClusterLedgerError {
    try {
      action();
    } catch (error) {
      return error as ClusterLedgerError;
    }
    throw new Error("expected the call to throw");
  }

  /** A request as it arrives from a FILE, with its one record's groups replaced. */
  function rawRequestWithGroups(groups: unknown): unknown {
    const raw = JSON.parse(JSON.stringify(request())) as {
      records: Record<string, unknown>[];
    };
    raw.records[0].groups = groups;
    return raw;
  }

  function inputWithGroups(
    groups: Record<string, string | null>,
  ): ExposureRequest {
    return request({
      records: [{ id: "r1", text: BASE_TEXT, partition: "dev", groups }],
    });
  }

  it("refuses a request whose groups answers fewer axes than one version declares", () => {
    const failure = caught(() =>
      parseExposureRequest(rawRequestWithGroups({})),
    );
    expect(failure.code).toBe("CLUSTER_LEDGER_GROUPS_INCOMPLETE");
    // The diagnosis NAMES the axes, because "incomplete" alone leaves an operator
    // guessing which vocabulary the file was supposed to answer.
    for (const axis of ["author", "humanSeed", "nearDuplicate"]) {
      expect(failure.message).toContain(axis);
    }
  });

  it("refuses a groups map that is an array, which typeof calls an object", () => {
    // `typeof [] === "object"` and an array is not null, so the old check passed it
    // and `Object.entries` of it iterated nothing: the same empty map by another
    // spelling.
    const failure = caught(() =>
      parseExposureRequest(rawRequestWithGroups([])),
    );
    expect(failure.code).toBe("CLUSTER_LEDGER_REQUEST_INVALID");
  });

  it("refuses an empty groups map on the library path too, not only in the parser", async () => {
    // E2's freeze path builds an `ExposureRecordInput` in code and never sees the JSON
    // parser, so a guard living only in the parser guards the hand-written file and
    // leaves the real writer open.
    await init();
    await expect(
      preflightExposure(paths(), inputWithGroups({})),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_GROUPS_INCOMPLETE" });
  });

  it("refuses a groups map that answers only some of its version axes", async () => {
    // The PARTIAL map is the same defect in a size that is easy to miss, and it is
    // what "the map is not empty" leaves alive.
    await init();
    const partial = { author: "person_0123456789abcdef", source: "th_1" };
    await expect(
      preflightExposure(paths(), inputWithGroups(partial)),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_GROUPS_INCOMPLETE" });
    expect(
      caught(() => parseExposureRequest(rawRequestWithGroups(partial))).code,
    ).toBe("CLUSTER_LEDGER_GROUPS_INCOMPLETE");
  });

  it("refuses a groups map that mixes v3-only and v4-only axes", async () => {
    // A chimera no version declares: `collectionBatch` is v3's, `generationBatch` is
    // one of the three axes v4 replaced it with. Accepting the UNION would accept
    // this, and an event that answers a set no version has cannot be re-derived from
    // any corpus.
    await init();
    await expect(
      preflightExposure(
        paths(),
        inputWithGroups({
          ...answers({
            author: "person_0123456789abcdef",
            source: "th_1",
            collectionBatch: "cb_1",
          }),
          generationBatch: "gb_1",
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_GROUPS_INCOMPLETE" });
  });

  it("accepts a total map over each version tuple, and only those", async () => {
    await init();
    const identities = { author: "person_0123456789abcdef", source: "th_1" };
    for (const vocabulary of [V3_GROUP_AXES, V4_GROUP_AXES]) {
      const decision = await preflightExposure(
        paths(),
        inputWithGroups(answers(identities, vocabulary)),
      );
      expect(
        Object.keys(decision.event.records[0].groupDigests).sort(),
        `the ${vocabulary.length}-axis tuple`,
      ).toEqual([...vocabulary].sort());
    }
    // And the UNION of the two is not a tuple any version declares, so the map that
    // answers all fifteen axes is refused just like the map that answers five.
    await expect(
      preflightExposure(
        paths(),
        inputWithGroups(answers(identities, ALL_GROUP_AXES)),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_GROUPS_INCOMPLETE" });
  });

  it("the vocabularies the ledger accepts are exactly the tuples recordGroupAxes returns", () => {
    // THE pin of the mirror. The ledger must not carry its own list of axis names:
    // `recordGroupAxes` is the authority on what a record version declares, and a
    // second list here would go on accepting a set the schema had already changed.
    const tupleKey = (axes: readonly string[]): string =>
      [...axes].sort().join(",");
    // `recordGroupAxes` dispatches on this one field and reads nothing else, so a
    // stub is the whole record it needs — and v2 has no fixture builder, because the
    // schema does not mint v2 records any more while the ledger still reads corpora
    // that were.
    const declared = new Set(
      [2, 3, 4].map((schemaVersion) =>
        tupleKey(
          recordGroupAxes({ schemaVersion } as unknown as BenchmarkRecord),
        ),
      ),
    );
    // EQUALITY of the two sets, and not containment in one direction: a vocabulary
    // here that no record version declares is the second authority this pin exists to
    // forbid, and a subset of the union satisfies "every axis is a declared axis"
    // while being a tuple no corpus can ever answer.
    expect(LEDGER_AXIS_VOCABULARIES.map(tupleKey).sort()).toEqual(
      [...declared].sort(),
    );
    // And the union of what the WRITER accepts is exactly what the READER accepts,
    // so no axis can be storable-but-unwritable or the other way round.
    expect([...new Set(LEDGER_AXIS_VOCABULARIES.flat())].sort()).toEqual(
      [...ALL_GROUP_AXES].sort(),
    );
  });

  it("records every axis the request answered, with an empty digest list where there was no identity", async () => {
    await init();
    const decision = await preflightExposure(paths(), request());
    const digests = decision.event.records[0].groupDigests;
    expect(Object.keys(digests).sort()).toEqual([...V3_GROUP_AXES].sort());
    // The axis with an identity carries one digest per key version...
    expect(digests.author).toHaveLength(1);
    // ...and the axis answered `null` carries the EMPTY list, which is the marker
    // that the event asked about it. Written only in the event, never as a new
    // record field: `validateEventShape` requires every key of RECORD_KEYS, so a new
    // field would refuse retroactively every event already on disk.
    expect(digests.humanSeed).toEqual([]);
    expect(digests.derivationRoot).toEqual([]);
  });

  it("a null identity is an answer the parsed request keeps, never a skip", async () => {
    // The parser used to `continue` past a `null`, so a file that answered explicitly
    // was reduced to the silence of an absent key — and the record it produced was
    // then partial for exactly the axes it had taken the trouble to answer.
    await init();
    const parsed = parseExposureRequest(JSON.parse(JSON.stringify(request())));
    expect(Object.keys(parsed.records[0].groups).sort()).toEqual(
      [...V3_GROUP_AXES].sort(),
    );
    expect(parsed.records[0].groups.humanSeed).toBeNull();
    // And end to end: what the parser produced is what the writer accepts.
    const decision = await preflightExposure(paths(), parsed);
    expect(decision.eligible).toBe(true);
  });

  it("names null as the spelling of no identity when a value is neither", () => {
    const failure = caught(() =>
      parseExposureRequest(
        rawRequestWithGroups({ ...answers({ source: "th_1" }), author: 42 }),
      ),
    );
    expect(failure.code).toBe("CLUSTER_LEDGER_REQUEST_INVALID");
    expect(failure.message).toContain("null");
  });
});

describe("the ledger publishes the coverage of the history it compares", () => {
  it("verify counts a legacy record that answered only some axes, not only an empty one", async () => {
    // Measuring by emptiness (`Object.keys(groupDigests).length === 0`) would report
    // zero here, and this record is the common case: the old writer persisted the
    // axes that carried an identity and said nothing about the rest.
    await init();
    const { event } = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await rewriteLedger((events) => trimToLegacy(events[0]));

    const stored = await readClusterLedger(paths().ledgerPath);
    expect(Object.keys(stored[0].records[0].groupDigests)).toHaveLength(5);

    const verified = await verifyClusterLedger(paths());
    expect(verified.axisCoverage.underAskedRecords).toBe(1);
    expect(verified.axisCoverage.underAskedEventIds).toEqual([event.eventId]);
  });

  it("verify reports an under-asked legacy event and does NOT refuse it", async () => {
    // The decision the report rests on: the ledger is append-only and has no
    // amendment, so failing closed here would take the blind partitions off the
    // board with no repair — permanently, for every future offer. `verify` therefore
    // passes, the count is published, and every offer still gets decided.
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await rewriteLedger((events) => trimToLegacy(events[0]));

    const verified = await verifyClusterLedger(paths());
    expect(verified.eventCount).toBe(1);
    expect(verified.axisCoverage.underAskedRecords).toBeGreaterThan(0);

    // The barrier still bars what the legacy event DID record...
    const exposed = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          record({ id: "r1-renamed", text: FAR_TEXT, partition: "test" }),
        ],
      }),
    );
    expect(exposed.refusals.map((refusal) => refusal.reason)).toContain(
      "cluster-exposed-previously",
    );
    // ...and it still admits a cluster the history never saw, which is what makes
    // this a report and not a shutdown.
    const fresh = await preflightExposure(
      paths(),
      request({
        datasetDigest: DATASET_B,
        splitDigest: SPLIT_B,
        records: [
          record({
            id: "r-fresh",
            text: FAR_TEXT,
            author: "person_1111222233334444",
            source: "th_fresh",
            partition: "test",
          }),
        ],
      }),
    );
    expect(fresh.refusals).toEqual([]);
    expect(fresh.eligible).toBe(true);
    // The offer decision publishes the same gap, so an operator who runs preflight
    // and never runs verify still sees it.
    expect(fresh.axisCoverage.underAskedRecords).toBe(1);
  });

  it("tells an axis answered with no identity from an axis a legacy event never asked about", async () => {
    // The two states an absent key and an empty list used to share. The first event
    // is written by today's writer and answers all twelve axes, seven of them with
    // the empty list; the second is trimmed to the five the old writer would have
    // persisted. Collapse the two readings and the full event counts as under-asked
    // too, which is how "measured" turns back into "invisible".
    await init();
    const { event: complete } = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    const { event: legacy } = await commitSplitFreeze(
      paths(),
      request({
        runId: "run-2",
        records: [
          record({
            id: "r2",
            text: FAR_TEXT,
            author: "person_5555666677778888",
            source: "th_2",
          }),
        ],
      }),
    );
    await rewriteLedger((events) => trimToLegacy(events[1]));

    const stored = await readClusterLedger(paths().ledgerPath);
    const answeredWithoutIdentity = Object.entries(
      stored[0].records[0].groupDigests,
    ).filter(([, digests]) => digests.length === 0);
    expect(answeredWithoutIdentity).toHaveLength(7);

    const verified = await verifyClusterLedger(paths());
    expect(verified.axisCoverage.underAskedRecords).toBe(1);
    expect(verified.axisCoverage.underAskedEventIds).toEqual([legacy.eventId]);
    expect(verified.axisCoverage.underAskedEventIds).not.toContain(
      complete.eventId,
    );
  });
});

describe("the answer the operator reads carries the coverage behind it", () => {
  // The measurement reaches a human only as the last sentence of the CLI's answer,
  // and an answer that drops it reads exactly like an answer whose history had
  // answered every axis — the silence this measurement exists to break, arriving one
  // layer above the ledger. The four actions that rest on the history are therefore
  // driven end to end, both of `preflight`'s answers included, and what they PRINT is
  // what is asserted.

  /** The reading of a history that answered every axis of some version. */
  const FULL_TUPLE_NOTE =
    "Every recorded record-line answers a full axis tuple.";

  function expectShortfall(
    answer: string,
    records: number,
    eventId: string,
  ): void {
    expect(answer).toContain(
      `${records} recorded record-line(s) answer no version's full axis tuple`,
    );
    // The EVENTS, because a count alone leaves an operator with nowhere to look.
    expect(answer).toContain(eventId);
    // And the clean reading is gone rather than accompanied: an answer carrying both
    // sentences reads as a full comparison with a footnote.
    expect(answer).not.toContain(FULL_TUPLE_NOTE);
  }

  async function requestFile(
    name: string,
    body: ExposureRequest,
  ): Promise<string> {
    const path = join(root, name);
    await writeFile(path, JSON.stringify(body, null, 2), "utf8");
    return path;
  }

  /**
   * A history of one event whose record-line answers only the legacy axes, and the
   * id of that event — which is what every answer below has to name.
   */
  async function underAskedHistory(): Promise<string> {
    await init();
    const { event } = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    await rewriteLedger((events) => trimToLegacy(events[0]));
    return event.eventId;
  }

  it("verify says the history answered every axis when it did, and names the shortfall when it did not", async () => {
    await init();
    const { event } = await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    expect(await clusterLedgerCli("verify")).toContain(FULL_TUPLE_NOTE);

    await rewriteLedger((events) => trimToLegacy(events[0]));
    const verified = await clusterLedgerCli("verify");
    // The chain still closes and the keyring still attests, so every other word of
    // this answer is the same as above: the shortfall is the only thing that keeps it
    // from being read as "every axis was compared".
    expect(verified).toContain("Cluster-exposure ledger verified: 1 event(s)");
    expectShortfall(verified, 1, event.eventId);
  });

  it("preflight carries it whether the offer is eligible or REFUSED", async () => {
    const legacyEventId = await underAskedHistory();

    const eligible = await clusterLedgerCli(
      "preflight",
      "--request",
      await requestFile(
        "fresh.json",
        request({
          records: [
            record({
              id: "r-fresh",
              text: FAR_TEXT,
              author: "person_1111222233334444",
              source: "th_fresh",
            }),
          ],
        }),
      ),
    );
    expect(eligible).toContain("Preflight: eligible.");
    expectShortfall(eligible, 1, legacyEventId);

    const refused = await clusterLedgerCli(
      "preflight",
      "--request",
      await requestFile(
        "burned.json",
        request({
          records: [record({ id: "r1-renamed", partition: "cal-B" })],
        }),
      ),
    );
    expect(refused).toContain("Preflight: REFUSED");
    expectShortfall(refused, 1, legacyEventId);
  });

  it("record-pilot and commit-split carry the coverage of the history they were decided against", async () => {
    const legacyEventId = await underAskedHistory();

    const pilot = await clusterLedgerCli(
      "record-pilot",
      "--request",
      await requestFile(
        "pilot.json",
        request({
          eventType: "pilot-exposure",
          runId: "run-pilot-2",
          records: [
            record({
              id: "p2",
              text: FAR_TEXT,
              author: "person_1111222233334444",
              source: "th_p2",
            }),
          ],
        }),
      ),
    );
    expect(pilot).toContain("Pilot exposure recorded");
    expectShortfall(pilot, 1, legacyEventId);

    const staged = join(root, "split-artifact.staged.json");
    await writeFile(staged, '{"splitDigest":"staged"}\n', "utf8");
    const committed = await clusterLedgerCli(
      "commit-split",
      "--request",
      await requestFile(
        "freeze.json",
        request({
          runId: "run-freeze",
          records: [
            record({
              id: "f1",
              text: words("kappa", 200),
              author: "person_2222333344445555",
              source: "th_f1",
            }),
          ],
        }),
      ),
      "--staged-split",
      staged,
      "--split-out",
      join(root, "split-artifact.json"),
    );
    expect(committed).toContain("Split freeze committed");
    // The events the write was decided against, and not the event it just wrote: the
    // decision was taken over the history as it stood, which is what the number
    // qualifies.
    expectShortfall(committed, 1, legacyEventId);
  });
});

describe("the persisted record is read back in the form the writer wrote", () => {
  // Presence of the five record keys was all `validateEventShape` checked, and
  // presence is not form: a `groupDigests` that is the string "banana", a
  // `fingerprint` that is a label and a `recordDigest` that is not a digest were all
  // accepted, and a digest this module cannot read matches nothing — so the exposure
  // the event records stops blocking without ever failing. The forgeries go in
  // through `readClusterLedger`, which is the API the defect crosses.
  let pristineLedger: string;
  let pristineKeyring: string;

  beforeEach(async () => {
    await init();
    await recordPilotExposure(
      paths(),
      request({ eventType: "pilot-exposure" }),
    );
    pristineLedger = await readFile(paths().ledgerPath, "utf8");
    pristineKeyring = await readFile(paths().keyringPath, "utf8");
  });

  /**
   * Applies one edit to the stored record and reads the ledger back, returning
   * whatever came out. The chain and the attestation are re-closed by
   * `rewriteLedger`, so nothing here can be refused for having diverged.
   */
  async function forgeAndRead(
    edit: (record: Record<string, unknown>) => void,
  ): Promise<unknown> {
    await writeFile(paths().ledgerPath, pristineLedger, "utf8");
    await writeFile(paths().keyringPath, pristineKeyring, "utf8");
    await rewriteLedger((events) => edit(recordsOf(events[0])[0]));
    return readClusterLedger(paths().ledgerPath).catch(
      (error: unknown) => error,
    );
  }

  function expectRefused(outcome: unknown, spelling: string): void {
    expect(outcome, spelling).toBeInstanceOf(ClusterLedgerError);
    expect((outcome as ClusterLedgerError).code, spelling).toBe(
      "CLUSTER_LEDGER_EVENT_INVALID",
    );
  }

  /** A digest this module CAN read, so a forgery carries only the defect it names. */
  const READABLE_DIGEST = "0".repeat(64);

  it("refuses a persisted record whose groupDigests is not a map of axis to keyed digests", async () => {
    // The control: the forging machinery leaves a READABLE ledger, so a refusal below
    // is the edit and never the forgery.
    const control = await forgeAndRead(() => {});
    expect(Array.isArray(control)).toBe(true);

    // ONE defect per forgery. A line carrying an undeclared axis AND an unreadable
    // digest is refused by either check alone, so either could be dropped and the
    // refusal would still arrive from the other one — which is why every defect below
    // the axis name is spelled under `author`, an axis every version declares.
    const spellings: [string, (record: Record<string, unknown>) => void][] = [
      ["a string", (record) => void (record.groupDigests = "banana")],
      ["an array", (record) => void (record.groupDigests = [])],
      [
        "an axis no version declares, under a digest this module can read",
        (record) =>
          void (record.groupDigests = {
            naoExiste: [{ keyVersion: "v1", digest: READABLE_DIGEST }],
          }),
      ],
      [
        "a declared axis carrying a digest that is not hex",
        (record) =>
          void (record.groupDigests = {
            author: [{ keyVersion: "v1", digest: "nao-e-hex" }],
          }),
      ],
      [
        "a pair declaring a third field",
        (record) =>
          void (record.groupDigests = {
            author: [
              {
                keyVersion: "v1",
                digest: READABLE_DIGEST,
                algorithm: "sha256",
              },
            ],
          }),
      ],
      [
        "a pair whose keyVersion is empty",
        (record) =>
          void (record.groupDigests = {
            author: [{ keyVersion: "", digest: READABLE_DIGEST }],
          }),
      ],
      [
        "an axis whose value is not an array",
        (record) => void (record.groupDigests = { author: "x" }),
      ],
    ];
    for (const [spelling, edit] of spellings) {
      expectRefused(await forgeAndRead(edit), spelling);
    }
  });

  it("refuses a persisted record whose fingerprint, lineageDigests or recordDigest is not the shape buildEventRecords writes", async () => {
    const spellings: [string, (record: Record<string, unknown>) => void][] = [
      ["fingerprint is a string", (record) => void (record.fingerprint = "x")],
      [
        // The index's own comment ASSERTS that this is refused here — a record that
        // lacks its lineage identity would let the seed half of every lineage walk
        // through — and until now only the key's PRESENCE was checked.
        "lineageDigests is a string",
        (record) => void (record.lineageDigests = "x"),
      ],
      ["recordDigest is a label", (record) => void (record.recordDigest = "x")],
      [
        "lineageDigests is the empty array",
        (record) => void (record.lineageDigests = []),
      ],
    ];
    for (const [spelling, edit] of spellings) {
      expectRefused(await forgeAndRead(edit), spelling);
    }
  });
});

describe("the staging failure is the error that reaches the operator", () => {
  // EPERM/EBUSY on a handle is the platform case this module's durability comments
  // argue about, and a `close()` inside a `finally` REPLACES the exception in
  // flight — so "these bytes were never fsynced" could reach the operator as a
  // close error, on the one path whose whole job is to say what failed.
  //
  // HOW THE FAULT IS AIMED: `sync` is the only FileHandle PROTOTYPE method the
  // staging write calls, and `close` is an OWN property of every handle, so arming
  // a failing close from inside the `sync` spy hits the staging handle and nothing
  // else — the ledger lock's handle never syncs, and neither does any read.
  async function failTheStagingHandle(faults: {
    sync: boolean;
  }): Promise<() => void> {
    const probe = await open(join(root, "handle-probe"), "w");
    const prototype = Object.getPrototypeOf(probe) as {
      sync: () => Promise<void>;
    };
    await probe.close();
    const realSync = prototype.sync;
    const spy = vi
      .spyOn(prototype, "sync")
      .mockImplementation(async function (this: {
        close: () => Promise<void>;
      }) {
        const realClose = this.close;
        this.close = async () => {
          await realClose.call(this);
          throw new Error("CLOSE_FAILED");
        };
        if (faults.sync) throw new Error("SYNC_FAILED");
        await realSync.call(this);
      });
    return () => spy.mockRestore();
  }

  async function tempsLeftBehind(): Promise<string[]> {
    const entries = await readdir(dirname(paths().keyringPath)).catch(
      () => [] as string[],
    );
    return entries.filter((entry) => entry.endsWith(".tmp"));
  }

  it("keeps the sync error when the close that follows it fails too", async () => {
    const restore = await failTheStagingHandle({ sync: true });
    try {
      await expect(init()).rejects.toThrow("SYNC_FAILED");
    } finally {
      restore();
    }
    expect(await tempsLeftBehind()).toEqual([]);
  });

  it("still fails the write when only the close fails", async () => {
    // The other direction: a handle that would not close is not a published file,
    // so the success path must NOT swallow the close error — and the staged bytes
    // are discarded either way.
    const restore = await failTheStagingHandle({ sync: false });
    try {
      await expect(init()).rejects.toThrow("CLOSE_FAILED");
    } finally {
      restore();
    }
    expect(await tempsLeftBehind()).toEqual([]);
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

// ---------------------------------------------------------------------------
// Guardas de FORMA, TRAVA e ROTACAO.
//
// Uma medicao por mencao mostrou que nenhum teste citava estes codigos. Eles nao protegem a
// elegibilidade de um cluster — essa parte e coberta a exaustao acima — e sim as bordas: o pedido
// que chega de um arquivo escrito a mao, a identidade que o ledger teria de adivinhar, o tipo de
// evento que nao corresponde a transacao, a trava que impede duas escritas concorrentes, a versao
// de chave repetida, e as duas formas de um arquivo de ledger ilegivel.
// ---------------------------------------------------------------------------

describe("cluster ledger — guardas de forma, trava e rotacao", () => {
  function capturado(acao: () => unknown): unknown {
    try {
      acao();
    } catch (erro) {
      return erro;
    }
    throw new Error("esperava que a chamada lancasse");
  }

  it("refuses a request that is not even an object", () => {
    // `parseExposureRequest` existe para que um arquivo escrito a mao nao chegue a transacao com
    // campo que o ledger teria de adivinhar. A entrada mais crua e o caso mais facil de esquecer.
    expect(capturado(() => parseExposureRequest(42))).toMatchObject({
      code: "CLUSTER_LEDGER_REQUEST_INVALID",
    });
  });

  it("refuses an identity outside the shape the ledger can hash", async () => {
    await init();
    await expect(
      commitSplitFreeze(
        paths(),
        request({
          records: [record({ id: "r1", author: "pessoa com espaco" })],
        }),
      ),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_IDENTITY_INVALID" });
  });

  it("refuses a request whose eventType is not the transaction being run", async () => {
    await init();
    await expect(
      commitSplitFreeze(paths(), request({ eventType: "pilot-exposure" })),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_EVENT_TYPE_INVALID" });
  });

  it("refuses a transaction while another holds the lock", async () => {
    await init();
    // A trava e um arquivo criado com `wx`, entao pre-criar equivale a outra transacao em curso.
    await writeFile(`${paths().ledgerPath}.lock`, "", "utf8");
    await expect(commitSplitFreeze(paths(), request())).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_LOCKED",
    });
  });

  it("refuses rotating onto a key version the keyring already has", async () => {
    await init();
    // A versao vem do proprio chaveiro em vez de constante: fixar 1 aqui amarraria o teste a um
    // detalhe da inicializacao que nao e o que se quer provar.
    const keyring = JSON.parse(await readFile(paths().keyringPath, "utf8")) as {
      keys: { keyVersion: string }[];
    };
    const existente = keyring.keys[0].keyVersion;
    await expect(
      rotateClusterExposureKey(paths(), {
        keyVersion: existente,
        createdAt: "2026-07-28T11:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_KEY_VERSION_DUPLICATE" });
  });

  it("refuses a ledger line that is not valid JSON", async () => {
    await init();
    const original = await readFile(paths().ledgerPath, "utf8");
    await writeFile(paths().ledgerPath, `${original}isto nao e json\n`, "utf8");
    await expect(preflightExposure(paths(), request())).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_CORRUPT",
    });
  });

  async function backupDe(): Promise<string> {
    await init();
    await commitSplitFreeze(paths(), request());
    const recibo = await backupClusterLedger(
      paths(),
      "2026-07-28T13:00:00.000Z",
    );
    return recibo.directory;
  }

  it("refuses a backup whose ledger no longer hashes to its manifest", async () => {
    const diretorio = await backupDe();
    // Adultera o CONTEUDO e nao o manifesto: o MAC do manifesto continua valido, e o que quebra
    // e o digest declarado. E a metade do par que a guarda de digest tem de pegar.
    const copia = join(diretorio, CLUSTER_EXPOSURE_LEDGER_FILE);
    await writeFile(
      copia,
      `${await readFile(copia, "utf8")}
`,
      "utf8",
    );
    await expect(
      restoreClusterLedger(paths(), diretorio),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_BACKUP_INVALID" });
  });

  it("refuses a backup manifest no key in the keyring MACed", async () => {
    const diretorio = await backupDe();
    // A outra metade, e a que fecha a saida obvia do teste acima: "consertar" o digest declarado
    // exige reescrever o manifesto, e o manifesto e autenticado. Sem a chave nao ha como
    // reescrever e continuar autentico.
    const caminho = join(diretorio, "backup-manifest.json");
    const manifesto = JSON.parse(await readFile(caminho, "utf8")) as Record<
      string,
      unknown
    >;
    manifesto.ledgerSha256 = "0".repeat(64);
    await writeFile(caminho, JSON.stringify(manifesto, null, 2), "utf8");
    await expect(
      restoreClusterLedger(paths(), diretorio),
    ).rejects.toMatchObject({ code: "CLUSTER_LEDGER_BACKUP_UNAUTHENTIC" });
  });

  it("refuses a ledger line that parses but is not an object", async () => {
    await init();
    // Distinto do anterior: aqui o JSON e valido, entao a recusa nao pode vir do parser. E a
    // guarda de FORMA do evento que tem de pegar.
    const original = await readFile(paths().ledgerPath, "utf8");
    await writeFile(paths().ledgerPath, `${original}123\n`, "utf8");
    await expect(preflightExposure(paths(), request())).rejects.toMatchObject({
      code: "CLUSTER_LEDGER_EVENT_INVALID",
    });
  });
});
