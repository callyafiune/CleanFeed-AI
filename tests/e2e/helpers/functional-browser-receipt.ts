import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { BrowserContext } from "@playwright/test";

/**
 * The technical receipt proving WHICH browser the functional MV3 lane ran on.
 * It is deliberately NOT the scientific Chrome-for-Testing lock: it identifies
 * the Playwright-bundled Chromium (`channel: "chromium"`), by its full
 * four-component version, the Playwright package version that shipped it and the
 * Chromium revision that package pins. It never records an executable path, a
 * user-data profile or a hostname, so it can be uploaded as a plain artifact.
 */
export interface FunctionalBrowserReceipt {
  readonly schemaVersion: 1;
  /** The one accepted kind. A `chrome-stable`/`chrome-for-testing` label fails. */
  readonly browserKind: "playwright-bundled-chromium";
  readonly channel: "chromium";
  /** Full four-component Chromium version, e.g. `140.0.7259.5`. */
  readonly browserVersion: string;
  /** The Playwright package version that shipped this Chromium, e.g. `1.61.1`. */
  readonly playwrightVersion: string;
  /** The Chromium revision that Playwright package pins, e.g. `1228`. */
  readonly chromiumRevision: string;
}

/** The local lock the receipt is cross-checked against (from the installed pkg). */
export interface FunctionalBrowserLock {
  readonly playwrightVersion: string;
  readonly chromiumRevision: string;
}

const RECEIPT_KEYS: readonly (keyof FunctionalBrowserReceipt)[] = [
  "schemaVersion",
  "browserKind",
  "channel",
  "browserVersion",
  "playwrightVersion",
  "chromiumRevision",
];

const FOUR_COMPONENT_VERSION = /^\d+\.\d+\.\d+\.\d+$/u;
const PLAYWRIGHT_1_61 = /^1\.61\.\d+$/u;
const REVISION = /^\d+$/u;

/** Coded, fail-closed error thrown by the receipt parser. */
export class FunctionalBrowserReceiptError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FunctionalBrowserReceiptError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FunctionalBrowserReceiptError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The closed parser reused by the E2E writer and (re-implemented byte-for-byte)
 * by the CI asserter. It rejects unknown keys, a partial version, the wrong
 * channel/kind and, when a lock is supplied, a Playwright/revision that does not
 * match the local install. A `chrome-stable` or `chrome-for-testing` label can
 * never satisfy the exact `browserKind`/`channel` literals.
 */
export function assertFunctionalBrowserReceipt(
  value: unknown,
  lock?: FunctionalBrowserLock,
): asserts value is FunctionalBrowserReceipt {
  if (!isPlainObject(value)) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt must be an object");
  }
  const keys = Object.keys(value);
  if (keys.length !== RECEIPT_KEYS.length) {
    fail(
      "RECEIPT_SCHEMA_INVALID",
      `receipt must have exactly ${RECEIPT_KEYS.length} keys`,
    );
  }
  for (const key of RECEIPT_KEYS) {
    if (!Object.hasOwn(value, key)) {
      fail("RECEIPT_SCHEMA_INVALID", `receipt is missing key "${key}"`);
    }
  }
  if (value.schemaVersion !== 1) {
    fail("RECEIPT_FIELD_INVALID", "schemaVersion must be 1");
  }
  if (value.browserKind !== "playwright-bundled-chromium") {
    fail(
      "RECEIPT_BROWSER_KIND_INVALID",
      'browserKind must be "playwright-bundled-chromium"',
    );
  }
  if (value.channel !== "chromium") {
    fail("RECEIPT_CHANNEL_INVALID", 'channel must be "chromium"');
  }
  if (
    typeof value.browserVersion !== "string" ||
    !FOUR_COMPONENT_VERSION.test(value.browserVersion)
  ) {
    fail(
      "RECEIPT_VERSION_INVALID",
      "browserVersion must be a full four-component version",
    );
  }
  if (
    typeof value.playwrightVersion !== "string" ||
    !PLAYWRIGHT_1_61.test(value.playwrightVersion)
  ) {
    fail("RECEIPT_PLAYWRIGHT_INVALID", "playwrightVersion must be 1.61.x");
  }
  if (
    typeof value.chromiumRevision !== "string" ||
    !REVISION.test(value.chromiumRevision)
  ) {
    fail(
      "RECEIPT_REVISION_INVALID",
      "chromiumRevision must be a numeric string",
    );
  }
  if (lock !== undefined) {
    if (value.playwrightVersion !== lock.playwrightVersion) {
      fail(
        "RECEIPT_PLAYWRIGHT_MISMATCH",
        `playwrightVersion ${value.playwrightVersion} != lock ${lock.playwrightVersion}`,
      );
    }
    if (value.chromiumRevision !== lock.chromiumRevision) {
      fail(
        "RECEIPT_REVISION_MISMATCH",
        `chromiumRevision ${value.chromiumRevision} != lock ${lock.chromiumRevision}`,
      );
    }
  }
}

/** Reads the Playwright version + pinned Chromium revision from the install. */
export function readFunctionalBrowserLock(): FunctionalBrowserLock {
  const require = createRequire(import.meta.url);
  const playwrightVersion = (
    JSON.parse(
      readFileSync(require.resolve("playwright/package.json"), "utf8"),
    ) as {
      version: string;
    }
  ).version;
  const coreDir = dirname(require.resolve("playwright-core/package.json"));
  const browsers = JSON.parse(
    readFileSync(join(coreDir, "browsers.json"), "utf8"),
  ) as { browsers: { name: string; revision: string }[] };
  const chromium = browsers.browsers.find((entry) => entry.name === "chromium");
  if (chromium === undefined) {
    fail("LOCK_UNRESOLVED", "playwright browsers.json has no chromium entry");
  }
  return { playwrightVersion, chromiumRevision: String(chromium.revision) };
}

/**
 * Builds the receipt from a launched context. It reads the browser version from
 * the live browser and the Playwright/revision facts from the local install,
 * then self-validates before returning — a malformed environment fails closed.
 */
export function buildFunctionalBrowserReceipt(
  context: BrowserContext,
): FunctionalBrowserReceipt {
  const browser = context.browser();
  if (browser === null) {
    fail(
      "BROWSER_UNAVAILABLE",
      "context has no backing browser to fingerprint",
    );
  }
  const lock = readFunctionalBrowserLock();
  const receipt: FunctionalBrowserReceipt = {
    schemaVersion: 1,
    browserKind: "playwright-bundled-chromium",
    channel: "chromium",
    browserVersion: browser.version(),
    playwrightVersion: lock.playwrightVersion,
    chromiumRevision: lock.chromiumRevision,
  };
  assertFunctionalBrowserReceipt(receipt, lock);
  return receipt;
}

/** Canonical (key-sorted, compact) JSON for the flat receipt. */
function canonicalReceiptJson(receipt: FunctionalBrowserReceipt): string {
  const ordered: Record<string, unknown> = {};
  for (const key of [...RECEIPT_KEYS].sort()) {
    ordered[key] = receipt[key];
  }
  return JSON.stringify(ordered);
}

/** Atomically writes the canonical receipt JSON to `outputPath`. */
export function writeFunctionalBrowserReceipt(
  receipt: FunctionalBrowserReceipt,
  outputPath: string,
): void {
  assertFunctionalBrowserReceipt(receipt, readFunctionalBrowserLock());
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = join(
    dirname(outputPath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  writeFileSync(temporary, `${canonicalReceiptJson(receipt)}\n`);
  renameSync(temporary, outputPath);
}
