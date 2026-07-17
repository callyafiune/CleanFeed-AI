import { PageStatsStore } from "@/content/page-stats";
import {
  attachExplanationDisclosure,
  getBadge,
} from "@/content/presentation/badge";
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
import { FeedbackRepository, type FeedbackVerdict } from "@/storage/feedback";
import { ChromeStorageArea } from "@/storage/storage-area";

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
  result?: ClassificationResult;
  /**
   * Set when the user explicitly re-requests analysis of an already-classified
   * post, so its own remembered hash does not make it skip as duplicate content.
   * Consumed on the next classification run.
   */
  manualRun?: boolean;
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
  feedback?: FeedbackRepository;
  now?: () => number;
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
  private readonly feedback: FeedbackRepository;
  private readonly now: () => number;
  private readonly states = new WeakMap<HTMLElement, PostRuntimeState>();
  private readonly observed = new Set<HTMLElement>();
  private contextTarget: WeakRef<HTMLElement> | undefined;
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
    this.feedback =
      options.feedback ?? new FeedbackRepository(new ChromeStorageArea());
    this.now = options.now ?? (() => Date.now());
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
    this.contextTarget = undefined;
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

  /**
   * Remembers, in memory only, the owned post element under a right-click. It
   * stores a `WeakRef` to the element and nothing else: no author, no URL, no
   * text. A node that is not inside a tracked post clears the reference.
   */
  noteContextTarget(node: EventTarget | null): void {
    const element = this.resolveObservedPost(node);
    this.contextTarget =
      element === undefined ? undefined : new WeakRef(element);
  }

  /** The still-connected, still-tracked post last right-clicked, if any. */
  getContextPost(): HTMLElement | undefined {
    const element = this.contextTarget?.deref();
    if (
      element === undefined ||
      !element.isConnected ||
      !this.observed.has(element)
    ) {
      this.contextTarget = undefined;
      return undefined;
    }
    return element;
  }

  /**
   * Records a local, hash-keyed verdict for the right-clicked post. Resolves to
   * `false` when no classified post is remembered. Never stores text or author.
   */
  async reportContextFeedback(verdict: FeedbackVerdict): Promise<boolean> {
    const element = this.getContextPost();
    if (element === undefined) return false;
    const state = this.states.get(element);
    // Require a currently-classified post so the hash and result are the
    // consistent successful pair; a re-analysis in flight (or a failed run)
    // could otherwise pair a hash with a stale or mismatched result.
    if (
      state?.state !== "classified" ||
      state.hash === undefined ||
      state.result === undefined
    ) {
      return false;
    }
    await this.recordFeedback(state.hash, state.result, verdict);
    return true;
  }

  /**
   * Re-queues the right-clicked post for a fresh classification under the
   * user's gesture. Resolves to `false` when nothing is remembered or the post
   * is already in flight.
   */
  analyzeContextPost(): boolean {
    const element = this.getContextPost();
    if (element === undefined) return false;
    const state = this.states.get(element);
    if (
      state === undefined ||
      state.state === "queued" ||
      state.state === "classifying"
    ) {
      return false;
    }
    state.state = "observed";
    state.cancelled = false;
    state.manualRun = true;
    element.dataset.cleanfeedState = "observed";
    this.handleViewportChange({ element, nearViewport: true });
    return true;
  }

  private resolveObservedPost(
    node: EventTarget | null,
  ): HTMLElement | undefined {
    let current: Node | null = node instanceof Node ? node : null;
    while (current !== null) {
      if (current instanceof HTMLElement && this.observed.has(current)) {
        return current;
      }
      current = current.parentNode;
    }
    return undefined;
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
    // A user-initiated re-analysis must not skip on its own remembered hash.
    const skipDedup = state.manualRun === true;
    state.manualRun = false;
    const eligibility = evaluateEligibility({
      text,
      enabled: this.options.settings.enabled,
      domainEnabled: true,
      modelAvailable: this.modelAvailable(),
      extractionSucceeded: extracted !== null,
      duplicateContent:
        !skipDedup && hash !== undefined && this.session.hasSeen(hash),
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
      if (mode !== null && this.options.settings.showExplanation) {
        this.attachExplanation(element, result, hash);
      }
      state.presentationApplied = mode !== null;
      state.result = result;
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

  /** Wires the badge disclosure and routes verdicts to hash-keyed feedback. */
  private attachExplanation(
    element: HTMLElement,
    result: ClassificationResult,
    hash: string,
  ): void {
    const badge = getBadge(element);
    if (badge === undefined) return;
    attachExplanationDisclosure(element, badge, result, {
      onFeedback: (verdict) => this.recordFeedback(hash, result, verdict),
    });
  }

  /** Stores a local, non-identifying verdict; storage failures are ignored. */
  private recordFeedback(
    hash: string,
    result: ClassificationResult,
    verdict: FeedbackVerdict,
  ): Promise<void> {
    return this.feedback
      .add({
        textHash: hash,
        predictedScore: result.decision?.calibratedScore ?? result.aiScore,
        predictedStatus: result.status,
        feedback: verdict,
        modelVersion: result.modelVersion,
        platform: this.options.adapter.id,
        createdAt: this.now(),
      })
      .catch(() => undefined);
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
