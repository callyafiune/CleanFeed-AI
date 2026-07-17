import { validateRegexPattern } from "@/rules/regex-safety";
import {
  MAX_RULE_TEXT_LENGTH,
  RuleWorkerClient,
} from "@/rules/rule-worker-client";

/**
 * Evaluates a page's personal keyword rules against normalized post text. The
 * result it produces is deliberately SEPARATE from any AI `ClassificationResult`:
 * it carries no score, only which rule fired and the action to take, plus a
 * fixed label that never describes the match as AI detection. `contains` and
 * `exact` rules are bounded, linear string comparisons on the main thread;
 * `regex` rules are delegated to the disposable worker so untrusted patterns
 * never compile or run here.
 */

export type KeywordMatchType = "contains" | "exact" | "regex";
export type KeywordRuleAction = "label" | "blur" | "collapse" | "hide";

export interface KeywordRule {
  id: string;
  pattern: string;
  matchType: KeywordMatchType;
  caseSensitive: boolean;
  action: KeywordRuleAction;
  platforms: string[];
  enabled: boolean;
}

/** The user-facing label shown for any post filtered by a personal rule. */
export const PERSONAL_RULE_LABEL =
  "Conteúdo filtrado por uma regra personalizada." as const;

/**
 * Outcome of evaluating a post against the personal rules. It never carries an
 * `aiScore` or any classification status — a rule match is not AI detection.
 */
export interface RuleMatchResult {
  matched: boolean;
  ruleId?: string;
  action?: KeywordRuleAction;
  label?: typeof PERSONAL_RULE_LABEL;
}

export interface RuleEngineOptions {
  /** Injected for tests; created lazily on first regex rule otherwise. */
  workerClient?: RuleWorkerClient;
}

export class RuleEngine {
  private workerClient: RuleWorkerClient | undefined;

  constructor(options: RuleEngineOptions = {}) {
    this.workerClient = options.workerClient;
  }

  /**
   * Returns the first applicable rule that matches `text` for `platform`, or an
   * unmatched result. Disabled rules and rules that do not target the platform
   * are skipped. The text is capped so evaluation stays bounded.
   */
  async evaluate(
    text: string,
    platform: string,
    rules: readonly KeywordRule[],
  ): Promise<RuleMatchResult> {
    const capped = text.slice(0, MAX_RULE_TEXT_LENGTH);
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!rule.platforms.includes(platform)) continue;
      try {
        if (await this.matches(rule, capped)) {
          return {
            matched: true,
            ruleId: rule.id,
            action: rule.action,
            label: PERSONAL_RULE_LABEL,
          };
        }
      } catch {
        // A single regex rule whose worker times out or is unavailable is
        // isolated: it simply does not match, and evaluation continues with the
        // remaining rules. A rule failure must never abort the ruleset or
        // surface into AI classification.
        continue;
      }
    }
    return { matched: false };
  }

  /** Releases the regex worker if one was created. */
  dispose(): void {
    this.workerClient?.dispose();
    this.workerClient = undefined;
  }

  private matches(rule: KeywordRule, text: string): Promise<boolean> {
    if (rule.matchType === "contains") {
      return Promise.resolve(matchesContains(rule, text));
    }
    if (rule.matchType === "exact") {
      return Promise.resolve(matchesExact(rule, text));
    }
    // A pattern that fails the safety validator never matches and is never sent
    // to the worker; the repository disables such rules and logs them locally.
    if (!validateRegexPattern(rule.pattern).safe) return Promise.resolve(false);
    return this.client().match(rule, text);
  }

  private client(): RuleWorkerClient {
    this.workerClient ??= new RuleWorkerClient();
    return this.workerClient;
  }
}

function matchesContains(rule: KeywordRule, text: string): boolean {
  if (rule.caseSensitive) return text.includes(rule.pattern);
  return text.toLowerCase().includes(rule.pattern.toLowerCase());
}

function matchesExact(rule: KeywordRule, text: string): boolean {
  if (rule.caseSensitive) return text === rule.pattern;
  return text.toLowerCase() === rule.pattern.toLowerCase();
}
