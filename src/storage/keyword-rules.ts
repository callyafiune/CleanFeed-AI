import { validateRegexPattern } from "@/rules/regex-safety";
import {
  type KeywordMatchType,
  type KeywordRule,
  type KeywordRuleAction,
} from "@/rules/rule-engine";
import type { StorageArea } from "@/storage/storage-area";

const KEYWORD_RULES_KEY = "cleanfeed.keyword-rules.v1";
const SCHEMA_VERSION = 1;

const MAX_RULES = 500;
const MAX_ID_LENGTH = 128;
const MIN_PATTERN_LENGTH = 1;
const MAX_PATTERN_LENGTH = 256;
const MIN_PLATFORMS = 1;
const MAX_PLATFORMS = 20;

/**
 * Platform ids a rule may target. Kept as a small allowlist so a rule can never
 * be scoped to an unknown or free-form platform string.
 */
export const KNOWN_PLATFORM_IDS = ["linkedin", "manual"] as const;

const matchTypes = [
  "contains",
  "exact",
  "regex",
] as const satisfies readonly KeywordMatchType[];

const actions = [
  "label",
  "blur",
  "collapse",
  "hide",
] as const satisfies readonly KeywordRuleAction[];

const RULE_KEYS = [
  "id",
  "pattern",
  "matchType",
  "caseSensitive",
  "action",
  "platforms",
  "enabled",
] as const;

interface PersistedRules {
  schemaVersion: typeof SCHEMA_VERSION;
  rules: KeywordRule[];
}

export interface KeywordRuleRepositoryOptions {
  maximumRules?: number;
  /** Local, non-identifying diagnostic sink for disabled invalid rules. */
  logInvalidRule?: (ruleId: string, reason: string) => void;
}

/**
 * Bounded, local-only store of personal keyword rules. Mirrors the other
 * repositories: one versioned serialized value, an allowlisted validator, a
 * serialized mutation queue and versioned recovery. A regex rule whose pattern
 * fails the safety validator is stored DISABLED and logged locally rather than
 * rejected, so it never runs and never affects AI classification.
 */
export class KeywordRuleRepository {
  private mutation = Promise.resolve();
  private readonly maximumRules: number;
  private readonly logInvalidRule: (ruleId: string, reason: string) => void;

  constructor(
    private readonly storage: StorageArea,
    options: KeywordRuleRepositoryOptions = {},
  ) {
    const maximumRules = options.maximumRules ?? MAX_RULES;
    if (!Number.isSafeInteger(maximumRules) || maximumRules < 1) {
      throw new RangeError("maximumRules must be a positive safe integer.");
    }
    this.maximumRules = maximumRules;
    this.logInvalidRule =
      options.logInvalidRule ??
      ((ruleId, reason) => {
        // Local, non-identifying diagnostic only (rule id + reason, never text).
        console.warn(`CleanFeed disabled invalid rule ${ruleId}: ${reason}`);
      });
  }

  list(): Promise<KeywordRule[]> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return persisted.rules.map(sanitize);
    });
  }

  /** Adds or replaces a rule (matched by id), enforcing the whole ruleset cap. */
  add(rule: KeywordRule): Promise<void> {
    const prepared = this.prepare(rule);
    if (prepared === undefined) {
      return Promise.reject(new Error("INVALID_KEYWORD_RULE"));
    }
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const withoutPrevious = persisted.rules.filter(
        (entry) => entry.id !== prepared.id,
      );
      if (withoutPrevious.length + 1 > this.maximumRules) {
        throw new Error("TOO_MANY_KEYWORD_RULES");
      }
      await this.persist([...withoutPrevious, prepared]);
    });
  }

  /** Replaces the whole ruleset after validating and bounding it. */
  save(rules: readonly KeywordRule[]): Promise<void> {
    if (rules.length > this.maximumRules) {
      return Promise.reject(new Error("TOO_MANY_KEYWORD_RULES"));
    }
    const prepared: KeywordRule[] = [];
    for (const rule of rules) {
      const clean = this.prepare(rule);
      if (clean === undefined) {
        return Promise.reject(new Error("INVALID_KEYWORD_RULE"));
      }
      prepared.push(clean);
    }
    return this.runMutation(() => this.persist(prepared));
  }

  remove(id: string): Promise<void> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      await this.persist(persisted.rules.filter((entry) => entry.id !== id));
    });
  }

  clear(): Promise<void> {
    return this.runMutation(() => this.storage.remove(KEYWORD_RULES_KEY));
  }

  /**
   * Validates and normalizes one rule. Returns `undefined` for a structurally
   * invalid rule; a regex rule whose pattern is unsafe is returned DISABLED and
   * logged rather than dropped.
   */
  private prepare(rule: KeywordRule): KeywordRule | undefined {
    if (!isKeywordRule(rule)) return undefined;
    const clean = sanitize(rule);
    if (clean.matchType === "regex") {
      const safety = validateRegexPattern(clean.pattern);
      if (!safety.safe) {
        this.logInvalidRule(clean.id, safety.reason ?? "UNSAFE_REGEX");
        return { ...clean, enabled: false };
      }
    }
    return clean;
  }

  private persist(rules: KeywordRule[]): Promise<void> {
    return this.storage.set<PersistedRules>(KEYWORD_RULES_KEY, {
      schemaVersion: SCHEMA_VERSION,
      rules: rules.slice(0, this.maximumRules),
    });
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readPersisted(): Promise<PersistedRules> {
    const value = await this.storage.get<unknown>(KEYWORD_RULES_KEY);
    if (value === undefined) {
      return { schemaVersion: SCHEMA_VERSION, rules: [] };
    }
    if (!isPersistedRules(value)) {
      await this.storage.remove(KEYWORD_RULES_KEY);
      return { schemaVersion: SCHEMA_VERSION, rules: [] };
    }
    return value;
  }
}

function sanitize(rule: KeywordRule): KeywordRule {
  return {
    id: rule.id,
    pattern: rule.pattern,
    matchType: rule.matchType,
    caseSensitive: rule.caseSensitive,
    action: rule.action,
    platforms: [...rule.platforms],
    enabled: rule.enabled,
  };
}

function isKeywordRule(value: unknown): value is KeywordRule {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== RULE_KEYS.length ||
    !RULE_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }
  return (
    isBoundedString(value.id, MAX_ID_LENGTH) &&
    isBoundedString(value.pattern, MAX_PATTERN_LENGTH, MIN_PATTERN_LENGTH) &&
    matchTypes.includes(value.matchType as KeywordMatchType) &&
    typeof value.caseSensitive === "boolean" &&
    actions.includes(value.action as KeywordRuleAction) &&
    typeof value.enabled === "boolean" &&
    isPlatformList(value.platforms)
  );
}

function isPlatformList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_PLATFORMS &&
    value.length <= MAX_PLATFORMS &&
    value.every((platform) =>
      (KNOWN_PLATFORM_IDS as readonly string[]).includes(platform as string),
    )
  );
}

function isPersistedRules(value: unknown): value is PersistedRules {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(value.rules) &&
    value.rules.every(isKeywordRule)
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  minimumLength = 1,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
