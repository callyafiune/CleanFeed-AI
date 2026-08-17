import { describe, expect, it } from "vitest";

import {
  auditBlockedSplit,
  GROUP_AXIS_ROLES,
  groupAxisRole,
  REPORTED_GROUP_AXES,
  type GroupAxisRole,
  type SplitAuditPolicy,
} from "../split-audit.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  axisConnectivity,
  connectedComponentRoots,
  CONNECTIVITY_AXES,
  createBlockedSplit,
  GROUP_KEYS,
  IMPOSED_UNION_AXES,
  INERT_UNION_AXES,
  PARENT_LINKAGE_AXES,
  PARTITIONS,
  SplitConstraintError,
  type BlockedSplitPolicy,
  type Partition,
  withinClassTolerance,
  CLASS_TOLERANCE_EPSILON,
} from "../split.ts";
import {
  ALL_GROUP_AXES,
  groupAxisIdentity,
  V4_GROUP_AXES,
  validateBenchmarkRecordV4,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type TransformationKind,
  type V4GroupAxis,
} from "../schema.ts";
import { known, v4Ai, v4Human, withAxis } from "./helpers/v3-record-fixture.ts";
import {
  asGeneratorFamily,
  generatorFamilyOf,
  normalizeGeneratorFamily,
} from "../generator-family.ts";
import { EXPOSURE_IDENTITY_AXES } from "../cluster-exposure-ledger.ts";
import {
  buildCatalogueCorpus,
  componentsUnderAxes,
  loadCatalogue,
  type ViabilityCase,
} from "./helpers/viability-catalogue.ts";

const CATALOGUE = await loadCatalogue();

// The blocked split is exercised through the public API only (no lower-level
// hooks), so every fixture is a full, self-consistent dataset that the temporal
// 45/5/10/20/20 cuts can actually satisfy within tolerance. A record factory keeps the
// closed schema fields realistic while leaving the axes the splitter reads
// (label, createdAt, domain, the canonical generator family and every groups.* key)
// under
// direct test control.
const SHA = "a".repeat(64);

interface RecordSpec {
  id: string;
  label: BenchmarkLabel;
  createdAt: number;
  domain: string;
  wordCount: number;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  transformationKind?: TransformationKind;
  family?: string;
  aiFraction?: number;
  author: string;
  source: string;
  domainSource: string;
  collectionBatch: string;
  nearDuplicate: string;
  derivationRoot: string;
  generatorVersion?: string;
  promptTemplate?: string;
}

function rec(spec: RecordSpec): BenchmarkRecord {
  const kind: TransformationKind = spec.transformationKind ?? "none";
  const record: BenchmarkRecord = {
    schemaVersion: 2,
    id: spec.id,
    text: `texto ${spec.id}`,
    normalizedTextSha256: SHA,
    label: spec.label,
    language: "pt-BR",
    platform: "generic",
    domain: spec.domain,
    topic: "carreira",
    wordCount: spec.wordCount,
    createdAt: spec.createdAt,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src",
      sourceRevision: "rev1",
      collectedAt: spec.createdAt,
      licenseId: "cc-by",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "rev1",
        reviewedAt: spec.createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["rev1", "rev2"],
      agreement: "agree",
    },
    transformation: {
      kind,
      severity: kind === "none" ? "none" : "medium",
    },
    groups: {
      author: spec.author,
      source: spec.source,
      domainSource: spec.domainSource,
      collectionBatch: spec.collectionBatch,
      nearDuplicate: spec.nearDuplicate,
      derivationRoot: spec.derivationRoot,
    },
  };
  if (spec.humanSourceType !== undefined) {
    record.humanSourceType = spec.humanSourceType;
  }
  if (spec.hardNegativeFamily !== undefined) {
    record.hardNegativeFamily = spec.hardNegativeFamily;
  }
  if (spec.generatorVersion !== undefined) {
    record.groups.generatorVersion = spec.generatorVersion;
  }
  if (spec.promptTemplate !== undefined) {
    record.groups.promptTemplate = spec.promptTemplate;
  }
  if (spec.family !== undefined) {
    // Both fields, as a valid record carries them: the provider's own label inside
    // the recipe, and the CANONICAL token in groups — the only field the splitter,
    // the audit and the slices read (benchmark/generator-family.ts). A fixture that
    // set only `generation.family` modelled a record the schema now refuses.
    record.generation = {
      provider: "acme",
      family: spec.family,
      model: `${spec.family}-model`,
      version: spec.generatorVersion ?? "v1",
      promptId: "prompt1",
      promptSha256: SHA,
      generatedAt: spec.createdAt,
    };
    record.groups.generatorFamily = normalizeGeneratorFamily(spec.family);
  }
  if (spec.aiFraction !== undefined) {
    record.mixture = {
      aiFraction: spec.aiFraction,
      humanFraction: Number((1 - spec.aiFraction).toFixed(4)),
      spans: [],
      generationMode: "mechanistic",
    };
  }
  return record;
}

// Even class interleaving across 100 time slots. Because human, ai and mixed are
// each spread uniformly over time, four global temporal cuts land every class at
// ~45/5/10/20/20, and every (slot, class) shares every grouping axis it can carry, so the
// audit exercises real — never vacuous — cohesion. One hundred slots is not decoration: the
// `dev` target is 0.05, so a coarser timeline could not place a cut pair that lands
// dev inside two points of it at all. Mixed records point their
// derivationRoot at the slot's human parent, so parent + derivatives cluster.
// The unseen generator family appears only in the newest slots so it is both
// held-out-eligible and temporally in test.
function buildDataset(options: {
  perHuman: number;
  perAi: number;
  perMixed: number;
  unseenPerSlot: number;
  unseenFromSlot: number;
  unseenFamilyFromSlot?: number;
}): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < options.perHuman; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: i % 2 === 0 ? "employee-post" : "newsletter",
          hardNegativeFamily: i % 2 === 0 ? "hn-legal" : "hn-marketing",
          author: `auth_h_${slot}`,
          source: `src_h_${slot}`,
          domainSource: `ds_h_${slot}`,
          collectionBatch: `cb_h_${slot}`,
          nearDuplicate: `nd_h_${slot}`,
          derivationRoot: `h_${slot}_0`,
        }),
      );
    }
    for (let i = 0; i < options.perAi; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: "family-seen",
          author: `auth_a_${slot}`,
          source: `src_a_${slot}`,
          domainSource: `ds_a_${slot}`,
          collectionBatch: `cb_a_${slot}`,
          nearDuplicate: `nd_a_${slot}`,
          derivationRoot: `a_${slot}_0`,
          generatorVersion: `gv_seen_${slot}`,
          promptTemplate: `pt_a_${slot}`,
        }),
      );
    }
    for (let i = 0; i < options.perMixed; i += 1) {
      records.push(
        rec({
          id: `m_${slot}_${i}`,
          label: "mixed",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [60, 220, 500][i % 3],
          transformationKind: "human-ai-mix",
          family: "family-seen",
          aiFraction: i % 2 === 0 ? 0.7 : 0.4,
          author: `auth_m_${slot}`,
          source: `src_m_${slot}`,
          domainSource: `ds_m_${slot}`,
          collectionBatch: `cb_m_${slot}`,
          nearDuplicate: `nd_m_${slot}`,
          derivationRoot: `h_${slot}_0`,
          promptTemplate: `pt_m_${slot}`,
        }),
      );
    }
  }

  const unseenStart = options.unseenFamilyFromSlot ?? options.unseenFromSlot;
  for (let slot = unseenStart; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < options.unseenPerSlot; i += 1) {
      records.push(
        rec({
          id: `u_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: "linkedin",
          wordCount: 300,
          transformationKind: "paraphrase",
          family: "family-unseen",
          author: `auth_u_${slot}_${i}`,
          source: `src_u_${slot}_${i}`,
          domainSource: `ds_u_${slot}_${i}`,
          collectionBatch: `cb_u_${slot}_${i}`,
          nearDuplicate: `nd_u_${slot}_${i}`,
          derivationRoot: `u_${slot}_${i}`,
          generatorVersion: `gv_unseen_${slot}`,
          promptTemplate: `pt_u_${slot}`,
        }),
      );
    }
  }
  return records;
}

const DATASET = buildDataset({
  perHuman: 6,
  perAi: 4,
  perMixed: 3,
  unseenPerSlot: 1,
  unseenFromSlot: 96,
});

const POLICY: BlockedSplitPolicy = {
  fractions: {
    train: 0.45,
    dev: 0.05,
    "cal-A": 0.1,
    "cal-B": 0.2,
    test: 0.2,
  },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  seed: 20_260_726,
};

const RELEASE_AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

// The axes the splitter unions on that a v2 record can CARRY, restated here rather
// than imported: a list read off `GROUP_KEYS` cannot fail when `GROUP_KEYS` moves, and
// that failure is the whole reason this list exists.
//
// `generationBatch` is the fifth union axis and is v4-only — a v2 `groups` block has
// no such key — so its cohesion is exercised on v4 fixtures further down.
// `domainSource`, `promptTemplate` and `generatorVersion` are absent because the
// splitter does not union on them, and the v4 fixtures prove it: the first would
// collapse a quota cell, and the other two the whole generated class.
const GROUP_AXES = [
  "author",
  "source",
  "nearDuplicate",
  "derivationRoot",
] as const;

describe("the inclusive boundary holds through the real search, not just the helper", () => {
  // O helper sozinho nao prova nada sobre a busca: cada poda que reescreve a aritmetica
  // inline reabre a borda para UM corte, e um teste que chama so o helper nao ve isso. Este
  // vai pela API publica.
  //
  // O corpus tem cinco blocos temporais com 45, 5, 8, 22 e 20 registros, cada linha em seu
  // proprio componente. Como os unicos cortes possiveis sao as fronteiras dos blocos, a UNICA
  // colocacao alcancavel realiza `45/5/8/22/20` — `cal-A` a 0,08 e `cal-B` a 0,22, ambos
  // exatamente nos dois pontos de tolerancia. Comparar float cru recusa: `0.58 - 0.50` da
  // `0.07999999999999996`.
  function corpusNasBordas(): BenchmarkRecord[] {
    const porBloco = [45, 5, 8, 22, 20];
    const registros: BenchmarkRecord[] = [];
    let indice = 0;
    porBloco.forEach((quantos, bloco) => {
      for (let i = 0; i < quantos; i += 1) {
        registros.push(
          rec({
            id: `b${bloco}_${i}`,
            label: "human",
            createdAt: (bloco + 1) * 1_000,
            domain: "corporate",
            wordCount: 180,
            humanSourceType: "employee-post",
            author: `a_${indice}`,
            source: `s_${indice}`,
            domainSource: `ds_${indice}`,
            collectionBatch: `cb_${indice}`,
            nearDuplicate: `nd_${indice}`,
            derivationRoot: `b${bloco}_${i}`,
          }),
        );
        indice += 1;
      }
    });
    return registros;
  }

  it("accepts a distribution sitting exactly on both tolerance edges", () => {
    const split = createBlockedSplit(corpusNasBordas(), POLICY);
    expect({
      train: split.train.length,
      dev: split.dev.length,
      "cal-A": split["cal-A"].length,
      "cal-B": split["cal-B"].length,
      test: split.test.length,
    }).toEqual({ train: 45, dev: 5, "cal-A": 8, "cal-B": 22, test: 20 });
  });

  it("still refuses a distribution genuinely outside the tolerance", () => {
    // Mesma construcao, `cal-A` com 5 de 100: 0,05 contra alvo 0,10 e cinco pontos fora.
    const porBloco = [45, 5, 5, 25, 20];
    const registros: BenchmarkRecord[] = [];
    let indice = 0;
    porBloco.forEach((quantos, bloco) => {
      for (let i = 0; i < quantos; i += 1) {
        registros.push(
          rec({
            id: `x${bloco}_${i}`,
            label: "human",
            createdAt: (bloco + 1) * 1_000,
            domain: "corporate",
            wordCount: 180,
            humanSourceType: "employee-post",
            author: `xa_${indice}`,
            source: `xs_${indice}`,
            domainSource: `xds_${indice}`,
            collectionBatch: `xcb_${indice}`,
            nearDuplicate: `xnd_${indice}`,
            derivationRoot: `x${bloco}_${i}`,
          }),
        );
        indice += 1;
      }
    });
    expect(() => createBlockedSplit(registros, POLICY)).toThrow(
      /proportions|unreachable/iu,
    );
  });
});

// As cinco podas da busca são de UM LADO SÓ, e o lado é este — uma prova por sítio.
//
// A poda de `train` é um TETO sobre a share da banda e as outras quatro são PISOS, e nenhuma
// das duas famílias tem prova de DIREÇÃO: inverter as cinco de uma vez deixa a bateria verde.
// O que separa as direções é uma share de banda que caia estritamente dentro da metade certa
// e estritamente fora da invertida, e a folga entre banda e realizado que isso exige vem do
// COMPONENTE QUE ATRAVESSA um corte: ele cai em `train` inteiro, então `train` recebe massa
// que a banda dele não conta e as bandas do meio perdem massa que a banda delas conta. Cada
// corpo abaixo põe UMA share nessa faixa e as outras quatro dentro das duas metades, que é o
// que faz cada caso morrer só sob a inversão do seu próprio sítio.
describe("cada poda da busca é de um lado só, e o lado é este", () => {
  /**
   * Cinco blocos temporais com uma linha por componente, mais UM componente que atravessa
   * dois blocos. `porBloco` conta TODAS as linhas datadas em cada bloco, incluindo as do
   * atravessador — é a share da banda que as podas leem, e ela conta a linha atravessadora.
   */
  function corpusDeBlocos(
    porBloco: readonly number[],
    atravessador?: {
      deBloco: number;
      paraBloco: number;
      linhas: readonly [number, number];
    },
  ): BenchmarkRecord[] {
    const registros: BenchmarkRecord[] = [];
    const noBloco = (bloco: number): number => {
      if (atravessador === undefined) return 0;
      if (bloco === atravessador.deBloco) return atravessador.linhas[0];
      if (bloco === atravessador.paraBloco) return atravessador.linhas[1];
      return 0;
    };
    let indice = 0;
    porBloco.forEach((quantas, bloco) => {
      const avulsas = quantas - noBloco(bloco);
      for (let i = 0; i < avulsas; i += 1) {
        registros.push(umaLinha(`p${bloco}_${i}`, bloco, `pa_${indice}`));
        indice += 1;
      }
    });
    if (atravessador !== undefined) {
      // UM autor para todas as linhas do atravessador: `author` é eixo de união, então elas
      // são um componente só, e um componente cujo intervalo de tempo cruza um corte não
      // cabe inteiro em banda alguma do meio — o splitter o deixa em `train`, que é o
      // fallback.
      for (const [posicao, bloco] of [
        atravessador.deBloco,
        atravessador.paraBloco,
      ].entries()) {
        for (let i = 0; i < atravessador.linhas[posicao as 0 | 1]; i += 1) {
          registros.push(umaLinha(`x${bloco}_${i}`, bloco, "pa_atravessador"));
        }
      }
    }
    return registros;
  }

  /**
   * UM instante por bloco, e é o que faz a colocação ser única: os cortes só podem cair nas
   * fronteiras dos cinco blocos, então existe uma só quádrupla crescente cujo último corte
   * não zera a banda de `test`. Um instante por LINHA daria duzentos candidatos e a
   * colocação passaria a ser a que o grid preferir.
   */
  function umaLinha(
    id: string,
    bloco: number,
    author: string,
  ): BenchmarkRecord {
    return rec({
      id,
      label: "human",
      createdAt: (bloco + 1) * 1_000,
      domain: "corporate",
      wordCount: 180,
      humanSourceType: "employee-post",
      author,
      source: `ps_${id}`,
      domainSource: `pds_${id}`,
      collectionBatch: `pcb_${id}`,
      nearDuplicate: `pnd_${id}`,
      derivationRoot: id,
    });
  }

  /** As shares de banda que as cinco podas comparam, lidas do CORPO e não do split. */
  function sharesDeBanda(records: readonly BenchmarkRecord[]): number[] {
    const porBloco = new Map<number, number>();
    for (const row of records) {
      const bloco = Math.floor(row.createdAt / 1_000);
      porBloco.set(bloco, (porBloco.get(bloco) ?? 0) + 1);
    }
    return [...porBloco.keys()]
      .sort((a, b) => a - b)
      .map((bloco) => (porBloco.get(bloco) as number) / records.length);
  }

  const tamanhos = (
    split: ReturnType<typeof createBlockedSplit>,
  ): Record<Partition, number> => ({
    train: split.train.length,
    dev: split.dev.length,
    "cal-A": split["cal-A"].length,
    "cal-B": split["cal-B"].length,
    test: split.test.length,
  });

  it("train: aceita a banda ABAIXO do piso do teto, que a inversão para piso recusa", () => {
    // Banda de `train` em 41 %: dentro do teto de 47 % e FORA de um piso de 43 %. O
    // atravessador leva seis linhas do meio para `train`, que realiza 44 %.
    const records = corpusDeBlocos([82, 12, 22, 42, 42], {
      deBloco: 1,
      paraBloco: 2,
      linhas: [3, 3],
    });
    expect(records).toHaveLength(200);
    expect(sharesDeBanda(records)).toEqual([0.41, 0.06, 0.11, 0.21, 0.21]);
    expect(tamanhos(createBlockedSplit(records, POLICY))).toEqual({
      train: 88,
      dev: 9,
      "cal-A": 19,
      "cal-B": 42,
      test: 42,
    });
  });

  it("dev: aceita a banda ACIMA do teto do piso, que a inversão para teto recusa", () => {
    // Banda de `dev` em 8 %: acima do piso de 3 % e FORA de um teto de 7 %. O atravessador
    // tira três linhas dela, e `dev` realiza 6,5 %.
    const records = corpusDeBlocos([88, 16, 20, 38, 38], {
      deBloco: 1,
      paraBloco: 2,
      linhas: [3, 1],
    });
    expect(sharesDeBanda(records)).toEqual([0.44, 0.08, 0.1, 0.19, 0.19]);
    expect(tamanhos(createBlockedSplit(records, POLICY))).toEqual({
      train: 92,
      dev: 13,
      "cal-A": 19,
      "cal-B": 38,
      test: 38,
    });
  });

  it("cal-A: aceita a banda ACIMA do teto do piso, que a inversão para teto recusa", () => {
    const records = corpusDeBlocos([88, 10, 26, 38, 38], {
      deBloco: 2,
      paraBloco: 3,
      linhas: [4, 1],
    });
    expect(sharesDeBanda(records)).toEqual([0.44, 0.05, 0.13, 0.19, 0.19]);
    expect(tamanhos(createBlockedSplit(records, POLICY))).toEqual({
      train: 93,
      dev: 10,
      "cal-A": 22,
      "cal-B": 37,
      test: 38,
    });
  });

  it("cal-B: aceita a banda ACIMA do teto do piso, que a inversão para teto recusa", () => {
    const records = corpusDeBlocos([88, 10, 18, 46, 38], {
      deBloco: 3,
      paraBloco: 4,
      linhas: [4, 1],
    });
    expect(sharesDeBanda(records)).toEqual([0.44, 0.05, 0.09, 0.23, 0.19]);
    expect(tamanhos(createBlockedSplit(records, POLICY))).toEqual({
      train: 93,
      dev: 10,
      "cal-A": 18,
      "cal-B": 42,
      test: 37,
    });
  });

  it("test: aceita a quantidade ACIMA do teto do piso, que a inversão para teto recusa", () => {
    // A quantidade que a poda de `test` compara é `1 - share(calBCut) + heldOutShare`, e a
    // reserva entra nela DUAS vezes por desenho: as componentes reservadas já estão depois
    // do último corte, e a soma as conta de novo. Com 3 % reservados a quantidade vale 23 % —
    // acima do piso de 18 % e fora de um teto de 22 % — enquanto `test` realiza 20 % exatos.
    // Sem reserva não há atravessador aqui: as cinco bandas são as cinco frações.
    const records: BenchmarkRecord[] = [];
    const porBloco = [45, 5, 10, 20, 20];
    porBloco.forEach((quantas, bloco) => {
      for (let i = 0; i < quantas; i += 1) {
        records.push(umaLinha(`r${bloco}_${i}`, bloco, `ra_${bloco}_${i}`));
        const id = `g${bloco}_${i}`;
        records.push(
          rec({
            id,
            label: "ai",
            createdAt: (bloco + 1) * 1_000,
            domain: "corporate",
            wordCount: 180,
            transformationKind: "paraphrase",
            // Seis linhas da família RESERVADA, e só no bloco de `test`: uma reservada
            // antes do último corte faz o splitter recusar por elegibilidade temporal.
            family: bloco === 4 && i < 6 ? "family-unseen" : "family-seen",
            author: `ga_${bloco}_${i}`,
            source: `gs_${id}`,
            domainSource: `gds_${id}`,
            collectionBatch: `gcb_${id}`,
            nearDuplicate: `gnd_${id}`,
            derivationRoot: id,
            generatorVersion: `ggv_${id}`,
            promptTemplate: `gpt_${id}`,
          }),
        );
      }
    });
    expect(records).toHaveLength(200);
    expect(sharesDeBanda(records)).toEqual([0.45, 0.05, 0.1, 0.2, 0.2]);
    const reservadas = records.filter(
      (row) => generatorFamilyOf(row) === "family-unseen",
    );
    expect(reservadas).toHaveLength(6);
    expect(reservadas.length / records.length).toBe(0.03);
    expect(tamanhos(createBlockedSplit(records, POLICY))).toEqual({
      train: 90,
      dev: 10,
      "cal-A": 20,
      "cal-B": 40,
      test: 40,
    });
  });
});

describe("class tolerance is inclusive at the boundary", () => {
  // 3% and 7% of a class in `dev` are LEGAL by the frozen contract, and binary floats do not
  // represent the boundary: `Math.abs(0.03 - 0.05)` is 0.020000000000000004, strictly greater
  // than 0.02. Comparing raw floats refuses exactly the two values the contract admits.
  it("accepts exactly 3% and 7% against a 5% target", () => {
    expect(withinClassTolerance(0.03, 0.05)).toBe(true);
    expect(withinClassTolerance(0.07, 0.05)).toBe(true);
  });

  it("still refuses fractions genuinely outside the tolerance", () => {
    expect(withinClassTolerance(0.0299, 0.05)).toBe(false);
    expect(withinClassTolerance(0.0701, 0.05)).toBe(false);
  });

  it("pins the epsilon so the Python mirror can be compared against it", () => {
    expect(CLASS_TOLERANCE_EPSILON).toBe(1e-9);
  });
});

describe("createBlockedSplit", () => {
  it("keeps connected groups together and the holdout family in test", () => {
    const split = createBlockedSplit(DATASET, {
      fractions: {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
      seed: 20_260_726,
    });
    const audit = auditBlockedSplit(
      DATASET,
      split,
      RELEASE_AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(audit.leakages).toEqual([]);
    // Reads the CANONICAL field, like the splitter does. Asserting on
    // `generation.family` here would keep passing even if the held-out mark stopped
    // working, because the two spellings coincide in this fixture.
    expect(
      split.test.filter((row) => generatorFamilyOf(row) === "family-unseen"),
    ).not.toHaveLength(0);
    expect(
      [
        ...split.train,
        ...split.dev,
        ...split["cal-A"],
        ...split["cal-B"],
      ].filter((row) => generatorFamilyOf(row) === "family-unseen"),
    ).toHaveLength(0);
  });

  it("does not collapse every linkedin record or every seen family into one component", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    expect(split.train.some((row) => row.domain === "corporate")).toBe(true);
    expect(split.test.some((row) => row.domain === "corporate")).toBe(true);
    expect(
      split["cal-A"].some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
    expect(
      split.test.some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
  });

  it("confines every grouping axis to a single partition (no leakage on any union axis)", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const partitions: Array<[Partition, BenchmarkRecord[]]> = [
      ["train", split.train],
      ["dev", split.dev],
      ["cal-A", split["cal-A"]],
      ["cal-B", split["cal-B"]],
      ["test", split.test],
    ];
    for (const axis of GROUP_AXES) {
      const partitionsByValue = new Map<string, Set<Partition>>();
      const recordsByValue = new Map<string, number>();
      for (const [partition, rows] of partitions) {
        for (const row of rows) {
          const value = groupAxisIdentity(row, axis);
          if (value === undefined) continue;
          const set = partitionsByValue.get(value) ?? new Set<Partition>();
          set.add(partition);
          partitionsByValue.set(value, set);
          recordsByValue.set(value, (recordsByValue.get(value) ?? 0) + 1);
        }
      }
      // No value on this axis may straddle a partition boundary.
      for (const set of partitionsByValue.values()) {
        expect([...set]).toHaveLength(1);
      }
      // Proves the assertion is non-vacuous: this axis genuinely binds multiple
      // records into a shared group, and that group stayed together.
      expect(Math.max(...recordsByValue.values())).toBeGreaterThanOrEqual(2);
    }
  });

  it("splits every class 45/5/10/20/20 within the two-point tolerance", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const audit = auditBlockedSplit(
      DATASET,
      split,
      RELEASE_AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    // Restated here on purpose rather than imported from the audit: a test that reads
    // the same constant the implementation reads cannot fail when that constant moves.
    const expected: Array<[Partition, number]> = [
      ["train", 0.45],
      ["dev", 0.05],
      ["cal-A", 0.1],
      ["cal-B", 0.2],
      ["test", 0.2],
    ];
    // Every partition, not a subset: with four of five checked the fifth can drift
    // eight points and still leave this test green.
    expect(expected.map(([partition]) => partition)).toEqual([...PARTITIONS]);
    for (const label of ["human", "ai", "mixed"] as const) {
      for (const [partition, target] of expected) {
        expect(
          Math.abs(audit.classFractions[label][partition] - target),
          `${label} ${partition}`,
        ).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("keeps the blocked test strictly newer than every other partition", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const earliestTest = Math.min(...split.test.map((row) => row.createdAt));
    // Against each partition individually, and what the loop buys is the LABEL plus the
    // non-vacuity check per partition: `x > max(a,b,c,d)` is the same predicate as the
    // four comparisons, so the four are written out to name which partition `test`
    // reaches into. The form that would NOT be equivalent is a CHAIN of
    // neighbour-to-neighbour comparisons, and `train` is why: it is the fallback for
    // every straddling component, so it can be newer than `cal-B` by design.
    for (const partition of PARTITIONS) {
      if (partition === "test") continue;
      const rows = split[partition];
      expect(rows.length, `${partition} is non-empty`).toBeGreaterThan(0);
      expect(
        earliestTest,
        `test starts after all of ${partition}`,
      ).toBeGreaterThan(Math.max(...rows.map((row) => row.createdAt)));
    }
  });

  it("is deterministic for a fixed seed", () => {
    const first = createBlockedSplit(DATASET, POLICY);
    const second = createBlockedSplit(DATASET, POLICY);
    const ids = (rows: BenchmarkRecord[]): string[] =>
      rows.map((row) => row.id);
    for (const partition of PARTITIONS) {
      expect(ids(first[partition]), partition).toEqual(ids(second[partition]));
    }
  });

  it("throws when a held-out family is not temporally eligible for test", () => {
    const dataset = buildDataset({
      perHuman: 6,
      perAi: 4,
      perMixed: 3,
      unseenPerSlot: 1,
      unseenFromSlot: 96,
      // Plant the unseen family in an early slot: it can never be test-only
      // without leaking future data, so the splitter must refuse.
      unseenFamilyFromSlot: 2,
    });
    expect(() => createBlockedSplit(dataset, POLICY)).toThrow(
      SplitConstraintError,
    );
  });

  it("throws when no temporal cut exists at all (single timestamp)", () => {
    // Every record shares one timestamp, so no strictly increasing quadruple of cuts
    // exists at all: fail closed at the no-cut branch rather than relax anything.
    //
    // The message says "no candidate cut quadruple", not "no temporal cut exists". The
    // candidate grid is bounded, so an empty result proves only that nothing in the grid
    // worked — here that happens to coincide with genuine impossibility, but the message
    // must not claim the stronger thing in the cases where it does not.
    const degenerate = Array.from({ length: 12 }, (_, index) =>
      rec({
        id: `d_${index}`,
        label: "human",
        createdAt: 1,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${index}`,
        source: `src_${index}`,
        domainSource: `ds_${index}`,
        collectionBatch: `cb_${index}`,
        nearDuplicate: `nd_${index}`,
        derivationRoot: `d_${index}`,
      }),
    );
    expect(() => createBlockedSplit(degenerate, POLICY)).toThrow(
      /no candidate cut quadruple realises/,
    );
  });

  it("throws the class-fraction error when 45/5/10/20/20 is unreachable within tolerance", () => {
    // Human lives entirely in the oldest half of the timeline, AI entirely in
    // the newest half. Candidate cuts exist (many distinct timestamps) and the
    // search finds a legal quadruple, but no set of global cuts can give both
    // classes a 20% test block — so the per-class ±2pp guard must throw,
    // exercising the class-fraction path and not the no-cut branch.
    const skewed: BenchmarkRecord[] = [];
    for (let slot = 1; slot <= 10; slot += 1) {
      skewed.push(
        rec({
          id: `hh_${slot}`,
          label: "human",
          createdAt: slot,
          domain: "corporate",
          wordCount: 100,
          author: `auth_hh_${slot}`,
          source: `src_hh_${slot}`,
          domainSource: `ds_hh_${slot}`,
          collectionBatch: `cb_hh_${slot}`,
          nearDuplicate: `nd_hh_${slot}`,
          derivationRoot: `hh_${slot}`,
        }),
      );
    }
    for (let slot = 11; slot <= 20; slot += 1) {
      skewed.push(
        rec({
          id: `aa_${slot}`,
          label: "ai",
          createdAt: slot,
          domain: "linkedin",
          wordCount: 100,
          family: "family-seen",
          author: `auth_aa_${slot}`,
          source: `src_aa_${slot}`,
          domainSource: `ds_aa_${slot}`,
          collectionBatch: `cb_aa_${slot}`,
          nearDuplicate: `nd_aa_${slot}`,
          derivationRoot: `aa_${slot}`,
        }),
      );
    }
    expect(() => createBlockedSplit(skewed, POLICY)).toThrow(
      /fractions unreachable within tolerance/,
    );
  });
});

// --- what the v4 union does and does not glue --------------------------------

/**
 * A quota cell as the corpus really offers it: ONE acquisition event and ONE stratum
 * for every row, each row its own origin document, author and near-duplicate cluster.
 *
 * The rows are built through `validateBenchmarkRecordV4`, so the axis states are the
 * ones a real v4 human row is allowed to carry — `sourceMaterialBatch` and
 * `domainSource` are `known` on every human row BY RULE, which is exactly why a union
 * on either of them would collapse the cell.
 */
function cellFromOneAcquisition(rows: number): BenchmarkRecord[] {
  return Array.from({ length: rows }, (_, index) => {
    let raw: Record<string, unknown> = { ...v4Human(), id: `h_cell_${index}` };
    raw = withAxis(raw, "author", known(`au_hmac_cell_${index}`));
    raw = withAxis(raw, "source", known(`th_doc_${index}`));
    raw = withAxis(raw, "nearDuplicate", known(`nd_cell_${index}`));
    return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
  });
}

/** A generated row whose ONLY shareable identity is its generation batch. */
function generatedInBatch(id: string, batch: string): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v4Ai(), id };
  raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
  raw = withAxis(raw, "generatorVersion", known(`gv_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  // Parent linkage, and the named row is absent from every record set below, so it
  // unions nothing — which is what leaves the batch as the only candidate.
  raw = withAxis(raw, "humanSeed", known(`h_absent_${id}`));
  raw = withAxis(raw, "generationBatch", known(batch));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

describe("the coarse axes carry dependence without unioning", () => {
  it("leaves one component per record-line when only the cell is shared", () => {
    const cell = cellFromOneAcquisition(8);
    // Non-vacuous: the two coarse axes really do carry ONE value across the whole
    // cell, so a union on either would have to produce a single component.
    for (const axis of ["domainSource", "sourceMaterialBatch"] as const) {
      const identities = new Set(
        cell.map((row) => groupAxisIdentity(row, axis)),
      );
      expect(identities.size, axis).toBe(1);
      expect([...identities][0], axis).not.toBeUndefined();
    }
    const roots = connectedComponentRoots(cell);
    expect(new Set(roots.values()).size).toBe(8);
  });

  it("still unions the generation batch, which is the axis that replaced the v3 one", () => {
    const together = [
      generatedInBatch("a_1", "gb_agy_20260724"),
      generatedInBatch("a_2", "gb_agy_20260724"),
    ];
    expect(new Set(connectedComponentRoots(together).values()).size).toBe(1);

    const apart = [
      generatedInBatch("a_3", "gb_agy_20260724"),
      generatedInBatch("a_4", "gb_agy_20260725"),
    ];
    expect(new Set(connectedComponentRoots(apart).values()).size).toBe(2);
  });

  it("never unions the extraction run, so re-reading one dump is not new material", () => {
    // Every row of the cell above shares its extraction run as well as its batch:
    // the run is DIAGNOSTIC, and unioning on it would count one dependence twice.
    const cell = cellFromOneAcquisition(4);
    const runs = new Set(
      cell.map((row) => groupAxisIdentity(row, "extractionRun")),
    );
    expect(runs.size).toBe(1);
    expect(axisConnectivity("extractionRun")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
  });
});

// --- generationBatch, the one v4 added, through the splitter and not only the components -

/**
 * A hundred temporal slots, one human and one generated row each, all v4 and all
 * validated. The only shareable identity across rows is the generated batch, and it
 * is shared by exactly ONE pair — placed in the OLDEST and the NEWEST band, so the
 * pair only lands in one partition if the splitter unions on the batch.
 *
 * Everything else is per row: `author`, `source` and `nearDuplicate` on the human
 * rows; `promptTemplate`, `generatorVersion` and `nearDuplicate` on the generated
 * ones. `domainSource` and `sourceMaterialBatch` are shared cell-wide BY RULE and
 * union nothing, which is what leaves the batch as the single axis under test.
 * `humanSeed` names a row absent from the corpus, so the linkage relation resolves to
 * nothing here.
 */
function v4CorpusSharingOneBatch(): {
  records: BenchmarkRecord[];
  sharedBatch: string;
} {
  const sharedBatch = "gb_agy_shared_pair";
  const records: BenchmarkRecord[] = [];
  for (let slot = 1; slot <= 100; slot += 1) {
    let human: Record<string, unknown> = {
      ...v4Human(),
      id: `hb_${slot}`,
      createdAt: slot,
    };
    human = withAxis(human, "author", known(`au_hmac_hb_${slot}`));
    human = withAxis(human, "source", known(`th_doc_hb_${slot}`));
    human = withAxis(human, "nearDuplicate", known(`nd_hb_${slot}`));
    records.push(
      validateBenchmarkRecordV4(human) as unknown as BenchmarkRecord,
    );

    // Slot 3 is inside the oldest band and slot 98 inside the blocked test band.
    const shared = slot === 3 || slot === 98;
    let ai: Record<string, unknown> = {
      ...v4Ai(),
      id: `ab_${slot}`,
      createdAt: slot,
    };
    ai = withAxis(ai, "promptTemplate", known(`pt_ab_${slot}`));
    ai = withAxis(ai, "generatorVersion", known(`gv_ab_${slot}`));
    ai = withAxis(ai, "nearDuplicate", known(`nd_ab_${slot}`));
    ai = withAxis(
      ai,
      "generationBatch",
      known(shared ? sharedBatch : `gb_agy_ab_${slot}`),
    );
    records.push(validateBenchmarkRecordV4(ai) as unknown as BenchmarkRecord);
  }
  return { records, sharedBatch };
}

const V4_BATCH_POLICY: BlockedSplitPolicy = {
  fractions: { train: 0.45, dev: 0.05, "cal-A": 0.1, "cal-B": 0.2, test: 0.2 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [],
  seed: 20_260_804,
};

describe("the generation batch, taken through the splitter", () => {
  it("keeps one batch inside a single partition, so the batch axis binds", () => {
    const { records, sharedBatch } = v4CorpusSharingOneBatch();
    const split = createBlockedSplit(records, V4_BATCH_POLICY);
    const partitions: Array<[Partition, BenchmarkRecord[]]> = [
      ["train", split.train],
      ["dev", split.dev],
      ["cal-A", split["cal-A"]],
      ["cal-B", split["cal-B"]],
      ["test", split.test],
    ];

    // The axis name is RESTATED, never read off `GROUP_KEYS`. A loop over the
    // splitter's own list cannot fail when that list loses the axis, and the audit's
    // `leakages` reads the same list — so both go BLIND rather than red under exactly
    // the mutation this test exists to catch.
    const partitionsByBatch = new Map<string, Set<Partition>>();
    const rowsByBatch = new Map<string, number>();
    for (const [partition, rows] of partitions) {
      for (const row of rows) {
        const value = groupAxisIdentity(row, "generationBatch");
        if (value === undefined) continue;
        const seen = partitionsByBatch.get(value) ?? new Set<Partition>();
        seen.add(partition);
        partitionsByBatch.set(value, seen);
        rowsByBatch.set(value, (rowsByBatch.get(value) ?? 0) + 1);
      }
    }
    // Non-vacuous: exactly one batch really does bind two rows, and those two rows sit
    // in temporal bands the cuts fall between, so nothing but the union holds them
    // together.
    expect(rowsByBatch.get(sharedBatch)).toBe(2);
    expect(Math.max(...rowsByBatch.values())).toBe(2);
    for (const [batch, seen] of partitionsByBatch) {
      expect([...seen], batch).toHaveLength(1);
    }

    // Evidence, not the guard: the audit enumerates `GROUP_KEYS` too, so an empty
    // leakage list here is only as strong as that list is.
    const audit = auditBlockedSplit(
      records,
      split,
      RELEASE_AUDIT_POLICY,
      V4_BATCH_POLICY.heldOutGeneratorFamilies,
    );
    expect(audit.leakages).toEqual([]);
  });
});

// --- the axis lists the audit and D0b read ----------------------------------

describe("the connectivity axis lists", () => {
  it("names every axis the splitter unions on exactly once", () => {
    // `derivationRoot` is BOTH a value axis and a linkage axis, so a plain
    // concatenation of the two lists carried it twice. Harmless to `.includes()`,
    // wrong for anything that counts or serialises the list — and this one is
    // exported and read downstream.
    expect(CONNECTIVITY_AXES.length).toBe(new Set(CONNECTIVITY_AXES).size);
    expect(
      CONNECTIVITY_AXES.filter((axis) => axis === "derivationRoot").length,
    ).toBe(1);

    // The CONTENT and the ORDER, as literals. Comparing the list against
    // `new Set([...GROUP_KEYS, ...PARENT_LINKAGE_AXES])` is the derivation itself and is
    // therefore a tautology: it holds for a list of seven, of five, and of one, so nothing
    // pins the SIZE. Seven names — the six value axes and the linkage-only `humanSeed` —
    // and this is the list `CLUSTER_ATOM_AXES` (benchmark/cross-validation.ts) reads, so
    // a name lost here silently stops making the fold atom unknowable.
    expect([...CONNECTIVITY_AXES]).toEqual([
      "author",
      "source",
      "promptTemplate",
      "generationBatch",
      "nearDuplicate",
      "derivationRoot",
      "humanSeed",
    ]);

    // And still the union of the two relations, which is what keeps the literal above
    // from becoming a third authority.
    expect([...CONNECTIVITY_AXES].sort()).toEqual(
      [...new Set([...GROUP_KEYS, ...PARENT_LINKAGE_AXES])].sort(),
    );
  });

  it("separates the two relations instead of flattening them to one flag", () => {
    // A value axis: sharing the identity is enough.
    expect(axisConnectivity("source")).toEqual({
      sharedValue: true,
      parentLinkage: false,
    });
    // Linkage only. The named row has to be PRESENT for anything to be unioned,
    // so this flag alone must never be read as "these rows are kept together".
    expect(axisConnectivity("humanSeed")).toEqual({
      sharedValue: false,
      parentLinkage: true,
    });
    // Both, said as both.
    expect(axisConnectivity("derivationRoot")).toEqual({
      sharedValue: true,
      parentLinkage: true,
    });
    // Two axes the splitter does not union on at all, and one it never saw. The version is
    // the interesting one: its identity IS the family's on every assembled line, so neither
    // flag is set for either, and the family is genuinely divisible here.
    expect(axisConnectivity("generatorFamily")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
    expect(axisConnectivity("generatorVersion")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
    expect(axisConnectivity("noSuchAxis")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
  });
});

// F1-4: lineage is refused BEFORE anything is partitioned.
//
// WHAT IS ALREADY COVERED ELSEWHERE, so this block does not repeat it: the
// colocation itself is "confines every grouping axis to a single partition (no leakage
// on any union axis)" above, which walks `derivationRoot` and `humanSeed` over a
// dataset the temporal cut can actually satisfy; the refusal's own behaviour is pinned
// in `benchmark/tests/schema-v3.test.ts`. What was missing is the wiring — the refusal
// existed with no production caller and `benchmark/split.ts` named it in a comment as
// where an unresolved parent "belongs".
//
// WHAT IS STILL NOT COVERED, stated rather than implied: `assertDerivedParentsResolve`
// returns immediately for any record whose `schemaVersion` is not 3, and the
// end-to-end scenario in `corpus-import.test.ts` builds a v2 corpus of 10 000 records.
// So no test in this repository runs the new call over a corpus it actually inspects.
// An integration test needs a v3 dataset with coherent manifest + audit digests, which
// means sealing one; it is recorded as an open finding.
describe("F1-4 — the refusal is wired ahead of the splitter", () => {
  it("calls the refusal before the split, in the command itself", async () => {
    // A source-order assertion, and worth saying why rather than apologizing for it:
    // the plan's requirement is positional — "a execução chama
    // `assertDerivedParentsResolve` ANTES do split". Behaviour lives in the two places
    // named above; what this pins is that the call cannot drift below
    // `createBlockedSplit`, where it would be refusing a corpus already partitioned.
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "../commands/split.ts"),
      "utf8",
    );
    const refusal = source.indexOf("assertDerivedParentsResolve(records)");
    const partitioning = source.indexOf("createBlockedSplit(records");
    expect(refusal, "the command calls the refusal").toBeGreaterThan(-1);
    expect(partitioning, "the command partitions the records").toBeGreaterThan(
      -1,
    );
    expect(refusal, "the refusal must precede the partitioning").toBeLessThan(
      partitioning,
    );
  });

  it("leaves the clusterer permissive about an absent parent, deliberately", () => {
    // The two responsibilities stay apart, and this is the direction that matters:
    // the clusterer sees ONE record set and cannot answer a selection question about
    // the whole corpus, so it must not throw on a parent it simply cannot see. The
    // `ids.has(parent)` guard in `buildClusters` is what keeps it permissive, and it
    // stays even though the command path now guarantees every parent resolves.
    expect(PARENT_LINKAGE_AXES).toContain("humanSeed");
    expect(axisConnectivity("humanSeed")).toEqual({
      sharedValue: false,
      parentLinkage: true,
    });
  });
});

// --- o CRITÉRIO da lista de união ------------------------------------------

describe("a lista de união tem critério, e o critério é verificável eixo por eixo", () => {
  // TODO eixo de `GROUP_KEYS` identifica MATERIAL — é membro de `EXPOSURE_IDENTITY_AXES`,
  // a lista que o ledger EXECUTA para decidir que a mesma unidade de amostragem
  // reapareceu —, ou a união por ele é INERTE sobre o corpo montado, ou ele modela uma
  // dependência da FAMÍLIA CERTIFICADORA cuja união é VIÁVEL porque o corpo é construído
  // para ser. É condição NECESSÁRIA, e a recíproca é FALSA: `humanSeed` cumpre a primeira
  // perna e é de LINHAGEM, `extractionRun` cumpre a segunda e é DIAGNÓSTICO,
  // `generatorFamily` cumpre a terceira e é RESÍDUO, e `generatorVersion` cumpre a terceira
  // na forma mais forte que existe — a identidade dele É a da família em toda linha montada —
  // e é REPORTADO. Os quatro têm teste próprio, os três primeiros abaixo e o quarto em
  // benchmark/tests/split-audit.test.ts, porque um "se e somente se" aqui concluiria que
  // `humanSeed` deve entrar na lista de união — a mudança que o contrato recusou.
  //
  // A segunda perna é medição e não argumento, e a forma dela é: apagar a identidade do
  // eixo em toda linha não muda o número de componentes. A TERCEIRA não é uma propriedade
  // do corpo e sim uma OBRIGAÇÃO imposta a ele, então a forma dela é um par de medições —
  // a forma que os pools produzem é RECUSADA e a geometria de ilhas é ACEITA, as duas sob a
  // MESMA lista de união.
  //
  // A lista de material é IMPORTADA de benchmark/cluster-exposure-ledger.ts e nunca
  // restatada: uma cópia deixaria o ledger passar a comparar um eixo que o splitter não
  // une, com os dois lados verdes sobre listas diferentes.
  const casoNomeado = (nome: string): ViabilityCase =>
    CATALOGUE.cases.find((entry) => entry.name === nome) as ViabilityCase;
  const CORPO = buildCatalogueCorpus(
    casoNomeado("forma-medida-da-classe-gerada"),
    CATALOGUE.generatedStratum,
  );
  const ILHAS = buildCatalogueCorpus(
    casoNomeado("ilhas-de-receita-que-passam"),
    CATALOGUE.generatedStratum,
  );
  const COM_HUMANAS = buildCatalogueCorpus(
    casoNomeado("lote-unico-por-celula"),
    CATALOGUE.generatedStratum,
  );

  /** O mesmo corpo com a identidade de um eixo apagada em toda linha. */
  function semOEixo(
    records: readonly BenchmarkRecord[],
    axis: string,
  ): BenchmarkRecord[] {
    return records.map((record) => {
      const groups = { ...(record.groups as Record<string, unknown>) };
      // `unknown` e não a remoção da chave: `groupAxisIdentity` lê os dois como "esta
      // linha não se une a ninguém aqui", e manter a chave mantém o registro na forma
      // que o esquema declara.
      groups[axis] = { state: "unknown", reason: "medição de inércia" };
      return { ...record, groups } as unknown as BenchmarkRecord;
    });
  }

  function componentes(records: readonly BenchmarkRecord[]): number {
    return new Set(connectedComponentRoots(records).values()).size;
  }

  /** Os tamanhos dos componentes, para a ponta que precisa da FRAÇÃO e não da contagem. */
  function tamanhos(records: readonly BenchmarkRecord[]): number[] {
    const porRaiz = new Map<string, number>();
    for (const raiz of connectedComponentRoots(records).values()) {
      porRaiz.set(raiz, (porRaiz.get(raiz) ?? 0) + 1);
    }
    return [...porRaiz.values()];
  }

  it("admite cada eixo por MATERIAL, por INÉRCIA ou por VIABILIDADE IMPOSTA, e o laço percorre todos", () => {
    const porMaterial: string[] = [];
    const porInercia: string[] = [];
    const porImposta: string[] = [];
    for (const axis of GROUP_KEYS) {
      // EXACTAMENTE UMA perna, contada antes de qualquer medição: um `any` aqui deixaria
      // um eixo entrar por duas justificações e nenhuma delas ser a que decide.
      const pernas = [
        (EXPOSURE_IDENTITY_AXES as readonly string[]).includes(axis),
        (INERT_UNION_AXES as readonly string[]).includes(axis),
        (IMPOSED_UNION_AXES as readonly string[]).includes(axis),
      ];
      expect(pernas.filter(Boolean), axis).toHaveLength(1);
      if (pernas[0]) {
        porMaterial.push(axis);
        continue;
      }
      if (pernas[1]) {
        porInercia.push(axis);
        // A perna de INÉRCIA, medida: apagar a identidade do eixo em toda linha não muda o
        // número de componentes.
        expect(componentes(semOEixo(CORPO, axis)), axis).toBe(
          componentes(CORPO),
        );
        continue;
      }
      porImposta.push(axis);
      // A perna IMPOSTA, e o que se mede POR EIXO é que a perna (b) não estava disponível:
      // sobre o corpo que existe, apagar a identidade deste eixo MUDA a contagem de
      // componentes. É a medição de inércia acima com o sinal trocado, sobre o mesmo corpo.
      expect(componentes(semOEixo(CORPO, axis)), axis).not.toBe(
        componentes(CORPO),
      );
    }
    // A VIABILIDADE é medida nas DUAS pontas e sob a MESMA lista de união de produção: o
    // corpo que ignora o plano de ilhas deixa um componente de 641 das 1170 linhas, que
    // partição alguma recebe, e o que cumpre o plano deixa um componente por template. Uma
    // ponta só não distingue "obrigação cumprível" de "eixo que colapsa sempre".
    if (porImposta.length > 0) {
      expect(componentes(CORPO)).toBe(4);
      expect(Math.max(...tamanhos(CORPO)) / 1170).toBeCloseTo(0.547863, 6);
      expect(componentes(ILHAS)).toBe(40);
    }
    // Não vácuo nas TRÊS pernas: cada uma tem entrada, e um laço que caísse todo numa delas
    // deixaria as outras sem medição alguma.
    expect(porMaterial).toEqual(["author", "source", "derivationRoot"]);
    // E as duas outras pernas são as LISTAS publicadas, não constantes deste teste: quem lê
    // `INERT_UNION_AXES` e `IMPOSED_UNION_AXES` fica sabendo por que cada eixo entrou, e um
    // eixo posto na união sem nenhuma das três cai aqui em vez de chegar com um parágrafo.
    // Por IGUALDADE, e não por pertinência.
    expect(porInercia).toEqual([...INERT_UNION_AXES]);
    expect(porImposta).toEqual([...IMPOSED_UNION_AXES]);
    for (const axis of [...INERT_UNION_AXES, ...IMPOSED_UNION_AXES]) {
      expect(GROUP_KEYS as readonly string[], axis).toContain(axis);
      expect(EXPOSURE_IDENTITY_AXES as readonly string[], axis).not.toContain(
        axis,
      );
    }
  });

  it("mede a inércia de verdade: um eixo que colapsa a classe NÃO passa nela", () => {
    // O contraste que faz da perna de inércia uma medição. Sem ele qualquer eixo passaria,
    // inclusive um que põe uma célula de quota inteira num componente.
    //
    // Ancorado em `domainSource` SOBRE CORPO COM LINHA HUMANA, e as duas coisas são
    // necessárias: `promptTemplate` já está na união, então `[...GROUP_KEYS, "promptTemplate"]`
    // é no-op e mediria a si mesmo; e sobre a classe gerada `domainSource` é um valor único
    // por lane, então o contraste ali confundiria "não é inerte" com "colapsa a lane".
    const base = componentes(COM_HUMANAS);
    const comOEixo = new Set(
      componentsUnderAxes(
        COM_HUMANAS,
        [...GROUP_KEYS, "domainSource"],
        [...PARENT_LINKAGE_AXES],
      ).values(),
    ).size;
    expect(comOEixo).not.toBe(base);
    // E o contraste é FORTE e não marginal: quarenta componentes viram quatro, um por
    // célula, que é a degenerescência que a perna de inércia tem de recusar.
    expect(base).toBe(40);
    expect(comOEixo).toBe(4);
  });

  it("não deixa nenhum eixo de material fora das duas relações", () => {
    // A recíproca. Sem ela a lista poderia PERDER um eixo de material e ficar verde:
    // o ledger continuaria barrando pela reaparição de uma unidade que o splitter
    // espalhou por duas partições.
    const relacoes = new Set<string>([...GROUP_KEYS, ...PARENT_LINKAGE_AXES]);
    for (const axis of EXPOSURE_IDENTITY_AXES) {
      expect(relacoes, axis).toContain(axis);
    }
  });

  it("torna `humanSeed` como eixo de VALOR inerte quando a semente resolve", () => {
    // O que o comentário de `AxisConnectivity` afirma, medido. Com a linha da semente
    // PRESENTE — o único estado que `assertDerivedParentsResolve` admite no caminho de
    // comando — a linhagem de pai já une as duas gerações através dela, então acrescentar
    // a relação de VALOR não muda componente algum. Sem esta medição a frase é argumento.
    let seedRaw: Record<string, unknown> = {
      ...v4Human(),
      id: "h_seed",
      createdAt: 1,
    };
    seedRaw = withAxis(seedRaw, "author", known("au_hmac_seed"));
    seedRaw = withAxis(seedRaw, "source", known("th_doc_seed"));
    seedRaw = withAxis(seedRaw, "nearDuplicate", known("nd_seed"));
    const seed = validateBenchmarkRecordV4(
      seedRaw,
    ) as unknown as BenchmarkRecord;
    const siblings = [1, 2, 3].map((index) => {
      let raw: Record<string, unknown> = {
        ...v4Ai(),
        id: `a_sibling_${index}`,
        createdAt: index + 1,
      };
      raw = withAxis(raw, "promptTemplate", known(`pt_${index}`));
      raw = withAxis(raw, "generatorVersion", known(`gv_${index}`));
      raw = withAxis(raw, "generationBatch", known(`gb_${index}`));
      raw = withAxis(raw, "nearDuplicate", known(`nd_${index}`));
      raw = withAxis(raw, "humanSeed", known("h_seed"));
      return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
    });
    const records = [seed, ...siblings];
    // Não vácuo: as três irmãs realmente compartilham a semente, e ela ESTÁ no conjunto.
    expect(
      new Set(siblings.map((row) => groupAxisIdentity(row, "humanSeed"))),
    ).toEqual(new Set(["h_seed"]));
    expect(records.map((row) => row.id)).toContain("h_seed");

    const semValor = componentsUnderAxes(
      records,
      [...GROUP_KEYS],
      [...PARENT_LINKAGE_AXES],
    );
    const comValor = componentsUnderAxes(
      records,
      [...GROUP_KEYS, "humanSeed"],
      [...PARENT_LINKAGE_AXES],
    );
    expect([...comValor]).toEqual([...semValor]);
    // E o componente é UM: semente e gerações caem juntas, que é o que a linhagem compra.
    expect(new Set(semValor.values()).size).toBe(1);

    // A contraparte, que é o que a frase NÃO afirma: com a semente AUSENTE as duas
    // relações divergem, e é por isso que a medição vale só no caminho de comando.
    const ausente = componentsUnderAxes(
      siblings,
      [...GROUP_KEYS],
      [...PARENT_LINKAGE_AXES],
    );
    const ausenteComValor = componentsUnderAxes(
      siblings,
      [...GROUP_KEYS, "humanSeed"],
      [...PARENT_LINKAGE_AXES],
    );
    expect(new Set(ausente.values()).size).toBe(3);
    expect(new Set(ausenteComValor.values()).size).toBe(1);
  });

  it("faz o caminhador local reproduzir a conectividade de produção, raiz por raiz", () => {
    // O preço de medir "e se este eixo unisse": `connectedComponentRoots` lê `GROUP_KEYS`
    // do módulo e um const exportado não se substitui em tempo de execução, então a
    // medição usa um caminhador local. Esta asserção é o que impede que ele seja uma
    // segunda autoridade — entregues as listas de produção, os dois têm de dar as MESMAS
    // raízes, e não só o mesmo número de componentes.
    for (const entry of CATALOGUE.cases) {
      const records = buildCatalogueCorpus(entry, CATALOGUE.generatedStratum);
      expect(
        [
          ...componentsUnderAxes(
            records,
            [...GROUP_KEYS],
            [...PARENT_LINKAGE_AXES],
          ),
        ],
        entry.name,
      ).toEqual([...connectedComponentRoots(records)]);
    }
  });

  it("tem RECÍPROCA FALSA, e os TRÊS eixos que a refutam estão nomeados", () => {
    // `humanSeed` cumpre a perna (a) — o ledger o EXECUTA como identidade de material —
    // e não está em `GROUP_KEYS`. Lido como bicondicional, o critério conclui que ele
    // deve entrar, que é a mudança recusada.
    expect(EXPOSURE_IDENTITY_AXES as readonly string[]).toContain("humanSeed");
    expect(GROUP_KEYS as readonly string[]).not.toContain("humanSeed");
    expect(groupAxisRole("humanSeed")).toBe("parentLinkage");

    // `extractionRun` cumpre a perna (b) — MEDIDO, e é o que faz disto refutação e não
    // observação: sobre o corpo montado a união por ele não muda componente algum,
    // porque `notApplicable` em toda linha gerada não une nada. E ele é DIAGNÓSTICO.
    //
    // O ESCOPO é a classe gerada, que é o corpo que existe. Sobre um corpo com linha
    // humana o mesmo eixo NÃO é inerte — uma extração escreve milhares de linhas com um
    // id de execução —, e essa medição está no espelho do lab
    // (`test_a_reciproca_do_criterio_e_FALSA_nos_dois_sentidos`). Cumprir (b) num corpo
    // não é licença para unir, e é por isso que o critério não é bicondicional.
    const comOEixo = new Set(
      componentsUnderAxes(
        CORPO,
        [...GROUP_KEYS, "extractionRun"],
        [...PARENT_LINKAGE_AXES],
      ).values(),
    ).size;
    expect(comOEixo).toBe(componentes(CORPO));
    expect(GROUP_KEYS as readonly string[]).not.toContain("extractionRun");
    expect(groupAxisRole("extractionRun")).toBe("diagnostic");

    // `generatorFamily` cumpre a perna (c) — é o nível de TOPO de `ai-recall`, a linha da
    // tabela de reamostragem que o recall certificado usa — e NÃO está em `GROUP_KEYS`. É o
    // refutador mais incómodo dos três, porque a razão de ele ficar fora é uma que (c) não
    // vê (é `inventoryOnly`, e o que a árvore faz por ele é mais estreito que agrupar) e
    // porque a família é DIVISÍVEL aqui: com `generatorVersion` REPORTADO em vez de unido,
    // nenhum membro desta lista carrega a identidade dela, e o que a constrange é a reserva
    // OOD e não o splitter. A identidade dos dois é MEDIDA igual em toda linha montada dos
    // pools (`GeneratorVersionIsTheFamilyTests`, no espelho do lab), então particionar a
    // versão custaria um id de modelo por ilha — que é a razão de ela não estar na lista. O
    // resíduo está escrito no comentário de `GROUP_KEYS`, e esta asserção é o que o mantém
    // preso.
    expect(
      PREREGISTRATION_V4.resampling.estimandClasses["ai-recall"].levels.map(
        (level) => level.axis,
      ),
    ).toContain("groups.generatorFamily");
    expect(GROUP_KEYS as readonly string[]).not.toContain("generatorFamily");
    expect(IMPOSED_UNION_AXES as readonly string[]).not.toContain(
      "generatorFamily",
    );
    expect(groupAxisRole("generatorFamily")).toBe("inventoryOnly");
  });
});

// --- as quatro situações, e o resíduo que nenhuma delas cobre ----------------

describe("toda situação de eixo é decidida por lista, e o resíduo é declarado", () => {
  /**
   * A situação de cada eixo v4 e a lista que a decide. RESTATADA e não derivada: uma
   * tabela lida de `groupAxisRole` concordaria com qualquer implementação, inclusive uma
   * que devolvesse `inventoryOnly` para os catorze.
   *
   * `identificaMaterial` é a perna (a) do critério da união, e está aqui para que cada
   * linha diga POR QUE: é o que separa `humanSeed` (material, e ainda assim de linhagem)
   * de `generationLane` (não material, e sem lista alguma).
   */
  const SITUACAO: Record<
    V4GroupAxis,
    { papel: GroupAxisRole; identificaMaterial: boolean }
  > = {
    author: { papel: "unionByValue", identificaMaterial: true },
    source: { papel: "unionByValue", identificaMaterial: true },
    derivationRoot: { papel: "unionByValue", identificaMaterial: true },
    generationBatch: { papel: "unionByValue", identificaMaterial: false },
    nearDuplicate: { papel: "unionByValue", identificaMaterial: false },
    humanSeed: { papel: "parentLinkage", identificaMaterial: true },
    generatorVersion: { papel: "namedReported", identificaMaterial: false },
    promptTemplate: { papel: "unionByValue", identificaMaterial: false },
    domainSource: { papel: "namedReported", identificaMaterial: false },
    sourceMaterialBatch: { papel: "namedReported", identificaMaterial: false },
    extractionRun: { papel: "diagnostic", identificaMaterial: false },
    generatorFamily: { papel: "inventoryOnly", identificaMaterial: false },
    generationLane: { papel: "inventoryOnly", identificaMaterial: false },
    harnessVersion: { papel: "inventoryOnly", identificaMaterial: false },
  };

  it("percorre os CATORZE e afirma, por eixo, a situação e a lista que a decide", () => {
    // O laço é sobre `V4_GROUP_AXES` e não sobre as chaves da tabela: uma tabela à qual
    // faltasse um eixo passaria percorrendo a si mesma.
    expect(V4_GROUP_AXES).toHaveLength(14);
    for (const axis of V4_GROUP_AXES) {
      const esperado = SITUACAO[axis];
      expect(esperado, axis).toBeDefined();
      expect(groupAxisRole(axis), axis).toBe(esperado.papel);
      expect(
        (EXPOSURE_IDENTITY_AXES as readonly string[]).includes(axis),
        axis,
      ).toBe(esperado.identificaMaterial);

      // O POR QUÊ, e não só o rótulo: cada situação é pertença a UMA lista e ausência
      // das outras três. Sem esta metade, um `groupAxisRole` que ignorasse as listas e
      // devolvesse a tabela de cor passaria.
      const emUniao = (GROUP_KEYS as readonly string[]).includes(axis);
      const emLinhagem = (PARENT_LINKAGE_AXES as readonly string[]).includes(
        axis,
      );
      const emReportado = (REPORTED_GROUP_AXES as readonly string[]).includes(
        axis,
      );
      const emDiagnostico = (
        PREREGISTRATION_V4.connectivity.diagnosticAxes as readonly string[]
      ).includes(axis);
      switch (esperado.papel) {
        case "unionByValue":
          expect([emUniao, emReportado, emDiagnostico], axis).toEqual([
            true,
            false,
            false,
          ]);
          // A ÚNICA sobreposição admitida, e ela é nomeada: `derivationRoot` carrega as
          // duas relações, e o papel nomeia a mais forte. `axisConnectivity` é quem
          // publica o par.
          expect(emLinhagem, axis).toBe(axis === "derivationRoot");
          break;
        case "parentLinkage":
          expect(
            [emUniao, emLinhagem, emReportado, emDiagnostico],
            axis,
          ).toEqual([false, true, false, false]);
          break;
        case "namedReported":
          expect(
            [emUniao, emLinhagem, emReportado, emDiagnostico],
            axis,
          ).toEqual([false, false, true, false]);
          break;
        case "diagnostic":
          expect(
            [emUniao, emLinhagem, emReportado, emDiagnostico],
            axis,
          ).toEqual([false, false, false, true]);
          break;
        case "inventoryOnly":
          // O RESÍDUO: nenhuma das quatro listas o nomeia. O que ele tem é o inventário
          // por partição, e o inventário vem de `ALL_GROUP_AXES` filtrado pelo que os
          // REGISTROS declaram — por isso ele não desaparece do artefato selado.
          expect(
            [emUniao, emLinhagem, emReportado, emDiagnostico],
            axis,
          ).toEqual([false, false, false, false]);
          expect(ALL_GROUP_AXES as readonly string[], axis).toContain(axis);
          break;
      }
    }
  });

  it("é TOTAL e EXCLUSIVA: cada eixo cai em uma situação, e as cinco têm conteúdo", () => {
    // Total sobre o vocabulário INTEIRO e não só sobre v4: `collectionBatch` é v3-only e
    // também é resíduo, então uma auditoria de corpo misto encontra papel para ele.
    const porPapel = new Map<GroupAxisRole, string[]>(
      GROUP_AXIS_ROLES.map((papel) => [papel, []]),
    );
    for (const axis of ALL_GROUP_AXES) {
      porPapel.get(groupAxisRole(axis))?.push(axis);
    }
    expect(ALL_GROUP_AXES).toHaveLength(15);
    // Ordenado dos dois lados: a ordem aqui é a de `ALL_GROUP_AXES` e a das listas é a
    // delas, e o que se afirma é o CONJUNTO de cada situação.
    const sorted = (papel: GroupAxisRole): string[] =>
      [...(porPapel.get(papel) as string[])].sort();
    expect(sorted("unionByValue")).toEqual([...GROUP_KEYS].sort());
    expect(sorted("parentLinkage")).toEqual(["humanSeed"]);
    expect(sorted("namedReported")).toEqual([...REPORTED_GROUP_AXES].sort());
    expect(sorted("diagnostic")).toEqual(["extractionRun"]);
    // O resíduo, ESCRITO. Enquanto ele está aqui, ninguém pode ler "todo outro eixo é
    // reportado" da lista de união: quatro eixos desmentem a frase.
    expect(sorted("inventoryOnly")).toEqual([
      "collectionBatch",
      "generationLane",
      "generatorFamily",
      "harnessVersion",
    ]);
    // Nenhuma das cinco vazia — uma situação sem entrada é uma situação que nenhum
    // laço deste arquivo exercita.
    for (const papel of GROUP_AXIS_ROLES) {
      expect(porPapel.get(papel), papel).not.toHaveLength(0);
    }
  });

  it("mantém `generatorFamily` no resíduo com o que o mecanismo faz por ele, e nada mais", () => {
    // O resíduo não é "não carrega dependência". `generatorFamily` carrega, e o que a
    // árvore faz é MAIS ESTREITO que agrupar: só as famílias RESERVADAS são restringidas,
    // e só a serem de `test`. Chamá-lo reportado ou diagnóstico nomearia uma
    // responsabilidade que ninguém assumiu.
    expect(groupAxisRole("generatorFamily")).toBe("inventoryOnly");
    expect(axisConnectivity("generatorFamily")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
    expect(REPORTED_GROUP_AXES as readonly string[]).not.toContain(
      "generatorFamily",
    );
  });
});
