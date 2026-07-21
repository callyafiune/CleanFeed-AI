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
  host_permissions?: string[];
  [key: string]: unknown;
}

function addFixtureMatch(matches: string[] | undefined): string[] {
  const next = [...(matches ?? [])];
  if (!next.includes(FIXTURE_MATCH)) next.push(FIXTURE_MATCH);
  return next;
}

/** Options for {@link prepareExtension}, all defaulting to no change. */
export interface PrepareExtensionOptions {
  /**
   * Extra host permissions to add to the throwaway manifest. The full-MVP E2E
   * uses this to grant programmatic (`chrome.scripting`) access to the local
   * NON-LinkedIn fixture origin, standing in for the `activeTab` grant a native
   * context-menu click would give — a gesture Playwright cannot fire. It never
   * touches the shipped `dist` (which `npm run audit` verifies stays locked to
   * `https://www.linkedin.com/*`); it only widens this test's throwaway copy.
   */
  extraHostPermissions?: string[];
}

/**
 * Copies the built `dist` to a throwaway directory and patches ONLY the URL
 * match lists (content scripts and web-accessible resources), plus any opt-in
 * extra host permissions, so the extension runs on the local fixture origins.
 * Every byte of code, the CSP, and the shipped permission allowlist are the
 * shipped ones — this is a test host affordance, not a behavioural change. The
 * real manifest.config.ts is never touched.
 */
export function prepareExtension(
  distPath: string = EXTENSION_DIST,
  options: PrepareExtensionOptions = {},
): string {
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

  // Grant the http fixture host permission too (the shipped manifest lists only
  // https). Without it, a background `chrome.tabs.query({url})` cannot see the
  // http fixture tab, so SW-driven flows (e.g. CLEAR_PAGE_PRESENTATION) can't
  // target it. This only widens the throwaway copy; `npm run audit` still checks
  // the shipped dist stays locked to https://www.linkedin.com/*.
  const extraHosts = [FIXTURE_MATCH, ...(options.extraHostPermissions ?? [])];
  const hosts = [...(manifest.host_permissions ?? [])];
  for (const host of extraHosts) {
    if (!hosts.includes(host)) hosts.push(host);
  }
  manifest.host_permissions = hosts;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

/** Options for {@link launchExtension}. */
export interface LaunchExtensionOptions {
  /**
   * The insecure fixture origin to treat as a secure context, so the shipped
   * content script's Web Crypto hashing works over http exactly as on https.
   * The offline fixture is served as `http://www.linkedin.com:<port>`; passing it
   * here mirrors the shared harness. When omitted the flag is not added.
   */
  secureOrigin?: string;
}

/**
 * Launches a persistent Chromium context with the unpacked extension at
 * `distPath`. The launch shape is exactly the one verified for this environment
 * (headless, the "chromium" channel, the two extension flags and the LinkedIn
 * host-resolver mapping); an empty `userDataDirectory` yields a throwaway
 * profile, while a real directory lets a later relaunch restore its state. The
 * optional `secureOrigin` adds the same insecure-origin-as-secure flag the
 * shared harness uses so Web Crypto works over the http fixture.
 */
export async function launchExtension(
  distPath: string,
  userDataDirectory: string = "",
  options: LaunchExtensionOptions = {},
): Promise<BrowserContext> {
  const extensionPath = prepareExtension(distPath);
  const secureArgs =
    options.secureOrigin === undefined
      ? []
      : [`--unsafely-treat-insecure-origin-as-secure=${options.secureOrigin}`];
  return chromium.launchPersistentContext(userDataDirectory, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1, EXCLUDE localhost",
      ...secureArgs,
    ],
  });
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
