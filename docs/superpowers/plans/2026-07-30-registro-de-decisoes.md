# Registro de decisões — em vigor por delegação, ratificáveis nos marcos

> **O estado vigente vive em `docs/ESTADO.md`, que é sobrescrito e vence este arquivo.** Este registro é
> append-only e guarda razão, medição e retratação; parte do que ele contém já foi superada, e a lista do
> que NÃO aplicar está em `ESTADO.md` § 6.

**Modelo de governança (pedido do operador em 2026-07-30):** o agente decide ancorado no escopo do
projeto, registra com razão e custo de reversão, e o trabalho **não para**. O operador ratifica ou
reverte lendo este registro — e a ratificação só é *obrigatória* antes dos **marcos irreversíveis**
(selagem do corpus, qualquer publicação externa, consumo de partição selada). Até lá, reverter
qualquer decisão custa apenas o retrabalho anotado nela.

**Honestidade de autoria (R4):** cada decisão registra QUEM decidiu. Nada aqui afirma que o operador
decidiu o que ele não decidiu. Status possíveis: `EM-VIGOR (delegada)` → `RATIFICADA` | `REVERTIDA`.

**O que NUNCA é delegado:** D0 (o fork), B1 (risco jurídico pessoal), B6 (o calendário do operador),
apertar qualquer botão de publicação externa, ler `test`/`cal-B`/ledger real, gastar dinheiro além do
envelope A6.

---

## ABERTAS — só o operador (1 viva, após D0)

| # | decisão | por que não é delegável |
|---|---|---|
| ~~D0~~ | **DECIDIDA pelo operador em 2026-07-30: caminho 1, o detector.** A recomendação do agente era o caminho 2 (estudo); o operador decidiu pelo detector. Estudo e encerramento ficam descartados | — |
| **B1** | Posição (a) com parecer jurídico antes de publicar pesos, ou risco assumido por escrito | o risco é pessoal seu, não do projeto |
| **B6** | Aceitar o calendário do caminho escolhido | idem |

**B6 (aceitar o calendário) fica satisfeita pela própria escolha do caminho 1.** Sobra **B1**, que
bloqueia somente a Fase 3 (publicação de pesos) — as Fases 0 a 2 correm sem ela.

Com D0 = 1, o bloco B está vivo e o bloco C (estudo) fica arquivado como não aplicável.

---

## EM VIGOR por delegação — bloco A (comuns aos caminhos 1 e 2)

| # | decisão | razão ancorada no escopo | reversão | ratificar antes de |
|---|---|---|---|---|
| A1 | **Stack Overflow SAI do corpus** | termo de acesso do dump (2024) sem disposição jurídica; buscar disposição é lento e incerto para dev solo sem verba; R9 estendido exige termo de acesso limpo. Estrato `qa-informal` fica descoberto e **declarado** (R7). A fonte volta se a disposição vier | refazer D1 parcial (~dias) | **selagem do corpus** |
| A2 | **Eixo = 4 células por FONTE** (Wikipedia, B2W, Carolina×2 registros se couber; pooling justificado como perda de resolução) — consequência coerente de A1 | sem SO, "5 registros" perde a célula `qa-informal`; renomear o eixo para fonte é o que o codex prescreveu para esse caso | emenda de pré-registro (~horas) se A1 reverter | **selagem do corpus** |
| A3 | `drop_seen()` = hash exato + Jaccard ≥0,82, descrito só como isso | R7; consenso de 3 revisões | trivial | — |
| A4 | Antiartefato pré-treino; **família >2% contaminada → regenera a lane inteira** | contaminação de treino é o modo de falha nº 1 documentado (DetectRL 36,3%); poda seletiva mascara o viés da lane | regenerar custa API barata | — |
| A5 | Revisão adversarial só em caminho selado; 1 rodada no resto, menores registrados. **Emendada em 2026-07-31** pela decisão de processo do operador (ver § "Processo de execução por unidade"): passou a haver uma etapa de verificação de DESENHO pelo Fable antes de qualquer código, em toda unidade | rodadas de revisão são onde os tokens moram; o selado protege a bala, o resto não | subir de nível a qualquer momento | — |
| A6 | Colab Pro pré-autorizado até **R$60/mês** | destrava treino sem round-trip | cancelar | — |
| A7 | Rajadas dimensionadas pelo rate limit; teto semanal bateu → fila pausa e retoma sozinha | `hasExtraUsageEnabled: False` — não há o que decidir quando bater | — | — |

## EM VIGOR por delegação — bloco B (só caminho 1)

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| B2 | Pesos sob **licença própria estilo OpenRAIL-M**: NC + proibição de uso disciplinar/acadêmico/empregatício/decisório | é a única família de licença que carrega a política de uso junto com os pesos (a copy da extensão não viaja com pesos extraídos — achado codex) | trocar licença antes do release | **publicação dos pesos** |
| B3 | Família primária **m=4**: FPR pior estrato core · recall no limiar · calibração global · integridade. Todo o resto = diagnóstico não certificador. **Piso: n ≥ 250 clusters independentes por célula** | aritmética, com `n` explícito porque sem ele não é pré-registro: m=61 → α=0,00082 → **2,8026 %** em n=250 (autodestrutivo); m=4 → α=0,0125 → **1,7375 %** em n=250 e **0,8522 %** em n=512 | emenda até a selagem; depois R3 tranca | **selagem** |
| B4 | GitHub (código+evidência) + HF **gated** por aceite da política (pesos) | canal padrão da área; gating implementa B2 | mover antes do release | **publicação** |
| B5 | Mismatch pós-exposição = **terminal** | já implementado e testado em `937dc80`; reverter custaria a garantia da Guarda 6 | não reverter | ratificação simples |

## EM VIGOR por delegação — bloco C (só caminho 2)

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| C1 | Candidatos: **Binoculars, Fast-DetectGPT, RoBERTa-OpenAI, 1-2 HF top-downloads, cleanfeed-ptbr-v1 (interno)**. Só open/gratuito | orçamento ~zero; APIs pagas (GPTZero) enviesariam o estudo para quem pagamos | adicionar depois | **publicação do estudo** |
| C2 | Corpora externos: MultiSocial-pt + MULTITuDE-pt (uso avaliativo, sem redistribuir) + nosso corpus nos estratos que eles não cobrem | são os dois únicos com corte de data compatível com nossa base de rótulo | — | idem |
| C3 | Publicar como **repo público + relatório técnico md**; arXiv/venue depois se o resultado justificar | menor atrito para dev solo; a venue não muda o conteúdo | — | idem |
| C4 | `test`/`cal-B` selados **preservados** para eventual caminho 1 futuro | custo zero, mantém a opção | — | — |
| C5 | Nosso modelo entra como candidato **sem publicar pesos** ("modelo próprio, não distribuído") | evita toda a questão de licença de pesos dentro do estudo | — | — |

## Decisões da Fase 0, tomadas pelo AGENTE em 2026-07-31

Executadas sob o modelo acima: decidi, registrei, não parei. Cada uma nomeia o custo de reversão.
Nada aqui afirma que o operador decidiu — ele ratifica lendo.

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| F0-1 | **Licença dos pesos nomeada `cleanfeed-weights-nc-1.0`**, família OpenRAIL-M, arquivo `models/cleanfeed-ptbr-v1/LICENSE` | B2 pedia "licença própria nomeada" e não nomeava. Tudo a jusante precisa do nome: `declaredLicense`, os inventários fechados do bundle, a copy do gating no HF | renomear antes do release (troca de string em 4 lugares + o arquivo) | **publicação dos pesos** |
| F0-2 | **Restrição comercial só nos PESOS; código fica MIT** | restrição no código não protege ninguém — quem quiser detector comercial treina o próprio — e só conseguiria impedir o reuso da bancada de avaliação, que é a parte sem precedente. `docs/corpus-sources.md` prescrevia PolyForm para o código; foi descartado e a razão ficou escrita | trocar `LICENSE` da raiz | **publicação** |
| F0-3 | **Documentação e evidência sob CC BY 4.0**, não CC BY-NC | evidência existe para ser checada, citada e republicada. NC atingiria curso pago, jornal e auditoria contratada — exatamente quem deve poder usar | trocar `docs/LICENSE-DOCS.md` | **publicação** |
| F0-4 | **`license-review.json` FICA `pending`**, com o conteúdo da revisão completo e um bloco `ratification` que nomeia B1 | o gate lê a string `approved` literalmente. Escrever `approved` seria o agente assinando a revisão de licença do operador — governança simulada, que R4 proíbe. As Fases 0–2 correm sem a assinatura; só a Fase 3 depende dela | o operador move para `approved` quando decidir B1 | **é** a ratificação |
| F0-5 | **`humanCoreStrata` mantém os cinco estratos**; `qa-informal` entra em `uncoveredCoreStrata` | A1 diz "descoberto e **declarado**". Apagar o estrato encolheria todo denominador e a lacuna ficaria invisível no arquivo que diz o que a avaliação cobre. Com ele declarado, o piso de poder **passará a reprovar** a célula antes da selagem — a imposição é E3 da Fase 1; a Fase 0.2 congela o número, e é essa reprovação que o operador precisa ver quando ela existir | trivial (dois campos) | **selagem** |
| F0-6 | **Stack Overflow bloqueado POR NOME, não apagado** — `humanSources.blockedSnapshots` + `A1_BLOCKED_HUMAN_SOURCES` + recusa `access-terms-unresolved` | "documentar a limitação não conclui a tarefa" exige bloqueio estrutural. E apagar seria pior que incompleto: a árvore de trabalho tem registros `src_ptso`, e auditoria que não **conhece** a fonte fica quieta sobre eles em vez de reprovar | mover a entrada de volta e tirar a linha bloqueada | **selagem** |
| F0-7 | **`access-terms-unresolved` abaixo da rota, acima da licença** | a rota é a afirmação mais geral (B3 recusa `recruited-donor` para toda fonte); a licença e o regime da fonte estão **corretos**, então nomeá-los diria ao chamador que há algo a consertar ali | trocar a ordem de dois `if` | — |
| F0-8 | **`blindReserveCompleteAttempts` NÃO foi alterado** (segue 2), com `plannedCertifyingMeasurements: 1` ao lado | o corte da reserva foi corte de escopo de engenharia da v1.0, não ordem para recongelar um valor cuja janela fecha em G5. A divergência fica registrada nos dois arquivos em vez de resolvida em silêncio | decidir na v2 | **selagem** |
| F0-9 | **A cota `nenhum`/`nenhuma` foi corrigida só na tela nova** (`WEIGHT_DENIAL`), não na compartilhada | `HUMAN_LABEL_DENIAL` não carrega a palavra, então as duas telas antigas hoje leem "nenhuma evidência prova a autoria humana" como over-claim. É defeito real, em função de caminho selado que esta tarefa não foi encarregada de mexer; mudá-lo em silêncio alteraria o que duas outras telas aceitam num commit sobre licença | ver achado aberto nº 1 | — |

### Segunda rodada — o que a revisão adversarial achou, e o que foi consertado

Rodada de 4 lentes + 34 verificadores céticos em 2026-07-31, mais cross-review do codex.
**21 achados confirmados**, 13 refutados. Os confirmados foram consertados no mesmo commit:

| achado | conserto |
|---|---|
| `WEIGHT_SUBJECT` não reconhecia `detector` nem `classificador` — o nome primário do artefato no projeto, vocabulário vivo em 4 dos 5 arquivos que a tela guarda | ambos adicionados |
| `WEIGHT_INHERITANCE_CLAIM` não tinha `alcançam` — **o verbo em que o NOTICE e a licença dos pesos declaram a posição**. Apagar um `não` daqueles arquivos afirmaria o proibido em silêncio | `alcança(m)`, `recai(em)`, `aplica(m)-se`, `vale(m) para` |
| `SOURCE_REFERENT` omitia identificadores que este próprio módulo registra (`odc-by-1.0`, `lei9610-art8`) e as palavras genéricas | acrescentados, mais `bases`/`snapshots` |
| `LICENSES.md` e `docs/LICENSE-DOCS.md` — os dois arquivos criados pelo mesmo commit da tela — **não estavam na lista varrida** | adicionados |
| a frase proibida seguia em pé em `2026-07-26-detector-v3-rebuild-implementation.md` | reescrita |
| `isAuthorizedHumanSource` não sabia do bloqueio A1: `auditCorpusSources` devolvia `ready` para manifesto que declarasse `src_ptso` — a fonte saía do inventário e a auditoria **ficava quieta**, exatamente o que manter o registro devia evitar | novo código `SOURCE_BLOCKED_BY_ACCESS_TERMS` (o décimo), e `A1_BLOCKED_HUMAN_SOURCES` ganhou consumidor de produção |
| `RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` ainda exigia `qa-informal` — **o selo de release ficou insatisfazível**, não estrito | estrato removido da lista, com a razão escrita e o acordo com `uncoveredCoreStrata` preso por teste |
| `adoptedFloorPerCell` e `powerFloors.samplingUnits` são a mesma decisão e o validador não as juntava | juntadas no parser (havia teste, não havia gate de load) |
| `WEIGHT_USE_POLICY.policyId` reusava `noncommercial-v1` — os dois policies que o módulo insiste em separar publicavam o mesmo identificador | passou a `weights-noncommercial-v1` |
| `quotaAxis` se descrevia como quatro FONTES quando duas células são estratos de registro da Carolina, e o pooling declarado não acontecia como descrito | docstring corrigida: "a partição mais grossa cujas células são comparáveis" |
| `DERIVED_TOLERANCE = 5e-7` era exatamente o erro máximo de arredondamento a 6 casas — hoje passa com 1,17e-7 de folga, e um valor futuro reprovaria pela apresentação | 1e-6, com a razão escrita |
| `docs/corpus-sources.md` ainda dizia "só quatro" fontes humanas e ainda mandava o operador baixar o dump, com o argumento que a própria seção A1 recusa | as duas corrigidas |
| runbook ainda exigia `qa-informal` do SE-PT e o template colável começava por `src_ptso` | corrigidos |
| `extract_stackexchange.py` afirmava em comentário que seu token está na lista congelada de onde acabou de sair | comentário reescrito, e a decisão de manter o extrator executável ficou explicada |
| a fixture v3 compartilhada ficou `ptwiki` com `humanSourceType: "qa-informal"` — o estrato sem fonte — e o header ainda creditava o extrator do SE | estrato e header corrigidos |

**Refutado com bom argumento, e por isso NÃO mexido:** a alegação de que a Fase 0.2 não entregou
"célula abaixo do piso falha antes da selagem" porque nada lê `powerFloors.samplingUnits`. A Fase
0.2 é fase de **congelamento** por desenho, o próprio código já diz isso em
`partitionFractions` ("Phase 0 freezes the decision, Phase 1 migrates the splitter") e no docstring
de `preRegistration`, e a imposição é E3 da Fase 1. O que foi ajustado é só o tempo verbal nos
documentos, para que "reprova antes da selagem" leia como o que é: prospectivo.

### Terceira rodada — cross-review do codex (`gpt-5.6-sol`, xhigh, read-only)

**Veredito: (b) aprovar com modificações. Nenhum P0.** Dois P1 e um P2, todos consertados no
mesmo commit. A rodada interna de 4 lentes e 34 céticos, do mesmo dia, **não** havia achado
nenhum dos três — vale registrar isso, porque é o argumento a favor de manter o cross-review
externo em caminho selado mesmo depois de uma rodada adversarial grande.

| # | achado | conserto |
|---|---|---|
| P1 | **A separação de política era real no código e invisível no contrato publicado.** `WEIGHT_USE_POLICY.policyId` recebeu id próprio (`weights-noncommercial-v1`), mas `license-review.json` não tinha `policyId` em `weightPolicy` **nenhum**, e o `NOTICE.md` imprimia `noncommercial-v1` — o id do CORPUS — logo abaixo do cabeçalho dos pesos. Quem lê o artefato publicado não conseguia dizer de qual política o `commercialUse: false` vinha | `weightPolicy.policyId` publicado, NOTICE corrigido com a distinção explicada, e teste novo prendendo review + NOTICE ao módulo ("publishes the weights policy under its OWN id, never the corpus's") |
| P1 | **O pré-registro contradizia o próprio nível de confiança.** `primaryAnalysis` dizia `one-sided-95-marginal-per-version` enquanto `perHypothesisAlpha` é 0,0125 — isto é, 98,75 % marginal. Quem lesse "marginal 95 %" ao pé da letra subestimaria **todo** teto publicado. As duas famílias são diferentes e só uma estava nomeada | `primaryAnalysis` virou `one-sided-95-familywise-within-version`, e o Regime 2 entrou como dado próprio: `crossVersionAdjustment: "none"`. Dentro da versão, Bonferroni sobre m=4 → 95 % familiar e 98,75 % por hipótese. Entre versões, nenhum ajuste — e o que compra isso é publicar toda execução, não silenciá-las |
| P2 | Dois casos concretos da tela, ambos reais: **`recebem` não estava na lista de verbos** (frase proibida passava), e **"a licença própria vincula os pesos, enquanto as licenças das fontes vinculam o corpus" era recusada** — a maneira mais clara de enunciar a posição (a) | `recebe(m)` e mais quatro verbos adicionados; `CONTRAST_BOUNDARY` divide em `enquanto`/`ao passo que`/`já o`, e os dois casos entraram como regressão. `, e não X,` ficou **fora** do divisor de propósito: é aposto dentro de uma cláusula, e dividir ali deixava passar "os pesos, e não o corpus, herdam as obrigações" |
| — | `partitionFractions` era só verificado por domínio e soma, então qualquer permutação que somasse 1 passava — `test: 0.05` teria carregado limpo | as cinco fixadas com `frozenNumber`, mantendo a checagem de soma |

**Um defeito meu que o conserto do P2 revelou:** a primeira versão de `CONTRAST_BOUNDARY` foi
escrita com caracteres **backspace** (`0x08`) no lugar de `\b`, por escape perdido no pipeline de
edição. Um regex com backspace simplesmente nunca casa, a suíte ficou verde, e o único sinal foi
inspecionar os bytes. Registro porque a falha é invisível por construção: teste verde sobre padrão
que não casa nada.

**Não afirmado pelo codex:** ele não conseguiu rodar a vitest (sandbox read-only bloqueou
`node_modules/.vite-temp`), então o veredito dele **não** inclui "a suíte passa". Essa parte é
medição minha: 162 arquivos / 2307 testes verdes.

## Decisões da Fase 1, tomadas pelo AGENTE

### Unidade 1 — `drop_seen()` (2026-07-31)

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| F1-1a | **O teto `MAX_BUCKET` sai de `drop_seen`** (segue no `prune`) | no `prune` o teto limita um passo genuinamente quadrático — ele forma todo PAR dentro do bucket, então bucket de n custa n²/2. No `drop_seen` o bucket só contribui membros para um `set` de candidatos, e o laço de Jaccard é linear nesse conjunto com `break` no primeiro que passa. O teto **comprava** custo — para um candidato mantido, um `set.update` e uma interseção Jaccard por membro do bucket, porque o `break` do laço só ajuda os registros que acabam descartados — e custava recall **em silêncio**: um documento cuja única ponte para o treino fosse um shingle presente em mais de 40 textos de treino nunca era comparado, e nenhuma estatística dizia isso. Como o índice é sobre train+dev (grande), shingles frequentes em pt-BR batem nesse teto muito mais do que qualquer coisa no `prune` | restaurar uma linha | **selagem do corpus** |
| F1-1b | **`buckets_over_prune_cap` e `candidates_evaluated` passam a ser reportados** | a mudança acima aumenta o custo e pode aumentar os descartes; sem essas duas contagens ninguém consegue dizer se um número de descartes mudou por causa do corpus ou por causa do conserto | trivial | — |
| F1-1c | **`contract` viaja dentro das próprias stats** | a linha de log é lida por humano no aceite da montagem, e um dicionário com `dropped` e `highest_similarity_kept` sem o contrato ao lado é exatamente onde "independência" reaparece | trivial | — |
| F1-1d | **`worst` renomeada para `highest_kept`** | o nome sugeria pior caso; o valor é a maior similaridade entre os registros **mantidos**, e os descartados são excluídos de propósito — incluí-los faria um pool limpo reportar número acima da barra | trivial | — |
| F1-1e | **Quarta tela: `trainingIndependenceOverclaimIn`** | o item 1 da Fase 1 diz "**nunca** como independência corpus↔treino". Os documentos já estavam certos quando a tela foi escrita — o runbook diz "não é independência semântica" com essas palavras. É justamente por isso: "nunca" pede imposição, e prosa correta hoje está a uma edição de virar alegação | remover a tela e a varredura | — |
| F1-1f | **Predicado da tela restrito a `independente`/`independência`/`disjunto`** — sem `limpo`, sem `não visto` | `limpo` aparece numa frase que o runbook precisa manter ("um corpus limpo contra um treino não é limpo contra outro") e `não visto` enuncia a propriedade **através** de negação, então a janela de negação leria a alegação como sua própria denegação. Tela que recusa a primeira e é cega para a segunda seria pior que a estreita | ampliar com teste | — |
| F1-1g | **`nada` saiu das DUAS telas; `INDEPENDENCE_DENIAL` é alias de `WIDENED_DENIAL`** (terceira e última posição sobre a palavra) | tentei consolidar numa só e o cross-review pegou a regressão: "Nada muda o fato de que os pesos herdam as obrigações das fontes" disparava antes e passou depois. Ali `nada` é sujeito de *muda* e **reforça** a alegação sobre *herdam*; em "nada aqui mede independência" é sujeito do próprio verbo cujo resultado se nega. Mesma palavra, força oposta. A terceira rodada produziu a MESMA forma para a tela de independência ("Nada muda o fato de que o corpus é independente do treino"), o que fechou a questão: `nada` é sujeito do verbo que o segue, então não serve de marcador em nenhuma tela lexical, e saiu das duas. O projeto escreve a denegação com `não`. **O achado aberto 1 NÃO foi resolvido por isso** e segue aberto: ele é sobre as duas telas antigas recusarem denegações corretas que usam `nenhum`/`nenhuma`, o que é defeito diferente. O que a rodada 4 consertou nelas foi outra coisa — as fronteiras Unicode | trivial | — |
| F1-1h | **`benchmark/lab/test_near_dupes.py` criado** — não existia teste nenhum para a poda | `drop_seen` é a única coisa do pipeline que consegue ver sobreposição corpus↔treino, e tinha zero teste. O módulo tinha teste para os extratores e nenhum para a poda que eles alimentam | — | — |

**Nota de fixture, porque custou duas tentativas e a lição é reusável:** o teste do teto só é
determinístico porque os textos vistos são **curtos** (< `SAMPLE_MIN_SHINGLES`), e aí o índice
guarda **todos** os shingles em vez de amostrar 1/16. Com textos longos os tamanhos de bucket
dependem de valores de `crc32` e o teste passa ou falha por acidente. A primeira versão da fixture
usava textos longos e reportava `buckets_over_prune_cap == 0` — a fixture não exercitava o caminho
que dizia exercitar.

### Unidade 2 — linhagem fail-closed (2026-07-31)

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| F1-4a | **`assertDerivedParentsResolve(records)` é chamada em `runSplit`, antes de `createBlockedSplit`** | a função existia sem chamador de produção: só `benchmark/tests/schema-v3.test.ts` a alcançava, e `benchmark/split.ts` a nomeava num comentário como o lugar onde um pai não resolvido "pertence" — verdadeiro e não ligado | remover uma linha | **selagem** |
| F1-4b | **A colocalização sai dessa chamada, não de um segundo mecanismo** | `buildClusters` une um registro ao pai só `if (ids.has(parent))`, porque pai ausente não deve inventar cluster nem recusar linha em silêncio. Com a recusa na frente, um corpus cujos pais não resolvem **nunca chega** ao splitter, então todo pai que o clusterizador procura está presente e pai + gerações + derivados caem sempre num cluster — logo, numa partição | — | **selagem** |
| F1-4c | **`humanSeed` NÃO se torna eixo de valor** | o docstring de `AxisUnionRelation` deixava isso como "questão substantiva para E2/E3". Neste caminho ela se resolve pela chamada e não por um argumento sobre dependência: duas gerações do mesmo pai resolvem para um pai presente, então ambas são unidas a ele e portanto entre si. A questão sobrevive só para chamadores que particionam sem passar por `runSplit` | virar eixo de valor é uma linha | **selagem** |
| F1-4d | **O guarda `ids.has(parent)` permanece** | `createBlockedSplit` também é chamada direto (testes e qualquer chamador futuro que não passou pelo gate de corpus inteiro), e um clusterizador que lançasse sobre pai ausente estaria respondendo uma pergunta de seleção sem ver a entrada inteira | — | — |

**A cobertura que esta unidade NÃO tem, dita em vez de implícita:**
`assertDerivedParentsResolve` retorna imediatamente para todo registro cujo `schemaVersion`
não é 3, e o cenário ponta a ponta de `benchmark/tests/corpus-import.test.ts` monta corpus
**v2** de 10 000 registros. Ou seja: nenhum teste do repositório roda a chamada nova sobre um
corpus que ela realmente inspeciona. Os testes verdes desta unidade cobrem a ORDEM da chamada e a
separação de responsabilidades; não cobrem o corpo da função no caminho do comando. Ver achado
aberto 8.

### Unidade 3 — E2, as cinco partições (2026-07-31)

**A promessa, enunciada de forma falseável** (é o contrato que a etapa 1 fixou, e o texto público
não pode dizer mais que isto): dado o corpus D entregue ao comando, ou sai uma atribuição total
id→partição em {`train`, `dev`, `cal-A`, `cal-B`, `test`} tal que (i) nenhum componente conectado
de D cruza fronteira de partição, (ii) toda família geradora declarada held-out tem todos os seus
registros em `test`, (iii) `earliest(test) > latest(cada uma das outras quatro)`, (iv) `dev`,
`cal-A` e `cal-B` estritamente ordenados entre si por `earliest` contra `latest`, e (v) para todo
rótulo de classe e toda partição `|fração − alvo| ≤ classTolerance` sobre 45/5/10/20/20 — **ou o
comando lança sem escrever nenhuma SAÍDA**. Universal e determinística sobre o corpus de entrada.

**O alcance exato de "nada é escrito", porque a versão universal era falsa — duas vezes.** Primeira:
o comando ABRE as entradas (manifesto, registros, auditoria selada) antes de calcular qualquer coisa,
então "antes de abrir qualquer arquivo" era falso; o correto é "sem escrever nenhuma saída". O que NÃO é verdade é a frase estendida a qualquer falha: os sete arquivos são publicados
por `writeFileSetAtomic`, que escreve e fsynca todos os temporários antes de renomear, e renomeia
`split-artifact.json` **por último**. Uma falha durante a publicação pode portanto deixar arquivos de
partição sem o artefato que os certifica; **não** pode deixar o artefato sem eles. A sequência de
renomeações não é uma operação só, e essa é a garantia residual — dita, não escondida.

**O que a promessa NÃO diz, e não pode passar a dizer:** `train` **não integra a CADEIA das três
partições médias**. É o fallback e recebe todo componente que atravessa um corte, então um registro de
`train` pode ser mais novo que um de `cal-B` por desenho — e por isso `train` está fora da cadeia. A
separação estrita contra `test` continua valendo para ele, e é justamente por ser o fallback.
O que a auditoria prende são duas coisas: as três partições do MEIO (`dev`, `cal-A`, `cal-B`)
estritamente ordenadas `earliest` contra `latest`, porque cada uma só contém componentes inteiramente
dentro da sua banda; e `earliest(test) > latest(cada uma das outras quatro)`, `train` incluída, porque
`train` alcançar o início de `test` é vazamento real e a auditoria é o único lugar que pode recusá-lo.
"Cinco blocos estritamente ordenados" seria promessa universal falsa.

*(Esta redação substitui a primeira, que descrevia a cadeia `latest(train) < latest(dev) < …` —
exatamente a cadeia que o conserto P2-4 apagou por recusar splits legítimos. A rodada 2 do
cross-review pegou o documento contradizendo o próprio conserto registrado nele.)*

| # | decisão | razão | reversão | ratificar antes de |
|---|---|---|---|---|
| F1-5a | **Grafia canônica dos VALORES de partição: `train / dev / cal-A / cal-B / test`** (V3, a do ledger) | é a única das três grafias já validada contra **dados persistidos** — `LEDGER_PARTITIONS` valida eventos de exposição em três pontos (`cluster-exposure-ledger.ts:490`, `:1040`, `:1842`). Vocabulário que guarda dado persistido não se renomeia sem reescrever histórico; vocabulário só-de-código se renomeia. A convergência tem de mover o lado renomeável, e o ledger é o lado que não é. É também a grafia dos documentos (`plano-v1-minima.md:138`, `docs/corpus-sources.md:604`), então não há divergência doc↔código a criar. Custo aceito: propriedades com aspas (`"cal-A"`) em `DatasetSplit` e `Record<Partition, …>` — legal em TS, e o acesso já era `split[partition]` | renomear é mecânico, mas move o `evaluatorDigest` | **selagem do corpus** |
| F1-5b | **As chaves `calA`/`calB` do pré-registro FICAM como estão** | são nome de CAMPO de um objeto de frações (identificador JS), camada lexical diferente de valor de partição. `rebuild-v3-policy.json` não é tocado, o que preserva o congelamento recém-feito e o `.prettierignore`. A correspondência campo↔valor é declarada **uma vez só**, onde a auditoria deriva os alvos (F1-5f) | — | — |
| F1-5c | **`classTolerance` fica `0.02` ABSOLUTO para as cinco** | não foi pré-registrada para cinco (não existe em `rebuild-v3-policy.json`; vive como literal em código). Tolerância relativa ou por partição seria invenção metodológica sem precedente — categoria (iii), que o projeto não tem e não deve ter. Manter o absoluto é a escolha já em vigor e é **mais severa no agregado**: 15 restrições (3 classes × 5 partições) contra 9, com 4 graus de liberdade contra 2 | trocar o literal | **selagem** |
| F1-5c′ | **Consequência declarada, não escondida: a banda admissível de `dev` é [0,03; 0,07]** | o alvo de `dev` é 0,05, logo ±0,02 absoluto é ±40% relativo. Um split em que `dev` fique com 3% ou 7% dos registros de uma classe é LEGAL sob esta tolerância. Isso é consequência de F1-5c e está escrito aqui para que ninguém a descubra depois lendo o número | — | **selagem** |
| F1-5d | **Ordem temporal `train → dev → cal-A → cal-B → test`, com `train` como fallback** | `train` é o maior alvo (0,45) e o mais tolerante a receber componentes-ponte; `dev`, a 0,05, é o que menos suporta drenagem. O termo de overflow do objetivo migra de `development` para `train` junto com o fallback — um implementador que esqueça o termo deixa o excesso drenar para `train` sem penalidade até estourar a tolerância | — | **selagem** |
| F1-5e | **Identidade do algoritmo: `blocked-group-time-v2`; `schemaVersion` do artefato 1 → 2** | os dois são literal type, então a troca transforma cada consumidor em erro de compilação em vez de deixar um leitor de v1 interpretar mal `cutoffs` de quatro cortes e `counts` de cinco chaves | — | **selagem** |
| F1-5f | **`TARGETS` da auditoria passa a ser DERIVADO de `REBUILD_V3_POLICY.preRegistration.partitionFractions`** | hoje a auditoria restata os alvos num objeto próprio. O pré-registro é pinado valor por valor (`frozenNumber`, `rebuild-v3-policy.ts:978-982`), tem teste (`rebuild-v3-policy.test.ts:238`) e está no `.prettierignore` — é imune a drift silencioso, e o objeto do splitter não é. Derivar do pré-registro é o elo que faltava entre o restatement tipado e a decisão congelada. **Nunca** derivar do objeto do splitter: a independência entre splitter e auditoria é o que pega omissão de partição num só dos dois | — | **selagem** |
| F1-5g | **Layout de saída: `train.jsonl`, `dev.jsonl`, `cal-A.jsonl` públicos; `private/cal-B.jsonl` e `private/test-labels.jsonl` privados; `test-input.jsonl` cego e público** | `cal-B` e `test` ficam byte-intocados até a v2 (`plano-v1-minima.md:44`), e pôr `cal-B` sob `private/` o coloca automaticamente dentro da proibição de leitura que já vale para `private/` — a invariante passa a ser imposta pelo caminho do arquivo e não por memória de quem edita | — | **selagem** |
| F1-5h | **A busca de cortes vira grade de quantis LIMITADA por corte + poda admissível, e não produto cartesiano** | com quatro cortes o enumerador atual (O(k²), janela ±10 pp, todos os tempos distintos) vira O(k⁴) e não termina. A grade tem tamanho **fixo** por corte, então o número de folhas é limitado por construção e nenhuma recusa depende do tamanho do corpus. Duas podas são admissíveis e não heurísticas: `train` só RECEBE componentes-ponte, logo `realizado(train) ≥ banda(train)` e banda acima de `alvo + tolerância` é infactível; as partições do meio só PERDEM massa para `train`, logo `realizado ≤ banda` e banda abaixo de `alvo − tolerância` é infactível | — | **selagem** |
| F1-5h′ | **A busca é heurística e o contrato é verificado por inteiro DEPOIS** | é a diferença estrutural em relação ao defeito da unidade 1: lá o mecanismo era probabilístico e a promessa era publicada como absoluta. Aqui a insatisfação vira `SplitConstraintError`, não afirmação. O preço, dito: uma busca mais estreita recusa mais corpora **factíveis** — fail-closed na direção certa, cronograma em risco. E o comportamento no corpus real de 10 mil registros é **não medido**, porque esse corpus não existe (depende de D1+D3) | — | **selagem** |
| F1-5i | **Os filtros negativos viram allowlist positiva, e a população de `fit` é `dev ∪ cal-A`** | `test` é o único nome que sobrevive à migração, então `partition !== "test"` **compila com significado alterado** e passaria a entregar `cal-B` ao `fit`. Positivo e explícito: `train` fica fora porque ajustar limiar sobre dado de treino é exatamente o vazamento que o split existe para impedir, e `cal-B` fica fora porque é privado até a v2 | — | **selagem** |
| F1-5j | **O lane de predição ganha um tipo ESTREITADO `ScoringPartition = "dev" \| "cal-A" \| "test"`, subconjunto de `Partition`** | a alternativa era manter três nomes antigos no lane e traduzir na fronteira — mais código e mais risco que renomear dois valores. O estreitamento entrega uma propriedade que hoje não existe: `cal-B` e `train` ficam **irrepresentáveis** num manifesto de predição, então nenhum caminho de scoring consegue nomeá-los nem por engano. `prediction-schema.ts` valida esse subconjunto, não os cinco | — | **selagem** |
| F1-5k | **`groupTimeSplit` e companhia são APAGADOS** | o cabeçalho `split.ts:2-5` justificava mantê-los com "cli.ts imports it. Kept intentionally, not dead". **Medido: falso.** `grep` de `groupTimeSplit\|SplitFractions\|DEFAULT_FRACTIONS\|GroupTimeSplit` só encontra o próprio `split.ts` e dois planos antigos. É código morto com justificativa falsa dentro de um arquivo do `evaluatorDigest` | `git revert` | — |
| F1-5l | **O montador Python migra na MESMA unidade** | `assemble_corpus.py` não pré-atribui partição: ele estampa **tempos de bloco** (`BLOCK_TIME`, três valores) para que os cortes temporais do splitter caiam onde ele planejou, e dimensiona os blocos por `CLASS_FRACTIONS` (20/30/50). Deixar o montador em três blocos e o splitter em cinco produz um corpus que o splitter **recusa** — as duas metades são um contrato só, não dois módulos | — | **selagem** |
| F1-5m | **Fora do E2, explicitamente:** os nomes de CAMPO de `report.ts` (`predictionManifests.development/calibration`) | em `report.ts` a palavra `calibration` nomeia **duas** coisas — a partição e a calibração de probabilidade (`metrics.calibration`, `calibrationArtifactDigest`). Desambiguar isso é unidade própria, e renomear campo por campo aqui misturaria a migração de vocabulário com uma correção de colisão de nome | — | — |

**F1-5n — DECIDIDO PELO AGENTE em 2026-07-31, EMENDADO em 2026-08-01 após consulta ao codex.**
Resolve o achado 11, que estava aberto por erro de processo.

**A primeira versão estava errada e está registrada como errada.** Eu tirei o piso
`minimumTestHumanNegatives` do caminho de reprovação e apontei o gate de composição do E3 como
substituto. O cross-review mostrou que **o substituto não existe no código**: o pré-registro manda
`zeroEventCeiling.unitsBelowFloorFailBeforeSealing: true`, mas `powerFloors.samplingUnits` só é
parseado e `commands/split.ts` selava lendo apenas `splitAudit.passed`. Removi o único piso que
reprovava e apontei para um gate imaginário — afrouxamento real, não realocação.

**A versão em vigor, em três partes:**

| # | decisão | razão |
|---|---|---|
| a | `minimumTestHumanNegatives` **continua fora do caminho de reprovação** e segue publicado como medição (`audit.testHumanNegatives`) | ele conta LINHAS agregadas no bloco cego, que é a unidade errada duas vezes: reprova um corpus que tem os componentes, e aprovaria 2.000 linhas colapsadas em poucos componentes ou concentradas numa célula de cota. Ressuscitá-lo como gate científico seria reprovar pelo motivo errado hoje para aprovar pelo motivo errado depois |
| b | **NOVO GATE, que existe em código:** corpus `scientificUse: "release"` **não pode ser congelado** sem o atestado de composição do E3 (`COMPOSITION_FLOOR_NOT_APPLIED` em `benchmark/commands/split.ts`, renomeado por F1-5o) | é o gate que o pré-registro já mandava e que ninguém havia implementado, agora na unidade certa (componentes independentes por célula de cota, em cada partição). Hoje é deliberadamente insatisfazível: **release fica indisponível, o repositório não** |
| c | `runValidate` aceita `corpusPolicy` explícita **somente** para `infrastructure-only`, sem flag de CLI e nunca derivada dos dados | `sealDataset` já recebia a política; era `runValidate` que fixava a de release. Isso recupera a prova ponta a ponta honestamente, com `releaseEligible: false`. A estreiteza é a segurança: para corpus de release a sobrescrita é RECUSADA (`CORPUS_POLICY_OVERRIDE_FORBIDDEN`) |

**Custo de reversão:** (a) restaurar um `reasons.push`; (b) remover um `if`; (c) remover um campo
opcional. **Ratificar antes de:** selagem do corpus.

**A aritmética, conferida na consulta e pior do que eu havia registrado.** O piso de 250 por célula
vale **por partição** (`2026-07-26-detector-v3-rebuild-implementation.md:7710-7713`), não só no bloco
cego. Então `dev` precisa de `4 × 250 = 1.000` componentes; na fração nominal de 5% isso é **20 mil
linhas humanas** no melhor caso (componentes singleton, distribuição perfeita), e componentes com
mais de uma linha só aumentam o mínimo. Mantida a razão 4:4:2, o corpus seria de **~50 mil
registros** — pelo menos **+16 mil linhas humanas** sobre as 4 mil atuais, com o custo
correspondente de coleta, revisão e geração. Os números "≥10 mil" e "≥11 mil" que eu havia
registrado estavam **ambos errados** e foram corrigidos aqui; derivar `4×250=1.000` como piso de
linhas serve de pré-condição barata, mas **não** substitui o gate, porque linhas não provam 250
componentes em cada uma das quatro células.

**A decisão de dimensionar o corpus NÃO foi tomada aqui, e o motivo é a lista:** composição de
corpus gasta calendário e cota de geração do operador. O que está decidido é que o release fica
**bloqueado** até que alguém a tome — o que é a direção fail-closed e deixa a escolha visível em vez
de implícita.

**Terceiro deslize do relatório de desenho, achado ao conferir o disco:** ele afirma "hoje ZERO
regex `\b` em `benchmark/*.ts` (grep vazio)". **Falso** — há `\b` em
`benchmark/evidence-sanitizer.ts:103` e mais de dez em `benchmark/source-manifest.ts` (1367–1590),
e esse arquivo já documenta a armadilha em `:1378-1383` ("Unicode word edges, NOT `\b`. `\b` in
JavaScript is ASCII-only"). A conclusão acionável do relatório sobrevive (E2 não processa texto, e o
risco residual é `/^\w+$/` recusar `cal-A` — hífen não é `\w`), mas o fato citado para sustentá-la
não. Vale para a contabilidade da etapa 1: três das suas afirmações de disco estavam erradas, todas
verificáveis por `grep`. A etapa 1 é ferramenta, não oráculo.

**Consequência de F1-5a que o compilador NÃO pega, e que fica proibida por escrito:** nenhuma
validação de nome de partição por `\w`, `\b` ou `/^[a-z]+$/`. `cal-A` tem hífen e maiúscula, e
qualquer uma dessas telas o recusaria. Hoje `requirePartition` compara valores explicitamente, que é
a forma correta e tem de continuar sendo.

### As três rodadas de rejeição da unidade 1, e o que cada uma achou

O cross-review do codex **rejeitou** esta unidade três vezes antes de ela ficar de pé. Nenhuma
rodada repetiu achado da anterior, e cada uma encontrou uma classe diferente de erro — o que vale
registrar porque o padrão é mais instrutivo que os consertos.

**Rodada 1 — o conserto não era o conserto.** Seis P1. O pior: `drop_seen()` **nunca** havia usado
`content_hash`. Ele propunha candidatos só pelos shingles amostrados 1/16, então um documento cujos
shingles todos escapassem da amostra propunha zero candidatos e era mantido — inclusive sendo cópia
byte a byte de um texto de treino. Medido pelo codex: 40 dos 36.971 textos vistos caem nesse
buraco. Eu tinha tratado o teto de bucket como o defeito, consertado isso, e escrito no docstring
que o contrato cobre "exact tokenized content" — alegação falsa, com um teste que a "provava" usando
um texto curto que por sorte tinha shingles amostrados.

**Rodada 2 — o relatório era falso.** Cinco achados. O mais sério não foi bug de código: eu havia
reportado "11/11 casos corretos" para a quarta tela, medindo **antes** de estreitar o
`CONJUNCTION_BOUNDARY`, e não re-medi depois de mudar o padrão. O caso central voltou a passar em
silêncio porque `\b` em JavaScript é ASCII e não casa depois de `é`. Afirmar resultado de medição
feita em outro estado do código é exatamente a falha que este projeto existe para não cometer.

**Rodada 3 — erro de categoria.** O contrato publicado é **absoluto** ("para todo id não devolvido,
nenhum texto visto alcança Jaccard ≥ 0,82") e o mecanismo era **probabilístico**. Nenhum valor de
piso bottom-k fecha isso. Minha derivação de `0,18^k` estava correta como risco *por par* e foi
apresentada como se fechasse a promessa; ela também assumia independência entre o hash e a edição,
que nada estabelece. Contraexemplo do codex: 1.000 shingles, 12 edições, Jaccard 0,886792, zero
candidatos, registro mantido.

O conserto foi trocar a garantia probabilística por uma **determinística**, que não usa hipótese
nenhuma sobre o hash: se `J(A,B) ≥ 0,82` então `|A ∩ B| ≥ 0,82·|A ∪ B| ≥ 0,82·|A|`, logo os shingles
de `A` ausentes de `B` são no máximo `0,18·|A|`; um subconjunto com **mais** de 18% não cabe nessa
lacuna, então a interseção é forçada e o candidato é sempre proposto.
`MINWISE_FRACTION = 1 − JACCARD_THRESHOLD`, e o índice recebe `floor(0,18·|A|)+1` shingles por texto
visto. Custa cerca de **3,7×** o índice — a união das duas fontes (18% mais a amostra de 1/16 sobre o resto, ou 23,125% dos shingles), não 18% isolados, e é o preço de a frase ser verdadeira em vez de provavelmente
verdadeira.

**A palavra `nada` custou três posições, e a lição ficou escrita no código.** Entrou como negação;
saiu da tela de pesos quando o codex mostrou que "Nada muda o fato de que os pesos herdam as
obrigações" **reforça** em vez de negar; saiu da tela de independência quando ele produziu a mesma
forma para ela. `nada` é sujeito do verbo que o segue, então nega numa frase e reforça na seguinte —
marcador que só se distingue com análise sintática não serve a nenhuma tela lexical. O projeto
escreve "Independência semântica não é medida aqui".

**Três erros meus de processo, registrados porque se repetiram:**

1. **Escape perdido em heredoc.** Duas vezes um `\b` virou caractere **backspace** (`0x08`) no
   arquivo. Um regex com backspace nunca casa, a suíte fica verde e o único sinal é inspecionar os
   bytes. A segunda vez foi dentro do parágrafo que documenta a primeira. Passei a editar por
   arquivo `.py` com raw strings e a checar `0x08` em todo arquivo rastreado.
2. **`cd` do shell resetando.** Duas vezes o diretório voltou para o repositório principal, e numa
   delas editei três arquivos lá em vez do worktree. `git status` nos dois é a única checagem
   confiável.
3. **Afirmar sem re-medir** — a rodada 2 acima.

### Rodadas 4 a 6 do cross-review, e o que restou

**Rodada 4 — `\b` é ASCII em JavaScript.** A palavra `sem` casava dentro de `semântica`,
porque `â` não é caractere de palavra para `\b`. Os **dois** padrões de negação usavam `\b`,
então o defeito atingia as **quatro** telas — inclusive `humanLabelOverclaimIn` e
`reviewOverclaimIn`, que são caminho selado e existem desde antes desta fase. A tela ficava
cega exatamente na palavra central do domínio. Todas as fronteiras passaram a ser Unicode
explícitas (`(?<![\p{L}\p{N}])`). O mesmo `\b` já havia quebrado um lookahead depois de `é`
na rodada 3: duas falhas de uma causa só.

**Rodada 5 — teste verde sob mutação.** O codex mutou o código (removeu o `+1`, trocou a
fração por `12`) e os 16 testes continuaram verdes. A causa não era fixture faltando:
**nenhum teste construído a partir de texto** distingue aquelas mutações, porque um teste não
escolhe quais shingles uma edição destrói. A seleção foi extraída para `indexed_keys()` e a
propriedade passou a ser testada como operação de conjunto — o subconjunto indexado tem de
sobreviver ao **pior buraco possível**, que é justamente o que um bottom-k escolheria.
Verificado rodando as duas mutações: ambas falham, o código restaurado passa.

**Rodada 6 — coerência textual.** Nenhum achado funcional novo ("a garantia funcional agora
está presa"). Sobraram três lugares dizendo `3×` onde a conta da união dá `3,7×`, e
comentários descrevendo a decisão sobre `nada` que já havia sido revertida duas rodadas
antes.

**A frase que o número corrige, porque errei duas vezes nela:** o custo do índice é a
**união** das duas fontes, não uma delas. `18% + 6,25%·(1 − 18%) ≈ 23,125%` dos shingles,
cerca de **3,7×** o índice antigo.

### Rodada 1 do cross-review do E2 — REJEITADA, e o que ela achou (2026-07-31)

Veredito **(c) rejeitar**, sete achados: três P1, dois P2, dois P3. Nenhum era falso. Vale registrar
porque a hipótese do processo novo é medível — a etapa de desenho deveria fazer o número de rodadas
cair — e esta rodada mostra ONDE ela ajudou e onde não.

**A etapa 1 (Fable) acertou o que prometeu.** Os três achados que ela nomeou (transposição
`cal-B`/`test`, filtros negativos, vocabulários múltiplos) chegaram implementados e a rodada 1
confirmou-os corretos, além de confirmar as duas podas admissíveis e a segurança das guardas de
vacuidade. **Nenhum dos sete achados novos é erro de categoria** — são todos erro de execução ou de
alcance, exatamente a classe que só existe depois de escrever, que é o que a etapa 3 existe para
pegar. A hipótese não foi refutada; foi confirmada de forma estreita.

| # | achado | conserto |
|---|---|---|
| P1-1 | A aritmética do achado 11 citava `4000 × 0,20 = 800`, que é o ALVO e não o teto | corrigida para `(0,20 + 0,02) × 4000 = 880`, que é o número que fecha a prova, e o alcance restrito a corpora selados por `runValidate` |
| P1-2 | **`validateSplitArtifact` aceitava artefato v1.** Não validava em runtime `schemaVersion`, `algorithm`, valores de partição nem forma de `counts`/`policy.fractions`. Como todo comando chega ao artefato por `as SplitArtifact` sobre JSON, os literal types não restringiam nada em disco: um artefato v1 auto-consistente passava com todos os digests conferindo | `assertArtifactVocabulary` novo, e `algorithmDigest` passou a ser RECOMPUTADO (é o que prende a política ao algoritmo — um `policy` editado depois da selagem mantém `splitDigest` válido, porque o selo cobre a política editada). Cinco testes, cada um re-selando a mutação para o artefato seguir auto-consistente. **Medido: com a guarda desligada, os cinco devolvem `ACEITO`** |
| P1-3 | **"lança e nada é escrito" era falso como universal.** Seis arquivos gravados em sequência, artefato PRIMEIRO: falha no quarto deixava um diretório que já continha o artefato certificando os seis | `writeFileSetAtomic` novo — grava e fsynca todos os temporários, depois renomeia, com `split-artifact.json` **por último**. A garantia residual está dita em três lugares (código, registro, references): recusa de restrição não escreve nada; falha ao publicar pode deixar partições sem artefato, nunca artefato sem partições |
| P2-4 | **A cadeia temporal recusava splits legítimos.** Exigia `latest(dev) > latest(train)`, mas `train` é o fallback e absorve componentes que atravessam cortes — o cross-review reproduziu um split de `createBlockedSplit` com todas as frações na tolerância, sem vazamento, recusado só por isso | `chainHolds` apagada. No lugar: `middleIsOrdered` sobre `dev`/`cal-A`/`cal-B` por `earliest` contra `latest` — que é **mais forte e verdadeiro**, porque cada uma só contém componentes inteiramente dentro da sua banda. `train` sai da cadeia; `testIsStrictlyNewest` continua cobrindo os cinco, e cobrir `train` ali é o que pega vazamento real. Dois testes de regressão; **medido: a cadeia antiga reprova o primeiro** |
| P2-5 | A mensagem dizia "no temporal cut can realise", culpando o corpus por um limite da grade | virou "no candidate cut quadruple realises", e o teste diz por que a diferença importa |
| P3-6 | **Sobrou uma allowlist crua em `cli.ts`** (`fit`), aceitando `development`/`calibration`. `optionalFlag` devolve `string`, então comparar com nome antigo é TypeScript legal e a migração não a expôs. O teste ficava verde porque só checava que `test` era recusado — passaria também se TODOS os nomes novos fossem | allowlist passou a ler `FIT_PARTITIONS`; o teste passou a checar as duas direções (recusa `test`/`train`/`cal-B` **e** aceita `dev`/`cal-A`). Mensagens obsoletas em `prediction-schema.ts` e `browser-scorer.ts` também corrigidas |
| P3-7 | Comentários de processo: cabeçalhos `E2:` em testes, "ONLY so it can be tested", ponteiros para "open finding 11", e narrativa "antes era assim" em `fit.ts` | reescritos para enunciar a restrição sem narrar o processo. Zero referências a número de achado em código |

**A lição de evidência desta rodada:** dois dos sete achados eram testes que passavam pelo motivo
errado (P1-2 e P3-6), e nos dois casos a forma era a mesma — o teste checava só a direção negativa.
Um teste que verifica "X é recusado" e não verifica "Y é aceito" fica verde quando a implementação
recusa tudo. Passou a ser conserto padrão: toda allowlist ganha teste nas duas direções, e toda
guarda nova é medida com a guarda desligada.

### Rodada 2 do cross-review do E2 — REJEITADA também, e o padrão que ela expôs (2026-07-31)

Veredito **(c) rejeitar**, sete achados de novo: três P1, três P2, um P3. Confirmei quatro no disco
antes de consertar; nenhum era falso. O codex também confirmou que `middleIsOrdered` (conserto
P2-4 da rodada 1) está **correto** — ali o defeito era só documentação contraditória.

| # | achado | conserto |
|---|---|---|
| P1 | **`publish-evidence` contornava o validador inteiro.** Fazia cast para `SplitArtifact` e comparava só os digests DECLARADOS contra o relatório — que um arquivo adulterado satisfaz mantendo a string antiga. `algorithm`, `counts`, `cutoffs` e a `audit` inteira chegavam à evidência pública sem checagem | fatorada `assertSplitArtifactSelfConsistent` (vocabulário + os três digests + veredito + formas canônicas): **uma implementação, dois chamadores**. `publish-evidence` não tem os registros, então recebe a metade independente deles; `validateSplitArtifact` segue sendo a completa |
| P1 | **`assertArtifactVocabulary` fechava metade do vocabulário** — nada de `audit.sizes`, `audit.classFractions`, `audit.cutoffs`, partições de `audit.leakages`; e não confrontava `counts` com os assignments | tudo isso, mais `counts` × assignments × `audit.sizes`, mais `seed` × `policy.seed` (o seed é publicado duas vezes e só uma está sob digest) |
| P1 | **o meu teste do "policy editado" passava pelo motivo errado** — deixava `algorithmDigest` obsoleto de propósito, então quem recomputasse OS DOIS digests passava. O codex notou o que isso implica: digest só prova consistência do arquivo com ele mesmo | a política passou a ser comparada com as autoridades **fora** do arquivo: `fractions` contra `preRegistration.partitionFractions` e `classTolerance` contra a constante congelada. Cinco testes novos, todos recomputando os dois digests |
| P1 | **a garantia de publicação continuava falsa em REEXECUÇÃO** — pôr o certificador por último não neutraliza um `split-artifact.json` que já está no disco, então uma segunda execução que falhe no meio deixa o artefato antigo certificando mistura | `writeFileSetAtomic` remove o certificador ANTES de publicar o conjunto. O diretório fica sem certificador até o novo pousar, que é o estado recuperável |
| P2 | **o montador Python ainda calculava capacidade de `test` como `1 − 0,20 − 0,30`** — 50%, enquanto `assign_partitions` dava 20%. Eu havia migrado `CLASS_FRACTIONS` e `assign_partitions` e passado ao lado de uma terceira cópia | passou a derivar da MESMA `CLASS_FRACTIONS`, então as duas leituras não podem discordar |
| P2 | **o runbook executável não migrou** — `test=50%`, `2.000 humanos`, e comandos `--partition development`/`calibration` que a CLI agora **recusa**. Eu corrigi duas linhas e declarei o arquivo pronto | migrado inteiro, incluindo a explicação de que o número agora é publicado e o gate é do E3 |
| P2 | **o registro ressuscitava a cadeia que o P2-4 apagou** — a seção da promessa ainda descrevia `latest(train) < latest(dev) < …` no mesmo documento que registra a remoção dela | reescrita, com nota de que a rodada 2 pegou o documento contradizendo o próprio conserto |
| P2/P3 | **outras allowlists passavam pelo motivo errado**: em `fit.test.ts` eu havia deixado `train` e `cal-B` VAZIOS, então aquele teste ficaria verde se a produção voltasse ao filtro negativo — a mina exata desta unidade. Idem `candidate-preflight.test.ts`; e `generator-family.test.ts` olhava train/dev e omitia cal-A/cal-B | os fixtures passaram a CONTER `train` e `cal-B`. **Medido: com a produção revertida para `partition !== "test"`, quatro testes reprovam** — antes, zero |

**O padrão, que é meu e apareceu nas duas rodadas:** *fixture que não contém o caso que o teste
alega excluir.* Um teste que verifica "X é recusado" sem verificar "Y é aceito" fica verde quando a
implementação recusa tudo; e um teste cujo fixture não tem `train` nem `cal-B` não distingue
allowlist de filtro negativo, por mais explícito que o comentário seja. Regra que passa a valer:
**toda allowlist ganha fixture que contém o que ela exclui, e a prova é reverter a produção e ver
vermelho** — não ler o código e concluir.

### Rodada 3 do cross-review do E2 — REJEITADA, e a que mais rendeu (2026-08-01)

Veredito **(c) rejeitar**, cinco achados, todos bloqueantes, e o codex fechou dizendo que a unidade
"não está entregável". Nenhum era falso — conferi os dois mais graves no disco antes de consertar.

**Foi a rodada mais produtiva das três, e a razão é de método:** as rodadas 1 e 2 receberam a minha
lista de perguntas, que enviesou a revisão para o meu enquadramento; a 3 recebeu **mandato amplo**
("analise o código e a estrutura do diretório por conta própria"). Nas três ele achou coisas fora da
minha lista, mas na 3 achou as estruturais.

| # | achado | conserto |
|---|---|---|
| 1 | **F1-5n afrouxou de verdade.** Tirei o piso do caminho de reprovação e apontei o gate do E3 como substituto — que **não existe em código**: `powerFloors.samplingUnits` só é parseado e `commands/split.ts` selava lendo apenas `splitAudit.passed`. E o piso pré-registrado é **por partição**, então `dev` exigiria ≈20 mil linhas humanas, não os "≥10 mil" que eu havia registrado | F1-5n **emendada** após consulta ao codex: o piso de linhas segue fora do gating (é a unidade errada nas duas direções), mas entrou um gate que recusa **congelar corpus `release`** (hoje `COMPOSITION_FLOOR_NOT_APPLIED`, ver F1-5o), e `runValidate` passou a aceitar `corpusPolicy` explícita só para `infrastructure-only`. Release fica indisponível de propósito; o repositório, não |
| 2 | **`validateSplitArtifact` tinha os registros e nunca reexecutava a auditoria** — `classFractions`, `cutoffs`, `leakages`, `testHumanNegatives` e `passed` eram lidos do arquivo. E o meu fixture de evidência declarava 2.000 negativos humanos com 20 assignments em `test`: criptograficamente selado, semanticamente impossível, e **aceito** | o validador passou a **re-derivar** a auditoria dos registros e comparar por digest. Cinco testes de forja, cada um recomputando OS DOIS digests; **medido: com a guarda desligada, todos devolvem `ACEITO`** |
| 3 | autoridades se contradizendo: achado 11 aberto em dois documentos, spec ainda pedindo 2.000, F1-5n sem entrada obrigatória em `references.md`, "≥11 mil" contra "≥10 mil" | achado 11 fechado, plano e spec atualizados, `references.md` § 2.2e criada, e os dois números marcados como **ambos errados** |
| 4 | garantias publicadas falsas: "recusa antes de abrir qualquer arquivo" — mas `runSplit` abre três ENTRADAS antes de calcular | reenunciada como "sem escrever nenhuma SAÍDA", nos três lugares onde a promessa aparece |
| 5 | comentários narrando processo/versão/histórico; vocabulário antigo sobrevivente; e um comentário que o meu próprio `sed` **corrompeu** em "Development and dev and cal-A" | reescritos para enunciar a restrição, não a migração; o corrompido reparado |

**A consequência que rendeu mais que os cinco achados.** Re-derivar a auditoria desmascarou **três
fixtures que a fabricavam à mão** (`passingAudit(split)` em `fit`, `consume-holdout` e `cli`). Ao
consertá-los apareceu o que a fabricação escondia: aqueles corpora tinham `collectionBatch`,
`domainSource` e — num deles — `promptTemplate` **idênticos em todas as linhas**, ou seja, eram **um
único componente conectado**, que nenhum split consegue separar. Nenhum deles nunca descreveu um
corpus divisível. Ver achados 14 e 15.

**Quanto código existia só para sustentar a ficção:** removidas três funções
(`passingAudit`, `honoredReservation` ×2) e quatro imports que nada mais usa depois que a auditoria
passou a ser medida.

**Estado ao fim:** 162 arquivos / **2340** testes verdes (baseline da unidade: 2315), 139 Python,
typecheck/format/docs limpos, lint nos 13 problemas pré-existentes (zero introduzidos),
`evaluatorDigest` `747b1785…`.

### Incidente de agente parado esperando trabalho que já tinha terminado (E2, 2026-08-01)

**Sintoma, observado pelo operador e não por mim:** duas rodadas de cross-review terminaram e eu não
voltei a olhar a resposta até ele perguntar "como está o andamento?". Duas vezes. Entre o fim da
análise e a minha leitura houve tempo morto que nada justificava.

**Causa, diagnosticada e não suposta.** Duas, somadas:

1. **Lançei o codex com `nohup … &` dentro de uma chamada em PRIMEIRO PLANO.** Isso entrega o
   processo ao sistema operacional e não deixa nada para o harness rastrear — e é exatamente para
   isso que existe o `run_in_background` da ferramenta, que registra o processo e re-invoca o agente
   quando ele sai. Eu contornei o mecanismo projetado e depois reclamei da falta dele.
2. **O monitor caseiro que pus no lugar era insatisfazível por construção.** A condição era
   `ps -W | grep -ci codex` chegar a zero. Só que há um `codex.exe` da extensão do VS Code
   (`~/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe`) **permanentemente vivo**.
   A contagem nunca chega a zero, o laço gira até o timeout e nenhuma notificação acontece. O
   processo da revisão já havia morrido; o contador estava olhando outro programa.

**As três regras que passam a valer:**

1. **Trabalho externo longo vai com `run_in_background: true` da ferramenta**, nunca `nohup &` dentro
   de chamada em primeiro plano. Quem rastreia é o harness.
2. **O comando anexa uma SENTINELA à própria saída ao terminar** (`===...CONCLUIDA status=N===`).
   Conclusão fica detectável por conteúdo, não por tabela de processos — um `tail` responde mesmo se
   o rastreamento se perder.
3. **Nunca condicionar espera em NOME de processo.** Se poll for inevitável, ele olha a sentinela ou
   a linha de veredito. Nome de processo casa homônimos, e neste repositório casa um homônimo
   imortal.

**A regra de conduta por trás das três, que é a que importa:** "estou aguardando X" só pode ser dito
depois de ter conferido X ao menos uma vez naquele turno. Eu afirmei estar aguardando duas revisões
que já estavam prontas — o que, em termos de evidência, é a mesma falha de reportar medição feita em
estado anterior do código. Aguardar não é estado que se presume; é estado que se verifica.

### Incidente de diretório, terceira ocorrência da MESMA causa (E2, 2026-07-31)

O handoff avisava: "o `cd` do shell resetou duas vezes e três arquivos foram editados no lugar
errado". Aconteceu de novo. Um `cd benchmark/lab && python -m unittest` em **primeiro plano**
persiste no shell, e um `cd` absoluto posterior o reverteu para a raiz do tree **principal** — não
do worktree. Duas verificações rodaram no tree errado antes de eu notar: a varredura de `0x08`
(que leu 560 arquivos do `main`, limpo por construção, e reportou "NONE" sobre o corpus errado) e
uma medição de tempo que devolveu "no tests".

**Nada foi editado no lugar errado**, e isso foi conferido e não suposto: `git status` no tree
principal seguiu com `main` em `04c2cd5` e só `graphify-out/` fora do índice, idêntico ao início da
sessão. O motivo de ter escapado é que todo EDIT usou caminho absoluto; os scripts Python de
migração usavam caminho relativo e teriam acertado o tree errado se a deriva tivesse ocorrido antes
deles, e não depois.

**A regra que faltava, e que é mais forte que "confira a branch no começo":** toda medição que
vale como evidência tem de imprimir `pwd` **na mesma invocação** que produz o número. Conferir a
branch uma vez no início não protege — a deriva acontece no meio. Uma varredura que devolve "NONE"
é indistinguível de uma varredura no diretório errado, e foi exatamente essa a forma do erro aqui:
o resultado limpo era verdadeiro sobre a árvore errada.

### Incidente de edição, registrado porque quase custou trabalho

Ao reescrever um bloco de comentário em `benchmark/source-manifest.ts` por índice de
string, escolhi como fim um marcador que ocorria **antes** do início — e o recorte
`s[:start] + novo + s[fim:]` duplicou 247 linhas do arquivo, incluindo declarações de
constante. O `typecheck` pegou (`Cannot redeclare block-scoped variable`), mas a suíte teria
pegado também; o risco real era eu ter tentado consertar com `git checkout`, que apagaria
todo o trabalho não commitado do arquivo.

O conserto foi por linhas, com verificação de que **cada** constante do módulo aparece
exatamente uma vez, e conferindo depois que o comentário sobrevivente era a versão nova e que
`git diff --stat` não estava inflado. Regra que fica: recorte por índice de string precisa
verificar `fim > início` antes de escrever, e edição de bloco grande deve conferir unicidade
das declarações depois.

### Onde está o cross-review em curso (handoff)

A **sétima rodada** foi disparada em 2026-07-31 e roda **desanexada** do processo do agente, para
o resultado existir mesmo que a sessão termine antes dela:

- prompt: `.codex-reviews/r7-prompt.txt`
- veredito: `.codex-reviews/r7-veredito.txt` (o script anexa `EXIT=<código>` na última linha)
- para redisparar: `./.codex-reviews/run-r7.sh`
- o diretório está no `.gitignore` — é área de trabalho, não artefato

**Regra de procedimento que faltava, e que custou uma sessão:** ao encerrar com uma unidade de
caminho selado consertada mas não re-revisada, **dispare a rodada antes de encerrar**. A revisão
roda em segundo plano e não consome atenção; não disparar troca tempo de máquina ocioso (que é de
sobra no fim da sessão) por latência de sessão (que é escassa). D-2 diz que a unidade espera o
cross-review — não o contrário. E como processo em segundo plano pode morrer no encerramento,
desanexe com `nohup` e escreva em caminho estável do worktree, nunca no diretório temporário da
sessão.

**Achados abertos, registrados e não consertados** (rule 3 do bloco D):

11. ✅ **FECHADO em 2026-08-01 pela decisão F1-5n emendada** (ver § "Unidade 3 — E2"). Ficava
    aberto por erro de processo — eu o havia devolvido como pergunta em vez de decidir.

    A contradição medida era real e a aritmética é `(0,20 + 0,02) × 4000 = 880 < 2000`, com o teto e
    não o alvo, para corpora selados por `runValidate`. O que resolveu **não** foi mexer em nenhum dos
    três números: foi trocar a PERGUNTA que o gate faz. O piso de linhas saiu do caminho de reprovação
    e virou medição publicada; no lugar dele entrou um gate que recusa **congelar corpus de release**
    sem o atestado de composição do E3 — na unidade pré-registrada, e existindo em código, que era o
    que faltava. Corpus `infrastructure-only` congela normalmente, então o repositório segue
    exercitável ponta a ponta.

    **O que permanece aberto, e agora é escolha explícita do operador e não contradição escondida:**
    dimensionar o corpus para o gate (≈20 mil linhas humanas, ≈50 mil registros, +16 mil humanos) ou
    rever formalmente unidade/células/piso do E3 com nova análise de poder. Até uma das duas, release
    está bloqueado por desenho.

14. ❌ **ESTE ACHADO ESTAVA ERRADO, e a correção importa mais que ele.** Registrei que o caso
    DEGENERADO de reamostragem havia perdido sua asserção por uma **impossibilidade estrutural** —
    que um corpus com proporções corretas não poderia ser degenerado. Falso, e a rodada 4 do
    cross-review mediu a saída.

    **O erro foi de leitura, invertida:** `degenerate` é `levels === items.length`
    (`benchmark/bootstrap.ts`), isto é **cada item sendo sua própria unidade de reamostragem** — o
    caso em que não há nada sobre o que reamostrar. Eu li como "poucos níveis" e concluí o oposto do
    que o predicado diz. Com oito positivos, degenerado é **oito** níveis, não dois.

    **E a minha própria mudança foi o que causou a perda:** eu havia posto o filler do bloco cego num
    cluster só, "para a degeneração existir". Isso a destrói. Revertido para um cluster por linha, a
    medição dá `2/8/8` com `degenerate: true` e a cobertura volta — sem tocar proporções, tempos ou
    vazamento.

    **A lição que fica, e é a de terceira ordem:** eu não só errei o predicado, eu **registrei o erro
    como impossibilidade estrutural** e aceitei perder cobertura por causa dele. Antes de declarar que
    duas propriedades não cabem no mesmo corpus, leia o predicado que as decide. Declarar
    impossibilidade é a afirmação mais forte disponível e exige a evidência mais forte.

15. **Duas regras de fixture que esta unidade descobriu na prática, e que valem além dela.**

    **(a) Filler não é neutro — ele participa da propriedade sob teste.** Três variantes do mesmo
    erro apareceram: no `consume-holdout` a exigência era **um cluster por linha**, para o vazamento
    não ser vacuoso; no bloco cego do `cli` é **um cluster só**, para a degeneração existir; e em
    ambos os tempos do filler têm de ser fixos por banda, porque somar o índice espalha `train` para
    dentro da banda de `test` e quebra `earliest(test) > latest(train)`.

    **(b) Fixture que fabrica a auditoria esconde corpus indivisível.** Os três fixtures que
    chamavam `passingAudit(split)` tinham `collectionBatch`, `domainSource` e — num deles —
    `promptTemplate` idênticos em **todas** as linhas. Ou seja: o corpus era **um único componente
    conectado**, que nenhum split consegue separar. Nenhum deles nunca descreveu um corpus
    divisível; a auditoria escrita à mão é que sustentava a ficção, e só a re-derivação a desfez.

12. **Dois arquivos rastreados carregam um byte NUL literal (`0x00`), escrito onde o repositório
    manda escrever escape.** `benchmark/near-duplicates.ts:11283` (num separador de chave
    composta, `` `${left}\x00${right}` ``) e `tests/unit/storage/import-export.test.ts:5071`.
    Funcionalmente idêntico ao escape em runtime, mas faz `grep` tratar o arquivo como binário —
    foi assim que este achado apareceu, num `grep` que silenciosamente não mostrou linhas. É a
    mesma família do incidente do `0x08`, e `benchmark/split-audit.ts` já documenta a regra
    ("Written as an escape, never as a literal control byte"). **Pré-existente** (`81e5f3f`), não
    tocado pelo E2, e `near-duplicates.ts` é membro de `EVALUATOR_FILES` — então o conserto move o
    `evaluatorDigest` e quer commit próprio. A varredura de `0x08` continua limpa; o que faltava
    era varrer os OUTROS bytes de controle, e passou a ser feito.

13. **Dois problemas de lint pré-existentes, fora do E2:** `benchmark/lab/build_governance.ts:14`
    importa `dirname` sem usar; e o ESLint varre
    `.cache/chrome-for-testing/**` (10 erros `no-undef` em JS de terceiros do build do Chrome),
    que deveria estar ignorado. O E2 não introduziu nenhum problema de lint.

1. **PRIORIDADE SUBIU (Fase 1).** `HUMAN_LABEL_DENIAL` (`benchmark/source-manifest.ts`) não
   inclui `nenhum`/`nenhuma`, então `humanLabelOverclaimIn` e `reviewOverclaimIn` recusam
   denegações corretas — "nenhuma evidência prova a autoria humana" lê como over-claim. (`nada`
   NÃO faz parte deste achado: foi removido de todas as telas, porque nega numa frase e reforça na
   seguinte — ver F1-1g.) Já são
   **duas** telas que precisaram ampliar a negação localmente (`WIDENED_DENIAL`), o que é o sinal
   de que o padrão compartilhado é que está errado. Conserto é de uma linha; o efeito é afrouxar
   duas telas de caminho selado, então quer rodada própria com revisão.
2. A janela de negação de 40 caracteres das duas telas antigas atravessa vírgula, então
   "X, e não Y, garante Z" lê como sua própria denegação. A tela nova usa
   `propagationIsDenied`, que corta na vírgula; as antigas não.
3. `benchmark/lab/build_governance.ts` tem `dirname` importado e não usado (erro de eslint
   pré-existente, arquivo não tocado nesta fase).
4. **Tela de over-claim não alcança célula de tabela markdown.** `CLAUSE_BOUNDARY` trata `|` como
   fronteira de cláusula — por uma razão real: sem isso um sujeito numa coluna casaria com um verbo
   três colunas adiante. Consequência: uma alegação partida entre duas células é invisível às
   **três** telas. Nenhum documento explora isso hoje, e uma tabela de licença é exatamente onde
   alguém escreveria a frase. Conserto mexe em maquinaria compartilhada: rodada própria.
5. **A negação é testada por presença na janela, não por escopo.** `propagationIsDenied` estreita a
   janela até a última vírgula, o que pega o aposto ("os pesos, e não o corpus, herdam…"); não pega
   uma negação de outro constituinte sem vírgula. A tela é lint que encarece escrever a frase, não
   prova de que a frase não está lá — e o docstring agora diz isso.
6. `verify-model-bundle.mjs` **não** verifica o CONTEÚDO de `LICENSE`/`NOTICE.md` — só `isFile()` e
   `size > 0` (`bundleDigest` cobre apenas `manifest.artifacts`). Foi assim que o `public/` servido
   ficou com um NOTICE de 749 bytes enquanto o rastreado tinha 3020, com todos os gates verdes.
   A Fase 0 corrigiu a **origem** (o script copiava o MIT da raiz sobre a licença dos pesos), não
   a ausência de verificação de conteúdo. Cabe na Fase 2 ou 3.
10. **A linhagem fail-closed está PARCIAL, e o buraco é de desenho.** Achado da sétima rodada de
   cross-review, reproduzido por ele: `assertDerivedParentsResolve` faz
   `if (parentId === undefined) continue` (`benchmark/schema.ts:3450`), então um registro v3
   gerado com **ambos** os eixos de linhagem em `notApplicable` passa pela guarda — e
   `benchmark/lab/assemble_corpus.py:894` permite geração sem pai. O plano exige que "todo gerado
   referencia pai humano presente" (plano v1, Fase 1 item 4), e o que está imposto hoje é mais
   fraco: *todo gerado que DECLARA um pai referencia um pai presente*.
   **Por que não foi consertado junto:** a pergunta é de desenho, não de código — existe geração
   legítima sem semente humana? (o schema permite `notApplicable`, e a razão declarada pode ser
   verdadeira). Decidir isso escrevendo o `if` é exatamente o erro que o processo decidido em
   2026-07-31 existe para evitar. Vai para a etapa 1 (Fable) da próxima unidade que tocar
   linhagem — provavelmente E3, que já deve o teste de integração v3 do achado 8.
   O cross-review autorizou o commit com este achado registrado.
9. **`benchmark/tests/consume-holdout.test.ts` é intermitente.** Três testes ("opens a fresh
   lease for a genuinely different block under the same candidate" e duas ocorrências de
   "refuses a resume whose evaluator drifted") falharam em UMA execução da suíte completa e
   não reproduziram em duas seguintes, nem rodando o arquivo isolado. Não é desta unidade — o
   arquivo não foi tocado — e o padrão sugere concorrência de fixture em diretório temporário.
   Merece uma rodada própria, porque teste intermitente em caminho selado é pior que teste
   ausente: ele ensina a ignorar vermelho.
8. **Falta teste de integração v3 para a recusa de linhagem.** `assertDerivedParentsResolve` só
   inspeciona registros `schemaVersion: 3`, e o único cenário ponta a ponta do repositório
   (`corpus-import.test.ts`) é v2 — então a chamada acrescentada em `runSplit` passa por ali sem
   nunca entrar no corpo. O teste que falta precisa de um dataset v3 com `manifest.json` e
   `dataset-audit.json` de digests coerentes, o que significa selar um corpus v3 pequeno
   (`sealDataset` com política própria, já que 4000/4000/2000 é a política de release). Desenho
   pronto; é a próxima coisa a fazer em E3.
7. **Os bundles em `public/` e `dist*/` seguem com os arquivos legais antigos.** A Fase 0 consertou
   o script; não reempacotou. Enquanto ninguém rodar `package-own-model`, o que está servido é o
   MIT como licença dos pesos e o NOTICE pré-Fase-0. Reempacotar é ação de release, não de Fase 0.

### Rodada 4 do cross-review do E2 — REJEITADA, sete achados (2026-08-01)

Veredito **(c) rejeitar**: três P1, dois P2, dois P3. Nenhum falso. O mandato foi amplo de novo, e
de novo foi o que achou o estrutural.

| # | achado | conserto |
|---|---|---|
| 1 | **O gate de composição era contornável pelo caminho tipado.** `runSplit` recusava `release` sem atestado, mas `buildSplitArtifact` e `validateSplitArtifact` são exportadas e alcançadas direto — medido `release-sem-atestado-via-builder+validator: ACEITO` | o atestado entrou no **contrato**: `compositionAttestation: string \| null` no artefato, obrigatoriamente não-nulo quando o manifesto diz `release`, verificado nas duas funções. Forma selada mudou, logo `schemaVersion` 2 → 3 |
| 2 | **O validador não vinculava o artefato às autoridades que recebe:** re-derivava a auditoria com a reserva do próprio arquivo, sem comparar com o manifesto, e nunca reexecutava o splitter | as duas metades entraram: comparação contra `manifest.heldOutGeneratorFamilies`, e reexecução de `createBlockedSplit` sob a política do próprio artefato, comparando `id`+`partition` (`SPLIT_ARTIFACT_ASSIGNMENTS_NOT_REPRODUCIBLE`) |
| 3 | **A guarda parcial não continha toda a metade independente do dataset.** Três forjas medidas como ACEITAS: `cutoffs` divergentes, `passed` com `reasons`, id duplicado com contagens coerentes | **já estava consertado no disco** — as três checagens vivem na função que a guarda parcial chama na primeira linha. O que estava errado era o NOME dela: `assertArtifactVocabulary` fazia digest, coerência e unicidade. Renomeada `assertDatasetIndependentInvariants` |
| 4 | o achado 14 do registro afirmava impossibilidade estrutural falsa | **FECHADO.** `degenerate` é `levels === items.length`, ou seja MUITOS níveis. Eu havia lido invertido; a minha mudança para "um cluster por pad" foi o que causou a perda. Revertida, cobertura recuperada `2/8/8` |
| 5 | `fit.test.ts` declarava `release` sobre corpus sem classe `mixed` | **FECHADO** — passou a `infrastructure-only` |
| 6 | comentários descrevendo comportamento extinto: o cabeçalho de `split-audit.ts` dizia que a auditoria PROVA `release-worthy` pelos pisos; `commands/split.ts` dizia que o piso torna nenhum corpus selável | reescritos para o que o código faz hoje: a auditoria reprova por vazamento, ordem temporal, proporção e eixo declarado em `unknown`; os pisos são **medição publicada**, e quem decide selar `release` é o atestado |
| 7 | resíduo de script no registro: linha duplicada e **dois achados 13 diferentes** | linha desfeita; o achado de regras de fixture renumerado **13 → 15** (12 = bytes NUL, 13 = lint), e a referência cruzada da rodada 3 corrigida junto. Em `fit.test.ts`, a citação Wilson passou a usar o denominador do fixture: `wilsonOneSided(0,105)` ≈ **0,025**, não os 0,037 de 70 |

**A consequência que rendeu mais que os sete achados: três cópias à mão da projeção selada.** O
`splitDigest` cobre "todo campo menos ele mesmo", e essa projeção estava escrita três vezes — na
produção (`withoutSplitDigest`), no teste (`sealedProjection`) e na fixture de evidência (um objeto
literal inline). Ao acrescentar `compositionAttestation` as duas cópias ficaram velhas, e o efeito
foi pior que uma falha: os testes de forja passaram a morrer em `SPLIT_DIGEST_MISMATCH` **antes** de
alcançar a re-derivação que eles existem para provar — passavam a testar outra coisa sem avisar. A
cópia do teste era tipada `unknown`, então o TypeScript não tinha como acusar a divergência.
Conserto: a projeção de produção foi **exportada** e as duas cópias apagadas. Como ela devolve
`Omit<SplitArtifact, "splitDigest">`, esquecer um campo novo agora é **erro de compilação**.

**E um achado que a própria correção produziu: o `seed` publicado é alavanca fraca.** Ele entra em
um lugar só — `component.order`, o digest que desempata a ordenação dos componentes
(`benchmark/split.ts`). Num corpus sem empate de tempo ele não move colocação nenhuma: **medido**,
uma forja que troca `seed` e `policy.seed` e re-sela tudo é ACEITA pela reexecução do splitter,
porque a reexecução com o seed novo produz exatamente a mesma partição. Então `seed` não é, por si,
proveniência verificável — o que a reexecução prova é que a POLÍTICA e os registros geram aquela
colocação, e o resíduo que ela cobre é o conjunto de colocações que a auditoria aceitaria e o
algoritmo não produz.

**E esse resíduo eu não consegui exibir, o que registro como limite e não como prova.** Sondei o
fixture: para os 30 primeiros candidatos de `cal-B → train`, TODO movimento de registro único é
recusado, e sempre pela mesma razão — `grouping leakage: 6 group value(s) cross partitions`. Ou seja
o vazamento de grupo já cobre a forja de um registro, porque nenhum registro do corpus é componente
sozinho. Uma colocação que a auditoria aceite teria de mover um **componente inteiro**, e aí as
proporções por classe têm de continuar dentro dos dois pontos — busca que não fechei. Então a
reexecução do splitter hoje entra como defesa em profundidade **sem forja que só ela pegue**, e o
único teste de mutação que ela tem é o de limite (seed trocado → ACEITO). Levado explicitamente à
rodada 5: uma guarda que nenhuma mutação exercita deve entrar?

### Rodada 5 do cross-review do E2 — REJEITADA, e ela derrubou duas coisas que eu havia registrado como verdade (2026-08-01)

Veredito **(c) rejeitar**: dois P1, três P2, mais a lente de padrões. Confirmei as duas P1 no disco
antes de decidir.

| # | achado | situação |
|---|---|---|
| 1 | **P1 — o gate do atestado continua contornável.** `assertCompositionAttestation` aceita qualquer string com `length > 0`, logo `"x"` basta para `buildSplitArtifact` e `validateSplitArtifact` aceitarem `release`. Pior: `commands/publish-evidence.ts` conhece `scientificUse` e chama só a guarda parcial, sem cruzar `release` com o atestado, e o resumo do sanitizador omite o campo. O digest de fachada das fixtures mascarava exatamente isso — testava presença de token, não existência de E3 | **decidido: F1-5o.** A minha afirmação "release segue bloqueado pela ausência de E3" **não correspondia ao disco** |
| 2 | **P1 — o `seed` é inerte, e não só sem empate de tempo.** Eu havia registrado o limite como "num corpus sem empate"; é pior. `order` entra apenas no comparador de iteração; `assignPartition` decide por banda e cortes, e cada partição é reordenada por `id` no fim — então a ordem de iteração não muda `id → partition` NUNCA. E há conflito de autoridade: a seed pré-registrada do split é **20260726** (`rebuild-v3-policy.json`), o comando aceita qualquer número, o validador só exige igualdade entre as duas cópias internas, e os fixtures usam **712019**, que é a seed do *checkpoint publicável* — outra autoridade | **decidido: F1-5p** |
| 3 | **P2 — a reexecução deve ficar, e ele construiu a forja que eu não consegui.** 300 registros singleton, split `135/15/30/60/60`, os três registros do instante 61 movidos de `cal-B` para `cal-A` → `135/15/33/57/60`, auditoria `passed: true` com `reasons: []`, três atribuições divergentes, validador recusa com `SPLIT_ARTIFACT_ASSIGNMENTS_NOT_REPRODUCIBLE` | a guarda fica; entra o teste com essa construção |
| 4 | **P2 — o contrato não fecha em RUNTIME.** JSON entra por cast e ninguém valida o conjunto exato de chaves da raiz. **Medido:** acrescentar `unsealedExtra` na raiz SEM recomputar `splitDigest` é aceito (a projeção enumera campos conhecidos, então extra desconhecido é invisível ao digest); e acrescentar a label `robot` em `audit.classFractions` e re-selar é aceito, porque a checagem enumera `human/ai/mixed` individualmente e nunca valida o conjunto | entra fronteira de runtime que recusa chave extra/ausente e vocabulário desconhecido |
| 5 | **P2 — o mesmo defeito estrutural das cópias à mão vive em mais seis lugares:** paridade de runtime, auditoria de dataset e prontidão de fonte, reescritas à mão em `candidate-preflight.ts` e `calibration-pipeline.ts`. Hoje concordam, e nada força acompanhar | unificar ou tornar exaustiva por tipo |
| 6 | padrões: comentários de processo, histórico e número de tarefa sobreviveram — `Phase 3`, narrativa em `commands/split.ts`, `E3`/`C3`/`D0b` como rótulos de etapa, "used to" em `split.ts` e `assemble_corpus.py` | reescrever enunciando a restrição |

**F1-5o — o atestado de composição passa a ser DERIVADO do corpus, não fornecido pelo chamador.**
O atestado como `string` era teatro: quem chama fornece o valor, então a guarda só verificava que
alguém digitou algo.

**Registro da alternativa que eu descartei, porque quase a implementei.** A primeira formulação era
recusar `release` no caminho selado, sem campo nenhum para satisfazer. Ao medir os 47 pontos de
`release` no código vi que ela é destrutiva: `commands/fit.ts`, `commands/evaluate.ts` e
`commands/consume-holdout.ts` **exigem** `scientificUse: "release"`, então recusá-lo no split torna
todo o pipeline a jusante permanentemente inalcançável e apaga a cobertura dele. Foi exatamente esse
muro que derrubou a minha primeira tentativa no achado 1 da rodada 4, e eu ia repeti-lo.

**O que entrou:** o atestado é o digest canônico do inventário por partição e por classe de
**linhas-registro e componentes conectados independentes**, calculado por `compositionAttestationOf`
a partir dos registros e das atribuições, via `connectedComponentRoots` — a mesma fonte única de
conectividade que o splitter e a auditoria usam. O construtor o deriva (não há mais campo de
entrada); `validateSplitArtifact` o **recomputa** e recusa divergência
(`SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH`), e recusa também atestado presente em corpus não-
release. Nenhuma string satisfaz por ser não-vazia. A publicação, que por desenho não tem dataset,
verifica a metade decidível sem ele — o pareamento `release` ⇒ atestado não-nulo — e passou a
publicar o campo no resumo, que antes o omitia.

**O que NÃO é decidido aqui, e onde fica:** se um inventário **basta**. Isso é julgamento de
suficiência, continua no piso pré-registrado e no E3, exatamente onde F1-5n o pôs. A minha afirmação
anterior — "release bloqueado por ausência de E3" — era falsa e foi retirada; o bloqueio, quando
existir, vem da suficiência medida, não da ausência de um campo.

**Referência obrigatória:** `docs/references.md` § 2.2f, e a § 2.2e foi **emendada** porque afirmava
que o atestado era evidência inexistente.

**F1-5p — a seed do split passa a ser vinculada à autoridade congelada, e deixa de ser apresentada
como proveniência causal.** Duas metades: (i) `commands/split.ts` e o validador passam a exigir
`REBUILD_V3_POLICY.seeds.split`, recusando qualquer outro número — o que também recusa a forja de
seed, por autoridade e não por reexecução; (ii) o comentário do campo enuncia que a colocação é
função pura de registros, frações, tolerância e reserva, e que a seed não seleciona entre resultados.
Os fixtures saem de `712019` (seed do checkpoint publicável, autoridade errada) para `20260726`.

**A minha falha de processo desta rodada, e ela custou verificação.** Rodei uma workflow de
verificação adversarial **em paralelo** ao cross-review, e os agentes dela mutaram o worktree: nasceram
e morreram arquivos `zz-*`, e um deles chegou a alterar `benchmark/split-artifact.ts` para um `void 0`
antes de restaurar. O codex viu a árvore instável e registrou que **não havia suíte verde demonstrável
no estado final observado** — ou seja, eu enfraqueci a própria revisão que pedi. Regra que passa a
valer: **nenhuma verificação que muta arquivos roda concorrente a um cross-review.** Ou espera, ou roda
em worktree isolado. Resíduo removido e integridade reprovada depois (nada rastreado ficou alterado).

**Fechamento dos três P2 e da lente de padrões (2026-08-01).**

**Achado 3 — a reexecução ganhou a mutação que só ela recusa, e a construção é do codex.** Eu havia
registrado que não conseguia exibir a forja e levado a pergunta à revisão; ele a construiu. O teste
que entrou usa corpus de **300 singletons** — todo eixo de grupo único por registro — porque foi
exatamente isso que a minha sonda tinha medido como impedimento: num corpus cujas linhas compartilham
gerador, lote ou cadeia de derivação, mover um registro parte o componente dele e o vazamento recusa
antes. Com singletons, o registro **mais antigo de `cal-B`** (derivado, não fixado) volta para `cal-A`:
a ordem temporal continua valendo porque `latest(cal-A) < earliest(cal-B)` se mantém, e um registro
desloca cada fração por 1/total-da-classe, dentro dos dois pontos. A auditoria re-derivada fica
**idêntica e aprovada** — `reasons: []` — e a reexecução do splitter é a única coisa entre o arquivo e
a aceitação. Dois tropeços no caminho, os dois de fixture e não de desenho: o corpus precisava ter
registro da família **reservada** (uma reserva declarada sem linha não é honrada, então a reserva
derivada voltava vazia e discordava da política), e a família certa era `family-unseen`, que é a que a
política do teste declara — eu havia usado `heldout_family`, de outro fixture.

**Achado 4 — o contrato passou a fechar em RUNTIME, e a forma é exaustiva por tipo.** As duas forjas
que o codex mediu como aceitas entraram como teste. A raiz e o vocabulário de label são declarados
como `Record<keyof T, true>`, então **campo novo não classificado é erro de compilação**; e a checagem
do CONJUNTO de chaves roda antes de qualquer digest ser confiado, porque é aí que está o furo: o
`splitDigest` cobre uma projeção de campos conhecidos, logo chave extra na raiz é invisível ao selo e
viajava não-selada.

**Achado 5 — as seis projeções duplicadas foram unificadas, e a de paridade revelou que o contrato já
tinha a resposta.** `runtime-parity.ts` já exportava `RuntimeParityDigestInput = Omit<…,
"runtimeParityDigest">`: o literal duplicado nunca precisou existir. As três projeções autoritativas
vivem em `calibration-pipeline.ts` e `candidate-preflight.ts` as importa (direção que o import de tipo
já existente estabelecia). Auditoria de dataset e prontidão de fonte usam `Record<keyof T, boolean>`,
classificando cada campo como dentro ou fora da identidade. A serialização canônica **ordena chaves**,
então selecionar campos não move digest nenhum — verificado antes de mexer.

**Lente de padrões — os rótulos de etapa saíram.** `C3`, `D0b`, `E3`, `R6` e `C2` apareciam 21 vezes
como nome de fase do plano dentro de comentário. O fato de domínio ficou, o rótulo saiu: "C2 mediu 782
de 783 referências de pai sem linha" virou "782 de 783 referências de pai no corpus montado não
resolvem para linha nenhuma". Também caiu `Phase 3`, a narrativa de "a função existia e não tinha
chamador de produção", e o "used to be written as `partition !== \"test\"`" — que virou o enunciado
positivo: a forma negativa descreve o mesmo conjunto **só enquanto há três nomes**.

**E o gate do comando foi renomeado porque o motivo dele mudou.** Era
`COMPOSITION_ATTESTATION_MISSING`, o que deixou de ser verdade quando o atestado passou a ser derivado
— nenhum atestado falta. Virou `COMPOSITION_FLOOR_NOT_APPLIED`, e o motivo enunciado é o real: o
artefato **registra** a composição, registrar não é julgar, e o piso pré-registrado por célula de cota
não é aplicado nesta etapa — então um selo de release produzido aqui publicaria composição contra a
qual piso nenhum foi conferido. Ponteiros reconciliados em `references.md` e no registro.

**Falha de processo repetida, e desta vez contra mim mesmo.** Editei comentários **durante** a bateria
e ela devolveu duas falhas (`cli.test.ts` e `consume-holdout.test.ts`) que não se reproduzem: os dois
arquivos passam sozinhos. É a mesma regra que eu acabei de registrar por causa da workflow concorrente,
agora aplicada ao meu próprio teclado: **enquanto a bateria roda, não se toca no repositório** — nem
comentário. Trabalho de espera vai para o scratchpad, fora da árvore.

### Rodada 6 do cross-review do E2 — REJEITADA, e o achado 1 é maior que um conserto (2026-08-01)

Veredito **(c) rejeitar**: cinco achados de spec (dois P1, três P2) e um grupo de padrões. Confirmei
cada P1 no disco antes de decidir. **Dois deles são defeitos que eu mesmo introduzi na rodada 5.**

| # | achado | situação |
|---|---|---|
| 1 | **P1 — o montador Python é NOMINAL: ele estampa 45/5/10/20/20 em linhas, e o splitter recolapsa.** Sonda do codex: 100 linhas de um lote compartilhado voltaram `human=[train 1.000, dev 0.000, cal-A 0.000, cal-B 0.000, test 0.000]` | **fail-closed + garfo escalado.** Ver abaixo: a consequência é maior que consertar o fatiamento |
| 2 | **P1 — prototype pollution no atestado que eu acabei de escrever.** `partition: "__proto__"` indexava objeto comum em `compositionAttestationOf`, e a validação de vocabulário só rodava depois: ele reproduziu `Object.prototype.human.recordLines === 1` | **FECHADO.** Duas correções, porque uma só não basta: a guarda independente do dataset passou a rodar ANTES de qualquer uso das atribuições, e o inventário virou `Map`. Teste prova a recusa E que `Object.prototype` fica intacto |
| 3 | **P2 — seed arbitrária passava pela guarda de publicação.** A autoridade estava só no validador completo, e `publish-evidence` alcança apenas a guarda parcial: seed `99` re-selada foi ACEITA | **FECHADO** — a comparação com `REBUILD_V3_POLICY.seeds.split` mudou para as invariantes independentes do dataset, que é onde o caminho de publicação chega |
| 4 | **P2 — a guarda parcial aceitava "atestado" que não era digest.** JSON entra por cast, então `string \| null` é alegação de compilação: `compositionAttestation: 42` foi ACEITO | **FECHADO** — na mesma fronteira, só `null` ou sha256 hexadecimal minúsculo de 64 caracteres |
| 5 | **P2 — o campo não tinha a semântica que a § 2.2f documentava.** Eu hasheava `{datasetDigest, assignmentsDigest, inventory}`, então o atestado se movia sem a composição mudar, e duplicava identidades que o artefato já sela | **FECHADO** — hash **só do inventário**, que é o que a especificação diz |
| padrões | comentários narrando tarefa, migração e histórico em nove lugares, mais um factualmente obsoleto | **FECHADO** — nove reescritos |

**O achado 1 não é um bug de fatiamento; é uma contradição estrutural, e o próprio código já
continha a metade da explicação.** A docstring de `assign_generation_batches` justifica compartilhar
`collectionBatch` assim: `generatedAt` faz parte da chave do lote e **coincide com o bloco temporal**,
logo um lote de geração é componente indivisível que nunca atravessa dois blocos. Verdadeiro — e o
argumento **não se estende aos humanos**. Um registro humano fica com `extraction_<arquivo de pool>`,
e são **quatro** arquivos; os registros de um pool são espalhados pelos cinco blocos. O valor
compartilhado é um componente conectado, o splitter põe o componente inteiro numa banda, e um que
atravessa cai em `train`. Daí `train 1.000`.

A medição já estava no repositório, em outro contexto: o comentário de
`test_no_generated_record_is_left_unknown_on_the_batch_axis` registra "as quatro clusters humanas
`extraction_*`". **Quatro componentes não ocupam cinco bandas.** Nenhum reordenamento de tempos
conserta isso — e a correção que o codex propôs ("atribuir tempos a componentes inteiros") também não,
porque com quatro componentes não existe atribuição que dê 45/5/10/20/20 por classe.

**O que eu decidi e fiz:** `assign_partitions` passou a **recusar** — `UnsplittableCorpus` — quando
qualquer valor de eixo de `V3_GROUP_AXES` atravessa blocos, nomeando o eixo, o valor e os blocos. Isso
troca sucesso nominal por recusa explícita, que é a disciplina fail-closed deste projeto, e é
decidível sem depender do garfo abaixo. Teste com recusa **e controle positivo** (o mesmo lote num
único bloco é aceito), porque a suíte Python passou verde com a guarda recém-escrita — ou seja, ela
nasceu sem nada que a exercitasse, o mesmo defeito que eu vinha consertando do outro lado.

**O que NÃO é meu, e vai ao operador como garfo de três dentes.** Para a metade humana existir num
split de cinco partições, uma destas tem de ceder:

1. **muitos mais lotes de extração** — coleta passa a rodar em execuções incrementais em vez de quatro
   pools monolíticos. É mudança de coleta, e coleta é do operador;
2. **`collectionBatch` deixa de ser eixo de conectividade para registros humanos** — mas o eixo existe
   justamente para impedir vazamento entre linhas coletadas juntas, então isso enfraquece a alegação
   de independência que o projeto publica;
3. **a exigência de proporção por classe muda** — e ela é pré-registrada.

Nenhuma das três é escolha de implementação: a 1 é coleta, a 2 é invariante científica, a 3 é
pré-registro. Registrado como garfo aberto, com a medição, em vez de eu escolher em silêncio.

**Dois testes existentes tiveram de ficar mais fortes, e o motivo vale registro.** Ao mover a guarda
independente do dataset para o início, ela passou a recusar antes de dois testes alcançarem a
propriedade que eles nomeiam. Consertar a expectativa seria maquiar: os dois foram **reescritos para
isolar a própria propriedade**. O de `datasetDigest` agora **re-sela** (editar o digest e deixar os
selos velhos é pego por auto-consistência, que nada diz sobre o artefato descrever ESTE dataset); e o
da seed publicada duas vezes agora forja a cópia **de topo**, deixando `policy.seed` na autoridade, de
modo que a autoridade passa e só resta a divergência entre as duas cópias — das quais apenas a de
dentro da política está sob `algorithmDigest`.

### Rodada 7 do cross-review do E2 — REJEITADA, e três achados eram nas guardas que eu escrevi para fechar a rodada 6 (2026-08-01)

Veredito **(c) rejeitar**: um P1, três P2 e o grupo de padrões. **O P1 e dois dos P2 são defeitos que
eu introduzi consertando a rodada anterior** — a lição de método está no fim.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a minha guarda Python não implementava a conectividade do splitter, e errava nas DUAS direções.** Ela tratava todo `V3_GROUP_AXES` como eixo de valor compartilhado. Medido por ele: dois registros compartilhando `generatorFamily` entre `train` e `test` eram **RECUSADOS**, embora esse eixo seja deliberadamente não conectivo (unir por ele colapsaria uma família inteira); e pai em `train` com filho em `test` via `humanSeed` era **ACEITO**, embora o splitter os una | a guarda passou a reproduzir `connectedComponentRoots`: union-find, valor compartilhado só em `GROUP_KEYS`, referência id→pai em `PARENT_LINKAGE_AXES` (só quando a linha nomeada está presente), e fechamento transitivo. Sete testes: eixo não conectivo ACEITO, pai→filho recusado, pai ausente não une, cadeia transitiva recusada, valor compartilhado atravessando recusado, controle positivo, e **espelho que fixa as duas listas contra `split.ts`** — que é como este repositório já impede deriva de cópia |
| 2 | **P2 — `key in allowed` era burlável pela cadeia de protótipo:** `in` caminha o protótipo, então `__proto__` e `constructor` liam como permitidos. Medido: artefato com chave raiz enumerável `__proto__` voltou **ACCEPTED** da própria guarda parcial | `Object.hasOwn`. Dois testes com JSON **realmente parseado** — em literal, `__proto__` define protótipo em vez de criar chave, então a forja só existe em arquivo lido, que é como todo comando carrega o artefato |
| 3 | **P2 — `String(attestation)` aceitava array:** `String(["<64 hex>"])` **é** aquela string. Medido: `compositionAttestation: ["aaa…"]` re-selado voltou ACCEPTED | `typeof attestation === "string" && SHA256_HEX.test(attestation)`, com teste de array |
| 4 | **P2 — o mesmo padrão em outras três fronteiras de parsing:** `cluster-exposure-ledger.ts` (duas) e as cópias de manifesto em `candidate-preflight.ts`/`calibration-pipeline.ts` copiavam chave parseada para `{}`. Atribuir a `__proto__` troca o protótipo em vez de criar chave, então a chave desconhecida **desaparece** antes de poder ser recusada e o digest é calculado sobre objeto sem ela | `Object.create(null)` nos quatro acumuladores |
| padrões | rótulos de etapa e narrativa de histórico sobrevivendo | ver abaixo: escopo medido em vez de amostrado |

**O que a rodada 7 CONFIRMOU, e vale mais que os consertos:** a conclusão dos quatro componentes
humanos está certa, apesar de a guarda estar errada — `collectionBatch` pertence a `GROUP_KEYS`, os
quatro pools produzem no máximo quatro componentes, e ele acrescentou o detalhe que fecha o argumento:
**a menor fração permitida é 3%** (o alvo de `dev` é 5%, tolerância dois pontos), logo as cinco
partições exigem presença humana em todas. Quatro componentes não bastam. O garfo do operador segue
como registrado na rodada 6.

**Padrões, com o escopo medido em vez de amostrado.** Ele citou exemplos e afirmou que "os comentários
foram saneados" não correspondia ao diff — correto. Contei: são ~180 ocorrências de rótulo de etapa
(`C2`/`C3`/`C4`/`D0b`/`E3`/`G1`/`G2`/`R5`/`R6`/`R7`/`A3`/`A7`) ou de "used to" em 29 arquivos tocados.
Mas nas **linhas que esta unidade ADICIONOU** eram **26**, e dessas apenas **quatro** em comentário de
código — as outras 22 estão em documentos, onde rótulo de etapa é legítimo, porque é exatamente ali que
história e decisão devem viver. Os quatro (mais dois que a primeira passada errou de arquivo) foram
reescritos, e a medição fecha em **zero**. **Achado aberto, e é repo-wide, não do E2:** as ~150
restantes vivem em arquivos que esta unidade quase não tocou (`cluster-exposure-ledger.ts` com 32,
`assemble_corpus.py` com 22, `group_axes.py` com 14, `calibration-pipeline.ts` com 15). Saneá-las é
limpeza de repositório, não desta unidade, e transformá-la em parte do E2 inflaria o diff sem relação
com a migração.

**A lição de método, porque é a terceira vez que ela aparece com outra roupa.** Três dos quatro
achados desta rodada são de guardas que eu ESCREVI na rodada anterior, e as três falharam do mesmo
jeito: eu implementei a **intenção** da guarda e não o **contrato** que ela precisava espelhar. A
guarda Python espelhava "eixos de grupo" quando o splitter tem duas relações distintas; a de chaves
usou `in` quando precisava de propriedade própria; a de forma usou coerção quando precisava de tipo.
Em todos os casos existia uma autoridade a consultar — `connectedComponentRoots`, a semântica de `in`,
`typeof` — e eu escrevi de memória. **Regra: guarda que espelha comportamento de outro módulo é
escrita LENDO aquele módulo, e o espelho é fixado por teste.** Foi o que o pino contra `split.ts`
passou a fazer no lado Python.

### Rodada 8 do cross-review do E2 — REJEITADA, e o P1 corrigiu a MINHA inferência (2026-08-01)

Veredito **(c) rejeitar**: um P1 e três P2. **O P1 e um dos P2 são defeitos que eu introduzi
consertando a rodada 7** — é a terceira rodada seguida em que o pior achado é de guarda minha.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a minha guarda Python era FORTE DEMAIS: falso negativo estrutural.** Ela recusava qualquer componente presente em dois carimbos, mas atravessar não implica corpus inviável. Ele reproduziu com corpus sintético válido, serializado e revalidado por `parseBenchmarkDataset`: unindo um humano de `train` a um de `dev`, o splitter canônico produziu humano `1801/199/400/800/800`, mixed `901/99/200/400/400`, e `auditBlockedSplit` voltou `passed=true, reasons=[]` — `dev` em 4,975% e 4,95%, legal. **E os sete testes passavam porque fixavam a inferência errada** | a guarda passou a checar o CONTRATO: simula o colapso (componente unânime fica no seu bloco, componente que atravessa cai em `train`, que é o fallback do splitter) e compara as **frações realizadas** contra o alvo dentro de `CLASS_TOLERANCE`. Nove testes, e o central é o caso dele: **componente atravessando com frações legais é ACEITO**. `CLASS_TOLERANCE` entrou como espelho fixado contra `split.ts` |
| 2 | **P2 — `Object.create(null)` fez o preflight violar o próprio contrato fail-soft.** Preservado o `__proto__`, `canonicalDigest` **lança** `CanonicalJsonError`, e `runCandidatePreflight` passou a estourar em vez de devolver `status: "blocked"` | canonicalização em `try/catch` → `blockingReasons`. A gêmea de `calibration-pipeline.ts` é fail-closed, então recusar está certo; o que mudou é carregar o erro CODIFICADO do módulo em vez de vazar exceção do serializador |
| 3 | **P2 — a guarda parcial promovia formas JSON inválidas ao mundo tipado.** Validava conjuntos de chaves e nenhum TIPO de valor: sonda com todos os digests recalculados foi aceita com `assignment.id` numérico, frações como strings e cutoffs como strings — e esses valores chegam ao resumo público | validação de tipo na fronteira independente do dataset: id string não vazia, frações finitas em [0,1], cutoffs finitos, contagens finitas não negativas. **A ordem importa e custou uma iteração:** tipo tem de vir DEPOIS do vocabulário, senão artefato com nomes de partição antigos é recusado por "não é número" em vez de por vocabulário |
| 4 | **P2 — dois comentários que eu escrevi eram FALSOS.** O do espelho Python afirmava que o teste impediria uma "terceira relação" futura, e ele só compara as duas listas atuais. O de `cluster-exposure-ledger.ts:2475` dizia que a chave vem de arquivo parseado, mas o laço percorre `V3_GROUP_AXES`, lista fixa — apliquei o mesmo comentário nas duas ocorrências sem conferir a segunda | o primeiro passou a dizer o que o teste faz; no segundo, o `Object.create(null)` injustificado voltou a `{}` e o comentário saiu |

**E a minha medição de "zero comentários adicionados" estava errada por escopo, não por contagem.** Eu
grepei os rótulos de etapa e o "used to" que ELE havia citado, e concluí zero. Mas a regra é mais
ampla: sobraram "KNOWN DEFECT, deliberately not fixed here" e "whoever touches" em `fit.ts`, "operator
step / Vitest / Playwright" em `score.ts`, "A test pins…" em dois lugares, e narrativa de comportamento
anteriormente aceito em três pontos de `split-artifact.ts`. **A lição é sobre a medição:** eu respondi
uma pergunta mais estreita que a que afirmei ter respondido. Uma contagem só sustenta a afirmação
quando o predicado da contagem é o predicado da regra.

**E o conserto do achado 3 rendeu um achado meu, do mesmo tipo que eu venho consertando nos outros.**
Ao escrever as forjas de tipo, três delas foram recusadas por OUTRA guarda antes de chegarem ao tipo:
cutoff-string trombava na concordância `cutoffs × audit.cutoffs`, e contagem-string trombava na
comparação contra a tally das atribuições — nas DUAS cópias, `counts` e `audit.sizes`. Isso significa
que as minhas checagens de tipo para contagem eram **inalcançáveis**: nenhum valor não-numérico pode
igualar uma tally. Removi as duas e registrei o motivo no código, porque guarda que nenhuma entrada
alcança é exactamente o defeito que eu passei oito rodadas apontando. Sobraram as três que a forja de
fato exercita — id, fração e cutoff (nas duas cópias, para isolar o tipo da concordância).

**O que ele confirmou:** as duas relações estão espelhadas corretamente, `generatorFamily` não conecta,
referência a pai ausente não une, o fechamento transitivo está certo, `Object.hasOwn` e o `typeof`
antes do regex estão certos isoladamente, e o corte das ~150 ocorrências pré-existentes como dívida
repo-wide é razoável. **O garfo do operador continua real** — quatro componentes humanos não ocupam
cinco partições quando todas exigem presença humana. O P1 mostra apenas que **nem todo straddle é
inviável**, o que é uma correção da minha inferência e não do garfo.

**O padrão que se repete há três rodadas, agora nomeado com precisão.** Rodada 7: implementei a
intenção da guarda em vez do contrato que ela espelha. Rodada 8: implementei a minha **inferência sobre
o contrato** em vez do contrato — "atravessa ⇒ frações colapsam" é uma dedução minha, e o contrato diz
apenas "frações realizadas dentro de ±0,02". A diferença entre as duas é onde moraram os dois piores
achados. **Regra: guarda que decide por um critério enuncia o critério do contrato, nunca uma condição
suficiente que eu deduzi dele** — e o teste tem de conter um caso que a condição deduzida recusaria e o
contrato aceita, que é exactamente o teste que faltava.

### Varredura de mutação em sete módulos, em worktrees isolados (2026-08-02)

Sete agentes, um por módulo, **cada um em worktree próprio** — o único uso de paralelismo que a regra
de concorrência desta sessão admite, porque a auditoria muta fontes e agentes na mesma árvore veriam as
mutações uns dos outros. Isolamento **verificado durante a corrida**, não assumido: 8 worktrees ativos,
24 processos, e a minha árvore em zero arquivos modificados. É o conserto da falha da rodada 5, onde eu
soube do estrago pelo veredito.

O mandato exigiu, por agente, as três coisas que me custaram erro nesta sessão: descobrir o idioma de
lançamento (tudo "NÃO-MUTÁVEL" é zero informação, não zero lacuna), descobrir as suítes por `grep` em
vez de adivinhar, e **duas medições por lacuna** — auditoria mais `grep` do código em todo
`benchmark/tests/`. O agregador descartou o que não passou pelas duas.

**Resultado: zero "sem medição", zero agentes com erro, e 31 lacunas corroboradas.**

| módulo | exercitadas | lacunas corroboradas |
|---|---|---|
| `cluster-exposure-ledger.ts` | 17 | **10** |
| `commands/evaluate.ts` | 2 | **8** |
| `commands/publish-evidence.ts` | 2 | **5** |
| `corpus-import.ts` | 2 | **3** (uma quarta caiu na corroboração) |
| `cross-validation.ts` | 2 | **3** |
| `corpus-source-audit.ts` | 10 | **1** |
| `dataset-manifest.ts` | 9 | **0** |

**O que eu VERIFIQUEI por leitura própria, porque relatório de agente não é medição.** Duas alegações
do `cluster-exposure-ledger.ts`, e as duas se confirmam:

1. **A cadeia do ledger fecha contra o digest DECLARADO, não contra um recálculo:**
   `const expected = index === 0 ? null : events[index - 1].eventDigest`. Logo o único lugar que amarra
   o CONTEÚDO de um evento ao seu digest é `computeEventDigest(event) !== event.eventDigest` em
   `validateEventShape` — e **nenhum teste mencionava esse código**. Consequência concreta: esvaziar os
   `records` de um evento `holdout-consumed` sem tocar o `eventDigest` declarado mantém a cadeia fechada
   e a testemunha do keyring citando a mesma cauda, e o índice passaria a ver zero unidades queimadas —
   tudo que o `test` consumiu voltaria elegível.
2. **A regressão de `CLUSTER_LEDGER_LOCKED` seria DESTRUTIVA, não permissiva.** Sem a guarda, o
   `EEXIST` cai adiante, `handle` fica `undefined`, `handle.close()` estoura, e o `finally` executa
   `rm(lockPath, { force: true })` — apagando o lock da transação em andamento. A maioria das lacunas de
   teste arrisca "entrada inválida aceita"; esta arrisca duas transações intercalando escrita num
   arquivo append-only.

**FECHADO agora, o de maior consequência:** teste para a amarração conteúdo↔digest, com forja competente
— esvazia `records` e **preserva** o `eventDigest` declarado, de modo que a cadeia continua íntegra e só
a checagem de conteúdo pode recusar. **Provado por mutação:** com a guarda desligada, apenas esse teste
falha; os outros 61 do arquivo passam, o que prova que ele alcança a guarda e que nada mais a cobria.

**Ordem para o resto, por consequência e não por contagem:**

### As dívidas restantes, medidas em vez de estimadas

**`artifactWithoutDigest` não exportado — RETIRADA.** Eu a listei porque re-selar o artefato
congelado parecia exigir aquele helper. Não exige: o teste do Chrome em `consume-holdout.test.ts`
forja o artefato pelo JSON — apaga `artifactDigest`, substitui o campo e re-sela com
`canonicalSha256` sobre o resto. A dívida estava paga por um teste que eu mesmo escrevi nesta
sessão, e continuar listando-a seria inventário desatualizado.

**`TRAIN_MISSING_LABEL` — buscada, não achada, e não declarada inalcançável.** A leitura do
empacotador dá o argumento: para um átomo de classe pura o custo é
`peso_da_classe × acumulado_daquela_classe_na_dobra`, então o guloso põe cada um onde há MENOS
daquela classe, o que os espalha. Mas o fechamento depende de uma propriedade ao longo de uma
SEQUÊNCIA de colocações, e `bestFoldIndex` declara que otimalidade global não é reivindicada — ao
contrário das duas guardas que eu declarei inalcançáveis, onde um invariante anterior fecha o caminho
em uma linha.

Então mediu-se. Busca **exaustiva num espaço declarado**: N átomos de `FOLDS` a `FOLDS+3`, cada um
puro-positivo, puro-negativo ou misto, exigindo cada classe em ao menos `FOLDS` átomos para que a
recusa não venha de `CLASS_CLUSTERS_BELOW_FOLDS`. Resultado, com os números fixados no teste em vez
de piso:

- **3800** populações admissíveis, **3800 aceitas**, nenhuma recusada por guarda alguma;
- **zero** testemunhas de `TRAIN_MISSING_LABEL`.

**E um controle positivo, porque sem ele o resultado não valeria nada.** Um arnês que nunca capturou
recusa alguma não demonstrou que VERIA uma testemunha. O teste passa uma população deliberadamente
inadmissível pelo MESMO caminho de captura e exige que o código dela chegue ao mapa. Foi o furo que
a sonda revelou: eu ia registrar "zero testemunhas em 3800 populações" sem ter provado que o detector
detecta.

Conclusão registrada com a força que tem: **evidência, não prova.** A guarda fica, e o que mudou é
que agora existe um espaço medido em vez de uma impressão.

**Aridade fixa da busca de cortes** segue nomeada e intocada — não é lacuna de teste, é limite de
desenho: a busca tem quatro cortes porque o desenho tem cinco partições, e generalizar é outra
unidade.

**Nota sobre a guarda do fecho transitivo:** ela já abortou **quatro** medições minhas por suíte de
fora, a última na própria auditoria de `commands/split.ts`, que exigia `split-audit.test.ts` e
`cluster-exposure-ledger.test.ts`. Quatro achados falsos evitados é o que ela custou de tempo.

### Dívida fechada: `SPLIT_AUDIT_FAILED`, e a armadilha estava na conectividade

A última guarda sem teste de `commands/split.ts`. Ela exige a combinação que nenhum outro teste
produz — splitter com SUCESSO e auditoria reprovando — e a construção estava escrita: um componente
que atravessa o último corte cai em `train` levando tempo da banda de teste, e
`earliest(test) > latest(train)` falha.

**Duas correções de atribuição, ambas minhas.** A tabela dizia que a dívida era de
`split-artifact.ts`; a guarda vive em `commands/split.ts:163`. E o custo que eu havia registrado
("mexer no gerador de 10k linhas") era menor do que parecia: bastou uma opção no gerador do
fixture, porque a suíte já dirige `runSplit` no caminho de integração.

**O que quase fez o teste provar outra coisa.** A primeira tentativa mudou o lote do PRIMEIRO
humano do bloco de teste, e o splitter recusou antes por proporção — `human test 0.000`,
`train 0.650`. O bloco inteiro havia sido absorvido: aquele humano é pai de um registro `mixed`, o
filho compartilha `mixedBatch` com todos os outros `mixed` do bloco, esses apontam para os demais
humanos, e o fecho transitivo fundiu teste com treino.

O atravessador tem de ser um humano SEM filho. Os pais são `humanIds[n % humanIds.length]` para n
em [0, mixed), então o primeiro sem filho é o índice `mixed`. Com ele, um único registro muda de
componente, a proporção se mantém, o splitter não vê nada e a auditoria recusa — que é exatamente o
estado que a guarda existe para pegar.

A lição é a mesma que a medição de conectividade deu hoje: **em corpo com fecho transitivo, mexer
em um registro raramente mexe em um registro.**

### Decisão: a unidade nova começa pelo estrato, não pelo lote

**Decido e registro** (classe do agente; o operador ratifica no marco): a ordem dos passos da metade
em código da F1-5q muda, e `collectionBatch` é PARTIDO em vez de acompanhado.

A razão é medida, não argumentada — `benchmark/lab/test_connectivity_feasibility.py`, com o código
de produção:

- `domainSource` está em `GROUP_KEYS` e une por valor compartilhado, então todo registro de um
  domínio cai num único componente. Quatro domínios ⇒ quatro componentes de 25% do corpo.
- O splitter do E2 coloca componente inteiro numa só partição, e a menor do desenho de cinco é 5%.
  Logo o maior componente é **limite superior de viabilidade**, e 25% não cabe em 5%.
- Cinco lotes por domínio produzem os MESMOS quatro componentes: o lote não compra viabilidade
  enquanto o estrato unir. A contraprova, no mesmo arquivo, dá vinte componentes de 5% com o estrato
  fora do agrupamento.

Portanto o item que sustenta a viabilidade é a saída do `domainSource` do `GROUP_KEYS` — o que
estava marcado como "depende da ratificação" e listado em segundo lugar. Enquanto ele não sai, os
outros passos são reorganização de nome.

**O que NÃO faço agora, e por quê.** Não mexo em `GROUP_KEYS`. Aquele contrato de conectividade é a
peça central do E2, que está commitado e com rodada 13 de revisão adversarial pendente por cota até
8 de agosto. Mudá-lo agora faria a rodada 13 revisar outra árvore que não a declarada. A mudança
pertence à nova pré-inscrição, e o teste de estado que acompanha a medição falha no dia em que ela
for feita — a falha é o sinal, não um defeito.

**Erro meu na primeira medição, registrado porque quase virou achado publicado:** dei a mesma
`source` a todas as linhas sintéticas e obtive "um componente só". `source` é o DOCUMENTO de origem
(o prefixo `th_` do corpo real é de thread), um por registro. O resultado certo aparece quando o
modelo sintético respeita isso — e o motivo do colapso é outro eixo.

### A varredura fechou NOS DEZ MÓDULOS QUE A VARREDURA ANTERIOR APONTOU — e não no repositório

| módulo | resultado final | o que resta, nomeado |
| --- | --- | --- |
| `split-artifact.ts` | fechado | — |
| `commands/split.ts` | **fechado, agora inteiro** | aridade fixa da busca de cortes |
| `holdout-ledger.ts` | fechado | — (2 achados falsos retratados) |
| `commands/publish-evidence.ts` | **8 / 0** | — |
| `commands/verify-published-evidence.ts` | **8 / 1** | `PROFILE_DIGESTS_MISMATCH`, inalcançável com prova |
| `commands/evaluate.ts` | **12 / 1** | `PREDICTION_UNKNOWN_ID`, inalcançável com prova |
| `corpus-import.ts` | **6 / 0** | 8 códigos que são motivos de rejeição, não guardas |
| `cluster-exposure-ledger.ts` | **27 / 0** | `EEXIST`/`ENOENT`, que são errno em `catch` |
| `cross-validation.ts` | `EMPTY_POPULATION` fechada | `TRAIN_MISSING_LABEL` e `FOLD_HALF_EMPTY`, invariante interna |
| `corpus-source-audit.ts` | nunca foi lacuna | — |

Nenhuma linha desta tabela diz "não medido".

**RETRATAÇÃO DE ESCOPO, escrita no dia seguinte à tabela acima.** Eu declarei "a varredura fechou" e,
pouco depois, que "o trabalho não bloqueado acabou". As duas afirmações valem para os dez módulos que
uma varredura anterior apontou, e eu as escrevi como se valessem para o repositório. Medindo a
superfície inteira — códigos que aparecem em posição de LANÇAMENTO, `throw new X("CODIGO"` ou
`fail("CODIGO"` — o quadro é outro:

- **25 módulos** de `benchmark/` têm guarda lançada;
- **9 estão auditados** (o décimo, `corpus-source-audit.ts`, tem um único `throw` com código
  variável, e por isso não aparece nessa contagem);
- **16 módulos com 70 códigos nunca foram medidos**, entre eles `dataset-manifest.ts` (9),
  `browser-scorer.ts` (8), `prediction-shards.ts` (6), `commands/verify-evidence.ts` (6),
  `commands/validate-predictions.ts` (6), `source-manifest.ts` (5) e `commands/fit.ts` (5).

**Triagem por menção nos 16, para ordenar o trabalho:** **51 dos 70** códigos não são citados por
teste algum. Os maiores blocos são `dataset-manifest.ts` (9 de 9), `prediction-shards.ts` (5 de 6),
`commands/verify-evidence.ts` (5 de 6), `commands/validate-predictions.ts` (5 de 6) e
`generator-family.ts` (4 de 4).

**E a triagem tem viés declarado, na direção oposta à que eu já havia registrado.** Antes eu escrevi
que "menção não prova exercício"; aqui aparece o outro lado: **ausência de menção não prova ausência
de teste** quando a suíte afirma MENSAGEM em vez de código. `dataset-manifest.ts` é validado em várias
suítes e ainda assim dá 9 de 9 sem menção — o mais provável é que ali se asserte a mensagem. Só a
auditoria por mutação decide, e é ela que vai rodar; a triagem serve para ordenar, não para concluir.

**PRECISÃO da triagem, medida no primeiro módulo.** `dataset-manifest.ts` tinha **9 de 9 sem
menção**, e a auditoria por mutação com as 21 suítes do fecho mediu **8 exercitadas e 1 sem teste** —
só `DATASET_DUPLICATE`. A triagem previu nove lacunas e havia uma. O viés que eu declarei antes de
rodar se confirmou na proporção: aquelas suítes afirmam MENSAGEM em vez de código.

Isso recalibra o resto do trabalho: **os 51 códigos sem menção não são 51 lacunas**, e tratar a
triagem como resultado teria produzido o maior achado falso desta sessão. A ordem de trabalho
continua a da triagem; a conclusão, só a da mutação.

### Defeito 1 da v1.0 corrigido: o teto `indicator` passou a ser estrutural

O primeiro dos três defeitos que a seção 5 do plano nomeia. A citação do plano estava **correta**, e
a leitura do código acrescentou a nuance que decide como consertar:

- `decideExperimentalUncalibrated` devolvia `actionCeiling: shortText ? "indicator" : "hide"`;
- existe um `capToIndicator` com o comentário certo, mas ele é aplicado **só** no ramo
  `calibrateResult`. O ramo do preview experimental não passava por ele;
- o caminho é tomado quando o usuário opta pelo preview e não há calibração — então a promessa de
  `docs/model-validation.md` ("um classificador não calibrado **nunca** desfoca, recolhe ou oculta um
  post") era violada para quem opta.

**Um conflito de intenções declaradas, não um descuido.** O teste em
`tests/integration/inference-pipeline.test.ts` **exigia** `hide`, e o comentário dele dizia por quê:
"reaching the `hide` ceiling so the user's presentationMode governs blur/collapse/hide". Era desenho
escrito, contradizendo o documento. O escopo da v1.0 é a autoridade e resolve a favor da promessa.

**A forma do conserto é o que o plano pede — estrutural, não copy.** O tipo de retorno da função
passou a pinar `actionCeiling: "indicator"`, então reintroduzir `hide` naquele caminho é **erro de
compilação**, e não algo que um teto posterior precise lembrar de corrigir. O teste passou a afirmar
`indicator`, com a mudança e o motivo escritos nele.

**Dívida de processo minha, encontrada aqui:** eu havia commitado `contract-guards.test.ts` rodando
typecheck e vitest mas **não** lint, e ele carregava três erros — o idioma de descartar por
desestruturação (`const { x: _descarte, ...resto }`) não passa na regra do repositório. Consertado com
o idioma que o resto do arquivo já usava (`delete` sobre a cópia), e o lint voltou aos 13 problemas
pré-existentes. A lição: verde de typecheck e de suíte não é verde de lint, e eu tratei os três como
um só.

### A decisão de deixar `src/` fora merece revisão, e a evidência é do meu próprio trabalho

Eu declarei `src/` fora do escopo da varredura com este argumento: 47 códigos de runtime de extensão,
onde "um defeito é bug de produto e não medição científica que passa verde estando errada".

**CORREÇÃO da justificativa, escrita no mesmo dia.** Eu argumentei que o defeito 1 refutava a
exclusão de `src/`. Refuta o argumento de PRIORIDADE, mas não serve como razão para a varredura por
mutação, e a diferença importa: aquela ferramenta muta `fail("CODIGO")` e `throw new X("CODIGO")`, e o
defeito 1 era um **valor** (`actionCeiling: shortText ? "indicator" : "hide"`), não uma recusa
codificada. **A auditoria não o teria encontrado.** A lição do defeito 1 é sobre deriva entre promessa
escrita e código — que pede outro tipo de verificação, não esta.

**Refeita com o lançador certo, a medição de `src/inference/model-bundle.ts` dá 3 exercitadas e
8 SEM TESTE:** `BUNDLE_VERIFIED_WITH_PROFILES`, `CALIBRATION_SET_MISMATCH`, `DUPLICATE_PROFILE`,
`MANIFEST_SCHEMA_INVALID`, `PROFILE_IDENTITY_MISMATCH`, `PROFILE_SET_MISMATCH`,
`ROLLOUT_WITHOUT_PROFILES`, `SOURCE_LOCK_INVALID`.

São todas do bloco que amarra o pacote embarcado ao seu **source lock** e ao **release** — as guardas
que garantem que a extensão executa o modelo que ela diz executar. Um pacote cujos artefatos não
batem com o lock é falha de integridade de cadeia, não bug de apresentação, e nenhuma das oito tem
teste que prenda a recusa.

### Parada explícita da sessão, e por quê

O batimento foi **desarmado de propósito** (35 pulsos). Não foi falta de trabalho: as oito guardas de
integridade estão mapeadas e disponíveis. Foi falta de capacidade de fazê-las COM VERIFICAÇÃO nesta
sessão — escrever oito testes sem contexto para levá-los ao verde produziria exatamente o tipo de
afirmação não medida que esta sessão passou corrigindo, e a regra que vale aqui é a das duas medições
ou nenhuma alegação.

Pela regra registrada, parar é ato explícito e não deriva. Fica então dito: nada em execução, árvore
limpa, e o próximo passo é o mapa acima — direto, sem redescobrir.

**O que esta sessão corrigiu de mim, para o próximo que ler:** duas retratações de escopo (dez módulos
relatados como se fossem o repositório; dois módulos perdidos entre lotes), uma justificativa errada
(o defeito 1 não sustenta a varredura por mutação, porque era um VALOR e não uma recusa codificada),
uma medição nula por lançador errado, e três invocações montadas sobre saída truncada. Todas
encontradas por medir de novo, nenhuma por lembrar melhor.

> **⚠️ ESTE MAPA FOI REFUTADO EM CINCO PONTOS pela etapa 1 de 2026-08-02.** Fica legível e não
> editado — medição registrada não se corrige em silêncio —, mas **não o siga**: ver
> § "As oito guardas de integridade do pacote, e o mapa que estava errado" abaixo. Ele foi escrito de
> LEITURA e não de execução, e a frase de abertura contradiz a própria tabela dele.

**O mapa de mutações das oito, levantado para que a implementação não precise redescobri-lo.** Todas
passam por `crossValidateRuntimeDescriptor`, que é exportada, e o arnês de
`tests/unit/inference/model-bundle.test.ts` já tem `validSources()` — um clone dos quatro artefatos
embarcados. Cada teste muda UMA coisa:

| guarda | mutação |
|---|---|
| `BUNDLE_VERIFIED_WITH_PROFILES` | `release.rolloutState = "bundle-verified"` com perfis não vazios |
| `ROLLOUT_WITHOUT_PROFILES` | release promovido com `profiles.profiles = []` |
| `DUPLICATE_PROFILE` | dois perfis com o mesmo digest de arquivo |
| `PROFILE_SET_MISMATCH` | `release.profileDigests` diferente do conjunto do arquivo |
| `CALIBRATION_SET_MISMATCH` | `release.calibrationSetDigest` fora do digest canônico da lista |
| `PROFILE_IDENTITY_MISMATCH` | um campo de identidade do perfil diferente do manifesto |
| `MANIFEST_SCHEMA_INVALID` | manifesto malformado (`runtimeManifestInvalid`, helper em `:556`) |
| `SOURCE_LOCK_INVALID` | source lock malformado (`sourceLockInvalid`, helper em `:563`) |

Duas cautelas que a sessão inteira ensinou e que valem aqui: um teste do descritor VÁLIDO passando
antes de cada forja, senão a recusa pode ser do artefato; e uma mutação por teste, senão fica ambíguo
qual guarda recusou.

Isso responde, com medição, a pergunta de escopo que eu tinha errado nas duas direções: `src/` não é
"só risco de produto". A primeira coisa medida ali é uma amarra de integridade.

**Primeira medição de `src/`, e ela saiu NULA — registrada como nula.** `src/inference/model-bundle.ts`
(12 códigos, fecho de 15 suítes) voltou com **zero mutável**: a detecção automática de lançador do meu
lote escolheu `fail`, e aquele módulo usa `throw new RuntimeDescriptorError("CODIGO", ...)`. A
ferramenta reportou zero-mutável em vez de fingir medição — que é o comportamento que ela deve ter —,
mas a INVOCAÇÃO estava errada e o resultado não vale.

Duas coisas para a próxima sessão, escritas para não serem redescobertas:

1. o lançador de `src/` é uma CLASSE de erro codificado por módulo (`RuntimeDescriptorError` em
   `model-bundle.ts`), não o helper `fail`. A detecção por contagem de `fail(` contra `throw new` erra
   aqui, e o lote precisa passar a classe explicitamente;
2. **ler saída truncada e agir sobre ela** me custou uma rodada inteira: montei a primeira invocação
   sobre um fecho cortado por `head -12` quando ele tinha 15 suítes. O fecho passou a ser computado e
   repassado por variável, sem eu olhar no meio. É a mesma família do `$?` depois de um pipe.

A razão que sustenta a varredura de `src/` é mais simples e sobrevive: são **47 guardas codificadas
nunca medidas**, e a ferramenta agora as alcança. Nada além disso.

**O argumento original, que fica registrado como parcialmente errado:** **O defeito 1 da v1.0 refuta o argumento.** Era uma guarda de runtime em `src/inference/` —
o teto `indicator` — que, sem teste que a prendesse, deixou o produto poder OCULTAR posts contra uma
promessa pública escrita em `docs/model-validation.md`. E havia um teste que fixava o comportamento
violador. É o mesmo mecanismo da varredura (guarda cuja recusa ninguém exercita), com consequência de
outra natureza: quebra de promessa ao usuário em vez de medição corrompida.

Então a prioridade de `src/` não é "menor", é **diferente** — e a distinção que eu usei para excluí-lo
não se sustenta como escrita.

**Um limite de ferramenta a resolver antes:** o fecho transitivo de `auditoria-mutacao.py` varre
`benchmark/tests/`. Os testes de `src/` vivem em `tests/unit/` e `tests/integration/`, então hoje a
ferramenta apontaria zero suítes e pularia todo módulo de `src/` — silenciosamente, o que é
exatamente o balde de erro que ela já foi endurecida seis vezes para não ter. Estender a busca de
suítes é pré-requisito, não detalhe.

Fica como unidade nomeada, com a ordem sugerida por consequência: os módulos que **fazem cumprir
promessa** primeiro (`inference-worker`, `runtime-activation`, `model-catalog`,
`calibration-registry`), não os de maior contagem.

### `contracts/` FECHADO, e a superfície selada está medida inteira

Os quatro módulos de contrato saíram de **1 guarda exercitada** para **todas**, em
`benchmark/tests/contract-guards.test.ts`: 15 em `calibration-profile.ts`, 4 em
`model-release.ts`, 3 em `runtime-parity.ts`, 4 em `source-readiness.ts`.

**Três correções que só a execução deu, e as três do mesmo tipo — eu inventei estrutura que o
contrato não tem:**

1. o invariante de política que eu visei vive DENTRO de `decision === "indicator-only"`, e eu partia
   do fixture `pass`, onde o bloco é pulado inteiro: a recusa vinha do digest e provaria outra
   guarda. Com o perfil `indicator-only`, uma mudança só basta;
2. o calibrador isotônico exige forma completa (`clamp: true` literal, dois knots) para que a recusa
   seja por MONOTONICIDADE e não por forma malformada;
3. a razão de bloqueio admite `code`, `recordId` e `sourceId` — e mais nada. Eu escrevi `detail`, e o
   parser recusou por chave desconhecida: teria provado a guarda de FORMA em vez da de ESTADO.

**Dois controles positivos que pagaram o próprio custo.** Cada bloco afirma que o artefato intocado
PASSA antes de qualquer forja. O de prontidão de fontes recusou o artefato que devia ser válido e
revelou que o fixture carrega `reportDigest` de fachada — sem ele o teste passaria pelo motivo
errado, porque o código da recusa é o MESMO para "fixture inválido" e "guarda funcionando".

**Estado final da superfície selada:**

| superfície | estado |
| --- | --- |
| `benchmark/` (25 módulos) | medida e fechada |
| `contracts/` (4 módulos) | medida e fechada |
| `src/` (47 códigos) | **fora por decisão declarada** — risco de produto, não de medição |

O que resta tem razão escrita, e nada foi silenciado: duas guardas **inalcançáveis com prova de uma
linha** (`PREDICTION_UNKNOWN_ID`, `PROFILE_DIGESTS_MISMATCH`), quatro **invariantes internas nomeadas
sem prova** (`FOLD_HALF_EMPTY`, `TRAIN_MISSING_LABEL` — buscada em 3800 populações com controle
positivo —, `FIT_CLUSTER_MISSING`, `SCORE_MISSING_RECORD`) e a **aridade fixa da busca de cortes**,
que é limite de desenho e não teste que falta.

### `contracts/`: 25 guardas sem teste, e é o maior achado da varredura

Depois de fechar `benchmark/` inteiro (25 módulos), enumerei o que ficara fora e achei duas
superfícies: `contracts/` (26 códigos) e `src/` (47). `contracts/` **entra**, e não por simetria: são
os contratos selados de que as afirmações científicas dependem — descritor de release, perfil de
calibração, paridade de runtime, prontidão de fontes — e eu **dependi deles nesta própria sessão**,
ao raciocinar que `actions` seria recusado pelo contrato e por isso usar `shadow` nos testes de
`verify-evidence`.

| módulo | exercitadas / sem teste |
| --- | --- |
| `contracts/calibration-profile.ts` | **0 / 15** |
| `contracts/model-release.ts` | 1 / 3 |
| `contracts/runtime-parity.ts` | **0 / 3** |
| `contracts/source-readiness.ts` | **0 / 4** (mais 10 sem `throw` literal) |

**Uma exercitada em quatro módulos de contrato.** A razão é estrutural e vale registrar: as suítes
atravessam esses parsers a cada teste, sempre pelo caminho VÁLIDO. Parsear artefato bom prova que o
parser aceita; não prova nenhuma das recusas. É a diferença entre cobertura de linha e cobertura de
GUARDA, e é exatamente a distinção que a auditoria por mutação existe para medir.

**A verificação que isso me obrigou a fazer contra mim mesmo:** `RELEASE_STATE_INVALID` aparece sem
teste, e eu raciocinei com ela ao escrever `verify-evidence` — foi por confiar nela que escolhi
`shadow` em vez de `actions`. O raciocínio estava certo (a leitura do contrato o sustenta), mas ele
apoiava-se numa guarda cuja existência eu conferi e cujo funcionamento nenhum teste prendia.

**Ordem de trabalho, por consequência e não por tamanho:** primeiro as quatro amarras de DIGEST e
ESTADO — `PROFILE_DIGEST_MISMATCH`, `RELEASE_STATE_INVALID`, `RUNTIME_PARITY_DIGEST_MISMATCH`,
`SOURCE_READINESS_DIGEST_MISMATCH` —, porque amarra de digest sem teste é o portão forjável que esta
sessão passou fechando em todo o resto. As de campo e esquema vêm depois.

**`src/` fica FORA por decisão declarada**, não por descuido: 47 códigos no runtime da extensão, onde
um defeito é bug de produto e não medição científica que passa verde estando errada. Se o operador
quiser aquela superfície medida, é outra unidade, e o custo é conhecido — ferramenta e método já
existem.

### O lote fechado: 21 das 23 escritas, 2 nomeadas como invariante interna

| módulo | antes | agora |
| --- | --- | --- |
| `commands/verify-evidence.ts` | 0 / 6 | **6 / 6** |
| `commands/validate-predictions.ts` | 0 / 6 | **6 / 6** |
| `profile-artifact.ts` | 0 / 3 | **3 / 3** |
| `commands/consume-holdout.ts` | 2 / 4 | **4 / 4** |
| `commands/fit.ts` | 1 / 5 | **4 / 5** |
| `commands/ingest.ts` | 0 / 1 | **1 / 1** |
| `commands/score.ts` | 0 / 1 | 0 / 1 |

**As duas que sobram são da mesma família, e a razão está escrita no código agora.**
`FIT_CLUSTER_MISSING` e `SCORE_MISSING_RECORD` exigiriam um id de partição sem registro
correspondente — e nos dois casos `validateSplitArtifact` roda ANTES, amarrando cada assignment a
um registro do dataset (em `score.ts`, linha 81 contra linha 90). São asserções de invariante
interna, da família de `FOLD_HALF_EMPTY`. Não declaro prova de inalcançabilidade como fiz nas duas
que tinham prova de uma linha; ficam nomeadas.

**O que a escrita ensinou, e que a leitura não teria dado:**

- o artefato congelado dos fixtures de evidência carrega `artifactDigest` de fachada, porque o
  caminho do pacote nunca o valida e `runVerifyEvidence` é o primeiro consumidor que valida. As sete
  recusas daquele comando falharam todas por auto-digest até o arnês RE-SELAR o artefato;
- `profile-artifact.ts` **não** chama `validateFrozenCalibrationArtifact`, então lá o congelado pode
  ser mexido sem re-selar. A mesma forja tem custo diferente em módulos diferentes, e supor um
  custo único produz teste que prova a guarda vizinha;
- `NaN` só é expressável no caminho em memória: JSON não o carrega. `GATE_EVIDENCE_INCOMPLETE` tem
  estado alcançável porque a entrada de `buildModelPublication` é objeto, não arquivo;
- para `RUNTIME_PARITY_MISMATCH` a divergência tem de ser entre dois artefatos VÁLIDOS. Um digest
  de paridade escrito à mão daria manifesto que o parser recusa, e o teste mediria o parser;
- a asserção "o ledger não existe" era falsa: o arquivo é criado pelo cenário. O que a guarda da
  confirmação do split impede é o EVENTO, e sem separar as duas coisas o teste não distinguiria
  "recusou antes de abrir o lease" de "recusou depois".

### O lote dos dez baratos: 23 guardas sem teste, e três módulos limpos como controle

| módulo | exercitadas / total |
| --- | --- |
| `commands/validate-predictions.ts` | **0 / 6** |
| `commands/verify-evidence.ts` | **0 / 6** |
| `commands/fit.ts` | 1 / 5 |
| `profile-artifact.ts` | **0 / 3** |
| `commands/consume-holdout.ts` | 2 / 4 |
| `commands/ingest.ts` | 0 / 1 |
| `commands/score.ts` | 0 / 1 |
| `commands/cluster-ledger.ts` | 1 / 1 — limpo |
| `evidence-sanitizer.ts` | 4 / 4 — limpo |
| `commands/validate.ts` | 4 / 4 — limpo |

**Os três limpos são o controle, e valem tanto quanto os outros sete.** Eles provam que a mutação
funciona nos dois idiomas do repositório — `fail(` e `throw new CommandError(` — então os zeros das
outras linhas são medição e não artefato de ferramenta. Sem eles, sete zeros seguidos seriam
indistinguíveis de uma ferramenta que parou de mutar.

O mais consequente é `verify-evidence.ts` em 0 de 6: é o comando que verifica evidência antes da
publicação, e nenhuma das seis recusas dele tem teste. Depois vem `validate-predictions.ts`, também
0 de 6, que amarra o artefato de predição ao dataset, ao split e à paridade de runtime.

O lote rodou em SEQUÊNCIA, de propósito: cada rodada compila o grafo inteiro, e um módulo mutado
enquanto outro é medido produz resultado que não vale. E cada módulo PERGUNTOU o fecho à própria
ferramenta em vez de eu listar suítes à mão — foi a seleção à mão que ela abortou quatro vezes.

**Nota de método:** três dos sete têm fecho de apenas duas suítes (`cli` e
`cluster-exposure-ledger`), o que significa que aqueles comandos não são dirigidos por suíte
dedicada alguma — a `cli` os alcança só na validação de bandeiras, sem entrar no corpo. É a mesma
forma do achado de `evaluate.ts`, e desta vez a leitura do fecho já a antecipa.

**Nota de honestidade sobre o commit anterior:** a mensagem de `765c567` diz que registra esta
medição, e o commit contém apenas o teste — o patch do registro falhou na âncora e eu não conferi
antes de commitar. Este parágrafo é o conserto, e a mensagem daquele commit fica imprecisa no
histórico.

O erro é o mesmo que a ferramenta foi endurecida quatro vezes para impedir, agora cometido um nível
acima: **medir o conjunto que alguém apontou e relatar como se fosse o conjunto todo.** A guarda por
fecho transitivo protege a escolha de SUÍTES; nada protegia a escolha de MÓDULOS, e eu herdei a lista
de uma varredura anterior sem conferir o que ela deixara fora.

Portanto: a tabela acima continua verdadeira sobre os dez, e o trabalho não bloqueado NÃO acabou — há
70 códigos de superfície não medida, e medi-los não toca `GROUP_KEYS` nem o esquema. As duas que diziam foram medidas: `cluster-exposure-ledger.ts` por
mutação com as onze suítes que o fecho transitivo aponta, e `corpus-source-audit.ts` por leitura —
lá os dez códigos são motivos de bloqueio do relatório, há um único `throw` que reencaminha os
códigos coletados, e o caso negativo dele já tinha teste. As lacunas que um agente havia reportado
naquele módulo eram falsas, o que confirma a divergência que eu já havia sinalizado ao ver zero
código sem menção.

**O par de backup é o achado que mais valeu a pena escrever.** Adulterar o CONTEÚDO do ledger
copiado deixa o MAC do manifesto válido e quebra o digest declarado; "consertar" o digest exige
reescrever o manifesto, que é autenticado. Os dois testes juntos dizem o que nenhum diria sozinho:
não há saída sem a chave. Restaurar um backup forjado é como se esconderia cluster queimado, e essa
era a borda sem teste.

**O que a varredura custou em erros meus, todos de arnês e todos corrigidos:** `$?` capturado depois
de um pipe (três `EXIT=0` que mediam o `tail`), uma fronteira por heurística que truncou metade de
uma suíte, uma substring que continha a si mesma e duplicou um `export`, escape de heredoc aninhado,
e âncoras envelhecidas pelo formatador entre a escrita e o patch seguinte. Nenhum deles chegou a um
commit verde sem conserto, e a recuperação foi sempre `git checkout` — o que só funcionou porque
cada passo virou commit antes do seguinte.

### RETRATAÇÃO: não havia 22 sítios, e a contagem sem leitura foi o erro

No commit anterior eu escrevi que a guarda anti-recaída era "metade da guarda", porque existiriam
**22 `toThrow()` síncronos pelados** no repositório. Está errado, e o erro é meu e do mesmo tipo que
eu venho perseguindo.

Contei com um regex que excluía apenas o prefixo `rejects`. Ao LER os 22 sítios, todos são
`.not.toThrow()` — asserção positiva de que nada estourou, uso correto, e não existe erro a nomear
ali. Medido direito, o repositório tem **zero** `toThrow()` pelado, síncrono ou assíncrono.

Isso não anula o furo, só o descreve certo: a guarda cobria só o lado `rejects`, então um
`expect(() => f()).toThrow()` pelado escrito amanhã passaria. O detector foi ampliado para as duas
formas, com `.not.toThrow()` explicitamente fora, e provado contra amostra nas duas direções — e o
conjunto de violações continua vazio, então a ampliação não pediu conserto de sítio algum.

A lição é a que eu já tinha registrado e desobedeci: **contagem não é leitura.** Um regex que casa
22 linhas não sabe o que aquelas linhas afirmam, e eu publiquei a conclusão antes de abrir uma. A
regra das duas medições existe exatamente para isto, e aqui a segunda medição foi ler.

### Uma terceira categoria: guarda sem estado alcançável

Eu vinha classificando cada guarda em duas caixas — exercitada por teste, ou lacuna. Ao escrever os
testes apareceu a terceira, e ela apareceu **três vezes**:

| guarda | por que não tem estado alcançável |
| --- | --- |
| `PROFILE_DIGESTS_MISMATCH` | o contrato amarra `calibrationSetDigest` ao digest canônico de `profileDigests`, e o verificador compara aquele digest ANTES desta guarda: chegar aqui exigiria lista diferente com digest igual |
| `PREDICTION_UNKNOWN_ID` | a completude compara CONJUNTOS, então um id a mais é recusado antes; chegar aqui exigiria conjunto exatamente igual ao do `test` contendo um id sem registro, e `validateSplitArtifact` amarra cada assignment a um registro |
| `OBSERVED_CHROME_INVALID` | os dois lados estão pinados — o manifesto de release pelo parser em runtime, o artefato congelado pelo próprio TIPO, que fixa `chromeVersion` no literal do release |

As duas primeiras são **redundância defensiva**: nenhum teste pode alcançá-las sem quebrar um
invariante anterior. Chamar isso de "guarda sem teste" seria achado falso — e eu quase publiquei os
três assim. A terceira tem estado alcançável, mas só num **arquivo adulterado em disco**, que é
precisamente a ameaça que ela defende; o teste dela forja o JSON e re-sela o `artifactDigest`,
porque sem re-selar a recusa vem da guarda vizinha.

O que muda no método: a ferramenta de mutação sabe dizer PEGA, SEM TESTE e NÃO-MUTÁVEL, e nenhuma
dessas é "inalcançável". Essa distinção não é automatizável — ela exige a prova de que um invariante
anterior fecha o caminho — então fica no registro, com a prova escrita, e não numa contagem.

### `commands/evaluate.ts` fechado, e a tupla exportada em vez de copiada

Medido pelo mesmo método, com as cinco suítes que o dirigem:

| | guardas exercitadas | sem teste |
| --- | --- | --- |
| linha de base | 3 | 10 |
| depois dos três primeiros testes | 6 | 7 |
| depois dos sete restantes | 12 | 1 |

A única guarda que sobra sem teste é `PREDICTION_UNKNOWN_ID` — a mesma que a prova acima diz ser
inalcançável. As duas medições são independentes e concordam: a auditoria por mutação diz que
nenhum teste a pega, e a prova diz que nenhum teste pode. É a diferença entre lacuna e código
defensivo morto, e aqui ela está estabelecida por dois caminhos em vez de um.

Os testes de governança ficam DEPOIS da retomada do lease, então precisam de sessão aberta com a
mesma tupla de dezesseis campos que o comando exige. `buildIdentity` passou a ser exportada, pelo
precedente da própria unidade: copiar projeção selada à mão já custou 27 falhas aqui e foi
consertado exportando `withoutSplitDigest`. E no teste do Chrome a sessão tem de abrir **depois** da
forja, porque `chromeVersion` entra na tupla — abrir antes faz a retomada divergir e o teste prova a
guarda vizinha.

### Dois erros meus de arnês nesta etapa, os dois de substituição sem guarda

1. **Fronteira por heurística.** Para regerar um bloco de teste, procurei o cabeçalho varrendo o
   arquivo do topo por `// ---` com "evaluate" nas linhas seguintes. Casou com um cabeçalho muito
   anterior e **truncou metade da suíte**. O conserto foi achar o `describe` e subir enquanto for
   comentário ou linha vazia, com `assert` na faixa esperada.
2. **Substring que contém a si mesma.** `"function buildIdentity("` é substring de
   `"export function buildIdentity("`, então a segunda passada do script duplicou o `export` e o
   comentário. O conserto foi ancorar em `"\nfunction buildIdentity(\n"` e exigir
   `count == 1`.

Os dois são a mesma regra que já está registrada — `replace` sem `assert` é aposta —, agora em duas
formas novas: heurística de fronteira e substring auto-contida. E os dois foram baratos porque a
recuperação era `git checkout` de um commit verde; teriam sido caros numa árvore não commitada.

### Retratação dupla: `evaluate.ts` não é intestabilidade estrutural

Eu afirmei **duas vezes** que `commands/evaluate.ts` exigia mudança de desenho — extrair a
sequência de validação — porque `runEvaluate` só seria alcançável com uma sessão de holdout real.
As duas vezes estava errado, e a causa foi a mesma: confiei no cabeçalho da própria suíte mais uma
medição estreita, em vez de conferir as entradas.

O que o disco diz:

- `benchmark/cli.ts:170` despacha `evaluate` direto, `runEvaluate(buildEvaluate(flags))`. Existe
  entrada externa para apontar o diretório de predições.
- `tests/consume-holdout.test.ts` e `tests/cli.test.ts` já escrevem manifestos de predição.
- `commands/consume-holdout.ts:167` chama `assertEvaluatorIdentity`, e `:359` chama `runEvaluate`.
  O módulo é dirigido pelas suítes, transitivamente.

**O conserto é teste, não extração.** E a medição com o conjunto completo de suítes que o dirigem
(cinco, achadas pelo fecho transitivo) dá **3 exercitadas e 10 sem teste** — não "2 de 13", que era
o número da medição estreita reportada por agente.

Lição, terceira aparição da mesma família: a intestabilidade que um comentário de teste declara é
afirmação sobre o passado de quem escreveu, não invariante do código. Vale como pista, nunca como
prova.

### Uma guarda provavelmente inalcançável, e a diferença entre isso e lacuna

Ao escrever o teste de `PROFILE_DIGESTS_MISMATCH` (em `verify-published-evidence.ts`) apareceu que
ele **não é alcançável**, e a prova é curta:

1. o contrato do descritor amarra `calibrationSetDigest` ao digest canônico de `profileDigests`
   (`contracts/model-release.ts:159-167`), logo qualquer release que passe pelo contrato tem os dois
   coerentes;
2. o verificador compara `calibrationSetDigest` com o da decisão publicada ANTES de comparar
   `profileDigests`;
3. para chegar ao segundo, a lista teria de diferir com o digest igual — que é exatamente o que não
   existe.

Isso não é lacuna de cobertura: é redundância defensiva. Registrar como "guarda sem teste" seria
achado falso, e o conserto certo foi virar o teste para o que o código faz de verdade — recusar
pelo contrato, com `RELEASE_DIGEST_MISMATCH`.

`ROLLOUT_STATE_INVALID`, ao lado, **é** alcançável, e por um caminho que o contrato deixa aberto de
propósito: `rolloutState: "shadow"` é o único estado sem regra estrutural no contrato, porque roda
só em desenvolvimento. `actions` não serviria, porque o contrato o recusa antes e o teste provaria o
contrato em vez do verificador.

### Três suposições minhas corrigidas por executar, não por ler

Nesta rodada de escrita, três asserções que eu havia escolhido por leitura caíram ao rodar:

1. `EVIDENCE_DIGEST_MISMATCH` pelo artefato congelado — `validateFrozenCalibrationArtifact` recusa
   antes, com erro de outra família. Vetor correto: o relatório.
2. `PROFILE_DIGESTS_MISMATCH` / `ROLLOUT_STATE_INVALID` — o contrato do descritor pega as duas
   forjas antes do verificador.
3. `consume-holdout.test.ts:1681` — eu afirmei o código da guarda, e o que rejeita ali é a escrita
   do ANEXO do incidente (destino é um diretório, o rename falha). O teste existe justamente para
   provar que o evento terminal do ledger sobrevive à falha do anexo, e a asserção certa nomeia a
   classe de erro de E/S em vez de fixar um código por plataforma.

Em nenhum dos três a leitura tinha me dado a resposta errada por descuido: ela deu a resposta
plausível. Escrever o teste é o que separa plausível de verdadeiro.

### O mecanismo por trás das "guardas sem teste": `rejects.toThrow()` sem argumento

Fui escrever os seis testes que faltavam em `commands/publish-evidence.ts` e o primeiro cenário já
tinha teste. `it("refuses an unfinished ledger")` existe, trunca o ledger no evento `started` e
afirma `rejects.toThrow()` — sem código. Com a guarda desligada a execução segue e estoura adiante
por outro motivo, e o `toThrow()` pelado continua verde. O teste passa pelo motivo errado.

O vizinho prova que é acidente e não critério: `HOLDOUT_REPORT_DIGEST_MISMATCH`, escrito no mesmo
estilo, deu **PEGA** na auditoria — porque ali desligar a guarda faz o comando *concluir*, e então
o `rejects` falha. Dois testes idênticos em forma: um real por acidente, outro decorativo por
acidente. O veredito não depende do que o teste afirma, e sim de haver ou não um estouro posterior.

A varredura do repositório: **21 `rejects.toThrow()` pelados contra 128 com matcher.** A convenção
já é afirmar o código; os 21 são a exceção, concentrados exatamente nos módulos onde eu vinha
"encontrando guardas sem teste". Boa parte do que eu chamaria de lacuna era asserção incapaz de
distinguir a guarda de um estouro posterior.

Conserto e **medição do conserto, pelo mesmo método antes e depois**, em `publish-evidence.ts`:

| | guardas exercitadas | sem teste |
| --- | --- | --- |
| antes | 2 | 6 |
| depois | 8 | 0 |

Foram oito asserções especificadas em `evidence-sanitizer.test.ts` (no idioma do repositório,
`rejects.toMatchObject({ code })`, porque a mensagem do `CommandError` não contém o código) e cinco
testes novos. Duas coisas que só apareceram ao escrever:

- `EVIDENCE_DIGEST_MISMATCH` não é alcançável mutando o artefato congelado:
  `validateFrozenCalibrationArtifact` recusa antes, com erro de outra família — defesa em
  profundidade que eu não sabia estar ali. Re-selar o congelado não está disponível ao teste porque
  `artifactWithoutDigest` não é exportado. O vetor que funciona é o relatório, porque a comparação
  de digests roda antes da conferência do ledger.
- `SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISSING` exige forja competente: anular o atestado sem
  re-selar o `splitDigest` pararia na auto-consistência, que é outra guarda.

Os treze `toThrow()` pelados restantes, classificados por leitura (a contagem sozinha os
confundiria): **dez são asserção de ausência de arquivo** (`stat(...)` rejeitando com ENOENT — não
são guarda de comando, e o conserto é precisão, não consequência) e **três são guarda de verdade**,
em `consume-holdout.test.ts`, onde o cenário afirma `identity-mismatch` no ledger.

**Medição nula registrada como nula.** A auditoria de `commands/verify-published-evidence.ts`
devolveu 9 de 9 NÃO-MUTÁVEL, porque o módulo usa o idioma `fail("CODIGO", ...)` e eu apontei a
ferramenta para `CommandError`. Zero mutável não é zero lacuna: aquele módulo continua **não
medido**, e vai ser remedido com o lançador certo. É o mesmo erro que o docstring da própria
ferramenta descreve, o que mostra que aviso em documentação não substitui a guarda que recusa.

### Medição: as lacunas restantes são de dois tipos, e a razão de linhas não distingue

Registrei como primeira pergunta da unidade nova se as 29 lacunas restantes eram intestabilidade
estrutural (como `evaluate.ts`) ou lacuna simples. A pergunta é respondível por medição, e a
medição é qual suíte importa quais pontos de entrada do módulo — não a razão de linhas, que aqui
teria dado a resposta certa por acidente e a errada no caso que importa.

| módulo | pontos de entrada | importados pela suíte | tipo |
| --- | --- | --- | --- |
| `cluster-exposure-ledger.ts` | 12 | 11 (fora: `parseExposureRequest` e dois auxiliares de caminho) | lacuna simples |
| `corpus-import.ts` | 3 | 3 | lacuna simples |
| `cross-validation.ts` | 5 | 5 | lacuna simples |
| `corpus-source-audit.ts` | 2 | 2 | lacuna simples |
| `commands/evaluate.ts` | 4 | 1 (`buildEvaluationItem`) | **estrutural** |
| `commands/publish-evidence.ts` | 1 (`runPublishEvidence`) | 1, por suíte de OUTRO nome | lacuna simples |

Ou seja: das lacunas restantes, a esmagadora maioria é **teste que falta**, não desenho que
impede. Só `evaluate.ts` exige extrair a sequência de validação antes de poder ser testada.

**E a última linha da tabela é um quase-erro meu, pelo mesmo mecanismo do primeiro.**
`commands/publish-evidence.ts` não tem suíte homônima, então eu ia auditá-lo escolhendo suítes
pelo nome — e quem o exercita de ponta a ponta é `tests/evidence-sanitizer.test.ts`, que importa
`runPublishEvidence` e mantém um `describe` end-to-end, mais um arquivo de fixtures construído
para isso. Eu estava a um comando de publicar "o comando que publica evidência não é exercitado",
que é falso. A retratação anterior tinha me feito endurecer a ferramenta contra medição estreita,
mas a guarda que eu escrevi confere só a suíte HOMÔNIMA — e nome de arquivo não é prova de
cobertura. Agora a ferramenta calcula **quem importa o módulo** e recusa qualquer seleção que
deixe um importador de fora. A mesma família de defeito, na segunda aparição, exigiu guarda mais
forte que a primeira: o conserto mecânico de antes não tinha resolvido, como eu havia dito.

**Segundo furo, este de arnês.** Rodei a ferramenta sob `timeout 30` para ver só o preâmbulo, e
`timeout` mata com SIGTERM, que não roda `finally`: o módulo ficou **mutado na árvore**. Se eu
tivesse rodado a auditoria em seguida, a linha de base seria "verde com uma guarda desligada" e
todo resultado depois dela, lixo. A ferramenta passou a gravar a fonte original num arquivo de
resgate antes da primeira mutação, a restaurar sob SIGTERM/SIGINT, e a **abortar** se encontrar o
resgate na entrada — porque sobrevivente de morte violenta tem de ser tratado como árvore suja,
não como ponto de partida.

1. `commands/evaluate.ts` — **e aqui a natureza do achado é diferente das outras, o que só apareceu ao
   ir escrever o teste.** As guardas EXISTEM e funcionam; o risco é regressão silenciosa, como no
   `CLUSTER_LEDGER_LOCKED`. Corrigindo a minha própria formulação anterior: eu havia escrito que
   "`evaluate.ts` aceita predições declaradas `development`", e isso descreve o estado MUTADO, não o
   atual.

   O que a leitura mostrou: `benchmark/tests/evaluate.test.ts` tem 130 linhas, **não chama
   `runEvaluate`**, e o cabeçalho dela explica por quê — "`runEvaluate` needs a real open holdout
   session", e `buildEvaluationItem` foi extraída exatamente para tornar a lógica testável sem sessão.
   A intestabilidade é **estrutural e documentada**, não descuido.

   Então o conserto não é escrever oito testes: é **repetir o padrão que o arquivo já usa** — extrair a
   sequência de validação (partição declarada, vínculo da sessão, completude contra a partição, rótulos
   duplicados/divergentes) para uma função exportada que receba manifestos e rótulos, e testá-la direto.
   Isso é mudança de desenho, pequena mas real, e por isso unidade própria em vez de apêndice.

   As duas de maior consequência continuam sendo `TEST_PARTITION_EXPECTED` (predição de outra partição
   passando pela corrida do holdout) e `TEST_COMPLETENESS_FAILED` (subconjunto de `test`, que é a
   seleção que melhora FPR), porque as duas selam relatório de release e gastam o lease.
2. o resto de `cluster-exposure-ledger.ts` — restore de backup fabricado, `records: []` passando como
   evento válido, tipo de evento trocado.
3. `corpus-import.ts` — `REVIEW_LEDGER_EMPTY`: um dataset com **zero** entradas de revisão humana sela
   como válido e assinado, e nada a jusante pega, porque `validate` só recomputa o digest dos bytes que
   estão lá.
4. `commands/publish-evidence.ts`, `cross-validation.ts`, `corpus-source-audit.ts`.

**Nada disso é do E2**, que está commitado. É unidade própria, e o mérito é de a ferramenta ser
versionada e repetível sem depender da cota do revisor.

**Resíduo do paralelismo, e a limpeza é parte do trabalho.** A corrida deixou **seis worktrees** e
**sete branches** de agente. Todos os seis worktrees estavam LIMPOS — o `finally` da ferramenta
restaurou a fonte em cada cópia isolada, o que é a confirmação independente de que o arnês aguenta ser
usado em paralelo. Antes de apagar as branches conferi `git rev-list --count cleanfeed-mvp..<branch>`
para cada uma: zero commits à frente, então nada de trabalho único se perdeu. Branch de agente apagada
sem essa conferência é trabalho jogado fora, e a pressa de limpar é o jeito mais fácil de destruir o que
a corrida produziu.

### Retratação: o achado do ledger era metade do que eu disse (2026-08-02)

**O que eu afirmei e commitei em `dbf52f7`:** quatro guardas do ledger do holdout sem teste, com
`HOLDOUT_TUPLE_MISMATCH` — a que vincula o consumo à configuração arrendada — apresentada como a mais
consequente, e a falha dela descrita como "bloco cego consumido para a configuração errada".

**O que é verdade, medido depois:** duas sem teste, `HOLDOUT_LEDGER_CORRUPT` e `HOLDOUT_LEDGER_LOCKED`.
`HOLDOUT_TUPLE_MISMATCH` e `HOLDOUT_FAILURE_CODE_INVALID` **estão testadas**, em
`benchmark/tests/holdout-ledger.test.ts` — uma suíte DEDICADA ao módulo que eu não incluí na auditoria.

**A causa, e é a terceira vez na mesma sessão:** eu escolhi as suítes por conveniência
(`consume-holdout.test.ts` e `cli.test.ts`, as que eu já conhecia) em vez de por cobertura do módulo. A
rodada 12 do cross-review já havia me pegado nisto com os comentários, e eu registrei a lição — "uma
contagem só sustenta a afirmação quando o predicado da contagem é o predicado da regra" — e repeti o
erro na medição seguinte.

**Como peguei antes do operador:** fui ao disco ler a assinatura da função para escrever o teste, e o
`grep` de arquivos mostrou a suíte que eu havia ignorado. **Ir implementar é o que revelou o erro de
medição** — ler para escrever encontra o que ler para concluir não encontra.

**O conserto é mecânico, não uma resolução.** A ferramenta passou a **RECUSAR** rodar quando existe
`benchmark/tests/<modulo>.test.ts` e ela não está nas suítes, com a mensagem dizendo que rodar sem a
suíte dedicada reporta lacuna inexistente. Testado: a recusa dispara. É a mesma forma da checagem de
linha de base verde — transformar a disciplina que eu falho em cumprir numa condição que o arnês impõe.

**O que sobra de achado, e continua valendo:** `HOLDOUT_LEDGER_CORRUPT` (ledger danificado passando por
válido) e `HOLDOUT_LEDGER_LOCKED` (proteção contra consumo concorrente) não tinham teste. Duas guardas,
não quatro, e nenhuma delas é a identidade do lease.

**FECHADO no mesmo dia: as oito guardas mutáveis do ledger agora são exercitadas.** `LEDGER_CORRUPT`
com uma linha válida seguida de uma corrompida — ignorar a segunda em silêncio é como um ledger truncado
por escrita interrompida passaria por completo —, asserindo também que a mensagem nomeia a linha 2. E
`LEDGER_LOCKED` pré-criando o arquivo de lock, que o módulo abre com `wx`, o que equivale a outra
transição em curso.

**E a lição que a comparação entre as três auditorias dá, mais forte que "inclua as suítes certas":**
`commands/split.ts` estava correto porque só uma suíte exercita `runSplit` e eu a incluí.
`split-artifact.ts` foi medido estreito — 2 de 6 suítes — **e o achado sobreviveu**, porque naquele eu
havia feito uma SEGUNDA medição independente: grep pelos códigos em todo `benchmark/tests/`, vazio para
os sete. O do ledger caiu porque teve **uma só** medição. O endurecimento da ferramenta (recusar sem a
suíte irmã) é necessário e insuficiente; o que salvou foi **corroborar por método diferente**.

### A ferranta de mutação entendia o idioma minoritário — e o ledger do holdout tem quatro guardas sem teste (2026-08-02)

**Primeiro, um erro de método meu, porque ele quase virou conclusão falsa.** Apontei a auditoria para
`benchmark/holdout-ledger.ts` e ela devolveu **dez "NAO-MUTAVEL" e zero informação**. Se eu tivesse
lido isso como "nenhuma lacuna", teria publicado o oposto da verdade. **Zero mutável não é zero
lacuna.**

A causa: o repositório tem DOIS idiomas de lançamento — `throw new XError("CODIGO", ...)` e
`fail("CODIGO", ...)` por helper — e a ferramenta só entendia o primeiro. Pior, o primeiro é o
**minoritário**: 14 módulos usam o helper. Os dois módulos em que a ferramenta funcionou
(`split-artifact.ts` e `commands/split.ts`) eram a exceção, e eu concluí sobre o alcance dela em vez de
sobre o repositório.

Generalizada, com um detalhe que importa: **não serve trocar `fail(...)` por `void fail(...)`**, porque
`fail` lança por dentro e `void` apenas avalia. O que desliga é substituir o lançador por um inerte
injetado no módulo. Fiz ensaio a seco antes de rodar, porque mutação que produz código inválido faz a
suíte falhar por compilação e eu leria isso como "guarda exercitada" — falso positivo, que aqui é pior
que falso negativo.

> ⚠️ **RETRATAÇÃO PARCIAL, 2026-08-02, poucos minutos depois: a tabela abaixo estava ERRADA, e o erro
> era meu, de novo por escopo de medição.** Existe `benchmark/tests/holdout-ledger.test.ts`, uma suíte
> DEDICADA ao módulo, e eu rodei a auditoria sem ela. Com a suíte incluída são **seis exercitadas e
> duas sem teste** — e `HOLDOUT_TUPLE_MISMATCH`, que eu apresentei como a mais consequente e
> descoberta, **estava testada desde sempre**, como `HOLDOUT_FAILURE_CODE_INVALID`. Ver a correção
> completa em § "Retratação: o achado do ledger era metade do que eu disse".

**O resultado que eu reportei, em `benchmark/holdout-ledger.ts`: oito guardas mutáveis, quatro
exercitadas, quatro sem teste** — e duas dessas quatro não eram lacuna:

| guarda | estado | por que importa |
|---|---|---|
| `HOLDOUT_ALREADY_CONSUMED` | exercitada | — |
| `HOLDOUT_LEDGER_ABSENT` | exercitada | — |
| `HOLDOUT_SESSION_TERMINAL` | exercitada | — |
| `HOLDOUT_SESSION_UNKNOWN` | exercitada | — |
| **`HOLDOUT_TUPLE_MISMATCH`** | **sem teste** | é a guarda que vincula o consumo à CONFIGURAÇÃO arrendada; sem ela, o bloco cego pode ser consumido para uma configuração diferente da que pediu o lease |
| **`HOLDOUT_LEDGER_CORRUPT`** | **sem teste** | ledger danificado passando por válido |
| **`HOLDOUT_LEDGER_LOCKED`** | **sem teste** | proteção contra consumo concorrente |
| **`HOLDOUT_FAILURE_CODE_INVALID`** | **sem teste** | código de falha arbitrário entrando no ledger |

`EEXIST` e `ENOENT` não são guardas do módulo — são códigos de erro do sistema de arquivos, e a
ferramenta os lista como não mutáveis corretamente.

**Isto NÃO é do E2**, que está commitado. É fluxo de achados novo, num módulo que a unidade não tocou, e
o mérito é da ferramenta ser versionada e repetível sem depender da cota do revisor.

**Fica como UNIDADE PRÓPRIA, com a ordem ditada por consequência e não por facilidade:**
`HOLDOUT_TUPLE_MISMATCH` primeiro, porque a falha dela não é teste vermelho — é holdout consumido para
a configuração errada, e isso é irreversível. Depois `LEDGER_CORRUPT` e `LEDGER_LOCKED`, e por fim
`FAILURE_CODE_INVALID`.

**E fica um alvo maior medido:** há guardas codificadas em pelo menos dez módulos, com
`cluster-exposure-ledger.ts` em 29 e `corpus-import.ts` em 14. A ferramenta agora alcança os dois
idiomas, então essa varredura é possível — e a hipótese de trabalho, depois de dois módulos medidos com
7/29 e 4/8 sem teste, é que a taxa não é baixa.

### A auditoria de mutação aplicada ao caminho do COMANDO (2026-08-02)

Com a rodada 13 bloqueada por cota, a ferramenta versionada foi generalizada (módulo, classe de erro e
suítes como argumento) e apontada para o módulo irmão mais consequente. A escolha do alvo foi por
medição: `benchmark/split.ts` tem três `SplitConstraintError` **sem código nomeado** e
`benchmark/split-audit.ts` **não lança** — empilha razões. O único irmão com guardas codificadas é
`benchmark/commands/split.ts`, e é o caminho que o operador executa.

**Resultado: cinco guardas, duas exercitadas, TRÊS sem teste.**

| guarda | estado |
|---|---|
| `COMPOSITION_FLOOR_NOT_APPLIED` | exercitada |
| `HELD_OUT_FAMILY_DISAGREEMENT` | exercitada |
| `SPLIT_SEED_NOT_PRE_REGISTERED` | **sem teste** — e é a guarda que eu escrevi na rodada 11 para fechar um P1 |
| `DATASET_AUDIT_MISMATCH` | **sem teste** |
| `SPLIT_AUDIT_FAILED` | **sem teste** |

A da seed dói: ela entrou como conserto de um P1 do cross-review, com registro e tudo, e **nunca foi
exercitada**. É a mesma família que a rodada 12 me apontou — declarar conserto sem que nada alcance a
guarda — e agora encontrada por ferramenta em vez de por revisor.

**Feito:** teste no caminho do comando para a seed, com `seed: 999_999` recusada antes de qualquer
trabalho (`corpus-import.test.ts`, caso 3d).

**Registrado em vez de entregue meia-boca**, com a construção exata que provaria cada uma:

- **`DATASET_AUDIT_MISMATCH` — FEITO** (caso 3e). A rota era exatamente a prevista: alterar a
  identidade e **recomputar** `auditDigest`, senão a checagem do auto-digest recusa antes e o teste
  provaria coerência interna em vez do vínculo ao dataset. Ficou tratável porque
  `computeDatasetAuditDigest` já é exportado; a forja troca o `datasetId` e re-sela. Reauditoria
  confirma: **4 das 5 guardas do comando exercitadas**.
- **`SPLIT_AUDIT_FAILED`** precisa de um corpus em que o splitter TENHA SUCESSO e a auditoria reprove.
  O caminho conhecido é o que o próprio cross-review usou na rodada 9: um componente que atravessa o
  último corte cai em `train` levando o tempo da banda de teste, e `earliest(test) > latest(train)`
  falha. O splitter constrói isso sem notar; a auditoria é o único lugar que recusa. Montar esse corpus
  no caminho de integração (diretório de dataset real, digests encadeados) é o custo, não a ideia.

**Reachability, não cobertura:** as duas são alcançáveis — não são segundas fechaduras como
`SPLIT_ARTIFACT_CUTOFFS_INVALID`. Portanto são lacuna de teste de verdade, e ficam como dívida nomeada
com o caminho escrito, para não voltarem a ser descobertas de novo.

### Decisão: COMMITAR sem o PASS da rodada 13, porque a cota só volta em 8 de agosto (2026-08-02)

**Medido:** a sonda do codex devolve "try again at Aug 8th, 2026 4:25 AM" — seis dias. Não é espera de
minutos; é bloqueio estrutural. Comprar crédito é dinheiro, que está na lista fechada de
nunca-delegado, então isso segue com o operador.

**Decisão do agente, com razão e custo de reversão.** A regra "só commitar após PASS" foi escrita por
mim para impedir que trabalho não revisado entre no histórico. O que ela protege é o **rastro de
auditoria** — e o rastro se preserva melhor com o estado da revisão declarado no commit do que com 48
arquivos pendurados por seis dias, herdados como árvore suja por qualquer sessão que abrir. Custo de
reversão: `git reset --soft HEAD~1`, nada publicado, nada externo. Commitar **não** está na lista de
nunca-delegado; a regra é processual e minha, e emendá-la com o motivo escrito é o procedimento previsto.

**O que o commit declara, e é a parte que importa:** doze rodadas de cross-review, doze rejeições, todas
consertadas e verificadas; a rodada 13 **não rodou**, por cota; e a lista de dívidas aceitas
(aridade da busca, comentários repo-wide fora do diff, e a metade em código da F1-5q como unidade
própria). Quem ler o histórico vê o estado real, não um "pronto".

**O que NÃO muda:** a rodada 13 continua sendo o próximo passo quando a cota voltar, com mandato escrito
e runner pronto. E `release` continua indisponível — nada aqui altera isso.

### Auditoria de mutação das guardas, e o batimento permanente (2026-08-02)

Com a rodada 13 bloqueada por cota, o trabalho foi o que não depende do revisor — e rendeu um achado
que **nenhuma das doze rodadas havia achado**.

**A ferramenta.** "Teste que passa pelo motivo errado" foi a família de defeito mais frequente desta
unidade, e ela é automatizável: para cada código de erro do módulo, desligar TODOS os `throw` daquele
código (`throw new X(` → `void new X(`, mesma aridade, mesmo construtor, sem lançar), rodar a suíte, e
registrar se algo ficou vermelho. Guarda cuja remoção deixa tudo verde não tem teste que a exercite.
O script ficou em `.codex-reviews/auditoria-mutacao.py`.

**O resultado, medido em `benchmark/split-artifact.ts`:** 29 guardas — **17 exercitadas, 7 sem teste
nenhum**, 4 não mutáveis pelo padrão (lançam de dentro de helpers, então o código é parâmetro; essas
quatro têm teste, conferido à mão). Entre as sete sem teste estavam
`SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH` e `_UNEXPECTED` — **o centro da F1-5o**, a regra que
exige o atestado derivado. A guarda que eu escrevi para fechar o P1 da rodada 5 não tinha uma única
entrada que a alcançasse.

Sete testes foram escritos a partir disso, e a **reauditoria** confirmou: **24 exercitadas, 1 restante**.

**A que restou é legítima, e a distinção importa.** `SPLIT_ARTIFACT_CUTOFFS_INVALID` é uma SEGUNDA
FECHADURA: uma partição vazia põe uma fração de classe em 0 contra alvo de no mínimo 0,05, então a
checagem de coerência recusa antes. Ela existe para converter uma falha obscura — `canonicalSha256`
engasgando em `Infinity` — numa falha nomeada, se a fechadura anterior algum dia se mover. **Isso é
diferente de guarda redundante:** as checagens de tipo de `counts` que removi na rodada 12 duplicavam
uma comparação equivalente com a mesma qualidade de erro; esta melhora o diagnóstico. Ficou com o
"inalcançável por desenho" escrito no código, para a próxima auditoria não a ler como lacuna.

**Três exigências do arnês, aprendidas errando três vezes seguidas:** conferir a linha de base VERDE
antes de mutar (senão "vermelho" não distingue mutação eficaz de suíte quebrada); restaurar num
`finally` e conferir por `diff` depois (o script muta o mesmo arquivo dezenas de vezes); e capturar
BYTES decodificando à mão, porque `text=True` usa cp1252 no Windows e o vitest emite UTF-8. As três
primeiras tentativas morreram por arnês, não por alvo, e nas três a fonte voltou idêntica.

**E o conserto definitivo das pausas.** A camada 4 do § 6b existia, estava provada, e eu **não a armei**
— porque ela pedia que eu a acionasse ao fim de cada turno, e falhar em acionar é a mesma falha
volitiva que ela cobria. Substituída por **batimento permanente**, armado uma vez por sessão
(`.codex-reviews/batimento.sh`), que escreve sentinela a cada 20 min até ser morto. A mudança real é
onde a decisão acontece: "continuar ou parar" sai do fim do turno — o momento em que eu erro — e passa
a ser tomada acordado, ao receber o batimento. **Parar passa a ser um ato explícito** (`pkill -f
batimento.sh`) e não a ausência de um. Primeiro pulso confirmado no mesmo dia.

**Estado:** 162 arquivos / **2369 vitest**, **157 Python**, typecheck, format e EOL limpos, lint nos 13.

### Bloqueio de cota do codex e o que fiz no lugar (2026-08-02)

A rodada 13 **não rodou**: `EXIT=1` em ~28 s, e a causa não é rede — é **cota de uso esgotada**
("You've hit your usage limit"). Comprar créditos é dinheiro, que está na lista fechada de
nunca-delegado, então não compro e a rodada fica bloqueada até a cota voltar. **Não commitei**: a regra
"só após PASS" existe porque o último veredito achou um P1 real dentro do meu próprio conserto, e a
razão dela não expirou com a cota.

**O que rodou no lugar, e por que é a coisa certa:** apliquei como VARREDURA a lição que já rendeu
quatro achados — *contar os sítios*. Resultado medido no diff inteiro:

- **comparações cruas contra tolerância: ZERO.** A família do P1 das rodadas 11 e 12 está fechada, e
  agora isso é medição e não afirmação.
- **enumerações à mão que restavam: três, e consertadas.** `split-artifact.ts` escrevia
  `audit.classFractions.human/ai/mixed` à mão apesar de `AUDIT_CLASS_LABELS` existir; e as duas guardas
  de `--partition` em `cli.ts` **citavam a autoridade na mensagem e repetiam os nomes na checagem** —
  tirar um nome de `FIT_PARTITIONS` não mudaria o `if`. Entrou um guarda de tipo `isOneOf`, para que a
  checagem leia a mesma tupla que a mensagem nomeia.
- **dois falsos positivos, que eu NÃO mexi.** Os inicializadores de `emptyPartitionCounts` e de
  `auditClassFractions` são literais restritos por `Record<Partition, number>`: partição nova já é erro
  de compilação. Concluir "não há defeito" também é conclusão, e trocar código correto por refatoração
  cosmética na décima terceira rodada é risco sem ganho.

**E a varredura achou um defeito que nenhuma revisão havia achado**, do mesmo tipo que elas vinham
achando: `LABELS` em `split-audit.ts` era `readonly BenchmarkLabel[]` — anotação que verifica cada
ELEMENTO e não a COBERTURA. Um rótulo acrescentado a `BenchmarkLabel` deixaria a lista curta, e
`auditClassFractions` monta o mapa com `{} as Record<BenchmarkLabel, ...>`: o cast passaria a mentir, o
rótulo ausente leria `undefined` e toda fração derivada dele seria `NaN`. Agora é
`Record<BenchmarkLabel, true>` com as chaves derivadas dele, então rótulo não listado é erro de
compilação.

**Estado ao fim:** 162 arquivos / **2362 vitest**, **157 Python**, typecheck, format e EOL limpos, lint
nos 13 pré-existentes. Doze rodadas, doze rejeições, nada commitado.

### Rodada 12 do cross-review do E2 — REJEITADA, e o P1 é o meu conserto anterior aplicado pela metade (2026-08-02)

Veredito **(c) rejeitar**: um P1 e dois P2. **Os dois cortes de escopo que eu havia declarado foram
ACEITOS** — a dívida de aridade da busca e o caráter documental da F1-5q ficam resolvidos, e ele
confirmou que não há implementação de `collectionBatch` misturada ao E2.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a operação de tolerância não ficou única: eu apliquei o helper em 2 de 7 lugares.** A busca reimplementava a aritmética em cinco podas e a checagem final numa sexta. Ele reproduziu **pela API pública**: 100 componentes unitários, distribuição `[45,5,8,22,20]` — toda dentro da tolerância inclusiva — e `createBlockedSplit` lançou `SPLIT_CONSTRAINT`, porque `0.58 - 0.50` dá `0.07999999999999996`. **E os meus testes de 3%/7% exercitavam SÓ o helper**, então não atravessavam a busca e não podiam detectar a regressão | as duas metades da tolerância ganharam nome — `atMostWithinTolerance` e `atLeastWithinTolerance`, sobre o mesmo epsilon — e as **sete** comparações passaram a delegar. Teste novo **pela API pública**, com a distribuição dele, e **provado por mutação**: revertendo UMA poda para float cru, o teste falha com exactamente o `SPLIT_CONSTRAINT` que ele reportou |
| 2 | **P2 — o espelho Python não falhava fechado em parse PARCIAL.** A guarda só pegava zero entradas; com uma entrada válida e outra malformada, devolvia o mapa menor em silêncio. E o meu teste chamado "fails closed" **não injetava nada malformado** — apenas chamava a função contra o arquivo atual | o parser passou a exigir **consumo completo**: conta os `sourceId` do corpo e recusa se o número extraído divergir. Quatro provas com corpo injetado: parse parcial, duplicata, terminador ausente, inventário ausente |
| 3 | **P2 — comentários de histórico e comentários incompatíveis com cinco partições.** Ainda havia `development`, `calibration`, "other two" e "all three partitions" em oito lugares, mais narrativas de revisão | reescritos com a partição real ou linguagem neutra |

**O padrão do P1 merece nome próprio, porque é a terceira variação da mesma coisa.** Rodada 9: espelhei
um SUBCONJUNTO das condições. Rodada 11: unifiquei a constante e não a operação. Rodada 12: unifiquei a
operação e **apliquei em 2 de 7 sítios**. As três vezes eu declarei o conserto completo e ele não estava.
O que faltou nas três é a mesma verificação: **contar os sítios antes e depois**. `grep` pelas comparações
cruas restantes leva dez segundos e teria fechado as três — foi o que fiz agora, e sobrou zero.

**E o teste que "provava" o P1 da rodada 11 não provava nada**, porque exercitava o helper e não o
caminho. Regra que sai daqui, e é a mais concreta da unidade: **teste de borda tem de passar pela API
pública que o defeito atravessa.** Um teste de unidade sobre o helper prova o helper; a busca é outro
código.

**Dívida repo-wide reconfirmada, com medição:** restam três narrativas de cross-review em
`benchmark/lab/near_dupes.py` e `benchmark/lab/test_near_dupes.py`, **ambos fora do diff do E2**
(verificado com `git diff --name-only`). Ficam na dívida de comentários que a rodada 7 delimitou e que
ele aceitou como fora desta unidade.

### Rodada 11 do cross-review do E2 — REJEITADA, e o P1 é aritmética de ponto flutuante contra o contrato (2026-08-02)

Veredito **(c) rejeitar**: um P1 executável e sete P2. O P1 é o mais elegante de todos os achados desta
unidade, porque não é lógica nem esquecimento — é a borda de `IEEE-754` contradizendo um número que o
registro declara legal.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a tolerância inclusiva de ±0,02 recusava exactamente as bordas legais.** O contrato diz que um `dev` com 3% ou 7% de uma classe é legal. Em ponto flutuante binário, `Math.abs(0.03 - 0.05)` é `0.020000000000000004`, **estritamente maior** que `0.02`. Quatro comparações independentes usavam float cru — a busca de cortes, a checagem final do splitter, a guarda do artefato e a minha guarda Python — e **só a auditoria** tinha margem (`+ 1e-9`). Ele reproduziu: `abs_error=0.020000000000000004; tolerance=0.02 → UnsplittableCorpus` | **uma** semântica numérica, nomeada e num lugar só: `CLASS_TOLERANCE_EPSILON` e `withinClassTolerance` em `benchmark/split.ts`, usados pelos quatro sítios TS, com espelho `within_class_tolerance` no Python e pino do epsilon contra o TS. Testes de borda nos DOIS lados: 3% e 7% aceitos, 2,99% e 7,01% recusados |
| 2 | **P2 — o meu espelho Python dos eixos declarados lia uma fonte BLOQUEADA.** O regex varria o arquivo inteiro e colhia `A1_BLOCKED_HUMAN_SOURCES`, trazendo `src_ptso`; a autoridade da auditoria é só `V3_HUMAN_SOURCE_INVENTORY`. E o meu teste checava apenas que `src_b2w` estava presente | o espelho passou a extrair **somente** o corpo do inventário, falhar fechado em parse incompleto ou duplicado, e o teste virou **igualdade exata do mapa**, incluindo a ausência das bloqueadas. Medido: três fontes, `src_ptso` fora |
| 3 | **P2 — o checkpoint operacional usava nomes que a CLI recusa:** `--partition development` e `calibration`, num roteiro que eu havia deixado híbrido ao migrar só a seed da linha anterior | cinco linhas migradas para `dev`/`cal-A`, incluindo os diretórios. As flags `--development-predictions`/`--calibration-predictions` **não** mudaram, porque são nome de flag da CLI e não de partição |
| 4 | **P2 — a autoridade afirmava que a linhagem não estava ligada ao comando**, e o disco mostra a chamada em `commands/split.ts` | o plano passou a dizer que o comando a chama antes de particionar, e por que isso torna a união de conectividade total no caminho do comando |
| 5 | **P2 — o runbook descrevia duas regras de split falsas:** reduzia a auditoria entre partições a `dev/cal/test`, e afirmava que componentes precisam permanecer no bloco estampado, contradizendo-se três linhas depois | as cinco partições nomeadas, e a distinção que a rodada 8 ensinou: **bloco ESTAMPADO é proposta, partição REALIZADA é o que o splitter produz**; atravessar não reprova por si |
| 6 | **P2 — comentários factualmente falsos:** `candidate-preflight.ts` chamava `dev ∪ cal-A` de "non-test split" (inclui `train` e `cal-B`); `cli.test.ts` dizia seis templates e o teste espera oito; `evidence.fixtures.ts` dizia "três números" havendo cinco; e duas narrativas de histórico de revisão | reescritos com os números atuais e sem história |
| 7 | **P2 — enumerações de forma ainda não vinculadas ao tipo**, em seis lugares | parcialmente feito. Ver abaixo o que ficou e por quê |

**O que ficou de fora do achado 7, declarado em vez de silenciado.** A busca de cortes em
`benchmark/split.ts` desestrutura os candidatos em exatamente quatro listas e quatro laços aninhados —
aridade fixa. Indexá-la pelas chaves dos cortes, ou recursá-la, é refatoração do algoritmo de busca, não
de uma lista de nomes: muda o caminho quente que a unidade inteira exercita, e entrar nela na décima
primeira rodada de revisão troca um defeito de forma por risco de comportamento. **Fica registrado como
dívida com razão**, e a razão é a mesma que fez a metade em código da F1-5q virar unidade própria.

**A lição desta rodada é sobre o que conta como "uma fonte de verdade".** Eu já havia aplicado quatro
vezes a regra "enumeração vem do tipo", e ela não cobre número: `CLASS_TOLERANCE` estava num lugar só,
corretamente, e **a comparação** estava em quatro — com semânticas diferentes. Uma constante única não
garante uma semântica única. **O que precisa ser único é a OPERAÇÃO, não o valor**, e é por isso que o
conserto foi um helper e não uma constante.

### Rodada 10 do cross-review do E2 — REJEITADA, e o P1 é o defeito que a regra da rodada 9 existia para impedir (2026-08-01)

Veredito **(c) rejeitar**: três P1, dois P2, cinco grupos de padrões. Antes do veredito, **a primeira
tentativa da rodada 10 morreu** por refresh de token (`EXIT=1`, 176k tokens gastos, `stream
disconnected`) — e a armadilha vale registro: `grep "Veredito"` no output achou vereditos ANTIGOS,
porque o codex cita o registro e o registro contém as rodadas anteriores. **Conferir `EXIT=` antes de
procurar veredito**, sempre. Arquivo da falha preservado como `e2-r10-veredito-FALHA-AUTH.txt`.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a guarda de publicação verificava a relação temporal ERRADA.** O contrato exige `earliest(cal-A) > latest(dev)` e `earliest(cal-B) > latest(cal-A)`; eu comparava `latestDev < latestCalA < latestCalB`. Faixas médias SOBREPOSTAS passam: ordem de faixas **implica** `latest` monótono, e a recíproca é falsa. Pior, o artefato nem publicava os dois `earliest` | a auditoria passou a publicar `earliestCalA` e `earliestCalB`, a guarda compara earliest-contra-latest, e a forma selada mudou — **`schemaVersion` 3 → 4**. Teste novo: faixas sobrepostas com `latest` monótonos são recusadas |
| 2 | **P1 — a minha divisão `0,46/0,99` não isolava a re-derivação honestamente.** Mudar só `human.train` para `0,46` faz as cinco frações somarem **1,01**, o que é decidível sem dataset — e a guarda checava cada célula contra o alvo, não a soma | entrou a checagem de soma (≈1 para classe presente, 0 para ausente), e a forja passou a **redistribuir** o 0,01 (`train=0.46`, `cal-B=0.19`), mantendo soma 1 com todas as células dentro da tolerância. `0,99` continua provando a coerência local |
| 3 | **P1 — a guarda Python omitia UMA das cinco reprovações que eu mesmo enumerei.** Faltava `declaredAxisGaps`; a sonda dele com 45/5/10/20/20 e `src_b2w.source = unknown` voltou `ACCEPTED_DECLARED_AXIS_GAP` | entrou a autoridade `sourceId → eixos declarados`, **lida de `source-manifest.ts`** em vez de reescrita, e a recusa. E entrou a tabela explícita "espelho / não decidível" que ele pediu: vazamento **não** é espelhado, porque `realized_blocks` põe o componente conexo inteiro numa partição e vazamento é impossível por construção nessa simulação |
| 4 | **P2 — `audit.reasons` era nominalmente tipado:** `reasons: ""` satisfazia a comparação por `.length`, e o sanitizador o convertia em `[]` | `Array.isArray` antes do `.length`, e cada item validado como string não vazia |
| 5 | **P2 — autoridades contraditórias:** registro e `references.md` diziam que `train` "não tem relação temporal com nenhuma das outras" e ambos exigiam `earliest(test) > latest(train)` logo em seguida. O handoff mandava ler a rodada 7 declarando a 10 como próxima | os dois passaram a dizer que `train` não integra a CADEIA das três médias, com a separação estrita contra `test` preservada e explicada — e omitir essa exceção é a promessa oposta, igualmente falsa. Handoff corrigido |
| padrões | cinco grupos, e três eram FALSOS | `score.ts` dizia que o módulo não dirige navegador real e ele chama `chromium.launchPersistentContext` — **comentário que eu escrevi nesta sessão**; `split-audit.ts` afirmava que comparar com o máximo deixaria sobreposição passar, quando `x > max(a,b,c,d)` **é** as quatro comparações (o que não vale é uma CADEIA de vizinhos); e o bloco da guarda parcial afirmava que todos os casos seguintes só eram recusados pela re-derivação, quando vários são recusados antes. Mais duas narrativas de teste e duas de versão extinta ("v2 header over v1 audit", que já não corresponde ao schema 4) |

**Um padrão estrutural apareceu três vezes nesta rodada e vale mais que os consertos: lista de chaves
mantida à mão.** O conjunto esperado de `audit.cutoffs` era um array literal ordenado, e não acompanhou
os dois campos novos — a bateria caiu em oito testes por isso. Substituído por
`Record<keyof SplitAudit["cutoffs"], true>`, usado nas DUAS cópias, de modo que campo novo é erro de
compilação. É a mesma correção que a projeção selada recebeu na rodada 5 e as seis projeções na 6: **em
todo lugar onde uma forma é enumerada, a enumeração vem do tipo.**

**E a lição da rodada 9 falhou no primeiro uso, o que a torna mais precisa.** Eu havia registrado
"enumerar no disco todas as condições de falha e decidir espelho/não-decidível para cada uma". Enumerei
as cinco e espelhei quatro — a enumeração sem a **tabela escrita** é só intenção. O conserto do achado 3
inclui a tabela no código, e é ela, não a intenção, que impede o subconjunto.

### Consenso sobre o garfo do `collectionBatch` — e a minha medição estava errada de novo (2026-08-01)

O operador pediu que eu e o codex chegássemos a consenso em vez de eu escolher. Chegamos, e o caminho
até ele corrigiu uma afirmação que eu já havia registrado como verdade nas rodadas 6, 7 e 8.

**ERRO MEU, o quarto desta unidade: "o corpus tem quatro componentes humanos" descreve um corpus que
NÃO EXISTE.** Medido por mim depois da contestação dele:

- a única saída v3 materializada, `benchmark/out/rebuild-v3/C5/records.jsonl`, tem **48 registros, todos
  `ai` — zero humanos**;
- os quatro arquivos de pool (`ptso_fresh`, `wikipedia_fresh`, `carolina_fresh`, `b2w_fresh`) **não
  estão nesta worktree** (coerente com a convenção de snapshots fora do repo);
- o corpus selado que existe é **v2**, com 4.000 humanos e — pelos lotes artificiais por registro da
  época — **4.000 componentes humanos**, não quatro.

Ou seja: os "quatro componentes" descrevem a seleção HIPOTÉTICA que surgiria se as linhas dos pools
sobrevivessem ao builder. Ele acrescenta que não sobreviveriam: nos pools legados nenhum registro
carrega `dateField`, `observedValue`, `snapshotVersion` nem eixo `source`, então os 4.000 humanos são
recusados como `MissingLabelEvidence` — não apenas o `extraction_reserved` que eu havia citado. Isso eu
não pude verificar localmente porque os pools estão fora da árvore, e registro como alegação dele.

**A inviabilidade sobrevive à correção**, com os tamanhos que ele calculou para a seleção hipotética:
Carolina 1.600, PT.SO 800, Wikipédia 800, B2W 800 — nenhuma atribuição desses quatro blocos atende aos
cinco alvos.

**E ele achou um gargalo que eu não tinha visto: `domainSource` TAMBÉM está em `GROUP_KEYS`.** Logo
tirar só `collectionBatch` deixa cinco componentes de 800 linhas, e continua inviável — não há como
`dev` cair entre 120 e 280 humanos nem `cal-A` entre 320 e 480. **Conclusão: (2) sozinha não resolve, e
(4) sozinha também não.** Isso derruba a minha saída (4) como conserto de identidade, porque ela
precisaria mexer em dois eixos e não em um.

**Julgamento sobre a minha saída (4).** O núcleo conceitual está de pé — para base pública estática, a
execução local de um extrator determinístico não é a unidade causal de dependência, e "material-fonte",
"evento de aquisição" e "execução de extração" são coisas diferentes. O que não se sustenta é o salto
"o metadado já existe, basta derivá-lo": só a Wikipédia preserva versão concreta de snapshot
(`snapshotVersion`); data documental não identifica evento de coleta, e agrupar retroativamente por mês
ou ano seria fatiamento convencional — exatamente a armadilha que eu mesmo havia apontado, aplicada à
minha própria proposta; o manifesto revisado não tem inventário de lotes humanos, versão/digest de
material nem janela de aquisição; e a política **verificada por mim** fixa `newDownloadsAllowed: false`,
permite só `b2w-reviews01`/`carolina`/`ptwiki` e bloqueia PT.SO por `access-terms-unresolved`. Ironia
útil: a condição de desbloqueio do PT.SO exige "registro verificável de data e mecanismo de aquisição"
— precisamente o metadado que (4) supunha existir.

**O CONSENSO — uma quinta saída, e concordo com ela.** Não é a (3). A diferença é científica e é o
ponto: emendar a pré-inscrição para caber na estrutura observada é ajustar o alvo depois de ver os
dados; **abandoná-la declarando inviabilidade estrutural verificada ANTES do holdout, preservá-la como
artefato imutável, e publicar uma nova pré-inscrição prospectiva** é prática aceita. Nenhum resultado do
bloco cego foi consultado, e é isso que mantém a nova versão genuinamente prospectiva. Se fosse preciso
escolher entre (1) e (4), ele escolhe **(1) com emenda formal**, e eu também.

O que a quinta saída exige, em código: eliminar o fallback `extraction_{fname}`; separar
`sourceMaterialBatch` de `extractionRun`, para que execução local não vire unidade estatística;
registrar lotes humanos no manifesto com `batchId`, `sourceId`, versão/digest imutável do material,
janela/evento de aquisição e evidência; extratores recusando lote ausente ou ambíguo; **decidir
explicitamente se `domainSource` é unidade de dependência ou apenas estrato — hoje é os dois, e é isso
que impede lotes independentes do mesmo domínio de ajudarem o split**; e um preflight de viabilidade
sobre tamanhos e intervalos temporais dos componentes, exigindo solução 45/5/10/20/20 ±0,02 antes da
montagem.

Em documento: registrar os números e a razão do abandono, deixando explícito que o holdout não foi
consultado; publicar nova pré-inscrição e novo dataset ID em vez de editar a existente; definir
"documento de origem", "lote de material", "evento de aquisição", "execução de extração" e "estrato de
domínio"; e declarar PT.SO fora até a condição jurídica ser satisfeita.

**O que isto NÃO é: decisão do agente.** Abandonar uma pré-inscrição e publicar novo dataset ID mexe no
registro científico do projeto. Fica como decisão do operador, com o consenso e a medição em mão.

**O que isto NÃO bloqueia: o E2.** A migração para cinco partições continua correta e necessária para
qualquer corpus que venha, o código está verde, e `release` já estava indisponível. O E2 fecha pela
rodada 9; a pré-inscrição é item próprio e maior.

### Rodada 9 do cross-review do E2 — REJEITADA, e a minha guarda completou o ciclo forte-demais → fraca-demais (2026-08-01)

Veredito **(c) rejeitar**: dois P1 e dois P2. **Os dois P1 são das guardas que eu escrevi nas rodadas 7
e 8** — quarta rodada seguida assim, e agora o padrão está nomeado com precisão suficiente para virar
regra.

| # | achado | conserto |
|---|---|---|
| 1 | **P1 — a guarda Python validava SÓ as frações, e o contrato tem mais dimensões.** Na rodada 8 ela era forte demais; consertei a dimensão das frações e ficou **fraca demais**. Ele reproduziu dois contraexemplos: um componente `train ↔ test` termina em `train` com frações legais (`46/5/10/20/19`) e a guarda aceitava, mas a auditoria reprova porque `earliest(test)` deixa de ser estritamente posterior a `latest(train)` — texto do período de teste dentro do treino; e o mesmo componente marcado como reserva continuava aceito, porque a guarda ignorava `held_out`, enquanto o splitter dá precedência à reserva e falha por inelegibilidade temporal | a guarda passou a espelhar **todas** as condições que um corpus estampado já determina: frações por classe, `test` estritamente mais novo que cada uma das outras QUATRO (inclusive `train`, porque é o fallback e absorve straddlers), as três do meio ordenadas earliest-contra-latest entre si, e precedência da reserva — que agora é passada como parâmetro. Onze testes, com os três casos mínimos que ele pediu: `train ↔ dev` pequeno ACEITO, `train ↔ test` legal nas frações RECUSADO, reserva realizando fora de `test` RECUSADA. **O fixture também estava incompleto:** não estampava `createdAt`, então todos os tempos eram 0 e nenhuma relação temporal era decidível |
| 2 | **P1 — a guarda "independente do dataset" publicava auditorias internamente contraditórias**, e é justamente a que `publish-evidence` alcança. Ela relacionava `passed` com `reasons` e com mais nada. Re-selando o fixture com todos os digests recalculados, ele fez passar: `passed: true` com `reasons: []` **e uma leakage real**; `classFractions.human.train = 0`; e `criticalSliceSamples = "abc"`, publicado como contagem `3` pelo sanitizador | entraram as implicações internas decidíveis sem dataset: leakage ou lacuna de eixo declarado ⇒ recusa; formas de `leakages`, `criticalSliceSamples` e `declaredAxisGaps` fechadas como array; frações publicadas contra os alvos congelados ± tolerância, **pulando classe ausente** (soma zero), que é a mesma regra de vacuidade da auditoria; e os cutoffs publicados contra as relações temporais que a auditoria afirma |
| 3 | **P2 — a seed continuava apresentada como CAUSA da atribuição**, contradizendo a F1-5p em três lugares: o comentário do desempate em `split.ts`, o da proveniência em `split-artifact.ts`, e a mensagem de erro "at seed" | os três reescritos. O desempate passou a dizer o que faz — ordena a ITERAÇÃO de componentes com `minCreatedAt` idêntico, e não seleciona colocação, porque `assignPartition` decide pela faixa de tempo do componente contra os cortes e cada partição é reordenada por id depois |
| 4 | **P2 — comentários proibidos remanescentes, e um deles FALSO:** `fit.ts` dizia "ALL non-test records" quando o código usa apenas `dev ∪ cal-A` | reescritos; a população passou a ser nomeada pelo que é. Saíram também "KNOWN DEFECT, deliberately not fixed here", "whoever touches", a narrativa de Vitest/Playwright em `score.ts`, e a de comportamento anteriormente aceito em `split-artifact.ts` |

**Um teste teve de ser DIVIDIDO em dois, e o motivo é a guarda nova.** A forja de frações usava
`human.train = 0.99` para provar re-derivação, e agora a coerência a recusa antes, sem dataset — o que é
estritamente melhor. Mas a propriedade de re-derivação continuava precisando de prova, então a forja
virou duas: `0.46` fica **dentro** da tolerância, é o que a política aceitaria e o corpus nunca produziu,
e só a re-derivação pega; `0.99` fica fora, e prova a coerência.

**O que ele confirmou:** o corte da F1-5q não tem contradição — os três documentos declaram o abandono e
o adiamento do código, a política congelada não foi alterada, e ele não considera isso expansão indevida
do E2.

**A REGRA que sai daqui, porque quatro rodadas seguidas produziram a mesma família de defeito.** Rodada
7: implementei a intenção da guarda em vez do contrato que ela espelha. Rodada 8: implementei a minha
inferência sobre o contrato. Rodada 9: implementei um SUBCONJUNTO do contrato. As três são a mesma coisa
vista de ângulos diferentes, e a correção é procedimental, não conceitual: **antes de escrever uma guarda
que espelha outro módulo, enumerar no disco TODAS as condições de falha daquele módulo, listá-las, e para
cada uma decidir explicitamente "espelho" ou "não é decidível aqui, e por quê".** A auditoria reprova por
cinco coisas — vazamento, eixo declarado em `unknown`, `test` estritamente mais novo, meio ordenado, e
frações por classe. Eu havia espelhado uma. Escolher por enumeração em vez de por memória é o que impede
tanto o subconjunto quanto a condição suficiente inventada.

## F1-5q — a pré-inscrição v3 é ABANDONADA por inviabilidade estrutural, e uma nova é publicada (2026-08-01)

Decidida pelo operador em 2026-08-01, sobre o consenso com o codex registrado acima. É a quinta saída
do garfo do `collectionBatch`, e não a emenda (3).

**O que fica declarado, e a ordem importa mais que o conteúdo:** a pré-inscrição atual é declarada
inviável **antes de o bloco cego ser tocado**. Nenhum resultado do holdout foi consultado em nenhum
momento desta unidade — o lease de `ptbr-generic-v1` segue gasto por outro motivo, registrado em
2026-07-25, e nada aqui o leu. É isso, e só isso, que mantém a nova pré-inscrição genuinamente
prospectiva: abandonar depois de ver a estrutura dos GRUPOS é legítimo; abandonar depois de ver os
RESULTADOS não seria.

**A inviabilidade, com os números.** Alvos 45/5/10/20/20 por classe, tolerância absoluta de 0,02, logo
`dev` exige entre 3% e 7% de cada classe e nenhuma das cinco partições pode ficar sem presença humana.
A seleção humana que os pools legados produziriam tem componentes de tamanho Carolina 1.600, PT.SO 800,
Wikipédia 800, B2W 800 — quatro blocos indivisíveis, e nenhuma atribuição deles atende aos cinco alvos.
Retirar `collectionBatch` da conectividade não salva: `domainSource` também está em `GROUP_KEYS`, e o
resultado é cinco blocos de 800, com o mesmo impedimento em `dev` e em `cal-A`.

**O que NÃO se sustenta, e por isso não entra como conserto:** derivar lote de material da data
documental. Só a Wikipédia preserva versão concreta de snapshot; agrupar retroativamente por mês ou ano
é fatiamento convencional e não evidência de lotes independentes. A política congelada fixa
`newDownloadsAllowed: false`, admite apenas `b2w-reviews01`, `carolina` e `ptwiki`, e bloqueia
`pt-stackoverflow` por `access-terms-unresolved` — cuja condição de desbloqueio exige, textualmente,
"registro verificavel de data e mecanismo de aquisicao", que é precisamente o metadado ausente.

**DECISÃO DO AGENTE, para ratificação: `domainSource` passa a ser ESTRATO, não unidade de dependência.**
Hoje é os dois, e é isso que impede lotes genuinamente independentes do mesmo domínio de ajudarem o
split — com quatro domínios, qualquer corpus fica com no máximo quatro componentes por construção,
quantas aquisições distintas existam. O argumento: o eixo captura *de que domínio o texto é*, que é
propriedade de conteúdo e serve para relatar por fatia; não captura *que material foi adquirido junto*,
que é a dependência que o split precisa isolar. Duas edições da Wikipédia baixadas em anos diferentes
não são correlacionadas por serem ambas enciclopédicas. **A dependência passa a ser carregada por
`sourceMaterialBatch`**, que é o que a nova pré-inscrição tem de definir e exigir. Consequência que
aceito explicitamente: as fatias por domínio continuam publicadas como estrato, e nenhuma alegação de
independência passa a depender de `domainSource`.

**Escopo e sequência, decididos:**

1. **Esta decisão, em documento, primeiro** — é o que data o abandono antes de qualquer trabalho novo.
2. **O E2 fecha como está.** A migração para cinco partições é correta e necessária para qualquer corpus
   que venha, o código está verde, e `release` já estava indisponível. Injetar mudança de esquema de
   manifesto aqui invalidaria a rodada de revisão em curso e misturaria duas unidades.
3. **A metade em código é UNIDADE PRÓPRIA**, e a ordem dela é ditada pela decisão do `domainSource`
   acima, porque todo o resto depende de qual eixo carrega dependência: eliminar o fallback
   `extraction_{fname}`; separar `sourceMaterialBatch` de `extractionRun`, para que execução local de
   script não vire unidade estatística; inventário de lotes humanos no manifesto revisado com
   `batchId`, `sourceId`, versão/digest imutável do material, janela ou evento de aquisição e a
   evidência correspondente; extratores recusando lote ausente ou ambíguo; e um **preflight de
   viabilidade** que exija solução 45/5/10/20/20 ±0,02 sobre os tamanhos e intervalos temporais dos
   componentes **antes** da montagem — a guarda que o E2 acabou de aprender a escrever pelo contrato.
4. **Novo dataset ID e nova pré-inscrição**, publicados como artefato novo. A pré-inscrição atual é
   preservada imutável e marcada como abandonada, com estes números e este motivo.
5. **PT.SO fica fora** até a condição jurídica do termo de acesso de 2024 ser satisfeita.

**Referência obrigatória:** `docs/references.md` § 2.2g.

## "Gasto" tem três pareceres na arquitetura, e só um deles é contradição (2026-08-02)

Levantamento pedido pelo operador, que contestou a afirmação de que o `ptbr-generic-v1` estaria
gasto. **Ele estava certo e eu estava errado.** As fontes foram lidas uma por uma; o resultado é que
a arquitetura é **coerente quanto à granularidade** e **incoerente quanto ao conjunto de partições
protegidas**.

| fonte | sobre o que emite parecer | o que diz |
|---|---|---|
| `holdout-ledger.ts` | a tupla `datasetDigest`+`splitDigest` | aquela execução já rodou. Re-cortar o mesmo material gera outra tupla e **este ledger a aceitaria** |
| `cluster-exposure-ledger.ts` | cluster e conteúdo | graduado: linha de `test` consumido sai de tudo; cluster exposto perde **só** `test` |
| R2 (plano v3 §0, linhas 375-405) | a cegueira informacional | é a autoridade, e existe **para ninguém a ler como mais estrita do que ela é** |

O ledger de exposição declara ele mesmo que a identidade do ledger de holdout é "the right identity
for 'was THIS evaluation already run', and the **wrong** one for 'is this block still blind'". Os dois
coexistem por desenho e não se contradizem: respondem perguntas diferentes.

### A assimetria de R2, que é a resposta

| objeto | o que a exposição custa | imposição no código |
|---|---|---|
| cluster exposto em qualquer partição | elegibilidade para `test` **e só** | `cluster-exposure-ledger.ts:1958` (`if (record.partition !== "test") continue;`) |
| registro-linha de `test` consumido | sai das cinco partições, de vez | `:1940-1955`, via `consumedContent` |

Verificado no código de hoje: a regra de conteúdo roda para **qualquer** partição proposta; a de
cluster roda **somente** quando a partição proposta é `test`.

E o parágrafo de R2 que fecha a questão, porque nomeia o que o ledger **não** cobre: "mesmo autor,
thread, página, seed e linhagem estão cobertos; **mesmo estrato, lote, época, receita ou dependência
semântica não estão.** Dizer 'independente' sem essa lista é exatamente o que R7 proíbe."

### RETRATAÇÃO: quatro erros meus nesta conversa, todos na mesma direção

1. **"o `ptbr-generic-v1` não pode mais ser usado"** — largo demais. Metade das linhas é material
   recuperável, com prova por registro e por cluster.
2. **"o material está descegado, porque sabemos quais registros o modelo erra"** — este é
   conhecimento de nível de **estrato**, que R2 declara fora de cobertura e cuja exclusão o ledger
   justifica como "a shutdown, not a control". Eu li R2 como mais estrita do que ela é, que é
   precisamente o erro contra o qual o parágrafo 386-397 foi escrito.
3. **"código de produção"**, dito de `cluster-exposure-ledger.ts` para lhe dar autoridade sobre o
   splitter. **Não existe produção:** zero tags de git, `issuedAt: null`, `evidenceDigest: null`,
   `gateDecision: pending`. Nunca foi empacotado. Os dois módulos são rascunhos não exercitados e o
   argumento de cada um vale pelo mérito, sem deferência por antiguidade.
4. **"não existe mecanismo para aposentar material"** — `retirement` já é um dos quatro
   `CLUSTER_EXPOSURE_EVENT_TYPES`. Faltava a regra de quando disparar, não o mecanismo.

O padrão dos quatro é o mesmo: presumir a leitura estrita sem medir. Todos foram achados pela
insistência do operador, nenhum por eu reler o que havia escrito.

### DECISÃO DO AGENTE: `cal-B` herda a barreira de `test`

| campo | conteúdo |
|---|---|
| decidida por | agente, 2026-08-02, por delegação |
| o quê | a barreira de cluster exposto passa a cobrir **as duas partições cegas**, `test` e `cal-B`, e não só `test` |
| razão | a tabela de R2 diz que cluster exposto segue elegível para "train, dev e **cal**". Foi escrita quando `cal` era **uma** partição, olhada. O E2 partiu `cal` em `cal-A` (olhada) e `cal-B` (**privada e byte-intocada até a v2.0**, plano da v1.0). Uma barreira que nomeia partições pelo vocabulário anterior à migração protege o conjunto errado — e `cal-B` é onde a calibração conformal da medição v2 é construída |
| custo de reversão | uma linha de predicado mais os testes. **Mas o custo real é de viabilidade, e vai contra a escassez:** barrar cluster exposto de `cal-B` retira as linhas recuperadas de 20 % do corpus, não só de 20 % |
| a alternativa, para o operador poder revertê-la | se o papel de `cal-B` for julgado como não exigindo cegueira de cluster, a barreira fica em `test` e **R2 tem de trocar "cal" por `cal-A` explicitamente, com o argumento escrito**. O que não pode ficar é a palavra ambígua |
| ratificar antes de | **a montagem do corpus novo** — decide quais linhas podem entrar em `cal-B` |

**Referências obrigatórias:** `docs/references.md` § 3 (Vovk, Gammerman & Shafer 2005 — exchangeability
como *condição* da cota conformal; Papadopoulos et al. 2002 — o quantil em `cal-B`) e § 2.4 (Cawley &
Talbot 2010 — a separação `cal-A` × `cal-B` e a proibição de verificar cobertura conformal no próprio
`cal-B`). A âncora de R2 permanece Dwork et al. 2015, § 1.1.

#### Etapa 1 (Fable) sobre este desenho, e o que ela achou que eu não havia visto

Rodada em 2026-08-02, antes de qualquer código, com o Fable no lugar do codex (ver § "Substituição
temporária do revisor"). Três achados que mudaram a implementação:

1. **O gate carrega DUAS checagens, e a decisão nomeava uma.** `partition !== "test"` guardava a
   checagem de cluster **e** o rastreio de quase-duplicata histórica. **Resolvido: as duas estendem
   juntas.** A razão que aceitei: uma paráfrase de documento exposto em `dev` quebra a exchangeability
   de `cal-B` exatamente como quebraria a cegueira de `test`; e estender só uma criaria uma **terceira
   regra que ninguém argumentou**, dentro de uma tabela que existe justamente por enumerar duas.
2. **Nenhum teste ficava vermelho ao reverter a barreira.** Toda asserção de
   `cluster-exposed-previously` no arnês nomeia `partition: "test"`; nenhuma fixture oferecia a
   `cal-B`. É a mesma mina que as listas do `fit` já pisaram — fixture que deixa `cal-B` vazia deixa a
   guarda verde sob mutação.
3. **Uma sobre-extensão perigosa, que eu poderia ter feito por simetria:** alargar `inTest` em
   `buildIndex` para "qualquer partição cega" **reinterpretaria eventos já em disco** como consumidos
   em todo lugar. Estender o gate de OFERTA é forward-only e não reinterpreta byte nenhum; estender o
   índice não é. Fiz a primeira e **não** a segunda, e o teste R5a existe para prender isso.

#### Medição de mutação, feita e não estimada

Linha de base verde confirmada antes de mutar (78 testes no arquivo), restauração em `finally`,
backup conferido por `diff` depois — idêntico. Bytes capturados e decodificados à mão, porque
`text=True` no Windows usa cp1252 e a vitest emite UTF-8.

| mutação | vermelhos | quais |
|---|---:|---|
| gate revertido para `partition !== "test"` | **4** | as quatro de `cal-B`: cluster sob id/tupla/texto novos, quase-duplicata sob cluster novo, filho de linhagem, e o cluster de linha congelada em `cal-B` |
| gate removido (o alargamento) | **8** | as de admissão — a assimetria morre e o "shutdown, not a control" aparece |

#### LACUNA NOMEADA, registrada e deliberadamente NÃO implementada

A proteção de "esteve numa partição cega" é **assimétrica entre as duas cegas**, e a decisão acima é
silenciosa sobre isso. Registro-linha congelado em `test` sai das cinco partições para sempre;
registro-linha congelado em `cal-B` não ganha proteção nenhuma — nada o impede de entrar no `dev` de um
corpus posterior, ser olhado lá, e descegar retroativamente o `cal-B` ainda vivo em que ele está.
Silencioso também: o que a **consumação** de `cal-B` pela v2.0 faz com os registros-linha dele, já que
o quantil conformal é literalmente "lido pelo processo", que é o critério da própria tabela.

**Não implementado agora de propósito:** consertar qualquer das duas exigiria alargar `inTest`, que é a
reinterpretação retroativa do achado 3. Precisa de decisão própria, e ela vence **antes da v2.0 ou
antes de um segundo corpus sobrepor um split vivo** — o que vier primeiro. O teste R5a fixa o escopo
registrado, para que qualquer alargamento futuro seja ato consciente e não deriva.

#### Consequência operacional que a decisão implica e não operacionalizava

`eligible` é tudo-ou-nada: uma recusa reprova o `commit-split` inteiro. Depois desta mudança, **o
primeiro `commit-split` após qualquer exposição-piloto será recusado por inteiro** se o splitter tiver
posto um cluster recuperado em `cal-B`. E o splitter não pode saber o conjunto barrado sozinho — os
digests vivem sob o keyring privado. O laço é **preflight → reatribuir as linhas recusadas fora das
partições cegas → re-cortar**, e ele precisa estar no runbook de montagem antes da primeira tentativa.

#### Correção do custo de reversão que eu havia registrado

"Uma linha de predicado mais os testes" **subcontava**. São também quatro docstrings e uma linha de
tabela normativa em R2 — e a metade documental é exactamente a que foi pulada quando o vocabulário se
moveu no E2, que é a origem deste achado inteiro.

#### Etapa 3 (Fable, no lugar do codex) — veredito (b), nenhum P0

Nove itens do contrato **entregues**, com `file:line` de prova em cada um; os sete testes exigidos
presentes e discriminando de verdade. As duas contagens de mutação foram verificadas
**analiticamente** por ele (não podia rodar mutação, por ser leitura-apenas) e batem exatamente — e
ele explicou os 8 do alargamento melhor do que eu: três admissões explícitas mais **cinco testes de
ciclo de vida** cuja segunda mutação compartilha o `author` default com um registro já exposto, um
deles recusando dentro da transação antes de chegar ao escritor que o teste queria exercitar.

**O P1, e ele é sobre mim.** A varredura de vocabulário consertou **exatamente os quatro comentários
que o contrato listou e parou ali**. Sobraram três irmãos no mesmo módulo dizendo "test eligibility"
onde agora está em jogo elegibilidade às duas cegas — e **um deles é a mensagem de recusa que o
operador lê durante um incidente** de histórico perdido (`CLUSTER_LEDGER_HISTORY_ABSENT`). Um operador
triando aquela recusa concluiria que só `test` está em risco e trataria re-cortar `cal-B` como seguro.

Isso é **a mesma falha que originou esta unidade**: quando o vocabulário se moveu no E2, a metade
documental ficou para trás. Eu a repeti dentro do conserto dela, com a lista do contrato funcionando
como teto em vez de piso. A regra que tiro: **lista de contrato é piso; a varredura é por termo, no
módulo inteiro, e se prova com `grep` do termo antigo saindo vazio.**

**E a regra se pagou no mesmo commit em que foi escrita.** Rodado o `grep` que ela exige
(`test eligibility|test-ineligible|future test block|barred from test|non-test`), ele **não** saiu
vazio: achou **três sítios a mais no arquivo de teste**, que nem a minha varredura nem a etapa 3
haviam pegado — o nome do `describe` da aceitação 1, o comentário do argumento do shutdown, e o
docstring do bloco de cauda perdida. A etapa 3 varreu o módulo por este termo e o teste só por
"non-test", que era o que o contrato listava. Sem o `grep`, a regra teria nascido falsa no commit que
a escreve. Os três estão consertados e o `grep` sai vazio agora — é essa saída vazia, e não a lista de
achados de ninguém, que é a evidência.

Os quatro P2, todos consertados: o docstring de `BLIND_PARTITIONS` afirmava que só os testes de
oferta pegam a troca `cal-A`/`cal-B` — falso, o teste de igualdade também pega; R5b iterava a
**constante de produção**, ficando vacuoso sob constante vazia e acompanhando a troca sob troca
(fraqueza que eu havia levantado e ele confirmou — agora está fixo em literal, como R3 já fazia);
cabeçalho do arquivo de teste dizendo "oito testes de aceitação"; e vocabulário residual de
`test`-apenas em dois outros pontos do plano v3.

Nenhum dos cinco toca comportamento, formato persistido nem o gate.

### Inventário de recuperação do `ptbr-generic-v1`, por célula

Calculado da tabela de distribuição já publicada em `docs/detector-rebuild-assessment.md` (§1) e da
composição do corpus medida em `records.jsonl` — **nenhuma leitura de `test` foi feita para isto**.

| fonte (célula da cota) | linhas humanas | onde estavam | recuperável | morto |
|---|---:|---|---:|---:|
| Wikipédia (`encyclopedic`) | 800 | `test` | 0 | **800** |
| PT.SO (`qa-informal`) | 800 | 400 `dev` + 400 `test` | 400 | 400 |
| B2W (`social-media`) | 800 | 400 `dev` + 400 `cal` | **800** | 0 |
| Carolina (`university` + `institutional`) | 1.600 | 800 `cal` + 800 `test` | **800** | 800 |
| **total** | **4.000** | — | **2.000** | **2.000** |

**E o número que vale é 1.600, não 2.000:** as 400 linhas recuperáveis do PT.SO estão bloqueadas por
A1 (termo de acesso de 2024), então são recuperáveis pela cegueira e indisponíveis pela licença.

**O que isso muda no dimensionamento**, contra o piso de ≈20 mil linhas humanas:

- partições não cegas (`train` 45 + `dev` 5 + `cal-A` 10 = 60 %) ⇒ 12.000 linhas, e é só aqui que as
  1.600 entram — cobrem **13 %** desta necessidade;
- partições cegas (`cal-B` 20 + `test` 20 = 40 %) ⇒ 8.000 linhas, **todas de cluster nunca exposto**.
  As 1.600 cobrem **zero** aqui, e sob a decisão acima isso passa a valer para `cal-B` também;
- **material novo necessário: 18.400 linhas humanas**, das quais 8.000 de cluster inédito.

Ou seja: a recuperação encurta a coleta em **8 %**, não em um sexto como eu havia estimado a olho.
Ela não é o alívio que a conversa sugeriu — mas é uma medição, e substitui a presunção de que o
corpus inteiro havia queimado.

**Uma leitura minha, marcada como leitura:** o piso `samplingUnits: 250` por célula, lido junto com a
aritmética da cota (`1 − α^(1/n)` com n = componentes por célula) e com o fato de o FPR ser medido em
`test`, implica **≥250 componentes independentes por célula dentro de `test`** — ou seja ≥1.000
componentes inéditos só ali, com 4 células. Não achei essa leitura escrita em lugar nenhum, e ela é
mais restritiva que a contagem de linhas. Vale conferir antes de dimensionar a coleta.

### O que fica DEFERIDO, e por qual regra

A enumeração **por registro** das linhas sobreviventes exige ler a atribuição de partições em
`out/split/split-artifact.json`, que é pertença de `test`. Regra condicional 8 ("tocaria
`test`/`cal-B`/ledger real → para e pergunta. Sempre.") se aplica, e o inventário por célula acima é
suficiente para dimensionar a coleta. **Não foi feito, e não deve ser feito sem autorização
explícita** — o pedido de rodar o inventário não é autorização para isso, porque a conversa não o
nomeou.

### O silêncio que a varredura encontrou, e que não é contradição

Nada na arquitetura trata da liberdade de escolher **eixos, semente ou alvos** já conhecendo
desfechos. Não é vazamento: o splitter é determinístico e nenhum humano coloca linhas. Mas a escolha
dos eixos é humana, e o único mecanismo contra isso é prospectividade — que é exatamente o que a
F1-5q faz ao declarar a pré-inscrição nova antes de tocar em qualquer coisa. Registrado como silêncio
nomeado, não como pendência de código.

### E a contradição irmã, que esta varredura confirmou de outro ângulo

`GROUP_KEYS` (splitter) e `EXPOSURE_IDENTITY_AXES` (ledger) discordam sobre os mesmos eixos:

```
GROUP_KEYS            = author, source, domainSource, generatorVersion,
                        promptTemplate, collectionBatch, nearDuplicate, derivationRoot
EXPOSURE_IDENTITY_AXES = author, source, humanSeed, derivationRoot
```

`domainSource` e `collectionBatch` **unem** no splitter e são **excluídos** no ledger, cuja razão
escrita é: "both shared by design across thousands of rows, so comparing them would make every future
record-line test-ineligible the moment one row of its stratum was ever exposed. **That is a shutdown,
not a control.**"

Isso muda o texto da ratificação pendente de `domainSource`: ela não adota posição nova — **faz o
splitter concordar com o ledger**. E aperta a decisão, porque exatamente um dos dois está errado: se
`domainSource` carrega dependência, o ledger devolve elegibilidade a `test` que deveria barrar; se não
carrega, o splitter fecha o corpus por nada. Não há leitura em que os dois estejam certos.

`humanSeed` divergindo na direção contrária (identidade plena no ledger, só `parentLinkage` no
splitter, com 782 de 783 referências não resolvendo) mostra que não é o ledger sendo simplesmente mais
frouxo: são **duas teorias diferentes de unidade amostral** convivendo, cada uma argumentada no seu
próprio docstring.

## As oito guardas de integridade do pacote, e o mapa que estava errado (2026-08-02)

Unidade só de teste: `tests/unit/inference/model-bundle.test.ts`. Nada em `src/`, `contracts/`,
`models/` nem nos helpers mudou. **De 3 exercitadas / 8 sem teste para 11 / 0.**

### O mapa anterior estava errado em cinco pontos, e a etapa 1 os achou

O mapa foi escrito por mim, de leitura, na sessão anterior. Os erros, na ordem em que teriam custado:

1. **"Todas passam por `crossValidateRuntimeDescriptor`" é falso para duas.**
   `MANIFEST_SCHEMA_INVALID` e `SOURCE_LOCK_INVALID` são lançadas pelos parsers dentro de
   `loadRuntimeDescriptor`, que o cross-validator **nunca chama**. A frase de abertura contradizia a
   tabela do próprio mapa, cujas referências de linha apontavam para os helpers certos.
2. **Silêncio sobre interceptação de parser — o caminho mais provável para oito testes verdes e
   inúteis.** Mutar campo de release ou de perfil nas **fontes cruas** faz
   `ModelReleaseError`/`CalibrationProfileError` dispararem antes, e a guarda nunca executa. Para
   `CALIBRATION_SET_MISMATCH` a mutação sugerida pelo mapa **não toca a guarda**.
3. **A mutação de `ROLLOUT_WITHOUT_PROFILES` descrevia um estado final, não uma forja de uma
   mudança.** "Release promovido com `profiles.profiles = []`" é interceptado por
   `PROFILE_SET_MISMATCH`. A única mutação única que alcança a guarda é virar `rolloutState` no
   descritor selado **vazio**.
4. **`validSources()` não alcança cinco das oito em uma mutação** — a baseline selada é
   `bundle-verified` com zero perfis. O helper que fecha a lacuna, `tests/helpers/promoted-descriptor.ts`,
   **já existia** e o mapa não o mencionava.
5. **Omitia a alcançabilidade de três guardas** — o item abaixo, que é o achado maior.

### Três guardas são inalcançáveis pelo caminho parseado, e mesmo assim NÃO são código morto

`CALIBRATION_SET_MISMATCH`, `ROLLOUT_WITHOUT_PROFILES` e `BUNDLE_VERIFIED_WITH_PROFILES` **não podem
disparar** num descritor vindo de `loadRuntimeDescriptor`. **Mas a razão não é o parser de release, e
a minha primeira redação disto estava errada — a etapa 3 a corrigiu.**

`parseModelReleaseDescriptorV1` constrange `rolloutState` contra `release.profileDigests` e **nunca
contra o ARQUIVO de perfis**, que é de outro parser. Então um descritor plenamente parseado **pode**
carregar `indicator` com arquivo vazio. O que fecha o caminho das duas guardas de rollout é
`PROFILE_SET_MISMATCH` recusar antes delas — e isso significa que **reordenar as guardas reabre o
caminho**, coisa que atribuir a prova ao parser esconderia.

E para `CALIBRATION_SET_MISMATCH` não é "uma guarda anterior recusa": a igualdade de conjuntos que
`PROFILE_SET_MISMATCH` força, mais o sort-e-dedupe dentro de `computeCalibrationSetDigest`, tornam a
**condição em si** falsa. Ali nada recusa, porque não há o que recusar. Minha frase "sempre há uma
guarda anterior que recusa primeiro" era exata em dois terços.

**Mas elas têm chamador de produção:** `src/inference/inference-worker.ts` revalida o descritor que
chega por `postMessage`, e o comentário dele já carrega a regra — o worker não pode verificar quem
validou antes dele. Ali o domínio de entrada é "qualquer objeto clonável", incluindo releases que o
parser nunca viu. Então **chamada direta ao cross-validator é o modelo fiel desse chamador**, não um
atalho em volta do parser, e é materialmente diferente dos precedentes de guarda inalcançável do
`benchmark/` (`PREDICTION_UNKNOWN_ID`, `PROFILE_DIGESTS_MISMATCH`), que não tinham entrada não
confiável nenhuma. Os três testes dizem isso em comentário e **nenhum afirma alcançabilidade pelo
caminho parseado**.

### A armadilha de asserção, específica deste módulo

`RuntimeDescriptorError` **não repete o código na mensagem** — ao contrário de
`CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED")`. Então `rejects.toThrowError("CODIGO")`
falha **até contra o erro correto**, e essa falha empurra quem escreve para o `rejects` pelado, que
passa para qualquer rejeição — inclusive a de outra guarda. Toda forja afirma `code` exato.

A prova de que o mascaramento é real e já aconteceu aqui: o teste existente "never constructs the host
when the descriptor JSON is invalid" **pretendia** `MANIFEST_SCHEMA_INVALID` com
`bundleDigest = "not-a-sha"`, mas com aquele `throw` desligado o manifesto malformado seguia e
`RELEASE_IDENTITY_MISMATCH` recusava de todo modo — `rejects.toBeDefined()` ficava verde. É por isso
que a guarda constava sem teste apesar de o teste existir.

### Medição de mutação: 8 de 8, um vermelho cada

Linha de base verde antes de mutar (2497 na suíte inteira), uma guarda por corrida
(`throw new RuntimeDescriptorError("CODIGO"` → `void new ...`, mesma aridade), fecho = **suíte
inteira** para que nenhum consumidor do módulo fique fora, restauração em `finally` conferida por
`diff` — idêntica.

| guarda | vermelhos |
|---|---:|
| `MANIFEST_SCHEMA_INVALID` | 1 |
| `SOURCE_LOCK_INVALID` | 1 |
| `PROFILE_IDENTITY_MISMATCH` | 1 |
| `DUPLICATE_PROFILE` | 1 |
| `PROFILE_SET_MISMATCH` | 1 |
| `CALIBRATION_SET_MISMATCH` | 1 |
| `ROLLOUT_WITHOUT_PROFILES` | 1 |
| `BUNDLE_VERIFIED_WITH_PROFILES` | 1 |

**Exatamente um vermelho em cada** é o sinal que se queria: cada guarda é pega por um único teste, sem
ambiguidade sobre qual teste exercita qual — e sem nenhum teste ficando vermelho por dano colateral.

### Etapa 3 (Fable) — veredito (b), nenhum defeito de comportamento

Ela reproduziu a linha de base rodando a suíte (2497) e verificou a tabela 8×1 analiticamente: desligar
um `throw` só converte recusa em resolução, então só teste que **espera** recusa por aquela guarda pode
ficar vermelho — e um `grep` dos oito códigos em `tests/` mostra que os únicos outros usos miram as
reimplementações `.mjs` de `scripts/`, intocadas por mutação em `src/`. Nenhuma forja recusa pela guarda
errada, nenhuma mutação toca dois campos, nenhuma violação de `structuredClone`.

**O P1 era meu, e do exato tipo que esta unidade existe para eliminar: um comentário ensinando ordem de
guardas falsa.** Eu escrevi que forjar o digest do arquivo "seria pego por `CALIBRATION_SET_MISMATCH`
primeiro". Não seria — `PROFILE_SET_MISMATCH` dispara antes, porque está antes. A razão verdadeira de a
mutação no lado do RELEASE ser superior é outra: com o `throw` desta guarda apagado, a forja pelo release
**resolve** (vermelho mais forte), enquanto a forja pelo arquivo cairia numa recusa de código errado.
O teste estava certo; o comentário ensinava mentira, no único lugar cujo produto é verdade sobre ordem.

### Dívida registrada, fora do escopo desta unidade (regra condicional 3)

As três guardas que **já** eram exercitadas — `ARTIFACT_MISMATCH`, `RELEASE_IDENTITY_MISMATCH`,
`PROFILE_EXPIRED` — seguem afirmadas por `rejects.toBeDefined()` pelado. Elas passam sob a ordem atual,
mas passariam também pela guarda errada se a ordem mudasse: é o mesmo padrão que manteve
`MANIFEST_SCHEMA_INVALID` "com teste" e sem cobertura. Quatro asserções a apertar, unidade própria — não
alarguei o escopo desta para não misturar medição.

### Observação fora do escopo desta unidade, registrada para não se perder

A cross-validação amarra o source lock **somente** por `sourceLock.artifacts`. `modelId`, `revision` e
`baseUrl` são checados de esquema e **nunca cruzados** com o manifesto: um lock nomeando outro modelo
com lista de artefatos idêntica passa. E `experimental` com perfis passa a cross-validação — só o
parser o proíbe —, então o backstop do worker para aquele estado é apenas as checagens de conjunto.
Não consertado aqui: é mudança em `src/`, e esta unidade é só de teste.

## O source lock ganha checagem de identidade, e `baseUrl` fica como não-objetivo declarado (2026-08-02/03)

A cross-validação amarrava o source lock **só** por `artifacts`. `modelId`, `revision` e `baseUrl` eram
checados de esquema e nunca cruzados com o manifesto: um lock nomeando outro modelo, com lista de
artefatos idêntica, passava. Achado pela etapa 1 da unidade das oito guardas e diferido ali por ser
mudança em `src/`.

### A severidade, dita com honestidade — não é buraco de integridade de bytes

Isto fica escrito porque vender o conserto como maior do que é seria a mesma classe de over-claim que
R7 proíbe:

- **"a extensão roda bytes que não fixou": NÃO.** Os bytes seguem fixados por `verifyModelBundle`, que
  verifica SHA-256 de todo artefato buscado, e os digests do lock continuam comparados registro a
  registro. Forjar `modelId`/`revision` não muda byte nenhum;
- **"rotula errado a procedência": também não, em nada observável** — nada a jusante lê esses campos; a
  identidade emitida vem do manifesto;
- **o que é de fato:** ponto cego na prova de coerência **na fronteira de confiança do worker**, onde o
  domínio de entrada é "qualquer objeto clonável". O acidente realista é descritor montado de peças
  desencontradas — manifesto re-fixado com lock velho, ou ferramenta combinando objetos de dois bundles;
- **e o que o conserto NÃO compra:** quem consegue postar no worker já pode forjar um descritor
  **plenamente coerente**, porque nenhuma guarda ali compara o descritor com as constantes embarcadas.
  Barra forja incoerente e acidente, não adversário competente — mesma natureza de toda outra guarda
  daquela função.

O que o torna defeito e não não-objetivo: o docstring afirma provar que "os três níveis concordam", e o
nível de identidade do lock estava silenciosamente fora dessa prova, enquanto o de identidade do
release — mesma forma de checagem — estava dentro. Assimetria sem razão escrita é assinatura de
omissão, não de decisão.

### `baseUrl` NÃO é cruzado, e isso é decisão da etapa 1, com argumento que eu não tinha

O manifesto não tem campo correspondente. No bundle atual o valor é
`https://self-trained.invalid/<id>/<rev>/` — o TLD `.invalid` é o sinal documentado de que não existe
upstream de onde buscar. Derivar uma regra de runtime desse esquema faria a extensão **recusar um lock
que legitimamente apontasse para upstream**. Fica: checado de esquema no parser, fixado exatamente no
build por `scripts/model-lock.mjs`, ignorado em runtime — e o comentário na guarda diz isso como regra
de domínio.

### Código novo, e por que não reusar

`SOURCE_LOCK_IDENTITY_MISMATCH`. Reusar `ARTIFACT_MISMATCH` ou `RELEASE_IDENTITY_MISMATCH` destruiria o
mapeamento uma-guarda-um-código que a tabela 8×1 da unidade anterior mede — e aquela tabela é o
artefato de prova dela. Não há união fechada a estender (`code` é `string`), e `serializeWorkerError`
mapeia qualquer não-`CleanFeedError` para `INFERENCE_FAILED`, então nenhum protocolo muda.

### O que NÃO quebrou, medido e não presumido

- **o bundle selado satisfaz a checagem hoje:** `manifest.modelId === lock.modelId`
  (`cleanfeed-ptbr-v1`) e `manifest.modelVersion === lock.revision`
  (`d8f77f870fbd35a17add2498b73d906bbc299026`). Se não batesse, a guarda invalidaria o pacote embarcado
  e a unidade seria outra;
- `tests/helpers/promoted-descriptor.ts` e as fixtures: sem mudança — embutem o par selado real;
- **a ordem relativa das guardas anteriores não se move**, então as três provas de inalcançabilidade
  registradas continuam valendo verbatim. A nova entra depois de `ARTIFACT_MISMATCH` e antes do laço de
  `RUNTIME_IDENTITY_KEYS`;
- `scripts/` e as variantes de e2e: sem mudança. As reimplementações `.mjs` já impõem checagem
  estritamente mais forte (constantes exatas), em família de código separada.

### Medição de mutação: cada comparação tem o seu próprio teste, e o vermelho é por RESOLUÇÃO

As duas lançam o MESMO código, então mutá-las juntas provaria menos. Mutadas separadamente pela
mensagem, fecho igual à suíte inteira, linha de base verde em 2499:

| mutação | vermelhos | como o vermelho veio |
|---|---:|---|
| `throw` da comparação de `modelId` desligado | **1** | `promise resolved "undefined" instead of rejecting` |
| `throw` da comparação de `revision` desligado | **1** | idem |
| **PAR ERRADO** — `revision` comparado a `modelId` em vez de `modelVersion` | **12** na suíte / **9** no arquivo | resolução, e **o teste de `revision` está entre eles** |

O sinal que importa nas duas primeiras não é a contagem — é o vermelho vir de **resolução**. Com a
guarda apagada o descritor passa inteiro, o que prova que nada mais a cobria. Vermelho por recusa alheia
significaria que a forja não isola a guarda, e é exatamente o modo como um teste fica verde pelo motivo
errado.

**A terceira mutação existe porque a minha própria correção era uma alegação, e alegação minha nesta
sessão já errou duas vezes.** Ela testa o par errado diretamente. Verificado no arquivo alvo: 9 de 38
vermelhos, e a lista inclui `refuses a source lock pinning a revision other than the manifest's
modelVersion` — o teste que eu havia reescrito para essa finalidade. Ou seja a fixture nova mata o par
errado **por si**, e não por dependência dos baselines; os baselines também ficam vermelhos, o que é
segurança a mais e não o mecanismo.

Nota de arnês: o `UnicodeEncodeError` de cp1252 voltou a aparecer, agora no **print** da saída e não na
captura. A restauração havia acontecido no `finally` antes dele, e o `diff` contra o backup confirmou —
o que vale registrar é que a conferência por `diff` é o que separou "arnês falhou" de "alvo corrompido".

### Etapa 3: o P1 era um comentário meu afirmando o CONTRÁRIO do que a fixture faz

Eu pedi explicitamente que a etapa 3 checasse o **bug do par errado** — uma guarda comparando
`sourceLock.revision` contra `manifest.modelId` em vez de contra `modelVersion` passaria pelos meus dois
testes? **Passaria**, e o meu comentário afirmava a defesa exatamente ao contrário.

O comentário dizia que o valor forjado ser "distinto de `modelId`" impediria uma guarda mispareada de
passar. **Faz o oposto:** sendo distinto de `modelId`, a guarda mispareada também acha divergência, lança
o código **certo pelo motivo errado**, e o teste fica verde. Quem de fato mata o par errado são os
**testes de baseline** sobre o descritor intocado — porque a família slug (`cleanfeed-ptbr-v1`) e a
família hex (`d8f77f…`) são valores distintos, então qualquer comparação cruzada dispara no descritor
que deveria passar.

**Consertado nos dois níveis, e o segundo é o que importa:** o comentário foi corrigido, e a fixture
passou a forjar `revision` com **o próprio `manifest.modelId`**. Agora contra `modelVersion` diverge e a
guarda dispara; contra `modelId` seriam iguais e a guarda deixaria passar — então o teste mata o par
errado **diretamente**, em vez de depender do baseline três blocos acima. Valor arbitrário satisfaz as
duas leituras e prova só que alguma comparação existe.

A lição, que vale além desta unidade: **um comentário que afirma propriedade defensiva que a fixture não
tem é defeito no artefato de prova**, mesmo com o comportamento entregue correto. É a segunda vez nesta
sessão que a etapa 3 acha isso em mim — a primeira foi a ordem de guardas falsa na unidade das oito.

### Liberdade residual, nomeada em vez de testada

Uma guarda comparando contra `release.modelId`/`release.modelVersion` em vez do manifesto passaria a
suíte inteira. É equivalente para o desfecho fail-closed — o laço de `RELEASE_IDENTITY_MISMATCH` fecha o
triângulo transitivamente — e difere só em qual código é culpado quando release **e** lock divergem
juntos. Não vale teste; vale esta frase.

### Dívida pré-existente, fora do escopo desta unidade (regra condicional 3)

`src/inference/worker-protocol.ts` admite `sourceLock === undefined` na porta de forma do transporte,
então a revalidação do worker sobre um payload assim morre como `TypeError` **sem código** dentro de
`crossValidateRuntimeDescriptor`. Fail-closed, mas fora da disciplina de erro codificado que o resto do
módulo mantém. Não introduzido nem agravado aqui.

### O espelho da lição do lint: suíte verde não é typecheck verde

A primeira versão destes dois testes atribuía direto a `forged.sourceLock.modelId`. **A suíte passou
com 2499 verdes e o typecheck reprovou** — `TS2540: Cannot assign to 'modelId' because it is a read-only
property`, nos dois. A vitest transpila sem typechecar, então o erro de tipo não aparece em teste
nenhum.

O registro já carregava a lição na direção do lint ("verde de typecheck e de suíte não é verde de
lint"). Esta é a direção que faltava, e fecha a regra: **as três verificações são independentes e
nenhuma cobre a outra.** Consertado com o idioma de cast que o resto do arquivo já usa
(`(x as { campo: string }).campo = v`), que é apagado na emissão — o comportamento é idêntico, e a
medição de mutação foi refeita de todo modo, porque a regra é medir e não argumentar.

## As quatro asserções peladas, e o escopo que a etapa 1 decidiu (2026-08-03)

Dívida registrada em `70a14bd`. Unidade só de teste: nada em `src/`.

### A etapa 1 decidiu o escopo, e disse "não vale fazer" a uma das três

Eu levei três dívidas da mesma vizinhança e pedi que ela decidisse se eram uma, duas ou três unidades,
**argumentando pelo que teria de ser re-verificado junto** e não por conveniência. Veredito: **duas**.

| dívida | veredito |
|---|---|
| A — quatro asserções `rejects.toBeDefined()` peladas | **vale**, e vai primeiro: é só teste, e afia o instrumento em que todas as provas desta vizinhança se apoiam |
| B — `worker-protocol` admite `sourceLock: undefined` | **vale**, mas como registrada ela sub-entrega: o conserto do gate sozinho codifica **um** `TypeError` de uma família |
| C — `experimental` com perfis passa a cross-validação | **NÃO vale como registrada** |

**Por que A não pode ir junto com B/C:** A se verifica re-rodando a tabela de mutação por guarda, que é
o artefato de prova das duas unidades anteriores. Misturar com mudança em `src/` deixaria todo vermelho
ambíguo — "asserção apertada" ou "fronteira mudou". É literalmente a razão que eu havia escrito ao
diferir a dívida.

**E por que B e C são UMA:** as duas só existem no caminho de `postMessage`, as duas se provam com o
mesmo arnês, e o conserto certo de C **está dentro** do conserto certo de B.

### O veredito sobre C, que é o achado mais valioso desta etapa

C como registrada era "acrescentar guarda de `experimental`-com-perfis ao cross-validator". A etapa 1
recusa, com três razões medidas:

1. **a carga forjada é inerte no worker** — `experimental` cai no ramo "estado não promovido ⇒ só
   estilométrico" do catálogo, `calibrated` fica falso, e o registro de calibração só é construído
   quando `calibrated`. Os perfis forjados nunca se ligam a decisão nenhuma;
2. **é inalcançável em todo caminho parseado**, pelo mesmo argumento das outras três provas;
3. **e cura uma assimetria criando a próxima:** `assertRolloutInvariants` possui **cinco** invariantes
   de rollout, e o cross-validator não re-litiga nenhum dos outros quatro — um release `actions` com
   `gateDecision: "reject"` passa por ele igualmente. Re-litigar um e ignorar quatro exigiria um
   docstring que não se consegue escrever.

**O conserto certo, que dissolve C dentro de B:** o runtime não deve re-litigar invariante que o parser
possui — deve **parar de contornar** o parser na única fronteira onde entra input não confiável. Com o
worker chamando `loadRuntimeDescriptor` antes de cross-validar, a forja de C morre como
`RELEASE_STATE_INVALID` **vinda do dono do invariante**, junto com a família inteira, e o cross-validator
não muda uma linha.

**Custo já nomeado para a unidade 2:** a história de chamador das três guardas inalcançáveis — "existem
para o descritor que chega por `postMessage`" — **fica falsa** quando o worker passar a parsear. As
guardas ficam (função exportada, chamador direto não é conhecível), a tabela 11×1 segue medível, e a
ordem não se move; mas o bloco de comentário e este registro têm de ser emendados na mesma unidade.

### O que cada pino compra, dito sem inflar

A etapa 1 foi explícita e eu registro na íntegra, porque a tentação seria dizer "quatro guardas ganharam
cobertura":

- **o teste do manifesto (`MANIFEST_SCHEMA_INVALID`) pega mascaramento demonstrado**, não hipotético: com
  a guarda desligada, o digest malformado seguia e `RELEASE_IDENTITY_MISMATCH` recusava no lugar;
- **os outros três são seguro de ORDEM, e não pegam nenhuma mutação única de hoje** que a forma pelada já
  não pegasse. Desligar cada guarda faz a forja **resolver**, e `rejects` pelado vê isso. O que os pinos
  passam a ver é guarda **inserida ou reordenada** interceptando com outro código — recusa com nome
  errado, que a forma pelada não distingue.

### Medição: o teste antes mascarado passa a pegar

Uma guarda por corrida, `throw` → `void`, restauração conferida por `diff` — idêntica.

| guarda desligada | vermelhos | quais |
|---|---:|---|
| `MANIFEST_SCHEMA_INVALID` | **2** | `never constructs the host when the descriptor JSON is invalid` **e** `refuses a manifest that does not match the sealed schema` |
| `RELEASE_IDENTITY_MISMATCH` | 1 | o teste correspondente |
| `ARTIFACT_MISMATCH` | 1 | idem |
| `PROFILE_EXPIRED` | 1 | idem |

**Os 2 do primeiro são o resultado.** Antes desta unidade aquele teste ficava verde com a guarda
desligada; agora ele é um dos vermelhos. É a mesma medição que havia diagnosticado o mascaramento,
repetida do outro lado do conserto.

Nota: os `toThrowError("MODEL_LOAD_FAILED")` que sobraram no arquivo são de **outra família** —
`CleanFeedError`, cuja mensagem repete o próprio código —, então ali o substring casa por construção e
não é a armadilha. `rejectsWith` foi içado para escopo de módulo: os quatro testes vivem no `describe` de
cross-validação e ele estava definido no de guardas de integridade, que vem depois.

### Medição pré-código da unidade 2, feita antes de escrever uma linha dela

A unidade 2 vai fazer o worker chamar `loadRuntimeDescriptor` sobre o payload que chega por
`postMessage`. Isso só é viável se um descritor **já parseado** sobreviver a um segundo parse — e se não
sobrevivesse, a unidade seria outra. Medido com andaime descartável, criado, rodado e apagado:

| descritor | sobrevive ao reparse |
|---|---|
| par selado (`models/cleanfeed-ptbr-v1/`) | **sim** |
| `promotedDescriptor()` | **sim** |
| `bundleVerifiedDescriptor()` | **sim** |

E o survey do outro lado: `tests/integration/inference-pipeline.test.ts` inicializa o worker com os
**helpers**, não com payloads degenerados montados à mão — então nenhum teste de integração depende de
um descritor que o parse recusaria. A unidade 2 está liberada como desenhada.

## Escopo da alegação: tabela por estrato, e a correção do dimensionamento (2026-08-03)

Decidido pelo operador nesta sessão, depois de ele refutar duas alegações minhas. Registro na ordem em
que as coisas foram derrubadas, porque a ordem é o argumento.

### O que o operador refutou, e é a base de tudo abaixo

Eu dizia que a cota era **inviável** com três fontes. Ele respondeu que alegar sobre "texto em pt-BR em
geral" seria **indeterminado** — literatura, poesia, prosa, conto, uma infinidade de estilos que este
modelo e estes dados nunca alcançam.

Ele está certo, e é objeção de categoria diferente da minha. Uma cota `1 − α^(1/n)` é sobre sorteios **de
uma população**. Sem moldura amostral não há estimando: a cota não é difícil, **não é sobre nada**. Com
250 componentes por célula você teria rigor sobre uma população que não sabe nomear.

Então eu errei duas vezes na mesma frase: **forte demais** para a alegação escopada, que é alcançável, e
**fraca demais** para a ampla, que eu tratei como difícil quando nunca esteve disponível — com nenhum
volume de dados.

O projeto já havia achado o mesmo por outro caminho: assessment § 3.8, resolvido como L1 em 26/07, com
`platform = generic` e `topic = geral` nos 10.000 registros e a frase *"não existe base pública licenciada
de publicação profissional pt-BR"*. A moldura não cobre nem o domínio do produto.

### RETRATAÇÃO: o "20 mil" foi coincidência aritmética vestida de convergência

Eu apresentei "20 mil linhas humanas" como convergência entre a minha derivação e o piso do E3. **São
dois cálculos sem relação:**

| derivação | conta | unidade | partição que dirige |
|---|---|---|---|
| E3, registrada na linha 248 | 4 células × 250 ÷ 5 % | **componentes** | `dev`, a **menor** |
| minha, desta sessão | 800 ÷ 20 % × 5 estratos | **linhas** | `test` |

Caírem no mesmo número é acidente. Dizer "note que é exactamente o piso do E3" foi ornamento sobre
acidente — a mesma família de defeito que esta sessão passou corrigindo em mim.

**E a coincidência escondia a consequência real:** sob a alegação escopada, a derivação do E3
**dissolve**. Os 250 componentes por célula existiam para sustentar generalização, que é a alegação
indeterminada. Ela sai, o piso de componentes sai com ela, e o 20 mil do E3 sai também. O que passa a
vincular não é piso — é **escolha de teto**.

### O piso É por célula, e a razão é a hipótese do pior estrato

Confirmado na política, e o nome é explícito:

```json
"zeroEventCeiling": {
  "adoptedFloorPerCell": 250,
  "formula": "1 - perHypothesisAlpha^(1/n)",
  "unitsBelowFloorFailBeforeSealing": true
}
```

A hipótese certificadora de FPR é **"FPR do pior estrato core"** — uma, singular. É por isso que `m=4` e
não `m = 4 + número de células`. E porque a alegação é sobre o **pior**, e não se sabe qual é o pior antes
de medir, **toda célula tem de poder sustentá-la**: se uma célula tem 100 unidades e acaba sendo a pior, o
teto inteiro colapsa para o que 100 sustenta.

**Isso corrige a minha tabela, e para melhor.** Eu montei o dial como se cada estrato fosse alegação
separada com α próprio. O desenho registrado é mais simples e mais honesto:

- **uma** alegação certificadora — teto válido em todos os estratos declarados, porque calculado no pior;
- os números por estrato publicados como **diagnóstico não certificador, sem ajuste, rotulados como tal**.

Não precisa inflar `m`, e a manchete vale para o pior, logo para todos.

### O dial, com o único ponto que não é arbitrário

FPR medido em `test` a 20 %, e `criticalFprHumanNegatives: 300` é piso de **linhas** que a política já
tem, separado do de unidades amostrais:

| linhas em `test` | teto | por célula | 5 células | origem |
|---:|---:|---:|---:|---|
| 250 | 1,74 % | 1.250 | 6.250 | escolha |
| **300** | **1,45 %** | **1.500** | **7.500** | **piso da própria política** |
| 400 | 1,09 % | 2.000 | 10.000 | escolha |
| 800 | 0,55 % | 4.000 | 20.000 | escolha minha, arbitrária |

### E as frações de partição ficam re-deriváveis

`dev` = 5 % foi dimensionada para caber 1.000 componentes. Sem o piso de componentes, `dev` volta a ser
dimensionada para o que serve — ajustar limiar e hiperparâmetro — e o `45/5/10/20/20` inteiro se re-deriva.
`cal-B` a 20 % existia para a calibração conformal da cota que saiu de cena, então pode nem ser necessária.
Isso é desenho novo para a pré-inscrição nova, não conserto do antigo.

### O escopo escolhido: cinco estratos

| estrato | fonte | em disco |
|---|---|---:|
| `encyclopedic` | Wikipédia, dump direto | 1,96 GB |
| `legislative` | Carolina | 4,48 GB (162 arq.) |
| `judicial` | Carolina | 994 MB (38 arq.) |
| `university` | Carolina | 169 MB (8 arq.) |
| `social-media` | Carolina — **tipologia nunca usada** | 51 MB (3 arq.) |

Duas tipologias da Carolina estavam em disco e sem uso, e a medição das tipologias é o que revelou:
`social media` (51 MB) e `public domain works` (4,7 MB). A primeira fecha a lacuna de "rede social", que
até agora era preenchida por **resenha de produto da B2W**. A segunda ficou fora, e foi sorte: 4,7 MB em
**2 arquivos** seria a célula vinculante e travaria tudo em ~2 obras.

`wikis` (5,59 GB) fica fora porque o runbook manda pular — near-dup com a Wikipédia direta. `datasets and
other corpora` (4,52 GB) fica fora por ser saco de gatos: é onde a variância de licença mora, e "other
corpora" levanta risco de contaminação com benchmark público.

### A B2W sai, e a razão NÃO é o resultado

O operador escolheu excluir a resenha de produto, cujo FPR medido em 25/07 foi 7,12 % (teto 9,43 %). A
opção que ele marcou já avisava que excluir depois de ver resultado é suspeito. **Mas há razão que não
depende do número, e é ela que fica registrada:**

A B2W era **substituta**. Ela preenchia `social-media` porque a tipologia de rede social da Carolina não
estava sendo extraída — B2W entrou com 800 linhas e Carolina com **zero**. Com a tipologia real
disponível, a substituta é **redundante**: troca-se resenha de produto por texto de rede social de
verdade, no estrato que sempre foi de rede social.

Isso é escopo prospectivo. E o 7,12 % entra publicado como **a razão pela qual a substituta era ruim** —
resenha tem forma retórica fixa e não é o que o estrato dizia ser —, em vez de virar número omitido.

### O que muda no pré-registro

O `quotaAxis` congelado tem **4 células por fonte**: `["b2w", "carolina-institutional", "carolina-university",
"ptwiki"]`. A lista nova tem **5**, quatro delas da Carolina e sem a B2W. Muda conteúdo e cardinalidade —
e como a pré-inscrição antiga está abandonada, entra na nova em vez de ser emenda.

### A célula institucional: judiciário sozinho, e a legislativa sai

Medido: `legislative` tem 4,48 GB — a maior em bytes — e **3.982 documentos**, porque texto legislativo é
lei e projeto inteiros: 0,89 documento por megabyte. Era a célula vinculante, e falhava o teto de 0,55 %
por **18 documentos** (precisa 4.000).

O operador pediu para juntar `legislative` com `judicial` e alegar sobre "FPR em texto judiciário".
**Juntar e rotular assim declararia 3.982 documentos legislativos como judiciários** — over-claim de
moldura, que é a classe de erro que a alegação escopada existe para não cometer.

Três saídas, e a escolhida é a terceira:

| | célula | documentos | a alegação diz |
|---|---|---:|---|
| 1 | juntar, nome honesto `institutional` | 42.171 | "institucional (judiciário e legislativo)" |
| 2 | juntar e chamar de judiciário | 42.171 | **over-claim** |
| 3 | **só judiciário** | **38.189** | "texto judiciário" — exato |

**Judiciário sozinho é melhor que o pooling que eu havia recomendado.** 38.189 documentos dão folga de
9,5× até o teto agressivo de 0,55 %; a célula vinculante **desaparece**; e o rótulo fica exato sem
negociação. O que se perde é o estrato legislativo, que era justamente o frágil.

Eu recomendei juntar porque estava tratando cobertura como valor. Com o rótulo em jogo, **descartar a
legislativa é mais limpo que diluí-la** — e é o operador quem tem prerrogativa sobre a troca, que fica
nomeada: se a cobertura legislativa valer mais que a exatidão do rótulo, junte e chame de `institutional`.

### Política de melhoria do modelo ao longo do tempo

Pergunta do operador, e a resposta divide-se em duas operações de custo muito diferente. `eligibleCandidate:
"same-weight-hash-as-v1"` é o que as separa: a medição está amarrada a **um hash de pesos**.

**Acrescentar domínio à AVALIAÇÃO — barato.** Pesos idênticos: sela-se um bloco cego só para o estrato
novo, medem-se os mesmos pesos, e a tabela ganha uma linha. As linhas antigas continuam válidas porque
nada no modelo mudou. `crossVersionAdjustment: "none"` torna isso limpo, e o preço é publicar **toda**
execução, inclusive a ruim.

**Acrescentar domínio ao TREINO — caro, e mais do que parece.** Hash novo ⇒ **todo teto publicado morre**,
não só o do domínio novo, porque o modelo mudou em todos os estratos. E se os resultados de `test` da v1
foram vistos, `test` está contaminado para a v2 — não porque as linhas mudaram, mas porque houve
adaptação sabendo. `blindReserveCompleteAttempts: 2` existe para isso, e a segunda tentativa consome a
reserva.

**Política que segue:** **agrupar** melhorias de modelo, não iterar. Cada retreino é evento de release que
custa re-medição completa; iterar queima a reserva em duas rodadas.

**E a consequência contraintuitiva:** reservar material cego na **aquisição**, não no corte — no momento do
corte todo o material já entrou no ledger. `future-holdout-reserve` já existe no vocabulário, tratado como
digest de manifesto e não como partição.

**A tensão de desenho que a pergunta revelou, e que fica ABERTA:** a alegação certificadora é "FPR do pior
estrato", então acrescentar estrato só pode **piorar ou empatar** a manchete — o desenho **pune cobertura**.
A alternativa é teto por estrato com `m` crescendo: seis estratos ⇒ `m=9`, α=0,0056, e o teto a n=300 vai
de 1,45 % para 1,72 %. Trinta centésimos de ponto é o preço de cobertura não punir o projeto. Decidir
**antes da primeira medição**, porque muda o pré-registro.

**Literatura ficcional, medida:** `public domain works` da Carolina tem **26 documentos**, inutilizável. O
Domínio Público tem milhares de obras pré-1922, com licença resolvida e **rótulo humano de graça** — obra
de 1900 satisfaz o corte pré-ChatGPT sem depender de declaração de ninguém. Mas o estilo está um século
longe do pt-BR contemporâneo, então medir ali mistura **registro literário com época**, e não se sabe qual
o número reflete. É teste de estresse, não cobertura. Ficção **contemporânea** licenciada cai no muro do
§ 3.8: não existe base pública em pt-BR.

### A célula que vincula é a menor, e megabyte não é a unidade

O que decide não é tamanho: é **quantos valores independentes de `source` (documento de origem)** cada
tipologia rende. Um XML de 20 MB com dez documentos dentro rende dez, não dez mil. `university` (8
arquivos) e `social-media` (3 arquivos) são os candidatos a vincular, e é isso que a medição seguinte
apura.

## FORMA DO ARTEFATO — DECIDIDA PELO OPERADOR em 2026-08-03: opção C, e a entrega é o MODELO

O operador preencheu o campo do documento de corte, em sessão: *"a principal entrega agora é o modelo,
não a extensão do chrome. e o modelo deve ser abstraído de toda questão técnica envolvendo a extensão do
navegador."*

É a **opção C** — detector com a tabela escopada por célula (ESTADO.md § 3.1) — com uma precisão de
forma que A e B não tinham: o artefato é o **modelo** (pesos + tokenizer + model card + tabela), e a
extensão vira consumidora downstream, fora da entrega principal. Com o campo preenchido, o gate de
parada se dissolve; a fila de endurecimento **permanece** parada até o artefato existir, e o único
documento de plano autorizado é o plano de entrega do modelo.

Custo de reversão: escolher A ou B depois custa só o descarte do plano; o corpus e o pré-registro que C
exige servem a qualquer caminho futuro (C4 preserva os blocos).

## Etapa 0 do plano de entrega — DECIDIDA PELO OPERADOR em 2026-08-03 (G0.1–G0.3)

As três, na mesma resposta, todas na direção recomendada:

| # | decisão | consequência |
|---|---|---|
| G0.1 | **`domainSource` RATIFICADO como estrato de relato**; `sourceMaterialBatch` carrega a dependência | a decisão do agente de 2026-08-01 passa de `EM-VIGOR (delegada)` a `RATIFICADA`; a Fase 1 (eixos) destrava |
| G0.2 | **manchete POR ESTRATO, `m=7`** — quatro tetos de FPR (um por célula) + recall + calibração global + integridade; α = 0,05/7 ≈ 0,0071 | supera a família `m=4` do pior estrato (B3); célula futura acrescenta linha sem degradar a manchete, alinhado à política de melhoria |
| G0.3 | **teto pretendido 1,45 %** — 300 negativos humanos por célula em `test`, 1.500 linhas por célula, **6.000 humanas no total**; com `m=7` o teto sob zero eventos é ≈ **1,63 %** por célula | dimensiona a coleta da Fase 2/3; 0,55 % fica disponível para uma v2 com o mesmo desenho |

Custo de reversão: até o congelamento da pré-inscrição nova, emenda simples; depois, R3 tranca.

## A etapa 1 da Fase 1 refutou o item 3 do plano, e o operador ratificou a releitura (2026-08-03)

O desenho da pré-inscrição nova (etapa 1, Fable) mediu que **`sourceMaterialBatch` como eixo de união do
split reproduz exatamente a degenerescência do `domainSource`**: cada fonte tem UM evento de aquisição,
então cada célula viraria um bloco indivisível, `dev` a 5 % ± 2 pp é inalcançável por construção, e o
gate de composição leria 1 < 300 para sempre. A contraprova que fazia a troca parecer viável
(`test_connectivity_feasibility.py`) usava **cinco lotes por domínio** — inventário que não existe e que
o próprio documento de lotes proíbe fabricar por fatiamento.

**Ratificado pelo operador (G0.1-bis):** `sourceMaterialBatch` carrega a dependência como eixo de
**registro, manifesto e ledger** — é o que bloqueia supercontagem e ancora a cegueira quando uma v2
acrescentar uma segunda aquisição — e **não** entra em `GROUP_KEYS`. A dependência intra-célula fica com
os eixos finos (`author`, `source`, `nearDuplicate`, linhagem). "Unidades independentes" = componentes
conexos por **documento de origem**, com ≤ 1 linha por documento por célula. A política congela
`splitUnionsOnDependencyAxis: false` como dado legível por máquina, e o preflight recusa a reintrodução
do eixo grosso.

**E a margem do piso (G0.3-bis), também ratificada:** 1.500/célula dá 300 **esperados** em `test` com
desvio ~15 — o gate reprovaria metade das montagens honestas por sorteio. A coleta mira **~1.750 por
célula (~7.000 total)**; o piso derivado de 1.500 permanece como mínimo, e o gate de 300 fica inalterado.

O contrato completo da unidade (16 itens, 6 commits A–F, 15 testes com a mutação que cada um pega, e a
tabela de ratificação da política) está no relatório da etapa 1 desta data. Dois pontos do contrato que
o desenho acertou e valem destaque: `gates.ts` deriva o inventário obrigatório de `policy.primaryFamily`
(hoje `evaluate.ts` não passa multiplicidade nenhuma e todo gate de intervalo falha fechado — D12 era
maior do que o plano dizia); e `backbone`/`onnxMaximumInt8Bytes` congelam na Fase 1 com valores de
XLM-R, porque copiar os do JSON morto (BERTimbau, 109 MB) tornaria o gate de export da Fase 4
impassável sob política selada.

## Regras condicionais (bloco D) — decididas, executam sozinhas

1. Célula < n mínimo → **sem cota**, nunca cota frouxa.
2. Bloqueante em caminho selado → conserta e re-revisa até PASS, sem perguntar.
3. Menor fora do selado → registra; lista consolidada por fase.
4. Suíte quebra em arquivo alheio → 1h de investigação; pré-existente = registra e segue.
5. Lane de geração cai → lane reserva; todas caírem → pausa só a fila de corpus.
6. Codex indisponível → fora do selado segue sem cross-review (registrado); selado espera.
   **SUSPENSA em 2026-08-02 pelo operador** enquanto o crédito do codex não voltar: o selado anda com
   revisão do Fable em vez de esperar. Ver § "Substituição temporária do revisor" para a perda de
   independência que isso custa e para a regra de que rodada do Fable não fecha dívida de codex.
7. Plano × código divergem → o código medido vence; plano emendado na mesma unidade.
8. Tocaria `test`/`cal-B`/ledger real → **para e pergunta. Sempre.**

## Processo de execução por unidade — DECIDIDO PELO OPERADOR em 2026-07-31

Três etapas, nesta ordem, para toda unidade de trabalho. **Decisão do operador**, não delegada:
ele a tomou depois de ler o custo das seis rodadas de cross-review da unidade 1 da Fase 1.

| ordem | quem | o que faz |
|---|---|---|
| 1 | **Fable** | verifica o **desenho**, antes de existir código |
| 2 | **Opus** | implementa, tendo o achado da etapa 1 como contrato a cumprir |
| 3 | **codex** | cross-review adversarial do que foi implementado |

### Por que nesta ordem, e o que cada etapa pega

A ordem vem de classificar os seis achados da unidade 1 por **causa**, não por gravidade. Três
deles — "o contrato nunca foi implementado", "promessa absoluta com mecanismo probabilístico" e
"teste que fica verde sob mutação" — têm a mesma forma: erro sobre **o que a promessa exige**
versus **o que o mecanismo entrega**. Nenhum deles precisa de código para ser encontrado, e todos
os três custaram uma rodada de revisão cada.

**Etapa 1 (Fable) responde quatro perguntas fixas**, e o resultado é escrito antes de qualquer
edição:

1. Qual é exatamente a promessa — **universal ou probabilística**, e sobre qual população?
2. O mecanismo planejado entrega essa promessa, ou uma **mais fraca**?
3. Em que **nível** a propriedade é testável, e o teste planejado distingue a implementação
   correta da errada? (teste de mutação feito de cabeça)
4. Que **armadilhas de plataforma** este código pisa? (`\b` ASCII em texto acentuado, `toSorted`
   fora do lib target, literal type onde se espera número, escape perdido em pipeline de edição)

**Etapa 3 (codex) continua obrigatória** e não é redundante: erro de **execução** só existe depois
de escrever. Os dois piores incidentes desta fase foram desse tipo — um regex com caracteres
backspace (`0x08`), que nunca casa e deixa a suíte verde, e 247 linhas duplicadas por um recorte
de string cujo fim vinha antes do início.

### O que NENHUMA das três etapas conserta

Dois dos seis achados foram falhas de **evidência** do agente, e para elas o conserto é checklist:

- **nunca reportar medição feita em estado anterior do código.** Mudou o código, re-mede. A
  afirmação "11 de 11 casos corretos" foi feita sobre uma versão que já havia sido substituída;
- **todo número ou afirmação que aparece em mais de um lugar é conferido por `grep`** antes de
  fechar a unidade. O custo do índice ficou dizendo `3×` em dois arquivos e `3,7×` num terceiro.

### Por que o modelo de implementação NÃO muda

Implementação é dominada por edição mecânica, onde capacidade extra de raciocínio não rende — e foi
exatamente na edição mecânica que os dois incidentes de execução aconteceram. Além disso, o valor
da etapa 3 vem da **independência** (outro modelo, outro contexto, sem os vieses de quem
escreveu); concentrar desenho, implementação e revisão no mesmo modelo devolveria o ponto cego que
o ciclo existe para cobrir.

### Emenda a A5

A5 continua valendo para o **nível** de revisão (adversarial só em caminho selado, uma rodada no
resto). O que esta decisão acrescenta é a etapa 1, que passa a existir para **toda** unidade, e a
expectativa de que o número de rodadas da etapa 3 caia — porque erro de categoria deixa de chegar
lá. Se não cair, a hipótese está errada e isso é medível: basta contar as rodadas por unidade.

### SUBSTITUIÇÃO TEMPORÁRIA DO REVISOR — DECIDIDA PELO OPERADOR em 2026-08-02

O crédito do codex acabou. **O operador decidiu:** o Fable assume a etapa 3 até o crédito voltar, e a
implementação segue. Registrado com a autoria dele por R4 — eu não decidi isto.

**O que esta decisão substitui.** A regra condicional 6 diz "Codex indisponível → fora do selado segue
sem cross-review (registrado); **selado espera**". Ela deixaria a barreira de `cal-B` parada até 8 de
agosto. A decisão do operador a suspende: o selado passa a andar com revisão do Fable em vez de
esperar.

**A perda, nomeada, porque ela é real e está escrita neste mesmo documento.** A justificativa da etapa
3 é: "o valor da etapa 3 vem da **independência** (outro modelo, outro contexto, sem os vieses de quem
escreveu); concentrar desenho, implementação e revisão no mesmo modelo devolveria o ponto cego que o
ciclo existe para cobrir." O Fable **é a etapa 1**. Então:

| independência | com codex | com Fable |
|---|---|---|
| de quem **implementou** (Opus) | preservada | **preservada** |
| de quem **desenhou** (Fable) | preservada | **perdida** |

A consequência é previsível e vale escrever antes de acontecer: **erro de categoria — promessa
universal com mecanismo probabilístico, contrato nunca implementado, teste verde sob mutação — não
será pego duas vezes.** É exactamente a classe que a etapa 1 existe para achar, e o mesmo modelo que
aprovou o desenho não é quem a acha de novo. O que a etapa 3 pelo Fable **ainda** pega é erro de
execução: implementação que não entrega o contrato que a própria etapa 1 escreveu, e as armadilhas de
plataforma.

**Enquadramento adotado para as rodadas do Fable**, para extrair o que resta de valor: a etapa 3 dele
pergunta primeiro "a implementação entrega o contrato numerado que a etapa 1 escreveu?", e só depois
procura defeito livre. Contrato escrito antes vira lista de verificação, e essa parte não depende de
independência.

**Rodada do Fable NÃO fecha dívida de codex.** As duas ficam contadas separadamente no registro. Duas
razões: o E2 tem doze rodadas de codex rejeitadas e uma décima terceira por outro revisor não é
comparável à sequência; e quando o crédito voltar, o operador precisa poder ver quais unidades do
selado carregam **só** revisão do Fable, para decidir se re-roda o codex nelas ou se declara
explicitamente que não vai. **Essa decisão não é tomada agora** — só a visibilidade dela é garantida.

| campo | conteúdo |
|---|---|
| custo de reversão | zero: volta a D-6 quando o crédito voltar |
| ratificar antes de | é decisão do operador, já ratificada na origem. O que fica pendente é a decisão de re-rodar ou não o codex nas unidades revisadas só pelo Fable, **no marco do retorno do crédito** |

### Primeira aplicação do processo — etapa 1 no E2 (2026-07-31)

A etapa de desenho rodou **antes** de qualquer código do E2. Relatório completo em
`.codex-reviews/e2-desenho-fable.md` (área de trabalho, fora do Git). O que ela produziu, e por
que isso é evidência a favor da etapa existir:

**A promessa, enunciada de forma falseável:** para o corpus apresentado ao comando, o split
congelado atribui cada componente conectado inteiro a exatamente uma das cinco partições, com toda
família held-out declarada inteiramente em `test`, `test` estritamente mais novo que as demais, e a
fração de cada classe a no máximo `classTolerance` do alvo 45/5/10/20/20 — **ou o comando falha
fechado sem escrever nada**. Universal e determinística sobre o corpus de entrada, não
probabilística.

**Seis riscos, dos quais quatro são exatamente as classes de erro que custaram rodada na unidade
anterior:**

1. **`cal-B` e `test` têm a MESMA fração (0,20).** Trocar as duas passa em **qualquer** teste de
   fração; só o encadeamento temporal e a regra de held-out pegam. É a classe "teste que não
   distingue a implementação correta da errada", que na unidade 1 só apareceu na quinta rodada.
2. **Filtros negativos `partition !== "test"`.** `test` é o único nome que sobrevive à migração,
   então esses filtros **compilam com significado alterado** e passariam a entregar `cal-B` ao
   `fit` — partição que tem de ficar byte-intocada até a v2. O compilador não vê nada.
   **Conferido no código, e a lista da etapa 1 estava incompleta em um e imprecisa em outro** (o
   projeto manda medir; a etapa 1 é ferramenta, não oráculo). São CINCO ocorrências, não duas:
   `benchmark/commands/fit.ts:132` (a etapa 1 escreveu `benchmark/fit.ts:132`, caminho que não
   existe), `benchmark/candidate-preflight.ts:375`, `benchmark/cli.ts:605`,
   `benchmark/cluster-exposure-ledger.ts:1951` e `benchmark/commands/evaluate.ts:163` — este
   último é uma checagem positiva invertida, então muda de natureza mas pelo mesmo motivo. Toda a
   lista tem de ser revista na migração.
3. **Viabilidade não garantida no corpus real:** `dev` a 5% ±2pp com componentes indivisíveis por
   `collectionBatch`; o piso de 2.000 negativos humanos em `test` a 20% passa a exigir **≥10 mil**
   humanos no corpus (era ≥4 mil); e a busca de cortes é O(k²) hoje, com quatro cortes a
   generalização ingênua vira O(k⁴). Redesenho real, como o plano avisa.
   *(O "≥10 mil" desta linha é o que a etapa 1 estimou e está **errado** — conferido em 2026-08-01:
   o piso que vincula é o pré-registrado, por partição, e dá ≈20 mil linhas humanas. Fica aqui como
   registro do que a etapa 1 disse, não como número em vigor; o número em vigor está em F1-5n.)*
4. **QUATRO vocabulários de partição selados no mesmo `evaluatorDigest`** — não três, como o
   cross-review da Fase 0 estimou. E há restatements que o compilador **não** força
   (`benchmark/prediction-schema.ts:134`, `benchmark/cli.ts:600-610`,
   `benchmark/lab/assemble_corpus.py:1094`).
5. **A ordenação temporal das partições do meio é latest-vs-latest por desenho**
   (`benchmark/split-audit.ts:980-983`). Publicar "cinco blocos estritamente ordenados" seria
   promessa universal falsa — a mesma classe de erro da unidade 1.
6. **`classTolerance` para cinco partições não foi pré-registrada.** Ela não existe em
   `rebuild-v3-policy.json`; vive como literal `0.02` em código. Mantê-la é decisão a registrar,
   não herança automática.

**DECISÃO A TOMAR ANTES DE CODIFICAR — grafia canônica dos cinco nomes.** Existem três grafias no
repositório, duas delas congeladas em `EVALUATOR_FILES`:

| grafia | onde | consequência de adotar |
|---|---|---|
| `train/dev/cal-A/cal-B/test` | ledger (`cluster-exposure-ledger.ts:104-110`) | recomendada pela etapa 1; move o digest ao alinhar o pré-registro |
| `train/dev/calA/calB/test` | chaves do pré-registro (`rebuild-v3-policy.json:198-204`) | evita tocar o pré-registro recém-congelado; move o ledger |
| `development/calibration/test` | tipo `Partition` (`split.ts:145`) | é o que sai |

Não decidida aqui de propósito: nome de campo é delegado sem consulta, mas as duas candidatas
estão dentro de arquivos do evaluator, então a escolha move o `evaluatorDigest` de um lado ou do
outro e merece ser feita com o código aberto, não por preferência. Fica para o começo da
implementação do E2.

## Emenda ao "decidir–registrar–ratificar" — DECIDIDA PELO OPERADOR em 2026-07-31

O agente pausou o E2 e devolveu o achado 11 como pergunta ("qual dos três números move?"),
esperando decisão. **Isso foi erro de processo, não zelo.** O operador corrigiu na hora, e a regra
agora está escrita em vez de implícita:

> **Não pause o trabalho para esperar decisão.** Decida ancorado no escopo, registre com razão e
> custo de reversão, e siga. O operador confere depois, no registro. Pausar é o que este bloco
> existe para impedir.

**Por que a regra já estava aqui e eu não a apliquei.** § "Como trabalhar" do LEIA-PRIMEIRO diz
"o agente decide ancorado no escopo, registra com razão e custo de reversão, e **não para**", e a
lista de "nunca delegado" é curta e fechada: D0, risco jurídico pessoal, calendário do operador,
apertar botão de publicação externa, ler `test`/`cal-B`/ledger real, dinheiro além de R$60/mês. O
achado 11 **não estava nessa lista**. Eu o tratei como se estivesse porque uma das saídas
*tocava* calendário — e "toca uma coisa não delegada" não é o mesmo que "é uma coisa não
delegada". O teste correto é: o item está na lista? Se não, decida.

**O que a pausa custou, medido:** a rodada 2 do cross-review reprovou a unidade em parte porque o
caminho selado ficara impossível e sem prova ponta a ponta positiva — consequência direta de eu ter
deixado o achado aberto em vez de resolvê-lo. Ao decidir (F1-5n), o teste ponta a ponta voltou a
existir no mesmo movimento. **A pausa não preservou opções; ela produziu um achado.**

**Ferramentas de desempate, para não repetir a pausa por falta delas** (também do operador,
2026-07-31): o codex não serve só de cross-review — pode ser consultado sobre questão que pareça
impeditiva, ou depois de várias tentativas com erro, e pode receber mandato para analisar o código
e a estrutura do diretório por conta própria em vez de só responder a uma lista de perguntas. E há
a opção de trocar para um agente com Fable em tarefa mais difícil. Nenhuma dessas é motivo para
parar; todas são motivo para seguir por outro caminho.

**Lição de método sobre o prompt de revisão:** as rodadas 1 e 2 receberam minha lista de perguntas,
que enviesou a revisão para o meu enquadramento — e nas duas o codex achou coisas fora dela. A
rodada 3 passa a receber mandato amplo ("analise o código e a estrutura"), com a minha lista
apenas como anexo.

## Protocolo de exceção

Exceção genuína (fora deste registro): a unidade afetada pausa, as demais seguem, e as perguntas
acumulam num relatório único — contexto em 3 linhas, opções com recomendação, consequência de cada.
Você responde quando sentar.

**Delegado sem consulta:** nomes de campos/códigos de erro, parsers para nomes antigos, redação de
comentários dentro das regras do projeto, ordem interna das unidades numa fase, retry técnico.

## Conformidade do implementado com o ESTADO.md — medida em 2026-08-03, para o plano de entrega do modelo

Workflow de 4 verificadores (lab, bancada, abstração do modelo, treino/medição). **36 divergências,
18 conformes.** Esta é a medição que a Etapa 1 do plano consome; o plano referencia por D-número.

### Divergências

| # | tam | item | mudança |
|---|---|---|---|
| D0 | P | REGISTER/HUMAN_SOURCE ainda montam as 5 células antigas, não as 4 da moldura | Reduzir REGISTER/HUMAN_SOURCE às 4 células (ptwiki_lead, carolina_judicial_branch, carolina_university_domains, carolina_social_media), removendo ptso_qa/b2w_reviews/carolina_legislative_branch e as entradas correspondentes em SOURCE_SNAPSHOT, load_humans e governance; remapear HN_REGISTER para os 4 registros vigentes (mixed com pais B2W/PT.SO saem junto, via MissingRecipe/filtro de parentFamily). |
| D1 | M | Reserva OpenAI-para-OOD não é imposta em lugar nenhum do lab | Trocar o predicado por política explícita: toda família OpenAI (gpt-*) presente nos pools é assentada integralmente no bloco de teste (tratamento held-out/OOD) ou excluída da montagem; a lista de famílias core vs OOD deve vir do slate D3, não de um prefixo hardcoded. |
| D2 | P | Fallback de governança reinstala a família held-out retirada | Remover o fallback: held-out vazio deve ser um estado legal da governança (ou uma reprovação explícita da montagem), nunca a reinstalação silenciosa da alegação retirada. |
| D3 | M | Frações 45/5/10/20/20 congeladas no código | Parametrizar as frações a partir do artefato da pré-inscrição nova (como as lanes já vêm de rebuild-v3-policy.json), mantendo o vocabulário train/dev/cal-A/cal-B/test que É vigente; até lá, qualquer montagem real com esses valores realiza um desenho que o ESTADO diz não valer. |
| D4 | M | TARGET humano (4.000) não sustenta o piso de 300 negativos por célula em test | Dimensionar o alvo humano por célula a partir do piso (≥1.500/célula ⇒ human ≥ 6.000 para o teto de 1,45%; 4.000/célula se o operador escolher 0,55%); atenção ao material: Carolina social media tem só 8.863 documentos antes dos filtros (MINIMUM_WORDS=50 corta texto curto de rede social). |
| D5 | M | drop_seen é aplicado tudo-ou-nada, sem a graduação de §3.4 | Duas listas de seen com escopos distintos: conteúdo do test consumido (artefato fornecido pelo operador — o agente não lê a partição test) ⇒ drop total; material exposto (train/dev antigos + o resto dos 10.000) ⇒ barrado apenas de test e cal-B, o que exige aplicar o resultado do drop_seen como restrição de partição, não como poda global. |
| D6 | P | generate_ai ainda oferece --provider openai/anthropic e morre por KeyError no meio da lane | Restringir --provider às quatro lanes congeladas (derivar choices de PROVIDER_LANE) e recusar na argparse com mensagem apontando a reserva OOD; remover openai/anthropic de DEFAULT_MODELS/keys ou marcá-los explicitamente como canal OOD. |
| D7 | P | extract_carolina não extrai uma tipologia por vez nem exclui as fora-da-moldura | Adicionar allowlist de tipologias (flag --typologies ou constante com as 3 da moldura) para que tipologias fora da moldura não sejam emitidas nem consumam cota; a rotulagem por documento já é suficiente para separar as células downstream. |
| D8 | P | Licença lida por documento não viaja até o registro montado | human_record deve ler cand["licenseId"] (com HUMAN_SOURCE apenas como validação de sourceId) e o manifesto de licenças da governança deve listar as 4 licenças que o allowlist admite. |
| D9 | P | datasetId ainda é ptbr-generic-v1 | O corpus novo nasce com id novo (parâmetro ou constante da pré-inscrição nova); manter o id morto faria digest novo sobre nome velho, que §3.4 diz não restaurar cegueira nenhuma. |
| D10 | G | Medição certificadora roda no navegador, não no modelo | Um scorer de nível de modelo (onnxruntime/PyTorch sobre pesos+tokenizer) que produza os shards e manifests selados, e uma identidade de runtime ancorada no hash dos pesos em vez do tuple bundle/Chrome; o navegador sai do caminho certificador |
| D11 | G | Números congelados ainda vêm da pré-inscrição v3 abandonada | Criar o módulo da pré-inscrição nova com as 4 células de § 2, frações re-derivadas, seeds novos e só os valores herdados; apontar gates/split/fit para ele e aposentar o policy morto como fonte |
| D12 | M | Multiplicidade: nenhum m declarado e inventário de gates >> família m=4 | Depois da decisão da manchete (§ 4), fixar m na pré-inscrição nova, passá-lo em evaluate.ts, e reconciliar o inventário de gates com a família primária (quais gates são estatísticos obrigatórios sob o α familiar e quais são diagnósticos) |
| D13 | M | Gate antiartefato pré-treino (A4) é só decisão — não existe em código | Script de gate pré-treino que varre as linhas geradas por família/lane (eco de prompt vs seed, léxico de recusa/metaconversa, disclaimers), calcula a taxa por família e emite veredito regenerar-lane quando >2%, rodando antes de qualquer dataset de treino ser montado |
| D14 | G | fit congela calibradores probabilísticos que a v1 não tem | Redesenhar o estágio fit para a v1 sem calibrador: congelar limiar experimental provisório versionado e definir sobre que escore a 'calibração global' da família B3 é medida |
| D15 | M | F6: treino sem manifesto e sem consumidor do split selado | Manifesto de treino F6 (digests do dataset e do split, seed, hiperparâmetros, versões, hash sha256 dos pesos produzidos) escrito pelo próprio train_detector, mais um conversor que leia train.jsonl/dev.jsonl do split selado e verifique o splitDigest |
| D16 | M | Vocabulário de estratos do selo conflita com as 4 células | Estratos = as 4 células novas: separar judicial de legislative (e excluir legislative), tirar datasets de social-media; ajustar extratores que estampam humanSourceType e os testes que fixam a lista |
| D17 | P | Seed 712019 e backbone XLM-R não estão pinados no treino | Pinar seed 712019 recusando outro valor (o padrão que split.ts:132-138 já usa para o seed de split), fixar xlm-roberta-base como backbone e apagar a instrução de bake-off |
| D18 | P | export_onnx é BERT-shaped e quebra com XLM-R | Condicionar as entradas do export ao model_input_names do tokenizer, documentar os artefatos sentencepiece e rever o teto de bytes na pré-inscrição nova |
| D19 | P | baseline_tfidf não serve como detector de vazamento sem adaptação | Adaptador de entrada para o dataset selado, relatório de AUC por família de geração e por célula, e um critério pré-registrado de 'separação alta demais' que dispare o A4 |
| D20 | P | Vocabulário de gateDecision do verificador Node diverge do contrato | Alinhar KNOWN_GATE_DECISIONS a {pending, reject, indicator-only, pass} e prender com teste que passe o fixture pass-indicator pelo verificador Node. |
| D21 | M | Vínculo F6 treino→modelo inexistente no release | Acrescentar ao release agnóstico um bloco de proveniência de treino (datasetDigest+splitDigest do corpus consumido, seed, modelo base, commit) produzido no treino e exigido pelo empacotamento — é a dívida F6 declarada, confirmada ainda aberta. |
| D22 | M | Empacotamento standalone do modelo (fora do layout da extensão) não existe | Criar alvo de empacotamento próprio do modelo (layout HF: os 6 assets + LICENSE + NOTICE + model card + release/proveniência), reusando verifyReleaseModelDirectory — a verificação já é agnóstica, falta só o alvo. |
| D23 | M | Model card e tabela por célula não existem nem como esqueleto | Criar o model card como artefato do release (com seção datasheet, moldura de 4 células, frase R7-correta e a tabela FPR por célula vazia até a medição). |
| D24 | M | Pipeline de documento (normalização+janelamento+agregação) só existe dentro da árvore da extensão | Mover chunker+aggregator para contracts/ (são puros, sem API de navegador — a dependência é só de path alias @/shared) e decidir se a entrega inclui implementação de referência consumível (port Python com prova de paridade seria G) ou spec no model card. |
| D25 | P | Treino não fixa a seed 712019 nem emite recibo | Fixar 712019 como default/assert do checkpoint publicável e gravar recibo de treino (seed, digests dos jsonl consumidos, modelo base) junto ao checkpoint — é o insumo do vínculo F6. |
| D26 | P | Prova de paridade fp32→int8 é gerada e depois descartada | Rastrear o parity report em models/<id>/ (fora do inventário do bundle servível) e referenciá-lo (digest) no release agnóstico. |
| D27 | P | Bundle servido em public/ carrega LICENSE MIT e NOTICE pré-Fase-0, e o verificador não pega | Re-materializar public/models/ a partir dos rastreados e fazer o verificador de bundle comparar LICENSE/NOTICE byte a byte com models/<id>/ (como verifyReleaseModelDirectory já faz para release.json/calibration-profiles.json). |
| D28 | G | Parser da política congela a pré-inscrição v3 e todo o runtime carrega no import | A pré-inscrição nova exige arquivo de política novo (ou id novo) + parser com pins novos, trocados no mesmo commit: 4 células, frações re-deriváveis, estratos sem qa-informal, snapshots sem b2w. O JSON e o .ts estão em EVALUATOR_FILES (digests.ts:85-86), então o evaluatorDigest muda junto — esperado |
| D29 | G | GROUP_KEYS ainda une por domainSource — inviabiliza o split de 5 partições | Após a ratificação: tirar domainSource de GROUP_KEYS (fica só como eixo de relato/fatia), pôr sourceMaterialBatch como eixo de conectividade, partir collectionBatch em lote (dependência) + extractionRun (diagnóstico). É o item que decide a viabilidade do split novo — os passos 1-3 e 5-7 do plano 2026-08-02 ainda não têm código |
| D30 | G | sourceMaterialBatch existe só no manifesto; não é eixo de registro; extractionRun não existe | Bump de esquema de registro: eixo sourceMaterialBatch novo em V3_GROUP_AXES + regra de estado + GROUP_KEYS; materialBatches passa a obrigatório no manifesto; extractionRun recebe o resto de collectionBatch como diagnóstico. Move digests (schema.ts está em EVALUATOR_FILES) |
| D31 | M | RELEASE_CORPUS_POLICY assume composição do plano morto e estratos que misturam o que a moldura exclui | Re-derivar counts da pré-inscrição nova; redefinir o vocabulário de humanSourceType para as 4 células (judiciário sem legislativo; rede social sem B2W) em RELEASE_CORPUS_POLICY + assemble_corpus.py + teste de igualdade; os slices (benchmark/slices.ts:158) são data-driven e seguem sozinhos |
| D32 | G | Piso de 300 negativos por célula em test não reprova selagem nenhuma — o gate de composição não existe | Implementar o gate de composição pré-selagem: por célula × partição test, contar negativos humanos (e unidades independentes) contra o piso da pré-inscrição nova e reprovar a selagem release — é a unidade que destrava o caminho hoje fechado de propósito em commands/split.ts. Corrigir a mensagem para o piso vigente e ler o 300 de slices.ts da política |
| D33 | M | Frações de partição pinadas em três lugares — re-derivar frações exige tocar parser, tipo e comando juntos | Frações novas = editar o JSON + os pins do parser + o tipo literal em split.ts + a restatement em commands/split.ts no mesmo commit; o typecheck pega a transposição. Auditoria e testes (split-audit.test.ts:1595, rebuild-v3-policy.test.ts:238-244) seguem/ajustam |
| D34 | G | Remover cal-B do desenho não é expressável no código atual | Se a pré-inscrição nova remover cal-B: rework de split.ts (tuple, interface, busca de cortes vira 3), commands/split.ts, parser (partitionFractions e conformal), BLIND_PARTITIONS→[test] e testes — sem tocar LEDGER_PARTITIONS nem os artefatos selados. Se mantiver cal-B, nada disso é necessário |
| D35 | P | Ingest pina o dataset ID morto ptbr-generic-v1 como tipo literal | Trocar o id esperado pelo novo (ou parametrizá-lo pela política nova) em ingest.ts + corpus-import.ts; decidir se intendedDomain "generic" sobrevive à moldura escopada de 4 células ou ganha vocabulário próprio |

### Conformes — o que o plano NÃO toca

- **C0** — extract_wikipedia serve a célula enciclopédica como está
- **C1** — extract_carolina: licença por documento e corte de data conformes
- **C2** — near_dupes.drop_seen está mecanicamente pronto para os 10.000 textos antigos
- **C3** — pseudonymize: as células novas não têm identidade de pessoa que precise de HMAC
- **C4** — generate_ai: as 4 lanes congeladas conformes
- **C5** — F0-6: Stack Overflow bloqueado por nome, não apagado
- **C6** — Cross-entropy e hiperparâmetros congelados no treino
- **C7** — Export INT8 com gate de paridade nos valores congelados
- **C8** — Piso de 300 negativos humanos aplicado por célula, com assimetria correta
- **C9** — Gates de fatia não fixam nomes de célula — as 4 células entram sem quebrar
- **C10** — Caminho fit → consume-holdout → gates → publish-evidence existe e é fail-closed
- **C11** — CONFORME — os 7 artefatos de models/cleanfeed-ptbr-v1 são agnósticos de extensão
- **C12** — CONFORME — chrome-extension:// é exigido só pelo runtime em src/, nunca pelo manifesto
- **C13** — CONFORME — package-own-model, model-lock e verify-model-bundle rodam sem a extensão
- **C14** — CONFORME — contracts/model-release.ts e calibration-profile.ts são puros
- **C15** — CONFORME — ONNX+tokenizer são consumíveis standalone (por janela) em Python puro
- **C16** — Barreira de cal-B (BLIND_PARTITIONS) implementada e testada
- **C17** — Consumidores de runtime de quotaAxis/zeroEventCeiling são só a recusa do split — não quebram com 4 células
