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

**A moldura amostral é uma allowlist, não um filtro de conveniência.** Desde a
emenda de 2026-08-05 ela não tem nenhuma tipologia da Carolina:
`FRAME_TYPOLOGIES` está VAZIA, as SETE tipologias do pacote estão declaradas em
`OUT_OF_FRAME_TYPOLOGIES` com a razão medida de cada uma, e `extract_carolina.py`
recusa qualquer corrida em `CarolinaOutOfFrame` antes de abrir o arquivo — um
passe de 3,1 GB que escreve zero linha se lê como arquivo ruim, e a recusa é o
que carrega a razão. O módulo fica na árvore, não é apagado: readmitir a base tem
de custar uma emenda da moldura, não uma redescoberta de como ler um pacote TEI.
Uma tipologia que **nenhuma das duas listas nomeia** ainda recusa a corrida
(`TypologyOutOfFrame`) — o diretório vem grafado com espaço em algumas releases e
com underscore em outras, e é nisso que uma readmissão futura aterra.

O lado do montador espelha isso: `assemble_corpus.py` só admite a célula da
moldura (`REGISTER`/`HUMAN_SOURCE`), e Stack Overflow, resenha de
produto (B2W) e as tipologias fora da moldura seguem **nomeadas** em
`A1_BLOCKED_DOMAIN_SOURCES` e `OUT_OF_FRAME_DOMAIN_SOURCES`. As razões são
diferentes e o código as mantém separadas: termo de acesso é condição jurídica
satisfazível; "sem célula" é decisão de escopo. Um `domainSource` que **nenhuma
das três listas** nomeia recusa a corrida (`UndecidedDomainSource`), pelo mesmo
motivo da tipologia indecidida.

O vocabulário da célula é `preRegistration.quotaAxis.cells` — **uma** string,
`ptwiki`, desde a emenda da moldura de 2026-08-05 —, e `humanCoreStrata` carrega
a MESMA string: as duas grafias que existiam foram colapsadas porque nenhum lado
media o outro. É o campo `humanSourceType` que os gates fatiam, e o gate de FPR
por célula procura a hipótese que decide (`fpr-<célula>`) em
`multiplicity.primaryFamily`: escrito com outro vocabulário, o corpus conta zero
linha na célula do gate de composição e deixa a hipótese certificadora sem gate.

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

### A licença é do documento e viaja no registro

`document_license(cand)` é a **única** origem da licença de um registro humano: a
Carolina declara disponibilidade por `<TEI>`, então o extrator lê uma licença por
documento e o montador a transporta. `HUMAN_SOURCE` mapeia estrato → `sourceId` e
mais nada — um mapa estrato → licença é a constante que engolia a leitura.

Três desfechos, e a graduação é a de `UndecidedDomainSource`:

- licença **ausente** ou que o inventário revisado não publica → `MissingDocumentLicense`
  (subclasse de `UnwritableInV3`): a linha sai, contada, com o nome do documento;
- licença que **nenhuma** lista nomeia → `UndecidedDocumentLicense`, que para a corrida;
- `cc-by-4.0` e `public-domain` ficam nomeadas em `UNREVIEWED_DOCUMENT_LICENSES`:
  registrar os termos de uma licença é ato do inventário do corpus
  (`CORPUS_LICENSE_REGISTRY`), e "domínio público" é status e não instrumento.

O inventário `licenses[]` da governança e a licença de cada `sources[]` são
**projetados dos registros**, contra a allowlist `LICENSE_INVENTORY`: registro cuja
licença falte no inventário reprova o selo inteiro (`DATASET_LICENSE_INVALID`), e uma
entrada que nenhuma linha usa declara termos a que o corpus não está sujeito.

Fonte cujos documentos declaram **duas** licenças recusa
(`SourceCarriesTwoLicenses`): `ReviewedSourceEntryV1.licenseId` é uma string, então
nomear uma seria publicá-la para linhas que não a carregam. Não é hipotético — medido,
`carolina.jsonl` tem 3 documentos `cc-by-sa-4.0` contra 7.997 `cc-by-nc-sa-4.0`, e os 3
estão numa tipologia fora da moldura.

Um registro **gerado** não lê licença da linha: o texto foi produzido aqui e a concessão
é `GENERATED_LICENSE`. `generated_license(cand)` recusa o candidato que declare outra
(`GeneratedRowDeclaresAnotherLicense`), porque `import_public_corpus.py` escreve o corpus
gerado de um terceiro sob a licença desse terceiro — republicá-lo como geração própria
seria publicar uma concessão que ninguém aqui pode fazer.

### O gate antiartefato roda antes do treino, e regenera a lane

`artifact_gate.py`, chamado por `assemble_corpus.main()` depois da exclusão de
famílias do slate e antes de toda contagem por família e do carimbo de partição. O
conjunto de treino é o `train.jsonl` do split e o split é cortado desses registros,
então um corpus que passe daqui é um corpus que um treino pode ler; a recusa fica à
frente de `records.jsonl`.

Quatro detecções, cada uma nomeada no diagnóstico:

| detecção            | o que é                     | de onde vem a sonda                                                                                                |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `prompt-echo`       | a saída repete a instrução  | `generate_ai.RECIPES` (antes de `{reference}`) + 4 formas de diretiva de contagem de palavras                      |
| `refusal`           | o modelo declinou a tarefa  | frames que exigem o OBJETO recusado ("com isso", "esse pedido")                                                    |
| `metaconversation`  | a linha fala sobre a tarefa | frames de entrega, de oferta e de autoidentificação em 1ª pessoa                                                   |
| `harness-signature` | marca do binário/CLI        | `CLI_BANNER_PREFIXES`, `GEMINI_AUTH_MARKERS`, marcador de turno `assistant`, `<\|…\|>`/`[INST]`, bytes de controle |

O marcador de turno é procurado com a **linha** como fronteira, não a pontuação de frase:
a forma canônica do vazamento é `assistant` sozinho na própria linha. Medido, a pontuação
alcança 24 das 4.048 linhas geradas e a linha alcança 146, com zero nas 42.100 humanas.

Família acima de **2 %** manda a **lane inteira** para regeneração (A4). Poda seletiva
não é desfecho que o módulo consiga produzir: o relatório não nomeia linha nenhuma, só
família, contagem, fração e as sondas que casaram — derrubar as contaminadas deixaria
como corpus as que o detector não pegou. Não há denominador mínimo, então em `--sample`
a regra é tolerância zero: com 6 linhas numa família a menor fração não nula é 1/6.

Numa linha mista só os vãos `origin: "ai"` são varridos, e uma linha de geração
controlada SEM vão gerado recusa (`GeneratedRowCarriesNoGeneratedSpan`) em vez de sair do
denominador. Medido: as 2.135 mistas varridas inteiras dão 15 despedidas de assistente e
varridas nos vãos dão 1 — as outras 14 vêm do pai humano, que é resposta de fórum em pt-BR.

O relatório sai em `<out>/artifact-gate.json` **também** quando o corpus passa e **também**
quando o gate recusa — na recusa é o único arquivo escrito, porque as sondas que casaram
são o diagnóstico e a mensagem da recusa só carrega nomes e contagens.

```bash
# o gate roda dentro da montagem; para inspecionar o relatório de uma corrida:
py -3.13 -c "import json;print(json.load(open('<out>/artifact-gate.json'))['families'])"
```

Medido em 2026-08-05 sobre os pools: 148 de 4.048 linhas geradas (3,656 %) casam ao menos
uma detecção, e `madras_synthetic_corpusqwn` casa 146 de 150 (97,33 %) — família que o
slate já exclui por proveniência não registrada. Das 1.170 que a montagem consegue
construir hoje, 0 casam: as contaminadas morrem antes em `MissingRecipe`/`UnmappableLane`.
Controle de falso positivo em 8.600 linhas humanas, que o gate nunca lê: 2 (0,023 %).

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

## T4 — treino no Colab

Um backbone e uma seed, os dois congelados pela pré-inscrição
(`../preregistration-v4.json`: `backbone`, `backboneBakeOff: false`,
`seeds.publishableCheckpoint`). O script **lê** os dois de lá e recusa `--model` ou
`--seed` divergente — não há bake-off na v3, e um segundo checkpoint seria elegível ao
mesmo gate de export e à mesma medição certificadora.

**A pré-inscrição selada sobe com o script.** O upload do Colab cai num diretório plano, e
o script procura `preregistration-v4.json` um nível acima (layout do checkout) **e** ao seu
lado (layout do Colab); sem o arquivo, recusa com o path nomeado antes do argparse. Não há
default embarcado para cair: um espelho no lab seria autoridade que o `evaluatorDigest` não
vigia.

O smoke local (CPU) valida o script; o treino real roda num Colab T4 grátis:

```bash
# na sua máquina: empacotar o dataset final (após as lanes fecharem)
tar -czf dataset.tgz -C ../data/dataset train.jsonl dev.jsonl

# no Colab (Runtime > T4 GPU): subir dataset.tgz, train_detector.py E
# ../preregistration-v4.json (a política selada), então
!pip -q install torch transformers scikit-learn
!tar -xzf dataset.tgz
!python train_detector.py --train train.jsonl --dev dev.jsonl --outdir bertimbau
# baixar: bertimbau/best/ + metrics.json
```

`metrics.json` (AUC dev + FPR@recall>=0,6) é diagnóstico da corrida, não critério de
escolha entre modelos: o checkpoint `best/` segue para o T5.

## T5 — export ONNX int8 no Colab

```bash
# no Colab: subir bertimbau/best/, dev.jsonl, export_onnx.py E
# ../preregistration-v4.json, então
!pip -q install optimum onnx onnxruntime
!python export_onnx.py --checkpoint bertimbau/best --eval dev.jsonl --out cleanfeed-ptbr-v1
# baixar: cleanfeed-ptbr-v1-artifacts.zip (~110 MB)
```

Quatro recusas, todas nomeando o valor selado: política que sele backbone de outra **forma**
(o grafo emitido tem `input_ids`, `attention_mask`, `token_type_ids` e `vocab.txt`);
checkpoint cujo `config.json` divirja em `model_type`, `vocab_size`, `hidden_size` ou
`num_hidden_layers` — `model_type` sozinho é `"bert"` para todo BERT, e um fine-tune de
outro BERT passaria pela paridade e caberia no teto; grafo cujas entradas não sejam
exatamente as três (a paridade não pega, porque compara o grafo com os mesmos pesos torch);
e artefato acima de `onnxMaximumInt8Bytes`, que fica em staging e é apagado sem chegar ao
diretório de onde o empacotamento lê.
