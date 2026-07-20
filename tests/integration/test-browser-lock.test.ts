import { describe, expect, it, vi } from "vitest";

import {
  assertLockedBrowserVersion,
  installLockedTestBrowser,
  loadTestBrowserLock,
  readTestBrowserLock,
  resolveLockedTestBrowser,
  type BrowsersModule,
  type TestBrowserLock,
} from "../../scripts/test-browser-lock.mjs";

const CLOSED_LOCK = {
  schemaVersion: 1,
  product: "chrome",
  channel: "stable",
  version: "150.0.7871.129",
} as const;

function fakeBrowsers(): BrowsersModule & {
  installCalls: unknown[];
  computeCalls: unknown[];
} {
  const module = {
    installCalls: [] as unknown[],
    computeCalls: [] as unknown[],
    install(options: { browser: string; buildId: string; cacheDir: string }) {
      module.installCalls.push(options);
      return Promise.resolve({
        executablePath: `${options.cacheDir}/chrome/${options.buildId}/chrome`,
      });
    },
    computeExecutablePath(options: {
      browser: string;
      buildId: string;
      cacheDir: string;
    }) {
      module.computeCalls.push(options);
      return `${options.cacheDir}/chrome/${options.buildId}/chrome`;
    },
  };
  return module;
}

describe("test browser lock parser", () => {
  it("loads the committed lock as the exact closed Chrome for Testing build", async () => {
    const lock = await loadTestBrowserLock();
    expect(lock).toEqual(CLOSED_LOCK);
  });

  it("accepts the exact closed lock object", () => {
    expect(readTestBrowserLock({ ...CLOSED_LOCK })).toEqual(CLOSED_LOCK);
  });

  it("rejects an unknown key", () => {
    expect(() => readTestBrowserLock({ ...CLOSED_LOCK, extra: true })).toThrow(
      /unknown key|extra/iu,
    );
  });

  it("rejects a drifted version", () => {
    expect(() =>
      readTestBrowserLock({ ...CLOSED_LOCK, version: "150.0.7871.130" }),
    ).toThrow(/version/iu);
  });

  it("rejects a wrong product or channel", () => {
    expect(() =>
      readTestBrowserLock({ ...CLOSED_LOCK, product: "firefox" }),
    ).toThrow(/product/iu);
    expect(() =>
      readTestBrowserLock({ ...CLOSED_LOCK, channel: "beta" }),
    ).toThrow(/channel/iu);
  });
});

describe("locked browser version verification", () => {
  const lock = CLOSED_LOCK as TestBrowserLock;

  it("accepts the exact four-part version, from a bare or a Chrome/-prefixed string", () => {
    expect(assertLockedBrowserVersion("150.0.7871.129", lock)).toBe(
      "150.0.7871.129",
    );
    expect(assertLockedBrowserVersion("Chrome/150.0.7871.129", lock)).toBe(
      "150.0.7871.129",
    );
  });

  it("rejects a drifted or truncated version", () => {
    expect(() => assertLockedBrowserVersion("150.0.7871.130", lock)).toThrow(
      /version/iu,
    );
    expect(() => assertLockedBrowserVersion("150.0.7871", lock)).toThrow(
      /version/iu,
    );
  });
});

describe("locked browser install and resolve", () => {
  const lock = CLOSED_LOCK as TestBrowserLock;

  it("resolves the executable path from the pinned build id without touching the network", async () => {
    const browsers = fakeBrowsers();
    const resolved = await resolveLockedTestBrowser(lock, {
      cacheDir: "/tmp/cft-cache",
      browsersModule: browsers,
    });
    expect(resolved.version).toBe("150.0.7871.129");
    expect(resolved.executablePath).toContain("150.0.7871.129");
    expect(browsers.computeCalls).toEqual([
      {
        browser: "chrome",
        buildId: "150.0.7871.129",
        cacheDir: "/tmp/cft-cache",
      },
    ]);
    // No dynamic import of @puppeteer/browsers happened: install was never called.
    expect(browsers.installCalls).toEqual([]);
  });

  it("installs the pinned build id explicitly into the local cache", async () => {
    const browsers = fakeBrowsers();
    const installSpy = vi.spyOn(browsers, "install");
    const executablePath = await installLockedTestBrowser(lock, {
      cacheDir: "/tmp/cft-cache",
      browsersModule: browsers,
    });
    expect(executablePath).toContain("150.0.7871.129");
    expect(installSpy).toHaveBeenCalledWith({
      browser: "chrome",
      buildId: "150.0.7871.129",
      cacheDir: "/tmp/cft-cache",
    });
  });
});
