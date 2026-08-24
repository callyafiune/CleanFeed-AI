import { describe, expect, it } from "vitest";

import {
  ASSURANCE_PROFILES,
  type AssuranceProfileRegistry,
} from "../assurance-profile.ts";
import {
  DatasetManifestError,
  parseDatasetAudit,
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
  type CorpusPolicy,
  type DatasetFileDigests,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { asGeneratorFamily } from "../generator-family.ts";
import { validateBenchmarkRecordV4, type BenchmarkRecord } from "../schema.ts";
import {
  automatedUnreviewed,
  humanReviewed,
  llmPiiScreen,
  piiPatternScan,
  v4Ai,
  v4Human,
  withReview,
} from "./helpers/v3-record-fixture.ts";

const RECORDS_SHA = "d".repeat(64);
const REVIEW_LEDGER_SHA = "e".repeat(64);
const SOURCE_MANIFEST_SHA = "f".repeat(64);

const observed: DatasetFileDigests = {
  recordsSha256: RECORDS_SHA,
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
};

const HELD_OUT = asGeneratorFamily("gemini-3_5-flash-medium");

const licenses = [
  {
    id: "cc-by-sa-4.0",
    name: "Creative Commons Attribution-ShareAlike 4.0",
    source: "https://creativecommons.org/licenses/by-sa/4.0/",
    evaluationUseApproved: true as const,
    redistribution: "not-published" as const,
    notice: "Atribuição e share-alike obrigatórios.",
  },
  {
    id: "autoria-propria-v1",
    name: "Autoria própria do operador",
    source: "declaração do operador",
    evaluationUseApproved: true as const,
    redistribution: "not-published" as const,
    notice: "Gerado pelo próprio operador para avaliação interna.",
  },
];

const infrastructureManifest: DatasetManifest = {
  schemaVersion: 1,
  datasetId: "cleanfeed-ptbr-cells-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "scoped-cells",
  createdAt: "2026-08-24T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: RECORDS_SHA,
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
  heldOutGeneratorFamilies: [HELD_OUT],
  licenses,
};

const releaseUnderCensus: DatasetManifest = {
  ...infrastructureManifest,
  scientificUse: "release",
  assuranceProfile: "census-pii-screen-v1",
};

const releaseUnderHumanReview: DatasetManifest = {
  ...infrastructureManifest,
  scientificUse: "release",
  assuranceProfile: "full-human-review-v1",
};

/** The census profile as it will read AFTER an execution passes the gates. */
const activatedCensus: AssuranceProfileRegistry = {
  ...ASSURANCE_PROFILES,
  "census-pii-screen-v1": {
    ...ASSURANCE_PROFILES["census-pii-screen-v1"],
    activation: {
      state: "active",
      qualifyingRun: {
        receiptDigest: "b".repeat(64),
        ratifiedBy: "op_fixture",
        ratifiedAt: "2026-08-24T12:00:00.000Z",
      },
    },
  },
};

const POSITIVES = 200;

const policy: CorpusPolicy = {
  counts: { human: 1, ai: POSITIVES, mixed: 0 },
  requiredHumanSourceTypes: ["encyclopedic"],
  requiredHardNegativeFamilies: [],
};

/**
 * A corpus every row of which is `automated/unreviewed` and carries the census
 * screen. This is the shape the assembler can actually produce: no receipt, because
 * nobody reviewed a record, and a screen run, because the screen really ran.
 */
function screenedCorpus(unscreened: readonly number[] = []): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [
    validateBenchmarkRecordV4(
      withReview(v4Human(), {
        ...automatedUnreviewed(),
        automatedFilters: [piiPatternScan(), llmPiiScreen()],
      }),
    ),
  ];
  for (let n = 1; n <= POSITIVES; n += 1) {
    const raw = withReview(v4Ai(), {
      ...automatedUnreviewed(),
      automatedFilters: unscreened.includes(n)
        ? [piiPatternScan()]
        : [piiPatternScan(), llmPiiScreen()],
    });
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    const generation = raw.generation as Record<string, unknown>;
    const groups = raw.groups as Record<string, unknown>;
    raw.generation = { ...generation, family: HELD_OUT };
    raw.groups = {
      ...groups,
      generatorFamily: { state: "known", id: HELD_OUT },
    };
    records.push(validateBenchmarkRecordV4(raw));
  }
  return records;
}

/**
 * The same corpus with a coherent human receipt on every row.
 *
 * `automatedStage` is a parameter because a human receipt records the ONE automated
 * screen that produced the candidates it read, and which screen that was is exactly
 * what the census asks of a reviewed row.
 */
function reviewedCorpus(
  automatedStage: Record<string, unknown> = piiPatternScan(),
): BenchmarkRecord[] {
  const withStage = (decision: string): Record<string, unknown> => {
    const receipt = humanReviewed(decision);
    const pii = receipt.pii as Record<string, unknown>;
    return { ...receipt, pii: { ...pii, automatedStage } };
  };
  const records: BenchmarkRecord[] = [
    validateBenchmarkRecordV4(withReview(v4Human(), withStage("human"))),
  ];
  for (let n = 1; n <= POSITIVES; n += 1) {
    const raw = withReview(v4Ai(), withStage("ai"));
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    const generation = raw.generation as Record<string, unknown>;
    const groups = raw.groups as Record<string, unknown>;
    raw.generation = { ...generation, family: HELD_OUT };
    raw.groups = {
      ...groups,
      generatorFamily: { state: "known", id: HELD_OUT },
    };
    records.push(validateBenchmarkRecordV4(raw));
  }
  return records;
}

describe("the assurance profile a release corpus declares", () => {
  it("is obligatory: a release manifest with no profile is refused before anything is sealed", () => {
    const { assuranceProfile: _omitted, ...withoutProfile } =
      releaseUnderCensus;
    let error: unknown;
    try {
      validateDatasetManifest(withoutProfile);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DatasetManifestError);
    expect((error as DatasetManifestError).code).toBe(
      "DATASET_ASSURANCE_INVALID",
    );
    expect((error as DatasetManifestError).message).toMatch(
      /release corpus must declare an assuranceProfile/u,
    );
  });

  it("is refused when the name is outside the closed registry, version included", () => {
    for (const name of [
      "census-pii-screen-v2",
      "census-pii-screen",
      "full-human-review",
      "",
    ]) {
      let error: unknown;
      try {
        validateDatasetManifest({
          ...releaseUnderCensus,
          assuranceProfile: name,
        });
      } catch (caught) {
        error = caught;
      }
      expect(
        (error as DatasetManifestError | undefined)?.code,
        `assuranceProfile "${name}" must not parse`,
      ).toBe("DATASET_ASSURANCE_INVALID");
    }
  });

  it("is refused on an infrastructure-only corpus, which has no release claim to qualify", () => {
    let error: unknown;
    try {
      validateDatasetManifest({
        ...infrastructureManifest,
        assuranceProfile: "census-pii-screen-v1",
      });
    } catch (caught) {
      error = caught;
    }
    expect((error as DatasetManifestError | undefined)?.code).toBe(
      "DATASET_ASSURANCE_INVALID",
    );
  });

  it("parses on a release manifest and is carried through unchanged", () => {
    expect(validateDatasetManifest(releaseUnderCensus).assuranceProfile).toBe(
      "census-pii-screen-v1",
    );
    expect(
      validateDatasetManifest(infrastructureManifest).assuranceProfile,
    ).toBeUndefined();
  });
});

describe("what the seal enforces under each profile", () => {
  it("refuses a release under the census profile while the profile is only PRE-REGISTERED", async () => {
    const attempt = sealDataset(
      releaseUnderCensus,
      screenedCorpus(),
      policy,
      observed,
    );
    await expect(attempt).rejects.toThrow(DatasetManifestError);
    await expect(attempt).rejects.toThrow(
      /census-pii-screen-v1.*pre-registered/su,
    );
    // The refusal is actionable: it names what activation requires, and the first
    // requirement is the execution nobody has run.
    await expect(attempt).rejects.toThrow(/uma execução do llm-pii-screen/u);
  });

  it("names the inactive profile with its own code, not the review claim's", async () => {
    let error: unknown;
    try {
      await sealDataset(releaseUnderCensus, screenedCorpus(), policy, observed);
    } catch (caught) {
      error = caught;
    }
    expect((error as DatasetManifestError).code).toBe(
      "DATASET_ASSURANCE_INACTIVE",
    );
  });

  it("keeps the review-claim refusal under the human-review profile, byte for byte", async () => {
    const attempt = sealDataset(
      releaseUnderHumanReview,
      screenedCorpus(),
      policy,
      observed,
    );
    await expect(attempt).rejects.toThrow(
      /201 of 201 sustain no review claim \(201 automated-filter-only\)/u,
    );
    let error: unknown;
    try {
      await attempt;
    } catch (caught) {
      error = caught;
    }
    expect((error as DatasetManifestError).code).toBe("DATASET_REVIEW_INVALID");
  });

  it("seals a screened corpus once the census profile is ACTIVE, with no receipt on any row", async () => {
    const audit = await sealDataset(
      releaseUnderCensus,
      screenedCorpus(),
      policy,
      observed,
      activatedCensus,
    );
    expect(audit.releaseEligible).toBe(true);
    expect(audit.assuranceProfile).toBe("census-pii-screen-v1");
    expect(audit.recordCount).toBe(POSITIVES + 1);
  });

  it("still refuses the same corpus under the human profile after activation of the other one", async () => {
    await expect(
      sealDataset(
        releaseUnderHumanReview,
        screenedCorpus(),
        policy,
        observed,
        activatedCensus,
      ),
    ).rejects.toThrow(/sustain no review claim/u);
  });

  it("refuses a release under the ACTIVE census profile when one record was not screened", async () => {
    const attempt = sealDataset(
      releaseUnderCensus,
      screenedCorpus([137]),
      policy,
      observed,
      activatedCensus,
    );
    await expect(attempt).rejects.toThrow(/a_agy_0137/u);
    await expect(attempt).rejects.toThrow(/llm-pii-screen/u);
    let error: unknown;
    try {
      await attempt;
    } catch (caught) {
      error = caught;
    }
    expect((error as DatasetManifestError).code).toBe(
      "DATASET_ASSURANCE_UNSUPPORTED",
    );
  });

  it("counts the census shortfall over the whole corpus rather than stopping at the first row", async () => {
    await expect(
      sealDataset(
        releaseUnderCensus,
        screenedCorpus([1, 2, 3]),
        policy,
        observed,
        activatedCensus,
      ),
    ).rejects.toThrow(/3 of 201/u);
  });

  it("seals a reviewed corpus under the human profile, which is the semantics that already existed", async () => {
    const audit = await sealDataset(
      releaseUnderHumanReview,
      reviewedCorpus(),
      policy,
      observed,
    );
    expect(audit.releaseEligible).toBe(true);
    expect(audit.assuranceProfile).toBe("full-human-review-v1");
  });

  it("reads the census marker off a human receipt's automated STAGE, not only off the filter list", async () => {
    // A reviewed row has no `automatedFilters` at all: the screen it went through is the
    // receipt's own `pii.automatedStage`. Asking only the list would report a corpus with
    // MORE evidence as unscreened.
    const audit = await sealDataset(
      releaseUnderCensus,
      reviewedCorpus(llmPiiScreen()),
      policy,
      observed,
      activatedCensus,
    );
    expect(audit.assuranceProfile).toBe("census-pii-screen-v1");
    expect(audit.releaseEligible).toBe(true);
  });

  it("refuses a reviewed corpus whose automated stage names a DIFFERENT screen", async () => {
    // The other direction of the same read, so the branch cannot be satisfied by
    // answering `true` to every reviewed row.
    await expect(
      sealDataset(
        releaseUnderCensus,
        reviewedCorpus(piiPatternScan()),
        policy,
        observed,
        activatedCensus,
      ),
    ).rejects.toThrow(/201 of 201 records carry no "llm-pii-screen" run/u);
  });

  it("publishes a null profile on an infrastructure-only seal, so absence is never a name", async () => {
    const audit = await sealDataset(
      infrastructureManifest,
      screenedCorpus(),
      { ...RELEASE_CORPUS_POLICY, counts: policy.counts },
      observed,
    );
    expect(audit.assuranceProfile).toBeNull();
    expect(audit.releaseEligible).toBe(false);
  });
});

describe("the audit's own parser holds the profile to the same rule", () => {
  async function releaseAudit() {
    return sealDataset(
      releaseUnderCensus,
      screenedCorpus(),
      policy,
      observed,
      activatedCensus,
    );
  }

  async function codeOf(audit: unknown): Promise<string | undefined> {
    try {
      await parseDatasetAudit(audit);
      return undefined;
    } catch (caught) {
      return (caught as DatasetManifestError).code;
    }
  }

  it("round-trips an audit sealed under a profile", async () => {
    const audit = await releaseAudit();
    await expect(parseDatasetAudit(audit)).resolves.toEqual(audit);
  });

  it("refuses a profile name the registry does not hold", async () => {
    const audit = await releaseAudit();
    expect(
      await codeOf({ ...audit, assuranceProfile: "census-pii-screen-v9" }),
    ).toBe("DATASET_ASSURANCE_INVALID");
  });

  it("refuses a release audit whose profile was lost in transit", async () => {
    // Read BEFORE the digest is recomputed on purpose: a stripped profile changes the
    // bytes too, and reporting a digest mismatch would send a reader to the wrong cause.
    const audit = await releaseAudit();
    expect(await codeOf({ ...audit, assuranceProfile: null })).toBe(
      "DATASET_ASSURANCE_INVALID",
    );
  });

  it("refuses an infrastructure-only audit that names a profile", async () => {
    const audit = await sealDataset(
      infrastructureManifest,
      screenedCorpus(),
      { ...RELEASE_CORPUS_POLICY, counts: policy.counts },
      observed,
    );
    expect(audit.assuranceProfile).toBeNull();
    expect(
      await codeOf({ ...audit, assuranceProfile: "census-pii-screen-v1" }),
    ).toBe("DATASET_ASSURANCE_INVALID");
  });
});
