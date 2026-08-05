# Manifesto de transplante — o dia zero do repositório novo

> O estado vigente vive em `docs/ESTADO.md`, que vence este arquivo. Em particular, a decisão do § 5
> tem hoje **três** formas (A, B, ou detector com a tabela escopada — `ESTADO.md` § 4), não as duas
> abaixo.

Escrito em 2026-08-03. O nome `cleanfeed` foi batizado para um filtro de feed do LinkedIn, produto que
o projeto deixou de ser. O repo novo recebe o que faz sentido, sem o histórico de tentativa e erro, com
o corpus zerado e com a alegação decidida **antes** da montagem.

**Um campo fica em branco e não é meu:** a alegação (§5). É o D0 reaberto — A publica o detector, B
publica o avaliador —, e A carrega também B1 e o botão de publicação. Minha recomendação está lá, e já
perdeu uma vez.

---

## 1. Decisão de linguagem — DECIDIDA pelo agente

**O repo novo continua TypeScript para a bancada, e Python para o lab.** É o que o repo atual já faz, e
funciona.

Razão: a bancada e os seus testes são o único diferencial medido do projeto — a auditoria de 2026-07-30
varreu 10 benchmarks, 7 shared tasks e 12 repositórios sem achar *um* arquivo de teste automatizado.
Reescrever a bancada em Python reinicia do zero a única coisa que a área não tem, para ganhar
uniformidade de linguagem que o repo atual prova ser dispensável.

**E o número certo é 1.265, não 2.499** — a comparação com a área exige a quebra, porque os projetos
auditados são código de pesquisa sem produto, e o total do repo infla com testes de extensão:

| área | testes | o que cobre |
|---|---:|---|
| `benchmark/tests` | **1.099** | o avaliador: ledger de cegueira, gates, aritmética de cota, congelamento de split, obrigações de licença, telas de over-claim, esquema e regras de estado dos eixos |
| `benchmark/lab/test_*.py` | **166** | extratores (137), quase-duplicatas (20), viabilidade de conectividade (9) |
| `tests/unit` + `inference` + `integration` + `contract` | 1.234 | a **extensão** — não é o diferencial, e boa parte não viaja |

**1.265 contra zero** é a comparação honesta. Continua sendo a alegação mais forte do projeto; era
2,0× menos do que eu havia escrito.

Reversão: se a decisão de alegação for B e o relatório pedir stack única, a bancada pode ser portada
depois — mas então é port de código verde, não reescrita de desenho.

## 2. O que VIAJA

### 2.1 O lab (Python, direto)

`benchmark/lab/` — **604 KB**, reusável sem tradução:

| arquivo | papel |
|---|---|
| `assemble_corpus.py` (104 KB) | montagem, eixos, cotas |
| `test_extractors.py` (150 KB) | os testes dos extratores |
| `extract_{wikipedia,carolina,b2w,stackexchange}.py` | as quatro fontes |
| `group_axes.py` | vocabulário de eixos e os três estados (`known`/`unknown`/`notApplicable`) |
| `near_dupes.py` | `prune()` e **`drop_seen()`** — é o que prova o dia zero limpo (§4) |
| `pseudonymize.py` | HMAC de identidade; é o que impede o `reviewer_id` da B2W de virar chave de junção |
| `test_connectivity_feasibility.py` | a medição de viabilidade do split |
| `generate_ai.py`, `make_mixed*.py` | geração e híbridos |
| `train_detector.py`, `export_onnx.py`, `baseline_tfidf.py` | treino e baseline |
| `evaluate_external.py`, `evaluate_slices.py`, `compare_detectors.py` | avaliação por fatia e comparação |

### 2.2 A bancada e os contratos (TypeScript)

`benchmark/*.ts` (71.757 linhas), `contracts/` (3.176) e `benchmark/tests/`.

O que dentro dela é insubstituível:

- **`cluster-exposure-ledger.ts`** — invalidação graduada por cluster e conteúdo, com o keyring
  atestando altura e digest de cauda. Viaja como **mecanismo**, não como memória: o ledger real está
  vazio (0 bytes), então não há história a carregar;
- **`holdout-ledger.ts`** — concessão de uso único, `started` consome antes de qualquer número sair;
- **`split.ts` / `split-audit.ts` / `split-artifact.ts`** — as cinco partições, os eixos de
  conectividade e o atestado de composição;
- **`rebuild-v3-policy.ts`** — o parser de política congelada, fecha-a-porta;
- as **telas de over-claim** em `source-manifest.ts`, que recusam frase proibida por lista de verbos.

### 2.3 Documentação — o que carrega razão

| arquivo | por quê |
|---|---|
| `references.md` | **270 entradas, 222 links**, ancoradas por decisão. Semanas de trabalho, agnóstico de linguagem |
| `detector-rebuild-assessment.md` | os oito defeitos de 25/07, medidos. Sem ele, você os reaprende na prática |
| `detector-rebuild-critical-review.md` | a errata externa daquele diagnóstico |
| `2026-07-30-registro-de-decisoes.md` | as decisões em vigor, com razão e custo de reversão |
| `2026-07-30-auditorias-externas.md` | a auditoria da área — o lastro da alegação de que o avaliador é o diferencial |
| `ESTADO.md` | o modelo de arquivo sobrescrito, que é o conserto da inflação |
| `corpus-collection-runbook.md` | o procedimento, incluindo o laço de preflight |
| `corpus-sources.md` | inventário, licenças e as rejeições com razão registrada |

### 2.4 Licença e atribuição — **obrigatório, não opcional**

`NOTICE.md`, `LICENSES.md`, `docs/LICENSE-DOCS.md`, `license-review.json` e a matriz por artefato.

Atribuição e share-alike são obrigações **do corpus**: Wikipédia é CC BY-SA, Carolina e B2W são
CC BY-NC-SA. Apagar o git é livre; deixar essas obrigações para trás não é.

## 3. O que NÃO viaja

| item | linhas | razão |
|---|---:|---|
| `src/` — a extensão | 24.687 | o modelo passa a ser usável de outras formas; a entrega é biblioteca/API. Se A for escolhida, **parte** volta: o worker de inferência e o teto `indicator` |
| `benchmark/data/corpus-build/records.jsonl` | 37,8 MB | **é o corpus exposto.** Fica no repo velho, e serve como `seen_texts` do §4 |
| `benchmark/out/rebuild-v3/` | — | saídas das fases A e C, sobre material exposto |
| o histórico git | 426 commits | a razão foi destilada em §2.3 |
| o plano v3, dormente | 9.563 | consulta no repo velho. Cita `rebuild-v3-policy` 60 vezes e essa política está `ABANDONADA` |

## 4. Como o dia zero fica limpo — e provado, não prometido

**"Nada foi consumido" é falso como história:** `holdout-ledger.jsonl` tem 2.638 bytes e registra o
consumo de 25/07 com `decision: reject`. A tabela de FPR por registro existe porque o bloco foi lido.

**Mas passa a ser verdade do corpus novo**, e a prova não exige ler `test`:

1. `records.jsonl` **não tem campo de partição** — dá os textos e não diz onde cada um caiu;
2. logo, excluir **todos os 10.000** textos antigos é superconjunto de excluir os expostos;
3. `drop_seen_against(docs, index)` já existe, e o índice vem de `near_dupes.py build-seen-index` —
   ninguém lê o corpus morto para isso, porque parte daquelas 10.000 linhas esteve em partição cega e o
   artefato carrega só digests e chaves de shingle. Sai o que casar por hash exato **ou** Jaccard ≥ 0,82
   sobre chaves de shingles de 5 tokens;
4. ledger e keyring do repo novo nascem **legitimamente** vazios — o atual já está em 0 bytes.

**O que isso NÃO conserta, e precisa estar dito no dia zero:** os mesmos três dumps continuam sendo os
mesmos **três eventos de aquisição**. Excluir texto antigo não cria aquisição nova. O corpus novo nasce
com ~3 blocos indivisíveis contra piso de **250 componentes por célula** — distância de 250×,
independente de exposição.

E a saída falsa, nomeada para ninguém tentar: baixar vários dumps datados da Wikipédia **não** gera
aquisições independentes. Dump é snapshot completo, então dois dumps contêm em grande parte os mesmos
artigos — dá duplicata, não independência. Fatiar o espaço de artigos entre dumps é o fatiamento
convencional que o registro já recusou.

**Conclusão honesta:** com três fontes públicas de licença limpa em pt-BR, 250 componentes por célula
provavelmente não se alcança. Se é assim, a resposta certa é **baixar a alegação**, não caçar fontes — e
é isso que o §5 decide.

## 5. ⬜ CAMPO EM BRANCO — a alegação, antes da montagem

Não delegável: é o D0 reaberto, e A carrega B1 mais o botão de publicação.

**Por que vem antes da montagem:** é a alegação que diz quantas partições e quantos componentes o corpus
precisa ter. Montar primeiro e decidir depois foi como a pré-inscrição v3 morreu.

```
Alegação escolhida:   [ A — preview, sem alegação de erro ]
                      [ B — avaliador, alegação comparativa ]
Data:
Decidida por:
```

**Recomendação do agente: B.** O avaliador é a parte sem precedente; o detector é uma semana de
fine-tune. Registro que recomendei B no D0 e o operador escolheu o detector — a recomendação não mudou,
e a prerrogativa segue sendo dele.

**O que "sem alegação de erro" significa, com precisão** — porque a palavra "desconhecida" é imprecisa e
o fato é mais desconfortável que ignorância:

Números existem. O que não existe é número que valha para o que sairia.

1. **outra configuração.** Os 7,12 % de FPR em resenha da B2W foram medidos sobre artefato **calibrado**,
   com limiar congelado em `out/fit/frozen-calibration.json`. O pacote que A publica é
   `bundle-verified` com `profileDigests: []` — **não calibrado**, e o preview roda por caminho que
   carrega o modelo e o executa `UNCALIBRATED`. O número foi medido num limiar que não existe ali;
2. **medição invalidada.** O bloco de teste excluía os dois registros em que o modelo erra. A afirmação
   defensável é "entre 0 % e 7,1 % dependendo do gênero", e 7,1 % é texto informal curto — o gênero que
   uma extensão encontra num feed;
3. **intervalo não calculável.** As linhas por registro não são independentes (~1 componente por fonte);
   o bootstrap agrupado degenerou para i.i.d. sobre singletons, e todo intervalo saiu mais estreito do
   que os dados sustentam, na direção que lisonjeia.

Portanto o risco de A não é publicar sem saber nada. É publicar **sabendo que em resenha de produto o
modelo já errou a 7 %** num limiar diferente, e não poder dizer quanto erra no limiar que sai. A frase
R7-correta do plano é a formulação honesta disso, e é ela que A publica.

Consequência de cada escolha no corpus:

- **A** — não alega nada, então não precisa de corpus novo **nenhum**. O transplante é só §2 e §3, e o
  §4 fica sem uso. É o caminho mais curto até artefato;
- **B** — alegação comparativa sobre os mesmos dados exige muito menos que cota absoluta por célula.
  Corpus externo (MULTITuDE-pt, MultiSocial-pt) mais o nosso nos estratos que eles não cobrem. Aí o §4
  vale, e o piso de 250 sai de cena.

## 6. Os três arquivos que só o operador move

Estão sob `private/` e a regra proíbe o agente tocá-los:

| arquivo | o que fazer |
|---|---|
| `benchmark/data/corpus-build/private/holdout-ledger.jsonl` | **não levar.** Registra o consumo de um dataset que não participa do repo novo |
| `benchmark/data/private/cluster-exposure-keyring.v1.json` | **não levar.** Keyring novo é o correto: sem história a comparar, chave antiga não serve para nada |
| `benchmark/data/private/cluster-exposure-ledger.v1.jsonl` | **não levar** — está em 0 bytes |

Se você quiser, em vez disso, **reusar** as ~1.600 linhas recuperáveis, então os três viajam **juntos**,
e você precisa semear o ledger novo lendo `out/split/split-artifact.json`. Essa leitura é pertença de
`test` e é sua, não minha. Escolher §4 (descartar tudo) evita isso inteiro.

## 7. Ordem do dia zero

1. repo novo, nome que caiba num modelo reutilizável;
2. **preencher o §5**;
3. transplantar §2, respeitando §3;
4. se a escolha for B: extração nova com `drop_seen` contra os textos antigos (§4);
5. **preflight de viabilidade antes de montar** — exigir que exista solução de partições dentro da
   tolerância sobre tamanhos e intervalos temporais dos componentes. É a guarda que o E2 aprendeu a
   escrever e que a pré-inscrição v3 não teve;
6. `ESTADO.md` desde o primeiro commit, sobrescrito;
7. **um** plano, e nenhum plano novo até existir artefato.
