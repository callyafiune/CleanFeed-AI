#!/usr/bin/env node
// Re-implements the CLOSED functional-browser-receipt parser (mirroring
// tests/e2e/helpers/functional-browser-receipt.ts) so CI can validate the
// receipt WITHOUT importing the Playwright test helper. It proves the functional
// MV3 lane ran on the Playwright-bundled Chromium (`channel: "chromium"`), by its
// full four-component version, and cross-checks the Playwright version + pinned
// Chromium revision against the LOCAL install. It never accepts a `chrome-stable`
// or `chrome-for-testing` label, and it never reads an executable path.
//
//   node scripts/assert-functional-browser-receipt.mjs \
//     --receipt test-results/tmr-functional-browser.json

import console from "node:console";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "browserKind",
  "channel",
  "browserVersion",
  "playwrightVersion",
  "chromiumRevision",
]);

const FOUR_COMPONENT_VERSION = /^\d+\.\d+\.\d+\.\d+$/u;
const PLAYWRIGHT_1_61 = /^1\.61\.\d+$/u;
const REVISION = /^\d+$/u;

/** A coded, fail-closed error every guard throws. */
export class FunctionalBrowserReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FunctionalBrowserReceiptError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FunctionalBrowserReceiptError(code, message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The closed parser. Rejects unknown keys, a partial version, the wrong
 * channel/kind, and (when a lock is given) a Playwright/revision that does not
 * match the local install.
 */
export function assertFunctionalBrowserReceipt(value, lock) {
  if (!isPlainObject(value)) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt must be an object");
  }
  if (Object.keys(value).length !== RECEIPT_KEYS.length) {
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
export function readFunctionalBrowserLock() {
  const require = createRequire(import.meta.url);
  const playwrightVersion = JSON.parse(
    readFileSync(require.resolve("playwright/package.json"), "utf8"),
  ).version;
  const coreDir = dirname(require.resolve("playwright-core/package.json"));
  const browsers = JSON.parse(
    readFileSync(join(coreDir, "browsers.json"), "utf8"),
  );
  const chromium = browsers.browsers.find((entry) => entry.name === "chromium");
  if (chromium === undefined) {
    fail("LOCK_UNRESOLVED", "playwright browsers.json has no chromium entry");
  }
  return { playwrightVersion, chromiumRevision: String(chromium.revision) };
}

function parseCliArgs(args) {
  let receiptPath;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--receipt") {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", "--receipt needs a value");
      receiptPath = value;
      index += 1;
    } else {
      fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
    }
  }
  if (receiptPath === undefined) {
    fail("MISSING_FLAG", "--receipt is required");
  }
  return { receiptPath };
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { receiptPath } = parseCliArgs(argv.slice(2));
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assertFunctionalBrowserReceipt(receipt, readFunctionalBrowserLock());
    console.log(
      `functional-browser receipt OK — chromium ${receipt.browserVersion} ` +
        `(playwright ${receipt.playwrightVersion}, revision ${receipt.chromiumRevision})`,
    );
    exit(0);
  } catch (error) {
    console.error(
      `functional-browser receipt FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  }
}
