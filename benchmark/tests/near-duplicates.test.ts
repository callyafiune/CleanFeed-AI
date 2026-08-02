import { describe, expect, it } from "vitest";

import {
  clusterNearDuplicates,
  type NearDuplicateInput,
  type NearDuplicateOptions,
} from "../near-duplicates.ts";

// clusterNearDuplicates only reads `id` and `text`, so these tests use the
// minimal structural input rather than the full closed benchmark record schema
// (validated in schema.test.ts). A real BenchmarkRecord[] is assignable to
// NearDuplicateInput[], keeping this contract decoupled from the record schema.
function record(id: string, text: string): NearDuplicateInput {
  return { id, text };
}

// A PT-BR paragraph with enough tokens (28) that appending three more tokens
// keeps the exact Jaccard of the 5-token shingle sets above the 0.82 threshold:
// 24 shared shingles over 27 in the union is ~0.888.
const BASE =
  "a inteligência artificial está transformando o mercado de trabalho no brasil e muitas empresas já adotam ferramentas modernas para aumentar a produtividade das suas equipes todos os dias";
// Unrelated content: disjoint tokens, so no shingle overlap and no LSH bucket
// collision with BASE.
const OTHER =
  "receitas caseiras de bolo de chocolate com cobertura cremosa são perfeitas para festas infantis animadas durante o fim de semana ensolarado na praia";

const OPTIONS: NearDuplicateOptions = {
  shingleSize: 5,
  permutations: 128,
  bands: 32,
  jaccardThreshold: 0.82,
  seed: 20_260_726,
};

const records: NearDuplicateInput[] = [
  record("a", BASE),
  record("b", `${BASE} frase adicional curta`),
  record("c", OTHER),
];

// A deterministic 1000-record fixture: 500 disjoint-vocabulary pairs. Each pair
// shares its own tokens (so the two members are near duplicates) but no tokens
// with any other pair (so no cross-pair candidate pairs are generated). This
// keeps the candidate-pair count bounded while still exercising real clusters.
function buildLargeFixture(): NearDuplicateInput[] {
  const rows: NearDuplicateInput[] = [];
  for (let k = 0; k < 500; k += 1) {
    const base = `documento alfa${k} beta${k} gama${k} delta${k} epsilon${k} zeta${k} eta${k} teta${k}`;
    rows.push(record(`base-${k}`, base));
    rows.push(record(`dup-${k}`, `${base} extra${k}`));
  }
  return rows;
}

describe("clusterNearDuplicates", () => {
  it("joins normalized duplicates and highly similar shingle sets", () => {
    const result = clusterNearDuplicates(
      [
        record("a", BASE),
        record("b", `${BASE} frase adicional curta`),
        record("c", OTHER),
      ],
      {
        shingleSize: 5,
        permutations: 128,
        bands: 32,
        jaccardThreshold: 0.82,
        seed: 20_260_726,
      },
    );
    expect(result.clusterById.get("a")).toBe(result.clusterById.get("b"));
    expect(result.clusterById.get("a")).not.toBe(result.clusterById.get("c"));
  });

  it("is independent of input order", () => {
    const forward = clusterNearDuplicates(records, OPTIONS);
    const reverse = clusterNearDuplicates([...records].reverse(), OPTIONS);
    expect([...forward.clusterById].sort()).toEqual(
      [...reverse.clusterById].sort(),
    );
  });

  it("unions exact duplicates that differ only in surface whitespace and case", () => {
    const result = clusterNearDuplicates(
      [
        record("upper", "Bom Dia,   EQUIPE! Vamos    começar."),
        record("lower", "bom dia, equipe! vamos começar."),
        record("other", OTHER),
      ],
      OPTIONS,
    );
    expect(result.clusterById.get("upper")).toBe(
      result.clusterById.get("lower"),
    );
    expect(result.clusterById.get("upper")).not.toBe(
      result.clusterById.get("other"),
    );
  });

  it("records the algorithm identity and reproduces the frozen options", () => {
    const result = clusterNearDuplicates(records, OPTIONS);
    expect(result.algorithm).toBe("minhash-lsh-jaccard-v1");
    expect(result.options).toEqual(OPTIONS);
  });

  it("bounds candidate pairs and stays stable on a 1000-record fixture", () => {
    const fixture = buildLargeFixture();
    expect(fixture).toHaveLength(1000);

    const forward = clusterNearDuplicates(fixture, OPTIONS);
    const reverse = clusterNearDuplicates([...fixture].reverse(), OPTIONS);

    expect(forward.candidatePairCount).toBeLessThan(50_000);
    expect([...forward.clusterById].sort()).toEqual(
      [...reverse.clusterById].sort(),
    );
    // Each intended pair clusters together and no unintended cross-pair merges
    // occur, so every base joins exactly its own derived duplicate.
    for (let k = 0; k < 500; k += 1) {
      expect(forward.clusterById.get(`base-${k}`)).toBe(
        forward.clusterById.get(`dup-${k}`),
      );
    }
    expect(new Set(forward.clusterById.values()).size).toBe(500);
  });
});
