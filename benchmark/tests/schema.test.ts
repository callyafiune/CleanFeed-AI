import { describe, expect, it } from "vitest";

import { parseBenchmarkDataset, validateBenchmarkRecord } from "../schema.ts";

const HUMAN_TEXT = Array.from(
  { length: 100 },
  (_, index) => `palavra${index}`,
).join(" ");

const human = {
  schemaVersion: 2,
  id: "human-0001",
  text: HUMAN_TEXT,
  normalizedTextSha256: "a".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "linkedin",
  domain: "corporate",
  topic: "career",
  humanSourceType: "broetry",
  hardNegativeFamily: "formulaic",
  wordCount: 100,
  createdAt: 1_735_689_600_000,
  provenance: {
    sourceKind: "authorized-contribution",
    sourceId: "source_001",
    sourceRevision: "rev_001",
    collectedAt: 1_735_689_600_000,
    licenseId: "consent-v1",
    legalBasis: "consent",
    consentId: "consent_001",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_01",
      reviewedAt: 1_735_689_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["reviewer_01", "reviewer_02"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_001",
    source: "source_001",
    domainSource: "linkedin_contribution_batch_01",
    collectionBatch: "batch_001",
    nearDuplicate: "near_pending_001",
    derivationRoot: "human-0001",
  },
} as const;

describe("validateBenchmarkRecord", () => {
  it("accepts an authorized human record", () => {
    expect(validateBenchmarkRecord(human).label).toBe("human");
  });

  it("rejects unknown fields at every level", () => {
    expect(() =>
      validateBenchmarkRecord({
        ...human,
        provenance: {
          ...human.provenance,
          rawProfileUrl: "https://example.test",
        },
      }),
    ).toThrow(/unknown field provenance\.rawProfileUrl/);
  });

  it("requires a complete recipe for ai", () => {
    expect(() => validateBenchmarkRecord({ ...human, label: "ai" })).toThrow(
      /generation is required when label is ai/,
    );
  });

  it("requires valid mixed fractions and derivation", () => {
    expect(() =>
      validateBenchmarkRecord({
        ...human,
        label: "mixed",
        mixture: { aiFraction: 0.7, humanFraction: 0.4, spans: [] },
      }),
    ).toThrow(/mixed fractions must sum to 1/);
  });

  it("rejects duplicate ids and normalized content hashes", () => {
    const jsonl = `${JSON.stringify(human)}\n${JSON.stringify({ ...human, id: "human-0002" })}`;
    expect(() => parseBenchmarkDataset(jsonl)).toThrow(
      /duplicate normalizedTextSha256/,
    );
  });

  it("rejects a mixed span that ends beyond the record text", () => {
    expect(() =>
      validateBenchmarkRecord({
        ...human,
        label: "mixed",
        mixture: {
          aiFraction: 0.5,
          humanFraction: 0.5,
          spans: [{ start: 0, end: 100_000, origin: "ai" }],
        },
        groups: { ...human.groups, derivationRoot: "human-parent-0001" },
      }),
    ).toThrow(/mixture\.spans\[0\] out of text bounds/);
  });

  it("accepts a mixed record whose spans stay within the text", () => {
    const record = validateBenchmarkRecord({
      ...human,
      label: "mixed",
      mixture: {
        aiFraction: 0.5,
        humanFraction: 0.5,
        spans: [{ start: 0, end: 10, origin: "ai" }],
      },
      groups: { ...human.groups, derivationRoot: "human-parent-0001" },
    });
    expect(record.label).toBe("mixed");
    expect(record.mixture?.spans).toHaveLength(1);
    expect(record.mixture?.spans[0]?.end).toBe(10);
  });
});
