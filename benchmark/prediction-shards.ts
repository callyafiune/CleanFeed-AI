// The deterministic, resumable prediction shard store. Each shard owns exactly
// 100 ordered ids (only the last may be short), is written through a
// same-directory temp file that is fsynced then renamed, and holds exactly one
// row per id. A row carries ONLY the opaque id and the scoring outcome — never
// text, spans, author/source, url, prompt or a content hash. Resume is admitted
// only when the persisted `BrowserScoreRun` is byte-identical to the current one,
// and `finalize` runs the Phase 2 strict completeness validator before sealing
// the `PredictionManifestV1`.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-only (node:fs). Deterministic: `createdAt` is an explicit argument; the
// only randomness is in throwaway temp-file names.

import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.ts";
import type {
  BrowserScoreRun,
  PredictionShardStore,
} from "./browser-scorer.ts";
import {
  assertPredictionCompleteness,
  parsePredictionManifest,
  parsePredictions,
  validatePredictionRow,
  validatePredictionShards,
  type PredictionManifestV1,
  type PredictionShardDescriptor,
  type StrictPredictionV2,
} from "./prediction-schema.ts";

const SHARD_SIZE = 100;
const RUN_SIDECAR = "browser-score-run.json";
const MANIFEST_FILE = "prediction-manifest.json";
const SHARD_PATTERN = /^(\d{6})\.jsonl$/u;

// Keys that must NEVER appear in a serialized prediction row. The closed row
// parser already rejects unknown keys, but this guard fails first with an
// explicit, auditable message so a leak is impossible to miss.
const FORBIDDEN_ROW_KEYS = new Set([
  "text",
  "normalizedText",
  "normalizedTextSha256",
  "span",
  "spans",
  "author",
  "source",
  "groups",
  "url",
  "link",
  "prompt",
  "promptId",
  "promptSha256",
  "contentHash",
  "hash",
  "label",
]);

export interface PredictionShardStoreOptions {
  directory: string;
  createdAt: string;
}

/** Coded, fail-closed error thrown by every shard-store guard. */
export class PredictionShardError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "PredictionShardError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PredictionShardError(code, message);
}

function shardFileName(index: number): string {
  return `${String(index).padStart(6, "0")}.jsonl`;
}

interface LoadedShard {
  descriptor: PredictionShardDescriptor;
  ids: string[];
}

let tempCounter = 0;

class FilePredictionShardStore implements PredictionShardStore {
  private run: BrowserScoreRun | null = null;
  private readonly shards = new Map<number, LoadedShard>();

  constructor(private readonly options: PredictionShardStoreOptions) {}

  async open(run: BrowserScoreRun): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    const sidecarPath = join(this.options.directory, RUN_SIDECAR);
    const existing = await readOptionalJson(sidecarPath);
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(run)) {
        fail(
          "SHARD_RUN_MISMATCH",
          "resume requires a byte-identical BrowserScoreRun (including the full four-part chrome version)",
        );
      }
    } else {
      await this.writeAtomicFile(
        sidecarPath,
        `${JSON.stringify(run, null, 2)}\n`,
      );
    }
    this.run = run;
    await this.loadExistingShards();
  }

  completedIds(): Promise<ReadonlySet<string>> {
    const ids = new Set<string>();
    for (const shard of this.shards.values()) {
      for (const id of shard.ids) ids.add(id);
    }
    return Promise.resolve(ids);
  }

  async writeAtomic(
    index: number,
    rows: readonly StrictPredictionV2[],
  ): Promise<void> {
    if (this.run === null) {
      fail(
        "SHARD_STORE_NOT_OPEN",
        "open() must be called before writeAtomic()",
      );
    }
    if (!Number.isInteger(index) || index < 0) {
      fail(
        "SHARD_INDEX_INVALID",
        `shard index must be a non-negative integer, got ${index}`,
      );
    }
    if (rows.length > SHARD_SIZE) {
      fail(
        "SHARD_TOO_LARGE",
        `a shard holds at most ${SHARD_SIZE} rows, got ${rows.length}`,
      );
    }
    const seen = new Set<string>();
    const validated: StrictPredictionV2[] = [];
    for (const row of rows) {
      assertNoForbiddenKeys(row);
      const parsed = validatePredictionRow(row);
      if (seen.has(parsed.id)) {
        fail(
          "SHARD_DUPLICATE_ID",
          `duplicate id ${parsed.id} within shard ${index}`,
        );
      }
      seen.add(parsed.id);
      validated.push(parsed);
    }
    const body = `${validated.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const file = shardFileName(index);
    await this.writeAtomicFile(join(this.options.directory, file), body);
    this.shards.set(index, {
      descriptor: {
        index,
        file,
        sha256: sha256Hex(body),
        recordCount: validated.length,
      },
      ids: validated.map((row) => row.id),
    });
  }

  async finalize(
    expectedIds: readonly string[],
  ): Promise<PredictionManifestV1> {
    if (this.run === null) {
      fail("SHARD_STORE_NOT_OPEN", "open() must be called before finalize()");
    }
    const run = this.run;
    const ordered = [...this.shards.values()].sort(
      (left, right) => left.descriptor.index - right.descriptor.index,
    );
    const seen = new Set<string>();
    const rowIds: { id: string }[] = [];
    for (const shard of ordered) {
      for (const id of shard.ids) {
        if (seen.has(id)) {
          fail(
            "SHARD_DUPLICATE_ID",
            `duplicate prediction id ${id} across shards`,
          );
        }
        seen.add(id);
        rowIds.push({ id });
      }
    }
    assertPredictionCompleteness(expectedIds, rowIds);

    const shards = ordered.map((shard) => shard.descriptor);
    const manifest: PredictionManifestV1 = {
      schemaVersion: 1,
      modelId: run.modelId,
      modelVersion: run.modelVersion,
      bundleDigest: run.bundleDigest,
      aggregationVersion: run.aggregationVersion,
      contentCompositionVersion: run.contentCompositionVersion,
      tokenizerDigest: run.tokenizerDigest,
      runtimeParityDigest: run.runtimeParityDigest,
      extensionBuildDigest: run.extensionBuildDigest,
      backend: run.backend,
      chromeVersion: run.chromeVersion,
      datasetDigest: run.datasetDigest,
      splitDigest: run.splitDigest,
      partition: run.partition,
      shardSize: SHARD_SIZE,
      shardCount: shards.length,
      shards,
      holdoutConsumptionId: run.holdoutConsumptionId,
      createdAt: this.options.createdAt,
    };
    validatePredictionShards(manifest);
    // Re-parse through the closed contract so the sealed manifest can never drift.
    const sealed = parsePredictionManifest(manifest, {
      scientificUse: "release",
    });
    await this.writeAtomicFile(
      join(this.options.directory, MANIFEST_FILE),
      `${JSON.stringify(sealed, null, 2)}\n`,
    );
    return sealed;
  }

  private async loadExistingShards(): Promise<void> {
    this.shards.clear();
    const entries = await readdir(this.options.directory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = SHARD_PATTERN.exec(entry.name);
      if (match === null) continue;
      const index = Number.parseInt(match[1]!, 10);
      const body = await readFile(
        join(this.options.directory, entry.name),
        "utf8",
      );
      const rows = parsePredictions(body);
      this.shards.set(index, {
        descriptor: {
          index,
          file: entry.name,
          sha256: sha256Hex(body),
          recordCount: rows.length,
        },
        ids: rows.map((row) => row.id),
      });
    }
  }

  private async writeAtomicFile(path: string, content: string): Promise<void> {
    tempCounter += 1;
    const tempPath = join(
      this.options.directory,
      `.${process.pid}.${tempCounter}.tmp`,
    );
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
  }
}

/** Creates a file-backed prediction shard store for one scoring run. */
export function createPredictionShardStore(
  options: PredictionShardStoreOptions,
): PredictionShardStore {
  return new FilePredictionShardStore(options);
}

function assertNoForbiddenKeys(row: unknown): void {
  if (typeof row !== "object" || row === null) {
    return;
  }
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_ROW_KEYS.has(key)) {
      fail(
        "SHARD_FORBIDDEN_FIELD",
        `prediction rows must never serialize the forbidden field "${key}"`,
      );
    }
  }
}

async function readOptionalJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw);
}

function sha256Hex(content: string): string {
  return createHash("sha256")
    .update(new TextEncoder().encode(content))
    .digest("hex");
}
