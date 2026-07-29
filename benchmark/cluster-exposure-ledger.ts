// Append-only ledger of CLUSTER EXPOSURE — the second ledger, and the reason it
// has to exist.
//
// `benchmark/holdout-ledger.ts` records a lease against the tuple
// `datasetDigest`+`splitDigest`. That is the right identity for "was THIS
// evaluation already run", and the wrong one for "is this block still blind":
// rearranging the same record-lines yields ANOTHER tuple, and the holdout ledger
// would grant it. Blindness is INFORMATIONAL (R2) — a reviewer who has seen a
// document has seen it under every id you later give it. So this ledger indexes
// the things that survive a rename:
//
//   * the CLUSTER — the sampling unit (person, thread/page/product/member file,
//     lineage) the record-line belongs to. A unit exposed in any previous
//     partition is ineligible for a future TEST block.
//   * the CONTENT — an exact hash plus a MinHash signature, so a record-line that
//     sat in a consumed test is ineligible for EVERY future partition, and a
//     near-duplicate of it is barred from test even under a brand-new id.
//
// `_exclude_ids.txt` remains useful and is NOT replaced: it is a defence by
// RECORD ID, which stops a re-ingested row and stops nothing else. This module is
// the defence by cluster and by content.
//
// SCOPE. Writing a real event over the real corpus is E2 (`commit-split`) and
// H1 (`holdout-consumed`). Nothing here reads `benchmark/data/private/` on its
// own initiative: every path is an argument, and the canonical names below are
// constants, not defaults that fire by accident.
//
// THE FILE PATH IS NOT A TRUST BOUNDARY. Blindness must not depend on which path
// `--ledger` was given, so an absent or truncated ledger is a HARD FAILURE and
// never an empty history: the keyring attests the height and the tail digest, and
// the two are compared on every path that decides eligibility. See
// {@link ClusterLedgerWitness}.
//
// PLATFORM HONESTY (Windows). Every mutation writes a temp file, `fsync`s it and
// renames it over the target. On NTFS Node's `rename` is `MoveFileExW` with
// `MOVEFILE_REPLACE_EXISTING`, which is atomic with respect to a concurrent
// READER on the same volume: a reader sees either the whole old file or the whole
// new one. It is NOT a durability barrier — Windows exposes no directory fsync,
// so a power loss immediately after the rename can lose the directory entry
// update. What covers that: EVERY command that decides eligibility refuses a ledger
// disagreeing with the height the keyring attests, and names the staged temp files a
// dead run left behind in that same refusal — one `verify` used to produce the
// report only on its way out of a CONSISTENT ledger, the one state with no use for
// it. Plus an authenticated backup taken on both sides of every exposure-recording
// transaction: the pre-mutation pair for the state before it, the post-publication
// pair for the state it committed. Key ROTATION is a mutation that takes only the
// pre-side, and has therefore no restore point of its own — item 24(b) of the plan,
// unfixed. Neither backup restores over a HALF-written mutation, whose two files
// disagree, and `restore` writes only over an absent or identical ledger: that
// residue is refused, named, and repaired by hand. We do not claim more than that.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-only (node:crypto, node:fs). The only randomness is key material and
// throwaway temp-file names; every timestamp is an explicit argument.

import { createHmac, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.ts";
import { sha256BytesHex } from "./digests.ts";
import {
  NEAR_DUPLICATE_V1_OPTIONS,
  estimateShingleJaccard,
  nearDuplicateFingerprint,
} from "./near-duplicates.ts";
import {
  V3_GROUP_AXES,
  groupAxisIdentity,
  type BenchmarkRecord,
  type V3GroupAxis,
} from "./schema.ts";
import { connectedComponentRoots } from "./split.ts";

/** The canonical file names. The DATA is one artifact for the whole project. */
export const CLUSTER_EXPOSURE_LEDGER_FILE = "cluster-exposure-ledger.v1.jsonl";
export const CLUSTER_EXPOSURE_KEYRING_FILE = "cluster-exposure-keyring.v1.json";
/** Where both live, relative to the repository root. */
export const CLUSTER_EXPOSURE_PRIVATE_DIRECTORY = join(
  "benchmark",
  "data",
  "private",
);

export const CLUSTER_EXPOSURE_SCHEMA_VERSION = 1 as const;

/**
 * The five ACTIVE partitions of the frozen split (E2). Written here rather than
 * imported from `split.ts` on purpose: `Partition` there is the MVP splitter's
 * three-way vocabulary, and conflating the two is how a `calibration` event would
 * silently stand in for `cal-A` and `cal-B`. `future-holdout-reserve` is
 * deliberately ABSENT — the reserve is not a partition, generates no exposure
 * event, and enters this ledger only as `reserveManifestDigest`.
 */
export const LEDGER_PARTITIONS = [
  "train",
  "dev",
  "cal-A",
  "cal-B",
  "test",
] as const;

export type LedgerPartition = (typeof LEDGER_PARTITIONS)[number];

export const CLUSTER_EXPOSURE_EVENT_TYPES = [
  "pilot-exposure",
  "split-freeze",
  "holdout-consumed",
  "retirement",
] as const;

export type ClusterExposureEventType =
  (typeof CLUSTER_EXPOSURE_EVENT_TYPES)[number];

/**
 * The axes whose reappearance means "this same sampling unit was already
 * exposed", and therefore the axes the eligibility comparison reads.
 *
 * The event still RECORDS every axis a record fills (see
 * {@link ClusterExposureRecord.groupDigests}), so widening this set later needs
 * no re-derivation of history. But the comparison is deliberately narrow, and the
 * reason is measurable rather than aesthetic: `domainSource` is a STRATUM and
 * `collectionBatch` is a RUN, both shared by design across thousands of rows, so
 * comparing them would make every future record-line test-ineligible the moment
 * one row of its stratum was ever exposed. That is a shutdown, not a control. The
 * recipe axes (`promptTemplate`, `generatorFamily`, `generatorVersion`,
 * `generationLane`, `harnessVersion`) are shared for the same reason.
 *
 * `nearDuplicate` is excluded because after pruning it is the record's own id
 * (C2's assembler note), so it carries nothing the content fingerprint does not
 * carry better.
 */
export const EXPOSURE_IDENTITY_AXES: readonly V3GroupAxis[] = [
  "author",
  "source",
  "humanSeed",
  "derivationRoot",
];

/**
 * The axes whose identity is ANOTHER RECORD-LINE'S ID rather than a value two
 * rows happen to share.
 *
 * They are the reason this module needs a MAC domain that is not the axis name.
 * A human row carries `author`/`source`; the generation it seeded carries
 * `humanSeed` naming the human's id and, being machine text, has no author and no
 * thread at all (R6: those axes are `notApplicable`). The two rows therefore share
 * no axis VALUE, and an axis-scoped comparison — `humanSeed` digest against
 * `humanSeed` digest — matches only generation-to-generation. The seed half of
 * every lineage, which is the commonest sampling unit in v3, went through
 * unrefused; it is the same blindness `connectedComponentRoots` had before
 * 02ea363, arriving through the ledger instead of the splitter.
 *
 * `derivationRoot` behaves identically and is included for the same reason. The
 * two are NOT synonyms (see `V3_GROUP_AXES`), but a row that names `h1` as its
 * seed and a row that names `h1` as its derivation root both depend on `h1`, so
 * they belong to one cluster and one MAC domain.
 */
export const LINEAGE_AXES: readonly V3GroupAxis[] = [
  "humanSeed",
  "derivationRoot",
];

/**
 * The MAC domain the lineage axes AND a record-line's own id are MACed under.
 *
 * It replaces the axis name in the message for exactly those axes, so the digest
 * a child presents when it names its parent equals the digest the parent presents
 * for itself. Domain separation from the value axes is preserved: `author` and
 * `source` still mix their own axis name, so an id that happens to equal a
 * pseudonym cannot join two rows into a dependence that does not exist.
 */
const LINEAGE_MAC_DOMAIN = "lineage";

/**
 * The axes that carry a PERSON, and therefore the axes whose identity this module
 * refuses to accept in raw form. See the boundary note on
 * {@link assertLedgerIdentity}.
 */
const PERSON_AXES: readonly V3GroupAxis[] = ["author"];

/**
 * The MAC purpose, mixed into the message exactly as C2's
 * `benchmark/lab/pseudonymize.py` mixes `PERSON_PURPOSE`. The axis is mixed in as
 * well, so one identity string seen on two axes cannot MAC to one digest and
 * cannot join two rows into a dependence that does not exist.
 */
const CLUSTER_PURPOSE = "cluster-exposure";

/** Unit separator: it cannot occur inside an axis name or a pseudonym. */
const SEP = "\u001f";

const RECORD_DIGEST_PURPOSE = "cluster-exposure-record";

/** One key of the keyring. Rotation APPENDS; nothing is ever rewritten. */
export interface ClusterExposureKey {
  keyVersion: string;
  /** 32 bytes, lowercase hex. */
  secret: string;
  createdAt: string;
}

/**
 * The keyring, and the coordination decision it encodes.
 *
 * There is ONE keyring file, at the path C2's `pseudonymize.py` already names as
 * canonical, and it serves two purposes. That is a decision, taken against the
 * alternative of a second independent keyring, and here is the reasoning:
 *
 *   * C2's extractors already HMAC every person identifier under
 *     `secrets.person` and write the RESULT into `groups.author`. So this ledger
 *     never sees a raw identifier; what it receives is already a pseudonym, and
 *     its own MAC is applied ON TOP of C2's output. That is the third option the
 *     brief describes, and it is the one implemented.
 *   * Two independent FILES would still have worked for that, but they would have
 *     given the operator two things to keep, one of which (C2's) cannot be
 *     rotated without re-extracting the corpus. One file with two purposes keeps
 *     the un-rotatable secret and the rotatable ones visibly together.
 *   * Domain separation does not depend on the files being separate: both sides
 *     mix a PURPOSE into the MAC message, which is what makes the digests differ
 *     even when the secret is shared. `pseudonymize.py`'s own docstring measures
 *     this and states that C3 may legitimately issue one secret.
 *
 * Therefore {@link initClusterLedger} PRESERVES an existing `secrets` block
 * byte-for-byte and only ever ADDS the `keys` array it owns. Rotating
 * `secrets.person` would renumber every person cluster — a re-partitioning of the
 * corpus that requires re-extraction — so nothing in this module writes it after
 * creation.
 */
export interface ClusterExposureKeyring {
  /** C2's field. Preserved verbatim when adopting an existing keyring. */
  keyringVersion: string;
  /** C2's purposes. `person` is the one its extractors read. */
  secrets: Record<string, string>;
  /** C3's cluster-exposure keys, oldest first. */
  keys: ClusterExposureKey[];
  /**
   * What the ledger must contain. Absent only on a keyring that predates the
   * attestation, which is a hard failure everywhere a decision is taken — see
   * {@link ClusterLedgerWitness} and {@link readAttestedLedger}.
   */
  ledgerWitness?: ClusterLedgerWitness;
}

/**
 * The keyring's attestation of the ledger, and the reason the ledger cannot be
 * read as empty on its own word.
 *
 * A JSONL file carries no statement about its own length: an absent file, a file
 * truncated to zero bytes and a file whose last line was deleted all parse into a
 * shorter history whose hash chain still closes, because every
 * `previousEventDigest` in the surviving PREFIX still matches. So the chain sees a
 * removal from the head and from the middle and never one from the TAIL — which is
 * where the newest exposures live. Read as "nothing was exposed", that hands full
 * test eligibility back to every cluster and every record-line a consumed test
 * already burned, and `verify` passes green over it. It is the failure that cost
 * the 2026-07-25 measurement, arriving through the file path instead of the tuple.
 *
 * The witness lives in the KEYRING because the keyring is the artifact `init`
 * already refuses to overwrite and `restore` already requires — an operator who
 * mistypes `--ledger`, or a `git clean` that removes one file, does not
 * coincidentally produce a matching pair. It is written INSIDE the same
 * transaction that appends the event (see {@link appendEvent}); attested out of
 * band it would become one more thing that can diverge.
 *
 * WHAT IT DOES NOT DO (R7). It binds a height and a tail digest, not the secret
 * material: a keyring whose `v1` secret was replaced by another 32 bytes of the
 * same name still passes here, and that gap is `assertLedgerConsistent`'s
 * documented limit, unchanged by this attestation.
 */
export interface ClusterLedgerWitness {
  /** How many events the ledger must hold. */
  eventCount: number;
  /** The `eventDigest` of the last one, or null when the height is zero. */
  lastEventDigest: string | null;
  updatedAt: string;
}

/** One pseudonymised identity under one key version. */
export interface ClusterDigest {
  keyVersion: string;
  digest: string;
}

/**
 * What one exposed record-line contributes to the ledger. Closed key set.
 *
 * `recordDigest` is a plain SHA-256 over the record id AND its exact content
 * hash, deliberately unkeyed: a keyed record digest would change under rotation,
 * and "the same record-line looks new after a key change" is precisely the
 * failure this ledger exists to prevent. It is also why the digest is never the
 * only thing compared — an operator who renames a row changes it, and
 * `fingerprint.contentSha256` is what still matches.
 */
export interface ClusterExposureRecord {
  recordDigest: string;
  partition: LedgerPartition;
  /** axis -> one digest per key version present when the event was written. */
  groupDigests: Record<string, ClusterDigest[]>;
  /**
   * The digests a CHILD of this record-line would present when it names this row
   * as its `humanSeed` or `derivationRoot` — that is, this row's own identity in
   * the lineage MAC domain. Written for every record, because the ledger cannot
   * know which future row will cite it, and it is what lets the seed half of a
   * lineage be recognised. See {@link LINEAGE_AXES}.
   */
  lineageDigests: ClusterDigest[];
  /** The R7 index: exact hash plus MinHash signature. Never the text. */
  fingerprint: { contentSha256: string; signature: number[] | null };
}

/** One ledger event. Closed and versioned. */
export interface ClusterExposureEvent {
  schemaVersion: typeof CLUSTER_EXPOSURE_SCHEMA_VERSION;
  eventId: string;
  eventType: ClusterExposureEventType;
  occurredAt: string;
  runId: string;
  datasetDigest: string;
  splitDigest: string;
  keyVersions: string[];
  records: ClusterExposureRecord[];
  /** The reserve's PRIVATE manifest digest, and nothing else about it. */
  reserveManifestDigest: string | null;
  previousEventDigest: string | null;
  eventDigest: string;
}

const EVENT_KEYS: readonly string[] = [
  "schemaVersion",
  "eventId",
  "eventType",
  "occurredAt",
  "runId",
  "datasetDigest",
  "splitDigest",
  "keyVersions",
  "records",
  "reserveManifestDigest",
  "previousEventDigest",
  "eventDigest",
];

const RECORD_KEYS: readonly string[] = [
  "recordDigest",
  "partition",
  "groupDigests",
  "lineageDigests",
  "fingerprint",
];

/** The input side: one ACTIVE record-line offered to a partition. */
export interface ExposureRecordInput {
  id: string;
  /** Used to compute the fingerprint and then discarded. Never stored. */
  text: string;
  partition: LedgerPartition;
  /**
   * axis -> the ALREADY PSEUDONYMISED identity, or absent/undefined when the axis
   * is `notApplicable` or `unknown` (both mean "this row joins no other here").
   */
  groups: Record<string, string | undefined>;
}

export interface ExposureRequest {
  eventType: ClusterExposureEventType;
  occurredAt: string;
  runId: string;
  datasetDigest: string;
  splitDigest: string;
  records: readonly ExposureRecordInput[];
  reserveManifestDigest: string | null;
}

export const EXPOSURE_REFUSAL_REASONS = [
  "record-line-exposed-in-test",
  "cluster-exposed-previously",
  "historical-near-duplicate",
] as const;

export type ExposureRefusalReason = (typeof EXPOSURE_REFUSAL_REASONS)[number];

export interface ExposureRefusal {
  recordId: string;
  partition: LedgerPartition;
  reason: ExposureRefusalReason;
  detail: string;
}

export interface ExposureDecision {
  eligible: boolean;
  refusals: ExposureRefusal[];
  /** The event that WOULD be appended, digest included. Preflight writes nothing. */
  event: ClusterExposureEvent;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Fail-closed on a field that must be a lowercase SHA-256 digest. */
function assertSha256Field(key: string, value: unknown): void {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    fail(
      "CLUSTER_LEDGER_DIGEST_INVALID",
      `${key} must be a lowercase 64-character SHA-256 digest; received ` +
        `${JSON.stringify(value)}. A path, a label or an empty string would be ` +
        "written into an append-only event and would still verify forever",
    );
  }
}

/**
 * Validates an exposure request that arrived as JSON (from the CLI), so a
 * hand-written file cannot reach the transaction with a partition, an axis or an
 * identity the ledger would have to guess about. Fail-closed on every field: a
 * request is the input to an irreversible write.
 */
export function parseExposureRequest(value: unknown): ExposureRequest {
  if (typeof value !== "object" || value === null) {
    fail(
      "CLUSTER_LEDGER_REQUEST_INVALID",
      "the exposure request is not an object",
    );
  }
  const object = value as Record<string, unknown>;
  const requiredString = (key: string): string => {
    const found = object[key];
    if (typeof found !== "string" || found === "") {
      fail(
        "CLUSTER_LEDGER_REQUEST_INVALID",
        `the exposure request field "${key}" must be a non-empty string`,
      );
    }
    return found;
  };
  const eventType = requiredString("eventType");
  if (
    !(CLUSTER_EXPOSURE_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    fail(
      "CLUSTER_LEDGER_REQUEST_INVALID",
      `eventType must be one of ${CLUSTER_EXPOSURE_EVENT_TYPES.join(", ")}`,
    );
  }
  // The reserve's manifest digest is the ONLY trace the blind reserve leaves in
  // the ledger, and it is what a second holdout attempt will have to point at to
  // prove which reserve it came from. An empty string or a FILE PATH would be
  // accepted by "string or null", written into the event, and pass `verify`
  // forever — the link would be discovered useless exactly when it is needed.
  // `datasetDigest` and `splitDigest` are held to the same shape for the same
  // reason: they are the tuple, and a tuple that is not a digest identifies
  // nothing.
  if (object.reserveManifestDigest !== null) {
    assertSha256Field("reserveManifestDigest", object.reserveManifestDigest);
  }
  for (const key of ["datasetDigest", "splitDigest"] as const) {
    assertSha256Field(key, object[key]);
  }
  if (!Array.isArray(object.records) || object.records.length === 0) {
    fail(
      "CLUSTER_LEDGER_REQUEST_INVALID",
      "the exposure request must carry at least one active record-line",
    );
  }
  const records = (object.records as unknown[]).map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      fail(
        "CLUSTER_LEDGER_REQUEST_INVALID",
        `records[${index}] is not an object`,
      );
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || row.id === "") {
      fail("CLUSTER_LEDGER_REQUEST_INVALID", `records[${index}].id is missing`);
    }
    if (typeof row.text !== "string") {
      fail(
        "CLUSTER_LEDGER_REQUEST_INVALID",
        `records[${index}].text is missing: the fingerprint cannot be computed without it`,
      );
    }
    if (!(LEDGER_PARTITIONS as readonly unknown[]).includes(row.partition)) {
      fail(
        "CLUSTER_LEDGER_PARTITION_INVALID",
        `records[${index}].partition must be one of ${LEDGER_PARTITIONS.join(", ")}`,
      );
    }
    if (typeof row.groups !== "object" || row.groups === null) {
      fail(
        "CLUSTER_LEDGER_REQUEST_INVALID",
        `records[${index}].groups must be an object of axis -> pseudonym`,
      );
    }
    const groups: Record<string, string | undefined> = {};
    for (const [axis, identity] of Object.entries(
      row.groups as Record<string, unknown>,
    )) {
      if (identity === null || identity === undefined) continue;
      if (typeof identity !== "string") {
        fail(
          "CLUSTER_LEDGER_REQUEST_INVALID",
          `records[${index}].groups.${axis} must be a pseudonym string`,
        );
      }
      groups[axis] = identity;
    }
    return {
      id: row.id,
      text: row.text,
      partition: row.partition as LedgerPartition,
      groups,
    };
  });
  return {
    eventType: eventType as ClusterExposureEventType,
    occurredAt: requiredString("occurredAt"),
    runId: requiredString("runId"),
    datasetDigest: requiredString("datasetDigest"),
    splitDigest: requiredString("splitDigest"),
    records,
    reserveManifestDigest: object.reserveManifestDigest as string | null,
  };
}

export interface ClusterLedgerPaths {
  ledgerPath: string;
  keyringPath: string;
  /** `<home>/.cleanfeed-ai/ledger-backups` unless overridden. */
  backupRoot: string;
}

export interface ClusterLedgerVerification {
  ledgerPath: string;
  eventCount: number;
  /**
   * What the keyring attests the height to be. Reported even though a mismatch has
   * already thrown, so the operator reading a green `verify` sees WHICH statement
   * was checked rather than taking "verified" on faith.
   */
  attestedEventCount: number;
  keyVersions: string[];
  referencedKeyVersions: string[];
  lastEventDigest: string | null;
  /**
   * Leftovers of an interrupted write. Their presence is NOT a failure: the
   * rename never happened, so the ledger still holds its last consistent state.
   * They are reported so an operator sees that a run died mid-write.
   */
  strayTempFiles: string[];
}

export interface BackupReceipt {
  directory: string;
  ledgerSha256: string;
  keyringSha256: string;
  mac: string;
  keyVersion: string;
}

/**
 * What a writing transaction produced: the event, and the restore point for the
 * state that event created.
 *
 * The restore point is not a convenience field. A backup is ALSO taken before the
 * mutation, and that pair sits at height N while the committed state is N+1 — a
 * pair the keyring's attestation makes divergent, so `restore` refuses it over a
 * lost ledger. The only backup a frozen split can be recovered from is therefore the
 * one taken after the ledger is published, and returning its directory is what puts
 * it in front of the operator rather than in a runbook. What "recovered" covers is
 * narrow and stated where it is enforced: a ledger that is absent, or one moved aside
 * because it was corrupted ({@link restoreClusterLedger}).
 */
export interface ClusterExposureCommit {
  event: ClusterExposureEvent;
  restorePoint: BackupReceipt;
}

export interface RestoreOutcome {
  directory: string;
  ledger: "written" | "identical";
  keyring: "written" | "identical";
}

/** Coded, fail-closed error. Every refusal in this module carries a code. */
export class ClusterLedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClusterLedgerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ClusterLedgerError(code, message);
}

/** The canonical paths under a repository root. */
export function defaultClusterLedgerPaths(
  repositoryRoot: string,
): ClusterLedgerPaths {
  const directory = join(repositoryRoot, CLUSTER_EXPOSURE_PRIVATE_DIRECTORY);
  return {
    ledgerPath: join(directory, CLUSTER_EXPOSURE_LEDGER_FILE),
    keyringPath: join(directory, CLUSTER_EXPOSURE_KEYRING_FILE),
    backupRoot: defaultBackupRoot(),
  };
}

export function defaultBackupRoot(): string {
  return join(homedir(), ".cleanfeed-ai", "ledger-backups");
}

// --- identity boundary ------------------------------------------------------

/**
 * ONE alphabet for every identity this module indexes, and it is the schema's own
 * (`PSEUDONYM` / the record-id rule in `benchmark/schema.ts`): the characters
 * `A-Z a-z 0-9 _ -`, UNCAPPED.
 *
 * IT USED TO BE TWO RULES, AND THAT WAS THE DEFECT. Group identities were held to
 * `{1,128}` while a record-line id was held to the uncapped alphabet, on the theory
 * that the cap bounded "what this module will index". Both halves of that were
 * wrong:
 *
 *   * The two ends of one lineage edge are THE SAME STRING in THE SAME MAC domain
 *     ({@link LINEAGE_MAC_DOMAIN}): a parent's `id`, and the child's
 *     `groups.derivationRoot` naming it. Two rules meant a 200-character id was
 *     accepted as an id and refused one record later as an axis — a schema-valid
 *     corpus aborting E2's freeze, which is exactly what uncapping the id was
 *     supposed to have prevented. `nearDuplicate` makes it worse, not better:
 *     C2's assembler writes THE ROW'S OWN ID there
 *     (`assemble_corpus.near_duplicate_axis`), so capping "only the value axes"
 *     would have left the same abort alive on a value axis.
 *   * The cap bounded nothing durable. An identity is never persisted; only its
 *     64-hex HMAC is. Length costs one MAC message that is discarded, so there is
 *     no unbounded state to defend against, and a bound the schema does not have
 *     can only ever fail a corpus the schema accepts.
 *
 * What DOES still fail closed is a FORM this module cannot MAC coherently — a
 * character outside the alphabet, and a raw identifier on a person axis
 * ({@link assertLedgerIdentity}). Those are properties of the value, not of its
 * length.
 */
const IDENTITY_SHAPE = /^[A-Za-z0-9_-]+$/;
// Exactly what C2's `ClusterKeyring.pseudonym` emits: `<purpose>_<16 hex>`.
const PERSON_PSEUDONYM_SHAPE = /^[a-z][a-z0-9-]*_[0-9a-f]{16}$/;

/**
 * Refuses a record-line id the ledger cannot MAC coherently.
 *
 * Separate from {@link assertLedgerIdentity} only so the DIAGNOSTIC can name `id`
 * instead of `groups.id`, a field no record has. The SHAPE both check is one and the
 * same ({@link IDENTITY_SHAPE}) — it has to be, because a parent's id and the
 * child's `derivationRoot` are the same string MACed in the same domain, and the
 * previous split of one rule into two refused as an axis what it had accepted as an
 * id.
 */
function assertLedgerRecordId(id: string): void {
  if (!IDENTITY_SHAPE.test(id)) {
    fail(
      "CLUSTER_LEDGER_RECORD_ID_INVALID",
      `record id ${JSON.stringify(id)} is not a record-line id: the schema allows ` +
        "only the characters A-Z a-z 0-9 _ -, and the id becomes part of a MAC " +
        "message another run has to reproduce byte for byte",
    );
  }
}

/**
 * Refuses an identity this ledger must not index.
 *
 * WHY THIS LIVES HERE. C1's schema validates a group identity with
 * `PSEUDONYM = /^[A-Za-z0-9_-]+$/`, which accepts `12345` and `joaosilva` — so
 * the guarantee that the person axes carry an HMAC currently rests on C2's
 * discipline and not on the contract. The definitive enforcement is C1's pending
 * remediation. Until it lands, this module checks the person axes itself and
 * fails closed, because indexing a raw identifier would be worse than useless:
 * the ledger would hold personal data AND would never match the pseudonym a
 * correctly built corpus presents, so the exposure check would silently pass
 * empty. That is the `leakages: []` tautology coming back through another door.
 *
 * Shape alone cannot decide the general case — B2W ships a sha256-shaped
 * `reviewer_id`, so "looks like a digest" proves nothing — which is why the check
 * is for the FORM C2's `pseudonym()` actually emits, prefix included.
 *
 * The ALPHABET check, by contrast, is deliberately no stricter than the schema's:
 * see {@link IDENTITY_SHAPE} for why a length cap here refused a schema-valid
 * corpus at the far end of a lineage edge.
 */
function assertLedgerIdentity(axis: string, identity: string): void {
  if (!IDENTITY_SHAPE.test(identity)) {
    fail(
      "CLUSTER_LEDGER_IDENTITY_INVALID",
      `groups.${axis} identity ${JSON.stringify(identity)} is not a pseudonym token: ` +
        "the schema allows only the characters A-Z a-z 0-9 _ -",
    );
  }
  if (
    (PERSON_AXES as readonly string[]).includes(axis) &&
    !PERSON_PSEUDONYM_SHAPE.test(identity)
  ) {
    fail(
      "CLUSTER_LEDGER_IDENTITY_NOT_PSEUDONYM",
      `groups.${axis} carries a person, so its identity must be the keyed pseudonym ` +
        `C2 emits (<purpose>_<16 hex>); received ${JSON.stringify(identity)}. ` +
        "There is no unkeyed fallback: a bare digest of a low-entropy account id is reversible",
    );
  }
}

// --- keyring ----------------------------------------------------------------

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(message, "utf8")
    .digest("hex");
}

/**
 * Which MAC domain an axis is compared in. The lineage axes share ONE domain with
 * a record-line's own id, so the two ends of a parent/child edge meet; every other
 * axis is its own domain, so a value seen on two axes stays two identities.
 */
function macDomainOf(axis: string): string {
  return (LINEAGE_AXES as readonly string[]).includes(axis)
    ? LINEAGE_MAC_DOMAIN
    : axis;
}

function identityDigests(
  keyring: ClusterExposureKeyring,
  domain: string,
  identity: string,
): ClusterDigest[] {
  const message = `${CLUSTER_PURPOSE}${SEP}${domain}${SEP}${identity}`;
  return keyring.keys.map((key) => ({
    keyVersion: key.keyVersion,
    digest: hmacHex(key.secret, message),
  }));
}

function parseKeyring(raw: string, path: string): ClusterExposureKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(
      "CLUSTER_LEDGER_KEYRING_INVALID",
      `the keyring at ${path} is not valid JSON`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    fail(
      "CLUSTER_LEDGER_KEYRING_INVALID",
      `the keyring at ${path} is not an object`,
    );
  }
  const object = parsed as Record<string, unknown>;
  const secrets =
    typeof object.secrets === "object" && object.secrets !== null
      ? (object.secrets as Record<string, string>)
      : {};
  const keys: ClusterExposureKey[] = [];
  if (object.keys !== undefined) {
    if (!Array.isArray(object.keys)) {
      fail(
        "CLUSTER_LEDGER_KEYRING_INVALID",
        `the keyring at ${path} declares a non-array "keys"`,
      );
    }
    for (const entry of object.keys as unknown[]) {
      const key = entry as Record<string, unknown>;
      if (
        typeof key.keyVersion !== "string" ||
        key.keyVersion === "" ||
        typeof key.secret !== "string" ||
        !/^[0-9a-f]{64}$/.test(key.secret) ||
        typeof key.createdAt !== "string"
      ) {
        fail(
          "CLUSTER_LEDGER_KEYRING_INVALID",
          `the keyring at ${path} carries a key that is not {keyVersion, 32-byte hex secret, createdAt}`,
        );
      }
      keys.push({
        keyVersion: key.keyVersion,
        secret: key.secret,
        createdAt: key.createdAt,
      });
    }
  }
  const versions = new Set(keys.map((key) => key.keyVersion));
  if (versions.size !== keys.length) {
    fail(
      "CLUSTER_LEDGER_KEYRING_INVALID",
      `the keyring at ${path} repeats a keyVersion`,
    );
  }
  const parsedKeyring: ClusterExposureKeyring = {
    keyringVersion:
      typeof object.keyringVersion === "string" && object.keyringVersion !== ""
        ? object.keyringVersion
        : "unversioned",
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([name, value]) => [name, String(value)]),
    ),
    keys,
  };
  const witness = parseWitness(object.ledgerWitness, path);
  if (witness !== undefined) parsedKeyring.ledgerWitness = witness;
  return parsedKeyring;
}

/**
 * Fail-closed on the attestation itself. A malformed witness is never repaired to
 * a permissive default: "no height stated" would read as zero, which is the very
 * answer this field exists to refuse.
 */
function parseWitness(
  value: unknown,
  path: string,
): ClusterLedgerWitness | undefined {
  if (value === undefined || value === null) return undefined;
  // Annotated, so TypeScript knows the calls below do not return and narrows each
  // field after its check. Written as an untyped arrow it would not, and the
  // function would have to end in casts over values it has already validated.
  const invalid: (why: string) => never = (why) =>
    fail(
      "CLUSTER_LEDGER_KEYRING_INVALID",
      `the keyring at ${path} declares a ledgerWitness that ${why}. It attests the ` +
        "height and the tail digest of the ledger, and a witness that cannot be " +
        "read is not a permission to read the ledger as empty",
    );
  if (typeof value !== "object") invalid("is not an object");
  const object = value as Record<string, unknown>;
  const eventCount = object.eventCount;
  if (
    typeof eventCount !== "number" ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 0
  ) {
    invalid("carries no non-negative integer eventCount");
  }
  const updatedAt = object.updatedAt;
  if (typeof updatedAt !== "string" || updatedAt === "") {
    invalid("carries no updatedAt");
  }
  const lastEventDigest = object.lastEventDigest;
  // The TYPE is tested, not a coercion of it: `String(["<64 hex>"])` is 64 hex
  // characters, and a witness read permissively is exactly what this function
  // exists to refuse. It would still fail closed downstream — an array never
  // equals the ledger's digest — but the diagnostic would blame the ledger for a
  // malformed attestation.
  if (
    lastEventDigest !== null &&
    (typeof lastEventDigest !== "string" || !SHA256_HEX.test(lastEventDigest))
  ) {
    invalid("carries a lastEventDigest that is not a SHA-256 digest or null");
  }
  // The two fields state one fact between them, so a pair that contradicts itself
  // proves the attestation was written by hand.
  if ((eventCount === 0) !== (lastEventDigest === null)) {
    invalid(
      "states a height of zero with a tail digest, or a height above zero without one",
    );
  }
  return { eventCount, lastEventDigest, updatedAt };
}

async function readKeyringFile(
  path: string,
): Promise<{ keyring: ClusterExposureKeyring; raw: string } | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return { keyring: parseKeyring(raw, path), raw };
}

async function requireKeyring(path: string): Promise<ClusterExposureKeyring> {
  return (await requireKeyringFile(path)).keyring;
}

async function requireKeyringFile(
  path: string,
): Promise<{ keyring: ClusterExposureKeyring; raw: string }> {
  const loaded = await readKeyringFile(path);
  if (loaded === undefined) {
    fail(
      "CLUSTER_LEDGER_KEYRING_ABSENT",
      `no cluster-exposure keyring at ${path}: run "cluster-ledger init" once, ` +
        "and never a second time — a fresh keyring renumbers every cluster",
    );
  }
  if (loaded.keyring.keys.length === 0) {
    fail(
      "CLUSTER_LEDGER_KEYRING_ABSENT",
      `the keyring at ${path} carries no cluster-exposure key: run "cluster-ledger init"`,
    );
  }
  return loaded;
}

function serializeKeyring(keyring: ClusterExposureKeyring): string {
  return `${JSON.stringify(keyring, null, 2)}\n`;
}

/**
 * Rewrites the attestation and NOTHING else, from the file's OWN bytes.
 *
 * Not `serializeKeyring({...parsed, ledgerWitness})`: the parsed shape is this
 * module's three fields, so re-serialising it would silently drop any field the
 * keyring carries that this module does not know about — and the file is C2's too.
 * Its `secrets.person` cannot be rotated without re-extracting the whole corpus, so
 * every write to it stays a minimal edit of what was read.
 */
function reattestKeyringText(
  raw: string,
  witness: ClusterLedgerWitness,
): string {
  const object = JSON.parse(raw) as Record<string, unknown>;
  return `${JSON.stringify({ ...object, ledgerWitness: witness }, null, 2)}\n`;
}

// --- event digests and the chain --------------------------------------------

function eventWithoutDigest(
  event: ClusterExposureEvent,
): Omit<ClusterExposureEvent, "eventDigest"> {
  // Built explicitly rather than by destructuring the field away, so the hashed
  // key set is identical wherever it is computed and cannot drift.
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    runId: event.runId,
    datasetDigest: event.datasetDigest,
    splitDigest: event.splitDigest,
    keyVersions: event.keyVersions,
    records: event.records,
    reserveManifestDigest: event.reserveManifestDigest,
    previousEventDigest: event.previousEventDigest,
  };
}

function computeEventDigest(event: ClusterExposureEvent): string {
  return sha256Text(canonicalJson(eventWithoutDigest(event)));
}

function sha256Text(text: string): string {
  return sha256BytesHex(new TextEncoder().encode(text));
}

function validateEventShape(
  value: unknown,
  line: number,
): ClusterExposureEvent {
  if (typeof value !== "object" || value === null) {
    fail(
      "CLUSTER_LEDGER_EVENT_INVALID",
      `ledger line ${line} is not an object`,
    );
  }
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!EVENT_KEYS.includes(key)) {
      fail(
        "CLUSTER_LEDGER_EVENT_INVALID",
        `ledger line ${line} carries the unknown field "${key}"`,
      );
    }
  }
  for (const key of EVENT_KEYS) {
    if (object[key] === undefined) {
      fail(
        "CLUSTER_LEDGER_EVENT_INVALID",
        `ledger line ${line} is missing "${key}"`,
      );
    }
  }
  if (object.schemaVersion !== CLUSTER_EXPOSURE_SCHEMA_VERSION) {
    fail(
      "CLUSTER_LEDGER_EVENT_INVALID",
      `ledger line ${line} declares schemaVersion ${String(object.schemaVersion)}`,
    );
  }
  if (
    !(CLUSTER_EXPOSURE_EVENT_TYPES as readonly unknown[]).includes(
      object.eventType,
    )
  ) {
    fail(
      "CLUSTER_LEDGER_EVENT_INVALID",
      `ledger line ${line} declares the eventType ${JSON.stringify(object.eventType)}`,
    );
  }
  if (!Array.isArray(object.records)) {
    fail(
      "CLUSTER_LEDGER_EVENT_INVALID",
      `ledger line ${line} declares a non-array "records"`,
    );
  }
  for (const entry of object.records as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      fail(
        "CLUSTER_LEDGER_EVENT_INVALID",
        `ledger line ${line} carries a non-object record`,
      );
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!RECORD_KEYS.includes(key)) {
        fail(
          "CLUSTER_LEDGER_EVENT_INVALID",
          `ledger line ${line} carries a record with the unknown field "${key}"`,
        );
      }
    }
    for (const key of RECORD_KEYS) {
      if (record[key] === undefined) {
        fail(
          "CLUSTER_LEDGER_EVENT_INVALID",
          `ledger line ${line} carries a record missing "${key}"`,
        );
      }
    }
    if (!(LEDGER_PARTITIONS as readonly unknown[]).includes(record.partition)) {
      fail(
        "CLUSTER_LEDGER_PARTITION_INVALID",
        `ledger line ${line} names the partition ${JSON.stringify(record.partition)}, ` +
          `which is not one of ${LEDGER_PARTITIONS.join(", ")}`,
      );
    }
  }
  const event = object as unknown as ClusterExposureEvent;
  const recomputed = computeEventDigest(event);
  if (recomputed !== event.eventDigest) {
    fail(
      "CLUSTER_LEDGER_EVENT_DIGEST_MISMATCH",
      `ledger line ${line} does not hash to its own eventDigest`,
    );
  }
  return event;
}

/**
 * Parses the ledger and verifies it INTRINSICALLY: every line hashes to its own
 * `eventDigest` and every `previousEventDigest` names the line before it. An
 * absent file is an empty ledger, which is what a fresh `init` leaves.
 *
 * INTRINSIC IS NOT ENOUGH TO DECIDE ANYTHING. A file that closes its own chain
 * says nothing about whether it is the WHOLE history: an absent file, a truncated
 * one and one missing its last line all pass here. Every path that reads the
 * ledger to answer "was this exposed" therefore goes through
 * {@link readAttestedLedger}, which compares what this returns against the
 * keyring's witness. This function stays exported for `init` (which must tolerate
 * absence) and for tests that construct a ledger state on purpose.
 */
export async function readClusterLedger(
  ledgerPath: string,
): Promise<ClusterExposureEvent[]> {
  const raw = await readOptionalText(ledgerPath);
  if (raw === undefined) return [];
  return parseClusterLedger(raw);
}

function parseClusterLedger(raw: string): ClusterExposureEvent[] {
  const events: ClusterExposureEvent[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail(
        "CLUSTER_LEDGER_CORRUPT",
        `ledger line ${index + 1} is not valid JSON`,
      );
    }
    events.push(validateEventShape(parsed, index + 1));
  }
  for (const [index, event] of events.entries()) {
    const expected = index === 0 ? null : events[index - 1].eventDigest;
    if (event.previousEventDigest !== expected) {
      fail(
        "CLUSTER_LEDGER_CHAIN_BROKEN",
        `ledger event ${index + 1} declares previousEventDigest ` +
          `${JSON.stringify(event.previousEventDigest)} where the chain requires ` +
          `${JSON.stringify(expected)}: an event was removed, reordered or inserted`,
      );
    }
  }
  return events;
}

// --- durability primitives --------------------------------------------------

let tempCounter = 0;

function tempPathFor(target: string): string {
  tempCounter += 1;
  return `${target}.${process.pid}.${tempCounter}.tmp`;
}

/**
 * Cleanup that accompanies a failure and can never become one.
 *
 * `rm(force: true)` only suppresses ENOENT: an EPERM or EBUSY on the temp — plausible
 * on the platform whose semantics this module argues about — would throw out of the
 * `catch` and REPLACE the error that matters, turning "the keyring could not be
 * published" into an unlink error. The leftover is reported by
 * {@link strayTempFiles} either way, so discarding the real diagnosis to announce a
 * failed deletion is never the better trade.
 */
async function discardTemp(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true }).catch(() => {});
}

async function writeTemp(target: string, content: string): Promise<string> {
  await mkdir(dirname(target), { recursive: true });
  const tempPath = tempPathFor(target);
  const handle = await open(tempPath, "w");
  try {
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Outside the `finally` that closes, so a throwing `close()` — which fails the
    // write as much as `sync()` does — cannot skip the cleanup. Nothing else can
    // collect the file: the path is generated here, so a caller that never received
    // it cannot clean up after this.
    await discardTemp(tempPath);
    throw error;
  }
  return tempPath;
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const tempPath = await writeTemp(target, content);
  try {
    await rename(tempPath, target);
  } catch (error) {
    // A publish that failed must not leave the staged bytes on disk. For the
    // keyring those bytes are a full copy of `secrets.person` and every exposure
    // key, and the only caller that used to clean up after itself was the ledger's
    // own staging in `appendEvent`.
    await discardTemp(tempPath);
    throw error;
  }
}

/**
 * Serialises every mutation. Created with the exclusive `wx` flag and always
 * removed in the `finally`, so a leftover lock can only mean a crash inside the
 * critical section — a visible signal rather than a silent overwrite.
 */
async function withLedgerLock<T>(
  ledgerPath: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(ledgerPath), { recursive: true });
  const lockPath = `${ledgerPath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail(
        "CLUSTER_LEDGER_LOCKED",
        `another cluster-ledger transition holds ${lockPath}`,
      );
    }
    throw error;
  }
  try {
    await handle.close();
    return await action();
  } finally {
    await rm(lockPath, { force: true });
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// --- init and rotation ------------------------------------------------------

function mintSecret(): string {
  return randomBytes(32).toString("hex");
}

export interface InitOptions {
  createdAt: string;
}

/**
 * Creates the keyring's FIRST cluster-exposure key and an empty ledger, once.
 *
 * It refuses when C3 state already exists — a `keys` array, an attested height, or
 * a ledger holding events — because a second `init` would mint a second key family
 * and every cluster would come back as never-exposed. A fresh DIRECTORY does not
 * restart anything either, and that no longer rests on this command alone: the
 * keyring attests the ledger's height, so a fresh path is refused by every command
 * that decides eligibility ({@link assertAttestedHistory}), not only by the one
 * command an operator with a mistyped `--ledger` never runs.
 *
 * An existing keyring that carries only C2's `secrets` (the shape C2 minted
 * before this module existed) is ADOPTED: `keyringVersion`, `secrets` and any
 * other field are preserved verbatim and only `keys` is added. Rewriting
 * `secrets.person` would renumber every person cluster and force a re-extraction,
 * so it is never touched.
 */
export async function initClusterLedger(
  paths: ClusterLedgerPaths,
  options: InitOptions,
): Promise<ClusterExposureKeyring> {
  return withLedgerLock(paths.ledgerPath, async () => {
    const existing = await readKeyringFile(paths.keyringPath);
    if (existing !== undefined && existing.keyring.keys.length > 0) {
      fail(
        "CLUSTER_LEDGER_ALREADY_INITIALISED",
        `the keyring at ${paths.keyringPath} already carries ` +
          `${existing.keyring.keys.length} cluster-exposure key(s). A second init would ` +
          "mint a second key family, and every exposed cluster would read as never exposed",
      );
    }
    // A keyring stripped of its `keys` but still attesting a height would pass the
    // check above, and the freshly minted key family would read every exposed
    // cluster as never exposed. The attestation is the state that matters, so it is
    // checked in its own right.
    if (
      existing !== undefined &&
      (existing.keyring.ledgerWitness?.eventCount ?? 0) > 0
    ) {
      fail(
        "CLUSTER_LEDGER_ALREADY_INITIALISED",
        `the keyring at ${paths.keyringPath} attests ` +
          `${existing.keyring.ledgerWitness?.eventCount} ledger event(s): this project ` +
          "has a history, and init mints a key family that would read all of it as " +
          "never exposed",
      );
    }
    const events = await readClusterLedger(paths.ledgerPath);
    if (events.length > 0) {
      fail(
        "CLUSTER_LEDGER_ALREADY_INITIALISED",
        `the ledger at ${paths.ledgerPath} already holds ${events.length} event(s)`,
      );
    }

    const preserved: Record<string, unknown> =
      existing === undefined
        ? {}
        : (JSON.parse(existing.raw) as Record<string, unknown>);
    const secrets: Record<string, string> = {
      ...(existing?.keyring.secrets ?? {}),
    };
    // A fresh keyring must still satisfy C2's interface, or the extractors that
    // fill the person axes cannot run at all.
    if (secrets.person === undefined) secrets.person = mintSecret();

    const keyring: ClusterExposureKeyring = {
      ...(preserved as object),
      keyringVersion: existing?.keyring.keyringVersion ?? "v1",
      secrets,
      keys: [
        {
          keyVersion: "v1",
          secret: mintSecret(),
          createdAt: options.createdAt,
        },
      ],
      // The one place a height of zero may be attested: nothing has been exposed
      // yet, and every later command reads this as permission to see an empty
      // ledger. It is written BEFORE the ledger file exists, so a crash between the
      // two leaves "zero attested, no file", which is exactly the state this pair
      // describes.
      ledgerWitness: {
        eventCount: 0,
        lastEventDigest: null,
        updatedAt: options.createdAt,
      },
    } as ClusterExposureKeyring;

    await atomicWrite(paths.keyringPath, serializeKeyring(keyring));
    if ((await readOptionalText(paths.ledgerPath)) === undefined) {
      await atomicWrite(paths.ledgerPath, "");
    }
    return keyring;
  });
}

export interface RotateOptions {
  keyVersion: string;
  createdAt: string;
}

/**
 * APPENDS a key. Old keys stay, because every identity in history was MACed
 * under them and the comparison uses any digest in common — which is exactly why
 * a rotation cannot make an exposed cluster look new. Removing a key an event
 * references is not offered here and is refused by
 * {@link verifyClusterLedger}.
 *
 * Deliberately NOT a CLI subcommand: the plan freezes the command set at
 * `init|verify|preflight|record-pilot|commit-split|backup|restore`, so rotation
 * is a library operation an operator performs knowingly.
 */
export async function rotateClusterExposureKey(
  paths: ClusterLedgerPaths,
  options: RotateOptions,
): Promise<ClusterExposureKeyring> {
  return withLedgerLock(paths.ledgerPath, async () => {
    const keyring = await requireKeyring(paths.keyringPath);
    await assertLedgerConsistent(paths, keyring);
    if (keyring.keys.some((key) => key.keyVersion === options.keyVersion)) {
      fail(
        "CLUSTER_LEDGER_KEY_VERSION_DUPLICATE",
        `the keyring already carries the keyVersion "${options.keyVersion}"`,
      );
    }
    await writeBackup(paths, keyring, options.createdAt);
    const rotated: ClusterExposureKeyring = {
      ...keyring,
      keys: [
        ...keyring.keys,
        {
          keyVersion: options.keyVersion,
          secret: mintSecret(),
          createdAt: options.createdAt,
        },
      ],
    };
    await atomicWrite(paths.keyringPath, serializeKeyring(rotated));
    return rotated;
  });
}

// --- verification -----------------------------------------------------------

/**
 * Staged writes a dead run left behind, for BOTH files a transaction touches.
 *
 * The keyring is included because the transaction writes it too, and its staged
 * copy is a full copy of `secrets.person` and every exposure key. A temp nobody
 * reports is a temp nobody deletes, and the module's crash story leans on `verify`
 * reporting interrupted writes.
 */
async function strayTempFiles(paths: ClusterLedgerPaths): Promise<string[]> {
  const found = new Set<string>();
  for (const target of [paths.ledgerPath, paths.keyringPath]) {
    const directory = dirname(target);
    const prefix = `${basename(target)}.`;
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.startsWith(prefix) && entry.endsWith(".tmp")) {
        found.add(join(directory, entry));
      }
    }
  }
  return [...found].sort();
}

/**
 * The two things every decision path checks before reading history: the ledger is
 * the WHOLE attested history ({@link assertAttestedHistory}), and every key its
 * events reference is still present.
 *
 * Key coverage is checked BY VERSION NAME — and that is the whole limit of it.
 *
 * What it catches: a keyVersion an event references that the keyring no longer
 * carries, i.e. a key removed or renamed instead of appended.
 *
 * What it CANNOT catch: a key whose NAME is unchanged and whose SECRET is not. If
 * `benchmark/data/private/cluster-exposure-keyring.v1.json` is replaced by a fresh
 * 32-byte secret still called `v1`, every name lines up, `verifyClusterLedger`
 * passes, every HMAC `buildIndex` computes is taken under the new secret, and the
 * whole history reads as "never exposed" — the silent-empty-check failure this
 * module exists to prevent. `init` refuses to mint over an existing `keys` array,
 * so reaching that state takes a manual edit or restoring a foreign keyring, and the
 * backup manifest's MAC is today the only place a secret is bound to anything.
 *
 * Fixing it means an event carrying a key-bound witness (e.g. a MAC over
 * `eventDigest` under each active key) so `verify` can detect a substituted secret.
 * The event schema is closed and versioned, so that field cannot be added without a
 * `schemaVersion` bump: it is E2's decision, to be taken BEFORE the freeze, and it
 * is recorded as such in the plan.
 */
async function assertLedgerConsistent(
  paths: ClusterLedgerPaths,
  keyring: ClusterExposureKeyring,
): Promise<AttestedLedger> {
  const { events, present: onDisk } = await readAttestedLedgerText(paths);
  const present = new Set(keyring.keys.map((key) => key.keyVersion));
  const referenced = new Set<string>();
  for (const event of events) {
    for (const version of event.keyVersions) referenced.add(version);
  }
  const missing = [...referenced].filter((version) => !present.has(version));
  if (missing.length > 0) {
    fail(
      "CLUSTER_LEDGER_KEY_VERSION_MISSING",
      `the ledger references the keyVersion(s) ${missing.join(", ")}, which the ` +
        "keyring no longer carries. Rotation APPENDS a key; replacing one orphans " +
        "every digest written under it, and no migration exists that could recover them",
    );
  }
  // Key coverage is checked FIRST on purpose: a keyring that dropped a key it once
  // held has also dropped the witness, and "you removed a key" is the diagnostic
  // that names what the operator actually did.
  return {
    events,
    witness: await assertAttestedHistory(paths, keyring, onDisk, events),
  };
}

/**
 * A ledger that agreed with its attestation, and the attestation it agreed with.
 *
 * The witness is returned rather than re-read from the keyring because on
 * `ClusterExposureKeyring` it is OPTIONAL — a keyring predating the attestation
 * parses without one, and every decision path refuses that. Handing the validated
 * value back is what keeps the invariant inside the types instead of inviting each
 * caller to cast an optional field it "knows" is present.
 */
interface AttestedLedger {
  events: ClusterExposureEvent[];
  witness: ClusterLedgerWitness;
}

/** Reads the file once, so the attested check and the parse see the same bytes. */
async function readAttestedLedgerText(paths: ClusterLedgerPaths): Promise<{
  events: ClusterExposureEvent[];
  present: boolean;
}> {
  const raw = await readOptionalText(paths.ledgerPath);
  if (raw === undefined) return { events: [], present: false };
  return { events: parseClusterLedger(raw), present: true };
}

/**
 * THE INVARIANT: the ledger may be read as empty only when it is provably new.
 *
 * "Provably" means the keyring — the durable artifact of this ledger, the one
 * `init` refuses to overwrite — attests a height of zero. Anything else that reads
 * as shorter than the attestation is a LOST HISTORY and fails hard, because the
 * alternative is handing test eligibility back to clusters a consumed test already
 * burned. See {@link ClusterLedgerWitness} for why the hash chain cannot do this
 * on its own.
 *
 * A height ABOVE the attestation fails just as hard, and for the mirror reason:
 * the surplus event was written by something that did not attest it, so which of
 * the two files is the stale one is not knowable from here. Both directions name
 * the actionable condition instead of guessing.
 */
async function assertAttestedHistory(
  paths: ClusterLedgerPaths,
  keyring: ClusterExposureKeyring,
  ledgerPresent: boolean,
  events: readonly ClusterExposureEvent[],
): Promise<ClusterLedgerWitness> {
  const witness = keyring.ledgerWitness;
  if (witness === undefined) {
    fail(
      "CLUSTER_LEDGER_WITNESS_ABSENT",
      `the keyring at ${paths.keyringPath} carries ${keyring.keys.length} ` +
        "cluster-exposure key(s) but attests no ledger height, so how much history " +
        `${paths.ledgerPath} is supposed to hold is unknown. An unattested ledger is ` +
        "never read as empty: restore the keyring from an authenticated backup " +
        '("cluster-ledger restore"), or, if this really is the project\'s first run, ' +
        'start from "cluster-ledger init" on a keyring that carries no keys',
    );
  }
  if (!ledgerPresent) {
    if (witness.eventCount === 0) return witness;
    const staged = await strayTempFiles(paths);
    fail(
      "CLUSTER_LEDGER_HISTORY_ABSENT",
      `there is no ledger at ${paths.ledgerPath}, and the keyring at ` +
        `${paths.keyringPath} attests ${witness.eventCount} event(s) ending at ` +
        `${witness.lastEventDigest}. A path with no file is not an empty history: ` +
        "point --ledger at the canonical artifact " +
        `(${join(CLUSTER_EXPOSURE_PRIVATE_DIRECTORY, CLUSTER_EXPOSURE_LEDGER_FILE)}) ` +
        'or restore it with "cluster-ledger restore". Reading it as empty would ' +
        "return test eligibility to every cluster a consumed test already burned. " +
        interruptedWriteNote(staged, witness),
    );
  }
  const lastEventDigest = events.at(-1)?.eventDigest ?? null;
  if (
    events.length !== witness.eventCount ||
    lastEventDigest !== witness.lastEventDigest
  ) {
    const staged = await strayTempFiles(paths);
    fail(
      "CLUSTER_LEDGER_HISTORY_DIVERGED",
      `the ledger at ${paths.ledgerPath} holds ${events.length} event(s) ending at ` +
        `${lastEventDigest ?? "(empty)"}, and the keyring at ${paths.keyringPath} ` +
        `attests ${witness.eventCount} ending at ` +
        `${witness.lastEventDigest ?? "(empty)"}. ` +
        `${divergenceDiagnosis(
          events.length,
          witness.eventCount,
          staged.length > 0,
        )}. ` +
        interruptedWriteNote(staged, witness),
    );
  }
  return witness;
}

/**
 * The staged writes on disk, said INSIDE the refusal.
 *
 * `verify` reports them in its SUCCESS value, which is the one state that has no use
 * for them: a ledger disagreeing with its attestation throws before the report is
 * built, and the crash residue the write order deliberately prefers IS that
 * disagreement ({@link appendEvent}). Collected here, the list reaches every command
 * that decides eligibility instead of only the one an operator may not have run.
 *
 * It stops at NAMING the files (R7). A temp holds whatever the dead run had written,
 * so nothing here proves a staged ledger is the missing state — what the operator
 * gets is how to check: the attested tail digest is in the last line of the bytes
 * that are it.
 */
function interruptedWriteNote(
  staged: readonly string[],
  witness: ClusterLedgerWitness,
): string {
  if (staged.length === 0) return "No interrupted write is on disk.";
  return (
    `Interrupted write(s) still on disk: ${staged.join(", ")}. A staged LEDGER ` +
    "among them is a CANDIDATE for the missing state and nothing here proves it is " +
    "one: it holds the attested state only if its last line carries the digest " +
    `${witness.lastEventDigest ?? "(none — the attested height is zero)"}. If it ` +
    "does, renaming it over the ledger publishes bytes that are already fsynced; " +
    'then take a "cluster-ledger backup", because no backup on disk matches the ' +
    "pair that leaves."
  );
}

/**
 * Names which of the three shapes of divergence this is, and a repair that is not
 * refused when the operator runs it.
 *
 * Every repair that ends in `restore` begins by MOVING THE LEDGER ASIDE, because
 * `restore` writes only over state that is absent or byte-identical
 * ({@link restoreClusterLedger}). A ledger that is present and different — the
 * truncation, the stale `--ledger` copy, the rewritten tail, i.e. every shape below
 * — is refused as divergent, so naming `restore` on its own would name the one
 * action this state always rejects. "Aside" is deliberately not "away": the file is
 * the only copy of whatever it holds that the backup may not.
 *
 * `stagedWriteOnDisk` reorders the repair without changing it. A ledger short of its
 * attestation with a staged write beside it is the crash residue the write order
 * prefers ({@link appendEvent}), and the repair for THAT is the staged file, not a
 * backup: an operator who reaches for the backup first is refused, because its
 * keyring attests the pre-mutation height.
 */
function divergenceDiagnosis(
  onDisk: number,
  attested: number,
  stagedWriteOnDisk: boolean,
): string {
  if (onDisk < attested) {
    const restore =
      "move the ledger aside — keep it — and then " +
      '"cluster-ledger restore <backup>", which writes only over an ABSENT ' +
      "ledger and therefore cannot run over the file as it stands. The " +
      "restorable pair is the one taken AFTER the last mutation, because its " +
      "keyring attests this same height";
    return (
      "The ledger lost events: a truncation, a deleted last line, a stale copy, " +
      "or a run that died between attesting the height and publishing the ledger. " +
      "The hash chain cannot see a removal from the TAIL, which is where the " +
      "newest exposures are, so this is the only check that catches it. " +
      (stagedWriteOnDisk
        ? "An interrupted write is listed below, and it is the FIRST thing to " +
          `check: those bytes may be the missing state. If they are not, ${restore}`
        : `To recover: ${restore}`)
    );
  }
  if (onDisk > attested) {
    return (
      "The ledger holds events the keyring never attested, so one of the two " +
      "files is stale and this cannot tell which. Do NOT discard the surplus " +
      "events: they may be a real exposure whose attestation was lost, and no " +
      "backup can be restored over them either (restore writes only over an " +
      "absent or identical ledger). Compare the surplus event against the " +
      "newest backup pair by hand before moving either file aside"
    );
  }
  return (
    "The ledger is at the attested HEIGHT and its last event is not the attested " +
    "one: the tail was rewritten in place, or this is a fork of the same history " +
    "from another run. The hash chain cannot see either, because a rewritten tail " +
    "closes its own chain. To recover: move the ledger aside — keep it — and then " +
    '"cluster-ledger restore <backup>" from the pair taken after the last mutation'
  );
}

function witnessFor(
  event: ClusterExposureEvent,
  eventCount: number,
): ClusterLedgerWitness {
  return {
    eventCount,
    lastEventDigest: event.eventDigest,
    updatedAt: event.occurredAt,
  };
}

/**
 * Verifies the chain, the ATTESTED HEIGHT, the key coverage, and reports
 * interrupted writes.
 *
 * The attested height is what keeps `verify` from passing green over a ledger that
 * lost its tail — the state in which every other command would have answered
 * "never exposed". See {@link assertAttestedHistory}.
 */
export async function verifyClusterLedger(
  paths: ClusterLedgerPaths,
): Promise<ClusterLedgerVerification> {
  const keyring = await requireKeyring(paths.keyringPath);
  if ((await readOptionalText(paths.ledgerPath)) === undefined) {
    fail(
      "CLUSTER_LEDGER_ABSENT",
      `no cluster-exposure ledger at ${paths.ledgerPath}`,
    );
  }
  const { events, witness } = await assertLedgerConsistent(paths, keyring);
  const referenced = new Set<string>();
  for (const event of events) {
    for (const version of event.keyVersions) referenced.add(version);
  }
  return {
    ledgerPath: paths.ledgerPath,
    eventCount: events.length,
    attestedEventCount: witness.eventCount,
    keyVersions: keyring.keys.map((key) => key.keyVersion),
    referencedKeyVersions: [...referenced].sort(),
    lastEventDigest: events.at(-1)?.eventDigest ?? null,
    strayTempFiles: await strayTempFiles(paths),
  };
}

// --- the exposure index and the refusals ------------------------------------

interface HistoryEntry {
  contentSha256: string;
  signature: number[] | null;
  inTest: boolean;
}

interface ExposureIndex {
  /**
   * Digests of identity axes seen in ANY partition, PLUS the lineage identity of
   * every exposed record-line itself. Both live in one set on purpose: the lineage
   * axes and a row's own id share a MAC domain, so "the parent was exposed" and
   * "a child of this row was exposed" are the same lookup from either end.
   */
  clusterDigests: Set<string>;
  /** Record-line digests and exact content hashes seen in a `test` partition. */
  consumedRecordDigests: Set<string>;
  consumedContent: Set<string>;
  /** Every exposed record-line's fingerprint, for the R7 screen. */
  history: HistoryEntry[];
}

function buildIndex(events: readonly ClusterExposureEvent[]): ExposureIndex {
  const index: ExposureIndex = {
    clusterDigests: new Set(),
    consumedRecordDigests: new Set(),
    consumedContent: new Set(),
    history: [],
  };
  for (const event of events) {
    for (const record of event.records) {
      const inTest = record.partition === "test";
      for (const axis of EXPOSURE_IDENTITY_AXES) {
        for (const digest of record.groupDigests[axis] ?? []) {
          index.clusterDigests.add(digest.digest);
        }
      }
      // The exposed row's own lineage identity. Without it a future child naming
      // this row matches nothing, because a child shares no axis VALUE with its
      // human seed. It is a REQUIRED field of the record schema, so an event that
      // lacks it is refused by `validateEventShape` rather than read as empty.
      for (const digest of record.lineageDigests) {
        index.clusterDigests.add(digest.digest);
      }
      if (inTest) {
        index.consumedRecordDigests.add(record.recordDigest);
        index.consumedContent.add(record.fingerprint.contentSha256);
      }
      index.history.push({
        contentSha256: record.fingerprint.contentSha256,
        signature: record.fingerprint.signature,
        inTest,
      });
    }
  }
  return index;
}

/**
 * Is this content the same document as one already exposed, or a near-duplicate
 * of it?
 *
 * WHAT IS MEASURED, precisely (R7): an exact match of the SHA-256 over the
 * normalized token stream, OR an ESTIMATED 5-token-shingle Jaccard at or above
 * the frozen 0.82, computed from the 128-permutation MinHash signatures the
 * ledger stores. It is the LSH half of `benchmark/near-duplicates.ts`, not its
 * exact confirmation step: the exact step needs both shingle sets, and retaining
 * shingles would mean retaining the document in a ledger that outlives the
 * corpus. So this is a SCREEN with a sampling error near 0.034 at the threshold,
 * and it is not "Jaccard >= 0.82".
 */
function matchesHistoricalContent(
  index: ExposureIndex,
  fingerprint: { contentSha256: string; signature: number[] | null },
): { matched: boolean; estimate: number } {
  let best = 0;
  for (const entry of index.history) {
    if (entry.contentSha256 === fingerprint.contentSha256) {
      return { matched: true, estimate: 1 };
    }
    const estimate = estimateShingleJaccard(
      entry.signature,
      fingerprint.signature,
    );
    if (estimate > best) best = estimate;
  }
  return {
    matched: best >= NEAR_DUPLICATE_V1_OPTIONS.jaccardThreshold,
    estimate: best,
  };
}

function buildEventRecords(
  keyring: ClusterExposureKeyring,
  inputs: readonly ExposureRecordInput[],
): ClusterExposureRecord[] {
  return inputs.map((input) => {
    // The id first, because every diagnostic below quotes it and because the row's
    // OWN lineage identity is MACed from it. It goes through its own function only
    // so the message names `id` and not `groups.id`; the shape is the same one
    // `assertLedgerIdentity` applies, which is what keeps the two ends of a lineage
    // edge from being judged by two rules ({@link IDENTITY_SHAPE}).
    assertLedgerRecordId(input.id);
    if (!(LEDGER_PARTITIONS as readonly string[]).includes(input.partition)) {
      fail(
        "CLUSTER_LEDGER_PARTITION_INVALID",
        `record ${input.id} names the partition ${JSON.stringify(input.partition)}, ` +
          `which is not one of ${LEDGER_PARTITIONS.join(", ")}. The future reserve is ` +
          "not a partition: it generates no exposure event and enters only as reserveManifestDigest",
      );
    }
    const groupDigests: Record<string, ClusterDigest[]> = {};
    for (const [axis, identity] of Object.entries(input.groups)) {
      if (!(V3_GROUP_AXES as readonly string[]).includes(axis)) {
        fail(
          "CLUSTER_LEDGER_AXIS_UNKNOWN",
          `record ${input.id} names the grouping axis "${axis}", which the schema ` +
            `does not declare (${V3_GROUP_AXES.join(", ")})`,
        );
      }
      if (identity === undefined) continue;
      assertLedgerIdentity(axis, identity);
      groupDigests[axis] = identityDigests(
        keyring,
        macDomainOf(axis),
        identity,
      );
    }
    const fingerprint = nearDuplicateFingerprint(input.text);
    return {
      recordDigest: sha256Text(
        `${RECORD_DIGEST_PURPOSE}${SEP}${input.id}${SEP}${fingerprint.contentSha256}`,
      ),
      partition: input.partition,
      groupDigests,
      lineageDigests: identityDigests(keyring, LINEAGE_MAC_DOMAIN, input.id),
      fingerprint: {
        contentSha256: fingerprint.contentSha256,
        signature: fingerprint.signature,
      },
    };
  });
}

function computeEventId(request: ExposureRequest): string {
  return sha256Text(
    canonicalJson({
      eventType: request.eventType,
      occurredAt: request.occurredAt,
      runId: request.runId,
      datasetDigest: request.datasetDigest,
      splitDigest: request.splitDigest,
    }),
  ).slice(0, 24);
}

function buildEvent(
  keyring: ClusterExposureKeyring,
  events: readonly ClusterExposureEvent[],
  request: ExposureRequest,
): ClusterExposureEvent {
  // Re-checked here and not only in `parseExposureRequest`, because a library
  // caller (E2's freeze path) never goes through the JSON parser.
  assertSha256Field("datasetDigest", request.datasetDigest);
  assertSha256Field("splitDigest", request.splitDigest);
  if (request.reserveManifestDigest !== null) {
    assertSha256Field("reserveManifestDigest", request.reserveManifestDigest);
  }
  const event: ClusterExposureEvent = {
    schemaVersion: CLUSTER_EXPOSURE_SCHEMA_VERSION,
    eventId: computeEventId(request),
    eventType: request.eventType,
    occurredAt: request.occurredAt,
    runId: request.runId,
    datasetDigest: request.datasetDigest,
    splitDigest: request.splitDigest,
    keyVersions: keyring.keys.map((key) => key.keyVersion),
    records: buildEventRecords(keyring, request.records),
    reserveManifestDigest: request.reserveManifestDigest,
    previousEventDigest: events.at(-1)?.eventDigest ?? null,
    eventDigest: "",
  };
  event.eventDigest = computeEventDigest(event);
  return event;
}

function collectRefusals(
  index: ExposureIndex,
  records: readonly ClusterExposureRecord[],
  inputs: readonly ExposureRecordInput[],
): ExposureRefusal[] {
  const refusals: ExposureRefusal[] = [];
  for (const [position, record] of records.entries()) {
    const recordId = inputs[position].id;

    // A record-line that sat in a consumed test is out of EVERY partition, and
    // an id change does not help: the exact content hash is compared too.
    if (
      index.consumedRecordDigests.has(record.recordDigest) ||
      index.consumedContent.has(record.fingerprint.contentSha256)
    ) {
      refusals.push({
        recordId,
        partition: record.partition,
        reason: "record-line-exposed-in-test",
        detail:
          "this record-line was already exposed in a test partition, so it is " +
          "ineligible for every future partition; a new id does not restore it",
      });
      continue;
    }

    if (record.partition !== "test") continue;

    // A sampling unit exposed in ANY previous partition cannot enter a future
    // test block. Any digest in common counts, so a key rotation cannot mint a
    // "new" cluster.
    const exposedAxes: string[] = EXPOSURE_IDENTITY_AXES.filter((axis) =>
      (record.groupDigests[axis] ?? []).some((digest) =>
        index.clusterDigests.has(digest.digest),
      ),
    );
    // The other end of a lineage edge: this row's own id was already named as the
    // seed or the derivation root of something exposed, so the child is in history
    // even though the parent row never was.
    if (
      record.lineageDigests.some((digest) =>
        index.clusterDigests.has(digest.digest),
      )
    ) {
      exposedAxes.push("lineage(self)");
    }
    if (exposedAxes.length > 0) {
      refusals.push({
        recordId,
        partition: record.partition,
        reason: "cluster-exposed-previously",
        detail: `the sampling unit on ${exposedAxes.join(", ")} was exposed by an earlier run`,
      });
      continue;
    }

    const content = matchesHistoricalContent(index, record.fingerprint);
    if (content.matched) {
      refusals.push({
        recordId,
        partition: record.partition,
        reason: "historical-near-duplicate",
        detail:
          `exact-hash or estimated-shingle-Jaccard ${content.estimate.toFixed(3)} ` +
          `against text an earlier corpus exposed (screen threshold ` +
          `${NEAR_DUPLICATE_V1_OPTIONS.jaccardThreshold})`,
      });
    }
  }
  return refusals;
}

function assertEventType(
  request: ExposureRequest,
  expected: ClusterExposureEventType,
): void {
  if (request.eventType !== expected) {
    fail(
      "CLUSTER_LEDGER_EVENT_TYPE_INVALID",
      `this command writes "${expected}" events; the request declares "${request.eventType}"`,
    );
  }
}

async function decide(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
): Promise<{
  decision: ExposureDecision;
  events: ClusterExposureEvent[];
  keyring: ClusterExposureKeyring;
  keyringRaw: string;
}> {
  const { keyring, raw } = await requireKeyringFile(paths.keyringPath);
  const { events } = await assertLedgerConsistent(paths, keyring);
  const event = buildEvent(keyring, events, request);
  const refusals = collectRefusals(
    buildIndex(events),
    event.records,
    request.records,
  );
  return {
    decision: { eligible: refusals.length === 0, refusals, event },
    events,
    keyring,
    keyringRaw: raw,
  };
}

/**
 * Answers "would this exposure be accepted" and WRITES NOTHING — no event, no
 * backup, no lock. It is the read-only half an operator runs before committing.
 */
export async function preflightExposure(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
): Promise<ExposureDecision> {
  const { decision } = await decide(paths, request);
  return decision;
}

// --- the authenticated backup ----------------------------------------------

/** `:` is illegal in a Windows path component, so the instant is slugified. */
function backupSlug(occurredAt: string): string {
  return occurredAt.replace(/[:]/g, "-");
}

async function writeBackup(
  paths: ClusterLedgerPaths,
  keyring: ClusterExposureKeyring,
  occurredAt: string,
): Promise<BackupReceipt> {
  const ledger = (await readOptionalText(paths.ledgerPath)) ?? "";
  const keyringRaw = (await readOptionalText(paths.keyringPath)) ?? "";
  const ledgerSha256 = sha256Text(ledger);
  const keyringSha256 = sha256Text(keyringRaw);
  // The directory carries the ledger digest as well as the instant, so two
  // mutations at the same recorded instant never overwrite each other's backup.
  const directory = join(
    paths.backupRoot,
    `${backupSlug(occurredAt)}-${ledgerSha256.slice(0, 8)}`,
  );
  await mkdir(directory, { recursive: true });
  await copyFileIfPresent(
    paths.ledgerPath,
    join(directory, CLUSTER_EXPOSURE_LEDGER_FILE),
    ledger,
  );
  await copyFileIfPresent(
    paths.keyringPath,
    join(directory, CLUSTER_EXPOSURE_KEYRING_FILE),
    keyringRaw,
  );

  // AUTHENTICATED: the manifest is MACed under the newest key, so a backup whose
  // bytes were edited (or produced under a foreign keyring) fails to restore.
  const newest = keyring.keys.at(-1) as ClusterExposureKey;
  const manifest = {
    schemaVersion: CLUSTER_EXPOSURE_SCHEMA_VERSION,
    createdAt: occurredAt,
    ledgerFile: CLUSTER_EXPOSURE_LEDGER_FILE,
    keyringFile: CLUSTER_EXPOSURE_KEYRING_FILE,
    ledgerSha256,
    keyringSha256,
    keyVersion: newest.keyVersion,
  };
  const mac = hmacHex(
    newest.secret,
    `${CLUSTER_PURPOSE}${SEP}backup${SEP}${canonicalJson(manifest)}`,
  );
  await atomicWrite(
    join(directory, "backup-manifest.json"),
    `${JSON.stringify({ ...manifest, mac }, null, 2)}\n`,
  );
  return {
    directory,
    ledgerSha256,
    keyringSha256,
    mac,
    keyVersion: newest.keyVersion,
  };
}

async function copyFileIfPresent(
  source: string,
  target: string,
  fallback: string,
): Promise<void> {
  try {
    await copyFile(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await atomicWrite(target, fallback);
  }
}

/** Takes an authenticated backup of ledger + keyring under the ledger lock. */
export async function backupClusterLedger(
  paths: ClusterLedgerPaths,
  occurredAt: string,
): Promise<BackupReceipt> {
  return withLedgerLock(paths.ledgerPath, async () => {
    const keyring = await requireKeyring(paths.keyringPath);
    await assertLedgerConsistent(paths, keyring);
    return writeBackup(paths, keyring, occurredAt);
  });
}

/**
 * Restores a backup ONLY over state that is absent or provably identical.
 *
 * Divergence fails closed and is never merged: a ledger that moved on since the
 * backup holds exposures the backup does not know about, and overwriting it would
 * hand back eligibility that was already spent. The backup's MAC is checked
 * first, against every key still in the keyring, so a hand-edited backup cannot
 * be restored at all.
 *
 * WHICH BACKUP IS RESTORABLE, stated because the attestation narrowed it. An
 * exposure-recording transaction takes TWO backups ({@link appendEvent}): the
 * pre-mutation pair holds ledger and keyring at height N while the committed state is
 * N+1, so restoring it over a lost ledger — which used to succeed and silently roll
 * the history back one event — now diverges on the keyring and is refused. The
 * restorable pair for the committed state is the post-publication one, which the
 * transaction returns as `ClusterExposureCommit.restorePoint`. `cluster-ledger
 * backup` is the MANUAL fallback for the two states that have no restore point of
 * their own: after `CLUSTER_LEDGER_COMMITTED_UNBACKED`, and after a key rotation
 * (which takes only the pre-side).
 *
 * WHAT IT CANNOT DO, because "absent or identical" is narrow: a ledger that is
 * present and CORRUPTED — truncated, a stale `--ledger` copy, a rewritten tail — is
 * not restored in place. The refusal that reports the corruption names the sequence
 * that works, which begins by moving that file aside
 * ({@link divergenceDiagnosis}). Two further limits are unfixed and recorded in the
 * plan: a keyring that is itself lost cannot be restored at all (authenticating the
 * manifest needs it), and a rotation makes every earlier pair divergent for the same
 * reason as the pre-mutation pair above.
 */
export async function restoreClusterLedger(
  paths: ClusterLedgerPaths,
  backupDirectory: string,
): Promise<RestoreOutcome> {
  return withLedgerLock(paths.ledgerPath, async () => {
    const manifestRaw = await readOptionalText(
      join(backupDirectory, "backup-manifest.json"),
    );
    if (manifestRaw === undefined) {
      fail(
        "CLUSTER_LEDGER_BACKUP_INVALID",
        `no backup-manifest.json in ${backupDirectory}`,
      );
    }
    const parsed = JSON.parse(manifestRaw) as Record<string, unknown> & {
      mac: string;
    };
    const { mac, ...manifest } = parsed;
    const keyring = await requireKeyring(paths.keyringPath);
    const authentic = keyring.keys.some(
      (key) =>
        hmacHex(
          key.secret,
          `${CLUSTER_PURPOSE}${SEP}backup${SEP}${canonicalJson(manifest)}`,
        ) === mac,
    );
    if (!authentic) {
      fail(
        "CLUSTER_LEDGER_BACKUP_UNAUTHENTIC",
        `the backup manifest in ${backupDirectory} is not MACed by any key this keyring carries`,
      );
    }

    const plans = await Promise.all(
      (
        [
          [
            join(backupDirectory, CLUSTER_EXPOSURE_LEDGER_FILE),
            paths.ledgerPath,
            manifest.ledgerSha256 as string,
            "ledger" as const,
          ],
          [
            join(backupDirectory, CLUSTER_EXPOSURE_KEYRING_FILE),
            paths.keyringPath,
            manifest.keyringSha256 as string,
            "keyring" as const,
          ],
        ] as const
      ).map(async ([source, target, declaredSha, name]) => {
        const backupContent = await readOptionalText(source);
        if (backupContent === undefined) {
          fail(
            "CLUSTER_LEDGER_BACKUP_INVALID",
            `the backup in ${backupDirectory} is missing its ${name}`,
          );
        }
        if (sha256Text(backupContent) !== declaredSha) {
          fail(
            "CLUSTER_LEDGER_BACKUP_INVALID",
            `the backed-up ${name} does not hash to the digest its manifest declares`,
          );
        }
        const current = await readOptionalText(target);
        if (current !== undefined && current !== backupContent) {
          fail(
            "CLUSTER_LEDGER_RESTORE_DIVERGENT",
            `the ${name} on disk differs from the backup: restore writes only over ` +
              "absent or identical state, because a divergent ledger holds exposures " +
              "this backup does not know about" +
              // Said only for the ledger: setting the KEYRING aside is not a repair
              // (it holds the un-rotatable person secret, and authenticating this
              // very manifest needs it), and its divergence is the rotation case
              // recorded in the plan.
              (name === "ledger"
                ? '. If this is the corruption "verify" reported, move the ledger ' +
                  "aside — keep it — and restore again: an ABSENT ledger is written " +
                  "from the backup"
                : ""),
          );
        }
        return {
          name,
          target,
          backupContent,
          outcome:
            current === undefined
              ? ("written" as const)
              : ("identical" as const),
        };
      }),
    );

    for (const plan of plans) {
      if (plan.outcome === "written") {
        await atomicWrite(plan.target, plan.backupContent);
      }
    }
    return {
      directory: backupDirectory,
      ledger: plans.find((plan) => plan.name === "ledger")!.outcome,
      keyring: plans.find((plan) => plan.name === "keyring")!.outcome,
    };
  });
}

// --- the two writing transactions ------------------------------------------

async function appendEvent(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
  finalize?: (event: ClusterExposureEvent) => Promise<void>,
): Promise<ClusterExposureCommit> {
  return withLedgerLock(paths.ledgerPath, async () => {
    // Order matters and is the transaction: verify the chain and the keys, REFUSE
    // an ineligible exposure, and only then touch anything on disk.
    const { decision, events, keyring, keyringRaw } = await decide(
      paths,
      request,
    );
    if (!decision.eligible) {
      fail(
        "CLUSTER_LEDGER_EXPOSURE_REFUSED",
        `the exposure is refused: ${decision.refusals
          .map(
            (refusal) =>
              `${refusal.recordId} -> ${refusal.partition}: ${refusal.reason}`,
          )
          .join("; ")}`,
      );
    }
    await writeBackup(paths, keyring, request.occurredAt);

    const event = decision.event;
    const lines = [
      ...events.map((existing) => JSON.stringify(existing)),
      JSON.stringify(event),
    ];
    // Stage the whole new ledger, then let the caller commit ITS artifact, then
    // publish the ledger. If the caller's write fails, the staged file is
    // discarded and the ledger is untouched — so the split and the exposure event
    // are written together or neither is.
    const tempPath = await writeTemp(paths.ledgerPath, `${lines.join("\n")}\n`);
    try {
      if (finalize !== undefined) await finalize(event);
      // The witness is part of THIS transaction, not a bookkeeping step after it:
      // attested out of band it would be one more thing that can diverge, and the
      // whole point of it is to be the thing that cannot.
      //
      // ORDER. It is attested BEFORE the ledger is published, which PREFERS the
      // residue "attested N+1, ledger at N": the direction whose repair does not
      // touch the file holding the un-rotatable person secret — rename the staged
      // ledger, whose bytes are already fsynced and which the refusal itself names
      // ({@link interruptedWriteNote}), then take a `backup`.
      //
      // It does not make that the only possible residue, and the header says why:
      // this platform exposes no directory fsync, so a power loss can lose either
      // rename's directory entry independently of the other. "Attested N, ledger at
      // N+1" is therefore equally possible. Both are refused — the first as a lost
      // history, the second as surplus events — and only the first has a repair, so
      // the order buys the repairable side of an unavoidable window, not the absence
      // of the window. The CLI action set is frozen, so neither repair is a
      // subcommand.
      await atomicWrite(
        paths.keyringPath,
        reattestKeyringText(keyringRaw, witnessFor(event, lines.length)),
      );
    } catch (error) {
      // The caller's write or the attestation failed, and THAT is the error the
      // operator has to see — see {@link discardTemp}.
      await discardTemp(tempPath);
      throw error;
    }
    await rename(tempPath, paths.ledgerPath);

    // The two files now agree at N+1, and THIS is the pair the committed state can
    // be recovered from: the backup taken above holds height N against a keyring
    // that attests N+1, which `restore` refuses as divergent. Without this second
    // backup the split E2 freezes and the holdout H1 consumes would have no restore
    // point at all, and the compensating step would live only in a runbook.
    //
    // WHAT IT RECOVERS, narrowly: a ledger that is ABSENT, or one an operator moved
    // aside by hand. `restore` writes only over absent or byte-identical state, so a
    // ledger that is present and CORRUPTED — a truncation, a stale `--ledger` copy —
    // is not restored in place; the refusal that reports it names the move-aside
    // step ({@link divergenceDiagnosis}).
    //
    // `keyring` is the pre-mutation parse, which is what the MAC needs: re-attesting
    // does not touch `keys`, so the newest key is the same one. The BYTES copied into
    // the backup are read from disk, i.e. the re-attested file.
    let restorePoint: BackupReceipt;
    try {
      restorePoint = await writeBackup(paths, keyring, request.occurredAt);
    } catch (error) {
      // The event is already published, so this cannot be reported as a failed
      // transaction: re-running the command would be refused (the clusters are now
      // exposed) and the operator would conclude the split was never frozen.
      fail(
        "CLUSTER_LEDGER_COMMITTED_UNBACKED",
        `the ${request.eventType} event ${event.eventId} IS RECORDED in ` +
          `${paths.ledgerPath} at height ${lines.length}, and the backup of that ` +
          "state could not be written: " +
          // The module's shape for an unknown catch (`cli.ts:648`, `corpus-import.ts`).
          // A rejection that is not an Error would otherwise render "undefined" in the
          // one message whose job is to say the exposure IS recorded and why the
          // backup did not land.
          `${error instanceof Error ? error.message : String(error)}. Do NOT re-run ` +
          "this command — the exposure is recorded and would now be refused. Run " +
          '"cluster-ledger backup" once the backup root is writable; until then the ' +
          "committed pair has no restore point",
      );
    }
    return { event, restorePoint };
  });
}

/**
 * Records a `pilot-exposure`: the pilot's clusters become exposed, and therefore
 * ineligible for any future test block. Backs up on both sides of the mutation and
 * transacts; the returned {@link ClusterExposureCommit} names the restore point of
 * the state it committed.
 */
export async function recordPilotExposure(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
): Promise<ClusterExposureCommit> {
  assertEventType(request, "pilot-exposure");
  return appendEvent(paths, request);
}

/**
 * Freezes a split: refuses first, then writes the FIRST exposure of every cluster
 * of the five active partitions. `finalizeSplit` is the caller's own atomic write
 * of the split artifact; it runs inside the transaction, so a failure there
 * leaves no event behind.
 */
export async function commitSplitFreeze(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
  finalizeSplit?: (event: ClusterExposureEvent) => Promise<void>,
): Promise<ClusterExposureCommit> {
  assertEventType(request, "split-freeze");
  return appendEvent(paths, request, finalizeSplit);
}

// --- the cluster notion C4 and C6 import -----------------------------------

export interface ClusterAssignment {
  /** record id -> the opaque, stable root of its connected component. */
  rootById: Map<string, string>;
  /** root -> the record ids it contains, ascending. */
  membersByRoot: Map<string, string[]>;
}

/**
 * The split/exposure CLUSTER: the connected component of the union of the
 * applicable grouping axes, exposed as one reusable value because C4 (resampling
 * units) and C6 (correlated fixtures) both need it and neither may re-derive it.
 *
 * It delegates to {@link connectedComponentRoots} so there is exactly ONE
 * definition of connectivity in the benchmark. From the glossary: a cluster is
 * NOT the resampling unit — that is chosen per estimand, and choosing it is C4's.
 */
export function clusterAssignments(
  records: readonly BenchmarkRecord[],
): ClusterAssignment {
  const rootById = connectedComponentRoots(records);
  const membersByRoot = new Map<string, string[]>();
  for (const [id, root] of rootById) {
    const bucket = membersByRoot.get(root);
    if (bucket === undefined) membersByRoot.set(root, [id]);
    else bucket.push(id);
  }
  for (const bucket of membersByRoot.values()) {
    bucket.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return { rootById, membersByRoot };
}

/**
 * Turns real records into exposure inputs, reading each axis through the single
 * accessor so `notApplicable` and `unknown` arrive as "no identity here" rather
 * than as an invented one (R6).
 */
export function exposureInputsFromRecords(
  records: readonly BenchmarkRecord[],
  partitionOf: (record: BenchmarkRecord) => LedgerPartition,
): ExposureRecordInput[] {
  return records.map((record) => {
    const groups: Record<string, string | undefined> = {};
    for (const axis of V3_GROUP_AXES) {
      const identity = groupAxisIdentity(record, axis);
      if (identity !== undefined) groups[axis] = identity;
    }
    return {
      id: record.id,
      text: record.text,
      partition: partitionOf(record),
      groups,
    };
  });
}
