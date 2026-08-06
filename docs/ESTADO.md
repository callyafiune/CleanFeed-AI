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

**Última reescrita:** 2026-08-05

---

## 1. Onde está

| item | valor |
|---|---|
| branch | `cleanfeed-mvp` |
| suíte | 170 arquivos / 2.773 testes (vitest) + 417 testes e 78 subtests (pytest, lab). Verde em rodada limpa; sob contenção de I/O, dois arquivos de caminho selado batem no timeout de 20 s — dívida de § 7, não de política |
| dos quais, o avaliador | 1.820 — 1.403 em 44 arquivos de `benchmark/tests`, 417 no lab |
| typecheck | limpo |
| lint | 13 problemas (11 erros, 2 avisos) |
| tags de release | 0 |
| `issuedAt` no descritor | `null` (`models/cleanfeed-ptbr-v1/release.json`, com `gateDecision: "pending"` e `profileDigests: []`) |
| verificador de links de docs | 200 links relativos em 34 arquivos, todos resolvem |

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

Dos dois, só `smb_ptwiki-20220301` é lote de material **em moldura**; o da Carolina permanece medido e
declarado, com a fonte em `OUT_OF_FRAME_HUMAN_SOURCES`.

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
| componentes independentes na célula, hoje | 1 — sem documento de origem conhecido, toda linha da célula cai no balde único de origem irrecuperável |
| guardas de integridade do pacote | 11 exercitadas, 0 sem teste |
| `evaluatorDigest` da árvore | `18b8465f9071c35b8efa0cfc24f96d231229452715d5177b5b99ce3a06342ba6` — 52 arquivos, recomputado pela função de produção e **lido por teste nomeado** (`digests.test.ts`, "is published in the ESTADO at the value the LIVE tree hashes to"), então este número não pode envelhecer em silêncio. Moveu de `9c68b884…` com a emenda do backbone, e mover é barato enquanto `issuedAt` é nulo |
| ledger de exposição real | **0 bytes** — nenhum evento real foi escrito |
| holdout-ledger real | 2.638 bytes — o consumo de 2026-07-25, `decision: reject` |
| memória da exposição por linha | `benchmark/data/corpus-build/out/split/split-artifact.json` — pertença de `test`, só o operador lê |
| referências | **415** marcadores de link em **18** seções de nível `##` de `references.md`, e **42** declarações literais de "Sem precedente encontrado" (mais 13 menções em outra forma). A regra é a ocorrência da junta `](` seguida de URL, contada **no arquivo inteiro e não por linha**: `references.md` quebra a ~100 colunas e 38 rótulos de link atravessam a quebra, então um regex `\[rótulo\]\(url\)` aplicado por linha devolve 377. Agora **lido por teste nomeado** (`estado-counts.test.ts`) — os valores anteriores (322 / 50, depois 349) envelheceram em silêncio exatamente porque nenhum teste os lia |

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
- a leitura de que as sondas 2, 3 e 4 podem **recusar** algo: o relatório delas não tem campo de veredito.

---

## 7. Dívidas

| dívida | vence |
|---|---|
| byte NUL literal em arquivo de `EVALUATOR_FILES` (`near-duplicates.ts`) | commit próprio — o conserto move o `evaluatorDigest` |
| **inventário de material**: `build_governance.ts` escreve manifesto v1 sem `materialBatches`, então todo corpus v4 sai `blocked` com `SOURCE_REFERENCE_MISSING` por linha humana | Fase 3, item 1 — entrada declarada pelo operador para **um** lote (`smb_ptwiki-20220301`), e o manifesto passa a v2 |
| nenhum vínculo F6 prova em que corpus os pesos atuais foram treinados | antes de publicar pesos |
| rodada 13 do cross-review do E2 | crédito do codex, 8 de agosto |
| o lado **selado** não impõe a reserva OOD: `sealDataset` confere positivos por família declarada, não que as reservadas estejam fora do treino | Fase 3, item 3 |
| o lado **selado** não confere licença registro↔fonte: `auditRecords` junta `sourceId` e ignora a licença | Fase 3, item 1 |
| fonte sob **duas** licenças recusa a montagem, e o remédio (dividir a fonte por licença, ou licença por registro no esquema selado) é decisão de esquema. Deixou de ser urgente: a Carolina, que era a fonte alcançável, saiu da moldura | quando uma fonte **em moldura** declarar duas licenças |
| a moldura de uma célula deixa **`non-commercial` sem licença que o imponha**: as obrigações medidas são `attribution` + `share-alike`, e o regime NC passa a apoiar-se só em `commercialUse: false` | a **assinatura** de B1 — o ramo já está escolhido (risco assumido por escrito), e é nela que o operador declara o que assume |
| três das seis famílias hard-negative (`repetitive`, `non-native`, `motivational`) são de texto curto informal e passam a ser procuradas em lede de Wikipédia, onde são mais raras; a demanda por célula é 6 × `tag_per` numa célula só | Fase 3, item 1 — se a marcação não encher, é escassez de material e não erro de coleta |
| a reserva OOD não foi **dimensionada**: com os pools de hoje ela encheria o bloco cego e seria recusada | Fase 3, item 2 |
| `generatorVersion` na união do split colapsa a classe gerada por versão | Fase 3 |
| `cc-by-4.0` e `public-domain` sem termos revisados em `CORPUS_LICENSE_REGISTRY` — custo zero hoje, medido | quando um documento em moldura declarar uma delas |
| `train_detector.py` não confere o relatório do gate antiartefato; hoje o único caminho até um `train.jsonl` passa pela montagem | segundo produtor de corpus |
| `make_mixed.emit` escreve `text: edited` **sem** `common.normalize_text`, enquanto todo pool escrito por `CandidateWriter.offer` normaliza: 8,67 % dos vãos mistos carregam corrida de espaço e 5,29 % espaço terminal, contra 0 em 11.000 linhas ptwiki e 0 em 19.673 `ai`. O gate acusa corretamente (é rótulo de graça), mas o remédio verdadeiro é o escritor, e regenerar a lane não conserta escritor | Fase 3, quando existir pool misto novo |
| **train/serving skew de normalização, medido**: `contracts/text-normalization.ts` roda só na **inferência**; `train_detector.py` e `build_dataset.py` não normalizam. Então os invisíveis chegam ao treino (0,59 % das linhas humanas em moldura os carregam) e **não** chegam ao serviço, e o texto que ajusta o limiar não é o texto que o runtime pontua | unidade que tocar treino ou limiar, ou a Fase 5 |
| as taxas por sonda do gate (§ 5.4 e L12b) foram medidas por **script de sonda que não está no repo**: os pools são `benchmark/data/*`, gitignored, então nenhuma das taxas é reproduzível de um checkout. A regra de calibração está imposta por fixture e as duas recusas por teste nomeado — o que falta é o **medidor**. As taxas de § 5.7 têm o medidor no repositório (`diagnostic_probes.py --pools … --in-frame-pools`, com a invocação exata em § 5.7 e a procedência por arquivo dentro do próprio relatório) e a mesma dívida de material | unidade que voltar ao gate, ou a Fase 3 quando os pools forem reconstruídos |
| a **sonda 1 não é imposta por consumidor**: ela recusa pelo código de saída do próprio comando, e `assemble_corpus.main()` não a chama — o montador é stdlib-only e uma validação cruzada de 5 dobras rodaria em cada fixture de montagem, a maioria com menos linhas por partição do que há dobras. Mesma forma da dívida do relatório do gate antiartefato, e mesmo dono | segundo produtor de corpus, ou a Fase 3 quando existir corpus carimbado |
| a **dispersão entre janelas é quase vacuosa neste material**: 9.559 de 9.707 documentos varridos têm uma única janela a 510 tokens (§ 5.7), e a mediana de ~100 palavras fica muito abaixo de uma janela também em subtokens WordPiece (~350-400 palavras). O sinal existe e separa 4× onde há mais de uma janela; o que não existe é população | Fase 5, ou unidade que tocar agregação |
| a dispersão do lab lateia tokens de **espaço** onde o runtime lateia **WordPiece**: a regra é a selada (`contentTokens`/`overlapTokens`/`maxWindows` lidos do manifesto), a unidade é mais grosseira, então as fronteiras não são as do runtime. Declarado, e a sonda não decide | D24 (chunker em `contracts/`), quando existir um tokenizador no lab |
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
