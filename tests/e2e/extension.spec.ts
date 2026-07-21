import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./helpers/load-extension";

// The badge's accessible name is always "CleanFeed: <qualitative band>"; match
// the stable prefix so the assertion is independent of the exact band copy.
const BADGE_NAME = /^CleanFeed:/u;

test("loads unpacked, classifies the fixture offline and restores with the keyboard", async ({
  context,
  fixture,
}) => {
  // Monitor the WHOLE extension network surface — page, service worker and
  // offscreen document — not just the page. Anything that is neither the
  // extension itself nor the fixture origin is an external request.
  const external: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (
      !url.startsWith("chrome-extension://") &&
      !url.startsWith(fixture.origin)
    ) {
      external.push(url);
    }
  });

  const page = await context.newPage();
  await page.goto(fixture.feedUrl);

  await page.getByTestId("long-post").scrollIntoViewIfNeeded();

  const badge = page.getByRole("button", { name: BADGE_NAME });
  await expect(badge).toBeVisible({ timeout: 20_000 });

  // The original post is only decorated with an owned sibling badge; it is
  // never removed from the DOM.
  await expect(page.getByTestId("long-post")).toBeVisible();

  // Opening the disclosure with the keyboard reveals the evidence panel.
  await badge.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Indícios observados" }),
  ).toBeVisible();

  // Closing it again with the keyboard removes the panel; the post stays.
  await badge.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Indícios observados" }),
  ).toBeHidden();
  await expect(page.getByTestId("long-post")).toBeVisible();

  expect(external).toEqual([]);
  await page.close();
});

test("has no serious or critical accessibility violations on its own roots", async ({
  context,
  extensionId,
  fixture,
}) => {
  const roots = [
    { name: "feed", url: fixture.feedUrl },
    {
      name: "popup",
      url: `chrome-extension://${extensionId}/src/popup/popup.html`,
    },
    {
      name: "options",
      url: `chrome-extension://${extensionId}/src/options/options.html`,
    },
  ];

  for (const root of roots) {
    const page = await context.newPage();
    await page.goto(root.url);
    if (root.name === "feed") {
      await page.getByTestId("long-post").scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: BADGE_NAME })).toBeVisible({
        timeout: 20_000,
      });
    } else {
      // Let the popup/options React tree render before auditing.
      await page.getByRole("heading").first().waitFor({ timeout: 10_000 });
    }

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(
      blocking,
      `${root.name}: ${blocking.map((violation) => violation.id).join(", ")}`,
    ).toEqual([]);
    await page.close();
  }
});

test("processing a large feed produces no main-thread long task over 50ms", async ({
  context,
  fixture,
}) => {
  const page = await context.newPage();
  // Record every long task (the API reports only tasks > 50ms) from the start,
  // so any entry means a synchronous observer cycle blew the budget.
  await page.addInitScript(() => {
    const store = window as unknown as { __cleanfeedLongTasks: number[] };
    store.__cleanfeedLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__cleanfeedLongTasks.push(entry.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
  });

  await page.goto(fixture.feedUrl);
  await page.getByTestId("long-post").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: BADGE_NAME })).toBeVisible({
    timeout: 20_000,
  });

  // Discard any load-time tasks; from here, a long task can only be the
  // extension's own feed processing.
  await page.evaluate(() => {
    (
      window as unknown as { __cleanfeedLongTasks: number[] }
    ).__cleanfeedLongTasks.length = 0;
  });

  // Inject far more than one 100-candidate cycle of real post elements so the
  // feed mutation observer must batch and yield. The injection is chunked with
  // yields so the TEST's own DOM writes never form a long task — any long task
  // recorded is therefore the extension's synchronous observer work, which the
  // cap (100/cycle) must keep under the 50ms threshold.
  await page.evaluate(async () => {
    const feed = document.querySelector("main") ?? document.body;
    const template = document.querySelector('[data-testid="long-post"]');
    if (template === null) return;
    for (let chunk = 0; chunk < 8; chunk += 1) {
      for (let offset = 0; offset < 50; offset += 1) {
        const index = chunk * 50 + offset;
        const clone = template.cloneNode(true) as HTMLElement;
        clone.removeAttribute("data-testid");
        clone.setAttribute("data-urn", `urn:li:activity:bulk-${index}`);
        const body = clone.querySelector(".update-components-text");
        if (body !== null) {
          // Keep the adapter-recognized structure but a light body, so the
          // measured cost is the observer's per-cycle work (the budget under
          // test), not layout of a heavy paragraph cloned 400 times.
          body.textContent = `Publicação de teste número ${index}.`;
        }
        feed.append(clone);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  // Let the observer drain its batches (cap 100/cycle with yields between them).
  await page.waitForTimeout(3_000);

  const longTasks = await page.evaluate(
    () =>
      (window as unknown as { __cleanfeedLongTasks: number[] })
        .__cleanfeedLongTasks,
  );
  expect(longTasks.filter((duration) => duration > 50)).toEqual([]);
  await page.close();
});
