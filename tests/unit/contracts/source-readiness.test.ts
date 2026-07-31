import { describe, expect, it } from "vitest";

import {
  CORPUS_SOURCE_BLOCKING_CODES,
  computeSourceReadinessDigest,
  parseCorpusSourceReadinessReport,
  type CorpusSourceReadinessReport,
  type SourceReadinessDigestInput,
} from "../../../contracts/source-readiness";

const ready: SourceReadinessDigestInput = {
  schemaVersion: 1,
  status: "ready",
  sourceManifestDigest: "a".repeat(64),
  recordCount: 10_000,
  sourceCount: 80,
  acquisitionCounts: { consent: 2_000, licensed: 2_000, generated: 6_000 },
  protocols: {
    corpus: "corpus-v1",
    collection: "collection-v1",
    annotation: "annotation-v1",
    generation: "generation-v1",
    pii: "pii-review-v1",
  },
  blockingReasons: [],
};

async function sign(
  value: SourceReadinessDigestInput,
): Promise<CorpusSourceReadinessReport> {
  return { ...value, reportDigest: await computeSourceReadinessDigest(value) };
}

describe("source readiness contract", () => {
  it("accepts the exact ready report including generated acquisitions and corpus protocol", async () => {
    await expect(
      parseCorpusSourceReadinessReport(await sign(ready)),
    ).resolves.toEqual(await sign(ready));
  });

  it("rejects unknown root, protocol, acquisition and reason keys", async () => {
    await expect(
      parseCorpusSourceReadinessReport({ ...(await sign(ready)), extra: true }),
    ).rejects.toThrow(/unknown key.*extra/i);

    const withProtocolKey = structuredClone(
      await sign(ready),
    ) as unknown as Record<string, unknown>;
    (withProtocolKey.protocols as Record<string, unknown>).extra = true;
    await expect(
      parseCorpusSourceReadinessReport(withProtocolKey),
    ).rejects.toThrow(/unknown key.*extra/i);

    const withAcquisitionKey = structuredClone(
      await sign(ready),
    ) as unknown as Record<string, unknown>;
    (withAcquisitionKey.acquisitionCounts as Record<string, unknown>).extra = 1;
    await expect(
      parseCorpusSourceReadinessReport(withAcquisitionKey),
    ).rejects.toThrow(/unknown key.*extra/i);

    const blocked = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [
        { code: "SOURCE_REFERENCE_MISSING", recordId: "record-1" },
      ],
    });
    blocked.blockingReasons[0] = {
      ...blocked.blockingReasons[0],
      extra: true,
    } as never;
    await expect(parseCorpusSourceReadinessReport(blocked)).rejects.toThrow(
      /unknown key.*extra/i,
    );
  });

  it("rejects a stale digest after a blocking reason changes", async () => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [
        { code: "SOURCE_REFERENCE_MISSING", recordId: "record-1" },
      ],
    });
    report.blockingReasons[0] = {
      code: "SOURCE_REFERENCE_MISSING",
      recordId: "record-2",
    };
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(
      /reportDigest/i,
    );
  });

  it("rejects an isolated change to a digest-protected scalar", async () => {
    const changedCount = await sign(ready);
    changedCount.sourceCount = 81;
    await expect(
      parseCorpusSourceReadinessReport(changedCount),
    ).rejects.toThrow(/reportDigest/i);

    const changedDigest = await sign(ready);
    changedDigest.sourceManifestDigest = "b".repeat(64);
    await expect(
      parseCorpusSourceReadinessReport(changedDigest),
    ).rejects.toThrow(/reportDigest/i);
  });

  it.each(CORPUS_SOURCE_BLOCKING_CODES)(
    "accepts the closed code %s",
    async (code) => {
      const report = await sign({
        ...ready,
        status: "blocked",
        blockingReasons: [{ code }],
      });
      await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(
        report,
      );
    },
  );

  it("exposes exactly ten closed blocking codes", () => {
    expect([...CORPUS_SOURCE_BLOCKING_CODES]).toEqual([
      "SOURCE_MANIFEST_INVALID",
      "SOURCE_REFERENCE_MISSING",
      "EVALUATION_USE_NOT_APPROVED",
      "LINKEDIN_SOURCE_NOT_AUTHORIZED",
      "SOURCE_LEGAL_REVIEW_MISSING",
      "SOURCE_REVIEWERS_NOT_INDEPENDENT",
      "COLLECTION_PROTOCOL_MISMATCH",
      "GENERATION_RECIPE_MISSING",
      "GENERATION_RECIPE_MISMATCH",
      "SOURCE_BLOCKED_BY_ACCESS_TERMS",
    ]);
  });

  it("rejects an unknown blocking code", async () => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [{ code: "NOT_A_REAL_CODE" as never }],
    });
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(
      /code/i,
    );
  });

  it("requires canonical reason order and status/reason agreement", async () => {
    const unsorted = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [
        { code: "SOURCE_REFERENCE_MISSING", recordId: "z" },
        { code: "EVALUATION_USE_NOT_APPROVED", sourceId: "a" },
      ],
    });
    await expect(parseCorpusSourceReadinessReport(unsorted)).rejects.toThrow(
      /sorted/i,
    );
    await expect(
      parseCorpusSourceReadinessReport(
        await sign({
          ...ready,
          status: "ready",
          blockingReasons: [{ code: "SOURCE_MANIFEST_INVALID" }],
        }),
      ),
    ).rejects.toThrow(/status.*blockingReasons/i);
    await expect(
      parseCorpusSourceReadinessReport(
        await sign({ ...ready, status: "blocked", blockingReasons: [] }),
      ),
    ).rejects.toThrow(/status.*blockingReasons/i);
  });

  it("rejects duplicate identical blocking reasons", async () => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [
        { code: "SOURCE_REFERENCE_MISSING", recordId: "x" },
        { code: "SOURCE_REFERENCE_MISSING", recordId: "x" },
      ],
    });
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(
      /duplicate/i,
    );
  });

  it("rejects empty optional identifiers on a reason", async () => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [{ code: "SOURCE_REFERENCE_MISSING", recordId: "" }],
    });
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(
      /recordId/i,
    );
  });

  it("rejects a missing generated count and a non-literal corpus protocol", async () => {
    const missingGenerated = structuredClone(
      await sign(ready),
    ) as unknown as Record<string, unknown>;
    delete (missingGenerated.acquisitionCounts as Record<string, unknown>)
      .generated;
    await expect(
      parseCorpusSourceReadinessReport(missingGenerated),
    ).rejects.toThrow(/generated/i);

    const wrongCorpus = structuredClone(await sign(ready)) as unknown as Record<
      string,
      unknown
    >;
    (wrongCorpus.protocols as Record<string, unknown>).corpus = "corpus-v2";
    await expect(parseCorpusSourceReadinessReport(wrongCorpus)).rejects.toThrow(
      /corpus-v1/i,
    );
  });

  it("rejects non-integer or negative counts", async () => {
    const negativeSource = await sign({ ...ready, sourceCount: -1 });
    await expect(
      parseCorpusSourceReadinessReport(negativeSource),
    ).rejects.toThrow(/non-negative integer/i);

    const fractionalRecord = await sign({
      ...ready,
      recordCount: 10_000.5,
    });
    await expect(
      parseCorpusSourceReadinessReport(fractionalRecord),
    ).rejects.toThrow(/non-negative integer/i);
  });

  it("rejects acquisition counts that do not sum to recordCount", async () => {
    const report = await sign({
      ...ready,
      acquisitionCounts: { consent: 1, licensed: 1, generated: 1 },
    });
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(
      /sum to recordCount/i,
    );
  });

  it("rejects a non-lowercase sha256 sourceManifestDigest and reportDigest", async () => {
    const upperManifest = await sign({
      ...ready,
      sourceManifestDigest: "A".repeat(64),
    });
    await expect(
      parseCorpusSourceReadinessReport(upperManifest),
    ).rejects.toThrow(/sourceManifestDigest/i);

    const upperReport = await sign(ready);
    upperReport.reportDigest = upperReport.reportDigest.toUpperCase();
    await expect(parseCorpusSourceReadinessReport(upperReport)).rejects.toThrow(
      /reportDigest/i,
    );
  });

  it("rejects the wrong schemaVersion and a non-object root", async () => {
    const wrongVersion = await sign(ready);
    (wrongVersion as unknown as Record<string, unknown>).schemaVersion = 2;
    await expect(
      parseCorpusSourceReadinessReport(wrongVersion),
    ).rejects.toThrow(/schemaVersion/i);
    await expect(parseCorpusSourceReadinessReport(null)).rejects.toThrow(
      /object/i,
    );
  });
});
