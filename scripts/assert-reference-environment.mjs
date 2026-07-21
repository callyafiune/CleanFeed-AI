#!/usr/bin/env node
// Owns the CLOSED reference-environment facts for the release-eligible
// performance lane (mirroring tests/e2e/helpers/release-performance.ts) so CI
// can validate/produce them WITHOUT importing the Playwright helper. The pure
// `assertReferenceEnvironment` validates a facts object; the CLI additionally
// INSPECTS the machine via `os`/`process`, resolves the pinned Chrome for
// Testing from the closed lock, computes the executable SHA-256 locally and
// confirms over CDP that the launched process is that exact build. The lock
// never carries an official binary hash — the SHA is a reproducible observation
// of the installed artifact. Windows-11 / >= 4 logical CPUs / >= 8 GiB / WASM
// are required; a bundled Chromium never satisfies this lane.
//
//   node scripts/assert-reference-environment.mjs \
//     --browser-lock tests/browser-lock.json \
//     --output test-results/reference-environment.json

import console from "node:console";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

export const REFERENCE_BROWSER_KIND = "chrome-for-testing";
export const REFERENCE_BROWSER_VERSION = "150.0.7871.129";
export const REFERENCE_MINIMUM_LOGICAL_PROCESSORS = 4;
export const REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES = 8 * 1024 ** 3;
export const REFERENCE_WINDOWS_MINIMUM_BUILD = 22_000;

const ENVIRONMENT_KEYS = Object.freeze([
  "operatingSystem",
  "logicalProcessors",
  "totalMemoryBytes",
  "browserKind",
  "browserVersion",
  "browserExecutableSha256",
  "browserLockDigest",
]);

const HEX64 = /^[0-9a-f]{64}$/u;
const WINDOWS_RELEASE = /^win32 10\.0\.(\d+)$/u;

const REFERENCE_BROWSER_LOCK = Object.freeze({
  schemaVersion: 1,
  product: "chrome",
  channel: "stable",
  version: REFERENCE_BROWSER_VERSION,
});

/** Coded, fail-closed error every guard throws. */
export class ReferenceEnvironmentError extends Error {
  constructor(code, message) {
    super(`${code} — ${message}`);
    this.name = "ReferenceEnvironmentError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReferenceEnvironmentError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sortedStringify(value) {
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`)
    .join(",")}}`;
}

/** SHA-256 (hex) of the canonical JSON of the closed 4-key browser lock. */
export function referenceBrowserLockDigest() {
  return createHash("sha256")
    .update(sortedStringify(REFERENCE_BROWSER_LOCK), "utf8")
    .digest("hex");
}

/**
 * Validates the closed reference-environment facts and returns them. Shared by
 * the pure CI check and by {@link assertPerformanceReport}'s environment guard.
 */
export function assertReferenceEnvironment(
  value,
  invalidCode = "REFERENCE_ENVIRONMENT_INVALID",
) {
  if (!hasExactKeys(value, ENVIRONMENT_KEYS)) {
    fail(invalidCode, "environment must carry exactly the closed key set");
  }
  if (value.browserKind !== REFERENCE_BROWSER_KIND) {
    fail(
      "BROWSER_KIND_INVALID",
      `browserKind must be ${REFERENCE_BROWSER_KIND}`,
    );
  }
  if (value.browserVersion !== REFERENCE_BROWSER_VERSION) {
    fail(
      "BROWSER_VERSION_INVALID",
      `browserVersion must be the pinned ${REFERENCE_BROWSER_VERSION}`,
    );
  }
  const osMatch =
    typeof value.operatingSystem === "string"
      ? WINDOWS_RELEASE.exec(value.operatingSystem)
      : null;
  const build = osMatch ? Number(osMatch[1]) : Number.NaN;
  if (!Number.isFinite(build) || build < REFERENCE_WINDOWS_MINIMUM_BUILD) {
    fail(
      "OS_NOT_WINDOWS_11",
      `operatingSystem must be Windows 11 (win32 build >= ${REFERENCE_WINDOWS_MINIMUM_BUILD})`,
    );
  }
  if (
    !Number.isInteger(value.logicalProcessors) ||
    value.logicalProcessors < REFERENCE_MINIMUM_LOGICAL_PROCESSORS
  ) {
    fail(
      "INSUFFICIENT_LOGICAL_PROCESSORS",
      `logicalProcessors must be >= ${REFERENCE_MINIMUM_LOGICAL_PROCESSORS}`,
    );
  }
  if (
    !isFiniteNonNegative(value.totalMemoryBytes) ||
    value.totalMemoryBytes < REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES
  ) {
    fail(
      "INSUFFICIENT_TOTAL_MEMORY",
      `totalMemoryBytes must be >= ${REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES}`,
    );
  }
  if (
    typeof value.browserExecutableSha256 !== "string" ||
    !HEX64.test(value.browserExecutableSha256)
  ) {
    fail(
      "BROWSER_EXECUTABLE_SHA256_INVALID",
      "browserExecutableSha256 must be a 64-hex digest",
    );
  }
  if (value.browserLockDigest !== referenceBrowserLockDigest()) {
    fail(
      "BROWSER_LOCK_DIGEST_MISMATCH",
      "browserLockDigest must equal the canonical closed-lock digest",
    );
  }
  return value;
}

/**
 * Inspects the live machine + resolved pinned browser and PRODUCES the closed
 * facts. Node-only modules are imported lazily so the pure validator above stays
 * importable under Vitest/jsdom. The CDP confirmation is only reached on the
 * reference machine, where the pinned Chrome is installed.
 */
export async function inspectReferenceEnvironment(options = {}) {
  const lockModule =
    options.testBrowserLockModule ?? (await import("./test-browser-lock.mjs"));
  const lock = await lockModule.loadTestBrowserLock(options.browserLockPath);
  const { executablePath } = await lockModule.resolveLockedTestBrowser(lock);

  const readFile = options.readFileBytes ?? ((path) => readFileSync(path));
  const executableSha256 = createHash("sha256")
    .update(readFile(executablePath))
    .digest("hex");

  const facts = {
    operatingSystem: `${platform()} ${release()}`,
    logicalProcessors: cpus().length,
    totalMemoryBytes: totalmem(),
    browserKind: REFERENCE_BROWSER_KIND,
    browserVersion: lock.version,
    browserExecutableSha256: executableSha256,
    browserLockDigest: referenceBrowserLockDigest(),
  };
  return { facts: assertReferenceEnvironment(facts), executablePath };
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (isRecord(nested)) {
      const ordered = {};
      for (const key of Object.keys(nested).sort()) ordered[key] = nested[key];
      return ordered;
    }
    return nested;
  });
}

function writeCanonical(value, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = join(
    dirname(outputPath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  writeFileSync(temporary, `${canonicalJson(value)}\n`);
  renameSync(temporary, outputPath);
}

function parseCliArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    const assign = (key) => {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", `${flag} needs a value`);
      options[key] = value;
      index += 1;
    };
    if (flag === "--browser-lock") assign("browserLockPath");
    else if (flag === "--output") assign("outputPath");
    else fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  if (options.outputPath === undefined) {
    fail("MISSING_FLAG", "--output is required");
  }
  return options;
}

async function runCli() {
  const options = parseCliArgs(argv.slice(2));
  const { facts } = await inspectReferenceEnvironment({
    browserLockPath: options.browserLockPath,
  });
  writeCanonical(facts, options.outputPath);
  console.log(
    `reference environment OK — ${facts.operatingSystem}, ${facts.logicalProcessors} CPUs, ` +
      `chrome-for-testing ${facts.browserVersion}`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `reference environment FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
