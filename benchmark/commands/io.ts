// Shared, fail-closed filesystem helpers for the seven benchmark subcommands.
// Every scientific write goes through a temporary file in the same directory,
// is fsynced, then atomically renamed into place, so a crashed command never
// leaves a half-written artifact behind. Reads are strict: a missing file or
// malformed JSON is a hard, coded failure — never a silent default.
//
// Standalone benchmark support module: MUST NOT import from the extension bundle
// (src/). Node-only (node:fs). Deterministic: no Date, no randomness in any
// bytes it writes; temp-file names use pid/counter only.

import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256BytesHex } from "../digests.ts";
import {
  parsePredictionManifest,
  parsePredictions,
  validatePredictionShards,
  type ParsePredictionManifestOptions,
  type PredictionManifestV1,
  type StrictPredictionV2,
} from "../prediction-schema.ts";

/** Coded, fail-closed error raised by a subcommand. */
export class CommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

let tempCounter = 0;

/** Reads a UTF-8 file, mapping a missing file to a coded command failure. */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CommandError(
        "FILE_MISSING",
        `required file is missing: ${path}`,
      );
    }
    throw error;
  }
}

/** Reads and parses a JSON file with strict, coded failures. */
export async function readJsonFile(path: string): Promise<unknown> {
  const text = await readTextFile(path);
  try {
    return JSON.parse(text);
  } catch {
    throw new CommandError("JSON_INVALID", `file is not valid JSON: ${path}`);
  }
}

/** SHA-256 (lowercase hex) of a file's raw bytes. */
export async function sha256OfFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return sha256BytesHex(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
}

/** SHA-256 (lowercase hex) of a UTF-8 string. */
export function sha256OfText(text: string): string {
  return sha256BytesHex(new TextEncoder().encode(text));
}

/** Atomically writes text: temp file in the same directory, fsync, rename. */
export async function writeFileAtomic(
  path: string,
  content: string,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
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

/** Atomically writes a value as pretty JSON with a trailing newline. */
export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Reads a sharded prediction artifact (`<dir>/manifest.json` plus its shard
 * files): parses the closed manifest, verifies the declared shard structure,
 * confirms every shard's sha256 against the real bytes, and parses the
 * concatenated rows. Any drift is a hard, coded failure.
 */
export async function readPredictionArtifact(
  directory: string,
  options: ParsePredictionManifestOptions = {},
): Promise<{
  manifest: PredictionManifestV1;
  predictions: StrictPredictionV2[];
}> {
  const manifest = parsePredictionManifest(
    await readJsonFile(join(directory, "manifest.json")),
    options,
  );
  validatePredictionShards(manifest);
  let body = "";
  for (const shard of manifest.shards) {
    const shardPath = join(directory, shard.file);
    const observed = await sha256OfFile(shardPath);
    if (observed !== shard.sha256) {
      throw new CommandError(
        "SHARD_DIGEST_MISMATCH",
        `shard ${shard.file} digest does not match the manifest`,
      );
    }
    body += await readTextFile(shardPath);
    if (!body.endsWith("\n")) body += "\n";
  }
  return { manifest, predictions: parsePredictions(body) };
}
