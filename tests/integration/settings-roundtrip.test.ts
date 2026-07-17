import "@testing-library/jest-dom/vitest";

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { StorageArea } from "@/shared/types";
import { ClassificationCache } from "@/storage/cache";
import { FeedbackRepository, type FeedbackRecord } from "@/storage/feedback";
import { MetricsRepository } from "@/storage/metrics";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";

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
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

const HASH = "a".repeat(64);

function feedbackRecord(): FeedbackRecord {
  return {
    textHash: HASH,
    predictedScore: 0.91,
    predictedStatus: "possibly_ai",
    feedback: "human",
    modelVersion: "mock-v1",
    platform: "linkedin",
    createdAt: 1,
  };
}

interface Harness {
  api: OptionsApi;
  settings: SettingsRepository;
  feedback: FeedbackRepository;
  cache: ClassificationCache;
  metrics: MetricsRepository;
  storage: MemoryStorageArea;
}

function createHarness(): Harness {
  const storage = new MemoryStorageArea();
  const settings = new SettingsRepository(storage);
  const platform = new PlatformSettingsRepository(storage);
  const feedback = new FeedbackRepository(storage);
  const metrics = new MetricsRepository(storage);
  const cache = new ClassificationCache(
    storage,
    { now: () => Date.now() },
    { maximumEntries: 100, ttlMs: 60_000 },
  );

  const api: OptionsApi = {
    getSettings: () => settings.get(),
    updateSettings: (update) => settings.patch(update),
    save: (value) => settings.save(value),
    resetSettings: () => settings.reset(),
    clearFeedback: () => feedback.clear(),
    clearCache: () => cache.clear(),
    clearMetrics: () => metrics.clear(),
    async getPlatformSettings(platformId) {
      return (await platform.get(platformId)) ?? null;
    },
    savePlatformSettings: (value) => platform.save(value),
    resetPlatformSettings: (platformId) => platform.remove(platformId),
  };

  return { api, settings, feedback, cache, metrics, storage };
}

describe("options settings round-trip", () => {
  afterEach(cleanup);

  it("persists an edited general setting through the validated repository", async () => {
    const { api, settings } = createHarness();
    render(createElement(OptionsApp, { api }));

    fireEvent.change(await screen.findByLabelText("Mínimo de palavras"), {
      target: { value: "150" },
    });

    await waitFor(async () =>
      expect((await settings.get()).minimumWordCount).toBe(150),
    );
  });

  it("persists an ordered threshold set atomically through save", async () => {
    const { api, settings } = createHarness();
    render(createElement(OptionsApp, { api }));

    fireEvent.change(await screen.findByLabelText("Limiar de desfoque"), {
      target: { value: "0.93" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(async () =>
      expect((await settings.get()).blurThreshold).toBe(0.93),
    );
  });

  it("rejects an out-of-order threshold change without mutating storage", async () => {
    const { api, settings } = createHarness();
    render(createElement(OptionsApp, { api }));

    fireEvent.change(await screen.findByLabelText("Limiar de desfoque"), {
      target: { value: "0.70" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/ordem dos limiares/u);
    expect((await settings.get()).blurThreshold).toBe(
      DEFAULT_SETTINGS.blurThreshold,
    );
  });

  it("clears only the feedback store when confirmed, leaving settings intact", async () => {
    const { api, settings, feedback } = createHarness();
    await settings.patch({ minimumWordCount: 250 });
    await feedback.add(feedbackRecord());
    expect(await feedback.list()).toHaveLength(1);

    render(createElement(OptionsApp, { api }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar feedback" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar limpeza de feedback" }),
    );

    await waitFor(async () => expect(await feedback.list()).toHaveLength(0));
    expect((await settings.get()).minimumWordCount).toBe(250);
  });
});
