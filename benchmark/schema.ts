// Closed benchmark record schema (v2 and v3) and cross-field validation. This
// module is intentionally standalone and MUST NOT import from the extension
// bundle (src/): the benchmark lives outside the shipped extension and only
// depends on plain data.
//
// "Closed" means every object is validated against an exact key set: any
// unknown field, repeated id/hash, score outside its range, or contradictory
// metadata is a hard failure. There is no coercion and no last-write-wins.
// Ground truth (the class label) is derived from documented provenance, never
// from a detector's opinion, so the schema only records provenance and never a
// predicted score.
//
// TWO VERSIONS, ONE MODULE, AND WHY (C1). `schemaVersion` is a discriminant, not
// a formality: `BenchmarkRecord` is the union and `validateBenchmarkRecord`
// dispatches on it.
//
//   * v2 is what the SEALED CORPUS ON DISK is. Its branch is unchanged, byte for
//     byte, because rewriting it would make an artifact that already exists
//     unreadable, and a corpus nothing can read cannot even be audited.
//   * v3 is the contract the rebuild produces. Its whole purpose is that the
//     grouping axes are REAL. Measuring the v2 corpus found six of the eight
//     axes filled with an identifier unique per record and two never filled at
//     all — `assemble_corpus.py` says so in a comment ("All UNIQUE per record so
//     the blocked split sees singleton components"). The consequences were not
//     thought through: the leakage audit validated identifiers built never to
//     collide, so `leakages: []` was tautological, and the "author-clustered"
//     bootstrap degenerated into i.i.d. over 10.000 singleton authors. How much
//     that narrowed every published interval is IRRECOVERABLE, because the real
//     cluster identity was never persisted.
//
// A dataset is ONE version: `parseBenchmarkDataset` refuses a file that mixes
// them, so a half-migrated corpus cannot be sealed and then read as if it were
// uniform.
//
// The v3 half is at the bottom of this file, under "SCHEMA V3". C2 emits these
// records, C3 audits them, C4 chooses resampling units from them and C5/C6 read
// them; where a representation needed an argument, the argument is written beside
// it rather than left for those five agents to reconstruct.

import {
  GeneratorFamilyError,
  isCanonicalGeneratorFamily,
  normalizeGeneratorFamily,
  type GeneratorFamily,
} from "./generator-family.ts";
import { REBUILD_V3_POLICY, laneRunsHarness } from "./rebuild-v3-policy.ts";
import type {
  EffortSource,
  GenerationLane,
  GenerationLaneRow,
  GenerationMode,
  LabelBasisValue,
} from "./rebuild-v3-policy.ts";

export type BenchmarkLabel = "human" | "ai" | "mixed";

export type { EffortSource, GenerationLane, GenerationMode, LabelBasisValue };

export type TransformationKind =
  | "none"
  | "paraphrase"
  | "back-translation"
  | "human-edit"
  | "noise"
  | "unicode-homoglyph"
  | "truncate"
  | "expand"
  | "linkedin-style"
  | "human-ai-mix";

export type TransformationSeverity = "none" | "low" | "medium" | "high";

export type EvidenceSpanOrigin = "human" | "ai";

/**
 * The sealed-corpus record shape. Unchanged by C1 on purpose: this is what
 * `benchmark/data/**\/records.jsonl` already holds, and the v3 contract lives on
 * {@link BenchmarkRecordV3} instead of being retrofitted here.
 */
export interface BenchmarkRecordV2 {
  schemaVersion: 2;
  id: string;
  text: string;
  normalizedTextSha256: string;
  label: BenchmarkLabel;
  language: "pt-BR";
  platform: string;
  domain: string;
  topic: string;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  wordCount: number;
  createdAt: number;
  provenance: {
    sourceKind:
      "authorized-contribution" | "licensed-corpus" | "controlled-generation";
    sourceId: string;
    sourceRevision: string;
    collectedAt: number;
    licenseId: string;
    licenseUrl?: string;
    legalBasis: "consent" | "license" | "generated";
    consentId?: string;
    piiAudit: {
      status: "passed";
      method: "manual-and-automated";
      reviewerId: string;
      reviewedAt: number;
    };
  };
  annotation: {
    protocolVersion: "annotation-v1";
    reviewerIds: [string, string, ...string[]];
    agreement: "agree" | "adjudicated";
    adjudicatorId?: string;
  };
  generation?: {
    provider: string;
    // The PROVIDER's own label for the recipe, kept exactly as the provider
    // spelled it (dots included) because benchmark/corpus-source-audit.ts matches
    // it byte for byte against the declared generation batch. It is NOT the
    // grouping identity and MUST NOT be compared against a declared family set —
    // `groups.generatorFamily` is the canonical field. See
    // benchmark/generator-family.ts.
    family: string;
    model: string;
    version: string;
    promptId: string;
    promptSha256: string;
    temperature?: number;
    seed?: string;
    generatedAt: number;
  };
  mixture?: {
    aiFraction: number;
    humanFraction: number;
    spans: Array<{ start: number; end: number; origin: EvidenceSpanOrigin }>;
    // WHICH cohort this mixture belongs to, and therefore which claim it can
    // support. Mandatory, with no default: `mechanistic` is what this project
    // produces (we chose and executed the edits, so the provenance per stretch
    // is known but the coauthorship DISTRIBUTION is ours), `ecological` is
    // reserved for a sample whose writing process was observed. The two are
    // never added together — see `materialAssistance.cohortsAggregated: false`
    // in benchmark/rebuild-v3-policy.json and the cohort split in
    // benchmark/metrics.ts. Absent the field there is nothing to infer: a
    // mixture whose cohort is unknown would be pooled into whichever one the
    // consumer assumed, which is exactly the aggregation the frozen table
    // forbids, so the record is REFUSED instead (R4/R6: never synthesize).
    generationMode: GenerationMode;
  };
  transformation: {
    kind: TransformationKind;
    severity: TransformationSeverity;
    operatorId?: string;
  };
  groups: {
    author: string;
    source: string;
    domainSource: string;
    // THE canonical generator-family field: the single source of truth every
    // consumer (split, slices, audit, manifest, report) compares against. Its
    // nominal type makes a comparison against any other field a compile error.
    generatorFamily?: GeneratorFamily;
    generatorVersion?: string;
    promptTemplate?: string;
    collectionBatch: string;
    nearDuplicate: string;
    derivationRoot: string;
  };
}

export class BenchmarkRecordError extends Error {
  readonly reason: string;
  readonly recordId?: string;

  constructor(reason: string, recordId?: string) {
    super(
      recordId === undefined
        ? `BENCHMARK_RECORD_INVALID: ${reason}`
        : `BENCHMARK_RECORD_INVALID: ${reason} (id=${recordId})`,
    );
    this.name = "BenchmarkRecordError";
    this.reason = reason;
    this.recordId = recordId;
  }
}

const LABELS: readonly BenchmarkLabel[] = ["human", "ai", "mixed"];
const TRANSFORMATION_KINDS: readonly TransformationKind[] = [
  "none",
  "paraphrase",
  "back-translation",
  "human-edit",
  "noise",
  "unicode-homoglyph",
  "truncate",
  "expand",
  "linkedin-style",
  "human-ai-mix",
];
const TRANSFORMATION_SEVERITIES: readonly TransformationSeverity[] = [
  "none",
  "low",
  "medium",
  "high",
];
const SOURCE_KINDS = [
  "authorized-contribution",
  "licensed-corpus",
  "controlled-generation",
] as const;
const LEGAL_BASES = ["consent", "license", "generated"] as const;
const AGREEMENTS = ["agree", "adjudicated"] as const;
const SPAN_ORIGINS: readonly EvidenceSpanOrigin[] = ["human", "ai"];

// Exact key sets for every closed object. Any key outside these is rejected.
const RECORD_KEYS = [
  "schemaVersion",
  "id",
  "text",
  "normalizedTextSha256",
  "label",
  "language",
  "platform",
  "domain",
  "topic",
  "humanSourceType",
  "hardNegativeFamily",
  "wordCount",
  "createdAt",
  "provenance",
  "annotation",
  "generation",
  "mixture",
  "transformation",
  "groups",
];
const PROVENANCE_KEYS = [
  "sourceKind",
  "sourceId",
  "sourceRevision",
  "collectedAt",
  "licenseId",
  "licenseUrl",
  "legalBasis",
  "consentId",
  "piiAudit",
];
const PII_AUDIT_KEYS = ["status", "method", "reviewerId", "reviewedAt"];
const ANNOTATION_KEYS = [
  "protocolVersion",
  "reviewerIds",
  "agreement",
  "adjudicatorId",
];
const GENERATION_KEYS = [
  "provider",
  "family",
  "model",
  "version",
  "promptId",
  "promptSha256",
  "temperature",
  "seed",
  "generatedAt",
];
const MIXTURE_KEYS = ["aiFraction", "humanFraction", "spans", "generationMode"];
// The closed vocabulary comes from the frozen contract, never from a literal
// repeated here (benchmark/rebuild-v3-policy.ts is the single source).
const GENERATION_MODES: readonly GenerationMode[] =
  REBUILD_V3_POLICY.materialAssistance.generationModes;
const SPAN_KEYS = ["start", "end", "origin"];
const TRANSFORMATION_KEYS = ["kind", "severity", "operatorId"];
const GROUPS_KEYS = [
  "author",
  "source",
  "domainSource",
  "generatorFamily",
  "generatorVersion",
  "promptTemplate",
  "collectionBatch",
  "nearDuplicate",
  "derivationRoot",
];

// Pseudonymised identity/group tokens are opaque: no whitespace and no PII
// separators such as "@" or ".", so raw names and addresses are rejected and
// grouping stays privacy preserving.
const PSEUDONYM = /^[A-Za-z0-9_-]+$/;
// Lowercase, 64-character hex, matching the canonical SHA-256 digests produced
// by contracts/canonical-json.ts.
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Validates a record of EITHER version, dispatching on `schemaVersion`.
 *
 * The version is read before the key set, because the two versions have different
 * key sets and closing the object against the wrong one produces a misleading
 * diagnostic — a v3 record checked as v2 fails with "unknown field labelBasis",
 * which names a symptom and hides the version mismatch.
 */
export function validateBenchmarkRecord(value: unknown): BenchmarkRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchmarkRecordError("record must be an object");
  }
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version === 3) return validateBenchmarkRecordV3(value);
  if (version === 2) return validateBenchmarkRecordV2(value);
  throw new BenchmarkRecordError("schemaVersion must be 2 or 3");
}

export function validateBenchmarkRecordV2(value: unknown): BenchmarkRecordV2 {
  const root = assertClosedObject(value, "", RECORD_KEYS);

  if (root.schemaVersion !== 2) {
    throw new BenchmarkRecordError("schemaVersion must be 2");
  }

  const id = pseudonym(root, "id", "");
  const text = nonEmptyString(root, "text", "", id);
  const normalizedTextSha256 = sha256Hex(root, "normalizedTextSha256", "", id);
  const label = enumValue(root, "label", "", LABELS, id);
  literal(root, "language", "", "pt-BR", id);
  const platform = nonEmptyString(root, "platform", "", id);
  const domain = nonEmptyString(root, "domain", "", id);
  const topic = nonEmptyString(root, "topic", "", id);
  const humanSourceType = optionalNonEmptyString(
    root,
    "humanSourceType",
    "",
    id,
  );
  const hardNegativeFamily = optionalNonEmptyString(
    root,
    "hardNegativeFamily",
    "",
    id,
  );
  const wordCount = finiteNumber(root, "wordCount", "", id);
  const createdAt = finiteNumber(root, "createdAt", "", id);

  const provenance = validateProvenance(root.provenance, id);
  const annotation = validateAnnotation(root.annotation, id);
  const generation = validateGeneration(root.generation, id);
  const mixture = validateMixture(root.mixture, id, text.length);
  const transformation = validateTransformation(root.transformation, id);
  const groups = validateGroups(root.groups, id);

  // Cross-field rules. Ground truth is the provenance-derived label, so the
  // generation recipe, mixture metadata and adjudication must be consistent
  // with the class rather than optional decoration.
  if (label === "human" && generation !== undefined) {
    throw new BenchmarkRecordError(
      "generation is forbidden when label is human",
      id,
    );
  }
  if (label === "ai" && generation === undefined) {
    throw new BenchmarkRecordError(
      "generation is required when label is ai",
      id,
    );
  }
  if (label === "mixed") {
    if (mixture === undefined) {
      throw new BenchmarkRecordError(
        "mixed records require mixture metadata and a parent derivationRoot",
        id,
      );
    }
    const sum = mixture.aiFraction + mixture.humanFraction;
    if (Math.abs(sum - 1) > Number.EPSILON * 8) {
      throw new BenchmarkRecordError("mixed fractions must sum to 1", id);
    }
    if (groups.derivationRoot === id) {
      throw new BenchmarkRecordError(
        "mixed records require mixture metadata and a parent derivationRoot",
        id,
      );
    }
  }
  // One family, one spelling. A generated record must carry the canonical field,
  // and it must be the canonical form of the recipe's own label. Divergence is
  // REFUSED rather than reconciled: silent correction is what allowed two
  // spellings of one family to coexist in the corpus, which left the
  // `generatorExposure` slice with no `unseen` bucket and the splitter's held-out
  // mark permanently false.
  if (generation !== undefined) {
    let expected: GeneratorFamily;
    try {
      expected = normalizeGeneratorFamily(generation.family);
    } catch (error) {
      throw new BenchmarkRecordError(
        `generation.family cannot be normalized into a canonical groups.generatorFamily: ${
          error instanceof GeneratorFamilyError ? error.message : String(error)
        }`,
        id,
      );
    }
    if (groups.generatorFamily === undefined) {
      throw new BenchmarkRecordError(
        `groups.generatorFamily is required when generation is present: it is the canonical generator-family field, and generation.family "${generation.family}" normalizes to "${expected}"`,
        id,
      );
    }
    if (groups.generatorFamily !== expected) {
      throw new BenchmarkRecordError(
        `groups.generatorFamily must be the canonical form of generation.family: expected "${expected}", received "${groups.generatorFamily}"`,
        id,
      );
    }
  }
  if (
    annotation.agreement === "adjudicated" &&
    annotation.adjudicatorId === undefined
  ) {
    throw new BenchmarkRecordError(
      "adjudicated records require adjudicatorId",
      id,
    );
  }

  const record: BenchmarkRecordV2 = {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256,
    label,
    language: "pt-BR",
    platform,
    domain,
    topic,
    wordCount,
    createdAt,
    provenance,
    annotation,
    transformation,
    groups,
  };
  if (humanSourceType !== undefined) record.humanSourceType = humanSourceType;
  if (hardNegativeFamily !== undefined) {
    record.hardNegativeFamily = hardNegativeFamily;
  }
  if (generation !== undefined) record.generation = generation;
  if (mixture !== undefined) record.mixture = mixture;

  return record;
}

// Parses a JSONL dataset, validating every record and rejecting any repeated id
// or normalized content hash with the offending line. Datasets never enter Git
// (see .gitignore), so this only runs against local files supplied at runtime.
export function parseBenchmarkDataset(jsonl: string): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  jsonl.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BenchmarkRecordError(`line ${index + 1} is not valid JSON`);
    }
    const record = validateBenchmarkRecord(parsed);
    // One dataset, one schema version. A mixed file would let a half-migrated
    // corpus be sealed and then read as if it were uniform: every consumer that
    // reads a grouping axis would silently see real identities on some rows and
    // per-record singletons on the others, which is the v2 defect reintroduced in
    // a form no audit could name.
    const first = records[0];
    if (first !== undefined && first.schemaVersion !== record.schemaVersion) {
      throw new BenchmarkRecordError(
        `dataset mixes schemaVersion ${first.schemaVersion} and schemaVersion ${record.schemaVersion} (line ${index + 1})`,
        record.id,
      );
    }
    if (seenIds.has(record.id)) {
      throw new BenchmarkRecordError(
        `duplicate id ${record.id} on line ${index + 1}`,
        record.id,
      );
    }
    if (seenHashes.has(record.normalizedTextSha256)) {
      throw new BenchmarkRecordError(
        `duplicate normalizedTextSha256 ${record.normalizedTextSha256} on line ${index + 1}`,
        record.id,
      );
    }
    seenIds.add(record.id);
    seenHashes.add(record.normalizedTextSha256);
    records.push(record);
  });

  if (records.length === 0) {
    throw new BenchmarkRecordError("dataset contains no records");
  }
  return records;
}

function validateProvenance(
  value: unknown,
  id: string,
): BenchmarkRecordV2["provenance"] {
  const obj = assertClosedObject(value, "provenance", PROVENANCE_KEYS, id);
  const sourceKind = enumValue(
    obj,
    "sourceKind",
    "provenance",
    SOURCE_KINDS,
    id,
  );
  const sourceId = pseudonym(obj, "sourceId", "provenance", id);
  const sourceRevision = pseudonym(obj, "sourceRevision", "provenance", id);
  const collectedAt = finiteNumber(obj, "collectedAt", "provenance", id);
  const licenseId = nonEmptyString(obj, "licenseId", "provenance", id);
  const licenseUrl = optionalNonEmptyString(
    obj,
    "licenseUrl",
    "provenance",
    id,
  );
  const legalBasis = enumValue(
    obj,
    "legalBasis",
    "provenance",
    LEGAL_BASES,
    id,
  );
  const consentId = optionalPseudonym(obj, "consentId", "provenance", id);

  const auditObj = assertClosedObject(
    obj.piiAudit,
    "provenance.piiAudit",
    PII_AUDIT_KEYS,
    id,
  );
  literal(auditObj, "status", "provenance.piiAudit", "passed", id);
  literal(
    auditObj,
    "method",
    "provenance.piiAudit",
    "manual-and-automated",
    id,
  );
  const piiAudit: BenchmarkRecordV2["provenance"]["piiAudit"] = {
    status: "passed",
    method: "manual-and-automated",
    reviewerId: pseudonym(auditObj, "reviewerId", "provenance.piiAudit", id),
    reviewedAt: finiteNumber(auditObj, "reviewedAt", "provenance.piiAudit", id),
  };

  const provenance: BenchmarkRecordV2["provenance"] = {
    sourceKind,
    sourceId,
    sourceRevision,
    collectedAt,
    licenseId,
    legalBasis,
    piiAudit,
  };
  if (licenseUrl !== undefined) provenance.licenseUrl = licenseUrl;
  if (consentId !== undefined) provenance.consentId = consentId;
  return provenance;
}

function validateAnnotation(
  value: unknown,
  id: string,
): BenchmarkRecordV2["annotation"] {
  const obj = assertClosedObject(value, "annotation", ANNOTATION_KEYS, id);
  literal(obj, "protocolVersion", "annotation", "annotation-v1", id);
  const agreement = enumValue(obj, "agreement", "annotation", AGREEMENTS, id);

  const reviewerIdsRaw = obj.reviewerIds;
  if (!Array.isArray(reviewerIdsRaw) || reviewerIdsRaw.length < 2) {
    throw new BenchmarkRecordError(
      "annotation.reviewerIds must list at least two reviewers",
      id,
    );
  }
  const reviewerIds = reviewerIdsRaw.map((reviewer, index) => {
    if (typeof reviewer !== "string" || !PSEUDONYM.test(reviewer)) {
      throw new BenchmarkRecordError(
        `annotation.reviewerIds[${index}] must be a pseudonymised token`,
        id,
      );
    }
    return reviewer;
  }) as [string, string, ...string[]];

  const adjudicatorId = optionalPseudonym(
    obj,
    "adjudicatorId",
    "annotation",
    id,
  );

  const annotation: BenchmarkRecordV2["annotation"] = {
    protocolVersion: "annotation-v1",
    reviewerIds,
    agreement,
  };
  if (adjudicatorId !== undefined) annotation.adjudicatorId = adjudicatorId;
  return annotation;
}

function validateGeneration(
  value: unknown,
  id: string,
): BenchmarkRecordV2["generation"] {
  if (value === undefined) return undefined;
  const obj = assertClosedObject(value, "generation", GENERATION_KEYS, id);
  const generation: NonNullable<BenchmarkRecordV2["generation"]> = {
    provider: nonEmptyString(obj, "provider", "generation", id),
    family: nonEmptyString(obj, "family", "generation", id),
    model: nonEmptyString(obj, "model", "generation", id),
    version: nonEmptyString(obj, "version", "generation", id),
    promptId: pseudonym(obj, "promptId", "generation", id),
    promptSha256: sha256Hex(obj, "promptSha256", "generation", id),
    generatedAt: finiteNumber(obj, "generatedAt", "generation", id),
  };
  const temperature = optionalFiniteNumber(
    obj,
    "temperature",
    "generation",
    id,
  );
  if (temperature !== undefined) generation.temperature = temperature;
  const seed = optionalNonEmptyString(obj, "seed", "generation", id);
  if (seed !== undefined) generation.seed = seed;
  return generation;
}

function validateMixture(
  value: unknown,
  id: string,
  textLength: number,
): BenchmarkRecordV2["mixture"] {
  if (value === undefined) return undefined;
  const obj = assertClosedObject(value, "mixture", MIXTURE_KEYS, id);
  const aiFraction = fraction(obj, "aiFraction", "mixture", id);
  const humanFraction = fraction(obj, "humanFraction", "mixture", id);

  const spansRaw = obj.spans;
  if (!Array.isArray(spansRaw)) {
    throw new BenchmarkRecordError("mixture.spans must be an array", id);
  }
  const spans = spansRaw.map((span, index) => {
    const spanObj = assertClosedObject(
      span,
      `mixture.spans[${index}]`,
      SPAN_KEYS,
      id,
    );
    const start = finiteNumber(spanObj, "start", `mixture.spans[${index}]`, id);
    const end = finiteNumber(spanObj, "end", `mixture.spans[${index}]`, id);
    // Spans are integer character offsets into the record text. Reject anything
    // that is not a whole offset or that runs outside 0..text.length, so an
    // annotated span can never point past the content it claims to cover.
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > textLength
    ) {
      throw new BenchmarkRecordError(
        `mixture.spans[${index}] out of text bounds: require integer 0 <= start <= end <= ${textLength}`,
        id,
      );
    }
    const origin = enumValue(
      spanObj,
      "origin",
      `mixture.spans[${index}]`,
      SPAN_ORIGINS,
      id,
    );
    return { start, end, origin };
  });

  // Validated LAST so the earlier, more specific diagnostics (a fraction out of
  // range, a span past the end of the text) keep firing first on a record that
  // has more than one problem.
  const generationMode = enumValue(
    obj,
    "generationMode",
    "mixture",
    GENERATION_MODES,
    id,
  );

  return { aiFraction, humanFraction, spans, generationMode };
}

function validateTransformation(
  value: unknown,
  id: string,
): BenchmarkRecordV2["transformation"] {
  const obj = assertClosedObject(
    value,
    "transformation",
    TRANSFORMATION_KEYS,
    id,
  );
  const transformation: BenchmarkRecordV2["transformation"] = {
    kind: enumValue(obj, "kind", "transformation", TRANSFORMATION_KINDS, id),
    severity: enumValue(
      obj,
      "severity",
      "transformation",
      TRANSFORMATION_SEVERITIES,
      id,
    ),
  };
  const operatorId = optionalPseudonym(obj, "operatorId", "transformation", id);
  if (operatorId !== undefined) transformation.operatorId = operatorId;
  return transformation;
}

function validateGroups(
  value: unknown,
  id: string,
): BenchmarkRecordV2["groups"] {
  const obj = assertClosedObject(value, "groups", GROUPS_KEYS, id);
  const groups: BenchmarkRecordV2["groups"] = {
    author: pseudonym(obj, "author", "groups", id),
    source: pseudonym(obj, "source", "groups", id),
    domainSource: pseudonym(obj, "domainSource", "groups", id),
    collectionBatch: pseudonym(obj, "collectionBatch", "groups", id),
    nearDuplicate: pseudonym(obj, "nearDuplicate", "groups", id),
    derivationRoot: pseudonym(obj, "derivationRoot", "groups", id),
  };
  // The canonical field is checked against the ONE normalizer, not against a
  // second regex, and a non-canonical spelling is refused rather than rewritten.
  const rawFamily = obj.generatorFamily;
  if (rawFamily !== undefined) {
    if (!isCanonicalGeneratorFamily(rawFamily)) {
      throw new BenchmarkRecordError(
        `groups.generatorFamily must be a generator family in canonical form (a pseudonymised token, no dots): received ${JSON.stringify(rawFamily)}`,
        id,
      );
    }
    groups.generatorFamily = rawFamily;
  }
  const generatorVersion = optionalPseudonym(
    obj,
    "generatorVersion",
    "groups",
    id,
  );
  if (generatorVersion !== undefined)
    groups.generatorVersion = generatorVersion;
  const promptTemplate = optionalPseudonym(obj, "promptTemplate", "groups", id);
  if (promptTemplate !== undefined) groups.promptTemplate = promptTemplate;
  return groups;
}

// --- Primitive validators -------------------------------------------------

function assertClosedObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  id?: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const label = path === "" ? "record" : path;
    throw new BenchmarkRecordError(`${label} must be an object`, id);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      const field = path === "" ? key : `${path}.${key}`;
      throw new BenchmarkRecordError(`unknown field ${field}`, id);
    }
  }
  return value as Record<string, unknown>;
}

function field(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function nonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be a non-empty string`,
      id,
    );
  }
  return value;
}

function optionalNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string | undefined {
  if (obj[key] === undefined) return undefined;
  return nonEmptyString(obj, key, path, id);
}

function pseudonym(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  // Optional because the record id itself is validated by this helper BEFORE an
  // id is known (the first call passes none); every other call passes the id.
  id?: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || !PSEUDONYM.test(value)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be a pseudonymised token matching [A-Za-z0-9_-], never raw PII`,
      id,
    );
  }
  return value;
}

function optionalPseudonym(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string | undefined {
  if (obj[key] === undefined) return undefined;
  return pseudonym(obj, key, path, id);
}

function sha256Hex(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be a lowercase 64-character SHA-256 hex digest`,
      id,
    );
  }
  return value;
}

function finiteNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be a finite number`,
      id,
    );
  }
  return value;
}

function optionalFiniteNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): number | undefined {
  if (obj[key] === undefined) return undefined;
  return finiteNumber(obj, key, path, id);
}

function fraction(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): number {
  const value = finiteNumber(obj, key, path, id);
  if (value < 0 || value > 1) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be within [0,1]`,
      id,
    );
  }
  return value;
}

function enumValue<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
  id: string,
): T {
  const value = obj[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be one of ${allowed.join(", ")}`,
      id,
    );
  }
  return value as T;
}

function literal<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  expected: T,
  id: string,
): T {
  const value = obj[key];
  if (value !== expected) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must equal "${expected}"`,
      id,
    );
  }
  return expected;
}

// ===========================================================================
// SCHEMA V3 — grouping axes with a real, three-valued state, and a human label
// that names the evidence it rests on.
// ===========================================================================

/**
 * The dependence axes a v3 record declares. All twelve are MANDATORY keys: the
 * question "is this axis known for this record" must have an answer, and an
 * absent key is not one.
 *
 * Order is the reading order of a record's provenance, not an alphabet: who wrote
 * it, where it came from, what seeded it, what generated it, how it was collected,
 * and how it relates to other rows.
 *
 *   * `author` — the person or account that wrote the human text. Pseudonymised
 *     with HMAC (see {@link GroupAxisValue}), never a bare hash.
 *   * `source` — the ORIGIN DOCUMENT: a Stack Overflow thread, a Wikipedia page,
 *     a B2W product, a Carolina member file. In v2 this held
 *     `g_<recordId>`, a value that existed only to be unique.
 *   * `domainSource` — the domain/source stratum the record is counted under.
 *   * `humanSeed` — the human text that SEEDED a generation. Recoverable from the
 *     pools: `promptId` encodes it (`original_src_b2w_00848b3bc692`).
 *   * `promptTemplate` — which recipe template produced it. NEVER filled in v2.
 *   * `generatorFamily` — the canonical family (benchmark/generator-family.ts).
 *   * `generatorVersion` — the model version. NEVER filled in v2.
 *   * `generationLane` — the channel the text came out of, API or CLI. New in v3.
 *   * `harnessVersion` — the CLI binary version. New in v3, and an axis and not a
 *     mere field because `agy` is present in 3 of the 4 core families and absent
 *     from the OOD family, so it is a dependence structure that can be confounded
 *     with the generator.
 *   * `collectionBatch` — the extraction or generation batch.
 *   * `nearDuplicate` — the near-duplicate cluster. After pruning this is expected
 *     to be all singletons; that is what pruning DOES, and it is deliberately NOT
 *     treated as a degenerate axis (requiring groups > 1 would reward artificial
 *     grouping). Sufficient power per stratum is E3's criterion, not this module's.
 *   * `derivationRoot` — the record this one is a textual derivation OF.
 *
 * `humanSeed` and `derivationRoot` are BOTH here and are not synonyms: the
 * `original` recipe generates fresh text from a human prompt (seed known,
 * derivation notApplicable), while `parafrase` rewrites that text (both known).
 * Collapsing them would either invent a derivation or lose the seed.
 */
export const V3_GROUP_AXES = [
  "author",
  "source",
  "domainSource",
  "humanSeed",
  "promptTemplate",
  "generatorFamily",
  "generatorVersion",
  "generationLane",
  "harnessVersion",
  "collectionBatch",
  "nearDuplicate",
  "derivationRoot",
] as const;

export type V3GroupAxis = (typeof V3_GROUP_AXES)[number];

/** The three states R6 allows, and no fourth. */
export type GroupAxisState = "known" | "notApplicable" | "unknown";

export const GROUP_AXIS_STATES: readonly GroupAxisState[] = [
  "known",
  "notApplicable",
  "unknown",
];

/**
 * One axis of one record. A DISCRIMINATED UNION, not a nullable string, and that
 * is the whole point of C1: the raw identifier is not accepted on its own, so a
 * producer cannot leave the state to be inferred from whether the string is empty.
 *
 *   * `known` — the identity, pseudonymised. For any identifier of a PERSON coming
 *     from a public base (a Stack Exchange author, a B2W reviewer) the
 *     pseudonymisation is HMAC with a secret, because a plain hash of a
 *     low-entropy identifier is reversible by brute force and remains personal
 *     data even when the source is public. The keyring is C3; this layer requires
 *     the pseudonymised FORM and refuses a raw one.
 *   * `notApplicable` — legitimate and NOT a defect: Wikipedia is collectively
 *     written and has no single author, and generated text has no human author.
 *     It does NOT make the record ineligible.
 *   * `unknown` — the value exists but was not recovered. It makes the record
 *     INELIGIBLE ({@link recordEligibility}) and is never replaced by a synthetic
 *     identifier. Generating one per record to "satisfy" the split is exactly the
 *     defect this schema exists to undo.
 *
 * `reason` is mandatory on the two non-`known` states and forbidden on `known`.
 * That is a deliberate cost: the failure mode R6 guards against is a producer
 * writing `notApplicable` to dodge ineligibility, and a state whose justification
 * has to be written down is one a reviewer can disagree with. It is the same move
 * as `decodingConfigurable` — say in the data WHY a value is absent instead of
 * leaving the reader to assume nobody recorded it.
 */
export type GroupAxisValue<Id extends string = string> =
  | { state: "known"; id: Id }
  | { state: "notApplicable"; reason: string }
  | { state: "unknown"; reason: string };

/**
 * The `groups` block of a v3 record: every axis, each with a state. Two axes are
 * narrower than `string` so a comparison against the wrong field is a compile
 * error — `generatorFamily` keeps the nominal type A4 introduced, and
 * `generationLane` is restricted to the frozen lane vocabulary.
 */
export type V3Groups = {
  [
    A in Exclude<V3GroupAxis, "generatorFamily" | "generationLane">
  ]: GroupAxisValue;
} & {
  generatorFamily: GroupAxisValue<GeneratorFamily>;
  generationLane: GroupAxisValue<GenerationLane>;
};

/**
 * The decoding configuration of a generated record — as a discriminated union, so
 * a lane that cannot accept sampling parameters does not merely leave them null:
 * the fields DO NOT EXIST on that branch.
 *
 * This is not stylistic. MEASURED: `benchmark/lab/generate_ai.py` writes
 * `"temperature": str(TEMPERATURE)` into the meta of every record it produces,
 * for every provider, while `CLI_PROVIDERS = {"agy", "codex", "gemini_cli"}` are
 * invoked as CLIs — `agy` as `[AGY_BIN, "-p", prompt, "--mode", "plan",
 * "--model", model]`, with no sampling flag anywhere. So the candidate pools on
 * disk carry a temperature of 0.8 on records where no temperature was ever
 * applied. Under `configurable: false` that datum has nowhere to go, and the
 * cross-field rule below refuses it outright rather than carrying a number that
 * describes nothing.
 *
 * Inside `configurable: true`, `null` means "we did not set it, the provider's
 * default applied" — which is a different statement from "this lane has no such
 * knob", and the two are now told apart by the branch rather than by a comment.
 * Every sampling parameter is REQUIRED-and-nullable for that reason: an absent key
 * would leave a reader to assume nobody recorded it, which is the ambiguity this
 * block exists to remove.
 *
 * `temperature` lives HERE and not beside `seed` at the top of `generation`. In the
 * first C1 round it was a top-level optional refused by a cross-field check, which
 * meant the union's promise that the sampling fields "do not exist on that branch"
 * was false for the one field the pools are known to carry a wrong value for, and
 * an api row could omit it entirely and still validate.
 */
export type DecodingConfig =
  | { configurable: false }
  | {
      configurable: true;
      /** The provider's own word for the decoding strategy, when it names one. */
      strategy: string | null;
      temperature: number | null;
      topP: number | null;
      repetitionPenalty: number | null;
    };

/**
 * The reasoning-effort configuration of a generated record.
 *
 * `level` NEVER travels without `scale`, by construction: on the branches that
 * carry a level, both keys are required, so there is no way to record an effort
 * whose scale was forgotten. That matters because effort is NOT comparable across
 * providers — `codex` reaches `xhigh`, `agy` stops at `high` — and a bare level
 * would read as a shared ordinal. {@link compareEffortWithinScale} is the only
 * comparator this module offers and it REFUSES a cross-scale pair, which is the
 * same rule that keeps `mechanistic` from being pooled with `ecological`.
 *
 * `configurable` is stored rather than derived from `source`, because D3 consumes
 * it and because the contradiction it makes possible has to be REFUSED where it
 * can occur: a JSON file can say `source: "flag", configurable: false`, and that
 * combination is the exact shape an invented provenance would take.
 */
export type EffortConfig =
  | { source: "not-supported"; configurable: false }
  | {
      source: "model-id" | "flag" | "provider-default";
      configurable: boolean;
      scale: string;
      level: string;
    };

/** The recipe of a v3 generated record, with the lane's own configuration. */
export interface GenerationV3 {
  provider: string;
  /**
   * The PROVIDER's own label for the recipe, dots included, kept byte-identical
   * because benchmark/corpus-source-audit.ts matches it against the declared
   * batch. It is NOT the grouping identity: `groups.generatorFamily` is.
   */
  family: string;
  model: string;
  version: string;
  promptId: string;
  promptSha256: string;
  /** Digest of the prompt TEMPLATE, as the candidate pools already record it. */
  promptTemplateDigest: string;
  generatedAt: number;
  decoding: DecodingConfig;
  effort: EffortConfig;
  /**
   * Present only on a lane that exposes a sampling seed. The sampling PARAMETERS
   * are not here — they live inside {@link DecodingConfig}, on the branch of a lane
   * that has them. `seed` stays at this level because `agy` exposes none while
   * still being a real recipe, so its absence needs a written reason
   * (`seedNullReason`) rather than a branch.
   */
  seed?: string;
  /** Why there is no seed. Exactly one of `seed`/`seedNullReason` is present. */
  seedNullReason?: string;
}

/**
 * WHERE a `human` label's evidence lives, and enough of it to be re-derived.
 *
 * `entryId` + `entryDigest` are the whole privacy design: the record names an
 * entry of the PRIVATE source manifest and the digest of that entry's canonical
 * bytes. Resolution is {@link assertLabelEvidenceResolves}, which takes an
 * `entryId -> digest` index the caller builds from the private file — so the
 * private manifest is never imported into a record, never into the dataset audit,
 * and never into any published artifact. Only opaque digests cross the boundary.
 *
 * The per-basis payload is what makes the reference auditable without the private
 * file, and the two shapes are closed against each other: a `date-cutoff`
 * reference carrying `sessionLogDigest` is refused as an unknown field, not
 * ignored.
 */
export type LabelEvidenceRef =
  | {
      basis: "date-cutoff";
      entryId: string;
      entryDigest: string;
      /** The date field as it is named AT SOURCE (`Posts.xml@CreationDate`). */
      dateField: string;
      /** The value read for THIS record, as an ISO instant. */
      observedValue: string;
      /** The cutoff it was compared against, as an ISO instant. */
      cutoff: string;
      /** The frozen snapshot the bytes came from. */
      snapshot: string;
    }
  | {
      basis: "observed-process";
      entryId: string;
      entryDigest: string;
      protocol: string;
      protocolVersion: string;
      sessionLogDigest: string;
      /** The controls actually applied. At least one; never an empty gesture. */
      controls: [string, ...string[]];
      /** What the protocol does NOT rule out. R7: state the residual. */
      residualRisk: string;
    };

/**
 * A v3 record. Shares `provenance`, `annotation`, `mixture` and `transformation`
 * with v2 — those blocks were not the defect — and replaces `groups`, extends
 * `generation`, and adds the label-evidence pair.
 */
export interface BenchmarkRecordV3 {
  schemaVersion: 3;
  id: string;
  text: string;
  normalizedTextSha256: string;
  label: BenchmarkLabel;
  language: "pt-BR";
  platform: string;
  domain: string;
  topic: string;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  wordCount: number;
  createdAt: number;
  /**
   * The evidence basis of the `human` label. Present IF AND ONLY IF
   * `label === "human"`; forbidden on `ai` and `mixed`, whose labels come from
   * `generation`/`mixture`. When a generated record derives from a human parent,
   * `groups.derivationRoot`/`groups.humanSeed` RESOLVE the parent's basis
   * ({@link assertDerivedParentsResolve}) instead of duplicating it here — a
   * duplicated basis is a second copy that can go stale.
   */
  labelBasis?: LabelBasisValue;
  labelEvidenceRef?: LabelEvidenceRef;
  provenance: BenchmarkRecordV2["provenance"];
  annotation: BenchmarkRecordV2["annotation"];
  generation?: GenerationV3;
  mixture?: BenchmarkRecordV2["mixture"];
  transformation: BenchmarkRecordV2["transformation"];
  groups: V3Groups;
}

/** Either version. `schemaVersion` is the discriminant. */
export type BenchmarkRecord = BenchmarkRecordV2 | BenchmarkRecordV3;

const V3_RECORD_KEYS = [
  "schemaVersion",
  "id",
  "text",
  "normalizedTextSha256",
  "label",
  "language",
  "platform",
  "domain",
  "topic",
  "humanSourceType",
  "hardNegativeFamily",
  "wordCount",
  "createdAt",
  "labelBasis",
  "labelEvidenceRef",
  "provenance",
  "annotation",
  "generation",
  "mixture",
  "transformation",
  "groups",
];
const V3_GENERATION_KEYS = [
  "provider",
  "family",
  "model",
  "version",
  "promptId",
  "promptSha256",
  "promptTemplateDigest",
  "generatedAt",
  "decoding",
  "effort",
  "seed",
  "seedNullReason",
];
// `temperature` is deliberately NOT in V3_GENERATION_KEYS: the pools carry it at
// this level and the refusal for a CLI row is now the closed-object one against
// `{ configurable: false }`, so the guarantee is stated once, structurally.
const DECODING_CONFIGURABLE_KEYS = [
  "configurable",
  "strategy",
  "temperature",
  "topP",
  "repetitionPenalty",
];
const EFFORT_LEVELLED_KEYS = ["source", "configurable", "scale", "level"];
const DATE_CUTOFF_REF_KEYS = [
  "basis",
  "entryId",
  "entryDigest",
  "dateField",
  "observedValue",
  "cutoff",
  "snapshot",
];
const OBSERVED_PROCESS_REF_KEYS = [
  "basis",
  "entryId",
  "entryDigest",
  "protocol",
  "protocolVersion",
  "sessionLogDigest",
  "controls",
  "residualRisk",
];

/**
 * WHICH class a record's axes are judged against. NOT the same thing as
 * {@link BenchmarkLabel}, and the difference is load-bearing rather than tidy:
 * `mixed` covers TWO cohorts the frozen table refuses to pool
 * (`materialAssistance.generationModes`, `cohortsAggregated: false`), and they
 * have opposite provenance for the four generation axes.
 *
 *   * `mixed-mechanistic` — WE chose and executed the edits. The recipe is ours,
 *     it is on disk (`mixed_from_pairs.jsonl` records provider, model and
 *     `generatedAt` per row), so the row must carry it.
 *   * `mixed-ecological` — observed human coauthorship. The assistance came out of
 *     the COAUTHOR's tool: we have no prompt, no template digest, no seed and no
 *     lane. Requiring the four axes `known` here would leave exactly one writable
 *     form for an observed row — one naming our `agy` lane and our
 *     `pt_parafrase_v1` template — which is fabricated provenance (R4) and the
 *     substitution pressure this schema exists to remove. Nothing carries the
 *     cohort yet; that is why representability has to be checked by test and not
 *     by the corpus.
 */
export type V3AxisClass =
  "human" | "ai" | "mixed-mechanistic" | "mixed-ecological";

/** How each class is NAMED in a refusal, so the message says which cohort. */
const AXIS_CLASS_LABEL = {
  human: "a human record",
  ai: "an ai record",
  "mixed-mechanistic": "a mechanistic mixed record",
  "mixed-ecological": "an ecological mixed record",
} as const satisfies Record<V3AxisClass, string>;

/**
 * The class of a record, from its label and — for `mixed` — its cohort. Exported
 * because C2 needs the same derivation when it builds a row and C3 when it audits
 * one, and two copies of this mapping would drift.
 */
export function v3AxisClass(
  label: BenchmarkLabel,
  generationMode: GenerationMode | undefined,
): V3AxisClass {
  if (label !== "mixed") return label;
  // `mixture` is required on `mixed` and validated BEFORE the axes, so the mode is
  // present by the time this is called. `mechanistic` is the fail-closed default
  // for the impossible case because it is the STRICTER row: defaulting to
  // `ecological` would silently drop the recipe requirement.
  return generationMode === "ecological"
    ? "mixed-ecological"
    : "mixed-mechanistic";
}

/**
 * WHICH states each axis may take, per class. A decision table and not a list of
 * `if`s: `satisfies` makes an axis added to {@link V3_GROUP_AXES} without a rule a
 * compile error, and makes a class added to {@link V3AxisClass} one too. No axis is
 * permissive by default.
 *
 * The entries that carry an argument rather than an obvious answer:
 *
 *   * `author` is `notApplicable` and nothing else on an `ai` record, because
 *     generated text has no human author. The v2 fixtures wrote
 *     `author: "author_gen_001"` on a generated record — a person-shaped token for
 *     a row that has no person — and that is precisely how an axis becomes a
 *     10.000-singleton set nobody questions.
 *   * `author` and `source` stay open on BOTH mixed cohorts, because a mixed
 *     record IS a human text with generated stretches: its human author and its
 *     origin document are real, and pruning them would delete the dependence that
 *     makes a mixed row correlated with its parent.
 *   * `promptTemplate` and `generatorVersion` must be `known` on every row whose
 *     recipe is OURS. These are the two axes the v2 corpus NEVER filled, and both
 *     exist in `meta` in the candidate pools, so `unknown` there would be a choice
 *     not to read data that is on disk. On `mixed-ecological` the table restricts
 *     FIVE axes, not the two named in the sentence above and not four: it is
 *     `promptTemplate`, `generatorFamily`, `generatorVersion`, `generationLane` and
 *     `harnessVersion` — every axis that names a piece of a generation apparatus.
 *     Each of the five is `notApplicable` (no tool of ours ran) or `unknown` (the
 *     coauthor's tool was not recorded, at the cost of eligibility), and `known` is
 *     REFUSED on all five, because a known value there could only be one we made
 *     up. Count them off this list rather than from the prose: an earlier round of
 *     this comment said "two" and then "four" while the table said five, and a
 *     reader who trusted the number left an axis open.
 *   * `humanSeed` must be `known` on `mixed-mechanistic` and is open on `ai` and on
 *     `mixed-ecological`: a mechanistic mixed record is built by editing a specific
 *     human text, a generated record may legitimately answer a bare topic prompt
 *     with no human parent, and an observed coauthored document has no separate
 *     precursor row in this corpus. `derivationRoot` follows the same split, for
 *     the same reason: we derived the mechanistic row and we derived nothing at all
 *     in the ecological one.
 *   * `harnessVersion` is open on rows whose recipe is ours HERE and narrowed by
 *     the lane rule below, because whether a harness exists is a fact about the
 *     lane and must be decided in one place. "One place" holds for the three
 *     classes that can name a lane and NOT for `mixed-ecological`, where this table
 *     refuses `known` on its own: the lane rule fires only when `generationLane` is
 *     `known`, which an ecological row may never be, so it would never speak. A
 *     harness version with no lane behind it is unattributable — it would name a
 *     binary of ours as an input to text no tool of ours produced — so the refusal
 *     has to live here. Do not read the clause above as "leave `harnessVersion`
 *     free on an ecological row and let the lane rule sort it out"; the table
 *     answers first and the row will be refused.
 *   * `domainSource`, `collectionBatch` and `nearDuplicate` admit `known` and
 *     NOTHING else, in every class, and that asymmetry against `harnessVersion` is
 *     deliberate. All three identities are produced by OUR OWN extraction and
 *     pruning: the domain of a source is decided by the extractor that read it, the
 *     batch is assigned by the assembler that wrote the row, and the near-duplicate
 *     cluster comes out of `near_dupes.py` over the corpus itself. So `unknown` on
 *     any of the three is not an unrecoverable gap in the world, it is a defect in
 *     a pipeline we control — and accepting it as `unknown` would ship an
 *     ineligible row where the right outcome is a failing build. The argument does
 *     NOT carry to `harnessVersion`, whose value lives in a third-party binary that
 *     may already have been upgraded past recovery by the time the row is
 *     assembled; there the gap is real, so `unknown` is accepted and priced in
 *     eligibility instead of refused. If a source ever genuinely cannot yield one
 *     of the three, the fix is the extractor or this table, argued — not a
 *     `notApplicable` written to get a row accepted.
 */
const AXIS_STATE_RULE = {
  author: {
    human: ["known", "notApplicable", "unknown"],
    ai: ["notApplicable"],
    "mixed-mechanistic": ["known", "notApplicable", "unknown"],
    "mixed-ecological": ["known", "notApplicable", "unknown"],
  },
  source: {
    human: ["known", "notApplicable", "unknown"],
    ai: ["notApplicable"],
    "mixed-mechanistic": ["known", "notApplicable", "unknown"],
    "mixed-ecological": ["known", "notApplicable", "unknown"],
  },
  domainSource: {
    human: ["known"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["known"],
  },
  humanSeed: {
    human: ["notApplicable"],
    ai: ["known", "notApplicable", "unknown"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["known", "notApplicable", "unknown"],
  },
  promptTemplate: {
    human: ["notApplicable"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["notApplicable", "unknown"],
  },
  generatorFamily: {
    human: ["notApplicable"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["notApplicable", "unknown"],
  },
  generatorVersion: {
    human: ["notApplicable"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["notApplicable", "unknown"],
  },
  generationLane: {
    human: ["notApplicable"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["notApplicable", "unknown"],
  },
  harnessVersion: {
    human: ["notApplicable"],
    ai: ["known", "notApplicable", "unknown"],
    "mixed-mechanistic": ["known", "notApplicable", "unknown"],
    "mixed-ecological": ["notApplicable", "unknown"],
  },
  collectionBatch: {
    human: ["known"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["known"],
  },
  nearDuplicate: {
    human: ["known"],
    ai: ["known"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["known"],
  },
  derivationRoot: {
    human: ["notApplicable"],
    ai: ["known", "notApplicable", "unknown"],
    "mixed-mechanistic": ["known"],
    "mixed-ecological": ["known", "notApplicable", "unknown"],
  },
} as const satisfies Record<
  V3GroupAxis,
  Record<V3AxisClass, readonly GroupAxisState[]>
>;

const V3_LABEL_BASES: readonly LabelBasisValue[] =
  REBUILD_V3_POLICY.labelBasis.allowed;

/** The frozen lane row of `lane`. Total by construction over the lane union. */
export function generationLaneRow(lane: GenerationLane): GenerationLaneRow {
  return REBUILD_V3_POLICY.generationLanes[lane];
}

const GENERATION_LANES = Object.keys(
  REBUILD_V3_POLICY.generationLanes,
) as GenerationLane[];

/**
 * Validates a v3 record. Throws {@link BenchmarkRecordError} on the first
 * problem, naming the field; never coerces and never fills a value in.
 */
export function validateBenchmarkRecordV3(value: unknown): BenchmarkRecordV3 {
  const root = assertClosedObject(value, "", V3_RECORD_KEYS);

  if (root.schemaVersion !== 3) {
    throw new BenchmarkRecordError("schemaVersion must be 3");
  }

  const id = pseudonym(root, "id", "");
  const text = nonEmptyString(root, "text", "", id);
  const normalizedTextSha256 = sha256Hex(root, "normalizedTextSha256", "", id);
  const label = enumValue(root, "label", "", LABELS, id);
  literal(root, "language", "", "pt-BR", id);
  const platform = nonEmptyString(root, "platform", "", id);
  const domain = nonEmptyString(root, "domain", "", id);
  const topic = nonEmptyString(root, "topic", "", id);
  const humanSourceType = optionalNonEmptyString(
    root,
    "humanSourceType",
    "",
    id,
  );
  const hardNegativeFamily = optionalNonEmptyString(
    root,
    "hardNegativeFamily",
    "",
    id,
  );
  const wordCount = finiteNumber(root, "wordCount", "", id);
  const createdAt = finiteNumber(root, "createdAt", "", id);

  const provenance = validateProvenance(root.provenance, id);
  const annotation = validateAnnotation(root.annotation, id);
  const generation = validateGenerationV3(root.generation, id);
  const mixture = validateMixture(root.mixture, id, text.length);
  const transformation = validateTransformation(root.transformation, id);

  // --- label / recipe consistency (the v2 rules, kept) ---------------------
  if (label === "human" && generation !== undefined) {
    throw new BenchmarkRecordError(
      "generation is forbidden when label is human",
      id,
    );
  }
  // A `mixture` block belongs to the `mixed` label and to no other, and this is
  // the FIRST question asked about it — before its fractions, before the recipe
  // rules, and before the cohort is derived from it. It used to be forbidden on
  // `human` only, which left it legal on `ai` with two measured consequences:
  //
  //   * `ai` + `generationMode: "mechanistic"` VALIDATED. A fully generated row
  //     carried an `aiFraction: 0.5` human-coauthorship block, and the only thing
  //     keeping it out of the mechanistic mixed cohort downstream was that every
  //     consumer in metrics.ts happens to gate on `label === "mixed"` first.
  //   * `ai` + `generationMode: "ecological"` was refused by the cohort rule
  //     below, with a sentence about the coauthor's own tool — a cohort the row is
  //     not in — while `label: "ai"` REQUIRES the recipe that sentence forbids. The
  //     two refusals pointed at each other and neither named the contradiction.
  //
  // So the message names the contradiction itself, and it is the same
  // contradiction in both directions: the block describes a document of divided
  // origin while the label claims a single one. It is a reason a caller CANNOT
  // satisfy by editing the block, which is why it must not be phrased as a fact
  // about fractions or recipes — the same precedence argument the ND-over-NC rule
  // in source-manifest.ts uses.
  if (label !== "mixed" && mixture !== undefined) {
    throw new BenchmarkRecordError(
      `mixture is forbidden when label is ${label}: the block describes a document of divided origin, and a ${label} label claims a single one — a divided document is label "mixed", and its generationMode then decides which cohort it belongs to`,
      id,
    );
  }
  if (label === "ai" && generation === undefined) {
    throw new BenchmarkRecordError(
      "generation is required when label is ai",
      id,
    );
  }
  // The mixture is checked BEFORE the axes now, because the COHORT it declares is
  // what the axis table is keyed on. A mixed row with no mixture has no cohort, so
  // it has to be refused here rather than judged against a guessed one.
  if (label === "mixed" && mixture === undefined) {
    throw new BenchmarkRecordError(
      "mixed records require mixture metadata",
      id,
    );
  }
  // Reads the BLOCK rather than the label, deliberately, even though the guard
  // above now makes the two equivalent: the fractions are a property of the block,
  // and if a later edit ever re-admits `mixture` somewhere else, a malformed pair
  // should still be refused rather than silently carried. Pinned on a mixed row so
  // it is not dead code.
  if (mixture !== undefined) {
    const sum = mixture.aiFraction + mixture.humanFraction;
    if (Math.abs(sum - 1) > Number.EPSILON * 8) {
      throw new BenchmarkRecordError("mixed fractions must sum to 1", id);
    }
  }

  const axisClass = v3AxisClass(label, mixture?.generationMode);
  const groups = validateV3Groups(root.groups, id, axisClass);

  // NEW in v3, and conditioned on the COHORT rather than on the class. A
  // `mechanistic` mixed row's AI stretches came out of a generator WE ran, so the
  // recipe is provenance the row must carry; v2 left it optional, which is why a
  // mixed row could name a `generatorFamily` with no recipe behind it, and
  // `mixed_from_pairs.jsonl` already records provider, model and `generatedAt` per
  // row, so the data supports the requirement.
  //
  // It does NOT support it for `ecological`, and requiring it there was a defect of
  // the first C1 round: the evidence quoted above is about the mechanistic cohort
  // only. An observed coauthored document has a recipe belonging to the coauthor's
  // tool — we have no prompt, no template digest and no seed for it — so the only
  // writable form of such a row would have named OUR lane and OUR template. That is
  // invented provenance (R4). Both directions are refusals now, and they are
  // different sentences because they are different mistakes.
  //
  // Both read `axisClass`, the value the axis table is keyed on, rather than
  // `mixture?.generationMode` directly. That is what makes the guards say what they
  // mean: each one is a statement about a COHORT, and a cohort is a mixed row with
  // a mode, never a mode on its own. Before the `mixture`-forbidden guard above
  // existed this was also load-bearing — an `ai` row could reach these lines and be
  // told about the coauthor's tool. It no longer can, so reverting only this pair
  // to the bare `mixture?.generationMode` read is a mutation NO test can kill: with
  // `mixture` confined to `mixed`, the two spellings agree on every input the
  // validator accepts. They are written this way for the reader (C2-C6 build and
  // audit these rows) and to keep the pair from being the last place a mode is
  // trusted without its label.
  if (axisClass === "mixed-mechanistic" && generation === undefined) {
    throw new BenchmarkRecordError(
      "generation is required when label is mixed and mixture.generationMode is mechanistic: the recipe that produced its AI spans is ours, and it is provenance rather than decoration",
      id,
    );
  }
  if (axisClass === "mixed-ecological" && generation !== undefined) {
    throw new BenchmarkRecordError(
      "generation is forbidden when mixture.generationMode is ecological: the assistance came out of the coauthor's own tool, so a recipe of ours attached to the row would be provenance we invented",
      id,
    );
  }

  // --- the label-evidence pair, in BOTH directions --------------------------
  //
  // Two refusals, not one. "Required for human" and "forbidden for ai/mixed" are
  // different failures with different causes: the first is a missing receipt, the
  // second is a receipt attached to a row whose label does not come from one. A
  // generated row carrying `labelBasis: "date-cutoff"` would be claiming its text
  // is human because of its date.
  const labelBasis = optionalEnumValue(
    root,
    "labelBasis",
    "",
    V3_LABEL_BASES,
    id,
  );
  if (label === "human" && labelBasis === undefined) {
    throw new BenchmarkRecordError(
      "labelBasis is required when label is human: the basis of a human label is evidence, and a label with no stated basis is an assertion",
      id,
    );
  }
  if (label !== "human" && labelBasis !== undefined) {
    throw new BenchmarkRecordError(
      `labelBasis is forbidden when label is ${label}: an ai or mixed label comes from generation/mixture, and a derived row resolves its parent's basis through groups.derivationRoot instead of copying it`,
      id,
    );
  }
  if (label !== "human" && root.labelEvidenceRef !== undefined) {
    throw new BenchmarkRecordError(
      `labelEvidenceRef is forbidden when label is ${label}`,
      id,
    );
  }
  let labelEvidenceRef: LabelEvidenceRef | undefined;
  if (labelBasis !== undefined) {
    if (root.labelEvidenceRef === undefined) {
      throw new BenchmarkRecordError(
        "labelEvidenceRef is required whenever labelBasis is present: a basis that names no digested entry cannot be checked by anyone",
        id,
      );
    }
    labelEvidenceRef = validateLabelEvidenceRef(
      root.labelEvidenceRef,
      id,
      labelBasis,
    );
  }

  // --- generator identity: one family, one spelling (A4, carried into v3) ---
  if (generation !== undefined) {
    let expected: GeneratorFamily;
    try {
      expected = normalizeGeneratorFamily(generation.family);
    } catch (error) {
      throw new BenchmarkRecordError(
        `generation.family cannot be normalized into a canonical groups.generatorFamily: ${
          error instanceof GeneratorFamilyError ? error.message : String(error)
        }`,
        id,
      );
    }
    const family = groups.generatorFamily;
    if (family.state !== "known") {
      throw new BenchmarkRecordError(
        `groups.generatorFamily must be known when generation is present: generation.family "${generation.family}" normalizes to "${expected}"`,
        id,
      );
    }
    if (family.id !== expected) {
      throw new BenchmarkRecordError(
        `groups.generatorFamily must be the canonical form of generation.family: expected "${expected}", received "${family.id}"`,
        id,
      );
    }
  }

  // --- the lane decides the harness, the decoding and the effort ------------
  const lane = groups.generationLane;
  if (lane.state === "known") {
    if (generation === undefined) {
      throw new BenchmarkRecordError(
        `groups.generationLane is known ("${lane.id}") but the record carries no generation recipe`,
        id,
      );
    }
    assertLaneAgreement(lane.id, generation, groups, id);
  }

  // --- lineage ---------------------------------------------------------------
  for (const axis of ["derivationRoot", "humanSeed"] as const) {
    const value = groups[axis];
    if (value.state === "known" && value.id === id) {
      throw new BenchmarkRecordError(
        `groups.${axis} must not name the record itself`,
        id,
      );
    }
  }

  if (
    annotation.agreement === "adjudicated" &&
    annotation.adjudicatorId === undefined
  ) {
    throw new BenchmarkRecordError(
      "adjudicated records require adjudicatorId",
      id,
    );
  }

  const record: BenchmarkRecordV3 = {
    schemaVersion: 3,
    id,
    text,
    normalizedTextSha256,
    label,
    language: "pt-BR",
    platform,
    domain,
    topic,
    wordCount,
    createdAt,
    provenance,
    annotation,
    transformation,
    groups,
  };
  if (humanSourceType !== undefined) record.humanSourceType = humanSourceType;
  if (hardNegativeFamily !== undefined) {
    record.hardNegativeFamily = hardNegativeFamily;
  }
  if (labelBasis !== undefined) record.labelBasis = labelBasis;
  if (labelEvidenceRef !== undefined) {
    record.labelEvidenceRef = labelEvidenceRef;
  }
  if (generation !== undefined) record.generation = generation;
  if (mixture !== undefined) record.mixture = mixture;
  return record;
}

function validateV3Groups(
  value: unknown,
  id: string,
  axisClass: V3AxisClass,
): V3Groups {
  const obj = assertClosedObject(value, "groups", V3_GROUP_AXES, id);
  const groups: Record<string, GroupAxisValue> = {};
  for (const axis of V3_GROUP_AXES) {
    // Absent is its OWN refusal and not "unknown by default": a producer that
    // never wrote the key made no statement at all, and reading that as `unknown`
    // would silently mark the record ineligible instead of failing the write.
    if (!Object.hasOwn(obj, axis) || obj[axis] === undefined) {
      throw new BenchmarkRecordError(
        `groups.${axis} is required: every axis states known, notApplicable or unknown, and an absent key states nothing`,
        id,
      );
    }
    const parsed = validateGroupAxisValue(obj[axis], `groups.${axis}`, id);
    const allowed: readonly GroupAxisState[] = AXIS_STATE_RULE[axis][axisClass];
    if (!allowed.includes(parsed.state)) {
      throw new BenchmarkRecordError(
        `groups.${axis} of ${AXIS_CLASS_LABEL[axisClass]} must be ${allowed.join(" or ")}, received ${parsed.state}`,
        id,
      );
    }
    if (parsed.state === "known") {
      if (
        axis === "generatorFamily" &&
        !isCanonicalGeneratorFamily(parsed.id)
      ) {
        throw new BenchmarkRecordError(
          `groups.generatorFamily.id must be a generator family in canonical form (no dots): received ${JSON.stringify(parsed.id)}`,
          id,
        );
      }
      if (
        axis === "generationLane" &&
        !GENERATION_LANES.includes(parsed.id as GenerationLane)
      ) {
        throw new BenchmarkRecordError(
          `groups.generationLane.id must be one of ${GENERATION_LANES.join(", ")}, received ${JSON.stringify(parsed.id)}`,
          id,
        );
      }
    }
    groups[axis] = parsed;
  }
  return groups as unknown as V3Groups;
}

function validateGroupAxisValue(
  value: unknown,
  path: string,
  id: string,
): GroupAxisValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchmarkRecordError(
      `${path} must be an object carrying a state, never a bare identifier`,
      id,
    );
  }
  const obj = value as Record<string, unknown>;
  const state = obj.state;
  if (
    typeof state !== "string" ||
    !GROUP_AXIS_STATES.includes(state as GroupAxisState)
  ) {
    throw new BenchmarkRecordError(
      `${path}.state must be one of ${GROUP_AXIS_STATES.join(", ")}`,
      id,
    );
  }
  if (state === "known") {
    assertClosedObject(value, path, ["state", "id"], id);
    return { state: "known", id: pseudonym(obj, "id", path, id) };
  }
  assertClosedObject(value, path, ["state", "reason"], id);
  const reason = nonEmptyString(obj, "reason", path, id);
  return state === "notApplicable"
    ? { state: "notApplicable", reason }
    : { state: "unknown", reason };
}

function validateGenerationV3(
  value: unknown,
  id: string,
): GenerationV3 | undefined {
  if (value === undefined) return undefined;
  const obj = assertClosedObject(value, "generation", V3_GENERATION_KEYS, id);
  const generation: GenerationV3 = {
    provider: nonEmptyString(obj, "provider", "generation", id),
    family: nonEmptyString(obj, "family", "generation", id),
    model: nonEmptyString(obj, "model", "generation", id),
    version: nonEmptyString(obj, "version", "generation", id),
    promptId: pseudonym(obj, "promptId", "generation", id),
    promptSha256: sha256Hex(obj, "promptSha256", "generation", id),
    promptTemplateDigest: sha256Hex(
      obj,
      "promptTemplateDigest",
      "generation",
      id,
    ),
    generatedAt: finiteNumber(obj, "generatedAt", "generation", id),
    decoding: validateDecodingConfig(obj.decoding, id),
    effort: validateEffortConfig(obj.effort, id),
  };

  // Exactly one of a seed and a written reason there is none. Never invent a seed.
  const seed = optionalNonEmptyString(obj, "seed", "generation", id);
  const seedNullReason = optionalNonEmptyString(
    obj,
    "seedNullReason",
    "generation",
    id,
  );
  if ((seed === undefined) === (seedNullReason === undefined)) {
    throw new BenchmarkRecordError(
      "generation must record exactly one of seed or seedNullReason",
      id,
    );
  }
  if (seed !== undefined) generation.seed = seed;
  if (seedNullReason !== undefined) generation.seedNullReason = seedNullReason;
  return generation;
}

function validateDecodingConfig(value: unknown, id: string): DecodingConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchmarkRecordError("generation.decoding must be an object", id);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.configurable !== "boolean") {
    throw new BenchmarkRecordError(
      "generation.decoding.configurable must be a boolean",
      id,
    );
  }
  if (!obj.configurable) {
    assertClosedObject(value, "generation.decoding", ["configurable"], id);
    return { configurable: false };
  }
  assertClosedObject(
    value,
    "generation.decoding",
    DECODING_CONFIGURABLE_KEYS,
    id,
  );
  return {
    configurable: true,
    strategy: nullableNonEmptyString(
      obj,
      "strategy",
      "generation.decoding",
      id,
    ),
    temperature: nullableFiniteNumber(
      obj,
      "temperature",
      "generation.decoding",
      id,
    ),
    topP: nullableFiniteNumber(obj, "topP", "generation.decoding", id),
    repetitionPenalty: nullableFiniteNumber(
      obj,
      "repetitionPenalty",
      "generation.decoding",
      id,
    ),
  };
}

const EFFORT_SOURCES: readonly EffortSource[] = [
  "model-id",
  "flag",
  "not-supported",
  "provider-default",
];

function validateEffortConfig(value: unknown, id: string): EffortConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchmarkRecordError("generation.effort must be an object", id);
  }
  const obj = value as Record<string, unknown>;
  const source = enumValue(
    obj,
    "source",
    "generation.effort",
    EFFORT_SOURCES,
    id,
  );
  if (typeof obj.configurable !== "boolean") {
    throw new BenchmarkRecordError(
      "generation.effort.configurable must be a boolean",
      id,
    );
  }
  // Checked BEFORE the lane cross-check on purpose. This pair contradicts itself
  // without reference to any lane — it claims a flag was passed to something that
  // accepts none — so it is a reason no lane row could satisfy away, and naming a
  // lane instead would point at a field the producer could "fix" by relabelling.
  // It is also the exact shape an invented provenance takes.
  if (source === "flag" && !obj.configurable) {
    throw new BenchmarkRecordError(
      'generation.effort claims source "flag" while configurable is false: a value passed as a flag is by definition configurable',
      id,
    );
  }
  if (source === "not-supported") {
    if (obj.configurable) {
      throw new BenchmarkRecordError(
        'generation.effort source "not-supported" cannot be configurable',
        id,
      );
    }
    assertClosedObject(
      value,
      "generation.effort",
      ["source", "configurable"],
      id,
    );
    return { source: "not-supported", configurable: false };
  }
  assertClosedObject(value, "generation.effort", EFFORT_LEVELLED_KEYS, id);
  return {
    source,
    configurable: obj.configurable,
    scale: nonEmptyString(obj, "scale", "generation.effort", id),
    level: nonEmptyString(obj, "level", "generation.effort", id),
  };
}

// Everything the frozen lane row decides about a record, in one place. Reading
// the row rather than repeating its facts is what stops the schema and D3 from
// disagreeing about which lane accepts what.
function assertLaneAgreement(
  lane: GenerationLane,
  generation: GenerationV3,
  groups: V3Groups,
  id: string,
): void {
  const row = generationLaneRow(lane);

  const harness = groups.harnessVersion;
  if (laneRunsHarness(row)) {
    // On a CLI lane `notApplicable` is REFUSED and `unknown` is ACCEPTED, and the
    // difference is the whole of R6. The lane runs a harness binary that injects a
    // system prompt, loops over tools, retries and post-processes, so its version
    // is an input to the text: claiming the axis does not apply is a false
    // statement about the lane, while stating the version was not recovered is a
    // true statement with a price — the record becomes INELIGIBLE
    // ({@link recordEligibility}) and is never given a synthesized version.
    //
    // Refusing `unknown` here too would look stricter and be worse: it would push
    // a producer that genuinely did not capture the binary version toward writing
    // `notApplicable` to get the row accepted, which is exactly the substitution
    // this schema exists to make impossible.
    if (harness.state === "notApplicable") {
      throw new BenchmarkRecordError(
        `groups.harnessVersion must be known on the CLI lane "${lane}" (or unknown, which makes the record ineligible): the binary is an input to the text, so the axis does apply and is never synthesized`,
        id,
      );
    }
  } else if (harness.state === "known") {
    throw new BenchmarkRecordError(
      `groups.harnessVersion must be notApplicable on the lane "${lane}", which runs no harness binary`,
      id,
    );
  }

  if (generation.decoding.configurable !== row.decodingConfigurable) {
    throw new BenchmarkRecordError(
      `generation.decoding.configurable must be ${String(row.decodingConfigurable)} on the lane "${lane}"`,
      id,
    );
  }

  const effort = generation.effort;
  if (!row.effortSources.includes(effort.source)) {
    throw new BenchmarkRecordError(
      `generation.effort.source "${effort.source}" is not offered by the lane "${lane}" (it offers ${row.effortSources.join(", ")})`,
      id,
    );
  }
  if (effort.source !== "not-supported") {
    if (effort.configurable !== row.effortConfigurable) {
      throw new BenchmarkRecordError(
        `generation.effort.configurable must be ${String(row.effortConfigurable)} on the lane "${lane}"`,
        id,
      );
    }
    if (effort.scale !== row.effortScale) {
      throw new BenchmarkRecordError(
        `generation.effort.scale must be "${String(row.effortScale)}" on the lane "${lane}", received "${effort.scale}"`,
        id,
      );
    }
    if (!row.effortLevels.includes(effort.level)) {
      throw new BenchmarkRecordError(
        `generation.effort.level "${effort.level}" is not in the scale "${effort.scale}" (its levels are ${row.effortLevels.join(", ")}). Effort is not an ordinal shared across providers: codex reaches xhigh and agy stops at high`,
        id,
      );
    }
  }
}

function validateLabelEvidenceRef(
  value: unknown,
  id: string,
  labelBasis: LabelBasisValue,
): LabelEvidenceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchmarkRecordError("labelEvidenceRef must be an object", id);
  }
  const obj = value as Record<string, unknown>;
  const basis = enumValue(obj, "basis", "labelEvidenceRef", V3_LABEL_BASES, id);
  // DIVERGENCE, first form: the reference describes a different basis than the
  // record claims. Refused rather than reconciled — either the label is wrong or
  // the receipt is, and picking one would be guessing which.
  if (basis !== labelBasis) {
    throw new BenchmarkRecordError(
      `labelEvidenceRef.basis "${basis}" diverges from labelBasis "${labelBasis}"`,
      id,
    );
  }
  if (basis === "date-cutoff") {
    assertClosedObject(value, "labelEvidenceRef", DATE_CUTOFF_REF_KEYS, id);
    const observedValue = isoInstant(
      obj,
      "observedValue",
      "labelEvidenceRef",
      id,
    );
    const cutoff = isoInstant(obj, "cutoff", "labelEvidenceRef", id);
    // The reference has to be internally true: a date at or after the cutoff it
    // names does not support the basis it claims to support. This is checkable
    // without the private manifest, so it is checked here.
    if (Date.parse(observedValue) >= Date.parse(cutoff)) {
      throw new BenchmarkRecordError(
        `labelEvidenceRef.observedValue "${observedValue}" is not before the cutoff "${cutoff}", so it does not support a date-cutoff basis`,
        id,
      );
    }
    const snapshot = nonEmptyString(obj, "snapshot", "labelEvidenceRef", id);
    if (!REBUILD_V3_POLICY.humanSources.snapshots.includes(snapshot)) {
      throw new BenchmarkRecordError(
        `labelEvidenceRef.snapshot must be one of ${REBUILD_V3_POLICY.humanSources.snapshots.join(", ")}, received "${snapshot}"`,
        id,
      );
    }
    return {
      basis: "date-cutoff",
      entryId: pseudonym(obj, "entryId", "labelEvidenceRef", id),
      entryDigest: sha256Hex(obj, "entryDigest", "labelEvidenceRef", id),
      dateField: nonEmptyString(obj, "dateField", "labelEvidenceRef", id),
      observedValue,
      cutoff,
      snapshot,
    };
  }
  assertClosedObject(value, "labelEvidenceRef", OBSERVED_PROCESS_REF_KEYS, id);
  const controlsRaw = obj.controls;
  if (!Array.isArray(controlsRaw) || controlsRaw.length === 0) {
    throw new BenchmarkRecordError(
      "labelEvidenceRef.controls must list at least one applied control",
      id,
    );
  }
  const controls = controlsRaw.map((control, index) => {
    if (typeof control !== "string" || control.trim().length === 0) {
      throw new BenchmarkRecordError(
        `labelEvidenceRef.controls[${index}] must be a non-empty string`,
        id,
      );
    }
    return control;
  }) as [string, ...string[]];
  return {
    basis: "observed-process",
    entryId: pseudonym(obj, "entryId", "labelEvidenceRef", id),
    entryDigest: sha256Hex(obj, "entryDigest", "labelEvidenceRef", id),
    protocol: nonEmptyString(obj, "protocol", "labelEvidenceRef", id),
    protocolVersion: nonEmptyString(
      obj,
      "protocolVersion",
      "labelEvidenceRef",
      id,
    ),
    sessionLogDigest: sha256Hex(
      obj,
      "sessionLogDigest",
      "labelEvidenceRef",
      id,
    ),
    controls,
    residualRisk: nonEmptyString(obj, "residualRisk", "labelEvidenceRef", id),
  };
}

// --- accessors and dataset-level guards ------------------------------------

/**
 * The pseudonymised identity of one axis, or `undefined` when the axis is not
 * `known`. THE accessor: it reads a record of either version, so a consumer does
 * not branch on `schemaVersion` and a v2 empty string and a v3 `notApplicable`
 * arrive as the same "no identity here".
 *
 * `undefined` deliberately collapses `notApplicable` and `unknown`, because for a
 * consumer that is grouping rows the two behave the same way: neither joins this
 * row to another. The distinction matters for ELIGIBILITY, not for grouping, and
 * that question is {@link recordEligibility}'s.
 */
export function groupAxisIdentity(
  record: BenchmarkRecord,
  axis: V3GroupAxis,
): string | undefined {
  const value = (
    record.groups as Record<string, string | GroupAxisValue | undefined>
  )[axis];
  if (value === undefined) return undefined;
  // Dispatched on the VALUE's shape rather than on `record.schemaVersion`, and
  // deliberately: a string is unambiguously a v2 identity and an object is
  // unambiguously a v3 axis, so the reader is total over both without depending on
  // a field that a partially-built record (C2 mid-assembly) may not have set yet.
  // `schemaVersion` remains the discriminant for the VALIDATOR, where the question
  // is which contract to enforce; here the question is only what this value says.
  if (typeof value === "string") return value === "" ? undefined : value;
  return value.state === "known" ? value.id : undefined;
}

/**
 * The sampling temperature a record's recipe applied, or `null` when none did.
 * Version-aware for the same reason {@link groupAxisIdentity} is: v2 keeps it as a
 * top-level optional on `generation`, v3 keeps it inside the `configurable: true`
 * branch of `decoding`, and a consumer comparing a record against a declared batch
 * is asking one question, not two.
 *
 * `null` covers three states that are all "no temperature was applied": a v2 record
 * that recorded none, a v3 CLI row whose branch has no such field, and a v3 api row
 * that left the provider's default in place. Only the last of those is
 * distinguishable, and the distinction belongs to a reader of `decoding`, not to a
 * batch comparison.
 */
export function recipeTemperature(
  generation: NonNullable<BenchmarkRecord["generation"]>,
): number | null {
  if ("decoding" in generation) {
    return generation.decoding.configurable
      ? generation.decoding.temperature
      : null;
  }
  return generation.temperature ?? null;
}

/**
 * The state of one axis.
 *
 * A v2 record has no states, so a filled axis reads as `known` and an absent one
 * as `unknown` — which is the truthful mapping and NOT a flattering one: it means
 * `recordEligibility` reports a v2 record with an absent axis as ineligible, and a
 * v2 record has no way to say `notApplicable` about anything.
 */
export function groupAxisState(
  record: BenchmarkRecord,
  axis: V3GroupAxis,
): GroupAxisState {
  const value = (
    record.groups as Record<string, string | GroupAxisValue | undefined>
  )[axis];
  if (value === undefined) return "unknown";
  if (typeof value === "string") return value === "" ? "unknown" : "known";
  return value.state;
}

/** The canonical generator family of a record of either version. */
export function recordGeneratorFamily(
  record: BenchmarkRecord,
): GeneratorFamily | undefined {
  return groupAxisIdentity(record, "generatorFamily") as
    GeneratorFamily | undefined;
}

/**
 * The author identity a caller uses as a RESAMPLING CLUSTER — or a loud failure.
 *
 * It throws for a v3 record whose `author` axis is not `known`, and that is the
 * correct outcome rather than an inconvenience. The three alternatives were all
 * considered and all are worse:
 *
 *   * return `record.id` — synthesizes one cluster per row. That IS the v2 defect:
 *     10.000 singleton "authors" that made a clustered bootstrap i.i.d. and
 *     narrowed every interval by an unrecoverable amount.
 *   * return `undefined` and let the caller skip the row — drops rows from a
 *     denominator silently, which is worse than failing.
 *   * fall back to independent rows — refused by the frozen contract itself:
 *     `resampling.fallbackToIndependentRows: false`.
 *
 * So on a v3 corpus this throws by design, because `author` is `notApplicable` on
 * every generated row BY RULE (generated text has no human author), and therefore
 * the author axis is NOT a resampling unit for a v3 corpus. Choosing the unit per
 * estimand is C4's task; this function exists so that the pipeline says so instead
 * of quietly computing an interval that means nothing.
 */
export function authorClusterKey(record: BenchmarkRecord): string {
  const identity = groupAxisIdentity(record, "author");
  if (identity !== undefined) return identity;
  throw new BenchmarkRecordError(
    `groups.author is ${groupAxisState(record, "author")}, so it is not a resampling unit for this record. Choosing the unit per estimand is C4's decision; the frozen contract sets resampling.fallbackToIndependentRows to false, so there is no default to fall back to`,
    record.id,
  );
}

/**
 * Is the record eligible, and which axes made it ineligible?
 *
 * R6 in one function: `unknown` on ANY axis makes the record ineligible, while
 * `notApplicable` does not. It is DERIVED and never stored, because a stored
 * eligibility flag is a second copy of the axes that can disagree with them.
 *
 * The axes are returned in {@link V3_GROUP_AXES} order so the answer is stable
 * and a report can name them without sorting.
 */
export function recordEligibility(record: BenchmarkRecord): {
  eligible: boolean;
  unknownAxes: V3GroupAxis[];
} {
  const unknownAxes = V3_GROUP_AXES.filter(
    (axis) => groupAxisState(record, axis) === "unknown",
  );
  return { eligible: unknownAxes.length === 0, unknownAxes };
}

/**
 * Refuses a record that fails to fill an axis its SOURCE declared applicable.
 *
 * The two halves of the comparison live apart on purpose: a source declares its
 * axes on `HumanSourceRegistrationV1.declaredGroupAxes`
 * (benchmark/source-manifest.ts) and a record fills them here, and C3 is what
 * joins the two. Passing the declared list in as a plain argument is what keeps
 * this module from importing the source manifest.
 *
 * `notApplicable` is refused as well as `unknown`, and the two get different
 * sentences. They are different failures: `unknown` means the extractor did not
 * recover a value the source says exists, while `notApplicable` CONTRADICTS the
 * source's own declaration — one is a gap, the other is a disagreement.
 *
 * NOT WIRED YET, and deliberately named as such: no production path calls this.
 * The obligation is C3's — it is the task that reads
 * `private/source-manifest.json`, so it is the only one that can pair a record
 * with its source's declaration. Until then the refusal is proven against this
 * exported function by test and is NOT a property of any pipeline. Wiring it
 * anywhere else would mean this module reaching for the private manifest, which is
 * the one thing the split above exists to prevent.
 */
export function assertDeclaredAxesResolved(
  record: BenchmarkRecord,
  declaredAxes: readonly V3GroupAxis[],
): void {
  for (const axis of declaredAxes) {
    const state = groupAxisState(record, axis);
    if (state === "known") continue;
    throw new BenchmarkRecordError(
      state === "unknown"
        ? `the source declares axis "${axis}" applicable, and the record leaves it unknown: the record is ineligible and the axis was not recovered`
        : `the source declares axis "${axis}" applicable, and the record states notApplicable: the record contradicts its own source declaration`,
      record.id,
    );
  }
}

/**
 * Refuses a record whose `labelEvidenceRef` does not RESOLVE against the private
 * source manifest.
 *
 * `index` maps `entryId -> entryDigest` and is built by the caller from the
 * private file. That is the privacy boundary: the manifest itself never enters
 * this module, no record, and nothing published. Only opaque digests cross.
 *
 * Two distinct refusals, because they are two distinct facts: an entry that is
 * ABSENT means the record points at nothing, and a digest that DIVERGES means the
 * entry it points at is not the one that was digested when the record was
 * written — the reference resolved, to different bytes.
 *
 * NOT WIRED YET. `validateBenchmarkRecordV3` checks everything a reference can be
 * checked for WITHOUT the private file (its basis agrees with the label, its
 * per-basis payload is complete and closed, its snapshot is a frozen one, its
 * observed date really precedes the cutoff it names) and stops there, because the
 * index does not exist inside this module. Building it from
 * `private/source-manifest.json` and calling this on every human row is C3's
 * obligation; until then "refuses a divergent reference" is a property of this
 * function and not of the ingest path.
 */
export function assertLabelEvidenceResolves(
  records: readonly BenchmarkRecord[],
  index: ReadonlyMap<string, string>,
): void {
  for (const record of records) {
    if (record.schemaVersion !== 3) continue;
    const ref = record.labelEvidenceRef;
    if (ref === undefined) continue;
    const digest = index.get(ref.entryId);
    if (digest === undefined) {
      throw new BenchmarkRecordError(
        `labelEvidenceRef entry "${ref.entryId}" is absent from the private source manifest`,
        record.id,
      );
    }
    if (digest !== ref.entryDigest) {
      throw new BenchmarkRecordError(
        `labelEvidenceRef entry "${ref.entryId}" digest diverges from the private source manifest`,
        record.id,
      );
    }
  }
}

/**
 * Refuses a derived record whose human parent does not resolve.
 *
 * This is a DATASET-level guard because one record cannot answer the question: the
 * parent is another row. Three refusals, and they are three different facts —
 * a parent that is not in the dataset at all, a parent that is not human, and a
 * human parent carrying no `labelBasis`.
 *
 * The third is what makes the "resolve, do not duplicate" design safe. A derived
 * record does NOT copy its parent's basis, so the parent's basis is the only copy
 * there is; if the parent has none, the derived row's provenance terminates in
 * nothing, and the whole chain is unsupported. Refusing the derived row is
 * therefore not pedantry about a missing field — it is refusing a lineage with no
 * evidence at its root.
 *
 * NOT WIRED YET. `parseBenchmarkDataset` deliberately does not call it: that
 * function parses a JSONL file that may be one PARTITION, and a parent legitimately
 * lives in another, so calling it there would refuse valid files. It belongs on the
 * whole-corpus path — C3's audit, beside `assertDeclaredAxesResolved` — and until
 * that call exists a JSONL file whose derived rows name a missing or non-human
 * parent parses without complaint. The refusal is proven against this function, not
 * against any pipeline.
 */
export function assertDerivedParentsResolve(
  records: readonly BenchmarkRecord[],
): void {
  const byId = new Map<string, BenchmarkRecord>();
  for (const record of records) byId.set(record.id, record);

  for (const record of records) {
    if (record.schemaVersion !== 3) continue;
    if (record.label === "human") continue;
    for (const axis of ["humanSeed", "derivationRoot"] as const) {
      const parentId = groupAxisIdentity(record, axis);
      if (parentId === undefined) continue;
      const parent = byId.get(parentId);
      if (parent === undefined) {
        throw new BenchmarkRecordError(
          `groups.${axis} "${parentId}" resolves to no record in the dataset`,
          record.id,
        );
      }
      // `derivationRoot` may name a generated parent (a paraphrase of a
      // generation is a legitimate chain), while `humanSeed` names the HUMAN text
      // a generation started from, so only that one has a class to satisfy.
      if (axis === "derivationRoot") continue;
      if (parent.label !== "human") {
        throw new BenchmarkRecordError(
          `groups.humanSeed "${parentId}" resolves to a record whose label is ${parent.label}, not human`,
          record.id,
        );
      }
      if (parent.schemaVersion !== 3 || parent.labelBasis === undefined) {
        throw new BenchmarkRecordError(
          `groups.humanSeed "${parentId}" resolves to a human record carrying no labelBasis, so the derived row's provenance ends in nothing`,
          record.id,
        );
      }
    }
  }
}

/**
 * Orders two efforts measured ON THE SAME SCALE, and REFUSES a cross-scale pair.
 *
 * There is deliberately no comparator that ignores the scale. `codex` reaches
 * `xhigh` and `agy` stops at `high`, so "high" is not one quantity: treating the
 * levels as a shared ordinal would rank two providers on an axis neither of them
 * defines. This is the same prohibition as `cohortsAggregated: false` for
 * `mechanistic` vs `ecological`, and it is enforced at runtime because a type
 * cannot carry a scale that is only known from the data.
 *
 * Returns a negative number, zero or a positive number, comparing the positions of
 * the two levels within the lane's own ordered level list.
 */
export function compareEffortWithinScale(
  left: EffortConfig,
  right: EffortConfig,
): number {
  if (left.source === "not-supported" || right.source === "not-supported") {
    throw new BenchmarkRecordError(
      "effort is not comparable across scales: one side has no effort at all",
    );
  }
  if (left.scale !== right.scale) {
    throw new BenchmarkRecordError(
      `effort is not comparable across scales: "${left.scale}" and "${right.scale}" are different measurements, not two points of one ordinal`,
    );
  }
  const levels = effortLevelsOfScale(left.scale);
  const leftIndex = levels.indexOf(left.level);
  const rightIndex = levels.indexOf(right.level);
  if (leftIndex < 0 || rightIndex < 0) {
    throw new BenchmarkRecordError(
      `effort level outside the scale "${left.scale}"`,
    );
  }
  return leftIndex - rightIndex;
}

// The ordered levels of a named scale, found by scanning the frozen lane table.
// The scale name is the join key; no lane may reuse another lane's scale name,
// which is what makes the lookup unambiguous.
function effortLevelsOfScale(scale: string): readonly string[] {
  for (const lane of GENERATION_LANES) {
    const row = generationLaneRow(lane);
    if (row.effortScale === scale) return row.effortLevels;
  }
  throw new BenchmarkRecordError(
    `effort scale "${scale}" is not declared by any frozen lane`,
  );
}

// --- v3 primitive validators ------------------------------------------------

function optionalEnumValue<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
  id: string,
): T | undefined {
  if (obj[key] === undefined) return undefined;
  return enumValue(obj, key, path, allowed, id);
}

function nullableNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string | null {
  if (!Object.hasOwn(obj, key)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} is required (use null when the provider default applied)`,
      id,
    );
  }
  if (obj[key] === null) return null;
  return nonEmptyString(obj, key, path, id);
}

function nullableFiniteNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): number | null {
  if (!Object.hasOwn(obj, key)) {
    throw new BenchmarkRecordError(
      `${field(path, key)} is required (use null when the provider default applied)`,
      id,
    );
  }
  if (obj[key] === null) return null;
  return finiteNumber(obj, key, path, id);
}

function isoInstant(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  id: string,
): string {
  const value = nonEmptyString(obj, key, path, id);
  if (!Number.isFinite(Date.parse(value))) {
    throw new BenchmarkRecordError(
      `${field(path, key)} must be a parseable ISO instant`,
      id,
    );
  }
  return value;
}
