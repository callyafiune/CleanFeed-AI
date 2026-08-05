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
   abundante (38k/26k/8,8k documentos por célula) e a prova de "nada visto" fica trivial.

---

## Etapa 0 — decisões do operador que precedem a Fase 1

> **DECIDIDAS em 2026-08-03**, todas na direção recomendada — mais duas ratificações da etapa de
> desenho: **G0.1-bis** (`sourceMaterialBatch` fora da união do split; unidades = documentos de origem)
> e **G0.3-bis** (coleta ~1.750/célula, ~7.000 total, piso de 300 inalterado). Ver ESTADO.md § 3.

| # | decisão | recomendação do agente | bloqueia |
|---|---|---|---|
| G0.1 | ratificar `domainSource` como estrato (`sourceMaterialBatch` carrega dependência) | ratificar — é a decisão de 2026-08-01, medida | Fase 1 (eixos) |
| G0.2 | manchete: pior estrato **ou** por estrato (`m=7`, teto 1,45 %→≈1,63 % a n=300) | **por estrato** — cobertura deixa de ser punida, e melhorias futuras acrescentam linha sem degradar a manchete (§ 3.2 do ESTADO) | Fase 1 (m, α) |
| G0.3 | teto pretendido: **1,45 %** (1.500 linhas/célula ⇒ 6.000 humanas) ou **0,55 %** (4.000/célula ⇒ 16.000) | **1,45 %** — é o piso da própria política, e 6.000 humanas cabem no material com folga; 0,55 % é alcançável numa v2 com o mesmo desenho | Fase 2 (alvos) |
| B1 | parecer jurídico da posição (a) ou risco assumido por escrito | — (pessoal) | **só a Fase 7** |

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
- `backbone` e `onnxMaximumInt8Bytes` congelam **aqui** com valores de XLM-R — copiar os do JSON morto
  tornaria o export da Fase 4 impassável sob política selada;
- o piso de 300 é de **linhas** (denominador do FPR); o piso de **unidades** (componentes) é decisão
  nova, e o gate de composição conta os dois.

**Ordem de execução — 6 commits, cada um pela tríade desenho→implementação→revisão:**

| commit | conteúdo | move `evaluatorDigest`? |
|---|---|---|
| **A** | esquema **v4** (− `collectionBatch`; + `sourceMaterialBatch`, `generationBatch`, `extractionRun`; `AXIS_STATE_RULE` completo) + manifesto **v2** (`materialBatches` obrigatório, projeção incondicional) + espelhos Python | sim (`schema.ts`, `source-manifest.ts`) |
| **B** | conectividade: `GROUP_KEYS` v4 (sem `domainSource`, sem lote), auditoria reporta os dois como inventário, contraprova de viabilidade com lote-único-por-célula. **Inclui**: `auditClusters`/`standInClusterReport` (split-audit.ts:766, :564) ainda iteram `V3_GROUP_AXES` sem condição, então sobre corpus v4 o relatório de cluster do split publica `collectionBatch` com `states.unknown = N` e **omite** os três eixos novos — o espelho Python já é ciente da versão (`group_axes.axes_of`), e é o lado TS que está atrás. `DECLARED_GROUP_AXES` e o parser fechado do audit mudam com ele | sim (`split.ts`, `split-audit.ts`) |
| **C** | **a troca atômica**: `preregistration-v4.{json,ts}` com os pins, 11 sítios de import, `EVALUATOR_FILES` atualizado, identidade de dataset da política, estratos recompostos, `fit` sem calibrador. **Inclui o que o Commit A deferiu**: a tabela `resampling` re-derivada sobre os eixos v4 (o estimando `ai-recall` deixa de nomear `groups.collectionBatch`, que v4 apagou, e passa a nomear `groups.generationBatch`) **junto** do alargamento de `metrics.ts` — `V3_AXIS_NAMES` (metrics.ts:1304) era a tupla v3 e `axisLevel` estourava `RangeError` para qualquer outro eixo, então a política nova era inalcançável e a política velha congelaria um eixo morto no selado; as DUAS falhavam, e é por isso que os dois entram no mesmo commit | sim (por desenho) |
| **D** | fiação `m=7`: inventário de gates derivado de `primaryFamily`; `evaluate.ts` passa a multiplicidade; 300 threaded em `slices.ts`. **Inclui a metade que o Commit C não fechou** (achado do cross-review): o corte publicado da v1 passa a ser o **limiar provisório sobre `documentRawScore`**, o ECE-15 passa a ser medido sobre esse mesmo escore, e o `fit` para de ajustar calibrador e evidência de seleção. Não caberia no C: `buildEvaluationItem`, `profile-artifact.ts` (que publica o perfil de runtime a partir de `frozen.calibrators`), `contracts/calibration-profile.ts` e `src/inference/calibration.ts` mudam JUNTOS, e meia troca — escore bruto com corte calibrado, ou corte bruto com perfil de runtime calibrado — é pior que qualquer das duas pontas. O que o C entregou é a **guarda**: `evaluate` exige e confere `provisional-threshold.json` (digest, restatement da política, digests de governança), então um `fit` sem o corte pré-inscrito não alcança a medição | sim (`gates.ts`, `commands/evaluate.ts`) |
| **E** | **gate de composição** (D32): linhas E componentes por célula × `test`, recusa nomeando célula/contagem/piso; substitui `COMPOSITION_FLOOR_NOT_APPLIED` no mesmo commit | sim (`commands/split.ts`) |
| **F** | comando `preflight-viability` (runbook § 4b-bis) + guarda do lab alinhada, as duas comparando fração **por classe** e não só agregada — o cross-review mediu que um preflight só agregado APROVA a degenerescência humana na composição ratificada, porque a metade gerada fina derruba toda fração do corpo | **sim** (`cli.ts`, `split-audit.ts`) — nenhum arquivo NOVO entra em `EVALUATOR_FILES`, mas dois membros da lista mudam de bytes: o dispatcher do subcomando em `cli.ts` e um comentário em `split-audit.ts`. Medido: `76e81ba0…` → `35041bfa…`. Inevitável (um subcomando é fiado no dispatcher) e inócuo hoje: `issuedAt` null, 0 tags, nenhum `fit` selado |

**Ratificação da pré-inscrição:** antes do Commit C ser commitado, a tabela de valores congelados (no
relatório da etapa 1) vai ao operador — inclui `dataset.id` proposto (`cleanfeed-ptbr-cells-v1`) e os
counts ai 4000 / mixed 2000. **Ratificado em 2026-08-04**, com duas correções que o cross-review do
Commit C impôs à tabela:

- `collection.humanLinesTotal` e `counts.human` são **7.000** e não 6.000 — quatro células vezes o ALVO de
  1.750, não vezes o piso de 1.500. `sealDataset` compara a composição por igualdade EXATA, então derivar
  o total do piso recusaria justamente todo corpus que carrega a margem de G0.3-bis. Medido: no piso, a
  média de negativos humanos por célula em `test` é exatamente 300 (sd ≈ 15) e **metade dos sorteios
  reprova** o gate de composição; no alvo são ~350, três desvios acima. Total do corpus: 13.000;
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
entra na Fase 3 com **entrada declarada pelo operador** por lote de aquisição (dois lotes: ptwiki e
carolina), e `build_governance.ts` passa a escrever manifesto **v2** no mesmo item.

## Fase 2 — alinhamento do lab (2–4 dias)

Contra a medição, itens P/M do lab: **D0** (REGISTER/HUMAN_SOURCE → 4 células; B2W/PT.SO/legislativo
saem de `load_humans`, governança e `HN_REGISTER` remapeado), **D2** (fallback que reinstala família
held-out retirada — remover), **D6** (`--provider` restrito às 4 lanes; openai/anthropic recusados na
argparse), **D7** (allowlist de tipologias no `extract_carolina`), **D8** (licença por documento viaja
até o registro montado), **D1** (reserva OpenAI-OOD por política explícita do slate, não prefixo),
**D4** (alvo humano por célula derivado de G0.3), **D5** (seen_texts = os 10.000 antigos, poda global),
**D13** (gate antiartefato pré-treino **em código**: eco de prompt, recusa, metaconversa, assinatura de
harness — família >2 % contaminada regenera a lane, A4).

## Fase 3 — corpus, uma vez (1–2 semanas)

1. extração das 4 células (Wikipédia + 3 tipologias da Carolina), com corte de data, licença por
   documento e `drop_seen` global. **Inclui o inventário de material** (dívida do Commit A): o operador
   declara os dois lotes de aquisição — `materialVersion`, `acquisitionWindow`, `evidence` —, e
   `build_governance.ts` passa a escrever manifesto **v2** com `materialBatches`. Sem isso a auditoria
   bloqueia toda linha humana v4, e é isso que ela deve fazer;
2. geração IA pelas 4 lanes; famílias OpenAI **não entram** (reserva OOD); todo registro nasce
   `automated/unreviewed`; PII amostral; gate antiartefato roda **antes** do treino;
3. montagem com preflight; **congelamento do split** via ledger (barreira das duas cegas em vigor);
   atestado de composição E3 contra o piso por célula;
4. `test` e `cal-B` nascem e permanecem byte-intocados.

## Fase 4 — treino (3–5 dias, Colab ≤ R$60)

**D17/D25** (seed `712019` pinada + recibo de treino), **D15/D21** (manifesto F6: digests do dataset e
do split selado + hiperparâmetros + hash dos pesos resultantes — o vínculo treino→modelo que hoje não
existe), **D18** (`export_onnx` ganha XLM-R), **D26** (prova de paridade fp32→int8 **persistida** como
artefato), **D19** (baseline TF-IDF rodado como detector de vazamento: desempenho alto demais = artefato
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
**D23** (o model card e a tabela nascem aqui), **D27** (arquivos legais pré-Fase-0 nos bundles servidos
corrigidos). A extensão **não** entra no pacote.

## Fase 7 — publicação (dias + prazo externo de B1)

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
| 7 | dias + B1 externo | 6, B1 |
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
