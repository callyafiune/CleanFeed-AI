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
// PLATFORM HONESTY (Windows). Every mutation writes a temp file, `fsync`s it and
// renames it over the target. On NTFS Node's `rename` is `MoveFileExW` with
// `MOVEFILE_REPLACE_EXISTING`, which is atomic with respect to a concurrent
// READER on the same volume: a reader sees either the whole old file or the whole
// new one. It is NOT a durability barrier — Windows exposes no directory fsync,
// so a power loss immediately after the rename can lose the directory entry
// update. That residue is covered by the authenticated backup taken BEFORE the
// rename, and by `verify`, which refuses a ledger whose chain does not close. We
// do not claim more than that.
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

/**
 * Validates an exposure request that arrived as JSON (from the CLI), so a
 * hand-written file cannot reach the transaction with a partition, an axis or an
 * identity the ledger would have to guess about. Fail-closed on every field: a
 * request is the input to an irreversible write.
 */
export function parseExposureRequest(value: unknown): ExposureRequest {
  if (typeof value !== "object" || value === null) {
    fail("CLUSTER_LEDGER_REQUEST_INVALID", "the exposure request is not an object");
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
  if (!(CLUSTER_EXPOSURE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    fail(
      "CLUSTER_LEDGER_REQUEST_INVALID",
      `eventType must be one of ${CLUSTER_EXPOSURE_EVENT_TYPES.join(", ")}`,
    );
  }
  if (
    object.reserveManifestDigest !== null &&
    typeof object.reserveManifestDigest !== "string"
  ) {
    fail(
      "CLUSTER_LEDGER_REQUEST_INVALID",
      "reserveManifestDigest must be a digest string or null (the reserve is never a partition)",
    );
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

const PSEUDONYM_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
// Exactly what C2's `ClusterKeyring.pseudonym` emits: `<purpose>_<16 hex>`.
const PERSON_PSEUDONYM_SHAPE = /^[a-z][a-z0-9-]*_[0-9a-f]{16}$/;

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
 */
function assertLedgerIdentity(axis: string, identity: string): void {
  if (!PSEUDONYM_SHAPE.test(identity)) {
    fail(
      "CLUSTER_LEDGER_IDENTITY_INVALID",
      `groups.${axis} identity ${JSON.stringify(identity)} is not a pseudonym token`,
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
  return {
    keyringVersion:
      typeof object.keyringVersion === "string" && object.keyringVersion !== ""
        ? object.keyringVersion
        : "unversioned",
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([name, value]) => [name, String(value)]),
    ),
    keys,
  };
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
  return loaded.keyring;
}

function serializeKeyring(keyring: ClusterExposureKeyring): string {
  return `${JSON.stringify(keyring, null, 2)}\n`;
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

function validateEventShape(value: unknown, line: number): ClusterExposureEvent {
  if (typeof value !== "object" || value === null) {
    fail("CLUSTER_LEDGER_EVENT_INVALID", `ledger line ${line} is not an object`);
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
 */
export async function readClusterLedger(
  ledgerPath: string,
): Promise<ClusterExposureEvent[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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

async function writeTemp(target: string, content: string): Promise<string> {
  await mkdir(dirname(target), { recursive: true });
  const tempPath = tempPathFor(target);
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return tempPath;
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const tempPath = await writeTemp(target, content);
  await rename(tempPath, target);
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
 * It refuses when C3 state already exists — a `keys` array, or a ledger holding
 * events — because a second `init` would mint a second key family and every
 * cluster would come back as never-exposed. A fresh DIRECTORY does not restart
 * anything either: the keyring is the identity, so pointing the ledger at a new
 * path while the keyring still carries keys is refused here, and a ledger whose
 * events reference a key the keyring no longer has is refused by
 * {@link verifyClusterLedger}.
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

async function strayTempFiles(ledgerPath: string): Promise<string[]> {
  const directory = dirname(ledgerPath);
  const prefix = `${basename(ledgerPath)}.`;
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"))
    .sort()
    .map((entry) => join(directory, entry));
}

async function assertLedgerConsistent(
  paths: ClusterLedgerPaths,
  keyring: ClusterExposureKeyring,
): Promise<ClusterExposureEvent[]> {
  const events = await readClusterLedger(paths.ledgerPath);
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
  return events;
}

/** Verifies the chain, the key coverage, and reports interrupted writes. */
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
  const events = await assertLedgerConsistent(paths, keyring);
  const referenced = new Set<string>();
  for (const event of events) {
    for (const version of event.keyVersions) referenced.add(version);
  }
  return {
    ledgerPath: paths.ledgerPath,
    eventCount: events.length,
    keyVersions: keyring.keys.map((key) => key.keyVersion),
    referencedKeyVersions: [...referenced].sort(),
    lastEventDigest: events.at(-1)?.eventDigest ?? null,
    strayTempFiles: await strayTempFiles(paths.ledgerPath),
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
      groupDigests[axis] = identityDigests(keyring, macDomainOf(axis), identity);
    }
    // The row's OWN lineage identity, in the domain a child would use. The id is
    // shape-checked here for the same reason a group identity is: it becomes part
    // of a MAC message that has to match one another run computes, and the schema
    // already restricts an id to this alphabet (`pseudonym(root, "id", "")`).
    assertLedgerIdentity("id", input.id);
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
}> {
  const keyring = await requireKeyring(paths.keyringPath);
  const events = await assertLedgerConsistent(paths, keyring);
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
  return { directory, ledgerSha256, keyringSha256, mac, keyVersion: newest.keyVersion };
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
              "this backup does not know about",
          );
        }
        return {
          name,
          target,
          backupContent,
          outcome:
            current === undefined ? ("written" as const) : ("identical" as const),
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
): Promise<ClusterExposureEvent> {
  return withLedgerLock(paths.ledgerPath, async () => {
    // Order matters and is the transaction: verify the chain and the keys, REFUSE
    // an ineligible exposure, and only then touch anything on disk.
    const { decision, events, keyring } = await decide(paths, request);
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
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    await rename(tempPath, paths.ledgerPath);
    return event;
  });
}

/**
 * Records a `pilot-exposure`: the pilot's clusters become exposed, and therefore
 * ineligible for any future test block. Backs up and transacts.
 */
export async function recordPilotExposure(
  paths: ClusterLedgerPaths,
  request: ExposureRequest,
): Promise<ClusterExposureEvent> {
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
): Promise<ClusterExposureEvent> {
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
