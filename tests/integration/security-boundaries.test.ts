import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../manifest.config";
import { installChromeStorageMock } from "../setup/chrome";
import { createExplanationPanel } from "@/content/presentation/explanation-panel";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ClassificationResult } from "@/shared/types";
import { buildCacheKey, ClassificationCache } from "@/storage/cache";
import { DomainPauseRepository } from "@/storage/domain-pause";
import { FeedbackRepository } from "@/storage/feedback";
import { MetricsRepository } from "@/storage/metrics";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea } from "@/storage/storage-area";
import { DEFAULT_SETTINGS } from "@/shared/constants";

// Vitest runs from the project root (where vitest.config.ts lives), so the
// source tree is a stable relative path from there.
const SRC_ROOT = join(process.cwd(), "src");
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css", ".html"];

/** Patterns that would introduce dynamic code execution or HTML sinks. */
const FORBIDDEN_PATTERNS: { name: string; expression: RegExp }[] = [
  { name: "eval(", expression: /\beval\s*\(/ },
  { name: "new Function(", expression: /\bnew\s+Function\s*\(/ },
  { name: "innerHTML", expression: /\binnerHTML\b/ },
  { name: "outerHTML", expression: /\bouterHTML\b/ },
  { name: "insertAdjacentHTML", expression: /\binsertAdjacentHTML\b/ },
  { name: "document.write", expression: /\bdocument\s*\.\s*write\b/ },
  {
    name: "dangerouslySetInnerHTML",
    expression: /\bdangerouslySetInnerHTML\b/,
  },
];

/** Storage keys that would identify an author and must never be persisted. */
const FORBIDDEN_STORAGE_KEYS = ["authorName", "authorId", "profileUrl"];

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

function makeResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.94,
    humanScore: 0.06,
    confidence: "high",
    status: "strong_ai_indication",
    wordCount: 130,
    tokenCount: 130,
    runtimeIdentity: {
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    },
    evidence: {
      quality: "limited",
      coverage: 1,
      lexicalRatio: 1,
      truncated: false,
      exactTokenizer: false,
      reasonCodes: [],
    },
    decision: {
      status: "strong_ai_indication",
      calibratedScore: 0.94,
      actionCeiling: "hide",
      abstained: false,
      presentationAllowed: true,
      triggers: [],
      reasonCodes: [],
    },
    modelVersion: "mock-v1",
    modelId: "mock-detector",
    backend: "mock",
    processingTimeMs: 5,
    demo: true,
    ...overrides,
  };
}

describe("security boundaries", () => {
  describe("source tree", () => {
    it("contains no eval, new Function, or HTML-injection sinks in src/", () => {
      const offences: string[] = [];
      for (const file of collectSourceFiles(SRC_ROOT)) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/u);
        lines.forEach((line, index) => {
          for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.expression.test(line)) {
              offences.push(`${file}:${index + 1} → ${pattern.name}`);
            }
          }
        });
      }
      expect(offences).toEqual([]);
    });
  });

  describe("presentation copy never claims authorship or shows a feed score", () => {
    // Fail-closed presentation: the UI states probabilistic signals, never that
    // a text "is AI", and never renders the raw/calibrated score in the feed.
    // These are the exact phrasings retired when copy was centralized.
    const FORBIDDEN_COPY: { name: string; expression: RegExp }[] = [
      { name: "Possivelmente gerado", expression: /Possivelmente gerado/u },
      { name: "Fortes indícios de IA", expression: /Fortes indícios de IA/u },
      { name: "Era humano", expression: /Era humano/u },
      { name: "Era IA", expression: /Era IA/u },
      {
        name: "Math.round(result.aiScore",
        expression: /Math\.round\(result\.aiScore/u,
      },
      { name: "foi escrito por IA", expression: /foi escrito por IA/u },
      {
        name: "comprovadamente artificial",
        expression: /comprovadamente artificial/u,
      },
    ];

    it("has no definitive authorship claim or feed score anywhere in src/", () => {
      const offences: string[] = [];
      for (const file of collectSourceFiles(SRC_ROOT)) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/u);
        lines.forEach((line, index) => {
          for (const pattern of FORBIDDEN_COPY) {
            if (pattern.expression.test(line)) {
              offences.push(`${file}:${index + 1} → ${pattern.name}`);
            }
          }
        });
      }
      expect(offences).toEqual([]);
    });

    it("surfaces the calibrated score only in the advanced diagnostic, with its caveat and no percentage", () => {
      const bundle = makeResult({
        runtimeIdentity: {
          kind: "bundle",
          modelId: "cleanfeed-ptbr-v1",
          modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
          bundleDigest: "a".repeat(64),
          tokenizerDigest: "b".repeat(64),
          aggregationVersion: "tmr-aggregation-v3",
          contentCompositionVersion: "lexical-content-v1",
          calibrationSetDigest: "c".repeat(64),
        },
        selectedProfileDigest: "d".repeat(64),
        decision: {
          status: "strong_ai_indication",
          calibratedScore: 0.84321,
          actionCeiling: "hide",
          abstained: false,
          presentationAllowed: true,
          triggers: [],
          reasonCodes: [],
        },
      });

      // Feed default (no options): no score, no authorship claim.
      const feedPanel = createExplanationPanel(bundle, {
        onFeedback: () => undefined,
      });
      expect(feedPanel.textContent).not.toMatch(
        /Score calibrado|0[.,]843|84%/u,
      );
      expect(feedPanel.textContent).not.toMatch(
        /foi escrito por IA|comprovadamente artificial/u,
      );

      // Advanced diagnostic (opt-in): calibrated score with its caveat, never %.
      const advancedPanel = createExplanationPanel(
        bundle,
        { onFeedback: () => undefined },
        { showTechnicalScore: true },
      );
      expect(advancedPanel.textContent).toContain(
        "Score calibrado do modelo: 0,843",
      );
      expect(advancedPanel.textContent).toContain(
        "Este score não equivale à probabilidade real de autoria por IA.",
      );
      expect(advancedPanel.textContent).not.toMatch(/84%/u);

      document.body.replaceChildren();
    });
  });

  describe("manifest hardening", () => {
    it("locks the CSP to self plus wasm, with no raw eval or inline execution", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      expect(csp).toBe(
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'",
      );
      expect(csp).toContain("'wasm-unsafe-eval'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("https:");
    });

    it("requests only the approved permission allowlist and no broad host access", () => {
      expect(manifest.permissions).toEqual([
        "storage",
        "contextMenus",
        "activeTab",
        "scripting",
        "offscreen",
      ]);
      expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/*"]);
      const serialized = JSON.stringify(manifest);
      expect(serialized).not.toContain("<all_urls>");
      expect(serialized).not.toContain("http://");
      expect(serialized).not.toContain("*://*/*");
    });
  });

  describe("storage never retains author-identifying keys", () => {
    beforeEach(() => {
      installChromeStorageMock();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("dumps only non-identifying data after exercising every repository", async () => {
      const storage = new ChromeStorageArea();

      await new SettingsRepository(storage).save(DEFAULT_SETTINGS);

      const feedbackHash = "a".repeat(64);
      await new FeedbackRepository(storage).add({
        textHash: feedbackHash,
        predictedScore: 0.91,
        predictedStatus: "possibly_ai",
        feedback: "human",
        modelVersion: "mock-v1",
        platform: "linkedin",
        createdAt: 1,
      });

      // Teeth: deliberately feed author-identifying fields the data model does
      // not have. The repository's key allowlist must strip or reject them, so
      // the FORBIDDEN_STORAGE_KEYS assertion below fails if any ever persists.
      await new FeedbackRepository(storage)
        .add({
          textHash: "b".repeat(64),
          predictedScore: 0.5,
          predictedStatus: "possibly_ai",
          feedback: "ai",
          modelVersion: "mock-v1",
          platform: "linkedin",
          createdAt: 2,
          authorName: "Jane Doe",
          authorId: "urn:li:person:42",
          profileUrl: "https://www.linkedin.com/in/jane",
        } as unknown as Parameters<FeedbackRepository["add"]>[0])
        .catch(() => undefined);

      await new MetricsRepository(storage).record({
        postsDetected: 1,
        postsAnalyzed: 1,
        status: "strong_ai_indication",
        backend: "mock",
        inferenceMs: 12,
      });

      await new DomainPauseRepository(storage).pause("www.linkedin.com");

      const cache = new ClassificationCache(
        storage,
        { now: () => 1_000 },
        { maximumEntries: 10, ttlMs: 60_000 },
      );
      await cache.set(
        buildCacheKey("linkedin", "mock:1.0.0", "v1", feedbackHash),
        makeResult(),
      );

      const dump = await chrome.storage.local.get();
      const serialized = JSON.stringify(dump);

      // We actually wrote data (guards against a vacuously-true assertion).
      expect(serialized).toContain(feedbackHash);
      for (const key of FORBIDDEN_STORAGE_KEYS) {
        expect(serialized).not.toContain(key);
      }
    });
  });

  describe("runtime message contract", () => {
    it("accepts a well-formed message from an allowed route", () => {
      expect(() =>
        parseExtensionMessage({
          source: "content",
          target: "background",
          type: "CLASSIFY_TEXT",
          requestId: "req-1",
          payload: { text: "olá mundo", platform: "linkedin", manual: false },
        }),
      ).not.toThrow();
    });

    it("rejects forged messages with INVALID_MESSAGE", () => {
      const forged: unknown[] = [
        // A message that claims to come from the page's own JavaScript.
        {
          source: "page",
          target: "background",
          type: "CLASSIFY_TEXT",
          requestId: "x",
          payload: { text: "hi", platform: "linkedin", manual: false },
        },
        // A real type over a route that is never allowed.
        {
          source: "content",
          target: "popup",
          type: "CLASSIFY_TEXT",
          requestId: "x",
          payload: { text: "hi", platform: "linkedin", manual: false },
        },
        // Prototype-pollution attempt.
        JSON.parse(
          '{"__proto__":{"polluted":true},"source":"content","target":"background","type":"GET_SETTINGS"}',
        ),
        // Unknown type.
        {
          source: "content",
          target: "background",
          type: "RUN_ARBITRARY_CODE",
          payload: {},
        },
        // Not an object at all.
        "not-a-message",
        42,
        null,
        ["content", "background"],
      ];

      for (const message of forged) {
        expect(() => parseExtensionMessage(message)).toThrow("INVALID_MESSAGE");
      }
    });
  });

  describe("explanation panel treats result fields as text", () => {
    it("injects no <img> or <script> from hostile result fields", () => {
      const panel = createExplanationPanel(
        makeResult({
          modelId: '<img src=x onerror="boom">',
          modelVersion: "<script>alert(1)</script>",
        }),
        { onFeedback: () => undefined },
      );
      document.body.append(panel);

      expect(panel.querySelector("img")).toBeNull();
      expect(panel.querySelector("script")).toBeNull();
      // The hostile string survives, but only as inert text content.
      expect(panel.textContent).toContain('<img src=x onerror="boom">');

      document.body.replaceChildren();
    });
  });
});
