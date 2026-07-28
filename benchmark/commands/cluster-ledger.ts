// `cluster-ledger <action>`: the closed CLI over the cluster-exposure ledger.
//
// The action set is FROZEN at init | verify | preflight | record-pilot |
// commit-split | backup | restore. `preflight` writes nothing at all;
// `record-pilot` and `commit-split` take an authenticated backup and then
// transact. Key ROTATION is deliberately not here — it is a library operation
// (`rotateClusterExposureKey`), because the command set is closed and rotating a
// key renumbers nothing but must still be a knowing act, not a flag.
//
// This module is only plumbing: it reads a request file, hands it to the ledger
// and formats the answer. Every eligibility decision, every digest and every
// durability guarantee lives in benchmark/cluster-exposure-ledger.ts.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { rename } from "node:fs/promises";

import {
  CLUSTER_EXPOSURE_EVENT_TYPES,
  backupClusterLedger,
  commitSplitFreeze,
  initClusterLedger,
  parseExposureRequest,
  preflightExposure,
  recordPilotExposure,
  restoreClusterLedger,
  verifyClusterLedger,
  type ClusterLedgerPaths,
} from "../cluster-exposure-ledger.ts";
import { CommandError, readJsonFile } from "./io.ts";

export const CLUSTER_LEDGER_ACTIONS = [
  "init",
  "verify",
  "preflight",
  "record-pilot",
  "commit-split",
  "backup",
  "restore",
] as const;

export type ClusterLedgerAction = (typeof CLUSTER_LEDGER_ACTIONS)[number];

export interface ClusterLedgerOptions {
  action: ClusterLedgerAction;
  paths: ClusterLedgerPaths;
  /** `init`, `backup`: the instant recorded. Never `Date.now()`. */
  occurredAt?: string;
  /** `preflight`, `record-pilot`, `commit-split`: the request JSON file. */
  requestPath?: string;
  /** `restore`: the backup directory. */
  backupDirectory?: string;
  /**
   * `commit-split`: the split artifact ALREADY written to a staging path, and
   * where it belongs. The finalize step is the rename, so the artifact and the
   * exposure event are published together or neither is.
   */
  stagedSplitPath?: string;
  splitOutPath?: string;
}

function require_(
  value: string | undefined,
  flag: string,
  action: string,
): string {
  if (value === undefined) {
    throw new CommandError(
      "CLUSTER_LEDGER_FLAG_MISSING",
      `cluster-ledger ${action} requires --${flag}`,
    );
  }
  return value;
}

export async function runClusterLedger(
  options: ClusterLedgerOptions,
): Promise<string> {
  const { action, paths } = options;
  switch (action) {
    case "init": {
      const keyring = await initClusterLedger(paths, {
        createdAt: require_(options.occurredAt, "occurred-at", action),
      });
      return (
        `Cluster-exposure ledger initialised: keyring ${paths.keyringPath} ` +
        `carries ${keyring.keys.length} key(s) (${keyring.keys
          .map((key) => key.keyVersion)
          .join(", ")}); ledger ${paths.ledgerPath} is empty.`
      );
    }
    case "verify": {
      const verified = await verifyClusterLedger(paths);
      return (
        `Cluster-exposure ledger verified: ${verified.eventCount} event(s), ` +
        `chain closed at ${verified.lastEventDigest ?? "(empty)"}, ` +
        `keys ${verified.keyVersions.join(", ")}, ` +
        `${verified.strayTempFiles.length} interrupted write(s) left on disk.`
      );
    }
    case "preflight": {
      const request = parseExposureRequest(
        await readJsonFile(require_(options.requestPath, "request", action)),
      );
      const decision = await preflightExposure(paths, request);
      if (decision.eligible) {
        return (
          `Preflight: eligible. ${decision.event.records.length} record-line(s) ` +
          `would be exposed as ${decision.event.eventType}. Nothing was written.`
        );
      }
      return (
        `Preflight: REFUSED (${decision.refusals.length}). ` +
        `${decision.refusals
          .map(
            (refusal) =>
              `${refusal.recordId} -> ${refusal.partition}: ${refusal.reason}`,
          )
          .join("; ")}. Nothing was written.`
      );
    }
    case "record-pilot": {
      const request = parseExposureRequest(
        await readJsonFile(require_(options.requestPath, "request", action)),
      );
      const event = await recordPilotExposure(paths, request);
      return (
        `Pilot exposure recorded: ${event.records.length} record-line(s), ` +
        `event ${event.eventId}, digest ${event.eventDigest}.`
      );
    }
    case "commit-split": {
      const request = parseExposureRequest(
        await readJsonFile(require_(options.requestPath, "request", action)),
      );
      const staged = require_(options.stagedSplitPath, "staged-split", action);
      const target = require_(options.splitOutPath, "split-out", action);
      const event = await commitSplitFreeze(paths, request, async () => {
        // The caller staged and fsynced the artifact; publishing it is one
        // rename, which is the smallest window this platform offers.
        await rename(staged, target);
      });
      return (
        `Split freeze committed: ${event.records.length} record-line(s) across the ` +
        `five active partitions, reserve manifest ` +
        `${event.reserveManifestDigest ?? "(none)"}, event ${event.eventId}.`
      );
    }
    case "backup": {
      const receipt = await backupClusterLedger(
        paths,
        require_(options.occurredAt, "occurred-at", action),
      );
      return (
        `Backup written to ${receipt.directory}, authenticated under ` +
        `${receipt.keyVersion}.`
      );
    }
    case "restore": {
      const outcome = await restoreClusterLedger(
        paths,
        require_(options.backupDirectory, "backup", action),
      );
      return (
        `Restore from ${outcome.directory}: ledger ${outcome.ledger}, ` +
        `keyring ${outcome.keyring}.`
      );
    }
  }
}

/** The event types a request file may declare, for the usage text. */
export const CLUSTER_LEDGER_EVENT_TYPES = CLUSTER_EXPOSURE_EVENT_TYPES;
