# Fase V2 — detector próprio pt-BR (fine-tune) substituindo o TMR

> **Motivação (veredito do piloto, commit `a1819fb`):** o TMR é INVERTIDO no
> nosso domínio — AUC 0,049 em 177 pares topic-controlled (humanos 0,977 de
> média; GPT-5.6 engana em 100% dos pares). As assinaturas RAID 2022-23/EN não
> existem na prosa de modelos 2026. Ao mesmo tempo, TF-IDF+LogReg atinge AUC
> 0,9998 no mesmo piloto: **o sinal de autoria existe e é fortemente
> aprendível**. Decisão: treinar detector próprio; a arquitetura da extensão é
> agnóstica ao modelo (tudo chaveado por bundle/tokenizer digest), o pipeline
> selado avalia o modelo NOVO.
>
> Nome do candidato: **`cleanfeed-ptbr-v1`**.

## Princípios inegociáveis (herdados)

1. **Treino ≠ avaliação.** Nenhum registro do corpus de treino é registro do
   corpus selado de 10k (que só nasce depois, com registro de deployment). Os
   mecanismos: partição determinística por hash + poda de quase-duplicata na
   montagem do selado + famílias de gerador reservadas (nunca treinadas).

   ⚠️ **Redação corrigida em 2026-07-31 (Fase 1).** Dizia "DISJUNTO" e "disjunção
   por construção", juntando duas coisas de força muito diferente: que os dois
   conjuntos não compartilham registro (verdadeiro, e quase trivial) e que não há
   sobreposição de conteúdo (um **contrato** — hash exato + Jaccard ≥ 0,82 —, nunca
   independência semântica). Documento histórico; a formulação em vigor está em
   `docs/corpus-collection-runbook.md`.
2. **Zero-PII e licenças por fonte** valem para o treino também (pipeline
   `benchmark/lab` já aplica).
3. O modelo final embarca **ONNX int8 local**; ciência selada continua no
   pipeline TypeScript; Python é bancada.
4. Projeto aberto **não-comercial**: treinar sobre Carolina (CC BY-NC-SA)
   condiciona o modelo resultante ao regime não-comercial — coerente com a
   postura declarada; registrar no NOTICE do bundle.

## Etapa A — Corpus de treino (alvo: ~40–50k docs)

### Humanos (~20–25k)
| Fonte | Já temos | Ação |
| --- | --- | --- |
| SE-PT | 4.000 (de ~52k elegíveis) | Re-extrair com `--sample-rate 2 --limit 12000` |
| Wikipédia | 4.000 (de ~387k págs) | Re-extrair `--sample-rate 12 --limit 6000` |
| Carolina | 3.326 balanceados | Re-extrair `--per-typology-limit 2500 --limit 8000` |

**Partição anti-vazamento:** todo candidato ganha `split = sha1(candidateId) % 10`
→ `0-7` treino, `8` dev, `9` **reservado** (nunca visto; disponível para o
corpus selado). Pares ficam atômicos (o par herda o split do pai humano).

### IA (~15–20k, pareados por tópico como no piloto)
As três lanes funcionam; escalar é rodar mais:

| Lane | Custo | Ritmo realista | Famílias |
| --- | --- | --- | --- |
| Gemini API (free tier) | R$0 | ~1.000–1.500/dia (flash-lite, sleep 6s) | `gemini-flash-lite-latest`; opcional `gemini-3.5-flash` |
| Codex CLI (assinatura) | R$0 | ~500–1.000/dia (20/chunk) | `gpt-5.6-luna` |
| Sessão Claude (subagentes) | uso do Claude Code | ~300–600/dia | `claude-fable-5` |
| **Atalho recomendado** | ~US$20–40 | 1–2 dias p/ tudo | OpenAI API (`gpt-4o-mini`) + Anthropic API (`claude-haiku`) com o `generate_ai.py` existente |

**Diversidade obrigatória de receita** (o piloto usou só uma):
- `original-pareado` (atual) — 50%;
- `parafrase-de-humano` (reescrita do pai; hard positive; kind=paraphrase) — 20%;
- `post-estilo-rede-social` (prompt standalone por tópico, 60–300 palavras) — 20%;
- `humanizado-adversarial` ("escreva casual, com pequenas imperfeições") — 10%
  — o hard positive que mede robustez a "humanização".

**Famílias reservadas (nunca no treino):** ≥2 famílias inteiras (proposta:
`gemini-3.5-pro` e `gpt-4o` OU o que só gerarmos na fase do selado) — ficam
para o holdout do corpus selado (gate de generalização exige ≥200 positivos).

### Mistos (treino v1: NÃO)
O modelo é binário por janela (`{human:0, ai:1}`, contrato atual do manifest).
Mistos entram no corpus SELADO (com spans) para avaliar a agregação
documento/localizado — não no treino v1. (v2 opcional: janelas de mistos como
positivos.)

## Etapa B — Modelo e treino

### Base model: decisão por bake-off (2 candidatos, treinar ambos e medir)
| Candidato | Params | int8 aprox. | Prós | Contras |
| --- | --- | --- | --- | --- |
| **BERTimbau-base** (`neuralmind/bert-base-portuguese-cased`) | 110M | **~110 MB** (menor que o TMR!) | Nativo pt-BR, tokenizer eficiente em pt, canônico | WordPiece (ver custo de offsets na Etapa C) |
| XLM-R-base | 279M | ~280 MB | Multilíngue (futuro multi-idioma) | 2,2× o download atual; SentencePiece |

Recomendação: **BERTimbau-base como primário** (o pivô de escopo é pt-BR, não
multilíngue; 110 MB melhora o produto). XLM-R só ganha se o bake-off mostrar
diferença relevante de AUC.

### Receita (HF Trainer, script único rodável no Colab)
- Head de classificação binária; janela 512; truncation nas janelas do runtime
  (510+2) para paridade treino-inferência.
- lr 2e-5, 3–5 épocas, batch 16–32 (grad-accum se precisar), warmup 6%,
  weight decay 0.01, early-stop por AUC no dev.
- Split por GRUPO (par pai-filho atômico; `source`/`author` não cruzam splits).
- Métricas de iteração: AUC dev + **FPR@recall=0,6** (a métrica-produto) por
  família e por registro (SE/wiki/Carolina-social).

### Computação
- Colab T4 grátis: BERTimbau-base, 40k docs × 3 épocas ≈ **2–5 h/run** (cabe).
  Kaggle (30 h/sem grátis) como alternativa. 2–4 runs de iteração previstos.
- Entregável: `benchmark/lab/train_detector.py` + notebook espelho para Colab
  (dados sobem como um `.tar` dos JSONL de candidatos — SEM sair do controle do
  operador; Colab é efêmero e os dados são licenciados p/ avaliação local:
  aceitável para treino não-comercial, registrar a decisão).

## Etapa C — Export e integração no runtime (o custo escondido)

1. **Export**: HF → ONNX (optimum) → quantização dinâmica **int8**
   (onnxruntime), validando paridade de logits (amostra de 100 textos,
   |Δscore| < 0,02 fp32→int8).
2. **⚠️ Offsets nativos**: `deriveByteLevelOffsets` do runtime é específico de
   ByteLevel-BPE (GPT-2/RoBERTa-EN). BERTimbau = **WordPiece** → implementar
   `deriveWordPieceOffsets` no `ExactTokenizer` (prefixo `##`, walk
   determinístico do texto-fonte, arredondamento outward em subpalavras com
   acento — MESMOS testes de fixture: emoji, acentos partidos, cobertura
   total). XLM-R = SentencePiece (`▁`), deriver análogo. **1 sessão de
   trabalho; é a única mudança real de código no core** — e recomputa
   `inferenceCoreDigest` (permitido: nenhuma ciência selada).
3. **Bundle novo**: `models/cleanfeed-ptbr-v1/` (model-lock com sha256 dos
   artefatos, source-lock = treino próprio + inventário de dados de treino por
   licença, LICENSE/NOTICE com o condicionante NC do Carolina),
   `bundled-model-metadata.ts` regenerado, manifest v1 com
   `labels {human:0, ai:1}` (contrato inalterado).
4. **Smoke + preview**: `npm run test:model:smoke` com o bundle novo; o **modo
   experimental já vira o teste de campo do modelo novo** (mesmo caminho
   uncalibrated preview — badge experimental, limiar configurável).
5. Release continua `pending` até o selado.

## Etapa D — Portão de saída da fase (antes do corpus selado)

No slice de teste do lab (partição `9` + ~100 textos de registro LinkedIn
coletados por doação/próprios, revisados):
- **AUC ≥ 0,95**; e
- **FPR ≤ 5% @ recall ≥ 0,6** (ponto de operação estilo produto); e
- nenhuma família de IA treinada com recall < 0,4; e
- adversarial rápido: recall ≥ 0,4 no slice `humanizado`.

Aprovou → montar o corpus selado de 10k (registro de deployment, mistos com
spans, famílias held-out) e rodar o pipeline oficial
(`ingest → … → consume-holdout`) contra o **cleanfeed-ptbr-v1**.
Reprovou → iterar receita/dados (não o gate).

## Sequência de tarefas

| # | Tarefa | Entregável | Esforço |
| --- | --- | --- | --- |
| T1 | Re-extração ampliada + partição por hash | ~25k humanos particionados | 1h de máquina |
| T2 | Escalar geração IA (3 lanes ou APIs pagas) + receitas novas (paráfrase/social/humanizado) | ~15–20k IA | 2–7 dias corridos (lanes) ou 1–2 dias (API) |
| T3 | Montagem do dataset de treino (pares atômicos, dedup, splits, stats) | `train.jsonl`/`dev.jsonl`/`reserved.jsonl` | 1 sessão |
| T4 | `train_detector.py` + notebook Colab (bake-off BERTimbau × XLM-R) | checkpoints + relatório AUC/FPR | 2–5h GPU/run |
| T5 | Export ONNX int8 + paridade fp32/int8 | `model_int8.onnx` | 1 sessão |
| T6 | Offsets WordPiece no ExactTokenizer + fixtures | core atualizado, suíte verde | 1 sessão |
| T7 | Bundle `cleanfeed-ptbr-v1` (locks, metadata, manifest, NOTICE) | `model:verify` verde | 1 sessão |
| T8 | Smoke real + preview experimental no feed | teste de campo | horas |
| T9 | Slice LinkedIn (~100 doações/próprios) + portão da Etapa D | go/no-go para o selado | paralelo a T2 |

## Riscos e mitigação

- **Registro do treino ≠ registro do feed** (SE/wiki vs posts LinkedIn): o
  baseline 0,9998 vai cair no domínio real. Mitigação: receita
  `post-estilo-rede-social` no treino + slice LinkedIn no portão D + a
  calibração final é medida no registro certo (corpus selado).
- **Modelo aprende "limpeza tipográfica" em vez de autoria**: paráfrases e o
  slice humanizado no treino; monitorar FPR no subgrupo humano-formal
  (Carolina institucional) — é o proxy dos hard-negatives do gate.
- **Drift de geradores (o que matou o TMR)**: famílias reservadas no holdout +
  perfis com expiração de 180 dias (já no contrato) + re-treino periódico
  barato (a fábrica de dados fica pronta).
- **NC do Carolina no modelo**: postura não-comercial declarada cobre; se um
  dia mudar, re-treinar sem Carolina (partição por fonte torna isso trivial).
