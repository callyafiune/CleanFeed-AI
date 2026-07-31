# Reconstrução do detector — diagnóstico da medição de 2026-07-25 e plano

Este documento avalia o que a execução selada de 2026-07-25 realmente mediu, lista
os defeitos encontrados ao investigá-la, e propõe como refazer corpus, split,
gates e treino. Tudo o que está afirmado aqui foi calculado a partir dos artefatos
em `benchmark/data/corpus-build/`; onde a conclusão é hipótese, está marcada.

Decisão registrada da execução: **`reject`**, 13 de 61 gates reprovados
(`out/evaluate/gate-report.json`).

---

## 1. O achado principal: a taxa de falso alarme depende do registro

O artefato de calibração congelado (`out/fit/frozen-calibration.json`,
`thresholdEvidence.warning`) registra, no momento do ajuste, **77 falsos positivos
em 2000 negativos humanos** — FPR 3,85%, limite superior 4,62% contra um orçamento
de 5%. O relatório de teste registra, com o **mesmo limiar congelado**, **zero
falsos positivos em 2000 negativos humanos** — limite superior 0,135%.

A diferença não é do modelo. É de **quais registros humanos cada bloco contém**.
Reconstruindo os 77 falsos positivos por registro (calibrador beta reaplicado aos
escores brutos de `out/predictions/`, total confere exatamente com o artefato):

| registro humano | fonte | n | FP de aviso | FPR | FP de ação visual |
|---|---|---:|---:|---:|---:|
| social-media | B2W (avaliações de produto) | 800 | 57 | **7,12%** | 26 (3,25%) |
| university | Carolina (domínios universitários) | 745 | 20 | **2,68%** | 0 |
| qa-informal | pt.stackoverflow | 399 | 0 | 0,00% | 0 |
| encyclopedic | Wikipédia pt | 800 | 0 | 0,00% | 0 |
| institutional | Carolina (judiciário) | 800 | 0 | 0,00% | 0 |

As duas primeiras linhas foram medidas na calibração. As três últimas, no teste.

**E os dois registros em que o modelo erra estão inteiramente ausentes do bloco de
teste.** Distribuição verificada em `out/split/split-artifact.json`:

| registro | development | calibration | test |
|---|---:|---:|---:|
| qa-informal | 400 | 0 | 400 |
| social-media | 400 | 400 | **0** |
| university | 0 | 800 | **0** |
| encyclopedic | 0 | 0 | 800 |
| institutional | 0 | 0 | 800 |

O gate `warning.fpr.overall` e todos os gates de fatia por `domain` /
`humanSourceType` são avaliados **somente no bloco de teste**. Como
`social-media` e `university` não existem nesse bloco, nenhum gate jamais viu os
7,12% e os 2,68%. Os gates estão corretos; o split entregou a eles um conjunto de
teste que excluía os dois registros mais difíceis.

Consequência prática: o número de divulgação defensável não é "0,14% de falso
alarme". É **"entre 0% e 7,1%, dependendo do gênero de texto"** — e 7,1% é
justamente o gênero de texto informal curto que uma extensão de navegador
encontra num feed.

---

## 2. O que o corpus faz o modelo aprender

`domain` está perfeitamente confundido com o rótulo: todos os 4000 registros
humanos têm um registro real (`encyclopedic`, `institutional`, `university`,
`qa-informal`, `social-media`, 800 cada) e **todos os 6000 registros de IA e
mistos têm `domain: "geral"`** e `humanSourceType: null`. Nenhum texto de IA foi
gerado no registro de nenhuma fonte humana.

A separação de escores mostra o efeito (dev+cal, 3941 documentos pontuados):

| classe | p10 | mediana | p90 | > 0,999 |
|---|---:|---:|---:|---:|
| human | 0,0001 | 0,0015 | 0,2745 | — |
| ai | 0,9988 | 0,9999 | 1,0000 | **88,8%** |
| mixed | 0,0001 | 0,0001 | 0,0011 | — |

Só **2,8%** dos documentos de IA caem na faixa intermediária 0,01–0,99. Um
detector de autoria genuíno não satura assim. E documentos mistos pontuam **mais
baixo que documentos humanos** (mediana 0,0001 contra 0,0015), inclusive na faixa
`aiFraction` 0,50–0,74 (mediana 0,0002) — o texto misto é construído sobre um pai
humano, mantém o registro humano, e o modelo o classifica como humano com alta
confiança. Isso explica o recall de 11,6% em texto misto por um único mecanismo.

Duas ressalvas honestas contra a leitura simples de "atalho":

- Uma regressão logística sobre TF-IDF treinada em `development` e avaliada em
  `calibration` atinge **AUC 0,474** — nível de azar. Ou seja, o corpus **não** é
  trivialmente separável entre partições; o transformer está fazendo algo que um
  modelo linear não faz.
- O recall por família geradora no teste **não** acompanha a exposição no treino:
  `gpt-5_6-luna` (1628 linhas no treino) tem 87,6%, enquanto
  `gemini-3_5-flash-low` (declarada retida, 320 registros) tem **99,4%**. Não é
  memorização de família.

O que fica: o modelo aprendeu um sinal real de autoria **mais** uma dependência
forte de registro. O registro do texto humano decide a taxa de falso alarme, e
os registros do bloco de teste eram os favoráveis.

Um controle informativo: TF-IDF restrito a **palavras funcionais e pontuação**
(149 features, tópico removido) generaliza *melhor* através da mudança de registro
(**AUC 0,772**) do que o TF-IDF lexical completo com 50 mil features (0,474). O
sinal que transfere é distribucional-estilístico, não lexical.

---

## 3. Defeitos encontrados na investigação

Cinco são meus, introduzidos no montador ou no avaliador.

### 3.1 Falha de inferência é contada como "humano confiante"

[`benchmark/commands/evaluate.ts:157`](../benchmark/commands/evaluate.ts#L157)

```ts
const applied = applyFrozenCalibration(frozen, {
  documentRawScore: prediction.documentRawScore ?? 0,
```

Uma linha com `status: "error"` tem `documentRawScore: null`. O `?? 0` a converte
no escore **mais humano possível**. Em
[`metrics.ts:550-551`](../benchmark/metrics.ts#L550-L551) os negativos são
`items.filter(isHumanNegative)` — sem filtro de status. Logo cada um dos 325
documentos que falharam entrou na matriz de decisão como **verdadeiro negativo**.

O viés é assimétrico e foi todo favorável: os 325 são **todos humanos**, nenhum
positivo falhou. Restringindo aos registros de fato pontuados: 0 falsos positivos em
1675, limite superior 0,161% em vez de 0,135%.

Mas **excluir os erros do denominador também não é a correção certa** — isso faria um
sistema frágil parecer melhor do que é, porque um documento que o detector não
consegue pontuar é uma falha do produto, não um caso fora de escopo. A correção é
publicar **as duas métricas juntas**: fim-a-fim sobre todos os registros elegíveis
(erro conta como não-detecção) e condicional a `status = scored`, mais cobertura e
taxa de erro por fonte, classe, comprimento e plataforma. O estado `error` precisa ser
um ramo explícito, nunca um escore calibrado.

### 3.2 A janela de inferência não tem folga, e 40% dos documentos longos de uma fonte falham

`contentTokens` é validado como `modelMaxTokens - specialTokenCount`
([`model-runtime.ts:130`](../src/inference/model-runtime.ts#L130)) = 512 − 2 =
**510**. Cada janela cheia ocupa exatamente a capacidade do modelo; a folga é zero.

A taxa de falha cresce monotonicamente com o comprimento e se concentra numa fonte:

| tokens | documentos | erros | taxa |
|---|---:|---:|---:|
| < 400 | 4072 | 0 | 0,0% |
| 400–600 | 118 | 1 | 0,8% |
| 600–800 | 64 | 14 | 21,9% |
| 800–1200 | 198 | 46 | 23,2% |
| 1200–1600 | 187 | 74 | 39,6% |
| 1600–2000 | 97 | 38 | 39,2% |
| 2000–3000 | 175 | 100 | 57,1% |
| > 3000 | 89 | 52 | 58,4% |

| fonte | documentos humanos no teste | erros | taxa |
|---|---:|---:|---:|
| carolina | 800 | **322** | 40,2% |
| wikipedia_pt | 800 | 2 | 0,2% |
| ptso | 400 | 1 | 0,2% |

Testei a hipótese óbvia — que re-tokenizar o recorte de caracteres estoura 512 — e
ela está **refutada**: reproduzindo o caminho exato com o `tokenizer.json` do
bundle, a pior janela dá exatamente 512, e o guard só reprova acima de 512.

A causa exata não é determinável a partir dos artefatos, e isso é o segundo
defeito: [`onnx-classifier.ts:252`](../src/inference/onnx-classifier.ts#L252)
descarta a mensagem do erro subjacente (`"ONNX inference failed."`), e
`ModelBenchmarkScoreV1` só carrega `reasonCode`, sem campo de mensagem. Três
origens distintas colapsam no mesmo `INFERENCE_FAILED`. **Antes de qualquer
correção, é preciso propagar a mensagem real.**

Defeito relacionado, independente da falha: `buildWindows` gera **todas** as
janelas e o laço infere **cada uma**; só depois `aggregateWindowsV2` seleciona 8
([`main.ts:255-271`](../src/model-benchmark/main.ts#L255-L271),
[`aggregator.ts:42`](../src/inference/aggregator.ts#L42)). Um documento de 5000
tokens paga ~20 inferências para usar 8. O custo é linear no comprimento sem
necessidade, e `MAX_AGGREGATION_WINDOWS` é constante fixa em `aggregator.ts:17` em
vez de ler `manifest.windowing.maxWindows`.

### 3.3 A medição de gerador não visto é silenciosamente vazia

[`slices.ts:129-134`](../benchmark/slices.ts#L129-L134) compara
`record.generation.family` com `heldOutGeneratorFamilies`. Mas os dois lados usam
grafias diferentes do mesmo nome:

- `generation.family` = `gemini-3.5-flash-low` (pontos)
- `groups.generatorFamily` = `gemini-3_5-flash-low` (sublinhados)
- `manifest.heldOutGeneratorFamilies` = `["gemini-3_5-flash-low", "gemini-3_6-flash-low"]`

`heldOut.has()` nunca casa. Resultado: a fatia `generatorExposure` do relatório tem
**apenas `seen` com n=3000** e nenhum `unseen`. Os 769 registros semeados no teste
exatamente para medir generalização a geradores não vistos foram reportados como
vistos. A validação do manifesto conta por `groups.generatorFamily` (sublinhados),
casa, e passa — os dois lados discordam sobre qual campo é autoritativo, e nenhum
gate depende dessa fatia, então nada reclamou.

**E o mesmo erro de grafia quebra um segundo mecanismo, que eu não havia notado.**
[`split.ts:359-360`](../benchmark/split.ts#L359-L360) também compara
`record.generation?.family` (com pontos) contra a lista do manifesto (com
sublinhados):

```ts
const family = record.generation?.family;
if (family !== undefined && heldOutFamilies.has(family)) {
  component.heldOut = true;
```

`component.heldOut` portanto **nunca fica verdadeiro**, e a restrição "família retida
vai obrigatoriamente para o teste" (`split.ts:249` e `:380`) nunca foi exercida. Os
769 registros estão no teste apenas porque o montador os pré-posicionou pelo
`createdAt` sintético (3.4). O invariante valeu por acidente da minha atribuição
manual, não por imposição do split.

O dado bruto existe e é bom: `gemini-3_5-flash-low` tem **99,4%** de detecção
(320 registros). Só nunca foi apresentado como o que é — e não foi garantido como o
que devia ser.

### 3.4 O split não é temporal

`createdAt` assume **três valores sintéticos** — 1000000, 2000000, 3000000 — que
`stamp_block()` em [`assemble_corpus.py:313`](../benchmark/lab/assemble_corpus.py#L313)
grava também em `provenance.collectedAt`, `generation.generatedAt` e `piiAudit`.
O docstring do montador declara isso abertamente ("createdAt assigns a dev/cal/test
BLOCK"), mas as consequências não foram pensadas:

- O "blocked temporal split" não separa nada no tempo; a atribuição de partição é
  manual, minha, feita através de um campo que finge ser data.
- A fatia `temporalCohort` colapsa para um único `cohort-0` no teste (span = 0),
  logo não mede nada.
- Fui eu quem escolheu qual registro vai para qual partição — e escolhi de forma
  que calibração e teste não compartilham **nenhum** registro humano além de
  `qa-informal`. É a causa raiz do item 1.

### 3.5 A classe mista pede o impossível, e por isso 82% dela é inerte

Os trechos de IA dentro dos documentos mistos têm mediana de **16 caracteres**
(p90 = 55). Mesmo restringindo a `aiFraction >= 0.5`, a mediana é 21 caracteres e
o **maior trecho contíguo** de IA por documento tem mediana de 87 caracteres, em
documentos de mediana 63 palavras. São ~7 fragmentos de duas ou três palavras
salpicados num texto humano.

Isso não é o modelo de ameaça real (humano escreve a introdução e a IA redige o
corpo; a IA rascunha e o humano edita) e é quase indetectável por construção, em
qualquer granularidade que o pipeline possui. Os 11,6% de recall não medem
fraqueza do modelo; medem uma tarefa mal formulada.

Além disso, `isWarningPositive` exige `aiFraction >= 0.5` e `isHumanNegative` exige
`label === "human"`. Os **1761 registros mistos com `aiFraction < 0.5`** (88% da
classe, 17,6% do corpus) não são positivos nem negativos: não entram em FPR,
recall, ECE, AUC nem em nenhum gate. São massa inerte.

**Correção de uma afirmação anterior deste documento.** Eu havia escrito que
`mixture.spans` já fornece a anotação necessária para treino em nível de token.
**Está errado.** [`make_mixed.py`](../benchmark/lab/make_mixed.py) deriva os spans de
um `difflib.SequenceMatcher` entre o texto pai e o texto editado: bloco igual →
origem `human`, inserção/substituição → origem `ai`. Isso mede **diferença textual,
não proveniência causal**. E o prompt de edição exige explicitamente que "a maior
parte do texto fique idêntica ao original" (`make_mixed.py:46`), o que *garante* que
a maior parte de um documento processado inteiro pela IA seja rotulada como humana.
Treinar uma cabeça de token sobre esses spans ensinaria justamente o contrário do
que se quer.

Para ter proveniência em nível de span é preciso **gerar** com proveniência
observável — inserções ou concatenações controladas, ou um pipeline que registre cada
operação de edição. Texto livremente reescrito só admite rótulo de documento
("assistido por IA"), nunca rótulo por trecho.

### 3.6 Seis dos oito eixos de agrupamento são sintéticos, e dois não existem

Este é o defeito mais grave da lista e eu não o havia visto. `base_groups()` no
montador cria identificadores únicos por registro. Medindo no corpus selado:

| eixo de `GROUP_KEYS` | valores distintos | maior grupo |
|---|---:|---:|
| `author` | **10 000** | 1 |
| `source` | **10 000** | 1 |
| `domainSource` | **10 000** | 1 |
| `nearDuplicate` | **10 000** | 1 |
| `derivationRoot` | **10 000** | 1 |
| `collectionBatch` | 4 067 | 476 |
| `generatorVersion` | **0 — nunca preenchido** | — |
| `promptTemplate` | **0 — nunca preenchido** | — |

Consequências, em ordem de gravidade:

1. **A auditoria de leakage é tautológica.** `leakages: []` não demonstra
   independência entre autores, páginas ou linhagens: verifica identificadores
   construídos para nunca colidir. **A afirmação "a disjunção por grupo já
   funciona", que este documento fazia na seção 5, é infundada e foi removida.**
2. **O bootstrap "agrupado por autor" de [`metrics.ts`](../benchmark/metrics.ts)
   degenera em bootstrap i.i.d.**, porque `groups.author` tem 10 000 singletons.
   Todo intervalo de confiança do relatório que depende dele trata registros
   correlacionados como observações independentes. Quanto isso estreita os
   intervalos é **impossível de medir com os artefatos atuais** — a identidade real
   do cluster nunca foi persistida. Foi descartada na montagem, por mim.
3. O split por componentes conexos comporta-se como split por linha, exceto em
   `collectionBatch`. O risco prático de leakage é menor do que parece, porque as
   quase-duplicatas foram podadas em Python antes da seleção — mas essa é uma
   garantia diferente, e mais fraca, do que a que o artefato anuncia.

### 3.7 A governança de revisão é metadado constante

`annotation` tem **exatamente uma forma** nos 10 000 registros:
`{agreement: "agree", protocolVersion: "annotation-v1", reviewerIds: ["reviewer_a", "reviewer_b"]}`.
E `provenance.piiAudit` tem três formas que diferem apenas no timestamp de bloco
sintético — todas com `status: "passed"`, `reviewerId: "reviewer_pii"`,
`method: "manual-and-automated"`.

Ou seja: 10 000 registros afirmam concordância entre dois revisores e uma auditoria
de PII "manual e automatizada" que nunca aconteceram, e os gates
`integrity.review-ledger-hash` e `integrity.dataset-audit-sealed` passam sobre isso.
Registro não revisado precisa ser marcado `automated/unreviewed`; simular revisão
humana é pior do que declarar ausência dela.

### 3.8 O corpus não tem o domínio do produto

`platform` = `generic` nos 10 000 registros. `topic` = `geral` nos 10 000. O produto
é uma extensão para feed profissional, e os 800 humanos rotulados `social-media` são
avaliações de produto do B2W, não publicações profissionais.

O corpus se chama `ptbr-generic-v1` e é honesto quanto a isso, mas a consequência
não estava dita: **uma calibração feita sobre ele não estima o falso alarme em
publicação profissional contemporânea.**

> **Resolvido como limitação de projeto em 2026-07-26.** A saída ideal seria um benchmark
> *in-domain* governando a calibração, com a suíte pública (Wikipédia, Stack Exchange,
> Carolina, avaliações) medindo apenas generalização. **Isso não vai acontecer:** o projeto
> não tem condições de adquirir textos com autorização individual e passa a depender só de
> bases públicas, e não existe base pública licenciada de publicação profissional pt-BR.
>
> O rótulo humano permanece defensável — o corte `< 2022-11-30` (pré-ChatGPT) já é padrão
> nos extratores e garante a autoria por construção, sem depender de declaração de
> ninguém. O que se perde é **contemporaneidade e domínio**, e portanto a possibilidade de
> medir o FPR onde o produto opera. A resposta do plano é limiar contra o **pior registro
> calibrado** em vez da média, **teto de ação rebaixado** em plataforma não calibrada, e
> comunicação como detector pt-BR **genérico**. Ver "Limitações declaradas do projeto" (L1)
> em [`2026-07-26-detector-v3-rebuild-implementation.md`](superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md).

---

## 4. Reavaliação dos gates

A política em [`benchmark/gates.ts`](../benchmark/gates.ts) está, no essencial,
bem construída: limites unilaterais de Wilson 95%, decisão em três ramos, fatia
subdimensionada nunca autoriza ação visual mas também não bloqueia o aviso, e o
digest do avaliador prende 42 arquivos. Os problemas são de cobertura, não de
rigor.

### 4.1 Um gate é insatisfazível por construção

`action.fpr.slice.lengthBucket.0_49` exige 300 negativos humanos com menos de 50
palavras. Mas a admissão do corpus exige `>= 50` palavras para humano e IA (os
únicos 109 registros abaixo de 50 são mistos, encurtados pela mistura), e
`DEFAULT_MINIMUM_ELIGIBLE_WORDS = 50` faz o produto **abster-se** abaixo de 50
palavras. Cobrar FPR numa faixa onde o sistema nunca age, e que a admissão proíbe
de povoar, é incoerente: o nível de ação nunca pode chegar a `pass`.

Correção: restringir as fatias críticas às faixas em que o produto age, ou tornar
`0_49` explicitamente fora de escopo com a razão registrada.

### 4.2 Faltam três gates que teriam pegado o que passou

1. **FPR por registro no teste, com todos os registros presentes.** O gate existe
   (`warning.fpr.slice.humanSourceType.*`), mas só avalia o que está no teste. É
   preciso um invariante de composição do split: *todo registro humano precisa
   estar presente nas três partições*, verificado antes do fit.
2. **Gate de gerador não visto.** `generatorExposure` não gera gate nenhum. Depois
   de corrigir 3.3, deve haver um mínimo de recall sobre `unseen` — é a única
   medida de generalização que o corpus se propõe a dar.
3. **Consistência entre calibração e teste.** O fit mediu FPR 3,85% e o teste
   0,00% com o mesmo limiar. Uma divergência dessa ordem entre o conjunto que
   escolheu o limiar e o que o avalia deveria ser, por si, um gate de integridade.

### 4.3 O gate de taxa de erro funcionou e deve ficar como está

`integrity.error-rate < 0,01` foi o gate que impediu a publicação de uma medição
com 6,57% dos registros não pontuados e não faltantes ao acaso. Foi exatamente
para isso que existe. Manter estrito.

### 4.4 ECE é sintoma, e um gate pontual sobre um estimador enviesado

ECE-15 = 8,18% contra o limite de 5%. Com 88,8% dos documentos de IA acima de 0,999,
nenhum calibrador monótono conserta o que resta: quando o modelo erra, erra com
confiança extrema. A origem dessa saturação **não está estabelecida** — ver §6, item
3, para as causas candidatas — então "a correção é no treino" é a direção provável,
não um diagnóstico.

Duas fragilidades do gate em si, independentes disso:

- **É estimativa pontual.** Deveria usar limite superior ou intervalo, como todos os
  demais gates numéricos fazem. O relatório já calcula o bootstrap
  (0,0731–0,0908); o gate só não o usa.
- **ECE com 15 bins de largura fixa é sensível à escolha dos bins e esconde erro
  condicional.** Vale publicar junto Brier, log-loss, intercept e slope de calibração,
  diagrama de confiabilidade, um estimador equal-mass ou com correção de viés, e a
  calibração por comprimento, fonte e registro — especialmente dado 4.9.

### 4.5 O gate de texto misto pede mais do que a literatura entrega

`warning.mixed-recall >= 0.5` é, hoje, o gate mais exigente do conjunto — e está
acima do estado da arte. O vencedor do PAN 2025 na tarefa de autoria mista em 6
classes obteve **64,46% de recall macro com um Qwen3-4B** (§6.1), e um classificador
binário de documento como o nosso tem **AUROC 0,502 publicado** no nível de texto
humanizado. Um limite de 50% para um encoder de 110M em WASM não é ambicioso, é
inatingível pela formulação atual.

Duas correções, e a ordem importa:

1. **Trocar a formulação** (cabeça em nível de sentença/token, §6.1) — sem isso,
   nenhum limiar é honesto.
2. **Reancorar o limite em evidência**, medido na nossa própria curva de cobertura de
   IA (v0–v8, §6.1), e não escolhido a priori. Um gate que nunca pode passar não
   protege nada; ele só garante `reject` permanente.

Este é o único gate que eu recomendo **mudar de valor**, e só depois de a formulação
mudar. Os demais não precisam afrouxar.

### 4.6 Trocar a métrica primária

A métrica primária de release é o **recall no limiar congelado**, com o FPR no mesmo
limiar, e **Brier ao lado do ECE**. Hoje o relatório traz ROC-AUC 0,9647 e PR-AUC 0,9788,
que são exatamente as métricas que Tufts et al. mostram descolarem do comportamento em
FPR baixo — mas a correção não é trocá-las por TPR@1%FPR como número principal.

> **Correção (segunda rodada de revisão).** Uma versão anterior desta seção elegia
> **TPR@1%FPR** como métrica primária. Está errado: esse número escolhe um ponto na ROC
> do **próprio teste**, enquanto o sistema implantado opera num limiar fixo, escolhido
> antes de ver o teste. TPR@1%FPR e AUROC medem **separabilidade** e são diagnósticos
> úteis; desempenho de release se mede no limiar que vai rodar. Publicar os dois, com os
> papéis nomeados.

Faltam também, e valem como diagnóstico: TPR@1%FPR, log-loss, intercept e slope de
calibração, e a verificação de que a distribuição de escores **consegue** operar no FPR
alvo — o RAID encontrou detectores cujo piso de FPR é maior que 1%, e com 88,8% da classe
de IA acima de 0,999 a granularidade perto do corte é pequena.

### 4.7 Dimensionamento que os gates exigem

Cada fatia crítica de FPR precisa de **300 negativos humanos**; cada fatia de
recall, de 200 positivos. Marginalmente, por eixo:

| eixo | fatias | negativos humanos exigidos |
|---|---:|---:|
| hardNegativeFamily | 6 | 1800 |
| domain | 5–6 | 1500–1800 |
| humanSourceType | 5 | 1500 |
| lengthBucket (sem `0_49`) | 5 | 1500 |
| temporalCohort | 1–4 | 300–1200 |

Como cada negativo conta em uma fatia de cada eixo, o piso é o eixo mais exigente,
com a restrição de que os 1800 negativos rotulados como hard negative sejam
espalhados pelas faixas de comprimento e pelos registros. Hoje há **20 por família
hard-negative** — déficit de 15×, porque `assemble_corpus.py:670` calcula
`tag_per = 4000 // 200 = 20`.

Bloco de teste mínimo ≈ **1800 humanos + 1200 de IA + 300 mistos ≥ 0,5 ≈ 3300
registros úteis**. Com o teste em 15–20% do corpus (§5), o total fica em
**16 500–22 000 registros** — e não nos ~11 000 que uma versão anterior desta seção
citava, que vinha de uma fração de teste de 30% incompatível com o split proposto.

**E esse número é um piso otimista**, por duas razões que a revisão crítica aponta
com razão: (a) o cálculo é em linhas, quando o poder estatístico real depende de
**clusters independentes** — e hoje não sabemos quantos existem, porque a identidade
de cluster nunca foi persistida (3.6); (b) satisfazer marginalmente cada eixo não
garante satisfazer as fatias conjuntas pré-especificadas. O dimensionamento honesto
só é possível depois de 3.6 estar corrigido, e deve ser feito por pior-fonte e por
contagem de clusters, não por total de linhas.

### 4.8 O limite de 95% publicado não vale para o limiar escolhido

`selectWarningThresholds` em
[`calibration-pipeline.ts:451`](../benchmark/calibration-pipeline.ts#L451) é, pela
própria documentação, uma **busca exata O(n²)**: varre todos os valores distintos de
escore como limiar candidato de documento × todos como limiar de localização, e
escolhe o par de maior recall cujo limite superior de FPR cabe no orçamento de 5%.
Com ~4000 registros em dev+cal isso são milhões de hipóteses avaliadas nos **mesmos
2000 negativos**.

O `fprUpper95` reportado é o limite de Wilson nominal do par vencedor, calculado nos
dados que o escolheram. Não é um limite pós-seleção, e portanto **subestima a
incerteza real do limiar publicado**. A assinatura empírica está no artefato: o par
vencedor ficou em **4,62% contra um orçamento de 5,00%** — encostado na restrição, que
é o que se espera de uma maximização levada até a fronteira.

> **Nota de campo (A7, 2026-07-27).** O nome `fprUpper95` acima é o do artefato de
> 2026-07-25. Hoje o campo emitido chama-se `selectionFprUpper95Nominal`, ao lado de um
> `certifiedFprUpper` explicitamente nulo e de um bloco `fprBound` que registra
> estimador, dado de medição, ausência de correção pós-seleção e de onde virá a
> certificação. A **matemática é a mesma**: A7 mudou rótulo e procedência, não
> estimador. Artefatos gravados antes disso continuam legíveis sob o nome antigo — ele
> só nunca é reemitido.

**Correção — e uma versão anterior desta seção errava aqui.** Eu havia escrito que
bastava separar `cal-A` (calibrador) de `cal-B` (limiar). **Não basta:** se o limiar é
escolhido em `cal-B`, um limite de Wilson calculado em `cal-B` continua sendo
pós-seleção para aquela escolha. Separar os blocos evita apenas que a escolha do
calibrador contamine a escolha do limiar; não valida o limite.

Para que o número publicado signifique 95%, uma destas três coisas precisa ser
verdade:

1. **A certificação acontece no teste independente e cego** — a busca escolhe o limiar
   em `cal-B`, e o limite reportado como garantia é o medido no teste, uma única vez.
   É a saída mais simples e a que o pipeline já suporta.
2. **Controle simultâneo explícito** sobre a grade de candidatos (correção de
   multiplicidade sobre os pares efetivamente avaliados), aceitando o limiar mais
   conservador que dela resulta.
3. **Controle formal de risco** no estilo de *Conformal Risk Control* (Bates et al.),
   que dá garantia sobre o parâmetro selecionado por construção, em vez de corrigir
   um limite calculado depois.

Em qualquer dos casos o agrupamento tem de usar clusters reais (3.6), sem o que
nenhuma das três garantias vale. E se o volume não permitir dois blocos de
calibração, cross-fitting agrupado aninhando as duas seleções substitui a divisão —
mas a certificação continua tendo de vir de (1), (2) ou (3).

**Uma ressalva de precisão sobre o mecanismo.** A revisão crítica atribui este
problema a um reúso de `dev`: que o `dev` usado por `train_detector.py` para escolher o
checkpoint de maior AUC seria o mesmo `development` que o `fit` consome. **Não é.**
`train_detector.py` recebe `--dev benchmark/data/dataset/dev.jsonl` (4118 linhas, o
artefato de treino separado), enquanto `fit.ts` lê a partição `development` do corpus
selado (2000 registros). A seleção de checkpoint, portanto, não contamina a calibração,
e o problema de seleção adaptativa acima existe por outro caminho — a busca de limiares.

O que se pode afirmar sobre a relação entre os dois conjuntos é mais fraco do que a
palavra que se costuma usar, e vale registrar com precisão: `drop_seen()` prova
**ausência de sobreposição por hash exato e ausência de quase-duplicata sob o contrato
Jaccard ≥ 0,82**. Isso não é independência semântica. Um documento do teste pode tratar do mesmo
assunto, citar a mesma fonte ou parafrasear um documento de treino e passar folgado
pelo limiar de 0,82. O que se tem é o que o contrato mede, e só isso — chamar esse resultado de independência, mesmo qualificando, já concede a palavra que a regra proíbe.

### 4.9 Os três perfis por comprimento não são calibrados por comprimento

[`profile-artifact.ts:483-487`](../benchmark/profile-artifact.ts#L483-L487) copia
`frozen.calibrators.document` e `frozen.calibrators.localized` — os calibradores
**globais** — para os três perfis `50-79`, `80-199` e `200-plus`, e deriva os limiares
dos mesmos `frozen.thresholds`. O que varia por faixa é apenas o `actionCeiling`.

Isso não é calibração condicional; é uma calibração global republicada três vezes com
tetos de ação diferentes. Se o escore variar com o comprimento — e há motivo para
crer que varia, já que os humanos longos e curtos vêm de fontes distintas — cada
perfil pode estar sistematicamente mal calibrado mesmo com o ECE global aceitável.

Três saídas possíveis: ajustar e validar um calibrador por faixa; usar um calibrador
condicional regularizado; ou declarar explicitamente que o escore é global e publicar
a calibração por faixa apenas como diagnóstico. O que não se pode manter é a
aparência de que as três faixas foram calibradas separadamente. Nota: isto conversa
diretamente com os quantis por faixa de comprimento do MCP (§6.5), que são
load-bearing lá — remover as faixas custa −22% de TPR.

---

## 5. Como refazer o split

O desenho atual tem três partições e **nenhuma de treino** — o detector foi
treinado num artefato separado e não governado
(`benchmark/data/dataset/train.jsonl`, 32 853 linhas), e o que existe entre os dois
é uma poda *a posteriori* (`near_dupes.drop_seen()`) contra um arquivo que nada
amarra ao ONNX empacotado. O runbook já registra essa lacuna.

⚠️ **Redação corrigida em 2026-07-31 (Fase 1).** Esta frase dizia que "a
**independência** entre os dois é garantida" pela poda. Era over-claim (R7) em duas
camadas: a poda garante um **contrato** — ausência de duplicata exata de conteúdo
tokenizado e de quase-duplicata sob Jaccard ≥ 0,82 —, não independência semântica,
porque paráfrase e mesmo assunto passam folgado; e mesmo esse contrato só vale contra
o arquivo comparado, que é justamente o que o resto do parágrafo aponta. A distinção
passou a ser imposta por `trainingIndependenceOverclaimIn`, que varre este arquivo.

Proposta: **um pool governado, um split, cinco partições.** Cinco, e não quatro,
porque a escolha do calibrador e a escolha do limiar são duas seleções distintas e
não devem ocorrer nos mesmos dados (ver 4.8).

```
train  (50–55%)  -> treina o detector, dentro da mesma governança
dev    (≈10%)    -> arquitetura, hiperparâmetro, época, política de janelas
cal-A  (≈10%)    -> escolhe e ajusta o calibrador
cal-B  (≈10%)    -> escolhe o limiar, com política pré-registrada
test   (15–20%)  -> cego, uso único, com poder de fatia suficiente
```

Regras que o split precisa garantir, e hoje não garante:

1. **Persistir grupos reais.** Hoje seis dos oito `GROUP_KEYS` são identificadores
   sintéticos únicos por registro e dois não existem — ver 3.6. A disjunção por
   grupo precisa ser construída sobre autor/página/seed/prompt/versão/batch/raiz de
   derivação/cluster de quase-duplicata **reais e pseudonimizados**, e a auditoria
   precisa publicar a contagem e a distribuição de clusters, não só `leakages: []`.
   Toda a árvore seed → geração → derivados fica na mesma partição.
2. **Estratos *core* presentes em todas as partições.** É o invariante ausente que
   produziu o item 1: estratificar por `humanSourceType` × faixa de comprimento
   **dentro** da atribuição por grupo, de modo que nenhum registro humano exista em
   apenas uma partição.
3. **Coortes *OOD* exclusivas do teste**, e explicitamente separadas dos estratos
   core: geradores não vistos, prompts e estratégias de decoding não vistos, fontes
   humanas não vistas, e — quando a data for real — período temporal não visto. O
   risco é concreto: a sonda linear pontuou texto acadêmico não visto com média
   0,80 de IA num modelo que não o conhecia.
4. **Um identificador canônico de família geradora**, validado pelo schema, com
   invariante de igualdade exata entre manifesto, split, auditoria e relatório.
   Hoje o mesmo erro de grafia quebra a fatia **e** a restrição do split (3.3).
5. **Abandonar o eixo temporal enquanto `createdAt` for sintético.** Ou passa a
   registrar a data real do texto (a Wikipédia e o Stack Exchange têm; o Carolina
   tem parcialmente), e então o split temporal mede algo, ou o eixo sai e a
   estratificação passa a ser explícita. Manter as duas coisas — data falsa e
   fatia temporal — só produz garantia decorativa.

O dimensionamento tem de ser calculado em **clusters independentes**, não em linhas
(4.7), e a concessão desta tupla está `completed`
(`private/holdout-ledger.jsonl`), logo qualquer medição nova exige corpus novo — o
que este plano já implica.

---

## 6. Metodologia de treino

Estado atual, de [`benchmark/lab/train_detector.py`](../benchmark/lab/train_detector.py):
BERTimbau base (`neuralmind/bert-base-portuguese-cased`, 110M), truncamento em 512,
3 épocas, lote 16, lr 2e-5, AdamW, warmup 6%, pesos de classe por frequência
inversa, seed 42. **Sem suavizamento de rótulo, sem early stopping, sem
acumulação, sem clipping.**

Quatro problemas concretos, independentes do estado da arte:

1. **Treino e inferência discordam.** O treino vê **um** truncamento de 512 tokens
   por documento; a inferência vê janelas de 510 e faz média ponderada de até 8.
   Documentos longos são treinados apenas no seu primeiro trecho. A paridade do
   export INT8 também foi medida em passagem única de 512
   (`export_onnx.py:125-167`), nunca no pipeline com janelas.

   **Correção de uma recomendação anterior deste documento.** Eu havia escrito
   "treinar por janela, com o rótulo do documento herdado". Herdar o rótulo do
   documento para cada janela é ruim: marca citação e boilerplate como se tivessem a
   origem do documento, é claramente errado em documento misto, dá peso maior a
   documento longo (mais janelas = mais exemplos) e **continua divergindo do
   runtime**, que agrega no máximo oito janelas selecionadas, não todas. O correto é
   aprendizado **multi-instância**: amostrar as janelas com a mesma política do
   runtime, agregar os escores com a mesma regra, calcular a perda **no nível do
   documento**, manter peso total semelhante por documento, e usar perda auxiliar de
   span apenas onde houver proveniência real (3.5).
2. **79,7% dos exemplos de IA no treino são reimportação de um único corpus
   público** (Madras, 9626 de 12 071 linhas); só 2445 são gerações próprias
   pareadas por tópico. A diversidade de geradores no treino é muito menor do que
   a contagem de famílias sugere.
3. **A saturação em 0,999 não tem causa demonstrada.** Uma versão anterior desta
   seção afirmava que a ausência de suavizamento de rótulo era a causa e que
   suavizamento/mixup "atacam a causa". Isso vai além da evidência. Candidatas
   igualmente plausíveis, e várias delas apontadas por este próprio documento:
   atalho de domínio/fonte/época, separabilidade artificial do corpus, cross-entropy
   pura, composição dos prompts, quantização INT8, e a diferença de população entre
   fit e avaliação (§1). Suavizamento, mixup, focal loss e Brier loss são **ablações
   a comparar**, não correções conhecidas — e nenhuma delas corrige confounding.
   Medida barata e independente: **preservar os logits no artefato de calibração**,
   para permitir temperature scaling antes de comprimir a saída em probabilidades já
   saturadas.
4. **Deduplicação do treino é só por hash exato** (`build_dataset.py:60-67`,
   `droppedExactDupes: 0`), sem recusa de quase-duplicata — deliberadamente. Como
   as fontes humanas são reextrações das mesmas páginas, o treino pode conter
   clusters quase idênticos que inflam épocas efetivas sobre alguns textos.
5. **Classe e época não se sobrepõem — mas o vazamento foi testado e não encontrado.**
   Os humanos vêm de fontes históricas (Wikipédia 2011–2022, Stack Exchange 2013–2016,
   B2W 2018, Carolina 2020–2021) e as gerações de IA são de 2026. O modelo **nunca vê
   data** (`train_detector.py` alimenta só `{"text", "label"}`), então o único canal é
   indireto: correlatos textuais de época. Medindo esse canal na maior extensão
   disponível — Wikipédia, 798 humanos pontuados, 2017–2022 — a correlação entre a data
   real e o escore de IA é **+0,015, IC95 [−0,054, +0,085]**, e as médias por ano são
   planas; no ptso (2013–2016) dá −0,047. Além disso os prompts de IA foram derivados de
   pais humanos, então o assunto é herdado do corpus pré-2022 e o canal mais óbvio está
   controlado por construção. O teste detecta **gradiente, não degrau**: resolver o
   resíduo exige texto humano contemporâneo. Até lá, risco a monitorar com coorte
   temporal real — não confundimento demonstrado.

A mudança de maior alavanca, porém, não é hiperparâmetro: é **gerar texto de IA
dentro de cada registro humano**. Enquanto todo texto de IA for `domain: "geral"`
e todo texto humano tiver um gênero definido, o modelo continuará podendo decidir
por registro, e a taxa de falso alarme continuará dependendo do gênero, como a
tabela do item 1 mostra. O corpus precisa de pares: mesma fonte, mesmo gênero,
mesmo tópico, comprimento semelhante — "escreva um verbete de enciclopédia sobre
X", "responda a esta pergunta de Stack Overflow", "escreva uma avaliação deste
produto".

Para o texto misto, a formulação precisa mudar de classificação de documento para
**rotulagem em nível de sentença ou token**, usando os `mixture.spans` que já
existem, com o escore de documento derivado da agregação. É também o que faria o
sinal localizado (hoje desligado pelo sentinela `warningLocalized: 2`, porque
nenhum limiar de máximo-de-janelas cabia no orçamento de FPR) voltar a ter
utilidade.

### 6.1 O que o estado da arte diz sobre o nosso problema específico

**O recall de 11,6% em texto misto é o comportamento publicado e esperado de um
classificador binário de documento.** Não é déficit de ajuste. HART
([arXiv 2503.00258](https://arxiv.org/html/2503.00258)) mede exatamente isso: um
classificador RoBERTa de documento atinge **AUROC 0,502 — azar puro — e 8% de
TPR@5%FPR** no nível "conteúdo de IA humanizado". Fast-DetectGPT e Binoculars, que
usam LLMs de 7B em inferência, chegam a 0,711 de AUROC no mesmo nível.

O teto conhecido para a nossa tarefa é baixo. O vencedor do **PAN 2025 Voight-Kampff
Subtask 2** — a única competição que propôs formalmente o problema de autoria mista,
em 6 classes — obteve **64,46% de recall macro usando um Qwen3-4B ajustado**, contra
48,32% da linha de base roberta-base ([CEUR Vol-4038](https://ceur-ws.org/Vol-4038/paper_307.pdf)).
O mesmo sistema tinha 97,27% na validação: um colapso de 33 pontos. E Zeng et al.
([arXiv 2403.03506](https://arxiv.org/html/2403.03506v1)), no corpus CoAuthor de
interação humano-IA real, mostram que **mesmo com um detector de fronteira perfeito
o teto é 0,52 de Kappa**.

Duas consequências diretas:

- **Nenhuma configuração de um BERT-base de documento resolve texto misto.** A
  correção é de formulação, não de hiperparâmetro.
- **A meta de 50% do gate `warning.mixed-recall` está acima do que um modelo de 4B
  atinge.** O gate está pedindo o que a literatura não entrega. Ele precisa ser
  reancorado em evidência, não afrouxado por conveniência.

**O achado que mais muda o nosso desenho de corpus**: OpAI-Bench
([arXiv 2606.06481](https://arxiv.org/html/2606.06481)) constrói 9 níveis
progressivos de cobertura de IA (v0=0%, v4=50%, v8=100%) e encontra
**não-monotonicidade** — as versões intermediárias são *mais difíceis* que ambos os
extremos. Fast-DetectGPT cai de F1 65,0 em v1 para **35,2 em v4**. Uma avaliação que
só tem "humano puro" e "IA pura" é estruturalmente cega ao próprio ponto de falha.
É o desenho que o nosso corpus deveria ter e não tem.

### 6.2 Backbone: o orçamento em INT8 é ~106M de parâmetros

Em INT8, bytes ≈ parâmetros. O bundle atual de 106 MB significa que **o orçamento é
de ~106M de parâmetros, incluindo a tabela de embeddings** — e é aí que os modelos
multilíngues estouram.

| modelo | params | contexto | idioma | INT8 estimado | cabe? |
|---|---:|---:|---|---:|---|
| BERTimbau-base (atual) | 110M | 512 | pt-BR | ~110 MB | sim |
| Albertina-100m-ptbr | 100M | 512 | pt-BR (MIT) | ~100 MB | sim |
| BERTugues-base | 110M | 512 | pt (+7k tokens pt) | ~110 MB | sim |
| moBERTo | 149M | **8192** | pt (CC-BY-4.0) | ~149 MB | 1,4× acima |
| ModernBERT-base | 149M | 8192 | **só inglês** | ~149 MB | não usar |
| mDeBERTa-v3-base | 280M | 512 | 100 idiomas | ~280 MB | 2,6× acima |
| mDeBERTa-v3 **com vocabulário podado** p/ pt-BR | ~124M | 512 | pt-BR | ~124 MB | quase |
| mmBERT-small **podado** | ~61M | **8192** | pt-BR | ~61 MB | **cabe folgado** |

Três decisões que a evidência sustenta:

1. **Não adotar ModernBERT-base.** É só inglês, e o moBERTo
   ([arXiv 2606.22722](https://arxiv.org/pdf/2606.22722)) mostra que o ModernBERT
   inglês *degrada abaixo da própria linha de base de 512* em contexto longo
   português (nDCG@10 0,4054 → 0,2867 em 8k).
2. **Manter BERTimbau-base como a referência a ser batida.** O único artigo de
   detecção em português — **PT-Detect, ENIAC 2025, UFOP**
   ([DOI 10.5753/eniac.2025.13952](https://sol.sbc.org.br/index.php/eniac/article/view/38755))
   — mostra BERTimbau-Large em 97,7% binário / 96,5% ternário e **BERTimbau/BERTugues
   batendo Llama-3.2-3B com ~2,9B de parâmetros menos**. E o moBERTo não bate
   claramente o BERTimbau em classificação (0,7717 vs 0,7680, dentro do ruído).
3. **Contexto longo é ganho de latência, não de acurácia.** Não existe estudo
   comparando 8k contra janelamento em detecção. Não gastar orçamento nisso.

Se houver apetite para trocar de backbone, a aposta interessante é **poda de
vocabulário** ([arXiv 2305.15020](https://arxiv.org/abs/2305.15020): 40–52k tokens
sem perda mensurável): mDeBERTa-v3-base é 68% tabela de embeddings, e podá-la para
pt-BR o traz para ~124 MB — sendo ele o encoder multilíngue que ganha MULTITuDE,
GenAI Task 1 inglês e o ternário do DetectRL-X. **Nunca foi publicado para detecção
de MGT; é aposta de engenharia, não resultado citado.**

### 6.3 Três mudanças de treino com efeito medido

1. **Aumento por truncamento (multiscale).** A ablação do MPU
   ([arXiv 2305.18149](https://arxiv.org/html/2305.18149v3)) em HC3: **+24,2 de F1**
   em texto curto (58,60 → 82,76), preservando texto longo (97,42 → 98,40). E a
   alternativa "inteligente" — perda PU sensível a comprimento — **custa 13,3 de F1
   sozinha**. Fazer a coisa simples. É mudança só de dados de treino, custo zero em
   inferência, e ataca de frente a nossa faixa `50_79` (3026 registros, a maior).
2. **Diversidade de geradores acima de volume.** ACL 2026
   ([arXiv 2604.13692](https://arxiv.org/html/2604.13692v1)) fixa 12 000 amostras e
   varia o número de geradores: BERT ganha **+5,3 a +6,9 pontos** de N=2 para N=5 em
   geradores retidos. Conclusão dos autores: "diversidade de treino, e não volume,
   é o fator determinante". O nosso treino tem 12 famílias nominais mas **79,7% dos
   exemplos de IA vêm de um único corpus público**.
3. **Mistura robusta com dados ofuscados.** Macko, Moro & Srba
   ([arXiv 2503.15128](https://arxiv.org/html/2503.15128v1)) treinam com 44 idiomas
   (**português incluído**), 2 domínios, 16 geradores e 3 ataques de ofuscação:
   mDeBERTa ganha **+21% de AUC relativa fora de distribuição** por −2,1 pontos
   dentro. Português especificamente: MULTITuDE pt 0,9942 → **0,9973**.
   Regularização de consistência siamesa
   ([arXiv 2406.01179](https://arxiv.org/html/2406.01179v2)) é custo puro de treino
   e ablacioná-la derruba a robustez de 97,25% para 50,0%.

### 6.4 Normalização Unicode é obrigatória e está de graça

Homóglifos zeram detectores: Binoculars e Fast-DetectGPT vão a **0,000 de
TPR@1%FPR**, e o Originality perde **75,7 pontos** no RAID
([arXiv 2405.07940](https://arxiv.org/abs/2405.07940)). É classe de bug, não
problema de pesquisa. Verificar se o caminho de inferência normaliza Unicode e
remove caracteres de largura zero — o `near_dupes.py` faz NFKC, mas isso é do
montador, não do detector.

### 6.5 Métrica e calibração: trocar o alvo

**A métrica de release é o recall no limiar congelado; TPR@1%FPR e AUROC são
diagnósticos de separabilidade** (ver §4.6 — uma versão anterior desta seção elegia
TPR@1%FPR como primária, e isso está errado porque ele escolhe um ponto na ROC do próprio
teste). Dito isso, o diagnóstico importa muito, e é aqui que a literatura é
esclarecedora. Tufts, Zhao & Li
([arXiv 2412.05139](https://arxiv.org/html/2412.05139v4)) encontram um sistema com
**AUROC 0,9249 e TPR@1%FPR de 0,00**, e concluem que AUROC correlaciona com TPR em
FPR de 0,4–0,6, não em 0,01. O RAID acrescenta o achado estrutural: **três
detectores não conseguem fisicamente operar a 1% de FPR** (piso de 16,9% no
ZeroGPT). Vale checar o nosso histograma de escores antes de citar qualquer limiar —
com 88,8% da classe de IA acima de 0,999, a granularidade disponível perto do corte
é pequena.

**A melhor peça de calibração da literatura é diretamente aplicável a nós.** MCP
(ACL 2025, [2025.acl-long.601](https://aclanthology.org/2025.acl-long.601/)) calibra
um limiar conformal **unilateral, usando apenas texto humano**, com **quantis por
faixa de comprimento** — remover as faixas custa −22% de TPR. Como a garantia nunca
toca a distribuição de texto de IA, **ela sobrevive à troca de gerador por
construção**. É a única garantia da área que não evapora fora de distribuição, e é
exatamente o que o nosso produto promete (limitar acusação falsa). O conjunto de
calibração do MCP são 5000 textos humanos; nós temos 12 093 humanos de sobra nos
pools frescos.

**Abstenção tem respaldo, e o nosso 93,3% de cobertura é defensável.** O PAN
Voight-Kampff é a única competição que a permite explicitamente, e pontua com
**C@1 + F0.5u + Brier**: C@1 premia a abstenção, F0.5u a cobra como falso negativo,
então ela não é grátis nem proibida. Vale **reportar Brier ao lado de ECE** — Brier
é regra de pontuação própria e a única métrica calibração-adjacente com alguma
comparabilidade no campo.

Sobre ECE, o contexto importa: **existem apenas dois artigos publicados com ECE para
esta tarefa**, ambos in-distribution, e um deles reporta 0,49 para sete arquiteturas
diferentes — incompatível com o Brier de 0,034 que reporta junto, provavelmente
estimador quebrado. **Não há alvo publicado de ECE para um benchmark difícil de MGT,
e nenhum para português.** O nosso 8,18% não tem com o que ser comparado; o limite de
5% é nossa escolha, não convenção da área.

### 6.6 Dados em português que já existem e não estamos usando

Este é o achado de maior valor prático, porque a geração de IA foi o gargalo:

| recurso | português | licença | contém classe mista? |
|---|---:|---|---|
| **IberAuTexTification** (IberLEF 2024) | **32 450 textos** (~19%), em treino | **CC-BY-4.0** | não |
| **MultiSocial** (ACL 2025) | **44 178 textos**, em treino | — | não |
| **DetectRL-X** (ACL 2026) | 1 de 8 idiomas | — | **sim, ternário HWT/HLT/LGT** |
| MULTITuDE | 2 673, só teste | Zenodo restrito | não |
| PT-Detect (ENIAC 2025) | 3 024 (Folha, 2015–2017) | código público | reescrita total, não parcial |

**IberAuTexTification está no HuggingFace como `Genaios/iberautextification`, sob
CC-BY-4.0, com 32 450 textos em português em 7 domínios** (chat, how-to, notícia,
literário, avaliações, tweets, wiki). Isso é oito vezes o volume de IA que geramos
com dificuldade de cota — e vem com diversidade de domínio que o nosso corpus não
tem. **DetectRL-X é o único benchmark que intersecta português e texto misto**, e o
mDeBERTa faz 87,68% no ternário dele.

Lacunas reais em português, que valem saber antes de prometer qualquer coisa: **não
existe benchmark pt-BR de texto parcial**, **nenhum estudo de calibração em
português**, **nenhuma análise por comprimento** além de um número do MultiSocial, e
**nenhum estudo de viés contra falante não nativo em português**.

### 6.7 Viés: não assumir a direção do inglês

Liang et al. (*Patterns* 4(7):100779, 2023) é o resultado que todo mundo cita: **FPR
médio de 61,22% em 91 redações TOEFL** contra 5,19% em redações de nativos, com
mecanismo atribuído a perplexidade mais baixa.

**Mas a Charles University** ([arXiv 2602.05769](https://arxiv.org/html/2602.05769),
fev 2026) refez o estudo em tcheco e **o mecanismo inverte**: redações não nativas
têm entropia *mais alta* (3,48 contra 3,19, p<10⁻¹⁴), porque numa língua
morfologicamente rica os erros gramaticais elevam a entropia mais do que o
vocabulário limitado a reduz. Um dos detectores testados foi **melhor** em texto não
nativo. Conclusão dos autores: "o viés em detectores de GPT é dependente da língua".

O português é morfologicamente mais rico que o inglês. **Não dá para assumir a
direção do viés, e uma mitigação desenhada para a direção do inglês pode piorar.**
Ninguém mediu isso em português — mediríamos primeiro. O caminho é medir entropia
nos subgrupos de baixa proficiência e variação dialetal antes de desenhar qualquer
mitigação. A nossa família hard-negative `non-native` tem **20 registros**.

### 6.8 O que esperar, não o que resolver

O vencedor do PAN 2025, um **Qwen3-14B** robustamente ajustado, fez **0,9972 de
ROC-AUC dentro da distribuição e 0,6995 fora**. O melhor sistema na única
competição de autoria mista em 6 classes fez **64,46% de recall macro**. Um detector
local de ~106 MB rodando em WASM não vai bater isso.

O produto precisa ser desenhado em torno de **abstenção, taxa de acusação falsa
garantida e incerteza honesta** — não em torno de um número de recall. E aí a nossa
arquitetura já está do lado certo: o pipeline tem abstenção, tem orçamento de FPR,
tem uso único de holdout e tem cadeia de digests. O que falta é o corpus e a
formulação estarem à altura dela.

---

## 7. Recursos disponíveis

Não é preciso começar da coleta. O inventário mostra **51 825 textos distintos já
extraídos e não usados** (união de `benchmark/data/candidates/` e
`benchmark/data/dataset/` = 61 825; o corpus selado usa 10 000):

| bucket | distintos | no corpus selado | sobra |
|---|---:|---:|---:|
| pools humanos frescos | 16 093 | 4 000 | 12 093 |
| pools humanos legados (alimentaram o treino) | 26 000 | 0 | 26 000 |
| pools de IA do pipeline | 4 048 | 4 000 | **48** |
| pools de IA fora do pipeline (majoritariamente Madras) | 15 025 | 1 476 | 13 549 |
| pools mistos | 2 135 | 2 000 | 135 |

Todos os snapshots de origem continuam em disco (`Posts.xml` 748 MB, `ptwiki`
1,9 GB, Carolina `archive.zip` 3,0 GB com 567 membros em 7 tipologias, B2W 48 MB),
e o Carolina tem gêneros ainda não usados (legislativo 162 membros, wikis 197,
domínio público 2) — material para as coortes OOD exclusivas do teste (§5, item 3).

**O gargalo é o texto de IA**: só 48 registros de sobra nos pools do pipeline. Um
corpus de 16 500–22 000 com IA pareada por registro exige gerar muitos milhares de
documentos novos, e foi exatamente aí que a cota dos CLIs limitou a coleta anterior.

**Mas o gargalo verdadeiro é outro, e a revisão crítica está certa ao apontá-lo:**
nada nesses 51 825 textos é conteúdo profissional contemporâneo, que é o domínio do
produto (3.8). Wikipédia, Stack Exchange, Carolina e avaliações de produto formam uma
boa suíte de robustez/OOD, e devem ser usados como tal — mas não podem governar a
calibração de uma extensão para feed profissional. Adquirir esse material com
consentimento e licença defensável é o item de caminho crítico real, e é problema
jurídico antes de ser problema de engenharia: raspar publicações de rede profissional
tem exposição de termos de uso e de dados pessoais que nenhuma decisão técnica
resolve.

Restrição de licença a considerar antes de qualquer plano comercial: o Carolina é
CC BY-NC-SA 4.0, o que torna o modelo treinado **não-comercial**
(`models/cleanfeed-ptbr-v1/NOTICE.md`). Se o produto tiver ambição comercial, o
Carolina precisa sair do treino — e ele é hoje 1600 dos 4000 humanos do corpus e
~6400 linhas do treino.

---

## 8. Ordem sugerida

Barato e imediato, sem depender de decisão nenhuma:

1. **Propagar a mensagem real do erro de inferência** (3.2). Sem isso, qualquer
   correção das falhas de documento longo é palpite. Três origens distintas colapsam
   hoje no mesmo `INFERENCE_FAILED`.
2. **Corrigir os dois defeitos de avaliador**: `?? 0` (3.1) e o campo de família
   comparado na fatia `generatorExposure` (3.3). São mudanças de poucas linhas e
   ambas alteram o significado dos números publicados.
3. **Normalização Unicode no caminho de inferência** (6.4) — gratuita, determinística,
   e é a defesa de maior retorno contra homóglifos.
4. **Limitar a inferência a `maxWindows`** em vez de pontuar todas as janelas e
   descartar (3.2). Corta o custo em documentos longos sem mudar resultado.

Depende de decisão sua:

5. **Política de licença** (item 7). O Carolina é CC BY-NC-SA 4.0 e hoje contamina o
   modelo com não-comercial; ele é 1600 dos 4000 humanos. Isso determina quais
   fontes entram em tudo o que vem depois.

Decisões de produto e de esquema, que precedem qualquer coleta:

5. **Política de licença** (item 7). O Carolina é CC BY-NC-SA 4.0 e hoje contamina o
   modelo com não-comercial; ele é 1600 dos 4000 humanos. Isso determina quais
   fontes entram em tudo o que vem depois.
6. **Definir o alvo formalmente** e separado: texto integralmente gerado; texto com
   assistência material de IA; texto com spans de proveniência localizável. Cada um
   com regra de anotação, métrica e ação de produto próprias (3.5, 6.1).
7. **Corrigir o esquema de proveniência e de grupos** (3.6) — persistir autor, página,
   seed, prompt template, versão/configuração de geração, batch, raiz de derivação e
   cluster de quase-duplicata, reais e pseudonimizados. **Nada abaixo é confiável
   antes disto**, porque split, validação cruzada, bootstrap e dimensionamento todos
   dependem de cluster real.
8. **Corrigir a governança de revisão e PII** (3.7) — recibos reais, ou marcar como
   `automated/unreviewed`.

Coleta e reconstrução:

9. **Obter humanos in-domain contemporâneos** com consentimento e licença (3.8). É o
   caminho crítico real e o item que pode inviabilizar a calibração do produto.
10. **Incorporar IberAuTexTification pt** (32 450 textos, CC-BY-4.0, 7 domínios) e
    avaliar MultiSocial pt (6.6) como suíte de robustez/OOD — não como base de
    calibração. Verificar antes o overlap com os nossos pools.
11. **Gerar IA pareada** por registro, tópico, comprimento e época, variando modelo,
    versão, prompt, temperatura, top-p, penalidade de repetição e decoding (§6, 6.3).
12. **Reconstruir a classe mista com proveniência observável** — inserções ou
    concatenações controladas, ou um pipeline que registre cada operação de edição —
    e montar a curva v0–v8 de cobertura de IA (6.1). **Não reutilizar os spans de
    diff atuais como rótulo de token** (3.5).
13. **Reconstruir o corpus e congelar o split de cinco partições** (§5), auditando e
    publicando a contagem de clusters independentes por fatia.
14. **Retreinar** com objetivo no nível do documento e política de janelas igual à do
    runtime (multi-instância), aumento por truncamento, diversidade de geradores,
    múltiplas seeds, e ablações para smoothing/losses/agregação. Preservar os logits.
15. **Calibrar** em dados independentes: calibrador em `cal-A`, limiar em `cal-B` com
    política pré-registrada (4.8), limiar conformal unilateral sobre texto humano com
    quantis por faixa de comprimento (6.5), e calibração condicional por faixa ou
    declaração explícita de que o escore é global (4.9).
16. **Ajustar os gates**: `0_49` fora de escopo, gate de gerador não visto, gate de
    composição core-vs-OOD do split, gate de divergência calibração-vs-teste, gate de
    número mínimo de clusters independentes por fatia, reancoragem do limite de texto
    misto, e no relatório TPR@1%FPR, Brier, log-loss, intercept/slope de calibração e
    PPV/NPV em prevalências plausíveis (4.1–4.9).

O que **não** muda: a cadeia de digests, o uso único do holdout com concessão, a
recusa de quase-duplicata na montagem e o desenho de três níveis dos gates. Essa parte
da arquitetura funcionou — foi ela que produziu a `reject` em vez de uma publicação
otimista.

---

## 9. Revisão crítica externa (2026-07-26)

Este documento passou por **duas rodadas** de revisão crítica, registradas em
[`detector-rebuild-critical-review.md`](./detector-rebuild-critical-review.md) e no
registro de errata daquele documento. Verifiquei cada afirmação checável contra o código
e os dados. O resultado está incorporado acima; o registro do que mudou:

**Achados confirmados que eu não tinha visto**, todos incorporados: os eixos de
agrupamento sintéticos e o bootstrap degenerado (3.6, o mais grave); a governança de
revisão como metadado constante (3.7); a ausência do domínio do produto (3.8); os spans
mistos como diff e não proveniência (3.5); a restrição de família retida também quebrada
no split (3.3); a incerteza pós-seleção nos limiares (4.8); os três perfis por
comprimento sem calibração por comprimento (4.9); hard negatives não validados
semanticamente; ausência de sobreposição temporal entre as classes (§6, item 5 — canal
testado depois e **não** encontrado); prior do benchmark ≠ prior de
produção; e a inconsistência aritmética do meu dimensionamento (4.7).

**Afirmações minhas que estavam erradas e foram corrigidas no texto:**

1. "A disjunção por grupo já funciona, a auditoria acusou `leakages: []`" — removida.
   A auditoria é tautológica (3.6).
2. "`mixture.spans` já é a anotação para treino em nível de token" — removida (3.5).
3. "Treinar por janela com o rótulo do documento herdado" — substituída por
   aprendizado multi-instância (§6, item 1).
4. "Sem suavizamento de rótulo → saturação → ECE irreparável" — requalificada como
   uma entre várias causas candidatas, a comparar em ablação (§6, item 3).
5. "Excluir os erros do denominador" — substituída por métricas duplas end-to-end e
   condicionais (3.1).
6. Dimensionamento de ~11 000 registros — corrigido para 16 500–22 000, e marcado como
   piso otimista até haver contagem de clusters reais (4.7).
7. "Todo registro humano em todas as partições" **e** "reservar uma fonte humana
   inteira só para o teste" liam-se como contraditórias — reescritas com a distinção
   entre estratos *core* e coortes *OOD* (§5).
8. "Basta separar `cal-A` de `cal-B`" — errado, e apontado na segunda rodada de
   revisão. Escolher o limiar em `cal-B` e reportar um Wilson de `cal-B` continua
   sendo pós-seleção. A certificação tem de vir do teste cego, de controle simultâneo
   sobre a grade, ou de controle formal de risco (4.8).
9. A alegação de disjunção entre os dois conjuntos — afirmação forte demais.
   `drop_seen()` prova ausência de sobreposição por hash exato e de quase-duplicata
   sob Jaccard ≥ 0,82; esse contrato **não** sustenta a alegação mais forte (4.8).

**Um ponto em que a revisão erra**, verificado: ela afirma que o `dev` usado por
`train_detector.py` para selecionar o checkpoint é o mesmo `development` que o `fit`
consome. Não é — são artefatos distintos e disjuntos (detalhe em 4.8). O problema de
seleção adaptativa que ela levanta é real, mas por outro mecanismo.

**Onde a revisão subestima:** ela diz que `generatorVersion` e `promptTemplate` "não são
preenchidos de modo consistente"; medindo, eles **nunca** são preenchidos — 10 000
ausências. E o hedge sobre `derivationRoot` ("salvo derivações específicas") é generoso:
ele é único em todos os 10 000 registros, inclusive nos mistos.

**Concordo com o parecer executivo**: o estado atual é **no-go para retreino ou
publicação**, e os cinco P0 têm prioridade sobre troca de arquitetura, suavizamento de
rótulo ou ajuste de hiperparâmetro. A ordem da seção 8 foi reescrita para refletir isso.
