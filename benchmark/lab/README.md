# benchmark/lab — bancada Python de coleta (nunca ciência selada)

Extratores de **candidatos humanos** a partir dos snapshots licenciados
pré-ChatGPT (ver [docs/corpus-sources.md](../../docs/corpus-sources.md)). Python
3.11+ **stdlib apenas**; determinístico (sem aleatoriedade/relógio na saída).

Regra de ouro do projeto: Python é bancada — o que embarca é ONNX/WASM e o que
sela ciência é o pipeline TypeScript ([benchmark/](../README.md)). A saída daqui
são apenas CANDIDATOS (`benchmark/data/candidates/*.jsonl`, gitignored) que
ainda passam por revisão humana + PII-audit antes de virarem registros do
`ingest`.

Pipeline compartilhado (`common.py`): corte temporal `< 2022-11-30` →
normalização NFC+LF → janela de 50–5000 palavras → **drop por PII** (e-mail,
telefone BR, CPF/CNPJ, @handle — descarta, nunca reescreve) → amostragem
determinística. Cada saída ganha um `.stats.json` com as contagens de descarte.

```bash
cd benchmark/lab
python -m unittest -v                     # fixtures dos 3 parsers + pipeline

python extract_stackexchange.py --input <Posts.xml> \
  --output ../data/candidates/ptso.jsonl --limit 4000 --sample-rate 7
python extract_wikipedia.py --input <ptwiki-...-pages-articles.xml.bz2> \
  --output ../data/candidates/wikipedia.jsonl --limit 4000 --sample-rate 40
python extract_carolina.py --input <carolina.zip> \
  --output ../data/candidates/carolina.jsonl --limit 4000
```

Notas por fonte: SE-PT descarta `<code>/<pre>` inteiros (payload de programação
não é prosa); Wikipédia usa só a seção-lede de artigos ns=0 sem redirect;
Carolina lê licença + `<date type="Download">` POR DOCUMENTO (o que torna o
pacote v2.0 utilizável), exclui a tipologia `wikis` e nunca lê os campos de
nomes/autores dos headers.

## Classe IA — `generate_ai.py` (pareada por tópico)

Gera a contraparte IA de candidatos humanos amostrados deterministicamente:
"escreva um texto ORIGINAL sobre o mesmo assunto, extensão semelhante" — o
pareamento por tópico impede o classificador de aprender tópico/era em vez de
autoria, e pedir texto novo (nunca reescrita) evita near-dups com o pai. Sem
truques de estilo: o estilo default do modelo É o sinal a detectar. Cada saída
carrega a receita completa do schema (provider/family/model/temperature/seed ou
seedNullReason/promptId/promptSha256/generatedAt + `pairedWith`) e um
`.batch.json` para o source-manifest. Retries com backoff; resume por
`pairedWith`; o corte pré-ChatGPT fica DESLIGADO (gerados agora).

Chaves só por variável de ambiente (nunca impressas/gravadas):
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (ou `GOOGLE_API_KEY`).

```bash
python generate_ai.py --provider anthropic \
  --humans ../data/candidates/ptso.jsonl ../data/candidates/carolina.jsonl \
           ../data/candidates/wikipedia.jsonl \
  --output ../data/candidates/ai_anthropic.jsonl --per-provider 60
# idem --provider openai | gemini; --dry-run mostra o plano sem chamar API
```

## Piloto de triagem de PII por NER — `ner_pilot.py`

**Não é a triagem; é a medição do custo dela.** O estágio 1 do
[`pii-review-v1`](../protocols/pii-review-v1.md) (`common.py:pii_hits`) **descarta** o
candidato em vez de sinalizá-lo, então toda linha de pool sobrevivente é limpa-até-onde-os-
cinco-regexes-veem e a incógnita é a **taxa de escape** — nome próprio em prosa corrida,
endereço, forma rara de handle, que o próprio `common.py:70-76` nomeia. Um NER é a única
entrada possível para uma adjudicação humana por achado, e o custo dessa adjudicação é a
taxa de apontamento vezes o custo por item. O script mede a primeira e instrumenta o
segundo; o número que ele produz é
`P(o NER aponta pessoa | a varredura de regex disse limpo)`, **não** a prevalência de PII
nos dumps.

Amostra estratificada (~125 por fonte humana), sorteio determinístico por digest da chave
`seed:candidateId`, janelas cortadas nos **offsets do tokenizador** (nunca truncamento) e
menções repetidas do mesmo nome agrupadas — um acórdão cita o mesmo ministro quinze vezes e
o revisor julga aquele nome **uma**. **Nenhum artefato carrega texto de entidade:** as
linhas de achado têm id, categoria canônica e offsets. O subcomando `show` imprime a forma
de superfície **no console** para quem adjudica, e isso não é gravado.

```bash
python ner_pilot.py screen                      # modelo primário (HAREM/BERTimbau)
python ner_pilot.py screen --model Babelscape/wikineural-multilingual-ner
python ner_pilot.py show --batch adjudication-batch-<slug>.json \
  --findings findings-<slug>.jsonl              # console; nada é persistido
python ner_pilot.py tally --verdicts verdicts.json \
  --summary summary-<slug>.json --findings findings-<slug>.jsonl
```

Saída em `../out/rebuild-v3/ner-pilot/` (gitignored). `tally` exige que o arquivo de
vereditos declare em prosa a **origem** dos segundos por item: é o único insumo que não é
medição deste corpus.

## T4 — treino no Colab (bake-off)

O smoke local (CPU) valida o script; o treino real roda num Colab T4 grátis:

```bash
# na sua máquina: empacotar o dataset final (após as lanes fecharem)
tar -czf dataset.tgz -C ../data/dataset train.jsonl dev.jsonl

# no Colab (Runtime > T4 GPU): subir dataset.tgz e train_detector.py, então
!pip -q install torch transformers scikit-learn
!tar -xzf dataset.tgz
!python train_detector.py --train train.jsonl --dev dev.jsonl \
  --model neuralmind/bert-base-portuguese-cased --outdir bertimbau
!python train_detector.py --train train.jsonl --dev dev.jsonl \
  --model xlm-roberta-base --outdir xlmr
# baixar: {bertimbau,xlmr}/best/ + metrics.json  (o melhor AUC vence o bake-off)
```

Métrica de decisão: `metrics.json` (AUC dev + FPR@recall>=0,6). O checkpoint
`best/` do vencedor segue para o T5 (export ONNX int8).
