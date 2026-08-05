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

# NÃO é passo da montagem: a fonte está BLOQUEADA por termo de acesso (A1/F0-6)
# e o montador a recusa por nome. O extrator fica na árvore para que a recusa
# tenha o que recusar, e volta a ser passo se a condição jurídica se resolver.
python extract_stackexchange.py --input <Posts.xml> \
  --output ../data/candidates/ptso.jsonl --limit 4000 --sample-rate 7
python extract_wikipedia.py --input <ptwiki-...-pages-articles.xml.bz2> \
  --output ../data/candidates/wikipedia.jsonl --limit 4000 --sample-rate 40 \
  --snapshot-version ptwiki-20220301
python extract_carolina.py --input <carolina.zip> \
  --output ../data/candidates/carolina.jsonl --limit 4000 \
  --snapshot-version carolina-v2.0 \
  [--typologies judicial_branch,social_media,university_domains]
```

`--snapshot-version` é obrigatório nos dois: é dele que sai
`groups.sourceMaterialBatch`, o evento de aquisição contra o qual o manifesto
revisado resolve. Sem ele o extrator recusa a corrida inteira — um lote batizado
na base do snapshot fundiria dois downloads num único bloco indistinguível.

Notas por fonte: SE-PT descarta `<code>/<pre>` inteiros (payload de programação
não é prosa); Wikipédia usa só a seção-lede de artigos ns=0 sem redirect;
Carolina lê licença + `<date type="Download">` POR DOCUMENTO (o que torna o
pacote v2.0 utilizável) e nunca lê os campos de nomes/autores dos headers.

**A moldura amostral é uma allowlist, não um filtro de conveniência.** O
`extract_carolina.py` extrai as TRÊS tipologias da moldura
(`judicial_branch`, `social_media`, `university_domains`) e nenhuma outra:
`legislative_branch`, `public_domain_works`, `wikis` e
`datasets_and_other_corpora` estão declaradas em `OUT_OF_FRAME_TYPOLOGIES` com
a razão de cada uma, não são abertas e por isso **não consomem cota**. Pedir
uma delas em `--typologies` é recusado na entrada; uma tipologia que **nenhuma
das duas listas nomeia** recusa a corrida inteira (`TypologyOutOfFrame`) — o
diretório vem grafado com espaço em algumas releases e com underscore em
outras, e uma tipologia da moldura renomeada produziria zero linha de uma
célula cujo teto de FPR a release publica, em silêncio.

O lado do montador espelha isso: `assemble_corpus.py` só admite as quatro
células da moldura (`REGISTER`/`HUMAN_SOURCE`), e Stack Overflow, resenha de
produto (B2W) e as tipologias fora da moldura seguem **nomeadas** em
`A1_BLOCKED_DOMAIN_SOURCES` e `OUT_OF_FRAME_DOMAIN_SOURCES`. As razões são
diferentes e o código as mantém separadas: termo de acesso é condição jurídica
satisfazível; "sem célula" é decisão de escopo. Um `domainSource` que **nenhuma
das três listas** nomeia recusa a corrida (`UndecidedDomainSource`), pelo mesmo
motivo da tipologia indecidida.

O vocabulário das células é `preRegistration.quotaAxis.cells` —
`carolina-judicial`, `carolina-social-media`, `carolina-university`, `ptwiki` —
e não os nomes de registro de `humanCoreStrata`. É o campo `humanSourceType`
que os gates fatiam, e o gate de FPR por célula procura a hipótese que decide
(`fpr-<célula>`) em `multiplicity.primaryFamily`: escrito com o outro
vocabulário, o corpus conta zero linha nas quatro células do gate de composição
e deixa as quatro hipóteses certificadoras sem gate.

Duas recusas do montador acontecem **antes** da montagem gastar a corrida, e as
duas repetem uma comparação que o gate de composição só faria no fim:

- `assert_cells_can_meet_the_origin_document_floor` conta, por célula, quantos
  documentos de origem (`groups.source`) DISTINTOS o pool entrega e recusa
  abaixo de `powerFloors.samplingUnits`. Uma linha por documento é o teto
  pré-inscrito, então uma célula com poucos documentos não alcança o piso de
  negativos humanos por mais linhas que o pool carregue. Só vale contra a cota
  de release: `--sample` coleta uma fração dela por construção;
- `tag_hard_negatives` recusa quando uma célula não cobre as famílias de estilo
  tiradas dela (`hard_negative_demand_per_cell`). Três das seis vêm da célula de
  rede social, e as demandas somam porque uma linha não carrega duas famílias.

### A reserva OOD é política do slate, por nome

`OOD_RESERVED_FAMILIES`, `CORE_GENERATOR_FAMILIES` e
`EXCLUDED_GENERATOR_FAMILIES` (em `assemble_corpus.py`) declaram o papel de cada
família geradora, e a comparação é por **igualdade exata** sobre
`groups.generatorFamily`. Reservada significa: nenhuma linha da
família chega a partição de que o treino é tirado — ela é assentada inteira no
bloco cego, e a auditoria do split recusa qualquer linha dela que realize em
outro lugar. As reservadas são as famílias OpenAI (ESTADO.md § 3.3).

Nem lane nem prefixo decidem isso, e a razão é medida: `gpt-5.6-luna` chega pela
lane `codex` e `gpt-oss-120b-medium` só é alcançável pelo `agy`, que é o harness
do Google — a fronteira de provedor cruza a fronteira de lane. Prefixo é pior que
errado, é silencioso: uma família reservada renomeada pelo provedor deixa de
casar, é lida como core e entra no treino sem nada reportar. Sob igualdade exata
ela cai em **nenhuma** das três listas e a corrida para
(`UndeclaredGeneratorFamily`) — a mesma assimetria de `UndecidedDomainSource`.

O terceiro papel existe porque os pools carregam um terceiro caso:
`ai_reserved.jsonl` entrega 1.185 linhas em nove famílias `madras_*` cuja linha
registra o nome de um corpus e nenhum provedor (`openrouter` é ROTEADOR, e
`gptoss5` nomeia justamente o provedor reservado). Core não pode tomá-las — treinar
numa linha possivelmente OpenAI destrói a única alegação de gerador não visto do
release —, reservar tampouco — seria publicar "gerador ausente do treino" para um
gerador cujo provedor ninguém nomeia, e todas as nove estão sob o piso de 200. Então
as linhas SAEM do corpus, contadas por família e com a razão declarada. No dia em
que a linha registrar provedor, a entrada muda de lista.

A cobertura é GUARDA e não alegação: `POOL_GENERATOR_FAMILIES` é o censo medido das
famílias que `load_ai` + `load_mixed` entregam, e
`assert_slate_roles_are_consistent` recusa nos dois sentidos — família do pool sem
papel, e papel sobre família que o pool não entrega.

Três consequências que o montador impõe:

- a reserva tem de caber no bloco cego **e deixar lugar ao lado**
  (`assert_the_blind_block_holds_both_roles`): o bloco cego carrega duas
  hipóteses ao mesmo tempo — recall no limiar, medido sobre positivos de famílias
  que o treino contém, e a fatia de gerador não visto —, então reserva igual ao
  bloco deixa a primeira sem população. Quanto de cada papel o bloco carrega é
  cota de coleta, e o montador não escolhe quais linhas reservadas descartar;
- reserva vazia **recusa** a montagem (`HeldOutReserveEmpty`).
  `heldOutGeneratorFamilies` vazio não é estado que o manifesto selado expresse,
  e substituir por um nome reinstalaria uma alegação que a corrida retirou;
- reserva que não CABE no bloco recusa também no carimbo
  (`assign_partitions`), onde os dois números são reais em vez de previstos. Ali
  se imprimia e seguia adiante — carimbando toda linha reservada num bloco que não
  as comporta e deixando o splitter recusar um passo depois.

### O conjunto de vistos é artefato, e a poda é global

A poda é contra os **10.000 registros do corpus morto** — todas as partições — e é
GLOBAL: candidato que casa sai do corpus, não só das partições cegas. É
superconjunto da graduação de exposição (ESTADO.md § 3.4), que readmitiria a linha
em `train`, `dev` e `cal-A`; as ~1.600 linhas recuperáveis são abdicadas para que
"nada deste corpus foi visto" seja uma comparação só.

Parte daquelas 10.000 linhas esteve em partição cega, então o montador **não** lê
o corpus morto: lê um artefato que carrega só digests e chaves de shingle.

```bash
py -3.13 near_dupes.py build-seen-index \
  --records ../data/corpus-build/dataset/records.jsonl \
  --out ../data/seen-index.v2.jsonl
```

Medido: 10.000 documentos, 3.323.576 chaves de shingle, 36,4 MB, ~8 s.
`assemble_corpus.py --seen-index` aponta para ele por default; uma montagem de
release **recusa** sem o artefato (`SeenIndexMissing`) e recusa um artefato que
cubra menos de 10.000 documentos (`SeenIndexIncomplete`) ou que tenha sido
construído sobre outro arquivo (`SeenIndexOfAnotherCorpus`: o cabeçalho declara o
sha256 do que indexou, e a contagem de documentos sozinha é satisfeita por
qualquer arquivo grande o bastante, incluindo os próprios pools) — pular a poda em
silêncio, ou telar contra o corpus errado, é o modo de falha que isso substitui. O artefato vive em
`benchmark/data/` (nunca no Git, nunca em pacote de evidência) e é estritamente
menos exposto que o material de que deriva, não incondicionalmente opaco: chave
de 64 bits de um 5-grama não é texto e não se inverte sozinha, mas um dicionário
de 5-gramas de pt-BR poderia testar candidatos contra ela.

A comparação é sobre CHAVES de 8 bytes de blake2b e o contrato diz isso: duas
chaves iguais são um elemento só para a tela, e colisão entre dois shingles que os
dois documentos compartilham tira um elemento da interseção E um da união, o que
BAIXA o Jaccard medido (82/100 = 0,82 vira 81/99 = 0,818, sob barra de 0,82). Sob
crc32 isso era construtível por busca em segundos e um par exatamente na barra
sobrevivia; a 64 bits o número esperado de pares em colisão sobre as 3.323.576
chaves do artefato real é ~3e-7, e é esse resíduo que a frase declara em vez de
alegar ausência.

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

`--provider` aceita as **quatro lanes congeladas** e recusa o resto na entrada:
`agy`, `codex` e `gemini_cli` autenticam pelo login do operador e `gemini` é o
único endpoint REST. Chave só por variável de ambiente (nunca impressa/gravada):
`GEMINI_API_KEY` (ou `GOOGLE_API_KEY`). As superfícies de API da OpenAI e da
Anthropic ficam nomeadas em `OUT_OF_SLATE_PROVIDERS`, com a razão — as famílias
OpenAI estão reservadas ao teste de gerador não visto (OOD) e chegam ao corpus
só pela lane `codex`; as famílias claude vêm pela lane `agy`. A recusa é na
argparse porque `PROVIDER_LANE[provider]` é lido **dentro do laço, depois da
chamada**: pedir uma lane fora do slate gastava uma chamada real e morria com
`KeyError` na primeira linha escrita.

```bash
python generate_ai.py --provider agy \
  --humans ../data/candidates/carolina.jsonl \
           ../data/candidates/wikipedia.jsonl \
  --output ../data/candidates/ai_agy.jsonl --per-provider 60
# idem --provider codex | gemini | gemini_cli; --dry-run mostra o plano sem
# chamar API
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
