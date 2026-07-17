/**
 * Static, allocation-only analysis of a user regex pattern that decides whether
 * it is safe to hand to the disposable rule worker for compilation. Nothing here
 * ever calls `new RegExp` or runs the pattern: the whole point is that untrusted
 * regex never compiles or executes on the caller's thread. The worker builds the
 * `RegExp` only after this validator returns `{ safe: true }`, and its 20 ms
 * kill-switch is the runtime backstop for anything this heuristic misses.
 *
 * The rejections target the shapes that drive catastrophic backtracking (ReDoS):
 * backreferences, lookbehind, quantifiers nested inside a quantified group, and
 * quantified alternations whose branches overlap. Flags are locked to `u` plus
 * an optional `i`; `g`, `m`, `s` and `y` are refused.
 */

export interface RegexSafetyResult {
  safe: boolean;
  reason?: string;
}

export const MAX_REGEX_PATTERN_LENGTH = 256;

const ALLOWED_FLAGS = new Set(["u", "i"]);

const SAFE: RegexSafetyResult = { safe: true };

/** Validates the flags string in isolation (only `u` and optional `i`). */
export function validateRegexFlags(flags: string): RegexSafetyResult {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.has(flag)) {
      return { safe: false, reason: `DISALLOWED_FLAG:${flag}` };
    }
    if (seen.has(flag))
      return { safe: false, reason: `DUPLICATE_FLAG:${flag}` };
    seen.add(flag);
  }
  return SAFE;
}

/**
 * Returns `{ safe: true }` only for patterns whose structure cannot cause
 * catastrophic backtracking under the supported flags. `flags` is optional so
 * the pattern can be checked on its own; when supplied it is validated too.
 */
export function validateRegexPattern(
  pattern: string,
  flags?: string,
): RegexSafetyResult {
  if (typeof pattern !== "string") {
    return { safe: false, reason: "INVALID_PATTERN" };
  }
  if (pattern.length === 0) return { safe: false, reason: "EMPTY_PATTERN" };
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return { safe: false, reason: "PATTERN_TOO_LONG" };
  }
  if (flags !== undefined) {
    const flagResult = validateRegexFlags(flags);
    if (!flagResult.safe) return flagResult;
  }
  return scanPattern(pattern);
}

/** Walks the pattern once, tracking groups, classes and escapes. */
function scanPattern(pattern: string): RegexSafetyResult {
  const groupStarts: number[] = [];
  let inClass = false;
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === "\\") {
      const next = pattern[index + 1];
      if (next === undefined) return { safe: false, reason: "DANGLING_ESCAPE" };
      if (!inClass) {
        if (next >= "1" && next <= "9") {
          return { safe: false, reason: "BACKREFERENCE" };
        }
        if (next === "k") {
          return { safe: false, reason: "NAMED_BACKREFERENCE" };
        }
      }
      index += 2;
      continue;
    }

    if (inClass) {
      if (char === "]") inClass = false;
      index += 1;
      continue;
    }

    if (char === "[") {
      inClass = true;
      index += 1;
      continue;
    }

    if (char === "(") {
      const opened = openGroup(pattern, index);
      if (!opened.safe) return opened;
      groupStarts.push(opened.contentStart);
      index = opened.nextIndex;
      continue;
    }

    if (char === ")") {
      const contentStart = groupStarts.pop();
      if (contentStart === undefined) {
        return { safe: false, reason: "UNBALANCED_GROUP" };
      }
      if (isQuantifierStart(pattern, index + 1)) {
        const inner = pattern.slice(contentStart, index);
        if (containsQuantifier(inner)) {
          return { safe: false, reason: "NESTED_QUANTIFIER" };
        }
        if (hasOverlappingAlternation(inner)) {
          return { safe: false, reason: "AMBIGUOUS_ALTERNATION" };
        }
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  if (inClass) return { safe: false, reason: "UNTERMINATED_CLASS" };
  if (groupStarts.length > 0)
    return { safe: false, reason: "UNBALANCED_GROUP" };
  if (hasAdjacentUnboundedQuantifiers(pattern)) {
    return { safe: false, reason: "ADJACENT_QUANTIFIERS" };
  }
  return SAFE;
}

interface OpenGroupResult extends RegexSafetyResult {
  contentStart: number;
  nextIndex: number;
}

/**
 * Classifies a group opener at `open`. Lookbehind is rejected outright; any
 * group modifier other than the supported set (`?:`, `?=`, `?!`, `?<name>`) is
 * refused so inline flags and exotic syntax can never slip through.
 */
function openGroup(pattern: string, open: number): OpenGroupResult {
  const fail = (reason: string): OpenGroupResult => ({
    safe: false,
    reason,
    contentStart: open + 1,
    nextIndex: open + 1,
  });

  if (pattern[open + 1] !== "?") {
    return { safe: true, contentStart: open + 1, nextIndex: open + 1 };
  }

  const marker = pattern[open + 2];
  if (marker === ":" || marker === "=" || marker === "!") {
    return { safe: true, contentStart: open + 3, nextIndex: open + 3 };
  }
  if (marker === "<") {
    const fourth = pattern[open + 3];
    if (fourth === "=" || fourth === "!") return fail("LOOKBEHIND");
    const close = pattern.indexOf(">", open + 3);
    if (close === -1) return fail("INVALID_NAMED_GROUP");
    return { safe: true, contentStart: close + 1, nextIndex: close + 1 };
  }
  return fail("UNSUPPORTED_GROUP");
}

/** Whether a quantifier begins at `index` (`*`, `+`, `?` or a bounded `{n,m}`). */
function isQuantifierStart(pattern: string, index: number): boolean {
  const char = pattern[index];
  if (char === "*" || char === "+" || char === "?") return true;
  return char === "{" && isBoundedQuantifier(pattern.slice(index));
}

function isBoundedQuantifier(fragment: string): boolean {
  return /^\{\d+(?:,\d*)?\}/u.test(fragment);
}

/** Whether `inner` contains any quantifier at any depth outside a class. */
function containsQuantifier(inner: string): boolean {
  let inClass = false;
  let index = 0;
  while (index < inner.length) {
    const char = inner[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      index += 1;
      continue;
    }
    if (char === "[") {
      inClass = true;
      index += 1;
      continue;
    }
    // Skip a group modifier so the `?` in `(?:` is not read as a quantifier.
    if (char === "(" && inner[index + 1] === "?") {
      index += 2;
      continue;
    }
    if (char === "*" || char === "+" || char === "?") return true;
    if (char === "{" && isBoundedQuantifier(inner.slice(index))) return true;
    index += 1;
  }
  return false;
}

/**
 * A coarse description of the set of characters an atom's FIRST position can
 * match. Used to decide whether two alternation branches — or two adjacent
 * quantified atoms — can consume the same input and so drive backtracking.
 */
type CharCategory =
  | { kind: "any" }
  | { kind: "word" }
  | { kind: "digit" }
  | { kind: "space" }
  | { kind: "literal"; char: string }
  | { kind: "unknown" };

/** Whether two first-position categories can match a common character. */
function categoriesOverlap(a: CharCategory, b: CharCategory): boolean {
  if (a.kind === "unknown" || b.kind === "unknown") return false;
  if (a.kind === "any" || b.kind === "any") return true;
  if (a.kind === b.kind) {
    return a.kind === "literal" && b.kind === "literal"
      ? a.char === b.char
      : true;
  }
  const kinds = new Set([a.kind, b.kind]);
  if (kinds.has("digit") && kinds.has("word")) return true; // \d is a subset of \w
  const literal =
    a.kind === "literal" ? a : b.kind === "literal" ? b : undefined;
  const named = a.kind === "literal" ? b : a;
  if (literal !== undefined) {
    if (named.kind === "word") return /[\p{L}\p{N}_]/u.test(literal.char);
    if (named.kind === "digit") return /\d/u.test(literal.char);
    if (named.kind === "space") return /\s/u.test(literal.char);
  }
  return false;
}

/** Category of a `\`-escape's first character (used by both overlap checks). */
function escapeCategory(escaped: string | undefined): CharCategory {
  switch (escaped) {
    case "d":
      return { kind: "digit" };
    case "w":
      return { kind: "word" };
    case "s":
      return { kind: "space" };
    case "D":
    case "W":
    case "S":
      return { kind: "any" }; // a negated class matches a broad set
    case undefined:
      return { kind: "unknown" };
    default:
      return { kind: "literal", char: escaped };
  }
}

/**
 * Whether a quantified group's alternation has branches that could match the
 * same input, the classic `(a|aa)+` ReDoS shape. Two branches overlap when they
 * can share a first character or when a branch can match the empty string.
 * Classes, `.`, negated escapes and nested groups are treated broadly here, so
 * `(\w|\d)+`, `(.|a)+` and `(a|[a-z])+` are all caught — not only branches with
 * an identical literal first token.
 */
function hasOverlappingAlternation(inner: string): boolean {
  const branches = splitTopLevelAlternation(inner);
  if (branches.length < 2) return false;
  const seen: CharCategory[] = [];
  for (const branch of branches) {
    if (branch.length === 0) return true; // an empty branch matches ε
    const category = alternationFirstCategory(branch);
    if (seen.some((other) => categoriesOverlap(other, category))) return true;
    seen.push(category);
  }
  return false;
}

/** First-position category of an alternation branch (classes/groups = broad). */
function alternationFirstCategory(branch: string): CharCategory {
  const first = branch[0];
  if (first === "\\") return escapeCategory(branch[1]);
  if (first === ".") return { kind: "any" };
  if (first === "[" || first === "(") return { kind: "any" };
  return { kind: "literal", char: first ?? "" };
}

/**
 * Detects two adjacent, unbounded-quantified single-character atoms whose match
 * sets overlap — the polynomial `\d+\d+` / `.*.*` / `\w+\d+` shape that
 * {@link scanPattern}'s group-close check does not see. Character classes and
 * negated escapes are deliberately treated as unmodeled ("unknown") so disjoint
 * neighbours such as `[a-z]+[0-9]+` are never falsely rejected; the 20 ms worker
 * kill-switch is the backstop for shapes this conservative pass does not flag.
 */
function hasAdjacentUnboundedQuantifiers(pattern: string): boolean {
  let previous: { category: CharCategory; unbounded: boolean } | null = null;
  let index = 0;
  while (index < pattern.length) {
    const atom = readSingleCharAtom(pattern, index);
    if (atom === null) {
      previous = null; // a group, `|`, anchor or bare quantifier breaks adjacency
      index += 1;
      continue;
    }
    if (
      atom.unbounded &&
      previous !== null &&
      previous.unbounded &&
      categoriesOverlap(previous.category, atom.category)
    ) {
      return true;
    }
    previous = { category: atom.category, unbounded: atom.unbounded };
    index = atom.nextIndex;
  }
  return false;
}

interface SingleCharAtom {
  category: CharCategory;
  unbounded: boolean;
  nextIndex: number;
}

/** Reads one single-character atom + its quantifier, or null for a breaker. */
function readSingleCharAtom(
  pattern: string,
  index: number,
): SingleCharAtom | null {
  const char = pattern[index];
  if (
    char === "(" ||
    char === ")" ||
    char === "|" ||
    char === "^" ||
    char === "$" ||
    char === "*" ||
    char === "+" ||
    char === "?" ||
    char === "{"
  ) {
    return null;
  }

  let category: CharCategory;
  let atomEnd: number;
  if (char === "\\") {
    category = escapeCategory(pattern[index + 1]);
    atomEnd = index + 2;
  } else if (char === ".") {
    category = { kind: "any" };
    atomEnd = index + 1;
  } else if (char === "[") {
    atomEnd = skipClass(pattern, index);
    category = { kind: "unknown" };
  } else {
    category = { kind: "literal", char };
    atomEnd = index + 1;
  }

  const quantifier = readQuantifier(pattern, atomEnd);
  return {
    category,
    unbounded: quantifier.unbounded,
    nextIndex: atomEnd + quantifier.length,
  };
}

/** Index just past a `[...]` class starting at `open`. */
function skipClass(pattern: string, open: number): number {
  let index = open + 1;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "]") return index + 1;
    index += 1;
  }
  return index;
}

/** Reads a trailing quantifier: `*`/`+`/`{n,}` are unbounded, `?`/`{n,m}` not. */
function readQuantifier(
  pattern: string,
  index: number,
): { unbounded: boolean; length: number } {
  const char = pattern[index];
  const lazy = pattern[index + 1] === "?" ? 1 : 0;
  if (char === "*" || char === "+")
    return { unbounded: true, length: 1 + lazy };
  if (char === "?") return { unbounded: false, length: 1 + lazy };
  if (char === "{") {
    const match = /^\{(\d+)(,(\d*)?)?\}/u.exec(pattern.slice(index));
    if (match !== null) {
      const openEnded = match[2] !== undefined && match[3] === "";
      return {
        unbounded: openEnded,
        length:
          match[0].length + (pattern[index + match[0].length] === "?" ? 1 : 0),
      };
    }
  }
  return { unbounded: false, length: 0 };
}

function splitTopLevelAlternation(inner: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "\\") {
      current += char + (inner[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (inClass) {
      current += char;
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      current += char;
      continue;
    }
    if (char === "|" && depth === 0) {
      branches.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  branches.push(current);
  return branches;
}
