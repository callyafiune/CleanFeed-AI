#!/usr/bin/env node
// Proves the extension build is reproducible.
//
//   node scripts/verify-reproducible-build.mjs
//
// Runs TWO clean `npm run build`s, snapshotting `dist` into two throwaway temp
// directories, then compares the file-name sets and the SHA-256 of every file.
// Only KNOWN bundle timestamps are normalized before hashing (see NORMALIZERS);
// content-hashed chunk names make the output otherwise deterministic. Exits 0
// when the two builds are byte-identical (after normalization); exits 1 with a
// diff summary otherwise.
//
// Safety: it only ever creates and (at the end) removes its own temp dirs. It
// never deletes `dist`, the repo, or anything outside the verified temp dirs.

import { Buffer } from "node:buffer";
import { execSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { exit } from "node:process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(repoRoot, "dist");

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".css",
  ".json",
  ".map",
  ".txt",
]);

/**
 * KNOWN bundle-timestamp normalizers, applied to TEXT files before hashing so a
 * mere build-time stamp never registers as non-determinism. Kept intentionally
 * narrow: an ISO-8601 timestamp and a numeric epoch stamp under an obvious
 * build/time key. Real chunk contents (hashed into their file names) are never
 * touched by these.
 */
const NORMALIZERS = [
  {
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu,
    replacement: "<TIMESTAMP>",
  },
  {
    pattern: /("(?:buildTime|build_time|timestamp|builtAt)"\s*:\s*)\d{10,}/gu,
    replacement: "$1<TIMESTAMP>",
  },
];

function toPosix(path) {
  return path.split("\\").join("/");
}

function listFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function normalizeText(text) {
  return NORMALIZERS.reduce(
    (accumulator, { pattern, replacement }) =>
      accumulator.replace(pattern, replacement),
    text,
  );
}

/** Maps every dist-relative path to a normalized SHA-256 of its contents. */
function hashTree(root) {
  const hashes = new Map();
  for (const absolute of listFiles(root)) {
    const rel = toPosix(relative(root, absolute));
    const dot = rel.lastIndexOf(".");
    const extension = dot === -1 ? "" : rel.slice(dot).toLowerCase();
    const raw = readFileSync(absolute);
    const input = TEXT_EXTENSIONS.has(extension)
      ? Buffer.from(normalizeText(raw.toString("utf8")), "utf8")
      : raw;
    hashes.set(rel, createHash("sha256").update(input).digest("hex"));
  }
  return hashes;
}

function build() {
  execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
  if (!statSync(DIST).isDirectory()) {
    throw new Error("build did not produce a dist/ directory");
  }
}

function snapshot(label) {
  const dir = mkdtempSync(join(tmpdir(), `cleanfeed-repro-${label}-`));
  cpSync(DIST, dir, { recursive: true });
  return dir;
}

function diff(first, second) {
  const problems = [];
  const names = new Set([...first.keys(), ...second.keys()]);
  for (const name of [...names].sort()) {
    const a = first.get(name);
    const b = second.get(name);
    if (a === undefined) problems.push(`only in build #2: ${name}`);
    else if (b === undefined) problems.push(`only in build #1: ${name}`);
    else if (a !== b) problems.push(`content differs: ${name}`);
  }
  return problems;
}

function main() {
  const temps = [];
  try {
    console.log("reproducible build — running build #1 ...");
    build();
    temps.push(snapshot("a"));

    console.log("reproducible build — running build #2 ...");
    build();
    temps.push(snapshot("b"));

    const problems = diff(hashTree(temps[0]), hashTree(temps[1]));
    if (problems.length > 0) {
      console.error(
        `reproducible build FAILED — ${problems.length} difference(s):`,
      );
      for (const problem of problems) console.error(`  - ${problem}`);
      exit(1);
    }

    const count = hashTree(temps[0]).size;
    console.log(
      `reproducible build OK — ${count} file(s) identical across two clean builds.`,
    );
    exit(0);
  } finally {
    for (const dir of temps) {
      // Only ever remove our own temp snapshots.
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

main();
