import type { PlatformSettings, UserSettings } from "@/shared/settings-types";
import type { HistoryEntry } from "@/shared/types";
import type { FeedbackRecord } from "@/storage/feedback";
import type { KeywordRule } from "@/rules/rule-engine";

/**
 * The export schema version this build WRITES. Reading additionally accepts the
 * previous v1 (its settings are normalized on import — the legacy decision
 * thresholds are dropped), but a file carrying any other value is rejected
 * rather than guessed at.
 */
export const EXPORT_SCHEMA_VERSION = 2;

/** Every export schema version this build can READ (v1 is normalized on apply). */
export const SUPPORTED_IMPORT_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([
  1, 2,
]);

/** Hard cap on the raw import size, enforced BEFORE `JSON.parse`. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Maximum object/array nesting depth accepted by the validator. */
export const MAX_IMPORT_DEPTH = 20;

/**
 * Per-category upper bounds. These mirror the limits enforced by the storage
 * repositories, restated here so the validator can reject an oversized payload
 * WITHOUT constructing a repository, compiling a regex or touching storage.
 */
export const MAX_KEYWORD_RULES = 500;
export const MAX_KEYWORD_PATTERN_LENGTH = 256;
export const MAX_FEEDBACK_RECORDS = 2_000;
export const MAX_HISTORY_ENTRIES = 10_000;
export const MAX_PLATFORM_ENTRIES = 100;

/**
 * Keys that could poison an object's prototype chain. They are rejected
 * recursively at every node, so a crafted payload can never reach the apply
 * phase — let alone `Object.prototype`.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The versioned envelope produced by {@link buildExport} and accepted by the
 * importer. Categories the user did not select are absent (`undefined`). Cache,
 * post text and domain settings are NEVER represented here; history rows are
 * text-free.
 */
export interface ExtensionExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  settings?: UserSettings;
  platformSettings?: Record<string, PlatformSettings>;
  keywordRules?: KeywordRule[];
  feedback?: FeedbackRecord[];
  history?: HistoryEntry[];
  /** Opaque persisted metrics blob; validated structurally, not by shape. */
  metrics?: unknown;
}

export interface ExportValidationSuccess {
  ok: true;
  value: ExtensionExport;
}

export interface ExportValidationFailure {
  ok: false;
  reason: string;
}

export type ExportValidationResult =
  ExportValidationSuccess | ExportValidationFailure;

/**
 * A PURE structural validator for an import file. It NEVER compiles a regex,
 * executes content or writes storage. It only:
 *
 * 1. rejects anything above the {@link MAX_IMPORT_BYTES} cap, checked before
 *    `JSON.parse` so an oversized string is never parsed;
 * 2. rejects non-JSON and non-object payloads;
 * 3. rejects prototype-pollution keys recursively and objects nested past
 *    {@link MAX_IMPORT_DEPTH};
 * 4. rejects an unknown/unsupported `schemaVersion`;
 * 5. rejects category arrays above their documented maxima (including an
 *    over-long keyword-rule pattern).
 *
 * Domain validity (that a settings object is well-formed, that a rule is safe,
 * etc.) is deliberately NOT decided here — the storage repositories enforce it
 * at write time. This layer only guarantees the payload is safe to inspect.
 */
export function validateExportInput(input: string): ExportValidationResult {
  if (typeof input !== "string") {
    return fail("import must be a string");
  }

  if (byteLength(input) > MAX_IMPORT_BYTES) {
    return fail("import exceeds the maximum allowed size");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return fail("import is not valid JSON");
  }

  if (!isPlainObject(parsed)) {
    return fail("import must be a JSON object");
  }

  const structureReason = checkStructure(parsed, 1);
  if (structureReason !== undefined) {
    return fail(structureReason);
  }

  if (
    typeof parsed.schemaVersion !== "number" ||
    !SUPPORTED_IMPORT_SCHEMA_VERSIONS.has(parsed.schemaVersion)
  ) {
    return fail("unsupported schemaVersion");
  }

  const capsReason = checkCaps(parsed);
  if (capsReason !== undefined) {
    return fail(capsReason);
  }

  // Structurally safe and schema-versioned. Field-level domain validity is the
  // repositories' responsibility at write time, hence the cast through unknown.
  return { ok: true, value: parsed as unknown as ExtensionExport };
}

function fail(reason: string): ExportValidationFailure {
  return { ok: false, reason };
}

/** UTF-8 byte length, so multi-byte content cannot slip past the size cap. */
function byteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

/**
 * Recursively rejects dangerous keys and over-deep nesting. Runs before any
 * schema interpretation so a polluting payload is refused no matter where the
 * dangerous key hides.
 */
function checkStructure(node: unknown, depth: number): string | undefined {
  if (depth > MAX_IMPORT_DEPTH) {
    return "import nesting is too deep";
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const reason = checkStructure(item, depth + 1);
      if (reason !== undefined) {
        return reason;
      }
    }
    return undefined;
  }

  if (isPlainObject(node)) {
    for (const key of Object.getOwnPropertyNames(node)) {
      if (DANGEROUS_KEYS.has(key)) {
        return `dangerous key rejected: ${key}`;
      }
    }
    for (const key of Object.keys(node)) {
      const reason = checkStructure(node[key], depth + 1);
      if (reason !== undefined) {
        return reason;
      }
    }
  }

  return undefined;
}

function checkCaps(value: Record<string, unknown>): string | undefined {
  const { keywordRules, feedback, history, platformSettings } = value;

  if (keywordRules !== undefined) {
    if (!Array.isArray(keywordRules)) {
      return "keywordRules must be an array";
    }
    if (keywordRules.length > MAX_KEYWORD_RULES) {
      return "too many keyword rules";
    }
    for (const rule of keywordRules) {
      if (
        isPlainObject(rule) &&
        typeof rule.pattern === "string" &&
        rule.pattern.length > MAX_KEYWORD_PATTERN_LENGTH
      ) {
        return "keyword rule pattern is too long";
      }
    }
  }

  if (feedback !== undefined) {
    if (!Array.isArray(feedback)) {
      return "feedback must be an array";
    }
    if (feedback.length > MAX_FEEDBACK_RECORDS) {
      return "too many feedback records";
    }
  }

  if (history !== undefined) {
    if (!Array.isArray(history)) {
      return "history must be an array";
    }
    if (history.length > MAX_HISTORY_ENTRIES) {
      return "too many history entries";
    }
  }

  if (platformSettings !== undefined) {
    if (!isPlainObject(platformSettings)) {
      return "platformSettings must be an object";
    }
    if (Object.keys(platformSettings).length > MAX_PLATFORM_ENTRIES) {
      return "too many platform settings";
    }
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
