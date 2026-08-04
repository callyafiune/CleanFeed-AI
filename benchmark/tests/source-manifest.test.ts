import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EVALUATOR_FILES } from "../digests.ts";
import {
  PREREGISTRATION_V4,
  PREREGISTRATION_V4_PATH,
} from "../preregistration-v4.ts";
import {
  CORPUS_LICENSE_REGISTRY,
  CORPUS_USE_POLICY,
  FROZEN_CORPUS_OBLIGATIONS,
  LICENSE_OBLIGATION_LABEL_PT,
  PRE_CHATGPT_CUTOFF_ISO,
  A1_BLOCKED_HUMAN_SOURCES,
  OUT_OF_FRAME_HUMAN_SOURCES,
  V3_HUMAN_SOURCE_INVENTORY,
  WEIGHT_USE_POLICY,
  corpusLicenseObligations,
  weightInheritanceOverclaimIn,
  trainingIndependenceOverclaimIn,
  assertLicenseInventoryAdmissible,
  assertNoIndividualAcquisition,
  assertPublicBaseLicensesOnly,
  assertV3HumanInventoryAdmissible,
  batchNamespaceOf,
  computeReviewedSourceManifestDigest,
  corpusLicenseTerms,
  determinedHumanAcquisition,
  humanLabelOverclaimIn,
  reviewOverclaimIn,
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
import { ALL_GROUP_AXES } from "../schema.ts";

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
  temperatureNullReason: null,
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

  // -----------------------------------------------------------------------
  // C1 correction round — `temperature` gets the same pair `seed` already has,
  // for the same reason and it is the same class of fact.
  //
  // A batch was required to declare a finite `temperature`, while three of the
  // four frozen generation lanes (`agy`, `codex`, `gemini-cli`) are agent CLIs
  // whose frozen policy row sets `decodingConfigurable: false` — they accept no
  // sampling flag at all. So the reviewed batch of a CLI lane had to write down
  // a number that was never applied, and the record's side (`recipeTemperature`,
  // `null` on that lane BY CONSTRUCTION) could never equal it: the
  // recipe-identity comparison in benchmark/corpus-source-audit.ts was
  // UNSATISFIABLE for every v3 CLI-lane row. Measured on the committed tree at
  // 7a4d610: an `agy` row aligned field-for-field with its batch reported
  // `GENERATION_RECIPE_MISMATCH` and `status: "blocked"`.
  //
  // `temperature: null` alone would have been enough to make the comparison
  // satisfiable and NOT enough to keep the datum honest: a bare null is
  // indistinguishable from "nobody wrote it down", which is precisely the
  // ambiguity `decodingConfigurable` exists to remove on the record side. So the
  // absence carries a written reason, exactly as `seedNullReason` does for the
  // seed a provider does not expose.
  // -----------------------------------------------------------------------

  it("accepts a batch that applied no temperature with a non-empty null reason", async () => {
    const cliBatch = malformed({
      ...batch,
      temperature: null,
      temperatureNullReason:
        "agent-CLI lane: the binary accepts no sampling flag",
    });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [cliBatch as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).resolves.toMatchObject({
      generationBatches: [
        {
          temperature: null,
          temperatureNullReason:
            "agent-CLI lane: the binary accepts no sampling flag",
        },
      ],
    });
  });

  it("rejects a batch with both a temperature and a null reason", async () => {
    const both = malformed({
      ...batch,
      temperatureNullReason: "unnecessary",
    });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [both as GenerationBatchV1],
    });
    // The specific message, not just /temperature/: before the field existed the
    // unknown-key refusal ALSO named `temperatureNullReason`, so a loose pattern
    // would have passed against the very state this pins.
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /must record exactly one of temperature or temperatureNullReason/u,
    );
  });

  it("rejects a batch with neither a temperature nor a null reason", async () => {
    const neither = malformed({
      ...batch,
      temperature: null,
      temperatureNullReason: null,
    });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [neither as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).rejects.toThrow(
      /must record exactly one of temperature or temperatureNullReason/u,
    );
  });

  it("keeps a temperature of 0 as an applied value, not as an absence", async () => {
    // A greedy decode is a REAL recipe. The exclusivity check reads
    // null/undefined and not falsiness for that reason — the same trap the seed
    // pair avoids, on a field where `0` is a legitimate frozen sweep value.
    const greedy = malformed({
      ...batch,
      temperature: 0,
      temperatureNullReason: null,
    });
    const manifest = await sealManifest({
      ...validBody,
      generationBatches: [greedy as GenerationBatchV1],
    });
    await expect(parseReviewedSourceManifest(manifest)).resolves.toMatchObject({
      generationBatches: [{ temperature: 0, temperatureNullReason: null }],
    });
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
  // benchmark/preregistration-v4.json, which the plan designates as the ONLY
  // place a frozen value is written down ("código não pode repeti-los como
  // constantes soltas"). These two tests pin the chain from that file to what
  // this module publishes, so `commercialUse: false` exists once and not twice.
  it("reads the frozen non-commercial decision from the policy file, not a copy of it", async () => {
    const frozenFile = JSON.parse(
      await readFile(PREREGISTRATION_V4_PATH, "utf8"),
    ) as { commercialUse: unknown };
    // file bytes -> validated policy -> the use policy this module publishes.
    expect(PREREGISTRATION_V4.commercialUse).toBe(frozenFile.commercialUse);
    expect(CORPUS_USE_POLICY.commercialUse).toBe(
      PREREGISTRATION_V4.commercialUse,
    );
    // And the verdict on the NC source follows that flag rather than a local
    // decision: Carolina is admissible BECAUSE the frozen use is not commercial.
    expect(sourceAdmissibility("cc-by-nc-sa-4.0").admissible).toBe(
      !PREREGISTRATION_V4.commercialUse,
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
      /commercialUse:\s*PREREGISTRATION_V4\.commercialUse/u,
    );
  });

  // The header told an editor that this module is NOT part of the evaluator's
  // identity and that editing its two over-claim screens "does not move
  // `integrity.evaluator-digest`" — while C3 had already put it inside
  // `EVALUATOR_FILES`. That is the belief whose consequence is a burned holdout
  // grant (R1), stated in the file C3 had just made load-bearing for the
  // declared-axis gate.
  //
  // WHAT THIS MEASURES, and its limit: the membership itself, plus the presence of
  // the affirmative sentence and the absence of the denial. A reworded denial the
  // pattern does not know would pass — the pairing is what makes the current text
  // red, not a general lie detector.
  it("says in its header that it IS part of the evaluator identity", async () => {
    expect(new Set<string>(EVALUATOR_FILES)).toContain(
      "benchmark/source-manifest.ts",
    );
    const source = await readFile(
      resolve(HERE, "../source-manifest.ts"),
      "utf8",
    );
    const header = source
      .split(/\r?\n/u)
      .slice(
        0,
        source.split(/\r?\n/u).findIndex((line) => !line.startsWith("//")),
      )
      .join("\n");
    expect(header).not.toMatch(/not\s+in\s+`?EVALUATOR_FILES/iu);
    expect(header).toMatch(/is\s+in\s+`?EVALUATOR_FILES/iu);
    // And the consequence, which is the part an editor needs before the freeze.
    expect(header).toMatch(/integrity\.evaluator-digest/u);
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
  // `benchmark/preregistration-v4.ts` as the owner of a frozen value, not as a
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
      "./preregistration-v4.ts",
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
    if (PREREGISTRATION_V4.attributionRequired)
      requiredByContract.push("attribution");
    if (!PREREGISTRATION_V4.commercialUse)
      requiredByContract.push("non-commercial");
    if (PREREGISTRATION_V4.shareAlikeRequired)
      requiredByContract.push("share-alike");
    expect(FROZEN_CORPUS_OBLIGATIONS).toEqual(requiredByContract);

    // The registry must actually IMPOSE them: dropping `shareAlike` from
    // `cc-by-nc-sa-4.0` would otherwise leave a frozen obligation unenforced
    // while every other test stayed green.
    const imposed = corpusLicenseObligations(
      CORPUS_LICENSE_REGISTRY.filter(
        (terms) => terms.derivedCorpus === "admissible",
      ).map((terms) => terms.licenseId),
    );
    for (const obligation of FROZEN_CORPUS_OBLIGATIONS) {
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

  it("unions the obligations the corpus must carry", () => {
    expect(corpusLicenseObligations(["cc-by-sa-4.0", "lei9610-art8"])).toEqual([
      "attribution",
      "share-alike",
    ]);
    expect(corpusLicenseObligations(["lei9610-art8"])).toEqual([]);
    expect(
      corpusLicenseObligations(
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

  // The cross-review's first P1: `WEIGHT_USE_POLICY.policyId` had been given its own
  // value in the module while the published review carried no weights policy id at all
  // and the NOTICE printed the CORPUS id under the weights heading. The separation was
  // real in code and invisible in the contract a downstream user reads, which is the
  // half that matters. Pinned here so the two can no longer drift.
  it("publishes the weights policy under its OWN id, never the corpus's", async () => {
    const review = await licenseReview();
    const weightPolicy = review.weightPolicy as Record<string, unknown>;
    expect(weightPolicy.policyId).toBe(WEIGHT_USE_POLICY.policyId);
    expect(weightPolicy.licenseId).toBe(WEIGHT_USE_POLICY.licenseId);
    expect(weightPolicy.commercialUse).toBe(WEIGHT_USE_POLICY.commercialUse);
    expect(weightPolicy.sourceObligationsPropagate).toBe(
      WEIGHT_USE_POLICY.sourceObligationsPropagate,
    );
    // Two policies, two identifiers. Equal ids would leave a reader of the published
    // artifact unable to say which policy a given `commercialUse: false` came from.
    expect(WEIGHT_USE_POLICY.policyId).not.toBe(CORPUS_USE_POLICY.policyId);
    expect(review.usePolicyId).not.toBe(weightPolicy.policyId);
    // And the NOTICE, which is the file that travels with the weights, has to name the
    // weights' id where it states their regime.
    const notice = await readFile(resolve(MODEL_DIR, "NOTICE.md"), "utf8");
    expect(notice).toContain(WEIGHT_USE_POLICY.policyId);
  });

  it("the model licence review carries the registry's terms verbatim", async () => {
    const review = await licenseReview();
    expect(review.sourceLicenses).toEqual(CORPUS_LICENSE_REGISTRY);
    expect(review.corpusObligations).toEqual(
      corpusLicenseObligations(
        (review.sourceLicenses as CorpusLicenseTermsV1[])
          .filter((terms) => terms.derivedCorpus === "admissible")
          .map((terms) => terms.licenseId),
      ),
    );
  });

  // The field this replaced was `artifactObligations`, and the rename is the
  // point: it published the union of source obligations as the OBLIGATION OF THE
  // MODEL. Nothing may reintroduce it under the old name, because a consumer
  // reading `artifactObligations` reads exactly the claim position (a) denies.
  it("no longer publishes the source union as an obligation of the artifact", async () => {
    const review = await licenseReview();
    expect(review.artifactObligations).toBeUndefined();
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

  it("the NOTICE states the non-commercial regime and the corpus obligations", async () => {
    const notice = await readFile(resolve(MODEL_DIR, "NOTICE.md"), "utf8");
    expect(notice).toMatch(/`commercialUse: false`/u);
    for (const obligation of corpusLicenseObligations(
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

// `ptwiki` and not `pt-stackoverflow`, which this fixture used until A1 refused
// that base: a registration naming a blocked snapshot is refused at the first
// guard, so it can no longer stand in for "an ordinary admissible source" while
// these tests pin the ORDER of the later guards.
const publicSnapshot: HumanSourceRegistrationV1 = {
  sourceId: "src_wikipedia_pt",
  snapshot: "ptwiki",
  acquisition: "public-dataset",
  licenseId: "cc-by-sa-4.0",
  labelBasis: "date-cutoff",
  anchorDateField: "page/revision/timestamp",
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
    expect([...PREREGISTRATION_V4.labelBasis.allowed].sort()).toEqual([
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
    expect(PREREGISTRATION_V4.humanSources.newDownloadsAllowed).toBe(false);
    expect(
      V3_HUMAN_SOURCE_INVENTORY.map((entry) => entry.snapshot).sort(),
    ).toEqual([...PREREGISTRATION_V4.humanSources.snapshots].sort());
  });

  it("declares the sourceId a reviewed manifest joins on", () => {
    // The inventory is keyed twice — by `snapshot` against the frozen policy
    // (asserted above) and by `sourceId` against the reviewed source manifest.
    // These are the ids the manifests an operator holds actually use. Those
    // manifests are gitignored build artifacts, so this is a literal and not a read.
    expect(V3_HUMAN_SOURCE_INVENTORY.map((entry) => entry.sourceId)).toEqual([
      "src_wikipedia_pt",
      "src_carolina",
    ]);
  });

  it("keeps the out-of-frame source declared instead of deleting it, and out of the stocked inventory", () => {
    // B2W is not refused: its route and licence are admissible, and
    // `humanSourceAdmissibility` still says so. What it lacks is a CELL — product
    // review is not one of the four the claim is published over — so its base left
    // `humanSources.snapshots` and its registration left this inventory while staying
    // readable, with the axes a review really has.
    expect(OUT_OF_FRAME_HUMAN_SOURCES.map((entry) => entry.sourceId)).toEqual([
      "src_b2w",
    ]);
    for (const entry of OUT_OF_FRAME_HUMAN_SOURCES) {
      expect(humanSourceAdmissibility(entry).admissible, entry.sourceId).toBe(
        true,
      );
      expect(
        [...PREREGISTRATION_V4.humanSources.snapshots],
        entry.sourceId,
      ).not.toContain(entry.snapshot);
      expect(
        V3_HUMAN_SOURCE_INVENTORY.map((stocked) => stocked.sourceId),
      ).not.toContain(entry.sourceId);
    }
    // And the stocking rule is what refuses it, naming the snapshot: a source with
    // no frozen base has no bytes on disk, however admissible it is.
    expect(() =>
      assertV3HumanInventoryAdmissible([...OUT_OF_FRAME_HUMAN_SOURCES]),
    ).toThrow(/src_b2w draws on "b2w-reviews01": snapshot-not-frozen/u);
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

  it("returns the obligations the frozen inventory imposes on the corpus", () => {
    expect(assertV3HumanInventoryAdmissible(V3_HUMAN_SOURCE_INVENTORY)).toEqual(
      FROZEN_CORPUS_OBLIGATIONS,
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
    ).toThrow(/src_wikipedia_pt.*individual-acquisition/u);
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
    // Wikipedia -> page; Carolina -> member file. `source` IS the origin document in
    // v3, so page and member-file are one axis under two names, and `author` is
    // declared only where a single person wrote the text — which neither stocked
    // source has. `sourceMaterialBatch` is declared by EVERY human source: the
    // splitter does not union on it, so the declaration is the only thing that turns
    // an unrecovered acquisition event into an audit failure.
    expect(byId.has("src_b2w")).toBe(false);
    expect(byId.get("src_wikipedia_pt")).toEqual([
      "source",
      "sourceMaterialBatch",
    ]);
    expect(byId.get("src_carolina")).toEqual(["source", "sourceMaterialBatch"]);
    expect(byId.has("src_ptso")).toBe(false);
  });

  it("keeps the refused source's declaration instead of deleting it", () => {
    // A1 refused the Stack Exchange dump; the registration survives so
    // `auditCorpusSources` can still recognise a manifest that declares `src_ptso`
    // and BLOCK it (`SOURCE_BLOCKED_BY_ACCESS_TERMS`), rather than not know the
    // source and report `ready`. Thread and author are
    // the axes an answer really has, and rediscovering them is the cost A1 would
    // otherwise charge to whoever reverts it.
    expect(A1_BLOCKED_HUMAN_SOURCES.map((entry) => entry.sourceId)).toEqual([
      "src_ptso",
    ]);
    expect([...A1_BLOCKED_HUMAN_SOURCES[0].declaredGroupAxes]).toEqual([
      "author",
      "source",
      "sourceMaterialBatch",
    ]);
    expect(A1_BLOCKED_HUMAN_SOURCES[0].anchorDateField).toBe(
      "Posts.xml@CreationDate",
    );
  });

  it("refuses the blocked base by name, not by absence, and above its licence", () => {
    const verdict = humanSourceAdmissibility(A1_BLOCKED_HUMAN_SOURCES[0]);
    expect(verdict).toMatchObject({
      admissible: false,
      blockedBy: "access-terms-unresolved",
    });
    // The licence and the route are both fine, which is exactly why neither may be
    // reported: telling a caller the problem is the licence would tell them that
    // `cc-by-sa-4.0` is the thing to fix, and it is not.
    expect(sourceAdmissibility("cc-by-sa-4.0").admissible).toBe(true);
    expect(licenseDescribesPublicBase("cc-by-sa-4.0")).toBe(true);
    // And the route still wins when both could fire: B3 refuses recruitment for
    // every source, which is the more general statement than one blocked base.
    expect(
      humanSourceAdmissibility({
        ...A1_BLOCKED_HUMAN_SOURCES[0],
        acquisition: "recruited-donor",
      }),
    ).toMatchObject({ blockedBy: "individual-acquisition" });
  });

  it("declares no axis a record cannot fill", () => {
    // Against the union over every record version, not against one tuple: a source
    // may declare an axis only v4 names, and the property that matters is that SOME
    // version of a record can fill it.
    for (const entry of [
      ...V3_HUMAN_SOURCE_INVENTORY,
      ...A1_BLOCKED_HUMAN_SOURCES,
      ...OUT_OF_FRAME_HUMAN_SOURCES,
    ]) {
      for (const axis of entry.declaredGroupAxes) {
        expect(ALL_GROUP_AXES).toContain(axis);
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

// C5 — the review claim was removed from the records and from the assembler, and
// prose is the other place a removed claim comes back. `reviewOverclaimIn` refuses
// the SENTENCE; whether a record was reviewed is decided by `review` on the record
// and by `sealDataset`, never here.
describe("C5 — documentation may not claim a review that did not happen", () => {
  const SCREENED = [
    "docs/corpus-sources.md",
    "docs/corpus-collection-runbook.md",
    "docs/limitations.md",
    "benchmark/protocols/pii-review-v1.md",
    "benchmark/protocols/collection-v1.md",
    "benchmark/protocols/annotation-v1.md",
    "benchmark/protocols/generation-v1.md",
  ];

  it("fires on the assertions the fabricated field used to make true-looking", () => {
    for (const claim of [
      "A revisão humana garante que nenhum dado pessoal sobrou.",
      "Dois revisores certificam cada registro.",
      "A auditoria de PII prova que o corpus está limpo.",
      "Todos os registros foram revisados por dois revisores.",
      "Cada registro foi auditado para dados pessoais.",
      "A concordância entre os revisores é garantida por construção.",
    ]) {
      expect(reviewOverclaimIn(claim), claim).not.toBeNull();
    }
  });

  it("does not fire on a protocol describing what it requires", () => {
    // The distinction the screen exists to keep: a REQUIREMENT and a DESCRIPTION
    // are not claims that the work was done. Every one of these has to survive, or
    // the project cannot document its own protocol.
    for (const allowed of [
      "Cada registro passa por revisão manual antes de ser selado.",
      "O revisor inspeciona os candidatos sinalizados e confirma que o registro está limpo.",
      "O protocolo exige que cada registro seja revisado por dois revisores independentes.",
      "Nenhum registro foi revisado: o estado é automated/unreviewed.",
      "A revisão humana não ocorreu neste corpus, e o registro não sustenta alegação.",
      "Um registro sem revisão humana nunca é certificado como auditado.",
      "A auditoria de PII deste corpus não está comprovada por recibo nenhum.",
    ]) {
      expect(reviewOverclaimIn(allowed), allowed).toBeNull();
    }
  });

  it("sees through a soft line wrap, as the label screen does", () => {
    // Same machinery, so the same property has to hold: prose in `docs/` wraps at
    // about 80 columns and a claim may straddle two physical lines.
    expect(
      reviewOverclaimIn("Todos os registros\nforam revisados."),
    ).not.toBeNull();
    expect(
      reviewOverclaimIn("> A revisão humana\n> garante o resultado."),
    ).not.toBeNull();
    // And two list items stay two clauses.
    expect(
      reviewOverclaimIn("- A revisão humana é o assunto\n- e isto garante."),
    ).toBeNull();
  });

  it("screens every document that describes the corpus governance", async () => {
    for (const relativePath of SCREENED) {
      const body = await readFile(resolve(REPO_ROOT, relativePath), "utf8");
      expect(reviewOverclaimIn(body), relativePath).toBeNull();
    }
  });

  it("keeps the PII protocol from presenting the automated filter as an audit", async () => {
    const body = await readFile(
      resolve(REPO_ROOT, "benchmark/protocols/pii-review-v1.md"),
      "utf8",
    );
    // The protocol has to name the state a stage-1-only record carries, or the
    // document describes a two-stage review whose first stage silently counts as
    // the second — which is exactly what the removed `provenance.piiAudit` did.
    expect(body).toContain("automated/unreviewed");
    // Whitespace collapsed first: the sentence wraps at about 80 columns, and a
    // reflow of the paragraph must not decide whether the required wording is
    // present (the same reason the label screen's doc assertions collapse it).
    expect(body.replace(/\s+/gu, " ")).toMatch(
      /is not a claim that the protocol ran/u,
    );
    // And it may no longer point at the field that could only ever say "passed".
    expect(body).not.toMatch(/`status: "passed"`/u);
  });
});

// Position (a): the obligations of the source licences govern the CORPUS, and the
// project asserts they do not propagate to the WEIGHTS. Under the opposite reading
// the model would owe `NC` (share-alike of `cc-by-nc-sa-4.0`) and owe not adding
// `NC` (`cc-by-sa-4.0`) at once, so the reading is not merely disfavoured — it is
// unsatisfiable. These tests hold the two policies apart, and the screen refuses
// the sentence that collapses them.
describe("position (a) — the weights carry their own policy, not the sources'", () => {
  it("keeps the weights' non-commercial regime from being derived from the corpus", () => {
    // Both say non-commercial and NEITHER reads the other: agreement by two
    // independent derivations is the property, because a single shared read would
    // rebuild the inheritance the position denies. What pins them together is the
    // frozen flag, which is the one thing both are allowed to agree with.
    expect(WEIGHT_USE_POLICY.commercialUse).toBe(false);
    expect(CORPUS_USE_POLICY.commercialUse).toBe(false);
    expect(PREREGISTRATION_V4.commercialUse).toBe(false);
    // And the position itself is data, not prose: a reader of the module can ask.
    expect(WEIGHT_USE_POLICY.sourceObligationsPropagate).toBe(false);
    expect(WEIGHT_USE_POLICY.positionAuthority).toBe("operator-risk-decision");
  });

  it("names the weights licence, because a use restriction that does not travel restricts nothing", () => {
    // B2: the extension's own copy screen does not ship with weights somebody
    // extracted from the bundle, so the prohibitions have to be a term of the
    // artifact's own licence and that licence has to have a name.
    expect(WEIGHT_USE_POLICY.licenseId).toBe("cleanfeed-weights-nc-1.0");
    // The prohibited uses are the documented-harm categories, not a free list:
    // Liang 2023 (bias against non-native writers) and Weber-Wulff 2023
    // (detectors inadequate as misconduct evidence) are what make the academic and
    // disciplinary entries mandatory rather than cautious.
    expect([...WEIGHT_USE_POLICY.prohibitedUses]).toEqual([
      "academic-integrity",
      "decisional",
      "disciplinary",
      "employment",
      "mass-screening",
    ]);
  });

  it("does not register the weights licence as a corpus licence", () => {
    // The two registries answer different questions, and the weights licence is
    // not an instrument any source was published under. Registering it would make
    // it selectable as a source licence and let a source claim it.
    expect(corpusLicenseTerms(WEIGHT_USE_POLICY.licenseId)).toBeNull();
  });

  it("fires on the claims position (a) forbids", () => {
    for (const claim of [
      "Obrigações que este artefato herda das licenças das suas fontes.",
      "O modelo herda as obrigações das fontes e propaga para qualquer derivado.",
      "As licenças das fontes se estendem aos pesos.",
      "Os pesos estão sujeitos ao share-alike da Carolina.",
      "A obrigação de atribuição do corpus é transferida ao modelo.",
      "Qualquer derivado dos pesos carrega as mesmas obrigações, propagadas do corpus.",
      "Os pesos, e não o corpus, herdam as obrigações.",
      // Found by the codex cross-review, which the internal adversarial round of the
      // same day did not catch: the verb list had no `recebem`.
      "Os pesos recebem as obrigações das licenças das fontes.",
    ]) {
      expect(weightInheritanceOverclaimIn(claim), claim).not.toBeNull();
    }
  });

  it("does not fire on the denial, on the corpus, or on the base model's licence", () => {
    for (const allowed of [
      // The project's own position, which must be sayable.
      "As obrigações das fontes não se propagam aos pesos.",
      "Os pesos não herdam a licença das fontes: o regime não comercial é política própria.",
      "Nenhuma obrigação de licença de fonte é transferida ao modelo.",
      "O modelo nunca herda as cláusulas das licenças do corpus.",
      // True and required: the corpus really does inherit them.
      "O corpus herda as obrigações das licenças das suas fontes.",
      "A aquisição e a preparação dos dados seguem as obrigações de cada licença.",
      // Provenance of the base model is not propagation from the corpus.
      "O detector é um fine-tune de BERTimbau-base, sob licença MIT.",
      // A sentence about weights with no licence object at all.
      "O modelo herda o vocabulário do tokenizer do BERTimbau.",
      // The sentence `cleanfeed-weights-nc-1.0` has to make: its OWN restrictions
      // bind downstream, with no source as their origin. A screen that refused
      // this would forbid the licence from being enforceable.
      "Estas restrições acompanham os pesos e se propagam a qualquer derivado deles.",
      "Quem redistribuir os pesos fica vinculado às mesmas obrigações desta licença.",
      // Also from the codex cross-review, and the more interesting half: this is the
      // CLEAREST way to state position (a), and lexical co-occurrence refused it. One
      // sentence, two subjects, two predicates — `CONTRAST_BOUNDARY` splits on
      // `enquanto` so each half is judged against its own subject.
      "A licença própria vincula os pesos, enquanto as licenças das fontes vinculam o corpus.",
      "As obrigações valem para o corpus, ao passo que os pesos seguem política própria.",
    ]) {
      expect(weightInheritanceOverclaimIn(allowed), allowed).toBeNull();
    }
  });

  it("sees through a soft line wrap, as the other two screens do", () => {
    // The sentence that actually shipped, wrapped exactly as the NOTICE wrapped
    // it: subject and verb on one line, object on the next. A per-line screen
    // reads two harmless halves.
    expect(
      weightInheritanceOverclaimIn(
        "Obrigações que este artefato herda das licenças das suas fontes e propaga para\nqualquer derivado: atribuição, não comercial e share-alike.",
      ),
    ).not.toBeNull();
    expect(
      weightInheritanceOverclaimIn(
        "> Os pesos herdam\n> as obrigações das fontes.",
      ),
    ).not.toBeNull();
    // And two list items stay two clauses.
    expect(
      weightInheritanceOverclaimIn(
        "- Os pesos são o assunto\n- e as obrigações se propagam.",
      ),
    ).toBeNull();
  });

  it("screens every document that states the licence position", async () => {
    // The NOTICE is first because it is the file that TRAVELS with the weights:
    // whatever the repository says elsewhere, this is what a downstream user
    // reads, and it is where the forbidden sentence actually stood.
    for (const relativePath of [
      "models/cleanfeed-ptbr-v1/NOTICE.md",
      "models/cleanfeed-ptbr-v1/LICENSE",
      "docs/corpus-sources.md",
      "docs/limitations.md",
      "docs/uso-responsavel.md",
      // The repository's front-door statement of the position and the licence of the
      // documentation. Both were created by the same commit as the screen and both
      // were missing from this list, which is the shape of the failure the screen
      // exists to prevent: the claim is not where you last removed it, it is in the
      // file somebody writes next.
      "LICENSES.md",
      "docs/LICENSE-DOCS.md",
    ]) {
      const body = await readFile(resolve(REPO_ROOT, relativePath), "utf8");
      expect(weightInheritanceOverclaimIn(body), relativePath).toBeNull();
    }
  });
});

// R7 over the one property the pipeline can most easily be read as proving and does
// not: independence between the sealed corpus and the detector's training set. What
// `drop_seen` proves is a contract — no exact tokenized duplicate, nothing at Jaccard
// >= 0.82 over 5-token shingles, against train+dev. Paraphrase and shared subject
// matter clear that bar, so "independent" is an over-claim however tempting the
// shorthand is.
describe("R7 — the corpus is contract-clean against training, never independent of it", () => {
  it("fires on the claim the plan says may never be made", () => {
    for (const claim of [
      "O corpus é independente do conjunto de treino.",
      "As partições seladas são disjuntas do treino.",
      "drop_seen prova a independência entre o corpus e o treino.",
      "O dataset garante independência em relação ao que o detector treinou.",
      "Os registros são independentes dos dados de treinamento.",
    ]) {
      expect(trainingIndependenceOverclaimIn(claim), claim).not.toBeNull();
    }
  });

  it("does not fire on the denial, nor on the sentences the runbook must keep", () => {
    for (const allowed of [
      // The project's own correct formulations.
      "O contrato verificado é hash exato + Jaccard ≥ 0,82, e não é independência semântica.",
      "O corpus não é independente do treino: o que existe é uma poda sob contrato.",
      // A forma que o projeto escreve desde a terceira rodada: `nada` saiu das duas
      // telas porque nega numa frase e reforça na seguinte, então a denegação usa `não`.
      "Independência semântica não é medida aqui, nem contra o treino.",
      // The runbook sentence that a `limpo`-based predicate would have refused, and
      // which is true and load-bearing: cleanliness is relative to ONE training set.
      "Um corpus limpo contra um treino não é limpo contra outro.",
      "O corpus não repete o que treinou o detector, sob contrato explícito.",
      // Independence of something else entirely: the predicate alone is not a claim.
      "Os componentes conectados são independentes entre si.",
      "Dois revisores independentes avaliam cada registro.",
    ]) {
      expect(trainingIndependenceOverclaimIn(allowed), allowed).toBeNull();
    }
  });

  it("sees through a soft line wrap, as the other three screens do", () => {
    expect(
      trainingIndependenceOverclaimIn(
        "O corpus selado é independente\ndo conjunto de treino.",
      ),
    ).not.toBeNull();
    // Two list items stay two clauses. The pair is chosen so that NEITHER half is a
    // claim on its own: the earlier version used "- e o treino é independente", which
    // asserts the forbidden thing by itself and must fire — it only passed while the
    // screen still demanded a corpus subject in the same clause.
    expect(
      trainingIndependenceOverclaimIn(
        "- O treino é o assunto\n- e a poda é obrigatória.",
      ),
    ).toBeNull();
    // And the half that IS a claim fires even as a bare list item.
    expect(
      trainingIndependenceOverclaimIn("- o treino é independente do corpus."),
    ).not.toBeNull();
  });

  // NOT named "every document", because it is not every document and the earlier name
  // said so falsely. This is every document that describes the gate as CURRENT
  // behaviour. Deliberately excluded, and this is a design constraint rather than an
  // omission: a document that documents the PROHIBITION has to quote the forbidden
  // sentence in order to explain it. `plano-v1-minima.md`, `registro-de-decisoes.md`,
  // `estado-do-projeto.md`, the v3 rebuild plan and `references.md` all carry it between
  // quotes for exactly that reason, and screening them would stop the project from
  // writing down its own rule. Sweeping all 55 tracked markdown files confirms the
  // split: five hit for that reason, and the two that hit for a real reason are fixed
  // and are in the list below.
  it("screens every document that describes the gate as current behaviour", async () => {
    for (const relativePath of [
      "docs/corpus-collection-runbook.md",
      "docs/corpus-sources.md",
      "docs/limitations.md",
      // Added after the cross-review: both describe the gate, both were unprotected,
      // and the assessment carried a live over-claim ("a independência entre os dois é
      // garantida") that no test would have caught.
      "docs/detector-rebuild-assessment.md",
      "docs/detector-rebuild-critical-review.md",
    ]) {
      const body = await readFile(resolve(REPO_ROOT, relativePath), "utf8");
      expect(trainingIndependenceOverclaimIn(body), relativePath).toBeNull();
    }
  });

  it("keeps the runbook stating the contract where it states the invariant", async () => {
    const runbook = (
      await readFile(
        resolve(REPO_ROOT, "docs/corpus-collection-runbook.md"),
        "utf8",
      )
    ).replace(/\s+/gu, " ");
    expect(runbook).toMatch(/Jaccard ≥ 0,82/u);
    expect(runbook).toMatch(/n[ãa]o é independência semântica/iu);
  });
});

// ---------------------------------------------------------------------------
// O inventário de lotes de material.
//
// Campo ADMITIDO e não exigido no esquema v1, e a razão é de digest: a projeção que
// `computeReviewedSourceManifestDigest` hasheia é escrita à mão, então incluir a chave sempre
// mudaria o digest de todo manifesto que não declara lote — inclusive o inventário v3 congelado.
// Os dois primeiros testes abaixo prendem exatamente esse par: o digest de quem não declara não
// mudou, e o de quem declara COBRE o que foi declarado.
// ---------------------------------------------------------------------------

describe("inventário de lotes de material", () => {
  const lote = {
    batchId: "smb_licenciado_2024",
    sourceId: "src_licensed",
    materialVersion: "dump-2024-06-01",
    acquisitionWindow: {
      startedAt: 1_717_200_000_000,
      endedAt: 1_717_286_400_000,
    },
    evidence: ["https://exemplo.invalido/dump-2024-06-01.sha256"],
  };

  function comLote(overrides: Record<string, unknown> = {}): ManifestBody {
    return {
      ...validBody,
      materialBatches: [{ ...lote, ...overrides }],
    } as ManifestBody;
  }

  it("keeps the digest of a manifest that declares no batch unchanged", async () => {
    // A guarda da decisão: se algum dia a chave entrar na projeção sem condição, este teste cai
    // junto com o inventário v3 congelado — e é ele que explica por quê.
    const semLote = await computeReviewedSourceManifestDigest(validBody);
    const comChaveAusente = await computeReviewedSourceManifestDigest({
      ...validBody,
    });
    expect(comChaveAusente).toBe(semLote);
    await expect(
      parseReviewedSourceManifest(await sealManifest()),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("covers the declared inventory with the self-digest", async () => {
    // A forja: selar COM o lote e depois trocar o lote sem re-selar. Se a projeção não cobrisse o
    // campo, isto passaria — que é o defeito que o atestado de composição do E2 fechou.
    const selado = await sealManifest(comLote());
    await expect(parseReviewedSourceManifest(selado)).resolves.toMatchObject({
      materialBatches: [{ batchId: "smb_licenciado_2024" }],
    });

    const forjado = {
      ...selado,
      materialBatches: [{ ...lote, materialVersion: "dump-2025-01-01" }],
    };
    await expect(parseReviewedSourceManifest(forjado)).rejects.toMatchObject({
      code: "SOURCE_MANIFEST_DIGEST_MISMATCH",
    });
  });

  it("refuses a batch whose sourceId this manifest does not declare", async () => {
    const selado = await sealManifest(comLote({ sourceId: "src_inexistente" }));
    await expect(parseReviewedSourceManifest(selado)).rejects.toMatchObject({
      code: "SOURCE_MANIFEST_FIELD_INVALID",
    });
  });

  it("refuses a material batchId a generation batch already uses", async () => {
    // Os dois inventários dividem o namespace de propósito: a auditoria recusa registro não
    // gerado que nomeie lote de GERAÇÃO, e essa recusa só é decidível se um id pertence a um dos
    // dois e nunca aos dois.
    const selado = await sealManifest(comLote({ batchId: "batch_gen" }));
    await expect(parseReviewedSourceManifest(selado)).rejects.toThrow(
      /duplicate batchId/u,
    );
  });

  it("refuses a batch with no evidence at all", async () => {
    const selado = await sealManifest(comLote({ evidence: [] }));
    await expect(parseReviewedSourceManifest(selado)).rejects.toThrow(
      /evidence must be a non-empty array/u,
    );
  });

  it("refuses an acquisition window that ends before it starts", async () => {
    const selado = await sealManifest(
      comLote({
        acquisitionWindow: {
          startedAt: 1_717_286_400_000,
          endedAt: 1_717_200_000_000,
        },
      }),
    );
    await expect(parseReviewedSourceManifest(selado)).rejects.toThrow(
      /ends before it starts/u,
    );
  });

  it("accepts a point acquisition, where the window starts and ends together", async () => {
    const instante = 1_717_200_000_000;
    const selado = await sealManifest(
      comLote({
        acquisitionWindow: { startedAt: instante, endedAt: instante },
      }),
    );
    await expect(parseReviewedSourceManifest(selado)).resolves.toMatchObject({
      materialBatches: [{ acquisitionWindow: { startedAt: instante } }],
    });
  });
});

// ---------------------------------------------------------------------------
// O esquema v2: `materialBatches` obrigatória, e na projeção do digest SEM condição.
//
// As duas metades são a mesma decisão vista de dois lados, e cada uma tem a sua mutação. Opcional,
// um manifesto declararia zero lote e continuaria válido, e nenhum registro v4 teria contra o que
// resolver `groups.sourceMaterialBatch`. Fora da projeção, o inventário nasceria FORJÁVEL —
// acrescentar, remover ou reescrever um lote não mexeria no digest que a evidência publica.
// ---------------------------------------------------------------------------

describe("inventário revisado v2", () => {
  const lote = {
    batchId: "smb_licenciado_2024",
    sourceId: "src_licensed",
    materialVersion: "dump-2024-06-01",
    acquisitionWindow: {
      startedAt: 1_717_200_000_000,
      endedAt: 1_717_286_400_000,
    },
    evidence: ["https://exemplo.invalido/dump-2024-06-01.sha256"],
  };

  function corpoV2(materialBatches: unknown[] = [lote]): ManifestBody {
    return {
      ...validBody,
      schemaVersion: 2,
      materialBatches,
    } as unknown as ManifestBody;
  }

  it("aceita e reproduz um manifesto v2 selado", async () => {
    const manifesto = await sealManifest(corpoV2());
    await expect(parseReviewedSourceManifest(manifesto)).resolves.toEqual(
      manifesto,
    );
  });

  it("recusa um manifesto v2 que não declara a lista", async () => {
    const semLista = corpoV2() as Record<string, unknown>;
    delete semLista.materialBatches;
    // O digest é um valor qualquer de propósito: a recusa é de CHAVE AUSENTE e vem ANTES
    // da conferência do digest, porque o que o v2 elimina é a ausência da declaração —
    // indistinguível de ninguém ter escrito — e não uma divergência de bytes.
    await expect(
      parseReviewedSourceManifest({
        ...semLista,
        sourceManifestDigest: "0".repeat(64),
      }),
    ).rejects.toThrow(/is missing key "materialBatches"/u);
    // E um corpo v2 sem a lista não é nem hasheável: `canonicalJson` RECUSA `undefined`
    // em vez de omitir, então a projeção incondicional não tem forma degenerada.
    await expect(
      computeReviewedSourceManifestDigest(semLista as unknown as ManifestBody),
    ).rejects.toThrow(/"materialBatches" is undefined/u);
  });

  it("recusa a chave presente com valor ausente, e não a lê como zero lote", async () => {
    // A outra metade da ausência, e a que `assertExactObject` NÃO pega: `Object.hasOwn`
    // considera `{materialBatches: undefined}` uma chave declarada, então sem esta recusa o
    // parser traduziria a única forma que o bump v2 existe para tornar inexpressável em "zero
    // lote declarado". JSON em disco não escreve `undefined`; um chamador em memória escreve,
    // e `benchmark/lab/audit_sources.ts` chega ao audit com `JSON.parse` + cast.
    await expect(
      parseReviewedSourceManifest({
        ...corpoV2(),
        materialBatches: undefined,
        sourceManifestDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_MANIFEST_FIELD_INVALID",
      message: expect.stringMatching(
        /materialBatches must be an array: schemaVersion 2 requires the declaration/u,
      ),
    });
    // E a recusa vem ANTES da conferência do digest, como a de chave ausente: o defeito é a
    // declaração e não uma divergência de bytes.
    const selado = await sealManifest(corpoV2([]));
    await expect(
      parseReviewedSourceManifest({ ...selado, materialBatches: undefined }),
    ).rejects.toMatchObject({ code: "SOURCE_MANIFEST_FIELD_INVALID" });
  });

  it("aceita a lista VAZIA, que continua dizendo algo conferível", async () => {
    // Zero lote declarado é uma afirmação: nenhum registro v4 humano resolve contra este
    // manifesto. É a AUSÊNCIA da chave que deixa de ser expressável, não a lista vazia.
    const manifesto = await sealManifest(corpoV2([]));
    await expect(parseReviewedSourceManifest(manifesto)).resolves.toMatchObject(
      { schemaVersion: 2, materialBatches: [] },
    );
  });

  it("cobre a lista vazia com o digest, então acrescentar lote sem re-selar cai", async () => {
    // A metade INCONDICIONAL da decisão. Se a chave só entrasse na projeção "quando existe", o
    // digest de um v2 com lista vazia seria igual ao de um v2 com lote — e o inventário seria
    // forjável exatamente onde ele é obrigatório.
    const selado = await sealManifest(corpoV2([]));
    const forjado = { ...selado, materialBatches: [lote] };
    await expect(parseReviewedSourceManifest(forjado)).rejects.toMatchObject({
      code: "SOURCE_MANIFEST_DIGEST_MISMATCH",
    });
    expect(await computeReviewedSourceManifestDigest(corpoV2([]))).not.toBe(
      await computeReviewedSourceManifestDigest(corpoV2([lote])),
    );
  });

  it("mantém o digest do v1 sem lote distinto do v2 com lista vazia", async () => {
    // O bump de esquema é parte do digest, então o inventário v3 congelado (v1, sem a chave) não
    // pode colidir com um v2 que declara nada.
    expect(await computeReviewedSourceManifestDigest(validBody)).not.toBe(
      await computeReviewedSourceManifestDigest(corpoV2([])),
    );
  });

  it("recusa uma versão fora do par admitido", async () => {
    const selado = await sealManifest(corpoV2());
    await expect(
      parseReviewedSourceManifest({ ...selado, schemaVersion: 3 }),
    ).rejects.toThrow(/schemaVersion must be 1 or 2/u);
  });

  it("mantém a exclusividade de namespace de batchId no v2", async () => {
    const selado = await sealManifest(
      corpoV2([{ ...lote, batchId: "batch_gen" }]),
    );
    await expect(parseReviewedSourceManifest(selado)).rejects.toThrow(
      /duplicate batchId/u,
    );
  });

  it("recusa no v2 um lote órfão, como no v1", async () => {
    const selado = await sealManifest(
      corpoV2([{ ...lote, sourceId: "src_inexistente" }]),
    );
    await expect(parseReviewedSourceManifest(selado)).rejects.toMatchObject({
      code: "SOURCE_MANIFEST_FIELD_INVALID",
    });
  });

  it("entrega as duas metades do namespace ao lado do registro", async () => {
    const manifesto = await parseReviewedSourceManifest(
      await sealManifest(corpoV2()),
    );
    const namespace = batchNamespaceOf(manifesto);
    expect(namespace.material.get("smb_licenciado_2024")).toBe("src_licensed");
    expect(namespace.generation.has("batch_gen")).toBe(true);
    // Só ids opacos atravessam: a entrada do manifesto não sai daqui.
    expect(namespace.material.get("smb_licenciado_2024")).not.toBe(lote);
  });
});
