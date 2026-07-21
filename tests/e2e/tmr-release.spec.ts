import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

import {
  startFixtureServer,
  type FixtureServer,
} from "./fixtures/linkedin-server";
import type { ReleaseVariantName } from "./fixtures/release-variants";
import {
  getExtensionServiceWorker,
  launchExtension,
} from "./helpers/load-extension";
import {
  assertFunctionalBrowserReceipt,
  buildFunctionalBrowserReceipt,
  readFunctionalBrowserLock,
  writeFunctionalBrowserReceipt,
} from "./helpers/functional-browser-receipt";
import type { PresentationMode } from "@/shared/types";

/**
 * Rollout + modes + accessibility + offline + service-worker restart on the REAL
 * Chromium MV3 lane (bundled Chromium, `channel: "chromium"`). It runs against the
 * TEST-ONLY variants materialized by `scripts/build-e2e-release-variants.mjs`
 * (invoked by `npm run test:e2e:release` before Playwright), each an unpacked
 * extension whose only difference is a synthetic, cross-validation-clean
 * descriptor. No variant ever enters `build:release`.
 */

const VARIANTS_ROOT = fileURLToPath(
  new URL("../../test-results/release-variants", import.meta.url),
);
const RECEIPT_PATH = fileURLToPath(
  new URL("../../test-results/tmr-functional-browser.json", import.meta.url),
);

const BADGE_SELECTOR = "button.cleanfeed-badge";
const REVEAL_NAME = "Mostrar texto";
const STRONGER_BAND = /Sinais mais fortes/u;

function variantDist(name: ReleaseVariantName): string {
  return join(VARIANTS_ROOT, name, "dist");
}

interface OpenVariant {
  context: BrowserContext;
  feed: Page;
  serviceWorker: Worker;
  extensionId: string;
  server: FixtureServer;
  origin: string;
}

/**
 * Launches a variant's dist over the offline LinkedIn fixture. The fixture is
 * served as `www.linkedin.com` (mapped to loopback) and marked secure so the
 * shipped content-script guards and Web Crypto run exactly as on https.
 */
async function openVariant(
  name: ReleaseVariantName,
  userDataDirectory = "",
): Promise<OpenVariant> {
  const dist = variantDist(name);
  if (!existsSync(dist)) {
    throw new Error(
      `variant dist missing: ${dist}. Run \`node scripts/build-e2e-release-variants.mjs\` (or \`npm run test:e2e:release\`).`,
    );
  }
  const server = await startFixtureServer();
  const port = new URL(server.origin).port;
  const origin = `http://www.linkedin.com:${port}`;
  const context = await launchExtension(dist, userDataDirectory, {
    secureOrigin: origin,
  });
  const serviceWorker = await getExtensionServiceWorker(context);
  const extensionId = new URL(serviceWorker.url()).host;
  const feed = await context.newPage();
  await feed.goto(`${origin}/linkedin-feed.html`);
  return { context, feed, serviceWorker, extensionId, server, origin };
}

async function closeVariant(open: OpenVariant): Promise<void> {
  await open.context.close();
  await open.server.close();
}

/** Sends the shipped UPDATE_SETTINGS message via a real options page. */
async function setPresentationMode(
  context: BrowserContext,
  extensionId: string,
  mode: PresentationMode,
): Promise<void> {
  const options = await context.newPage();
  await options.goto(
    `chrome-extension://${extensionId}/src/options/options.html`,
  );
  const applied = await options.evaluate(async (presentationMode) => {
    const response = (await chrome.runtime.sendMessage({
      source: "options",
      target: "background",
      type: "UPDATE_SETTINGS",
      payload: { presentationMode },
    })) as { payload?: { presentationMode?: string } } | undefined;
    return response?.payload?.presentationMode ?? null;
  }, mode);
  expect(applied).toBe(mode);
  await options.close();
}

/** Reads the model card text from a fresh popup page. */
async function readModelCard(
  context: BrowserContext,
  extensionId: string,
): Promise<string> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.getByRole("heading", { name: "Modelo local" }).waitFor({
    timeout: 10_000,
  });
  await popup.waitForTimeout(1_500);
  const text =
    (await popup
      .locator('section[aria-label="Estado do modelo"]')
      .textContent()) ?? "";
  await popup.close();
  return text;
}

test.describe("authorized rollout on the real Chromium MV3 lane", () => {
  test("records the functional-browser receipt (bundled chromium, never CfT)", async () => {
    const open = await openVariant("indicator-only");
    try {
      const receipt = buildFunctionalBrowserReceipt(open.context);
      writeFunctionalBrowserReceipt(receipt, RECEIPT_PATH);
      assertFunctionalBrowserReceipt(receipt, readFunctionalBrowserLock());
      expect(receipt.browserKind).toBe("playwright-bundled-chromium");
      expect(receipt.channel).toBe("chromium");
      expect(receipt.browserVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
    } finally {
      await closeVariant(open);
    }
  });

  test("shadow + hide preference never presents (fail-closed, no badge/class)", async () => {
    const open = await openVariant("shadow");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      const long = open.feed.getByTestId("long-post");
      await long.scrollIntoViewIfNeeded();
      // Shadow authorizes no presentation: no owned badge and no visual class.
      await open.feed.waitForTimeout(6_000);
      await expect(open.feed.locator(BADGE_SELECTOR)).toHaveCount(0);
      await expect(long).not.toHaveClass(
        /cleanfeed-(blurred|collapsed|hidden)/u,
      );
    } finally {
      await closeVariant(open);
    }
  });

  test("indicator-only + hide preference badges but never actions", async () => {
    const open = await openVariant("indicator-only");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      const long = open.feed.getByTestId("long-post");
      await long.scrollIntoViewIfNeeded();
      await expect(
        open.feed.locator(`${BADGE_SELECTOR}[data-cleanfeed-mode='indicator']`),
      ).toBeVisible({ timeout: 20_000 });
      await expect(long).not.toHaveClass(
        /cleanfeed-(blurred|collapsed|hidden)/u,
      );
    } finally {
      await closeVariant(open);
    }
  });

  test("expired profile: TMR abstains, popup shows builtin fallback + no coverage", async () => {
    const open = await openVariant("expired");
    try {
      const card = await readModelCard(open.context, open.extensionId);
      // The promoted (actions/pass) release ships only an EXPIRED profile, so the
      // TMR abstains and the stylometric builtin serves: coverage none, the
      // active identity is builtin, and the abstention reason is surfaced.
      expect(card).toContain("Fallback estilométrico ativo");
      expect(card).toContain(
        "Sem perfil aplicável; o TMR se abstém e o fallback local pode apenas indicar.",
      );
      // A promoted decision is still reported as the scientific stage.
      expect(card).toContain("Elegível para ações");
      const long = open.feed.getByTestId("long-post");
      await long.scrollIntoViewIfNeeded();
      await open.feed.waitForTimeout(6_000);
      await expect(long).not.toHaveClass(
        /cleanfeed-(blurred|collapsed|hidden)/u,
      );
    } finally {
      await closeVariant(open);
    }
  });

  const VISUAL_MODES = [
    ["blur", "cleanfeed-blurred"],
    ["collapse", "cleanfeed-collapsed"],
    ["hide", "cleanfeed-hidden"],
  ] as const;

  for (const [mode, className] of VISUAL_MODES) {
    test(`pass applies explicit ${mode} to the long post and remains reversible`, async () => {
      const open = await openVariant("pass");
      try {
        await setPresentationMode(open.context, open.extensionId, mode);
        await open.feed.reload();
        const post = open.feed.getByTestId("long-post");
        await post.scrollIntoViewIfNeeded();
        await expect(post).toHaveClass(new RegExp(className, "u"), {
          timeout: 20_000,
        });
        // The raw score is NEVER in the feed: only a qualitative band label.
        await expect(
          open.feed.locator(`${BADGE_SELECTOR}[data-cleanfeed-mode='${mode}']`),
        ).toBeVisible();
        // Reveal drops the visual treatment but keeps the badge.
        await open.feed.getByRole("button", { name: REVEAL_NAME }).click();
        await expect(post).not.toHaveClass(new RegExp(className, "u"));
        await expect(open.feed.locator(BADGE_SELECTOR)).toBeVisible();
      } finally {
        await closeVariant(open);
      }
    });
  }

  test("pass + a 70-word post stays indicator (short bucket never actions)", async () => {
    const open = await openVariant("pass");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      const short = open.feed.getByTestId("short-qualified-post");
      await short.scrollIntoViewIfNeeded();
      await expect(short).not.toHaveClass(
        /cleanfeed-(blurred|collapsed|hidden)/u,
        { timeout: 20_000 },
      );
    } finally {
      await closeVariant(open);
    }
  });

  test("pass: restore removes every owned node and preserves the original text", async () => {
    const open = await openVariant("pass");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      const post = open.feed.getByTestId("long-post");
      await post.scrollIntoViewIfNeeded();
      await expect(post).toHaveClass(/cleanfeed-hidden/u, { timeout: 20_000 });
      await open.serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          url: "http://www.linkedin.com/*",
        });
        if (tab?.id === undefined) throw new Error("linkedin tab not found");
        await chrome.tabs
          .sendMessage(tab.id, {
            source: "popup",
            target: "content",
            type: "CLEAR_PAGE_PRESENTATION",
            payload: undefined,
          })
          .catch(() => undefined);
      });
      await expect(open.feed.locator("[data-cleanfeed-owned]")).toHaveCount(0);
      await expect(post).not.toHaveClass(
        /cleanfeed-(blurred|collapsed|hidden)/u,
      );
      await expect(post).toContainText("a inovação transforma o mercado");
    } finally {
      await closeVariant(open);
    }
  });

  test("pass: keyboard opens the explanation and the approved probabilistic copy shows", async () => {
    const open = await openVariant("pass");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      const post = open.feed.getByTestId("long-post");
      await post.scrollIntoViewIfNeeded();
      await expect(post).toHaveClass(/cleanfeed-hidden/u, { timeout: 20_000 });
      const badge = open.feed.locator(BADGE_SELECTOR).first();
      await badge.press("Enter");
      await expect(
        open.feed.getByRole("heading", { name: "Indícios observados" }),
      ).toBeVisible();
      await expect(
        open.feed.getByText(
          "Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA. Isso não comprova sua origem.",
        ),
      ).toBeVisible();
      // The strongest band label is qualitative, never a raw score.
      await expect(
        open.feed.getByRole("button", { name: STRONGER_BAND }),
      ).toBeVisible();
    } finally {
      await closeVariant(open);
    }
  });

  test("offline: no request ever leaves the extension or the local fixture", async () => {
    const open = await openVariant("pass");
    try {
      const external: string[] = [];
      open.context.on("request", (request) => {
        const url = request.url();
        if (
          !url.startsWith("chrome-extension://") &&
          !url.startsWith(open.origin)
        ) {
          external.push(url);
        }
      });
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      await open.feed.getByTestId("long-post").scrollIntoViewIfNeeded();
      await open.feed.waitForTimeout(8_000);
      expect(external).toEqual([]);
    } finally {
      await closeVariant(open);
    }
  });

  test("no serious/critical a11y violations on the extension's own roots", async () => {
    const open = await openVariant("pass");
    try {
      await setPresentationMode(open.context, open.extensionId, "hide");
      await open.feed.reload();
      await open.feed.getByTestId("long-post").scrollIntoViewIfNeeded();
      const roots: { name: string; url: string; wait: () => Promise<void> }[] =
        [
          {
            name: "feed",
            url: `${open.origin}/linkedin-feed.html`,
            wait: async () => {
              await open.feed.getByTestId("long-post").scrollIntoViewIfNeeded();
            },
          },
          {
            name: "popup",
            url: `chrome-extension://${open.extensionId}/src/popup/popup.html`,
            wait: async () => undefined,
          },
          {
            name: "options",
            url: `chrome-extension://${open.extensionId}/src/options/options.html`,
            wait: async () => undefined,
          },
        ];
      for (const root of roots) {
        const page =
          root.name === "feed" ? open.feed : await open.context.newPage();
        if (root.name !== "feed") await page.goto(root.url);
        else await root.wait();
        if (root.name !== "feed") {
          await page.getByRole("heading").first().waitFor({ timeout: 10_000 });
        }
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        const blocking = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          blocking,
          `${root.name}: ${blocking.map((v) => v.id).join(", ")}`,
        ).toEqual([]);
        if (root.name !== "feed") await page.close();
      }
    } finally {
      await closeVariant(open);
    }
  });

  test("service worker restart: settings persist and no duplicate presentation", async () => {
    const userDataDirectory = fileURLToPath(
      new URL(
        `../../test-results/release-variants/pass/user-data-${Date.now()}`,
        import.meta.url,
      ),
    );
    const first = await openVariant("pass", userDataDirectory);
    await setPresentationMode(first.context, first.extensionId, "hide");
    await first.feed.reload();
    await expect(first.feed.getByTestId("long-post")).toHaveClass(
      /cleanfeed-hidden/u,
      { timeout: 20_000 },
    );
    await first.context.close();
    await first.server.close();

    // Relaunch with the SAME profile + dist: settings persist and the feed is
    // presented once, without duplicated badges or placeholders.
    const dist = variantDist("pass");
    const server = await startFixtureServer();
    const origin = `http://www.linkedin.com:${new URL(server.origin).port}`;
    const context = await chromium.launchPersistentContext(userDataDirectory, {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1, EXCLUDE localhost",
        `--unsafely-treat-insecure-origin-as-secure=${origin}`,
      ],
    });
    try {
      const feed = await context.newPage();
      await feed.goto(`${origin}/linkedin-feed.html`);
      const post = feed.getByTestId("long-post");
      await post.scrollIntoViewIfNeeded();
      await expect(post).toHaveClass(/cleanfeed-hidden/u, { timeout: 20_000 });
      await expect(feed.locator("[data-cleanfeed-owned='badge']")).toHaveCount(
        1,
      );
      await expect(
        feed.locator("[data-cleanfeed-owned='placeholder']"),
      ).toHaveCount(1);
    } finally {
      await context.close();
      await server.close();
    }
  });
});
