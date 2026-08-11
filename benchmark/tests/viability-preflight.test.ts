// O preflight de viabilidade de partição: as condições NECESSÁRIAS que o splitter impõe
// por pôr o componente conexo inteiro numa única partição E comparar fração POR CLASSE.
//
// O catálogo de corpos vive em `fixtures/viability-agreement.json` e é lido pelos DOIS
// lados — este arquivo e `benchmark/lab/test_connectivity_feasibility.py`. É o que
// torna a concordância mensurável: um catálogo por lado deixaria cada um provar a
// própria regra sobre o próprio corpo, que é a forma de discordar sem que nada fique
// vermelho.
//
// Nada aqui abre partição cega: todos os corpos são sintéticos e montados em memória.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runPreflightViability } from "../commands/preflight-viability.ts";
import {
  PREREGISTRATION_V4,
  type PreregistrationV4,
} from "../preregistration-v4.ts";
import {
  groupAxisIdentity,
  validateBenchmarkRecordV4,
  type BenchmarkRecord,
  type GroupAxis,
} from "../schema.ts";
import { PARTITION_TARGETS } from "../split-audit.ts";
import {
  CLASS_TOLERANCE,
  GROUP_KEYS,
  PARENT_LINKAGE_AXES,
  SplitConstraintError,
  atMostWithinTolerance,
  connectedComponentRoots,
  createBlockedSplit,
  type BlockedSplitPolicy,
} from "../split.ts";
import {
  CORPUS_SCOPE,
  PARTITION_VIABILITY_NOT_MET,
  VIABILITY_BREACH_KINDS,
  VIABILITY_NECESSARY_NOT_SUFFICIENT,
  auditPartitionViability,
  describeViabilityBreaches,
  describeViabilityInventory,
  viabilityScope,
  type ViabilityBreach,
  type ViabilityReport,
} from "../viability-preflight.ts";
import {
  buildCatalogueCorpus,
  componentHistogram,
  declaredHistogram,
  histogramUnderAxes,
  loadCatalogue,
  measuredClassLines,
  type ViabilityCase,
} from "./helpers/viability-catalogue.ts";

const CATALOGUE = await loadCatalogue();
const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * The same five fractions `commands/split.ts` hands the splitter.
 *
 * Written as literals because `BlockedSplitPolicy.fractions` pins each one as a LITERAL
 * TYPE, so `Record<Partition, number>` does not satisfy it. The drift that would
 * otherwise hide here — the preflight leg reading new pre-registered fractions while the
 * splitter leg still ran the old ones, both green — is closed by asserting this object
 * against `PARTITION_TARGETS` and `CLASS_TOLERANCE` below.
 */
const SPLIT_POLICY: BlockedSplitPolicy = {
  fractions: { train: 0.45, dev: 0.05, "cal-A": 0.1, "cal-B": 0.2, test: 0.2 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [],
  seed: PREREGISTRATION_V4.seeds.split,
};

function caseNamed(name: string): ViabilityCase {
  const found = CATALOGUE.cases.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`o catálogo compartilhado não declara o caso "${name}"`);
  }
  return found;
}

function corpusOf(testCase: ViabilityCase): BenchmarkRecord[] {
  return buildCatalogueCorpus(testCase, CATALOGUE.generatedStratum);
}

function breachPairs(
  report: ViabilityReport,
): { scope: string; kind: string }[] {
  return report.breaches.map((breach) => ({
    scope: breach.scope,
    kind: breach.kind,
  }));
}

/**
 * The root a refusal names is an id of a line of the very component it describes, and
 * the component holds exactly the reported number of lines OF THAT SCOPE.
 *
 * Without this the "names the component" assertions are tautological: they build the
 * expected string out of the root the report itself produced, so any value would pass.
 */
function expectRootDescribesItsComponent(
  records: readonly BenchmarkRecord[],
  breach: ViabilityBreach,
): void {
  const component = breach.component;
  if (component === null) {
    throw new Error(`a recusa ${breach.kind} não nomeia componente`);
  }
  const rootById = connectedComponentRoots(records);
  expect(rootById.get(component.root)).toBe(component.root);
  const lines = records.filter(
    (record) =>
      rootById.get(record.id) === component.root &&
      (breach.scope === CORPUS_SCOPE || record.label === breach.scope),
  );
  expect(lines).toHaveLength(component.recordLines);
}

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Writes a corpus as the `records.jsonl` the command reads, and returns its directory. */
async function datasetDirectoryOf(
  records: readonly BenchmarkRecord[],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-preflight-viability-"));
  temporary.push(root);
  await writeFile(
    join(root, "records.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return root;
}

describe("o catálogo compartilhado descreve a geometria que declara", () => {
  it("nomeia os dois alvos extremos, e o preflight lê os mesmos", () => {
    const report = auditPartitionViability(
      corpusOf(caseNamed("lote-unico-por-celula")),
    );
    expect(report.largestTarget).toEqual({
      partition: CATALOGUE.extremeTargets.largest.partition,
      fraction: CATALOGUE.extremeTargets.largest.fraction,
    });
    expect(report.smallestTarget).toEqual({
      partition: CATALOGUE.extremeTargets.smallest.partition,
      fraction: CATALOGUE.extremeTargets.smallest.fraction,
    });
    expect(report.classTolerance).toBe(CATALOGUE.extremeTargets.tolerance);
  });

  it("roda o splitter sob as MESMAS frações pré-inscritas que o preflight lê", () => {
    // A perna do splitter e a do preflight têm de medir um desenho só. Se as frações
    // pré-inscritas mudarem, esta asserção fica vermelha e força atualizar as duas
    // juntas, em vez de uma medir o desenho novo e a outra o velho, as duas verdes.
    expect(SPLIT_POLICY.fractions).toEqual(PARTITION_TARGETS);
    expect(SPLIT_POLICY.classTolerance).toBe(CLASS_TOLERANCE);
  });

  it("declara o vocabulário de recusa do módulo, menos o corpo vazio", () => {
    // Por igualdade, e com `empty-corpus` fora: nenhum corpo do catálogo é vazio (todos
    // declaram linhas), então esse ramo é exercitado direto e não pela concordância.
    expect(VIABILITY_BREACH_KINDS).toEqual([
      "empty-corpus",
      ...CATALOGUE.expectedBreachVocabulary,
    ]);
    for (const testCase of CATALOGUE.cases) {
      for (const breach of testCase.expected.breaches) {
        expect(CATALOGUE.expectedBreachVocabulary).toContain(breach.kind);
        expect([CORPUS_SCOPE, "human", "ai", "mixed"]).toContain(breach.scope);
      }
    }
  });

  it("declara exatamente os corpos que esta suíte mede, por igualdade", () => {
    // Igualdade e não pertinência: apagar um caso do JSON deixaria todo `it.each` verde
    // com uma célula de cobertura a menos, dos dois lados da fronteira de linguagem.
    expect(CATALOGUE.cases.map((entry) => entry.name)).toEqual([
      "lote-unico-por-celula",
      "um-componente-por-celula",
      "so-o-maior-componente",
      "so-o-menor-componente",
      "duas-aquisicoes-25-75",
      "misto-com-degenerescencia-humana",
      "corpo-grosso-classes-finas",
      "bordas-inclusivas-47-e-7",
      "forma-medida-da-classe-gerada",
    ]);
  });

  it.each(CATALOGUE.cases.map((entry) => [entry.name, entry] as const))(
    "materializa %s com a geometria declarada, e os eixos grossos não unem",
    (_name, testCase) => {
      const records = corpusOf(testCase);
      expect(records).toHaveLength(testCase.expected.recordLines);

      // O histograma e as contagens por classe MEDIDOS contra os DECLARADOS. É o que
      // impede que um materializador que divergiu do outro lado passe: os dois leem a
      // mesma declaração e cada um afirma que produziu exatamente ela.
      expect(componentHistogram(records)).toEqual(declaredHistogram(testCase));
      expect(measuredClassLines(records)).toEqual(testCase.expected.classLines);

      // Não vácuo: o estrato e o lote realmente carregam UM valor por célula — é por
      // isso que uni-los colapsaria a célula — e ainda assim não unem nada. Linha
      // gerada não carrega lote de material, então só as identidades DEFINIDAS contam.
      const identities = (axis: GroupAxis): Set<string> =>
        new Set(
          records
            .map((row) => groupAxisIdentity(row, axis))
            .filter((identity): identity is string => identity !== undefined),
        );
      expect(identities("domainSource").size).toBe(
        testCase.expected.distinctStrata,
      );
      expect(identities("sourceMaterialBatch").size).toBe(
        testCase.expected.distinctMaterialBatches,
      );
    },
  );

  it("nomeia o mesmo arquivo de catálogo que a guarda do lab abre", async () => {
    // A concordância só existe sobre um corpo comum. Se o lado Python passasse a ler
    // outro catálogo, os dois seguiriam verdes medindo corpos diferentes. O veredito do
    // outro lado é medido pelo pytest, não aqui; o que se afirma aqui é o ARQUIVO.
    const guardaDoLab = await readFile(
      join(AQUI, "..", "lab", "test_connectivity_feasibility.py"),
      "utf8",
    );
    for (const segment of [
      '"tests"',
      '"fixtures"',
      '"viability-agreement.json"',
    ]) {
      expect(guardaDoLab).toContain(segment);
    }
  });
});

describe("preflight de viabilidade — as condições necessárias", () => {
  it("recusa o corpo cujo maior componente não cabe no maior alvo, nomeando componente, tamanho e alvo", () => {
    const testCase = caseNamed("so-o-maior-componente");
    const records = corpusOf(testCase);
    const report = auditPartitionViability(records);

    expect(report.passed).toBe(false);
    expect(breachPairs(report)).toEqual(testCase.expected.breaches);
    const breach = report.breaches[0];
    expect(breach.kind).toBe("largest-component-exceeds-largest-target");
    expect(breach.scope).toBe(CORPUS_SCOPE);
    expect(breach.component?.recordLines).toBe(60);
    expect(breach.component?.fraction).toBeCloseTo(0.6, 10);
    expect(breach.target).toEqual({ partition: "train", fraction: 0.45 });
    // A raiz é um id de linha do próprio componente, e não um rótulo qualquer.
    expect(breach.component?.root).toBe("h_0_0_0");
    expectRootDescribesItsComponent(records, breach);

    // A mensagem, e não só a estrutura: é a recusa inteira que o operador lê. As TRÊS
    // coisas que o contrato exige que ela nomeie, mais o escopo.
    const message = describeViabilityBreaches(report);
    expect(message).toContain('componente "h_0_0_0"');
    expect(message).toContain("60 de 100 linha(s) do corpo");
    expect(message).toContain('60 de 100 linha(s) da classe "human"');
    expect(message).toContain("train=45.00 %");
    // O ramo do MENOR não pode disparar neste corpo (o menor vale 1 %, e cabe nos
    // 5 %), então a recusa é do maior e de mais nada.
    expect(
      viabilityScope(report, CORPUS_SCOPE).smallestComponent?.recordLines,
    ).toBe(1);
    expect(message).not.toContain("MENOR");
  });

  it("recusa o corpo em que o menor alvo não é preenchível, e a recusa é de granularidade", () => {
    const testCase = caseNamed("so-o-menor-componente");
    const records = corpusOf(testCase);
    const report = auditPartitionViability(records);

    expect(report.passed).toBe(false);
    expect(breachPairs(report)).toEqual(testCase.expected.breaches);
    const breach = report.breaches[0];
    expect(breach.kind).toBe("smallest-component-exceeds-smallest-target");
    expect(breach.component?.recordLines).toBe(2);
    expect(breach.component?.fraction).toBeCloseTo(0.2, 10);
    expect(breach.target).toEqual({ partition: "dev", fraction: 0.05 });
    expect(breach.component?.root).toBe("h_0_0_0");
    expectRootDescribesItsComponent(records, breach);

    const message = describeViabilityBreaches(report);
    expect(message).toContain('componente "h_0_0_0"');
    expect(message).toContain("2 de 10 linha(s) do corpo");
    expect(message).toContain("dev=5.00 %");
    expect(message).toContain("granularidade, não tamanho de corpo");
    // Todo componente CABE no maior alvo (20 % < 45 %), então a condição frouxa está
    // satisfeita e este corpo mede o ramo afiado isoladamente.
    expect(
      viabilityScope(report, CORPUS_SCOPE).largestComponent?.fraction,
    ).toBeCloseTo(0.2, 10);
    expect(
      report.breaches.filter(
        (entry) => entry.kind === "largest-component-exceeds-largest-target",
      ),
    ).toEqual([]);
  });

  it("relata as DUAS quando as duas são violadas, começando pela do maior", () => {
    const testCase = caseNamed("duas-aquisicoes-25-75");
    const report = auditPartitionViability(corpusOf(testCase));
    expect(breachPairs(report)).toEqual(testCase.expected.breaches);
    expect(report.breaches[0].kind).toBe(
      "largest-component-exceeds-largest-target",
    );
    expect(report.breaches[0].scope).toBe(CORPUS_SCOPE);
  });

  it("recusa a degenerescência de UMA CLASSE que o agregado esconde", async () => {
    // O corpo com a forma do corpus ratificado: metade humana grossa, metade gerada
    // fina. É o caso pelo qual a comparação é por classe — no agregado ele passa.
    const testCase = caseNamed("misto-com-degenerescencia-humana");
    const records = corpusOf(testCase);
    const report = auditPartitionViability(records);

    const corpo = viabilityScope(report, CORPUS_SCOPE);
    expect(corpo.largestComponent?.fraction).toBeCloseTo(0.1, 10);
    expect(corpo.smallestComponent?.fraction).toBeCloseTo(0.02, 10);
    // Nenhuma violação no escopo do corpo: os dois extremos agregados cabem nos dois
    // alvos, então uma leitura só agregada APROVA este corpo.
    expect(
      report.breaches.filter((breach) => breach.scope === CORPUS_SCOPE),
    ).toEqual([]);
    expect(breachPairs(report)).toEqual(testCase.expected.breaches);

    const breach = report.breaches[0];
    expect(breach.scope).toBe("human");
    expect(breach.kind).toBe("smallest-component-exceeds-smallest-target");
    expect(breach.component?.recordLines).toBe(5);
    expect(breach.component?.fraction).toBeCloseTo(0.25, 10);
    expectRootDescribesItsComponent(records, breach);
    // A classe gerada é fina e não é recusada: a recusa é de uma classe, nomeada.
    expect(
      viabilityScope(report, "ai").smallestComponent?.fraction,
    ).toBeCloseTo(1 / 30, 10);

    const message = describeViabilityBreaches(report);
    expect(message).toContain('5 de 20 linha(s) da classe "human"');
    expect(message).not.toContain("do corpo");

    // Pelo COMANDO, com a política que ele carrega: a recusa nomeia a classe e o alvo.
    await expect(
      runPreflightViability({
        datasetDirectory: await datasetDirectoryOf(records),
      }),
    ).rejects.toMatchObject({
      code: PARTITION_VIABILITY_NOT_MET,
      message: expect.stringContaining('da classe "human"'),
    });
  });

  it("recusa pelo CORPO o que nenhuma classe recusa", () => {
    // A direção contrária, e a razão de o escopo do corpo não ser decoração: toda
    // classe tem componente fino, e no agregado nenhum componente cabe em 5 %.
    const testCase = caseNamed("corpo-grosso-classes-finas");
    const report = auditPartitionViability(corpusOf(testCase));
    expect(breachPairs(report)).toEqual(testCase.expected.breaches);
    expect(report.breaches[0].scope).toBe(CORPUS_SCOPE);
    for (const scope of ["human", "ai"] as const) {
      const inventory = viabilityScope(report, scope);
      expect(inventory.smallestComponent?.fraction).toBeCloseTo(0.05, 10);
      expect(
        report.breaches.filter((breach) => breach.scope === scope),
      ).toEqual([]);
    }
  });

  it("passa nas duas bordas inclusivas, que é onde a tolerância é carga", () => {
    // 47 % = 45 % + 2 pp e 7 % = 5 % + 2 pp: as duas condições passam RASPANDO, então
    // uma tolerância zero recusaria as duas.
    const testCase = caseNamed("bordas-inclusivas-47-e-7");
    const records = corpusOf(testCase);
    const report = auditPartitionViability(records);
    expect(report.passed).toBe(true);
    expect(report.breaches).toEqual([]);
    const corpo = viabilityScope(report, CORPUS_SCOPE);
    expect(corpo.largestComponent?.fraction).toBe(0.47);
    expect(corpo.smallestComponent?.fraction).toBe(0.07);
    // A borda é INCLUSIVA, e o float destas duas somas está medido: `0.05 + 0.02` dá
    // exatamente 0.07 e `0.45 + 0.02` dá 0.47000000000000003 — as duas erram para CIMA
    // ou não erram. Nestas duas frações congeladas, portanto, é a TOLERÂNCIA que faz a
    // borda passar, e não o épsilon dos comparadores.
    expect(
      report.largestTarget.fraction + report.classTolerance,
    ).toBeGreaterThanOrEqual(0.47);
    expect(
      report.smallestTarget.fraction + report.classTolerance,
    ).toBeGreaterThanOrEqual(0.07);
    // E o splitter o recusa: passar aqui é necessário e NÃO suficiente, medido.
    expect(testCase.expected.splitterRefuses).toBe(true);
    expect(() => createBlockedSplit(records, SPLIT_POLICY)).toThrow(
      /class split fractions unreachable/u,
    );
  });

  it("passa o corpo de lote único por célula, e a saída declara necessário e não suficiente", async () => {
    const testCase = caseNamed("lote-unico-por-celula");
    expect(testCase.expected.breaches).toEqual([]);
    const records = corpusOf(testCase);
    const report = auditPartitionViability(records);

    expect(report.passed).toBe(true);
    expect(report.breaches).toEqual([]);
    expect(report.components).toBe(40);
    expect(
      viabilityScope(report, CORPUS_SCOPE).largestComponent?.fraction,
    ).toBeCloseTo(1 / 40, 10);

    const message = await runPreflightViability({
      datasetDirectory: await datasetDirectoryOf(records),
    });
    expect(message).toContain("40 linha(s) em 40 componente(s)");
    // O inventário do caminho verde carrega os dois extremos e os dois alvos, e é por
    // ele que a política que o COMANDO usa fica pinada: outra política diria outro
    // número aqui e nada mais mudaria.
    expect(message).toContain('maior "h_0_0_0" com 1 linha(s) (2.50 %)');
    expect(message).toContain("train=45.00 % (±2.00 %)");
    expect(message).toContain("dev=5.00 % (±2.00 %)");
    expect(message).toContain('da classe "human"');
    // A declaração, verbatim: um preflight verde é a saída que um leitor pode tomar
    // por corpus divisível, e é aqui que a frase carrega peso.
    expect(message).toContain("necessário e NÃO suficiente");
    expect(message).toContain(VIABILITY_NECESSARY_NOT_SUFFICIENT);
    expect(message).toContain("soma de subconjuntos");
    expect(message).toContain("tolerância de fração por classe");
  });

  it("recusa pelo comando com código próprio, nomeando o componente e o alvo", async () => {
    const records = corpusOf(caseNamed("so-o-maior-componente"));
    const directory = await datasetDirectoryOf(records);
    await expect(
      runPreflightViability({ datasetDirectory: directory }),
    ).rejects.toMatchObject({
      code: PARTITION_VIABILITY_NOT_MET,
      message: expect.stringContaining("60 de 100 linha(s) do corpo"),
    });
    // O alvo, na recusa do COMANDO: é a única asserção que pina a política que ele lê.
    await expect(
      runPreflightViability({ datasetDirectory: directory }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("train=45.00 % (±2.00 %)"),
    });
  });

  it("recusa um diretório sem records.jsonl em vez de ler o corpo como vazio", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-preflight-vazio-"));
    temporary.push(root);
    await expect(
      runPreflightViability({ datasetDirectory: root }),
    ).rejects.toMatchObject({ code: "FILE_MISSING" });
  });

  it("recusa o corpo vazio, que é a ÚNICA recusa mais estrita que o splitter", () => {
    // Pelo comando este ramo é inalcançável: `parseBenchmarkDataset` recusa antes um
    // arquivo sem registro. Ele existe para o chamador direto e pela paridade com a
    // guarda do assembler, que recusa "corpo vazio" pela mesma razão — um corpo sem
    // componente satisfaria todas as comparações e passaria sem nada ter sido medido.
    const report = auditPartitionViability([]);
    expect(report.passed).toBe(false);
    expect(report.components).toBe(0);
    expect(report.scopes.map((inventory) => inventory.scope)).toEqual([
      CORPUS_SCOPE,
    ]);
    expect(breachPairs(report)).toEqual([
      { scope: CORPUS_SCOPE, kind: "empty-corpus" },
    ]);
    expect(describeViabilityBreaches(report)).toContain("corpo vazio");
    expect(describeViabilityInventory(report)).toContain("nenhum componente");
    // A exceção, medida: o splitter ACEITA corpo vazio, devolvendo cinco partições
    // vazias. É a única entrada em que este preflight é deliberadamente mais estrito.
    expect(createBlockedSplit([], SPLIT_POLICY)).toEqual({
      train: [],
      dev: [],
      "cal-A": [],
      "cal-B": [],
      test: [],
    });
  });

  it("lê os alvos da política que recebeu, não de literais compilados", () => {
    // O corpo de cinco componentes de 20 % é recusado sob as frações congeladas e
    // ACEITO sob um desenho cujo menor alvo é 20 %. Só uma política diferente separa
    // "lido da entrada" de "escrito no código".
    const records = corpusOf(caseNamed("so-o-menor-componente"));
    expect(auditPartitionViability(records).passed).toBe(false);

    const evenFifths: PreregistrationV4 = {
      ...PREREGISTRATION_V4,
      preRegistration: {
        ...PREREGISTRATION_V4.preRegistration,
        partitionFractions: {
          train: 0.2,
          dev: 0.2,
          calA: 0.2,
          calB: 0.2,
          test: 0.2,
        },
      },
    };
    const relaxed = auditPartitionViability(records, evenFifths);
    expect(relaxed.largestTarget.fraction).toBe(0.2);
    expect(relaxed.smallestTarget.fraction).toBe(0.2);
    // Empate entre as cinco frações: o desempate é a ordem de PARTITIONS, então o
    // nome relatado não depende de acidente de iteração.
    expect(relaxed.largestTarget.partition).toBe("train");
    expect(relaxed.smallestTarget.partition).toBe("train");
    expect(relaxed.passed).toBe(true);
  });

  it("dá o mesmo veredito, e o mesmo componente nomeado, sob outra ordem de linhas", () => {
    // O extremo é escolhido com desempate declarado (raiz lexicograficamente menor) e
    // os escopos saem em ordem declarada, então embaralhar o corpo não pode mudar nem
    // o veredito nem qual componente a recusa nomeia.
    const records = corpusOf(caseNamed("misto-com-degenerescencia-humana"));
    const reversed = [...records].reverse();
    expect(auditPartitionViability(reversed)).toEqual(
      auditPartitionViability(records),
    );
    expect(
      auditPartitionViability(reversed).scopes.map(
        (inventory) => inventory.scope,
      ),
    ).toEqual([CORPUS_SCOPE, "human", "ai"]);
  });
});

describe("concordância entre a guarda do lab e o preflight", () => {
  // O fixture que o contrato nomeia — lote único por célula — mais os outros do
  // catálogo, porque concordar num corpo viável é o barato: os dois lados concordarem
  // sobre QUAL condição recusa, em QUAL escopo, é o que separa "mesma regra" de "mesmo
  // resultado".
  it.each(CATALOGUE.cases.map((entry) => [entry.name, entry] as const))(
    "julga %s como o catálogo declara, que é o que a guarda do lab afirma do outro lado",
    (_name, testCase) => {
      const report = auditPartitionViability(corpusOf(testCase));
      expect(breachPairs(report)).toEqual(testCase.expected.breaches);
      expect(report.passed).toBe(testCase.expected.breaches.length === 0);
    },
  );
});

describe("o que o splitter faz com os mesmos corpos", () => {
  // A PERNA QUE DÁ SENTIDO À PROVA POR MUTAÇÃO: afrouxar qualquer condição deixaria
  // passar um corpo que o splitter recusa, e é aqui que "o splitter recusa" deixa de
  // ser afirmação e passa a ser medição. A RAZÃO da recusa é afirmada junto da classe
  // do erro, porque `SplitConstraintError` tem dois ramos: o limite do GRID de busca
  // (que não autoriza conclusão sobre o corpus) e a fração por classe.
  it.each(CATALOGUE.cases.map((entry) => [entry.name, entry] as const))(
    "%s: o veredito do splitter é o que o catálogo declara",
    (_name, testCase) => {
      const records = corpusOf(testCase);
      const { splitterRefuses, splitterRefusal, splitSizes } =
        testCase.expected;
      if (splitterRefuses) {
        expect(splitterRefusal).not.toBeNull();
        expect(() => createBlockedSplit(records, SPLIT_POLICY)).toThrow(
          SplitConstraintError,
        );
        expect(() => createBlockedSplit(records, SPLIT_POLICY)).toThrow(
          new RegExp(splitterRefusal ?? "", "u"),
        );
        return;
      }
      const split = createBlockedSplit(records, SPLIT_POLICY);
      // As cinco partições povoadas: um `cal-B` vazio deixaria vácuo justamente o
      // caminho que a viabilidade afirma existir.
      expect(splitSizes).toBeDefined();
      for (const [partition, size] of Object.entries(splitSizes ?? {})) {
        expect(split[partition as keyof typeof split]).toHaveLength(size);
        expect(size).toBeGreaterThan(0);
      }
    },
  );

  it("aprova tudo o que o splitter aceita, e aprova mais que isso", () => {
    const aprovados = CATALOGUE.cases
      .filter((entry) => auditPartitionViability(corpusOf(entry)).passed)
      .map((entry) => entry.name);
    const aceitos = CATALOGUE.cases
      .filter((entry) => !entry.expected.splitterRefuses)
      .map((entry) => entry.name);
    // NECESSIDADE: nada que o splitter aceita é recusado aqui. Uma condição necessária
    // que recusasse um corpus divisível seria uma condição errada, e é isso que a
    // mutação de qualquer uma delas produz.
    for (const aceito of aceitos) expect(aprovados).toContain(aceito);
    // INSUFICIÊNCIA, medida e não declarada: há corpo aprovado que o splitter recusa.
    expect(aprovados).toEqual([
      "lote-unico-por-celula",
      "bordas-inclusivas-47-e-7",
      "forma-medida-da-classe-gerada",
    ]);
    expect(aceitos).toEqual([
      "lote-unico-por-celula",
      "forma-medida-da-classe-gerada",
    ]);
  });
});

// O registro v4 que o materializador produz é válido pelo validador de verdade, e não
// pelo cast: um fixture que só o cast admite mediria uma forma que o corpus não pode
// carregar. O corpo misto passa pelas duas metades do esquema, humana e gerada.
describe("o materializador do catálogo produz registro v4 válido", () => {
  it("passa cada linha pelo validador de esquema", () => {
    const records = corpusOf(caseNamed("misto-com-degenerescencia-humana"));
    const labels = new Set(records.map((record) => record.label));
    expect(labels).toEqual(new Set(["human", "ai"]));
    for (const record of records) {
      expect(
        validateBenchmarkRecordV4(record as unknown as Record<string, unknown>)
          .schemaVersion,
      ).toBe(4);
    }
  });
});

describe("a forma medida da classe gerada, e o que os eixos de receita fariam com ela", () => {
  // O caso que descreve o que o montador PRODUZ: 1170 linhas ai de uma célula, quatro
  // identidades de `promptTemplate` em corridas de 641/231/213/85 e cinco de
  // `generatorVersion` em 493/320/256/99/2. Os fixtures que dão um template por linha
  // provam viabilidade sobre uma classe gerada que ninguém tem, e foi por eles que a
  // inviabilidade atravessou verde.
  const CASO = caseNamed("forma-medida-da-classe-gerada");

  it("realiza as corridas de receita que declara, e cada linha é seu componente", () => {
    const records = corpusOf(CASO);
    expect(records).toHaveLength(1170);
    const recipe = CASO.generatedRecipe;
    expect(recipe).toBeDefined();
    for (const [axis, runs] of [
      ["promptTemplate", recipe!.promptTemplateRuns],
      ["generatorVersion", recipe!.generatorVersionRuns],
    ] as const) {
      const lines = new Map<string, number>();
      for (const record of records) {
        const identity = groupAxisIdentity(record, axis);
        expect(identity, `${axis} em ${record.id}`).toBeDefined();
        lines.set(identity as string, (lines.get(identity as string) ?? 0) + 1);
      }
      expect(
        [...lines.values()].sort((a, b) => b - a),
        axis,
      ).toEqual([...runs].sort((a, b) => b - a));
    }
    // E sob a união do splitter as corridas não unem nada: 1170 componentes.
    expect(componentHistogram(records)).toEqual(
      Array.from({ length: 1170 }, () => 1),
    );
    expect(auditPartitionViability(records).passed).toBe(true);
  });

  it("mede que generatorVersion sozinho CABE, então a exclusão dele é o FECHO DO PAR", () => {
    // Esta medição existe para impedir uma razão falsa de voltar. O comentário de
    // `GROUP_KEYS` já afirmou que `generatorVersion` carrega a identidade de
    // `generatorFamily` — e a medição o refuta em 0 de 1170 linhas: version REFINA family
    // (cinco identidades contra uma), logo unir por version é estritamente mais FRACO que
    // unir pela família, e o argumento da família não alcança este eixo.
    const records = corpusOf(CASO);
    const leg = CASO.expected.recipeUnioned?.generatorVersionOnly;
    expect(leg).toBeDefined();
    const histogram = histogramUnderAxes(
      records,
      [...GROUP_KEYS, ...(leg!.axes as readonly GroupAxis[])],
      [...PARENT_LINKAGE_AXES],
    );
    expect(histogram).toEqual([...leg!.histogram].sort((a, b) => a - b));
    expect(histogram.length).toBe(leg!.components);
    // CABE nas duas condições — é isto que torna o par, e não este eixo, a razão.
    expect(
      atMostWithinTolerance(
        Math.max(...histogram) / records.length,
        0.45,
        CLASS_TOLERANCE,
      ),
    ).toBe(true);
    expect(
      atMostWithinTolerance(
        Math.min(...histogram) / records.length,
        0.05,
        CLASS_TOLERANCE,
      ),
    ).toBe(true);
    expect(leg!.breaches).toEqual([]);
    // E o fato que a prosa afirmava: as duas identidades não coincidem em linha alguma.
    const versoes = new Set(
      records.map((row) => JSON.stringify(row.groups.generatorVersion)),
    );
    const familias = new Set(
      records.map((row) => JSON.stringify(row.groups.generatorFamily)),
    );
    expect(versoes.size).toBe(5);
    expect(familias.size).toBe(1);
    expect(
      records.filter(
        (row) =>
          JSON.stringify(row.groups.generatorVersion) ===
          JSON.stringify(row.groups.generatorFamily),
      ),
    ).toEqual([]);
  });

  it("colapsa quando os eixos de receita entram na união, e recusa pelo MAIOR componente", () => {
    const records = corpusOf(CASO);
    const declared = CASO.expected.recipeUnioned;
    expect(declared).toBeDefined();
    for (const leg of [
      declared!.promptTemplateOnly,
      declared!.bothRecipeAxes,
    ]) {
      const histogram = histogramUnderAxes(
        records,
        [...GROUP_KEYS, ...(leg.axes as readonly GroupAxis[])],
        [...PARENT_LINKAGE_AXES],
      );
      expect(histogram, leg.axes.join("+")).toEqual(
        [...leg.histogram].sort((a, b) => a - b),
      );
      expect(histogram.length, leg.axes.join("+")).toBe(leg.components);
      // A recusa que essa geometria produz, pela condição e pelo escopo que o catálogo
      // declara — e o lado Python afirma os MESMOS pares sobre o MESMO corpo.
      const largest = Math.max(...histogram);
      const smallest = Math.min(...histogram);
      expect(
        atMostWithinTolerance(largest / records.length, 0.45, CLASS_TOLERANCE),
        leg.axes.join("+"),
      ).toBe(false);
      expect(
        atMostWithinTolerance(smallest / records.length, 0.05, CLASS_TOLERANCE),
        leg.axes.join("+"),
      ).toBe(false);
      expect(new Set(leg.breaches.map((breach) => breach.scope))).toEqual(
        new Set([CORPUS_SCOPE, "ai"]),
      );
      expect(new Set(leg.breaches.map((breach) => breach.kind))).toEqual(
        new Set(CATALOGUE.expectedBreachVocabulary),
      );
    }
    // O número que decide: 641 de 1170 é 54,79 % da classe, acima de 45 % + 2 pp.
    expect(
      Math.max(...declared!.promptTemplateOnly.histogram) / records.length,
    ).toBeCloseTo(0.547863, 6);
  });
});
