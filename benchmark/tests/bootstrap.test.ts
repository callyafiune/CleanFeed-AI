import { describe, expect, it } from "vitest";

import {
  clusteredPercentileBootstrap,
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
  // intervalo, e a alegacao foi atacada duas vezes. Primeiro: percentis de uma estatistica de
  // RAZAO nao sao monotonicos sob a multiplicacao por um vetor de pesos novo, entao o fator
  // poderia ESTREITAR -- e limite mais estreito compra passe, que e o oposto do que a emenda
  // diz fazer. Depois: o alargamento medido podia vir de a familia ser COLINEAR com o template
  // no fixture, e nao da dependencia que o fator existe para carregar. As duas objecoes sao
  // medidas aqui, e a segunda muda o que a emenda pode alegar.
  interface Linha extends Row {
    hit: number;
  }

  /**
   * `dependeDaFamilia` liga ou desliga o efeito de familia no acerto, e e o contrafactual que
   * separa "o fator captura dependencia" de "acrescentar fator grosseiro alarga". `colinear`
   * decide se a familia varia DENTRO de um template: com `i % templates` e `templates`
   * multiplo de `familias` a familia fica constante por template, e o fixture nao distingue as
   * duas causas. O bloco de `familias` linhas consecutivas partilhando template poe todas as
   * familias em todo template.
   */
  function populacao(
    n: number,
    templates: number,
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
    return Array.from({ length: n }, (_unused, i) => {
      const fam = i % familias;
      const tpl = colinear
        ? i % templates
        : Math.floor(i / familias) % templates;
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
    const linhas = populacao(200, 60, familias, dependeDaFamilia, colinear);
    return largura(linhas, true, SEED) / largura(linhas, false, SEED);
  };

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

  it("ALARGA por DUAS causas, e a decomposicao e o que a emenda pode alegar", () => {
    // Com dependencia de familia a razao passa de 1,7; SEM ela o fator ainda alarga, entre 1,2
    // e 1,6. Logo o alargamento NAO e todo evidencia de dependencia capturada: parte e
    // estrutural -- um fator grosseiro reamostrado por si acrescenta variancia, tenha ou nao
    // efeito real. Essa parte e o PRECO do fator, e e paga mesmo quando o conjunto de modelos
    // nao importa. Alegar "alarga porque captura a dependencia" sem esta perna atribuiria a
    // decomposicao inteira a uma das duas causas.
    for (const familias of [2, 4, 8]) {
      const comDep = razao(familias, true, false);
      const semDep = razao(familias, false, false);
      expect(comDep, `familias=${familias} com dependencia`).toBeGreaterThan(
        1.7,
      );
      expect(semDep, `familias=${familias} sem dependencia`).toBeGreaterThan(
        1.2,
      );
      expect(semDep, `familias=${familias} sem dependencia`).toBeLessThan(1.6);
      // E a dependencia acrescenta ACIMA da parte estrutural, que e o que a torna visivel.
      expect(comDep).toBeGreaterThan(semDep);
    }
  });

  it("a COLINEARIDADE com o template nao e o que produz o alargamento", () => {
    // O fixture antigo punha a familia como funcao do template (`i % 60`, com 60 multiplo de 2
    // e de 4), e assim ele nao distinguia as duas causas. Medido nas duas formas a razao quase
    // nao se move, logo a colinearidade nao e a causa e a perna acima nao esta a medir o
    // template outra vez.
    for (const familias of [2, 4, 8]) {
      const col = razao(familias, true, true);
      const naoCol = razao(familias, true, false);
      expect(
        Math.abs(col - naoCol) / naoCol,
        `familias=${familias}`,
      ).toBeLessThan(0.2);
    }
  });

  it("nao ESTREITA quando o fator e degenerado: a diferenca e do fluxo do PRNG", () => {
    // Com um nivel so, `drawMultiway` faz `min(levels - 1, ...)` = 0 e a contagem do fator e
    // sempre 1, entao o multiplicador do peso e constante. O que muda e a POSICAO no fluxo,
    // porque o laco consome um sorteio a mais por replicado -- e uma semente que andou nao e
    // variancia. Logo a comparacao correta e de FAIXAS e nao de pontos: medido, ponto contra
    // ponto na semente pre-inscrita da 0,972, que leria como estreitamento.
    //
    // A razao de fundo, achada por MUTANTE EQUIVALENTE: um fator de um nivel contribui um
    // multiplicador CONSTANTE ao peso de toda celula, e a DISTRIBUICAO-ALVO de uma estatistica
    // de razao e invariante a escala uniforme. Isso vale para o alvo e NAO para a execucao
    // finita: com o fluxo deslocado, um replicado individual e portanto o percentil amostral
    // podem mover-se nos dois sentidos. E por isso que esta perna afirma sobreposicao de
    // faixas e media a menos de um por cento, e nao igualdade.
    const linhas = populacao(200, 60, 1, false, false);
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
