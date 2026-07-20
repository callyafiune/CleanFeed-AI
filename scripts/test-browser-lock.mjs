// Owns the single, CLOSED lock for the pinned Chrome for Testing Stable build the
// scientific scoring and performance lanes use. The lock file `tests/browser-lock.json`
// is the source of truth; this module parses it fail-closed (rejecting any unknown
// key, a wrong product/channel or a drifted version), installs the pinned build id
// EXPLICITLY into a local cache, and resolves an executable path whose reported
// version must be the exact four-part lock version — never system Chrome, never the
// Playwright-bundled Chromium.
//
//   node scripts/test-browser-lock.mjs install --lock tests/browser-lock.json
//
// The `@puppeteer/browsers` dependency is imported LAZILY (dynamic import) so that
// the pure parser and the version check run without the package installed, and so
// tests can inject a fake `browsersModule`. Everything fails closed: a missing
// path, malformed JSON, an unknown key, or a version drift throws a coded
// TestBrowserLockError rather than silently falling back.

import console from "node:console";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** The pinned Chrome for Testing Stable build. Any drift is rejected. */
const PINNED_VERSION = "150.0.7871.129";
const PINNED_PRODUCT = "chrome";
const PINNED_CHANNEL = "stable";

const LOCK_KEYS = ["schemaVersion", "product", "channel", "version"];
const FOUR_PART_VERSION = /(\d+\.\d+\.\d+\.\d+)/u;

/** The frozen closed lock this module enforces. */
export const LOCKED_TEST_BROWSER = Object.freeze({
  product: PINNED_PRODUCT,
  channel: PINNED_CHANNEL,
  version: PINNED_VERSION,
});

/** A coded, fail-closed error every guard in this module throws. */
export class TestBrowserLockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TestBrowserLockError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TestBrowserLockError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultLockPath() {
  return join(repoRoot(), "tests", "browser-lock.json");
}

function defaultCacheDir() {
  return join(repoRoot(), ".cache", "chrome-for-testing");
}

/** Closed parser for the browser lock. Rejects any drift. */
export function readTestBrowserLock(value) {
  if (!isPlainObject(value)) {
    fail("TEST_BROWSER_LOCK_INVALID", "browser lock must be an object");
  }
  const allowed = new Set(LOCK_KEYS);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("TEST_BROWSER_LOCK_INVALID", `unknown key "${key}" in browser lock`);
    }
  }
  for (const key of LOCK_KEYS) {
    if (!Object.hasOwn(value, key)) {
      fail("TEST_BROWSER_LOCK_INVALID", `browser lock is missing key "${key}"`);
    }
  }
  if (value.schemaVersion !== 1) {
    fail("TEST_BROWSER_LOCK_INVALID", "schemaVersion must be 1");
  }
  if (value.product !== PINNED_PRODUCT) {
    fail("TEST_BROWSER_LOCK_PRODUCT", `product must be "${PINNED_PRODUCT}"`);
  }
  if (value.channel !== PINNED_CHANNEL) {
    fail("TEST_BROWSER_LOCK_CHANNEL", `channel must be "${PINNED_CHANNEL}"`);
  }
  if (value.version !== PINNED_VERSION) {
    fail(
      "TEST_BROWSER_LOCK_VERSION_DRIFT",
      `version must be the pinned ${PINNED_VERSION}, got "${value.version}"`,
    );
  }
  return {
    schemaVersion: 1,
    product: PINNED_PRODUCT,
    channel: PINNED_CHANNEL,
    version: PINNED_VERSION,
  };
}

/** Reads and closed-parses the committed lock file (defaults to tests/browser-lock.json). */
export async function loadTestBrowserLock(lockPath) {
  const path = lockPath ?? defaultLockPath();
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    fail("TEST_BROWSER_LOCK_UNREADABLE", `cannot read browser lock: ${error}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(
      "TEST_BROWSER_LOCK_INVALID_JSON",
      `browser lock is not valid JSON: ${error}`,
    );
  }
  return readTestBrowserLock(parsed);
}

/**
 * Asserts a reported browser version (bare or `Chrome/<version>`) is EXACTLY the
 * pinned four-part lock version. A truncated or drifted version fails closed.
 */
export function assertLockedBrowserVersion(reported, lock) {
  const match =
    typeof reported === "string" ? FOUR_PART_VERSION.exec(reported) : null;
  const version = match?.[1] ?? null;
  if (version !== lock.version) {
    fail(
      "TEST_BROWSER_VERSION_MISMATCH",
      `resolved browser version "${reported}" is not the pinned ${lock.version}`,
    );
  }
  return lock.version;
}

async function loadBrowsersModule(options) {
  if (options.browsersModule !== undefined) {
    return options.browsersModule;
  }
  // Resolved lazily at real Node runtime only; tests always inject a module, so
  // the pinned @puppeteer/browsers package is never required to load this file.
  // The @vite-ignore keeps the Vitest/Vite import analyzer from eagerly resolving it.
  const packageName = "@puppeteer/browsers";
  return import(/* @vite-ignore */ packageName);
}

/**
 * Installs the pinned build id EXPLICITLY into the local cache and returns its
 * executable path. Local/cache-only; it never reaches out during scoring.
 */
export async function installLockedTestBrowser(lock, options = {}) {
  const browsers = await loadBrowsersModule(options);
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const installed = await browsers.install({
    browser: "chrome",
    buildId: lock.version,
    cacheDir,
  });
  return (
    installed?.executablePath ??
    browsers.computeExecutablePath({
      browser: "chrome",
      buildId: lock.version,
      cacheDir,
    })
  );
}

/**
 * Resolves the locked Chrome for Testing executable path from the local cache
 * WITHOUT any network access; the caller launches it and then verifies the
 * reported version with {@link assertLockedBrowserVersion}.
 */
export async function resolveLockedTestBrowser(lock, options = {}) {
  const browsers = await loadBrowsersModule(options);
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const executablePath = browsers.computeExecutablePath({
    browser: "chrome",
    buildId: lock.version,
    cacheDir,
  });
  return { executablePath, version: lock.version };
}

function parseInstallArgs(args) {
  if (args.length === 0 || args[0] !== "install") {
    fail("UNKNOWN_SUBCOMMAND", 'the only supported subcommand is "install"');
  }
  let lockPath;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--lock") {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", "--lock needs a value");
      lockPath = value;
      index += 1;
    } else {
      fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
    }
  }
  return { command: "install", lockPath };
}

async function runCli(args) {
  const cli = parseInstallArgs(args);
  const lock = await loadTestBrowserLock(cli.lockPath);
  const executablePath = await installLockedTestBrowser(lock);
  console.log(
    `test-browser-lock: installed ${lock.version} -> ${executablePath}`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli(argv.slice(2))
    .then(() => exit(0))
    .catch((error) => {
      console.error(
        `test-browser-lock FAILED: ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
