import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachContextMenuTracking,
  type ContextTrackingController,
} from "@/content/content-script";
import {
  PostController,
  type IntersectionObserverFactory,
} from "@/content/post-controller";
import { MockClassifier } from "@/inference/mock-classifier";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, Clock } from "@/shared/types";
import { buildCacheKey, ClassificationCache } from "@/storage/cache";
import { FeedbackRepository } from "@/storage/feedback";
import { HistoryRepository } from "@/storage/history";
import { MetricsRepository } from "@/storage/metrics";
import type { StorageArea } from "@/storage/storage-area";

/**
 * The three pieces of personal data that must NEVER reach local storage by
 * default: the post author's display name, their full profile URL, and the
 * verbatim post text. They are placed on the fixture DOM (author/URL) and fed
 * to the pipeline (text); the audit asserts none of them survive a full,
 * representative session in the storage dump.
 */
const AUTHOR_NAME = "Mariana Prevent Autora";
const PROFILE_URL = "https://www.linkedin.com/in/mariana-prevent-autora-12345";
const PORTUGUESE_LONG_TEXT = [
  "Compartilho hoje uma reflexão sincera sobre disciplina, aprendizado contínuo",
  "e a importância de processos claros dentro de qualquer equipe madura de tecnologia.",
  "Ao longo dos últimos anos percebi que resultados sustentáveis nascem de rotinas",
  "simples, de comunicação honesta e da revisão constante das nossas próprias decisões.",
  "Cada projeto entregue trouxe lições práticas sobre prioridade, foco, colaboração",
  "e respeito ao tempo das pessoas envolvidas em cada etapa dessa jornada compartilhada.",
  "Acredito que a transparência gera confiança, e que a confiança acelera qualquer",
  "iniciativa coletiva que realmente pretenda durar e evoluir com método e clareza.",
  "Registro também que o planejamento cuidadoso, a execução paciente e a análise honesta",
  "dos erros formam a base de toda a melhoria contínua que buscamos alcançar juntos.",
].join(" ");

/** A valid 64-hex SHA-256 stand-in, so the run never depends on Web Crypto. */
const POST_HASH = "b".repeat(64);

const NOW = 20_000 * 86_400_000;
const clock: Clock = { now: () => NOW };

const MODEL_KEY = "mock:1.0.0";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    // Round-trip through JSON so the dump reflects exactly what chrome.storage
    // would persist (no live object references that could hide a leak).
    this.values.set(key, JSON.parse(JSON.stringify(value)));
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

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}

class FakeIntersectionObserver {
  constructor(
    private readonly callback: (
      changes: { element: HTMLElement; nearViewport: boolean }[],
    ) => void,
  ) {}

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  emit(element: HTMLElement, nearViewport: boolean): void {
    this.callback([{ element, nearViewport }]);
  }
}

function result(): ClassificationResult {
  return {
    aiScore: 0.84,
    humanScore: 0.16,
    confidence: "medium",
    status: "possibly_ai",
    wordCount: 130,
    tokenCount: 140,
    modelVersion: "mock-v1",
    modelId: "mock",
    backend: "mock",
    processingTimeMs: 9,
    demo: true,
  };
}

function classificationResponse(): unknown {
  return {
    source: "background",
    target: "content",
    type: "CLASSIFICATION_RESULT",
    requestId: "request-1",
    payload: result(),
  };
}

/** Builds a LinkedIn-shaped post carrying the author name, profile URL and text. */
function buildPost(document: Document): {
  article: HTMLElement;
  commentary: HTMLElement;
} {
  const article = document.createElement("article");
  article.dataset.urn = "urn:li:activity:privacy-audit";
  article.innerHTML = `
    <header data-test-node="author">
      <a href="${PROFILE_URL}">${AUTHOR_NAME}</a>
    </header>
    <div class="update-components-text">${PORTUGUESE_LONG_TEXT}</div>
    <div data-test-actions data-test-node="buttons">
      <button type="button">Curtir</button>
    </div>`;
  const commentary = article.querySelector<HTMLElement>(
    ".update-components-text",
  )!;
  return { article, commentary };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rightClick(target: Element): void {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
}

interface SessionResult {
  storage: MemoryStorageArea;
  feedback: FeedbackRepository;
  history: HistoryRepository;
}

/**
 * Runs a representative CleanFeed session against in-memory storage: it
 * classifies a post, records opt-in history, reveals (restores) it, and submits
 * user feedback — exercising every repository that persists per-post data.
 */
async function runRepresentativeSession(): Promise<SessionResult> {
  const storage = new MemoryStorageArea();
  const feedback = new FeedbackRepository(storage);
  // History is exercised with the OPT-IN flag ON to prove that even an enabled
  // history stores neither text nor author nor URL (text stays off).
  const history = new HistoryRepository(storage, clock);
  const metrics = new MetricsRepository(storage);
  const cache = new ClassificationCache(storage, clock, {
    maximumEntries: DEFAULT_SETTINGS.cacheMaximumEntries,
    ttlMs: DEFAULT_SETTINGS.cacheTtlMs,
  });

  const settings: EffectiveSettings = {
    ...DEFAULT_SETTINGS,
    presentationMode: "blur",
    historyEnabled: true,
    storeFullText: false,
  };

  const { article, commentary } = buildPost(document);
  const root = document.createElement("main");
  root.append(article);
  document.body.append(root);

  let intersection: FakeIntersectionObserver | undefined;
  const createIntersectionObserver: IntersectionObserverFactory = (callback) =>
    (intersection = new FakeIntersectionObserver(callback));

  const controller = new PostController({
    adapter: new LinkedInAdapter(),
    document,
    settings,
    createIntersectionObserver,
    sendMessage: vi.fn().mockResolvedValue(classificationResponse()),
    hashText: async () => POST_HASH,
    feedback,
    history,
    now: () => NOW,
  });
  const detach = attachContextMenuTracking(
    document,
    () => controller as unknown as ContextTrackingController,
  );
  controller.start();

  // Classify the visible post (records an opt-in, text-free history row).
  intersection!.emit(article, true);
  await flushPromises();

  // Submit local feedback for the right-clicked post (hash-keyed only).
  rightClick(commentary);
  await controller.reportContextFeedback("human");

  // Reveal: restore the post to its original state (drops the presentation).
  controller.clearPresentation();

  // Exercise the aggregate metrics and the classification cache directly, since
  // in production the background writes both on the same classification.
  await metrics.record({
    postsDetected: 1,
    postsAnalyzed: 1,
    revealedPosts: 1,
    status: "possibly_ai",
    backend: "mock",
    inferenceMs: 9,
    model: MODEL_KEY,
  });
  // Classify the hostile post text through the REAL mock classifier and cache
  // the genuine result, so the classification cache is audited against actual
  // pipeline output — not a hand-built, text-free stand-in. ClassificationCache
  // persists the result verbatim, so any text the classifier embedded would
  // surface in the storage dump below.
  const classifier = new MockClassifier();
  await classifier.initialize();
  const realResult = await classifier.classify(PORTUGUESE_LONG_TEXT);
  await cache.set(
    buildCacheKey("linkedin", MODEL_KEY, "settings-fp", POST_HASH),
    realResult,
  );

  detach();
  return { storage, feedback, history };
}

describe("storage privacy audit", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("storage contains no author identity, full URL or text by default", async () => {
    const { storage, feedback, history } = await runRepresentativeSession();
    const dump = JSON.stringify(storage.dump());

    // The session must actually have persisted something, so the assertions
    // below are not vacuously true.
    expect(Object.keys(storage.dump()).length).toBeGreaterThan(0);

    expect(dump).not.toContain(AUTHOR_NAME);
    expect(dump).not.toContain(PROFILE_URL);
    expect(dump).not.toContain(PORTUGUESE_LONG_TEXT.slice(0, 50));

    // A weaker but still-telling check: not even the profile handle survives.
    expect(dump).not.toContain("mariana-prevent-autora");

    // Feedback was recorded, keyed only by the content hash.
    const feedbackRecords = await feedback.list();
    expect(feedbackRecords).toHaveLength(1);
    expect(feedbackRecords[0]).toMatchObject({
      textHash: POST_HASH,
      feedback: "human",
      predictedStatus: "possibly_ai",
      platform: "linkedin",
    });
    expect(Object.keys(feedbackRecords[0]!)).not.toContain("text");

    // Opt-in history recorded exactly one text-free row for the same hash.
    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textHash).toBe(POST_HASH);
    expect(rows.every((row) => !("text" in row))).toBe(true);
  });
});
