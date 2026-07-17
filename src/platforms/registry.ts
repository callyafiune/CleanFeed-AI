import type { PlatformAdapter } from "@/shared/types";

/**
 * Holds the platform adapters known to a page session and resolves the one that
 * owns a given URL. The registry is the single extension point for new
 * platforms: adding one means registering an adapter here, never editing the
 * inference, storage or presentation core. See docs/platform-adapters.md.
 */
export class PlatformRegistry {
  private readonly adapters: PlatformAdapter[] = [];
  private readonly byId = new Map<string, PlatformAdapter>();

  constructor(adapters: readonly PlatformAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  /** Registers an adapter. Throws if its id is already registered. */
  register(adapter: PlatformAdapter): void {
    if (this.byId.has(adapter.id)) {
      throw new Error(`Duplicate platform adapter id: "${adapter.id}"`);
    }
    this.byId.set(adapter.id, adapter);
    this.adapters.push(adapter);
  }

  /** Returns the adapter registered under `id`, or `null` when none is. */
  get(id: string): PlatformAdapter | null {
    return this.byId.get(id) ?? null;
  }

  /** Finds the first registered adapter that explicitly accepts a page URL. */
  match(url: URL): PlatformAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }
}
