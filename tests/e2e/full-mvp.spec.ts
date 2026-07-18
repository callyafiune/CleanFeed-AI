import { chromium, type BrowserContext, type Worker } from "@playwright/test";

import {
  EXTENSION_DIST,
  expect,
  getExtensionServiceWorker,
  prepareExtension,
  test,
} from "./helpers/load-extension";

/**
 * Full-MVP acceptance flow, run in ONE offline session against the SHIPPED
 * `dist`. It exercises the real user-visible criteria end to end:
 *
 *  1. On the (offline) LinkedIn fixture, a long post gets an accessible badge.
 *  2. Changing the presentation mode to `blur` — via the shipped
 *     options -> background UPDATE_SETTINGS message — is reflected after the
 *     tab re-reads settings on load: the post is blurred.
 *  3. The post is revealed back to its original text via the shipped page-level
 *     "clear presentation" (popup -> content CLEAR_PAGE_PRESENTATION) message.
 *  4. Manual analysis of a Portuguese selection on a NON-LinkedIn page produces
 *     a result panel, classified by the mock backend with zero network.
 *
 * Offline is proven the same way the existing extension.spec.ts proves it: the
 * only resolvable hosts are the local fixture origins (via --host-resolver-rules
 * for www.linkedin.com and the loopback IP directly), and the test asserts that
 * no request ever leaves those origins or the extension itself.
 *
 * DRIVING NOTES (documented because they replace gestures Playwright cannot fire
 * and observe, never the shipped result itself):
 *  - Presentation mode is changed with the exact UPDATE_SETTINGS runtime message
 *    the shipped options page sends; the SettingsRepository persists it.
 *  - The tab does NOT live-apply a presentation-mode change (the shipped
 *    content-script storage listener only live-toggles the domain pause), so the
 *    feed is reloaded to re-read the setting — matching real behaviour.
 *  - Reveal uses the shipped CLEAR_PAGE_PRESENTATION message the popup emits; the
 *    shipped LinkedIn presenter has no per-post reveal control, only this
 *    page-level restore-to-original.
 *  - Manual analysis: native context menus are not scriptable, so the shipped
 *    manual-analysis bundle is injected with chrome.scripting (standing in for
 *    the activeTab context-menu gesture) and handed the selection with the exact
 *    SHOW_MANUAL_ANALYSIS message the ManualAnalysisController sends. The panel,
 *    its messaging and its classification are entirely the shipped code; the
 *    only test affordance is coercing its (otherwise closed) shadow root open so
 *    Playwright can click "Analisar seleção" and read the produced result. The
 *    result is real mock output, never faked.
 */

const BADGE_NAME = /indícios|inconclusivo|pessoa/u;
const DEMO_NOTE =
  "Modo de demonstração: nenhum modelo real está sendo utilizado.";

test("all MVP acceptance criteria work in one offline session", async ({
  fixture,
}) => {
  test.setTimeout(90_000);

  const port = new URL(fixture.origin).port;
  const genericOrigin = `http://127.0.0.1:${port}`;
  const genericUrl = `${genericOrigin}/generic-page.html`;

  // Grant programmatic scripting access to the local NON-LinkedIn fixture origin
  // (the throwaway copy only — the shipped dist stays locked; `npm run audit`
  // enforces that). Every other launch flag mirrors the shared harness.
  const extensionPath = prepareExtension(EXTENSION_DIST, {
    extraHostPermissions: ["http://www.linkedin.com/*", "http://127.0.0.1/*"],
  });
  const context: BrowserContext = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1, EXCLUDE localhost",
      `--unsafely-treat-insecure-origin-as-secure=${fixture.origin}`,
    ],
  });

  try {
    const external: string[] = [];
    context.on("request", (request) => {
      const url = request.url();
      if (
        !url.startsWith("chrome-extension://") &&
        !url.startsWith(fixture.origin) &&
        !url.startsWith(genericOrigin)
      ) {
        external.push(url);
      }
    });

    const serviceWorker: Worker = await getExtensionServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;

    // ---- 1. Long LinkedIn post gets an accessible badge (offline) ----------
    const feed = await context.newPage();
    await feed.goto(fixture.feedUrl);
    await feed.getByTestId("long-post").scrollIntoViewIfNeeded();
    await expect(feed.getByRole("button", { name: BADGE_NAME })).toBeVisible({
      timeout: 20_000,
    });

    // ---- 2. Switch presentation mode to blur via the shipped options path ---
    const options = await context.newPage();
    await options.goto(
      `chrome-extension://${extensionId}/src/options/options.html`,
    );
    const applied = await options.evaluate(async () => {
      const response = (await chrome.runtime.sendMessage({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { presentationMode: "blur" },
      })) as
        { type?: string; payload?: { presentationMode?: string } } | undefined;
      return response?.payload?.presentationMode ?? null;
    });
    expect(applied).toBe("blur");
    await options.close();

    // Reclassify the visible post under the new mode by reloading the tab.
    await feed.reload();
    const longPost = feed.getByTestId("long-post");
    await longPost.scrollIntoViewIfNeeded();
    await expect(feed.getByRole("button", { name: BADGE_NAME })).toBeVisible({
      timeout: 20_000,
    });
    // Blur is reflected: the shipped presenter carries a blur-mode badge and the
    // post element itself is visually blurred.
    await expect(
      feed.locator("button.cleanfeed-badge[data-cleanfeed-mode='blur']"),
    ).toBeVisible();
    await expect(longPost).toHaveCSS("filter", /blur/u);

    // ---- 3. Reveal the post back to its original text ----------------------
    await serviceWorker.evaluate(async () => {
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
    await expect(longPost).toHaveCSS("filter", "none");
    await expect(feed.locator("[data-cleanfeed-owned='badge']")).toHaveCount(0);
    await expect(longPost).toBeVisible();
    await expect(longPost).toContainText("Compartilho hoje uma reflexão");

    // ---- 4. Manual analysis on a NON-LinkedIn page -------------------------
    const generic = await context.newPage();
    await generic.goto(genericUrl);
    const selection = (
      await generic.getByTestId("portuguese-selection").textContent()
    )
      ?.replace(/\s+/gu, " ")
      .trim();
    expect(selection && selection.length).toBeTruthy();

    const injected = await serviceWorker.evaluate(
      async ({ urlPattern, entryFile, selectedText, minimumWordCount }) => {
        const [tab] = await chrome.tabs.query({ url: urlPattern });
        const tabId = tab?.id;
        if (tabId === undefined) return { ok: false, reason: "tab-not-found" };

        // Coerce shadow roots created in THIS isolated world to be observable,
        // so Playwright can drive the (shipped) panel. Shipped code is untouched.
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const proto = Element.prototype as unknown as {
              attachShadow: (init: ShadowRootInit) => ShadowRoot;
              __cfShadowPatched?: boolean;
            };
            if (proto.__cfShadowPatched === true) return;
            const original = proto.attachShadow;
            proto.attachShadow = function (
              this: Element,
              init: ShadowRootInit,
            ) {
              return original.call(this, { ...init, mode: "open" });
            };
            proto.__cfShadowPatched = true;
          },
        });

        // Inject the shipped manual-analysis bundle (self-mounts the panel).
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [entryFile],
        });

        // Hand it the selection with the exact message the controller sends.
        await chrome.tabs
          .sendMessage(tabId, {
            source: "background",
            target: "manual",
            type: "SHOW_MANUAL_ANALYSIS",
            payload: { selectedText, minimumWordCount },
          })
          .catch(() => undefined);
        return { ok: true };
      },
      {
        urlPattern: "http://127.0.0.1/*",
        entryFile: "manual-analysis.js",
        selectedText: selection ?? "",
        minimumWordCount: 100,
      },
    );
    expect(injected.ok).toBe(true);

    // The shipped panel is now observable; drive its real classify + result.
    const analyze = generic.getByRole("button", { name: "Analisar seleção" });
    await expect(analyze).toBeVisible({ timeout: 20_000 });
    await analyze.click();
    await expect(generic.getByText(DEMO_NOTE)).toBeVisible({ timeout: 20_000 });

    // ---- Offline guarantee: nothing ever left the local origins ------------
    expect(external).toEqual([]);
  } finally {
    await context.close();
  }
});
