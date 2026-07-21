import { describe, expect, it } from "vitest";

import {
  sampleExtensionHeap,
  type CdpClient,
} from "../../../tests/e2e/helpers/cdp-extension-metrics";

/**
 * A valid MV3 extension id is 32 chars in the a–p alphabet. This fixture id is
 * used ONLY in the unit test; the real spec resolves the installed id from the
 * extension service worker and passes it to the sampler.
 */
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const OTHER_EXTENSION_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";

interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface HeapUsage {
  totalSize: number;
  embedderHeapUsedSize: number;
  backingStorageSize: number;
  [key: string]: number;
}

interface FakeCdpOptions {
  targets: CdpTargetInfo[];
  heapByTarget: Record<string, HeapUsage | "disappear">;
  /** targetIds whose attach returns no session (target disappeared). */
  attachFailures?: Set<string>;
}

interface CallLogEntry {
  method: string;
  sessionId?: string;
}

/** A fake flatten-mode CDP transport that records call order per session. */
function createFakeCdp(options: FakeCdpOptions): {
  client: CdpClient;
  calls: CallLogEntry[];
} {
  const calls: CallLogEntry[] = [];
  const sessionToTarget = new Map<string, string>();
  let nextSession = 0;

  const client: CdpClient = {
    async send(method, params, sessionId) {
      calls.push({ method, sessionId });
      if (method === "Target.getTargets") {
        return { targetInfos: options.targets };
      }
      if (method === "Target.attachToTarget") {
        const targetId = (params as { targetId: string }).targetId;
        if (options.attachFailures?.has(targetId)) {
          return {};
        }
        const session = `session-${(nextSession += 1)}`;
        sessionToTarget.set(session, targetId);
        return { sessionId: session };
      }
      if (method === "HeapProfiler.collectGarbage") {
        return {};
      }
      if (method === "Runtime.getHeapUsage") {
        const targetId = sessionToTarget.get(sessionId ?? "");
        const usage = options.heapByTarget[targetId ?? ""];
        if (usage === "disappear") {
          throw new Error("target closed");
        }
        return usage ?? {};
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
  };

  return { client, calls };
}

const usage = (n: number): HeapUsage => ({
  totalSize: n,
  embedderHeapUsedSize: n,
  backingStorageSize: n,
});

describe("sampleExtensionHeap", () => {
  it("samples only extension page/service_worker/worker targets (incl. blob workers)", async () => {
    const { client, calls } = createFakeCdp({
      targets: [
        {
          targetId: "t-page",
          type: "page",
          url: `chrome-extension://${EXTENSION_ID}/options.html`,
        },
        {
          targetId: "t-sw",
          type: "service_worker",
          url: `chrome-extension://${EXTENSION_ID}/sw.js`,
        },
        {
          targetId: "t-worker",
          type: "worker",
          url: `blob:chrome-extension://${EXTENSION_ID}/9c1e-uuid`,
        },
        // Excluded: a different extension, the fixture page, and a non-runtime type.
        {
          targetId: "t-other-ext",
          type: "service_worker",
          url: `chrome-extension://${OTHER_EXTENSION_ID}/sw.js`,
        },
        {
          targetId: "t-feed",
          type: "page",
          url: "https://www.linkedin.com/feed/",
        },
        {
          targetId: "t-browser",
          type: "browser",
          url: `chrome-extension://${EXTENSION_ID}/x`,
        },
      ],
      heapByTarget: {
        "t-page": usage(10),
        "t-sw": usage(20),
        "t-worker": usage(30),
      },
    });

    const sample = await sampleExtensionHeap(client, EXTENSION_ID);

    // Only the three extension runtime targets are summed: (10+10+10)+(20*3)+(30*3).
    expect(sample.targetCount).toBe(3);
    expect(sample.footprintBytes).toBe(30 + 60 + 90);

    // The excluded targets are never attached.
    const attached = calls.filter(
      (call) => call.method === "Target.attachToTarget",
    ).length;
    expect(attached).toBe(3);
  });

  it("runs HeapProfiler.collectGarbage before Runtime.getHeapUsage on each session", async () => {
    const { client, calls } = createFakeCdp({
      targets: [
        {
          targetId: "t-sw",
          type: "service_worker",
          url: `chrome-extension://${EXTENSION_ID}/sw.js`,
        },
      ],
      heapByTarget: { "t-sw": usage(5) },
    });

    await sampleExtensionHeap(client, EXTENSION_ID);

    const sessionCalls = calls.filter((call) => call.sessionId !== undefined);
    const gcIndex = sessionCalls.findIndex(
      (call) => call.method === "HeapProfiler.collectGarbage",
    );
    const usageIndex = sessionCalls.findIndex(
      (call) => call.method === "Runtime.getHeapUsage",
    );
    expect(gcIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeGreaterThan(gcIndex);
  });

  it("rejects a non-finite or negative heap total", async () => {
    const { client } = createFakeCdp({
      targets: [
        {
          targetId: "t-sw",
          type: "service_worker",
          url: `chrome-extension://${EXTENSION_ID}/sw.js`,
        },
      ],
      heapByTarget: {
        "t-sw": {
          totalSize: -1,
          embedderHeapUsedSize: 0,
          backingStorageSize: 0,
        },
      },
    });
    await expect(sampleExtensionHeap(client, EXTENSION_ID)).rejects.toThrow(
      "HEAP_USAGE_INVALID",
    );
  });

  it("rejects a target that disappears mid-sample", async () => {
    const { client } = createFakeCdp({
      targets: [
        {
          targetId: "t-sw",
          type: "service_worker",
          url: `chrome-extension://${EXTENSION_ID}/sw.js`,
        },
      ],
      heapByTarget: { "t-sw": "disappear" },
    });
    await expect(sampleExtensionHeap(client, EXTENSION_ID)).rejects.toThrow(
      "TARGET_DISAPPEARED",
    );
  });

  it("rejects an attach that returns no session", async () => {
    const { client } = createFakeCdp({
      targets: [
        {
          targetId: "t-sw",
          type: "service_worker",
          url: `chrome-extension://${EXTENSION_ID}/sw.js`,
        },
      ],
      heapByTarget: { "t-sw": usage(5) },
      attachFailures: new Set(["t-sw"]),
    });
    await expect(sampleExtensionHeap(client, EXTENSION_ID)).rejects.toThrow(
      "TARGET_DISAPPEARED",
    );
  });

  it("rejects a sample with no extension runtime target", async () => {
    const { client } = createFakeCdp({
      targets: [
        {
          targetId: "t-feed",
          type: "page",
          url: "https://www.linkedin.com/feed/",
        },
      ],
      heapByTarget: {},
    });
    await expect(sampleExtensionHeap(client, EXTENSION_ID)).rejects.toThrow(
      "NO_RUNTIME_TARGET",
    );
  });
});
