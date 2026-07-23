# Runbook — coleta do corpus genérico pt-BR e execução do pipeline TMR

> **O que este documento é:** a especificação exata do que coletar e a sequência
> exata de comandos para transformar um corpus real em uma decisão de release do
> detector TMR. Ele é derivado dos contratos fechados do próprio projeto
> ([schema](../benchmark/schema.ts), [dataset-manifest](../benchmark/dataset-manifest.ts),
> [source-manifest](../benchmark/source-manifest.ts),
> [source-readiness](../contracts/source-readiness.ts), [gates](../benchmark/gates.ts))
> e do parser da CLI ([benchmark/cli.ts](../benchmark/cli.ts)).
>
> **O que este documento não é:** ele não coleta, não raspa e não gera dados. A
> coleta em si — texto licenciado/consentido, auditoria de PII, anotação humana,
> revisão legal — é um entregável de **dados + jurídico + anotação** que acontece
> fora deste repositório. O CleanFeed apenas **ingere** materiais que um workflow
> autorizado já produziu.
>
> A matriz de publicação e os gates de empacotamento ficam em
> [release-checklist.md](release-checklist.md); o contrato de calibração em
> [model-validation.md](model-validation.md); a superfície de evidência em
> [releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md); a estatística no
> [benchmark científico](../benchmark/README.md).

## 0. Invariantes que nunca podem ser violados

Antes de qualquer coisa — estes são inegociáveis e são o motivo de o pipeline
recusar atalhos:

- **Nada de dado real entra no Git.** `benchmark/data/**`, `benchmark/work/**`,
  `benchmark/out/**` e `private/**` são gitignored. O corpus, o ledger, o
  source-manifest e as previsões vivem apenas em disco local.
- **Fail-closed.** Enquanto não houver uma decisão científica selada, o TMR
  **não** classifica o feed — o fallback estilométrico transparente segue ativo,
  limitado ao teto `indicator`. O release fica `pending`/`bundle-verified`.
- **O holdout é consumido uma única vez, para sempre.** `consume-holdout` abre um
  lease *append-only* irreversível (ver §4). Não existe "rodar de novo".
- **Sem PII.** Todo id de identidade/grupo é um token pseudonimizado
  `[A-Za-z0-9_-]` — nunca um nome, handle, e-mail ou URL. O `piiAudit` de cada
  registro é `passed`.
- **Sem alegação de autoria.** A verdade de rótulo vem da *procedência*
  documentada, nunca da opinião de um detector.

## 1. Composição e cobertura do corpus (o "o quê")

A política de release é fechada ([RELEASE_CORPUS_POLICY](../benchmark/dataset-manifest.ts)).
O `sealDataset` só produz um audit se a composição bater **exatamente**:

| Requisito | Valor | Verificado por |
| --- | --- | --- |
| Total | **10.000** registros | `sealDataset` |
| `human` | **4.000** | contagem exata |
| `ai` | **4.000** | contagem exata |
| `mixed` | **2.000** | contagem exata |
| Idioma | `pt-BR` (todos) | schema + manifest |
| Plataforma / domínio | tokens livres por registro (ex.: `generic`); manifest: `datasetId: "ptbr-generic-v1"`, `intendedDomain: "generic"` | schema + manifest |
| Tipos de fonte humana | pelo menos 1 registro de cada: `qa-informal` (SE-PT), `encyclopedic` (Wikipédia), `social-media` (Carolina social/datasets), `university` (Carolina university), `institutional` (Carolina judicial/legislative) | `DATASET_COVERAGE_INVALID` |
| Famílias hard-negative | pelo menos 1 humano de cada: `formulaic`, `motivational`, `highly-polished`, `repetitive`, `non-native`, `corporate-structure` | `DATASET_COVERAGE_INVALID` |
| Famílias de gerador held-out | cada família em `heldOutGeneratorFamilies` precisa de **≥ 200** positivos elegíveis (`ai`/`mixed`) e **não pode** aparecer em nenhum registro `human` | `DATASET_COVERAGE_INVALID` |
| Revisores por registro | **≥ 2 distintos**; adjudicador (se `adjudicated`) independente dos dois | `DATASET_REVIEW_INVALID` |
| Licenças | toda `provenance.licenseId` presente no inventário do manifest | `DATASET_LICENSE_INVALID` |

### Bloqueio temporal (para o split cego 20/30/50)

O `split` corta o corpus por tempo em **development 20% / calibration 30% /
test 50%** e a auditoria recusa qualquer vazamento entre partições. Para o corte
existir de forma limpa, os `createdAt` precisam formar **três blocos temporais
separados** (desenvolvimento mais antigo → teste mais recente), e componentes
ligados por `derivationRoot`/near-duplicate precisam ficar dentro do mesmo bloco.
Consequência prática: um registro `mixed` que aponta para um pai `human` via
`groups.derivationRoot` deve compartilhar o bloco temporal do pai.

Com 4.000 humanos, os 50% do bloco de teste dão **2.000 negativos humanos** — o
suficiente para os pisos de amostra por slice (≥ 300 negativos por slice crítico
para autorizar ação visual; ver §5).

## 2. O registro (`records.jsonl`) — schema v2 fechado

Um JSON por linha, validado por [validateBenchmarkRecord](../benchmark/schema.ts).
**Chaves desconhecidas são recusadas.** Campos:

```jsonc
{
  "schemaVersion": 2,
  "id": "r000001",                       // token opaco [A-Za-z0-9_-], emitido a montante, NUNCA derivado do texto
  "text": "…",                            // texto real; será normalizado NFC+LF na ingestão
  "normalizedTextSha256": "<64 hex>",     // sha256 do texto normalizado; recomputado e conferido no ingest
  "label": "human" | "ai" | "mixed",
  "language": "pt-BR",
  "platform": "generic",
  "domain": "corporate",
  "topic": "geral",
  "humanSourceType": "qa-informal",       // opcional; use os 5 tipos exigidos p/ cobrir human
  "hardNegativeFamily": "formulaic",       // opcional; use as 6 famílias exigidas
  "wordCount": 60,
  "createdAt": 1700000000000,             // número; define o bloco temporal do split
  "provenance": {
    "sourceKind": "authorized-contribution" | "licensed-corpus" | "controlled-generation",
    "sourceId": "src_x",                  // token pseudonimizado; precisa existir no source-manifest
    "sourceRevision": "rev_001",
    "collectedAt": 1700000000000,
    "licenseId": "cc-by-4.0",             // precisa existir no inventário de licenças do manifest
    "licenseUrl": "https://…",            // opcional
    "legalBasis": "consent" | "license" | "generated",
    "consentId": "consent_x",             // opcional (token pseudonimizado)
    "piiAudit": {
      "status": "passed",                 // ÚNICO valor aceito
      "method": "manual-and-automated",   // ÚNICO valor aceito
      "reviewerId": "reviewer_pii",
      "reviewedAt": 1700000000000
    }
  },
  "annotation": {
    "protocolVersion": "annotation-v1",
    "reviewerIds": ["reviewer_a", "reviewer_b"],   // ≥ 2 tokens distintos
    "agreement": "agree" | "adjudicated",
    "adjudicatorId": "reviewer_c"         // obrigatório se agreement = adjudicated; independente dos 2 acima
  },
  "generation": { … },                    // OBRIGATÓRIO se label=ai; PROIBIDO se label=human
  "mixture": { … },                       // OBRIGATÓRIO se label=mixed
  "transformation": { "kind": "none", "severity": "none" },
  "groups": {
    "author": "author_x",                 // eixo de clustering p/ o bootstrap por autor
    "source": "source_x",
    "domainSource": "domainsource_x",
    "generatorFamily": "family_x",        // opcional; usado p/ held-out families
    "generatorVersion": "v1",             // opcional
    "promptTemplate": "tpl_x",            // opcional
    "collectionBatch": "batch_x",
    "nearDuplicate": "nd_x",
    "derivationRoot": "r000001"           // p/ mixed: aponta p/ o id do pai (≠ próprio id)
  }
}
```

**Regras cruzadas (falham fechado):**

- `label: "ai"` → `generation` obrigatório: `{ provider, family, model, version,
  promptId, promptSha256, generatedAt, temperature?, seed? }`.
- `label: "human"` → `generation` proibido.
- `label: "mixed"` → `mixture` obrigatório: `{ aiFraction, humanFraction, spans:
  [{ start, end, origin }] }`; `aiFraction + humanFraction === 1`; spans são
  offsets inteiros `0 ≤ start ≤ end ≤ text.length`; **e** `groups.derivationRoot`
  precisa ser um id de pai diferente do próprio id.
- Todo `sha256` é hex minúsculo de 64 chars. O ingest **recomputa** o
  `normalizedTextSha256` do texto normalizado e recusa (`CONTENT_HASH_CONFLICT`)
  qualquer hash declarado divergente.

## 3. Os arquivos de governança (o "com quê")

O `ingest` recebe **cinco** entradas e escreve o diretório canônico do dataset
de forma atômica (só quando **zero** registros são recusados).

### 3.1 `records.jsonl` — os 10k registros da §2.

### 3.2 `private/review-ledger.jsonl` (independente)

Um JSON válido por linha, ≥ 1 entrada. É a trilha de revisão independente; o
ingest prova que faz *parse*, mas nunca inspeciona os valores. Mantido em bytes
LF-normalizados para o hash.

### 3.3 `private/source-manifest.json` — [ReviewedSourceManifestV1](../benchmark/source-manifest.ts)

Inventário fechado das fontes autorizadas. **Nenhuma URL, nome, handle ou recibo
bruto** — só tokens opacos e digests.

```jsonc
{
  "schemaVersion": 1,
  "sources": [
    {
      "sourceId": "src_consent_1",
      "sourceType": "linkedin-contribution",   // acquisition = "consent"
      "acquisition": "consent",
      "evaluationUseApproved": true,
      "licenseId": null,                        // consent → licenseId null
      "consentReceiptDigest": "<64 hex>",       // consent → digest obrigatório
      "collectionProtocolVersion": "collection-v1",
      "legalReviewerIds": ["legal_a", "legal_b"]  // EXATAMENTE 2, distintos
    },
    {
      "sourceId": "src_licensed_1",
      "sourceType": "licensed-corpus",          // acquisition = "licensed"
      "acquisition": "licensed",
      "evaluationUseApproved": true,
      "licenseId": "cc-by-4.0",                 // licensed/generated → licenseId obrigatório
      "consentReceiptDigest": null,
      "collectionProtocolVersion": "collection-v1",
      "legalReviewerIds": ["legal_a", "legal_c"]
    },
    {
      "sourceId": "src_generated_1",
      "sourceType": "controlled-generation",    // acquisition = "generated"
      "acquisition": "generated",
      "evaluationUseApproved": true,
      "licenseId": "internal-generation-v1",
      "consentReceiptDigest": null,
      "collectionProtocolVersion": "collection-v1",
      "legalReviewerIds": ["legal_b", "legal_c"]
    }
  ],
  "generationBatches": [
    {
      "batchId": "batch_1",
      "sourceId": "src_generated_1",
      "generationProtocolVersion": "generation-v1",
      "provider": "…", "family": "…", "model": "…", "version": "…",
      "promptTemplateDigest": "<64 hex>",
      "temperature": 0.7,
      "generatedAt": 1700000000000,
      "seed": "42",              // EXATAMENTE um de: seed …
      "seedNullReason": null     // … ou seedNullReason (o outro é null)
    }
  ],
  "sourceManifestDigest": "<64 hex>"  // self-digest canônico do corpo (sem este campo)
}
```

Toda `provenance.sourceId` de um registro precisa existir aqui (`SOURCE_ENTRY_ABSENT`).

### 3.4 Template do dataset-manifest (`--dataset-manifest-template`)

Um [DatasetManifest](../benchmark/dataset-manifest.ts) **sem** os seis campos
derivados (o ingest os gera: `recordsFile`, `recordsSha256`, `reviewLedgerFile`,
`reviewLedgerSha256`, `sourceManifestFile`, `sourceManifestSha256` — declará-los
é `TEMPLATE_HAS_DERIVED_FIELD`).

```jsonc
{
  "schemaVersion": 1,
  "datasetId": "ptbr-generic-v1",        // DEVE ser exatamente isto (DATASET_ID_MISMATCH)
  "version": "1.0.0",
  "scientificUse": "release",            // "release" p/ elegibilidade; "infrastructure-only" nunca promove
  "intendedLanguage": "pt-BR",
  "intendedDomain": "generic",
  "createdAt": "2026-08-01T00:00:00.000Z",  // ISO válido
  "normalizationVersion": "cleanfeed-text-v1",
  "annotationProtocolVersion": "annotation-v1",
  "heldOutGeneratorFamilies": ["family_heldout_1"],  // ≥ 1; cada uma ≥200 positivos, só em ai/mixed
  "licenses": [
    {
      "id": "cc-by-4.0",
      "name": "…", "source": "…",
      "evaluationUseApproved": true,
      "redistribution": "allowed" | "not-published",
      "notice": "…"
    }
  ]
}
```

> **Fontes sem consentimento individual** (licenciadas/domínio público/atos
> oficiais), com inventário pronto, blocos `licenses[]`/source-manifest no
> formato exato do `ingest`, política de zero-PII e as implicações do projeto
> aberto não-comercial: ver [corpus-sources.md](corpus-sources.md).

### 3.5 Relatório de source-readiness — [CorpusSourceReadinessReport](../contracts/source-readiness.ts)

Produzido pela governança da Fase 3, consumido pelo `fit`. `status: "ready"` exige
`blockingReasons: []`; `acquisitionCounts.{consent,licensed,generated}` precisa
somar `recordCount`; `sourceManifestDigest` bate com o self-digest do
source-manifest; protocolos fixos (`corpus-v1`/`collection-v1`/`annotation-v1`/
`generation-v1`/`pii-review-v1`). Os nove códigos de bloqueio (ex.:
`SOURCE_LEGAL_REVIEW_MISSING`, `SOURCE_REVIEWERS_NOT_INDEPENDENT`,
`GENERATION_RECIPE_MISSING`) são a lista fechada de motivos de `blocked`.

## 4. A sequência exata do pipeline (o "como")

Pré-requisitos: `npm run model:verify` verde (o ONNX selado presente) e um **build
candidato isolado** para pontuação — `npm run build:model-benchmark` (gera o
`runtime-parity.json` e o diretório de extensão candidato; o `score`/`consume`
**recusam** um diretório terminando em `dist`, use o `dist-model-benchmark`).

Rode dentro do worktree. Os caminhos abaixo são convenção; ajuste às suas pastas.

```bash
# 1) INGEST — materializa o diretório canônico do dataset (atômico, fail-closed)
npm run benchmark -- ingest \
  --input <records.jsonl> \
  --review-ledger <review-ledger.jsonl> \
  --sources <source-manifest.json> \
  --dataset-manifest-template <template.json> \
  --dataset-dir benchmark/data/ptbr-generic-v1

# 2) VALIDATE — sela o dataset e emite o DatasetAudit
npm run benchmark -- validate \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --output benchmark/work/validate

# 3) SPLIT — corte temporal 20/30/50 + auditoria de vazamento (seed fixo)
npm run benchmark -- split \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --dataset-audit benchmark/work/validate/dataset-audit.json \
  --output benchmark/work/split \
  --seed 1

# 4) SCORE — pontua no browser SOMENTE development e calibration (nunca test)
npm run benchmark -- score --partition development \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --split-artifact benchmark/work/split/split-artifact.json \
  --candidate-extension-dir dist-model-benchmark \
  --output benchmark/work/predictions/development
npm run benchmark -- score --partition calibration \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --split-artifact benchmark/work/split/split-artifact.json \
  --candidate-extension-dir dist-model-benchmark \
  --output benchmark/work/predictions/calibration

# 5) VALIDATE-PREDICTIONS — completude/identidade das previsões (dev e cal)
npm run benchmark -- validate-predictions --partition development \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --split-artifact benchmark/work/split/split-artifact.json \
  --predictions benchmark/work/predictions/development \
  --runtime-parity <runtime-parity.json>
#   (idem para --partition calibration)

# 6) FIT — calibração (Platt/beta/isotônico + CV) e congelamento dos limiares
npm run benchmark -- fit \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --dataset-audit benchmark/work/validate/dataset-audit.json \
  --source-readiness <source-readiness.json> \
  --split-artifact benchmark/work/split/split-artifact.json \
  --runtime-parity <runtime-parity.json> \
  --development-predictions benchmark/work/predictions/development \
  --calibration-predictions benchmark/work/predictions/calibration \
  --output benchmark/work/fit \
  --seed 1

# 7) CONSUME-HOLDOUT — ⚠️ IRREVERSÍVEL. Gasta o lease do holdout UMA vez.
#    Pontua o bloco de teste selado e DELEGA a decisão aos gates da Fase 2.
npm run benchmark -- consume-holdout \
  --dataset-dir benchmark/data/ptbr-generic-v1 \
  --split-artifact benchmark/work/split/split-artifact.json \
  --frozen-calibration benchmark/work/fit/frozen-calibration.json \
  --ledger benchmark/data/ptbr-generic-v1/private/holdout-ledger.jsonl \
  --candidate-extension-dir dist-model-benchmark \
  --work-dir benchmark/work/holdout \
  --output benchmark/work/evaluate \
  --bootstrap-seed 1 \
  --confirm-split-digest <splitDigest do split-artifact.json>
#    → imprime: HOLDOUT_COMPLETED decision=pass|indicator-only|reject
#    Se o processo CRASHAR: reabra o MESMO lease com
#      --resume-consumption <id>   (nunca um id novo; um tuple já consumido é recusado)

# 8) PUBLISH-PROFILE — só p/ pass/indicator-only: escreve perfis + descritor indicator
npm run benchmark -- publish-profile \
  --report benchmark/work/evaluate/benchmark-report.json \
  --frozen-calibration benchmark/work/fit/frozen-calibration.json \
  --issued-at 2026-08-01T00:00:00.000Z \
  --model-dir models/cleanfeed-ptbr-v1

# 9) PUBLISH-EVIDENCE — escreve os 7 arquivos sanitizados de evidência versionável
npm run benchmark -- publish-evidence \
  --source-readiness <source-readiness.json> \
  --dataset-audit benchmark/work/validate/dataset-audit.json \
  --split-artifact benchmark/work/split/split-artifact.json \
  --frozen-calibration benchmark/work/fit/frozen-calibration.json \
  --fit-report benchmark/work/fit/fit-report.json \
  --report benchmark/work/evaluate/benchmark-report.json \
  --ledger benchmark/data/ptbr-generic-v1/private/holdout-ledger.jsonl \
  --consumption-id <id da sessão> \
  --model-dir models/cleanfeed-ptbr-v1 \
  --output benchmark/evidence/tmr-ptbr-v1

# 10) VERIFY — confere todos os digests da evidência publicada
npm run model:evidence:verify
```

Depois disso, o descritor está `indicator-only/indicator` (marca com selo, teto
`indicator`) **ou** `pass/indicator` (pré-ativação). A única mutação pós-gate
permitida é `pass/indicator → pass/actions`, via:

```bash
npm run release:activate     # só é válido para pass; libera blur/collapse/hide
```

`reject` escreve perfis vazios + `bundle-verified` (o TMR não entra no pacote) e o
fallback estilométrico permanece.

## 5. A decisão (gates §6.5, verbatim de [gates.ts](../benchmark/gates.ts))

Ramos: **qualquer** gate de integridade ou de *warning* falho → `reject`; todos os
*warning* passam mas um *action* falha → `indicator-only`; todos passam → `pass`.

- **Integridade** (booleanos + erro): scientificUse=release, inventário de licença,
  hashes de review-ledger/source-manifest, audit selado, source-readiness ready,
  schema, digests de dataset/split/evaluator/calibração, split-audit, completude e
  digests das previsões, identidade única de runtime, sessão de holdout ativa, e
  **error rate < 1%** (estrito).
- **Warning:** FPR overall e por slice crítico **upper95 ≤ 5%**; recall overall
  **lower95 ≥ 0.6**; cobertura **≥ 0.8**; ECE-15 **≤ 0.05**; recall de `mixed`
  (≥50% IA) **≥ 0.5**.
- **Action:** limiar de ação congelado presente; FPR overall e por slice crítico
  **upper95 ≤ 2%**; recall overall **lower95 ≥ 0.35**. Um slice crítico de FPR com
  **< 300 negativos** não é elegível: não bloqueia o warning, mas **impede** ação
  visual (limita a decisão a `indicator-only`).

Slices críticos de FPR: `lengthBucket`, `domain`, `humanSourceType`,
`temporalCohort`, `hardNegativeFamily`.

## 6. Desempenho na máquina de referência (item opcional 4)

**Só roda depois da promoção.** Com `gateDecision: pending`, o runner recusa com
`RELEASE_NOT_ELIGIBLE` ([run-release-performance.mjs](../scripts/run-release-performance.mjs)).
Após `indicator-only`/`pass`:

```bash
npm run test:performance:release
```

na referência pinada — **Windows 11 / 4 CPUs lógicas / 8 GiB / Chrome for Testing
`150.0.7871.129` / backend WASM**. Orçamentos (item 11 do
[release-checklist](release-checklist.md)): cold ≤ 10 s, warm p95 ≤ 2 s, memória
incremental ≤ 512 MiB, erro < 1%, maior tarefa da main thread ≤ 50 ms. Em `reject`
a evidência de desempenho é `not-applicable`, sem números artificiais.

## 7. Portão final

Depois de promover e medir, o portão agregado de publicação é:

```bash
npm run verify:release              # base + E2E de release
npm run test:performance:release    # na referência
npm run release:assert-publishable  # só passa em reject/bundle-verified,
                                    # indicator-only/indicator ou pass/actions
```

Percorra a [checklist de release](release-checklist.md) por inteiro — inclusive as
assinaturas manuais (revisão de licença, aprovação do responsável). Nenhuma
alegação de acurácia é feita em lugar nenhum: a apresentação fala em filtro
**probabilístico** e **sinais compatíveis**, e a limitação canônica permanece —
*"Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA.
Isso não comprova sua origem."*
