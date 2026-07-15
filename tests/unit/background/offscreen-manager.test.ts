import { afterEach, describe, expect, it, vi } from "vitest";

describe("ensureOffscreenDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("creates one offscreen document with the WORKERS reason", async () => {
    const chromeMock = {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://cleanfeed/${path}`),
        getContexts: vi.fn().mockResolvedValue([]),
      },
      offscreen: {
        Reason: { WORKERS: "WORKERS" },
        createDocument: vi.fn().mockResolvedValue(undefined),
      },
    };
    vi.stubGlobal("chrome", chromeMock);

    const { ensureOffscreenDocument } =
      await import("@/background/offscreen-manager");

    await Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]);

    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledOnce();
    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledWith({
      url: "src/offscreen/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Executar classificação local fora da thread da página.",
    });
  });

  it("does not create a document when the offscreen context already exists", async () => {
    const chromeMock = {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://cleanfeed/${path}`),
        getContexts: vi
          .fn()
          .mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]),
      },
      offscreen: {
        Reason: { WORKERS: "WORKERS" },
        createDocument: vi.fn(),
      },
    };
    vi.stubGlobal("chrome", chromeMock);

    const { ensureOffscreenDocument } =
      await import("@/background/offscreen-manager");

    await ensureOffscreenDocument();

    expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled();
  });
});
