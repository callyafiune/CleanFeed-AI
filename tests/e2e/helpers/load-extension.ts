import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  test as base,
  type BrowserContext,
  type Worker,
} from "@playwright/test";

import { startFixtureServer } from "../fixtures/linkedin-server";

/** The offline fixture, addressed as the real host so the shipped guards run. */
export interface FixtureAccess {
  /** e.g. `http://www.linkedin.com:53124` — the E2E's only allowed origin. */
  readonly origin: string;
  /** The mock feed URL to navigate to. */
  readonly feedUrl: string;
}

/** Absolute path to the built, unpacked extension the E2E loads. */
export const EXTENSION_DIST = fileURLToPath(
  new URL("../../../dist", import.meta.url),
);

/**
 * The fixture is served over http as www.linkedin.com (mapped to 127.0.0.1 via
 * --host-resolver-rules) so the SHIPPED content-script runtime guard
 * (LinkedInAdapter.matches, which checks only the hostname) passes unchanged.
 * We add the http scheme to the match lists because the shipped manifest only
 * lists https; Chrome match patterns ignore the port.
 */
const FIXTURE_MATCH = "http://www.linkedin.com/*";

interface MutableManifest {
  content_scripts?: { matches?: string[] }[];
  web_accessible_resources?: { matches?: string[] }[];
  [key: string]: unknown;
}

function addFixtureMatch(matches: string[] | undefined): string[] {
  const next = [...(matches ?? [])];
  if (!next.includes(FIXTURE_MATCH)) next.push(FIXTURE_MATCH);
  return next;
}

/**
 * Copies the built `dist` to a throwaway directory and patches ONLY the URL
 * match lists (content scripts and web-accessible resources) so the extension
 * runs on the local fixture origin. Every byte of code, the CSP, and the
 * permission allowlist are the shipped ones — this is a test host affordance,
 * not a behavioural change. The real manifest.config.ts is never touched.
 */
export function prepareExtension(distPath: string = EXTENSION_DIST): string {
  const target = mkdtempSync(join(tmpdir(), "cleanfeed-e2e-ext-"));
  cpSync(distPath, target, { recursive: true });

  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as MutableManifest;

  for (const entry of manifest.content_scripts ?? []) {
    entry.matches = addFixtureMatch(entry.matches);
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    entry.matches = addFixtureMatch(entry.matches);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

/** The service worker backing the loaded extension, once it has started. */
export async function getExtensionServiceWorker(
  context: BrowserContext,
): Promise<Worker> {
  const [existing] = context.serviceWorkers();
  return existing ?? (await context.waitForEvent("serviceworker"));
}

/**
 * Playwright fixtures that launch a persistent Chromium context with the
 * unpacked extension. The launch shape is exactly the one verified for this
 * environment: headless, the "chromium" channel, and the two extension flags.
 */
export const test = base.extend<
  { context: BrowserContext; extensionId: string },
  { fixture: FixtureAccess }
>({
  // Worker-scoped offline fixture server, started once per worker. It is served
  // as www.linkedin.com so the shipped content-script host guard runs.
  fixture: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startFixtureServer();
      const port = new URL(server.origin).port;
      const origin = `http://www.linkedin.com:${port}`;
      await use({ origin, feedUrl: `${origin}/linkedin-feed.html` });
      await server.close();
    },
    { scope: "worker" },
  ],
  context: async ({ fixture }, use) => {
    const extensionPath = prepareExtension();
    const context = await chromium.launchPersistentContext("", {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // Resolve the real LinkedIn host to the local fixture (port preserved),
        // so the page is www.linkedin.com to the extension but 127.0.0.1 on the
        // wire. No real network: any unmapped host would fail to resolve.
        "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1, EXCLUDE localhost",
        // The fixture is plain http; mark its origin secure so the content
        // script's Web Crypto (SubtleCrypto) hashing works as it would on https.
        `--unsafely-treat-insecure-origin-as-secure=${fixture.origin}`,
      ],
    });
    // `use` is Playwright's fixture callback, not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const serviceWorker = await getExtensionServiceWorker(context);
    // chrome-extension://<id>/... → the host segment is the extension id.
    const extensionId = new URL(serviceWorker.url()).host;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(extensionId);
  },
});

export const expect = test.expect;
