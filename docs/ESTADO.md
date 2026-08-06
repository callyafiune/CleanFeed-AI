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

**Última reescrita:** 2026-08-06

---

## 1. Onde está

| item | valor |
|---|---|
| branch | `cleanfeed-mvp` |
| suíte | 171 arquivos / 2.816 testes (vitest) + 431 testes e 84 subtests (pytest, lab). Verde em rodada limpa; sob contenção de I/O, dois arquivos de caminho selado batem no timeout de 20 s — dívida de § 7, não de política |
| dos quais, o avaliador | 1.876 — 1.445 em 45 arquivos de `benchmark/tests`, 431 no lab |
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
| | a união do split roda sobre **sete** chaves (`GROUP_KEYS`): `author`, `source`, `generatorVersion`, `promptTemplate`, `generationBatch`, `nearDuplicate`, `derivationRoot` — duas linhas com o mesmo valor caem no mesmo agrupamento, sem condição. `derivationRoot` entra **também** por linhagem de pai (`PARENT_LINKAGE_AXES`), que é a única relação de `humanSeed`: une quando o valor **nomeia o id de outra linha presente no mesmo conjunto**, e 782 de 783 referências de pai não resolvem. `axisConnectivity` é a função que separa as duas relações; ler indivisibilidade da lista de pertença já publicou alegação falsa de independência uma vez | código |
| | `domainSource` e `sourceMaterialBatch` são eixos **reportados** (`REPORTED_GROUP_AXES`), nunca de união: a dependência do lote é carregada por registro, manifesto e ledger (`splitUnionsOnDependencyAxis: false`) | OP |
| | **unidades independentes** = componentes conexos por **documento de origem**, com ≤ 1 linha por documento por célula | OP |
| | identidade do dataset: `dataset.id` = **`cleanfeed-ptbr-cells-v1`**, `intendedDomain` = **`scoped-cells`**. `ptbr-generic-v1` é **recusado por nome** (`dataset.refusedIds`, código `DATASET_ID_ABANDONED`), não apagado | OP |
| | composição de release comparada por **igualdade exata** em `sealDataset`: `human` **4.000** (1 célula × o alvo de 4.000), `ai` **4.000**, `mixed` **2.000** — total 10.000 (`RELEASE_CORPUS_POLICY.counts`) | OP |
| | manifesto de fontes na **v2**: `materialBatches` é obrigatório e entra na projeção do `sourceManifestDigest` sem condição. Um lote declara `batchId`, `sourceId`, `materialVersion`, `acquisitionWindow` e `evidence` não vazia | código |
| | o **produtor** do inventário é `benchmark/lab/build_governance.ts`, que escreve v2 e nada mais. Os lotes são **DECLARADOS** ali (`DECLARED_MATERIAL_BATCHES`) e nunca derivados dos pools, porque `materialVersion`, `acquisitionWindow` e `evidence` são fatos de um download que nenhum código deste repositório observou. Duas recusas, antes do primeiro byte escrito: inventário **vazio** (`MATERIAL_BATCHES_EMPTY`) e lote cuja `sourceId` o manifesto não declara (`MATERIAL_BATCH_SOURCE_UNDECLARED`). A dos lotes vazios **não é alcançável pelo `main()` de hoje**, que passa uma constante de um elemento: ela guarda um produtor que **derive** a lista, e é por isso que a lista chega por parâmetro em vez de ser lida da constante — contra a constante embarcada, um escritor que pulasse as duas conferências responderia igual a um que as roda | código |
| | **gate de composição** (`benchmark/composition-gate.ts`): três quantidades por célula, só em `test` — linhas de negativo humano elegíveis, unidades de amostragem, e linhas por documento de origem. A recusa nomeia célula, contagem e piso | código |
| | **preflight de viabilidade** (`benchmark/viability-preflight.ts`, `preflight-viability`): condições necessárias antes do split, comparadas **por classe** e também sobre o corpus inteiro — passar não prova que o corpus é divisível | código |
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
| D19 | o baseline (`benchmark/lab/baseline_tfidf.py`) roda **duas** vetorizações em paralelo, palavra (1,2) e caractere (3,6) com `analyzer="char"`, num registro que impede rodar uma sem a outra. O papel é **detector de vazamento**: desempenho alto continua significando artefato de fonte | AG |
| A4 | gate antiartefato **pré-treino**, em código (`benchmark/lab/artifact_gate.py`): **dez** detecções — eco de prompt, recusa, metaconversa, assinatura de harness, espaço anômalo, encoding, caractere invisível, Markdown, cabeçalho, frase-padrão de prompt —, teto de contaminação em `Fraction(2, 100)`, comparado **por família geradora** e nunca com o agregado do conjunto gerado, relatório escrito **antes** do veredito e sem nomear linha | OP |
| | a fração do teto é **por LINHA**: uma linha com duas detecções é UMA linha contaminada com as duas razões nomeadas, e a soma por detecção pode exceder a contagem de contaminadas | código |
| | o gate acusa o que `contracts/text-normalization.ts` **remove** antes da tokenização: o que ele mede é contaminação da lane, não a entrada do modelo. A tabela de sondas cobre os **27** code points do contrato, afirmado por **igualdade de conjuntos** contra o literal do lado TypeScript: um code point acrescentado lá sem sonda aqui deixa o teste vermelho | código |
| | calibração das sondas: a **união** das dez detecções sobre a classe humana **em moldura** (ptwiki) fica **abaixo** do teto — 0,809 % medido. Sonda cuja direção é invertida e cujo lado humano passa do teto é **recusada**, e a regra é imposta por teste que roda o gate sobre uma fixture de 1.000 linhas com as formas recusadas dentro (1,0 % contra teto de 2 %) | AG |
| | família acima do teto **regenera a lane inteira** — poda seletiva mascara o viés da lane, e o relatório não dá o que podar | AG |
| R4 | todo registro gerado nasce **`automated/unreviewed`**; a auditoria de PII é **amostral** e não produz `passed` por registro | OP |
| | linhagem: todo gerado **que declara pai** referencia pai presente; `assertDerivedParentsResolve` roda antes do split. A admissão de pai `notApplicable` numa linha `ai` é lacuna aberta (§ 7) | AG |
| | famílias OpenAI ficam **reservadas ao teste de gerador não visto** (OOD): a reserva é política nomeada do slate (`OOD_RESERVED_FAMILIES`), não prefixo, e todo papel de família geradora é **declarado** — `core`, `ood-reserved` ou `excluded` —, com censo dos pools conferido por guarda. Reserva vazia **recusa** a montagem | AG |
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
| opt-in **desligado por padrão**; disclosure persistente em cada resultado; nenhum rótulo de autoria nem confiança numérica | OP |
| proibição de uso disciplinar, acadêmico, empregatício ou decisório; não iniciar acusação formal com base no sinal; revisão humana não salva sinal não validado — exige evidência independente do processo | OP |
| os pesos viajam com a mesma política de uso — a copy da extensão não acompanha pesos extraídos | OP |
| backbone **`neuralmind/bert-base-portuguese-cased`** (BERTimbau base), `backboneBakeOff: false` — a escolha é por literatura e pela forma do pipeline, **não** por comparação de qualidade sobre os nossos dados, e nenhuma vantagem de detecção foi medida. `train_detector.py` recusa `--model` e `--seed` divergentes **em `main()`**; `export_onnx.py` recusa checkpoint que divirja em `model_type`, `vocab_size` (29 794), `hidden_size` ou `num_hidden_layers`, e grafo cujas entradas não sejam exatamente `input_ids`/`attention_mask`/`token_type_ids` | código |
| teto de export int8 **130 000 000** bytes (`onnxMaximumInt8Bytes`) — **teto, não alvo**, ancorado num export int8 real desta arquitetura de **109 681 931** bytes (fora do repositório, com `parity_report.json`: 120 amostras, `meanAbsDelta` 0,000595, 0 inversões; o mesmo número rastreado com `sha256` em `models/cleanfeed-ptbr-v1/source-lock.json` e `cleanfeed-model.json`, onde um teste o confere contra o teto), com **18,5 % de folga declarada** para opset (o artefato ancorante é opset 18; o fallback do exportador emite 14), configuração de quantização e forma da cabeça. `export_onnx.py` quantiza em staging e só publica o artefato se o teto aceitar | código |
| treino: **cross-entropy + seed `712019` pré-fixadas, sem ablação** (adamw, 3 épocas, lr 2 × 10⁻⁵, 16 documentos por batch, warmup 0,06, weight decay 0,01); segunda corrida só como retry técnico, nunca seleção | OP |
| **sem calibrador probabilístico na v1** (`threshold.probabilisticCalibrator: "none"`): o corte publicado é o **limiar provisório `provisional-v1`** — quantil 0,95 superior de `document-raw-score` sobre os negativos humanos de `dev` + `cal-A` —, versionado, jamais descrito como "conservador", "alta confiança" ou probabilidade. `evaluate` exige e confere `provisional-threshold.json`, então um `fit` sem o corte pré-inscrito não alcança a medição | OP |
| o gate de calibração mede **ECE-15 sobre o mesmo `document-raw-score`**, em bins de massa igual, com limite superior simultâneo por bootstrap e `eceMax` 0,05 | código |
| calibrador probabilístico e conformal ficam **reservados à v2** (`calibrator.reservedFor`, `conformal.reservedFor`) | código |
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
| | a etapa 3 é do **Fable** enquanto o crédito do codex não voltar; rodada do Fable não fecha dívida de codex | OP |
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
| comentário no código: só regra de domínio, restrição técnica não óbvia, ou armadilha de biblioteca |
| `node --experimental-strip-types` apaga tipos: parameter properties não funcionam na CLI |

---

## 4. Abertas — só o operador

| decisão | trava |
|---|---|
| **B1** — o **ramo** está escolhido: **risco assumido por escrito**, não parecer jurídico. Falta a **assinatura** — nome, data e a razão de assumir em vez de consultar —, que é do operador e espera o pacote da Fase 6 | publicação de pesos (Fase 7); `license-review.json` → `approved` |
| **`consume-holdout`** — o botão irreversível da medição | Fase 5 |
| re-rodar ou não o codex nas unidades do caminho selado revisadas **só pelo Fable** | no retorno do crédito do codex |

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
| `evaluatorDigest` da árvore | `a79a9ee6cf454172af5a85334c8e3f66d462d29245257b032ef1106d536c7f33` — 52 arquivos, recomputado pela função de produção e **lido por teste nomeado** (`digests.test.ts`, "is published in the ESTADO at the value the LIVE tree hashes to"), então este número não pode envelhecer em silêncio. Mover é barato enquanto `issuedAt` é nulo |
| byte de controle cru em caminho rastreado | **zero**, e imposto por dois testes nomeados, com escopos diferentes de propósito. `digests.test.ts` ("carry no raw control byte, so no code-search tool can skip an evaluator file") varre os **52** de `EVALUATOR_FILES` e **não isenta nada**, porque os bytes desses arquivos são a identidade do avaliador. `tests/unit/repo/line-endings.test.ts` ("leaves no raw control byte in a tracked path the repo calls text") varre **todo** caminho de `git ls-files`, isentando só extensão que `.gitattributes` declara `binary` — nenhuma rastreada hoje, então na prática é a árvore inteira. Os dois recusam controle C0 fora de LF, TAB e CR e apontam `arquivo:linha:coluna` mais o offset de byte. A isenção **não** é a classificação `i/-text` do git: ela é causada pelo byte cru, e filtrar por ela pularia justamente o infrator |
| ledger de exposição real | **0 bytes** — nenhum evento real foi escrito |
| holdout-ledger real | 2.638 bytes — o consumo de 2026-07-25, `decision: reject` |
| memória da exposição por linha | `benchmark/data/corpus-build/out/split/split-artifact.json` — pertença de `test`, só o operador lê |
| referências | **430** marcadores de link em **18** seções de nível `##` de `references.md`, e **48** declarações literais de "Sem precedente encontrado". A regra é a ocorrência da junta `](` seguida de URL, contada **no arquivo inteiro e não por linha**: `references.md` quebra a ~100 colunas e 38 rótulos de link atravessam a quebra, então um regex `\[rótulo\]\(url\)` aplicado por linha devolve 390. Agora **lido por teste nomeado** (`estado-counts.test.ts`) — os valores anteriores (322 / 50, depois 349) envelheceram em silêncio exatamente porque nenhum teste os lia |

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

---

## 6. NÃO APLICAR — aparecem no registro e não valem

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
| nenhum vínculo F6 prova em que corpus os pesos atuais foram treinados | antes de publicar pesos |
| rodada 13 do cross-review do E2 | crédito do codex, 8 de agosto |
| o lado **selado** não impõe a reserva OOD: `sealDataset` confere positivos por família declarada, não que as reservadas estejam fora do treino | Fase 3, item 3 |
| o lado **selado** não confere licença registro↔fonte: `auditRecords` junta `sourceId` e ignora a licença. **Custo zero por este produtor, medido**: `source_licenses` projeta a `licenseId` da entrada A PARTIR dos registros e recusa fonte com duas licenças (`SourceCarriesTwoLicenses`), então o desacordo registro↔fonte não é construtível pelo caminho que existe. Um segundo produtor o constrói | segundo produtor de corpus |
| fonte sob **duas** licenças recusa a montagem, e o remédio (dividir a fonte por licença, ou licença por registro no esquema selado) é decisão de esquema. Deixou de ser urgente: a Carolina, que era a fonte alcançável, saiu da moldura | quando uma fonte **em moldura** declarar duas licenças |
| a moldura de uma célula deixa **`non-commercial` sem licença que o imponha**: as obrigações medidas são `attribution` + `share-alike`, e o regime NC passa a apoiar-se só em `commercialUse: false` | a **assinatura** de B1 — o ramo já está escolhido (risco assumido por escrito), e é nela que o operador declara o que assume |
| `hardNegativeFamily` é atribuída por **pertença de célula**, não por leitura de estilo: `tag_hard_negatives` etiqueta as primeiras `tag_per` linhas ainda sem etiqueta da célula de que a família é lida. A cobertura que o selo exige está satisfeita (20 linhas em cada uma das seis, § 5.4b), e o que a etiqueta **não** afirma é que a linha exibe o estilo — ler estilo é ato de revisão humana, que a v1 não faz (R4) | unidade que introduzir revisão humana por registro, ou a v2 |
| a reserva OOD não foi **dimensionada**: com os pools de hoje ela encheria o bloco cego e seria recusada | Fase 3, item 2 |
| `generatorVersion` na união do split colapsa a classe gerada por versão | Fase 3 |
| `cc-by-4.0` e `public-domain` sem termos revisados em `CORPUS_LICENSE_REGISTRY` — custo zero hoje, medido | quando um documento em moldura declarar uma delas |
| `train_detector.py` não confere o relatório do gate antiartefato; hoje o único caminho até um `train.jsonl` passa pela montagem | segundo produtor de corpus |
| `make_mixed.emit` escreve `text: edited` **sem** `common.normalize_text`, enquanto todo pool escrito por `CandidateWriter.offer` normaliza: 8,67 % dos vãos mistos carregam corrida de espaço e 5,29 % espaço terminal, contra 0 em 11.000 linhas ptwiki e 0 em 19.673 `ai`. O gate acusa corretamente (é rótulo de graça), mas o remédio verdadeiro é o escritor, e regenerar a lane não conserta escritor | Fase 3, quando existir pool misto novo |
| **train/serving skew de normalização, medido**: `contracts/text-normalization.ts` roda só na **inferência**; `train_detector.py` e `build_dataset.py` não normalizam. Então os invisíveis chegam ao treino (0,59 % das linhas humanas em moldura os carregam) e **não** chegam ao serviço, e o texto que ajusta o limiar não é o texto que o runtime pontua | unidade que tocar treino ou limiar, ou a Fase 5 |
| as taxas por sonda do gate (§ 5.4 e L12b) foram medidas por **script de sonda que não está no repo**: os pools são `benchmark/data/*`, gitignored, então nenhuma das taxas é reproduzível de um checkout. A regra de calibração está imposta por fixture e as duas recusas por teste nomeado — o que falta é o **medidor**. As taxas de § 5.7 têm o medidor no repositório (`diagnostic_probes.py --pools … --in-frame-pools`, com a invocação exata em § 5.7 e a procedência por arquivo dentro do próprio relatório) e a mesma dívida de material | unidade que voltar ao gate |
| os números **de pool** de § 5.4b saem de código que está na árvore — `extract_wikipedia.py` para a extração, e `assemble_corpus.py --candidates-dir` para a união, a poda global, os 4.097 documentos de origem, as seis famílias hard-negative e a recusa `HeldOutReserveEmpty`. Os números **do corpo estampado** (componentes, faixas, digests, auditoria, preflight) precisam de um arnês que monte a classe humana **só** e pare antes da selagem, e é ele que não está na árvore: o montador completo não chega ao corpo escrito enquanto a classe gerada não existir. Não é a dívida da linha acima — aqui o medidor é o próprio montador, e o que falta é um modo de parada | Fase 3, item 2 (quando a classe gerada existir, o montador completo produz o corpo), ou unidade que dê a `assemble_corpus.py` um modo "classe humana só" |
| a **sonda 1 não é imposta por consumidor**: ela recusa pelo código de saída do próprio comando, e `assemble_corpus.main()` não a chama — o montador é stdlib-only e uma validação cruzada de 5 dobras rodaria em cada fixture de montagem, a maioria com menos linhas por partição do que há dobras. Mesma forma da dívida do relatório do gate antiartefato, e mesmo dono | segundo produtor de corpus, ou a Fase 3 quando existir corpus carimbado |
| a **dispersão entre janelas é quase vacuosa neste material**: 9.559 de 9.707 documentos varridos têm uma única janela a 510 tokens (§ 5.7), e a mediana de ~100 palavras fica muito abaixo de uma janela também em subtokens WordPiece (~350-400 palavras). O sinal existe e separa 4× onde há mais de uma janela; o que não existe é população | Fase 5, ou unidade que tocar agregação |
| a dispersão do lab lateia tokens de **espaço** onde o runtime lateia **WordPiece**: a regra é a selada (`contentTokens`/`overlapTokens`/`maxWindows` lidos do manifesto), a unidade é mais grosseira, então as fronteiras não são as do runtime. Declarado, e a sonda não decide | D24 (chunker em `contracts/`), quando existir um tokenizador no lab |
| as **frações por faixa congeladas na pré-inscrição estão ERRADAS, medido** (§ 5.1b): `expectedBlindBlockLines` apropria 238/239/204/119 a partir de uma varredura das primeiras 60.000 páginas do dump, e a extração real de 394.414 artigos realiza **271/269/192/68**. A faixa `[300,+∞)` é a que dói: 8,53 % da população contra os 14,89 % congelados, teto de **6,24 %** contra os **3,62 %** que a política publica e que o model card imprimiria. As faixas são **diagnóstico** — não decidem, não gastam alpha, `m` continua 4 —, e o parser confere a soma contra `blindBlockLinesAtCollectionTarget` e cada teto contra `1 − α^(1/n)` do próprio `n`, **nunca** a fração: os quatro valores são internamente consistentes e externamente errados. Corrigi-los move `evaluatorDigest` (a política está em `EVALUATOR_FILES`) e é emenda de pré-inscrição sobre a ESTRUTURA da população, legítima enquanto nenhum resultado foi visto (§ 3.4) | unidade que emendar a pré-inscrição, **antes** da Fase 6 — o model card é onde a tabela é publicada |
| `benchmark/split-audit.ts` tem o **seu** `lengthBucket` (`short`/`medium`/`long`, cortes em 100 e 300) sob o mesmo nome de eixo que a faixa pré-inscrita, e não deriva da pré-inscrição: são tabelas com trabalhos diferentes (exposição de cluster contra taxa publicada) e nenhum número as compara, mas o **nome** colide dentro do próprio benchmark | unidade que tocar o audit do split |
| a agregação por bucket de `profile-artifact.ts` só distingue **presença** de evidência: com `pass` todo gate de ação presente passou, porque um que reprove capa o release em `indicator-only`. A sobreposição `150_299` fica como resposta conservadora para uma regra de decisão que não capa globalmente, e hoje nenhuma entrada a exercita | unidade que mexer na regra de decisão dos gates |
| o § 3.3 do **runbook** descreve o manifesto de fontes campo a campo na **v1**, sem `materialBatches`, e o exemplo nomeia `src_carolina`, que saiu da moldura. O callout de v2 e o passo `build_governance.ts` estão lá, então quem seguir a ordem dos comandos não produz mais o manifesto que a auditoria bloqueia — o que falta é reescrever o corpo campo a campo, como o § 2 ainda deve para o v4. A consequência de seguir o corpo velho está **medida**: `status=blocked` com 4.000 `SOURCE_REFERENCE_MISSING` (§ 5.4b) | unidade que reescrever o campo-a-campo do runbook |
| README do benchmark está **3 subcomandos atrás** do CLI | unidade que reescrever o README |
| linhagem admite pai `notApplicable` numa linha `ai` sem recusa — a pergunta de desenho está aberta | unidade que tocar linhagem ou E3 |
| registro-linha congelado em `cal-B` não tem a proteção do de `test` | antes da v2.0, ou antes de um segundo corpus sobrepor um split vivo |
| `worker-protocol` admite `sourceLock: undefined`; a revalidação morre como `TypeError` sem código | — |
| F0-9 — duas telas antigas com over-claim de autoria humana | — |
| bundles servidos (`public/`, `dist*`) carregam arquivos legais pré-Fase-0 (MIT como licença dos pesos) | Fase 6 — e a **assinatura** de B1 espera por ela: aprovar `license-review.json` antes assinaria pacote com arquivos legais sabidamente errados |
| o denominador da cota por células **DECLARADAS** é indistinguível do por células **PRESENTES** enquanto a moldura tem uma célula: com `len(QUOTA_CELLS) == 1` declarado ≡ presente, e nenhum corpus separa as duas escolhas. A escolha está escrita em `balanced_humans` e pinada na lista da moldura, não medida | a segunda célula |
| a população que ajusta o limiar provisório caiu de **1.050** para **600** linhas com a emenda da moldura (`dev` 5 % + `cal-A` 10 % sobre 4.000): o corte passa a ser o 30.º maior de 600 em vez do 53.º de 1.050. Nenhum piso pré-inscrito guarda essa população — `powerFloors` só cobre negativos de FPR, positivos de recall e unidades de amostragem | unidade que tocar `threshold`, ou a Fase 5 |
| timeouts de 20 s sob contenção de I/O em **caminho selado**: `consume-holdout.test.ts` e `digests.test.ts` (`observeEvaluatorFiles`) reprovam em rodada cheia e passam isolados. Não é defeito de política; é a suíte competindo por disco | rodada própria |
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
