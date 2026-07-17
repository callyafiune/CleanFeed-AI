#!/usr/bin/env node
// Dependency-free relative-link checker for the project docs.
//
// Scans README.md, every Markdown file under docs/, and benchmark/README.md for
// inline Markdown links ([text](target)) whose target is a relative path, and
// fails (exit 1) if any target file does not exist on disk. External links
// (http(s), protocol-relative, mailto/tel) and pure in-page anchors (#section)
// are ignored; a fragment or query on a relative link is stripped before the
// file is checked. No third-party dependencies: only node: built-ins.

import console from "node:console";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Inline links `[text](target "title")`, tolerating a double-, single- or
 * parenthesis-quoted title after the target.
 */
const INLINE_LINK_PATTERN =
  /\[[^\]]*\]\(\s*([^)\s]+?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** Reference-style definitions `[label]: target "title"` at line start. */
const REFERENCE_LINK_PATTERN = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(\S+)/gm;

const LINK_PATTERNS = [INLINE_LINK_PATTERN, REFERENCE_LINK_PATTERN];

/** Strips angle brackets some Markdown allows around a link target. */
const unwrap = (target) =>
  target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;

/** Targets we never resolve to a file on disk. */
const isExternal = (target) =>
  /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:|tel:)/i.test(target);

/** Recursively collect Markdown files under a directory. */
function markdownFilesUnder(directory) {
  const absolute = join(repoRoot, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true })
    .map((entry) => join(absolute, entry.toString()))
    .filter((path) => path.endsWith(".md") && statSync(path).isFile());
}

const filesToScan = [
  join(repoRoot, "README.md"),
  ...markdownFilesUnder("docs"),
  join(repoRoot, "benchmark", "README.md"),
].filter((path) => existsSync(path));

const problems = [];
let linkCount = 0;

for (const file of filesToScan) {
  const content = readFileSync(file, "utf8");
  const fileDir = dirname(file);
  for (const pattern of LINK_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const rawTarget = unwrap(match[1]);
      if (isExternal(rawTarget)) continue;
      linkCount += 1;
      const withoutFragment = rawTarget.split("#")[0].split("?")[0];
      if (withoutFragment.length === 0) continue; // was a pure fragment
      const resolved = resolve(fileDir, decodeURIComponent(withoutFragment));
      if (!existsSync(resolved)) {
        problems.push({ file, target: rawTarget, resolved });
      }
    }
  }
}

const relative = (absolute) => absolute.slice(repoRoot.length + 1) || absolute;

if (problems.length > 0) {
  console.error(
    `docs:check FAILED — ${problems.length} broken relative link(s):`,
  );
  for (const problem of problems) {
    console.error(
      `  ${relative(problem.file)} -> ${problem.target} (missing: ${relative(
        problem.resolved,
      )})`,
    );
  }
  exit(1);
}

console.log(
  `docs:check OK — ${linkCount} relative link(s) across ${filesToScan.length} file(s) resolve.`,
);
