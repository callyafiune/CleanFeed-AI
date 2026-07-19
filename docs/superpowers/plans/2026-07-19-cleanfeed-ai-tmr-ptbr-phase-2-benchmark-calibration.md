# CleanFeed AI TMR/PT-BR Phase 2 — Benchmark and Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um benchmark PT-BR/LinkedIn fechado, reprodutível e estatisticamente auditável que valide dados e previsões, congele um split temporal sem vazamento, ajuste calibradores sem consultar o holdout, emita `pass | indicator-only | reject` e publique perfis imutáveis consumíveis pela extensão.

**Architecture:** O benchmark permanece um pacote Node independente em `benchmark/`, sem importar `src/`; ele consome os contratos puros de perfil/release criados pela Fase 1 e cria em `contracts/source-readiness.ts` e `contracts/runtime-parity.ts` os contratos puros de governança e identidade compartilhados pelas Fases 3/4. Dados, previsões e labels bloqueados ficam fora do Git, enquanto schemas, protocolos, políticas, digests e descritores aprovados são versionados. O fluxo obrigatório é `validate -> split -> validate-predictions -> fit -> evaluate -> publish-profile -> verify-evidence`; a geração das previsões reais pelo TMR pertence à Fase 3 e entra nesta fase apenas por artefatos JSONL estritamente validados.

**Tech Stack:** Node.js 22.18+, TypeScript strict com execução nativa de TypeScript, Web Crypto/`node:crypto` SHA-256, JSONL, Vitest, algoritmos determinísticos próprios de union-find, MinHash/LSH, Wilson unilateral, bootstrap clusterizado, Platt scaling, beta calibration, regressão isotônica, ECE-15, Brier score, ESLint e Prettier.

## Global Constraints

- Este plano implementa o [design aprovado do classificador TMR/PT-BR](../specs/2026-07-19-tmr-ptbr-classifier-design.md), limitado ao benchmark, calibração e publicação do perfil.
- `benchmark/` não pode importar nenhum arquivo de `src/`; contratos compartilhados devem viver em `contracts/` e não podem usar APIs de Node, DOM ou Chrome.
- A Fase 2 não executa inferência TMR. `fit` recebe previsões de development/calibration produzidas pela Fase 3; `evaluate` só aceita previsões de teste ligadas a uma sessão atômica `consume-holdout` aberta pelo browser scorer da Fase 3.
- O browser scorer da Fase 3 processa shards determinísticos de exatamente 100 registros. O holdout não pode ser pontuado antes ou fora da sessão `consume-holdout` correspondente.
- Scoring científico release-eligible usa exclusivamente Chrome for Testing Stable `150.0.7871.129`, pinado e verificado antes de ler registros, com backend WASM. O Chromium bundled do Playwright serve somente aos E2E comuns e nunca produz predictions de fit/evaluate.
- O corpus de release contém exatamente 10.000 registros: 4.000 `human`, 4.000 `ai` e 2.000 `mixed`.
- Conteúdo humano do LinkedIn só pode vir de contribuição autorizada ou fonte com licença compatível; coleta indiscriminada de perfis é proibida.
- Ground truth é derivado de proveniência documentada e revisão humana, nunca da opinião de um detector.
- Cada registro requer dois revisores; divergência requer um terceiro adjudicador antes do selamento.
- O split de release é 20% desenvolvimento, 30% calibração e 50% teste temporal bloqueado, por classe, com tolerância máxima de dois pontos percentuais após agrupamento.
- O teste contém pelo menos 2.000 negativos humanos; cada slice crítico de FPR precisa de 300 negativos para autorizar ação visual e cada slice crítico de recall precisa de 200 positivos.
- O split agrupa autor, fonte/coorte de domínio, versão/lote gerador, template de prompt, lote de coleta, quase duplicata e pai/derivados. Não deve unir todos os registros por `domain = "linkedin"` nem por uma família geradora inteira.
- Uma família geradora inteira, declarada no manifesto, é reservada ao teste como não vista; famílias vistas continuam divisíveis por versão/lote para que o teste contenha slices `seen` e `unseen`.
- O holdout não pode escolher calibrador, agregação, regra OOD ou limiar. Uma avaliação de release consome a combinação de split, modelo, bundle, agregação/composição, tokenizer, inference core, build do harness, backend WASM, versão exata do Chrome e avaliador.
- Aviso: limite superior unilateral de 95% do FPR menor ou igual a 5% overall e nos slices críticos com amostra suficiente.
- Ação visual: limite superior unilateral de 95% do FPR menor ou igual a 2% overall e nos slices críticos com amostra suficiente.
- Utilidade: limite inferior unilateral de 95% do recall de aviso maior ou igual a 60% e de ação maior ou igual a 35%.
- Cobertura sem abstenção deve ser pelo menos 80%; ECE-15 deve ser no máximo 0,05; textos mistos com pelo menos 50% de contribuição de IA precisam de recall de aviso de pelo menos 50%.
- Wilson unilateral usa `z = 1.6448536269514722`; AUC e calibração usam 2.000 réplicas de bootstrap clusterizadas por autor e seed registrado.
- Platt, beta e isotonic são comparados por validação cruzada de cinco folds agrupada por autor. Entre candidatos com ECE-15 menor ou igual a 0,05, vence o menor Brier; diferença de Brier menor que 0,002 favorece Platt.
- Os caminhos `documentRawScore` e `localizedRawScore` têm calibradores próprios. O aviso é a união dos dois caminhos sob um único orçamento de 5%; ação visual usa somente o score de documento sob 2%.
- Qualquer campo desconhecido, ID/hash repetido, score fora de `[0,1]`, metadado contraditório, previsão ausente ou digest divergente é falha dura; não existe `last-write-wins` nem exclusão silenciosa.
- Dados e outputs científicos permanecem em `benchmark/data/ptbr-linkedin-v1`, `benchmark/out/ptbr-v1` e `benchmark/work`, todos fora do Git. A publicação escreve `models/tmr-ai-text-detector/calibration-profiles.json` e `models/tmr-ai-text-detector/release.json`; a Fase 1 materializa esses descritores em `public/` durante o build.
- Cada tarefa segue RED-GREEN-REFACTOR, termina com verificação focada e produz um commit pequeno com `--no-verify`.

---

## 1. Fluxo e fronteiras de arquivos

```text
benchmark/data/ptbr-linkedin-v1/               # local, ignorado pelo Git
  manifest.json
  records.jsonl
  private/review-ledger.jsonl
  private/source-manifest.json
  private/test-labels.jsonl
                    |
                    v
benchmark/commands/validate.ts
  -> dataset-audit.json + datasetDigest
                    |
                    v
benchmark/commands/split.ts
  -> split-artifact.json + development/calibration/test-input
                    |
                    | previsões externas da Fase 3
                    v
benchmark/commands/fit.ts
  -> frozen-calibration.json                    # não lê labels de teste
                    |
                    v
browser scorer da Fase 3: consume-holdout, shards de 100
  -> sessão/manifesto de scoring bloqueado
                    |
                    v
benchmark/commands/evaluate.ts --consumption-id
  -> benchmark-report.{json,md} + gate-report.json
                    |
                    v
benchmark/commands/publish-profile.ts
  -> models/tmr-ai-text-detector/calibration-profiles.json
  -> models/tmr-ai-text-detector/release.json
```

Responsabilidades fechadas:

| Arquivo | Responsabilidade única |
|---|---|
| `benchmark/schema.ts` | Schema fechado e validação cruzada de cada registro. |
| `benchmark/dataset-manifest.ts` | Manifesto, revisão, inventário de licenças e selamento 4k/4k/2k. |
| `contracts/source-readiness.ts` | Contrato/digest puro da decisão de governança produzida pela Fase 3. |
| `benchmark/prediction-schema.ts` | Manifesto de previsões, linhas de score e completude exata. |
| `contracts/runtime-parity.ts` | Schema/digest puro que identifica o mesmo inference core entre benchmark e release. |
| `scripts/runtime-parity.mjs` | Inventário fechado do inference core e materialização de `runtime-parity.json`. |
| `benchmark/near-duplicates.ts` | Normalização, MinHash/LSH, Jaccard e clusters determinísticos. |
| `benchmark/split.ts` | Componentes union-find e atribuição temporal 20/30/50. |
| `benchmark/split-audit.ts` | Provas de não vazamento, proporções e amostras mínimas. |
| `contracts/canonical-json.ts` | Serialização/digest canônicos criados pela Fase 1 e consumidos sem redefinição. |
| `benchmark/digests.ts` | SHA-256 de dataset, split, evaluator e relatórios. |
| `benchmark/split-artifact.ts` | Contrato imutável de assignments/cortes/política. |
| `benchmark/intervals.ts` | Wilson unilateral e percentis. |
| `benchmark/bootstrap.ts` | Reamostragem clusterizada determinística. |
| `benchmark/calibrators.ts` | Fit/aplicação/serialização de Platt, beta e isotonic. |
| `benchmark/cross-validation.ts` | Cinco folds disjuntos por autor e seleção por Brier/ECE. |
| `benchmark/calibration-pipeline.ts` | Ajuste final e seleção conjunta de limiares. |
| `benchmark/metrics.ts` | Métricas overall com intervalos e prevalências simuladas. |
| `benchmark/slices.ts` | Slices, macro, pior slice e elegibilidade amostral. |
| `benchmark/gates.ts` | Política pura `pass | indicator-only | reject`. |
| `benchmark/report.ts` | Relatórios JSON/Markdown schema v2. |
| `contracts/calibration-profile.ts` | Contrato puro de perfil produzido pela Fase 1 e consumido sem redefinição. |
| `contracts/model-release.ts` | Contrato puro do descritor de release produzido pela Fase 1. |
| `benchmark/profile-artifact.ts` | Construção, digest e validação do perfil. |
| `benchmark/holdout-ledger.ts` | Registro auditável de consumo do holdout. |
| `benchmark/cli.ts` | Parsing e despacho dos sete subcomandos. |

---

### Task 1: Schema fechado de registros e proveniência

**Files:**
- Modify: `benchmark/schema.ts`
- Create: `benchmark/tests/schema.test.ts`
- Modify: `benchmark/tests/split.test.ts`
- Create: `benchmark/templates/record.example.json`

**Interfaces:**
- Consumes: nenhum módulo de `src/`; somente valores JSON.
- Produces: `BenchmarkLabel`, `BenchmarkRecord`, `validateBenchmarkRecord(value: unknown): BenchmarkRecord` e `parseBenchmarkDataset(jsonl: string): BenchmarkRecord[]`.

- [ ] **Step 1: Escrever testes que fixam as três classes e objetos fechados**

Criar `benchmark/tests/schema.test.ts` com casos positivos para `human`, `ai` e `mixed`, e casos negativos para campos desconhecidos, PII, receita ausente, receita humana contraditória, frações mistas inválidas, spans fora do texto, revisão incompleta e hash repetido:

```typescript
import { describe, expect, it } from "vitest";

import {
  BenchmarkRecordError,
  parseBenchmarkDataset,
  validateBenchmarkRecord,
} from "../schema.ts";

const HUMAN_TEXT = Array.from({ length: 100 }, (_, index) => `palavra${index}`).join(" ");

const human = {
  schemaVersion: 2,
  id: "human-0001",
  text: HUMAN_TEXT,
  normalizedTextSha256: "a".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "linkedin",
  domain: "corporate",
  topic: "career",
  humanSourceType: "broetry",
  hardNegativeFamily: "formulaic",
  wordCount: 100,
  createdAt: 1_735_689_600_000,
  provenance: {
    sourceKind: "authorized-contribution",
    sourceId: "source_001",
    sourceRevision: "rev_001",
    collectedAt: 1_735_689_600_000,
    licenseId: "consent-v1",
    legalBasis: "consent",
    consentId: "consent_001",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_01",
      reviewedAt: 1_735_689_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["reviewer_01", "reviewer_02"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_001",
    source: "source_001",
    domainSource: "linkedin_contribution_batch_01",
    collectionBatch: "batch_001",
    nearDuplicate: "near_pending_001",
    derivationRoot: "human-0001",
  },
} as const;

describe("validateBenchmarkRecord", () => {
  it("accepts an authorized human record", () => {
    expect(validateBenchmarkRecord(human).label).toBe("human");
  });

  it("rejects unknown fields at every level", () => {
    expect(() =>
      validateBenchmarkRecord({
        ...human,
        provenance: { ...human.provenance, rawProfileUrl: "https://example.test" },
      }),
    ).toThrow(/unknown field provenance\.rawProfileUrl/);
  });

  it("requires a complete recipe for ai", () => {
    expect(() => validateBenchmarkRecord({ ...human, label: "ai" })).toThrow(
      /generation is required when label is ai/,
    );
  });

  it("requires valid mixed fractions and derivation", () => {
    expect(() =>
      validateBenchmarkRecord({
        ...human,
        label: "mixed",
        mixture: { aiFraction: 0.7, humanFraction: 0.4, spans: [] },
      }),
    ).toThrow(/mixed fractions must sum to 1/);
  });

  it("rejects duplicate ids and normalized content hashes", () => {
    const jsonl = `${JSON.stringify(human)}\n${JSON.stringify({ ...human, id: "human-0002" })}`;
    expect(() => parseBenchmarkDataset(jsonl)).toThrow(/duplicate normalizedTextSha256/);
  });
});
```

Remover de `benchmark/tests/split.test.ts` os testes antigos de `validateBenchmarkRecord`, pois a responsabilidade passa ao novo arquivo.

- [ ] **Step 2: Executar o teste e confirmar a falha do contrato antigo**

Run: `npx vitest run benchmark/tests/schema.test.ts`

Expected: FAIL porque o schema atual aceita `hybrid`, não conhece os objetos v2 e não rejeita campos desconhecidos.

- [ ] **Step 3: Substituir o contrato plano pelo schema v2**

Definir em `benchmark/schema.ts` estes tipos exatos, sem enums transformáveis:

```typescript
export type BenchmarkLabel = "human" | "ai" | "mixed";
export type TransformationKind =
  | "none"
  | "paraphrase"
  | "back-translation"
  | "human-edit"
  | "noise"
  | "unicode-homoglyph"
  | "truncate"
  | "expand"
  | "linkedin-style"
  | "human-ai-mix";
export type TransformationSeverity = "none" | "low" | "medium" | "high";
export type EvidenceSpanOrigin = "human" | "ai";

export interface BenchmarkRecord {
  schemaVersion: 2;
  id: string;
  text: string;
  normalizedTextSha256: string;
  label: BenchmarkLabel;
  language: "pt-BR";
  platform: string;
  domain: string;
  topic: string;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  wordCount: number;
  createdAt: number;
  provenance: {
    sourceKind:
      | "authorized-contribution"
      | "licensed-corpus"
      | "controlled-generation";
    sourceId: string;
    sourceRevision: string;
    collectedAt: number;
    licenseId: string;
    licenseUrl?: string;
    legalBasis: "consent" | "license" | "generated";
    consentId?: string;
    piiAudit: {
      status: "passed";
      method: "manual-and-automated";
      reviewerId: string;
      reviewedAt: number;
    };
  };
  annotation: {
    protocolVersion: "annotation-v1";
    reviewerIds: [string, string, ...string[]];
    agreement: "agree" | "adjudicated";
    adjudicatorId?: string;
  };
  generation?: {
    provider: string;
    family: string;
    model: string;
    version: string;
    promptId: string;
    promptSha256: string;
    temperature?: number;
    seed?: string;
    generatedAt: number;
  };
  mixture?: {
    aiFraction: number;
    humanFraction: number;
    spans: Array<{ start: number; end: number; origin: EvidenceSpanOrigin }>;
  };
  transformation: {
    kind: TransformationKind;
    severity: TransformationSeverity;
    operatorId?: string;
  };
  groups: {
    author: string;
    source: string;
    domainSource: string;
    generatorFamily?: string;
    generatorVersion?: string;
    promptTemplate?: string;
    collectionBatch: string;
    nearDuplicate: string;
    derivationRoot: string;
  };
}
```

Implementar `assertClosedObject(value, path, allowedKeys)` e validadores de string, número finito, SHA-256 e pseudônimo. Aplicar `assertClosedObject` também aos objetos aninhados. As regras cruzadas são:

```typescript
if (record.label === "human" && record.generation !== undefined) {
  throw new BenchmarkRecordError("generation is forbidden when label is human", record.id);
}
if (record.label === "ai" && record.generation === undefined) {
  throw new BenchmarkRecordError("generation is required when label is ai", record.id);
}
if (record.label === "mixed") {
  if (record.mixture === undefined || record.groups.derivationRoot === record.id) {
    throw new BenchmarkRecordError(
      "mixed records require mixture metadata and a parent derivationRoot",
      record.id,
    );
  }
  const sum = record.mixture.aiFraction + record.mixture.humanFraction;
  if (Math.abs(sum - 1) > Number.EPSILON * 8) {
    throw new BenchmarkRecordError("mixed fractions must sum to 1", record.id);
  }
}
if (
  record.annotation.agreement === "adjudicated" &&
  record.annotation.adjudicatorId === undefined
) {
  throw new BenchmarkRecordError("adjudicated records require adjudicatorId", record.id);
}
```

`parseBenchmarkDataset` deve manter `Set<string>` para IDs e hashes, rejeitar duplicatas com a linha correspondente e rejeitar dataset vazio. `record.example.json` deve ser o mesmo humano válido do teste, formatado como JSON.

- [ ] **Step 4: Executar schema e regressão do split**

Run: `npx vitest run benchmark/tests/schema.test.ts benchmark/tests/split.test.ts`

Expected: PASS; nenhum teste ainda usa o rótulo removido `hybrid`.

- [ ] **Step 5: Commit**

```powershell
git add benchmark/schema.ts benchmark/tests/schema.test.ts benchmark/tests/split.test.ts benchmark/templates/record.example.json
git commit --no-verify -m "feat: close the benchmark record schema"
```

---

### Task 2: Manifesto do corpus, revisão e selamento 4k/4k/2k

**Files:**
- Create: `contracts/source-readiness.ts`
- Create: `tests/unit/contracts/source-readiness.test.ts`
- Create: `benchmark/dataset-manifest.ts`
- Create: `benchmark/tests/dataset-manifest.test.ts`
- Create: `benchmark/templates/dataset-manifest.example.json`
- Create: `benchmark/protocols/annotation-v1.md`
- Create: `benchmark/protocols/pii-review-v1.md`
- Create: `benchmark/protocols/corpus-v1.md`

**Interfaces:**
- Consumes: `BenchmarkRecord` de `benchmark/schema.ts` e `canonicalSha256` da Fase 1.
- Produces: `CorpusSourceBlockingCode`, `CorpusSourceReadinessReport`, `parseCorpusSourceReadinessReport`, `computeSourceReadinessDigest`, `DatasetManifest`, `DatasetFileDigests`, `CorpusPolicy`, `DatasetAudit`, `computeDatasetAuditDigest`, `parseDatasetAudit`, `validateDatasetManifest(value: unknown): DatasetManifest` e `sealDataset(manifest, records, policy, observedFiles): Promise<DatasetAudit>`.

- [ ] **Step 1: Escrever os testes vermelhos do contrato puro de source readiness**

Em `tests/unit/contracts/source-readiness.test.ts`, construa um payload assinado por helper local que sempre chama `computeSourceReadinessDigest` sem `reportDigest`:

```typescript
import { describe, expect, it } from "vitest";

import {
  CORPUS_SOURCE_BLOCKING_CODES,
  computeSourceReadinessDigest,
  parseCorpusSourceReadinessReport,
  type CorpusSourceReadinessReport,
  type SourceReadinessDigestInput,
} from "../../../contracts/source-readiness.ts";

const ready: SourceReadinessDigestInput = {
  schemaVersion: 1,
  status: "ready",
  sourceManifestDigest: "a".repeat(64),
  recordCount: 10_000,
  sourceCount: 80,
  acquisitionCounts: { consent: 2_000, licensed: 2_000, generated: 6_000 },
  protocols: {
    corpus: "corpus-v1",
    collection: "collection-v1",
    annotation: "annotation-v1",
    generation: "generation-v1",
    pii: "pii-review-v1",
  },
  blockingReasons: [],
};

async function sign(
  value: SourceReadinessDigestInput,
): Promise<CorpusSourceReadinessReport> {
  return { ...value, reportDigest: await computeSourceReadinessDigest(value) };
}

describe("source readiness contract", () => {
  it("accepts the exact ready report including generated acquisitions and corpus protocol", async () => {
    await expect(parseCorpusSourceReadinessReport(await sign(ready))).resolves.toEqual(
      await sign(ready),
    );
  });

  it("rejects unknown root, protocol, acquisition and reason keys", async () => {
    await expect(
      parseCorpusSourceReadinessReport({ ...(await sign(ready)), extra: true }),
    ).rejects.toThrow(/unknown key.*extra/i);

    const blocked = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [{ code: "SOURCE_REFERENCE_MISSING", recordId: "record-1" }],
    });
    blocked.blockingReasons[0] = { ...blocked.blockingReasons[0], extra: true } as never;
    await expect(parseCorpusSourceReadinessReport(blocked)).rejects.toThrow(
      /unknown key.*extra/i,
    );
  });

  it("rejects a stale digest after a blocking reason changes", async () => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [{ code: "SOURCE_REFERENCE_MISSING", recordId: "record-1" }],
    });
    report.blockingReasons[0] = {
      code: "SOURCE_REFERENCE_MISSING",
      recordId: "record-2",
    };
    await expect(parseCorpusSourceReadinessReport(report)).rejects.toThrow(/reportDigest/i);
  });

  it.each(CORPUS_SOURCE_BLOCKING_CODES)("accepts the closed code %s", async (code) => {
    const report = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [{ code }],
    });
    await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(report);
  });

  it("requires canonical reason order and status/reason agreement", async () => {
    const unsorted = await sign({
      ...ready,
      status: "blocked",
      blockingReasons: [
        { code: "SOURCE_REFERENCE_MISSING", recordId: "z" },
        { code: "EVALUATION_USE_NOT_APPROVED", sourceId: "a" },
      ],
    });
    await expect(parseCorpusSourceReadinessReport(unsorted)).rejects.toThrow(/sorted/i);
    await expect(
      parseCorpusSourceReadinessReport(
        await sign({
          ...ready,
          status: "ready",
          blockingReasons: [{ code: "SOURCE_MANIFEST_INVALID" }],
        }),
      ),
    ).rejects.toThrow(/status.*blockingReasons/i);
  });

  it("rejects a missing generated count and a non-literal corpus protocol", async () => {
    const missingGenerated = structuredClone(await sign(ready)) as Record<string, unknown>;
    delete (missingGenerated.acquisitionCounts as Record<string, unknown>).generated;
    await expect(parseCorpusSourceReadinessReport(missingGenerated)).rejects.toThrow(
      /generated/i,
    );

    const wrongCorpus = structuredClone(await sign(ready)) as Record<string, unknown>;
    (wrongCorpus.protocols as Record<string, unknown>).corpus = "corpus-v2";
    await expect(parseCorpusSourceReadinessReport(wrongCorpus)).rejects.toThrow(/corpus-v1/i);
  });
});
```

Também cubra cada um dos nove códigos pelo menos uma vez em uma tabela, `recordCount/sourceCount/acquisitionCounts` inteiros não negativos, soma de aquisições igual a `recordCount`, SHA-256 lowercase, IDs opcionais não vazios, razões duplicadas e alteração isolada de cada campo protegido pelo digest. Não use `as` para tornar o fixture válido; os dois casts acima servem somente para construir inputs deliberadamente inválidos.

- [ ] **Step 2: Escrever testes de manifesto e selamento**

```typescript
import { describe, expect, it } from "vitest";

import {
  parseDatasetAudit,
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
} from "../dataset-manifest.ts";
import type { BenchmarkRecord } from "../schema.ts";

describe("dataset manifest", () => {
  it("rejects a source not approved for internal evaluation", () => {
    expect(() =>
      validateDatasetManifest({
        schemaVersion: 1,
        datasetId: "ptbr-linkedin-v1",
        version: "1.0.0",
        scientificUse: "release",
        intendedLanguage: "pt-BR",
        intendedDomain: "linkedin",
        createdAt: "2026-07-19T00:00:00.000Z",
        normalizationVersion: "cleanfeed-text-v1",
         annotationProtocolVersion: "annotation-v1",
         recordsFile: "records.jsonl",
         recordsSha256: "a".repeat(64),
         reviewLedgerFile: "private/review-ledger.jsonl",
         reviewLedgerSha256: "b".repeat(64),
         sourceManifestFile: "private/source-manifest.json",
         sourceManifestSha256: "c".repeat(64),
         heldOutGeneratorFamilies: ["heldout-family"],
        licenses: [{
          id: "bad",
          name: "Fixture license",
          source: "fixture://license",
          evaluationUseApproved: false,
          redistribution: "not-published",
          notice: "Fixture-only material",
        }],
      }),
    ).toThrow(/evaluationUseApproved/);
  });

  it("seals only the exact release composition", async () => {
    const policy = { ...RELEASE_CORPUS_POLICY, counts: { human: 1, ai: 1, mixed: 1 } };
    await expect(
      sealDataset(validManifest, [human] as BenchmarkRecord[], policy, validFileDigests),
    ).rejects.toThrow(
      /expected ai=1, received ai=0/,
    );
  });

  it("detects a changed conclusion in a signed dataset audit", async () => {
    const policy = { ...RELEASE_CORPUS_POLICY, counts: { human: 1, ai: 1, mixed: 1 } };
    const audit = await sealDataset(
      validManifest,
      [human, ai, mixed],
      policy,
      validFileDigests,
    );
    await expect(parseDatasetAudit({ ...audit, recordCount: 4 })).rejects.toThrow(
      /auditDigest/i,
    );
  });
});
```

As fixtures `validManifest`, `validFileDigests` e `human` devem ser objetos completos locais ao teste; derivar `ai` e `mixed` alterando todos os metadados exigidos, sem type assertions que escondam campos ausentes. Adicione casos que alteram separadamente os bytes/digests de records, review ledger e source manifest; todos falham antes de selar. Prove também que unknown key, `sealed !== true`, SHA uppercase e qualquer alteração isolada de `DatasetAudit` com o digest antigo são recusados por `parseDatasetAudit`.

- [ ] **Step 3: Confirmar RED**

Run: `npx vitest run tests/unit/contracts/source-readiness.test.ts benchmark/tests/dataset-manifest.test.ts`

Expected: FAIL com erros de módulos ausentes `contracts/source-readiness.ts` e `benchmark/dataset-manifest.ts`.

- [ ] **Step 4: Implementar o contrato fechado e o digest de source readiness**

`contracts/source-readiness.ts` não importa Node, DOM, Chrome nem `src/`; ele usa somente `canonicalSha256` de `contracts/canonical-json.ts`. Exporte exatamente estes contratos:

```typescript
import { canonicalSha256 } from "./canonical-json.ts";

export const CORPUS_SOURCE_BLOCKING_CODES = [
  "SOURCE_MANIFEST_INVALID",
  "SOURCE_REFERENCE_MISSING",
  "EVALUATION_USE_NOT_APPROVED",
  "LINKEDIN_SOURCE_NOT_AUTHORIZED",
  "SOURCE_LEGAL_REVIEW_MISSING",
  "SOURCE_REVIEWERS_NOT_INDEPENDENT",
  "COLLECTION_PROTOCOL_MISMATCH",
  "GENERATION_RECIPE_MISSING",
  "GENERATION_RECIPE_MISMATCH",
] as const;

export type CorpusSourceBlockingCode =
  (typeof CORPUS_SOURCE_BLOCKING_CODES)[number];

export interface CorpusSourceBlockingReason {
  code: CorpusSourceBlockingCode;
  recordId?: string;
  sourceId?: string;
}

export interface CorpusSourceReadinessReport {
  schemaVersion: 1;
  status: "ready" | "blocked";
  sourceManifestDigest: string;
  recordCount: number;
  sourceCount: number;
  acquisitionCounts: {
    consent: number;
    licensed: number;
    generated: number;
  };
  protocols: {
    corpus: "corpus-v1";
    collection: "collection-v1";
    annotation: "annotation-v1";
    generation: "generation-v1";
    pii: "pii-review-v1";
  };
  blockingReasons: CorpusSourceBlockingReason[];
  reportDigest: string;
}

export type SourceReadinessDigestInput = Omit<
  CorpusSourceReadinessReport,
  "reportDigest"
>;

export async function computeSourceReadinessDigest(
  value: SourceReadinessDigestInput,
): Promise<string> {
  return canonicalSha256(value);
}

export async function parseCorpusSourceReadinessReport(
  value: unknown,
): Promise<CorpusSourceReadinessReport>;
```

O parser implementa estas regras fechadas, sem coerção:

- objeto raiz aceita exatamente `schemaVersion`, `status`, `sourceManifestDigest`, `recordCount`, `sourceCount`, `acquisitionCounts`, `protocols`, `blockingReasons`, `reportDigest`;
- `acquisitionCounts`, `protocols` e cada razão também rejeitam chave desconhecida; razões aceitam somente `code`, `recordId?`, `sourceId?`;
- `sourceManifestDigest` e `reportDigest` casam `/^[a-f0-9]{64}$/u`; contagens são inteiros seguros não negativos e `consent + licensed + generated === recordCount`;
- `code` pertence literalmente a `CORPUS_SOURCE_BLOCKING_CODES`; IDs presentes são strings não vazias;
- a ordem canônica de razões é a comparação ordinal por `[code, recordId ?? "", sourceId ?? ""]`; ordem divergente ou razão idêntica duplicada é inválida;
- `ready` exige zero razões e `blocked` exige pelo menos uma; todos os cinco protocolos precisam dos literais declarados;
- após validar/copiar o objeto, o parser recalcula `await computeSourceReadinessDigest({...report sem reportDigest})` e exige igualdade literal lowercase com `reportDigest`.

O produtor da Fase 3 deve ordenar as razões antes do digest; o helper não mascara input não canônico ordenando implicitamente. O contrato é a única fonte desses nove códigos e da shape do relatório: a Fase 3 importa e produz, sem redeclarar.

`sourceManifestDigest` é o self-digest canônico de `ReviewedSourceManifestV1` sem seu próprio campo, não o SHA bruto do arquivo. O SHA bruto permanece em `DatasetManifest.sourceManifestSha256`/`DatasetAudit.sourceManifestSha256`; o `fit` verifica os dois para formar a ponte entre readiness e os bytes selados.

- [ ] **Step 5: Implementar manifesto fechado e política de release**

```typescript
export interface DatasetManifest {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  scientificUse: "release" | "infrastructure-only";
  intendedLanguage: "pt-BR";
  intendedDomain: "linkedin";
  createdAt: string;
  normalizationVersion: string;
  annotationProtocolVersion: "annotation-v1";
  recordsFile: "records.jsonl";
  recordsSha256: string;
  reviewLedgerFile: "private/review-ledger.jsonl";
  reviewLedgerSha256: string;
  sourceManifestFile: "private/source-manifest.json";
  sourceManifestSha256: string;
  heldOutGeneratorFamilies: [string, ...string[]];
  licenses: Array<{
    id: string;
    name: string;
    source: string;
    evaluationUseApproved: true;
    redistribution: "allowed" | "not-published";
    notice: string;
  }>;
}

export interface DatasetFileDigests {
  recordsSha256: string;
  reviewLedgerSha256: string;
  sourceManifestSha256: string;
}

export interface CorpusPolicy {
  counts: { human: number; ai: number; mixed: number };
  requiredHumanSourceTypes: readonly string[];
  requiredHardNegativeFamilies: readonly string[];
}

export const RELEASE_CORPUS_POLICY: CorpusPolicy = {
  counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
  requiredHumanSourceTypes: [
    "broetry",
    "recruiting",
    "sales",
    "career",
    "technology",
    "formal",
  ],
  requiredHardNegativeFamilies: [
    "formulaic",
    "motivational",
    "highly-polished",
    "repetitive",
    "non-native",
    "corporate-structure",
  ],
};

export interface DatasetAudit {
  datasetId: string;
  scientificUse: DatasetManifest["scientificUse"];
  releaseEligible: boolean;
  recordCount: number;
  counts: Record<"human" | "ai" | "mixed", number>;
  sourceTypes: Record<string, number>;
  hardNegativeFamilies: Record<string, number>;
  generatorFamilies: Record<string, number>;
  licenses: string[];
  recordsSha256: string;
  reviewLedgerSha256: string;
  sourceManifestSha256: string;
  sealed: true;
  auditDigest: string;
}
```

`runValidate` calcula os três `DatasetFileDigests` diretamente dos bytes locais antes do parse. `sealDataset` exige igualdade literal com o manifesto, além de composição exata, dois revisores distintos, adjudicador distinto quando aplicável, todas as licenças presentes no inventário com `evaluationUseApproved: true` e pelo menos um registro de cada source/hard-negative obrigatório. `auditDigest` é `canonicalSha256` do `DatasetAudit` completo sem o próprio campo; exporte `computeDatasetAuditDigest(input: Omit<DatasetAudit, "auditDigest">): Promise<string>` e `parseDatasetAudit(value: unknown): Promise<DatasetAudit>`, com schema fechado, recálculo do digest e `sealed === true`. Assim `computeDatasetDigest`, que inclui o manifesto canônico, vincula também o ledger de revisão e o manifesto fechado de autorização/geração produzido pela Fase 3; trocar qualquer um desses bytes invalida o dataset, e trocar qualquer conclusão da auditoria invalida `auditDigest`. A Fase 2 verifica existência/hash, mas a Fase 3 é dona do schema e da auditoria semântica de `source-manifest.json`.

`redistribution: "not-published"` é válido porque records brutos permanecem locais; somente uma fonte `allowed` poderia ter seu texto redistribuído, e esta fase não publica texto de nenhuma fonte. A família reservada precisa existir somente em registros `ai|mixed` e possuir ao menos 200 positivos elegíveis; ela ainda não é atribuída ao teste nesta tarefa. `releaseEligible` só pode ser `true` quando `scientificUse === "release"`; fixtures sintéticas usam `infrastructure-only`, percorrem os mesmos validadores de escala, mas recebem gate de integridade `reject` antes de qualquer perfil.

- [ ] **Step 6: Escrever os três protocolos operacionais sem dados pessoais**

`annotation-v1.md` deve registrar sequência de dois revisores, adjudicação e regra de ground truth; `pii-review-v1.md` deve exigir busca automatizada seguida de revisão manual e proibir URL/nome/handle; `corpus-v1.md` deve definir as contagens, fontes permitidas, ausência de scraping indiscriminado e estrutura local:

```text
benchmark/data/ptbr-linkedin-v1/
  manifest.json
  records.jsonl
  private/review-ledger.jsonl
  private/source-manifest.json
  private/test-labels.jsonl
```

- [ ] **Step 7: Executar testes focados**

Run: `npx vitest run tests/unit/contracts/source-readiness.test.ts benchmark/tests/schema.test.ts benchmark/tests/dataset-manifest.test.ts`

Expected: PASS, incluindo contrato fechado/digest de source readiness, rejeição de contagem incorreta, auditoria adulterada e licença não aprovada.

- [ ] **Step 8: Commit**

```powershell
git add contracts/source-readiness.ts tests/unit/contracts/source-readiness.test.ts benchmark/dataset-manifest.ts benchmark/tests/dataset-manifest.test.ts benchmark/templates/dataset-manifest.example.json benchmark/protocols/annotation-v1.md benchmark/protocols/pii-review-v1.md benchmark/protocols/corpus-v1.md
git commit --no-verify -m "feat: seal the licensed PT-BR corpus contract"
```

---

### Task 3: Paridade do runtime, previsões estritas e completude como hard fail

**Files:**
- Create: `contracts/runtime-parity.ts`
- Create: `scripts/runtime-parity.mjs`
- Create: `scripts/runtime-parity.d.mts`
- Create: `tests/unit/contracts/runtime-parity.test.ts`
- Create: `tests/unit/scripts/runtime-parity.test.ts`
- Create: `benchmark/prediction-schema.ts`
- Create: `benchmark/tests/prediction-schema.test.ts`
- Modify: `benchmark/cli.ts`
- Modify: `benchmark/tests/cli.test.ts`

**Interfaces:**
- Consumes: IDs de `BenchmarkRecord`, manifesto de modelo v2 e `canonicalJson`/`canonicalSha256` da Fase 1.
- Produces: `RuntimeParityManifestV1`, `parseRuntimeParityManifestV1`, `computeRuntimeParityDigest`, `buildRuntimeParityManifest`, `writeRuntimeParityManifest`, `RELEASE_CHROME_VERSION`, `PredictionManifestV1`, `StrictPredictionV2`, `computePredictionManifestDigest`, `parsePredictionManifest`, `parsePredictions`, `validatePredictionShards` e `assertPredictionCompleteness`.

- [ ] **Step 1: Fixar por teste scores, identidade e cobertura exata**

```typescript
import { describe, expect, it } from "vitest";

import {
  assertPredictionCompleteness,
  parsePredictions,
} from "../prediction-schema.ts";

const valid = {
  schemaVersion: 1,
  id: "post-001",
  status: "scored",
  documentRawScore: 0.7,
  localizedRawScore: 0.8,
  evidenceQuality: "sufficient",
  reasonCode: "SCORED",
  coverage: 1,
  latencyMs: 120,
  memoryBytes: 10_000,
};

describe("predictions", () => {
  it("rejects scores outside the probability range", () => {
    expect(() => parsePredictions(JSON.stringify({ ...valid, documentRawScore: 1.1 }))).toThrow(
      /documentRawScore must be between 0 and 1/,
    );
  });

  it("rejects duplicate ids instead of overwriting", () => {
    expect(() => parsePredictions(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}`)).toThrow(
      /duplicate prediction id post-001/,
    );
  });

  it("requires null scores and a reason for abstained or error records", () => {
    expect(() =>
      parsePredictions(
        JSON.stringify({ ...valid, status: "abstained", reasonCode: "TOO_SHORT" }),
      ),
    ).toThrow(/scores must be null unless status is scored/);
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...valid,
          status: "error",
          documentRawScore: null,
          localizedRawScore: null,
          reasonCode: "",
        }),
      ),
    ).toThrow(/reasonCode must be a non-empty string/);
  });

  it("fails on missing and extra predictions", () => {
    expect(() => assertPredictionCompleteness(["post-001", "post-002"], [valid])).toThrow(
      /missing=post-002/,
    );
    expect(() => assertPredictionCompleteness(["post-001"], [valid, { ...valid, id: "extra" }])).toThrow(
      /extra=extra/,
    );
  });
});
```

- [ ] **Step 2: Confirmar que o loader permissivo falha o novo teste**

Run: `npx vitest run tests/unit/contracts/runtime-parity.test.ts tests/unit/scripts/runtime-parity.test.ts benchmark/tests/prediction-schema.test.ts benchmark/tests/cli.test.ts`

Expected: FAIL porque os contratos/helpers de paridade e `prediction-schema.ts` não existem e o CLI atual aceita duplicatas/missing.

- [ ] **Step 3: Criar o contrato puro e o inventário único de paridade**

`contracts/runtime-parity.ts` não usa Node/DOM/Chrome e exporta:

```typescript
export interface RuntimeParityManifestV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  inferenceCoreDigest: string;
  runtimeParityDigest: string;
}

export function parseRuntimeParityManifestV1(value: unknown): RuntimeParityManifestV1;
export function computeRuntimeParityDigest(
  value: Omit<RuntimeParityManifestV1, "runtimeParityDigest">,
): Promise<string>;
```

`runtimeParityDigest` é SHA-256 do JSON canônico dos demais campos. `tokenizerDigest` é SHA-256 canônico dos registros `{bytes,path,sha256}` de `merges.txt`, `special_tokens_map.json`, `tokenizer.json`, `tokenizer_config.json` e `vocab.json`, em ordem lexicográfica de `path`, com a canonicalização exata definida na Fase 1 Task 2 (chaves em ordem alfabética, separadores compactos, sem newline final). O helper recalcula esse valor, exige igualdade com `cleanfeed-model.json.tokenizerDigest` e, para o lock aprovado, fixa o vetor `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9`. `inferenceCoreDigest` é SHA-256 canônico do inventário ordenado `{path,sha256}` de todos os `src/inference/**/*.ts`, mais `contracts/content-composition.ts`, `contracts/calibration-profile.ts`, `contracts/model-release.ts`, `contracts/runtime-parity.ts`, `src/offscreen/worker-host.ts`, `src/shared/constants.ts`, `src/shared/types.ts` e `package-lock.json`. Path ausente, symlink, path fora do repo, arquivo extra sob `src/inference/` não inventariado ou hash não hexadecimal falha fechado.

`scripts/runtime-parity.mjs` exporta `buildRuntimeParityManifest({repoRoot, modelManifestPath})` e `writeRuntimeParityManifest(manifest, outputDirectory)`. O primeiro deriva todos os campos dos bytes/manifesto verificado; o segundo grava atomicamente `runtime-parity.json`. O mesmo arquivo oferece o CLI fechado `node scripts/runtime-parity.mjs write --model-manifest models/tmr-ai-text-detector/cleanfeed-model.json --output-dir benchmark/work/runtime-parity`; rejeite outro subcomando/flag e nunca aceite uma lista de inputs fornecida pelo caller. Os builds candidate da Fase 3 e release da Fase 4 chamam estes mesmos exports/CLI e apenas escolhem diretórios de saída diferentes. Teste que adulterar um asset de tokenizer, um arquivo do core ou o lock muda o digest, enquanto alterar somente o shell do harness não muda.

- [ ] **Step 4: Criar os contratos fechados de previsão**

```typescript
export interface PredictionManifestV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  backend: "wasm" | "webgpu";
  chromeVersion: string;
  datasetDigest: string;
  splitDigest: string;
  partition: "development" | "calibration" | "test";
  shardSize: 100;
  shardCount: number;
  shards: Array<{
    index: number;
    file: string;
    sha256: string;
    recordCount: number;
  }>;
  holdoutConsumptionId: string | null;
  createdAt: string;
}

export const RELEASE_CHROME_VERSION = "150.0.7871.129" as const;

export interface StrictPredictionV2 {
  schemaVersion: 2;
  id: string;
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}
```

Aplicar schema fechado e estas invariantes:

```typescript
if (prediction.coverage < 0 || prediction.coverage > 1) fail("coverage must be between 0 and 1");
if (prediction.reasonCode.trim() === "") fail("reasonCode must be a non-empty string");
if (prediction.status === "scored") {
  assertProbability(prediction.documentRawScore, "documentRawScore");
  assertProbability(prediction.localizedRawScore, "localizedRawScore");
} else if (
  prediction.documentRawScore !== null ||
  prediction.localizedRawScore !== null
) {
  fail("scores must be null unless status is scored");
}
if (prediction.status === "abstained" && prediction.evidenceQuality === "sufficient") {
  fail("abstained prediction cannot have sufficient evidence");
}
if (prediction.status === "error" && prediction.evidenceQuality !== "unsupported") {
  fail("error prediction must have unsupported evidence");
}
if (
  prediction.memoryBytes !== null &&
  (!Number.isFinite(prediction.memoryBytes) || prediction.memoryBytes < 0)
) {
  fail("memoryBytes must be null or a finite nonnegative number");
}
```

`computePredictionManifestDigest` calcula SHA-256 do manifesto canônico completo. `assertPredictionCompleteness(expectedIds, predictions)` deve comparar sets e lançar um único erro ordenado com todos os IDs ausentes/extras; a função também verifica que todas as linhas correspondem ao mesmo manifesto fornecido separadamente. Há exatamente uma linha para cada ID mesmo em abstenção ou erro: nenhum status autoriza omitir o registro. Manifests de development/calibration exigem `holdoutConsumptionId: null`; manifesto de test exige um ID de sessão ativo e matching no ledger. O parser aceita `chromeVersion` como string para artefatos diagnósticos, mas todo caminho com `scientificUse: "release"` exige igualdade literal com `RELEASE_CHROME_VERSION`; versão major igual não basta. `validatePredictionShards` exige `shardSize === 100`, índices contíguos de zero a `shardCount-1`, path relativo sem `..`, SHA-256 válido, no máximo 100 linhas por shard e somente o último shard abaixo de 100; o loader recalcula cada digest antes de concatenar as linhas.

- [ ] **Step 5: Remover `ScoreLine`, `loadScores` permissivo e o skip de missing do CLI**

No caminho legado do `benchmark/cli.ts`, substituir o `Map.set` last-write-wins por `parsePredictions` e substituir `joinScores(...): {records, missing}` por:

```typescript
function joinCompletePredictions(
  records: readonly BenchmarkRecord[],
  predictions: readonly StrictPredictionV2[],
): ScoredRecord[] {
  assertPredictionCompleteness(records.map((record) => record.id), predictions);
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  return records.map((record) => ({ record, prediction: byId.get(record.id)! }));
}
```

O non-null assertion é permitido somente depois da prova de completude na linha anterior.

- [ ] **Step 6: Executar testes e confirmar nenhuma exclusão silenciosa**

Run: `npx vitest run tests/unit/contracts/runtime-parity.test.ts tests/unit/scripts/runtime-parity.test.ts benchmark/tests/prediction-schema.test.ts benchmark/tests/cli.test.ts`

Expected: PASS; o teste de CLI afirma que missing, extra, duplicata e identidade divergente encerram o processo com exit code 1.

- [ ] **Step 7: Commit**

```powershell
git add contracts/runtime-parity.ts scripts/runtime-parity.mjs scripts/runtime-parity.d.mts tests/unit/contracts/runtime-parity.test.ts tests/unit/scripts/runtime-parity.test.ts benchmark/prediction-schema.ts benchmark/tests/prediction-schema.test.ts benchmark/cli.ts benchmark/tests/cli.test.ts
git commit --no-verify -m "feat: bind runtime parity to complete predictions"
```

---

### Task 4: Quase duplicatas determinísticas com MinHash/LSH

**Files:**
- Create: `benchmark/near-duplicates.ts`
- Create: `benchmark/tests/near-duplicates.test.ts`

**Interfaces:**
- Consumes: `BenchmarkRecord[]`.
- Produces: `clusterNearDuplicates(records, options): NearDuplicateResult` sem mutar registros.

- [ ] **Step 1: Escrever testes de exact match, quase duplicata e estabilidade**

```typescript
import { describe, expect, it } from "vitest";

import { clusterNearDuplicates } from "../near-duplicates.ts";

describe("clusterNearDuplicates", () => {
  it("joins normalized duplicates and highly similar shingle sets", () => {
    const result = clusterNearDuplicates(
      [record("a", BASE), record("b", `${BASE} frase adicional curta`), record("c", OTHER)],
      { shingleSize: 5, permutations: 128, bands: 32, jaccardThreshold: 0.82, seed: 712_019 },
    );
    expect(result.clusterById.get("a")).toBe(result.clusterById.get("b"));
    expect(result.clusterById.get("a")).not.toBe(result.clusterById.get("c"));
  });

  it("is independent of input order", () => {
    const forward = clusterNearDuplicates(records, OPTIONS);
    const reverse = clusterNearDuplicates([...records].reverse(), OPTIONS);
    expect([...forward.clusterById].sort()).toEqual([...reverse.clusterById].sort());
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/near-duplicates.test.ts`

Expected: FAIL com módulo ausente.

- [ ] **Step 3: Implementar normalização, candidatos e união exata**

```typescript
export interface NearDuplicateOptions {
  shingleSize: 5;
  permutations: 128;
  bands: 32;
  jaccardThreshold: 0.82;
  seed: number;
}

export interface NearDuplicateResult {
  algorithm: "minhash-lsh-jaccard-v1";
  options: NearDuplicateOptions;
  clusterById: Map<string, string>;
  candidatePairCount: number;
  acceptedPairCount: number;
}
```

Normalizar com `NFKC`, lowercase `pt-BR`, espaços colapsados e tokens Unicode de letras/números. Criar shingles contíguos de cinco tokens. Para a permutação `i`, calcular FNV-1a 32-bit de `` `${seed + i}\0${shingle}` `` e guardar o mínimo unsigned; isso produz 128 mínimos. Formar 32 bandas contíguas de quatro valores, usar `bandIndex:hex1:hex2:hex3:hex4` como bucket e deduplicar pares candidatos pela chave de IDs ordenados. Confirmar cada candidato por Jaccard exato `intersection/union >= 0.82`; exact hash sempre une. O cluster ID é `near_` seguido dos primeiros 16 hex do menor hash de conteúdo do componente, garantindo estabilidade independente da ordem.

Usar union-find local:

```typescript
class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void { if (!this.parent.has(id)) this.parent.set(id, id); }
  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) throw new Error(`unknown disjoint-set id ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }
  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(a.localeCompare(b) <= 0 ? b : a, a.localeCompare(b) <= 0 ? a : b);
  }
}
```

- [ ] **Step 4: Verificar estabilidade e custo limitado**

Run: `npx vitest run benchmark/tests/near-duplicates.test.ts`

Expected: PASS; fixture de 1.000 registros produz menos de 50.000 pares candidatos e resultado idêntico em duas ordens.

- [ ] **Step 5: Commit**

```powershell
git add benchmark/near-duplicates.ts benchmark/tests/near-duplicates.test.ts
git commit --no-verify -m "feat: cluster benchmark near duplicates"
```

---

### Task 5: Split temporal bloqueado por componentes e auditoria

**Files:**
- Modify: `benchmark/split.ts`
- Create: `benchmark/split-audit.ts`
- Modify: `benchmark/tests/split.test.ts`
- Create: `benchmark/tests/split-audit.test.ts`

**Interfaces:**
- Consumes: `BenchmarkRecord`, `NearDuplicateResult` e família reservada do manifesto.
- Produces: `createBlockedSplit(records, policy): DatasetSplit<BenchmarkRecord>` e `auditBlockedSplit(records, split, policy): SplitAudit`.

- [ ] **Step 1: Escrever teste que prova todos os eixos de não vazamento**

```typescript
import { describe, expect, it } from "vitest";

import { auditBlockedSplit } from "../split-audit.ts";
import { createBlockedSplit } from "../split.ts";

describe("createBlockedSplit", () => {
  it("keeps connected groups together and the holdout family in test", () => {
    const split = createBlockedSplit(DATASET, {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: ["family-unseen"],
      seed: 712_019,
    });
    const audit = auditBlockedSplit(DATASET, split, RELEASE_AUDIT_POLICY);
    expect(audit.leakages).toEqual([]);
    expect(split.test.filter((row) => row.generation?.family === "family-unseen")).not.toHaveLength(0);
    expect([...split.development, ...split.calibration]).not.toContainEqual(
      expect.objectContaining({ generation: expect.objectContaining({ family: "family-unseen" }) }),
    );
  });

  it("does not collapse every linkedin record or every seen family into one component", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    expect(split.development.some((row) => row.domain === "corporate")).toBe(true);
    expect(split.test.some((row) => row.domain === "corporate")).toBe(true);
    expect(split.calibration.some((row) => row.generation?.family === "family-seen")).toBe(true);
    expect(split.test.some((row) => row.generation?.family === "family-seen")).toBe(true);
  });
});
```

- [ ] **Step 2: Confirmar RED contra `groupTimeSplit` atual**

Run: `npx vitest run benchmark/tests/split.test.ts benchmark/tests/split-audit.test.ts`

Expected: FAIL porque o split atual possui `train/calibration/test`, usa 60/20/20 e só agrupa autor.

- [ ] **Step 3: Definir partições, política e componentes union-find**

```typescript
export type Partition = "development" | "calibration" | "test";

export interface DatasetSplit<T> {
  development: T[];
  calibration: T[];
  test: T[];
}

export interface BlockedSplitPolicy {
  fractions: { development: 0.2; calibration: 0.3; test: 0.5 };
  classTolerance: 0.02;
  heldOutGeneratorFamilies: readonly string[];
  seed: number;
}
```

Construir componentes conectados unindo os valores não vazios destes campos:

```typescript
const GROUP_KEYS = [
  "author",
  "source",
  "domainSource",
  "generatorVersion",
  "promptTemplate",
  "collectionBatch",
  "nearDuplicate",
  "derivationRoot",
] as const;
```

Não incluir `record.domain` nem `groups.generatorFamily` em `GROUP_KEYS`. A família configurada como holdout é uma restrição explícita: todos os componentes que a contêm são test-only. Os demais componentes podem compartilhar família, mas nunca versão/lote/template.

- [ ] **Step 4: Implementar o corte temporal determinístico e fail-closed**

Ordenar componentes por `minimumCreatedAt`, depois digest seeded do menor ID. Calcular cortes sobre contagens por classe; um componente entra em `test` somente se `minimumCreatedAt > testCut`, em `calibration` somente se `minimumCreatedAt > calibrationCut && maximumCreatedAt <= testCut`, e em `development` nos demais casos. Componentes holdout precisam satisfazer `minimumCreatedAt > testCut`; caso contrário, lançar `SplitConstraintError("held-out generator family is not temporally eligible for test")`.

Avaliar todos os timestamps distintos nas janelas de ±10% em torno dos quantis-alvo para os dois cortes. Escolher o par que minimiza, nesta ordem:

```typescript
type SplitObjective = readonly [
  maximumClassFractionError: number,
  totalClassFractionError: number,
  developmentOverflow: number,
  calibrationCut: number,
  testCut: number,
];
```

Comparar lexicograficamente. Se o melhor par exceder `0.02` para qualquer classe, lançar erro com as frações obtidas; não relaxar grupos nem tempo.

- [ ] **Step 5: Implementar auditoria científica separada**

```typescript
export interface SplitAuditPolicy {
  minimumTestHumanNegatives: 2_000;
  minimumCriticalFprNegatives: 300;
  minimumCriticalRecallPositives: 200;
  classTolerance: 0.02;
}

export interface SplitAudit {
  sizes: Record<Partition, number>;
  classFractions: Record<BenchmarkLabel, Record<Partition, number>>;
  cutoffs: { latestDevelopment: number; latestCalibration: number; earliestTest: number };
  leakages: Array<{ axis: string; value: string; partitions: Partition[] }>;
  criticalSliceSamples: Array<{
    axis: string;
    key: string;
    negatives: number;
    positives: number;
    fprGateEligible: boolean;
    recallGateEligible: boolean;
  }>;
  heldOutGeneratorFamilies: string[];
  passed: boolean;
  reasons: string[];
}
```

Slices críticos de FPR: `lengthBucket`, `domain`, `humanSourceType`, `temporalCohort`, `hardNegativeFamily`. Slices críticos de recall: `lengthBucket`, `domain`, `generatorExposure`, `transformation`, `mixedFractionBucket`. `generatorExposure` é `unseen` para as famílias reservadas e `seen` para as demais.

- [ ] **Step 6: Executar split e auditoria**

Run: `npx vitest run benchmark/tests/split.test.ts benchmark/tests/split-audit.test.ts`

Expected: PASS; testes provam zero vazamento em todos os oito eixos, corte temporal estrito e falha quando ±2% não é alcançável.

- [ ] **Step 7: Commit**

```powershell
git add benchmark/split.ts benchmark/split-audit.ts benchmark/tests/split.test.ts benchmark/tests/split-audit.test.ts
git commit --no-verify -m "feat: freeze a leakage-safe temporal split"
```

---

### Task 6: JSON canônico compartilhado, digests e artefato de split

**Files:**
- Create: `benchmark/digests.ts`
- Create: `benchmark/split-artifact.ts`
- Create: `benchmark/tests/digests.test.ts`
- Create: `benchmark/tests/split-artifact.test.ts`
- Consume: `contracts/canonical-json.ts` (criado pela Fase 1; não modificar)

**Interfaces:**
- Consumes: manifesto, registros e `SplitAudit`.
- Consumes: `canonicalJson` e `canonicalSha256` da Fase 1.
- Produces: `sha256BytesHex`, `computeDatasetDigest`, `computeEvaluatorDigest`, `buildSplitArtifact` e `validateSplitArtifact`.

- [ ] **Step 1: Escrever testes de reprodutibilidade e adulteração**

```typescript
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import { computeDatasetDigest } from "../digests.ts";

describe("canonical evidence", () => {
  it("sorts object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: [3, { y: 2, x: 1 }] })).toBe(
      '{"a":[3,{"x":1,"y":2}],"z":1}',
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/);
  });

  it("changes the dataset digest when one record changes", async () => {
    const first = await computeDatasetDigest(manifest, [record]);
    const second = await computeDatasetDigest(manifest, [{ ...record, text: `${record.text}!` }]);
    expect(first).not.toBe(second);
  });
});
```

Adicione vetores que mudam apenas `reviewLedgerSha256` e apenas `sourceManifestSha256`; ambos devem mudar `datasetDigest`. Os bytes reais já foram confrontados com esses campos por `sealDataset`, portanto o digest não aceita um hash meramente declarado.

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run tests/unit/contracts/canonical-json.test.ts benchmark/tests/digests.test.ts benchmark/tests/split-artifact.test.ts`

Expected: FAIL porque os adapters de digest/split da Fase 2 ainda não existem; os vetores canônicos da Fase 1 permanecem PASS.

- [ ] **Step 3: Implementar canonicalização e SHA-256**

Não reimplementar `canonicalJson`. `sha256BytesHex` usa `createHash("sha256")` somente em `benchmark/digests.ts` para streams/bytes concatenados; estruturas JSON passam primeiro pelo `canonicalJson` compartilhado. Testar os mesmos vetores da Fase 1 para detectar drift.

```typescript
export async function computeDatasetDigest(
  manifest: DatasetManifest,
  records: readonly BenchmarkRecord[],
): Promise<string> {
  const sortedRecords = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const payload = `${canonicalJson(manifest)}\n${sortedRecords.map(canonicalJson).join("\n")}\n`;
  return sha256BytesHex(new TextEncoder().encode(payload));
}
```

`computeEvaluatorDigest(root)` deve hashear, em ordem lexicográfica, path relativo + NUL + bytes de:

```typescript
export const EVALUATOR_FILES = [
  "contracts/canonical-json.ts",
  "contracts/content-composition.ts",
  "contracts/calibration-profile.ts",
  "contracts/model-release.ts",
  "contracts/source-readiness.ts",
  "contracts/runtime-parity.ts",
  "scripts/runtime-parity.mjs",
  "benchmark/schema.ts",
  "benchmark/dataset-manifest.ts",
  "benchmark/prediction-schema.ts",
  "benchmark/near-duplicates.ts",
  "benchmark/split.ts",
  "benchmark/split-audit.ts",
  "benchmark/digests.ts",
  "benchmark/split-artifact.ts",
  "benchmark/intervals.ts",
  "benchmark/bootstrap.ts",
  "benchmark/calibrators.ts",
  "benchmark/cross-validation.ts",
  "benchmark/calibration-pipeline.ts",
  "benchmark/metrics.ts",
  "benchmark/slices.ts",
  "benchmark/gates.ts",
  "benchmark/report.ts",
  "benchmark/profile-artifact.ts",
  "package-lock.json",
] as const;
```

- [ ] **Step 4: Criar contrato imutável do split**

```typescript
export interface SplitArtifact {
  schemaVersion: 1;
  datasetDigest: string;
  algorithm: "blocked-group-time-v1";
  algorithmDigest: string;
  seed: number;
  policy: BlockedSplitPolicy;
  assignments: Array<{ id: string; partition: Partition }>;
  assignmentsDigest: string;
  splitDigest: string;
  cutoffs: { calibrationCut: number; testCut: number };
  counts: Record<Partition, number>;
  heldOutGeneratorFamilies: string[];
  audit: SplitAudit;
}
```

Calcular `assignmentsDigest` sobre assignments ordenados por ID. Calcular `splitDigest` sobre todo o objeto sem a propriedade `splitDigest`. `validateSplitArtifact` recalcula ambos, exige um assignment por dataset ID, nenhum extra e `audit.passed === true`.

- [ ] **Step 5: Executar testes de digest**

Run: `npx vitest run tests/unit/contracts/canonical-json.test.ts benchmark/tests/digests.test.ts benchmark/tests/split-artifact.test.ts`

Expected: PASS; reordenação de records não muda `datasetDigest`, mas qualquer byte científico alterado muda o digest relevante.

- [ ] **Step 6: Commit**

```powershell
git add benchmark/digests.ts benchmark/split-artifact.ts benchmark/tests/digests.test.ts benchmark/tests/split-artifact.test.ts
git commit --no-verify -m "feat: digest benchmark evidence artifacts"
```

---

### Task 7: Wilson unilateral e bootstrap clusterizado por autor

**Files:**
- Create: `benchmark/intervals.ts`
- Create: `benchmark/bootstrap.ts`
- Create: `benchmark/tests/intervals.test.ts`
- Create: `benchmark/tests/bootstrap.test.ts`

**Interfaces:**
- Produces: `wilsonOneSided`, `percentileInterval` e `clusterBootstrap`.

- [ ] **Step 1: Fixar limites conhecidos e determinismo**

```typescript
import { describe, expect, it } from "vitest";

import { clusterBootstrap } from "../bootstrap.ts";
import { wilsonOneSided } from "../intervals.ts";

describe("wilsonOneSided", () => {
  it("uses the approved one-sided 95% z score", () => {
    const interval = wilsonOneSided(0, 300, "upper");
    expect(interval.confidence).toBe(0.95);
    expect(interval.z).toBe(1.6448536269514722);
    expect(interval.value).toBeCloseTo(0.008937, 5);
  });
});

describe("clusterBootstrap", () => {
  it("resamples whole authors and is seed deterministic", () => {
    const first = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
    });
    const second = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
    });
    expect(first).toEqual(second);
    expect(first.requestedReplicates).toBe(2_000);
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/intervals.test.ts benchmark/tests/bootstrap.test.ts`

Expected: FAIL por módulos ausentes.

- [ ] **Step 3: Implementar Wilson com a constante aprovada**

```typescript
export const ONE_SIDED_95_Z = 1.6448536269514722;

export function wilsonOneSided(
  successes: number,
  total: number,
  bound: "lower" | "upper",
): { value: number; confidence: 0.95; z: typeof ONE_SIDED_95_Z; method: "wilson-one-sided" } {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new RangeError("Wilson counts require integers with 0 <= successes <= total and total > 0");
  }
  const p = successes / total;
  const z2 = ONE_SIDED_95_Z ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius =
    (ONE_SIDED_95_Z / denominator) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total ** 2));
  return {
    value: Math.max(0, Math.min(1, bound === "lower" ? center - radius : center + radius)),
    confidence: 0.95,
    z: ONE_SIDED_95_Z,
    method: "wilson-one-sided",
  };
}
```

- [ ] **Step 4: Implementar bootstrap por clusters completos**

```typescript
export interface BootstrapOptions<T> {
  clusterBy: (item: T) => string;
  iterations: 2_000;
  seed: number;
  statistic: (sample: readonly T[]) => number;
}

export interface BootstrapInterval {
  lower95: number;
  upper95: number;
  requestedReplicates: 2_000;
  validReplicates: number;
  discardedReplicates: number;
  seed: number;
  method: "author-cluster-percentile";
}
```

Agrupar uma vez, sortear `clusterCount` clusters com reposição em cada réplica usando PRNG `xorshift32(seed)`, concatenar clusters completos e descartar estatística não finita. Percentis usam índices interpolados em 2,5% e 97,5%. Lançar erro de elegibilidade quando `validReplicates < 1_000`; nunca substituir por bootstrap por registro.

- [ ] **Step 5: Executar testes estatísticos**

Run: `npx vitest run benchmark/tests/intervals.test.ts benchmark/tests/bootstrap.test.ts`

Expected: PASS; duas seeds iguais geram intervalos byte a byte iguais e autores nunca são fracionados numa réplica.

- [ ] **Step 6: Commit**

```powershell
git add benchmark/intervals.ts benchmark/bootstrap.ts benchmark/tests/intervals.test.ts benchmark/tests/bootstrap.test.ts
git commit --no-verify -m "feat: add auditable confidence intervals"
```

---

### Task 8: Platt, beta, isotonic e seleção por CV agrupada

**Files:**
- Create: `benchmark/calibrators.ts`
- Create: `benchmark/cross-validation.ts`
- Create: `benchmark/tests/calibrators.test.ts`
- Create: `benchmark/tests/cross-validation.test.ts`

**Interfaces:**
- Consumes: pares `rawScore/label/authorGroup` somente de development/calibration e `SerializedCalibratorV1` de `contracts/calibration-profile.ts`.
- Produces: `fitCalibrator`, `applyCalibrator`, `createGroupedFolds` e `selectCalibrator`, todos usando o union canônico da Fase 1.

- [ ] **Step 1: Escrever testes das três famílias monotônicas**

```typescript
import { describe, expect, it } from "vitest";

import { applyCalibrator, fitCalibrator } from "../calibrators.ts";

const samples = [
  { rawScore: 0.05, label: 0 as const },
  { rawScore: 0.2, label: 0 as const },
  { rawScore: 0.7, label: 1 as const },
  { rawScore: 0.95, label: 1 as const },
];

describe.each(["platt", "beta", "isotonic"] as const)("%s calibration", (kind) => {
  it("serializes a monotonic mapping inside [0,1]", () => {
    const model = fitCalibrator(kind, samples);
    const mapped = [0, 0.1, 0.5, 0.9, 1].map((score) => applyCalibrator(model, score));
    expect(mapped.every((score) => score >= 0 && score <= 1)).toBe(true);
    expect(mapped).toEqual([...mapped].sort((a, b) => a - b));
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
```

- [ ] **Step 2: Escrever teste da regra ECE/Brier e desempate Platt**

```typescript
it("selects lowest Brier among ECE-valid candidates and prefers Platt within 0.002", () => {
  const selected = selectCandidateSummary([
    { kind: "isotonic", brier: 0.1000, ece15: 0.03 },
    { kind: "platt", brier: 0.1019, ece15: 0.04 },
    { kind: "beta", brier: 0.0990, ece15: 0.06 },
  ]);
  expect(selected.kind).toBe("platt");
});
```

- [ ] **Step 3: Confirmar RED**

Run: `npx vitest run benchmark/tests/calibrators.test.ts benchmark/tests/cross-validation.test.ts`

Expected: FAIL por módulos ausentes.

- [ ] **Step 4: Implementar representações serializáveis e aplicação**

```typescript
import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";

export interface CalibrationSample {
  rawScore: number;
  label: 0 | 1;
}

export function applyCalibrator(model: SerializedCalibratorV1, rawScore: number): number;
export function fitCalibrator(
  kind: SerializedCalibratorV1["kind"],
  samples: readonly CalibrationSample[],
): SerializedCalibratorV1;
```

Platt usa o branch canônico `{kind:"platt", slope, intercept}` e `sigmoid(slope * score + intercept)` com `slope >= 0`. Beta usa `{kind:"beta", alpha, beta, intercept}` e `sigmoid(alpha * log(p) - beta * log(1-p) + intercept)`, `alpha >= 0`, `beta >= 0`, com `p` limitado pela constante local `[1e-6, 1-1e-6]`. Ajustar ambos por gradient descent determinístico: learning rate 0,05, L2 `1e-6`, máximo 10.000 iterações e parada quando redução absoluta da log-loss for menor que `1e-10` por 20 iterações; projetar coeficientes monotônicos após cada passo. Isotonic usa o branch `{kind:"isotonic", interpolation:"linear", clamp:true, knots:[{rawScore,calibratedScore}]}`, PAVA e agrupamento de scores empatados antes do fit. A aplicação precisa ser idêntica ao runtime da Fase 1: clamp no primeiro/último knot fora do intervalo e interpolação linear entre os dois knots vizinhos dentro do intervalo; não usar função degrau.

- [ ] **Step 5: Implementar folds disjuntos por autor**

```typescript
export interface GroupedCalibrationSample extends CalibrationSample {
  id: string;
  authorGroup: string;
}

export function createGroupedFolds(
  samples: readonly GroupedCalibrationSample[],
  foldCount: 5,
  seed: number,
): Array<{ train: GroupedCalibrationSample[]; validation: GroupedCalibrationSample[] }>;
```

Ordenar grupos de autor por tamanho decrescente e hash seeded; atribuir cada grupo ao fold com menor tupla `[positiveCount, negativeCount, totalCount, foldIndex]`. Testar que todo ID aparece uma vez em validation e nenhum autor cruza train/validation no mesmo fold.

- [ ] **Step 6: Implementar seleção com out-of-fold predictions**

```typescript
export interface CandidateCalibrationSummary {
  kind: SerializedCalibratorV1["kind"];
  brier: number;
  ece15: number;
  foldCount: 5;
}

export interface SelectedCalibrator {
  model: SerializedCalibratorV1;
  selection: CandidateCalibrationSummary;
  candidates: CandidateCalibrationSummary[];
}
```

Para cada família, fit em train e score validation dos cinco folds; concatenar somente previsões out-of-fold. Remover candidatos com `ece15 > 0.05`. Se nenhum passar, lançar `CalibrationSelectionError("no calibrator satisfies ECE-15 <= 0.05")`. Ordenar por Brier; se qualquer Platt estiver a menos de `0.002` do menor Brier, escolher Platt; caso contrário escolher o menor Brier, desempate `platt`, `beta`, `isotonic`. Refit do vencedor recebe todas as amostras da partição calibration, não test.

- [ ] **Step 7: Executar testes dos calibradores**

Run: `npx vitest run benchmark/tests/calibrators.test.ts benchmark/tests/cross-validation.test.ts`

Expected: PASS; mappings monotônicos, folds sem autor compartilhado e regra `0.002` comprovada.

- [ ] **Step 8: Commit**

```powershell
git add benchmark/calibrators.ts benchmark/cross-validation.ts benchmark/tests/calibrators.test.ts benchmark/tests/cross-validation.test.ts
git commit --no-verify -m "feat: select monotonic score calibrators"
```

---

### Task 9: Fit congelado e seleção conjunta dos limiares 5%/2%

**Files:**
- Create: `benchmark/calibration-pipeline.ts`
- Create: `benchmark/tests/calibration-pipeline.test.ts`

**Interfaces:**
- Consumes: development/calibration records, previsões completas, seus manifests/digests, um `DatasetAudit` validado, um `CorpusSourceReadinessReport` validado, um `RuntimeParityManifestV1` validado e calibradores da Task 8.
- Produces: `fitFrozenCalibration(input): FrozenCalibrationArtifact` e `applyFrozenCalibration`.

- [ ] **Step 1: Escrever teste da união de avisos e ação somente documental**

```typescript
import { describe, expect, it } from "vitest";

import { fitFrozenCalibration } from "../calibration-pipeline.ts";

describe("fitFrozenCalibration", () => {
  it("budgets document OR localized warnings jointly", () => {
    const result = fitFrozenCalibration(calibrationFixture);
    const markedHumans = calibrationFixture.samples.filter(
      (sample) =>
        result.applyDocument(sample.documentRawScore) >= result.thresholds.warningDocument ||
        result.applyLocalized(sample.localizedRawScore) >= result.thresholds.warningLocalized,
    );
    expect(result.thresholdEvidence.warning.falsePositives).toBe(markedHumans.length);
    expect(result.thresholdEvidence.warning.fprUpper95).toBeLessThanOrEqual(0.05);
  });

  it("uses only document score for visual actions", () => {
    const result = fitFrozenCalibration(localizedSpikeFixture);
    expect(result.thresholds.visualDocument).toBeGreaterThanOrEqual(
      result.thresholds.warningDocument,
    );
    expect(result.thresholds).not.toHaveProperty("visualLocalized");
  });

  it("rejects a test partition in fit input", () => {
    expect(() => fitFrozenCalibration({ ...calibrationFixture, partition: "test" })).toThrow(
      /test partition is forbidden during fit/,
    );
  });
});
```

Adicione casos que recusam backend WebGPU, Chrome divergente entre development/calibration, `runtimeParityDigest`/tokenizer/build divergente, digest de manifesto adulterado, `holdoutConsumptionId` não nulo, `DatasetAudit` não selado, `auditDigest` adulterado e dataset audit pertencente a outro dataset. Alterar qualquer um dos dois manifests, o source-readiness report ou o dataset audit depois do fit deve invalidar `artifactDigest`.

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/calibration-pipeline.test.ts`

Expected: FAIL por módulo ausente.

- [ ] **Step 3: Definir o artefato congelado**

```typescript
export interface FrozenCalibrationArtifact {
  schemaVersion: 1;
  model: {
    modelId: string;
    modelVersion: string;
    bundleDigest: string;
    tokenizerDigest: string;
    aggregationVersion: string;
    contentCompositionVersion: string;
  };
  scoringRuntime: {
    runtimeParityDigest: string;
    extensionBuildDigest: string;
    backend: "wasm";
    chromeVersion: "150.0.7871.129";
  };
  predictionManifestDigests: {
    development: string;
    calibration: string;
  };
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
  partitionsUsed: ["development", "calibration"];
  calibrators: {
    document: SerializedCalibratorV1;
    localized: SerializedCalibratorV1;
  };
  selectionEvidence: {
    document: CandidateCalibrationSummary[];
    localized: CandidateCalibrationSummary[];
  };
  thresholds: {
    warningDocument: number;
    warningLocalized: number;
    visualDocument: number | null;
  };
  thresholdEvidence: {
    warning: ThresholdEvidence;
    visual: ThresholdEvidence | null;
  };
  fitSeed: number;
  artifactDigest: string;
}
```

Development serve para congelar candidatos de agregação/OOD recebidos no input; seleção de calibrador e limiar usa calibration. A função deve verificar que nenhum ID atribuído a test está presente em qualquer lista de fit. Antes do ajuste, parsear/recalcular os dois prediction manifests, o runtime parity manifest, o source-readiness report e o dataset audit fornecidos; exigir readiness `ready`, `reportDigest` válido, audit `sealed`, `auditDigest` válido, igualdade de `datasetId` e dos três hashes de arquivos com o manifesto carregado de `--dataset-dir`, `releaseEligible === (manifest.scientificUse === "release")`, `partition`/`holdoutConsumptionId` corretos e igualdade exata de model ID/version, bundle, aggregation/composition, tokenizer, `runtimeParityDigest`, build, backend WASM e versão completa do Chrome. Para fechar o vínculo entre os dois artefatos de governança, ler os mesmos bytes de `DatasetManifest.sourceManifestFile`, conferir seu SHA bruto contra manifesto/audit, exigir no objeto JSON um `sourceManifestDigest` SHA-256, recalculá-lo sobre o JSON canônico sem apenas esse campo e compará-lo literalmente com `sourceReadiness.sourceManifestDigest`; isso não reimplementa o schema semântico da Fase 3. Persistir `datasetAuditDigest = datasetAudit.auditDigest`, `sourceReadinessDigest = sourceReadiness.reportDigest` e os dois prediction manifest digests canônicos no artefato; não aceitar somente paths ou uma identidade fornecida pelo caller.

- [ ] **Step 4: Implementar busca exata O(n²) do par de aviso**

Enumerar thresholds distintos calibrados, incluindo `+Infinity`. Para cada `warningDocument`, pré-marcar registros que passam o documento; percorrer `warningLocalized` em ordem decrescente e adicionar somente registros ainda não marcados. Isso calcula a união sem somar FPRs. Candidato é elegível quando `wilsonOneSided(falsePositives, negatives, "upper").value <= 0.05`.

Ordenar candidatos pela tupla:

```typescript
type WarningCandidateOrder = readonly [
  negativeRecall: number,
  fprUpper95: number,
  negativeWarningDocument: number,
  negativeWarningLocalized: number,
];
```

Assim vence maior recall; empate favorece menor UCB e thresholds mais altos. Para ação, varrer apenas score de documento, exigir threshold maior ou igual ao warning documental e UCB menor ou igual a 0,02; maximizar recall com o mesmo desempate conservador. Se não houver candidato de ação, persistir `visualDocument: null` sem invalidar o aviso.

- [ ] **Step 5: Aplicar e validar digest do artefato**

`applyFrozenCalibration` retorna scores calibrados e booleans `warnedByDocument`, `warnedByLocalized`, `warning`, `visualAction`. Calcular `artifactDigest` com JSON canônico do artefato sem esse campo, incluindo `datasetAuditDigest`, `sourceReadinessDigest`, `scoringRuntime` e os dois prediction manifest digests; qualquer alteração posterior deve ser detectada por `validateFrozenCalibrationArtifact`.

- [ ] **Step 6: Executar testes de calibração**

Run: `npx vitest run benchmark/tests/calibration-pipeline.test.ts benchmark/tests/calibrators.test.ts benchmark/tests/intervals.test.ts`

Expected: PASS; a união inteira respeita 5%, ação usa somente documento e fit rejeita qualquer acesso ao teste.

- [ ] **Step 7: Commit**

```powershell
git add benchmark/calibration-pipeline.ts benchmark/tests/calibration-pipeline.test.ts
git commit --no-verify -m "feat: freeze calibrated warning and action thresholds"
```

---

### Task 10: Métricas completas, ECE-15 e slices

**Files:**
- Modify: `benchmark/metrics.ts`
- Create: `benchmark/slices.ts`
- Modify: `benchmark/tests/metrics.test.ts`
- Create: `benchmark/tests/slices.test.ts`

**Interfaces:**
- Consumes: records, predictions e `FrozenCalibrationArtifact`.
- Produces: `computeEvaluationMetrics`, `ece15`, `brierScore`, `simulatedPrecision`, `buildSlices` e `summarizeSlices`.

- [ ] **Step 1: Escrever testes de ECE, Brier, cobertura e prevalência**

```typescript
import { describe, expect, it } from "vitest";

import {
  brierScore,
  ece15,
  simulatedPrecision,
} from "../metrics.ts";

describe("calibration metrics", () => {
  it("uses fifteen equal-width bins", () => {
    expect(ece15([{ probability: 0.01, label: 0 }, { probability: 0.99, label: 1 }])).toBeCloseTo(0.01);
  });

  it("computes Brier and base-rate precision", () => {
    expect(brierScore([{ probability: 0.2, label: 0 }, { probability: 0.8, label: 1 }])).toBeCloseTo(0.04);
    expect(simulatedPrecision({ truePositiveRate: 0.8, falsePositiveRate: 0.05, prevalence: 0.01 })).toBeCloseTo(0.1391, 3);
  });
});
```

- [ ] **Step 2: Escrever testes que mantêm `mixed` fora dos negativos humanos**

```typescript
it("reports mixed records by AI fraction instead of counting them as human", () => {
  const metrics = computeEvaluationMetrics(mixedFixture, options);
  expect(metrics.binary.negatives).toBe(mixedFixture.filter((item) => item.record.label === "human").length);
  expect(metrics.mixed.atLeastHalfAi.sampleSize).toBe(2);
  expect(metrics.mixed.atLeastHalfAi.warningRecall).toBe(0.5);
});
```

- [ ] **Step 3: Confirmar RED**

Run: `npx vitest run benchmark/tests/metrics.test.ts benchmark/tests/slices.test.ts`

Expected: FAIL porque métricas atuais são apenas pontuais e excluem `hybrid`.

- [ ] **Step 4: Substituir o contrato binário pelo relatório estatístico v2**

```typescript
export interface MetricEstimate {
  value: number;
  lower95?: number;
  upper95?: number;
  method: "point" | "wilson-one-sided" | "author-cluster-percentile";
}

export interface DecisionMetrics {
  sampleSize: number;
  positives: number;
  negatives: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  falsePositiveRate: MetricEstimate;
  recall: MetricEstimate;
  precision: MetricEstimate;
}

export interface EvaluationMetrics {
  warning: DecisionMetrics;
  visualAction: DecisionMetrics | null;
  rocAuc: MetricEstimate;
  prAuc: MetricEstimate;
  brier: MetricEstimate;
  ece15: MetricEstimate;
  coverage: MetricEstimate;
  abstentionRate: MetricEstimate;
  errorRate: MetricEstimate;
  simulatedPrecision: Record<"prevalence01" | "prevalence05" | "prevalence10", number>;
  latency: LatencyMetrics;
  memory: MemoryMetrics;
  mixed: {
    atLeastHalfAi: { sampleSize: number; warningRecall: number; warningRecallLower95: number };
    byFraction: SegmentMetrics[];
  };
}
```

ECE-15 usa bins iguais `[0,1/15), ... [14/15,1]`; cada bin contribui `n_bin/n * |meanProbability - positiveRate|`. Brier usa média de `(p-y)^2`. Coverage é `status === "scored" / eligible`, onde elegível exige PT-BR e pelo menos 50 palavras; abstention rate conta `status === "abstained"` e error rate conta `status === "error"` separadamente. Latência por registro é obrigatória; memória agrega somente valores não nulos. O gate de memória de 512 MiB vem da execução Chrome/CDP da Fase 4 e entra no relatório/evidência final, sem fabricar memória por post. Bootstrap de ROC-AUC, PR-AUC, Brier e ECE usa exatamente 2.000 réplicas clusterizadas por `groups.author`.

- [ ] **Step 5: Implementar slices, macro e pior slice**

```typescript
export type SliceAxis =
  | "lengthBucket"
  | "domain"
  | "humanSourceType"
  | "temporalCohort"
  | "hardNegativeFamily"
  | "generatorExposure"
  | "transformation"
  | "severity"
  | "mixedFraction";

export interface SliceResult {
  axis: SliceAxis;
  key: string;
  sampleSize: number;
  positives: number;
  negatives: number;
  fprGateEligible: boolean;
  recallGateEligible: boolean;
  metrics: EvaluationMetrics;
}

export interface SliceSummary {
  slices: SliceResult[];
  macro: { warningFpr: number; warningRecall: number; actionFpr: number | null; actionRecall: number | null };
  worst: { warningFpr?: SliceResult; warningRecall?: SliceResult; actionFpr?: SliceResult; actionRecall?: SliceResult };
}
```

Faixas de tamanho permanecem `50_79`, `80_99`, `100_149`, `150_299`, `300_PLUS`; mistura usa `0_24`, `25_49`, `50_74`, `75_100`. `generatorExposure` compara família com `heldOutGeneratorFamilies` do split.

- [ ] **Step 6: Executar métricas e slices**

Run: `npx vitest run benchmark/tests/metrics.test.ts benchmark/tests/slices.test.ts benchmark/tests/bootstrap.test.ts`

Expected: PASS; relatórios possuem n explícito, Wilson nos rates e bootstrap clusterizado nas métricas contínuas.

- [ ] **Step 7: Commit**

```powershell
git add benchmark/metrics.ts benchmark/slices.ts benchmark/tests/metrics.test.ts benchmark/tests/slices.test.ts
git commit --no-verify -m "feat: report calibrated metrics by risk slice"
```

---

### Task 11: Gates científicos e relatório `pass | indicator-only | reject`

**Files:**
- Create: `benchmark/gates.ts`
- Create: `benchmark/tests/gates.test.ts`
- Modify: `benchmark/report.ts`
- Create: `benchmark/tests/report.test.ts`

**Interfaces:**
- Consumes: integridade, `EvaluationMetrics`, `SliceSummary` e evidência de calibração.
- Produces: `evaluateReleaseGates(input): GateReport` e `buildBenchmarkReport(input): BenchmarkReport` schema v2.

- [ ] **Step 1: Escrever tabela de decisão em testes**

```typescript
import { describe, expect, it } from "vitest";

import { evaluateReleaseGates } from "../gates.ts";

describe("release decision", () => {
  it.each([
    ["all gates pass", passingEvidence, "pass"],
    ["warning passes but action FPR fails", actionFprFailure, "indicator-only"],
    ["warning passes but an action slice lacks 300 negatives", actionSampleGap, "indicator-only"],
    ["warning FPR fails", warningFprFailure, "reject"],
    ["prediction completeness fails", incompletePredictions, "reject"],
    ["coverage falls below 80%", lowCoverage, "reject"],
  ] as const)("%s -> %s", (_name, evidence, expected) => {
    expect(evaluateReleaseGates(evidence).decision).toBe(expected);
  });
});
```

Em `report.test.ts`, construa os três manifests completos, prove que seus digests, `datasetAuditDigest`, `sourceReadinessDigest` e o `holdoutConsumptionId` ativo aparecem no relatório e que test com dataset audit, readiness, consumption ID, tokenizer, parity, build, backend ou Chrome divergente falha antes de métricas. Alterar dataset audit, source readiness, `runtimeParityDigest`, consumption ID ou qualquer prediction manifest digest muda `reportDigest`.

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/gates.test.ts benchmark/tests/report.test.ts`

Expected: FAIL por `gates.ts` ausente e report schema v1.

- [ ] **Step 3: Implementar gates estruturados sem booleanos implícitos**

```typescript
export type ReleaseDecision = "pass" | "indicator-only" | "reject";

export interface GateResult {
  id: string;
  tier: "integrity" | "warning" | "action";
  scope: "overall" | "slice";
  slice?: { axis: SliceAxis; key: string };
  observed: number | null;
  bound: "point" | "lower95" | "upper95" | "exact";
  operator: "<=" | ">=" | "==";
  required: number | boolean;
  sampleSize: number;
  eligible: boolean;
  passed: boolean;
  reasons: string[];
}

export interface GateReport {
  schemaVersion: 1;
  decision: ReleaseDecision;
  gates: GateResult[];
  failedIntegrity: string[];
  failedWarning: string[];
  failedAction: string[];
}
```

Gerar gates exatos:

- integridade: `scientificUse === "release"`, licença, hashes do review/source manifest, `datasetAuditDigest` selado/coerente, `sourceReadinessDigest` ready/coerente, schema, dataset/split/evaluator/calibration digest, split audit, prediction completeness, os três prediction manifest digests, identidade única de bundle/agregação/composição/tokenizer/runtime parity/build/backend WASM/Chrome, sessão de holdout ativa e error rate menor que 1%;
- warning: FPR upper95 `<=0.05` overall e slices críticos elegíveis, recall lower95 `>=0.60`, coverage `>=0.80`, ECE-15 `<=0.05`, e recall observado `>=0.50` em mixed com fração de IA `>=0.50`; o IC de mixed é reportado, mas não substitui o gate pontual aprovado;
- action: `visualDocument !== null`, FPR upper95 `<=0.02` overall e slices críticos elegíveis, recall lower95 `>=0.35`;
- slice crítico abaixo da amostra não autoriza ação e força no máximo `indicator-only`; se um slice com amostra suficiente exceder 5%, produz `reject`.

Decisão pura:

```typescript
const decision: ReleaseDecision =
  failedIntegrity.length > 0 || failedWarning.length > 0
    ? "reject"
    : failedAction.length > 0
      ? "indicator-only"
      : "pass";
```

- [ ] **Step 4: Evoluir o relatório para schema v2**

```typescript
export interface BenchmarkReport {
  schemaVersion: 2;
  generatedAt: string;
  holdoutConsumptionId: string;
  dataset: { id: string; version: string; digest: string };
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  split: { digest: string; strategy: "blocked-group-time-v1"; audit: SplitAudit };
  evaluatorDigest: string;
  runtimeParityDigest: string;
  model: {
    id: string;
    version: string;
    bundleDigest: string;
    tokenizerDigest: string;
    aggregationVersion: string;
    contentCompositionVersion: string;
  };
  scoringRuntime: {
    extensionBuildDigest: string;
    backend: "wasm";
    chromeVersion: "150.0.7871.129";
  };
  predictionManifestDigests: {
    development: string;
    calibration: string;
    test: string;
  };
  calibrationArtifactDigest: string;
  metrics: EvaluationMetrics;
  slices: SliceSummary;
  gates: GateReport;
  releaseDecision: ReleaseDecision;
  reportDigest: string;
  notes: string[];
}
```

Antes de calcular métricas, `evaluate` recalcula o digest do manifesto de teste, exige `holdoutConsumptionId` igual à sessão ativa e compara literalmente `datasetAuditDigest`, `sourceReadinessDigest`, toda a identidade `model` (incluindo `tokenizerDigest`), `runtimeParityDigest` e todos os campos de `scoringRuntime` com o artefato congelado/ledger. O report persiste esse mesmo `holdoutConsumptionId`, `datasetAuditDigest` e source-readiness digest, copia os digests development/calibration do freeze e adiciona o digest do manifesto test; assim `reportDigest` sela governança, sessão e as três execuções, e o campo top-level `benchmarkReport.runtimeParityDigest` é o que a Fase 4 compara ao release build. `extensionBuildDigest`, backend e Chrome permanecem auditáveis, mas não entram no cálculo de paridade entre shells de build.

Remover `excludedHybridCount`, `primaryMetric` fixo e `releaseDecisionEligible` derivado apenas do split. Markdown começa pela decisão e razões, depois gates, overall, macro, pior slice e todos os slices. Nunca imprimir “accuracy” como headline; precisão observada e prevalências simuladas devem ser explicitamente distinguidas.

- [ ] **Step 5: Executar gates e relatório**

Run: `npx vitest run benchmark/tests/gates.test.ts benchmark/tests/report.test.ts benchmark/tests/metrics.test.ts`

Expected: PASS; as três decisões aparecem em fixtures independentes e `reportDigest` muda quando um gate muda.

- [ ] **Step 6: Commit**

```powershell
git add benchmark/gates.ts benchmark/report.ts benchmark/tests/gates.test.ts benchmark/tests/report.test.ts
git commit --no-verify -m "feat: gate classifier promotion on benchmark evidence"
```

---

### Task 12: Contrato compartilhado e perfil imutável de calibração

**Files:**
- Create: `benchmark/profile-artifact.ts`
- Create: `benchmark/tests/profile-artifact.test.ts`
- Create: `tests/unit/inference/calibration-profile-contract.test.ts`
- Consume: `contracts/calibration-profile.ts` (criado pela Fase 1; não modificar)
- Consume: `contracts/model-release.ts` (criado pela Fase 1; não modificar)
- Consume: `models/tmr-ai-text-detector/calibration-profiles.json` (template criado pela Fase 1)
- Consume: `models/tmr-ai-text-detector/release.json` (template criado pela Fase 1)

**Interfaces:**
- Consumes: `FrozenCalibrationArtifact`, `BenchmarkReport`, decisão e os parsers/tipos canônicos da Fase 1.
- Produces: `buildModelPublication(input): Promise<ModelPublication>` e `writeModelPublication(publication, modelDirectory): Promise<void>`; não redefine contratos runtime.

- [ ] **Step 1: Escrever teste de identidade completa, expiração e ceilings**

```typescript
import { describe, expect, it } from "vitest";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import { buildModelPublication } from "../profile-artifact.ts";

describe("calibration profile artifact", () => {
  it("binds every evidence digest and expires after exactly 180 days", async () => {
    const publication = await buildModelPublication(passInput);
    const profiles = parseCalibrationProfilesFileV1(publication.profiles);
    const release = parseModelReleaseDescriptorV1(publication.release);
    const profile = profiles.profiles[0];
    expect(Date.parse(profile.expiresAt) - Date.parse(profile.issuedAt)).toBe(180 * 86_400_000);
    expect(profile.tokenizerDigest).toBe(passInput.frozen.model.tokenizerDigest);
    expect(release.tokenizerDigest).toBe(passInput.frozen.model.tokenizerDigest);
    expect(profile.actionCeiling).toBe("hide");
    expect(release.profileDigests).toEqual(profiles.profiles.map((item) => item.profileDigest));
    expect(release.rolloutState).toBe("indicator");
  });

  it("publishes indicator-only without a visual threshold", async () => {
    const publication = await buildModelPublication(indicatorInput);
    expect(publication.profiles.profiles.every((profile) => profile.actionCeiling === "indicator")).toBe(true);
    expect(publication.profiles.profiles.every((profile) => profile.thresholds.documentAction === 1)).toBe(true);
    expect(publication.release.rolloutState).toBe("indicator");
    expect(publication.release.gateDecision).toBe("indicator-only");
  });

  it("publishes a rejected bundle-verified descriptor and empty profiles", async () => {
    const publication = await buildModelPublication(rejectInput);
    expect(publication.profiles.profiles).toEqual([]);
    expect(publication.release.rolloutState).toBe("bundle-verified");
    expect(publication.release.gateDecision).toBe("reject");
    expect(publication.release.profileDigests).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/profile-artifact.test.ts tests/unit/inference/calibration-profile-contract.test.ts`

Expected: FAIL porque o builder ainda não consome os contratos da Fase 1.

- [ ] **Step 3: Consumir os contratos da Fase 1 sem redefini-los**

```typescript
import {
  computeCalibrationProfileDigest,
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
  type RuntimeCalibrationProfileV1,
} from "../contracts/calibration-profile.ts";
import {
  computeCalibrationSetDigest,
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../contracts/model-release.ts";

export interface ModelPublication {
  profiles: CalibrationProfilesFileV1;
  release: ModelReleaseDescriptorV1;
}
```

`benchmark/profile-artifact.ts` importa esses seis exports e não declara tipos runtime concorrentes. Carregar os templates existentes com os dois parsers antes de derivar a publicação. `RuntimeCalibrationProfileV1` já fixa calibradores, thresholds, identidade, evidence policy e digests; qualquer necessidade não representável é bloqueio da Fase 1, não autorização para acrescentar uma segunda interface.

- [ ] **Step 4: Construir um perfil por faixa e calcular digest**

`buildModelPublication` gera três `RuntimeCalibrationProfileV1` nas faixas canônicas da Fase 1: `50-79`, `80-199` e `200-plus`, sempre com `platform=linkedin` e `locale=pt-BR`. `modelId`, `modelVersion`, `bundleDigest`, `tokenizerDigest`, `aggregationVersion` e `contentCompositionVersion` são copiados literalmente do `FrozenCalibrationArtifact`, conferidos contra o `BenchmarkReport` e escritos iguais em cada profile e no release descriptor; o builder rejeita qualquer divergência, inclusive o tokenizer canônico. `50-79` recebe `indicator`, mesmo em `pass`. Em `indicator-only`, todos recebem `indicator` e `thresholds.documentAction = 1`. Em `pass`, `80-199` e `200-plus` recebem `hide` se seus slices constituintes passaram os gates; slice sem amostra recebe `indicator`. Os cinco buckets científicos continuam no relatório e são agregados conservadoramente para os três buckets runtime: o pior gate e o maior threshold aplicável vencem. Evidence sufficient usa `minimumLexicalRatio: 0.60`; `0.40` é somente o início da faixa limited.

O mapping é literal: `warningDocument -> documentIndicator`, `warningLocalized -> localizedIndicator`, `visualDocument ?? 1 -> documentAction`; os calibradores document/localized são copiados sem aproximação. `gateEvidence.intervalMethod` é `wilson-one-sided-95`, ECE usa `bins:15`, e o gate de mixed armazena estimate/intervalo completos embora a decisão compare o estimate observado com 0,50. `gateEvidence.criticalFprSlices` recebe somente os slices FPR elegíveis (`negatives >= 300`), com `indicatorFpr` e `actionFpr`; `gateEvidence.criticalRecallSlices` recebe somente os slices de recall elegíveis (`positives >= 200`), com `indicatorRecall` e `actionRecall` (`null` quando a ação não é aplicável). As chaves são canônicas `${axis}:${key}`. Nunca colapsar os dois mapas em `criticalSlices`, nem reutilizar o N de negativos como N de positivos.

`issuedAt` vem do argumento explícito, nunca de `Date.now()` dentro do builder. `expiresAt = issuedAt + 180*86_400_000`. Usar `computeCalibrationProfileDigest` para cada profile e `computeCalibrationSetDigest` para o arquivo completo; não reimplementar a canonicalização da Fase 1. Atualizar no release template `tokenizerDigest`, `calibrationSetDigest`, `profileDigests`, `aggregationVersion`, `contentCompositionVersion`, `gateDecision`, `issuedAt`, `evidenceDigest` e `rolloutState`. O mapping de evidência é literal e único: `release.evidenceDigest = report.reportDigest`; este é o digest científico, não o digest posterior do pacote sanitizado publicado pela Fase 3. A publicação científica inicial mapeia `pass -> indicator`, `indicator-only -> indicator`, `reject -> bundle-verified`; somente a Fase 4 pode fazer a transição monotônica posterior `pass/indicator -> pass/actions` após seus gates de pacote, paridade e desempenho. Em `reject`, escrever `{schemaVersion:1, profiles:[]}`, seu set digest canônico e lista vazia de profile digests; o descriptor preserva o TMR não promovido e registra `gateDecision: "reject"`.

- [ ] **Step 5: Testar a fronteira compartilhada sem import de `src`**

Em `tests/unit/inference/calibration-profile-contract.test.ts`, validar os dois outputs com `parseCalibrationProfilesFileV1` e `parseModelReleaseDescriptorV1`, recalcular profile/set digests e verificar por leitura estática que nenhum arquivo `benchmark/**/*.ts` contém import que comece com `../src` ou `@/`:

```typescript
expect(importViolations).toEqual([]);
```

- [ ] **Step 6: Executar testes de perfil**

Run: `npx vitest run benchmark/tests/profile-artifact.test.ts tests/unit/inference/calibration-profile-contract.test.ts`

Expected: PASS; perfis/descritor passam nos parsers da Fase 1, os digests conferem e a fronteira benchmark/runtime é respeitada.

- [ ] **Step 7: Commit**

```powershell
git add benchmark/profile-artifact.ts benchmark/tests/profile-artifact.test.ts tests/unit/inference/calibration-profile-contract.test.ts
git commit --no-verify -m "feat: build immutable model publication artifacts"
```

---

### Task 13: CLI científico, ledger do holdout e hygiene final

**Files:**
- Modify: `benchmark/cli.ts`
- Create: `benchmark/commands/validate.ts`
- Create: `benchmark/commands/split.ts`
- Create: `benchmark/commands/validate-predictions.ts`
- Create: `benchmark/commands/fit.ts`
- Create: `benchmark/commands/evaluate.ts`
- Create: `benchmark/commands/publish-profile.ts`
- Create: `benchmark/commands/verify-evidence.ts`
- Create: `benchmark/holdout-ledger.ts`
- Modify: `benchmark/tests/cli.test.ts`
- Create: `benchmark/tests/holdout-ledger.test.ts`
- Create: `benchmark/tests/helpers/generate-synthetic-release-corpus.ts`
- Create: `tsconfig.benchmark.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `benchmark/README.md`
- Modify: `docs/model-validation.md`
- Modify: `docs/release-checklist.md`
- Runtime output: `models/tmr-ai-text-detector/calibration-profiles.json`
- Runtime output: `models/tmr-ai-text-detector/release.json`

**Interfaces:**
- Consumes: todas as funções puras das Tasks 1–12 e previsões externas produzidas pela Fase 3.
- Produces: comandos `validate`, `split`, `validate-predictions`, `fit`, `evaluate`, `publish-profile`, `verify-evidence`, outputs atômicos e os primitives `beginHoldoutConsumption`, `resumeHoldoutConsumption` e `failHoldoutConsumption`. A Fase 3 apenas orquestra o browser scorer e chama esses primitives de ledger/validação.

- [ ] **Step 1: Escrever testes de parsing, ordem obrigatória e consumo único**

```typescript
describe("benchmark CLI workflow", () => {
  it("requires a named subcommand", () => {
    expect(() => parseCliArgs([])).toThrow(
      /expected one of validate, split, validate-predictions, fit, evaluate, publish-profile, verify-evidence/,
    );
  });

  it("prevents fit from receiving test labels", async () => {
    await expect(runCli(["fit", ...FIT_ARGS, "--partition", "test"])).rejects.toThrow(
      /fit accepts only development and calibration/,
    );
  });

  it("requires an active consumption session and rejects a repeated tuple", async () => {
    await expect(runCli(["evaluate", ...EVALUATE_ARGS])).rejects.toThrow(/--consumption-id/);
    const session = await beginHoldoutConsumption(LEDGER, HOLDOUT_IDENTITY, FIXED_TIME);
    await expect(
      resumeHoldoutConsumption(LEDGER, session.consumptionId, HOLDOUT_IDENTITY),
    ).resolves.toMatchObject({ consumptionId: session.consumptionId, status: "started" });
    await runCli(["evaluate", ...EVALUATE_ARGS, "--consumption-id", session.consumptionId]);
    await expect(
      beginHoldoutConsumption(LEDGER, HOLDOUT_IDENTITY, FIXED_TIME),
    ).rejects.toThrow(/holdout tuple was already consumed/);
    await expect(
      resumeHoldoutConsumption(LEDGER, session.consumptionId, HOLDOUT_IDENTITY),
    ).rejects.toThrow(/holdout session is terminal/);
  });
});
```

Em `holdout-ledger.test.ts`, abra uma segunda fixture, chame `failHoldoutConsumption` com um reason code fechado e prove que begin/resume posteriores falham, `active-session.json` é removido e os shards existentes permanecem intactos.

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run benchmark/tests/cli.test.ts benchmark/tests/holdout-ledger.test.ts`

Expected: FAIL porque o CLI atual aceita flags planas e não possui ledger.

- [ ] **Step 3: Implementar dispatcher e argumentos fechados**

```typescript
export type BenchmarkCommand =
  | "validate"
  | "split"
  | "validate-predictions"
  | "fit"
  | "evaluate"
  | "publish-profile"
  | "verify-evidence";

export interface CommonPaths {
  datasetDirectory: string;
  outputDirectory: string;
}
```

Cada command module exporta `runX(options): Promise<void>`. Rejeitar flags desconhecidas e exigir:

```text
validate: --dataset-dir --output
split: --dataset-dir --dataset-audit --output --seed
validate-predictions: --dataset-dir --split-artifact --partition --predictions --runtime-parity; para test, também --ledger --consumption-id
fit: --dataset-dir --dataset-audit --source-readiness --split-artifact --runtime-parity --development-predictions --calibration-predictions --output --seed
evaluate: --dataset-dir --split-artifact --frozen-calibration --test-predictions --test-labels --ledger --consumption-id --output --bootstrap-seed
publish-profile: --report --frozen-calibration --issued-at --model-dir
verify-evidence: --report --frozen-calibration --model-dir
```

Todas as escritas usam arquivo temporário no mesmo diretório, `fsync`, rename atômico e modo de criação exclusiva para ledger/perfis. `validate` calcula e confere `recordsSha256`, `reviewLedgerSha256` e `sourceManifestSha256` antes de chamar `sealDataset`; ausência ou troca de qualquer arquivo encerra o comando. `fit` exige `--dataset-audit`, chama `parseDatasetAudit`, recalcula seu digest e verifica `sealed`, `datasetId`, uso científico e hashes contra o mesmo `DatasetManifest`/bytes de `--dataset-dir` antes de usar qualquer previsão.

O subcomando `evaluate` é a etapa final interna de uma sessão já aberta; ele não abre a sessão nem inicia scoring. A Fase 3 adicionará o comando externo `consume-holdout`, que chama `beginHoldoutConsumption`, executa o browser scorer real em shards de 100 e chama `evaluate` com o `consumptionId` e o manifesto resultante. Assim não existe comando de release capaz de pontuar o holdout antes de consumi-lo.

- [ ] **Step 4: Implementar os sete comandos e outputs exatos**

Comandos de aceitação:

```powershell
npm run benchmark -- validate --dataset-dir benchmark/data/ptbr-linkedin-v1 --output benchmark/out/ptbr-v1/validate
npm run benchmark -- split --dataset-dir benchmark/data/ptbr-linkedin-v1 --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --output benchmark/out/ptbr-v1/split --seed 712019
npm run benchmark -- validate-predictions --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition development --predictions benchmark/data/ptbr-linkedin-v1/predictions/development --runtime-parity dist-model-benchmark/runtime-parity.json
npm run benchmark -- fit --dataset-dir benchmark/data/ptbr-linkedin-v1 --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --source-readiness benchmark/out/ptbr-v1/validate/source-readiness.json --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --runtime-parity dist-model-benchmark/runtime-parity.json --development-predictions benchmark/data/ptbr-linkedin-v1/predictions/development --calibration-predictions benchmark/data/ptbr-linkedin-v1/predictions/calibration --output benchmark/out/ptbr-v1/fit --seed 712019
$activeSession = Get-Content -Raw benchmark/work/holdout/active-session.json | ConvertFrom-Json
$consumptionId = $activeSession.consumptionId
if ([string]::IsNullOrWhiteSpace($consumptionId)) { throw "active holdout session has no consumptionId" }
npm run benchmark -- evaluate --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --test-predictions "benchmark/work/holdout/$consumptionId/predictions" --test-labels benchmark/data/ptbr-linkedin-v1/private/test-labels.jsonl --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --consumption-id $consumptionId --output benchmark/out/ptbr-v1/evaluate --bootstrap-seed 712019
npm run benchmark -- publish-profile --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --issued-at 2026-07-19T00:00:00.000Z --model-dir models/tmr-ai-text-detector
npm run benchmark -- verify-evidence --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --model-dir models/tmr-ai-text-detector
```

Expected por comando:

```text
validate -> Dataset sealed: 10000 records (human=4000, ai=4000, mixed=2000).
split -> Split frozen: development=20%, calibration=30%, test=50%; leakage=0.
validate-predictions -> Prediction artifact valid: missing=0 extra=0 duplicate=0 shardSize=100.
fit -> Calibration frozen without test access; warning UCB target=0.05; action UCB target=0.02.
evaluate -> Sessão de holdout concluída; decision=pass|indicator-only|reject; reportDigest é um SHA-256 lowercase de 64 caracteres.
publish-profile -> pass/indicator-only escrevem perfis; reject escreve profiles=[] e release gateDecision=reject sem erro.
verify-evidence -> parsers e todos os digests de report/calibration-profiles/release conferem.
```

`split` escreve `development.jsonl`, `calibration.jsonl`, `test-input.jsonl` sem labels e `private/test-labels.jsonl` separado. A Fase 3 pode pontuar development/calibration em shards de 100 antes do fit. Para test, ela só lê `test-input.jsonl` depois de `beginHoldoutConsumption` e grava as previsões em `benchmark/work/holdout/$consumptionId/`; o manifesto de test leva o mesmo `holdoutConsumptionId`. O exemplo de `evaluate` acima é invocado pelo orquestrador `consume-holdout` da Fase 3, e `$consumptionId` recebe o valor real emitido pelo ledger na mesma execução.

`validate-predictions` proíbe ledger/consumption ID em development/calibration e os exige para test; sempre recalcula o prediction manifest digest e valida o `RuntimeParityManifestV1` correspondente. `fit` persiste os `auditDigest`/`reportDigest` verificados literalmente como `datasetAuditDigest`/`sourceReadinessDigest`. `verify-evidence` aceita as três decisões: em `reject`, exige profiles vazio, `gateDecision: "reject"` e `rolloutState: "bundle-verified"`; em `indicator-only`, exige `indicator`; em `pass`, aceita o estado científico inicial `indicator` e a promoção monotônica posterior `actions`, sem alterar `release.evidenceDigest = report.reportDigest`. Nos casos não rejeitados recalcula cada profile digest e o calibration set digest. Nenhum dos dois comandos é reservado para implementação posterior.

- [ ] **Step 5: Implementar ledger de consumo por tupla científica**

```typescript
export interface HoldoutConsumption {
  schemaVersion: 1;
  consumptionId: string;
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  backend: "wasm";
  chromeVersion: "150.0.7871.129";
  evaluatorDigest: string;
  calibrationArtifactDigest: string;
  startedAt: string;
  terminalAt: string | null;
  status: "started" | "completed" | "failed";
  reportDigest: string | null;
  failureCode: string | null;
}
```

`assertHoldoutAvailable` compara a tupla científica sem os campos de lifecycle, incluindo `datasetAuditDigest` e `sourceReadinessDigest`; qualquer evento `started` anterior já bloqueia um novo consumo. `beginHoldoutConsumption` usa lockfile, grava `started` com `reportDigest/failureCode: null`, retorna `consumptionId = sha256(tuple + startedAt).slice(0,24)` e grava atomicamente `benchmark/work/holdout/active-session.json` antes de qualquer scoring. A Fase 3 pode inicializar o Chrome e verificar a identidade antes desse ponto, mas não pode ler o primeiro texto de teste.

`resumeHoldoutConsumption` só reabre a mesma sessão `started` quando consumption ID e todos os digests/valores da tupla são idênticos; nunca cria outro ID. `evaluate` exige sessão `started`, identidade completa, prediction manifest digest e `holdoutConsumptionId` iguais; ao terminar grava `completed` com report digest, `failureCode: null` e remove `active-session.json`. `failHoldoutConsumption(ledgerPath, consumptionId, identity, failureCode, terminalAt)` aceita somente uma sessão `started`, um reason code não vazio sem texto livre, grava `failed` com `reportDigest: null`, remove a sessão ativa e nunca apaga shards. Um crash de processo deixa `started` para `--resume`; uma falha declarada irrecuperável chama esse primitive. `completed` e `failed` são terminais e permanecem consumidos.

`benchmark/holdout-ledger.ts` e essas transições pertencem à Fase 2. A Fase 3 importa os primitives, fornece a lease ao browser scorer e finaliza somente após sucesso ou erro declarado irrecuperável; ela não cria outro ledger nem redefine seus estados. O `runId` privado do scorer, quando houver, deve ser igual ao `consumptionId` para a partição test e nunca substitui esse campo público.

- [ ] **Step 6: Incluir benchmark no typecheck e ignorar somente dados gerados**

Criar:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["benchmark/**/*.ts", "contracts/**/*.ts"]
}
```

Adicionar `@types/node` às devDependencies, atualizar lockfile, elevar `engines.node` para `>=22.18` e alterar scripts:

```json
{
  "benchmark": "node benchmark/cli.ts",
  "typecheck:benchmark": "tsc --noEmit --project tsconfig.benchmark.json",
  "typecheck": "tsc --noEmit && tsc --noEmit --project tsconfig.node.json && npm run typecheck:benchmark"
}
```

Adicionar ao `.gitignore`:

```gitignore
benchmark/out/
benchmark/work/
benchmark/data/*
!benchmark/data/.gitkeep
```

Não criar um diretório paralelo de perfis. Os únicos descritores fonte ficam em `models/tmr-ai-text-detector/`; a materialização em `public/models/tmr-ai-text-detector/` continua responsabilidade do build da Fase 1.

- [ ] **Step 7: Atualizar documentação e checklist de release**

`benchmark/README.md` deve documentar os sete comandos, a separação de labels, a proibição de imports de `src/`, os gates e que scoring pertence à Fase 3. `docs/model-validation.md` deve descrever Wilson/cluster bootstrap/calibradores/holdout. `docs/release-checklist.md` deve exigir:

```text
[ ] dataset/dataset-audit/source/review/source-readiness/split/evaluator/model/runtime-parity/report digests conferem
[ ] prediction completeness é 100%; nenhuma linha extra ou duplicada
[ ] manifests development/calibration/test estão ligados ao freeze/report e usam backend WASM
[ ] holdout foi consumido uma única vez
[ ] pass/indicator-only publicam perfis; reject publica arquivo de perfis vazio e descritor bundle-verified
[ ] perfil expira em 180 dias e possui identidade exata do bundle/tokenizer/agregação/composição
[ ] nenhum dataset, label privado ou texto entrou no Git
```

- [ ] **Step 8: Executar verificação focada da fase**

Run: `npm install`

Expected: `package-lock.json` atualizado com `@types/node`, sem dependência estatística de runtime.

Run: `npm run format:check && npm run lint && npm run typecheck`

Expected: todos PASS; `tsconfig.benchmark.json` verifica `benchmark/` e `contracts/`.

Run: `npx vitest run benchmark/tests tests/unit/contracts/source-readiness.test.ts tests/unit/contracts/runtime-parity.test.ts tests/unit/scripts/runtime-parity.test.ts tests/unit/inference/calibration-profile-contract.test.ts`

Expected: todos PASS; nenhum teste pulado.

Run: `npm run docs:check`

Expected: PASS sem links quebrados.

- [ ] **Step 9: Executar smoke de escala com 10.000 registros sintéticos**

`generate-synthetic-release-corpus.ts` deve receber `--output` e `--seed`, criar de forma determinística 4.000 humans, 4.000 AI e 2.000 mixed, distribuir timestamps e grupos para alcançar 20/30/50, reservar `synthetic-heldout-family` no período de teste, preencher todos os tipos humanos/hard negatives e escrever `records.jsonl`, `private/review-ledger.jsonl`, `private/source-manifest.json` e o manifesto com seus três hashes e `scientificUse: "infrastructure-only"`. Cada texto usa tokens exclusivos derivados de `id`; os mixed referenciam pais existentes. O helper escreve somente em `benchmark/work/` e recusa qualquer output fora desse diretório.

Executar:

```powershell
node benchmark/tests/helpers/generate-synthetic-release-corpus.ts --output benchmark/work/smoke/corpus --seed 712019
npm run benchmark -- validate --dataset-dir benchmark/work/smoke/corpus --output benchmark/work/smoke/validate
npm run benchmark -- split --dataset-dir benchmark/work/smoke/corpus --dataset-audit benchmark/work/smoke/validate/dataset-audit.json --output benchmark/work/smoke/split --seed 712019
```

Expected: o gerador informa `human=4000 ai=4000 mixed=2000`; validação e split terminam com exit code 0; o audit traz `releaseEligible=false`, `sealed=true` e `auditDigest` válido, `leakage=0`, teste com pelo menos 2.000 humans e proporções por classe dentro de ±0,02. Repetir os três comandos produz os mesmos digests, e nenhum arquivo de `benchmark/work/` aparece em `git status --short`.

- [ ] **Step 10: Commit**

```powershell
git add benchmark/cli.ts benchmark/commands/validate.ts benchmark/commands/split.ts benchmark/commands/validate-predictions.ts benchmark/commands/fit.ts benchmark/commands/evaluate.ts benchmark/commands/publish-profile.ts benchmark/commands/verify-evidence.ts benchmark/holdout-ledger.ts benchmark/tests/cli.test.ts benchmark/tests/holdout-ledger.test.ts benchmark/tests/helpers/generate-synthetic-release-corpus.ts tsconfig.benchmark.json package.json package-lock.json .gitignore benchmark/README.md docs/model-validation.md docs/release-checklist.md
git commit --no-verify -m "feat: expose the gated benchmark workflow"
```

---

## 2. Critério de conclusão da fase

A Fase 2 está concluída somente quando:

- todos os contratos fechados rejeitam unknown keys e contradições;
- o corpus real pode ser selado somente em 4.000/4.000/2.000 com proveniência/revisão/licença completas;
- qualquer previsão ausente, extra, repetida ou fora de `[0,1]` interrompe a execução;
- near-dup e split são determinísticos, sem vazamento nos oito eixos e sem colapsar LinkedIn/famílias vistas inteiras;
- dataset, dataset audit, source/review manifests, source readiness, split, os três prediction manifests, runtime parity, evaluator, calibração, relatório e perfil possuem digests recalculáveis;
- Wilson usa exatamente `1.6448536269514722` e bootstrap usa exatamente 2.000 réplicas por autor;
- Platt, beta e isotonic passam pela regra 5-fold/Brier/ECE-15/Δ0,002 aprovada;
- limiar de aviso mede a união documento/localizado e ação usa somente documento;
- `evaluate` emite exclusivamente `pass`, `indicator-only` ou `reject` pelas regras estruturadas;
- perfis não vazios ligam modelo, bundle, tokenizer, agregação/composição e toda a evidência e expiram em 180 dias; `pass` nasce em rollout `indicator` para a Fase 4 promover, enquanto `reject` publica somente arquivo vazio e descriptor `bundle-verified`/`gateDecision=reject`;
- `fit` não consegue ler labels de teste e `evaluate` consome o holdout mesmo quando reprova;
- nenhum arquivo em `benchmark/` importa `src/`;
- `npm run format:check`, `npm run lint`, `npm run typecheck`, a suíte de benchmark e `npm run docs:check` passam.

O corpus real e as previsões TMR não são inventados por esta fase. Se as fontes autorizadas ainda não totalizarem 10.000 registros ou a Fase 3 ainda não tiver produzido previsões completas, a infraestrutura pode estar verde, mas nenhuma decisão científica nem perfil de release pode ser emitido.
