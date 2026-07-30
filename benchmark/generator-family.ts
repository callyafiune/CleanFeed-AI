// The canonical generator-family identifier: ONE field, ONE normalization, ONE
// nominal type.
//
// Why this file exists. A generator family used to be written twice, in two
// spellings of the same fact: `generation.family` carried the provider's literal
// label (`gemini-3.5-flash-low`, with dots) while `groups.generatorFamily` and
// `manifest.heldOutGeneratorFamilies` carried the pseudonymised token
// (`gemini-3_5-flash-low`, with underscores). Both the `generatorExposure` slice
// and the splitter's held-out mark compared the DECLARED set against
// `generation.family`, so neither comparison could ever match: the slice produced
// only `seen` (the records seeded to measure an unseen generator were reported as
// seen) and `component.heldOut` was never true, which meant the constraint "a
// reserved family goes to test" never ran at all.
//
// Why the UNDERSCORE form is canonical, not the dotted one. The canonical value
// has to be storable in `groups.*`, and every grouping token is validated as a
// pseudonym (`/^[A-Za-z0-9_-]+$/` in benchmark/schema.ts) precisely so a raw name
// or an address can never become a grouping key — `.` is one of the separators
// that rule excludes. The dotted spelling therefore CANNOT be the canonical form.
// The underscore slug is the only spelling both fields can hold, and it is
// already what the corpus builder (benchmark/lab/assemble_corpus.py) and the
// manifest write.
//
// What this module guarantees, stated as a contract rather than a property:
//   * `normalizeGeneratorFamily` is the single definition of the canonical form.
//     A value is canonical exactly when it is a fixed point of that function, so
//     idempotence is true by construction rather than by inspection.
//   * `GeneratorFamily` is a nominal (branded) type. A raw `string` is not
//     assignable to it, so `heldOut.has(record.generation.family)` — the original
//     defect — does not compile. That is the point: the wrong comparison is meant
//     to be unwritable, not merely absent.
//   * `generatorFamilyOf` is the one place that decides WHICH FIELD holds the
//     family, and the only accessor that answers "what family is this record's".
//     Stated that narrowly on purpose. The splitter and the split audit also read
//     the same field through `groupAxisIdentity` (benchmark/schema.ts), because to
//     them `generatorFamily` is one of the nine grouping axes and the question is
//     "do these two rows share this axis" — a different question, answered
//     uniformly over all nine axes, and it reads the same field this accessor does.
//     The earlier wording said "the only accessor consumers use", which was simply
//     false, and a false contract is worse than a narrow one: `schema.ts` also
//     exports `recordGeneratorFamily`, a version-aware read of the same axis with
//     no caller today.
//
// It does NOT claim that two records with the same canonical family came from the
// same model build, nor that different canonical families are independent
// generators: the family is a declared recipe label, normalized.
//
// Standalone module: MUST NOT import from the extension bundle (src/), and MUST
// NOT import benchmark/schema.ts (schema.ts imports this file). The record
// accessor is therefore typed structurally.

declare const GENERATOR_FAMILY_BRAND: unique symbol;

/**
 * A generator-family identifier already in canonical form. Nominal on purpose:
 * only `normalizeGeneratorFamily`, `asGeneratorFamily` and the schema validator
 * mint one, so any value of this type has passed the canonical check.
 */
export type GeneratorFamily = string & {
  readonly [GENERATOR_FAMILY_BRAND]: "canonical-generator-family";
};

/** Coded, fail-closed error raised by the canonical generator-family contract. */
export class GeneratorFamilyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "GeneratorFamilyError";
    this.code = code;
  }
}

// The character class of a pseudonymised grouping token, mirroring PSEUDONYM in
// benchmark/schema.ts. Kept as its own constant here because this module must not
// import schema.ts (schema.ts imports this file). That the two agree is pinned by
// benchmark/tests/generator-family.test.ts, which feeds canonical and
// non-canonical tokens through validateBenchmarkRecord itself rather than
// comparing the two regexes.
const TOKEN = /^[A-Za-z0-9_-]+$/;
const NON_TOKEN_RUN = /[^A-Za-z0-9_-]+/g;

// The raw rewrite, shared by the normalizer and the canonical predicate: collapse
// every run of characters outside the token class into a single `_`, then drop
// leading/trailing separators so `gemini-3.5` and `gemini_3_5_` cannot both survive
// as distinct "canonical" spellings. Case is PRESERVED: lowercasing would merge two
// provider labels that differ only in case, which is a loss of fact, not a
// normalization. Returns "" when nothing survives.
//
// BOTH separators of the token class are trimmed, not just `_`. Trimming `_` alone
// mapped `gemini-3.5-` to `gemini-3_5-`, which is a fixed point of this function and
// therefore canonical — and a different family from `gemini-3_5`. That is the very
// pair of spellings for one family this module exists to make unwritable, so the
// trim has to cover the separator a provider label actually ends with.
function rewrite(raw: string): string {
  return raw.replace(NON_TOKEN_RUN, "_").replace(/^[_-]+|[_-]+$/g, "");
}

/**
 * The single definition of the canonical form. `gemini-3.5-flash-low` and
 * `gemini-3_5-flash-low` both map to `gemini-3_5-flash-low`.
 *
 * Fails closed when the label has no canonical content at all (`"..."`, `""`)
 * rather than inventing a placeholder token: a family we cannot name is a
 * governance problem, not a string to patch over.
 */
export function normalizeGeneratorFamily(raw: string): GeneratorFamily {
  if (typeof raw !== "string") {
    throw new GeneratorFamilyError(
      "GENERATOR_FAMILY_INVALID",
      `a generator family must be a string, received ${typeof raw}`,
    );
  }
  const normalized = rewrite(raw);
  if (normalized === "") {
    throw new GeneratorFamilyError(
      "GENERATOR_FAMILY_INVALID",
      `generator family ${JSON.stringify(raw)} normalizes to nothing: it carries no character of [A-Za-z0-9_-]`,
    );
  }
  return normalized as GeneratorFamily;
}

/**
 * True exactly when `value` is a fixed point of `normalizeGeneratorFamily` and a
 * legal grouping token. Defined against the normalizer rather than by a second
 * regex, so the two can never drift apart.
 */
export function isCanonicalGeneratorFamily(
  value: unknown,
): value is GeneratorFamily {
  return (
    typeof value === "string" && TOKEN.test(value) && rewrite(value) === value
  );
}

/**
 * Admits an already-canonical string into the nominal type. REFUSES a
 * non-canonical spelling instead of correcting it: silent correction is exactly
 * what let two spellings of one family coexist in the corpus. Use
 * `normalizeGeneratorFamily` when converting a provider label on purpose.
 */
export function asGeneratorFamily(value: string): GeneratorFamily {
  if (!isCanonicalGeneratorFamily(value)) {
    throw new GeneratorFamilyError(
      "GENERATOR_FAMILY_NOT_CANONICAL",
      `generator family ${JSON.stringify(value)} is not in canonical form; the canonical spelling is ${JSON.stringify(rewrite(String(value)))}`,
    );
  }
  return value;
}

/**
 * The one place that decides WHICH FIELD holds a record's generator family, and
 * the only accessor that answers "what family is this record's". Reads the
 * canonical field, never `generation.family` (the provider's own label, kept
 * unnormalized inside the recipe so the governance audit can match a declared
 * batch byte for byte).
 *
 * Narrowly stated on purpose, and the module header says why: the splitter and
 * the split audit read the SAME field through `groupAxisIdentity`
 * (benchmark/schema.ts), because to them `generatorFamily` is one of the nine
 * grouping axes and the question is "do these two rows share this axis".
 *
 * Typed structurally so this module stays free of a schema.ts import; the schema
 * guarantees that any record carrying `generation` also carries this field.
 *
 * It reads BOTH record versions, which is why the parameter type spells out two
 * shapes. In v2 the field is the family itself or absent; in v3 it is a
 * three-valued axis, and `notApplicable`/`unknown` mean the same thing to every
 * caller of this function as an absent v2 field did — there is no family to
 * compare. Keeping the two in one accessor is deliberate: a second version-aware
 * reader of this field is how two spellings of one fact came back last time, and
 * `schema.ts` already exports one (`recordGeneratorFamily`, caller-less today).
 */
export function generatorFamilyOf(record: {
  groups: {
    generatorFamily?:
      | GeneratorFamily
      | { state: "known"; id: GeneratorFamily }
      | { state: "notApplicable" | "unknown"; reason: string };
  };
}): GeneratorFamily | undefined {
  const value = record.groups.generatorFamily;
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value.state === "known" ? value.id : undefined;
}

/**
 * The four places that must name the SAME reserved families:
 *   * `declared` — `manifest.heldOutGeneratorFamilies`, the reservation itself;
 *   * `marked` — the families that actually set `component.heldOut` in the split;
 *   * `derived` — what the independent audit reads back off the partitions;
 *   * `published` — what the report prints.
 */
export interface GeneratorFamilySets {
  declared: readonly GeneratorFamily[];
  marked: readonly GeneratorFamily[];
  derived: readonly GeneratorFamily[];
  published: readonly GeneratorFamily[];
}

const COMPARED_ROLES = ["marked", "derived", "published"] as const;

/**
 * Exact set equality across the four places, with a HARD failure and a message
 * that says which set diverged from which and how. Not a warning: a reservation
 * that the splitter ignored, or an audit that reads back a family nobody
 * reserved, means the "unseen generator" measurement is describing a population
 * that does not exist.
 *
 * Order is irrelevant (these are sets) but duplicates are refused, because a
 * duplicated member hides a real difference behind an equal-looking membership
 * test.
 */
export function assertGeneratorFamilyAgreement(
  sets: GeneratorFamilySets,
): void {
  for (const role of COMPARED_ROLES) {
    assertGeneratorFamiliesEqual("declared", sets.declared, role, sets[role]);
  }
}

/**
 * The two-way primitive behind the four-way invariant, for the places that hold
 * only some of the four sets (benchmark/split-artifact.ts sees the declared
 * policy, the sealed list and the audit's derived list, but not the splitter's
 * marks). Same hard failure, same message shape.
 */
export function assertGeneratorFamiliesEqual(
  referenceRole: string,
  reference: readonly GeneratorFamily[],
  otherRole: string,
  other: readonly GeneratorFamily[],
): void {
  const left = uniqueSorted(reference, referenceRole);
  const right = uniqueSorted(other, otherRole);
  const missing = left.filter((family) => !right.includes(family));
  const extra = right.filter((family) => !left.includes(family));
  if (missing.length === 0 && extra.length === 0) return;
  throw new GeneratorFamilyError(
    "GENERATOR_FAMILY_DISAGREEMENT",
    `the ${otherRole} generator families diverge from the ${referenceRole} set: ` +
      `${otherRole} omits [${missing.join(", ")}] and adds [${extra.join(", ")}] ` +
      `(${referenceRole}=[${left.join(", ")}], ${otherRole}=[${right.join(", ")}])`,
  );
}

function uniqueSorted(
  families: readonly GeneratorFamily[],
  role: string,
): GeneratorFamily[] {
  const seen = new Set<string>();
  for (const family of families) {
    if (seen.has(family)) {
      throw new GeneratorFamilyError(
        "GENERATOR_FAMILY_DUPLICATE",
        `the ${role} generator families list ${JSON.stringify(family)} more than once`,
      );
    }
    seen.add(family);
  }
  return [...families].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Sorts a family list into the one order every artifact publishes it in. */
export function sortGeneratorFamilies(
  families: readonly GeneratorFamily[],
): GeneratorFamily[] {
  return [...families].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
