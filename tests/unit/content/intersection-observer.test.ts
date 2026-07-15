import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostIntersectionObserver } from "@/content/observers/intersection-observer";

class MockIntersectionObserver {
  static lastOptions: IntersectionObserverInit | undefined;
  static lastInstance: MockIntersectionObserver | undefined;

  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.lastOptions = options;
    MockIntersectionObserver.lastInstance = this;
  }
}

describe("createPostIntersectionObserver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockIntersectionObserver.lastOptions = undefined;
    MockIntersectionObserver.lastInstance = undefined;
  });

  it("uses the required viewport margin", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    createPostIntersectionObserver(vi.fn());

    expect(MockIntersectionObserver.lastOptions).toEqual({
      root: null,
      rootMargin: "500px",
      threshold: 0.01,
    });
  });

  it("translates entries and exposes explicit cleanup", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const callback = vi.fn();
    const post = document.createElement("article");
    const observer = createPostIntersectionObserver(callback);

    observer.observe(post);
    MockIntersectionObserver.lastInstance!.callback(
      [
        {
          target: post,
          isIntersecting: true,
          intersectionRatio: 0.5,
        } as unknown as IntersectionObserverEntry,
        {
          target: post,
          isIntersecting: false,
          intersectionRatio: 0,
        } as unknown as IntersectionObserverEntry,
      ],
      MockIntersectionObserver.lastInstance as unknown as IntersectionObserver,
    );
    observer.unobserve(post);
    observer.disconnect();

    expect(callback).toHaveBeenCalledWith([
      { element: post, nearViewport: true },
      { element: post, nearViewport: false },
    ]);
    expect(MockIntersectionObserver.lastInstance!.observe).toHaveBeenCalledWith(
      post,
    );
    expect(
      MockIntersectionObserver.lastInstance!.unobserve,
    ).toHaveBeenCalledWith(post);
    expect(
      MockIntersectionObserver.lastInstance!.disconnect,
    ).toHaveBeenCalledOnce();
  });
});
