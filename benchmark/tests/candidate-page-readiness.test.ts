import { describe, expect, it } from "vitest";

import { openHoldoutCandidatePage } from "../commands/consume-holdout.ts";
import { openScoreCandidatePage } from "../commands/score.ts";

const CANDIDATE_GLOBAL = "__cleanfeedModelBenchmark";
const EXPECTED_READY_TIMEOUT_MS = 300_000;

type CandidatePageDriver = (
  page: Parameters<typeof openScoreCandidatePage>[0],
  extensionId: string,
) => Promise<void>;

const DRIVERS: readonly [name: string, open: CandidatePageDriver][] = [
  ["score", openScoreCandidatePage],
  ["consume-holdout", openHoldoutCandidatePage],
];

describe.each(DRIVERS)("%s candidate-page driver", (_name, open) => {
  it("waits for delayed API publication with the cold-start timeout", async () => {
    const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      CANDIDATE_GLOBAL,
    );
    delete (globalThis as Record<string, unknown>)[CANDIDATE_GLOBAL];

    let publicationTimer: ReturnType<typeof setTimeout> | undefined;
    let observedTimeout: number | undefined;
    const page = {
      goto(url: string): Promise<null> {
        expect(url).toBe(
          "chrome-extension://candidate-extension/model-benchmark.html",
        );
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
      await open(
        page as Parameters<typeof openScoreCandidatePage>[0],
        "candidate-extension",
      );
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
});
