// `consume-holdout`: the Phase 3 orchestrator that spends the ONE-WAY temporal
// holdout lease exactly once and issues an auditable release decision.
//
// The lease is irreversible. This command confirms the evaluator's own bytes
// against the frozen declaration and the pre-registered cut against the frozen
// seal BEFORE anything else, opens the Phase 2
// append-only ledger session EXACTLY ONCE (after confirming
// `--confirm-split-digest` against the frozen `SplitArtifact.splitDigest`),
// browser-scores the sealed test partition under that active consumption through
// the scorer's internal test entry point, validates completeness, confirms the
// evaluator a second time now that shards exist, then DELEGATES the scientific
// decision byte-for-byte to the Phase 2 `evaluate`/gates. It never restates gate
// policy and never calls fit code after the consumption has started.
//
// The two evaluator checks bracket the exposure, and the bracket is the point: a
// divergence before the lease costs nothing, while a divergence after the first
// shard hit disk is a spent block that yields an exposure record and no claim.
// Neither check is blindness — the operator owns the disk — they make a provoked
// integrity veto indistinguishable from an honest one impossible.
//
// One-way semantics, enforced by the Phase 2 ledger primitives:
//   - The first `started` event consumes the BLOCK (dataset+split) even if the
//     process later crashes; a plain crash leaves the lease `started` for
//     `--resume`, and no other candidate can reopen that block.
//   - `--resume-consumption` reopens ONLY the same id under the identical tuple;
//     it can never mint a new id, and a fresh run of a consumed tuple is refused.
//     It also cannot re-bless the pre-registered cut: the block it reopens is already
//     spent, so the cut on disk has to be the one the first attempt recorded in
//     `pre-exposure-check.json` before it scored anything. What is asserted about that
//     record is scoped to the LEDGER the run is pointed at: a fresh run over a block
//     that ledger records as spent is refused BEFORE it reaches the write that would
//     replace the record. What is NOT asserted is the pair of arguments the caller
//     chooses — the receipt is keyed only by `--work-dir` and carries no block
//     identity, so a run pointed at a different `--ledger`, or a legitimate run over a
//     DIFFERENT block that shares the work directory, does replace it. Both sequences
//     are measured and open; see the debt row in `docs/ESTADO.md` § 7.
//   - A recognized irrecoverable failure (a candidate that fails identity/parity
//     verification, or an invalid shard set) is declared via
//     `failHoldoutConsumption`; `completed` and `failed` are terminal and stay
//     consumed. Deleting or resetting a ledger is unsupported, and a release run
//     refuses a `--ledger` that does not exist instead of creating it — an absent
//     ledger reads as an unspent block for every block there is.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  BrowserScorerError,
  runHoldoutTestScore,
  type BenchmarkPage,
  type BenchmarkScoreItem,
  type HoldoutTestScoreIdentity,
  type ModelBenchmarkScoreV1,
  type ModelBenchmarkStatusV1,
} from "../browser-scorer.ts";
import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { validateDatasetManifest } from "../dataset-manifest.ts";
import {
  computeEvaluatorDigest,
  observeEvaluatorFiles,
  type EvaluatorFileObservation,
} from "../digests.ts";
import type { ReleaseDecision } from "../gates.ts";
import {
  assertHoldoutAvailable,
  assertHoldoutLedgerPresent,
  beginHoldoutConsumption,
  failHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutConsumption,
  type HoldoutFailureCode,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import {
  assertPredictionCompleteness,
  PredictionSchemaError,
} from "../prediction-schema.ts";
import {
  createPredictionShardStore,
  PredictionShardError,
} from "../prediction-shards.ts";
import {
  parseProvisionalThresholdArtifact,
  validateProvisionalThresholdArtifact,
} from "../provisional-threshold.ts";
import { parseBenchmarkDataset } from "../schema.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import {
  assertEvaluatorIdentity,
  resolveEvaluatorRoot,
  runEvaluate,
  thresholdBinding,
} from "./evaluate.ts";
import {
  CommandError,
  readJsonFile,
  readPredictionArtifact,
  readTextFile,
  writeJsonAtomic,
} from "./io.ts";

import type { Page } from "playwright";

export interface ConsumeHoldoutOptions {
  datasetDirectory: string;
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  ledgerPath: string;
  candidateExtensionDir: string;
  /** Working directory holding the active-session marker and test shards. */
  workDirectory: string;
  outputDirectory: string;
  bootstrapSeed: number;
  /** Sealed opaque-id + text test corpus (private). */
  testInputPath: string;
  /** Sealed private test labels. */
  testLabelsPath: string;
  /** Required to OPEN a fresh consumption; verified against the split digest. */
  confirmSplitDigest?: string;
  /** Reopen the SAME started lease after an unexpected crash (never a new id). */
  resumeConsumptionId?: string;
}

/** An opened candidate page and its teardown. */
export interface ConsumeHoldoutTestPage {
  page: BenchmarkPage;
  close: () => Promise<void>;
}

export interface ConsumeHoldoutDeps {
  /** Deterministic clock; defaults to wall-clock ISO time. */
  now?: () => string;
  /**
   * Opens the candidate page that scores the test partition. Defaults to the
   * real locked Chrome for Testing launch (the deferred operator path); tests
   * inject a page over an in-memory scorer.
   */
  createTestPage?: (
    candidateExtensionDir: string,
  ) => Promise<ConsumeHoldoutTestPage>;
  /**
   * The tree whose bytes ARE the evaluator, for the identity check. Reachable only
   * from a caller in this process: `assertKnownFlags` keeps it off the CLI, because
   * a flag would let a run aim the check at a clean copy while an altered evaluator
   * produces the numbers.
   */
  evaluatorRoot?: string;
}

/** Readable copy of the pre-exposure check, beside the shards it precedes. */
const PRE_EXPOSURE_RECEIPT_FILE = "pre-exposure-check.json";
/** What a spent-but-uncertified block leaves behind, in the output directory. */
const EXPOSURE_INCIDENT_FILE = "holdout-exposure-incident.json";

/**
 * Consumes the temporal holdout exactly once and returns the sole line the
 * operator reads: `HOLDOUT_COMPLETED decision=pass|indicator-only|reject`. The
 * decision is whatever the Phase 2 gates sealed — never recomputed here.
 */
export async function runConsumeHoldout(
  options: ConsumeHoldoutOptions,
  deps: ConsumeHoldoutDeps = {},
): Promise<string> {
  const now = deps.now ?? ((): string => new Date().toISOString());
  const createTestPage = deps.createTestPage ?? defaultCreateTestPage;
  const evaluatorRoot = resolveEvaluatorRoot(deps.evaluatorRoot);

  // The frozen calibration is read first because the evaluator has to be judged
  // before this command touches the corpus: records.jsonl carries `text` and
  // `label` on every record, and the lease does not exist yet either. A divergence
  // here costs nothing — no ledger byte, no marker, no output.
  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);
  const observedEvaluatorDigest = await assertEvaluatorIdentity(
    evaluatorRoot,
    frozen.evaluatorDigest,
  );
  const preExposureFiles = await observeEvaluatorFiles(evaluatorRoot);
  const preExposureReceiptPath = join(
    options.workDirectory,
    PRE_EXPOSURE_RECEIPT_FILE,
  );
  // The pre-registered cut, parsed and bound to the frozen seal HERE, in the same stretch
  // as the evaluator check: all seven digests come off `frozen`, which is what makes the
  // check possible before any file but the frozen artifact has been opened. `evaluate`
  // reads the same file and repeats the same two checks, but it runs after the block has
  // been scored: without this reading a truncated or foreign cut would be discovered with
  // the lease already `started`, which spends the block to learn that a JSON file is
  // malformed.
  //
  // On a FRESH run this stretch also sits before the ledger, before the marker and before
  // the first blind-block byte — records.jsonl, read below, carries `text` and `label` on
  // every record — so the reading is a BLESSING taken while the block was still blind, and
  // a refusal costs the run and nothing else.
  //
  // On a `--resume-consumption` none of that holds: the previous attempt already wrote
  // `started`, already left the marker and already scored the block. The parse and the
  // binding still run, and they still refuse a malformed or foreign artifact, but they are
  // not a blessing — a cut first put on disk after the exposure would satisfy both. What
  // stands in for the blessing there is the guard below, which binds the retry to the
  // digest the first attempt recorded before it spent the block.
  //
  // The parsed artifact is KEPT, and that is what makes this a check on the cut that
  // decides rather than on a file that happened to be valid once: its `artifactDigest`
  // travels to `runEvaluate` below, which reads the same path again after the block has
  // been scored and refuses anything but these bytes.
  const preExposureCut = parseProvisionalThresholdArtifact(
    await readJsonFile(
      join(
        dirname(options.frozenCalibrationPath),
        "provisional-threshold.json",
      ),
    ),
  );
  validateProvisionalThresholdArtifact(
    preExposureCut,
    thresholdBinding(frozen),
  );
  if (options.resumeConsumptionId !== undefined) {
    await assertResumedCutWasBlessedBeforeTheExposure(
      preExposureReceiptPath,
      preExposureCut.artifactDigest,
    );
  }

  const manifest = validateDatasetManifest(
    await readJsonFile(join(options.datasetDirectory, "manifest.json")),
  );
  // A release run appends to a ledger whose existing `started` events are the only
  // thing that can refuse a spent block, so an absent ledger is refused instead of
  // created: `readLedger` reports ENOENT as zero events, which reads as "no block was
  // ever exposed" for every block at once. The refusal sits ahead of records.jsonl,
  // which carries `text` and `label` on every record.
  if (manifest.scientificUse === "release") {
    await assertHoldoutLedgerPresent(options.ledgerPath);
  }
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );
  const artifact = (await readJsonFile(
    options.splitArtifactPath,
  )) as SplitArtifact;
  await validateSplitArtifact(artifact, manifest, records);

  // The FULL scientific tuple the lease binds — identical to the one evaluate
  // re-verifies on resume, so the begin here and the resume there agree exactly.
  const identity = buildIdentity(frozen, artifact);
  const activeSessionPath = join(options.workDirectory, "active-session.json");

  await mkdir(options.workDirectory, { recursive: true });
  // Only an infrastructure-only run may bring its own ledger into being: it measures
  // nothing scientific, so a throwaway ledger under a throwaway directory costs
  // nothing. The release path was already refused above rather than backfilled.
  if (manifest.scientificUse !== "release") {
    await mkdir(dirname(options.ledgerPath), { recursive: true });
  }

  // On a fresh run the split-digest confirmation is checked FIRST, before any
  // ledger byte is written, so a wrong confirmation can never consume the holdout.
  if (options.resumeConsumptionId === undefined) {
    if (options.confirmSplitDigest === undefined) {
      throw new CommandError(
        "SPLIT_DIGEST_CONFIRMATION_REQUIRED",
        "a fresh consume-holdout run requires --confirm-split-digest",
      );
    }
    if (options.confirmSplitDigest !== artifact.splitDigest) {
      throw new CommandError(
        "SPLIT_DIGEST_CONFIRMATION_MISMATCH",
        "--confirm-split-digest does not match the frozen split artifact splitDigest",
      );
    }
    // The block's availability is read HERE, ahead of the receipt write, because the guard
    // on the resume branch compares the cut on disk against a FILE — so a fresh invocation
    // that reaches the write over a spent block replaces the very record that guard reads,
    // and the retry then agrees with whatever cut the second invocation found.
    // `beginHoldoutConsumption` refuses that invocation with this same code, but it does so
    // after the write, which is too late to keep the record intact.
    //
    // The authority is the LEDGER and not the presence of the receipt: the receipt lives in
    // the work directory, so keying the refusal on it would let deleting one file turn a
    // spent block back into a writable blessing. `assertHoldoutAvailable` is the same
    // function `beginHoldoutConsumption` runs under the ledger lock, so the two cannot
    // disagree about what "spent" means; this call is not the enforcement — that stays under
    // the lock — it only keeps a doomed invocation away from the record.
    //
    // The residue, measured and open: both of this guard's inputs are chosen by the caller.
    // A run pointed at an empty `--ledger` reads the block as unspent and writes the record
    // again, and a legitimate run over a DIFFERENT block sharing the `--work-dir` overwrites
    // it too, because the receipt carries no block identity. Closing that needs the receipt
    // keyed by the consumption, which is a unit of its own (`docs/ESTADO.md` § 7).
    await assertHoldoutAvailable(options.ledgerPath, identity);
  }

  // The durable receipt of the EVALUATOR check is the `started` event itself: its
  // `evaluatorDigest` now equals bytes confirmed on disk moments earlier, so for that half
  // this file is only a readable copy. For the CUT it is not a copy of anything — no ledger
  // field carries the cut — which is what a resume comes back to read. Either way it must
  // NOT become a ledger line: `latestForId` returns the last event for an id, so a stray
  // line would make resume and complete read a live session as terminal.
  //
  // `provisionalThresholdArtifactDigest` is the cut this attempt read before it opened or
  // reopened the session. On a fresh run that reading is the blessing, taken while the
  // block was still blind. On a resume the block is already spent, so this field is not a
  // new blessing: the guard above has already required it to equal the digest the first
  // attempt recorded, and rewriting it here can only put the same value back — which is
  // also why reading the receipt has to stay AHEAD of this write, since a write that came
  // first would leave the guard comparing the file against itself.
  //
  // That ordering is WITHIN one call, and on its own it protects nothing: a second
  // invocation is a fresh run, so it never reaches that guard and arrives here with its own
  // reading to write. What keeps this line out of its reach is the availability check above,
  // which refuses a fresh run over a spent block before the write.
  //
  // The refusal on the deciding side lives in `runEvaluate` and needs no file. What this
  // copy is for is a link the published bundle cannot make on its own, because it does not
  // carry this file: `fit-summary.json` publishes the cut's `artifactDigest`, and matching
  // that digest against the cut checked before the lease needs the receipt in the run's
  // work directory.
  await writeJsonAtomic(preExposureReceiptPath, {
    schemaVersion: 1,
    frozenEvaluatorDigest: frozen.evaluatorDigest,
    observedEvaluatorDigest,
    provisionalThresholdArtifactDigest: preExposureCut.artifactDigest,
    files: preExposureFiles,
    checkedAt: now(),
  });

  // Open (or reopen) the single atomic session. A resume rescores everything and
  // rewrites the shards, so it is fresh exposure and gets the same check.
  const session: HoldoutConsumption =
    options.resumeConsumptionId !== undefined
      ? await resumeHoldoutConsumption(
          options.ledgerPath,
          options.resumeConsumptionId,
          identity,
        )
      : await beginHoldoutConsumption(options.ledgerPath, identity, now(), {
          activeSessionPath,
        });

  const testPredictionsDirectory = join(
    options.workDirectory,
    "predictions",
    "test",
  );
  const testIds = artifact.assignments
    .filter((assignment) => assignment.partition === "test")
    .map((assignment) => assignment.id);

  // Score + validate under the active lease. A recognized irrecoverable fault is
  // declared terminal (`failed`); anything else propagates and leaves the lease
  // `started` so the exact `--resume-consumption` form can retry it.
  try {
    const items = await readTestInput(options.testInputPath);
    const store = createPredictionShardStore({
      directory: testPredictionsDirectory,
      createdAt: now(),
    });
    const scoreIdentity = buildScoreIdentity(frozen, artifact);
    const handle = await createTestPage(options.candidateExtensionDir);
    let scored;
    try {
      scored = await runHoldoutTestScore({
        consumption: session,
        identity: scoreIdentity,
        page: handle.page,
        store,
        items,
      });
    } finally {
      await handle.close();
    }
    // Materialize the artifact the Phase 2 evaluate reads (`manifest.json`
    // alongside the shard files the store already wrote).
    await writeJsonAtomic(
      join(testPredictionsDirectory, "manifest.json"),
      scored,
    );
    const { predictions } = await readPredictionArtifact(
      testPredictionsDirectory,
      { scientificUse: "release" },
    );
    // Missing, extra or duplicate ids are a hard failure — no scientific
    // decision. Individual `error` rows are valid, complete observations.
    assertPredictionCompleteness(testIds, predictions);
  } catch (error) {
    const failureCode = classifyIrrecoverable(error);
    if (failureCode !== null) {
      await failHoldoutConsumption(
        options.ledgerPath,
        session.consumptionId,
        identity,
        failureCode,
        now(),
        { activeSessionPath },
      );
    }
    throw error;
  }

  // Measured again now that shards exist on disk. A divergence at this point was
  // introduced by someone who could already read partial scores, so the lease goes
  // TERMINAL instead of sealing numbers an uncertified evaluator produced: the block
  // was spent and it yields an exposure record, not a claim.
  //
  // An inventory file that cannot be read AT ALL — deleted, renamed, permission
  // revoked — is measured as `null`, which is not the frozen digest and so takes the
  // same branch as an altered byte. Adding a byte and taking a file away are the same
  // act with the same motive, and a throw here would leave this function with the
  // block spent and no terminal event: the one outcome this guard exists to deny, and
  // reachable by a single `rm`.
  let postExposureEvaluatorDigest: string | null;
  try {
    postExposureEvaluatorDigest = await computeEvaluatorDigest(evaluatorRoot);
  } catch {
    postExposureEvaluatorDigest = null;
  }
  if (postExposureEvaluatorDigest !== frozen.evaluatorDigest) {
    // The DURABLE event first, its readable attachment second. The incident re-reads
    // the same tree that just failed to hash and writes into the output directory, so
    // it is the fragile half of the pair; ahead of the ledger it could take the
    // terminal event down with it.
    await failHoldoutConsumption(
      options.ledgerPath,
      session.consumptionId,
      identity,
      "identity-mismatch",
      now(),
      { activeSessionPath },
    );
    await writeExposureIncident({
      workDirectory: options.workDirectory,
      outputDirectory: options.outputDirectory,
      testPredictionsDirectory,
      evaluatorRoot,
      consumptionId: session.consumptionId,
      frozenEvaluatorDigest: frozen.evaluatorDigest,
      observedEvaluatorDigest: postExposureEvaluatorDigest,
      detectedAt: now(),
    });
    throw new CommandError(
      "EVALUATOR_DIGEST_POST_EXPOSURE_MISMATCH",
      `the evaluator changed after the test block was scored (${postExposureEvaluatorDigest ?? "unreadable"} on disk, ${frozen.evaluatorDigest} frozen); the session is terminal and no metric was computed`,
    );
  }

  // Delegate metrics, slices, the gate report and the terminal `completed`
  // ledger event to the frozen Phase 2 evaluator under the SAME consumption id.
  //
  // `expectedProvisionalThresholdDigest` is the whole reason the cut is parsed above
  // instead of being validated and dropped: `runEvaluate` re-reads
  // `provisional-threshold.json`, and it is the ONLY reading that decides. Handing the
  // pre-lease digest down is what makes the blessed artifact and the deciding artifact
  // the same one; without it the check above proves something about bytes that no longer
  // have to be on disk.
  await runEvaluate({
    datasetDirectory: options.datasetDirectory,
    splitArtifactPath: options.splitArtifactPath,
    frozenCalibrationPath: options.frozenCalibrationPath,
    testPredictionsDirectory,
    testLabelsPath: options.testLabelsPath,
    ledgerPath: options.ledgerPath,
    consumptionId: session.consumptionId,
    outputDirectory: options.outputDirectory,
    bootstrapSeed: options.bootstrapSeed,
    evaluatorRoot: deps.evaluatorRoot,
    expectedProvisionalThresholdDigest: preExposureCut.artifactDigest,
  });

  const gateReport = (await readJsonFile(
    join(options.outputDirectory, "gate-report.json"),
  )) as { decision: ReleaseDecision };
  return `HOLDOUT_COMPLETED decision=${gateReport.decision}`;
}

interface ExposureIncidentInput {
  workDirectory: string;
  outputDirectory: string;
  testPredictionsDirectory: string;
  evaluatorRoot: string;
  consumptionId: string;
  frozenEvaluatorDigest: string;
  /** `null` when the aggregate could not be computed at all. */
  observedEvaluatorDigest: string | null;
  detectedAt: string;
}

/**
 * Records that a block was spent without producing a certified claim: both digests,
 * which inventory paths moved since the pre-exposure receipt, and how many shards
 * already existed. Paths and counts only — never a row, a score, a label or a text,
 * because this file is published alongside the ledger event.
 */
async function writeExposureIncident(
  input: ExposureIncidentInput,
): Promise<void> {
  const receipt = await readPreExposureFileDigests(
    join(input.workDirectory, PRE_EXPOSURE_RECEIPT_FILE),
  );
  const observed = await observeEvaluatorFiles(input.evaluatorRoot);
  await writeJsonAtomic(join(input.outputDirectory, EXPOSURE_INCIDENT_FILE), {
    schemaVersion: 1,
    consumptionId: input.consumptionId,
    frozenEvaluatorDigest: input.frozenEvaluatorDigest,
    observedEvaluatorDigest: input.observedEvaluatorDigest,
    changedFiles:
      receipt === null
        ? null
        : observed
            .filter((file) => receipt.get(file.path) !== file.digest)
            .map((file) => file.path),
    receiptMissing: receipt === null,
    exposedShardCount: await countExposedShards(input.testPredictionsDirectory),
    detectedAt: input.detectedAt,
    failureCode: "identity-mismatch",
  });
}

/**
 * Binds a `--resume-consumption` attempt to the cut the FIRST attempt recorded before it
 * exposed the block.
 *
 * A resume cannot bless a cut: by the time it runs the block has been scored, so an
 * artifact that is impeccable in isolation — recomputing to its own digest and bound to
 * the same seven governance digests — may still have been chosen after someone read
 * partial scores. Validating it again would accept exactly that, which is why the retry is
 * compared against the recorded digest instead.
 *
 * The receipt is the only place that digest survives: the `started` ledger event carries
 * the scientific tuple and not the cut. So a receipt that no longer records one is a
 * refusal and never a fresh blessing, and the asymmetry is deliberate — the block is spent
 * either way, and the run that cannot be bound is the one that must not produce a claim.
 */
async function assertResumedCutWasBlessedBeforeTheExposure(
  receiptPath: string,
  onDiskDigest: string,
): Promise<void> {
  const blessed = await readBlessedCutDigest(receiptPath);
  if (blessed === null) {
    throw new CommandError(
      "PRE_EXPOSURE_RECEIPT_CUT_MISSING",
      `${receiptPath} records no pre-exposure cut digest, so this resume cannot be bound ` +
        "to a cut checked while the block was still blind",
    );
  }
  if (blessed !== onDiskDigest) {
    throw new CommandError(
      "PROVISIONAL_THRESHOLD_SWAPPED_BEFORE_RESUME",
      `the pre-registered cut on disk declares ${onDiskDigest}, while the cut checked ` +
        `before this session spent the block was ${blessed}: a resume may not bless a new cut`,
    );
  }
}

// The digest the receipt records for the pre-registered cut, or `null` when the file
// cannot be read or does not carry one.
async function readBlessedCutDigest(path: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(path));
  } catch {
    return null;
  }
  const digest = (parsed as { provisionalThresholdArtifactDigest?: unknown })
    .provisionalThresholdArtifactDigest;
  return typeof digest === "string" ? digest : null;
}

// The incident tolerates a receipt it cannot read: `null` here is reported as
// `receiptMissing` instead of as an empty change set. The tolerance is this writer's alone
// — {@link assertResumedCutWasBlessedBeforeTheExposure} refuses on the same absence —
// because a resume needs the file to know WHICH cut was blessed, while an incident is
// already the news that the block was spent without a claim.
async function readPreExposureFileDigests(
  path: string,
): Promise<Map<string, string> | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(path));
  } catch {
    return null;
  }
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  const digests = new Map<string, string>();
  for (const entry of files as EvaluatorFileObservation[]) {
    if (typeof entry?.path !== "string" || typeof entry?.digest !== "string") {
      return null;
    }
    digests.set(entry.path, entry.digest);
  }
  return digests;
}

// How much of the blind block was already on disk when the divergence was found.
// The shard store commits a file every SHARD_SIZE rows during scoring, so this is a
// count of committed files and nothing is opened.
async function countExposedShards(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory);
    return entries.filter((entry) => entry.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

// The scientific tuple that identifies the lease — byte-for-byte the identity
// `evaluate` rebuilds from the same frozen calibration and split artifact.
function buildIdentity(
  frozen: FrozenCalibrationArtifact,
  artifact: SplitArtifact,
): HoldoutIdentity {
  return {
    datasetDigest: artifact.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: artifact.splitDigest,
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    tokenizerDigest: frozen.model.tokenizerDigest,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
    backend: "wasm",
    chromeVersion: frozen.scoringRuntime.chromeVersion,
    evaluatorDigest: frozen.evaluatorDigest,
    calibrationArtifactDigest: frozen.artifactDigest,
  };
}

// The identity the test partition is scored under: the frozen model/runtime plus
// the split's dataset/split digests, so the emitted test manifest matches the
// frozen governance seal by construction.
function buildScoreIdentity(
  frozen: FrozenCalibrationArtifact,
  artifact: SplitArtifact,
): HoldoutTestScoreIdentity {
  return {
    datasetDigest: artifact.datasetDigest,
    splitDigest: artifact.splitDigest,
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    tokenizerDigest: frozen.model.tokenizerDigest,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
  };
}

// Only these faults are declared terminal `failed`. A candidate that fails
// identity/parity/backend/tokenizer verification is a chrome-verification
// failure; an invalid or incomplete shard set is a shard-invalid failure.
// Everything else (an unexpected scorer death, an evaluate governance error) is
// NOT declared here — it leaves the lease `started` for `--resume-consumption`.
function classifyIrrecoverable(error: unknown): HoldoutFailureCode | null {
  if (error instanceof BrowserScorerError) return "chrome-verification-failed";
  if (
    error instanceof PredictionShardError ||
    error instanceof PredictionSchemaError
  ) {
    return "shard-invalid";
  }
  return null;
}

// Reads the sealed test corpus: one `{ id, text }` per line. Text never leaves
// this process — it is scored and discarded, never stored in a prediction row.
async function readTestInput(path: string): Promise<BenchmarkScoreItem[]> {
  const text = await readTextFile(path);
  const items: BenchmarkScoreItem[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new CommandError(
        "TEST_INPUT_INVALID",
        `test input line ${index + 1} is not valid JSON`,
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { text?: unknown }).text !== "string"
    ) {
      throw new CommandError(
        "TEST_INPUT_INVALID",
        `test input line ${index + 1} must be { id, text }`,
      );
    }
    const { id, text: body } = parsed as { id: string; text: string };
    items.push({ id, text: body });
  });
  return items;
}

// --- default operator path: the locked Chrome for Testing launch -----------
// Only used when no page is injected (the deferred Step 8 real consumption). The
// Vitest suite always injects a page over an in-memory scorer, so this launch is
// exercised only by the live operator run, never by the unit tests.

const CANDIDATE_PAGE = "model-benchmark.html";
const CANDIDATE_GLOBAL = "__cleanfeedModelBenchmark";
/** Cold WASM start for the pinned bundle; see runScore for the rationale. */
const CANDIDATE_READY_TIMEOUT_MS = 300_000;

interface CandidatePageApi {
  status: ModelBenchmarkStatusV1;
  score(text: string): Promise<ModelBenchmarkScoreV1>;
}

async function defaultCreateTestPage(
  candidateExtensionDir: string,
): Promise<ConsumeHoldoutTestPage> {
  const { chromium } = await import("playwright");
  const {
    resolveLockedTestBrowser,
    loadTestBrowserLock,
    assertLockedBrowserVersion,
  } = await import("../../scripts/test-browser-lock.mjs");

  const candidateDir = resolve(candidateExtensionDir);
  const lock = await loadTestBrowserLock();
  const resolved = await resolveLockedTestBrowser(lock);
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    executablePath: resolved.executablePath,
    args: [
      `--disable-extensions-except=${candidateDir}`,
      `--load-extension=${candidateDir}`,
    ],
  });
  try {
    assertLockedBrowserVersion(
      (await context.browser()?.version()) ?? "",
      lock,
    );
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        void route.abort();
        return;
      }
      void route.continue();
    });
    const [existing] = context.serviceWorkers();
    const worker = existing ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await openHoldoutCandidatePage(page, extensionId);
    const benchmarkPage: BenchmarkPage = {
      status(): Promise<ModelBenchmarkStatusV1> {
        return page.evaluate((globalName) => {
          const api = (
            globalThis as unknown as Record<
              string,
              CandidatePageApi | undefined
            >
          )[globalName];
          if (api === undefined) {
            throw new Error("candidate benchmark API is unavailable");
          }
          return api.status;
        }, CANDIDATE_GLOBAL);
      },
      score(text: string): Promise<ModelBenchmarkScoreV1> {
        return page.evaluate(
          ([globalName, input]) => {
            const api = (
              globalThis as unknown as Record<
                string,
                CandidatePageApi | undefined
              >
            )[globalName];
            if (api === undefined) {
              throw new Error("candidate benchmark API is unavailable");
            }
            return api.score(input);
          },
          [CANDIDATE_GLOBAL, text] as const,
        );
      },
    };
    return { page: benchmarkPage, close: () => context.close() };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Navigates the one-way holdout driver and waits until the candidate has
 * published its terminal API. Kept separate from the score path so a regression
 * in either browser driver is detected independently.
 */
export async function openHoldoutCandidatePage(
  page: Pick<Page, "goto" | "waitForFunction">,
  extensionId: string,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/${CANDIDATE_PAGE}`);
  // The candidate publishes its API only once model assembly reaches a
  // TERMINAL outcome, so the global does not exist at navigation time — a 106M
  // ONNX bundle takes tens of seconds under WASM. Racing it reads as
  // "candidate benchmark API is unavailable", which on THIS path costs a
  // resume of the one-way holdout lease.
  await page.waitForFunction(
    (globalName) => globalName in globalThis,
    CANDIDATE_GLOBAL,
    { timeout: CANDIDATE_READY_TIMEOUT_MS },
  );
}
