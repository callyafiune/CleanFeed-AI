// Append-only, auditable ledger of holdout consumption. Two identities live here
// and they answer different questions:
//
//   - the BLOCK (`datasetDigest` + `splitDigest`) is the blind material, and it
//     may be scored exactly ONCE. Admission compares only these fields, so no
//     candidate — no bundle, no evaluator, no model version — can buy a second
//     measurement of the same block;
//   - the full scientific tuple (block plus the audit/source-readiness
//     attestations, the model and its bundle/aggregation/composition/tokenizer,
//     the runtime parity and build, the pinned WASM/Chrome shell, the evaluator
//     and the frozen calibration) identifies the RUN, and governs the
//     consumptionId and every resume/terminal transition, so a resume reopens the
//     exact execution and never a neighbouring one.
//
// The lease is ONE-WAY: the first `started` event consumes the block even if the
// process later crashes, so a crashed run can only be `--resume`d with the same
// consumptionId AND the identical tuple — never restarted under a fresh id.
// `completed` and `failed` are terminal and remain consumed forever.
//
// Phase 2 owns this module and its transitions. Phase 3 imports the primitives,
// hands the lease to the browser scorer and finalizes only after a success or a
// declared-irrecoverable failure; it never creates another ledger nor redefines
// these states. A private scorer `runId`, when present, MUST equal the
// consumptionId for the test partition.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-only (node:fs): it runs in the benchmark tooling, never in the browser.
// Deterministic: `startedAt`/`terminalAt` are explicit arguments, never
// `Date.now()`; the only randomness is in throwaway temp-file names.

import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.ts";
import { sha256BytesHex } from "./digests.ts";
import { RELEASE_CHROME_VERSION } from "./prediction-schema.ts";

/** The closed set of irrecoverable-failure reason codes. No free text is allowed. */
export const HOLDOUT_FAILURE_CODES = [
  "scorer-crash",
  "chrome-verification-failed",
  "shard-invalid",
  "identity-mismatch",
  "operator-abort",
] as const;

export type HoldoutFailureCode = (typeof HOLDOUT_FAILURE_CODES)[number];

// The scientific tuple that a release evaluation runs under. Every field must be
// identical for a resume or a terminal transition to reach the same session.
// Changing a candidate field does NOT open a fresh lease: admission is decided by
// the block fields alone (see BLOCK_IDENTITY_FIELDS).
export interface HoldoutIdentity {
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  backend: "wasm";
  chromeVersion: typeof RELEASE_CHROME_VERSION;
  evaluatorDigest: string;
  calibrationArtifactDigest: string;
}

export interface HoldoutConsumption extends HoldoutIdentity {
  schemaVersion: 1;
  consumptionId: string;
  startedAt: string;
  terminalAt: string | null;
  status: "started" | "completed" | "failed";
  reportDigest: string | null;
  failureCode: string | null;
}

export interface HoldoutLedgerOptions {
  /**
   * Where the atomic active-session marker is written. Defaults to
   * `benchmark/work/holdout/active-session.json` relative to the process cwd.
   */
  activeSessionPath?: string;
}

/** Coded, fail-closed error thrown by every ledger transition. */
export class HoldoutLedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HoldoutLedgerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new HoldoutLedgerError(code, message);
}

const IDENTITY_FIELDS: readonly (keyof HoldoutIdentity)[] = [
  "datasetDigest",
  "datasetAuditDigest",
  "sourceReadinessDigest",
  "splitDigest",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "tokenizerDigest",
  "runtimeParityDigest",
  "extensionBuildDigest",
  "backend",
  "chromeVersion",
  "evaluatorDigest",
  "calibrationArtifactDigest",
];

/**
 * The fields that identify the blind BLOCK, and the whole set of them. Exactly the
 * two digests over the material itself: the sealed dataset and the partition
 * assignment drawn over it.
 *
 * `datasetAuditDigest` and `sourceReadinessDigest` are deliberately absent. They
 * are attestations ABOUT this same material, recomputed by evaluator code from the
 * very bytes `datasetDigest` already covers, so they add no power to tell one block
 * from another — while a change in that code can move them with the material
 * byte-identical, which would hand a spent block back. Any field admitted here
 * narrows the refusal, so the set stays at the minimum that names the material.
 */
export const BLOCK_IDENTITY_FIELDS: readonly (keyof HoldoutIdentity)[] = [
  "datasetDigest",
  "splitDigest",
];

let tempCounter = 0;

function defaultActiveSessionPath(): string {
  return join(
    process.cwd(),
    "benchmark",
    "work",
    "holdout",
    "active-session.json",
  );
}

// The scientific tuple projected to exactly its identity fields, with lifecycle
// fields excluded, so the comparison and the consumptionId are stable functions
// of the tuple alone.
function projectIdentity(identity: HoldoutIdentity): HoldoutIdentity {
  const projected = {} as Record<keyof HoldoutIdentity, unknown>;
  for (const field of IDENTITY_FIELDS) projected[field] = identity[field];
  return projected as unknown as HoldoutIdentity;
}

function identityMatches(a: HoldoutIdentity, b: HoldoutIdentity): boolean {
  return IDENTITY_FIELDS.every((field) => a[field] === b[field]);
}

function blockMatches(a: HoldoutIdentity, b: HoldoutIdentity): boolean {
  return BLOCK_IDENTITY_FIELDS.every((field) => a[field] === b[field]);
}

function computeConsumptionId(
  identity: HoldoutIdentity,
  startedAt: string,
): string {
  const bytes = new TextEncoder().encode(
    `${canonicalJson(projectIdentity(identity))}${startedAt}`,
  );
  return sha256BytesHex(bytes).slice(0, 24);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  tempCounter += 1;
  const tempPath = join(directory, `.${process.pid}.${tempCounter}.tmp`);
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
}

async function readLedger(ledgerPath: string): Promise<HoldoutConsumption[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: HoldoutConsumption[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail(
        "HOLDOUT_LEDGER_CORRUPT",
        `ledger line ${index + 1} is not valid JSON`,
      );
    }
    events.push(parsed as HoldoutConsumption);
  });
  return events;
}

async function appendLedgerEvent(
  ledgerPath: string,
  event: HoldoutConsumption,
): Promise<void> {
  const existing = await readLedger(ledgerPath);
  const lines = [
    ...existing.map((e) => JSON.stringify(e)),
    JSON.stringify(event),
  ];
  await atomicWrite(ledgerPath, `${lines.join("\n")}\n`);
}

// A per-ledger lockfile serialises begin/complete/fail. It is created with the
// exclusive `wx` flag and always removed in the finally, so a crash inside the
// critical section is the only thing that can leave it behind — a deliberate,
// visible signal rather than a silent overwrite.
async function withLedgerLock<T>(
  ledgerPath: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = `${ledgerPath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail(
        "HOLDOUT_LEDGER_LOCKED",
        "another holdout ledger transition is in progress",
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

function latestForId(
  events: readonly HoldoutConsumption[],
  consumptionId: string,
): HoldoutConsumption | undefined {
  let latest: HoldoutConsumption | undefined;
  for (const event of events) {
    if (event.consumptionId === consumptionId) latest = event;
  }
  return latest;
}

/**
 * Compares the BLOCK fields against every `started` lease in the ledger. ANY prior
 * started event over the same block has already consumed the holdout — even if the
 * process later crashed before a terminal event, and whatever candidate it ran —
 * so a fresh consumption is refused. Scoring the same blind material a second time
 * is what the one-way lease exists to prevent, and swapping a candidate does not
 * restore blindness.
 */
export async function assertHoldoutAvailable(
  ledgerPath: string,
  identity: HoldoutIdentity,
): Promise<void> {
  const events = await readLedger(ledgerPath);
  for (const event of events) {
    if (event.status === "started" && blockMatches(identity, event)) {
      fail(
        "HOLDOUT_ALREADY_CONSUMED",
        "holdout block was already consumed by an existing session",
      );
    }
  }
}

/**
 * Opens the single atomic session over a block. Under the ledger lock it verifies
 * the block is unspent, writes the `started` event with null report/failure, and
 * writes the active-session marker BEFORE any scoring. The event carries the FULL
 * tuple — that is what makes it a verifiable receipt — and the consumptionId stays
 * `sha256(tuple + startedAt).slice(0,24)`, so two runs over one block would still
 * be told apart if one were ever allowed.
 */
export async function beginHoldoutConsumption(
  ledgerPath: string,
  identity: HoldoutIdentity,
  startedAt: string,
  options: HoldoutLedgerOptions = {},
): Promise<HoldoutConsumption> {
  const activeSessionPath =
    options.activeSessionPath ?? defaultActiveSessionPath();
  return withLedgerLock(ledgerPath, async () => {
    await assertHoldoutAvailable(ledgerPath, identity);
    const consumptionId = computeConsumptionId(identity, startedAt);
    const event: HoldoutConsumption = {
      schemaVersion: 1,
      ...projectIdentity(identity),
      consumptionId,
      startedAt,
      terminalAt: null,
      status: "started",
      reportDigest: null,
      failureCode: null,
    };
    await appendLedgerEvent(ledgerPath, event);
    await atomicWrite(activeSessionPath, `${JSON.stringify(event, null, 2)}\n`);
    return event;
  });
}

/**
 * Read-only assertion that a startable (non-terminal) lease exists for a
 * consumption id, without requiring the full tuple. Used by
 * `validate-predictions` for the test partition, where only the id is available.
 */
export async function assertHoldoutStarted(
  ledgerPath: string,
  consumptionId: string,
): Promise<void> {
  const events = await readLedger(ledgerPath);
  const latest = latestForId(events, consumptionId);
  if (latest === undefined) {
    fail(
      "HOLDOUT_SESSION_UNKNOWN",
      "no started holdout session for this consumption id",
    );
  }
  if (latest.status !== "started") {
    fail("HOLDOUT_SESSION_TERMINAL", "holdout session is terminal");
  }
}

/**
 * Reopens an EXISTING started lease. It never mints a new id: the consumptionId
 * must already exist, its latest event must still be `started`, and the supplied
 * tuple must be byte-identical. A terminal session or a diverging tuple is
 * refused.
 */
export async function resumeHoldoutConsumption(
  ledgerPath: string,
  consumptionId: string,
  identity: HoldoutIdentity,
): Promise<HoldoutConsumption> {
  const events = await readLedger(ledgerPath);
  const latest = latestForId(events, consumptionId);
  if (latest === undefined) {
    fail(
      "HOLDOUT_SESSION_UNKNOWN",
      "no started holdout session for this consumption id",
    );
  }
  if (latest.status !== "started") {
    fail("HOLDOUT_SESSION_TERMINAL", "holdout session is terminal");
  }
  if (!identityMatches(identity, latest)) {
    fail(
      "HOLDOUT_TUPLE_MISMATCH",
      "resume requires the identical holdout tuple as the started session",
    );
  }
  return latest;
}

// Loads the started lease for a terminal transition, enforcing the same
// identity and refusing anything already terminal.
async function requireStartedSession(
  ledgerPath: string,
  consumptionId: string,
  identity: HoldoutIdentity,
): Promise<HoldoutConsumption> {
  const events = await readLedger(ledgerPath);
  const latest = latestForId(events, consumptionId);
  if (latest === undefined) {
    fail(
      "HOLDOUT_SESSION_UNKNOWN",
      "no started holdout session for this consumption id",
    );
  }
  if (latest.status !== "started") {
    fail("HOLDOUT_SESSION_TERMINAL", "holdout session is terminal");
  }
  if (!identityMatches(identity, latest)) {
    fail(
      "HOLDOUT_TUPLE_MISMATCH",
      "terminal transition requires the identical holdout tuple",
    );
  }
  return latest;
}

/**
 * Marks a started session `completed` with the sealed report digest and removes
 * the active-session marker. Terminal and consumed thereafter. Called by
 * `evaluate` after a report is written — even when the gates reject, because a
 * release evaluation consumes the holdout whether it passes or fails.
 */
export async function completeHoldoutConsumption(
  ledgerPath: string,
  consumptionId: string,
  identity: HoldoutIdentity,
  reportDigest: string,
  terminalAt: string,
  options: HoldoutLedgerOptions = {},
): Promise<HoldoutConsumption> {
  const activeSessionPath =
    options.activeSessionPath ?? defaultActiveSessionPath();
  return withLedgerLock(ledgerPath, async () => {
    const started = await requireStartedSession(
      ledgerPath,
      consumptionId,
      identity,
    );
    const event: HoldoutConsumption = {
      ...started,
      terminalAt,
      status: "completed",
      reportDigest,
      failureCode: null,
    };
    await appendLedgerEvent(ledgerPath, event);
    await rm(activeSessionPath, { force: true });
    return event;
  });
}

/**
 * Marks a started session `failed` with a closed reason code (never free text),
 * a null report digest, and removes the active-session marker. Existing shards
 * are NEVER deleted. Used only for a declared-irrecoverable failure; a plain
 * process crash instead leaves the `started` lease for `--resume`.
 */
export async function failHoldoutConsumption(
  ledgerPath: string,
  consumptionId: string,
  identity: HoldoutIdentity,
  failureCode: HoldoutFailureCode,
  terminalAt: string,
  options: HoldoutLedgerOptions = {},
): Promise<HoldoutConsumption> {
  if (!HOLDOUT_FAILURE_CODES.includes(failureCode)) {
    fail(
      "HOLDOUT_FAILURE_CODE_INVALID",
      `failureCode must be one of ${HOLDOUT_FAILURE_CODES.join(", ")}`,
    );
  }
  const activeSessionPath =
    options.activeSessionPath ?? defaultActiveSessionPath();
  return withLedgerLock(ledgerPath, async () => {
    const started = await requireStartedSession(
      ledgerPath,
      consumptionId,
      identity,
    );
    const event: HoldoutConsumption = {
      ...started,
      terminalAt,
      status: "failed",
      reportDigest: null,
      failureCode,
    };
    await appendLedgerEvent(ledgerPath, event);
    await rm(activeSessionPath, { force: true });
    return event;
  });
}
