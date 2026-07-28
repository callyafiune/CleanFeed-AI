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
> coleta em si — extração de base pública licenciada, auditoria de PII, anotação
> humana, revisão legal — é um entregável de **dados + jurídico + anotação** que
> acontece fora deste repositório. O CleanFeed apenas **ingere** materiais que um
> workflow autorizado já produziu.
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
- **Somente bases públicas licenciadas (B3, 2026-07-26).** A coleta humana entra
  por uma única rota: base publicada, com licença verificada na fonte. Nenhum
  passo deste runbook pede autorização por documento a uma pessoa, convida alguém
  a ceder texto próprio, ou registra sessão de escrita nossa. A restrição é de
  **aquisição** e não de categoria de evidência: base pública que já contenha
  sessões instrumentadas continua admissível, com base de rótulo
  `observed-process`. O rótulo `human` das quatro fontes da v3 vem do corte
  `< 2022-11-30`, que é **mitigação declarada** e não prova de autoria humana —
  o campo de data que ancora cada fonte está em
  [corpus-sources.md](corpus-sources.md), e o que a decisão fecha em
  [limitations.md](limitations.md).
- **O corpus não repete o que treinou o detector, sob contrato explícito.** Nenhum
  registro pode ser quase-duplicata de nada em
  `benchmark/data/dataset/{train,dev}.jsonl`. O contrato verificado é **hash exato
  + Jaccard ≥ 0,82 sobre shingles de 5 tokens** (`near_dupes.drop_seen()`), e é só
  isso: **não é independência semântica**. Um registro pode tratar do mesmo assunto,
  citar a mesma fonte ou parafrasear um texto de treino e passar folgado pelo limiar.
  Ao declarar o invariante, declare o contrato — dizer "independente" sem qualificar
  é alegar mais do que se mediu. Contaminação aqui não quebra o pipeline — ela
  **infla a métrica**, e o benchmark passa a parecer melhor do que o detector é.
  Nenhum gate da esteira audita isso: `validate` e `split` nunca veem o conjunto de
  treino, então o invariante só existe se for imposto na montagem (ver §1.1).

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

### 1.1 Independência do conjunto de treino (verificação obrigatória)

O corpus selado mede um detector já treinado. Se um registro do corpus também
estiver no treino, o modelo foi otimizado justamente naquele texto: ele acerta
por memorização e a métrica sobe sem que a capacidade real tenha subido. O erro é
**sempre na direção otimista** — por isso ele não aparece como falha, aparece
como resultado bom.

**Nenhum gate da esteira pega isso.** O `sealDataset`, o `source-readiness` e o
`split` operam apenas sobre o corpus e o manifest; o conjunto de treino não é
entrada de nenhum deles. A auditoria de vazamento do `split` é **entre
partições** (dev/cal/test), não contra o treino. É uma checagem que só existe se
alguém a fizer.

**Comparar hash exato não basta.** Os pools humanos re-extraem as mesmas fontes
de onde o treino foi construído (Wikipédia, Carolina, SE-PT). Uma página
revisitada em outra revisão volta com pequenas edições: hash diferente, conteúdo
praticamente idêntico. Medido em 2026-07-24 sobre 36.971 textos de `train`+`dev`,
a sobreposição por hash exato era **zero** enquanto três registros estavam em
jaccard **0,931**, **0,897** e **0,855** — todos acima da barra de recusa de 0,82
usada no resto do pipeline.

**Como é imposto.** `near_dupes.drop_seen()` indexa `train.jsonl` + `dev.jsonl` e
descarta candidatos com jaccard ≥ 0,82 sob o mesmo contrato do
`minhash-lsh-jaccard-v1` (shingles de 5 tokens, confirmação exata).
`assemble_corpus.py` chama essa poda **antes da seleção** e imprime, em toda
execução:

```
vazamento vs train+dev: {'seen_texts': 36971, 'checked': 21506, 'dropped': 3,
                         'highest_similarity_kept': 0.746}
```

Ler `dropped` e `highest_similarity_kept` faz parte de aceitar a montagem. Se
`highest_similarity_kept` chegar perto de 0,82, o pool está encostando no limite
e merece investigação antes de selar.

Descartar não custa cobertura: o pool humano tem ~15 mil candidatos para 4 mil
vagas, então a poda é absorvida pelo excedente e a composição continua exata.

**Se o conjunto de treino mudar** (novo `train.jsonl`, retreino, fine-tune), a
verificação precisa ser refeita — um corpus limpo contra um treino não é limpo
contra outro.

**Lacuna conhecida — a guarda é ancorada numa suposição.** A poda compara o corpus
contra `benchmark/data/dataset/{train,dev}.jsonl`, mas **nada no repositório liga
esses arquivos ao modelo empacotado**: `models/cleanfeed-ptbr-v1/release.json`
registra `bundleDigest`, `tokenizerDigest`, `calibrationSetDigest`,
`profileDigests` e `evidenceDigest` — nenhum campo identifica os dados de treino.
Enquanto isso não existir, "o corpus é independente do treino" só é verificável
sob a premissa de que aqueles dois arquivos **são** o treino do ONNX em
`public/models/cleanfeed-ptbr-v1`. Guardar contra o conjunto errado dá a mesma
falsa tranquilidade que não guardar. O conserto durável é registrar um digest do
conjunto de treino no metadado do modelo, para a checagem passar a ser *amarrada*
em vez de *assumida*.

### 1.2 A alegação de held-out exige versão fixada, nunca alias

`heldOutGeneratorFamilies` afirma que aquele gerador **nunca foi visto no treino**.
Um alias de modelo (`*-latest`, `*-preview` sem versão, "stable") destrói essa
alegação, porque o nome não diz qual modelo respondeu — e nem a API nem o
gerador guardam a resolução:

- o `generate_ai.py` extrai apenas o texto; o campo `modelVersion` que a API
  devolve **não é persistido**;
- os arquivos `_session/*.raw` guardam texto já extraído, não corpo HTTP;
- logs de CLI pertencem a outro canal e não cobrem chamadas REST.

Caso real (2026-07-24): o treino tinha 721 registros de `gemini-flash-lite-latest`
gerados em 22-23/07, e o corpus declarava `gemini-3.5-flash-lite` e
`gemini-3.1-flash-lite` como held-out — lanes geradas ~30h depois, mesma API. Sem
rotação plausível de modelo nesse intervalo, "latest" era provavelmente uma
delas. Como não havia prova em nenhuma direção e **o ônus é de quem alega**, as
duas foram rebaixadas a famílias de IA comuns (`HELD_OUT_INELIGIBLE` em
`assemble_corpus.py`, com o motivo escrito no código).

Regras que evitam a repetição:

1. **Gerar dados de treino sempre com versão fixada.** Um alias no treino
   contamina toda alegação de held-out feita depois, retroativamente e sem
   possibilidade de reparo.
2. **Preferir canal e família distintos** para o held-out. As duas famílias que
   sobreviveram (`gemini-3.5-flash-low`, `gemini-3.6-flash-low`) vêm do
   Antigravity e não têm contraparte alguma no treino — é isso que as torna
   defensáveis.
3. **Menos famílias defensáveis vale mais que mais famílias duvidosas.** Retirar
   as duas liberou massa do bloco de teste e permitiu declarar uma segunda
   família limpa: o corpus terminou com 2 alegações sustentáveis em vez de 3
   frágeis.

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
    "legalBasis": "consent" | "license" | "generated",  // v3 usa "license"/"generated"; "consent" é rota fechada (B3)
    "consentId": "consent_x",             // opcional (token pseudonimizado); ausente na v3
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

Duas rotas aparecem abaixo, e são as duas que a v3 usa: `licensed-corpus` para
base pública e `controlled-generation` para a classe de IA. A terceira rota do
schema v1, `linkedin-contribution` (`acquisition: "consent"`), **não** aparece de
propósito: ela é autorização por documento, que B3 fechou, e nenhum passo deste
runbook a produz. E ela não carrega: `parseReviewedSourceManifest` chama
`assertNoIndividualAcquisition`
([source-manifest.ts](../benchmark/source-manifest.ts)), então um manifesto com
entrada de consentimento falha com `individual-acquisition` antes de virar
`ReviewedSourceManifestV1`. A auditoria recusa a mesma entrada por conta própria
(`LINKEDIN_SOURCE_NOT_AUTHORIZED`), porque recebe objeto já parseado.
Consequência para a §3.5: em um corpus da v3
`acquisitionCounts.consent` é **0**, e um valor diferente de zero é sinal de que
entrou registro por uma rota que não existe mais.

`licensed-corpus` **não** é passe livre, e é onde um passo deste runbook pode
errar sem perceber: a rota exige licença de **base publicada**. Duas licenças do
registro não são — `autoria-propria-v1` (autoria do operador) e
`autorizacao-interna-v1` (autorização interna escrita) —, e ambas entram como
`licensed-corpus` comum, com todas as cláusulas restritivas falsas, então nada nas
cláusulas as distingue de `lei9610-art8`. O que as distingue é o
`publicationRegime` declarado no registro, e o parser chama as duas recusas:
`autoria-propria-v1` falha como `operator-authored-session` (o regime **determina**
a rota) e `autorizacao-interna-v1` como `non-public-base`. Nenhum passo deste
runbook produz qualquer das duas; se você se pegar preenchendo uma, o passo está
errado, não o guarda.

```jsonc
{
  "schemaVersion": 1,
  "sources": [
    {
      "sourceId": "src_ptso",
      "sourceType": "licensed-corpus",          // acquisition = "licensed"
      "acquisition": "licensed",
      "evaluationUseApproved": true,
      "licenseId": "cc-by-sa-4.0",              // licensed/generated → licenseId obrigatório
      "consentReceiptDigest": null,             // não-consentimento → null
      "collectionProtocolVersion": "collection-v1",
      "legalReviewerIds": ["legal_a", "legal_b"]  // EXATAMENTE 2, distintos
    },
    {
      "sourceId": "src_carolina",
      "sourceType": "licensed-corpus",
      "acquisition": "licensed",
      "evaluationUseApproved": true,
      "licenseId": "cc-by-nc-sa-4.0",           // NC admissível: commercialUse é false
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
      "temperature": 0.7,            // EXATAMENTE um de: temperature …
      "temperatureNullReason": null, // … ou temperatureNullReason (lane de CLI
                                     //    não aceita flag de sampling)
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

> **O inventário de fontes** — todas públicas e licenciadas, sem autorização
> individual —, com blocos `licenses[]`/source-manifest no formato exato do
> `ingest`, a política de zero-PII, o campo de data que ancora cada fonte e as
> implicações do projeto aberto não-comercial: ver
> [corpus-sources.md](corpus-sources.md). O que a decisão de usar somente bases
> públicas fecha, e as quatro respostas do projeto:
> [limitations.md](limitations.md).

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
