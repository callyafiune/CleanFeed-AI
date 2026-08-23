import { describe, expect, it } from "vitest";

import {
  clusteredPercentileBootstrap,
  clusteredPercentileBootstrapAll,
  DESCRIPTIVE_ALPHA,
  resolveResampling,
  ResamplingUnitError,
  type ResamplingDesign,
  type ResamplingIdentity,
  type ResamplingLevel,
} from "../bootstrap.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";

const PILOT = PREREGISTRATION_V4.bootstrapReplicates.pilot;
const SEED = PREREGISTRATION_V4.seeds.bootstrap;

interface Row {
  id?: string;
  outer?: string;
  inner?: string;
  parent?: string;
  operation?: string;
  family?: string;
  score?: number;
  state?: "known" | "notApplicable" | "unknown";
}

/** Reads one declared field as an axis identity, with an explicit state. */
function field(
  axis: string,
  read: (row: Row) => string | undefined,
): ResamplingLevel<Row> {
  return {
    axis,
    identity: (row): ResamplingIdentity => {
      if (row.state === "unknown") return { state: "unknown" };
      const value = read(row);
      if (value === undefined) return { state: "notApplicable" };
      return { state: "known", id: value };
    },
  };
}

function chain(
  level: ResamplingLevel<Row>,
  ...fallbacks: ResamplingLevel<Row>[]
) {
  return { declared: level, fallbacks };
}

const OUTER = field("groups.source", (row) => row.outer);
const INNER = field("groups.author", (row) => row.inner);
const PARENT = field("groups.humanSeed", (row) => row.parent);
const OPERATION = field("groups.promptTemplate", (row) => row.operation);
const FAMILY = field("groups.generatorFamily", (row) => row.family);

function hierarchical(
  estimand: string,
  levels: ReadonlyArray<ReturnType<typeof chain>>,
): ResamplingDesign<Row> {
  return { method: "hierarchical", estimand, levels };
}

function multiway(
  estimand: string,
  factors: ReadonlyArray<ReturnType<typeof chain>>,
): ResamplingDesign<Row> {
  return { method: "multiway", estimand, factors };
}

/** Records the weight vector of every replicate; the statistic itself is constant. */
function recorder(): {
  vectors: number[][];
  statistic: (weights: readonly number[]) => number;
} {
  const vectors: number[][] = [];
  return {
    vectors,
    statistic: (weights) => {
      vectors.push([...weights]);
      return 1;
    },
  };
}

function weightedMean(
  clusterOf: readonly number[],
  clusterCount: number,
  values: readonly number[],
): (weights: readonly number[]) => number {
  const sums = new Array<number>(clusterCount).fill(0);
  const counts = new Array<number>(clusterCount).fill(0);
  for (let index = 0; index < values.length; index += 1) {
    sums[clusterOf[index]] += values[index];
    counts[clusterOf[index]] += 1;
  }
  return (weights) => {
    let total = 0;
    let mass = 0;
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const weight = weights[cluster];
      if (weight === 0) continue;
      total += weight * sums[cluster];
      mass += weight * counts[cluster];
    }
    return mass === 0 ? Number.NaN : total / mass;
  };
}

describe("resolveResampling — R6 states are two different answers", () => {
  it("fails on an `unknown` unit, naming the axis and the estimand", () => {
    const rows: Row[] = [
      { outer: "s1", inner: "a1" },
      { outer: "s1", inner: "a2" },
      { state: "unknown" },
    ];
    let thrown: unknown;
    try {
      resolveResampling(
        rows,
        hierarchical("warning.fpr", [chain(OUTER), chain(INNER)]),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResamplingUnitError);
    const error = thrown as ResamplingUnitError;
    expect(error.estimand).toBe("warning.fpr");
    expect(error.axis).toBe("groups.source");
    expect(error.message).toMatch(/warning\.fpr/u);
    expect(error.message).toMatch(/groups\.source/u);
    expect(error.message).toMatch(/unknown/u);
  });

  it("demotes a `notApplicable` unit to the next declared one and records it", () => {
    // Two rows name an author; two are anonymous encyclopedic rows whose next
    // declared unit is the page they came from.
    const rows: Row[] = [
      { outer: "wiki", inner: "ana" },
      { outer: "wiki", inner: "ana" },
      { outer: "wiki" },
      { outer: "wiki" },
    ];
    const page = field("groups.source", (row) => row.outer);
    const resolution = resolveResampling(
      rows,
      hierarchical("warning.fpr", [chain(OUTER), chain(INNER, page)]),
    );
    expect(resolution.declaration.demotions).toEqual([
      { position: 1, from: "groups.author", to: "groups.source", items: 2 },
    ]);
    // `ana` is one unit and the two anonymous rows fall into the page unit.
    expect(resolution.clusterCount).toBe(2);
    expect(resolution.declaration.axes).toEqual([
      "groups.source",
      "groups.author",
    ]);
  });

  it("fails when every declared unit of a level is notApplicable", () => {
    const rows: Row[] = [{ outer: "s1" }, { outer: "s1" }];
    expect(() =>
      resolveResampling(
        rows,
        hierarchical("action.fpr", [chain(OUTER), chain(INNER)]),
      ),
    ).toThrow(/action\.fpr/u);
    expect(() =>
      resolveResampling(
        rows,
        hierarchical("action.fpr", [chain(OUTER), chain(INNER)]),
      ),
    ).toThrow(/notApplicable/u);
  });

  it("publishes the level counts and flags a factor with one level per row", () => {
    const rows: Row[] = [
      { outer: "s1", inner: "a1" },
      { outer: "s1", inner: "a2" },
      { outer: "s2", inner: "a3" },
    ];
    const resolution = resolveResampling(
      rows,
      hierarchical("calibration.ece", [chain(OUTER), chain(INNER)]),
    );
    expect(resolution.declaration.levels).toEqual([
      { position: 0, axis: "groups.source", levels: 2, degenerate: false },
      { position: 1, axis: "groups.author", levels: 3, degenerate: true },
    ]);
    expect(resolution.declaration.degenerate).toBe(true);
    expect(resolution.declaration.items).toBe(3);
    expect(resolution.declaration.units).toBe(3);
  });
});

describe("hierarchical bootstrap — one inner resample per drawn occurrence", () => {
  // Outer `a` holds two inner units, outer `b` holds one. When `a` is drawn
  // twice, the correct estimator resamples a's inner level TWICE
  // INDEPENDENTLY, so a can contribute weight 4 split as (3,1). Multiplying a
  // single inner resample by the outer multiplicity can only ever produce even
  // splits — (4,0), (2,2), (0,4) — and understates the variance.
  const rows: Row[] = [
    { outer: "a", inner: "a1" },
    { outer: "a", inner: "a2" },
    { outer: "b", inner: "b1" },
  ];
  const design = hierarchical("recall", [chain(OUTER), chain(INNER)]);

  it("draws the inner level again for each occurrence of the outer level", () => {
    const resolution = resolveResampling(rows, design);
    const { vectors, statistic } = recorder();
    clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
    });
    const a1 = resolution.clusterOf[0];
    const a2 = resolution.clusterOf[1];
    const oddSplitOfFour = vectors.some(
      (weights) => weights[a1] + weights[a2] === 4 && weights[a1] % 2 === 1,
    );
    expect(oddSplitOfFour).toBe(true);
    // Every replicate still draws exactly two outer occurrences, each of which
    // contributes exactly as many inner draws as that outer holds.
    for (const weights of vectors) {
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      expect(total === 2 || total === 3 || total === 4).toBe(true);
    }
  });
});

describe("multiway bootstrap — pigeonhole weights, never nesting", () => {
  const rows: Row[] = [
    { parent: "p1", operation: "humanizar" },
    { parent: "p1", operation: "parafrasear" },
    { parent: "p2", operation: "humanizar" },
    { parent: "p2", operation: "parafrasear" },
  ];
  const crossed = multiway("mixed", [chain(PARENT), chain(OPERATION)]);
  const nested = hierarchical("mixed", [chain(PARENT), chain(OPERATION)]);

  it("multiplies independent per-factor weights cell by cell", () => {
    const resolution = resolveResampling(rows, crossed);
    const { vectors, statistic } = recorder();
    clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
    });
    const cell = rows.map((_, index) => resolution.clusterOf[index]);
    const seen = new Set(vectors.map((weights) => weights.join(",")));
    // The outer product of two 2-level multinomials: total weight is always
    // p * q = 4, and every cell weight is a product of the two factor counts.
    for (const weights of vectors) {
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(4);
      const w11 = weights[cell[0]];
      const w12 = weights[cell[1]];
      const w21 = weights[cell[2]];
      const w22 = weights[cell[3]];
      // Rank-one by construction: w11 * w22 === w12 * w21.
      expect(w11 * w22).toBe(w12 * w21);
    }
    // The anti-diagonal pattern is reachable ONLY by nesting the operation
    // inside the parent, and the pigeonhole bootstrap never produces it.
    const antiDiagonal = [0, 0, 0, 0];
    antiDiagonal[cell[0]] = 2;
    antiDiagonal[cell[3]] = 2;
    expect(seen.has(antiDiagonal.join(","))).toBe(false);
    // The uniform pattern (both factors drawn once each) is reachable.
    expect(seen.has([1, 1, 1, 1].join(","))).toBe(true);
  });

  it("reaches the anti-diagonal only when the crossed factors are nested", () => {
    const resolution = resolveResampling(rows, nested);
    const { vectors, statistic } = recorder();
    clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
    });
    const cell = rows.map((_, index) => resolution.clusterOf[index]);
    const antiDiagonal = [0, 0, 0, 0];
    antiDiagonal[cell[0]] = 2;
    antiDiagonal[cell[3]] = 2;
    const seen = new Set(vectors.map((weights) => weights.join(",")));
    expect(seen.has(antiDiagonal.join(","))).toBe(true);
  });

  it("gives a different interval from the nested design on the same data", () => {
    const values = [0.9, 0.1, 0.85, 0.15];
    const crossedResolution = resolveResampling(rows, crossed);
    const nestedResolution = resolveResampling(rows, nested);
    const crossedInterval = clusteredPercentileBootstrap(crossedResolution, {
      iterations: PILOT,
      seed: SEED,
      statistic: weightedMean(
        crossedResolution.clusterOf,
        crossedResolution.clusterCount,
        values,
      ),
    });
    const nestedInterval = clusteredPercentileBootstrap(nestedResolution, {
      iterations: PILOT,
      seed: SEED,
      statistic: weightedMean(
        nestedResolution.clusterOf,
        nestedResolution.clusterCount,
        values,
      ),
    });
    expect(crossedInterval.method).toBe("multiway-cluster-percentile");
    expect(nestedInterval.method).toBe("hierarchical-cluster-percentile");
    expect(crossedInterval.upper95 - crossedInterval.lower95).not.toBe(
      nestedInterval.upper95 - nestedInterval.lower95,
    );
  });
});

describe("intra-cluster correlation widens the interval", () => {
  // Twenty units of five rows each. Within a unit every row carries the same
  // value, so the effective sample size is 20, not 100. A bootstrap that
  // resamples rows sees 100 independent draws and reports an interval that is
  // too narrow — the exact defect this module exists to remove.
  const rows: Row[] = [];
  const values: number[] = [];
  for (let unit = 0; unit < 20; unit += 1) {
    const value = unit % 2 === 0 ? 0.05 : 0.95;
    for (let row = 0; row < 5; row += 1) {
      rows.push({
        id: `row-${unit}-${row}`,
        outer: "pool",
        inner: `unit-${unit}`,
        score: value,
      });
      values.push(value);
    }
  }

  it("is wider than the per-row design on the same data", () => {
    const clustered = resolveResampling(
      rows,
      hierarchical("calibration.ece", [chain(OUTER), chain(INNER)]),
    );
    const independent = resolveResampling(
      rows,
      hierarchical("calibration.ece", [
        chain(field("groups.source", (row) => row.outer)),
        chain(field("synthetic.row", (row) => row.id)),
      ]),
    );
    const clusteredInterval = clusteredPercentileBootstrap(clustered, {
      iterations: PILOT,
      seed: SEED,
      statistic: weightedMean(
        clustered.clusterOf,
        clustered.clusterCount,
        values,
      ),
    });
    const independentInterval = clusteredPercentileBootstrap(independent, {
      iterations: PILOT,
      seed: SEED,
      statistic: weightedMean(
        independent.clusterOf,
        independent.clusterCount,
        values,
      ),
    });
    const clusteredWidth =
      clusteredInterval.upper95 - clusteredInterval.lower95;
    const independentWidth =
      independentInterval.upper95 - independentInterval.lower95;
    expect(clusteredWidth).toBeGreaterThan(independentWidth);
    // And the per-row design is published AS degenerate, so nobody can read its
    // narrower interval as a clustered one.
    expect(independent.declaration.degenerate).toBe(true);
    expect(clustered.declaration.levels[1].degenerate).toBe(false);
  });
});

describe("frozen replicate counts, seeds and effort", () => {
  // Eight sources of three authors each. The replicate distribution needs enough
  // atoms for two different seeds to land on two different 2.5th percentiles; a
  // five-row fixture puts both on the same order statistic and would prove
  // nothing about the seed.
  const rows: Row[] = [];
  for (let source = 0; source < 8; source += 1) {
    for (let author = 0; author < 3; author += 1) {
      rows.push({
        outer: `s${source}`,
        inner: `s${source}-a${author}`,
        score: (source * 3 + author) / 24,
      });
    }
  }
  const values = rows.map((row) => row.score as number);
  const design = hierarchical("calibration.ece", [chain(OUTER), chain(INNER)]);
  const resolution = resolveResampling(rows, design);
  const statistic = weightedMean(
    resolution.clusterOf,
    resolution.clusterCount,
    values,
  );

  it("refuses a replicate count below the pre-registered pilot floor", () => {
    expect(() =>
      clusteredPercentileBootstrap(resolution, {
        iterations: PILOT - 1,
        seed: SEED,
        statistic,
      }),
    ).toThrow(new RegExp(String(PILOT), "u"));
  });

  it("is byte-for-byte reproducible per seed and differs across seeds", () => {
    const first = clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
    });
    const second = clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
    });
    const other = clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED + 1,
      statistic,
    });
    expect(first).toEqual(second);
    expect(first.lower95).not.toBe(other.lower95);
    expect(first.requestedReplicates).toBe(PILOT);
    expect(first.validReplicates).toBe(PILOT);
    expect(first.discardedReplicates).toBe(0);
    expect(first.seed).toBe(SEED);
    expect(first.unit.estimand).toBe("calibration.ece");
    expect(first.unit.method).toBe("hierarchical");
  });

  it("publishes the resampling effort behind a simultaneous bound", () => {
    const interval = clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
      simultaneousAlpha: 0.05 / 40,
    });
    expect(interval.simultaneous?.replicates).toBe(PILOT);
    expect(interval.simultaneous?.tailReplicates).toBe(
      Math.floor((0.05 / 40) * (PILOT - 1)),
    );
    expect(interval.simultaneous?.upper).toBeGreaterThanOrEqual(
      interval.upper95,
    );
    expect(interval.simultaneous?.lower).toBeLessThanOrEqual(interval.lower95);
  });

  it("publishes no simultaneous bound when the tail holds no replicate", () => {
    const interval = clusteredPercentileBootstrap(resolution, {
      iterations: PILOT,
      seed: SEED,
      statistic,
      simultaneousAlpha: 1 / (2 * PILOT),
    });
    expect(interval.simultaneous).toBeUndefined();
    expect(interval.lower95).toBeLessThanOrEqual(interval.upper95);
  });

  it("refuses to publish an interval from too few finite replicates", () => {
    expect(() =>
      clusteredPercentileBootstrap(resolution, {
        iterations: PILOT,
        seed: SEED,
        statistic: () => Number.NaN,
      }),
    ).toThrow(/1000/u);
  });

  it("refuses an empty population instead of returning an interval", () => {
    expect(() => resolveResampling([], design)).toThrow(/at least one/u);
  });
});

describe("o terceiro fator cruzado da classe mista, MEDIDO nos dois regimes", () => {
  // A emenda que pos `groups.generatorFamily` em `mixed.levels` alega que o fator ALARGA o
  // intervalo, e a alegacao foi atacada tres vezes. (i) Percentis de uma estatistica de RAZAO
  // nao sao monotonicos sob a multiplicacao por um vetor de pesos novo, entao o fator poderia
  // ESTREITAR -- e limite mais estreito compra passe. (ii) O alargamento podia vir de a familia
  // ser COLINEAR com o template no fixture. (iii) O fixture que respondia (ii) comparava
  // populacoes de CARDINALIDADE DE TEMPLATE diferente, e a sua perna "colinear" nao era
  // colinear para oito familias, porque 60 nao e multiplo de 8.
  //
  // Este fixture fecha as tres: os templates sao SEMPRE 20, e a colinearidade e construida
  // como `familia = f(template)`, que e colinear para qualquer numero de familias. As duas
  // propriedades sao AFERIDAS abaixo em vez de prometidas.
  interface Linha extends Row {
    hit: number;
  }

  const LINHAS = 200;
  const TEMPLATES = 20;

  /**
   * `dependeDaFamilia` liga ou desliga o efeito de familia no acerto, e e o contrafactual que
   * separa "o fator captura dependencia" de "acrescentar fator grosseiro alarga".
   *
   * `colinear` decide se a familia e FUNCAO do template (`template % familias`) ou se varia
   * dentro dele (`floor(i / TEMPLATES) % familias`). Nas duas formas o template e
   * `i % TEMPLATES`, entao a cardinalidade nao se move com o numero de familias -- que era o
   * confundimento da versao anterior deste fixture.
   */
  function populacao(
    familias: number,
    dependeDaFamilia: boolean,
    colinear: boolean,
  ): Linha[] {
    let s = 11;
    const rnd = () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 0x1_0000_0000;
    };
    return Array.from({ length: LINHAS }, (_unused, i) => {
      const tpl = i % TEMPLATES;
      const fam = colinear
        ? tpl % familias
        : Math.floor(i / TEMPLATES) % familias;
      const base = dependeDaFamilia
        ? 0.5 + 0.25 * ((fam / Math.max(1, familias - 1)) * 2 - 1)
        : 0.5;
      return {
        parent: `p${i}`,
        operation: `t${tpl}`,
        family: `f${fam}`,
        hit: rnd() < base ? 1 : 0,
      };
    });
  }

  function largura(
    linhas: Linha[],
    comFamilia: boolean,
    semente: number,
  ): number {
    const fatores = comFamilia
      ? [chain(PARENT), chain(OPERATION), chain(FAMILY)]
      : [chain(PARENT), chain(OPERATION)];
    const resolucao = resolveResampling(
      linhas,
      multiway("mixed.warning.recall", fatores),
    );
    // Agregado por cluster ANTES do primeiro sorteio, que e o contrato de `statistic`.
    const acertos = new Array<number>(resolucao.clusterCount).fill(0);
    const total = new Array<number>(resolucao.clusterCount).fill(0);
    linhas.forEach((linha, i) => {
      const c = resolucao.clusterOf[i];
      acertos[c] += linha.hit;
      total[c] += 1;
    });
    const intervalo = clusteredPercentileBootstrap(resolucao, {
      iterations: 10_000,
      seed: semente,
      statistic: (pesos) => {
        let a = 0;
        let t = 0;
        for (let c = 0; c < pesos.length; c += 1) {
          a += pesos[c] * acertos[c];
          t += pesos[c] * total[c];
        }
        return t === 0 ? Number.NaN : a / t;
      },
    });
    return intervalo.upper95 - intervalo.lower95;
  }

  const razao = (
    familias: number,
    dependeDaFamilia: boolean,
    colinear: boolean,
  ): number => {
    const linhas = populacao(familias, dependeDaFamilia, colinear);
    return largura(linhas, true, SEED) / largura(linhas, false, SEED);
  };

  it("o FIXTURE tem as duas propriedades que as pernas abaixo supoem", () => {
    // Sem isto as pernas medem outra coisa e nada acusa. As duas propriedades: a cardinalidade
    // de template nao se move com as familias, e "colinear" e colinear DE FACTO.
    for (const familias of [2, 4, 8]) {
      for (const colinear of [true, false]) {
        const linhas = populacao(familias, true, colinear);
        const porTemplate = new Map<string, Set<string>>();
        for (const linha of linhas) {
          const chave = linha.operation ?? "";
          if (!porTemplate.has(chave)) porTemplate.set(chave, new Set());
          porTemplate.get(chave)?.add(linha.family ?? "");
        }
        const maximo = Math.max(
          ...[...porTemplate.values()].map((conjunto) => conjunto.size),
        );
        expect(porTemplate.size, `templates familias=${familias}`).toBe(
          TEMPLATES,
        );
        expect(maximo, `familias por template familias=${familias}`).toBe(
          colinear ? 1 : familias,
        );
      }
    }
  });

  it("nunca ESTREITA, nas doze configuracoes varridas", () => {
    // O que a emenda precisa e so isto: a razao nao cai abaixo de 1. As doze incluem o caso
    // SEM dependencia de familia, que e onde um estreitamento apareceria primeiro.
    for (const familias of [2, 4, 8]) {
      for (const depende of [true, false]) {
        for (const colinear of [true, false]) {
          expect(
            razao(familias, depende, colinear),
            `familias=${familias} depende=${depende} colinear=${colinear}`,
          ).toBeGreaterThan(1);
        }
      }
    }
  });

  it("ALARGA por DUAS causas, e sao estas as faixas que o ESTADO publica", () => {
    // Sem nenhuma dependencia de familia o fator ainda alarga: parte do alargamento e
    // ESTRUTURAL, porque um fator grosseiro reamostrado por si acrescenta variancia, tenha ou
    // nao efeito real. Essa parte e o PRECO do fator e e paga mesmo quando o conjunto de
    // modelos nao importa. As faixas ficam presas aqui porque sao elas que o ESTADO § 5.11
    // publica, e numero publicado que nenhuma assercao sustenta envelhece em silencio.
    for (const familias of [2, 4, 8]) {
      for (const colinear of [true, false]) {
        const semDep = razao(familias, false, colinear);
        expect(
          semDep,
          `estrutural familias=${familias} col=${colinear}`,
        ).toBeGreaterThan(1.3);
        expect(
          semDep,
          `estrutural familias=${familias} col=${colinear}`,
        ).toBeLessThan(1.7);
        const comDep = razao(familias, true, colinear);
        expect(
          comDep,
          `com dependencia familias=${familias} col=${colinear}`,
        ).toBeGreaterThan(1.55);
        expect(
          comDep,
          `com dependencia familias=${familias} col=${colinear}`,
        ).toBeLessThan(3.25);
        // E a dependencia acrescenta ACIMA da parte estrutural, que e o que a torna visivel.
        expect(comDep).toBeGreaterThan(semDep);
      }
    }
  });

  it("a COLINEARIDADE com o template ATENUA o alargamento, e nao o produz", () => {
    // Quando a familia e funcao do template, o fator de template ja absorve parte da
    // dependencia familiar e o fator novo acrescenta MENOS. Isto REFUTA a leitura anterior de
    // que a colinearidade movia a razao menos de 20 %: aquela vinha de um fixture cuja perna
    // "colinear" nao era colinear para oito familias e cuja cardinalidade de template mudava
    // com as familias.
    //
    // A MAGNITUDE fica presa e nao declarada, porque um numero em comentario que nenhuma
    // assercao sustenta envelhece em silencio -- e foi assim que os 20 % sobreviveram a duas
    // publicacoes. Duas pernas: a atenuacao passa de 40 % na colinearidade mais completa, e
    // DECRESCE conforme as familias crescem, porque com mais familias sobre os mesmos 20
    // templates a colinearidade e menos completa.
    const atenuacao = new Map<number, number>();
    for (const familias of [2, 4, 8]) {
      const col = razao(familias, true, true);
      const naoCol = razao(familias, true, false);
      expect(naoCol, `familias=${familias}`).toBeGreaterThan(col);
      atenuacao.set(familias, naoCol / col);
    }
    expect(atenuacao.get(2) ?? 0).toBeGreaterThan(1.4);
    expect(atenuacao.get(2) ?? 0).toBeGreaterThan(atenuacao.get(4) ?? 0);
    expect(atenuacao.get(4) ?? 0).toBeGreaterThan(atenuacao.get(8) ?? 0);
  });

  it("com o fator DEGENERADO nao ha diferenca detectavel em seis sementes", () => {
    // Com um nivel so, `drawMultiway` faz `min(levels - 1, ...)` = 0 e a contagem do fator e
    // sempre 1, entao o multiplicador do peso e constante. O que muda e a POSICAO no fluxo,
    // porque o laco consome um sorteio a mais por replicado. Ponto contra ponto na semente
    // pre-inscrita isso leria como estreitamento; faixa contra faixa as duas se sobrepoem.
    //
    // O QUE ESTA PERNA NAO E: teste de equivalencia. Sobreposicao de amplitudes e razao de
    // medias dentro de um por cento sao AUSENCIA DE EVIDENCIA de diferenca em seis sementes,
    // e nao evidencia de ausencia de efeito. Um teste de equivalencia exigiria uma margem
    // declarada e poder para a recusar, e nenhuma foi pre-inscrita.
    //
    // A razao de fundo, achada por MUTANTE EQUIVALENTE: um fator de um nivel contribui um
    // multiplicador CONSTANTE ao peso de toda celula, e a DISTRIBUICAO-ALVO de uma estatistica
    // de razao e invariante a escala uniforme. Isso vale para o alvo e NAO para a execucao
    // finita: com o fluxo deslocado, um replicado e portanto o percentil amostral podem
    // mover-se nos dois sentidos.
    const linhas = populacao(1, false, false);
    const sementes = [
      SEED,
      SEED + 6,
      SEED + 22,
      SEED + 94,
      SEED + 990,
      SEED + 1002,
    ];
    const dois = sementes.map((s) => largura(linhas, false, s));
    const tres = sementes.map((s) => largura(linhas, true, s));
    const faixa = (a: number[]) => [Math.min(...a), Math.max(...a)] as const;
    const [d0, d1] = faixa(dois);
    const [t0, t1] = faixa(tres);
    expect(d0 <= t1 && t0 <= d1, `[${d0}, ${d1}] vs [${t0}, ${t1}]`).toBe(true);
    const media = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(media(tres) / media(dois)).toBeGreaterThan(0.99);
    expect(media(tres) / media(dois)).toBeLessThan(1.01);
  });
});

describe("o teto da fracao DESCARTADA, derivado e nao pre-inscrito", () => {
  // A divida da § 7 era "a fracao descartada nao tem teto". Dois pareceres discordaram sobre a
  // natureza dela e a reconciliacao ficou aqui.
  //
  // O QUE ESTA REGRA E: um criterio derivado de ADMISSIBILIDADE do avaliador. O lema e
  // |P(X<=x) - P(X<=x | finito)| <= p, com p a massa descartada, entao o quantil lido dos
  // sobreviventes tem cauda verdadeira em [q-p, q+p].
  //
  // O QUE ELA NAO E, e a distincao foi o objecto da discordancia: `p < alpha` NAO devolve o
  // nivel nominal. Com p logo abaixo de alpha a cauda do pior caso chega a `alpha + p -
  // alpha*p`, que e ~2x o nominal (medido: 0,0499 contra 0,025). Logo isto limita a
  // DEGRADACAO a menos de um fator dois; nao prova cobertura. Uma garantia incondicional
  // exigiria ranks ajustados, e essa decisao fica de fora desta unidade.
  //
  // Os dois niveis vem congelados e nao digitados: o descritivo e
  // `(1 - multiplicity.descriptiveConfidence)/2`, e o simultaneo e o que o chamador passa.
  const DESCRITIVO =
    (1 - PREREGISTRATION_V4.multiplicity.descriptiveConfidence) / 2;

  /** Uma estatistica que devolve NaN nas primeiras `quantas` replicas e 1 no resto. */
  function comDescartes(
    quantas: number,
  ): (weights: readonly number[]) => number {
    let vistas = 0;
    return () => {
      vistas += 1;
      return vistas <= quantas ? Number.NaN : 1;
    };
  }

  const design = multiway("e", [chain(PARENT), chain(OPERATION)]);
  const linhas: Row[] = Array.from({ length: 40 }, (_unused, i) => ({
    parent: `p${i}`,
    operation: `t${i % 8}`,
  }));

  function corre(quantas: number, alpha?: number) {
    const resolucao = resolveResampling(linhas, design);
    const [intervalo] = clusteredPercentileBootstrapAll(resolucao, {
      iterations: 10_000,
      seed: SEED,
      statistics: [comDescartes(quantas)],
      ...(alpha === undefined ? {} : { simultaneousAlpha: alpha }),
    });
    return intervalo;
  }

  it("o nivel descritivo e DERIVADO da confianca congelada", () => {
    expect(DESCRITIVO).toBe(DESCRIPTIVE_ALPHA);
    expect(PREREGISTRATION_V4.multiplicity.descriptiveConfidence).toBe(0.95);
    // E NAO e o literal decimal: `(1 - 0.95) / 2` da 0.025000000000000022 em binario, entao
    // trocar a derivacao por `0.025` e uma mudanca observavel. Sem esta assercao o mutante do
    // literal sobrevive, porque as duas formas dao o mesmo limiar INTEIRO -- medido.
    expect(DESCRIPTIVE_ALPHA).not.toBe(0.025);
    expect(DESCRIPTIVE_ALPHA).toBeCloseTo(0.025, 12);
  });

  it("recusa o intervalo acima do teto INTEIRO, e as tres fronteiras sao distintas", () => {
    // O teto e `floor(nivel * pedidas)` e nao a fracao, e a razao e esta perna: o nivel
    // derivado vezes 10.000 da 250.00000000000023, entao NENHUMA contagem faz a fracao
    // IGUALAR o nivel e `>=` contra `>` coincidiriam em todo input que um teste consiga
    // escrever -- medido, o mutante sobrevivia. Com o teto inteiro as tres posicoes sao
    // inputs distintos.
    const teto = Math.floor(DESCRIPTIVE_ALPHA * 10_000);
    expect(teto).toBe(250);
    // uma abaixo: admissivel
    expect(corre(teto - 1)).not.toBeNull();
    // NO teto: admissivel, e e esta que morre se a comparacao virar `>=`
    const noTeto = corre(teto);
    expect(noTeto).not.toBeNull();
    expect(noTeto?.discardedReplicates).toBe(teto);
    // uma acima: recusado
    expect(corre(teto + 1)).toBeNull();
    expect(corre(teto + 500)).toBeNull();
  });

  it("o piso de FINITAS fica SUBSUMIDO pelo teto, e isso e dito e nao escondido", () => {
    // A perna anterior dizia "as duas recusam", e era falso: sob a confianca congelada o
    // teto de descarte torna o piso de finitas INALCANCAVEL. Com no maximo 250 descartes
    // sobram 9.750 finitas, muito acima de 1.000 -- entao nenhum input admissivel chega ao
    // piso, e um mutante que o arranque sobrevive. Medido, e agora afirmado como relacao em
    // vez de fingido como segunda recusa.
    const teto = Math.floor(DESCRIPTIVE_ALPHA * 10_000);
    const finitasNoPior = 10_000 - teto;
    expect(finitasNoPior).toBe(9_750);
    expect(finitasNoPior).toBeGreaterThan(1_000);
    // O que fica alcancavel e so o caminho ACIMA do teto, e ali as duas condicoes valem --
    // o que o teste pode afirmar e que a recusa acontece, nao qual das duas a produziu.
    expect(corre(9_500)).toBeNull();
    expect(corre(teto + 10)).toBeNull();
  });

  it("OMITE apenas o simultaneo quando a massa alcanca o alpha simultaneo", () => {
    // O alpha simultaneo e MENOR que o descritivo sob Bonferroni com m >= 2, entao ha uma
    // faixa em que o intervalo de 95 % e admissivel e o simultaneo nao. Nessa faixa o
    // intervalo existe SEM o simultaneo, e um estimando gateado reprova por evidencia
    // ausente em vez de ler um limite condicionado.
    const simultaneo = PREREGISTRATION_V4.multiplicity.perHypothesisAlpha;
    expect(simultaneo).toBeLessThan(DESCRITIVO);
    const naFaixa = Math.ceil(simultaneo * 10_000) + 1;
    expect(naFaixa / 10_000).toBeLessThan(DESCRITIVO);
    const intervalo = corre(naFaixa, simultaneo);
    expect(intervalo).not.toBeNull();
    expect(intervalo?.simultaneous).toBeUndefined();
    // E abaixo do alpha simultaneo o limite simultaneo E publicado, sem o que a perna
    // acima passaria por o simultaneo nunca existir.
    const abaixo = corre(Math.floor(simultaneo * 10_000) - 1, simultaneo);
    expect(abaixo?.simultaneous).toBeDefined();
  });

  it("as DUAS estatisticas sao julgadas por si, e nao pela pior", () => {
    // Um teto aplicado sobre o total, e nao por estatistica, derrubaria a boa junto com a
    // ma. `discarded` e por estatistica e a admissibilidade tambem tem de ser.
    const resolucao = resolveResampling(linhas, design);
    const intervalos = clusteredPercentileBootstrapAll(resolucao, {
      iterations: 10_000,
      seed: SEED,
      statistics: [comDescartes(0), comDescartes(1_000)],
    });
    expect(intervalos[0]).not.toBeNull();
    expect(intervalos[1]).toBeNull();
  });

  it("a mensagem do envelope de UMA estatistica nomeia as duas causas", () => {
    // Ela nomeava so o piso de mil finitas, e com o teto novo passaria a mentir sobre a
    // causa do `null`. O caminho em lote nao levanta -- devolve `null` --, e isso fica
    // dito na propria mensagem em vez de suposto por quem le.
    const resolucao = resolveResampling(linhas, design);
    expect(() =>
      clusteredPercentileBootstrap(resolucao, {
        iterations: 10_000,
        seed: SEED,
        statistic: comDescartes(9_500),
      }),
    ).toThrow(/descartada|discarded/u);
  });
});
