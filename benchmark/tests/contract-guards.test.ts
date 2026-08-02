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
    const { reportDigest: _fachada, ...corpo } = bruto;
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
