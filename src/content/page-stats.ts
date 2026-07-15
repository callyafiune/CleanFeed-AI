import type {
  ClassificationResult,
  PageStats,
  PresentationMode,
} from "@/shared/types";

const EMPTY_PAGE_STATS: PageStats = {
  platform: null,
  postsFound: 0,
  analyzed: 0,
  skippedByLength: 0,
  skippedByLanguage: 0,
  marked: 0,
  blurred: 0,
  collapsed: 0,
  hidden: 0,
  restored: 0,
  averageInferenceMs: 0,
  queueSize: 0,
};

/** In-memory counters for the current page only. No text or URLs are retained. */
export class PageStatsStore {
  private readonly value: PageStats;
  private totalInferenceMs = 0;

  constructor(platform: string | null = null) {
    this.value = { ...EMPTY_PAGE_STATS, platform };
  }

  postFound(): void {
    this.value.postsFound += 1;
  }

  queued(): void {
    this.value.queueSize += 1;
  }

  dequeued(): void {
    this.value.queueSize = Math.max(0, this.value.queueSize - 1);
  }

  skippedByLength(): void {
    this.value.skippedByLength += 1;
  }

  skippedByLanguage(): void {
    this.value.skippedByLanguage += 1;
  }

  classified(
    result: ClassificationResult,
    mode: PresentationMode | null,
  ): void {
    this.value.analyzed += 1;
    this.totalInferenceMs += result.processingTimeMs;
    this.value.averageInferenceMs = this.totalInferenceMs / this.value.analyzed;
    if (mode === null) return;

    this.value.marked += 1;
    if (mode === "blur") this.value.blurred += 1;
    if (mode === "collapse") this.value.collapsed += 1;
    if (mode === "hide") this.value.hidden += 1;
  }

  restored(): void {
    this.value.restored += 1;
  }

  snapshot(): PageStats {
    return { ...this.value };
  }
}
