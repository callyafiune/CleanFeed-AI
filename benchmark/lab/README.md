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

Dez detecções, cada uma nomeada no diagnóstico. As quatro primeiras vêm das constantes do próprio
gerador; as seis seguintes foram calibradas por sonda sobre os pools em disco, e cada linha traz a taxa
medida como `humano em moldura / ai / mistas nos vãos` (11.000 linhas ptwiki, 19.673 `ai`, 2.135 mistas):

| detecção              | o que é                              | de onde vem a sonda                                                                                                                                                                                        | taxa medida                   |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `prompt-echo`         | a saída repete a instrução           | `generate_ai.RECIPES` (antes de `{reference}`) + 4 formas de diretiva de contagem de palavras                                                                                                              | 0 / 2,23 % / 0                |
| `refusal`             | o modelo declinou a tarefa           | frames que exigem o OBJETO recusado ("com isso", "esse pedido")                                                                                                                                            | 0 / 0 / 0                     |
| `metaconversation`    | a linha fala sobre a tarefa          | frames de entrega, de oferta e de autoidentificação em 1ª pessoa                                                                                                                                           | 0 / 0,33 % / 0,05 %           |
| `harness-signature`   | marca do binário/CLI                 | `CLI_BANNER_PREFIXES`, `GEMINI_AUTH_MARKERS`, marcador de turno `assistant`, `<\|…\|>`/`[INST]`, controle                                                                                                  | 0 / 8,18 % / 0                |
| `spacing-anomaly`     | espaço que nenhum escritor deixa     | corrida de espaço, espaço terminal antes de `\n`, tab dentro da linha                                                                                                                                      | **0** / 0 / **8,76 %**        |
| `encoding-corruption` | mojibake, dupla codificação, U+FFFD  | cabeça `Ã`/`Â` mais cauda Latin-1 (ou controle C1, que é a dupla), e U+FFFD                                                                                                                                | 0 / 0,05 % / 0                |
| `invisible-character` | code point que não renderiza         | os **27** code points que o contrato de normalização remove: ZWSP, ZWNJ, ZWJ em palavra, NBSP em corrida, hífen suave, BOM, word joiner, marcas de direção, operadores invisíveis, enchimentos Hangul, CGJ | 0,59 % / 0,02 % / 0,05 %      |
| `markdown-formatting` | sintaxe de Markdown                  | cerca de código, marcador de lista, ênfase por asterisco, tabela de pipe (separadora ou duas linhas)                                                                                                       | 0,11 % / **44,72 %** / 4,12 % |
| `heading-line`        | linha de título                      | `## `, `Título:`/`Resposta:`, numeração de seção, sublinha setext                                                                                                                                          | 0,06 % / **20,72 %** / 1,55 % |
| `prompt-boilerplate`  | a FORMA de uma instrução de template | diretiva com o artefato como objeto, atribuição de papel, referência ao material do prompt, orçamento de palavras                                                                                          | 0,05 % / 3,11 % / 0,05 %      |

**O gate acusa o que a normalização de inferência apaga, e isso é deliberado.**
`contracts/text-normalization.ts` remove os invisíveis, dobra separadores e roda NFKC **antes** da
tokenização — então o modelo pode nunca ver um ZWSP. O que o gate mede não é a entrada do modelo: é
contaminação da **lane**. Uma lane que emite uma marca a uma taxa que a classe humana não tem entrega o
rótulo de graça, e o remédio de A4 é regenerar a lane, não filtrar o caractere. Um teste do lab parseia
`REMOVED_INVISIBLE_CHARACTERS` do lado TypeScript e afirma, por **igualdade de conjuntos**, que o gate
acusa cada um dos 27 code points que o contrato remove: um code point acrescentado lá sem sonda aqui
seria apagado antes do modelo e nunca contado contra a lane, e é essa a diferença que o teste recusa.

**A fração é por LINHA.** Uma linha que é eco de prompt E tem cabeçalho é UMA linha contaminada com as
duas razões nomeadas; a soma por detecção pode passar da contagem de contaminadas, e é isso que o teste
`test_a_line_with_two_detections_is_one_contaminated_line` fixa — com números em que a diferença muda o
veredito (2 % limpo contra 4 % de recusa).

**Duas sondas foram medidas e RECUSADAS**, e a recusa está pinada por teste: espaço antes de pontuação
(7,15 % no humano em moldura contra 0,55 % no gerado — direção invertida e acima do teto no lado humano) e
NBSP **nu** (1,45 % contra 0,005 %, que sozinho levava a união humana a 2,18 %). A regra que sobrou está
escrita no módulo: a **união** das dez detecções sobre a classe humana em moldura fica abaixo do teto, ou
o gate estaria recusando lanes por serem humanas. Medido: **0,809 %**.

E a regra é **imposta**, não só escrita: `test_the_union_over_the_in_frame_human_class_stays_below_the_ceiling`
roda o gate sobre 1.000 linhas com a composição medida da classe humana em moldura — as quatro formas
recusadas incluídas, na taxa em que a Wikipédia pt as escreve — e exige veredito `clear` (1,0 % contra teto
de 2 %). Uma sonda nova cuja taxa no lado humano passe do teto deixa esse teste vermelho. Os pools não
estão no repo (`benchmark/data/*` é gitignored), então o que o checkout guarda é a composição medida, não
o pool.

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

Medido em 2026-08-05 sobre os pools, com as **quatro** detecções de então e sobre os 4.048
candidatos `ai` **depois** da dedup: 148 casam ao menos uma detecção (3,656 %), e
`madras_synthetic_corpusqwn` casa 146 de 150 (97,33 %) — família que o slate já exclui por
proveniência não registrada. Das 1.170 que a montagem consegue construir hoje, 0 casam: as
contaminadas morrem antes em `MissingRecipe`/`UnmappableLane`. Controle de falso positivo em
8.600 linhas humanas, que o gate nunca lê: 2 (0,023 %).

As dez detecções foram medidas num denominador **diferente** — as linhas dos arquivos de pool,
sem dedup —, e é a coluna "taxa medida" da tabela acima. Os dois números não se comparam: um é
quatro detecções sobre o conjunto deduplicado, o outro é dez sobre os arquivos.

Sobre as mesmas 1.170, com as **dez**, o veredito muda: **24 contaminadas (2,05 %)** e
`gemini-3_1-flash-lite` em **16/256 = 6,25 %**, acima do teto, o que manda a lane `gemini-api`
para regeneração. A única detecção que dispara é `markdown-formatting`. Não é efeito de hoje —
com a poda global ligada nenhum registro gerado chega ao gate —, mas é o veredito que vale no dia
em que a classe gerada voltar a existir.

### As sondas diagnósticas, e a única que recusa

`diagnostic_probes.py` responde "o que este detector pode aprender EM VEZ de autoria". Quatro sondas,
TF-IDF/regressão logística em CPU, sem torch:

| sonda                  | o que mede                                                     | decide?                     |
| ---------------------- | -------------------------------------------------------------- | --------------------------- |
| 1 · `probe_partitions` | prever `train` × `dev` × `cal-A` (validação adversarial, C2ST) | **SIM — recusa a MONTAGEM** |
| 2 · `probe_length`     | prever a classe **só** pela contagem de palavras               | não                         |
| 3 · `probe_lanes`      | prever a lane dentro da classe `ai`                            | não                         |
| 4 · `probe_stylometry` | 19 features baratas, e os **coeficientes**                     | não                         |

Mais duas quantidades publicadas ao lado: `spelling_error_rate` (sonda de **viés**, nunca feature) e
`probe_window_dispersion` (amplitude do escore entre janelas, o sinal natural de autoria mista).

A sonda 1 recusa por duas razões nomeadas — `partition-predictable` (AUC um-contra-resto ≥ 0,60 **e**
p < 0,01) e `text-shared-across-partitions` — e as duas são necessárias, porque um texto presente em
`train` e em `dev` é invisível a um classificador de partição: as mesmas features carregam dois rótulos
opostos. `cal-B` e `test` nunca alcançam sonda; o relatório publica **um** contador agregado do que foi
posto de lado, e alargar `OPEN_PARTITIONS` reprova dentro da sonda.

```bash
# sobre um corpus MONTADO (partições carimbadas): a sonda 1 roda e o exit != 0 recusa
py -3.13 diagnostic_probes.py --records ../data/<out>/records.jsonl \
  --out ../data/<out>/diagnostic-probes.json

# sobre os pools (não há partição: a sonda 1 não roda). ESTA é a invocação que reproduz as
# taxas de ESTADO § 5.7: --in-frame-pools são os 9 arquivos de IN_FRAME_POOLS, a célula publicada
py -3.13 diagnostic_probes.py --pools ../data/candidates --in-frame-pools \
  --permutation-repeats 5 --out /tmp/probes.json

# --pool-file escolhe à mão, para quem quer outro recorte
py -3.13 diagnostic_probes.py --pools ../data/candidates \
  --pool-file wikipedia_fresh.jsonl --pool-file ai_fresh_agy.jsonl \
  --out /tmp/probes.json
```

**`--pools` sem restrição não é o que mediu § 5.7:** lê o diretório inteiro, 67.934 linhas, inclusive
`ptso*` (bloqueado por nome, F0-6, e que este adaptador rotularia `human`), `carolina*`/`b2w*` fora de
moldura e a família OpenAI reservada ao OOD. O relatório carrega `inputs.rowsPerFile` justamente para que
"em moldura" seja verificável a partir do artefato.

A recusa **não** é imposta por consumidor: `assemble_corpus.main()` não chama a sonda (o montador é
stdlib-only e a validação cruzada rodaria em toda fixture de montagem). É passo de runbook, com a mesma
forma da dívida do relatório do gate antiartefato.

Medido em 2026-08-05 sobre 9.707 linhas de pool em moldura (ESTADO § 5.7): comprimento AUC **0,5009** e
ainda assim fração `ai` por decil entre 0,15 e 0,59 — AUC no acaso **não** é distribuição igual; lane AUC
macro **0,9713** sobre **três** lanes (`fable` não tem material gerado fresco); estilometria AUC **0,9853**
com `hapax-rate` e `parenthesis-rate` carregando o sinal; erro ortográfico 0,00581 no humano contra 0,00083
no gerado; dispersão `mixed` 0,622 (n=66) contra 0,147 no humano (n=78).

As duas colunas de AUC da sonda 2 — a ajustada e a do rank da contagem crua — **não são a mesma quantidade**:
a primeira agrupa predições fora de dobra de cinco modelos, e uma união de mapas monótonos não é monótona.

### O baseline é DETECTOR DE VAZAMENTO, e por isso vê caractere

`baseline_tfidf.py` roda **duas** vetorizações em paralelo e reporta as duas: palavra (1,2) e caractere
(3,6), com `analyzer="char"`. A segunda não entrou por desempenho — o papel do baseline na Fase 4 é ser
detector de vazamento (D19), e n-grama de palavra atravessa sem ver os artefatos tipográficos que o gate
antiartefato caça: `**palavra**` e `palavra` dão o **mesmo** token. `char_wb` está fora de propósito, porque
confina os n-gramas ao interior das palavras e as marcas medidas vivem atravessando a fronteira (`** `,
`|`, espaço antes de quebra).

Desempenho alto aqui continua significando **artefato de fonte** e não qualidade, e as duas colunas dizem
qual: palavra alta com caractere baixo é lexical ou de tópico, caractere alto com palavra baixa é
tipográfico. Cuidado com uma leitura medida: sobre material **pareado por tópico** — que é o desenho do
piloto — a AUC de palavra cai a 0,019, abaixo do acaso, porque fora de dobra o modelo prevê o rótulo da
gêmea que viu. Abaixo do acaso não é "nenhum artefato".

```bash
py -3.13 baseline_tfidf.py --ai ../data/candidates/ai_fresh_*.jsonl \
  --humans ../data/candidates/wikipedia_fresh.jsonl
```

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

`--provider` aceita as **quatro lanes que este script dirige** e recusa o resto na
entrada: `agy`, `codex` e `gemini_cli` autenticam pelo login do operador e `gemini`
é o único endpoint REST. Chave só por variável de ambiente (nunca impressa/gravada):
`GEMINI_API_KEY` (ou `GOOGLE_API_KEY`). As superfícies de API da OpenAI e da
Anthropic ficam nomeadas em `OUT_OF_SLATE_PROVIDERS`, com a razão — as famílias
OpenAI são núcleo e chegam ao corpus só pela lane `codex`; as famílias claude vêm
pela lane `claude-code`, que é chamada de subagente de dentro de uma sessão e não
subprocesso que este script consiga lançar. A recusa é na
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

**A pré-inscrição selada sobe com o script, e o leitor dela também.** O upload do Colab cai
num diretório plano, então **dois** arquivos sobem junto de cada script: `sealed_policy.py`
(o leitor) e `preregistration-v4.json` (a política). Sem o leitor, o script morre em
`ModuleNotFoundError: No module named 'sealed_policy'` na primeira linha — os dois scripts
o **importam**, porque duas cópias do resolvedor podiam discordar sobre qual arquivo é
autoridade. Sem a política, recusa com o path nomeado antes do argparse.

O leitor procura `preregistration-v4.json` um nível acima (layout do checkout) **e** ao seu
lado (layout do Colab), e **parseia**: `json.loads` não é parse — todo objeto JSON o
satisfaz, inclusive `rebuild-v3-policy.json`, que está na árvore e declara o backbone
descartado e o teto de 109 681 931. O parser pina `policyVersion`, exige os quatro valores
que o lab lê e recusa nomeando campo e path. Não há default embarcado para cair: um espelho
no lab seria autoridade que o `evaluatorDigest` não vigia.

**Nomear os campos não é identidade, então os BYTES são conferidos.** `policyVersion` não
se move quando a pré-inscrição é emendada, logo ele não separa uma emenda da outra: uma
cópia com a versão selada, `seeds.publishableCheckpoint: 42` e teto 340 000 000 passava por
todas as conferências de campo, e a guarda de seed comparava 42 com 42. O leitor pina o
`sha256` do arquivo (`SEALED_POLICY_SHA256`) e recusa nomeando path, digest medido e digest
esperado. Suba o arquivo **como arquivo** — uma cópia recolada num editor de texto tem
outros bytes e é recusada (o próprio `json.dumps` da política dá 11 956 bytes contra os
11 742 rastreados).

Emendar a pré-inscrição passa a exigir reescrever esse literal no mesmo commit: o teste do
lab compara os dois e reprova até que alguém o faça.

`--model` e `--seed` **não têm default tirado da política**: ausentes, são DELEGADOS e a
corrida imprime `DELEGADO … (nao conferido)`; presentes, são comparados e recusados. Um
default lido do mesmo objeto que a guarda lê faria a guarda comparar um valor consigo mesmo.

Cada corrida **imprime** o path e o `sha256` da política que leu, e escreve os dois no
recibo (`metrics.json` no treino, `parity_report.json` no export), com `policyOrigin`
dizendo de onde o arquivo veio — `tracked`, `beside-the-script` ou `explicit-path`. O
marcador diz **onde**; quem diz **o quê** é o digest.

O smoke local (CPU) valida o script; o treino real roda num Colab T4 grátis:

```bash
# na sua máquina: empacotar o dataset final (após as lanes fecharem)
tar -czf dataset.tgz -C ../data/dataset train.jsonl dev.jsonl

# no Colab (Runtime > T4 GPU): subir dataset.tgz, train_detector.py, sealed_policy.py E
# ../preregistration-v4.json (a política selada), então
!pip -q install torch transformers scikit-learn
!tar -xzf dataset.tgz
!python train_detector.py --train train.jsonl --dev dev.jsonl --outdir bertimbau
# baixar: bertimbau/best/ + metrics.json
```

`metrics.json` (AUC dev + FPR@recall>=0,6, mais seed e identidade da política) é
diagnóstico da corrida, não critério de escolha entre modelos: o checkpoint `best/` segue
para o T5. O treino grava `id2label = {0: human, 1: ai}` no checkpoint — o índice 1 é
P(ai) em todo o caminho a jusante, e `scripts/package-own-model.mjs` estampa esse mesmo
contrato no config servido.

`metrics.json` **não** é o recibo F6: ele não liga os pesos ao corpus nem ao split.

## T5 — export ONNX int8 no Colab

```bash
# no Colab: subir bertimbau/best/, dev.jsonl, export_onnx.py, sealed_policy.py E
# ../preregistration-v4.json, então
!pip -q install optimum onnx onnxruntime
!python export_onnx.py --checkpoint bertimbau/best --eval dev.jsonl --out cleanfeed-ptbr-v1
# baixar: cleanfeed-ptbr-v1-artifacts.zip (~110 MB)
```

**Nada é escrito em `--out` antes de todas as guardas aceitarem.** O bundle inteiro é
montado em `<out>.staging`, as guardas rodam lá, e só então o diretório e o ZIP são
promovidos. A publicação anterior (diretório **e** ZIP) é removida no começo da corrida, e
a remoção é impressa: `zipfile.ZipFile(..., "w")` só trunca se a execução chegar até ele,
então uma recusa na segunda corrida deixaria o ZIP aprovado da corrida A ao lado do
diretório rejeitado da corrida B.

**`--out` é apagado, então o que pode ser apagado é estreito.** Só um diretório que carregue
os **dois** marcadores que este exportador escreve (`onnx/model_int8.onnx` e
`parity_report.json`) — ou um diretório vazio — é removido. Qualquer outro é recusado, e um
que carregue arquivo de checkpoint (`model.safetensors`, `pytorch_model.bin`,
`training_args.bin`, `optimizer.pt`, `scheduler.pt`, `trainer_state.json`) é recusado
nomeando o arquivo: `save_pretrained` deixa `config.json`, `vocab.txt`, `tokenizer.json`,
`tokenizer_config.json` e `special_tokens_map.json`, que são cinco dos sete nomes do bundle,
e `--out bertimbau/best` foi medido apagando os pesos treinados. `--out` igual ao
`--checkpoint`, dentro dele ou contendo-o é recusado antes de qualquer remoção. Um arquivo
no caminho do ZIP que não seja ZIP também é recusado.

As recusas, todas nomeando o valor selado:

- política que sele backbone de outra **forma** (o grafo emitido tem `input_ids`,
  `attention_mask`, `token_type_ids` e `vocab.txt`);
- checkpoint cujo `config.json` divirja em qualquer um dos **oito** campos da forma selada
  (`model_type`, `vocab_size`, `hidden_size`, `num_hidden_layers`, `intermediate_size`,
  `num_attention_heads`, `max_position_embeddings`, `type_vocab_size`) — os quatro
  primeiros **não identificam** o modelo: `model_type` é `"bert"` para todo BERT, e um BERT
  12×768 de vocabulário 29 794 com `intermediate_size: 16` passaria por eles, exportaria
  limpo, caberia no teto e concordaria consigo mesmo na paridade;
- checkpoint que não declare **cabeça de classificação binária**: `architectures` tem de
  ser `["BertForSequenceClassification"]` e `id2label` tem de ser exatamente
  `{0: human, 1: ai}` — `train_detector.py` grava essa ordem, então nem a invertida nem o
  par anônimo `LABEL_0`/`LABEL_1` vêm do produtor selado.
  `AutoModelForSequenceClassification` **carrega** um checkpoint base, constrói o
  classificador ao AZAR e apenas avisa;
- carga que tenha **inventado** a cabeça ou o pooler sob ela: `classifier.*` ou
  `bert.pooler.*` em `missing_keys`/`mismatched_keys` recusa — o pooler alimenta o
  classificador, então um pooler ao azar entrega entrada aleatória a uma cabeça treinada;
- vocabulário que não seja o selado, medido no **arquivo** e não no campo: `vocab.txt` tem
  de ter exactamente 29 794 entradas, no checkpoint e no bundle;
- grafo cujas entradas não sejam exatamente as três (a paridade não pega, porque compara o
  grafo com os mesmos pesos torch);
- artefato acima de `onnxMaximumInt8Bytes`, que fica em staging e é apagado sem chegar ao
  diretório de onde o empacotamento lê;
- **escore degenerado**: paridade cujo **intervalo interquartil** do escore não supera a
  própria tolerância de 0,02. Paridade é verificação de AUTOCONSISTÊNCIA, não de validade, e
  um modelo com cabeça não treinada a MAXIMIZA — cabeça zerada devolve o mesmo logito para
  todo texto, os dois lados calculam P(ai) = 0,5, `meanAbsDelta` é exatamente 0 e o veredito
  era `pass: true`. A estatística é interquartil e não amplitude porque **um** documento em
  120 derrubava o piso: 119 escores em 0,5 e um em 0,9 dão amplitude 0,4 e passavam;
- **amostra de uma classe só**: `--eval` cujo arquivo não tenha as duas etiquetas é
  recusado nomeando `label`, e a amostra é sorteada **balanceada** (metade de cada classe,
  espaçada pelo arquivo inteiro em vez das primeiras `--parity-samples` linhas). `dev.jsonl`
  é AGRUPADO — medido: as 4 118 linhas são 2 640 de `label` 0 e depois 1 478 de `label` 1 —,
  então as primeiras 120 eram todas humanas, e sobre uma classe só o escore de um detector
  confiante é tão achatado quanto o de um constante: o piso de degenerescência recusaria o
  export legítimo. `parity_report.json` publica `sampleLabelCounts`;
- `--eval` ausente ou vazio, e `--parity-samples` abaixo de 2 (a amostra balanceada precisa
  de uma linha de cada classe). Amostra vazia nunca "passou por construção": `np.mean([])` é
  `nan`, `nan < 0,02` é falso e `np.max([])` **estoura** — o que a guarda muda é recusar
  antes dos imports, nomeando a flag, em vez de estourar depois de o int8 já existir.

Nenhuma dessas recusas prova que a cabeça foi **treinada** — a prova é o recibo F6, ligando
corpus, split, política, seed e hash dos pesos ao checkpoint, e ela não existe ainda
(dívida do ESTADO § 7).
