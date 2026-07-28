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

  // Reading the frozen policy changed what this module depends on, and its
  // header is what C1/C5 read first to decide whether they may import it.
  //
  // Two rounds of this test were too weak, and both failures are worth writing
  // down because they are the same mistake in different clothes. Round one left
  // the header claiming it "depends only on" the canonical-json helper while an
  // import of the policy module sat 50 lines below. Round two banned that one
  // phrase and searched the header for each imported BASENAME — which a simple
  // rewording walked around ("its sole dependency is"), while the basename
  // search stayed green on the unrelated WHO-OWNS bullet that names
  // `benchmark/rebuild-v3-policy.ts` as the owner of a frozen value, not as a
  // dependency. A bare basename over 50 lines of prose is satisfiable by
  // accident: "digests" already appears in a sentence about digesting sources,
  // so even an honestly-updated expectation list could not catch an undeclared
  // import of `./digests.ts`.
  //
  // So the header now carries a DELIMITED dependency block, and what is pinned
  // is that the block enumerates EXACTLY this module's import specifiers — whole
  // specifiers, which no other prose in the file contains. Delete the block and
  // the test fails loudly rather than falling back on prose found elsewhere.
  it("declares in its header exactly the specifiers it imports at load", async () => {
    const BLOCK_BEGIN = "DEPENDENCIES (BEGIN)";
    const BLOCK_END = "DEPENDENCIES (END)";
    const source = await readFile(
      resolve(HERE, "../source-manifest.ts"),
      "utf8",
    );
    const lines = source.split(/\r?\n/u);
    // The header is the leading run of `//` lines. Derive the boundary once, and
    // if there were no code at all say so — `slice(0, -1)` would otherwise drop
    // the LAST header line and silently judge a truncated block.
    const firstCodeLine = lines.findIndex((line) => !line.startsWith("//"));
    expect(
      firstCodeLine,
      "expected code after the header comment block",
    ).toBeGreaterThan(0);
    const headerLines = lines.slice(0, firstCodeLine);
    const header = headerLines.join("\n");

    // Locate the block by its markers, so every assertion below is scoped to a
    // deliberate dependency declaration instead of to any prose that happens to
    // mention a module name.
    const begin = headerLines.findIndex((line) => line.includes(BLOCK_BEGIN));
    const end = headerLines.findIndex((line) => line.includes(BLOCK_END));
    expect(begin, `header must open "${BLOCK_BEGIN}"`).toBeGreaterThan(-1);
    expect(end, `header must close "${BLOCK_END}"`).toBeGreaterThan(begin);
    const declared = [
      ...headerLines
        .slice(begin + 1, end)
        .join("\n")
        .matchAll(/(\.{1,2}\/[\w./-]+\.ts)/gu),
    ].map((match) => match[1]);

    // The imports as written: the full specifier, not the basename.
    const imported = [
      ...source.matchAll(/^import[^"']*["'](\.[^"']+)["'];$/gmu),
    ].map((match) => match[1]);
    expect(imported).toEqual([
      "../contracts/canonical-json.ts",
      "./rebuild-v3-policy.ts",
    ]);
    // EXACTLY: an import missing from the block fails, and a block entry that is
    // no longer imported fails too. Updating the expectation above without
    // touching the header does not rescue it.
    //
    // What is compared is the SET of specifiers on each side, deduplicated. The
    // block is deliberately prose — an explanatory sentence per bullet — so a
    // second mention of an already-declared specifier is a realistic edit that
    // adds no dependency, and it must be idempotent rather than fail with a
    // message that reads like an undeclared import. `imported` is deduplicated
    // for the same reason on the other side: two `import` statements may legally
    // name one specifier. Neither side may be relaxed to containment, which is
    // what would let a stale block entry or an undeclared import through.
    expect(
      [...new Set(declared)].sort(),
      "the DEPENDENCIES block must name exactly the specifiers imported at load",
    ).toEqual([...new Set(imported)].sort());

    // An accurate block under a false summary sentence still misleads whoever
    // stops reading at the first paragraph, so the two shapes the defect took
    // are refused along with the general claim both are instances of. The bare
    // word "standalone" is banned rather than the false version of it: the block
    // is now the authority on what loads, so prose restating dependency status
    // is either wrong or redundant — that restatement is what went stale twice.
    expect(header).not.toMatch(/standalone/iu);
    expect(header).not.toMatch(/depends?\s+(?:only|solely)\b/iu);
    expect(header).not.toMatch(/\b(?:sole|only)\s+dependenc/iu);
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
    // The case where BOTH clauses could fire, which is the only one that pins
    // the guard ORDER in `sourceAdmissibility`. Every other assertion in this
    // file calls the function with `commercialUse: false` or lets it default to
    // the frozen policy, so `terms.nonCommercial && use.commercialUse` is false
    // throughout and the two reasons never compete: swapping the two guard
    // blocks used to leave this whole file green at 33/33, and the whole suite
    // too, since nothing outside this module calls the function.
    //
    // Only `ND` may be named here. `NC` is a reason a caller can satisfy, and
    // satisfying it cannot remove an `ND` block — so reporting `commercial-use`
    // would tell a commercial caller that dropping the commercial claim unblocks
    // IberAuTexTification, which is false. That is the confusion of `NC` with
    // `ND` this describe block exists to refuse.
    expect(
      sourceAdmissibility("cc-by-nc-nd-4.0", { commercialUse: true }),
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
