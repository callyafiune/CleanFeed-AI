// `ingest`: materialize the canonical Phase 2 dataset directory from authorized
// local inputs. It is a thin CLI wrapper over `ingestAuthorizedRecords`: it never
// seals or splits (that is `validate`/`split`) and never collects data. It exits
// non-zero unless EVERY record was accepted, so a single rejected record blocks
// the corpus. Reported rejections carry only a line number and a code — never a
// text excerpt, url, author or prompt.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import {
  ingestAuthorizedRecords,
  type IngestRequest,
} from "../corpus-import.ts";
import { CommandError } from "./io.ts";

export interface IngestOptions {
  inputRecordsPath: string;
  reviewLedgerPath: string;
  sourceManifestPath: string;
  datasetManifestTemplatePath: string;
  datasetDirectory: string;
}

const EXPECTED_DATASET_ID = "ptbr-linkedin-v1" as const;

export async function runIngest(options: IngestOptions): Promise<string> {
  const request: IngestRequest = {
    inputRecordsPath: options.inputRecordsPath,
    inputReviewLedgerPath: options.reviewLedgerPath,
    inputSourceManifestPath: options.sourceManifestPath,
    inputDatasetManifestTemplatePath: options.datasetManifestTemplatePath,
    datasetDirectory: options.datasetDirectory,
    expectedDatasetId: EXPECTED_DATASET_ID,
  };

  const result = await ingestAuthorizedRecords(request);

  if (result.rejected.length > 0) {
    const summary = summarizeRejections(result.rejected);
    throw new CommandError(
      "INGEST_REJECTED",
      `ingest refused ${result.rejected.length} record(s); nothing was written (${summary})`,
    );
  }

  return (
    `Ingested ${result.accepted} records into ${options.datasetDirectory} ` +
    `(digest ${result.outputDigest ?? "unknown"}).`
  );
}

// Compact, privacy-preserving summary: counts per code plus the first offending
// line for each code. No text ever appears.
function summarizeRejections(
  rejected: readonly { inputLine: number; code: string }[],
): string {
  const firstLineByCode = new Map<string, number>();
  const countByCode = new Map<string, number>();
  for (const rejection of rejected) {
    countByCode.set(rejection.code, (countByCode.get(rejection.code) ?? 0) + 1);
    if (!firstLineByCode.has(rejection.code)) {
      firstLineByCode.set(rejection.code, rejection.inputLine);
    }
  }
  return [...countByCode.keys()]
    .sort()
    .map(
      (code) =>
        `${code}=${countByCode.get(code)} (first line ${firstLineByCode.get(code)})`,
    )
    .join(", ");
}
