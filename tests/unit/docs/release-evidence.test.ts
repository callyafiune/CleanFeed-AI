import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { renderReleaseEvidence } from "../../../scripts/render-release-evidence.mjs";

const EVIDENCE_DIGEST =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DISCLOSURE =
  "Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA. Isso não comprova sua origem.";

/** A fully-formed report whose reportDigest agrees with the descriptor. */
function report(overrides: Record<string, unknown> = {}) {
  return {
    reportDigest: EVIDENCE_DIGEST,
    runtimeParityDigest:
      "1111111111111111111111111111111111111111111111111111111111111111",
    metrics: {
      warning: {
        falsePositiveRate: { upper95: 0.04 },
        recall: { lower95: 0.78 },
      },
      action: {
        falsePositiveRate: { upper95: 0.02 },
        recall: { lower95: 0.7 },
      },
      coverage: { value: 0.95 },
    },
    gates: {
      gates: [
        {
          id: "warning-fpr",
          tier: "warning",
          scope: "overall",
          slice: null,
          eligible: true,
          passed: true,
        },
      ],
    },
    ...overrides,
  };
}

function manifest() {
  return {
    scientificEvidenceDigest: EVIDENCE_DIGEST,
    publicationDigest:
      "2222222222222222222222222222222222222222222222222222222222222222",
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    profileId: "ind-80-199",
    lengthBucket: "80-199",
    actionCeiling: "indicator",
    locale: "pt-BR",
    platform: "windows-x64",
    expiresAt: "2026-12-28T00:00:00.000Z",
    gateEvidence: {
      overall: {
        indicatorFpr: { upperBound95: 0.04 },
        indicatorRecall: { lowerBound95: 0.78 },
      },
    },
    ...overrides,
  };
}

function descriptor(
  gateDecision: "pending" | "reject" | "indicator-only" | "pass",
  rolloutState: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
    bundleDigest:
      "2d47d6f3e0a6f2c7836b03c9a47b1b81f6c34159aa35ae1bdffe3507e4dc25bc",
    tokenizerDigest:
      "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135",
    gateDecision,
    rolloutState,
    evidenceDigest: EVIDENCE_DIGEST,
    ...overrides,
  };
}

/** A promoted indicator-only rendering, the common happy input. */
function indicatorOnly() {
  return renderReleaseEvidence({
    release: descriptor("indicator-only", "indicator"),
    report: report(),
    evidenceManifest: manifest(),
    profilesFile: { profiles: [profile()] },
    performanceEvidence: {
      status: "measured",
      report: {
        coldStartMs: 4200,
        warmInferenceP95Ms: 900,
        incrementalMemoryBytes: 123_456,
        inferenceErrorRate: 0.001,
        maximumMainThreadTaskMs: 20,
      },
    },
    probabilisticDisclosure: DISCLOSURE,
  });
}

describe("renderReleaseEvidence — required content", () => {
  const rendered = indicatorOnly();

  it("names the decision, digests, gates, validity and the WASM performance", () => {
    expect(rendered).toContain("Decisão: indicator-only");
    expect(rendered).toContain("UCB95(FPR) de aviso");
    expect(rendered).toContain("Validade dos perfis");
    expect(rendered).toContain("Publication digest");
    expect(rendered).toContain("Runtime parity digest");
    expect(rendered).toContain("Tokenizer digest");
    expect(rendered).toContain("WASM");
    expect(rendered).toContain("Isso não comprova sua origem.");
  });

  it("never leaks corpus, author or per-sample score fields", () => {
    expect(rendered).not.toMatch(
      /postText|authorName|profileUrl|calibratedScore|aiScore/u,
    );
  });
});

describe("renderReleaseEvidence — per-decision copy", () => {
  it("reject states the fallback and renders performance as N/A", () => {
    const rendered = renderReleaseEvidence({
      release: descriptor("reject", "bundle-verified"),
      report: report(),
      evidenceManifest: manifest(),
      profilesFile: { profiles: [] },
      performanceEvidence: { status: "not-applicable" },
      probabilisticDisclosure: DISCLOSURE,
    });
    expect(rendered).toContain("TMR não empacotado; fallback estilométrico ativo");
    expect(rendered).toContain(
      "Não aplicável: candidato rejeitado e ausente do pacote",
    );
  });

  it("indicator-only disables visual actions", () => {
    expect(indicatorOnly()).toContain("Ações visuais desabilitadas");
  });

  it("pass limits actions to the profile/preference and keeps 50-79 indicator", () => {
    const rendered = renderReleaseEvidence({
      release: descriptor("pass", "actions"),
      report: report(),
      evidenceManifest: manifest(),
      profilesFile: {
        profiles: [
          profile({ profileId: "pass-50-79", lengthBucket: "50-79" }),
          profile({ profileId: "pass-80-199", lengthBucket: "80-199" }),
        ],
      },
      performanceEvidence: {
        status: "measured",
        report: {
          coldStartMs: 4200,
          warmInferenceP95Ms: 900,
          incrementalMemoryBytes: 123_456,
          inferenceErrorRate: 0.001,
          maximumMainThreadTaskMs: 20,
        },
      },
      probabilisticDisclosure: DISCLOSURE,
    });
    expect(rendered).toContain("Ações limitadas ao perfil e à preferência");
    expect(rendered).toContain("50–79: somente indicador");
  });
});

describe("renderReleaseEvidence — fail closed", () => {
  it("throws on a pending descriptor (no sealed decision to render)", () => {
    expect(() =>
      renderReleaseEvidence({
        release: descriptor("pending", "bundle-verified", {
          evidenceDigest: null,
        }),
        report: report(),
        evidenceManifest: manifest(),
        profilesFile: { profiles: [] },
        performanceEvidence: { status: "not-applicable" },
        probabilisticDisclosure: DISCLOSURE,
      }),
    ).toThrow("RELEASE_EVIDENCE_PENDING");
  });

  it("throws when the scientific evidence digests disagree", () => {
    expect(() =>
      renderReleaseEvidence({
        release: descriptor("indicator-only", "indicator"),
        report: report({ reportDigest: "deadbeef" }),
        evidenceManifest: manifest(),
        profilesFile: { profiles: [profile()] },
        performanceEvidence: { status: "not-applicable" },
        probabilisticDisclosure: DISCLOSURE,
      }),
    ).toThrow("EVIDENCE_DIGEST_MISMATCH");
  });
});

describe("docs/releases/tmr-ptbr-v1.md — the committed evidence surface is honest", () => {
  it("states the pending, no-decision state without any accuracy claim", async () => {
    const doc = await readFile("docs/releases/tmr-ptbr-v1.md", "utf8");
    const lower = doc.toLocaleLowerCase("pt-BR");
    expect(lower).toContain("pending");
    expect(lower).toContain("fallback estilométrico");
    // The deferred real-data operator steps are stated explicitly.
    expect(lower).toContain("holdout");
    expect(doc).toContain("Isso não comprova sua origem.");
    // No un-earned accuracy/quality claim while pending.
    expect(lower).not.toMatch(/acur[áa]cia de \d|precis[ãa]o de \d|\bf1\b/u);
    // The generator is named so the surface is reproducible once decided.
    expect(doc).toContain("npm run release:evidence");
  });
});
