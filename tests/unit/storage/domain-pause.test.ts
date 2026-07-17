import { describe, expect, it } from "vitest";

import { DomainPauseRepository } from "@/storage/domain-pause";
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

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}

describe("DomainPauseRepository", () => {
  it("pauses and reports a single hostname", async () => {
    const repository = new DomainPauseRepository(new MemoryStorageArea());

    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(false);
    await repository.pause("www.linkedin.com");
    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(true);
  });

  it("persists only the hostname, never a path, text or author", async () => {
    const storage = new MemoryStorageArea();
    const repository = new DomainPauseRepository(storage);

    await repository.pause("www.linkedin.com");

    const stored = storage.dump()["cleanfeed.domain-pause.v1"];
    expect(stored).toEqual({
      schemaVersion: 1,
      hostnames: ["www.linkedin.com"],
    });
    // No path segment, query string or free-text ever reaches storage.
    const serializedHostnames = JSON.stringify(
      (stored as { hostnames: string[] }).hostnames,
    );
    expect(serializedHostnames).not.toMatch(/[/?\s]/u);
  });

  it("rejects a value that carries a path or arbitrary text", async () => {
    const repository = new DomainPauseRepository(new MemoryStorageArea());

    await expect(
      repository.pause("www.linkedin.com/feed/update/123"),
    ).rejects.toThrow();
    await expect(
      repository.pause("texto do post inteiro aqui"),
    ).rejects.toThrow();
    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(false);
  });

  it("resumes a paused hostname without touching the others", async () => {
    const repository = new DomainPauseRepository(new MemoryStorageArea());

    await repository.pause("www.linkedin.com");
    await repository.pause("example.com");
    await repository.resume("www.linkedin.com");

    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(false);
    await expect(repository.isPaused("example.com")).resolves.toBe(true);
  });

  it("treats the hostname case-insensitively and does not duplicate it", async () => {
    const repository = new DomainPauseRepository(new MemoryStorageArea());

    await repository.pause("WWW.LinkedIn.com");
    await repository.pause("www.linkedin.com");

    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual(["www.linkedin.com"]);
  });

  it("recovers from a corrupt stored value by starting empty", async () => {
    const storage = new MemoryStorageArea();
    await storage.set("cleanfeed.domain-pause.v1", { totally: "wrong" });
    const repository = new DomainPauseRepository(storage);

    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(false);
    await repository.pause("www.linkedin.com");
    await expect(repository.isPaused("www.linkedin.com")).resolves.toBe(true);
  });

  it("clears every paused hostname", async () => {
    const repository = new DomainPauseRepository(new MemoryStorageArea());

    await repository.pause("www.linkedin.com");
    await repository.pause("example.com");
    await repository.clear();

    await expect(repository.list()).resolves.toEqual([]);
  });
});
