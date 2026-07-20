export interface TestBrowserLock {
  schemaVersion: 1;
  product: "chrome";
  channel: "stable";
  version: "150.0.7871.129";
}

/** The minimal surface consumed from `@puppeteer/browsers` (injectable in tests). */
export interface BrowsersModule {
  install(options: {
    browser: string;
    buildId: string;
    cacheDir: string;
  }): Promise<{ executablePath?: string }>;
  computeExecutablePath(options: {
    browser: string;
    buildId: string;
    cacheDir: string;
  }): string;
}

export interface LockedTestBrowserOptions {
  cacheDir?: string;
  browsersModule?: BrowsersModule;
}

export interface ResolvedTestBrowser {
  executablePath: string;
  version: string;
}

export declare const LOCKED_TEST_BROWSER: {
  product: "chrome";
  channel: "stable";
  version: "150.0.7871.129";
};

export declare class TestBrowserLockError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare function readTestBrowserLock(value: unknown): TestBrowserLock;

export declare function loadTestBrowserLock(
  lockPath?: string,
): Promise<TestBrowserLock>;

export declare function assertLockedBrowserVersion(
  reported: string,
  lock: TestBrowserLock,
): string;

export declare function installLockedTestBrowser(
  lock: TestBrowserLock,
  options?: LockedTestBrowserOptions,
): Promise<string>;

export declare function resolveLockedTestBrowser(
  lock: TestBrowserLock,
  options?: LockedTestBrowserOptions,
): Promise<ResolvedTestBrowser>;
