// As AMARRAS DE DIGEST E ESTADO dos contratos selados.
//
// A auditoria por mutação mediu `contracts/` com UMA guarda exercitada em quatro módulos: 0 de 15 em
// `calibration-profile.ts`, 1 de 4 em `model-release.ts`, 0 de 3 em `runtime-parity.ts` e 0 de 4 em
// `source-readiness.ts`. A razão é estrutural — as suítes atravessam esses parsers a cada teste,
// sempre pelo caminho VÁLIDO. Parsear artefato bom prova que o parser aceita; não prova recusa
// alguma.
//
// Este arquivo cobre primeiro as quatro amarras de DIGEST e ESTADO, porque amarra de digest sem
// teste é portão forjável: quem edita o artefato e reescreve o digest declarado passa, e é
// exatamente o defeito que o atestado de composição do E2 fechou do outro lado.
//
// Cada forja parte de um artefato VÁLIDO do fixture e altera uma coisa só. Sem isso a recusa pode
// vir de qualquer campo malformado, e o teste provaria o validador de forma em vez da amarra.

import { describe, expect, it } from "vitest";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import {
  computeRuntimeParityDigest,
  parseRuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import {
  computeSourceReadinessDigest,
  parseCorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import { bundleInputFor } from "./evidence.fixtures.ts";

describe("contratos selados — amarras de digest e estado", () => {
  it("refuses a profile whose declared profileDigest is not its content", async () => {
    const { profiles } = await bundleInputFor("pass");
    const arquivo = profiles as unknown as {
      schemaVersion: number;
      profiles: { profileDigest: string }[];
    };
    expect(arquivo.profiles.length).toBeGreaterThan(0);

    const forjado = {
      ...arquivo,
      profiles: [
        { ...arquivo.profiles[0], profileDigest: "a".repeat(64) },
        ...arquivo.profiles.slice(1),
      ],
    };
    await expect(parseCalibrationProfilesFileV1(forjado)).rejects.toMatchObject(
      { code: "PROFILE_DIGEST_MISMATCH" },
    );
  });

  it("refuses an actions rollout on a reject gate", async () => {
    // O par gate/rollout é monotônico: um reject fica em `bundle-verified`, e `actions` é a
    // ativação de Fase 4 de um pass. Esta é a guarda em que eu CONFIEI ao escrever os testes de
    // verify-evidence — foi por ela que escolhi `shadow`, que o contrato deixa sem regra — e ela
    // não tinha teste nenhum prendendo o funcionamento.
    const { release } = await bundleInputFor("reject");
    await expect(
      parseModelReleaseDescriptorV1({
        ...(release as unknown as Record<string, unknown>),
        rolloutState: "actions",
      }),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("refuses a runtime parity manifest that does not hash to its digest", async () => {
    const base = {
      schemaVersion: 1 as const,
      modelId: "cleanfeed-ptbr-v1",
      modelVersion: "1.0.0",
      bundleDigest: "1".repeat(64),
      aggregationVersion: "tmr-aggregation-v3",
      contentCompositionVersion: "lexical-content-v2",
      tokenizerDigest: "2".repeat(64),
      inferenceCoreDigest: "3".repeat(64),
    };
    // O coerente passa: sem este par, a recusa abaixo poderia vir de qualquer campo e não da
    // amarra do digest.
    const coerente = {
      ...base,
      runtimeParityDigest: await computeRuntimeParityDigest(base),
    };
    await expect(parseRuntimeParityManifestV1(coerente)).resolves.toMatchObject(
      { schemaVersion: 1 },
    );

    await expect(
      parseRuntimeParityManifestV1({
        ...base,
        runtimeParityDigest: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_PARITY_DIGEST_MISMATCH" });
  });

  it("refuses a source readiness report that does not hash to its digest", async () => {
    const { input } = await bundleInputFor("pass");
    const bruto = input.sourceReadiness as unknown as Record<string, unknown>;
    // O relatório do fixture carrega `reportDigest` de FACHADA — o controle positivo abaixo é o
    // que revelou isso, ao recusar o artefato que devia ser válido. Então ele é re-selado aqui, e
    // sem esse cuidado o teste passaria pelo motivo errado: o código da recusa é o MESMO nos dois
    // casos, então "fixture inválido" e "guarda funcionando" seriam indistinguíveis.
    const corpo = { ...bruto };
    delete corpo.reportDigest;
    const relatorio = {
      ...corpo,
      reportDigest: await computeSourceReadinessDigest(corpo as never),
    };
    // O válido passa primeiro, pelo mesmo motivo do par acima.
    await expect(
      parseCorpusSourceReadinessReport(relatorio),
    ).resolves.toMatchObject({ status: "ready" });

    await expect(
      parseCorpusSourceReadinessReport({
        ...relatorio,
        reportDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_DIGEST_MISMATCH" });
  });
});

// ---------------------------------------------------------------------------
// As guardas de FORMA e de POLÍTICA do parser de perfis.
//
// Menor consequência que as amarras de digest acima — validação de forma, não portão forjável —,
// mas nenhuma tinha teste. Cada caso muta UM campo de um perfil válido: mudar dois deixaria
// ambíguo qual guarda recusou, e as validações de campo rodam ANTES da conferência de digest, então
// nenhuma delas cai no `PROFILE_DIGEST_MISMATCH` por acidente.
// ---------------------------------------------------------------------------

describe("parser de perfis — forma e política", () => {
  async function perfilValido(): Promise<Record<string, unknown>> {
    const { profiles } = await bundleInputFor("pass");
    const arquivo = profiles as unknown as {
      profiles: Record<string, unknown>[];
    };
    expect(arquivo.profiles.length).toBeGreaterThan(0);
    return arquivo.profiles[0];
  }

  async function recusa(
    perfil: Record<string, unknown>,
    codigo: string,
  ): Promise<void> {
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: [perfil] }),
    ).rejects.toMatchObject({ code: codigo });
  }

  it("accepts the untouched profile, so every refusal below is the mutation", async () => {
    await expect(
      parseCalibrationProfilesFileV1({
        schemaVersion: 1,
        profiles: [await perfilValido()],
      }),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("refuses a file whose shape is not exactly {schemaVersion, profiles}", async () => {
    const perfil = await perfilValido();
    await expect(
      parseCalibrationProfilesFileV1({
        schemaVersion: 1,
        profiles: [perfil],
        extra: 1,
      }),
    ).rejects.toMatchObject({ code: "CALIBRATION_SCHEMA_INVALID" });
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 2, profiles: [perfil] }),
    ).rejects.toMatchObject({ code: "CALIBRATION_SCHEMA_INVALID" });
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: {} }),
    ).rejects.toMatchObject({ code: "CALIBRATION_SCHEMA_INVALID" });
  });

  it("refuses a profile carrying a key the schema does not name", async () => {
    await recusa(
      { ...(await perfilValido()), extra: 1 },
      "PROFILE_SCHEMA_INVALID",
    );
  });

  it("refuses a locale that is not pt-BR", async () => {
    // O perfil é por locale: aceitar outro publicaria limiar calibrado em português como se
    // valesse para outra língua.
    await recusa(
      { ...(await perfilValido()), locale: "en-US" },
      "PROFILE_FIELD_INVALID",
    );
  });

  it("refuses a validity window that is not exactly 180 days", async () => {
    const perfil = await perfilValido();
    const emitido = Date.parse(perfil.issuedAt as string);
    await recusa(
      {
        ...perfil,
        expiresAt: new Date(emitido + 179 * 24 * 60 * 60 * 1000).toISOString(),
      },
      "PROFILE_EXPIRY_INVALID",
    );
  });

  it("refuses a calibrator of an unknown kind", async () => {
    const perfil = await perfilValido();
    const calibradores = perfil.calibrators as Record<string, unknown>;
    await recusa(
      {
        ...perfil,
        calibrators: { ...calibradores, document: { kind: "chute" } },
      },
      "CALIBRATOR_INVALID",
    );
  });

  it("refuses isotonic knots that do not increase", async () => {
    // Knots fora de ordem descrevem uma função que não é monotônica, e um calibrador não
    // monotônico pode devolver score MENOR para evidência MAIOR.
    const perfil = await perfilValido();
    const calibradores = perfil.calibrators as Record<string, unknown>;
    await recusa(
      {
        ...perfil,
        calibrators: {
          ...calibradores,
          document: {
            kind: "isotonic",
            interpolation: "linear",
            clamp: true,
            knots: [
              { rawScore: 0.6, calibratedScore: 0.2 },
              { rawScore: 0.4, calibratedScore: 0.5 },
            ],
          },
        },
      },
      "CALIBRATOR_NOT_MONOTONIC",
    );
  });

  it("refuses a threshold outside the unit interval", async () => {
    const perfil = await perfilValido();
    const limiares = perfil.thresholds as Record<string, unknown>;
    await recusa(
      { ...perfil, thresholds: { ...limiares, documentIndicator: 2 } },
      "THRESHOLDS_INVALID",
    );
  });

  it("refuses an evidence policy missing a field", async () => {
    await recusa(
      { ...(await perfilValido()), evidencePolicy: {} },
      "EVIDENCE_POLICY_INVALID",
    );
  });

  it("refuses gate evidence with a decision the profile cannot carry", async () => {
    // Um perfil publicado só existe para `indicator-only` ou `pass`: um reject não tem perfil.
    const perfil = await perfilValido();
    const evidencia = perfil.gateEvidence as Record<string, unknown>;
    await recusa(
      { ...perfil, gateEvidence: { ...evidencia, decision: "reject" } },
      "GATE_EVIDENCE_INVALID",
    );
  });

  it("refuses an ECE that is not a finite number", async () => {
    const perfil = await perfilValido();
    const evidencia = perfil.gateEvidence as Record<string, unknown>;
    const ece = evidencia.ece as Record<string, unknown>;
    await recusa(
      {
        ...perfil,
        gateEvidence: { ...evidencia, ece: { ...ece, value: "muito" } },
      },
      "ECE_INVALID",
    );
  });

  it("refuses a critical-slice table that is not an object", async () => {
    const perfil = await perfilValido();
    const evidencia = perfil.gateEvidence as Record<string, unknown>;
    await recusa(
      { ...perfil, gateEvidence: { ...evidencia, criticalFprSlices: "nada" } },
      "SLICES_INVALID",
    );
  });

  it("refuses an overall FPR estimated on too few negatives", async () => {
    // O piso de negativos é o que dá sentido ao intervalo: FPR medido em punhado de amostra tem
    // limite superior largo o bastante para não decidir nada.
    const perfil = await perfilValido();
    const evidencia = perfil.gateEvidence as Record<string, unknown>;
    const geral = evidencia.overall as Record<string, unknown>;
    const fpr = geral.indicatorFpr as Record<string, unknown>;
    await recusa(
      {
        ...perfil,
        gateEvidence: {
          ...evidencia,
          overall: { ...geral, indicatorFpr: { ...fpr, sampleSize: 1 } },
        },
      },
      "INSUFFICIENT_NEGATIVES",
    );
  });

  it("refuses a critical slice estimated on too few samples", async () => {
    const perfil = await perfilValido();
    const evidencia = perfil.gateEvidence as Record<string, unknown>;
    const fatias = evidencia.criticalFprSlices as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const nomes = Object.keys(fatias);
    expect(nomes.length).toBeGreaterThan(0);
    const primeira = fatias[nomes[0]];
    await recusa(
      {
        ...perfil,
        gateEvidence: {
          ...evidencia,
          criticalFprSlices: {
            ...fatias,
            [nomes[0]]: {
              ...primeira,
              indicatorFpr: { ...primeira.indicatorFpr, sampleSize: 1 },
            },
          },
        },
      },
      "INSUFFICIENT_SLICE_SAMPLE",
    );
  });

  it("refuses an indicator ceiling that still carries an action threshold", async () => {
    // O invariante vive DENTRO de `decision === "indicator-only"`, então o perfil vem daquele
    // fixture e não do `pass` — no `pass` o bloco todo é pulado e a recusa acabaria vindo do
    // digest, provando outra guarda. Com o perfil certo, uma mudança só basta: teto `hide` sob
    // decisão indicator-only é ação declarada sob um teto que a proíbe.
    const { profiles } = await bundleInputFor("indicator-only");
    const arquivo = profiles as unknown as {
      profiles: Record<string, unknown>[];
    };
    const perfil = arquivo.profiles[0];
    expect((perfil.gateEvidence as Record<string, unknown>).decision).toBe(
      "indicator-only",
    );
    await recusa({ ...perfil, actionCeiling: "hide" }, "POLICY_INVALID");
  });
});

// ---------------------------------------------------------------------------
// As sete que fecham `contracts/`: forma e campo dos outros tres parsers.
//
// Todas partem de um artefato VALIDO e alteram uma coisa so. Nos tres casos o parser confere forma
// e campo ANTES do digest, entao a recusa nao cai no digest por acidente — e o teste do valido, em
// cada bloco, e o que garante que a recusa e da mutacao.
// ---------------------------------------------------------------------------

describe("contratos selados — forma e campo dos outros tres parsers", () => {
  async function paridadeValida(): Promise<Record<string, unknown>> {
    const base = {
      schemaVersion: 1 as const,
      modelId: "cleanfeed-ptbr-v1",
      modelVersion: "1.0.0",
      bundleDigest: "1".repeat(64),
      aggregationVersion: "tmr-aggregation-v3",
      contentCompositionVersion: "lexical-content-v2",
      tokenizerDigest: "2".repeat(64),
      inferenceCoreDigest: "3".repeat(64),
    };
    return {
      ...base,
      runtimeParityDigest: await computeRuntimeParityDigest(base),
    };
  }

  async function prontidaoValida(): Promise<Record<string, unknown>> {
    const { input } = await bundleInputFor("pass");
    const bruto = input.sourceReadiness as unknown as Record<string, unknown>;
    const corpo = { ...bruto };
    delete corpo.reportDigest;
    return {
      ...corpo,
      reportDigest: await computeSourceReadinessDigest(corpo as never),
    };
  }

  it("refuses a release descriptor whose shape or schemaVersion drifted", async () => {
    const { release } = await bundleInputFor("reject");
    const valido = release as unknown as Record<string, unknown>;
    await expect(
      parseModelReleaseDescriptorV1({ ...valido, extra: 1 }),
    ).rejects.toMatchObject({ code: "RELEASE_SCHEMA_INVALID" });
    await expect(
      parseModelReleaseDescriptorV1({ ...valido, schemaVersion: 2 }),
    ).rejects.toMatchObject({ code: "RELEASE_SCHEMA_INVALID" });
  });

  it("refuses a rollout state outside the closed list", async () => {
    const { release } = await bundleInputFor("reject");
    await expect(
      parseModelReleaseDescriptorV1({
        ...(release as unknown as Record<string, unknown>),
        rolloutState: "voando",
      }),
    ).rejects.toMatchObject({ code: "RELEASE_FIELD_INVALID" });
  });

  it("refuses a runtime parity manifest whose shape drifted", async () => {
    const valido = await paridadeValida();
    await expect(
      parseRuntimeParityManifestV1({ ...valido, extra: 1 }),
    ).rejects.toMatchObject({ code: "RUNTIME_PARITY_SCHEMA_INVALID" });
    const semCampo = { ...valido };
    delete semCampo.inferenceCoreDigest;
    await expect(parseRuntimeParityManifestV1(semCampo)).rejects.toMatchObject({
      code: "RUNTIME_PARITY_SCHEMA_INVALID",
    });
  });

  it("refuses a runtime parity field of the wrong shape", async () => {
    const valido = await paridadeValida();
    await expect(
      parseRuntimeParityManifestV1({ ...valido, modelId: "" }),
    ).rejects.toMatchObject({ code: "RUNTIME_PARITY_FIELD_INVALID" });
    await expect(
      parseRuntimeParityManifestV1({ ...valido, bundleDigest: "curto" }),
    ).rejects.toMatchObject({ code: "RUNTIME_PARITY_FIELD_INVALID" });
  });

  it("refuses a readiness report whose shape drifted", async () => {
    const valido = await prontidaoValida();
    await expect(
      parseCorpusSourceReadinessReport({ ...valido, extra: 1 }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_SCHEMA_INVALID" });
  });

  it("refuses a readiness status outside ready/blocked", async () => {
    const valido = await prontidaoValida();
    await expect(
      parseCorpusSourceReadinessReport({ ...valido, status: "talvez" }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_FIELD_INVALID" });
  });

  it("refuses ready with blocking reasons, and blocked without any", async () => {
    // O par e o ponto: `ready` com motivo de bloqueio e um relatorio que se contradiz, e `blocked`
    // sem motivo e um bloqueio que ninguem pode contestar. As duas metades sao a mesma guarda.
    const valido = await prontidaoValida();
    await expect(
      parseCorpusSourceReadinessReport({
        ...valido,
        // A razao admite `code`, `recordId` e `sourceId` — e mais nada. `detail` era invencao
        // minha, e o parser recusou por chave desconhecida: teria provado a guarda de FORMA em
        // vez da de ESTADO.
        blockingReasons: [
          { code: "SOURCE_LEGAL_REVIEW_MISSING", sourceId: "src_x" },
        ],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_STATE_INVALID" });
    await expect(
      parseCorpusSourceReadinessReport({
        ...valido,
        status: "blocked",
        blockingReasons: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_STATE_INVALID" });
  });
});
