import { describe, expect, it } from "vitest";

import type { Clock } from "@/shared/types";
import { DomainSettingsRepository } from "@/storage/domain-settings";
import type { StorageArea } from "@/storage/storage-area";

const DOMAIN_SETTINGS_KEY = "cleanfeed.domains.v1";
const ONE_HOUR_MS = 3_600_000;

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

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}

class TestClock implements Clock {
  constructor(private time = 1_000_000) {}

  now(): number {
    return this.time;
  }

  advanceBy(milliseconds: number): void {
    this.time += milliseconds;
  }
}

function createRepository(options?: { maximumHostnames?: number }) {
  const storage = new MemoryStorageArea();
  const clock = new TestClock();
  const domains = new DomainSettingsRepository(storage, clock, options);
  return { storage, clock, domains };
}

describe("DomainSettingsRepository", () => {
  it("stores only a normalized hostname and expires one-hour pauses", async () => {
    const { storage, clock, domains } = createRepository();

    await domains.pauseFor(
      "https://www.LinkedIn.com/feed/?tracking=secret",
      ONE_HOUR_MS,
    );

    await expect(domains.get("www.linkedin.com")).resolves.toMatchObject({
      hostname: "www.linkedin.com",
      pausedUntil: clock.now() + ONE_HOUR_MS,
    });
    // Never the full URL, path or query string reaches storage.
    const serialized = JSON.stringify(storage.dump());
    expect(serialized).not.toContain("tracking=secret");
    expect(serialized).not.toContain("/feed");
    expect(serialized).not.toMatch(/https?:\/\//u);

    clock.advanceBy(ONE_HOUR_MS + 1);
    await expect(domains.get("www.linkedin.com")).resolves.toBeUndefined();
  });

  it("drops the expired pause entry from storage lazily on read", async () => {
    const { storage, clock, domains } = createRepository();

    await domains.pauseFor("www.linkedin.com", ONE_HOUR_MS);
    clock.advanceBy(ONE_HOUR_MS + 1);
    await domains.get("www.linkedin.com");

    expect(storage.dump()[DOMAIN_SETTINGS_KEY]).toEqual({
      schemaVersion: 1,
      domains: {},
    });
  });

  it("persists a disabled domain and keeps it after a pause expires", async () => {
    const { clock, domains } = createRepository();

    await domains.disable("www.linkedin.com");
    await domains.pauseFor("www.linkedin.com", ONE_HOUR_MS);
    clock.advanceBy(ONE_HOUR_MS + 1);

    await expect(domains.get("www.linkedin.com")).resolves.toEqual({
      hostname: "www.linkedin.com",
      disabled: true,
    });
  });

  it("resumes a domain by clearing its pause and disabled flag", async () => {
    const { domains } = createRepository();

    await domains.disable("www.linkedin.com");
    await domains.resume("www.linkedin.com");

    await expect(domains.get("www.linkedin.com")).resolves.toBeUndefined();
  });

  it("clearExpired removes lapsed pauses but keeps active ones", async () => {
    const { clock, domains } = createRepository();

    await domains.pauseFor("expired.example", ONE_HOUR_MS);
    await domains.pauseFor("active.example", ONE_HOUR_MS * 5);
    clock.advanceBy(ONE_HOUR_MS + 1);

    await domains.clearExpired();

    await expect(domains.get("expired.example")).resolves.toBeUndefined();
    await expect(domains.get("active.example")).resolves.toMatchObject({
      hostname: "active.example",
    });
  });

  it("normalizes a full URL down to its hostname on get", async () => {
    const { domains } = createRepository();

    await domains.disable("www.linkedin.com");

    await expect(
      domains.get("https://www.LinkedIn.com/feed"),
    ).resolves.toMatchObject({ hostname: "www.linkedin.com" });
  });

  it("rejects credentials, a path and a wildcard", async () => {
    const { domains } = createRepository();

    await expect(
      domains.pauseFor("https://user:pass@www.linkedin.com/", ONE_HOUR_MS),
    ).rejects.toThrow();
    await expect(
      domains.pauseFor("www.linkedin.com/feed/update/123", ONE_HOUR_MS),
    ).rejects.toThrow();
    await expect(
      domains.pauseFor("*.linkedin.com", ONE_HOUR_MS),
    ).rejects.toThrow();
    await expect(
      domains.pauseFor("texto do post inteiro", ONE_HOUR_MS),
    ).rejects.toThrow();
  });

  it("rejects a non-positive pause duration", async () => {
    const { domains } = createRepository();

    await expect(domains.pauseFor("www.linkedin.com", 0)).rejects.toThrow();
    await expect(domains.pauseFor("www.linkedin.com", -1)).rejects.toThrow();
  });

  it("caps the number of stored hostnames", async () => {
    const { storage, domains } = createRepository({ maximumHostnames: 2 });

    await domains.disable("first.example");
    await domains.disable("second.example");
    await domains.disable("third.example");

    const stored = storage.dump()[DOMAIN_SETTINGS_KEY] as {
      domains: Record<string, unknown>;
    };
    expect(Object.keys(stored.domains)).toHaveLength(2);
    expect(stored.domains).toHaveProperty("third.example");
  });

  it("recovers from a corrupt stored value by starting empty", async () => {
    const storage = new MemoryStorageArea();
    await storage.set(DOMAIN_SETTINGS_KEY, { totally: "wrong" });
    const domains = new DomainSettingsRepository(storage, new TestClock());

    await expect(domains.get("www.linkedin.com")).resolves.toBeUndefined();
    await domains.disable("www.linkedin.com");
    await expect(domains.get("www.linkedin.com")).resolves.toEqual({
      hostname: "www.linkedin.com",
      disabled: true,
    });
  });
});
