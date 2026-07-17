import { PageStatsStore } from "@/content/page-stats";
import { resolveMode } from "@/content/presentation/presentation-controller";
import { SessionState } from "@/content/session-state";
import {
  createPostIntersectionObserver,
  type PostIntersectionObserver,
  type PostViewportChange,
} from "@/content/observers/intersection-observer";
import {
  createFeedMutationObserver,
  type FeedMutationObserver,
} from "@/content/observers/mutation-observer";
import { evaluateEligibility } from "@/inference/eligibility";
import type { EffectiveSettings } from "@/shared/settings-types";
import { sha256 } from "@/shared/hashing";
import { parseExtensionMessage } from "@/shared/message-validation";
import { normalizeText } from "@/shared/text-normalization";
import type { ClassificationResult, PlatformAdapter } from "@/shared/types";

export type IntersectionObserverFactory = (
  callback: (changes: PostViewportChange[]) => void,
) => PostIntersectionObserver;

export type RuntimeMessageSender = (message: unknown) => Promise<unknown>;

type PostState =
  | "observed"
  | "queued"
  | "classifying"
  | "classified"
  | "skipped"
  | "cancelled"
  | "failed";

interface PostRuntimeState {
  state: PostState;
  cancelled: boolean;
  presentationApplied: boolean;
  hash?: string;
}

export interface PostControllerOptions {
  adapter: PlatformAdapter;
  settings: EffectiveSettings;
  document?: Document;
  createIntersectionObserver?: IntersectionObserverFactory;
  sendMessage?: RuntimeMessageSender;
  session?: SessionState;
  stats?: PageStatsStore;
  modelAvailable?: () => boolean;
  hashText?: (text: string) => Promise<string>;
}

/** Coordinates one page's visible posts without retaining their source text. */
export class PostController {
  readonly stats: PageStatsStore;

  private readonly document: Document;
  private readonly createIntersectionObserver: IntersectionObserverFactory;
  private readonly sendMessage: RuntimeMessageSender;
  private readonly session: SessionState;
  private readonly modelAvailable: () => boolean;
  private readonly hashText: (text: string) => Promise<string>;
  private readonly states = new WeakMap<HTMLElement, PostRuntimeState>();
  private readonly observed = new Set<HTMLElement>();
  private observer: PostIntersectionObserver | undefined;
  private mutationObserver: FeedMutationObserver | undefined;
  private rootObserver: MutationObserver | undefined;
  private requestSequence = 0;
  private running = false;

  constructor(private readonly options: PostControllerOptions) {
    this.document = options.document ?? document;
    this.createIntersectionObserver =
      options.createIntersectionObserver ?? createPostIntersectionObserver;
    this.sendMessage =
      options.sendMessage ?? ((message) => chrome.runtime.sendMessage(message));
    this.session = options.session ?? new SessionState();
    this.stats = options.stats ?? new PageStatsStore(options.adapter.id);
    this.modelAvailable = options.modelAvailable ?? (() => true);
    this.hashText = options.hashText ?? sha256;
  }

  start(): void {
    if (this.observer !== undefined) return;
    this.running = true;
    this.observer = this.createIntersectionObserver((changes) => {
      changes.forEach((change) => this.handleViewportChange(change));
    });
    if (!this.attachFeedRoot()) this.observeFeedRootArrival();
  }

  stop(): void {
    this.running = false;
    for (const element of this.observed) {
      const state = this.states.get(element);
      if (state?.state !== "queued" && state?.state !== "classifying") continue;
      state.cancelled = true;
      if (state.state === "queued") this.stats.dequeued();
      state.state = "cancelled";
      element.dataset.cleanfeedState = "cancelled";
    }
    this.observer?.disconnect();
    this.observer = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.rootObserver?.disconnect();
    this.rootObserver = undefined;
    this.observed.clear();
  }

  observeCandidates(root: ParentNode): void {
    for (const element of this.options.adapter.findPostElements(root)) {
      if (this.observed.has(element)) continue;
      this.observed.add(element);
      this.states.set(element, {
        state: "observed",
        cancelled: false,
        presentationApplied: false,
      });
      element.dataset.cleanfeedState = "observed";
      this.stats.postFound();
      this.observer?.observe(element);
    }
  }

  clearPresentation(): void {
    for (const element of this.observed) {
      const state = this.states.get(element);
      if (state?.presentationApplied !== true) continue;
      this.options.adapter.restorePresentation(element);
      state.presentationApplied = false;
      this.stats.restored();
    }
  }

  private attachFeedRoot(): boolean {
    if (this.mutationObserver !== undefined) return true;
    const root = this.options.adapter.findFeedRoot(this.document);
    if (root === null) return false;

    this.observeCandidates(root);
    this.mutationObserver = createFeedMutationObserver(root, (candidates) => {
      candidates.forEach((candidate) => this.observeCandidates(candidate));
    });
    this.rootObserver?.disconnect();
    this.rootObserver = undefined;
    return true;
  }

  private observeFeedRootArrival(): void {
    this.rootObserver?.disconnect();
    this.rootObserver = new MutationObserver(() => {
      if (this.running) this.attachFeedRoot();
    });
    this.rootObserver.observe(this.document, {
      childList: true,
      subtree: true,
    });
  }

  private handleViewportChange({
    element,
    nearViewport,
  }: PostViewportChange): void {
    const state = this.states.get(element);
    if (state === undefined) return;
    if (!nearViewport) {
      if (state.state === "queued") {
        state.cancelled = true;
        state.state = "cancelled";
        this.stats.dequeued();
        element.dataset.cleanfeedState = "cancelled";
      }
      return;
    }
    if (state.state !== "observed") return;

    state.state = "queued";
    element.dataset.cleanfeedState = "queued";
    this.stats.queued();
    queueMicrotask(() => void this.process(element, state));
  }

  private async process(
    element: HTMLElement,
    state: PostRuntimeState,
  ): Promise<void> {
    if (!this.running || state.cancelled || state.state !== "queued") return;
    state.state = "classifying";
    this.stats.dequeued();
    element.dataset.cleanfeedState = "classifying";

    const extracted = this.options.adapter.extractPost(element);
    const text = extracted === null ? "" : normalizeText(extracted.text);
    const hash = text.length === 0 ? undefined : await this.hashText(text);
    if (!this.running || state.cancelled || state.state !== "classifying")
      return;
    const eligibility = evaluateEligibility({
      text,
      enabled: this.options.settings.enabled,
      domainEnabled: true,
      modelAvailable: this.modelAvailable(),
      extractionSucceeded: extracted !== null,
      duplicateContent: hash !== undefined && this.session.hasSeen(hash),
      experimentalShortTextDetection:
        this.options.settings.experimentalShortTextDetection,
      minimumWordCount: this.options.settings.minimumWordCount,
    });
    if (!eligibility.eligible) {
      state.state = "skipped";
      element.dataset.cleanfeedState = eligibility.reason
        .toLowerCase()
        .replaceAll("_", "-");
      if (eligibility.reason === "BELOW_MINIMUM_LENGTH")
        this.stats.skippedByLength();
      if (eligibility.reason === "UNSUPPORTED_LANGUAGE")
        this.stats.skippedByLanguage();
      return;
    }
    if (
      hash === undefined ||
      !this.running ||
      state.cancelled ||
      !element.isConnected
    )
      return;

    state.hash = hash;
    this.session.remember(hash);
    try {
      const response = await this.sendMessage({
        source: "content",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId: `${this.options.adapter.id}-${++this.requestSequence}`,
        payload: { text, platform: this.options.adapter.id, manual: false },
      });
      const result = classificationResult(response);
      if (result === null || !(await this.isCurrent(element, state))) return;

      const mode = resolveMode(result, this.options.settings);
      this.options.adapter.applyPresentation(
        element,
        result,
        this.options.settings,
      );
      state.presentationApplied = mode !== null;
      state.state = "classified";
      element.dataset.cleanfeedState = "classified";
      this.stats.classified(result, mode);
    } catch {
      if (this.running && element.isConnected && !state.cancelled) {
        state.state = "failed";
        element.dataset.cleanfeedState = "classification-failed";
      }
    }
  }

  private async isCurrent(
    element: HTMLElement,
    state: PostRuntimeState,
  ): Promise<boolean> {
    if (
      !this.running ||
      !element.isConnected ||
      state.cancelled ||
      state.hash === undefined
    )
      return false;
    const current = this.options.adapter.extractPost(element);
    if (current === null) return false;
    const currentHash = await this.hashText(normalizeText(current.text));
    return (
      this.running &&
      element.isConnected &&
      !state.cancelled &&
      state.state === "classifying" &&
      currentHash === state.hash
    );
  }
}

function classificationResult(response: unknown): ClassificationResult | null {
  try {
    const message = parseExtensionMessage(response);
    return message.type === "CLASSIFICATION_RESULT" &&
      message.source === "background"
      ? message.payload
      : null;
  } catch {
    return null;
  }
}
