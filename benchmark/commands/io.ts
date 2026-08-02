// Shared, fail-closed filesystem helpers for the seven benchmark subcommands.
// Every scientific write goes through a temporary file in the same directory,
// is fsynced, then atomically renamed into place, so a crashed command never
// leaves a half-written artifact behind. Reads are strict: a missing file or
// malformed JSON is a hard, coded failure — never a silent default.
//
// Standalone benchmark support module: MUST NOT import from the extension bundle
// (src/). Node-only (node:fs). Deterministic: no Date, no randomness in any
// bytes it writes; temp-file names use pid/counter only.

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
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
 * Writes a SET of files so the last entry cannot appear before the others.
 *
 * `writeFileAtomic` makes each file atomic on its own, which is not the same promise:
 * a command that writes six files one at a time and fails on the fourth leaves three
 * complete files behind, and if the first of them was the manifest describing all six,
 * the directory reads as a finished output. Here every payload is written and fsynced
 * to its temporary file FIRST, and only then are they renamed into place in the order
 * given — so the caller puts the file that certifies the set last, and its presence
 * means the rest is already there.
 *
 * What this still does not promise, because a rename sequence is not one operation: a
 * crash between renames can leave earlier files published without the final one. That
 * direction is the recoverable one — the certifying file is absent, so nothing reads
 * the output as complete.
 */
export async function writeFileSetAtomic(
  entries: readonly { path: string; content: string }[],
): Promise<void> {
  // The last entry is the certifier, and on a RE-RUN one may already be on disk from a
  // previous run. Publishing the new set around a surviving old certifier is the worst
  // outcome available: a failure part-way through leaves the old file vouching for a
  // mixture of old and new partitions. So it is unlinked FIRST — the directory then has
  // no certifier at all until the new one lands, which is the recoverable state.
  const certifier = entries.at(-1);
  if (certifier !== undefined) {
    await rm(certifier.path, { force: true });
  }

  const staged: { tempPath: string; path: string }[] = [];
  for (const entry of entries) {
    const directory = dirname(entry.path);
    await mkdir(directory, { recursive: true });
    tempCounter += 1;
    const tempPath = join(directory, `.${process.pid}.${tempCounter}.tmp`);
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(entry.content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    staged.push({ tempPath, path: entry.path });
  }
  for (const { tempPath, path } of staged) {
    await rename(tempPath, path);
  }
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
