import { afterEach, describe, expect, it, vi } from "vitest";

import { injectManualAnalysisPanel } from "@/manual-analysis/inject";

function manualShadow(): ShadowRoot | null | undefined {
  return document.querySelector<HTMLElement>("[data-cleanfeed-manual-host]")
    ?.shadowRoot;
}

describe("injectManualAnalysisPanel", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document
      .querySelectorAll("[data-cleanfeed-manual-host]")
      .forEach((node) => node.remove());
  });

  it("mounts one isolated panel and preserves host DOM", () => {
    document.body.innerHTML = '<main id="host">conteúdo original</main>';

    injectManualAnalysisPanel({ shadowMode: "open" });
    injectManualAnalysisPanel({ shadowMode: "open" });

    expect(
      document.querySelectorAll("[data-cleanfeed-manual-host]"),
    ).toHaveLength(1);
    expect(document.querySelector("#host")?.textContent).toBe(
      "conteúdo original",
    );
    expect(
      document.querySelector("[data-cleanfeed-manual-host]")?.shadowRoot,
    ).not.toBeNull();
  });

  it("defaults to a closed shadow root so page scripts cannot read or tamper with the panel", () => {
    injectManualAnalysisPanel();

    expect(
      document.querySelector("[data-cleanfeed-manual-host]")?.shadowRoot,
    ).toBeNull();
  });

  it("keeps its styles inside the shadow root and off the host page", () => {
    injectManualAnalysisPanel({ shadowMode: "open" });

    const host = document.querySelector<HTMLElement>(
      "[data-cleanfeed-manual-host]",
    );
    expect(host?.shadowRoot?.querySelector("style")).not.toBeNull();
    expect(document.head.querySelector("style[data-cleanfeed]")).toBeNull();
  });

  it("renders a selection prompt before any text arrives", async () => {
    injectManualAnalysisPanel({ shadowMode: "open" });

    await vi.waitFor(() =>
      expect(manualShadow()?.textContent).toContain(
        "Selecione um texto na página para analisar.",
      ),
    );
  });
});
