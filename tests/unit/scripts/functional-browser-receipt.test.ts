import { describe, expect, it } from "vitest";

import {
  assertFunctionalBrowserReceipt,
  readFunctionalBrowserLock,
} from "../../../scripts/assert-functional-browser-receipt.mjs";

const LOCK = readFunctionalBrowserLock();

/** A well-formed receipt bound to the installed Playwright/Chromium. */
function validReceipt(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    browserKind: "playwright-bundled-chromium",
    channel: "chromium",
    browserVersion: "140.0.7259.5",
    playwrightVersion: LOCK.playwrightVersion,
    chromiumRevision: LOCK.chromiumRevision,
  };
}

/** Returns the coded error thrown by the parser, or `undefined` if none. */
function codeOf(receipt: unknown): string | undefined {
  try {
    assertFunctionalBrowserReceipt(receipt, LOCK);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("functional-browser receipt parser", () => {
  it("accepts a well-formed bundled-chromium receipt against the local lock", () => {
    expect(() =>
      assertFunctionalBrowserReceipt(validReceipt(), LOCK),
    ).not.toThrow();
  });

  it("rejects a partial (three-component) browser version", () => {
    expect(codeOf({ ...validReceipt(), browserVersion: "140.0.7259" })).toBe(
      "RECEIPT_VERSION_INVALID",
    );
  });

  it("rejects an extra field", () => {
    expect(codeOf({ ...validReceipt(), executablePath: "C:/chrome.exe" })).toBe(
      "RECEIPT_SCHEMA_INVALID",
    );
  });

  it("rejects a Chrome-for-Testing label", () => {
    expect(
      codeOf({ ...validReceipt(), browserKind: "chrome-for-testing" }),
    ).toBe("RECEIPT_BROWSER_KIND_INVALID");
  });

  it("rejects a chrome-stable channel", () => {
    expect(codeOf({ ...validReceipt(), channel: "chrome" })).toBe(
      "RECEIPT_CHANNEL_INVALID",
    );
  });

  it("rejects a Playwright version outside 1.61.x", () => {
    expect(codeOf({ ...validReceipt(), playwrightVersion: "1.60.0" })).toBe(
      "RECEIPT_PLAYWRIGHT_INVALID",
    );
  });

  it("rejects a revision that disagrees with the local lock", () => {
    expect(codeOf({ ...validReceipt(), chromiumRevision: "1" })).toBe(
      "RECEIPT_REVISION_MISMATCH",
    );
  });
});
