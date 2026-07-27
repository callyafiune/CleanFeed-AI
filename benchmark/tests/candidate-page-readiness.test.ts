import { describe, expect, it } from "vitest";

import { openHoldoutCandidatePage } from "../commands/consume-holdout.ts";
import { openScoreCandidatePage } from "../commands/score.ts";

const CANDIDATE_GLOBAL = "__cleanfeedModelBenchmark";
const EXPECTED_READY_TIMEOUT_MS = 300_000;
const CANDIDATE_URL =
  "chrome-extension://candidate-extension/model-benchmark.html";

type CandidatePageDriver = (
  page: Parameters<typeof openScoreCandidatePage>[0],
  extensionId: string,
) => Promise<void>;

const DRIVERS: readonly [name: string, open: CandidatePageDriver][] = [
  ["score", openScoreCandidatePage],
  ["consume-holdout", openHoldoutCandidatePage],
];

/** The fakes below model only the two page methods the drivers call. */
function asPage(page: unknown): Parameters<typeof openScoreCandidatePage>[0] {
  return page as Parameters<typeof openScoreCandidatePage>[0];
}

describe.each(DRIVERS)("%s candidate-page driver", (_name, open) => {
  it("waits for delayed API publication with the cold-start timeout", async () => {
    const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      CANDIDATE_GLOBAL,
    );
    delete (globalThis as Record<string, unknown>)[CANDIDATE_GLOBAL];

    let publicationTimer: ReturnType<typeof setTimeout> | undefined;
    let observedTimeout: number | undefined;
    const visited: string[] = [];
    const page = {
      goto(url: string): Promise<null> {
        visited.push(url);
        publicationTimer = setTimeout(() => {
          Object.defineProperty(globalThis, CANDIDATE_GLOBAL, {
            configurable: true,
            value: {},
          });
        }, 10);
        return Promise.resolve(null);
      },
      async waitForFunction(
        predicate: (globalName: string) => boolean,
        globalName: string,
        options: { timeout?: number },
      ): Promise<unknown> {
        observedTimeout = options.timeout;
        const testDeadline = Date.now() + 1_000;
        while (!predicate(globalName)) {
          if (Date.now() >= testDeadline) {
            throw new Error("candidate API was not observed by the driver");
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return {};
      },
    };

    try {
      await open(asPage(page), "candidate-extension");
      // Asserted after the call, not inside the fake, so a driver that never
      // navigated fails on the navigation itself rather than on a later wait.
      expect(visited).toEqual([CANDIDATE_URL]);
      expect(CANDIDATE_GLOBAL in globalThis).toBe(true);
      expect(observedTimeout).toBe(EXPECTED_READY_TIMEOUT_MS);
    } finally {
      if (publicationTimer !== undefined) clearTimeout(publicationTimer);
      delete (globalThis as Record<string, unknown>)[CANDIDATE_GLOBAL];
      if (previous !== undefined) {
        Object.defineProperty(globalThis, CANDIDATE_GLOBAL, previous);
      }
    }
  });

  it("propagates the wait failure when the candidate never publishes", async () => {
    const visited: string[] = [];
    const timeout = new Error(
      "page.waitForFunction: Timeout 300000ms exceeded",
    );
    const page = {
      goto(url: string): Promise<null> {
        visited.push(url);
        return Promise.resolve(null);
      },
      waitForFunction(): Promise<unknown> {
        return Promise.reject(timeout);
      },
    };

    // A genuinely stuck candidate must surface as this timeout. If a driver
    // swallowed the rejection it would return normally, and the caller would
    // then misread the absent global as "candidate benchmark API is
    // unavailable" — the false-absence failure this driver exists to prevent.
    await expect(open(asPage(page), "candidate-extension")).rejects.toBe(
      timeout,
    );
    expect(visited).toEqual([CANDIDATE_URL]);
  });
});
