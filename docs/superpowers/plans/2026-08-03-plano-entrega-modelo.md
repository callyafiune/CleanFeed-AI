# Plano de entrega do modelo — ponta a ponta

> **Fonte da verdade: `docs/ESTADO.md`.** Se este plano divergir dele, ele vence; se o código medido
> divergir dos dois, o código vence. Este é o **único** documento de plano autorizado pela decisão C
> (2026-08-03). A entrega é o **modelo** — pesos + tokenizer + model card + tabela de FPR por célula —,
> abstraído de toda questão de navegador. A extensão é consumidora downstream e está fora deste plano.

**Base de conformidade:** a medição de 2026-08-03 no registro (§ "Conformidade do implementado com o
ESTADO.md") — **36 divergências (D0–D35), 18 conformes (C0–C17)**. Este plano referencia por número e
não repete o detalhe.

## O que este plano NÃO toca (conformes decisivos)

- os 7 artefatos de `models/` e os scripts de empacotamento **já são agnósticos de extensão** (C11–C13);
  `chrome-extension://` só é exigido pelo runtime em `src/` (C12);
- `contracts/` é puro (C14); ONNX+tokenizer já são consumíveis standalone por janela (C15);
- extratores de Wikipédia e Carolina: corte de data e licença por documento conformes (C0, C1);
- a barreira de `cal-B` (C16), o bloqueio por nome do PT.SO (C5), as 4 lanes de geração (C4), o
  caminho `fit → consume-holdout → gates → publish-evidence` fail-closed (C10), e o export INT8 com
  gate de paridade (C7).

## Duas decisões de desenho deste plano (AG, com razão)

1. **A medição certificadora sai do navegador e roda no modelo** (resolve D10): um scorer standalone
   em Node (`onnxruntime-node`) que **reusa o chunker e o agregador movidos para `contracts/`** (D24 —
   são puros; a dependência era só path alias). Paridade por construção, sem port Python e sem prova de
   paridade entre linguagens. A identidade de runtime ancora no **hash dos pesos**, não no tuple
   bundle/Chrome. O navegador vira consumidor downstream também na medição.
2. **Corpus novo = zero reuso do material antigo** (simplifica D5): `drop_seen` contra **os 10.000
   textos** do corpus morto, poda global. É superconjunto da graduação de § 3.4 e dispensa restrição
   por partição. As ~1.600 linhas recuperáveis são abdicadas de propósito — o material fresco é
   abundante (o dump de 1,96 GB rende página por página, e o piso é de 300 unidades) e a prova de
   "nada visto" fica trivial.

---

## Etapa 0 — decisões do operador que precedem a Fase 1

> **DECIDIDAS em 2026-08-03**, todas na direção recomendada — mais duas ratificações da etapa de
> desenho: **G0.1-bis** (`sourceMaterialBatch` fora da união do split; unidades = documentos de origem)
> e **G0.3-bis** (coleta ~1.750/célula, ~7.000 total, piso de 300 inalterado). **Os dois números da
> coleta estão superados pela emenda da moldura de 2026-08-05:** com uma célula são **4.000** por célula
> e **4.000** de total, e o piso de 300 segue inalterado. Ver ESTADO.md § 3.

| # | decisão | recomendação do agente | bloqueia |
|---|---|---|---|
| G0.1 | ratificar `domainSource` como estrato (`sourceMaterialBatch` carrega dependência) | ratificar — é a decisão de 2026-08-01, medida | Fase 1 (eixos) |
| G0.2 | manchete: pior estrato **ou** por estrato | **por estrato** — cobertura deixa de ser punida, e melhorias futuras acrescentam linha sem degradar a manchete (§ 3.2 do ESTADO) | Fase 1 (m, α) |
| G0.3 | teto pretendido: **1,45 %** (1.500 linhas/célula ⇒ 6.000 humanas) ou **0,55 %** (4.000/célula ⇒ 16.000) | **1,45 %** — 6.000 humanas cabiam no material com folga sob quatro células. **Superado pela emenda da moldura de 2026-08-05:** com uma célula, os 0,55 % custam 4.000 linhas e não 16.000, e é esse o valor vigente | Fase 2 (alvos) |
| B1 | parecer jurídico da posição (a) ou risco assumido por escrito — **ramo escolhido em 2026-08-05: risco assumido por escrito**; falta a assinatura | — (pessoal) | **só a Fase 7** |

As Fases 1–6 correm com G0.1–G0.3 decididas; B1 só trava a publicação.

---

## Fase 1 — pré-inscrição nova (caminho SELADO; ~1 semana) — EM EXECUÇÃO

A etapa 1 (desenho, Fable) rodou em 2026-08-03 e produziu o contrato completo — 16 itens, 15 testes
nomeados pela mutação que pegam, os pins do parser e a tabela de ratificação da política. **Relatório
verbatim em `.codex-reviews/fase1-preinscricao-desenho-fable.md`** (área de trabalho, fora do Git);
o veredito está resumido no registro (§ "A etapa 1 da Fase 1 refutou o item 3").

**Correções que o desenho impôs ao plano original desta fase:**

- o item 3 original ("`sourceMaterialBatch` entra como eixo de conectividade") era **inviável medido**
  — um evento de aquisição por fonte ⇒ um bloco por célula, a mesma morte do `domainSource`. Ratificado
  (G0.1-bis): o lote é eixo de **registro/manifesto/ledger**, nunca de união; unidades independentes =
  componentes por **documento de origem**, ≤ 1 linha por documento por célula;
- `evaluate.ts` hoje não passa multiplicidade **nenhuma** (D12 era maior que o escrito): o inventário
  obrigatório de gates passa a ser **derivado** de `policy.primaryFamily`;
- `backbone` e `onnxMaximumInt8Bytes` congelam **aqui**. Congelaram primeiro com valores de XLM-R, e a
  **emenda do backbone (W1, 2026-08-05)** os refez: o selado é `neuralmind/bert-base-portuguese-cased`
  e o teto volta a ancorar num export medido, com a folga declarada. A justificativa original era
  circular — o teto foi elevado para acomodar o backbone e depois apresentado como razão de escolhê-lo;
- o piso de 300 é de **linhas** (denominador do FPR); o piso de **unidades** (componentes) é decisão
  nova, e o gate de composição conta os dois.

**Ordem de execução — 6 commits, cada um pela tríade desenho→implementação→revisão:**

| commit | conteúdo | move `evaluatorDigest`? |
|---|---|---|
| **A** | esquema **v4** (− `collectionBatch`; + `sourceMaterialBatch`, `generationBatch`, `extractionRun`; `AXIS_STATE_RULE` completo) + manifesto **v2** (`materialBatches` obrigatório, projeção incondicional) + espelhos Python | sim (`schema.ts`, `source-manifest.ts`) |
| **B** | conectividade: `GROUP_KEYS` v4 (sem `domainSource`, sem lote), auditoria reporta os dois como inventário, contraprova de viabilidade com lote-único-por-célula. **Inclui**: `auditClusters`/`standInClusterReport` (split-audit.ts:766, :564) ainda iteram `V3_GROUP_AXES` sem condição, então sobre corpus v4 o relatório de cluster do split publica `collectionBatch` com `states.unknown = N` e **omite** os três eixos novos — o espelho Python já é ciente da versão (`group_axes.axes_of`), e é o lado TS que está atrás. `DECLARED_GROUP_AXES` e o parser fechado do audit mudam com ele | sim (`split.ts`, `split-audit.ts`) |
| **C** | **a troca atômica**: `preregistration-v4.{json,ts}` com os pins, 11 sítios de import, `EVALUATOR_FILES` atualizado, identidade de dataset da política, estratos recompostos, `fit` sem calibrador. **Inclui o que o Commit A deferiu**: a tabela `resampling` re-derivada sobre os eixos v4 (o estimando `ai-recall` deixa de nomear `groups.collectionBatch`, que v4 apagou, e passa a nomear `groups.generationBatch`) **junto** do alargamento de `metrics.ts` — `V3_AXIS_NAMES` (metrics.ts:1304) era a tupla v3 e `axisLevel` estourava `RangeError` para qualquer outro eixo, então a política nova era inalcançável e a política velha congelaria um eixo morto no selado; as DUAS falhavam, e é por isso que os dois entram no mesmo commit | sim (por desenho) |
| **D** | fiação `m=7`: inventário de gates derivado de `primaryFamily`; `evaluate.ts` passa a multiplicidade; 300 threaded em `slices.ts`. **NÃO incluiu a metade que o Commit C não fechou, apesar de dizer que incluía** — a afirmação era falsa e ficou falsa por 17 commits: `git show --name-only 1aa5751` não toca `fit.ts`, `profile-artifact.ts`, `contracts/calibration-profile.ts` nem `src/inference/calibration.ts`, que são justamente os quatro que esta linha nomeava como os que mudam JUNTOS. O que D entregou foi a **detecção**: `gates.ts` emite `score-basis-mismatch` quando a base medida e a pré-inscrita divergem — e elas divergiam SEMPRE, então o gate de calibração global reprovava por construção em toda corrida certificadora. O que C entregou foi a **guarda**: `evaluate` exige e confere `provisional-threshold.json`. A dívida ficou **órfã entre C e D** e foi paga em **R1** (2026-08-10): o corte pré-inscrito passa a decidir sobre `documentRawScore`, o perfil servido carrega calibrador `identity` com o mesmo corte, e o inventário de sete digests passa a ser conferido inteiro | sim (`gates.ts`, `commands/evaluate.ts`) |
| **E** | **gate de composição** (D32): linhas E componentes por célula × `test`, recusa nomeando célula/contagem/piso; substitui `COMPOSITION_FLOOR_NOT_APPLIED` no mesmo commit | sim (`commands/split.ts`) |
| **F** | comando `preflight-viability` (runbook § 4b-bis) + guarda do lab alinhada, as duas comparando fração **por classe** e não só agregada — o cross-review mediu que um preflight só agregado APROVA a degenerescência humana na composição ratificada, porque a metade gerada fina derruba toda fração do corpo | **sim** (`cli.ts`, `split-audit.ts`) — nenhum arquivo NOVO entra em `EVALUATOR_FILES`, mas dois membros da lista mudam de bytes: o dispatcher do subcomando em `cli.ts` e um comentário em `split-audit.ts`. Medido: `76e81ba0…` → `35041bfa…`. Inevitável (um subcomando é fiado no dispatcher) e inócuo hoje: `issuedAt` null, 0 tags, nenhum `fit` selado |

**Ratificação da pré-inscrição:** antes do Commit C ser commitado, a tabela de valores congelados (no
relatório da etapa 1) vai ao operador — inclui `dataset.id` proposto (`cleanfeed-ptbr-cells-v1`) e os
counts ai 4000 / mixed 2000. **Ratificado em 2026-08-04**, com duas correções que o cross-review do
Commit C impôs à tabela:

- `collection.humanLinesTotal` e `counts.human` são o número de células vezes o **ALVO** por célula, não
  vezes o piso de 1.500. `sealDataset` compara a composição por igualdade EXATA, então derivar o total do
  piso recusaria justamente todo corpus que carrega a margem de G0.3-bis. Medido: no piso, a média de
  negativos humanos por célula em `test` é exatamente 300 (sd ≈ 15) e **metade dos sorteios reprova** o
  gate de composição; no alvo fica três desvios acima. **Os números ratificados em 2026-08-04 eram 7.000
  humanas (4 × 1.750) e corpus de 13.000, e estão superados pela emenda da moldura de 2026-08-05:** hoje
  são **4.000** humanas (1 × 4.000) e corpus de **10.000** — o raciocínio da derivação é o que
  sobreviveu, não a aritmética;
- o lado **Python** da troca não era atômico: `assemble_corpus.py` lia `rebuild-v3-policy.json` no import
  e decidia `generation.decoding` a partir dele, com o par morto **já fora** de `EVALUATOR_FILES` — isto
  é, uma autoridade que decide sem que o `evaluatorDigest` a vigie. Os dois blocos `generationLanes` são
  idênticos, medido, então o conserto é troca de caminho e não de valor.

**Dívida que o Commit A abre, com dono (Fase 3, item 1):** o cruzamento
`groups.sourceMaterialBatch` → inventário está fiado em `auditCorpusSources`, e o **produtor do
inventário não existe**. `benchmark/lab/build_governance.ts` escreve manifesto v1 sem `materialBatches`,
então um corpus v4 sai `blocked` com `SOURCE_REFERENCE_MISSING` por linha humana até o inventário ser
declarado. Isso é o gate funcionando, não um defeito a contornar: dos cinco campos que
`SourceMaterialBatchV1` exige, três — `materialVersion`, `acquisitionWindow` e `evidence` — são fatos
que **nenhum código deste repositório detém** (quando o dump foi baixado, qual o digest do arquivo), e
sintetizá-los em `build_governance.ts` seria a proveniência inventada que R4 proíbe. O inventário
entra na Fase 3 com **uma entrada declarada por lote de aquisição** — **um** lote,
`smb_ptwiki-20220301`, desde a emenda da moldura —, e `build_governance.ts` passa a escrever manifesto
**v2** no mesmo item.

O item 1 substituiu **quem declara**: em vez de entrada do operador, uma constante de código revisado
(`DECLARED_MATERIAL_BATCHES`), escrita pelo agente e conferida por teste. A razão é a anti-forja — a
alternativa (campo de `governance-inputs.json`, em `benchmark/data/`, gitignored) seria preenchível pelo
próprio passo que consome o inventário, e o digest do manifesto cobriria a forja. Os **valores** foram
recomputados contra o arquivo de 1,96 GB, e a **declaração** vai à ratificação do operador junto do
pacote da Fase 6, com o resto da governança.

## Fase 2 — alinhamento do lab (2–4 dias)

Contra a medição, itens P/M do lab: **D0** (REGISTER/HUMAN_SOURCE → a célula da moldura; B2W, PT.SO e
toda a Carolina saem de `load_humans`, governança e `HN_REGISTER` remapeado), **D2** (fallback que reinstala família
held-out retirada — remover), **D6** (`--provider` restrito às 4 lanes; openai/anthropic recusados na
argparse), **D7** (allowlist de tipologias no `extract_carolina`), **D8** (licença por documento viaja
até o registro montado), **D1** (reserva OpenAI-OOD por política explícita do slate, não prefixo),
**D4** (alvo humano por célula derivado de G0.3), **D5** (seen_texts = os 10.000 antigos, poda global),
**D13** (gate antiartefato pré-treino **em código**: eco de prompt, recusa, metaconversa, assinatura de
harness — família >2 % contaminada regenera a lane, A4).

## Fase 3 — corpus, uma vez (1–2 semanas)

> **A moldura tem UMA célula** desde a emenda de 2026-08-05 (ESTADO § 2 e § 5.5): texto enciclopédico,
> Wikipédia pt, dump 2022-03-01. As três tipologias da Carolina saíram — instituição única, zero autor
> declarado — e o lote `smb_carolina-2_0-bea` deixa de ser necessário para esta fase.

1. **FEITO em 2026-08-06.** Extração de **uma** célula (Wikipédia pt), com corte de data, licença por
   documento e `drop_seen` global, mais o inventário de material (dívida do Commit A): o lote declarado é
   `smb_ptwiki-20220301`, `materialVersion` `ptwiki-20220301`, `sourceId` `src_wikipedia_pt`, janela
   pontual `startedAt = endedAt = 1784753446707` (ratificada em 2026-08-04), `evidence` com sha256
   `70c9ec4f700205ab586ab86dd21a5fe62fc543a5341770c84a28c343225f8b52` e 1.955.910.144 bytes — os três
   reconferidos contra o arquivo em disco nesta unidade. `build_governance.ts` escreve manifesto **v2**
   com `materialBatches` e **recusa** inventário vazio ou lote que não resolve, antes de escrever.
   Medido, e **re-executado depois da queda de rede** que interrompeu a unidade (ESTADO § 5.1b e § 5.4b):
   394.414 artigos lidos → 4.100 linhas no pool; **perda pela poda global de 2 linhas (0,049 %)**, 0 por
   hash exato e 2 por Jaccard, com a maior similaridade **mantida** em 0,81 — um centésimo abaixo da barra,
   que é a leitura que importa; **4.000 componentes conexos** de tamanho 1 no corpo, contra o piso de 300
   (e **4.097** documentos de origem no POOL, que é outra contagem, na barreira que antecede a seleção);
   `auditCorpusSources` devolve `ready` com 0 motivos sobre 4.000 registros, contra `blocked` com 4.000
   `SOURCE_REFERENCE_MISSING` se o manifesto for escrito na forma v1 do runbook; `preflight-viability` passa
   nos dois escopos com a declaração de que passar é necessário e não suficiente. Contando a poda
   **intra-pool** junto da global, uma extração de 4.000 exatas entregaria **3.997** — a margem de coleta é
   necessária, medido. Dois achados que sobram: a fração da faixa `[300,+∞)` que a pré-inscrição congelou
   está errada (8,53 % medido contra 14,89 % congelado, teto de 6,24 % contra 3,62 %) — dívida de quem
   emendar a pré-inscrição, **antes** da Fase 6 —, e a montagem de release para em `HeldOutReserveEmpty`
   porque `candidates-f3` não tem classe gerada nenhuma, que é o item 2. **Nenhum split foi congelado:** o
   comando `split` não rodou, nada foi selado, e o corpo humano que a auditoria leu — que por exigência de
   `schema.ts` carrega carimbo de bloco, porque `createdAt` é obrigatório e só `stamp_block` o escreve —
   **foi apagado** de `benchmark/data/` ao fim da unidade. Congelar o split é o item 3;
2. geração IA pelas 4 lanes; famílias OpenAI **não entram** (reserva OOD); todo registro nasce
   `automated/unreviewed`; PII amostral; gate antiartefato roda **antes** do treino. **A
   distribuição de comprimento do gerado tem de CASAR a humana medida**, e o casamento é por par:
   `generate_ai.target_word_count` pede ao modelo o comprimento da própria semente humana, sem
   clamp, e recusa semente fora da janela do extrator em vez de prendê-la na faixa. O critério de
   reprovação é a sonda de comprimento (`diagnostic_probes.probe_length`), lida na **tabela de
   faixas e nos extremos** e não na AUC: medido em 2026-08-06, o clamp `max(60, min(n, 350))` que
   o gerador usava deixa a AUC em 0,504 — invisível — enquanto produz uma faixa de 50-59 palavras
   que nenhuma linha gerada alcança e um máximo pedido preso em 350 contra 1.774 do lado humano. O
   casamento vale nas **quatro** lanes e até o fim do transporte: `codex_batch` pede pela mesma
   função, o orçamento de saída da lane REST escala com o alvo e resposta cortada
   (`finishReason` fora de `STOP`) é recusada em vez de aceita como inteira;
3. montagem com preflight; **congelamento do split** via ledger (barreira das duas cegas em vigor);
   atestado de composição E3 contra o piso por célula;
4. `test` e `cal-B` nascem e permanecem byte-intocados.

## Fase 4 — treino (3–5 dias, Colab ≤ R$60)

**D17/D25** (seed `712019` pinada + recibo de treino), **D15/D21** (manifesto F6: digests do dataset e
do split selado + hiperparâmetros + hash dos pesos resultantes — o vínculo treino→modelo que hoje não
existe), **D18 FECHADA pela emenda W1** (o export BERT-shaped **corresponde** ao backbone selado, então
não há forma nova a acomodar; `export_onnx` passou a recusar checkpoint que divirja em arquitetura **ou
em vocabulário** — `model_type` sozinho é `"bert"` para todo BERT —, grafo cujas entradas não sejam
exatamente as três e artefato acima do teto de bytes: export com a forma errada é pior que nenhum, porque
passa pelo gate de paridade e entrega artefato que não é o medido), **D26** (prova de paridade fp32→int8 **persistida** como
artefato — e, desde R2, a paridade **recusa** dispersão de escore nula, porque uma cabeça não treinada dá
delta zero e paridade perfeita: ESTADO § 5.9. A dispersão é o intervalo interquartil sobre uma amostra
sorteada com metade de cada classe — a amplitude cede a um outlier e a amostra do runbook era de uma classe
só, as duas coisas medidas em § 5.9b. A forma comparada tem oito campos, o vocabulário é conferido no
arquivo, a cabeça é lida em `architectures`/labels/`missing_keys` (com o pooler), o bundle é montado em
staging e só promovido depois de todas as guardas, `--out` só é apagado se for uma publicação deste
exportador, a política é aceita por `sha256` e não por versão, e os dois recibos gravam seed e identidade da
política — nada disso prova treino, que é o que o manifesto F6 desta mesma fase tem de fazer), **D19** (baseline TF-IDF rodado como detector de vazamento: desempenho alto demais = artefato
de fonte), gate de não degeneração em `dev + cal-A` com valores **não publicados** (R8).

## Fase 5 — medição certificadora no modelo (~1 semana)

1. **D24**: chunker + agregador movem para `contracts/` (puros; a extensão passa a importá-los de lá);
2. **D10**: scorer standalone Node (`onnxruntime-node`) sobre pesos+tokenizer, produzindo os shards de
   predição no esquema selado; identidade ancorada no hash dos pesos; **D20** (vocabulário de
   `gateDecision` do verificador sincronizado com o contrato);
3. `fit` (redesenhado na Fase 1) congela o limiar; paridade `dev + cal-A` zero inversões;
4. **`consume-holdout` — botão do OPERADOR**, irreversível, uma vez: pontua `test`, gates decidem;
5. **Regime 2**: a evidência é publicada **passe ou reprove**. Um `reject` não volta para ajuste — vira
   evidência publicada e a iteração seguinte é outra release com material cego fresco (§ 3.2).

## Fase 6 — empacotamento standalone do modelo (2–3 dias)

**D22**: layout de release agnóstico — ONNX + tokenizer + manifesto + recibo F6 + **tabela de FPR por
célula com a moldura declarada** + model card (frase R7-correta; moldura; "fora da moldura não há
alegação"; espec do pipeline de documento) + `LICENSE` (`cleanfeed-weights-nc-1.0`) + NOTICE.

O model card **publica a distribuição de comprimento da população medida** — os percentis de
palavras da célula (p25/p50/p75/p90 e o máximo) mais a **tabela de FPR por faixa pré-inscrita**,
com o `n` de cada faixa ao lado do teto que aquele `n` implica. Sem ela quem lê o teto não sabe
**sobre que texto** ele vale: a manchete é um número sobre a célula inteira, cuja mediana é de ~120
palavras, e quem analisa 600 recebe um modelo que a medição descreveu com ~119 linhas e teto de
3,62 %. As faixas são diagnóstico — não decidem, não gastam alpha — e é justamente por isso que a
sua ausência do card não seria detectada por nenhum gate.
### Três exigências do model card que vêm das sondas de tema (2026-08-07)

Registradas aqui porque nenhum gate as detecta: as quatro sondas são diagnóstico e a sua ausência do card
passa em silêncio.

1. **A família reservada é factualmente mais frágil que as de treino, logo o resultado nela é LIMITE
   OTIMISTA** — e com os **exemplos medidos**, não como ressalva genérica. Num probe de três linhas o modelo
   pequeno de pesos abertos escreveu "Tratado de Tordesilhas sob mediação da Coroa Francesa" e "maior maré
   quando a Lua está em quadratura" (quadratura é quando a maré é mais **fraca**). Isso não invalida o
   rótulo: torna a fatia OOD mais **fácil** que as famílias de treino, e o número dela é um teto sobre a
   generalização e não uma medida dela. O critério que decide se o número sai como generalização ou como
   limite otimista é o de `baseline_tfidf.read_ood_easiness`, e ele **recusa por padrão** — tanto quando a
   reservada é mais fácil quanto quando a comparação não resolve (ESTADO § 3.3, § 5.8).
2. **A razão TÉCNICA da proibição de uso acadêmico**, ao lado da ética que já existe. Seção inicial de
   Wikipédia é, **por política editorial**, resumo de conhecimento ESTABELECIDO: é o texto humano de menor
   novidade possível. A classe humana do corpus não consegue representar escrita acadêmica original, então o
   modelo não tem base para ela. A proibição deixa de ser cautela e passa a ser **consequência do desenho** —
   e é a formulação que o card imprime.
3. **A distribuição de comprimento da população medida**, com `p50 = 106` palavras da extração real de
   2026-08-06 (ESTADO § 5.1b) — não o `p50 = 120` da varredura de prefixo que a pré-inscrição congelou —,
   sem a qual quem lê o teto não sabe sobre que texto ele vale. É o mesmo item que o parágrafo acima exige, e
   está repetido aqui de propósito: a dívida das frações por faixa (§ 7 do ESTADO) vence **antes** desta
   fase, e o card imprime a tabela corrigida ou declara a divergência.

**D23** (o model card e a tabela nascem aqui), **D27** (arquivos legais pré-Fase-0 nos bundles servidos
corrigidos). A extensão **não** entra no pacote.

## Fase 7 — publicação (dias)

**Não há mais prazo externo.** Ele existia só no ramo do parecer jurídico de B1, e o operador escolheu o
outro em 2026-08-05: risco assumido por escrito. Sem terceiro, sem gasto acima do envelope de A6, e a
duração da fase deixa de depender da agenda de alguém de fora. O que falta é a **assinatura**, que é do
operador e espera o pacote da Fase 6 — aprovar antes assinaria pacote com os arquivos legais que D27
conserta lá.

`license-review.json` → `approved` (assinatura de B1, do operador) · HF **gated** para pesos + GitHub
para código e evidência (B4) · varredura repo-wide de alegações · **push e botões de publicação são do
operador**.

---

## Processo e estimativa

- **Caminho selado** (Fases 1, 3, 5): três etapas por unidade — desenho (Fable) → implementação →
  cross-review (Fable enquanto o codex não volta; rodada do Fable não fecha dívida de codex). Guarda
  nova ⇒ medição por mutação com linha de base verde e restauração conferida por `diff`.
- **Fora do selado** (Fases 2, 4, 6): uma rodada de revisão.
- Referência metodológica no mesmo commit (`references.md`).

| fase | duração | depende de |
|---|---|---|
| 0 | decisões G0.1–G0.3 | operador |
| 1 | ~1 semana | G0.1, G0.2 |
| 2 | 2–4 dias | G0.3 |
| 3 | 1–2 semanas | 1, 2 |
| 4 | 3–5 dias | 3 |
| 5 | ~1 semana | 4 |
| 6 | 2–3 dias | 5 |
| 7 | dias | 6, a assinatura de B1 (interna: o ramo é risco assumido por escrito) |
| **total** | **~4–6 semanas de engenharia** | |

## Mapa divergência → fase

| fase | resolve |
|---|---|
| 1 | D3, D9, D11, D12, D14, D16, D28, D29, D30, D31, D32, D33, D34, D35 |
| 2 | D0, D1, D2, D4, D5, D6, D7, D8, D13 |
| 4 | D15, D17, D18, D19, D21, D25, D26 |
| 5 | D10, D20, D24 |
| 6 | D22, D23, D27 |

## O que fica explicitamente fora

A extensão (consumidora downstream; volta como projeto próprio depois da entrega) · a fila de
endurecimento (parada até o artefato existir) · a v2.0 e qualquer segunda medição · o repositório novo
do manifesto de transplante (**este plano executa no repo atual**; o transplante, se vier, ocorre
depois da entrega, com o modelo já publicado — mudar de casa no meio da medição recriaria a ambiguidade
que o ESTADO.md acabou de eliminar).
