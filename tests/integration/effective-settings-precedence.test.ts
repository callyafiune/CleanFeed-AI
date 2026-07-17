import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { Clock } from "@/shared/types";
import { resolveEffectiveSettings } from "@/storage/effective-settings";
import { DomainSettingsRepository } from "@/storage/domain-settings";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
import type { StorageArea } from "@/storage/storage-area";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys.flatMap((key) =>
        this.values.has(key) ? [[key, this.values.get(key) as T]] : [],
      ),
    );
  }
}

class TestClock implements Clock {
  now(): number {
    return 1_000_000;
  }
}

describe("effective settings precedence", () => {
  it("applies the documented precedence", () => {
    const effective = resolveEffectiveSettings({
      global: { minimumWordCount: 80, presentationMode: "blur" },
      platform: { platformId: "linkedin", minimumWordCount: 150 },
      domain: { hostname: "www.linkedin.com", presentationMode: "indicator" },
      session: { minimumWordCount: 100 },
    });

    expect(effective.minimumWordCount).toBe(100);
    expect(effective.presentationMode).toBe("indicator");
  });

  it("lets each layer override the one before it", () => {
    const effective = resolveEffectiveSettings({
      global: { minimumWordCount: 80, presentationMode: "blur" },
      platform: { platformId: "linkedin", minimumWordCount: 150 },
      domain: { hostname: "www.linkedin.com", presentationMode: "collapse" },
    });

    // platform wins over global; domain wins over platform; defaults fill rest.
    expect(effective.minimumWordCount).toBe(150);
    expect(effective.presentationMode).toBe("collapse");
    expect(effective.enabled).toBe(DEFAULT_SETTINGS.enabled);
  });

  it("treats a disabled domain as CleanFeed being off unless the session re-enables it", () => {
    expect(
      resolveEffectiveSettings({
        domain: { hostname: "www.linkedin.com", disabled: true },
      }).enabled,
    ).toBe(false);

    expect(
      resolveEffectiveSettings({
        domain: { hostname: "www.linkedin.com", disabled: true },
        session: { enabled: true },
      }).enabled,
    ).toBe(true);
  });

  it("returns no sourceMap unless debug mode is on", () => {
    const effective = resolveEffectiveSettings({
      global: { minimumWordCount: 120 },
    });

    expect(effective.sourceMap).toBeUndefined();
  });

  it("explains the origin of each value in a debug sourceMap", () => {
    const effective = resolveEffectiveSettings({
      global: {
        debugMode: true,
        minimumWordCount: 80,
        presentationMode: "blur",
      },
      platform: { platformId: "linkedin", minimumWordCount: 150 },
      domain: { hostname: "www.linkedin.com", presentationMode: "indicator" },
      session: { minimumWordCount: 100 },
    });

    expect(effective.sourceMap).toBeDefined();
    expect(effective.sourceMap?.minimumWordCount).toBe("session");
    expect(effective.sourceMap?.presentationMode).toBe("domain");
    expect(effective.sourceMap?.debugMode).toBe("global");
    expect(effective.sourceMap?.enabled).toBe("default");
  });

  it("resolves the effective settings from the persisted repositories", async () => {
    const storage = new MemoryStorageArea();
    const clock = new TestClock();

    await new SettingsRepository(storage).save({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 80,
      presentationMode: "blur",
    });
    await new PlatformSettingsRepository(storage).save({
      platformId: "linkedin",
      minimumWordCount: 150,
    });
    const domains = new DomainSettingsRepository(storage, clock);
    await domains.disable("www.linkedin.com");

    const [global, platform, domain] = await Promise.all([
      new SettingsRepository(storage).get(),
      new PlatformSettingsRepository(storage).get("linkedin"),
      domains.get("www.linkedin.com"),
    ]);

    const effective = resolveEffectiveSettings({ global, platform, domain });

    expect(effective.minimumWordCount).toBe(150);
    expect(effective.presentationMode).toBe("blur");
    expect(effective.enabled).toBe(false);
  });
});
