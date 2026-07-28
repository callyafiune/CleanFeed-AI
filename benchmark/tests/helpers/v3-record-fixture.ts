// Schema v3 record fixtures with REAL provenance, shared by schema.test.ts and
// dataset-manifest.test.ts.
//
// Everything here is modelled on the candidate pools an operator actually holds
// (`benchmark/data/candidates/*.jsonl`), not invented: the AI fixture's lane,
// family, prompt id and `seedNullReason` are the shapes `ai_fresh_agy.jsonl`
// carries, and the human fixture's anchor date field is the one
// `benchmark/lab/extract_stackexchange.py` reads. The ids are pseudonymised
// tokens, as the schema requires.
//
// The builders return `Record<string, unknown>` on purpose: every refusal test
// needs to DELETE a required key or write a contradictory value, which a typed
// literal would reject at compile time before the validator ever ran. Each call
// returns a fresh deep copy, so a test that mutates cannot leak into the next.

const HUMAN_TEXT = Array.from(
  { length: 100 },
  (_, index) => `palavra${index}`,
).join(" ");

const AI_TEXT = Array.from({ length: 100 }, (_, index) => `token${index}`).join(
  " ",
);

const MIXED_TEXT = Array.from(
  { length: 100 },
  (_, index) => `misto${index}`,
).join(" ");

/** `known` axis value. */
export function known(id: string): Record<string, unknown> {
  return { state: "known", id };
}

/** `notApplicable` axis value; the reason is mandatory in v3. */
export function notApplicable(reason: string): Record<string, unknown> {
  return { state: "notApplicable", reason };
}

/** `unknown` axis value; makes the record ineligible. */
export function unknownAxis(reason: string): Record<string, unknown> {
  return { state: "unknown", reason };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const HUMAN_NO_GENERATOR = "human record: no generator produced this text";
const HUMAN_NOT_DERIVED =
  "original human text, not derived from another record";
const AI_NO_HUMAN_AUTHOR = "generated text has no human author";

// --- the review state (C5) --------------------------------------------------
//
// EVERY v3 fixture here is `automated/unreviewed`, and that is not laziness: no
// human reviewer existed for this corpus, so a fixture pool modelled on it must
// not carry a receipt by default. `humanReviewed()` exists because the coherence
// rules cannot be tested without a COHERENT receipt to mutate, and a fixture is
// hypothetical data — writing one here is not the thing R4 forbids, which is
// writing a receipt into a corpus, into the assembler, or into an artifact.
// Nothing in `benchmark/lab/` or `benchmark/data/` may produce this shape until a
// real review happens (D1/D5).

/** The automated PII screen the extractors really run, named honestly. */
export function piiPatternScan(): Record<string, unknown> {
  return {
    filter: "pii-pattern-scan",
    implementation: "benchmark/lab/common.py:pii_hits",
    outcome: "passed",
  };
}

/** The honest state of every record this project has: filtered, never audited. */
export function automatedUnreviewed(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: "automated/unreviewed",
    automatedFilters: [piiPatternScan()],
    humanAuditAbsentReason:
      "no human reviewer was assigned to this corpus build; only the automated filters ran",
    ...overrides,
  };
}

// Two instants inside the window a receipt date must fall in: at or after the
// protocol's effective instant and not in the future. Written as constants so a
// date test mutates ONE of them and the rest of the fixture stays coherent.
const REVIEWED_AT = Date.parse("2026-07-27T09:00:00.000Z");
const ADJUDICATED_AT = Date.parse("2026-07-27T11:00:00.000Z");

/** One reviewer's individual opinion, blind to the score and to the class. */
export function opinion(
  reviewerId: string,
  decision: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reviewerId,
    decision,
    decidedAt: REVIEWED_AT,
    blindToScore: true,
    blindToCandidateClass: true,
    ...overrides,
  };
}

/**
 * A COHERENT two-reviewer receipt, agreeing on `decision`. The control every
 * incoherence test mutates one field of.
 */
export function humanReviewed(
  decision: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: "human-reviewed",
    protocolVersion: "annotation-v2",
    reviewerIds: ["rev_hmac_a1", "rev_hmac_b2"],
    decisions: [
      opinion("rev_hmac_a1", decision),
      opinion("rev_hmac_b2", decision),
    ],
    agreement: "agree",
    pii: {
      protocol: "pii-review-v1",
      automatedStage: piiPatternScan(),
      reviewerId: "rev_hmac_pii",
      reviewedAt: REVIEWED_AT,
      treatment: "no-identifier-found",
    },
    ...overrides,
  };
}

/** A resolved disagreement: two opposed opinions plus a named adjudication. */
export function adjudicated(
  decision: string,
  other: string,
): Record<string, unknown> {
  return humanReviewed(decision, {
    decisions: [
      opinion("rev_hmac_a1", decision),
      opinion("rev_hmac_b2", other),
    ],
    agreement: "disagree",
    adjudication: {
      adjudicatorId: "rev_hmac_c3",
      decision,
      decidedAt: ADJUDICATED_AT,
      rationale:
        "the second reviewer read the quoted stretch as generated; the quotation marks and the source link place it with the human author",
      blindToScore: true,
    },
  });
}

/** Replaces a record's whole `review` block. */
export function withReview(
  record: Record<string, unknown>,
  review: unknown,
): Record<string, unknown> {
  return { ...record, review };
}

const V3_HUMAN: Record<string, unknown> = {
  schemaVersion: 3,
  id: "h_ptso_0001",
  text: HUMAN_TEXT,
  normalizedTextSha256: "a".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "generic",
  domain: "qa-informal",
  topic: "programacao",
  humanSourceType: "qa-informal",
  wordCount: 100,
  createdAt: 1_386_720_000_000,
  labelBasis: "date-cutoff",
  labelEvidenceRef: {
    basis: "date-cutoff",
    entryId: "ev_ptso_0001",
    entryDigest: "1".repeat(64),
    dateField: "Posts.xml@CreationDate",
    observedValue: "2013-12-11T00:00:00.000Z",
    cutoff: "2022-11-30T00:00:00.000Z",
    snapshot: "pt-stackoverflow",
  },
  provenance: {
    sourceKind: "licensed-corpus",
    sourceId: "src_ptso",
    sourceRevision: "rev_001",
    collectedAt: 1_784_900_000_000,
    licenseId: "cc-by-sa-4.0",
    legalBasis: "license",
  },
  review: automatedUnreviewed(),
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: known("au_hmac_5c1f0a9d"),
    source: known("th_ptso_140233"),
    domainSource: known("ds_ptso_qa"),
    humanSeed: notApplicable("a human record is not seeded by another text"),
    promptTemplate: notApplicable(HUMAN_NO_GENERATOR),
    generatorFamily: notApplicable(HUMAN_NO_GENERATOR),
    generatorVersion: notApplicable(HUMAN_NO_GENERATOR),
    generationLane: notApplicable(HUMAN_NO_GENERATOR),
    harnessVersion: notApplicable(HUMAN_NO_GENERATOR),
    collectionBatch: known("cb_ptso_20260727"),
    nearDuplicate: known("nd_ptso_0001"),
    derivationRoot: notApplicable(HUMAN_NOT_DERIVED),
  },
};

const V3_AI: Record<string, unknown> = {
  schemaVersion: 3,
  id: "a_agy_0001",
  text: AI_TEXT,
  normalizedTextSha256: "b".repeat(64),
  label: "ai",
  language: "pt-BR",
  platform: "generic",
  domain: "qa-informal",
  topic: "programacao",
  wordCount: 100,
  createdAt: 1_784_926_573_575,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "src_ai_agy",
    sourceRevision: "rev_001",
    collectedAt: 1_784_926_573_575,
    licenseId: "autoria-propria-v1",
    legalBasis: "generated",
  },
  review: automatedUnreviewed(),
  generation: {
    provider: "agy",
    family: "gemini-3.5-flash-medium",
    model: "gemini-3.5-flash-medium",
    version: "gemini-3.5-flash-medium",
    promptId: "original_h_ptso_0001",
    promptSha256: "2".repeat(64),
    promptTemplateDigest: "3".repeat(64),
    generatedAt: 1_784_926_573_575,
    // The agy lane is an agent CLI: it takes `-p prompt --mode plan --model M`
    // and no sampling flag at all, so there is no decoding configuration to
    // record and the `configurable: true` fields do not exist on this branch.
    decoding: { configurable: false },
    // On agy the effort IS the model id (`…-flash-medium`); it is not a flag and
    // cannot be set independently.
    effort: {
      source: "model-id",
      configurable: false,
      scale: "agy-model-id-tier",
      level: "medium",
    },
    seedNullReason: "provider API does not expose a sampling seed",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: notApplicable(AI_NO_HUMAN_AUTHOR),
    source: notApplicable("generated text has no source document"),
    domainSource: known("ds_ai_agy"),
    humanSeed: known("h_ptso_0001"),
    promptTemplate: known("pt_original_v1"),
    generatorFamily: known("gemini-3_5-flash-medium"),
    generatorVersion: known("gv_gemini_3_5_flash_medium"),
    generationLane: known("agy"),
    harnessVersion: known("agy_0_18_3"),
    collectionBatch: known("cb_agy_20260724"),
    nearDuplicate: known("nd_agy_0001"),
    derivationRoot: notApplicable(
      "the original recipe generates fresh text rather than deriving it",
    ),
  },
};

const V3_MIXED: Record<string, unknown> = {
  schemaVersion: 3,
  id: "m_ptso_0001",
  text: MIXED_TEXT,
  normalizedTextSha256: "c".repeat(64),
  label: "mixed",
  language: "pt-BR",
  platform: "generic",
  domain: "qa-informal",
  topic: "programacao",
  wordCount: 100,
  createdAt: 1_784_926_600_000,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "src_mixed",
    sourceRevision: "rev_001",
    collectedAt: 1_784_926_600_000,
    licenseId: "autoria-propria-v1",
    legalBasis: "generated",
  },
  review: automatedUnreviewed(),
  generation: {
    provider: "agy",
    family: "gemini-3.5-flash-medium",
    model: "gemini-3.5-flash-medium",
    version: "gemini-3.5-flash-medium",
    promptId: "parafrase_h_ptso_0001",
    promptSha256: "4".repeat(64),
    promptTemplateDigest: "5".repeat(64),
    generatedAt: 1_784_926_600_000,
    decoding: { configurable: false },
    effort: {
      source: "model-id",
      configurable: false,
      scale: "agy-model-id-tier",
      level: "medium",
    },
    seedNullReason: "provider API does not expose a sampling seed",
  },
  mixture: {
    aiFraction: 0.5,
    humanFraction: 0.5,
    spans: [{ start: 0, end: 10, origin: "ai" }],
    generationMode: "mechanistic",
  },
  transformation: { kind: "human-ai-mix", severity: "medium" },
  groups: {
    // A mixed record IS a human text with AI stretches, so the human author and
    // the origin document are real axes here — unlike a fully generated record.
    author: known("au_hmac_5c1f0a9d"),
    source: known("th_ptso_140233"),
    domainSource: known("ds_mixed_ptso"),
    humanSeed: known("h_ptso_0001"),
    promptTemplate: known("pt_parafrase_v1"),
    generatorFamily: known("gemini-3_5-flash-medium"),
    generatorVersion: known("gv_gemini_3_5_flash_medium"),
    generationLane: known("agy"),
    harnessVersion: known("agy_0_18_3"),
    collectionBatch: known("cb_mixed_20260724"),
    nearDuplicate: known("nd_mixed_0001"),
    derivationRoot: known("h_ptso_0001"),
  },
};

// An `ecological` mixed row: observed human coauthorship, the cohort the frozen
// table keeps apart from `mechanistic` (`materialAssistance.generationModes`,
// `cohortsAggregated: false`). Nothing carries it yet, and that is exactly why it
// has to be REPRESENTABLE: the only writable form must not be one that names a
// recipe we never ran. So there is no `generation` block, and the four generation
// axes say `notApplicable` with the reason written down — the assistance came out
// of the coauthor's own tool, whose prompt, template digest and seed we do not
// have and must not invent (R4).
const ECOLOGICAL_NOT_OURS =
  "observed coauthorship: the assistance came from the coauthor's own tool, so no recipe of ours applies";

const V3_MIXED_ECOLOGICAL: Record<string, unknown> = {
  ...structuredClone(V3_MIXED),
  id: "m_eco_0001",
  normalizedTextSha256: "e".repeat(64),
  generation: undefined,
  mixture: {
    aiFraction: 0.5,
    humanFraction: 0.5,
    spans: [{ start: 0, end: 10, origin: "ai" }],
    generationMode: "ecological",
  },
  groups: {
    ...structuredClone(V3_MIXED.groups as Record<string, unknown>),
    // The human author and the origin document are as real here as on a
    // mechanistic row — more so, since nothing about this text was staged.
    humanSeed: notApplicable(
      "the coauthored document has no separate human precursor row in this corpus",
    ),
    promptTemplate: notApplicable(ECOLOGICAL_NOT_OURS),
    generatorFamily: notApplicable(ECOLOGICAL_NOT_OURS),
    generatorVersion: notApplicable(ECOLOGICAL_NOT_OURS),
    generationLane: notApplicable(ECOLOGICAL_NOT_OURS),
    harnessVersion: notApplicable(ECOLOGICAL_NOT_OURS),
    derivationRoot: notApplicable(
      "no derivation of ours produced this text: the coauthorship was observed, not executed",
    ),
  },
};
delete V3_MIXED_ECOLOGICAL.generation;

/** A v3 human record whose label rests on a `date-cutoff` evidence entry. */
export function v3Human(): Record<string, unknown> {
  return clone(V3_HUMAN);
}

/** A v3 fully generated record on the `agy` agent-CLI lane. */
export function v3Ai(): Record<string, unknown> {
  return clone(V3_AI);
}

/** A v3 mechanistic mixed record derived from {@link v3Human}. */
export function v3Mixed(): Record<string, unknown> {
  return clone(V3_MIXED);
}

/** The one reason string for the api lane's absent harness. Shared so it cannot drift. */
export const API_LANE_NO_HARNESS = "the gemini-api lane runs no harness binary";

/**
 * A v3 fully generated record on the `gemini-api` lane at a given applied
 * temperature — `null` meaning the provider's own default applied, which is a
 * different statement from "this lane has no such knob" and is why the field is
 * required-and-nullable on the `configurable: true` branch.
 *
 * `gemini-api` is the ONLY lane whose frozen policy row sets
 * `decodingConfigurable: true`, so it is the only shape in which a v3 record can
 * carry a temperature at all. Every sampling parameter on that branch is
 * required, so all four are written.
 *
 * It lives here rather than in a test file because two files need it — schema-v3
 * (the accessor's own contract) and corpus-source-audit (the governance recipe
 * comparison that gives the value its meaning) — and they hand-built it twice,
 * down to a byte-identical `notApplicable` reason string. A drift between two
 * copies of a lane fixture would have been invisible in both.
 */
export function v3ApiAi(temperature: number | null): Record<string, unknown> {
  const raw = withGeneration(clone(V3_AI), {
    // The api lane is Gemini's own endpoint, not the agy binary; the base fixture
    // is an agy row, so the provider moves with the lane.
    provider: "gemini",
    decoding: {
      configurable: true,
      strategy: "sampling",
      temperature,
      topP: null,
      repetitionPenalty: null,
    },
    effort: { source: "not-supported", configurable: false },
  });
  let record = withAxis(raw, "generationLane", known("gemini-api"));
  record = withAxis(
    record,
    "harnessVersion",
    notApplicable(API_LANE_NO_HARNESS),
  );
  return record;
}

/**
 * A v3 `ecological` mixed record: observed coauthorship, no recipe of ours, the
 * four generation axes `notApplicable`. It is eligible — `notApplicable` is a
 * legitimate state and does not cost eligibility.
 */
export function v3MixedEcological(): Record<string, unknown> {
  return clone(V3_MIXED_ECOLOGICAL);
}

/** The digest index a caller builds from the private manifest, never embedded. */
export function v3EvidenceIndex(): Map<string, string> {
  return new Map([["ev_ptso_0001", "1".repeat(64)]]);
}

/** Replaces one axis of a record's `groups` block, returning a fresh record. */
export function withAxis(
  record: Record<string, unknown>,
  axis: string,
  value: unknown,
): Record<string, unknown> {
  const groups = { ...(record.groups as Record<string, unknown>) };
  if (value === undefined) {
    delete groups[axis];
  } else {
    groups[axis] = value;
  }
  return { ...record, groups };
}

/** Replaces one field of a record's `generation` block. */
export function withGeneration(
  record: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...record,
    generation: {
      ...(record.generation as Record<string, unknown>),
      ...patch,
    },
  };
}
