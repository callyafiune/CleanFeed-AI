// `preflight-viability`: reads the stamped corpus BEFORE the split and answers whether
// the five pre-registered partition fractions are reachable at all.
//
// It writes nothing and seals nothing. It reads `records.jsonl` and no manifest, no
// dataset audit and no split artifact, because it runs before any of them certifies
// anything and requiring a seal would make the cheap check available only after the
// expensive one. The scientific content is `benchmark/viability-preflight.ts`; this
// module is the I/O boundary and the operator-facing text.
//
// The verdict carries {@link VIABILITY_NECESSARY_NOT_SUFFICIENT} on the PASSING path.
// That is where the sentence is load-bearing: a green preflight is the output a reader
// can mistake for a splittable corpus, and a refusal cannot be mistaken for anything.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import { parseBenchmarkDataset } from "../schema.ts";
import {
  PARTITION_VIABILITY_NOT_MET,
  VIABILITY_NECESSARY_NOT_SUFFICIENT,
  auditPartitionViability,
  describeViabilityBreaches,
  describeViabilityInventory,
} from "../viability-preflight.ts";
import { CommandError, readTextFile } from "./io.ts";

export interface PreflightViabilityOptions {
  datasetDirectory: string;
}

export async function runPreflightViability(
  options: PreflightViabilityOptions,
): Promise<string> {
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );
  const report = auditPartitionViability(records);
  if (!report.passed) {
    throw new CommandError(
      PARTITION_VIABILITY_NOT_MET,
      "the stamped corpus cannot realise the pre-registered partition fractions: " +
        describeViabilityBreaches(report),
    );
  }
  return `${describeViabilityInventory(report)}. ${VIABILITY_NECESSARY_NOT_SUFFICIENT}`;
}
