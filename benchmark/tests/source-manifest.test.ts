import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  REBUILD_V3_POLICY,
  REBUILD_V3_POLICY_PATH,
} from "../rebuild-v3-policy.ts";
import {
  CORPUS_LICENSE_REGISTRY,
  CORPUS_USE_POLICY,
  FROZEN_ARTIFACT_OBLIGATIONS,
  LICENSE_OBLIGATION_LABEL_PT,
  artifactLicenseObligations,
  assertLicenseInventoryAdmissible,
  computeReviewedSourceManifestDigest,
  corpusLicenseTerms,
  parseReviewedSourceManifest,
  sourceAdmissibility,
  type CorpusLicenseTermsV1,
  type GenerationBatchV1,
  type LicenseObligation,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const MODEL_DIR = resolve(REPO_ROOT, "models/cleanfeed-ptbr-v1");

const consentSource: ReviewedSourceEntryV1 = {
  sourceId: "src_consent",
  sourceType: "linkedin-contribution",
  acquisition: "consent",
  evaluationUseApproved: true,
  licenseId: null,
  consentReceiptDigest: "a".repeat(64),
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_b"],
};

const licensedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_licensed",
  sourceType: "licensed-corpus",
  acquisition: "licensed",
  evaluationUseApproved: true,
  licenseId: "lic_ptbr_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_c"],
};

const generatedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_generated",
  sourceType: "controlled-generation",
  acquisition: "generated",
  evaluationUseApproved: true,
  licenseId: "lic_generated_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_d"],
};

const batch: GenerationBatchV1 = {
  batchId: "batch_gen",
  sourceId: "src_generated",
  generationProtocolVersion: "generation-v1",
  provider: "acme",
  family: "acme_large",
  model: "acme_large_2",
  version: "2026-05",
  promptTemplateDigest: "1".repeat(64),
  temperature: 0.7,
  generatedAt: 1_735_776_000_000,
  seed: "seed_1",
  seedNullReason: null,
};

type ManifestBody = Omit<ReviewedSourceManifestV1, "sourceManifestDigest">;

const validBody: ManifestBody = {
  schemaVersion: 1,
  sources: [consentSource, licensedSource, generatedSource],
  generationBatches: [batch],
};

async function sealManifest(
  body: ManifestBody = validBody,
): Promise<ReviewedSourceManifestV1> {
  return {
    ...body,
    sourceManifestDigest: await computeReviewedSourceManifestDigest(body),
  };
}

// Deliberately malformed structures cross the `unknown` boundary via a double
// cast; the closed parser must reject each one.
function malformed(value: unknown): unknown {
  return value;
}

describe("reviewed source manifest (closed schema)", () => {
  it("accepts and round-trips a fully specified manifest", async () => {
    const manifest = await sealManifest();
    await expect(parseReviewedSourceManifest(manifest)).resolves.toEqual(
      manifest,
    );
  });

  it("rejects an unknown top-level key", async () => {
    const manifest = await sealManifest();
    await expect(
      parseReviewedSourceManifest(
        malformed({ ...manifest, sourceUrl: "https://example.com" }),
      ),
    ).rejects.toThrow(/unknown key.*sourceUrl/i);
  });

  it("rejects an entry that carries a source URL, name or handle", async () => {
    const leaky = malformed({
      ...consentSource,
      sourceUrl: "https://linkedin.com/in/someone",
      authorName: "Jane Doe",
      handle: "@jane",
    });
    const manifest = await sealManifest({
      ...validBody,
      sources: [leaky as ReviewedSourceEntryV1, licensedSource],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /unknown key/i,
    );
  });

  it("rejects a consent entry that hides a raw receipt field", async () => {
    const leaky = malformed({
      ...consentSource,
      consentReceipt: "signed-by-jane-2026",
    });
    const manifest = await sealManifest({
      ...validBody,
      sources: [leaky as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /unknown key.*consentReceipt/i,
    );
  });

  it("requires a licenseId for a licensed source", async () => {
    const bad = malformed({ ...licensedSource, licenseId: null });
    const manifest = await sealManifest({
      ...validBody,
      sources: [bad as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /licenseId/i,
    );
  });

  it("requires a consentReceiptDigest for a consent source", async () => {
    const bad = malformed({ ...consentSource, consentReceiptDigest: null });
    const manifest = await sealManifest({
      ...validBody,
      sources: [bad as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /consentReceiptDigest/i,
    );
  });

  it("rejects a consent source that also declares a licenseId", async () => {
    const bad = malformed({ ...consentSource, licenseId: "lic_x" });
    const manifest = await sealManifest({
      ...validBody,
      sources: [bad as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /licenseId/i,
    );
  });

  it("rejects non-distinct legal reviewers", async () => {
    const bad = malformed({
      ...consentSource,
      legalReviewerIds: ["legal_a", "legal_a"],
    });
    const manifest = await sealManifest({
      ...validBody,
      sources: [bad as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /distinct/i,
    );
  });

  it("rejects a generation batch with an incomplete recipe", async () => {
    const incomplete = malformed({ ...batch });
    delete (incomplete as Record<string, unknown>).model;
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [incomplete as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /model/i,
    );
  });

  it("accepts a seedless batch with a non-empty null reason", async () => {
    const seedless: GenerationBatchV1 = {
      ...batch,
      seed: null,
      seedNullReason: "provider does not expose a seed",
    };
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [seedless],
    });
    await expect(parseReviewedSourceManifest(manifest)).resolves.toMatchObject({
      generationBatches: [{ seed: null }],
    });
  });

  it("rejects a batch with both a seed and a null reason", async () => {
    const both = malformed({ ...batch, seedNullReason: "unnecessary" });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [both as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /seed/i,
    );
  });

  it("rejects a batch with neither a seed nor a null reason", async () => {
    const neither = malformed({ ...batch, seed: null, seedNullReason: null });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [neither as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /seed/i,
    );
  });

  it("rejects a manifest whose self-digest no longer matches", async () => {
    const manifest = await sealManifest();
    await expect(
      parseReviewedSourceManifest({
        ...manifest,
        sourceManifestDigest: "0".repeat(64),
      }),
    ).rejects.toThrow(/digest/i);
  });

  it("computes a self-digest that excludes the digest field itself", async () => {
    const manifest = await sealManifest();
    const bodyOnly = await computeReviewedSourceManifestDigest(validBody);
    // The manifest carries the very digest computed over its body.
    expect(manifest.sourceManifestDigest).toBe(bodyOnly);
    // Recomputing over the sealed manifest minus its digest field is identical.
    const strip: ManifestBody = {
      schemaVersion: manifest.schemaVersion,
      sources: manifest.sources,
      generationBatches: manifest.generationBatches,
    };
    expect(await computeReviewedSourceManifestDigest(strip)).toBe(bodyOnly);
  });
});

// B1 — the frozen non-commercial policy. `commercialUse: false` is an invariant
// the code refuses to contradict, not an annotation it records; `NC` is
// admissible under it and `ND` stays blocked for a derived corpus.
describe("non-commercial corpus use policy", () => {
  it("freezes commercial use out of the inventory", () => {
    expect(CORPUS_USE_POLICY.commercialUse).toBe(false);
    expect(CORPUS_USE_POLICY.redistribution).toBe("not-published");
  });

  // The frozen table row "uso e licença" is materialized in
  // benchmark/rebuild-v3-policy.json, which the plan designates as the ONLY
  // place a frozen value is written down ("código não pode repeti-los como
  // constantes soltas"). These two tests pin the chain from that file to what
  // this module publishes, so `commercialUse: false` exists once and not twice.
  it("reads the frozen non-commercial decision from the policy file, not a copy of it", async () => {
    const frozenFile = JSON.parse(
      await readFile(REBUILD_V3_POLICY_PATH, "utf8"),
    ) as { commercialUse: unknown };
    // file bytes -> validated policy -> the use policy this module publishes.
    expect(REBUILD_V3_POLICY.commercialUse).toBe(frozenFile.commercialUse);
    expect(CORPUS_USE_POLICY.commercialUse).toBe(
      REBUILD_V3_POLICY.commercialUse,
    );
    // And the verdict on the NC source follows that flag rather than a local
    // decision: Carolina is admissible BECAUSE the frozen use is not commercial.
    expect(sourceAdmissibility("cc-by-nc-sa-4.0").admissible).toBe(
      !REBUILD_V3_POLICY.commercialUse,
    );
  });

  // The test above cannot fail on a re-inlined literal: once both spellings say
  // `false` no runtime assertion can tell a derived value from a copy that
  // happens to agree. What the plan forbids is the SECOND spelling, so that is
  // what this pins — structurally, on the module's own text.
  it("derives the frozen flag in its source instead of restating it", async () => {
    const source = await readFile(
      resolve(HERE, "../source-manifest.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /commercialUse:\s*REBUILD_V3_POLICY\.commercialUse/u,
    );
  });

  it("imposes every obligation the frozen contract requires", () => {
    // Rebuilt here from the frozen flags, independently of the module's own
    // derivation, so the two cannot agree by being the same literal.
    const requiredByContract: LicenseObligation[] = [];
    if (REBUILD_V3_POLICY.attributionRequired)
      requiredByContract.push("attribution");
    if (!REBUILD_V3_POLICY.commercialUse)
      requiredByContract.push("non-commercial");
    if (REBUILD_V3_POLICY.shareAlikeRequired)
      requiredByContract.push("share-alike");
    expect(FROZEN_ARTIFACT_OBLIGATIONS).toEqual(requiredByContract);

    // The registry must actually IMPOSE them: dropping `shareAlike` from
    // `cc-by-nc-sa-4.0` would otherwise leave a frozen obligation unenforced
    // while every other test stayed green.
    const imposed = artifactLicenseObligations(
      CORPUS_LICENSE_REGISTRY.filter(
        (terms) => terms.derivedCorpus === "admissible",
      ).map((terms) => terms.licenseId),
    );
    for (const obligation of FROZEN_ARTIFACT_OBLIGATIONS) {
      expect(imposed, `the registry imposes ${obligation}`).toContain(
        obligation,
      );
    }
  });

  it("refuses a declared commercial use over the Carolina NC licence", () => {
    // The fixture named by the plan: `commercialUse: true` + Carolina.
    const inventory = [
      { sourceId: "src_carolina", licenseId: "cc-by-nc-sa-4.0" },
    ];
    expect(() =>
      assertLicenseInventoryAdmissible(inventory, { commercialUse: true }),
    ).toThrow(/src_carolina.*cc-by-nc-sa-4\.0.*commercial-use/u);
    // The very same inventory is admissible under the frozen policy, so what
    // the guard refuses is the declared use, not the source.
    expect(assertLicenseInventoryAdmissible(inventory)).toEqual([
      "attribution",
      "non-commercial",
      "share-alike",
    ]);
  });

  it("admits Carolina with attribution and share-alike obligations", () => {
    const verdict = sourceAdmissibility("cc-by-nc-sa-4.0");
    expect(verdict.admissible).toBe(true);
    expect(verdict.obligations).toEqual([
      "attribution",
      "non-commercial",
      "share-alike",
    ]);
  });

  it("blocks a no-derivatives licence by ND and never by NC", () => {
    const nd = corpusLicenseTerms("cc-by-nc-nd-4.0");
    const nc = corpusLicenseTerms("cc-by-nc-sa-4.0");
    // NC and ND are two restrictions, not one "restrictive licence" concept:
    // both licences are nonCommercial, only one is noDerivatives, and only the
    // noDerivatives one is blocked.
    expect(nc?.nonCommercial).toBe(true);
    expect(nc?.noDerivatives).toBe(false);
    expect(nc?.derivedCorpus).toBe("admissible");
    expect(nd?.nonCommercial).toBe(true);
    expect(nd?.noDerivatives).toBe(true);
    expect(nd?.derivedCorpus).toBe("blocked");
    expect(nd?.blockedBy).toBe("no-derivatives");
    // Satisfying NC does not unblock it: the frozen policy is non-commercial
    // and the verdict is still `no-derivatives`.
    expect(
      sourceAdmissibility("cc-by-nc-nd-4.0", { commercialUse: false }),
    ).toMatchObject({ admissible: false, blockedBy: "no-derivatives" });
    expect(() =>
      assertLicenseInventoryAdmissible([
        { sourceId: "src_iberautextification", licenseId: "cc-by-nc-nd-4.0" },
      ]),
    ).toThrow(/no-derivatives/u);
  });

  it("refuses a licence the registry does not carry", () => {
    expect(sourceAdmissibility("cc-by-4.0")).toMatchObject({
      admissible: false,
      blockedBy: "license-not-registered",
      terms: null,
    });
    expect(() =>
      assertLicenseInventoryAdmissible([
        { sourceId: "src_x", licenseId: "aberta" },
      ]),
    ).toThrow(/license-not-registered/u);
  });

  it("ignores a consent source, whose basis is a receipt and not a licence", () => {
    expect(
      assertLicenseInventoryAdmissible([
        { sourceId: "src_consent", licenseId: null },
      ]),
    ).toEqual([]);
  });

  it("unions the obligations the artifact must carry", () => {
    expect(
      artifactLicenseObligations(["cc-by-sa-4.0", "lei9610-art8"]),
    ).toEqual(["attribution", "share-alike"]);
    expect(artifactLicenseObligations(["lei9610-art8"])).toEqual([]);
    expect(
      artifactLicenseObligations(
        CORPUS_LICENSE_REGISTRY.filter(
          (terms) => terms.derivedCorpus === "admissible",
        ).map((terms) => terms.licenseId),
      ),
    ).toEqual(["attribution", "non-commercial", "share-alike"]);
  });

  it("rejects a manifest whose licensed source carries a blocked licence", async () => {
    const blocked = malformed({
      ...licensedSource,
      licenseId: "cc-by-nc-nd-4.0",
    });
    const manifest = await sealManifest({
      ...validBody,
      sources: [blocked as ReviewedSourceEntryV1],
      generationBatches: [],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /no-derivatives/u,
    );
  });

  it("still parses an unregistered licence id, and says so on purpose", async () => {
    // The closed v1 schema does NOT require every licenceId to be registered
    // (its fixtures and the private manifest predate the registry); what it
    // refuses is a REGISTERED licence whose terms contradict the frozen policy.
    // Making registration mandatory is the schema-v3 decision, not B1's.
    const manifest = await sealManifest();
    const parsed = await parseReviewedSourceManifest(manifest);
    expect(parsed.sources.map((source) => source.licenseId)).toEqual([
      null,
      "lic_ptbr_1",
      "lic_generated_1",
    ]);
    expect(corpusLicenseTerms("lic_ptbr_1")).toBeNull();
  });
});

// Requirement 4: the manifest module, the model licence review and the NOTICE
// must agree, and must not be able to diverge without something failing.
describe("licence policy agreement across manifest, review and NOTICE", () => {
  async function licenseReview(): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(resolve(MODEL_DIR, "license-review.json"), "utf8"),
    ) as Record<string, unknown>;
  }

  it("the model licence review declares the same frozen use policy", async () => {
    const review = await licenseReview();
    expect(review.commercialUse).toBe(CORPUS_USE_POLICY.commercialUse);
    expect(review.usePolicyId).toBe(CORPUS_USE_POLICY.policyId);
  });

  it("the model licence review carries the registry's terms verbatim", async () => {
    const review = await licenseReview();
    expect(review.sourceLicenses).toEqual(CORPUS_LICENSE_REGISTRY);
    expect(review.artifactObligations).toEqual(
      artifactLicenseObligations(
        (review.sourceLicenses as CorpusLicenseTermsV1[])
          .filter((terms) => terms.derivedCorpus === "admissible")
          .map((terms) => terms.licenseId),
      ),
    );
  });

  it("the review scopes its licence list as the corpus inventory, not this model's training set", async () => {
    const review = await licenseReview();
    // `sourceLicenses` is the whole reviewed inventory, and it deliberately
    // carries an entry that was NEVER incorporated (`derivedCorpus: "blocked"`),
    // so the scope has to be stated in the file: unlabelled, the list reads as
    // this model's provenance, right next to the sentence that states the real
    // training sources.
    expect(review.sourceLicensesScope).toBe("corpus-inventory");
    expect(review.sourceLicensesNote).toMatch(/inventário/u);
    expect(
      (review.sourceLicenses as CorpusLicenseTermsV1[]).some(
        (terms) => terms.derivedCorpus === "blocked",
      ),
    ).toBe(true);
  });

  it("the NOTICE states the non-commercial regime and its obligations", async () => {
    const notice = await readFile(resolve(MODEL_DIR, "NOTICE.md"), "utf8");
    expect(notice).toMatch(/`commercialUse: false`/u);
    for (const obligation of artifactLicenseObligations(
      CORPUS_LICENSE_REGISTRY.filter(
        (terms) => terms.derivedCorpus === "admissible",
      ).map((terms) => terms.licenseId),
    )) {
      expect(notice).toContain(LICENSE_OBLIGATION_LABEL_PT[obligation]);
    }
  });

  it("the NOTICE lists every registered licence with exactly its obligations", async () => {
    const notice = await readFile(resolve(MODEL_DIR, "NOTICE.md"), "utf8");
    const labels = Object.values(LICENSE_OBLIGATION_LABEL_PT);
    for (const terms of CORPUS_LICENSE_REGISTRY) {
      const line = notice
        .split(/\r?\n/u)
        .find((candidate) => candidate.includes(`\`${terms.licenseId}\``));
      expect(line, `NOTICE.md names \`${terms.licenseId}\``).toBeDefined();
      const stated = labels.filter((label) => line?.includes(label));
      const expected: LicenseObligation[] = [];
      if (terms.attribution) expected.push("attribution");
      if (terms.nonCommercial) expected.push("non-commercial");
      if (terms.shareAlike) expected.push("share-alike");
      expect(new Set(stated)).toEqual(
        new Set(expected.map((o) => LICENSE_OBLIGATION_LABEL_PT[o])),
      );
      if (terms.derivedCorpus === "blocked") {
        expect(line).toMatch(/ND/u);
      }
    }
  });

  it("the source inventory doc records every exact licence identifier", async () => {
    const inventory = await readFile(
      resolve(REPO_ROOT, "docs/corpus-sources.md"),
      "utf8",
    );
    expect(inventory).toMatch(/`commercialUse: false`/u);
    for (const terms of CORPUS_LICENSE_REGISTRY) {
      expect(inventory, `docs names ${terms.licenseId}`).toContain(
        terms.licenseId,
      );
    }
    // The ND block is recorded as ND, never as NC or "restrictive licence".
    const ndLine = inventory
      .split(/\r?\n/u)
      .find((line) => line.includes("cc-by-nc-nd-4.0"));
    expect(ndLine).toMatch(/ND/u);
  });
});
