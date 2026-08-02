import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runPublishEvidence } from "../commands/publish-evidence.ts";
import { runPublishProfile } from "../commands/publish-profile.ts";
import { runVerifyEvidence } from "../commands/verify-evidence.ts";
import { runVerifyPublishedEvidence } from "../commands/verify-published-evidence.ts";
import {
  assertSanitized,
  buildEvidenceBundle,
  canonicalJson,
  EVIDENCE_FILE_NAMES,
  EvidenceSanitizerError,
  FORBIDDEN_RECORD_KEYS,
  INVENTORY_FILE_NAMES,
  type EvidenceBundle,
} from "../evidence-sanitizer.ts";
import { sha256BytesHex } from "../digests.ts";
import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import { withoutSplitDigest } from "../split-artifact.ts";
import type { SplitArtifact } from "../split-artifact.ts";
import { bundleInputFor, buildRejectScenario } from "./evidence.fixtures.ts";
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import type { ReleaseDecision } from "../gates.ts";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  created.length = 0;
});

async function newRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  created.push(root);
  return root;
}

// Writes a built bundle (the seven evidence files) plus the two model-metadata
// files, so the verifier can be run against a clean-clone-shaped directory.
async function writeBundleToDisk(
  bundle: EvidenceBundle,
  release: unknown,
  profiles: unknown,
): Promise<{ evidenceDir: string; modelDir: string }> {
  const root = await newRoot("cf-evidence-verify-");
  const evidenceDir = join(root, "evidence", "tmr-ptbr-v1");
  const modelDir = join(root, "models", "cleanfeed-ptbr-v1");
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  for (const file of bundle.files) {
    await writeFile(join(evidenceDir, file.name), file.content, "utf8");
  }
  await writeFile(
    join(modelDir, "release.json"),
    `${JSON.stringify(release, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(modelDir, "calibration-profiles.json"),
    `${JSON.stringify(profiles, null, 2)}\n`,
    "utf8",
  );
  return { evidenceDir, modelDir };
}

// ---------------------------------------------------------------------------
// The privacy allowlist has teeth.
// ---------------------------------------------------------------------------

describe("assertSanitized privacy allowlist", () => {
  it("preserves the safe aggregate predictionManifestDigests field", () => {
    expect(() =>
      assertSanitized({
        predictionManifestDigests: {
          development: "1".repeat(64),
          calibration: "2".repeat(64),
          test: "3".repeat(64),
        },
      }),
    ).not.toThrow();
  });

  it("rejects each forbidden record-level key exactly", () => {
    for (const key of FORBIDDEN_RECORD_KEYS) {
      expect(() => assertSanitized({ [key]: "x" })).toThrow(
        EvidenceSanitizerError,
      );
    }
  });

  it("rejects a prediction-rows payload", () => {
    expect(() =>
      assertSanitized({
        predictionRows: [{ id: "r1", documentRawScore: 0.4 }],
      }),
    ).toThrow(/predictionRows/u);
  });

  it("rejects a shard/raw path anywhere in the tree", () => {
    expect(() =>
      assertSanitized({ nested: { manifest: "shard-000.jsonl" } }),
    ).toThrow(EvidenceSanitizerError);
    expect(() =>
      assertSanitized({
        path: "benchmark/data/ptbr-generic-v1/records.jsonl",
      }),
    ).toThrow(EvidenceSanitizerError);
    expect(() =>
      assertSanitized({ p: "benchmark/out/ptbr-v1/private/test-labels.jsonl" }),
    ).toThrow(EvidenceSanitizerError);
  });

  it("rejects a disguised record-id array of at least 100 scalar ids", () => {
    const ids = Array.from({ length: 100 }, (_unused, index) => `r${index}`);
    expect(() => assertSanitized({ cohort: ids })).toThrow(
      EvidenceSanitizerError,
    );
    // 99 scalar ids is under the closed threshold and is allowed.
    expect(() => assertSanitized({ cohort: ids.slice(0, 99) })).not.toThrow();
  });

  it("allows short digest arrays (e.g. profileDigests)", () => {
    expect(() =>
      assertSanitized({
        profileDigests: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildEvidenceBundle: closed seven-file set + cross-checked evidence digest.
// ---------------------------------------------------------------------------

describe("buildEvidenceBundle", () => {
  it("emits exactly the seven allowlisted files", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    expect(bundle.files.map((file) => file.name)).toEqual([
      ...EVIDENCE_FILE_NAMES,
    ]);
  });

  it("cross-checks scientific, calibration-set and publication digests", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    const digest = bundle.evidenceDigest;

    // scientificEvidenceDigest == release.evidenceDigest == report.reportDigest.
    expect(digest.scientificEvidenceDigest).toBe(input.report.reportDigest);
    expect(digest.scientificEvidenceDigest).toBe(input.release.evidenceDigest);

    // calibrationSetDigest mirrors the release descriptor.
    expect(digest.calibrationSetDigest).toBe(
      input.release.calibrationSetDigest,
    );

    // The inventory lists exactly the other six files, sorted, with true hashes.
    expect(digest.files.map((entry) => entry.file)).toEqual(
      [...INVENTORY_FILE_NAMES].sort(),
    );
    const byName = new Map<string, string>(
      bundle.files.map((file) => [file.name, file.content]),
    );
    for (const entry of digest.files) {
      const content = byName.get(entry.file);
      expect(content).toBeDefined();
      const observed = sha256BytesHex(
        new TextEncoder().encode(content as string),
      );
      expect(observed).toBe(entry.sha256);
    }

    // publicationDigest == sha256(canonicalJson({schemaVersion: 1, files})).
    const expected = sha256BytesHex(
      new TextEncoder().encode(
        canonicalJson({ schemaVersion: 1, files: digest.files }),
      ),
    );
    expect(digest.publicationDigest).toBe(expected);

    // The manifest never hashes itself.
    expect(digest.files.map((entry) => entry.file)).not.toContain(
      "evidence-digest.json",
    );
  });

  it("refuses to build when the release evidence digest diverges from the report", async () => {
    const { input } = await bundleInputFor("pass");
    const tampered = {
      ...input,
      release: { ...input.release, evidenceDigest: "f".repeat(64) },
    };
    await expect(buildEvidenceBundle(tampered)).rejects.toThrow(
      EvidenceSanitizerError,
    );
  });

  const decisionMap: Array<{
    decision: ReleaseDecision;
    gateDecision: string;
    rolloutState: string;
    profiles: "empty" | "present";
  }> = [
    {
      decision: "pass",
      gateDecision: "pass",
      rolloutState: "indicator",
      profiles: "present",
    },
    {
      decision: "indicator-only",
      gateDecision: "indicator-only",
      rolloutState: "indicator",
      profiles: "present",
    },
    {
      decision: "reject",
      gateDecision: "reject",
      rolloutState: "bundle-verified",
      profiles: "empty",
    },
  ];

  for (const mapping of decisionMap) {
    it(`maps the ${mapping.decision} decision into decision.json`, async () => {
      const { input } = await bundleInputFor(mapping.decision);
      const bundle = await buildEvidenceBundle(input);
      const decisionFile = bundle.files.find(
        (file) => file.name === "decision.json",
      );
      expect(decisionFile).toBeDefined();
      const decision = JSON.parse(
        (decisionFile as { content: string }).content,
      );
      expect(decision.releaseDecision).toBe(mapping.decision);
      expect(decision.gateDecision).toBe(mapping.gateDecision);
      expect(decision.rolloutState).toBe(mapping.rolloutState);
      if (mapping.profiles === "empty") {
        expect(decision.profileDigests).toEqual([]);
      } else {
        expect(decision.profileDigests.length).toBeGreaterThan(0);
      }
    });
  }

  it("keeps the safe predictionManifestDigests in the fit summary", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    const fit = JSON.parse(
      (
        bundle.files.find((f) => f.name === "fit-summary.json") as {
          content: string;
        }
      ).content,
    );
    expect(fit.predictionManifestDigests).toEqual(
      input.frozenCalibration.predictionManifestDigests,
    );
  });

  // A7: this is the only place a frozen artifact's threshold evidence is EMITTED
  // into a public file, so it is where the legacy decision has teeth. A pre-A7
  // artifact is still readable — its bytes and its artifactDigest are never
  // touched — but the name that read as a 95% guarantee is never published again.
  it("publishes a pre-A7 fit's FPR bound under its A7 name, marked legacy", async () => {
    const { input } = await bundleInputFor("pass");
    const legacyInput = {
      ...input,
      frozenCalibration: {
        ...input.frozenCalibration,
        thresholdEvidence: {
          warning: {
            documentThreshold: 0.7,
            localizedThreshold: 0.65,
            negatives: 2_000,
            falsePositives: 40,
            fprUpper95: 0.03,
            positives: 2_000,
            truePositives: 1_600,
            recall: 0.8,
          } as unknown as FrozenCalibrationArtifact["thresholdEvidence"]["warning"],
          visual: null,
        },
      },
    };
    const bundle = await buildEvidenceBundle(legacyInput);
    const fit = JSON.parse(
      (
        bundle.files.find((f) => f.name === "fit-summary.json") as {
          content: string;
        }
      ).content,
    );
    expect(fit.thresholdEvidence.warning).not.toHaveProperty("fprUpper95");
    expect(fit.thresholdEvidence.warning.selectionFprUpper95Nominal).toBe(0.03);
    expect(fit.thresholdEvidence.warning.certifiedFprUpper).toBeNull();
    expect(fit.thresholdEvidence.warning.fprBound.vintage).toBe(
      "legacy-pre-a7",
    );
    // The artifact we were handed is unchanged, so its own digest still checks.
    expect(
      legacyInput.frozenCalibration.thresholdEvidence.warning,
    ).toHaveProperty("fprUpper95");
  });
});

// ---------------------------------------------------------------------------
// verify-published-evidence on a clean-clone shaped directory.
// ---------------------------------------------------------------------------

describe("verifyPublishedEvidence on a clean clone", () => {
  for (const decision of ["pass", "indicator-only", "reject"] as const) {
    it(`accepts a faithful ${decision} publication`, async () => {
      const fixture = await bundleInputFor(decision);
      const bundle = await buildEvidenceBundle(fixture.input);
      const { evidenceDir, modelDir } = await writeBundleToDisk(
        bundle,
        fixture.release,
        fixture.profiles,
      );
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: evidenceDir,
          modelDirectory: modelDir,
        }),
      ).resolves.toContain(decision);
    });
  }

  it("accepts the monotonic pass/indicator -> pass/actions transition without rewriting evidence", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    // Phase 4 promotes the live release to actions; the evidence is untouched.
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify({ ...fixture.release, rolloutState: "actions" }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).resolves.toContain("pass");
  });

  it("rejects altered evidence (a mutated content byte)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    const target = join(evidenceDir, "dataset-summary.json");
    const original = await readFile(target, "utf8");
    await writeFile(target, original.replace("10000", "9999"), "utf8");
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_FILE_ALTERED" });
  });

  it("rejects missing evidence (a deleted file)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await rm(join(evidenceDir, "fit-summary.json"));
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_MISSING_FILE" });
  });

  it("rejects extra evidence (an unexpected file)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await writeFile(join(evidenceDir, "extra.json"), "{}\n", "utf8");
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_EXTRA_FILE" });
  });

  it("rejects a stale model release whose evidence digest no longer matches", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify({ ...fixture.release, evidenceDigest: "e".repeat(64) }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toMatchObject({ code: "PUBLISHED_EVIDENCE_MISMATCH" });
  });

  it("rejects a profiles file holding fewer profiles than the release declares", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    // Um perfil A MENOS no arquivo, sem tocar em `profileDigests`: a lista continua igual a
    // publicada, entao a guarda de conjunto passa e so a CONTAGEM diverge. Sintetizar um perfil
    // seria o contrario — fabricar artefato cientifico dentro do teste.
    await writeFile(
      join(modelDir, "calibration-profiles.json"),
      `${JSON.stringify({ schemaVersion: 1, profiles: [] }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_COUNT_MISMATCH" });
  });
});

// ---------------------------------------------------------------------------
// publish-evidence end-to-end on a self-consistent reject run.
// ---------------------------------------------------------------------------

describe("publish-evidence end-to-end (reject run)", () => {
  async function scenario() {
    const root = await newRoot("cf-publish-evidence-");
    return buildRejectScenario(root, runPublishProfile);
  }

  function publishOptions(s: Awaited<ReturnType<typeof scenario>>) {
    return {
      sourceReadinessPath: s.sourceReadinessPath,
      datasetAuditPath: s.datasetAuditPath,
      splitArtifactPath: s.splitArtifactPath,
      frozenCalibrationPath: s.frozenCalibrationPath,
      fitReportPath: s.fitReportPath,
      reportPath: s.reportPath,
      ledgerPath: s.ledgerPath,
      consumptionId: s.consumptionId,
      modelDirectory: s.modelDir,
      outputDirectory: s.outputDir,
    };
  }

  it("writes only the seven allowlisted files, all free of forbidden keys, and re-verifies clean", async () => {
    const s = await scenario();
    await runPublishEvidence(publishOptions(s));

    const { readdir } = await import("node:fs/promises");
    const written = (await readdir(s.outputDir)).sort();
    expect(written).toEqual([...EVIDENCE_FILE_NAMES].sort());

    // No forbidden record-level key appears anywhere in the evidence directory.
    const forbidden = new RegExp(
      `"(${FORBIDDEN_RECORD_KEYS.join("|")})"\\s*:`,
      "u",
    );
    for (const name of written) {
      const body = await readFile(join(s.outputDir, name), "utf8");
      expect(forbidden.test(body)).toBe(false);
    }

    // decision.json reflects the reject mapping.
    const decision = JSON.parse(
      await readFile(join(s.outputDir, "decision.json"), "utf8"),
    );
    expect(decision.releaseDecision).toBe("reject");
    expect(decision.gateDecision).toBe("reject");
    expect(decision.rolloutState).toBe("bundle-verified");
    expect(decision.profileDigests).toEqual([]);

    // The published evidence re-verifies against the model metadata alone.
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: s.outputDir,
        modelDirectory: s.modelDir,
      }),
    ).resolves.toContain("reject");
  });

  it("refuses an unfinished ledger", async () => {
    const s = await scenario();
    // Truncate the ledger to the non-terminal `started` event only.
    const lines = (await readFile(s.ledgerPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    await writeFile(s.ledgerPath, `${lines[0]}\n`, "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "HOLDOUT_SESSION_UNFINISHED",
    });
  });

  it("refuses a report digest that the ledger does not attest", async () => {
    const s = await scenario();
    const lines = (await readFile(s.ledgerPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    const completed = JSON.parse(lines[1]);
    completed.reportDigest = "0".repeat(64);
    await writeFile(
      s.ledgerPath,
      `${lines[0]}\n${JSON.stringify(completed)}\n`,
      "utf8",
    );
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "HOLDOUT_REPORT_DIGEST_MISMATCH",
    });
  });

  it("refuses an unapproved model license", async () => {
    const s = await scenario();
    await writeFile(
      join(s.modelDir, "license-review.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          modelId: "cleanfeed-ptbr-v1",
          status: "pending",
          declaredLicense: "MIT",
          reviewedAt: null,
          reviewer: null,
          evidence: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "MODEL_LICENSE_NOT_APPROVED",
    });
  });

  it("refuses a missing report", async () => {
    const s = await scenario();
    await expect(
      runPublishEvidence({
        ...publishOptions(s),
        reportPath: join(s.root, "out", "does-not-exist.json"),
      }),
    ).rejects.toMatchObject({ code: "FILE_MISSING" });
  });

  it("refuses a consumption id the ledger never saw", async () => {
    const s = await scenario();
    await expect(
      runPublishEvidence({
        ...publishOptions(s),
        consumptionId: "consumo-que-nao-existe",
      }),
    ).rejects.toMatchObject({ code: "HOLDOUT_SESSION_UNKNOWN" });
  });

  it("refuses a ledger line that is not valid JSON", async () => {
    const s = await scenario();
    const raw = await readFile(s.ledgerPath, "utf8");
    await writeFile(s.ledgerPath, `${raw}isto nao e json\n`, "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "HOLDOUT_LEDGER_CORRUPT",
    });
  });

  it("refuses to publish into a directory holding a non-allowlisted file", async () => {
    const s = await scenario();
    await mkdir(s.outputDir, { recursive: true });
    await writeFile(join(s.outputDir, "sobra.json"), "{}\n", "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "EVIDENCE_OUTPUT_DIRTY",
    });
  });

  it("refuses a release artifact carrying no composition attestation", async () => {
    const s = await scenario();
    // O `splitDigest` cobre a projecao do artefato, entao anular o atestado sem re-selar
    // pararia na auto-consistencia — que e outra guarda. A forja tem de ser COMPETENTE para
    // que o teste prove a guarda do atestado e nao a vizinha.
    const artifact = JSON.parse(
      await readFile(s.splitArtifactPath, "utf8"),
    ) as SplitArtifact;
    artifact.compositionAttestation = null;
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    await writeFile(s.splitArtifactPath, JSON.stringify(artifact), "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISSING",
    });
  });

  it("refuses a report whose datasetDigest disagrees with the frozen calibration", async () => {
    const s = await scenario();
    // A divergencia e injetada no RELATORIO, nao no artefato congelado: o congelado carrega
    // `artifactDigest` proprio, e `validateFrozenCalibrationArtifact` recusa antes com
    // `CalibrationPipelineError` — outra guarda. Re-selar o congelado nao esta disponivel aqui
    // porque `artifactWithoutDigest` nao e exportado.
    //
    // Pelo relatorio o alcance existe porque a comparacao de digests roda ANTES da conferencia
    // do ledger, que so entao notaria que o digest do relatorio deixou de ser o atestado.
    const report = JSON.parse(await readFile(s.reportPath, "utf8")) as {
      dataset: { digest: string };
    };
    report.dataset.digest = "d".repeat(64);
    await writeFile(s.reportPath, JSON.stringify(report), "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toMatchObject({
      code: "EVIDENCE_DIGEST_MISMATCH",
    });
  });

  describe("and the published bundle re-verifies only while intact", () => {
    async function publicado() {
      const s = await scenario();
      await runPublishEvidence(publishOptions(s));
      return s;
    }

    it("refuses an evidence directory that does not exist", async () => {
      const s = await publicado();
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: join(s.root, "diretorio-que-nao-existe"),
          modelDirectory: s.modelDir,
        }),
      ).rejects.toMatchObject({ code: "EVIDENCE_DIR_MISSING" });
    });

    it("refuses an inventory that does not name exactly the other six files", async () => {
      const s = await publicado();
      // A conferencia dos NOMES do inventario vem antes da dos digests, entao soltar uma
      // entrada alcanca esta guarda em vez de parar na de arquivo alterado.
      const caminho = join(s.outputDir, "evidence-digest.json");
      const inventario = JSON.parse(await readFile(caminho, "utf8")) as {
        files: { file: string; sha256: string }[];
      };
      inventario.files = inventario.files.slice(1);
      await writeFile(caminho, JSON.stringify(inventario), "utf8");
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: s.outputDir,
          modelDirectory: s.modelDir,
        }),
      ).rejects.toMatchObject({ code: "EVIDENCE_INVENTORY_INVALID" });
    });

    it("refuses a profileDigests list the calibrationSetDigest does not cover", async () => {
      const s = await publicado();
      // O contrato do descritor amarra `calibrationSetDigest` ao digest canonico de
      // `profileDigests`, entao mexer na lista e recusado uma camada ANTES do verificador.
      // Por isso o `PROFILE_DIGESTS_MISMATCH` do verificador nao e alcancavel por esta forja:
      // para passar pelo contrato a lista teria de ter o digest que o proprio verificador ja
      // comparou antes, e digest igual com lista diferente e o que nao existe.
      const caminho = join(s.modelDir, "release.json");
      const release = JSON.parse(await readFile(caminho, "utf8")) as Record<
        string,
        unknown
      >;
      release.profileDigests = ["a".repeat(64)];
      await writeFile(caminho, JSON.stringify(release), "utf8");
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: s.outputDir,
          modelDirectory: s.modelDir,
        }),
      ).rejects.toMatchObject({ code: "RELEASE_DIGEST_MISMATCH" });
    });

    it("refuses a rollout state the gate decision does not allow", async () => {
      const s = await publicado();
      // `shadow` e o unico estado que o contrato do descritor deixa SEM regra estrutural,
      // porque roda so em desenvolvimento e nao autoriza apresentacao. Logo ele passa pelo
      // contrato e chega a esta guarda, que e a camada onde um release shadow deixa de poder
      // se apresentar como evidencia verificada. `actions` nao serviria: o contrato o recusa
      // antes, e o teste provaria o contrato em vez do verificador.
      const caminho = join(s.modelDir, "release.json");
      const release = JSON.parse(await readFile(caminho, "utf8")) as Record<
        string,
        unknown
      >;
      release.rolloutState = "shadow";
      await writeFile(caminho, JSON.stringify(release), "utf8");
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: s.outputDir,
          modelDirectory: s.modelDir,
        }),
      ).rejects.toMatchObject({ code: "ROLLOUT_STATE_INVALID" });
    });
  });
});

// ---------------------------------------------------------------------------
// `verify-evidence`: as seis recusas do comando que confere a evidência ANTES da publicação.
//
// A auditoria por mutação mediu 0 de 6 exercitadas. O fecho daquele módulo tem só três suítes, e
// nenhuma o dirigia: a `cli` o alcança na validação de bandeiras e para ali.
//
// A ORDEM interna dita cada forja, e é o que separa provar a guarda de provar a vizinha: o ramo da
// decisão vem primeiro (reject de um lado, o resto do outro), depois o digest da evidência, e só
// então a igualdade de gateDecision. Mexer em `profileDigests` está fora de questão em todas elas —
// o contrato do descritor amarra `calibrationSetDigest` à lista, e a recusa viria de lá.
// ---------------------------------------------------------------------------

describe("verify-evidence", () => {
  async function mundo(decision: ReleaseDecision): Promise<{
    opcoes: {
      reportPath: string;
      frozenCalibrationPath: string;
      modelDirectory: string;
    };
    release: Record<string, unknown>;
    profiles: unknown;
    modelDir: string;
  }> {
    const fixture = await bundleInputFor(decision);
    const root = await newRoot("cf-verify-evidence-");
    const modelDir = join(root, "models", "cleanfeed-ptbr-v1");
    await mkdir(modelDir, { recursive: true });
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify(fixture.release, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(modelDir, "calibration-profiles.json"),
      `${JSON.stringify(fixture.profiles, null, 2)}\n`,
      "utf8",
    );
    const reportPath = join(root, "report.json");
    await writeFile(
      reportPath,
      `${JSON.stringify(fixture.input.report, null, 2)}\n`,
      "utf8",
    );
    // O artefato congelado do fixture carrega `artifactDigest` de fachada: o caminho do
    // pacote de evidencia nunca o valida, e `runVerifyEvidence` e o primeiro consumidor que
    // valida. Ele e RE-SELADO aqui — sem isso as sete recusas abaixo viriam todas do
    // auto-digest, e o teste provaria a validacao do congelado em vez das guardas deste
    // comando.
    const frozenCalibrationPath = join(root, "frozen-calibration.json");
    const baseCongelada = {
      ...(fixture.input.frozenCalibration as unknown as Record<
        string,
        unknown
      >),
    };
    delete baseCongelada.artifactDigest;
    await writeFile(
      frozenCalibrationPath,
      `${JSON.stringify({ ...baseCongelada, artifactDigest: await canonicalSha256(baseCongelada) }, null, 2)}\n`,
      "utf8",
    );
    return {
      opcoes: { reportPath, frozenCalibrationPath, modelDirectory: modelDir },
      release: fixture.release as unknown as Record<string, unknown>,
      profiles: fixture.profiles,
      modelDir,
    };
  }

  async function reescreveRelease(
    modelDir: string,
    release: Record<string, unknown>,
    campos: Record<string, unknown>,
  ): Promise<void> {
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify({ ...release, ...campos }, null, 2)}\n`,
      "utf8",
    );
  }

  it("accepts a coherent reject world, which is what makes the refusals below mean anything", async () => {
    const { opcoes } = await mundo("reject");
    await expect(runVerifyEvidence(opcoes)).resolves.toContain(
      "Evidence verified",
    );
  });

  it("refuses a reject release whose rollout state is not bundle-verified", async () => {
    // `shadow` é o único estado que o contrato do descritor deixa sem regra estrutural, então
    // passa por ele e chega aqui. `actions` seria recusado antes, pelo contrato.
    const { opcoes, release, modelDir } = await mundo("reject");
    await reescreveRelease(modelDir, release, { rolloutState: "shadow" });
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "REJECT_STATE_INVALID",
    });
  });

  it("refuses a promoted release with no profile at all", async () => {
    const { opcoes, modelDir } = await mundo("indicator-only");
    await writeFile(
      join(modelDir, "calibration-profiles.json"),
      `${JSON.stringify({ schemaVersion: 1, profiles: [] }, null, 2)}\n`,
      "utf8",
    );
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "PROFILES_MISSING",
    });
  });

  it("refuses an indicator-only release outside the indicator rollout state", async () => {
    const { opcoes, release, modelDir } = await mundo("indicator-only");
    await reescreveRelease(modelDir, release, { rolloutState: "shadow" });
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "INDICATOR_STATE_INVALID",
    });
  });

  it("refuses a pass release outside indicator or actions", async () => {
    // O par pass/indicator é o início da vida científica e pass/actions a promoção monotônica da
    // Fase 4; qualquer outro estado é release que se apresenta sem ter sido promovido.
    const { opcoes, release, modelDir } = await mundo("pass");
    await reescreveRelease(modelDir, release, { rolloutState: "shadow" });
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "PASS_STATE_INVALID",
    });
  });

  it("refuses a release whose evidenceDigest is not the report digest", async () => {
    const { opcoes, release, modelDir } = await mundo("reject");
    await reescreveRelease(modelDir, release, {
      evidenceDigest: "f".repeat(64),
    });
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "EVIDENCE_DIGEST_MISMATCH",
    });
  });

  it("refuses a release whose gateDecision is not the report decision", async () => {
    // Precisa de um relatório NÃO-reject: para um reject o ramo anterior já exigiria
    // `gateDecision === "reject"` e a recusa viria dele. Aqui o descritor declara `pass` com
    // rollout `indicator`, que o contrato aceita, e o relatório diz `indicator-only`.
    const { opcoes, release, modelDir } = await mundo("indicator-only");
    await reescreveRelease(modelDir, release, { gateDecision: "pass" });
    await expect(runVerifyEvidence(opcoes)).rejects.toMatchObject({
      code: "GATE_DECISION_MISMATCH",
    });
  });
});
