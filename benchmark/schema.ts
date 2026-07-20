// Closed benchmark record schema (v2) and cross-field validation. This module
// is intentionally standalone and MUST NOT import from the extension bundle
// (src/): the benchmark lives outside the shipped extension and only depends on
// plain data.
//
// "Closed" means every object is validated against an exact key set: any
// unknown field, repeated id/hash, score outside its range, or contradictory
// metadata is a hard failure. There is no coercion and no last-write-wins.
// Ground truth (the class label) is derived from documented provenance, never
// from a detector's opinion, so the schema only records provenance and never a
// predicted score.

export type BenchmarkLabel = "human" | "ai" | "mixed";

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

export interface BenchmarkRecord {
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
    generatorFamily?: string;
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
const MIXTURE_KEYS = ["aiFraction", "humanFraction", "spans"];
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

export function validateBenchmarkRecord(value: unknown): BenchmarkRecord {
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
  if (
    annotation.agreement === "adjudicated" &&
    annotation.adjudicatorId === undefined
  ) {
    throw new BenchmarkRecordError(
      "adjudicated records require adjudicatorId",
      id,
    );
  }

  const record: BenchmarkRecord = {
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
): BenchmarkRecord["provenance"] {
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
  const piiAudit: BenchmarkRecord["provenance"]["piiAudit"] = {
    status: "passed",
    method: "manual-and-automated",
    reviewerId: pseudonym(auditObj, "reviewerId", "provenance.piiAudit", id),
    reviewedAt: finiteNumber(auditObj, "reviewedAt", "provenance.piiAudit", id),
  };

  const provenance: BenchmarkRecord["provenance"] = {
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
): BenchmarkRecord["annotation"] {
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

  const annotation: BenchmarkRecord["annotation"] = {
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
): BenchmarkRecord["generation"] {
  if (value === undefined) return undefined;
  const obj = assertClosedObject(value, "generation", GENERATION_KEYS, id);
  const generation: NonNullable<BenchmarkRecord["generation"]> = {
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
): BenchmarkRecord["mixture"] {
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

  return { aiFraction, humanFraction, spans };
}

function validateTransformation(
  value: unknown,
  id: string,
): BenchmarkRecord["transformation"] {
  const obj = assertClosedObject(
    value,
    "transformation",
    TRANSFORMATION_KEYS,
    id,
  );
  const transformation: BenchmarkRecord["transformation"] = {
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

function validateGroups(value: unknown, id: string): BenchmarkRecord["groups"] {
  const obj = assertClosedObject(value, "groups", GROUPS_KEYS, id);
  const groups: BenchmarkRecord["groups"] = {
    author: pseudonym(obj, "author", "groups", id),
    source: pseudonym(obj, "source", "groups", id),
    domainSource: pseudonym(obj, "domainSource", "groups", id),
    collectionBatch: pseudonym(obj, "collectionBatch", "groups", id),
    nearDuplicate: pseudonym(obj, "nearDuplicate", "groups", id),
    derivationRoot: pseudonym(obj, "derivationRoot", "groups", id),
  };
  const generatorFamily = optionalPseudonym(
    obj,
    "generatorFamily",
    "groups",
    id,
  );
  if (generatorFamily !== undefined) groups.generatorFamily = generatorFamily;
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
  id: string,
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
