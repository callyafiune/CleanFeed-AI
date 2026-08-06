import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import {
  clusterNearDuplicates,
  NEAR_DUPLICATE_V1_OPTIONS,
  nearDuplicateFingerprint,
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

// Two id pairs whose parts concatenate to the same string: "a" + "bc" and "ab" + "c".
// Each pair carries its own vocabulary, so its two members are near duplicates at an
// exact shingle Jaccard of 6/7, and shares no token with the other pair, so LSH
// proposes these two candidate pairs and no third one.
const AMBIGUOUS_LEFT = "alfa beta gama delta epsilon zeta eta teta iota kapa";
const AMBIGUOUS_RIGHT = "lambda mu ni ksi omicron pi rho sigma tau ipsilon";

const ambiguousIdRecords: NearDuplicateInput[] = [
  record("a", AMBIGUOUS_LEFT),
  record("bc", `${AMBIGUOUS_LEFT} coda`),
  record("ab", AMBIGUOUS_RIGHT),
  record("c", `${AMBIGUOUS_RIGHT} finis`),
];

// The corpus the frozen v1 result is pinned against: the two ambiguous id pairs, one
// exact duplicate that differs only in case and whitespace, one text too short to
// shingle at all, and one singleton — so every union path in the module contributes.
const frozenCorpus: NearDuplicateInput[] = [
  ...ambiguousIdRecords,
  record("exato-alto", "Bom Dia,   EQUIPE! Vamos    começar."),
  record("exato-baixo", "bom dia, equipe! vamos começar."),
  record("curto", "apenas tres tokens"),
  record(
    "unico",
    "receitas caseiras de bolo de chocolate com cobertura cremosa perfeitas",
  ),
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

describe("the composite keys the module builds", () => {
  it("keeps two candidate pairs whose ids concatenate to the same string", () => {
    const result = clusterNearDuplicates(
      ambiguousIdRecords,
      NEAR_DUPLICATE_V1_OPTIONS,
    );
    // The pair key joins two ids, so the joint has to be unambiguous. Joined by
    // something a record id can contain — or by nothing at all — "a" + "bc" and
    // "ab" + "c" produce ONE key, the second pair is skipped as already seen, and a
    // real near-duplicate pair is never confirmed: the two members would then be free
    // to straddle the development/calibration/test cut, which is the leak this module
    // exists to prevent.
    expect(result.candidatePairCount).toBe(2);
    expect(result.acceptedPairCount).toBe(2);
    expect(result.clusterById.get("a")).toBe(result.clusterById.get("bc"));
    expect(result.clusterById.get("ab")).toBe(result.clusterById.get("c"));
    expect(new Set(result.clusterById.values()).size).toBe(2);
  });

  it("reproduces the frozen v1 clustering byte for byte, cluster ids included", () => {
    const result = clusterNearDuplicates(
      frozenCorpus,
      NEAR_DUPLICATE_V1_OPTIONS,
    );
    // A cluster id is the first 16 hex of the component's smallest content hash, so
    // pinning the ids pins the normalized token stream, the exact-hash union, the LSH
    // proposal and the Jaccard confirmation at once: any change in how a key is spelled
    // or hashed lands here as different bytes.
    expect(Object.fromEntries(result.clusterById)).toEqual({
      a: "near_2930c17c4744a021",
      bc: "near_2930c17c4744a021",
      ab: "near_68bca0bfd6d150e1",
      c: "near_68bca0bfd6d150e1",
      "exato-alto": "near_0c997486e5eb4065",
      "exato-baixo": "near_0c997486e5eb4065",
      curto: "near_8414c7f11714429e",
      unico: "near_ff04104ee6c3117c",
    });
    expect(result.candidatePairCount).toBe(3);
    expect(result.acceptedPairCount).toBe(3);
  });

  it("reproduces the frozen MinHash signature, whose permutation key is joined the same way", () => {
    const fingerprint = nearDuplicateFingerprint(AMBIGUOUS_LEFT);
    // The signature is the surface that depends on the separator inside the hashed
    // PERMUTATION key rather than on the pair key, and the cluster-exposure ledger
    // stores it: a corpus fingerprinted years apart still has to compare equal.
    expect(fingerprint.contentSha256).toBe(
      "79a0fe09040416d88f5973c775f6d8e0a05ba746e670928148cd64f1cd9f45ae",
    );
    expect(fingerprint.shingleCount).toBe(6);
    expect(fingerprint.signature).not.toBeNull();
    const signature = fingerprint.signature ?? [];
    expect(signature).toHaveLength(128);
    expect(signature.slice(0, 4)).toEqual([
      320380335, 365771215, 143581155, 237914302,
    ]);
    expect(
      createHash("sha256").update(signature.join(","), "utf8").digest("hex"),
    ).toBe("a5f89d28d5cf0979ae0adbcb71819d809edf8c78b9295ebc7776ac994635bbb6");
  });
});
