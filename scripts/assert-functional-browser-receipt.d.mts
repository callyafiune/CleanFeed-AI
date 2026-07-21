export interface FunctionalBrowserReceipt {
  schemaVersion: 1;
  browserKind: "playwright-bundled-chromium";
  channel: "chromium";
  browserVersion: string;
  playwrightVersion: string;
  chromiumRevision: string;
}

export interface FunctionalBrowserLock {
  playwrightVersion: string;
  chromiumRevision: string;
}

export declare class FunctionalBrowserReceiptError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare function assertFunctionalBrowserReceipt(
  value: unknown,
  lock?: FunctionalBrowserLock,
): asserts value is FunctionalBrowserReceipt;

export declare function readFunctionalBrowserLock(): FunctionalBrowserLock;
