import type { PlatformAdapter } from "@/shared/types";

/** Finds the first registered adapter that explicitly accepts a page URL. */
export class PlatformRegistry {
  private readonly adapters: readonly PlatformAdapter[];

  constructor(adapters: readonly PlatformAdapter[]) {
    this.adapters = [...adapters];
  }

  match(url: URL): PlatformAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }
}
