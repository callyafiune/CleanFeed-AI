# ESTADO — a fonte da verdade do projeto

> **Este é o documento que se lê primeiro, e o que vale em caso de conflito.** Precedência: o **código
> medido** vence tudo, inclusive este arquivo; **este arquivo** vence qualquer outro documento; os planos
> e o registro trazem a **razão**, não o estado. Um documento que contradiga este deve ser emendado para
> apontar para cá.
>
> **Sobrescrito, não acrescentado.** Diz o que **é**, nunca o que aconteceu: sem histórico, sem o que
> entrou ou saiu, sem justificativa. Razão, narrativa e retratação ficam no registro
> (`superpowers/plans/2026-07-30-registro-de-decisoes.md`); os **valores medidos vigentes** vivem em
> § 5, cada um com a data ou o artefato da medição.
>
> Coluna **quem**: `OP` = operador, não reversível pelo agente · `AG` = agente, ratificável ·
> `código` = imposto por código medido. Um valor que a pré-inscrição vigente congela e algum módulo lê
> é `código`, qualquer que tenha sido a política que o escreveu primeiro.

**Última reescrita:** 2026-08-20

---

## 1. Onde está

| item | valor |
|---|---|
| branch | `cleanfeed-mvp` |
| suíte | 172 arquivos / 3.102 testes (vitest) + 737 testes e 742 subtests (pytest, lab). Verde em rodada limpa e SOZINHA; com uma segunda corrida de vitest concorrente, dois a quatro arquivos de caminho selado batem no timeout de 20 s — dívida de § 7, não de política |
| dos quais, o avaliador | 2.462 — 1.725 em 46 arquivos de `benchmark/tests`, 737 no lab |
| typecheck | limpo |
| lint | 12 problemas (10 erros, 2 avisos), e **nenhum erro em caminho rastreado**: os 10 estão todos sob `.cache/chrome-for-testing/` — um Chrome baixado, que `.gitignore` cobre e nenhum commit carrega —, então esse número é propriedade do cache e se move quando a versão do browser se move. Os 2 avisos são de `src/`, em `react-refresh/only-export-components` |
| tags de release | 0 |
| `issuedAt` no descritor | `null` (`models/cleanfeed-ptbr-v1/release.json`, com `gateDecision: "pending"` e `profileDigests: []`) |
| verificador de links de docs | 207 links relativos em 35 arquivos, todos resolvem |

---

## 2. Domínios e células

A alegação é publicada como tabela, uma linha por célula.

| célula | material |
|---|---|
| **texto enciclopédico** | Wikipédia pt, dump 2022-03-01 |

Uma célula, uma string: `humanCoreStrata`, `preRegistration.quotaAxis.cells` e
`RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` são a mesma grafia — `ptwiki` —, que é o valor do campo
`humanSourceType` que os gates fatiam. Duas grafias da mesma partição já publicaram corpus que todo gate
contava vazio.

Fora da moldura, em **duas** listas que o código mantém separadas porque exigem ações diferentes:

| lista | membros | o que destrava |
|---|---|---|
| recusado por condição legal (`A1_BLOCKED_DOMAIN_SOURCES`, `humanSources.blockedSnapshots`) | Stack Overflow pt | registro verificável da aquisição do dump **mais** disposição do termo de acesso de 2024 |
| fora da moldura amostral (`OUT_OF_FRAME_DOMAIN_SOURCES`, `OUT_OF_FRAME_TYPOLOGIES`, `OUT_OF_FRAME_HUMAN_SOURCES`) | resenha de produto (B2W) e a Carolina **inteira**: *judicial branch*, *university domains*, *social media*, *legislative branch*, *public domain works*, *wikis*, *datasets and other corpora* | emenda da moldura |

A razão das três primeiras tipologias da Carolina é **medida** (§ 5.6): cada uma é corpus de
**instituição única** e nenhum documento declara autor, então o material não carrega a proveniência
necessária para estabelecer independência na escala que o intervalo exige — entre 1 e 38.187 unidades ele
não oferece base para escolher. Não é célula mais estreita: é célula sem sustentação, e nenhum `n` a
conserta.

A rota e a licença dos membros da segunda lista permanecem admissíveis; o que falta a eles é célula.
`FRAME_TYPOLOGIES` está **vazia** e `extract_carolina.py` recusa a corrida em `CarolinaOutOfFrame` antes
de abrir o arquivo — o módulo fica na árvore, declarado, pela mesma convenção do PT.SO e do B2W.

---

## 3. Vigente

### 3.1 Alegação

| # | vigente | quem |
|---|---|---|
| | a alegação é **escopada e publicada como tabela por célula**, com a moldura declarada | OP |
| | "texto em pt-BR em geral" **não é alegável** — sem moldura amostral não há estimando | OP |
| | a pré-inscrição vigente é **`benchmark/preregistration-v4.{json,ts}`** (`PREREGISTRATION_V4`, `policyVersion: "preregistration-v4-v1"`) | código |
| | a família certificadora é **por célula**, `m=4`: `calibration-global`, `fpr-ptwiki`, `integrity`, `recall-at-threshold`. α familiar 0,05; α por hipótese **0,0125**; correção de Bonferroni | OP |
| Regime 2 | cada release certifica **só a própria hipótese versionada**; erro familiar ao longo da história do produto **não é alegado**. Toda execução certificadora é publicada, passe ou reprove | OP |
| | pisos de poder: **300** negativos humanos por célula em `test` (`criticalFprHumanNegatives`), **300** unidades de amostragem (`samplingUnits`), **200** positivos para recall (`criticalRecallPositives`) | código |
| | coleta: alvo de **4.000** linhas humanas na célula, piso de **1.500**, total de **4.000**, **1** linha por documento de origem (`collection`) | OP |
| | teto sob zero eventos: `1 − perHypothesisAlpha^(1/n)`, em **dois** pontos declarados. No piso de **300** linhas do bloco cego vale **1,4501 %** (`ceilingAtAdoptedFloor`) — é o critério de recusa, o pior teto que ainda sela. No bloco cego de **800** linhas que o alvo de coleta implica (`blindBlockLinesAtCollectionTarget`, derivado de 4.000 × 0,20) vale **0,5463 %** (`ceilingAtCollectionTarget`) — é a expectativa, o número que o model card imprime. Célula abaixo do piso **reprova antes da selagem** (`unitsBelowFloorFailBeforeSealing: true`) | código |
| | o inventário obrigatório de gates é **derivado** de `multiplicity.primaryFamily`, não escrito à mão: hipótese sem gate reprova | código |
| | **o gate `warning.mixed-recall` NÃO decide o release na v1** — emenda de pré-inscrição de 2026-08-12, decidida ANTES de existir linha mista (cota não gasta, `issuedAt` nulo, zero tags, nenhum `fit` sob a v4; a janela do § 3.4). O bloco misto continua **medido e publicado**, e as duas palavras têm alcance diferente, medido em 2026-08-17 por revisão independente: **medido** vale do objeto selado — a coorte `mixed.atLeastHalfAi` é campo de `report.metrics` e viaja ao perfil como `gateEvidence.overall.mixedRecall` —, mas **publicado ao lado dos gates** vale do **Markdown renderizado** e não do artefato serializado: `mixedRecallDiagnostics` tem um único chamador, `mixedRecallSection`, que devolve linhas de texto, então o pareamento do valor com o **piso** não entra em `reportDigestInput` nem em outra projeção do relatório — e a **ausência** do bloco é tolerada, renderizada como uma frase. Acrescentar campo ao objeto selado foi recusado no desenho (cresceria `GATE_REPORT_KEYS`, mudaria a receita do selo e tornaria irreparável todo relatório arquivado, para selar um número que a política já sela) e a recusa **fica**: o que se corrigiu foi a alegação, não o mecanismo —, e o piso **0,50** continua congelado em `materialAssistance.minimumWarningRecall` como **alvo de REARME**, que exige formulação nova (cabeça de sentença ou de token) **e** piso derivado de evidência com fonte, as duas escritas na política. A razão é uma assimetria medida: o gate declara `role: "diagnostic"` — não sustenta alegação, não gasta alpha e não é membro de `multiplicity.primaryFamily` —, mas a regra de decisão lê o **TIER**, e em tier `warning` reprovado ele **rejeita o release inteiro**; como a v1 teta em `indicator-only` (§ 3.5), passar não habilita alegação nenhuma. Contra isso, o piso está acima do teto documentado para classificador de **documento**: PAN 2025 Voight-Kampff Subtask 2, 64,46 % de recall macro com um Qwen3-4B ajustado; HART, AUROC 0,502 e 8 % de TPR@5%FPR; o corpus morto, 11,6 %. Reancorar o VALOR hoje foi recusado por não haver fonte que sustente um número para esta formulação — o remédio que a literatura nomeia é trocar a formulação, e o valor vem depois. **No mecanismo** (2026-08-12): o bloco saiu de `pointWarningGates` e o id deixou de existir como `GateResult` — um bloco **sem campo de veredito** publicado ao lado dos gates, no molde de `metrics.lengthBands` —, e a não-decisão mais as duas condições de rearme moram na política (`materialAssistance.decides: false` por `literal`, `rearmRequires` por `frozenList`, que pina conteúdo **e ordem**). Dar a `GateTier` um quarto valor foi **medido e recusado**: não existe leitor fail-closed de `tier` — `failedIds` filtra por igualdade e `profile-artifact.ts` declara por escrito que filtrar o desconhecido é a direção fail-**open** —, e o tier novo seria um interruptor silencioso (§ 7). Rearmar custa **quatro** edições coordenadas, três das quais reprovam alto | AG · ratificado 2026-08-12 |
| | **faixas de comprimento pré-inscritas** (`lengthBands`), quatro, conteúdo e ordem congelados: `[50,79]` · `[80,149]` · `[150,299]` · `[300,+∞)`. São **DIAGNÓSTICO** — `role: "diagnostic"`, `decides: false`, `spendsAlpha: false` —, então **não** são hipótese, não gastam alpha e não movem `m`, que continua **4**. Não são o pior estrato e não competem com a manchete: a manchete é **um** teto sobre a célula inteira. A primeira faixa começa exatamente em `wordFloor.abstainBelow` (50) e o parser recusa qualquer outro valor, porque a medição abstém abaixo disso; as faixas particionam de 50 ao infinito sem lacuna e sem sobreposição, e a última não tem limite superior. Cada faixa declara o `n` que o alvo de coleta lhe reserva no bloco cego (`expectedBlindBlockLines`, somando os 800) e o teto que esse `n` implica (`diagnosticCeilingAtExpectedLines`): **238 / 239 / 204 / 119** linhas, tetos **1,82 % / 1,82 % / 2,13 % / 3,62 %** — faixa larga declarada como larga | código |
| | `sizeBucket` (`benchmark/metrics.ts`) **deriva** dessas faixas e devolve *nenhuma faixa* abaixo do piso de abstenção, então nenhuma tabela chaveada por faixa nomeia população que a medição não mede. A derivação é `lengthBandKeyOf(bands, wordCount)`, que recebe a lista de faixas por parâmetro — é o que permite provar que ela **lê** as arestas em vez de repeti-las em literal, exercitando-a contra uma lista que não é a embarcada | código |
| | "faixa de comprimento" nomeia **quatro** partições, e nenhuma é a outra: as **quatro pré-inscritas** (acima); os **decis** da sonda de comprimento (`LENGTH_PROBE_DECILES`, derivados do dado — admissível porque a sonda não decide); as **três bandas de perfil do runtime** (`profileBands`, `50-79`/`80-199`/`200-plus`); e `lengthBucket` de `benchmark/split-audit.ts`, que corta em `short`/`medium`/`long` sob o **mesmo nome de eixo** (§ 7). Mais a grafia antiga `80_99`/`100_149`, que sobrevive só no caminho **embutido não calibrado** de `src/inference/calibration.ts`, declarado lá como não sendo o perfil científico. `RUNTIME_BUCKET_CONSTITUENTS` é o único lugar em que a faixa pré-inscrita e a banda de runtime se encontram, e a cobertura é **imposta**: faixa pré-inscrita fora do mapa, ou gate de ação de faixa que o mapa não conhece, **recusa a publicação** (`LENGTH_BAND_UNMAPPED`) — filtrar a chave desconhecida era fail-**open** | código |
| | frações de partição **45 / 5 / 10 / 20 / 20** (`train`/`dev`/`cal-A`/`cal-B`/`test`): campo `preRegistration.partitionFractions` da pré-inscrição vigente, de onde `split-audit.ts` deriva `PARTITION_TARGETS` | código |
| | unidade do inventário de poder = **componentes conexos** (`powerInventoryUnit`) | código |

### 3.2 Modelo e melhoria

| vigente | quem |
|---|---|
| a medição vale para **um** hash de pesos, e o hash vem do recibo F6 (`eligibleCandidate: weights-hash-from-f6-receipt`) | código |
| acrescentar domínio à **avaliação**: pesos idênticos, bloco cego novo só para a célula nova, linha nova na tabela. As linhas antigas seguem válidas | AG |
| acrescentar domínio ao **treino**: hash novo, **todo teto publicado morre**, e é preciso material cego fresco em toda célula alegada | AG |
| melhorias de modelo são **agrupadas**, não iteradas — cada retreino custa re-medição completa | AG |
| material cego é reservado na **aquisição**, não no corte | AG |
| `blindReserveCompleteAttempts: 2` · `plannedCertifyingMeasurements: 1` — ambos pinados na leitura da pré-inscrição vigente, o segundo como valor congelado | código |

### 3.3 Corpus

| # | vigente | quem |
|---|---|---|
| | esquema do benchmark na **v4**: **14 eixos** de grupo (`V4_GROUP_AXES`), com `sourceMaterialBatch`, `generationBatch` e `extractionRun`; `collectionBatch` não existe. `validateBenchmarkRecord` despacha `2 \| 3 \| 4`; o espelho Python (`benchmark/lab/group_axes.py`, `axes_of`) é ciente da versão | código |
| | `AXIS_STATE_RULE` é total sobre os dois tuplos e sobre as quatro classes de linha: para cada eixo, quais dos três estados (`known`, `notApplicable`, `unknown`) a classe pode escrever | código |
| | a união do split roda sobre **seis** chaves (`GROUP_KEYS`): `author`, `source`, `promptTemplate`, `generationBatch`, `nearDuplicate`, `derivationRoot` — e a lista tem **critério**, que é condição NECESSÁRIA e nunca definição: todo eixo dela identifica material (`EXPOSURE_IDENTITY_AXES`) ou é **inerte medido** sobre o corpo (`INERT_UNION_AXES`), e `GROUP_KEYS ⊆ (a) ∪ (b)` é asserção. A **recíproca é declarada falsa**, com os dois eixos que a refutam nomeados no texto: `humanSeed` identifica material e é **linhagem de pai**, `extractionRun` é inerte e é **diagnóstico**. A situação de um eixo é decidida por **quatro listas** (`groupAxisRole`, função total sobre os quinze), e o resíduo que as quatro não cobrem está escrito: `generatorFamily`, `generationLane`, `harnessVersion` e o v3-only `collectionBatch`. `derivationRoot` entra **também** por linhagem de pai (`PARENT_LINKAGE_AXES`), e `axisConnectivity` separa as duas relações — ler indivisibilidade da lista de pertença já publicou alegação falsa de independência uma vez | código |
| | **`promptTemplate` está na união e `generatorVersion` é REPORTADO** — decisão do operador em 2026-08-12, revertendo parte de U4. O recall é um dos quatro membros da família certificadora, e com os dois eixos fora ele era medido sobre prompts já vistos: 1.170/1.170 linhas tinham o seu template em mais de uma partição e 46.193 pares mesmo-template caíam em train × test, com erro de direção conhecida e magnitude que o próprio corpus não permite dimensionar. `generatorVersion` ficou fora porque **não é imponível**: a identidade dela é o id do modelo (`version ≡ family`, medido 1.170/1.170 e preso por teste), então particioná-la custaria **um modelo distinto por ilha** contra as cinco identidades do slate — e ela não é o que quebra o corpus (sozinha, maior componente **42,14 %**, que cabe). O resíduo está fixado por teste nos dois lados: a co-locação de versão **não é modelada**, e a perna de novidade de gerador é a reserva OOD por família | OP · ratificar |
| | **o corpus tem de ser CONSTRUÍDO em ilhas de receita**, e a ilha é um bloco de **material humano**: toda linha gerada ou mista semeada nesse bloco pertence a ela. Não basta particionar templates — medido, um corpo em que cada template pertence a uma corrida colapsa de 20 componentes para **11, com o maior em 60 %**, porque `derivationRoot` une por valor e uma linha mista cujo pai é a semente de outra ilha funde as duas. O plano particiona **dois eixos de registro**: `promptTemplate` (que recebe os campos de geração **e** de mistura, porque os dois escrevem o mesmo eixo) e `seedBlock`, com cobertura. A guarda recusa na fronteira do `argparse` do driver — **antes** do arquivo de sementes, do `.lock` e da primeira chamada de provedor —, e a aritmética é derivada de `FIVE_TARGETS`/`CLASS_TOLERANCE`/`RELEASE_CORPUS_POLICY.counts`: ≥ **15** ilhas, nenhuma acima de 1.880 linhas, ao menos uma abaixo de 280. Medido: 14 recusa, 15 erra `cal-A` em 6,6667 %, 20 de 200 realizam 45/5/10/20/20 exato nas três classes | código |
| | **a classe mista realiza SETE níveis da curva de D4 — 15/25/40/50/60/75/90 % de `aiFraction` alvo —, e v0 e v8 NÃO são linhas `mixed`.** `aiFraction` 0 e 1 são expressáveis pelo validador de campo (`fraction` admite `[0,1]`), e a recusa vem do resto do mecanismo: uma linha 0 % IA é o texto do pai palavra por palavra e colide com ele por `normalizedTextSha256`, e um documento 100 % IA não tem origem dividida — `mixture` é proibida fora de `mixed` por esse motivo escrito, e D4 manda o texto livremente reescrito receber rótulo de documento. Os extremos da curva publicada são lidos das classes puras **das mesmas ilhas**: v0 = os pais (uma taxa de aviso sobre humano, isto é um FPR), v8 = as linhas `ai` da ilha. Cada ponto nomeia a sua população e nenhum é agregado com os outros | AG · ratificado 2026-08-12 |
| | **alocação da cota mista**: 20 ilhas × 100 = 2.000, e por ilha **20 células de 5 linhas** — 7 níveis × 3 operações menos v1 × inserção. Totais: v1 200, v2–v7 300 cada; por operação, substituição 700, concatenação 700, inserção 600. A coorte de fração **observada** ≥ 0,50 é v4–v7 = **1.200 linhas (60 %)**, com **240 no bloco cego** — acima dos 200 de `criticalRecallPositives`, então o desenho não fecha a porta do rearme por falta de denominador; sub-0,50 são 800 (40 %), no papel congelado `mixedBelowHalfAiRole: "diagnostic-curve-only"`. O nível é **alvo da operação** e nunca a fração obtida (errata 13 do plano: chavear pela fração daria uma chave por registro-linha), a linha grava `mixLevel` e `mixOperation`, e a banda de v4 é fechada por baixo em `[0,50–0,55]` porque um v4 que aterrissa em 0,48 sai da coorte | AG · ratificado 2026-08-12 |
| | **as operações de mistura são as três de D4 e nenhuma outra**: substituição de seção contígua, inserção de seção contígua, e concatenação de introdução humana com corpo de IA, cada uma registrando offsets e hashes dos segmentos. **Vinte operações distintas não existem e não são alegadas** — a partição exige IDENTIDADES, e identidade é o digest dos bytes do template: **três templates de mistura por ilha**, um por operação, com prompt materialmente distinto por ilha × operação e o nível como parâmetro preenchido (que não muda o digest). No namespace único com a geração dá **cinco identidades por ilha, 100 no corpus** (40 de geração + 60 de mistura). **No mecanismo** (2026-08-12): `_island()` declara os três slots num **dicionário chaveado pela operação** — duas identidades da mesma operação ficam assim irrepresentáveis, e o dono de uma colisão nomeia `ilha/mixingTemplates[op]` —, o vocabulário nasce em `MIX_OPERATIONS` e a guarda de partição o confere por **uma igualdade** (chave alienígena, faltante e a grafia acentuada caem juntas); a alocação é **derivada** de `mix_cells()` e a função é total sobre qualquer cota de ilha; e `assert_island_plan_realizes_the_five_fractions` ganhou o **invariante de ilha** — uma ilha é um componente conexo, medido, com o esperado e o medido na recusa. Um único template de mistura por ilha foi recusado porque confunde a operação com a ilha: `dev` (1 ilha) e a ilha core do bloco cego carregariam **uma** operação só. **v1 × inserção sai, e a razão é VIÉS DE COMPRIMENTO e não impossibilidade** (§ 6: a leitura anterior, de célula inalcançável em todo comprimento, veio de sonda defeituosa). Medido com `shingles_of`/`jaccard` de `near_dupes.py`, agora **preso por teste**: inserir seção que leve o documento ao nível mais baixo preserva o pai inteiro, e o par pai/mista cruza o limite de 0,82 **a partir de 218 tokens de pai** — o sinal só fica monótono a partir de 232, e entre os dois alterna com o arredondamento do enxerto —, ficando **abaixo** dele em pai curto (0,780 a 100 tokens, 0,844 a 1.200). Logo a célula existiria **só em documento pequeno**, e a operação viraria proxy do comprimento — que é eixo de fatia diagnóstica declarado, com as faixas pré-inscritas indo de 50 palavras a 300 e mais. Célula enviesada por comprimento é **pior** que célula vazia, porque ninguém lê o viés. A célula seguinte da mesma operação não chega perto em comprimento algum: 0,745 no máximo. **A forma emendada foi medida pelas funções de produção e aguenta**: as 100 identidades são disjuntas com **zero colisões** no namespace único, e o corpo de 10.000 linhas com três clusters de mistura por ilha dá **20 componentes de 500**, passa o preflight, é atribuído por `_plano_de_blocos` e realiza 45/5/10/20/20 exato nas três classes — com pais contíguos **e** intercalados. A onda C mediu isso com UM template de mistura por ilha, que é outra forma de plano; esta é a medição da forma que a decisão pede | AG · ratificado 2026-08-12 |
| | **seleção de pais da mista**: pai = linha humana do corpus, da MESMA ilha; **um nível por pai e um pai por linha** (`id = mix_<pai>` mais a recusa de id duplicado), logo 100 dos 200 humanos da ilha viram pais; o **critério** que fecha a ilha em um componente é **ao menos um** cluster de operação alcançar as duas metades de template de geração — construir todos alcançando é condição SUFICIENTE deduzida dele, e a distinção é medida com `connected_components`: três clusters cobrindo as duas metades **somados** mas nenhum individualmente **racham** a ilha (40 componentes no corpo, de 230 e 270), um cluster livre com os outros dois presos fecha em 20 de 500, e mistas todas com pai de índice par racham em 200 e 300; pai com `family` na moldura e `sourceMaterialBatch` presente; e o par pai/mista passa o contrato de `near_dupes` **na geração**, não só na montagem — uma seção inserida que **cite** o pai pode cruzar o limite mesmo em v2. "Nunca treinado" é entregue por **co-locação**: `assign_partitions` carimba por componente, então pai e mista aterrissam no mesmo bloco por construção, e não por manter um pool separado. Pilhas de versões do mesmo pai — o desenho intra-documento do OpAI-Bench — são **inexprimíveis** sob o esquema de id, então a curva é entre coortes de pais distintos e a leitura intra-documento não é alegada | AG · ratificado 2026-08-12 |
| | (superado — mantido só como leitura do que o fecho do par mede) o **fecho do PAR**: sozinho, `generatorVersion` dá 5 componentes com o maior em **42,14 %** e CABE; `promptTemplate` dá 4 com o maior em 54,79 % e não cabe; os dois juntos fecham transitivamente e a classe inteira vira **um** componente de 100 %. `generatorVersion` **não** carrega a identidade de `generatorFamily` — cinco identidades contra uma, coincidindo em **0 de 1.170** linhas —, então o argumento da família não alcança este eixo, e a perna que CABE está fixada por teste nos dois lados (`generatorVersionOnly` no catálogo) para a razão falsa não voltar. O que se perde é a **co-locação da receita**: 1.170/1.170 linhas têm o seu template em mais de uma partição, e a dependência de prompt passa a ser carregada pela tabela de reamostragem congelada — `bootstrap.ts` não usa `connectedComponentRoots`, então a unidade do intervalo lê o EIXO e nunca a lista de união | OP · ratificar |
| | `assign_partitions` carimba por **componente conexo**, com a guarda chamada de dentro dela: era passeio por posição, que corta componente por aritmética quando a fronteira de um bloco cai em índice ímpar. O plano coloca o componente inteiro num bloco só, confere o teto **em toda classe que o componente carrega**, e **recusa em vez de fatiar** quando nada cabe — atribuir componentes a cinco partições é soma de subconjuntos, e o guloso é heurística declarada | código |
| | `domainSource` e `sourceMaterialBatch` são eixos **reportados** (`REPORTED_GROUP_AXES`), nunca de união: a dependência do lote é carregada por registro, manifesto e ledger (`splitUnionsOnDependencyAxis: false`) | OP |
| | **unidades independentes** = componentes conexos por **documento de origem**, com ≤ 1 linha por documento por célula | OP |
| | identidade do dataset: `dataset.id` = **`cleanfeed-ptbr-cells-v1`**, `intendedDomain` = **`scoped-cells`**. `ptbr-generic-v1` é **recusado por nome** (`dataset.refusedIds`, código `DATASET_ID_ABANDONED`), não apagado | OP |
| | composição de release comparada por **igualdade exata** em `sealDataset`: `human` **4.000** (1 célula × o alvo de 4.000), `ai` **4.000**, `mixed` **2.000** — total 10.000 (`RELEASE_CORPUS_POLICY.counts`) | OP |
| | manifesto de fontes na **v2**: `materialBatches` é obrigatório e entra na projeção do `sourceManifestDigest` sem condição. Um lote declara `batchId`, `sourceId`, `materialVersion`, `acquisitionWindow` e `evidence` não vazia | código |
| | o **produtor** do inventário é `benchmark/lab/build_governance.ts`, que escreve v2 e nada mais. Os lotes são **DECLARADOS** ali (`DECLARED_MATERIAL_BATCHES`) e nunca derivados dos pools, porque `materialVersion`, `acquisitionWindow` e `evidence` são fatos de um download que nenhum código deste repositório observou. Duas recusas, antes do primeiro byte escrito: inventário **vazio** (`MATERIAL_BATCHES_EMPTY`) e lote cuja `sourceId` o manifesto não declara (`MATERIAL_BATCH_SOURCE_UNDECLARED`). A dos lotes vazios **não é alcançável pelo `main()` de hoje**, que passa uma constante de um elemento: ela guarda um produtor que **derive** a lista, e é por isso que a lista chega por parâmetro em vez de ser lida da constante — contra a constante embarcada, um escritor que pulasse as duas conferências responderia igual a um que as roda | código |
| | **gate de composição** (`benchmark/composition-gate.ts`): três quantidades por célula, só em `test` — linhas de negativo humano elegíveis, unidades de amostragem, e linhas por documento de origem. A recusa nomeia célula, contagem e piso | código |
| | **preflight de viabilidade** (`benchmark/viability-preflight.ts`, `preflight-viability`): condições necessárias antes do split, comparadas **por classe** e também sobre o corpus inteiro — passar não prova que o corpus é divisível | código |
| | `validate` **recusa antes de selar**: a auditoria de governança roda, grava `source-readiness.json` e levanta `SOURCE_READINESS_BLOCKED` **antes** de `sealDataset`, então corpus `blocked` não cunha `dataset-audit.json` — e é a EXISTÊNCIA desse arquivo, não um código de saída, que `runSplit` aceita como permissão. Sair 1 não bastava | código |
| | a exposição só é registrável com **tupla de eixos completa**: `parseExposureRequest` e `buildEventRecords` recusam `groups` cujo conjunto de chaves não seja exatamente `V3_GROUP_AXES` ou `V4_GROUP_AXES`, lidas de `schema.ts` — o ledger não tem literal de nome de eixo. `{}` passava, e `groupDigests` vazio saía atestado; eixo **ausente** deixou de ser indistinguível de eixo **sem cluster**, e a CLI imprime a cobertura da história contra a qual cada escrita foi decidida | código |
| | o manifesto de fontes **impõe** o que promete: `assertNoSourceLocator` varre a projeção hasheada inteira e recusa localizador (o critério é o componente *authority* de `//`, RFC 3986 § 3.2, e não uma lista de esquemas) e identidade contactável. O resíduo é **declarado e fixado por teste como aceito** — localizador vestido de nome de arquivo (`dumps.wikimedia.org (10 bytes)`) passa, porque a whitelist fecha a grafia e não a classe | código |
| | o piso barato da família reservada lê **os pais da própria fatia**: cada fatia é (linhas `ai` da fatia, conjunto dos pais pareados dessas linhas), e as duas AUCs comparadas nunca dividem o vetor humano. A junção recusa por **cobertura da população declarada**, não por população vazia, e os números publicados ao lado do veredito são os da população que os produziu — não os do pool | código |
| | **o extrator carimba `extractionRun`, e o loader não inventa**: `extract_wikipedia.py` e `extract_carolina.py` derivam `er_<módulo>_<versão do material>_<sha256 dos bytes do módulo>` e escrevem o eixo por linha no próprio `writer.offer`; o `setdefault` do loader saiu, e pool que o extrator não carimbou é **contado fora** (`MissingExtractionRun`, queda contada como a de `MissingMaterialBatch`, nunca aborto). O id nomeia o MÓDULO e a versão do material e nada mais largo: duas execuções sobre o mesmo dump com `--limit` diferentes compartilham o id, e isso é declarado e fixado por teste | código |
| | **pertença de célula é exigida no selo, não presença**: em corpus `release`, `sealDataset` recusa quando alguma linha humana declara `humanSourceType` fora de `requiredHumanSourceTypes` — a recusa nomeia cada grafia observada fora da moldura, em ordem, e diz quantas deixou de listar. O gate antigo se satisfazia com **uma** linha da célula, então 3.999 podiam não declarar célula nenhuma sob uma tabela publicada POR célula. O esquema não mudou: `assemble_corpus.py` já escreve a célula em toda linha humana, medido | código |
| | **o gate de composição deixa recibo dentro do artefato selado**: `compositionReceipt` é chave obrigatória de `SplitArtifact` (`null` fora de `release`), o critério dos três limites é **chamado** e não copiado, e `validateSplitArtifact` **reconta** o recibo a partir dos registros e das atribuições, comparando por digest canônico. O par é conferido: atestado e recibo caem juntos, porque os dois derivam de `scientificUse: "release"` e um sem o outro descreve um corpus que é release e não é | código |
| | `BenchmarkReport` chega por **parser** e não por cast: `parseBenchmarkReport` recusa com **oito** códigos nomeados, recomputa o selo, e os três sítios que faziam `as BenchmarkReport` (`verify-evidence`, `publish-evidence`, `publish-profile`) passam por ele — o de `verify-evidence` é o que lia `releaseDecision` do objeto castado e **decidia o ramo**. O limite está declarado e preso por teste: o parser fecha a edição **não re-selada**; uma edição re-selada com a receita exportada passa, porque `release.json` não sela `evidenceDigest` nem `gateDecision` | código |
| | as **varreduras de prosa têm alcance medido**, não declarado: a do `evaluatorDigest` ancora na LINHA de publicação e conta multiplicidade (uma linha carregando o valor vivo **e** um hex velho era aceita); a das contagens ratificadas varre **141** arquivos (103 `.ts` + 38 `.py`) contra os 49 de antes e lê também o número do bloco cego, que derivou junto; a do NOTICE proíbe o **nome publicado** e não só o token entre backticks. A varredura alargada achou uma deriva real na primeira passada: `split-audit.test.ts` afirmava 880 linhas no bloco cego onde a autoridade congelada diz **800** | código |
| | a sonda de mascaramento **impõe partição** e não só cobertura: registro em duas classes é contado uma vez em `records` e pesado em duas médias, e linha de classe fora dos ids pontuados é média sobre registro que `records` não conta. Id sem rótulo saía das **duas** classes sem ninguém contar | código |
| | a AUC do baseline é **invariante à ordem da entrada**: a população é renderizada canonicamente antes de chegar ao `StratifiedKFold`, que particiona por POSIÇÃO — dois operadores com os mesmos arquivos em ordem diferente publicavam números diferentes e nada avisava. A guarda lê as DUAS condições (ordem e multiconjunto) e a posição dela é fixada por teste, porque uma linha perdida entre a guarda e o `split` é sempre a mesma linha em qualquer ordem e nenhuma bateria de permutação a vê | código |
| | rótulo `human` = corte de data **pré-ChatGPT** (`< 2022-11-30`), por campo do documento — nunca por declaração. Na Wikipédia o campo é `revision/timestamp` do dump, e o `pages-articles` carrega só a revisão corrente: dump recente derruba tudo em vez de admitir texto recente, que é a direção fail-closed | OP |
| | licença lida **por documento** (header TEI), com allowlist fail-closed no extrator (4 licenças) e `document_license` como **única** origem da licença de um registro humano. Licença não revisada derruba a linha contada; licença que nenhuma lista nomeia **para a corrida**; fonte com duas licenças **recusa** | AG |
| | a licença de um registro **gerado** é a concessão deste repositório, e candidato que declare outra **aborta** a montagem | AG |
| | o extrator da Carolina não abre **nenhuma** tipologia (`FRAME_TYPOLOGIES` vazia): `CarolinaOutOfFrame` recusa a corrida antes de abrir o arquivo. `TypologyOutOfFrame` — tipologia que nenhuma das duas listas nomeia — é a guarda que uma **readmissão** volta a alcançar, e hoje é medida sob readmissão simulada: com a moldura vazia a primeira recusa dispara antes | AG |
| A1 | Stack Overflow está fora do corpus | OP |
| F0-6 | Stack Overflow bloqueado **por nome**, não apagado | AG |
| A3 | `drop_seen()` = hash exato + Jaccard ≥ 0,82 sobre shingles de 5 tokens, descrito só como isso | OP |
| | a poda é **global** contra o corpus morto, sem restrição por partição: o insumo é um artefato de digests e chaves de shingle (`seen-index.v2.jsonl`), conferido contra a contagem **e** o digest do corpus indexado. Artefato ausente, parcial ou de outro corpus **recusa** a montagem de release | AG |
| | **sondas diagnósticas** (`benchmark/lab/diagnostic_probes.py`): quatro, e **só a primeira decide** — prever a partição entre `train`, `dev` e `cal-A` (validação adversarial / C2ST) **recusa a MONTAGEM** por duas razões nomeadas, `partition-predictable` (AUC um-contra-resto ≥ 0,60 **e** p < 0,01, os dois congelados em código e nenhum deles fração do alpha familiar) e `text-shared-across-partitions`. As outras três — classe por comprimento, lane dentro de `ai`, estilometria com coeficientes publicados — mais o viés ortográfico e a dispersão entre janelas são **diagnóstico que não decide**, e o relatório delas **não tem campo de veredito** | AG |
| | `cal-B` e `test` **nunca** alcançam sonda: `BLIND_PARTITIONS` é espelho pinado de `cluster-exposure-ledger.ts`, `OPEN_PARTITIONS` é derivada de `BLOCK_TIME` menos as cegas, e o relatório publica **um** contador agregado do que foi posto de lado — nunca detalhamento por partição cega, nunca id. Alargar `OPEN_PARTITIONS` reprova dentro da sonda | código |
| | a **taxa de erro ortográfico** é sonda de VIÉS e nunca feature: registro separado (`SPELLING_BIAS_MEASURES`), e `assert_no_bias_measure_reaches_the_features` compara nome **e** callable de dentro de `feature_row`/`feature_matrix` — ligar a feature recusa antes de qualquer `fit` | código |
| D19 | o baseline (`benchmark/lab/baseline_tfidf.py`) roda **cinco** vetorizações em paralelo, num registro que impede rodar uma sem as outras: palavra (1,2), caractere (3,6) com `analyzer="char"`, **`funcionais`** (TF-IDF de somente as 120 palavras funcionais da classe fechada — o **único** piso cego a tema, e `THEME_BLIND_VECTORIZATIONS` o nomeia em código), **`estilometria`** (as 19 features da W3, que **não** é cega a tema: 7 delas leem palavras de conteúdo) e a **união** das duas. O papel é **detector de vazamento**: desempenho alto continua significando artefato de fonte. `POST_FIT_GUARDS` tem as mesmas chaves de `VECTORIZATIONS`, então uma sexta vetorização não chega sem decisão sobre a sua conferência pós-`fit` | AG |
| | **as quatro sondas de dependência de tema** (mascaramento de entidades, fatia por `topic`, piso barato decomposto, facilidade da reservada) são **DIAGNÓSTICO**: `role`/`decides`/`spendsAlpha` declarados, nenhuma é membro de `multiplicity.primaryFamily` e `entity_masking.assert_theme_probes_decide_no_hypothesis` lê a política selada e recusa nas **duas** direções — sonda promovida a hipótese, e família que deixou de ter quatro membros. O inventário obrigatório continua **4** | código |
| | **mascaramento de entidades** (`benchmark/lab/entity_masking.py`): perturbação em tempo de inferência, **três braços** — `original`, `entity-masked` e `placebo-masked`. O placebo casa a contagem de vãos **e** o multiconjunto de comprimentos de vão, e existe porque `[MASK]` é token que a cabeça ajustada nunca viu: sem ele um deslocamento de escore é atribuível ao marcador. A quantidade lida é o **excesso** do braço de entidades sobre o placebo, na classe `ai`; o critério de colapso é `excesso de queda média ≥ 0,10` **ou** `excesso de virada de veredito ≥ 0,20`. O achador de entidades é heurístico e **sub-mascara** (capital que só abre frase sobrevive quando a forma não é evidenciada no meio de outra frase), então `collapses` é o veredito forte e `survives` vem acompanhado da fração de palavras mascarada | AG |
| | **`topic` é eixo de FATIA e nunca de UNIÃO**: entra em `SliceAxis`, `AXIS_ORDER` e nos extratores de `benchmark/slices.ts`, e em `DIAGNOSTIC_AXES` — logo **não** está em `FPR_AXES` nem em `RECALL_AXES`, nenhuma fatia de tópico é elegível a gate, `benchmark/gates.ts` não constrói `warning.fpr.slice.topic.*`, e `summarizeSlices` a tira da média macro **e** da busca do pior caso (duas barreiras, porque a elegibilidade sozinha só cobre a segunda). O relatório publica `## FPR e recall por tópico (diagnóstico)`, uma linha por fatia, com `n/a (fatia vazia)` onde a população medida de um lado é zero — nunca `0`. `topic` **não** entra em `GROUP_KEYS`: eixo de união derivado de um *clustering* põe decisão de modelagem dentro da política selada, e conglomerado temático é grande | código |
| | **critério de aceitação da família reservada**, lido de um número: `lift(família) = (AUC_piso − 0,5) / (AUC_detector − 0,5)`, com `margem` 0,10, `folga` 0,10 e `piso de separação` 0,51. Três vereditos, e **dois** recusam — `measures-easiness` (a reservada é mais fácil para o baseline burro que as *core*) e `no-headroom` (o piso já reclama mais de 90 % do *lift* nas *core*, então o excesso é pequeno por construção e a comparação não resolve). Abstenção lida como aceitação era o fail-open, e a necessidade da regra é **medida** (§ 5.8) | AG |
| A4 | gate antiartefato **pré-treino**, em código (`benchmark/lab/artifact_gate.py`): **dez** detecções — eco de prompt, recusa, metaconversa, assinatura de harness, espaço anômalo, encoding, caractere invisível, Markdown, cabeçalho, frase-padrão de prompt —, teto de contaminação em `Fraction(2, 100)`, comparado **por família geradora** e nunca com o agregado do conjunto gerado, relatório escrito **antes** do veredito e sem nomear linha | OP |
| | a fração do teto é **por LINHA**: uma linha com duas detecções é UMA linha contaminada com as duas razões nomeadas, e a soma por detecção pode exceder a contagem de contaminadas | código |
| | o gate acusa o que `contracts/text-normalization.ts` **remove** antes da tokenização: o que ele mede é contaminação da lane, não a entrada do modelo. A tabela de sondas cobre os **27** code points do contrato, afirmado por **igualdade de conjuntos** contra o literal do lado TypeScript: um code point acrescentado lá sem sonda aqui deixa o teste vermelho | código |
| | calibração das sondas: a **união** das dez detecções sobre a classe humana **em moldura** (ptwiki) fica **abaixo** do teto — 0,809 % medido. Sonda cuja direção é invertida e cujo lado humano passa do teto é **recusada**, e a regra é imposta por teste que roda o gate sobre uma fixture de 1.000 linhas com as formas recusadas dentro (1,0 % contra teto de 2 %) | AG |
| | família acima do teto **regenera a lane inteira** — poda seletiva mascara o viés da lane, e o relatório não dá o que podar | AG |
| R4 | todo registro gerado nasce **`automated/unreviewed`**; a auditoria de PII é **amostral** e não produz `passed` por registro | OP |
| | linhagem: todo gerado **que declara pai** referencia pai presente; `assertDerivedParentsResolve` roda antes do split. A admissão de pai `notApplicable` numa linha `ai` é lacuna aberta (§ 7) | AG |
| | **o Claude fica no núcleo apesar de marcar a saída** — decisão do operador em 2026-08-12. A lane `agy` é `claude-sonnet-4-6`, e a Anthropic publicou marca d'água em **nível de modelo**, presente em qualquer superfície, com os modelos existentes em transição declarada e sem sinal observável; o detector para terceiros é prometido e não existe. Já o **Gemini pela API não é marcado** e não há plano de marcar — resposta de engenheiro do Google em 5/08/2026 sobre `gemini-3.1-flash-lite` —, então as lanes `gemini` e `gemini_cli` estão limpas. Três razões sustentam manter: a consequência de o detector montar na marca **já é medida** pela reserva OOD por família, que é para isso; excluir por hipótese não medida trocaria um risco não quantificável por uma **monocultura de provedor** no núcleo, que é custo real; e um núcleo **misto** nessa dimensão é mais forte que um puro, porque a marca não pode explicar o desempenho na metade Gemini, que não tem marca nenhuma. **A condição de desenho:** a lane `agy` é gerada dentro de **uma janela só**, registrada, para a marca ficar **constante dentro da família** — presente ou ausente, e não há como saber qual. Variação dentro da família seria eixo oculto com `generatedAt` como proxy; constante dentro da família é indistinguível da impressão digital que `generatorFamily` já nomeia, a sonda de lane já mede e a reserva OOD já guarda | OP |
| | as famílias **OpenAI vão ao NÚCLEO** — decisão do operador, revertendo a reserva por provedor: ChatGPT e Claude são as famílias que as pessoas de facto usam, e um detector cego para elas é cego para o caso dominante. A geração é pelo **codex CLI** (não API) e a Anthropic pelo **Claude Code** (não pelo agy, que fica com Gemini e `gpt-oss-120b`). O que a reversão FORÇA: `gpt-oss-120b-medium` é linhagem OpenAI e vai ao núcleo com ela — reservá-la seria reservar receita de fornecedor visto —, e com as duas fora a reserva fica **vazia**, que `declared_held_out_families` recusa ("'sem reserva' não é um estado que a governança consiga expressar"). Logo nomear uma quarta linhagem deixou de ser opcional e é **precondição da montagem**. A reserva escolhida é **local por ollama** — `qwen2.5-7b` e `mistral-7b` —, e a alegação encolhe com ela: a fatia OOD passa a medir "linhagem de pesos abertos não vista" e não "provedor de fronteira ausente", com o viés otimista de um 7B quantizado declarado no model card. A reserva continua sendo política nomeada do slate (`OOD_RESERVED_FAMILIES`), não prefixo, e todo papel de família é **declarado** — `core`, `ood-reserved` ou `excluded` —, com censo dos pools conferido por guarda | OP |
| | `--provider` recusa na **argparse**, com as quatro lanes congeladas como `choices`: nenhuma chamada de provedor fora do slate é gasta | AG |
| | partições cegas = `test` e `cal-B`, privadas e byte-intocadas até a v2.0 | OP |
| | cluster exposto é barrado das **duas** partições cegas | OP |
| | o vocabulário de partições do código é `train / dev / cal-A / cal-B / test` | código |
| | só bases públicas; sem coleta autorizada individual | OP |
| | `ptbr-generic-v1` está morto como dataset | OP |
| C4 | `test` e `cal-B` selados ficam preservados | AG |

### 3.4 Gasto e cegueira

O que "corpus inutilizado" significa — a semântica é **graduada**, nunca tudo-ou-nada.

| vigente | quem |
|---|---|
| a cegueira é **informacional** (R2): digest novo, id novo ou repositório novo **não** a restauram | OP |
| registro-linha que esteve em `test` consumido: fora das **cinco** partições, para sempre. Quase-duplicata desse conteúdo (hash exato ou Jaccard ≥ 0,82): fora das **cegas** | código |
| cluster exposto em **qualquer** partição anterior: fora **só** das cegas — segue elegível para `train`, `dev` e `cal-A` | código |
| conhecimento de nível de **estrato, lote, receita ou semântica** não invalida material. A comparação de exposição lê `author`, `source`, `humanSeed`, `derivationRoot` e conteúdo — nada mais | código |
| a lease do holdout é consumida no **`started`**, de mão única; `completed` e `failed` são terminais; **ledger ausente ≠ bloco não gasto** | código |
| o corpus novo não reaproveita material do morto: a poda global é superconjunto da graduação acima, e dispensa restrição por partição | AG |
| abandonar pré-inscrição depois de ver a **estrutura dos grupos** é legítimo; depois de ver **resultados**, não | OP |
| resultado de **terceiro** sobre o candidato que o operador venha a ver conta como **exposição** e é registrado como tal | OP |

### 3.5 Produto e treino

| vigente | quem |
|---|---|
| **a entrega principal é o MODELO** — pesos + tokenizer + model card + tabela por célula —, **abstraído de toda questão técnica de navegador**. A extensão é consumidora downstream, fora da entrega principal | OP |
| o preview experimental **não faz alegação de erro**, não executa `fit` certificador e não abre concessão; **R1 só começa na v2.0** | OP |
| a única descrição de erro publicável antes de medição é a frase R7-correta: *"A taxa de erro desta versão no domínio de uso não foi estimada em holdout independente. Resultados de desenvolvimento não são estimativas publicáveis e não sustentam conclusão sobre autoria ou sobre pessoas."* | OP |
| teto de ação **`indicator`** no caminho não calibrado: a política o declara (`rollout.maximumStage`, `actionsPromoted: false`, pinados por `literal()`) e o runtime o torna **estrutural** — `src/inference/inference-worker.ts` devolve `DecisionOutcome & { actionCeiling: "indicator" }`, então reintroduzir uma ação mais forte não compila; a lane `experimental` é o único `pending` publicável — `profileDigests: []`, `evidenceDigest: null`, `issuedAt` obrigatório | código |
| **a v1 não tem corte de ação, e a consequência é a decisão tetar em `indicator-only`**: a pré-inscrição declara **um** corte sobre **uma** base, logo `evaluate` chega ao gate com `visualActionAvailable: false`, `action.available` reprova e `failedAction` tem exatamente esse membro. Nenhum gate de ação é membro de `multiplicity.primaryFamily`, então isso não gasta alpha nem move `m`. O limiar visual do artefato congelado vive na escala calibrada e lê-lo aqui compararia número de uma escala com escore de outra | código |
| o **perfil servido carrega o mesmo corte que a medição**: `profile-artifact.ts` publica `documentIndicator` = limiar pré-inscrito atrás de calibrador **`identity`** (kind novo de `SerializedCalibratorV1`, passagem direta — nenhum dos três anteriores é a identidade), com `localizedIndicator` e `documentAction` no **`DISABLED_THRESHOLD`** (1). `assertServedCutIsTheMeasuredCut` **recusa** a publicação se o calibrador não for a identidade, se o limiar divergir do medido, se `localizedIndicator`/`documentAction` não estiverem no desligado, ou se o artefato de limiar estiver ligado a outro dataset/split/avaliador | código |
| **o desligado é verificável e não convencional**: o contrato exporta `thresholdFires(score, threshold)` = `threshold < 1 && score >= threshold`, e `src/inference/calibration.ts` compara os três limiares por ele. Medido: o escore localizado é o **máximo** sobre softmaxes de janela e um softmax saturado é exatamente 1,0, então `localizedScore >= 1` disparava — o runtime podia levantar `LOCALIZED_SIGNAL` num caminho cujo FPR a medição não estimou. A colisão que o encoding cria (um corte MEDIDO valendo 1) é recusada na publicação por `PROFILE_CUT_AT_DISABLED_SENTINEL` | código |
| opt-in **desligado por padrão**; disclosure persistente em cada resultado; nenhum rótulo de autoria nem confiança numérica | OP |
| proibição de uso disciplinar, acadêmico, empregatício ou decisório; não iniciar acusação formal com base no sinal; revisão humana não salva sinal não validado — exige evidência independente do processo | OP |
| os pesos viajam com a mesma política de uso — a copy da extensão não acompanha pesos extraídos | OP |
| backbone **`neuralmind/bert-base-portuguese-cased`** (BERTimbau base), `backboneBakeOff: false` — a escolha é por literatura e pela forma do pipeline, **não** por comparação de qualidade sobre os nossos dados, e nenhuma vantagem de detecção foi medida. `train_detector.py` recusa `--model` e `--seed` divergentes **em `main()`**; `export_onnx.py` recusa checkpoint que divirja em qualquer um dos **oito** campos da forma selada (`model_type`, `vocab_size` 29 794, `hidden_size`, `num_hidden_layers`, `intermediate_size`, `num_attention_heads`, `max_position_embeddings`, `type_vocab_size`) e grafo cujas entradas não sejam exatamente `input_ids`/`attention_mask`/`token_type_ids`. Os **quatro primeiros não identificam** o modelo — um BERT 12×768 de vocabulário 29 794 com `intermediate_size: 16` passa por eles, exporta limpo e fica mais abaixo do teto —, e a forma de oito campos é transcrita da **testemunha** `public/models/cleanfeed-ptbr-v1/config.json`, cujo `sha256` os dois descritores rastreados declaram. O `vocab_size` é conferido no **arquivo**: `vocab.txt` tem de ter 29 794 entradas no checkpoint e no bundle | código |
| **a cabeça de classificação é lida do artefato, e nada disso prova treino**: o export exige `architectures == ["BertForSequenceClassification"]`, `id2label` **exatamente** na ordem selada (`{0: human, 1: ai}`, que `train_detector.py` grava e `scripts/package-own-model.mjs` estampa — o par anônimo `LABEL_0`/`LABEL_1` é recusado porque o produtor selado não o escreve) e **ausência de `classifier.*` e de `bert.pooler.*`** em `missing_keys`/`mismatched_keys` do carregamento — `AutoModelForSequenceClassification` carrega um checkpoint sem cabeça, constrói o classificador ao AZAR e apenas avisa, e o pooler alimenta o classificador, então inventá-lo entrega entrada aleatória a uma cabeça treinada. A prova de que a cabeça foi TREINADA é o recibo F6 ligando corpus, split, política, seed e hash dos pesos, e ela não existe (§ 7) | código |
| a leitura da pré-inscrição no lab passa por **um** parser fechado (`benchmark/lab/sealed_policy.py`, importado pelos dois scripts do Colab): pina `policyVersion`, pina o **`sha256` do arquivo** (`SEALED_POLICY_SHA256`), exige os quatro valores que o lab consome e recusa nomeando campo, path e digest. `json.loads` não é parse — `rebuild-v3-policy.json` está na árvore, tem `backbone` e teto, e era aceito. Nomear os campos também não é identidade: medido, uma cópia com a versão selada, `seeds.publishableCheckpoint: 42` e teto 340 000 000 era **aceita** e a guarda de seed comparava 42 com 42. `policyVersion` não se move quando a pré-inscrição é emendada, então emendá-la obriga a reescrever o literal no mesmo commit — um teste do lab compara os dois. `--model`/`--seed` deixaram de ter default tirado da política: ausentes são DELEGADOS e impressos como tal, presentes são conferidos. Cada corrida imprime e **grava no recibo** (`metrics.json`, `parity_report.json`) path, `sha256` e `policyOrigin` (`tracked`/`beside-the-script`/`explicit-path` — o marcador diz onde, o digest diz o quê) | código |
| teto de export int8 **130 000 000** bytes (`onnxMaximumInt8Bytes`) — **teto, não alvo**, ancorado num export int8 real desta arquitetura de **109 681 931** bytes (fora do repositório, com `parity_report.json`: 120 amostras, `meanAbsDelta` 0,000595, 0 inversões; o mesmo número rastreado com `sha256` em `models/cleanfeed-ptbr-v1/source-lock.json` e `cleanfeed-model.json`, onde um teste o confere contra o teto), com **18,5 % de folga declarada sobre o MEDIDO** (não sobre o teto: 130 000 000 é 1,1852 × 109 681 931; lido com o teto como denominador dá 15,63 %) para opset (o artefato ancorante é opset 18; o fallback do exportador emite 14), configuração de quantização e forma da cabeça | código |
| **nada é escrito no caminho canônico antes de todas as guardas aceitarem**: `export_onnx.py` monta o bundle inteiro em `<out>.staging`, roda teto, vocabulário, forma do grafo, tokenizer e paridade lá, e só então promove diretório **e** ZIP. A publicação anterior (diretório e ZIP) é removida no começo da corrida e a remoção é impressa — `zipfile.ZipFile(…, "w")` só trunca se a execução chegar até ele, então uma recusa deixava o ZIP aprovado da corrida A ao lado do diretório rejeitado da corrida B | código |
| **o que pode ser apagado é estreito, e a largura era caminho destrutivo NOVO**: só diretório com os **dois** marcadores deste exportador (`onnx/model_int8.onnx` **e** `parity_report.json`) ou vazio é removido; diretório com arquivo de checkpoint (`model.safetensors`, `pytorch_model.bin`, `training_args.bin`, `optimizer.pt`, `scheduler.pt`, `trainer_state.json`) é recusado nomeando o arquivo; `--out` igual, dentro ou contendo `--checkpoint` recusa antes de qualquer remoção; `<out>.staging` é reconhecido por membro de bundle ou pelo scratch `_fp32`; arquivo no caminho do ZIP que não seja ZIP recusa. Medido: um `save_pretrained` deixa cinco dos sete nomes do bundle, então `--out bertimbau/best` era reconhecido como publicação anterior e apagava os pesos treinados — e o código anterior nunca apagava `--out` | código |
| **as guardas do carregamento rodam onde o fluxo passa, não dentro da metade torch**: `main(argv, build_backend)` recebe a fábrica do backend, e `loading_info()`/`tokenizer_inputs()` entram pelo protocolo, então oito testes dirigem `main()` com um backend falso. Medido antes: comentar a guarda da cabeça, montar em `args.out` em vez do staging, ou comentar a asserção do tokenizer deixavam a suíte **verde** — o único teste dessas ligações era `assertIn` sobre o texto de `main()`, e linha comentada contém o texto | código |
| **paridade é verificação de autoconsistência, não de validade, e um modelo degenerado a MAXIMIZA**: o gate recusa quando o **intervalo interquartil** do escore sobre a amostra não supera a própria tolerância dos deltas (0,02), e o relatório publica os dois interquartis mais as duas amplitudes. Medido (§ 5.9): cabeça de duas classes zerada devolve logito `[0,0]` para todo texto, `P(ai)` exatamente 0,5, `meanAbsDelta` 0, zero inversões — e o veredito era `pass: true`. A estatística é interquartil porque **um** documento em 120 derrubava a amplitude: 119 escores em 0,5 e um em 0,9 dão amplitude 0,4 e passavam | código |
| **a amostra de paridade é BALANCEADA entre as duas classes**, espaçada pelo arquivo inteiro, e `parity_report.json` publica `sampleLabelCounts`. Medido: `dev.jsonl` é agrupado (4 118 linhas — `label` 0 nas posições 0 a 2 639, `label` 1 nas 2 640 a 4 117), então as 120 **primeiras**, que era o default do runbook, são de uma classe só — e sobre uma classe o escore de um detector confiante é tão achatado quanto o de um constante, logo o piso recusaria o export legítimo. Arquivo de uma classe só, linha sem `label` e `label` fora de `{0,1}` recusam nomeando a linha | código |
| treino: **cross-entropy + seed `712019` pré-fixadas, sem ablação** (adamw, 3 épocas, lr 2 × 10⁻⁵, 16 documentos por batch, warmup 0,06, weight decay 0,01); segunda corrida só como retry técnico, nunca seleção | OP |
| **sem calibrador probabilístico na v1** (`threshold.probabilisticCalibrator: "none"`): o corte publicado é o **limiar provisório `provisional-v1`** — quantil 0,95 superior de `document-raw-score` sobre os negativos humanos de `dev` + `cal-A` —, versionado, jamais descrito como "conservador", "alta confiança" ou probabilidade. Ele **DECIDE**: `buildEvaluationItem` compara `documentRawScore >=` esse limiar, `documentScore` é o escore cru sem transformação e `metrics.release.thresholdSource` é `preregistered-provisional-threshold`. `evaluate` **parseia** `provisional-threshold.json` (parser de forma fechado, recusa nomeando o path) e o confere contra os **sete** digests de governança — todos tirados do **selo** (`frozen.predictionManifestDigests` e não os manifestos recomputados, que é o que torna a ligação transitiva) — e a mesma conferência roda em `consume-holdout` **antes da lease**, no trecho de pré-exposição: corte truncado recusa sem nenhum evento no ledger, sem marcador e sem shard | OP |
| o gate de calibração mede **ECE-15 sobre o mesmo `document-raw-score`**, em bins de massa igual, com limite superior simultâneo por bootstrap e `eceMax` 0,05 — e agora é o escore que o caminho certificador realmente produz, então `score-basis-mismatch` deixou de ser inevitável: um corpo conforme alcança veredito nessa hipótese. Antes o gate reprovava **por construção** em toda corrida certificadora | código |
| a base que o gate compara é **medida, não declarada**: `measuredCalibrationScoreBasis(cut, rows)` devolve `cut.basis` só quando todo item pontuado tem `documentScore === prediction.documentRawScore` byte a byte, e `document-calibrated-score` no primeiro passo representável de diferença. Uma constante — inclusive uma lida da própria política — continuaria declarando a base certa depois de alguém recalibrar dentro de `buildEvaluationItem`, e o detector compararia a hipótese consigo mesma | código |
| calibrador probabilístico e conformal ficam **reservados à v2** (`calibrator.reservedFor`, `conformal.reservedFor`). O `fit` **continua** ajustando os dois calibradores de caminho e selando a evidência de seleção — é insumo da v2, congelado antes do bloco cego —, e nenhum consumidor os lê para decidir: `frozen.calibrators` e `frozen.thresholds` não alcançam mais medição nem perfil servido, e `applyFrozenCalibration` — a função que decidia por limiar calibrado e não tinha chamador de produção — foi **removida** | código |
| probe adversarial de FPR: **v2** | OP |
| datasheet = **seção do model card**, não artefato separado | OP |
| o relatório publica **FPR por faixa de comprimento** (`## FPR por faixa de comprimento (diagnóstico)`), uma linha por faixa **pré-inscrita** com negativos humanos, decididos, falsos positivos, FPR, o `n` esperado e o teto naquele `n`. A tabela é construída da lista congelada e não dos dados, então **faixa vazia aparece como vazia**; faixa sem linha decidida publica FPR `null` e nunca 0. A razão: texto curto provavelmente LISONJEIA o FPR — pouco sinal, mais hesitação, menos disparo —, então um teto honesto sobre a célula pode não TRANSFERIR para quem analisa 600 palavras | código |
| a distribuição de comprimento do texto **gerado** casa a humana **medida**, por par: `generate_ai.target_word_count` pede o comprimento da própria semente humana, sem clamp, e recusa semente fora da janela do extrator (`SeedLengthOutOfWindow`) abortando a lane — semente fora da janela é fato do arquivo, não do item. As **duas** drivers de geração pedem pela mesma função (`codex_batch.chunk_prompt` chama `target_word_count`), porque `generationLane` é eixo de agrupamento e uma lane clampada faria do comprimento um proxy da lane. O pareamento vale até o fim do transporte: o orçamento de saída da lane REST **escala com o alvo** (`max_output_tokens`, 2,0 tokens por palavra mais margem — orçamento fixo é clamp do outro lado do transporte) e resposta com `finishReason` diferente de `STOP` é **recusada**, como `GEMINI_INCOMPLETE` já fazia na lane CLI. A guarda é medida em `main()` dirigido, não só na função. O critério de reprovação é a sonda de comprimento lida na **tabela de faixas e nos extremos**, nunca na AUC dela | código |
| reserva dedicada de segunda tentativa: **fora do escopo da v1** — o valor congelado `2` permanece (F0-8), a divergência é declarada | OP |
| gate interno de não degeneração em `dev + cal-A`; **valores observados não publicados** (R8) | OP |
| a v1 publica somente **commitments agregados** (`datasetDigest`, `splitDigest`, instante, contagens não reconstruíveis); seed, assignments e hashes por registro só saem **depois** da medição v2 | OP |
| **não** publicar o universo candidato reproduzível; **não** publicar relatório externo sobre o mesmo candidato antes da v2 | OP |

### 3.6 Licença

| # | vigente | quem |
|---|---|---|
| posição (a) | as obrigações das fontes regem aquisição, preparação e uso do **corpus**, e não se propagam aos pesos. NC é política própria. **Não é consenso jurídico** | OP |
| F0-1 | licença dos pesos: `cleanfeed-weights-nc-1.0`, família OpenRAIL-M | AG |
| F0-2 | restrição comercial só nos pesos; código MIT | AG |
| F0-3 | documentação e evidência sob CC BY 4.0 | AG |
| F0-4 | `license-review.json` está `pending`: `status`, `reviewer` e `reviewedAt` são do operador e esperam o **pacote da Fase 6**, porque `models/cleanfeed-ptbr-v1/` é o layout antigo e os arquivos legais dos bundles servidos (§ 7) são consertados lá — aprovar antes assinaria pacote com arquivo legal sabidamente errado | AG |
| B1 | o **ramo** está escolhido: **risco assumido por escrito**, não parecer jurídico. Isso **não** é a assinatura, que continua aberta (§ 4) — e é o ramo que retira o prazo de terceiro e o gasto acima do envelope de A6 do caminho até a publicação | OP |
| B2 | pesos sob NC + proibição de uso disciplinar, acadêmico, empregatício e decisório | OP |
| B4 | GitHub para código e evidência; Hugging Face **gated** para pesos | AG · ratificar |

### 3.7 Processo

| # | vigente | quem |
|---|---|---|
| | **decidir–registrar–ratificar**: o agente decide ancorado no escopo, registra com razão e custo de reversão, e não para. Ratificação obrigatória só antes de marco irreversível | OP |
| | a **fila de endurecimento permanece parada** até o artefato principal existir; nenhum documento de plano além do plano único de entrega do modelo | OP |
| | **nunca delegado**: D0; risco jurídico pessoal (B1); calendário; apertar botão de publicação externa; ler `test`/`cal-B`/ledger real; dinheiro além de R$60/mês | OP |
| | **três etapas por unidade** no caminho selado: verificação de desenho antes do código · implementação contra o contrato · cross-review adversarial. Fora do selado, uma rodada | OP |
| | a etapa 3 é do **Fable** enquanto a janela de cota do codex estiver **fechada**, e rodada do Fable **não** fecha dívida de codex. A cota é janela **recorrente**, não um evento único: ela abriu em 8 de agosto, foi gasta em 9 de agosto (dez chamadas, **3.102.744** tokens, oito vereditos com `EXIT=0`) e fechou de novo no meio da própria rodada, com retorno impresso para 16 de agosto. Então "o crédito voltou" **não** quita nada por si: quem quita é a corrida que roda, unidade por unidade, e o livro-caixa de qual unidade caiu em qual janela é o que § 4 nomeia | OP |
| A5 | revisão adversarial em caminho selado, uma rodada no resto | OP |
| | guarda nova exige **prova por mutação**: linha de base verde, mutação, vermelho no teste nomeado, restauração e conferência byte a byte | OP |
| | toda decisão metodológica entra em `references.md` no mesmo commit, com link; sem precedente na literatura, a declaração explícita entra no lugar | OP |
| A6 | Colab Pro até R$60/mês | OP |
| A7 | rajadas pelo rate limit; teto semanal bateu, a fila pausa e retoma | AG |
| B5 | mismatch pós-exposição é terminal | AG · ratificar |
| F0-7 | `access-terms-unresolved` abaixo da rota, acima da licença | AG |
| | bancada em TypeScript, lab em Python | AG |

### 3.8 Invioláveis

| vigente |
|---|
| **nunca** ler `test`, `test-labels.jsonl`, nem nada sob `private/`. Calcular sha256 do ledger é permitido; escrever, não |
| **nunca** rodar `consume-holdout` de verdade |
| commits exigem `--no-verify` |
| `git ls-files --eol \| grep w/crlf` sai vazio |
| **`EVALUATOR_FILES` em JSON não se edita por Python.** Os bytes são a identidade do avaliador, e a autoridade de formato é o Node — `preregistration-v4.test.ts` ("is stored in canonical JSON") compara o arquivo com `JSON.stringify(canonical, null, 2)`, e o arquivo está em `.prettierignore` justamente para não ter dois formatadores. `json.dumps` do Python escreve número em outra representação: medido, um round-trip trocou `learningRate` de `0.00002` para `2e-05` e corrompeu um campo que a edição não tocava. É pior que a armadilha do CRLF, porque o CRLF tem `git ls-files --eol` a vigiar a árvore inteira e este só tem o teste canônico, que dispara **depois** de a corrupção estar escrita |
| comentário no código: só regra de domínio, restrição técnica não óbvia, ou armadilha de biblioteca |
| `node --experimental-strip-types` apaga tipos: parameter properties não funcionam na CLI |

---

## 4. Abertas — só o operador

| decisão | trava |
|---|---|
| **B1** — o **ramo** está escolhido: **risco assumido por escrito**, não parecer jurídico. Falta a **assinatura** — nome, data e a razão de assumir em vez de consultar —, que é do operador e espera o pacote da Fase 6 | publicação de pesos (Fase 7); `license-review.json` → `approved` |
| **`consume-holdout`** — o botão irreversível da medição | Fase 5 |
| a **razão** da cota `mixed = 2000`. O número é comparado por igualdade exata em `sealDataset` e é herança de um plano apagado (escrito em 2026-07-19, commit `dc02262`, como bullet de invariante **sem derivação**); a ratificação de 2026-08-04 cobre a razão do número do `ai` e deixou a coluna "alternativa recusada" vazia. Gerar a classe mista **gasta** essa cota, e gastar cota é nunca delegado — ratificar a razão, ou mandá-la de volta | antes de gerar a classe mista |
| **gastar a cota de geração**, e agora ela é a única porta em pé: os dois slates servem o plano — 40 identidades de geração e 60 de mistura — e `island_plan` aceita toda ilha nas DUAS pistas, então nada em código barra uma corrida além da chave de API. Vencem **antes** desta, e são três: nesta tabela, a **razão** da cota `mixed = 2000` e o **nível de gerador** da classe mista; na § 7, a emenda da `proxyReason` selada | antes de gerar as classes `ai` e `mixed` |
| o **nível de gerador da classe mista**. A exceção que U4 registrou dissolveu-se, a pergunta não: `mixed.levels` é `humanSeed × promptTemplate` e nenhum nível de gerador aparece nela. Mudar isso move o `evaluatorDigest` e obriga a repinar `SEALED_POLICY_SHA256` no mesmo commit, então é decisão a tomar **antes** e não depois | antes de gerar a classe mista |
| **como satisfazer o recibo humano que o selo de release exige, sob a auditoria amostral que ele mesmo decidiu.** Medido: `sealDataset` recusa com `DATASET_REVIEW_INVALID` um corpus `release` em que **qualquer** registro não sustente alegação de revisão, e o comentário do sítio declara que o desfecho é intencional — os 10.000 registros do corpus morto declaravam `agreement: "agree"` e uma auditoria de PII que nunca houve, e `reviewOf` lê todos como `automated/unreviewed`. O montador **proíbe-se** de produzir recibo (`NO_HUMAN_AUDIT`, com um "DO NOT ADD A RECEIPT BUILDER HERE" escrito), porque quem escreve toda linha é o único que teria os meios de fabricá-lo. `automated/unreviewed` é legítimo e sela `infrastructure-only`; o que ele não pode é sustentar alegação de que alguém olhou. Isso colide com R4 (§ 3.3), que é decisão **dele**: auditoria amostral, sem `passed` por registro. As duas pontas são dele, e reconciliá-las custa horas de revisão humana — ou o selo de release é inalcançável | Fase 3, antes do primeiro selo `release`; hoje nenhum corpus chega lá |
| re-rodar ou não o codex nas unidades do caminho selado que carregam **só** revisão do Fable. O conjunto é **R1** e **R2** (2026-08-10), que nasceram com a janela de cota já fechada; estão nomeadas aqui porque os únicos artefatos que as nomeiam vivem em `.codex-reviews/`, que o `.gitignore` cobre. Rodada do Fable **não** quita dívida de codex (§ 3.7) | próxima janela de cota **e** decisão do operador de gastar nelas em vez de em outra rodada |

---

## 5. Números medidos

### 5.1 Material em disco

Medido em 2026-08-04. Onde esta tabela e § 5.5 discordam sobre a mesma tipologia — *judicial branch*
38.189 aqui contra 38.187 lá, *social media* 8.863 contra 8.862 —, **vale o número de § 5.5**: lá a
contagem é por header de documento lido, e é a que § 2, o registro, `benchmark/source-manifest.ts` e
`benchmark/lab/extract_carolina.py` citam. A diferença de uma ou duas unidades **não foi atribuída a uma
causa medida**, e não vale a pena medir: o material está fora da moldura.

| tipologia | MB | documentos |
|---|---:|---:|
| Carolina *judicial branch* | 994 | 38.189 |
| Carolina *university domains* | 169 | 26.409 |
| Carolina *social media* | 51 | 8.863 |
| Carolina *legislative branch* | 4.477 | 3.982 |
| Carolina *public domain works* | 4,7 | 26 |
| Carolina *wikis* | 5.587 | — |
| Carolina *datasets and other corpora* | 4.519 | — |
| Wikipédia pt, dump 2022-03-01 | 1.960 | — |
| B2W-Reviews01 | 49 | — |
| Stack Overflow pt (`Posts.xml`) | 784 | — |
| Madras `train-00017` (classe IA) | 263 | — |

Megabyte não é a unidade: *legislative branch* rende 0,89 documento por megabyte.

Os dois lotes de aquisição, medidos em 2026-08-04 e reconferidos em 2026-08-05:

| lote | arquivo | bytes | sha256 |
|---|---|---:|---|
| `smb_ptwiki-20220301` | `ptwiki-20220301-pages-articles.xml.bz2` | 1.955.910.144 | `70c9ec4f700205ab586ab86dd21a5fe62fc543a5341770c84a28c343225f8b52` |
| `smb_carolina-2_0-bea` | `archive.zip` | 3.131.075.648 | `3fde823cc3abe9521d2bff119732f1c0bce52bf8ccc15cc893fba5f7531dbc19` |

Versão da Carolina, medida no header TEI dos **46** arquivos das três tipologias que estiveram na moldura
(2026-08-05): `Version 2.0 (Bea)` em 46/46 e `xml-model` apontando para `v2.0/corpus/schema.rng` em 46/46,
zero divergência. Janela de aquisição pontual (`startedAt === endedAt`), ancorada no mtime dos arquivos:
ptwiki `1784753446707`, carolina `1784752441472`.

Dos dois, só `smb_ptwiki-20220301` é lote de material **em moldura**, e é o único que tem produtor: ele
está em `DECLARED_MATERIAL_BATCHES` e `group_axes.material_batch_id("ptwiki-20220301")` deriva a mesma
grafia. O da Carolina permanece medido e declarado, com a fonte em `OUT_OF_FRAME_HUMAN_SOURCES`, e o nome
`smb_carolina-2_0-bea` acima é **de documento e de nenhum código**: `extract_carolina.py` derivaria
`smb_carolina-v2_0` do seu `--snapshot-version carolina-v2.0`. Custo zero enquanto a fonte está fora da
moldura, e a grafia que vale numa readmissão é a que o extrator deriva.

### 5.1b A população da célula, medida na EXTRAÇÃO REAL (2026-08-06)

Medido por `extract_wikipedia.py --limit 4100 --sample-rate 40 --snapshot-version ptwiki-20220301`
sobre `ptwiki-20220301-pages-articles.xml.bz2`, lido até o extrator encher a cota. É a corrida do
runbook, não uma varredura espelhada: os números saem de `wikipedia_fresh.stats.json`.

| quantidade | valor |
|---|---:|
| artigos oferecidos ao filtro (`scanned`) | 394.414 |
| derrubados pela janela de palavras (`< 50` ou `> 5.000`) | 231.441 |
| derrubados por PII (13 email · 9 handle · 8 cnpj · 12 phone) | 39 |
| derrubados pelo corte de data | **0** — o dump é de 2022-03-01, inteiro pré-ChatGPT |
| **admissíveis antes da amostragem** | **162.934** — 41,3 % dos artigos |
| tirados pela amostragem determinística de 1 em 40 | 158.834 |
| **escritos no pool** | **4.100** (cota de 4.000 mais 100 de margem) |

Palavras das 4.000 linhas do corpo: **p10=56 · p25=70 · p50=106 · p75=176 · p90=282 · máx=2.256**, média
144,9 e mínimo 50. O quantil é o elemento de **índice `⌊q·n⌋`** da lista ordenada 0-indexada, e a
convenção está escrita porque **só p90 depende dela**: medido, `w[3600] = 282`, o *nearest-rank* dá **281**
e a interpolação linear **281,1** — os outros quatro valores coincidem nas três convenções. Apenas **32 %**
têm ≥150 palavras e **8,5 %** têm ≥300. A coleta **não** filtra por comprimento: a população é "lead
sections da Wikipédia pt", em distribuição natural.

As quatro faixas pré-inscritas sobre o corpo de 4.000, por `lengthBandKeyOf` (a função de produção,
recebendo as faixas por parâmetro), com o `n` que o bloco cego de 800 linhas lhes reserva por maior
resto e o teto `1 − α^(1/n)` desse `n`. As parcelas exatas são **271,0 / 269,4 / 191,4 / 68,2**: os pisos
somam 799, sobra **uma** cadeira e os restos de `[80,149]` e `[150,299]` **empatam** em 0,4 — "maior resto"
sozinho não escolhe, e o desempate publicado dá a cadeira à faixa de **maior limite inferior**, que é a de
pior poder. A última coluna é o que a pré-inscrição **congelou**, e as duas não coincidem:

| faixa | linhas | fração | `n` a n=800 | teto medido | pré-inscrito `n` / teto |
|---|---:|---:|---:|---:|---:|
| [50,79] | 1.355 | 33,88 % | 271 | 1,60 % | 238 / 1,82 % |
| [80,149] | 1.347 | 33,67 % | 269 | 1,62 % | 239 / 1,82 % |
| [150,299] | 957 | 23,93 % | 192 | 2,26 % | 204 / 2,13 % |
| [300,+∞) | 341 | 8,53 % | **68** | **6,24 %** | 119 / 3,62 % |

**A faixa larga é mais estreita do que a pré-inscrição diz**, e a divergência é da POPULAÇÃO e não da
aritmética: 8,53 % de linhas com ≥300 palavras contra os 14,89 % que a política congelou. Os valores
congelados vieram de uma varredura das primeiras **60.000 páginas** do dump (46.110 artigos, 54,3 % de
admissão, p50=120, p90=362, máx=1.774) — um prefixo enviesado para artigo maduro e lede longa. A
amostra de 1 em 40 sobre 394.414 artigos derruba a admissão para 41,3 % e a mediana para 106. O parser
confere a soma contra `blindBlockLinesAtCollectionTarget` e cada teto contra o próprio `n`, **nunca** a
fração, então os quatro valores congelados são internamente consistentes e externamente errados
(dívida de § 7). Consequência concreta: o model card da Fase 6 imprimiria **3,62 %** para uma faixa que
a população realiza com 68 linhas e teto de **6,24 %**.

O corte 100 dos buckets antigos continua fora: sobre esta medição [80,99] tem **519** linhas, 12,97 % do
corpo, o que a n=800 daria faixa de **104** linhas (103,8 arredondado, leitura isolada e não parte do
rateio das quatro) e teto de **4,13 %** — pior poder que qualquer faixa da tabela vigente exceto a última.

### 5.2 Aritmética da cota

`1 − perHypothesisAlpha^(1/n)`, `perHypothesisAlpha` = 0,0125 (α = 0,05 sobre `m=4`). A coluna "linhas
coletadas" lê `partitionFractions.test` = 0,20.

| linhas em `test` | teto | linhas coletadas na célula |
|---:|---:|---:|
| 250 | 1,74 % | 1.250 |
| **300** (o piso) | **1,4501 %** | 1.500 |
| 350 | 1,2442 % | 1.750 |
| **800** (o alvo de coleta) | **0,5463 %** | 4.000 |

Os dois pontos em negrito são os que a pré-inscrição declara. Os outros dois valem como leitura da mesma
fórmula, não como valores congelados.

### 5.3 Medição de 25/07

Modelo **calibrado**, num limiar que o pacote atual não tem, sob a família `m=4` de então. Vale como
prova de que a aritmética fecha, não como resultado.

| estrato | FP / n | teto 98,75 % |
|---|---:|---:|
| Wikipédia | 0 / 800 | ≤ 0,55 % |
| Carolina institucional | 0 / 800 | ≤ 0,55 % |
| Carolina universitário | 20 / 745 | ≤ 4,34 % |
| B2W resenha | 57 / 800 | ≤ 9,43 % |

### 5.4 Pools em disco e o que a montagem faz com eles

Medido em 2026-08-05 sobre os pools de candidatos, por execução da montagem — exceto as duas linhas
marcadas **sonda**, medidas fora dela. As contagens de pool são fatos sobre o **disco**; o que a montagem
abre depois da emenda da moldura é só `wikipedia_fresh.jsonl` (5.000 linhas) mais os humanos reservados.

| fato | valor |
|---|---|
| candidatos nos pools, depois da dedup | 13.887 (`human` 7.704 · `ai` 4.048 · `mixed` 2.135) |
| pool humano que `load_humans` **abre** | `wikipedia_fresh.jsonl` — 5.000 linhas. `carolina_fresh.jsonl`, `b2w_fresh.jsonl` e `ptso_fresh.jsonl` não são abertos, e o filtro por `REGISTER` derruba a linha Carolina que chega pelo pool reservado |
| duplicata exata ou quase-duplicata do corpus morto | **8.133 dos 13.880 telados** (59 %); maior similaridade mantida 0,534. 13.880 e não 13.887 porque a poda **intra-pool** de quase-duplicata roda antes e colapsa 6 agrupamentos, tirando 7 linhas |
| artefato de índice de vistos | `benchmark/data/seen-index.v2.jsonl` — 10.000 documentos, 3.323.576 chaves de shingle, digest do corpus indexado pinado em código |
| documentos de origem conhecidos na célula | **0** — nenhuma linha de `wikipedia_fresh.jsonl` carrega `groupAxes`, então a montagem de release recusa em `CellBelowOriginDocumentFloor` antes da seleção |
| linhas geradas com ao menos uma detecção de artefato (**sonda**) | 148 de 4.048 (**3,656 %**) no pool `ai` — agregado de sonda, **não** veredito do gate: o teto de 2 % é comparado **por família geradora**, e a única família acima dele é `madras_synthetic_corpusqwn`, 146 de 150 (97,33 %), que `EXCLUDED_GENERATOR_FAMILIES` recusa por proveniência não registrada |
| veredito do gate antiartefato, no caminho da montagem | **nenhuma lane a regenerar, e por vacuidade.** Depois da poda global sobram 19 candidatos `ai` e 135 mistos, e os 154 são recusados em `MissingRecipe`/`UnmappableLane`: **0** registro gerado chega ao gate. Sem a poda global a montagem constrói 1.170 em 5 famílias, e aí o veredito **muda** com as dez detecções: **24 de 1.170** (2,05 %), `gemini-3_1-flash-lite` em **16/256 = 6,25 %** acima do teto → lane **`gemini-api` a regenerar**. Eram 0 de 1.170 com as **quatro** detecções de então, e a única que dispara é `markdown-formatting` |
| licenças por documento na Carolina em disco (**sonda**) | `cc-by-nc-sa-4.0` em 7.997 e `cc-by-sa-4.0` em 3 dos 8.000 de `carolina.jsonl`. A montagem não abre nenhum arquivo Carolina depois da emenda da moldura, então `SourceCarriesTwoLicenses` deixa de ser alcançável **por esta fonte**: a guarda fica, e a divida de esquema que ela abre (§ 7) não vence mais na Fase 3 |
| obrigações de licença que a moldura impõe | **`attribution` + `share-alike`**, de `cc-by-sa-4.0` na única fonte estocada. `non-commercial` chegava com `cc-by-nc-sa-4.0` da Carolina e **nenhuma licença em moldura o impõe hoje** — o regime NC sobrevive porque é decisão própria (`commercialUse: false`), que é exatamente o que a posição (a) afirma e agora não tem em que se apoiar |
| famílias geradoras nos pools | 23, somando 6.183 linhas (`POOL_GENERATOR_FAMILIES`) |
| as **dez** detecções do gate sobre as linhas de ARQUIVO de pool, sem dedup (2026-08-05) | união por linha: **0,809 %** em 11.000 humanas em moldura (ptwiki) · 9,71 % em 31.100 humanas fora de moldura · **49,07 %** em 19.673 `ai` · 10,30 % em 2.135 mistas varridas só nos vãos gerados. Denominador **diferente** dos 3,656 % acima, que são quatro detecções sobre os 4.048 candidatos `ai` **depois** da dedup |
| a detecção que separa | `markdown-formatting`: 0,11 % no humano em moldura contra **44,72 %** nas `ai` — ênfase `**…**` sozinha em 39,74 %. Depois dela, `heading-line` (0,06 % contra 20,72 %) |
| a detecção **invertida**, medida | `invisible-character`: 0,59 % no humano em moldura contra 0,02 % nas `ai`. Na célula ptwiki o invisível é marca do lado **humano** — vem da fonte wiki e nenhum extrator o remove —, então a detecção é guarda contra harness futuro, não descrição dos pools de hoje |
| espaço anômalo, e de onde vem | 0 de 11.000 linhas ptwiki e 0 de 19.673 `ai`, contra 185 de 2.135 vãos mistos (8,67 % corrida de espaço) e 113 (5,29 % espaço terminal): `make_mixed.emit` escreve `text: edited` cru, e todo pool escrito por `CandidateWriter.offer` passou por `common.normalize_text` |
| linhas mistas escrevíveis hoje | **0** — as 2.135 recusam, 1.898 em `MissingRecipe` (a linha não carrega o digest do template de mistura) e 237 em `UnmappableLane` (provedor fora das quatro lanes congeladas) |

A linha "documentos de origem conhecidos na célula" acima descreve o pool de 24/07, que § 5.4b substitui:
a extração de 2026-08-06 escreve `groupAxes` e o piso passa.

### 5.4b A célula extraída, a poda global medida e o corpo estampado (2026-08-06)

Pool novo em `benchmark/data/candidates-f3/wikipedia_fresh.jsonl` (4.100 linhas, § 5.1b). O corpo humano
que a auditoria e o preflight leram foi montado em `benchmark/data/corpus-build-f3` e **está retirado de
lá**: em `benchmark/data/` sobram só os dois arquivos de governança e a evidência de rótulo, que não
carregam pertença de bloco. A razão está abaixo, no parágrafo do carimbo. Tudo isso é gitignored por
desenho; o que o Git guarda é esta medição e o código que a produz.

**A perda pela poda global, que ninguém havia medido.** As linhas frescas são teladas contra o artefato
do corpus morto (10.000 documentos, 3.323.576 chaves de shingle, `sha256`
`595739107e895cfc7b09409f29c13b998d195e921f1ca7eec1e5c8406772116a` conferido no cabeçalho), por
`near_dupes.drop_seen_against` — nenhum token do material morto é lido:

| quantidade | valor |
|---|---:|
| linhas frescas teladas | 4.100 |
| casam por **hash exato** de conteúdo tokenizado | **0** |
| casam por **Jaccard ≥ 0,82** sobre chaves de shingle de 5 tokens | **2** |
| perda total | **2** — 0,049 % |
| sobrevivem | 4.098, contra a cota de 4.000 |
| **maior similaridade MANTIDA** | **0,81** |
| pares candidatos avaliados · buckets acima do teto antigo | 25.151 · 174 |

A perda esperada era irrelevante e é: 0,049 %, contra o limite superior que o plano derivava da fatia de
Wikipédia das ~1.600 linhas humanas do corpus morto. **O 0,81 é a leitura que importa** e é o que o
runbook manda olhar: uma linha fica um centésimo abaixo da barra de recusa, que é o comportamento
esperado de reextrair a mesma fonte — a mesma página noutra revisão volta com edições pequenas. Não é
folga; é a barra funcionando no limite, e é a razão de a margem de coleta existir.

**A margem de coleta não é folga contábil, e isso está medido:** as **três** linhas frescas que as podas
derrubam estão nas posições **245** (poda intra-pool), **369** e **1.084** (poda global) do pool, em
contagem **1-indexada**, e as três **dentro** das primeiras 4.000. Como a amostragem é determinística sobre
a chave da página e a leitura é sequencial, as primeiras 4.000 linhas do pool são exatamente o que
`--limit 4000` teria escrito — então uma extração de 4.000 exatas entregaria **3.997** frescas e a
composição de release, que `sealDataset` compara por igualdade **exata**, ficaria **três** linhas curta. O
contrafactual foi rodado, não derivado da taxa de perda: o pipeline completo (`dedup` → `prune` →
`drop_seen_against`) sobre as 4.100 deixa **4.097** frescas e sobre as primeiras 4.000 deixa **3.997**.
Contar só as duas da poda global é a leitura que esquece a poda intra-pool (§ 6).

**O artefato de vistos não carrega texto claro, afirmado sobre os bytes do arquivo real** (36.425.322
bytes, e não sobre uma fixture): 10.000 linhas de documento, **0** com campo fora do conjunto fechado
(`content`, `shingles`), **0** com `content` que não seja hex de 64, **0** com caractere fora do alfabeto
base64 em `shingles`, e as chaves das linhas somam **3.323.576**, o que o cabeçalho declara. A
proveniência do cabeçalho tem só `lines`, `path` e `sha256`. A limpeza também é imposta por teste sobre um
artefato construído (`test_the_artifact_carries_no_clear_text`), e a varredura acima é a mesma afirmação
sobre o artefato que a montagem realmente usa.

**A união que o montador real tela**, medida rodando `assemble_corpus.py --candidates-dir
../data/candidates-f3`, que é onde os dois números do pool reservado se separam. `load_humans` devolve
**4.680** linhas — as 4.100 frescas mais **580** do pool reservado —, e a dedup exata por conteúdo
tokenizado derruba **66**, todas reservadas: o corpus morto de que o pool reservado vem foi construído da
mesma Wikipédia, a linha fresca entra primeiro e é a cópia reservada que sai. Daí os **4.614** (4.100 +
514), **4.613** depois da poda intra-pool (a linha derrubada é fresca) e **4.607** depois da poda global
(**6** derrubadas — 2 frescas, 4 reservadas —, **0** por hash exato, maior mantida **0,81**). As 514 do
pool reservado não carregam licença de documento nem eixo de origem, e a seleção por cota não chega a
elas: `balanced_humans` escolhe 4.000, todas frescas.

**O pool, na barreira que o piso de poder impõe antes da seleção:**

| quantidade | valor |
|---|---:|
| documentos de origem distintos **no pool** (`origin_documents_per_cell` sobre as 4.607 sobreviventes) | **4.097**, contra o piso de 300 (`samplingUnits`) |
| `assert_cells_can_meet_the_origin_document_floor` | passa |

Os 4.097 são a contagem do POOL, não do corpo: a função só conta origem `known`, então as 510 linhas
reservadas que sobrevivem não entram, e 4.097 é exatamente 4.100 menos as 3 frescas que as duas podas
tiraram. Confundir esta contagem com a do corpo estampado é ler a barreira como se fosse o resultado.

**O corpo estampado, pelas funções reais do montador:**

| quantidade | valor |
|---|---:|
| linhas selecionadas | 4.000 de uma cota de 4.000, **todas** frescas |
| documentos de origem distintos **no corpo** (`groups.source`) | **4.000**, com **1** linha por documento no máximo — o teto pré-inscrito de `maximumLinesPerOriginDocument` realizado com igualdade |
| registros recusados por `UnwritableInV3` | **0** |
| **componentes conexos por célula** | **4.000**, todos de tamanho 1 — contados pela `connected_components` do lab (sete eixos de valor compartilhado) e, independentemente, pelo `preflight-viability` sobre os `CONNECTIVITY_AXES` do TypeScript, que somam a linhagem de pai. Os dois chegam a 4.000 |
| famílias hard-negative etiquetadas | 20 linhas em cada uma das **seis** |
| `auditCorpusSources` (via `audit_sources.ts`) | `status=ready`, **0** motivos de bloqueio sobre 4.000 registros e 1 fonte. Contra um manifesto na forma **v1** — `schemaVersion: 1`, sem `materialBatches`, que é a forma que o § 3.3 do runbook ensina — o mesmo corpo devolve `status=blocked` com **4.000** `SOURCE_REFERENCE_MISSING`, um por linha humana: é o cenário exato que este item fecha, e é a dívida do runbook em § 7 |
| `preflight-viability` | **passa** nos dois escopos (corpo e classe `human`): maior e menor componente com 1 linha (0,03 %) contra `train` 45 % e `dev` 5 %, e imprime que passar é necessário e não suficiente |
| `sourceManifestDigest` do manifesto v2 escrito | `dfcd17cd01128f4c3b09eb9d89d19043a761d21ea712c107a2959560989cb812`, recomputado pela função de produção sobre o corpo do arquivo |

**Um corpo v4 não existe em disco sem carimbo de bloco, e é por isso que este foi retirado.** `schema.ts`
exige `createdAt` numérico em todo registro, e o **único** escritor desse campo é
`assemble_corpus.stamp_block`, que escreve o `BLOCK_TIME` da partição; `diagnostic_probes.partition_of`
lê exatamente esse campo e devolve a partição, porque a pertença é fato **derivado** e nunca campo do
registro. Logo um corpo que passe `parseBenchmarkDataset` — o que `preflight-viability` exige — carrega
pertença de bloco por construção: **medir o corpo estampado e não criar `test`/`cal-B` são objetivos
incompatíveis por desenho do esquema**, e não uma escolha do arnês.

O corpo montado em 2026-08-06 carregava, medido, **2.400** linhas nas três partições abertas e **1.600
postas de lado** nas duas cegas — o agregado que `open_partition_rows` publica, sem detalhamento por
partição cega. **Ele foi apagado de `benchmark/data/`** (com o `cluster-report.json`, cuja chave de fatia é
`partição/classe`), e o que fica é esta medição. Nenhum split foi congelado: o comando `split` não rodou,
não existe `split-artifact.json`, nada foi selado, nenhum evento entrou no ledger de exposição e nenhuma
partição cega **selada** foi lida. **Congelar o split é o item 3** da Fase 3, e é lá que a pertença de
bloco passa a ser um compromisso em vez de um carimbo descartável.

A montagem de **release** não completa nesta unidade, e a recusa é o gate funcionando:
`assemble_corpus.py` chega até a governança e para em **`HeldOutReserveEmpty`** — nenhuma família pode
ser declarada held-out e o manifesto selado recusa lista vazia. **A causa, sobre este pool, é que
`candidates-f3` não tem classe gerada nenhuma**: `load_ai` e `load_mixed` devolvem 0, e a mesma corrida
avisa que a classe mista está 2.000 linhas abaixo da cota. A classe gerada é o **item 2** da Fase 3. Sobre
o pool de 24/07 a recusa é a mesma com outra causa — lá existem linhas geradas e é a poda global que não
deixa nenhuma sobreviver (§ 5.4) —, e sem a poda global a montagem constrói 1.170 geradas e o gate
antiartefato manda a lane `gemini-api` para regeneração: três saídas, três recusas, todas corretas.

O corpo que a auditoria e o preflight leram foi montado por um arnês que chama as **mesmas** funções do
montador na mesma ordem (`load_humans`, `prune`, `drop_seen_against`,
`assert_cells_can_meet_the_origin_document_floor`, `balanced_humans`, `human_record`,
`tag_hard_negatives`, `assign_partitions`, `assert_stamped_corpus_is_splittable`), sobre a classe humana
só. O arnês não está na árvore, e essa é a mesma dívida de material das taxas de § 5.4 e § 5.7 — com a
diferença de que cada número desta seção foi reproduzido em 2026-08-06 pelas funções de produção
chamadas direto, sobre os artefatos em disco, e a montagem real foi re-rodada até a recusa. Os números de
**pool** seguem reproduzíveis do que ficou em disco; os do **corpo** exigem re-montar, e é a dívida de § 7.

### 5.5 Proveniência das tipologias da Carolina — a medição que tirou três células da moldura

Medido em 2026-08-05 sobre `snapshots/archive.zip`, **por header de documento** (nunca corpo). É esta
tabela que sustenta § 2: a unidade que os pisos exigem não existe no material, e a população que a
alegação nomearia não é a que o pacote amostra.

| tipologia | documentos | pré-corte | autores declarados | hosts |
|---|---:|---:|---:|---|
| *judicial branch* | 38.187 | 38.187 | **0** | 5, todos `*.stf.jus.br` (redir 31.713 · portal 4.241 · notícias 1.089 · stf 611 · 533 sem URL) |
| *university domains* | 26.409 | 26.409 | **0** | 1, `jornal.usp.br` |
| *social media* | 8.862 | 3.294 | 104 (o maior com 200 documentos) | 1, `wattpad.com` |

Duas consequências, e a segunda é a que decide: **unidades insuficientes** (104 contra o piso de 300 na
melhor das três; zero nas outras duas, porque sem autor a unidade cai no arquivo-membro, e a moldura tinha
37 / 7 / 2 arquivos-membro) e **população mal declarada** — publicar "FPR em texto judiciário" a partir do
STF, "em domínio universitário" a partir de um jornal e "em rede social" a partir de ficção do Wattpad é
over-claim que nenhum `n` conserta.

O contraste que sustenta a célula que fica: `extract_wikipedia.py` emite
`source = known("ptwiki_page_" + page_id)` — a **página** — e `author = not_applicable(NO_SINGLE_AUTHOR)`.
A unidade é a página, o piso de 300 é trivial, e o dump de 1,96 GB é a reserva.

### 5.6 Outros

| fato | valor |
|---|---|
| componentes independentes na célula, hoje | **4.000**, todos de tamanho 1, sobre o corpo estampado de 2026-08-06 (§ 5.4b) — a unidade é a PÁGINA (`groups.source = ptwiki_page_<page_id>`) e o piso de 300 fica 13,3× folgado. Era 1 enquanto o pool de 24/07 não carregava `groupAxes` |
| guardas de integridade do pacote | 11 exercitadas, 0 sem teste |
| `evaluatorDigest` da árvore | `df417705ee27e095cef53264e1bc3c480b3a92f532a6946025df57db0c1f78a6` — 52 arquivos, recomputado pela função de produção e **lido por teste nomeado** (`digests.test.ts`, "is published in the ESTADO at the value the LIVE tree hashes to"), então este número não pode envelhecer em silêncio. Mover é barato enquanto `issuedAt` é nulo |
| byte de controle cru em caminho rastreado | **zero**, e imposto por dois testes nomeados, com escopos diferentes de propósito. `digests.test.ts` ("carry no raw control byte, so no code-search tool can skip an evaluator file") varre os **52** de `EVALUATOR_FILES` e **não isenta nada**, porque os bytes desses arquivos são a identidade do avaliador. `tests/unit/repo/line-endings.test.ts` ("leaves no raw control byte in a tracked path the repo calls text") varre **todo** caminho de `git ls-files`, isentando só extensão que `.gitattributes` declara `binary` — nenhuma rastreada hoje, então na prática é a árvore inteira. Os dois recusam controle C0 fora de LF, TAB e CR e apontam `arquivo:linha:coluna` mais o offset de byte. A isenção **não** é a classificação `i/-text` do git: ela é causada pelo byte cru, e filtrar por ela pularia justamente o infrator |
| ledger de exposição real | **0 bytes** — nenhum evento real foi escrito |
| holdout-ledger real | 2.638 bytes — o consumo de 2026-07-25, `decision: reject` |
| memória da exposição por linha | `benchmark/data/corpus-build/out/split/split-artifact.json` — pertença de `test`, só o operador lê |
| referências | **492** marcadores de link em **25** seções de nível `##` de `references.md`, e **67** declarações literais de "Sem precedente encontrado". A regra é a ocorrência da junta `](` seguida de URL, contada **no arquivo inteiro e não por linha**: `references.md` quebra a ~100 colunas e 38 rótulos de link atravessam a quebra, então um regex `\[rótulo\]\(url\)` aplicado por linha devolve **454** — a diferença é exatamente os 38. Agora **lido por teste nomeado** (`estado-counts.test.ts`) — os valores anteriores (322 / 50, depois 349) envelheceram em silêncio exatamente porque nenhum teste os lia — e o número por linha envelheceu **também**, publicado como 437 quando a medição dava 449, porque o teste lê os três valores da junta e não esse |

### 5.7 Sondas diagnósticas sobre os pools em moldura (W3)

Medido em 2026-08-05 por

```
py -3.13 diagnostic_probes.py --pools ../data/candidates --in-frame-pools \
  --permutation-repeats 5 --out /tmp/probes.json
```

sobre **9.707** linhas de pool em moldura: 5.000 humanas de `wikipedia_fresh.jsonl`, 2.572 `ai` das **três**
lanes com material fresco, 2.135 mistas. `--in-frame-pools` é `IN_FRAME_POOLS`, os **9** arquivos da célula
publicada, e não é detalhe de conveniência: `--pools` sem restrição lê os 67.934 registros do diretório
inteiro, inclusive `ptso*` (bloqueado por nome, F0-6), `carolina*`/`b2w*` fora de moldura e a família OpenAI
reservada ao OOD. O relatório agora carrega `inputs.rowsPerFile`, então a qualificação "em moldura" é
verificável a partir do artefato e não só da prosa.

A **sonda 1 não rodou**: exige corpus com partições carimbadas, e o único que existe em disco é o morto —
derivar partição dele é ler pertença de bloco cego. Ela é exercitada por fixture e sua primeira corrida
real é a montagem da Fase 3.

**A quarta lane congelada não tem material gerado fresco.** As lanes medidas são `codex` (1.402 linhas),
`gemini-api` (751) e `agy` (419); de `fable` só existe `lane_parents_fable.jsonl`, com 60 pais humanos.
Isso é fato de Fase 3 e não erro de contagem: a leitura de que D13/W2 varreu as quatro lanes é falsa.

| sonda | quantidade | valor |
|---|---|---|
| comprimento (**diagnóstico**) | AUC fora de dobra | **0,5009**, e ao lado o rank AUC da contagem crua **0,5017**. As duas **não são a mesma quantidade e não têm de coincidir**: a primeira agrupa as predições fora de dobra de 5 modelos com 5 interceptos, e uma união de mapas monótonos não é monótona. Aqui diferem 8,6e-4 com os 5 coeficientes de mesmo sinal, que é ruído de amostragem; onde as dobras discordam de sinal a agrupada cai do outro lado do acaso, e há teste nomeado sobre a fixture que faz isso |
| comprimento | mediana de palavras | humano **102** · `ai` **90** |
| comprimento | fração `ai` por decil pooled | 0,21 · 0,59 · 0,40 · 0,29 · 0,28 · 0,23 · 0,20 · 0,15 · 0,43 · 0,57 — **AUC no acaso não é distribuição igual**: a gerada é bimodal DENTRO da faixa humana, e nenhuma domina estocasticamente a outra |
| lane dentro de `ai` (**diagnóstico**) | AUC macro um-contra-resto | **0,9713** sobre **três** lanes — `codex` 0,9911 (1.402 linhas) · `agy` 0,9696 (419) · `gemini-api` 0,9533 (751). Território de D13/W2: lane que um classificador nomeia entrega o rótulo de graça |
| estilometria (**diagnóstico**) | AUC fora de dobra, 19 features | **0,9853** sobre 7.572 linhas (5.000 humanas + 2.572 `ai`), seed 42 |
| estilometria | os seis maiores coeficientes | `hapax-rate` **+3,564** · `type-token-ratio` −3,273 · `parenthesis-rate` **−3,108** · `flesch-pt` −2,155 · `sentence-length-mean` −2,054 · `mtld` +1,988 |
| estilometria | importância por permutação (5 repetições) | `hapax-rate` **+0,191** de queda de AUC, depois `parenthesis-rate` +0,070 e `flesch-pt` +0,062 |
| viés ortográfico (**nunca feature**) | média POR DOCUMENTO dos acertos por 100 palavras | humano **0,00581** · `ai` **0,00083** — o lado humano carrega ~**7,0×** a taxa, então a feature seria proxy de "humano" e motor de falso positivo na população vigiada. A agregação está nomeada porque as duas dão números diferentes: agrupando acertos e palavras dos dois lados (37 acertos em 705.526 palavras humanas contra 2 em 402.068 geradas) a razão é 10,5×. O valor humano caiu de 0,00624 ao sair `ate` e `quiz` da lista de formas — as duas são palavra correta de pt-BR e inflavam justamente o lado humano |
| dispersão entre janelas (**diagnóstico**) | amplitude média do escore por janela, **sobre os documentos de mais de uma janela** | `mixed` **0,622** (n=66) · `human` 0,147 (n=78) · `ai` 0,185 (**n=4**). A manchete de 4× é `mixed` contra `human`; o valor de `ai` é média sobre **quatro** documentos e não sustenta leitura nenhuma |
| dispersão | documentos com UMA só janela | **9.559 de 9.707** (2.069/2.135 mistos · 4.922/5.000 humanos · 2.568/2.572 `ai`): a 510 tokens de janela o escore de documento **é** o de uma janela para a grande maioria das linhas |

### 5.7b O clamp de comprimento da geração, e a cegueira da AUC (2026-08-06)

Medido sobre a distribuição humana de § 5.1b, com 80 pares. A última coluna é o **comprimento
pedido** — propriedade do alvo e do fixture que o sintetiza, **não** do gerador, que não rodou; o que
o gerador entrega é guardado pela recusa de truncagem de § 3.5:

| alvo de comprimento pedido ao gerador | AUC de posto | faixa 50-59 | máximo pedido |
|---|---:|---|---:|
| o da própria semente (vigente) | **0,5000** exato | `aiShare` 0,500 | 1.774, igual ao humano |
| `max(60, min(n, 350))` (o que havia) | 0,5040 | `aiShare` **0,000** | **350** contra 1.774 |

O orçamento de saída da lane REST era `1024` tokens **constante**: a ~1,4-1,7 tokens por palavra de
prosa pt-BR isso corta por volta de 600 a 700 palavras, contra p90 = 362 e máximo 1.774 da população
medida — clamp do outro lado do transporte, e a truncagem entrava em silêncio porque `finishReason`
não era lido. Hoje o orçamento é `⌈2,0 × alvo⌉ + 256` e `finishReason` fora de `STOP` recusa o item.

O clamp é **invisível** a uma AUC monótona: ele prende a cauda curta para cima e a longa para baixo, e
as duas inversões de posto se cancelam. O que ele produz é uma faixa que nenhuma linha gerada alcança —
50 a 59 palavras é humano com certeza, rótulo de graça — e um máximo gerado preso no clamp. **Logo o
critério de reprovação da geração é a tabela de faixas da sonda e os extremos, não a AUC dela.**

O achado que não é sobre autoria: depois da diversidade lexical, o sinal mais carregado do modelo barato é
`parenthesis-rate` — a lede da Wikipédia pt é cheia de parênteses e o gerado não é. AUC 0,985 apoiada em
dispersão de vocabulário e na convenção parentética da fonte é **artefato de fonte** no sentido exato de
D19.

Nenhuma destas taxas é reproduzível de um checkout: os pools são gitignored (§ 7). A diferença em relação à
dívida que a W2 abriu é que o **medidor** agora está no repositório, com a invocação exata registrada acima
e a procedência do material dentro do próprio relatório.

### 5.8 As quatro sondas de tema, exercitadas contra o artefato ANTIGO (2026-08-07)

**Não é medição do modelo do produto.** Não existe modelo novo nem corpus selado: o treino é a Fase 4 e a
medição certificadora é a Fase 5. O que estas linhas medem é que os **instrumentos rodam e discriminam**,
exercitados contra o export int8 que existe fora do repositório
(`snapshots/cleanfeed-ptbr-v1/onnx/model_int8.onnx`, 109.681.931 bytes, BERTimbau `vocab_size` 29.794) e
contra os pools de `benchmark/data/candidates*`. O artefato antigo foi treinado no corpus **morto**, num
domínio misto, e seus escores são **saturados** — média 0,00070 no humano ptwiki contra 0,89572 nas linhas
`ai` —, então nenhuma leitura abaixo transfere para o modelo da Fase 4. `onnxruntime` não existe no
interpretador do lab (`py -3.13`); a pontuação roda em `python` 3.11, que o tem.

**Os comandos exatos, porque sem eles a tabela não é reprodutível.** A primeira versão desta seção publicou
uma tabela que a invocação documentada do módulo não produzia — `main()` tomava as linhas `ai` inteiras
contra apenas os pais pareados, e o pareamento do lado `ai` tinha sido feito à mão fora da árvore. Corrigido:
`main()` **filtra** as linhas `ai` pelos pais presentes em `--humans` e imprime quantas caíram.

```
py -3.13 baseline_tfidf.py --ai ../data/candidates/ai_fresh_*.jsonl \
  --humans ../data/candidates/wikipedia_fresh.jsonl \
  --reserved-family gpt-5_6-luna --detector-scores <scores.jsonl>
# dataset: 253 ai + 253 human (topic-paired; 2319 ai row(s) without a parent in --humans dropped)

py -3.13 entity_masking.py sample --humans ../data/candidates-f3/wikipedia_fresh.jsonl \
  --ai ../data/candidates/ai_fresh_{codex,gemini,gemini_multi}.jsonl --per-pool 60 --out <sample.jsonl>
py -3.13 entity_masking.py arms --rows <sample.jsonl> --out-dir <dir>
python score_pilot_local.py --model-dir <snapshot> --dataset <dir>/<braço>.jsonl \
  --output <dir>/scores_<braço>.jsonl --max-length 512
py -3.13 entity_masking.py read --scores <dir>/scores_*.jsonl --rows <sample.jsonl> \
  --masking <dir>/masking.json --out <report.json>
```

**Mascaramento de entidades.** 60 linhas humanas de `candidates-f3/wikipedia_fresh.jsonl` mais 180 linhas
`ai` das três lanes frescas que pareiam com ptwiki, 240 linhas × 3 braços = 720 passagens, semente
`theme-entity-masking-20260807`. Limiar de decisão 0,5 — o argmax da cabeça de dois logitos, **não** o corte
`provisional-v1`, que nenhum artefato deste repositório carrega.

| classe | n | palavras mascaradas | falta do placebo | escore original | `entity-masked` | `placebo-masked` | queda entidade | queda placebo | **excesso** | excesso de virada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ai` | 180 | **5,32 %** | 0 palavras / 0 linhas | 0,89572 | 0,90338 | 0,85935 | −0,00766 | +0,03637 | **−0,04403** | −0,01667 |
| `human` | 60 | **23,17 %** | **47 palavras / 5 linhas** (máx. 23) | 0,00070 | 0,00407 | 0,00552 | −0,00337 | −0,00482 | **+0,00145** | 0,0 |

Veredito **`survives`**, e a leitura que decide é a da linha **humana**, não a da `ai`: a classe `ai` destes
pools tem 5,32 % de palavras mascaradas — as linhas geradas em disco falam de produto, saúde e educação e
quase não carregam entidade nomeada —, então um `survives` lido nela é um `survives` sobre texto que quase
não foi perturbado, que é exactamente o que a coluna de fração existe para tornar visível. Na classe humana
o mascaramento **morde** (23,17 % das palavras) e o excesso sobre o placebo é **+0,00145**, um sexto do teto
de ruído medido do próprio pipeline (`maxAbsDelta` 0,008950 do relatório de paridade). E a direção do
placebo é a que carrega o argumento: mascarar palavras comuns minúsculas move o escore `ai` **4,7×** mais
(+0,03637) que mascarar toda entidade, data e numeral (−0,00766, que é uma **subida**). Neste artefato a
identidade das entidades vale menos que arredondamento int8.

**A coluna de falta do placebo, e por que ela está publicada.** `mask_placebo` calculava `shortfall` desde o
início e `read_masking` **não o lia**, embora o docstring dissesse "publicado em vez de silenciosamente
absorvido". Medido: a classe **humana** — a que o veredito reporta ao lado e a que a leitura designa como
decisiva — tem 47 palavras de falta em 5 das 60 linhas, uma delas 23 palavras contra 23 vãos de entidade. A
direção do viés está escrita no código: falta do placebo significa que o placebo removeu **menos** que o
braço de entidades, logo a queda do placebo está subestimada e o **excesso está superestimado** — o viés
aponta para `collapses`, que neste instrumento é o alarme e não a dispensa. O `+0,00145` da linha humana é,
se algo, generoso com a hipótese. `--masking` deixou de ser opcional e `read_masking` **recusa** um registro
pontuado sem entrada de mascaramento.

**A janela de 512 tokens é a mesma para os três braços em 231 das 240 linhas.** Medida com o tokenizador do
próprio snapshot: no braço original, 6 das 180 linhas `ai` e 3 das 60 humanas passam de 512 tokens
(médias 281,2 e 182,8; máximos 692 e 857). Como o mascaramento **encurta** (médias 270,4 e 157,4), nessas 9
linhas a janela do braço mascarado cobre mais documento que a do original e o delta não é "o mesmo texto
menos as entidades". `--max-length 512` está fixado no runbook e a contagem registrada aqui; corrigir de
verdade exige janelar por documento, que é outra unidade.

**O piso barato, decomposto — e o erro que a decomposição desfaz.** 253 linhas `ai` pareadas com ptwiki (108
da família reservada `gpt-5_6-luna`, 145 das *core* `gemini-3_5-flash-lite` e `gemini-3_1-flash-lite`) contra
os 253 pais humanos, 5 dobras estratificadas, semente 42:

| vetorização | AUC média | desvio entre dobras | lê conteúdo? |
|---|---:|---:|---|
| palavra (1,2) | 0,9327 | 0,0247 | sim |
| caractere (3,6) | 0,9319 | 0,0156 | sim |
| **`funcionais`** (lista fechada de 120 palavras) | **0,9313** | **0,0139** | **não — é o único piso cego a tema** |
| `estilometria` (19 features da W3) | 0,9712 | 0,0211 | sim, 7 das 19 |
| `funcionais+estilometria` (piso barato) | 0,9767 | 0,0179 | sim, pela estilometria |

**A leitura anterior desta tabela estava errada e a correção é o achado.** Publicou-se `cego-a-tema` 0,9749
"superando palavra e caractere, com as palavras de conteúdo estruturalmente barradas". Medido: o número era
da **união**, e `estilometria` sozinha reclama **98,8 %** da separação acima do acaso da união
((0,9712 − 0,5)/(0,9767 − 0,5)); o ramo de palavras funcionais acrescenta 0,0055 de AUC. Sete das 19 features
de `probes.STYLOMETRIC_FEATURES` são funções das palavras de conteúdo (`type-token-ratio`, `mtld`,
`trigram-repetition`, `hapax-rate`, `long-word-rate`, `word-length-mean`, `flesch-pt`) e `_stylometry_matrix`
recebe o texto **inteiro**, então "estruturalmente barradas" era falso. O piso genuinamente cego a tema é
`funcionais`, com **0,9313** — logo **abaixo** de palavra (0,9327) e de caractere (0,9319), não acima. E não
é "a mesma conclusão de § 5.7b por outro caminho": é o **mesmo** caminho, as mesmas features a que § 5.7b
atribuiu a AUC 0,985.

O que sobra medido, e é bastante: um modelo linear que lê **só 120 palavras funcionais** separa este material
com AUC 0,93, empatando com as duas vetorizações que leem conteúdo. No enquadramento de D19 continua a não
ser boa notícia — é artefato de fonte —, mas o limite que se pode publicar é o de `funcionais`, e a diferença
até o modelo grande é o máximo que poderia ser temático **por esse número**, não pelo da união.

Duas correções de instrumento vieram com a medição. O `token_pattern` default do sklearn é
`(?u)\b\w\w+\b` e descarta todo token de um caractere, então `a`, `e`, `o`, `à` e `é` estavam no
vocabulário com massa **zero permanente** — as três palavras mais frequentes do pt-BR, e exactamente o
material que Mosteller & Wallace contam. Custo medido: o ramo lia 0,8944 em vez de 0,9313. E a guarda de
"nenhuma palavra de conteúdo" era uma **lista negra** de 42 itens: medido, `brasil` declarado funcional
passava pelas duas guardas e chegava ao vocabulário ajustado. Substituída por igualdade de conjuntos contra
um inventário de 120 palavras enumerado **por classe gramatical fechada** em `baseline_tfidf`, que recusa na
construção qualquer palavra — de conteúdo ou não — e também qualquer **remoção**.

**A facilidade da família reservada, e o fail-open que a medição encontrou.** Detector = o artefato antigo
sobre os mesmos 506 textos, AUC de posto. O piso é o **barato** (`funcionais+estilometria`), porque a
comparação quer o **máximo** que um modelo burro alcança: usar o ramo mais fraco subestimaria o `lift` e
leria facilidade como generalização.

| fatia | AUC do piso barato | AUC do detector | `lift` |
|---|---:|---:|---:|
| reservada (`gpt-5_6-luna`, n=108) | 0,95449 | 0,95766 | **0,99307** |
| *core* (gemini, n=145) | 0,98299 | 0,98981 | **0,98608** |

Excesso de `lift` **0,00699** contra margem de 0,10. A primeira versão do critério leria isso como
`measures-generalization` — e estaria **errada por construção**: com o piso reclamando 98,6 % da separação
do detector nas *core*, o excesso não podia ser outro número. A regra de **folga** nasceu desta medição, o
veredito publicado é **`no-headroom`**, e `assert_reserved_family_measures_generalization` **recusa**.
O lado humano são os **253 pais pareados** e não o pool inteiro: o bloco recebia
`list(humans_by_id.values())` enquanto as AUCs publicadas usavam os pais, então o único controle de tópico do
desenho desaparecia no instrumento que decide como o número OOD é publicado — um piso medido contra humanos
de outros tópicos sobe, o `lift` das *core* sobe com ele e o veredito se move por uma causa que não é a
declarada. `assert_every_human_row_is_a_paired_parent` agora **recusa** essa chamada.
Uma ressalva que não se apaga: `gpt-5_6-luna` é modelo de fronteira, e a família que a v1 vai reservar é o
modelo pequeno de pesos abertos `gpt-oss-120b-medium`, que **não tem material fresco** — a comparação real
é da Fase 3 item 2.

**A fatia por tópico não tem material, e a exigência do contrato fica descumprida.** `assemble_corpus`
escreve `"topic": "geral"` constante em todo registro, então um corpo montado hoje produz **uma** fatia de
tópico com todas as linhas. Das quatro sondas, esta é a única que **nunca** viu um registro real: toda a
evidência é fixture. O eixo, a tabela e as duas barreiras estão medidos por teste (fatia densa acima dos dois
pisos e ainda inelegível; fatia com população vazia de um lado publicando `n/a`, com o valor não-finito que
`buildSlices` de facto produz; média macro e pior caso intocados; nenhum gate de tópico com `m` em 4), e o
que falta é `topic` deixar de ser constante — dívida de § 7.

### 5.9 A cabeça não treinada, medida — o que a paridade aprovava (2026-08-10)

**Não é medição do modelo do produto.** É o ensaio de uma guarda contra o cenário que a cross-review
descreveu e que **ninguém havia executado**: um checkpoint da forma selada com cabeça de duas classes não
treinada. Rodado em `python` 3.11 (`torch` 2.13.0+cpu, `transformers` 5.14.1), sobre um `BertConfig` da forma
selada inteira (29 794 / 768 / 12 / 3072 / 12 / 512 / 2) inicializado ao azar e salvo com
`save_pretrained`, e sobre 8 textos em pt-BR. O lado **ONNX não foi executado**: `torch.onnx.export` exige o
módulo `onnx`, ausente neste interpretador — mesma fronteira que o veredito do codex declarou (§ 7).

| ensaio | o que as guardas fazem | o que o modelo devolve |
|---|---|---|
| **cabeça ZERADA** (`classifier.weight` e `.bias` em zero, salvos no checkpoint) | forma de 8 campos: **passa** · arquitetura e labels: **passam** · `missing_keys`/`mismatched_keys`: **vazios**, a cabeça está no arquivo | logitos **exatamente `[0,0]`** nos 8 textos, **um** valor distinto de `P(ai)` = **0,5**. `meanAbsDelta` 0, `maxAbsDelta` 0, 0 inversões → veredito ANTIGO **`pass: true`**; veredito novo `degenerate: true`, **`pass: false`** |
| **cabeça AUSENTE** (os dois tensores removidos do `model.safetensors`) | forma, arquitetura e labels: **passam** · `missing_keys` = `["classifier.bias", "classifier.weight"]` → **recusa** | a cabeça vem ao azar e os escores variam **0,00358** (0,5266 a 0,5302): a guarda de degenerescência **também** o pega, e as duas são independentes |

Duas leituras que a medição fixa. A primeira: o cenário do ZIP com detector constante e relatório de
paridade perfeito é **real**, não hipotético — todas as guardas estáticas passam e só a dispersão do escore
o separa de um export legítimo. A segunda: `transformers` 5.14.1 relata a cabeça inventada em
`missing_keys` e apenas **avisa** (`LOAD REPORT` com `MISSING` e a nota *"Consider training on your
downstream task"*), que é a armadilha de biblioteca que `score_pilot_local.py` já documentava do lado da
pontuação e que nenhuma guarda lia.

### 5.9b Onde a própria guarda estava frouxa, medido pelas duas lentes (2026-08-10)

Quatro medições sobre a guarda nova, não sobre o modelo. As três primeiras são a razão de a Decisão 1 e a
Decisão 3 do registro terem sido **reescritas** no mesmo dia.

| medição | número | consequência |
|---|---|---|
| **um outlier derruba a amplitude**: 119 escores em 0,5 e um em 0,9, os dois lados idênticos | amplitude 0,4 · `meanAbsDelta` 0 · 0 inversões · `degenerate: false` · **`pass: true`** | a estatística do piso passou a ser o **intervalo interquartil** (0 nessa amostra). Também mede: 0,5201 (amplitude 0,0201) e 0,53 passavam |
| **`dev.jsonl` é agrupado** (o arquivo que o runbook manda usar, com o default `--parity-samples 120`) | 4 118 linhas · `label` 0 nas 2 640 primeiras, `label` 1 nas 1 478 seguintes · primeiras 120 = `Counter({0: 120})` | amostra de **uma classe**: o piso recusaria o export legítimo. A amostra passou a ser balanceada e espaçada (medido: 60/60 com espaçamento pelo arquivo inteiro) |
| **`--out` apontado para o checkpoint apagava os pesos**: um `save_pretrained` com `config.json`, `model.safetensors`, `tokenizer.json`, `training_args.bin`, `vocab.txt` | o predicado antigo dizia "é bundle" · `clear_previous_publication` removeu o diretório · `checkpoint exists after: False` | remoção passou a exigir os **dois** marcadores do exportador, arquivo de checkpoint recusa nomeado, e `--out`↔`--checkpoint` sobrepostos recusam antes de tudo |
| **a cópia híbrida da política era aceita** (versão selada, `seeds.publishableCheckpoint: 42`, teto 340 000 000) | `HYBRID ACCEPTED … seed= 42 ceiling= 340000000` · `assert_seed_is_the_publishable_one(42, hybrid) -> 42` | `SEALED_POLICY_SHA256` pinado; recusa medida de ponta a ponta num diretório plano, nomeando path e os dois digests |

Uma quinta, sobre a força das ligações e não sobre valores: comentar a chamada de
`assert_the_head_came_from_the_checkpoint`, trocar o staging por `args.out` na lambda, ou comentar a asserção
de forma do tokenizer deixavam a suíte em **85 passed / 25 subtests** — verde. O teste dessas ligações era
`assertIn` sobre o **texto** de `main()`, e uma linha comentada contém o texto.

---

### 5.10 As lanes de geração, modelo por modelo — o que cada uma suporta, de onde vem e de onde roda (2026-08-20)

Uma linha por modelo, e a coluna **verificação** é o que separa medido de inferido. Nada aqui é
congelado no repositório: os rosters são de fora e se movem, então o que a corrida gravar vale
mais que esta tabela, e a tabela existe para que a corrida não seja escrita de memória.

**`codex` — OpenAI, `codex exec` pelo login do operador, rodado da raiz do worktree**

| modelo | efforts | default | verificação |
|---|---|---|---|
| `gpt-5.6-sol` | low, medium, high, xhigh, max, ultra | low | cache |
| `gpt-5.6-terra` | low, medium, high, xhigh, max, ultra | medium | cache |
| `gpt-5.6-luna` | low, medium, high, xhigh, max | medium | cache |
| `gpt-5.5` | low, medium, high, xhigh | medium | cache |
| `gpt-5.4` | low, medium, high, xhigh | medium | cache |
| `gpt-5.4-mini` | low, medium, high, xhigh | medium | cache |
| `gpt-reserve` | low … max | medium | cache — **não é produto de geração**, é slot de fallback |
| `codex-auto-review` | low … max | medium | cache — **não é produto de geração**, é o modelo de revisão |

Proveniência, e ela é a **mais fraca das quatro lanes**: `~/.codex/models_cache.json`, lido em
2026-08-20 — a data e não o instante, porque cada corrida do codex reescreve o `fetched_at`. É
cache e não sonda, e as versões **divergem**: o cache declara `client_version` 0.148.0 enquanto
o binário é `codex-cli 0.145.0`, o que explica o `missing field base_instructions` com que o
próprio codex recusa o arquivo. `-m/--model` é string livre sem `[possible values:]`, então o
binário não valida id localmente e o carimbo de primeira mão custa uma requisição por modelo.
A faixa `low…xhigh` é a **interseção dos seis** e é exactamente o que `codex.effortLevels`
declara, logo 6 × 4 = **24 combinações** sem emenda de política.

**`agy` — Google e pesos abertos, `agy -p` pelo login do operador, binário em `~/AppData/Local/agy/bin/agy`**

| modelo base | efforts | verificação |
|---|---|---|
| `gemini-3.7-flash` | low, medium, high | `agy models` (ids com tier) + geração real em `-low` |
| `gemini-3.6-flash` | low, medium, high | `agy models` + geração real em `-low` |
| `gemini-3.5-flash` | low, medium, high | `agy models` + geração real em `-low` |
| `gemini-3.1-pro` | **low, high** | sonda: `medium` recusado com "available: low, high" |
| `gpt-oss-120b` | **medium** | sonda: `low` recusado com "available: medium" |
| `claude-sonnet-4-6` | **nenhum** | sonda: "--effort is not supported for model" |
| `claude-opus-4-6-thinking` | **nenhum** | sonda: "--effort is not supported for model" |

Três coisas medidas sobre a MECÂNICA do effort nesta lane, e a terceira corrige a leitura
anterior. O tier vive no id **ou** na flag; o binário recusa a **contradição** e não a
co-ocorrência — `gemini-3.5-flash-low --effort high` sai com "conflicts with", e
`gemini-3.5-flash-low --effort low` **roda**, então as duas fontes não são exclusivas, são
conferidas por consistência. Um valor fora de `low|medium|high` é recusado pela validação
global antes de qualquer checagem por modelo, e por isso a ausência de um effort é sondável de
graça e a presença não é. E **o roster não é estável**: `gemini-3.7-flash` não existia na
medição anterior desta árvore, e o seu aparecimento move a aritmética — sob o desenho vigente
(agy serve Gemini e `gpt-oss`, não Claude) são 11 combinações de Gemini mais 1 de `gpt-oss` =
**12**, e não as 8 de antes. `claude-sonnet-4-6` e `claude-opus-4-6-thinking` continuam no
roster e **não são usados**: a Anthropic vem do Claude Code. Um id inexistente devolve a MESMA
mensagem que um modelo sem effort, então esta lane não permite verificar existência por sonda —
só `agy models` lista.

**`claude-code` — Anthropic, chamadas de subagente de dentro de uma sessão neste worktree, sem binário externo**

| modelo | id | efforts | verificação |
|---|---|---|---|
| haiku | `claude-haiku-4-5-20251001` | low, medium, high, xhigh, max | **20 de 20 pares invocados hoje** |
| sonnet | `claude-sonnet-5` | low, medium, high, xhigh, max | idem |
| opus | `claude-opus-5` | low, medium, high, xhigh, max | idem |
| fable | `claude-fable-5` | low, medium, high, xhigh, max | idem |

Os quatro tiers cruzados com os cinco níveis foram **invocados de facto** e os vinte
responderam, então esta é a **proveniência mais forte das quatro lanes** — medição viva, não
cache nem roster. O haiku é **4.5** enquanto os outros três são **5**: o núcleo Anthropic
abrange duas gerações, e nenhum documento pode dizer "quatro tiers da mesma geração". O que
esta lane **não** tem é artefato externo: não há `--version` obtenível daqui (o `claude` não
está no PATH desta sessão), não há arquivo como o cache do codex nem comando como `agy models`,
e o harness é o CLI mais a orquestração da sessão. Logo `harnessVersion` nasce `unknown` e o
preço é elegibilidade — tolerável no núcleo, que não é onde o piso de 200 conta.

**`ollama` — reserva OOD, runtime local em `~/.ollama`, `ollama` 0.32.6**

As duas famílias, com a ficha que a máquina dá (`ollama show`), não a que eu lembro:

| | `qwen2.5:7b` | `llama3:latest` |
|---|---|---|
| id de conteúdo | `845dbda0ea48` | `365c0bd3c000` |
| tamanho | 4,7 GB | 4,7 GB |
| arquitetura | `qwen2` | `llama` |
| parâmetros | **7.6B** (o tag diz 7b) | **8.0B** |
| comprimento de contexto | 32768 | **8192** |
| embedding | 3584 | 4096 |
| quantização | **Q4_K_M** | **Q4_0** |
| capacidades | completion, tools | completion |
| system prompt do modelo | **sim** — "You are Qwen, created by Alibaba Cloud. You are a helpful assistant." | **não** |
| licença | **Apache 2.0** | **META LLAMA 3 COMMUNITY LICENSE**, release 2024-04-18 |

Três coisas que essa tabela expõe e que não são cosméticas.

**(i) A licença da Meta tem cláusula que a Apache não tem, e o PAPEL de reserva é o que a
desarma.** Lido do próprio arquivo: 1.b.v — *"You will not use the Llama Materials or any output
or results of the Llama Materials to improve any other large language model"* — e 1.b.i, que
obriga a incluir **"Llama 3" no início do nome** de qualquer modelo de IA distribuído que tenha
sido treinado com o material. O detector é um encoder BERT-base e não um *large language model*,
mas essa leitura é jurídica e risco jurídico é **B1, do operador**. O que desarma por MECANISMO é
outra coisa: a reserva **nunca entra no treino** — o componente reservado assenta inteiro em
`test` —, então o texto do Llama é material de AVALIAÇÃO e não "usado para treinar um modelo".
Logo o Llama é seguro exactamente no papel para que foi escolhido, e seria inseguro no núcleo, num
projeto cujo ponto é publicar pesos. A obrigação de atribuição já tem casa: `attributionRequired`
é `true` na política. O Apache do qwen tem **zero** ocorrências de cláusula equivalente.

**(ii) As duas famílias diferem na QUANTIZAÇÃO, e isso é confundimento.** Q4_K_M contra Q4_0 — o
segundo é o esquema mais antigo e mais cru. Se o llama3 escrever pior, não se saberá se foi a
linhagem ou a quantização, que é a mesma classe de defeito que o projeto vem nomeando. Conserto de
graça: puxar `llama3:8b-instruct-q4_K_M` em vez do `latest` iguala o esquema e deixa a linhagem
como única variável.

**(iii) O system prompt é propriedade do MODELO e não da lane.** O qwen injeta um, o llama3 não.
É a terceira ocorrência de propriedade por modelo que a linha de lane não consegue expressar
(depois do effort do agy e do `effortLevels` do codex) — e morde na decisão de canal que o codex
reprovou: "o runtime injeta system prompt" é verdade do qwen e falsa do llama3, então não pode ser
fato de lane.

**Por que a reserva TEM de ser esta lane, e não é preferência.** `harnessVersion` capturada, por provedor, contado nos pools: `public-dataset` 0 de 12.000 · `openai` 0 de 2.004 · `gemini` 0 de 1.650 · `codex` 0 de 1.402 · `agy` 0 de 419 · `anthropic` 0 de 122 — e **`ollama` 400 de 400**. Canal não-API sem versão capturada cai em `unknown`, `recordEligibility` conta eixo em `unknown`, e `countsTowardHeldOutFloor` filtra o piso de **200 positivos da reserva** por essa elegibilidade. Logo o material do ollama é o **único em disco** que consegue cumprir o piso hoje; `agy` e `codex` podem ser núcleo, onde elegibilidade não é exigida, mas não reserva. A assimetria é feliz e vale dizer: a lane de proveniência mais forte aterrissa no papel onde a proveniência é imposta.

A versão do runtime (0.32.6) é a mesma que as 400 linhas gravaram em `harnessVersion`, e o id de
conteúdo do modelo é conferível agora — é a única lane em que a reprodutibilidade não depende de
acreditar em ninguém. **A segunda família da reserva é uma lacuna aberta**: o tag não está
decidido, o modelo não está em disco, e o digest não pode existir antes do pull. Ela não é
opcional — reserva com uma família só não estima dispersão, e reserva vazia recusa a montagem.
Disco livre: 26 GB, 89 % usado, o que sustenta o plano sequencial (pull → gerar → `rm`) e não
dois modelos ao mesmo tempo.

## 6. NÃO APLICAR — aparecem no registro e não valem

**A célula v1 × inserção como "inalcançável em todo comprimento", e os Jaccard de 0,848–0,869** (publicados em 2026-08-12 no ESTADO, no registro e em duas mensagens de commit). A sonda que os produziu passou uma **string** para `shingles_of`, que recebe **lista de tokens**: ela mediu 5-gramas de **caractere**, que é outra quantidade. Medido com a API correta, o par cruza 0,82 só a partir de ~223 tokens de pai — a álgebra que eu havia feito antes e depois declarado refutada estava certa. A exclusão da célula permanece, com a razão trocada para viés de comprimento (§ 3.3), e agora presa por teste nos dois lados da fronteira. Lição registrada: passar o tipo errado a uma função de produção devolve um número que **parece** medido.

- **"os eixos de receita são reportados, e o teto vale sobre prompts vistos"** (unidade U4, 2026-08-11, revertida pelo operador em 2026-08-12): `promptTemplate` voltou à união, e o recall passa a ser medido sobre prompts que o bloco cego retém. O que **sobrevive** de U4 é o conserto — carimbo por componente conexo, teto por classe, reserva pelo componente, o critério da lista com recíproca declarada falsa — e o que morre é a leitura de que a co-locação de receita fosse dispensável. `generatorVersion` continua reportado, por não ser imponível (a identidade é o id do modelo), com o resíduo fixado por teste;
- **"a cota do codex não voltou em 8 de agosto"** (unidade de auditoria de 2026-08-10, retratada no dia
  seguinte): ela voltou na data prometida, foi **gasta** na rodada das dez unidades de 9 de agosto (dez
  chamadas, oito com `EXIT=0`, 3.102.744 tokens) e fechou de novo no meio da rodada. A frase nasceu de ler
  o selo de fim de janela (`try again at …`) como prova de ausência de retorno, com oito vereditos de codex
  no mesmo diretório que estava sendo auditado. O que sobrevive é a regra de leitura de § 7; o que morre é
  a conclusão, e com ela a leitura de que a etapa 3 da rodada das dez tenha sido do Fable — foi do **codex**
  em oito das dez;
- a **implausibilidade de co-ocorrência como atalho aprendido** lida como fato: o que está ESTABELECIDO é
  que o pré-treino MLM do BERTimbau tem como objetivo prever token por contexto, logo as representações
  codificam estatística de co-ocorrência — isso é arquitetura. O que foi ESPECULADO, e afirmado como se
  fosse sabido, é que a representação **agrupada** que a cabeça de classificação lê exponha essa
  implausibilidade de forma utilizável: existe método padrão para ler surpresa de um MLM
  (pseudo-perplexidade, Salazar et al. 2020) e este classificador **não a calcula**. Do argumento
  **sobrevive** que o pareamento controla o ASSUNTO e não a CORREÇÃO — dentro de um par de tópico idêntico
  uma entidade inventada ainda diferencia — e **dissolve-se em grande parte** o resto: as famílias de treino
  são modelos de fronteira, que raramente confabulam em prosa enciclopédica curta sobre tópico conhecido, e
  a confabulação pesada vive na família RESERVADA, que é só teste e portanto não ensina nada ao modelo —
  apenas infla a leitura do OOD. Medido em 2026-08-07 contra o artefato antigo (§ 5.8): mascarar toda
  entidade, data e numeral **não** move o veredito, e mascarar palavras comuns move o escore 4,7× mais;
- a leitura de que o `survives` do mascaramento vem da classe **`ai`** dos pools de hoje: nela só 5,32 % das
  palavras foram mascaradas, porque as linhas geradas em disco falam de produto e saúde e quase não carregam
  entidade nomeada. A leitura que decide é a da classe **humana**, com 23,17 % das palavras mascaradas e
  excesso de +0,00145 sobre o placebo — que a falta de 47 palavras no placebo dessa classe torna, se algo,
  generoso com a hipótese (§ 5.8);
- a leitura de que um braço de mascaramento **sozinho** mede algo: `[MASK]` é token que a cabeça ajustada
  nunca viu, então inserir quinze deles move o escore qualquer que seja o que substituíram. A quantidade é o
  **excesso** sobre o braço placebo, casado por contagem de vãos e por multiconjunto de comprimentos de vão;
- a leitura de que o excesso de `lift` da família reservada perto de zero **aceita** a fatia OOD: medido,
  com o piso barato reclamando 98,6 % da separação do detector nas famílias *core*, o excesso não podia
  ser outro número. É abstenção (`no-headroom`) e a asserção de aceitação **recusa** — abstenção lida como
  aceitação era o fail-open que a regra de folga fechou (§ 5.8);
- a leitura de que o piso `funcionais+estilometria` é **cego a tema**, publicada como
  "`cego-a-tema` 0,9749 supera palavra e caractere, com as palavras de conteúdo estruturalmente barradas":
  medido, `estilometria` sozinha reclama 98,8 % da separação acima do acaso da união, 7 das suas 19 features
  são funções das palavras de conteúdo e `_stylometry_matrix` recebe o texto inteiro. O piso genuinamente
  cego a tema é `funcionais`, com **0,9313** — logo **abaixo** de palavra (0,9327) e de caractere (0,9319).
  Nem é "a mesma conclusão de § 5.7b por outro caminho": é o mesmo caminho e as mesmas features (§ 5.8);
- a leitura de que uma lista negra de palavras de conteúdo medidas prova "nenhuma palavra de conteúdo":
  medido, `brasil` declarado funcional passava pelas duas guardas e chegava ao vocabulário ajustado, porque a
  segunda guarda compara o ajustado contra a lista **já contaminada**. Só igualdade de conjuntos contra um
  inventário declarado por classe gramatical fecha isso (§ 5.8);
- a leitura de que `topic` pode entrar em `GROUP_KEYS` porque agora é eixo de fatia: são coisas separadas.
  Eixo de união derivado de um *clustering* põe uma decisão de modelagem dentro da política selada, e
  conglomerado temático é grande, o que traz de volta a degenerescência de poucos blocos grandes que a
  emenda da moldura resolveu;
- a leitura de que a inelegibilidade a gate sozinha mantém uma fatia diagnóstica fora dos números
  publicados: a **média macro** de `summarizeSlices` percorria TODAS as fatias, elegíveis ou não, e é
  publicada no relatório. São duas barreiras e nenhuma implica a outra;
- a **pré-inscrição v3 inteira** (`benchmark/rebuild-v3-policy.{json,ts}`, marcada em
  `.ABANDONADA.md`): está em árvore, é importada por **nenhum** módulo de produção e por nenhum membro
  de `EVALUATOR_FILES`. Os valores que a pré-inscrição vigente reafirma estão em § 3, com o rótulo da
  autoridade que hoje os impõe — o arquivo v3 não é autoridade sobre nenhum deles;
- `A2` (eixo de 4 células por fonte, com B2W);
- de `B3`, o piso de **250 componentes por célula** e a manchete do **pior estrato**;
- `F0-5` (cinco estratos com `qa-informal` declarado);
- piso de **≈20 mil linhas humanas**;
- a **moldura de quatro células** e tudo que dela pendia: `m=7`, α por hipótese **0,007143**, teto de
  **1,6337 %** no piso, alvo de **1.750** linhas por célula, total humano de **7.000**, corpus de 13.000,
  `humanCoreStrata` como segundo vocabulário (`encyclopedic`/`judicial`/`social-media`/`university`),
  `carolina` em `humanSources.snapshots`, e `groups.domainSource` como nível da tabela de reamostragem;
- o piso de **6.000** ou de **1.500** linhas humanas como número da composição de release —
  `RELEASE_CORPUS_POLICY.counts.human` é **4.000**, o alvo;
- a leitura de que reduzir a moldura **afrouxa** o teto publicado: ele **estreitou**, de 1,63 % para
  0,55 %, porque `m` caiu e o orçamento de coleta concentrou numa célula (§ 5.2);
- o backbone **`xlm-roberta-base`** e o teto de export int8 de **340 000 000** bytes, com a justificativa
  circular que os acompanhava (o teto foi elevado para acomodar o backbone e a elevação virou razão de
  escolhê-lo): o selado é `neuralmind/bert-base-portuguese-cased` com teto de **130 000 000** ancorado em
  export medido (§ 3.5), e o parser recusa os dois valores antigos nomeando o path. As duas seções do
  registro que os afirmavam estão marcadas **RETRATADO**: a do teto logo abaixo do cabeçalho, a do
  backbone no corpo da seção, junto do parágrafo que o afirmava;
- os **3,656 %** agregados de contaminação lidos como veredito do gate, ou como lane a regenerar: o teto de
  2 % é por família, e o agregado do conjunto gerado não é quantidade que o gate compare;
- o gate antiartefato com **quatro** detecções (L12 do registro): as quatro seguem em vigor, o **número**
  não — são dez desde W2. E duas sondas que o roteiro de W2 nomeava estão **medidas e recusadas**: espaço
  antes de pontuação (7,15 % no humano em moldura contra 0,55 % no gerado, direção invertida e acima do
  teto) e NBSP **nu**, que virou corrida de dois ou mais;
- o `0 de 1.170` que § 5.4 publicava como veredito do gate: era das **quatro** detecções. Com as dez são
  24 de 1.170 e `gemini-api` iria para regeneração — o que não acontece hoje só porque a poda global não
  deixa registro gerado nenhum chegar ao gate;
- `derivationRoot` lido como eixo **só** de linhagem de pai: ele está em `GROUP_KEYS` e une por valor
  compartilhado, sem condição. Só `humanSeed` é exclusivamente linhagem de pai;
- `blindReserveCompleteAttempts` lido como reserva **executada** na v1;
- regra condicional 6 (codex indisponível → selado espera);
- bloco C inteiro, exceto `C4`;
- de `B1` no registro — a lista de ABERTAS e a linha `F0-4` —, a **numeração de fases**: "bloqueia somente
  a Fase 3", "as Fases 0 a 2 correm sem ela" e "só a Fase 3 depende dela" são do plano antigo, em que a
  Fase 3 **era** a publicação dos pesos. No roteiro vigente a publicação é a **Fase 7**, e a assinatura
  espera o pacote da Fase 6 (§ 3.6, § 4);
- **qualquer leitura de "gasto" sem a graduação de § 3.4** — inclusive afirmações anteriores, no registro
  e em memórias de sessão, de que o `ptbr-generic-v1` "não pode mais ser usado" ou de que o material
  estaria "descegado" por conhecimento de estrato;
- as **~1.600 linhas humanas recuperáveis** do corpus morto: são abdicadas de propósito pela poda global;
- a leitura de que a **sonda 1 detecta duplicata** entre partições: um texto presente em `train` e em `dev`
  é **invisível** ao classificador de partição — as mesmas features carregam dois rótulos opostos e o par
  não move a AUC —, e há teste que o afirma. Duplicata é pega pela segunda razão da sonda
  (`text-shared-across-partitions`, texto normalizado exato) e quase-duplicata é de `near_dupes`, de
  `split.ts` e de `assert_components_can_fill_five_partitions`;
- a leitura de que a **AUC de comprimento no acaso** significa distribuições iguais: medido, AUC 0,5009 com
  a fração `ai` por decil oscilando entre 0,15 e 0,59 (§ 5.7). Uma AUC monótona no acaso diz que nenhuma das
  duas domina estocasticamente a outra, não que têm a mesma forma;
- a leitura de que uma **AUC de palavra abaixo do acaso** no baseline significa "nenhum artefato": sobre
  fixture pareada por tópico — que é o desenho do piloto — ela cai a 0,019 porque o modelo prevê o rótulo da
  gêmea que viu na dobra anterior. É memorização do par, e há teste que o afirma;
- a leitura de que as sondas 2, 3 e 4 podem **recusar** algo: o relatório delas não tem campo de veredito;
- os buckets de comprimento **`0_49`, `80_99` e `100_149`** de `sizeBucket`: eram constante em código,
  isto é, corte que alguém pode mover depois de ver o resultado, e `0_49` nomeava população que a medição
  **abstém**. As faixas vigentes são as **quatro** pré-inscritas de § 3.1, e `sizeBucket` deriva delas;
- a leitura de que a faixa de comprimento é **manchete, pior estrato ou hipótese**: ela é diagnóstico,
  não gasta alpha, e `m` continua 4 com as faixas presentes e continua 4 se uma faixa for acrescentada;
- a leitura de que **AUC de comprimento no acaso** prova que as duas distribuições casam: medido, um
  clamp bilateral deixa a AUC em 0,504 e ainda assim produz faixa de `aiShare` 0,0 (§ 5.7b). O
  mecanismo tem nome — truncamento nas duas caudas, cujas inversões de posto se cancelam — e é distinto
  da bimodalidade que o item anterior descreve;
- a leitura de que `generate_ai.py` pedia um comprimento **constante**: ele já pedia o da própria
  semente humana; o defeito era o **clamp** `max(60, min(n, 350))` em volta dele;
- a leitura de que o clamp de comprimento saiu de **um** lugar: eram **três** — a linha de
  `generate_ai.main()`, o `max(60, min(n, 300))` de `codex_batch.chunk_prompt` (a lane `codex`, a das
  famílias OpenAI) e o `MAX_OUTPUT_TOKENS = 1024` da lane REST, que é clamp do outro lado do
  transporte e não estava escrito em palavras;
- a leitura de que faixa **fora** de `RUNTIME_BUCKET_CONSTITUENTS` é a direção fail-closed: medido,
  era fail-**open** — o gate da faixa desconhecida era filtrado, então a reprovação dela não capava
  nada e `200-plus` seguia autorizando `hide`. Hoje a cobertura é imposta e a publicação recusa;
- a leitura de que a sobreposição `150_299` **capa** `80-199` e `200-plus` quando reprova: sob a regra
  de decisão vigente um gate de ação que reprova — inclusive o inelegível — entra em `failedAction` e
  capa o release inteiro em `indicator-only`, onde todo bucket já é `indicator`. Com `pass`, todo gate
  de ação presente passou, e o que a agregação por bucket decide é **presença de evidência**;
- a leitura de que a asserção `reads its edges from the pre-registered bands` prova a derivação por si:
  contra UMA lista de faixas, arestas em literal respondem igual a arestas lidas. Só a exercitação de
  `lengthBandKeyOf` contra uma lista **que não é a embarcada** separa as duas;
- a leitura de que o `máximo gerado 1.774` de § 5.7b é propriedade do **gerador**: é do alvo e do
  fixture que o sintetiza — nenhuma linha foi gerada nesta medição;
- a **varredura das primeiras 60.000 páginas** do dump como descrição da população da célula:
  54,3 % de admissão, p50=120, p90=362, máx=1.774 e as frações 29,77/29,81/25,54/14,89 %. A extração
  real de 2026-08-06 lê 394.414 artigos com amostragem de 1 em 40 e mede 41,3 % de admissão, p50=106,
  p90=282, máx=2.256 e 33,88/33,67/23,93/8,53 % (§ 5.1b). A causa é medida: as primeiras páginas de um
  dump são os artigos mais maduros, com lede mais longa, e um prefixo não é amostra. Os valores antigos
  seguem na pré-inscrição como valores **congelados** — é a dívida de § 7 —, mas não descrevem a
  população;
- a expectativa de que a **poda global** contra o corpus morto custaria caro, ou a de que ela custaria
  nada: medido, 2 de 4.100 linhas (0,049 %), **0** por hash exato e **2** por Jaccard — com a maior
  similaridade MANTIDA em **0,81**, um centésimo abaixo da barra;
- a leitura de que o inventário de material continua sendo dívida, ou de que um corpus v4 sai `blocked`
  por `SOURCE_REFERENCE_MISSING`: medido em 2026-08-06, `auditCorpusSources` devolve `ready` com **0**
  motivos sobre os 4.000 registros humanos (§ 5.4b);
- os **4.097** documentos de origem lidos como contagem do **corpo estampado**: são do POOL, na barreira
  que `assert_cells_can_meet_the_origin_document_floor` impõe antes da seleção, e a função só conta origem
  `known` (4.100 frescas menos as 3 que as podas tiraram). O corpo de 4.000 linhas tem **4.000**
  documentos de origem distintos, uma linha por documento (§ 5.4b). Publicar 4.097 como propriedade do
  corpo é a mesma classe de erro que deixou "1 unidade por célula" viver: contagem certa, objeto errado;
- a afirmação de que o corpo local de 2026-08-06 **não tinha partição**: ela é refutada pelo próprio
  código. `stamp_block` escreve `BLOCK_TIME` em `createdAt` e `diagnostic_probes.partition_of` devolve a
  partição a partir desse campo, então um corpo estampado **tem** pertença de bloco, inclusive nas duas
  cegas. O que não existia era **split congelado** — sem comando `split`, sem `split-artifact.json`, sem
  selo e sem evento de ledger —, e as duas coisas não são a mesma. O corpo foi apagado de
  `benchmark/data/` por isso (§ 5.4b);
- a contagem **por partição cega**, uma linha para `cal-B` e uma para `test`, como número publicável — e o
  ESTADO a publicava: § 3.3 admite **um** agregado do que foi posto de lado e nada mais, que é a regra que
  `open_partition_rows` impõe e a razão que a docstring dela escreve. O agregado é 1.600 de 4.000;
- a conferência dos 4.000 `normalizedTextSha256` contra `corpusContentDigest` lida como prova de que o
  digest do corpo está certo: `assemble_corpus` **omite** o campo de propósito (o `ingest` o recomputa e
  preenche), e quem o escreveu naquele corpo foi um script de fora da árvore chamando `corpusContentDigest`
  — a mesma função contra a qual seria comparado. Comparar um campo com a função que o escreveu só pode dar
  4.000 de 4.000, e o que isso exclui é corrupção do arquivo, não digest errado;
- o contrafactual de que uma extração de **4.000 exatas** entregaria **3.998**: são **3.997**. A conta que
  dá 3.998 esquece a linha que a poda **intra-pool** derruba, na posição 245 — as três posições (245, 369,
  1.084, 1-indexadas) estão dentro das primeiras 4.000, e o pipeline completo rodado sobre elas devolve
  3.997 (§ 5.4b);
- a leitura de que a montagem sobre `candidates-f3` para em `HeldOutReserveEmpty` **por causa da poda
  global**: medido, `load_ai` e `load_mixed` devolvem 0 sobre esse diretório — não há classe gerada para
  a poda derrubar. A causa "a poda global não deixa nenhuma gerada sobreviver" é do pool de 24/07
  (§ 5.4), e as duas recusas são corretas por razões diferentes;
- a leitura de que o **relatório de paridade** com `meanAbsDelta` pequeno e zero inversões é evidência de
  export fiel: medido (§ 5.9), paridade é verificação de AUTOCONSISTÊNCIA e um modelo degenerado a
  **maximiza** — cabeça zerada dá `meanAbsDelta` 0, `maxAbsDelta` 0, zero inversões e `pass: true`. O
  relatório só fala de quantização quando o **intervalo interquartil** do escore supera a tolerância dos
  deltas, sobre amostra que atravessa as duas classes;
- a leitura de que a **amplitude** (`max − min`) do escore serve de piso de degenerescência: medido (§ 5.9b),
  119 escores em 0,5 e um em 0,9 dão amplitude 0,4 e passavam com `meanAbsDelta` 0 — um documento em 120 move
  a amplitude e não move o interquartil;
- a leitura de que **amostra vazia passava por construção** — publicada em três sítios por esta empreitada e
  falsa: medido, `np.mean([])` é `nan`, `nan < 0,02` é falso, e `np.max([])` **estoura**. O valor da guarda é
  recusar antes dos imports, nomeando a flag, em vez de estourar depois de o int8 já existir;
- a leitura de que pinar `policyVersion` identifica a política selada: medido (§ 5.9b), uma cópia com a versão
  selada, seed 42 e teto 340 000 000 era aceita pelos dois scripts. `policyVersion` **não se move** quando a
  pré-inscrição é emendada; quem identifica o arquivo é o `sha256` pinado;
- a leitura de que `policyOrigin: tracked` (antes `policyBesideTheScript: false`) diz que a política veio do
  arquivo **rastreado**: ele diz apenas qual dos caminhos resolveu, e fora de um checkout "um nível acima" é o
  que estiver lá — medido duas vezes, nas duas corridas de conferência do T5. Quem diz o que o arquivo continha
  é o digest;
- a leitura de que as **guardas do export** provam que a cabeça foi treinada: nenhuma delas alcança isso.
  Elas recusam a cabeça ausente, a não binária, a de ordem invertida, o pooler inventado, o vocabulário de
  outro BERT, o grafo de duas entradas, a amostra de uma classe e o escore constante. A prova é o recibo F6
  (§ 7, primeira linha);
- a leitura de que os quatro campos `model_type`/`vocab_size`/`hidden_size`/`num_hidden_layers`
  **identificam** o backbone: um BERT 12×768 de vocabulário 29 794 com `intermediate_size: 16` satisfaz os
  quatro, exporta limpo, emite as três entradas e fica MAIS abaixo do teto. A forma comparada tem oito
  campos, transcritos da testemunha rastreada por digest (§ 3.5);
- a leitura de que `json.loads` sobre `preregistration-v4.json` é ler a política selada: todo objeto JSON o
  satisfaz, e `benchmark/rebuild-v3-policy.json` — que está na árvore e declara o backbone descartado e o
  teto de 109 681 931 — era aceito. O leitor pina `policyVersion` e recusa nomeando campo e path;
- a leitura de que os **12 problemas de lint** são dívida de código do projeto: os 10 erros estão todos
  sob `.cache/chrome-for-testing/`, um Chrome baixado que nenhum commit carrega (§ 1);
- a atribuição da queda do lint de **13 para 12** ao movimento do cache do Chrome: medido, o 11.º erro era
  do **repositório** — o `dirname` importado sem uso em `build_governance.ts:14`, que a Fase 3 item 1
  apagou. Rodar o ESLint sobre a versão anterior desse arquivo acusa esse 1 erro sozinho, então 11 = 1 do
  repositório + 10 do cache. A contagem publicada estava certa e a **causa** era sintetizada.

---

## 7. Dívidas

| dívida | vence |
|---|---|
| as 400 linhas da reserva em disco são recusadas por **três** motivos e não dois, e o terceiro é de CAMPO: todas as 400 declaram `licenseId: "apache-2.0"`, e `generated_license` recusa com `GeneratedRowDeclaresAnotherLicense` — a licença de uma linha gerada é a **nossa** concessão (`geracao-propria-v1`), e linha que nomeia a licença de outro está a nomear a licença de outro. Os outros dois são `UnmappableLane` (o provedor `ollama` não é lane congelada) e família sem papel no slate. **O terceiro não é consertado pela unidade de forma das lanes**: exige reescrever o campo nas 400 linhas ou regerá-las, e reescrever pool em disco é tocar material | antes de assentar a reserva |
| **nada cruza modelo e effort com template, e a lacuna é de PLANO e não de código.** Medido: uma ilha carrega `templates`, `mixingTemplates`, `seedBlock`, `lines` e `reserved`; uma receita carrega `task`, `register`, `template` e `weight`. **Nenhum dos dois nomeia modelo ou effort** — os dois são argumentos POR CORRIDA (`--model`, `--effort`, `--effort-source`). Consequência: a palavra "receita" carrega duas coisas que só uma está planejada. A identidade de PROMPT é planejada e particionada por ilha (40 templates, e `promptTemplate` está na união do split); a identidade de GERAÇÃO — modelo × effort, 24 no codex, 12 no agy, 20 no Claude Code — é o que a linha de comando do operador fizer. Nada recusa uma ilha gerada inteira num só modelo+effort, e nada garante que um modelo apareça em mais de uma ilha. Não ameaça a divisibilidade, porque `generatorVersion` é REPORTADO e não unido; ameaça a **atribuição**: se a ilha 00 sair toda de um modelo e a 01 de outro, template e modelo ficam colineares e a fatia de um não separa do outro — o mesmo confundimento que a `proxyReason` declara para operação e template. O conserto é um plano de cobertura, não uma guarda | antes de gerar a classe `ai`; é decisão de desenho de medição |
| a fonte de effort **`flag` do agy é medida e INGRAVÁVEL**, e a tentativa de a declarar foi medida e desfeita: `--effort` é fonte real num id base (`gemini-3.1-pro` recusa `medium` com "available: low, high"), mas a linha da lane carrega **um booleano** para uma propriedade que é **por modelo**, e `schema.ts` recusa `source: "flag"` com `configurable: false` — então acrescentar `"flag"` a `effortSources` cria um arm **inabitável**, e virar o booleano para `true` dá **119 vermelhos** porque todo registro agy já escrito passa a ser inválido. Uma corrida que passe `--effort` tem de ser gravada na forma de id de modelo ou não ser gravada. **E o codex tem o mesmo defeito pela outra ponta, com uma agravante**: a escada real dele é por modelo e chega a `max`/`ultra` (§ 5.6), e a política declara quatro níveis numa lista única. `effortLevels` é definido como **os níveis da escala** e não como subconjunto permitido, então a lista de quatro é **descrição incompleta da escala** — é falsidade, não teto. O efeito operacional é benigno e separado disso: uma linha gerada em `max` é recusada por "effort level outside the lane's own scale", isto é **fail-closed**, então nada corre risco enquanto a geração ficar em `low…xhigh`. Conserto dos dois = linha de lane que distinga effort por modelo, isto é mudança de FORMA | v2, ou a unidade que emendar as lanes; o teto de `xhigh` vence se alguém quiser `max` |
| **`format:check` está VERMELHO**: `benchmark/tests/consume-holdout.test.ts` tem dois `it(...)` com **terceiro** argumento (`TIMEOUT_MS`), e com três argumentos o prettier não abraça o callback — ele expande a chamada inteira. Medido: `prettier --write` nesse arquivo é **78 inserções / 68 remoções**, formatação e nada mais, e o arquivo **não** está em `EVALUATOR_FILES`, logo o `evaluatorDigest` não se move. `npm run verify` e `verify:release:base` param aqui | commit próprio, antes de qualquer `verify` de release |
| **as duas lanes que o desenho novo precisa não caberam na pré-inscrição, e a recusa é de FORMA e não de valor** — emenda reprovada pelo codex em 2026-08-20, com quatro dos seis itens derrubados. (i) `ollama` é a primeira lane que é **as duas coisas**: runtime local com versão (`ollama 0.32.6`, capturada em 400 de 400 linhas) **e** canal que aceita temperatura e **seed** real. O modelo selado supõe que isso é exclusivo — `GenerationChannel` tem três valores e o validador proíbe `decodingConfigurable` em canal com harness —, então declarar `api` perde a versão e declarar `cli` perde o seed, que `seed_pair` chama de "o único campo que torna uma geração reproduzível". O remédio nomeado: um canal novo que separe transporte de runtime versionado, mais a emenda da invariante de decoding. (ii) `claude-code` precisa que a definição textual de `not-supported` seja **enfraquecida**: ela diz "a lane não tem noção de effort" e já é falsa do agy, onde o arm dispara **por registro**. Sem isso a lane recusa toda linha que não gravou nível — as 122 `claude-fable-5` em disco entre elas | uma unidade própria, antes de gerar Anthropic ou a reserva |
| as **três ilhas reservadas carregam duas das oito tarefas** de geração — `didatico` e `comentario` —, porque a regra agrupa tarefas de cinco em cinco e as reservadas são as três últimas. **Não permutadas**: a reserva mede novidade de **família** geradora e não variedade de tarefa, e permutar trocaria os 40 digests de template para comprar propriedade que perna nenhuma da alegação reivindica. Logo a população em que o OOD mede cobre 2 das 8 tarefas. Custo de reversão **zero** enquanto nada foi gerado e alto depois da primeira linha, então quem quiser a permutação tem de a pedir antes da geração | antes de gerar a classe `ai` |
| a pista mista **realiza as três operações**, e o que sobra dela é menor e está medido. `MIX_TEMPLATES` serve **63** receitas: as **60** identidades `mix-<operação>-ilha-NN`, compostas de geometria × intenção × registro com o nível como parâmetro preenchido, mais as **três** `mix_*_v1` legadas, que ficam porque os pools em disco foram escritos sob elas. Os 63 têm 63 digests distintos, e a igualdade é conferida também na fronteira do `argparse` — sessenta nomes sobre corpos repetidos passariam a conferência por NOME e deixariam a partição de ilha NOMINAL. O laço de `--generate` itera as **20 células** que `mix_cells()` deriva, toma pai só do próprio bloco de semente, e a linha grava `mixOperation` e `mixLevel` no TOPO do registro de pool — nunca dentro de `mixture`, que é vocabulário FECHADO do esquema selado. **Três resíduos, declarados:** (i) as sondas de eco de `artifact_gate` derivam só de `RECIPES`, então a prosa de **geometria** e de **intenção** dos 60 não tem sonda — a de registro tem, porque é byte a byte a do slate de geração —, e crescê-las mudaria a taxa medida contra o teto **pré-inscrito** de 2 %, logo é medição com unidade própria; (ii) `make_mixed_agy.py` e `make_mixed_codex.py` continuam a fazer edit genérico pinando `mix_edit_v1`, então as linhas delas não pertencem a ilha alguma e a montagem as recusa — inalterado, e é a razão de `--assume-template` só admitir as receitas **sem** operação; (iii) o pool reservado tem 2.247 linhas sobre 20 blocos de semente, ~112 por ilha **antes** da janela de 50–450 palavras, contra a cota de 100 mistas por ilha, então a perda de rendimento da banda pode deixar célula sub-preenchida. O número por ilha não foi medido | (i) e (iii) antes de fechar a Fase 3; (ii) inalterado |
| a **marca d'água do núcleo não é declarável hoje e não é auditável nunca**: o esquema, a força e a robustez a paráfrase são desconhecidos, e os esquemas conhecidos são de **chave secreta** — green list/red list detecta por teste z sobre a contagem de verdes, o SynthID-Text por *tournament sampling* com g-funções, e sem a chave não há detecção. Logo nenhuma medição nossa isola a contribuição da marca para o recall, e gravar presença como eixo por linha foi **recusado**: valeria `unknown` em toda linha, que é o fator degenerado por construção. Ressalva que fica dita: indetectável **como marca** não é invisível para um aprendiz — a perturbação está nas estatísticas de token, então o classificador pode aprender a consequência sem nomear a causa | Fase 6, em `limitations.md` e no model card |
| o **recibo de pré-exposição não carrega identidade de bloco**, e é por isso que a amarração do corte fecha o processo e não o argumento. O que ficou **medido e fechado**: o corte abençoado antes da lease viaja como digesto até quem decide; a retomada o confere contra o recibo antes de reescrevê-lo; e uma invocação fresca sobre bloco que **aquele ledger** registra como gasto é recusada **antes** do write, ancorada em `assertHoldoutAvailable` — a mesma função que roda sob o lock, então as duas não podem discordar sobre o que "gasto" significa. As duas sequências que ficavam abertas **foram FECHADAS em 2026-08-19**, e cada uma virou teste: (i) a corrida apontada a um `--ledger` que não registra o gasto chega à escrita e é recusada por `PRE_EXPOSURE_RECEIPT_CUT_CONFLICT`, porque o recibo em disco já registra outro corte como o abençoado — e a recusa vale **inclusive para recibo legado**, sem o campo de identidade, que é a forma que o disco tem hoje; (ii) a segunda `consume-holdout` legítima sobre outro bloco no mesmo `--work-dir` é recusada por `PRE_EXPOSURE_RECEIPT_FOREIGN_CONSUMPTION`, e as duas provas afirmam que o registro alheio fica **intacto** e não só que houve recusa. O mecanismo é o recibo carregar `blockIdentityDigest` — o digesto canônico da `HoldoutIdentity`, a MESMA tupla que o ledger tranca —, e a chave viaja DENTRO do arquivo e não no nome dele porque a guarda da retomada lê o recibo antes de o artefato de split ser aberto: pôr a chave no nome obrigaria a reordenar uma sequência cuja ordem é o que impede uma corrida condenada de gastar qualquer coisa. Bateria diagonal: o ramo da identidade derruba uma prova, o do corte a outra, a chamada inteira derruba as duas. **A objeção antiga não foi revogada e não precisa ser:* "protege um arquivo com um arquivo" segue valendo — a autoridade sobre "gasto" continua sendo o ledger sob o lock, e esta guarda não a disputa. O que ela garante é mais estreito e é o que faltava: um registro existente nunca é substituído em silêncio. **O resíduo que fica**: apagar o recibo continua possível, e o efeito é fail-FECHADO — a retomada passa a ser recusada por ausência (`PRE_EXPOSURE_RECEIPT_CUT_MISSING`) em vez de se amarrar a um corte errado | **feita** em 2026-08-19; o resíduo do apagamento é fail-fechado e não tem dono |
| a **cláusula de ordem do exportador é carregada só indiretamente**: a docstring de `assert_no_checkpoint_is_at` afirma que `--out` apontado ao checkpoint é recusado por `assert_out_is_not_the_checkpoint` **antes** deste predicado ser consultado, e o único teste que aponta `--out` a um checkpoint chama a função **direto**, com um fixture que é documentado ele mesmo como o diretório "minus the weights". O caminho **composto** não tem portador. E o resíduo aceito da guarda nova está declarado: ela busca em qualquer profundidade, mas sobre a **lista fechada** de seis nomes — peso com nome fora dela não impede a remoção | unidade que tocar o exportador, ou a Fase 4 |
| o **quarto tier é um interruptor silencioso para hipótese CERTIFICADORA**, e o buraco não é desta unidade — é pré-existente e foi medido ao recusar a forma (b) do desarme. `certifyingIds` e `hypotheses` são montados de `intervalSpecs` **antes** da partição por tier, que não é exaustiva: alargando `IntervalGateSpec.tier` e dando um tier novo a `warning.recall.overall`, o gate **desaparece** de `gates` (24 → 23) enquanto `multiplicity.gateIds` continua nomeando a hipótese e `covers` continua `true` — o relatório declara ter decidido `recall-at-threshold` e não publica gate nenhum para ela. O teste do vocabulário de tier **não** o pega, porque o gate que desapareceu não tem tier para conferir. A guarda que faltava é a recíproca — todo spec que declara hipótese tem de aparecer nos gates emitidos —, e ela **existe desde 2026-08-20** (`assertEveryClaimedHypothesisHasAGate`, chamada em `decideGates` logo depois de `gates` ser montado). Ela **levanta** em vez de publicar gate reprovado, e a direção é a razão: gate ausente não é hipótese que falhou, é hipótese que ninguém decidiu — publicá-la como falha convidaria a retentar contra um limiar que nunca foi aplicado. O que a medição acrescentou ao diagnóstico: estreitar o filtro de emissão faz três specs certificadoras sumirem (`warning.fpr.slice.humanSourceType.ptwiki`, `warning.recall.overall`, `warning.calibration-ece`) e **com** a guarda 76 casos ficam vermelhos com o código nomeado; **sem** ela, 29 ficam vermelhos por `expected "pass" to be "reject"` — isto é, 47 casos passariam a APROVAR onde reprovavam. O interruptor silencioso está medido nas duas direções, e não só descrito **Delimitado por medição em 2026-08-17**, e o limite está escrito no próprio `gates.ts`: das três formas de introduzir um quarto tier, duas ficam vermelhas — gate construído direto (e aí ele **abranda**, porque sai de toda lista de falha: uma quebra de cobertura que rejeita passa a `pass`, medido) e spec de intervalo **existente** cujo tier muda (o gate desaparece de `gates` e o pino de inventário o vê). A terceira **não é guardada**: uma spec de intervalo **acrescentada**, diagnóstica, com quarto tier e reprovando o próprio limiar, deixa a suíte inteira verde — só é vista se reivindicar hipótese, porque `certifyingIds` e `hypotheses` saem de `intervalSpecs` **antes** de qualquer filtro de tier | **feita** em 2026-08-20 |
| **nada impõe o piso 0,50 do misto na v1**: o gate é diagnóstico por emenda (§ 3.1), o número sai no relatório e no perfil, e a barreira contra um model card que omita a limitação é **prosa mais teste de presença**, não mecanismo. O recall esperado é da ordem de 11–20 % pela literatura e pelo corpus morto, logo a v1 pode sair avisando em **menos da metade** dos textos que a própria política define como positivos de aviso. Rearmar exige formulação nova **e** piso com fonte, e dimensionamento próprio por D0b sobre a coorte de 240 do bloco cego. A **aceitação escrita** deste resíduo é ato do operador e não consequência automática da ratificação do desarme: ratificar que o gate não decide não é o mesmo que assinar que a v1 pode sair cega | v2, ou a unidade que trocar a formulação; a aceitação escrita e a declaração da limitação vencem na Fase 6 |
| o **eixo de operação de primeira classe não existe**, e o que resta é o eixo LIDO em vez de inferido: `groups.promptTemplate` carrega o **digest do template**, não a operação. O plano já torna irrepresentáveis duas identidades da mesma operação numa ilha (`mixingTemplates` é mapa chaveado pela operação), mas nada no **esquema** o recusa. A `proxyReason` selada de `resampling.estimandClasses.mixed.levels[1]` já diz o que é verdade sobre isto — nenhum eixo do schema v4 registra a operação, porque `mixOperation` é campo da linha de POOL e `mixed_record` não o carrega para o registro selado, cujos `MIXTURE_KEYS` e `GROUPS_KEYS` são fechados; e `promptTemplate` carrega três níveis por ilha, um por operação, então o fator não é degenerado **mas operação e template ficam colineares dentro da ilha**, e reamostragem alguma os separa. Um eixo próprio é o que separaria | v2 — é mudança de `V4_GROUP_AXES` e move o `evaluatorDigest` |
| a **dependência de ordem** não está fechada no lab: além do estrangulamento consertado em `baseline_tfidf.py`, `diagnostic_probes.py` tem quatro sítios que montam `features`/`targets` na ordem do jsonl e dividem com `StratifiedKFold`, que particiona por POSIÇÃO — `:323` (`_stratified_out_of_fold_probabilities`, consumida por `probe_partitions`, **a sonda que decide**, e por `probe_lanes`), `:547` (`probe_length`) e `:1254` (`probe_stylometry`). Nenhum renderiza a entrada antes de dividir. A contagem "um estrangulamento" vale DENTRO de `baseline_tfidf.py` e está fixada por teste com esse escopo | unidade que tocar as sondas diagnósticas, ou a Fase 5 |
| a bateria de **quarenta mutações** que a mensagem de `a028c8a` alega **não tem portador rastreado**: o único arquivo que traria a tabela está sob `.gitignore:63` e registra **23**, não 40. Não é retratação — é ausência de evidência, e ela é permanente: reconstruir a bateria hoje produziria outra. Consequência: a Fase 6 **não pode citar aquela bateria como evidência** | declarado, sem conserto possível |
| a **fila do cross-review de dez unidades**: R1 pagou o `consolidado-c`, R2 o `consolidado-w1`, e as ondas **A1**, **A2** e **A3** (2026-08-11) pagaram **os nove** que mordiam agora — `validate` recusando antes de selar, o eixo do ledger por totalidade, o manifesto com guarda de localizador, o piso barato pareado por fatia, o `extractionRun` carimbado pelo extrator, a pertença de célula exigida no selo, o recibo do gate dentro do artefato selado e a lista de união reduzida a cinco eixos com critério. **Nenhuma das nove morde agora**, e as catorze de pré-publicação estão **todas pagas**: a errata do ordinal do quantil (2026-08-10), as seis da onda **B1**, o parser de `BenchmarkReport`, as duas erratas numéricas (0,041 → **0,0369**; as 16.000 linhas declaradas como recomputação de `m=4` contra as 17.940 que a Etapa 0 custava sob `m=7`), a declaração de que a bateria de quarenta mutações do Commit A **não tem portador rastreado**, e as três da onda **B2** (a aritmética de quatro células rotulada contrafactual com o ramo e o limite medidos, a unidade de independência com uma só grafia, e a costura de igualdade dos eixos reportados). **A fila dos 23 bloqueantes confirmados está fechada** — e todas devem rodada de codex, **14 que mordem antes de publicar** e **31 menores** ainda não refutados um a um. A auditoria e o que foi refutado estão no registro (§ "A auditoria de 2026-08-10"); a onda A1, com as duas rodadas de revisão que ela precisou, em § "A onda A1" | fechada; a dívida que resta é a de codex |
| nenhum vínculo F6 prova em que corpus os pesos atuais foram treinados. O que existe agora é a **metade local**: os dois recibos do lab gravam seed, path e `sha256` da política, backbone, `sha256` do `config.json` do checkpoint, bytes do int8 e contagem do vocabulário — nada que ligue os pesos ao corpus, ao split ou ao relatório do gate antiartefato | antes de publicar pesos |
| o lado **ONNX** da degenerescência não foi executado por ninguém: `torch.onnx.export` exige o módulo `onnx`, que não existe no `python` 3.11 desta máquina nem no `py -3.13` do lab, então § 5.9 mede o lado torch (logito `[0,0]`, `P(ai)` 0,5) e a paridade dos dois lados fica sustentada por eles lerem os **mesmos** pesos. A guarda de dispersão é medida por fixture; o export real é a Fase 4 | Fase 4, na primeira corrida do operador |
| nenhum teste **semântico** amarra as três pontas do artefato servido: vocabulário real, as três entradas do grafo emitido e as três que `src/inference/onnx-classifier.ts` alimenta (achado M3 do `consolidado-w1`, não fechado em R2). O que existe é cada ponta sozinha — a forma do grafo é **observada** no artefato, a contagem de linhas do vocabulário é conferida no checkpoint e no bundle, e o runtime tem os próprios testes. Fechar exige artefato ONNX real (`onnxruntime` não existe no interpretador do lab) e atravessa a fronteira TS↔Python | unidade que rodar o export real, ou a Fase 4 na primeira corrida do operador |
| o piso de degenerescência depende da **composição** da amostra, e a composição é garantida por construção (metade de cada classe) e não por medição do arquivo real de treino: a suíte mede o sorteio sobre fixture agrupada, e o teste que o mede sobre `benchmark/data/dataset/dev.jsonl` **pula** quando o arquivo não está no checkout (é gitignored) | unidade que rodar o export real |
| o fallback sem `optimum` de `export_onnx.py` chama `torch.onnx.export` com `input_names`/`dynamic_axes`, que é a API do exportador **TorchScript**; em `torch` ≥ 2.9 o exportador default passou a ser o baseado em `torch.export` e a chamada emite `DeprecationWarning` (medido em 2.13.0). O ensaio de § 5.9 precisou de `dynamo=False` explícito para tomar o caminho legado. O caminho documentado no runbook instala `optimum`, então o fallback não roda lá — e fixar o `kwarg` quebraria `torch` antigo, que não o aceita | unidade que tocar o export, ou a Fase 4 se o operador rodar sem `optimum` |
| o teste que confere a forma selada contra a **testemunha** (`public/models/cleanfeed-ptbr-v1/config.json`) é o único do arquivo que **pula** quando o bundle não está no checkout — o bundle é gitignored. O que sempre roda é o pino literal de oito campos mais a asserção de que os dois descritores rastreados ainda declaram o `sha256` daquela testemunha: um repack move os descritores e obriga a rederivar a forma | unidade que rastrear a testemunha, ou a Fase 6 |
| `assemble_corpus` escreve **`topic: "geral"`** constante em todo registro, então a fatia por tópico existe, é lida e tem **uma** chave: o eixo, a tabela e as duas barreiras estão medidos por teste, e o que falta é material. Enquanto `topic` for constante a sonda não pode responder se a taxa desaba nos tópicos ralos, que é a pergunta pela qual ela existe | unidade que der um tópico ao extrator, ou a Fase 3 item 2 |
| a família reservada que a v1 vai usar (`gpt-oss-120b-medium`, pesos abertos) **não tem material fresco**, então o critério de facilidade foi exercitado contra `gpt-5_6-luna`, que é modelo de fronteira. A comparação que o critério existe para decidir só é possível quando a reservada real tiver linhas | Fase 3, item 2 |
| a pontuação das sondas de tema exige `onnxruntime`, que **não existe** no interpretador do lab (`py -3.13`); ela roda em `python` 3.11. Os testes das sondas são stdlib/numpy/sklearn e rodam onde a suíte roda, mas a corrida de smoke não é reproduzível de um `py -3.13` limpo | unidade que unificar o ambiente do lab, ou a Fase 5 |
| o corte de **512 tokens** do pontuador faz dos três braços do mascaramento três janelas diferentes em **9 das 240 linhas** (6 `ai`, 3 humanas, medidas com o tokenizador do snapshot): o mascaramento encurta, então a janela do braço mascarado cobre mais documento que a do original e nessas linhas o delta não é "o mesmo texto menos as entidades". `--max-length 512` está fixado no runbook e a contagem publicada em § 5.8; corrigir de verdade exige janelar por documento | unidade que levar o janelamento selado ao lab |
| o piso **cego a tema** é `funcionais` (0,9313) e **não** a união (0,9767): a união é o piso barato do critério O4 e não limita fração temática nenhuma. Enquanto a estilometria contiver medidas de diversidade lexical, nenhum número que a inclua pode ser publicado como limite superior do temático | permanente — é regra de leitura, não dívida de material |
| o achador de entidades do mascaramento **sub-mascara** por desenho: um capital que só abre frase sobrevive quando a forma não é evidenciada no meio de outra frase do mesmo documento. Sub-mascarar empurra o veredito para `survives`, então a fração de palavras mascarada viaja junto do veredito — e um `survives` sobre fração baixa não é resposta | unidade que introduzir um tagger no lab (hoje `ner_pilot.py` exige `transformers` + `torch` e dois downloads) |
| a data que a mensagem de cota do codex imprime é um **selo de fim de janela recalculado a cada estouro**, e lê-la como "a cota não voltou" **inverte o sentido do dado** — erro cometido e registrado em 2026-08-10. `Aug 16th, 2026 6:51 PM` aparece **quatro** vezes na árvore, todas as quatro dentro dos dois arquivos `*COTA-ESGOTADA*` escritos em 2026-08-09 às 22:04: a sonda do dia seguinte releu a mesma string que o estouro da noite anterior já havia gravado, e não descobriu nada. Uma data futura só afirma que a **janela atual** está fechada | permanente — é regra de leitura |
| a **sentinela do runner mente sobre sucesso**: `run-codex-dez-unidades.sh:20` escreve `===CODEX-<u>-PRONTO=== N bytes` **depois** do `EXIT=$?` e **sem condição**, então `.sentinelas.log` diz `PRONTO` para as dez unidades, inclusive as duas que morreram na cota. Quem auditar pela sentinela lê 10/10 concluídas; o que separa o sucesso do estouro é o tamanho (20-23 KB de eco de prompt contra 0,7-3,3 MB de veredito) e a linha `EXIT=` | qualquer runner novo que emita sentinela |
| o lado **selado** não impõe a reserva OOD: `sealDataset` confere positivos por família declarada, não que as reservadas estejam fora do treino | Fase 3, item 3 |
| o lado **selado** não confere licença registro↔fonte: `auditRecords` junta `sourceId` e ignora a licença. **Custo zero por este produtor, medido**: `source_licenses` projeta a `licenseId` da entrada A PARTIR dos registros e recusa fonte com duas licenças (`SourceCarriesTwoLicenses`), então o desacordo registro↔fonte não é construtível pelo caminho que existe. Um segundo produtor o constrói | segundo produtor de corpus |
| fonte sob **duas** licenças recusa a montagem, e o remédio (dividir a fonte por licença, ou licença por registro no esquema selado) é decisão de esquema. Deixou de ser urgente: a Carolina, que era a fonte alcançável, saiu da moldura | quando uma fonte **em moldura** declarar duas licenças |
| a moldura de uma célula deixa **`non-commercial` sem licença que o imponha**: as obrigações medidas são `attribution` + `share-alike`, e o regime NC passa a apoiar-se só em `commercialUse: false` | a **assinatura** de B1 — o ramo já está escolhido (risco assumido por escrito), e é nela que o operador declara o que assume |
| `hardNegativeFamily` é atribuída por **pertença de célula**, não por leitura de estilo: `tag_hard_negatives` etiqueta as primeiras `tag_per` linhas ainda sem etiqueta da célula de que a família é lida. A cobertura que o selo exige está satisfeita (20 linhas em cada uma das seis, § 5.4b), e o que a etiqueta **não** afirma é que a linha exibe o estilo — ler estilo é ato de revisão humana, que a v1 não faz (R4) | unidade que introduzir revisão humana por registro, ou a v2 |
| a reserva OOD não foi **dimensionada**: com os pools de hoje ela encheria o bloco cego e seria recusada | Fase 3, item 2 |
| `generatorVersion` na união do split colapsa a classe gerada por versão | Fase 3 |
| `cc-by-4.0` e `public-domain` sem termos revisados em `CORPUS_LICENSE_REGISTRY` — custo zero hoje, medido | quando um documento em moldura declarar uma delas |
| `train_detector.py` não confere o relatório do gate antiartefato; hoje o único caminho até um `train.jsonl` passa pela montagem | segundo produtor de corpus |
| `make_mixed.emit` escreve `text: edited` **sem** `common.normalize_text`, enquanto todo pool escrito por `CandidateWriter.offer` normaliza: 8,67 % dos vãos mistos carregam corrida de espaço e 5,29 % espaço terminal, contra 0 em 11.000 linhas ptwiki e 0 em 19.673 `ai`. O gate acusa corretamente (é rótulo de graça), e regenerar a lane não conserta escritor. **O remédio, porém, NÃO é chamar `common.normalize_text` no escritor, medido em 2026-08-18 por cinco lentes:** (i) a chamada teria de entrar ANTES de `compute_mixture`, porque os vãos são offsets sobre o texto editado e normalizar depois deixa o último vão apontando fora da cadeia escrita (77 contra 73, medido) — e a jusante ninguém reclama: o montador recomputa `aiFraction` sobre denominador errado e o gate fatia a cadeia errada; (ii) normalizar dentro de `emit` é INSUFICIENTE, porque o veredito de banda é decidido FORA dele e antes (`make_mixed.py:451` e `:628`) sobre texto cru, então a linha escrita carregaria fração que portão nenhum aprovou — medido nas duas direções, 0,4286 (nível 40) para 0,4521 (banda nenhuma) e 0,5621 (descartado) para 0,5444 (nível 50 aceito); e (iii) `common.normalize_text` é MAIS FORTE que a regra selada (`corpus-import.ts::normalizeCorpusText`, só CRLF/CR para LF e NFC), então normalizar com ela escreve pool que a ingestao não reproduz — a docstring que dizia espelhá-la era falsa e saiu. **E há um defeito MAIOR que o espaçamento, medido no mesmo lance:** o pai vem normalizado (por `offer`) e o editado vem cru, então a assimetria NFC corrompe o próprio diff — texto editado em NFD contra pai em NFC dá 6 vãos e `aiFraction` 0,5263 (nível 50, dentro da banda) contra 2 vãos e 0,2037 quando os dois lados são normalizados: a linha declararia nível 50 sobre um texto que é 20 % de IA. **A regra foi DECIDIDA em 2026-08-19: a do LAB** (`common.normalize_text`), ratificada pelo operador com consenso do codex, e a normalização passou a ser a REPRESENTAÇÃO CANÔNICA da pista — corre antes do diff, da banda e do `emit`, nos dois modos (`make_mixed.canonical_text`). O preço está escrito: o `text` guardado é texto canônico e não a resposta verbatim, e não há no repositório alegação de fidelidade byte a byte que isso falsifique (procurado em `benchmark/lab`, `docs` e `benchmark/*.ts`). **DUAS dívidas nascem com ela.** (i) **PAGA em 2026-08-19, e medida nas duas direções.** Antes dela, reduzir `canonical_text` à identidade deixava a suíte do lab indistinguível — 712/518, exatamente igual —, porque nenhum caso afirmava o campo `text` da linha escrita e os dois que dirigem os dois modos usam fixture canônico POR CONSTRUÇÃO. Hoje a mesma mutação derruba dois casos: `test_a_linha_ESCRITA_e_canonica_nos_dois_modos`, cujo fixture é adversarial de propósito e cuja forma canônica é exatamente o fixture do caso vizinho, e `test_dois_pares_que_diferem_SO_em_espaco_colidem_no_dedup`, que afirma a colisão como DELIBERADA e não incidental. (ii) Continua aberta: a canonização é **PROSPECTIVA**: 235 das 2.135 mistas em disco estão na representação antiga, `already_done` chaveia por `parentId` e `--output` é append, então fechar exigiria apagar os dois `.jsonl` antes de reexecutar — "regenerate the lane" é no-op. **E o que a barrava não é mais mecanismo:** o slate serve as 60 identidades e `island_plan` aceita toda ilha, então `--from-pairs` roda **sem cota nenhuma** — ele lê os três arquivos de pares, que não são tocados, e reescreve o `--output` na representação canônica; só a metade `--generate` depende de cota. O que resta é **ato do operador**: apagar `mixed_candidates.jsonl` e `mixed_from_pairs.jsonl` é apagar material, que é nunca delegado, e sem apagar, o `--output` em append e o `already_done` por `parentId` fazem de "regenerate the lane" um no-op. O material está copiado FORA do repositório em `repositorios/snapshots/mixed-pre-canonizacao-2026-08-19/` com `SHA256SUMS.txt`, os cinco arquivos (os dois de saída e os três de pares), que é a precondição de qualquer deleção futura. Medido no material: dos 940 pares agy, 166 mudam de `aiFraction` e **4 mudam o veredito de banda**, entre eles `src_ptso_ccb531bc78bb`, que está no pool declarando nível 15 (0,198885) enquanto a forma canônica (0,201887) cai FORA de banda | Fase 3, quando existir pool misto novo |
| **train/serving skew de normalização, medido**: `contracts/text-normalization.ts` roda só na **inferência**; `train_detector.py` e `build_dataset.py` não normalizam. Então os invisíveis chegam ao treino (0,59 % das linhas humanas em moldura os carregam) e **não** chegam ao serviço, e o texto que ajusta o limiar não é o texto que o runtime pontua | unidade que tocar treino ou limiar, ou a Fase 5 |
| as taxas por sonda do gate (§ 5.4 e L12b) foram medidas por **script de sonda que não está no repo**: os pools são `benchmark/data/*`, gitignored, então nenhuma das taxas é reproduzível de um checkout. A regra de calibração está imposta por fixture e as duas recusas por teste nomeado — o que falta é o **medidor**. As taxas de § 5.7 têm o medidor no repositório (`diagnostic_probes.py --pools … --in-frame-pools`, com a invocação exata em § 5.7 e a procedência por arquivo dentro do próprio relatório) e a mesma dívida de material | unidade que voltar ao gate |
| os números **de pool** de § 5.4b saem de código que está na árvore — `extract_wikipedia.py` para a extração, e `assemble_corpus.py --candidates-dir` para a união, a poda global, os 4.097 documentos de origem, as seis famílias hard-negative e a recusa `HeldOutReserveEmpty`. Os números **do corpo estampado** (componentes, faixas, digests, auditoria, preflight) precisam de um arnês que monte a classe humana **só** e pare antes da selagem, e é ele que não está na árvore: o montador completo não chega ao corpo escrito enquanto a classe gerada não existir. Não é a dívida da linha acima — aqui o medidor é o próprio montador, e o que falta é um modo de parada | Fase 3, item 2 (quando a classe gerada existir, o montador completo produz o corpo), ou unidade que dê a `assemble_corpus.py` um modo "classe humana só" |
| a **sonda 1 não é imposta por consumidor**: ela recusa pelo código de saída do próprio comando, e `assemble_corpus.main()` não a chama — o montador é stdlib-only e uma validação cruzada de 5 dobras rodaria em cada fixture de montagem, a maioria com menos linhas por partição do que há dobras. Mesma forma da dívida do relatório do gate antiartefato, e mesmo dono | segundo produtor de corpus, ou a Fase 3 quando existir corpus carimbado |
| a **dispersão entre janelas é quase vacuosa neste material**: 9.559 de 9.707 documentos varridos têm uma única janela a 510 tokens (§ 5.7), e a mediana de ~100 palavras fica muito abaixo de uma janela também em subtokens WordPiece (~350-400 palavras). O sinal existe e separa 4× onde há mais de uma janela; o que não existe é população | Fase 5, ou unidade que tocar agregação |
| a dispersão do lab lateia tokens de **espaço** onde o runtime lateia **WordPiece**: a regra é a selada (`contentTokens`/`overlapTokens`/`maxWindows` lidos do manifesto), a unidade é mais grosseira, então as fronteiras não são as do runtime. Declarado, e a sonda não decide | D24 (chunker em `contracts/`), quando existir um tokenizador no lab |
| as **frações por faixa congeladas na pré-inscrição estão ERRADAS, medido** (§ 5.1b): `expectedBlindBlockLines` apropria 238/239/204/119 a partir de uma varredura das primeiras 60.000 páginas do dump, e a extração real de 394.414 artigos realiza **271/269/192/68**. A faixa `[300,+∞)` é a que dói: 8,53 % da população contra os 14,89 % congelados, teto de **6,24 %** contra os **3,62 %** que a política publica e que o model card imprimiria. As faixas são **diagnóstico** — não decidem, não gastam alpha, `m` continua 4 —, e o parser confere a soma contra `blindBlockLinesAtCollectionTarget` e cada teto contra `1 − α^(1/n)` do próprio `n`, **nunca** a fração: os quatro valores são internamente consistentes e externamente errados. Corrigi-los move `evaluatorDigest` (a política está em `EVALUATOR_FILES`) e é emenda de pré-inscrição sobre a ESTRUTURA da população, legítima enquanto nenhum resultado foi visto (§ 3.4) | unidade que emendar a pré-inscrição, **antes** da Fase 6 — o model card é onde a tabela é publicada |
| `benchmark/split-audit.ts` tem o **seu** `lengthBucket` (`short`/`medium`/`long`, cortes em 100 e 300) sob o mesmo nome de eixo que a faixa pré-inscrita, e não deriva da pré-inscrição: são tabelas com trabalhos diferentes (exposição de cluster contra taxa publicada) e nenhum número as compara, mas o **nome** colide dentro do próprio benchmark | unidade que tocar o audit do split |
| a agregação por bucket de `profile-artifact.ts` decide **menos** do que lê, e agora decide **nada**: sem corte de ação pré-inscrito, `action.available` reprova em toda corrida certificadora, a decisão teta em `indicator-only` e `ceilingFor` devolve `indicator` sem consultar `bucketAuthorizesAction`. `RUNTIME_BUCKET_CONSTITUENTS`, a sobreposição `150_299` e `assertLengthBandsAreMapped` ficam medidos por teste e vivos por desenho — é a fiação que uma promoção da Fase 4 move primeiro | unidade que mexer na regra de decisão dos gates, ou a Fase 4 |
| `frozen.thresholds` e `frozen.calibrators` são **selados e não lidos por nenhum decisor**: o `fit` os ajusta como insumo da v2 e nem a medição nem o perfil servido os consultam. O risco não é o desperdício, é a **religação silenciosa** — um consumidor futuro que os leia volta a comparar número de escala calibrada com escore cru. Três barreiras: `buildEvaluationItem`, que só recebe o corte; `assertServedCutIsTheMeasuredCut`, que recusa o perfil divergente; e `measuredCalibrationScoreBasis`, que faz o gate de calibração recusar a hipótese se algo transformar o escore no caminho. A função que fazia a religação sozinha (`applyFrozenCalibration`) foi removida com o teste que a cobria | v2, quando o calibrador voltar a decidir |
| a guarda de `localizedIndicator`/`documentAction` em `assertServedCutIsTheMeasuredCut` **não tem entrada que a alcance**: os dois valores são produzidos pelo próprio `buildProfile`, então só uma mutação do produtor a exercita (M-E da bateria, vermelha). É a forma inversa da dívida comum — não é ramo morto, é guarda cujo único adversário é uma edição do código ao lado | segundo produtor de perfil, ou a Fase 4 |
| `NEVER_THRESHOLD` e o ramo `>= NEVER_THRESHOLD` de `toRuntimeThreshold` não têm estado alcançável para `documentIndicator`: um escore cru está em [0,1] por esquema. A função segue como guarda de faixa, e a recusa do sentinela (`PROFILE_CUT_AT_DISABLED_SENTINEL`) é o que hoje morde na fronteira | unidade que tocar a publicação de perfil |
| a população que ajusta o corte **decide** agora, e nenhum piso pré-inscrito a guarda: as 600 linhas de `dev` + `cal-A` deixaram de ser insumo de um limiar diagnóstico e passaram a ser insumo do limiar que corta o bloco cego. `powerFloors` cobre negativos de FPR, positivos de recall e unidades de amostragem — não esta | unidade que tocar `threshold`, ou a Fase 5 |
| o § 3.3 do **runbook** descreve o manifesto de fontes campo a campo na **v1**, sem `materialBatches`, e o exemplo nomeia `src_carolina`, que saiu da moldura. O callout de v2 e o passo `build_governance.ts` estão lá, então quem seguir a ordem dos comandos não produz mais o manifesto que a auditoria bloqueia — o que falta é reescrever o corpo campo a campo, como o § 2 ainda deve para o v4. A consequência de seguir o corpo velho está **medida**: `status=blocked` com 4.000 `SOURCE_REFERENCE_MISSING` (§ 5.4b) | unidade que reescrever o campo-a-campo do runbook |
| README do benchmark está **3 subcomandos atrás** do CLI | unidade que reescrever o README |
| linhagem admite pai `notApplicable` numa linha `ai` sem recusa — a pergunta de desenho está aberta | unidade que tocar linhagem ou E3 |
| registro-linha congelado em `cal-B` não tem a proteção do de `test` | antes da v2.0, ou antes de um segundo corpus sobrepor um split vivo |
| `worker-protocol` admite `sourceLock: undefined`; a revalidação morre como `TypeError` sem código | — |
| F0-9 — duas telas antigas com over-claim de autoria humana | — |
| bundles servidos (`public/`, `dist*`) carregam arquivos legais pré-Fase-0 (MIT como licença dos pesos) | Fase 6 — e a **assinatura** de B1 espera por ela: aprovar `license-review.json` antes assinaria pacote com arquivos legais sabidamente errados |
| o denominador da cota por células **DECLARADAS** é indistinguível do por células **PRESENTES** enquanto a moldura tem uma célula: com `len(QUOTA_CELLS) == 1` declarado ≡ presente, e nenhum corpus separa as duas escolhas. A escolha está escrita em `balanced_humans` e pinada na lista da moldura, não medida | a segunda célula |
| a população que ajusta o limiar provisório caiu de **1.050** para **600** linhas com a emenda da moldura (`dev` 5 % + `cal-A` 10 % sobre 4.000): o corte passa a ser o 30.º maior de 600 em vez do **52.º** de 1.050 — o índice é `ceil(q·n)` **zero-based** (`provisional-threshold.ts:243-244`), que deixa `n − ceil(q·n)` sorteios no corte ou acima: 1.050 → 998 → 52, e 600 → 570 → 30. O "53.º" que esta linha publicava era o número da convenção `ceil(q·n) − 1`, que o comentário do próprio código recusa por nome. Nenhum piso pré-inscrito guarda essa população — `powerFloors` só cobre negativos de FPR, positivos de recall e unidades de amostragem | unidade que tocar `threshold`, ou a Fase 5 |
| timeouts de 20 s sob contenção de I/O em **caminho selado**: `consume-holdout.test.ts`, `digests.test.ts` (`observeEvaluatorFiles`), `slices.test.ts` e um teste de UI de `tests/unit/options/` reprovam sob contenção e passam isolados. Medido em 2026-08-10: **duas** corridas de vitest simultâneas produzem 3 a 4 dessas falhas, e a corrida sozinha produz zero. Não é defeito de política; é a suíte competindo por disco, e a leitura correta exige rodada ÚNICA | rodada própria |
| a varredura recursiva de `benchmark/` em `calibration-profile-contract.test.ts` — a que proíbe import de `src/` em módulo de benchmark — morre como `ENOENT … scandir` se um subdiretório desaparecer no meio da caminhada: `readdir(recursive: true)` não tolera árvore que muda embaixo dele, e a chamada não trata o erro. É um terceiro modo de falha, distinto dos dois timeouts acima: não é timeout nem disputa por disco | unidade que tocar a varredura |

---

## 8. Ordem de leitura

1. **este arquivo**;
2. `superpowers/plans/2026-08-03-plano-entrega-modelo.md` — **o roteiro de execução**: sete fases até o
   modelo publicado;
3. `superpowers/plans/2026-08-03-decisao-de-corte-A-ou-B.md` — a decisão de corte, preenchida (opção C);
4. `MANIFESTO-DE-TRANSPLANTE.md` — o dia zero de um repo novo; ocorre **depois** da entrega, se ocorrer;
5. `superpowers/plans/2026-07-30-v1-escopo-e-retomada.md` — **como trabalhar** e as armadilhas. A parte
   de estado dele está **superada por este arquivo**;
6. `superpowers/plans/2026-07-30-registro-de-decisoes.md` — a **razão** de cada decisão; procure a seção;
7. `corpus-collection-runbook.md` — a ordem dos comandos da coleta e da montagem;
8. `detector-rebuild-assessment.md` — os oito defeitos de 25/07;
9. `references.md` — as referências, ancoradas por decisão;
10. `glossario.md` — os termos, com a área de origem de cada um e onde ele morde aqui.

Superado como estado: `superpowers/plans/2026-07-30-estado-do-projeto.md` — permanece como razão das três
decisões de 2026-07-30. Dormente, consulta e não execução:
`superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`.
