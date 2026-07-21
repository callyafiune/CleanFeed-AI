// A minimal Chrome DevTools Protocol (CDP) heap sampler for the REAL
// reference-performance lane. It attaches (flatten mode) to ONLY the loaded
// extension's own runtime targets — its page(s), the MV3 service worker and any
// dedicated/blob workers of the SAME extension origin — runs a forced GC and
// reads the runtime heap usage on each. The footprint is a CLOSED numeric sum;
// the sample never records a URL, an executable path or any machine identity.
//
// The DevTools loopback endpoint is control-plane only: it is not a content
// request, and it never relaxes the offline network posture the extension runs
// under. This module carries no Playwright import so the pure sampler can be
// unit-tested with a fake transport.

/** The one accepted transport: a flatten-mode CDP `send`, optionally scoped to a session. */
export interface CdpClient {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * A privacy-safe heap sample. It carries ONLY numeric totals and counts —
 * never a URL, target id or any string that could identify the machine.
 */
export interface ExtensionHeapSample {
  /** Sum of `totalSize + embedderHeapUsedSize + backingStorageSize` over targets. */
  readonly footprintBytes: number;
  /** How many extension runtime targets contributed to the sum. */
  readonly targetCount: number;
}

/** The CDP target types the extension runtime can legitimately own. */
const RUNTIME_TARGET_TYPES = new Set(["page", "service_worker", "worker"]);

/** Coded, fail-closed error thrown by the sampler. */
export class ExtensionHeapSampleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} — ${message}`);
    this.name = "ExtensionHeapSampleError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ExtensionHeapSampleError(code, message);
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/**
 * True when `url` belongs to the extension origin `chrome-extension://<id>` —
 * either a direct extension URL or a `blob:` worker minted by that origin.
 */
export function belongsToExtension(url: string, extensionId: string): boolean {
  const direct = `chrome-extension://${extensionId}/`;
  const blob = `blob:chrome-extension://${extensionId}/`;
  return url.startsWith(direct) || url.startsWith(blob);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readTargetInfos(response: Record<string, unknown>): CdpTargetInfo[] {
  const infos = response.targetInfos;
  if (!Array.isArray(infos)) {
    fail("TARGETS_UNAVAILABLE", "Target.getTargets returned no targetInfos");
  }
  return infos.map((info) => {
    const record = info as Record<string, unknown>;
    return {
      targetId: String(record.targetId ?? ""),
      type: String(record.type ?? ""),
      url: String(record.url ?? ""),
    };
  });
}

/**
 * Samples the aggregate runtime heap footprint of the extension's own targets.
 * Runs `HeapProfiler.collectGarbage` BEFORE `Runtime.getHeapUsage` on each
 * attached session and sums the closed triple. A target that vanishes mid-sample
 * or a non-finite/negative usage fails closed; a sample with no runtime target
 * fails rather than silently reporting zero.
 */
export async function sampleExtensionHeap(
  client: CdpClient,
  extensionId: string,
): Promise<ExtensionHeapSample> {
  const targets = readTargetInfos(await client.send("Target.getTargets"));
  const runtimeTargets = targets.filter(
    (target) =>
      RUNTIME_TARGET_TYPES.has(target.type) &&
      belongsToExtension(target.url, extensionId),
  );

  if (runtimeTargets.length === 0) {
    fail(
      "NO_RUNTIME_TARGET",
      `no page/service_worker/worker target for chrome-extension://${extensionId}`,
    );
  }

  let footprintBytes = 0;
  for (const target of runtimeTargets) {
    let attach: Record<string, unknown>;
    try {
      attach = await client.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
    } catch (error) {
      fail("TARGET_DISAPPEARED", `attach failed: ${String(error)}`);
    }
    const sessionId = attach.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      fail("TARGET_DISAPPEARED", "attachToTarget returned no session");
    }

    // Force a GC first so the usage read reflects live, retained memory only.
    let usage: Record<string, unknown>;
    try {
      await client.send("HeapProfiler.collectGarbage", undefined, sessionId);
      usage = await client.send("Runtime.getHeapUsage", undefined, sessionId);
    } catch (error) {
      fail("TARGET_DISAPPEARED", `session read failed: ${String(error)}`);
    }

    const { totalSize, embedderHeapUsedSize, backingStorageSize } = usage;
    if (
      !isFiniteNonNegative(totalSize) ||
      !isFiniteNonNegative(embedderHeapUsedSize) ||
      !isFiniteNonNegative(backingStorageSize)
    ) {
      fail(
        "HEAP_USAGE_INVALID",
        "Runtime.getHeapUsage returned a non-finite or negative total",
      );
    }
    footprintBytes += totalSize + embedderHeapUsedSize + backingStorageSize;
  }

  return { footprintBytes, targetCount: runtimeTargets.length };
}

/** A live CDP connection plus its teardown. */
export interface DevToolsCdpConnection {
  client: CdpClient;
  close(): Promise<void>;
}

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * A minimal flatten-mode CDP client over the DevTools loopback WebSocket
 * endpoint written to `DevToolsActivePort`. It correlates responses by their
 * globally unique `id` and forwards a session id when the caller scopes a
 * command to an attached target. It is created ONLY on the reference machine;
 * the unit test drives {@link sampleExtensionHeap} with a fake transport
 * instead, so this real transport is never exercised under Vitest.
 */
export async function connectDevToolsCdpClient(
  wsEndpoint: string,
): Promise<DevToolsCdpConnection> {
  const socket = new WebSocket(wsEndpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () =>
        reject(
          new ExtensionHeapSampleError("CDP_SOCKET_ERROR", "socket error"),
        ),
      { once: true },
    );
  });

  let nextId = 0;
  const pending = new Map<number, PendingCommand>();

  socket.addEventListener("message", (event: MessageEvent) => {
    const raw =
      typeof event.data === "string" ? event.data : String(event.data);
    const message = JSON.parse(raw) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (typeof message.id !== "number") return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(
        new ExtensionHeapSampleError(
          "CDP_COMMAND_FAILED",
          message.error.message ?? "command failed",
        ),
      );
    } else {
      entry.resolve(message.result ?? {});
    }
  });

  const client: CdpClient = {
    send(method, params, sessionId) {
      const id = (nextId += 1);
      const frame: Record<string, unknown> = {
        id,
        method,
        params: params ?? {},
      };
      if (sessionId !== undefined) frame.sessionId = sessionId;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify(frame));
      });
    },
  };

  return {
    client,
    close: () =>
      new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close();
      }),
  };
}
