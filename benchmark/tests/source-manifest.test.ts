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
  PRE_CHATGPT_CUTOFF_ISO,
  V3_HUMAN_SOURCE_INVENTORY,
  artifactLicenseObligations,
  assertLicenseInventoryAdmissible,
  assertNoIndividualAcquisition,
  assertPublicBaseLicensesOnly,
  assertV3HumanInventoryAdmissible,
  computeReviewedSourceManifestDigest,
  corpusLicenseTerms,
  determinedHumanAcquisition,
  humanLabelOverclaimIn,
  licenseDescribesPublicBase,
  humanSourceAdmissibility,
  parseReviewedSourceManifest,
  sourceAdmissibility,
  type CorpusLicenseTermsV1,
  type GenerationBatchV1,
  type HumanLabelBasis,
  type HumanSourceRegistrationV1,
  type LicenseObligation,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";
import { V3_GROUP_AXES } from "../schema.ts";

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

// The admissible baseline. `consentSource` is deliberately NOT here: since B3
// the parser refuses a per-document-consent entry, so a body that carried one
// would be a body no manifest can be sealed from. It stays a fixture because the
// closed-schema tests below still have to show that each of ITS OWN field rules
// (unknown key, missing receipt digest, non-null licenceId, distinct reviewers)
// fires on its own reason — those all fail inside `validateEntry`, before the
// acquisition sweep, and the test that pins the sweep itself adds the entry back.
const validBody: ManifestBody = {
  schemaVersion: 1,
  sources: [licensedSource, generatedSource],
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
      "./schema.ts",
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

// ---------------------------------------------------------------------------
// B3 — public bases only. The project acquires no text individually: no donor
// recruitment, no per-document consent, no writing session of our own. What is
// pinned here is the vocabulary, because the vocabulary is the deliverable:
// the RESTRICTION is on acquisition, never on the evidence CATEGORY, so a public
// base that already carries instrumented sessions stays representable.
// ---------------------------------------------------------------------------

const publicSnapshot: HumanSourceRegistrationV1 = {
  sourceId: "src_ptso",
  snapshot: "pt-stackoverflow",
  acquisition: "public-dataset",
  licenseId: "cc-by-sa-4.0",
  labelBasis: "date-cutoff",
  anchorDateField: "Posts.xml@CreationDate",
  anchorDateScope: "document",
  declaredGroupAxes: ["author", "source"],
};

describe("B3 — only public licensed bases enter as human sources", () => {
  it("admits a public licensed snapshot whose cutoff reads a document date", () => {
    expect(humanSourceAdmissibility(publicSnapshot)).toMatchObject({
      admissible: true,
      blockedBy: null,
      labelBasis: "date-cutoff",
    });
  });

  // Requirement 1 / criterion "fonte sem licença pública compatível falha".
  // Each individually-acquired route is named on its own, because the refusal is
  // of the ACQUISITION and the three routes are three different things a reader
  // might think survives.
  it("refuses every route that acquires text from an individual", () => {
    for (const acquisition of [
      "per-document-consent",
      "recruited-donor",
      "operator-authored-session",
    ] as const) {
      expect(
        humanSourceAdmissibility({
          ...publicSnapshot,
          sourceId: `src_${acquisition}`,
          acquisition,
          licenseId: null,
        }),
        `route ${acquisition} is refused`,
      ).toMatchObject({
        admissible: false,
        blockedBy: "individual-acquisition",
      });
    }
  });

  // The ONE case that pins the guard ORDER: an individual source has no public
  // licence either, so both reasons could fire. `individual-acquisition` must
  // win, for the same reason `no-derivatives` wins over `commercial-use` above:
  // a caller can satisfy "find a public licence", and satisfying it cannot make
  // an individually-acquired source admissible. Naming `no-public-license` there
  // would tell a donor-recruiting caller that a licence unblocks recruitment.
  it("names the acquisition, not the missing licence, when both could fire", () => {
    const individual: HumanSourceRegistrationV1 = {
      ...publicSnapshot,
      sourceId: "src_donor",
      acquisition: "recruited-donor",
      licenseId: null,
      labelBasis: null,
      anchorDateField: null,
      anchorDateScope: null,
    };
    expect(humanSourceAdmissibility(individual).blockedBy).toBe(
      "individual-acquisition",
    );
    // Fixing only the licence does not rescue the route.
    expect(
      humanSourceAdmissibility({ ...individual, licenseId: "cc-by-sa-4.0" })
        .blockedBy,
    ).toBe("individual-acquisition");
    // And a public route with no licence is refused by the licence, which is
    // what makes the two reasons distinguishable rather than interchangeable.
    expect(
      humanSourceAdmissibility({
        ...individual,
        acquisition: "public-dataset",
        licenseId: null,
      }).blockedBy,
    ).toBe("no-public-license");
  });

  it("refuses a public base whose licence blocks a derived corpus", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        licenseId: "cc-by-nc-nd-4.0",
      }).blockedBy,
    ).toBe("no-derivatives");
    expect(
      humanSourceAdmissibility({ ...publicSnapshot, licenseId: "aberta" })
        .blockedBy,
    ).toBe("license-not-registered");
  });

  // Requirement 2. The record-line schema gets `labelBasis` in C1; what is in
  // scope here is the SOURCE declaring which basis it sustains, so a human
  // source with no declared basis cannot enter the inventory.
  it("refuses a human source that declares no label basis", () => {
    expect(
      humanSourceAdmissibility({ ...publicSnapshot, labelBasis: null }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "label-basis-undeclared",
    });
  });

  it("refuses a basis outside the frozen allowed list", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        labelBasis: "self-declared" as unknown as HumanLabelBasis,
      }).blockedBy,
    ).toBe("label-basis-not-allowed");
    // The allowed list is READ from the frozen policy, not restated here.
    expect([...REBUILD_V3_POLICY.labelBasis.allowed].sort()).toEqual([
      "date-cutoff",
      "observed-process",
    ]);
  });

  // Vocabulary pair 3 and criterion "bases instrumentadas públicas permanecem
  // representáveis": a PUBLIC base that already ran instrumented sessions is
  // admissible, with the stronger basis and NO date field, because its basis is
  // the observed process and not a date. If this test cannot be written, the
  // acquisition restriction has been mistaken for a ban on the category.
  it("keeps a public instrumented base representable, under the stronger basis", () => {
    const instrumented: HumanSourceRegistrationV1 = {
      sourceId: "src_public_instrumented",
      snapshot: "some-public-instrumented-base",
      acquisition: "public-dataset",
      licenseId: "cc-by-sa-4.0",
      labelBasis: "observed-process",
      anchorDateField: null,
      anchorDateScope: null,
      declaredGroupAxes: ["author", "source"],
    };
    expect(humanSourceAdmissibility(instrumented)).toMatchObject({
      admissible: true,
      blockedBy: null,
      labelBasis: "observed-process",
    });
  });

  // Requirement 3: the cutoff is applied over the field that anchors the BYTES
  // of the document, never presumed from the vintage of the dump.
  it("refuses a date-cutoff basis with no anchoring date field", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        anchorDateField: null,
        anchorDateScope: null,
      }).blockedBy,
    ).toBe("anchor-date-field-missing");
  });

  it("refuses a cutoff anchored on the container vintage instead of the document", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        anchorDateField: "dump filename vintage",
        anchorDateScope: "container",
      }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "anchor-date-is-container-vintage",
    });
  });
});

describe("B3 — the frozen v3 human inventory", () => {
  it("covers exactly the frozen snapshot list, with no new download", () => {
    expect(REBUILD_V3_POLICY.humanSources.newDownloadsAllowed).toBe(false);
    expect(
      V3_HUMAN_SOURCE_INVENTORY.map((entry) => entry.snapshot).sort(),
    ).toEqual([...REBUILD_V3_POLICY.humanSources.snapshots].sort());
  });

  it("declares the sourceId a reviewed manifest joins on", () => {
    // The inventory is keyed twice — by `snapshot` against the frozen policy
    // (asserted above) and by `sourceId` against the reviewed source manifest.
    // These are the ids the manifests an operator holds actually use; the fourth
    // was written `src_b2w_reviews` for one round, which would have made a
    // by-sourceId join to `benchmark/data/corpus-build/**` silently empty for
    // B2W while succeeding for the other three. Those manifests are gitignored
    // build artifacts, so this is a literal and not a read.
    expect(V3_HUMAN_SOURCE_INVENTORY.map((entry) => entry.sourceId)).toEqual([
      "src_ptso",
      "src_wikipedia_pt",
      "src_carolina",
      "src_b2w",
    ]);
  });

  it("registers every entry as a public base with a document-level cutoff field", () => {
    for (const entry of V3_HUMAN_SOURCE_INVENTORY) {
      expect(entry.acquisition, entry.sourceId).toBe("public-dataset");
      expect(entry.labelBasis, entry.sourceId).toBe("date-cutoff");
      expect(entry.anchorDateScope, entry.sourceId).toBe("document");
      expect(entry.anchorDateField, entry.sourceId).toBeTruthy();
      expect(humanSourceAdmissibility(entry).admissible, entry.sourceId).toBe(
        true,
      );
    }
  });

  it("returns the obligations the frozen inventory imposes on the artifact", () => {
    expect(assertV3HumanInventoryAdmissible(V3_HUMAN_SOURCE_INVENTORY)).toEqual(
      FROZEN_ARTIFACT_OBLIGATIONS,
    );
  });

  it("refuses a snapshot the frozen list does not name", () => {
    expect(() =>
      assertV3HumanInventoryAdmissible([
        { ...publicSnapshot, sourceId: "src_new", snapshot: "brwac" },
      ]),
    ).toThrow(/snapshot-not-frozen/u);
  });

  it("refuses an inadmissible registration with its own reason", () => {
    expect(() =>
      assertV3HumanInventoryAdmissible([
        { ...publicSnapshot, acquisition: "recruited-donor" },
      ]),
    ).toThrow(/src_ptso.*individual-acquisition/u);
  });
});

describe("B3 — the v1 consent route is a route B3 forbids", () => {
  // Requirement 1, the part that has to hold in PRODUCTION and not only in a
  // helper: "não há caminho no código que a admita". `parseReviewedSourceManifest`
  // is the only way a manifest on disk becomes a `ReviewedSourceManifestV1`, so
  // it is the admission path, and this is the test that says so.
  it("refuses a sealed manifest that carries a per-document-consent source", async () => {
    const manifest = await sealManifest({
      ...validBody,
      sources: [consentSource, licensedSource, generatedSource],
    });
    // The entry is otherwise perfectly well formed — the digest matches, the
    // receipt is a real sha256 shape, the two legal reviewers are distinct — so
    // the ONLY thing that can refuse it is the acquisition route.
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /src_consent.*individual-acquisition/u,
    );
  });

  it("keeps the licensed and generated routes loading", async () => {
    // The counter-case, so the refusal above cannot be satisfied by refusing
    // everything: the same manifest without the consent entry still parses.
    const manifest = await sealManifest();
    await expect(parseReviewedSourceManifest(manifest)).resolves.toEqual(
      manifest,
    );
  });

  // The bridge below is what the parser now calls. It stays exported and
  // separately tested because the record-line half of the consent route —
  // `provenance.legalBasis: "consent"` in benchmark/schema.ts and
  // `acquisitionCounts.consent` in contracts/source-readiness.ts — is still
  // C1's schema-v3 change; what B3 closes is the SOURCE admission path.
  it("maps the consent entry to the route B3 refuses", () => {
    expect(determinedHumanAcquisition(consentSource)).toBe(
      "per-document-consent",
    );
    expect(() => assertNoIndividualAcquisition([consentSource])).toThrow(
      /src_consent.*individual-acquisition/u,
    );
  });

  it("leaves an unregistered licence undetermined rather than guessing it is public", () => {
    // A `licensed-corpus` entry under an OPAQUE licence id does not say whether
    // its licence is a public one, so the bridge reports `null` instead of
    // admitting it as `public-dataset` by default. What it no longer does is
    // report `null` for a licence the registry has already classified — that is
    // the hole the "non-public authorization licence" block below closes.
    expect(determinedHumanAcquisition(licensedSource)).toBeNull();
    expect(determinedHumanAcquisition(generatedSource)).toBeNull();
    expect(() =>
      assertNoIndividualAcquisition([licensedSource, generatedSource]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B3, requirement 1, the OTHER half: "só admite base pública licenciada".
//
// Refusing `per-document-consent` closed the route that NAMES an individual
// donor. It left two registered licences through, and both are non-public bases:
// `autoria-propria-v1` IS the `operator-authored-session` route this module's own
// union forbids, and `autorizacao-interna-v1` is a corporate self-authorization
// with no publication at all. Both parse as ordinary `licensed-corpus` entries
// with every restrictive clause false, so the licence guard has nothing to say
// about them and the acquisition guard used to determine no route.
//
// These tests run against `parseReviewedSourceManifest` on purpose: the criterion
// is "não há caminho no código que a admita", and the parser is the only way a
// manifest on disk becomes a `ReviewedSourceManifestV1`.
// ---------------------------------------------------------------------------

describe("B3 — a non-public authorization licence is not a public base", () => {
  function licensedUnder(
    sourceId: string,
    licenseId: string,
  ): ReviewedSourceEntryV1 {
    return {
      sourceId,
      sourceType: "licensed-corpus",
      acquisition: "licensed",
      evaluationUseApproved: true,
      licenseId,
      consentReceiptDigest: null,
      collectionProtocolVersion: "collection-v1",
      legalReviewerIds: ["legal_a", "legal_b"],
    };
  }

  async function sealedUnder(
    sourceId: string,
    licenseId: string,
  ): Promise<ReviewedSourceManifestV1> {
    return sealManifest({
      ...validBody,
      sources: [licensedUnder(sourceId, licenseId), generatedSource],
    });
  }

  it("refuses a sealed manifest licensed as the operator's own authorship", async () => {
    // `src_proprio` is the pilot row docs/corpus-sources.md refuses in prose.
    // The entry is otherwise flawless: digest matches, two distinct reviewers,
    // a registered licence with no ND and no NC clause. The ONLY thing that can
    // refuse it is that the licence describes text the operator wrote.
    await expect(
      parseReviewedSourceManifest(
        await sealedUnder("src_proprio", "autoria-propria-v1"),
      ),
    ).rejects.toThrow(/src_proprio.*operator-authored-session/u);
  });

  it("refuses a sealed manifest licensed as an internal authorization", async () => {
    // `src_empresa`, the other prose-only pilot row. Corporate self-authorization
    // is NOT individual acquisition, so it gets its own reason — but B3's rule is
    // "só admite base pública licenciada", not "só recusa doador individual".
    await expect(
      parseReviewedSourceManifest(
        await sealedUnder("src_empresa", "autorizacao-interna-v1"),
      ),
    ).rejects.toThrow(/src_empresa.*non-public-base/u);
  });

  it("keeps the same manifest loading under a published-base licence", async () => {
    // The counter-case, so neither refusal above can be satisfied by refusing
    // everything: one licence id apart, this is the manifest that must parse.
    const manifest = await sealedUnder("src_proprio", "cc-by-sa-4.0");
    await expect(parseReviewedSourceManifest(manifest)).resolves.toEqual(
      manifest,
    );
  });

  it("keeps the official-acts licence a public base", async () => {
    // `lei9610-art8` has every clause false, exactly like the two authorization
    // ids, so a fix that keyed off "no obligations" would have caught it too.
    // Official acts ARE published; they are refused only as `snapshot-not-frozen`.
    const manifest = await sealedUnder("src_atos_oficiais", "lei9610-art8");
    await expect(parseReviewedSourceManifest(manifest)).resolves.toEqual(
      manifest,
    );
  });

  it("decides the regime from the registry, for every registered licence", () => {
    // The verdict is DATA on the entry, not a hardcoded id list, so this asserts
    // the field exists on all of them and then the partition it induces. A new
    // licence added without a regime is a type error, not a silent admission.
    for (const terms of CORPUS_LICENSE_REGISTRY) {
      expect(
        terms.publicationRegime,
        `${terms.licenseId} declares a publication regime`,
      ).toBeTruthy();
    }
    const nonPublic = CORPUS_LICENSE_REGISTRY.filter(
      (terms) => licenseDescribesPublicBase(terms.licenseId) === false,
    ).map((terms) => terms.licenseId);
    expect(new Set(nonPublic)).toEqual(
      new Set(["autorizacao-interna-v1", "autoria-propria-v1"]),
    );
  });

  it("answers `null`, not `false`, for a licence it has never reviewed", () => {
    // Three-valued on purpose: v1 manifests and every fixture here carry opaque
    // ids, and "not registered" is an unanswered question, not a refusal. A guard
    // written as `!== true` instead of `=== false` would refuse all of them.
    expect(licenseDescribesPublicBase("lic_ptbr_1")).toBeNull();
    expect(licenseDescribesPublicBase("cc-by-sa-4.0")).toBe(true);
    expect(licenseDescribesPublicBase("autoria-propria-v1")).toBe(false);
  });

  it("maps the operator's own authorship to the route it really is", () => {
    // The licence names a route; the internal authorization does not, because no
    // forbidden route describes corporate self-authorization truthfully (R4).
    expect(
      determinedHumanAcquisition(
        licensedUnder("src_proprio", "autoria-propria-v1"),
      ),
    ).toBe("operator-authored-session");
    expect(
      determinedHumanAcquisition(
        licensedUnder("src_empresa", "autorizacao-interna-v1"),
      ),
    ).toBeNull();
    expect(
      determinedHumanAcquisition(licensedUnder("src_ok", "cc-by-sa-4.0")),
    ).toBeNull();
  });

  it("names the route, not the publication, when both could fire", () => {
    // `autoria-propria-v1` fails both guards. The route is reported, because
    // publishing your own writing session does not unblock a route B3 refuses,
    // so naming the publication would name a reason a caller could satisfy
    // without becoming admissible.
    expect(() =>
      assertNoIndividualAcquisition([
        licensedUnder("src_proprio", "autoria-propria-v1"),
      ]),
    ).toThrow(/src_proprio.*operator-authored-session/u);
    expect(() =>
      assertPublicBaseLicensesOnly([
        licensedUnder("src_proprio", "autoria-propria-v1"),
      ]),
    ).toThrow(/src_proprio.*non-public-base/u);
  });

  it("refuses a non-public base whatever label the entry gives itself", () => {
    // The reason is a property of the base, not of the entry's own sourceType: a
    // `controlled-generation` entry claiming the operator's authorship licence is
    // still a corpus built on an unpublished base.
    expect(() =>
      assertPublicBaseLicensesOnly([
        { ...generatedSource, licenseId: "autorizacao-interna-v1" },
      ]),
    ).toThrow(/src_generated.*non-public-base/u);
    // ...and the v1 tolerance survives: an unregistered id is not refused here.
    expect(() =>
      assertPublicBaseLicensesOnly([licensedSource, generatedSource]),
    ).not.toThrow();
  });

  it("refuses a registration that claims a public route under a private licence", () => {
    // The `public-dataset` LIE: the registration contradicts itself, the route
    // guard believes the declared route, and the licence the registration named
    // itself is what refuses it. Without this step `assertV3HumanInventoryAdmissible`
    // could have stocked v3 from an unpublished base.
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        sourceId: "src_proprio",
        licenseId: "autoria-propria-v1",
      }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "non-public-base-license",
    });
    expect(() =>
      assertV3HumanInventoryAdmissible([
        {
          ...publicSnapshot,
          sourceId: "src_empresa",
          licenseId: "autorizacao-interna-v1",
        },
      ]),
    ).toThrow(/src_empresa.*non-public-base-license/u);
  });

  it("names the declared route, not the licence's regime, when both could fire", () => {
    // Declared honestly, the same source is refused for the route: step 1 of the
    // documented guard order beats step 2.
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        sourceId: "src_proprio",
        acquisition: "operator-authored-session",
        licenseId: "autoria-propria-v1",
      }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "individual-acquisition",
    });
  });

  it("leaves the frozen v3 inventory admissible", () => {
    // The counter-case for the registration path: all four v3 human sources are
    // public bases, so the new step refuses none of them.
    expect(() =>
      assertV3HumanInventoryAdmissible(V3_HUMAN_SOURCE_INVENTORY),
    ).not.toThrow();
  });
});

// Requirement 3: confirm and document the Python default; do NOT reimplement it.
describe("B3 — the pre-ChatGPT cutoff is the Python bench's default", () => {
  it("reads the same cutoff the extractors apply, from common.py", async () => {
    const common = await readFile(
      resolve(REPO_ROOT, "benchmark/lab/common.py"),
      "utf8",
    );
    // The default of the shared candidate writer, i.e. every human extractor
    // gets the cutoff without asking for it.
    expect(common).toMatch(
      /date_cutoff:\s*datetime\s*\|\s*None\s*=\s*CHATGPT_CUTOFF/u,
    );
    expect(common).toMatch(
      /CHATGPT_CUTOFF\s*=\s*datetime\(2022,\s*11,\s*30,\s*tzinfo=timezone\.utc\)/u,
    );
    // And a candidate with NO date is dropped, so the cutoff fails closed
    // instead of admitting an undated document.
    expect(common).toMatch(/created_at is None or \(/u);
    // The TS side documents the same date and never computes it.
    expect(PRE_CHATGPT_CUTOFF_ISO).toBe("2022-11-30T00:00:00.000Z");
  });
});

// Criterion: the documentation says "mitigação declarada" and never claims proof.
describe("B3 — the human label is a declared mitigation, never a proof", () => {
  const DOCS = [
    "docs/corpus-sources.md",
    "docs/corpus-collection-runbook.md",
    "docs/limitations.md",
  ];

  async function doc(relativePath: string): Promise<string> {
    return readFile(resolve(REPO_ROOT, relativePath), "utf8");
  }

  it("fires on the claims it exists to forbid, and not on their denials", () => {
    // What must be refused.
    for (const claim of [
      "O corte de data garante que o texto é humano.",
      "É prova de autoria humana.",
      "A autoria humana está comprovada pelo corte de data.",
      "O rótulo humano é certificado por construção.",
      "O corte temporal assegura autoria humana.",
    ]) {
      expect(humanLabelOverclaimIn(claim), claim).not.toBeNull();
    }
    // What must survive, because the project's own correct formulations use
    // exactly these words in the denying direction.
    for (const allowed of [
      "A autoria humana não pode ser garantida em 100%.",
      "É mitigação declarada de risco, não prova de autoria humana.",
      "Isso não comprova sua origem.",
      "O corte de data nunca prova autoria humana.",
      "Isso é garantido estruturalmente pelo pipeline: o schema rejeita chaves de autor.",
      "O corte de data sustenta o rótulo humano como mitigação declarada.",
    ]) {
      expect(humanLabelOverclaimIn(allowed), allowed).toBeNull();
    }
  });

  // The screen has to survive the way markdown is actually written. Prose in
  // `docs/` wraps at about 80 columns, so a claim can straddle two physical
  // lines; a per-line screen then sees a subject with no claim next to a claim
  // with no subject and reports nothing. Blockquotes are the same defect with a
  // `>` in front, and the frozen-decision blocks of corpus-sources.md are
  // blockquotes. Both are pinned against the SAME sentence unwrapped, so what is
  // asserted is that the wrapping is irrelevant, not that some string matches.
  it("sees through a soft line wrap and a blockquote marker", () => {
    const flat = "A autoria humana está comprovada pelo corte de data.";
    expect(humanLabelOverclaimIn(flat)).not.toBeNull();
    expect(
      humanLabelOverclaimIn("A autoria humana está\ncomprovada pelo corte."),
    ).not.toBeNull();
    expect(
      humanLabelOverclaimIn(
        "> A autoria humana está\n> comprovada pelo corte.",
      ),
    ).not.toBeNull();
    // And unwrapping must not fuse neighbours: two list items are two clauses,
    // so a subject in one may not pair with a claim in the next.
    expect(
      humanLabelOverclaimIn("- A autoria humana é o assunto\n- e isto prova."),
    ).toBeNull();
    expect(
      humanLabelOverclaimIn("| autoria humana |\n| isto prova |"),
    ).toBeNull();
  });

  it("screens every documentation file that describes the human label", async () => {
    for (const relativePath of DOCS) {
      const body = await doc(relativePath);
      expect(humanLabelOverclaimIn(body), relativePath).toBeNull();
    }
  });

  // Whitespace is collapsed before matching for the same reason the screen
  // unwraps soft lines: a reflow of the paragraph must not decide whether the
  // required wording is present.
  it("says 'mitigação declarada' where it states what the cutoff is", async () => {
    const sources = (await doc("docs/corpus-sources.md")).replace(/\s+/gu, " ");
    expect(sources).toMatch(/mitiga[çc][ãa]o declarada/iu);
    expect(sources).toMatch(/n[ãa]o pode ser garantida em 100%/iu);
  });

  // Requirement 4: the three definitive limitations, unsoftened, plus the four
  // answers, plus the R8 note that 0%–7,12% is a diagnosis of the run that
  // failed on 2026-07-25 and not a claim about v3.
  it("records the three definitive limitations and the four answers", async () => {
    const limitations = await doc("docs/limitations.md");
    expect(limitations).toMatch(/pr[ée]-?nov(embro)?\/?2022/iu);
    expect(limitations).toMatch(/n[ãa]o ser[áa] medido/iu);
    expect(limitations).toMatch(/7,12\s?%/u);
    expect(limitations).toMatch(/sem cota superior/iu);
    for (const answer of ["G2", "E4", "G3", "H4"]) {
      expect(limitations, `answer ${answer}`).toContain(answer);
    }
    // R8: the range is a diagnosis of the failed run, never a v3 number.
    expect(limitations).toMatch(/2026-07-25/u);
  });

  // Requirement 6: no step of the runbook may require recruitment.
  //
  // The stems are banned OUTRIGHT here, which is stricter than the overclaim
  // screen above and deliberately so: the runbook is a procedure, its content is
  // steps, and the bluntest check that no step recruits anybody is that the
  // vocabulary of recruitment does not occur in it. `docs/corpus-sources.md` is
  // the opposite case — it is the policy document, so it has to NAME the
  // prohibition ("não recruta pessoas para doar texto") and is not screened for
  // the stems. Banning them there would forbid stating the decision.
  it("keeps every runbook step free of donor recruitment", async () => {
    const runbook = await doc("docs/corpus-collection-runbook.md");
    expect(runbook).not.toMatch(/recrut/iu);
    expect(runbook).not.toMatch(/doador/iu);
    // The invariant is stated, not merely absent by accident.
    expect(runbook).toMatch(/somente bases p[úu]blicas/iu);
  });
});

// ---------------------------------------------------------------------------
// C1 — each source declares the dependence axes it can fill, so the audit has
// something to compare a record-line against.
// ---------------------------------------------------------------------------

describe("declaredGroupAxes on the v3 human inventory", () => {
  it("declares the plan's fixed per-source mapping", () => {
    const byId = new Map(
      V3_HUMAN_SOURCE_INVENTORY.map((entry) => [
        entry.sourceId,
        [...entry.declaredGroupAxes],
      ]),
    );
    // Stack Overflow -> thread and author; Wikipedia -> page; B2W -> product and
    // reviewer; Carolina -> member file. `source` IS the origin document in v3, so
    // thread/page/product/member-file are one axis under four names, and `author`
    // is declared only where a single person wrote the text.
    expect(byId.get("src_ptso")).toEqual(["author", "source"]);
    expect(byId.get("src_b2w")).toEqual(["author", "source"]);
    expect(byId.get("src_wikipedia_pt")).toEqual(["source"]);
    expect(byId.get("src_carolina")).toEqual(["source"]);
  });

  it("declares no axis a record cannot fill", () => {
    for (const entry of V3_HUMAN_SOURCE_INVENTORY) {
      for (const axis of entry.declaredGroupAxes) {
        expect(V3_GROUP_AXES).toContain(axis);
      }
    }
  });

  it("keeps every frozen human source admissible with its declaration", () => {
    expect(() =>
      assertV3HumanInventoryAdmissible(V3_HUMAN_SOURCE_INVENTORY),
    ).not.toThrow();
  });

  // A source that declares no axis cannot support a blocked split: every record
  // drawn from it is a component of one. That is not hypothetical — it is the state
  // the v2 corpus was in when it reported `leakages: []` over eight axes of
  // singletons.
  it("refuses a source that declares no applicable axis", () => {
    expect(
      humanSourceAdmissibility({ ...publicSnapshot, declaredGroupAxes: [] }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "no-declared-group-axis",
    });
    expect(() =>
      assertV3HumanInventoryAdmissible([
        { ...publicSnapshot, declaredGroupAxes: [] },
      ]),
    ).toThrow(/no-declared-group-axis/u);
  });

  // Guard order: the licence is reported before the missing declaration, because a
  // source that cannot enter at all has nothing to group.
  it("names the licence, not the missing declaration, when both could fire", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        licenseId: "cc-by-nc-nd-4.0",
        declaredGroupAxes: [],
      }),
    ).toMatchObject({ admissible: false, blockedBy: "no-derivatives" });
  });

  // ...and the declaration is reported before the label basis, because it is a
  // fact about the source's structure rather than about the evidence for its label.
  it("names the missing declaration, not the undeclared basis, when both could fire", () => {
    expect(
      humanSourceAdmissibility({
        ...publicSnapshot,
        labelBasis: null,
        declaredGroupAxes: [],
      }),
    ).toMatchObject({
      admissible: false,
      blockedBy: "no-declared-group-axis",
    });
  });
});
