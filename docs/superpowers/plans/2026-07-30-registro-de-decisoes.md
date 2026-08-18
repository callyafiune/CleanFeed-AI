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

> **SUPERADO em `b0f975d`** (emenda da moldura, ratificada mais abaixo neste registro): a moldura
> publicada ficou com UMA célula, e `RELEASE_CORPUS_POLICY.counts.human` passou de 7.000 para **4.000**,
> com bloco cego de 800. Os números de 7.000/1.750 por célula acima são o que foi decidido nesta data e
> **não** são o que está em vigor. O que vale hoje é o que o código mede.

O contrato completo da unidade (16 itens, 6 commits A–F, 15 testes com a mutação que cada um pega, e a
tabela de ratificação da política) está persistido em
`.codex-reviews/fase1-preinscricao-desenho-fable.md` (área de trabalho, fora do Git, mesma convenção do
desenho do E2); a ordem de commits está no plano de entrega, Fase 1. Dois pontos do contrato que
o desenho acertou e valem destaque: `gates.ts` deriva o inventário obrigatório de `policy.primaryFamily`
(hoje `evaluate.ts` não passa multiplicidade nenhuma e todo gate de intervalo falha fechado — D12 era
maior do que o plano dizia); e `backbone`/`onnxMaximumInt8Bytes` congelam na Fase 1 com valores de
XLM-R, porque copiar os do JSON morto (BERTimbau, 109 MB) tornaria o gate de export da Fase 4
impassável sob política selada.

> **RETRATADO pela emenda do backbone (W1)**, seção no fim deste arquivo. A segunda metade do parágrafo
> acima é **circular** e não é razão: o teto de bytes foi elevado de 1,09 × 10⁸ para 3,4 × 10⁸ *para
> acomodar* o XLM-R, e a elevação foi então apresentada como razão de escolhê-lo. O "JSON morto" carregava
> o tamanho **medido** de um export real desta arquitetura, e um teto que reprova o candidato é
> consequência da escolha do candidato, nunca argumento a favor dela.

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
| D17 | P | Seed 712019 e backbone não estão pinados no treino | **RESOLVIDA pela emenda W1** (2026-08-05): `train_detector.py` lê `backbone` e `seeds.publishableCheckpoint` da pré-inscrição selada, recusa `--model` e `--seed` divergentes nomeando o selado, e a instrução de bake-off saiu do docstring. O remédio original dizia "fixar xlm-roberta-base"; a emenda o corrigiu para o BERTimbau |
| D18 | P | export_onnx é BERT-shaped e quebra com XLM-R | **FECHADA pela emenda W1** (2026-08-05): não há forma nova a acomodar, porque o backbone selado **é** BERT. `export_onnx.py` passou a recusar política que nomeie backbone de outra forma, checkpoint de `model_type` divergente e artefato acima de `onnxMaximumInt8Bytes` |
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

---

## A ratificação da pré-inscrição, e o que o Commit C decidiu por conta própria — 2026-08-04

**Status:** `dataset.id` e os counts **RATIFICADOS pelo operador**; o resto é `EM-VIGOR (delegada)`.
Implementado no Commit C da Fase 1 (a troca atômica). O estado vigente vive em `ESTADO.md`; aqui está a
razão e o custo de reversão.

### Ratificado pelo operador

| valor | ratificado | alternativa recusada | razão da recusa |
|---|---|---|---|
| `dataset.id` | **`cleanfeed-ptbr-cells-v1`** | `cells-v2` | dissociava o número do dataset do número da release do modelo: a v1 do modelo mediria um corpus chamado v2, e a partir daí qualquer leitor teria de aprender duas numerações para conferir uma alegação |
| | | `4cells-v1` | a **cardinalidade envelhece mal** no identificador. O `ESTADO.md` § 3.2 permite acrescentar célula à **avaliação** com os mesmos pesos — bloco cego novo, linha nova na tabela, pesos idênticos —, e nesse caminho um id que diz "4" passa a mentir sobre o corpus que ele nomeia, sem que nada tenha sido retreinado |
| counts gerados | **ai 4000 / mixed 2000** | — | o piso de recall (200 positivos em `test`) precisa de ≥ 1.000 positivos a 20 %; 4.000 satisfaz com margem |
| `intendedDomain` | **`scoped-cells`** (sai `generic`) | manter `generic` | consequência direta do id: "genérico" nomeia uma população sem moldura amostral, e é exatamente a alegação que a Etapa 0 recusou. Um manifesto que se declara genérico contradiz a tabela por célula que a release publica |
| `ptbr-generic-v1` | **recusado POR NOME** em `ingest`/`corpus-import` | apagar o id | um identificador que sai por deleção não deixa rastro: quem passasse o id velho construiria o corpus de uma alegação que ninguém faz mais, e construiria **com sucesso**. Vive em `dataset.refusedIds`, com a razão, e o código `DATASET_ID_ABANDONED` diagnostica |

Counts humanos (**SUPERADO em `b0f975d`**: a moldura de uma célula levou os dois a **4.000**; o
raciocínio abaixo sobre alvo × piso continua valendo, os números não):
`RELEASE_CORPUS_POLICY.counts.human` e `collection.humanLinesTotal` exigem **7.000**, que
são 4 células × o **ALVO** de 1.750 (G0.3-bis). O piso de 1.500/célula é o número do **gate**, não o da
composição: `sealDataset` compara a composição por igualdade **exata**, então escrever o total derivado
do piso (6.000) recusaria justamente todo corpus que carrega a margem de coleta — o comentário em
`benchmark/dataset-manifest.ts:104-113` é onde essa aritmética vive no código. A folga não é sobra: ela
existe para o **sorteio** cumprir o piso de 300 em `test`. Ver C-14, abaixo, para a medição.

### `onnxMaximumInt8Bytes` = 340 000 000 — decidido pelo agente, com a aritmética

> **RETRATADO pela emenda do backbone (W1)**, seção no fim deste arquivo. O campo selado é
> **130 000 000** (`benchmark/preregistration-v4.json`), ancorado no export medido de
> 109 681 931 bytes que esta seção descarta como "não é o mesmo backbone" — e o backbone voltou a ser
> exatamente esse. Toda a seção abaixo, incluindo a aritmética de 250 002 × 768 e a frase "nenhum export
> foi medido", descreve uma política que não existe mais. Fica registrada, não corrigida: o parser recusa
> 340 000 000 nomeando o path.

O valor v3 (109 681 931) era o tamanho medido de um export de `neuralmind/bert-base-portuguese-cased`.
Copiá-lo tornaria o export da Fase 4 **impassável sob política selada**, porque o backbone não é o mesmo.
A aritmética que justifica o número novo:

| parcela | contagem |
|---|---:|
| matriz de embeddings (250 002 × 768) | 192 001 536 |
| embeddings de posição (514 × 768) + tipo | 395 520 |
| 12 camadas do encoder (4 × 768² atenção + 2 × 768 × 3072 FFN + vieses/LayerNorm) | ≈ 85 008 384 |
| cabeça de classificação | ≈ 591 360 |
| **total de parâmetros** | **≈ 2,78 × 10⁸** |

A 1 byte por peso no int8 dinâmico, mais escalas e zero-points por canal (≤ 2 %) e o overhead do grafo e
dos inicializadores, um export fica em ≈ 2,8–2,9 × 10⁸ bytes. O teto congelado é **3,4 × 10⁸**, ~22 % de
folga, e é **TETO, não alvo**: nenhum export foi medido, e o número não é apresentado como medição.

O que o teto **decide**, e está escrito no tipo: um export que deixe a matriz de embeddings em fp32 pesa
≈ 8,5 × 10⁸ bytes e **reprova**. Isso é o teto funcionando — a matriz é dois terços do modelo, e um
export que a ignora não é o artefato que esta pré-inscrição congelou. Custo de reversão: reabrir o
número exige emenda da política selada, com a medição na mão.

### Decisões do agente que a tabela de ratificação não fixava

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| C-1 | `seeds.split` = **20260804** (novo); `seeds.bootstrap` (20260728) e `seeds.crossValidation` (20260727) **herdados** | o sorteio abandonado FOI inspecionado — a estrutura dos componentes está medida no `.ABANDONADA.md` —, então o seed de split está gasto e um novo é obrigatório. Os outros dois **nunca foram gastos**: não houve medição certificadora, e re-sorteá-los *depois* de ver o comportamento das dobras dos fixtures legados seria a escolha suspeita, não o contrário | editar o JSON e os pins; move o `evaluatorDigest` |
| C-2 | `multiplicity.frozenAt` = **`G0.2`** (era `G5`) | `G5` é gate do plano v3, que não existe mais; a família congelou em G0.2 (2026-08-03). `report.ts` **imprime** esse campo, então manter `G5` publicaria uma afirmação falsa na evidência | tipo literal em `gates.ts` + 3 fixtures |
| C-3 | o bloco `calibrator` fica na política **marcado `reservedFor: "v2"`**, sem `thresholdsAre`/`scope`/`selectionMetric`/`lengthResultsAre` | `cross-validation.ts` é sítio de import e lê `candidates`/`folds`/`tieBreak`/`tolerance`: deletar o bloco deixaria o par morto importado por módulo de produção, que é o oposto do que a troca atômica exige. Os quatro campos removidos **não são lidos por ninguém**, e `thresholdsAre: "per-profile-band"` congelaria justamente a decisão de limiar por banda que a v1 recusa | acrescentar campos ao JSON e ao parser |
| C-4 | `threshold.quantile` é **derivado e conferido** contra `1 − fprBudgets.warning` | o orçamento de FPR **é** a cauda que o quantil unilateral deixa acima do corte. Uma política em que os dois discordam congela um limiar apontado para uma taxa que ela não publica | afrouxar o parser |
| C-5 | `calibrationGate.scoreBasis` é **conferido igual** a `threshold.basis` | a calibração global mede `documentRawScore` — o softmax do próprio head após agregação de documento, **o mesmo escore que o limiar corta**. Uma afirmação de calibração sobre um escore que o limiar não corta não diz nada sobre a decisão publicada. Registrado também que isso **não licencia linguagem de probabilidade em lugar nenhum** | afrouxar o parser |
| C-6 | o limiar provisório vive em `benchmark/provisional-threshold.ts`, artefato próprio (`provisional-threshold.json`), **dentro de `EVALUATOR_FILES`** | o pipeline calibrado da v3 continua na árvore e é maquinaria de v2; o corte que a v1 publica é uma ordem-estatística determinística sobre negativos humanos de `dev`+`cal-A`, sem competição de calibrador, sem conformal por banda e sem campo de calibrador no artefato. Recusa id de `test` **por nome**, não por ausência | remover o módulo e a fiação em `commands/fit.ts` |
| C-7 | o quantil usa a posição `ceil(q·n)` (base zero), **não** `ceil(q·n) − 1` | o runtime compara `score >= threshold` (`runtimeComparator`: `score-ge-next-up-quantile`), logo o sorteio **no** corte é uma acusação. A ordem-estatística de livro para o comparador estrito deixa uma linha a mais acima do corte — 6 % onde o orçamento é 5 % | uma linha, com o teste que a mede |
| C-8 | o freeze **não** reprova quando a cauda excede o orçamento; publica `population.atOrAboveThreshold` | congelar o quantil e **decidir** o orçamento são afirmações diferentes: o orçamento é decidido em `test`, pelos gates. Num escore degenerado (todos os valores iguais) o quantil existe e a cauda é o corpo inteiro — publicar a contagem é o que impede o leitor de inferir 5 % que ninguém conferiu | acrescentar recusa |
| C-9 | o piso `n ≥ ceil(1/(1−q)) = 20` no freeze | abaixo disso nenhuma linha pode ficar acima do corte, e **todo** limiar leria como satisfazendo o orçamento por não ter cauda | afrouxar o piso |
| C-10 | `src_b2w` sai de `V3_HUMAN_SOURCE_INVENTORY` para `OUT_OF_FRAME_HUMAN_SOURCES` — lista **nova**, distinta de `A1_BLOCKED_HUMAN_SOURCES` | as razões são diferentes e confundi-las apaga informação: `src_ptso` é **recusado** por termo de acesso (condição jurídica satisfazível); `src_b2w` **não é recusado** — rota e licença seguem admissíveis —, ele simplesmente não tem célula, porque resenha de produto não é uma das quatro. Declarado, não apagado, pelo mesmo motivo de `blockedSnapshots` | mover a entrada de volta |
| C-11 | `metrics.ts` lê a **união** dos eixos de todas as versões (`ALL_GROUP_AXES`), e um eixo que a **versão do registro** não declara consulta a grafia antiga do mesmo fato (`generationBatch` → `collectionBatch`), restrito a linha **não humana** | v4 partiu `collectionBatch` em três, e numa linha **gerada** aquele eixo já guardava o lote de geração (`gb_*`) — o mesmo fato que `generationBatch` nomeia agora. Numa linha **humana** ele guardava a execução de extração, que é outro fato, então o alias para aí; nenhuma linha da tabela congelada lê o nível de lote sobre população humana, logo a restrição não custa nada. Sem isso, todo corpus v2/v3 em disco fica **imensurável** para `ai-recall` por uma renomeação de esquema, não por fato faltante | apagar o mapa de um item |
| C-12 | o par morto (`rebuild-v3-policy.json`/`.ts`) **permanece no `.prettierignore`** | deixou de ser hasheado, mas a aposta mudou de lugar em vez de desaparecer: uma pré-inscrição abandonada **reformatada** é indistinguível de uma **editada** | remover a entrada |
| C-13 | `assemble_corpus.py` e o runbook passam a escrever o id novo | um produtor que ainda escrevesse `ptbr-generic-v1` construiria um corpus que o importador recusa. O remapeamento das **fontes humanas** do lab (B2W/PT.SO/legislativo fora de `load_humans`) segue sendo D0, da Fase 2 | uma linha em cada |
| C-14 | (**SUPERADO em `b0f975d`: 4.000**, uma célula) `collection.humanLinesTotal` e `RELEASE_CORPUS_POLICY.counts.human` passam a **7.000** — quatro células vezes o ALVO de 1.750 —, e o parser deriva o total do alvo, exigindo `alvo > piso` | `sealDataset` compara a composição por **igualdade exata**, então um total derivado do piso (4 x 1.500 = 6.000) recusaria justamente todo corpus que carrega a margem que G0.3-bis criou. Medido: 1.750/célula dá ~350 em `test` com sd ≈ 16,7, três desvios acima do piso de 300; no piso, a média em `test` **é** 300 e metade dos sorteios reprova. O piso segue sendo o número do gate; este é o número da coleta. O alvo passa a ser **lido por código** em vez de decorativo | editar o JSON, o pin do parser e o literal do `RELEASE_CORPUS_POLICY` — os três juntos, o teste amarra |
| C-15 | o lado **Python** deixa de ler `rebuild-v3-policy.json`: `assemble_corpus.POLICY_PATH` aponta para `preregistration-v4.json` | achado do cross-review, e era o furo mais grave da troca "atômica": o par morto saiu de `EVALUATOR_FILES` neste commit, então um byte alterado nele **já não move** o `evaluatorDigest` — e continuava decidindo `generation.decoding` de toda linha gerada. Medido: os dois blocos `generationLanes` são idênticos (`json.load(a)['generationLanes'] == json.load(b)['generationLanes']` → `True`), logo é troca de autoridade sem troca de valor. A frase do `.ABANDONADA.md` que dizia "nenhum módulo de produção o importa" era falsa e foi corrigida | uma linha, mas ela reabre o furo |
| C-16 | `OUT_OF_FRAME_HUMAN_SOURCES` ganha **consumidor de produção**: `auditCorpusSources` recusa por nome, com o código novo `SOURCE_OUT_OF_DECLARED_FRAME` (o décimo primeiro) | é literalmente o mesmo defeito que criou `SOURCE_BLOCKED_BY_ACCESS_TERMS`: uma lista declarativa sem consumidor reproduz o silêncio que manter o registro devia evitar. E era pior aqui, porque tirar `src_b2w` do inventário estocado **desligou** a checagem de eixo declarado para as linhas dele (`auditDeclaredAxes` salta um `sourceId` que não conhece). Código próprio e não o de A1: "fora da moldura" e "recusada por termo de acesso" são fatos diferentes | remover o bloco do audit; o código fica no contrato |
| C-17 | o caminho certificador (`evaluate`) passa a **ler e conferir** `provisional-threshold.json`: digest recomputado, restatement da pré-inscrição cruzado com `PREREGISTRATION_V4` e digests de governança cruzados com o artefato congelado | o cross-review mediu que o limiar provisório era **write-only** — `grep` devolvia só `fit.ts` (escrita) e `digests.ts` (hash) —, e um campo selado que ninguém lê é alegação e não garantia. Agora um `fit` que não congelou o corte, ou que o congelou sob outra política ou sobre outro split, **não alcança** a medição certificadora. O que isto ainda NÃO faz está abaixo, em "o que este commit não fez" | remover a leitura de `evaluate` |
| C-18 | `recallFloor` passa de `proportion` a `frozenNumber`; `criticalFprHumanNegatives` entra no cruzamento do teto; `dataset.id`/`intendedDomain` voltam a ser **tipos literais**; `expectedDatasetId` é comparado por igualdade com a identidade viva (`DATASET_ID_UNKNOWN`) | quatro pins que a troca perdeu, todos na mesma direção: o valor deixou de ser conferido e passou a ser apenas *plausível*. `recallFloor = 0.55` atravessava o parser e movia o gate de `recall-at-threshold`; um `n` do teto casado só com o piso de **unidades** publicaria teto mais apertado que o denominador de **linhas** sustenta (direção de over-claim, R3); e `ingestAuthorizedRecords` aceitava qualquer id que a lista de recusados não nomeasse | cada um é uma linha |

### O que este commit NÃO fez, de propósito

- `commands/split.ts:114` continua recusando todo selo `release` com `COMPOSITION_FLOOR_NOT_APPLIED`: o
  gate de composição é o **Commit E**, e o contrato manda substituir a recusa no mesmo commit que a cria;
- `gates.ts` ainda não deriva o inventário obrigatório de `primaryFamily` e `evaluate.ts` ainda não passa
  multiplicidade — **Commit D**;
- o inventário de material (`build_governance.ts` escrevendo manifesto v2 com `materialBatches`) segue
  com dono na **Fase 3, item 1**. Três dos cinco campos que `SourceMaterialBatchV1` exige são fatos que
  nenhum código deste repositório detém, e sintetizá-los é a proveniência inventada que R4 proíbe;
- o byte NUL literal em `near-duplicates.ts` segue como dívida de commit próprio;
- **o corte publicado da v1 ainda é o CALIBRADO, e isto é dívida com dono no Commit D.** Medido:
  `commands/fit.ts:297` continua rodando `fitFrozenCalibration` (competição platt/beta/isotônico) e
  `commands/evaluate.ts` continua chamando `applyFrozenCalibration`, então `metrics.ts` mede o ECE-15
  sobre o escore **calibrado** enquanto `calibrationGate.scoreBasis` diz `document-raw-score`. A
  pré-inscrição não mente sobre isso — ela é uma **pré**-inscrição, congelada antes da corrida
  certificadora, que é a Fase 5 —, mas até este commit nada a fazia valer. O que entrou agora é a guarda
  (C-17: o corte pré-inscrito é entrada **obrigatória** e conferida da corrida certificadora) e a
  publicação honesta do que decide (`thresholdSource: "frozen-calibration-threshold"` no relatório, mais
  o corte pré-inscrito impresso no resumo do `evaluate`). O que **falta** é trocar a regra de decisão, e
  ela não cabe aqui: `buildEvaluationItem`, `profile-artifact.ts` (que publica o perfil de runtime a
  partir de `frozen.calibrators`), `contracts/calibration-profile.ts` e `src/inference/calibration.ts`
  mudam **juntos**, e metade da troca — escore bruto com corte calibrado, ou corte bruto com perfil de
  runtime calibrado — é pior que qualquer das duas pontas. **Dono: Commit D, junto do item 13**, que já
  reescreve `evaluate.ts` para passar a multiplicidade.

---

## Fase 2, unidade L1 — as células e as lanes: D0, D4, D6 e D7 resolvidas no lab (2026-08-05)

> **RETRATADO EM PARTE pela emenda da moldura** (seção "A emenda da moldura", no fim deste arquivo). Duas
> afirmações desta seção não valem mais: (i) a moldura tem **uma** célula e não quatro, então as quatro
> grafias `carolina-*` de L1-1 e o remapeamento de `HN_REGISTER` de L1-6 foram refeitos; e (ii) a
> afirmação de L1-1 de que "a célula É o estrato cujo teto a release publica" era **falsa** para as duas
> autoridades que publicam teto — `humanCoreStrata` não gateava nada, e a revisão adversarial mediu o
> corpus contando zero linha em toda célula. O mecanismo que L1 descreve continua correto; o vocabulário e
> a contagem de células estão superados.

**Status:** `EM-VIGOR (delegada)`. Nenhuma das quatro divergências está na lista de nunca-delegado, e
nenhuma toca o caminho selado — o lab produz candidatos e não sela ciência. O estado vigente vive em
`ESTADO.md`; a razão metodológica, com referência, em `references.md` § L (L1–L4); aqui está a razão de
engenharia e o custo de reversão.

**Medido antes de decidir:** o lab estava numa moldura de CINCO células (`qa-informal`, `encyclopedic`,
`social-media` servida por B2W, `university`, `institutional` pondo judiciário e legislativo no mesmo
estrato) enquanto a Fase 1 já havia congelado QUATRO (`humanCoreStrata` = encyclopedic, judicial,
social-media, university). O `humanSourceType` que o lab escrevia — `institutional`, `qa-informal` — não
existe no vocabulário que os gates fatiam, então a montagem produzia estrato que nenhum teto de FPR cobre.

### Decisões do agente, com a razão e o custo de reversão

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L1-1 | `REGISTER`/`HUMAN_SOURCE` passam às 4 células, na grafia de `preRegistration.quotaAxis.cells` (`ptwiki`, `carolina-judicial`, `carolina-social-media`, `carolina-university`) | o campo `humanSourceType` é lido pelos gates, e o de FPR por célula procura `fpr-<valor>` em `multiplicity.primaryFamily`: qualquer outra grafia conta ZERO linha nas quatro células do gate de composição e deixa as quatro hipóteses certificadoras sem gate (medido, ver L1-18). As duas listas ficam keyed igual e o pino é contra as DUAS autoridades que reprovam, mais a lista de cobertura do selo | editar dois dicts; o teste que junta com a política amarra |
| L1-2 | fonte fora da moldura é **nomeada** em duas listas distintas — `A1_BLOCKED_DOMAIN_SOURCES` (`ptso_qa`) e `OUT_OF_FRAME_DOMAIN_SOURCES` (B2W + 4 tipologias Carolina) | espelho de C-10/C-16 do lado Python: as razões exigem ações diferentes (parecer jurídico contra emenda da moldura) e juntá-las apaga qual se aplica. Deletar o nome faria a fonte reaparecer num pool antigo e ser descartada **sem razão reportada** | mover a entrada de volta |
| L1-3 | `human_record` recusa por `OutOfFrameDomainSource` (subclasse de `UnwritableInV3`), não por `KeyError` | a recusa é **contada** pelo `build()` do `main`, que é a disciplina do módulo inteiro ("a row the v3 contract cannot express is DROPPED AND COUNTED"). Um `KeyError` derrubaria a montagem e não diria qual das duas razões se aplica | trocar a classe da exceção |
| L1-4 | o argumento `register` de `human_record` passa a ser **conferido** contra a célula derivada da fonte | um rótulo de célula que discorda da fonte conta o negativo humano sob população de que ele não foi sorteado, e move DOIS tetos publicados de uma vez. O argumento permanece porque é o que a montagem **afirma** estar coletando; conferido, ele deixa de poder mentir | apagar quatro linhas |
| L1-5 | a linha **mista** cujo pai está fora da moldura sai junto, pelo `parentFamily` | uma mista mecanicista É o texto humano do pai com trechos gerados, então ela é contada na célula do pai. Medido nos pools: dos 2.135 pares, 1.337 têm pai fora da moldura — `ptso_qa` 1.111, `carolina_datasets_and_other_corpora` 223, `carolina_legislative_branch` 3 — e **zero** vem de B2W; a classe cai a 798 contra a cota de 2.000 comparada por igualdade exata (ver L1-22) | apagar a guarda |
| L1-6 | `HN_REGISTER` remapeado às quatro células: formulaic→carolina-judicial, corporate-structure→carolina-university, highly-polished→ptwiki, as outras três→carolina-social-media | não é bookkeeping: `tag_hard_negatives` tira as linhas de cada família do pool DAQUELA célula, então estilo apontando para célula morta não etiqueta nada, e a família fica ausente de `requiredHardNegativeFamilies` — selo recusado no fim de uma montagem inteira, por uma entrada de dict que parece inócua. Com as 5 células antigas, `motivational` já apontava para `qa-informal`, que morreu na Fase 1 | reescrever o dict; o teste de contradomínio amarra |
| L1-7 | `SOURCE_SNAPSHOT` perde `src_ptso` e `src_b2w` | é o **fallback** de `label_evidence`: uma entrada aqui data a linha contra um snapshot, e `pt-stackoverflow` está em `humanSources.blockedSnapshots`. O conjunto de valores é pinado contra `humanSources.snapshots` | reinserir a linha |
| L1-8 | `load_humans` lê só os pools da moldura, e o filtro de `REGISTER` permanece | duas telas para dois casos diferentes: o arquivo de pool fora da moldura não é aberto (não gasta cota), e o filtro pega a linha **de tipologia fora da moldura dentro de um pool da moldura** — que é o caso real, porque um arquivo Carolina tem a tipologia legislativa ao lado das três | reinserir o nome do pool |
| L1-9 | `TARGET["human"]` deriva de `collection.humanLinesTotal`; `collection_targets()` confere total = células × alvo e alvo > piso | o alvo literal de 4.000 dava 1.000 por célula, ~200 em `test`: um terço do denominador de 300 que o teto publicado exige. As duas conferências recusam no lab o que `sealDataset` recusaria por igualdade exata, e recusam **antes** da corrida de montagem | editar o JSON e o parser juntos |
| L1-10 | `ai`/`mixed` seguem literais no lab, e os TRÊS são pinados por teste contra `RELEASE_CORPUS_POLICY.counts` lido de `dataset-manifest.ts` | os counts gerados são ratificados e vivem no TypeScript, que é o artefato que o selo lê. Ler TS no import do módulo (o precedente existe em `declared_group_axes`, mas como função) tornaria o lab inimportável por uma reformatação; a junção entre linguagens fica no teste, como a de `CLASS_TOLERANCE` | mover os counts para o JSON da política |
| L1-11 | `balanced_humans` divide pelas células **declaradas** e o top-up entre células SAI | cada célula publica o próprio teto sobre o próprio denominador, então linha da célula A não substitui linha ausente na B. Dividir pelas células presentes transforma uma célula faltante em três sobrecoletadas; o top-up alcança o total e gasta o orçamento em material que o teto faltante não pode usar. A falta agora aparece na contagem de coleta, que é o número sobre o qual o operador ainda pode agir. Efeito colateral removido: o top-up antigo indexava `p[per + k]` e podia estourar `IndexError` num pool curto | reescrever a função |
| L1-12 | `--provider` recusa na **argparse**, com `type=frozen_lane` + `choices` derivados de `PROVIDER_LANE` | medido: `PROVIDER_LANE[provider]` é lido dentro do laço, **depois** da chamada ao provedor, então `--provider openai` gastava chamada real e morria com `KeyError` na primeira linha escrita — e de novo em cada retomada. A recusa nomeia as quatro lanes admissíveis e a razão (reserva OOD; slate congelado) | trocar o `type` por `choices` de `DEFAULT_MODELS` |
| L1-13 | os transportes REST de `openai`/`anthropic` **saem** de `call_provider`; os nomes ficam em `OUT_OF_SLATE_PROVIDERS`, que passa a ter consumidor de produção | manter transporte inalcançável exige manter `keys` com duas variáveis de ambiente que este projeto não tem (só `GEMINI_API_KEY`), e um `keys[provider]` incompleto é o mesmo `KeyError` uma camada abaixo. Restaurar transporte é emenda de slate, não edição | ~30 linhas de urllib, recuperáveis do git |
| L1-14 | `SEEDED_PROVIDERS` fica VAZIO, com o fato escrito | nenhuma das quatro lanes congeladas expõe seed de amostragem — é o que `assemble_corpus.SEED_NULL_REASON` já afirmava. A constante permanece porque é o mecanismo: uma lane que passasse a oferecer seed é uma entrada | uma entrada |
| L1-15 | `extract_carolina` troca denylist por **allowlist** de tipologia; as 4 fora da moldura ficam declaradas com a razão | uma denylist de `wikis` deixava passar legislativo, public domain works e datasets-and-other-corpora, e o legislativo é 4.477 MB do pacote. Membro fora da seleção não é aberto, então não gasta cota — que é o ponto da allowlist sobre o cap por tipologia | reescrever o filtro |
| L1-16 | tipologia que **nenhuma** das duas listas nomeia **recusa a corrida** (`TypologyOutOfFrame`) | exclusão DECIDIDA é silenciosa (a lista é a declaração); exclusão INDECIDIDA para tudo. Razão de domínio: o diretório vem grafado com espaço em algumas releases e underscore em outras, e uma tipologia da moldura renomeada produziria zero linha de uma célula cujo teto a release publica, **em silêncio**. A comparação é sobre o SLUG por isso mesmo | trocar o `elif` por um `continue` |
| L1-17 | `--typologies` valida na entrada e só **estreita** dentro da moldura | uma passada de vários gigabytes que descobre no último membro que foi pedido o legislativo já gastou a corrida | remover o `type=` |
| L1-18 | o vocabulário da célula é `preRegistration.quotaAxis.cells`, e `RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` passa à mesma grafia | achado BLOQUEANTE da revisão, confirmado por medição própria: `humanSourceType` tem três vocabulários candidatos na árvore e só dois decidem. Probe em node sobre os módulos da árvore, 4 x 320 negativos humanos em `test`, cada um com `source` distinto — com os nomes de registro, `auditReleaseComposition` conta `carolina-judicial=0L/0U … ptwiki=0L/0U` e reprova com 8 quebras; com a grafia das células, 320L/320U em cada uma e `passed: true`. E `gates.test.ts` já tinha, em HEAD, o teste "refuses a corpus whose humanSourceType carries the stratum names instead of the quota cells" — o lado selado já havia decidido, e L1 escrevera justamente o vocabulário que ele recusa. `requiredHumanSourceTypes` move no mesmo commit porque lê o MESMO campo: nos nomes de registro ele recusaria todo corpus que o gate de composição aprova (defeito A4, duas grafias que nunca se encontram, pré-existente em HEAD) | três listas e dois testes; `preregistration-v4.json` NÃO é tocado (congelado) |
| L1-19 | a inviabilidade da moldura na granularidade atual é MEDIDA e registrada, e não delegada ao preflight | achado BLOQUEANTE da revisão, confirmado: o `source` que `extract_carolina` emite é o MEMBRO do zip, e o pacote v2.0 tem 37 membros em `judicial branch`, 7 em `university domains` e 2 em `social media` (46 na moldura; 361 é o total não-wiki, que inclui as quatro tipologias de fora). Contra `powerFloors.samplingUnits` = 300, `criticalFprHumanNegatives` = 300 e `maximumLinesPerOriginDocument` = 1, as três células Carolina carregam no máximo 37, 7 e 2 linhas no bloco cego. Nenhuma re-extração muda: `ESTADO.md` § 5.1 conta DOCUMENTOS TEI, unidade que o gate não lê. O alvo de 1.750 linhas/célula é inalcançável sob o teto por documento, então a recusa nova de L1-9/L1-11 dispararia contra a política e não contra erro de coleta | nenhum: é registro. A escolha entre baixar a granularidade do eixo (documento TEI) e emendar piso/teto toca a UNIÃO do split e a pré-inscrição, e é da Fase 3 |
| L1-20 | `assert_cells_can_meet_the_origin_document_floor` recusa a montagem de release antes da seleção | a mesma aritmética do gate de composição, ouvida no começo da corrida em vez do fim. Derivação: com teto de 1 linha por documento e um balde único para origem irrecuperável, a célula carrega no máximo (documentos distintos + 1) linhas no bloco cego, logo documentos < piso é impossibilidade e não escassez. NECESSÁRIA e não suficiente (os pisos são medidos em `test` e é o split que decide onde os documentos caem). Só contra a cota de release: `--sample` coleta uma fração dela por construção, e comparar um smoke contra 300 recusaria todo smoke pela única razão que não é defeito. Medido nos pools de hoje: 0 documentos conhecidos nas quatro células, e a recusa imprime os quatro números | apagar a chamada; o teste que confere a ordem em `main` fica vermelho |
| L1-21 | `domainSource` que NENHUMA das três listas nomeia recusa a corrida (`UndecidedDomainSource`, fora de `UnwritableInV3`) | a assimetria de L1-16 no eixo da fonte, que L1 tinha construído só no extrator: exclusão DECIDIDA é descarte contado, exclusão INDECIDIDA para tudo. A razão de domínio é a mesma e é medida — `domainSource` é cunhado como `carolina_<tipologia>` e o diretório vem grafado com espaço em algumas releases e underscore em outras, então uma re-extração que sluga diferente escreve linhas de uma célula cujo teto a release publica, e o descarte genérico as apagaria em silêncio | trocar a classe da exceção pela razão genérica |
| L1-22 | `tag_hard_negatives` extraído de `main` e recusando por demanda de célula; `mixed_parents_by_frame` reporta o déficit da classe mista por pai | dois laços que só o `main` executava. O de etiquetagem tira `tag_per` linhas por família do pool da célula daquela família, então as demandas SOMAM (uma linha não carrega duas famílias) e uma célula curta deixava a última família com zero — ausência que `sealDataset` recusa no fim. O da mistura: 1.337 de 2.135 pares saem e ninguém contava por pai, então o desbloqueio inclui a REGERAÇÃO da lane de mistura (Fase 3, item 2) ao lado da re-extração humana | reinserir os laços em `main`; os testes das duas funções ficam vermelhos |
| L1-23 | REFUTADO: "nenhuma célula concentra mais de duas famílias hard-negative". No lugar dela, a regra é de COBERTURA: toda célula é fonte de ao menos uma família | a revisão pediu a regra de concentração junto da aritmética. A aritmética entrou (L1-22); o teto por célula não. A família é um ESTILO e a célula é o MATERIAL: repetição, fraseado não nativo e registro motivacional ocorrem em texto informal curto, e mover uma delas para material judiciário ou enciclopédico só para equilibrar contagem etiquetaria um hard negative sobre texto que não exibe o estilo — que é a única coisa que o hard negative afirma. O que a mutação pedida DEVE pegar, e passou a pegar, é a outra direção: cada célula publica o próprio teto de FPR, então célula de que nenhum estilo é tirado publica teto medido sobre material que nunca carrega o registro adversarial que as outras três carregam. A mutação da revisão (`formulaic` → rede social) esvazia a célula judiciária e agora fica vermelha | inverter a inclusão no teste de contradomínio |

### Fixtures migradas, e por que a migração não é cosmética

`AssemblerRealGroupTests._human_candidate` produzia candidato `ptso_qa` com `author` **`known`**, e todo
teste de `human_record` passava por ele. Migrado para material da célula judiciária, com `author`
`notApplicable` pela razão da Carolina: **nenhuma** célula da moldura vigente rende autor conhecido — a
lede da Wikipédia é obra coletiva e o extrator da Carolina nunca lê nome de header. Manter um autor
`known` numa fixture da moldura seria contrafactual, e a asserção que ela sustentava ("dois registros de
uma thread compartilham o eixo") sobrevive melhor no eixo que a célula tem de verdade: dois documentos TEI
de um MEMBER FILE compartilham `source`. O teste foi renomeado para dizer isso
(`test_two_records_of_one_member_file_share_the_source_axis`). Os pares mistos e as fixtures de
`make_mixed` que chegam ao montador migraram para pai `carolina_judicial_branch`.

**Consequência a registrar:** com as quatro células, `groups.author` é `notApplicable` em toda linha
humana do corpus novo. `author` continua em `GROUP_KEYS` (união do split) e não custa nada ali — um eixo
`notApplicable` não une —, mas a dependência intra-célula passa a repousar em `source`, `nearDuplicate` e
linhagem, e `source` é o eixo grosso da Carolina (46 member files na moldura carregam a contribuição
inteira). **A granularidade não está em aberto para o preflight decidir: ela já está decidida CONTRA a
moldura**, e o número está em L1-19.

### Achado fora do escopo desta unidade, registrado para não se perder

`load_humans(cand)` honra `cand` para os pools frescos e para os arquivos de mistura, mas lê
`reserved.jsonl` de `benchmark/data/dataset` **sempre**, por constante de módulo — o parâmetro promete
que uma re-extração pode ser montada sem tocar os pools da corrida reprovada, e a reserva escapa da
promessa. Medido de lado: as linhas da reserva são recusadas de todo modo (`MissingLabelEvidence`,
`MissingMaterialBatch`), então o efeito hoje é contagem de descarte, não corpus contaminado. Não
consertado: mexer no caminho da reserva é decisão sobre o que o corpus contém, e esta unidade é sobre a
moldura. O teste novo de `load_humans` filtra pelos ids plantados por causa disso.

### O que esta unidade NÃO fez, de propósito

- **D1, D2, D5, D8 e D13 seguem abertas** — são as outras unidades da Fase 2. Em particular, a reserva
  OpenAI-para-OOD (D1) continua sem política explícita no montador: o que L1 fez foi impedir que a
  superfície de API da OpenAI seja PEDIDA, não decidir onde as famílias `gpt-*` são assentadas;
- o fallback de governança que reinstala família held-out retirada (D2) continua lá, uma linha abaixo do
  que L1 tocou em `main` (`sorted(held_out) or ["gemini-3_5-flash-lite"]`);
- `SOURCE_DECLARED_AXES` (`group_axes.py`) continua listando `ptso_qa` e `b2w_reviews`. É declaração
  consumida só por teste, e o que ela declara — que uma resenha pertence a um produto e a um resenhista —
  é fato da fonte, não alegação de moldura. A autoridade que recusa é `declared_group_axes()`, parseada
  do inventário revisado, e o teste novo junta as duas pontas;
- `ner_pilot.py` continua amostrando `ptso_fresh.jsonl` e `b2w_fresh.jsonl` na medição de custo da
  triagem de PII. É medição de custo sobre pools em disco, não montagem de corpus;
- `ESTADO.md` **não foi reescrito**: a reescrita das seções 1 e 5 é a última unidade desta fila.

### A rodada de revisão: o que ela pegou, e o que foi refutado

Veredito da revisão: **BLOCK**, dois bloqueantes e três menores. Os dois bloqueantes eram reais e foram
reconferidos por medição própria antes de mexer no código — nenhum foi aceito pelo relato.

- **bloqueante 1 aplicado (L1-18).** A unidade tinha ancorado a célula em `humanCoreStrata`, a única das
  três listas sem consumidor que reprova, e o registro afirmava "a célula É o estrato cujo teto a release
  publica" — falso para as duas autoridades que publicam teto. O pino novo junta as três pontas que
  decidem (`quotaAxis.cells`, os sufixos `fpr-*` de `multiplicity.primaryFamily` e
  `requiredHumanSourceTypes` lido do TypeScript) e é vermelho nas duas direções da troca de grafia;
- **bloqueante 2 aplicado (L1-19 + L1-20).** A causa registrada da reprovação do smoke ("não é a
  moldura") estava incompleta e o número registrado (361 member files) era o total não-wiki e não o da
  moldura (46). A infeasibilidade por célula entrou no registro e a guarda que a diz na coleta entrou no
  código;
- **menor 3 aplicado.** O caso de célula com ZERO candidato entrou no teste da cota: as quatro células
  presentes tornavam "declaradas" e "chegadas" o mesmo número, e a mutação do denominador sobrevivia à
  suíte inteira (a revisão mediu isso em cópia no scratchpad, e a medição confere);
- **menor 4 aplicado (L1-5 + L1-22).** A razão registrada nomeava B2W, que contribui zero par. Números
  corrigidos e a consequência da classe mista registrada;
- **menor 5 aplicado.** A asserção de `author` compartilhado voltou como fixture de CONTRATO do builder,
  nomeada pelo que é, e a asserção que sobrevivia por construção passou a dizer que é declaração da
  célula. O eixo `author` volta a ter um caso em que duas linhas chegam com o mesmo `known`;
- **`extraMutationsRequested` #6 parcialmente refutado (L1-23), e a mutação SOBREVIVEU na primeira
  tentativa.** A metade aritmética entrou; a regra "no máximo duas famílias por célula" não, porque
  equilibrar contagem move um estilo para material que não o exibe. E a primeira versão da prova nasceu
  VERDE, por circularidade do fixture: ele dimensionava o pool a partir de `hard_negative_demand_per_cell`,
  isto é, do próprio mapa que a mutação altera, então o pool crescia junto com a demanda. O conserto é a
  guarda de COBERTURA (toda célula é fonte de ao menos uma família), que não depende de fixture nenhum e
  fica vermelha sob a mutação exata que a revisão pediu;
- **duas observações da revisão que NÃO viraram mudança.** (i) o argumento `register` de `human_record` é
  inverificável em produção porque o único chamador o deriva do mesmo `cell_of` — é o que L1-4 já diz, e
  a conferência continua valendo como contrato da assinatura; (ii) `make_mixed.py` ainda monta um dict de
  `keys` com OPENAI/ANTHROPIC e chama `call_provider(..., "gemini", ...)` fixo: dívida morta, declarada,
  fora do escopo de D6.

**O `evaluatorDigest` MOVE, e isto é fato registrado e não efeito colateral escondido.**
`benchmark/dataset-manifest.ts` é membro de `EVALUATOR_FILES` (`digests.ts`), e a lista de cobertura do
selo muda de bytes nele. Medido com os 52 membros lidos de HEAD numa raiz sombra fora da árvore:
35041bfa4f13719e7015c5ede03a1b994a3a54d64bcd93318278bafb0ebb1396 →
9bc4e7494d31cd023985d34818574b179cc2aabfa13f7562749a09be10d2783f. Nenhum arquivo NOVO entra na lista,
então nada em `references.md` § K15 muda; e é inócuo hoje pela mesma razão de K15: `issuedAt` nulo,
zero tags, nenhum `fit` selado.

**Consequência operacional medida:** o smoke `--sample 40` continua reprovando, e agora reprova MAIS
CEDO e nomeando a causa. Antes: `UnsplittableCorpus` em `assert_components_can_fill_five_partitions`
(1 componente). Agora: `HardNegativeCellUnderfilled`, dizendo que as quatro células têm 0 linha humana
porque as 16 selecionadas saíram em `MissingLabelEvidence`. É o mesmo defeito de pool — os 16.100
candidatos humanos em disco não carregam `dateField`, `sourceMaterialBatch` nem `groupAxes` — dito uma
etapa antes.

---

## Fase 2, unidade L2 — held-out, reserva OOD e cegueira: D2, D1 e D5 (2026-08-05)

**Status:** `EM-VIGOR (delegada)`. Nenhuma das três divergências está na lista de nunca-delegado e
nenhuma toca o caminho selado — o lab produz candidatos, e nenhum arquivo de `EVALUATOR_FILES` é tocado
(medido: os 52 membros da lista não contêm arquivo do lab, e `git status` mostra mudança só em
`benchmark/lab/*.py` e em documentação, logo **o `evaluatorDigest` NÃO move nesta unidade**). O estado
vigente vive em `ESTADO.md`; a razão metodológica, com referência, em `references.md` § L (L7–L9); aqui
está a razão de engenharia e o custo de reversão.

**Medido antes de decidir.** As famílias geradoras que os pools em disco entregam ao montador, por
`(provider, family)`: `gemini`→`gemini-3.5-flash-lite` (493), `gemini-3.1-flash-lite` (256),
`gemini-3-flash-preview` (2); `agy`→`gemini-3.5-flash-low` (320), `gemini-3.5-flash-medium` (99);
`codex`→`gpt-5.6-luna` (1.402). Nos pools de mistura: `antigravity`→`claude-sonnet-4-6` (177),
`gemini-3.6-flash-low` (449), `gpt-oss-120b-medium` (451); `gemini`→sete famílias gemini/gemma;
`openai`→`gpt-5.6-luna` (177) e `anthropic`→`claude-fable-5` (60), as duas recusadas por `UnmappableLane`.

**O censo acima estava INCOMPLETO, e a rodada adversarial pegou.** Faltava o sétimo arquivo que `load_ai`
lê, `ai_reserved.jsonl` (1.476 linhas): `claude-fable-5` (16), `gemini-flash-lite-latest` (94),
`gpt-5.6-luna` (181) e **nove famílias `madras_*` que nenhum papel nomeava** — 1.185 linhas. O censo
completo, canonizado e conferido por guarda, é `POOL_GENERATOR_FAMILIES` (23 famílias, 6.183 linhas, soma
igual a `load_ai` + `load_mixed`); a decisão sobre as nove está em L2-22. A omissão tem uma causa que vale
registrar: as listas de papel foram escritas a partir do **slate de geração** e lidas como se tivessem sido
escritas a partir dos pools — três das quatro entradas core que não vêm das quatro lanes vivem justamente
no arquivo que o censo não cobriu.
**Nenhuma linha de mistura é escrevível hoje**: as 2.135 não carregam `promptTemplateDigest` nem
`sourceMaterialBatch`, então a classe mista sai ZERO por `MissingRecipe`/`MissingMaterialBatch` — e é por
isso que o fixture de ponta a ponta desta unidade reproduz um corpus de duas classes.

### D2 — o fallback que reinstalava família held-out retirada

Estava em `main`, uma linha: `"heldOutGeneratorFamilies": sorted(held_out) or ["gemini-3_5-flash-lite"]`.
O nome do fallback é uma das DUAS famílias de `HELD_OUT_INELIGIBLE` — as que foram rebaixadas em
2026-07-24 porque o treino tinha 721 registros do alias `gemini-flash-lite-latest` e o ônus é de quem
alega. Isto é, quando a reserva saía vazia, a governança declarava exatamente a alegação que a corrida
havia retirado por falta de prova, e um `validate` posterior teria conferido só a contagem de positivos.

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L2-1 | o fallback SAI, e reserva vazia **recusa** a montagem (`HeldOutReserveEmpty`) | a escolha entre "vazio legal na governança" e "recusa explícita" não é gosto: `parseDatasetManifest` (`benchmark/dataset-manifest.ts`) recusa por nome uma `heldOutGeneratorFamilies` vazia, então não existe estado vazio a que cair. A recusa carrega a razão de CADA candidata retirada, que é o número sobre o qual o operador age | reinserir uma linha; o teste de ponta a ponta e o do sítio de chamada ficam vermelhos |
| L2-2 | a declaração é uma função (`declared_held_out_families`) e não um literal no dict de governança | uma guarda que só existe dentro de `main` não tem teste que a distinga de um literal. Com a função, o teste de comportamento (recusa) e o do sítio de chamada (a `main` a usa) pegam as duas metades da regressão | remover a função e inlinear |

### D1 — a reserva OpenAI-OOD passa a ser política do slate, por nome

O predicado que estava lá era `f.startswith("gemini-3") and f not in HELD_OUT_INELIGIBLE`: a candidatura
a held-out era deduzida de prefixo de nome, e a reserva OpenAI de ESTADO.md § 3.3 **não era imposta em
lugar nenhum** do montador.

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L2-3 | duas listas de PAPÉIS (`OOD_RESERVED_FAMILIES`, `CORE_GENERATOR_FAMILIES`), comparadas por igualdade exata sobre `groups.generatorFamily` | é o eixo canônico, e `generator-family.ts` já tem o tipo nominal e a invariante do lado selado; `generation.family` carrega a grafia pontuada do provedor e nunca casaria uma entrada do slate — é a comparação que deixava a marca de held-out do splitter inerte antes do tipo nominal existir | editar dois dicts |
| L2-4 | família geradora que NENHUMA das duas listas nomeia **para a corrida** (`UndeclaredGeneratorFamily`) | é a assimetria de L1-16/L1-21 no eixo do gerador, e é ela que responde ao problema do renome. Igualdade exata não é imune a renome — nada é —, mas ela FALHA FECHADO: sob prefixo, `gpt-5.7-luna` deixa de casar `gpt-5.6`, é lida como core e entra no treino em silêncio; sob declaração, cai fora das duas listas e a montagem para nomeando a família | trocar o `raise` por um default |
| L2-5 | nem lane nem prefixo decidem o papel, e a razão é MEDIDA | `gpt-5.6-luna` chega pela lane `codex` e `gpt-oss-120b-medium` só é alcançável pelo `agy`, que é o harness do **Google**: a fronteira de provedor cruza a de lane, então fatiar por lane não é fatiar por provedor. Um teto por lane classificaria `gpt-oss` como core por acidente de canal | — |
| L2-6 | `gpt-oss-120b-medium` é **reservada**, divergindo da tabela de D3 do plano dormente | ESTADO.md § 3.3 diz "famílias OpenAI ficam reservadas ao teste de gerador não visto (OOD); nenhuma entra em treino", sem exceção por lane, e o remédio de D1 na medição de conformidade fala em "toda família OpenAI (gpt-*)". Precedência: código medido > ESTADO > plano, e o plano de 2026-07-26 está declarado **dormente, consulta e não execução**. Custo hoje: ZERO medido — a família só aparece nos pools de mistura, cujas linhas são todas recusadas | mover uma entrada entre dois dicts |
| L2-7 | as famílias gemini-3.x passam a **core**; a alegação de gerador não visto repousa num PROVEDOR inteiro ausente do treino | é a alegação mais forte disponível e é a que o próprio slate D3 defende ("com a lane OpenAI reservada, o gerador não visto passa a ser um provedor inteiro ausente do treino"). Duas delas já estavam em `HELD_OUT_INELIGIBLE`; as outras (`gemini-3.5-flash-low`, `gemini-3.6-flash-low`) eram defensáveis pelo canal, e continuam sendo — o que muda é que a reserva agora tem um critério declarado em vez de um prefixo | mover entradas entre os dois dicts |
| L2-8 | `assert_slate_roles_are_consistent()` roda no começo de `main` e recusa três contradições do próprio slate | as três são silenciosas em tempo de montagem: família nos dois papéis (o assento sai da consulta que rodar primeiro), família reservada cuja alegação foi retirada (`HELD_OUT_INELIGIBLE` — reservá-la é publicar resultado de gerador não visto para um gerador que o treino pode ter visto), e nome que não é ponto fixo de `generator_family` (a grafia pontuada nunca casa o eixo, então o papel nunca se aplica). Roda antes dos pools porque a contradição é barata de ouvir agora e cara depois de uma montagem | apagar a chamada; o teste que confere a ordem em `main` fica vermelho |
| L2-9 | a reserva tem de caber no bloco cego **e deixar lugar ao lado** (`assert_the_blind_block_holds_both_roles`, comparação estrita) | o bloco cego carrega DUAS hipóteses: recall no limiar, cuja população são positivos de famílias que o treino contém, e a fatia de gerador não visto, cuja população é a reserva. Reserva igual ao bloco deixa a primeira sem população, e o montador não pode resolver isso escolhendo quais linhas reservadas descartar — quanto de cada papel o bloco carrega é cota de COLETA. Medido: 1.402 linhas frescas de `gpt-5.6-luna` contra bloco de teste de 800 na cota ratificada de 4.000 `ai`, logo a reserva **tem** de ser dimensionada na coleta (Fase 3) | trocar `>=` por `>`; o teste da borda fica vermelho |
| L2-10 | reserva **magra** (< 200 positivos) tem as linhas DESCARTADAS e contadas, e só em corrida de release | declarar é recusado por `validate` (`DATASET_COVERAGE_INVALID`) e treinar é proibido pela reserva: sobra uma saída só, e a contagem impressa é quanto uma regeração tem de fechar. Só em release pela razão de L1-20: um `--sample` coleta uma fração da cota por construção, então toda família de um smoke está abaixo de um piso escrito para corpus selado. Se o descarte esvaziar a reserva, L2-1 recusa — é a rede | remover o filtro |
| L2-11 | o print antigo "held-out nao cabem no bloco de teste" que seguia adiante vira **recusa** (`ReserveFillsTheBlindBlock`, dentro de `assign_partitions`) | imprimir e continuar produzia um corpus que o splitter recusaria depois, o que é a mesma espécie de defeito do fallback de D2: uma alegação degradada em silêncio. **Corrigido na rodada de fechamento:** este registro dizia que o print "sai" e ele estava intocado no arquivo — o que o diff havia removido era um print DIFERENTE (`nao declaradas held-out (bloco de teste cheio)`). O ramo é inalcançável a partir de `main`, porque `assert_the_blind_block_holds_both_roles` roda antes com a mesma aritmética e comparação estrita (provado por mutação: trocá-lo por `raise` deixou a suíte inteira verde), mas `assign_partitions` é chamável sozinha e é ali que os dois números são reais em vez de previstos | trocar o `raise` pelo `print`; `test_a_reserve_that_overflows_the_block_refuses_at_stamping_too` fica vermelho |

### D5 — o conjunto de vistos são os 10.000 do corpus morto, poda global, lido como artefato

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L2-12 | o conjunto de vistos passa a ser `benchmark/data/corpus-build/dataset/records.jsonl` — os **10.000** registros do corpus morto, todas as cinco partições — e a poda é **global** | é a decisão de desenho 2 do plano de entrega: superconjunto da graduação de § 3.4 (que readmitiria a linha casada em `train`, `dev` e `cal-A`), e o que se compra é que "nada deste corpus foi visto" seja UMA comparação em vez de restrição por partição. As ~1.600 linhas recuperáveis são abdicadas de propósito | trocar o caminho do artefato |
| L2-13 | **consequência declarada:** os 36.971 textos de `benchmark/data/dataset/{train,dev}.jsonl` deixam de ser telados | eram o treino do detector de 25/07, e o modelo de registro é retreinado **de zero** sobre o corpus novo (Fase 4), então aqueles textos não são "vistos pelo candidato". O que a graduação de § 3.4 grada é a exposição das cinco partições do corpus MORTO, e é isso que a tela nova cobre. Se a Fase 4 vier a reusar aquele dataset, esta linha é a que se retrata | acrescentar os dois arquivos à construção do índice |
| L2-14 | a montagem lê um **artefato** (`near_dupes.build_seen_index` / `write_seen_index` / `read_seen_index`), nunca o corpus morto | parte das 10.000 linhas esteve em partição cega. O artefato carrega, por documento, o digest do conteúdo tokenizado e as chaves de 8 bytes de blake2b dos shingles de 5 tokens — nenhum token do material —, e é a mesma lógica de "calcular sha256 do ledger é permitido": um PROGRAMA que lê bytes e emite digest não expõe conteúdo. Uma implementação que exigisse alguém ler uma linha de partição cega estaria errada | — |
| L2-15 | o lado visto é comparado como CHAVES e não como cadeias, e a **largura da chave é parte do contrato** | é o que permite uma implementação só: `drop_seen(docs, textos)` passa a ser `drop_seen_against(docs, build_seen_index(textos))`, sem bifurcar o algoritmo entre o caminho de texto e o de artefato. **A justificativa original desta linha estava ERRADA e a rodada adversarial provou com um par construído:** "colisão só pode ACRESCENTAR à interseção" é falso, porque colisão entre dois shingles que os dois documentos COMPARTILHAM tira um elemento da interseção e um da união ao mesmo tempo — 82/100 = 0,82 vira 81/99 = 0,8181 sob barra de 0,82, e a quase-duplicata SOBREVIVE. Sob crc32 o par saía de uma busca de segundos. Conserto em L2-20 | — |
| L2-16 | vocabulário FECHADO no cabeçalho e na linha de documento do artefato | um campo livre é onde alguém põe "só uma amostra para saber de que corpus veio", e a amostra É o material. Fechado nos dois lados, nenhum campo pode carregar texto — é asserção estrutural, e não confiança na disciplina de quem escreve. `read_seen_index` recusa contrato divergente, campo extra, índice truncado e blob de largura errada | remover as quatro conferências |
| L2-17 | o artefato é declarado **estritamente menos exposto** que o arquivo de que deriva, e não incondicionalmente opaco | chave de 64 bits de um 5-grama não é texto e não se inverte sozinha, mas um dicionário de 5-gramas de pt-BR poderia testar candidatos contra ela. O artefato vive em `benchmark/data/` (nunca no Git, nunca em pacote de evidência), no mesmo lugar onde o material já vive. Declarar o resíduo é mais honesto que alegar opacidade | usar hash com chave do keyring C3 — o que amarra a montagem ao keyring, que ela hoje não lê |
| L2-18 | montagem de **release** recusa sem o artefato (`SeenIndexMissing`) e recusa artefato com menos de 10.000 documentos (`SeenIndexIncomplete`) | o modo de falha substituído era pular a poda em silêncio: a guarda anterior era `if seen_texts:`, um teste de veracidade, então insumo ausente produzia corpus que não passara por tela nenhuma e não dizia nada. `DEAD_CORPUS_DOCUMENTS = 10_000` é medido (sha256 `595739107e895cfc7b09409f29c13b998d195e921f1ca7eec1e5c8406772116a`, 10.000 linhas) e o corpus morto é artefato congelado da corrida reprovada | uma constante |
| L2-19 | um smoke `--sample` sem artefato **avisa** e segue | um smoke não sela corpus, e exigir o índice de 10.000 documentos num fixture tornaria a montagem de fumaça intestável. O aviso é impresso, então a corrida não se apresenta como podada | trocar o `print` por `raise` |

**Medição do artefato real (v2, chave de 8 bytes):** 10.000 documentos, 3.323.576 chaves de shingle,
36.425.322 bytes, ~8 s para construir. A v1 (crc32) media 18.699.290 bytes e ~5 s; dobrar o arquivo local
é o preço da largura de chave de L2-20. O programa imprimiu apenas
contagens e o digest do arquivo de origem; nenhuma linha de conteúdo foi lida, impressa ou amostrada.

**Consequência operacional MEDIDA, e é grande.** `--sample 100` sobre os pools em disco contra o índice
real: `{'seen_texts': 10000, 'checked': 13880, 'dropped': 8133, 'dropped_exact_content': 8400,
'highest_similarity_kept': 0.534, 'candidates_evaluated': 425486}`. Isto é, **8.133 dos 13.880 candidatos
em disco (59 %) são duplicata exata ou quase-duplicata do corpus morto** — o que é esperado, porque os
pools de hoje são em boa parte o material de que o corpus morto foi montado, e é exatamente a razão pela
qual a Fase 3 re-extrai em vez de reaproveitar. A poda global não é um detalhe de higiene: ela é a
diferença entre um corpus novo e uma remontagem do abandonado.

Duas leituras da linha, para quem a for auditar: `dropped_exact_content` (8.400) é maior que `dropped`
(8.133) porque o primeiro conta OCORRÊNCIAS e o segundo é um CONJUNTO de chaves, e `enforce_unique_keys`
só roda depois — dois pools que carregam a mesma chave são contados duas vezes e descartados uma. É
propriedade preexistente da estatística, não efeito desta unidade. E `highest_similarity_kept: 0.534` diz
que o que sobrou não está encostando na barra de 0,82.

A corrida ainda reprova depois disso, pela mesma razão de pool que L1 registrou: em release,
`CellBelowOriginDocumentFloor` com **zero** documento de origem distinto nas quatro células; em smoke,
`HardNegativeCellUnderfilled`, porque as humanas selecionadas saem em `MissingLabelEvidence`. Os dois têm
uma causa só — os candidatos em disco não carregam `dateField`/`sourceMaterialBatch`/`groupAxes` —, e o
desbloqueio é a re-extração da Fase 3.

### O fixture de ponta a ponta, e por que os números dele são derivados

`AssemblyRunTests` roda `main()` inteiro sobre pools de fumaça e é o que dá dentes às três guardas nos
seus SÍTIOS DE CHAMADA. `--sample 100` pede 40 humanas, 40 `ai` e 20 mistas, e **40 é escolhido por
aritmética**: as quatro frações arredondadas de 40 (0,45/0,05/0,10/0,20) são inteiras e `test` é o resto,
então todas caem dentro de `CLASS_TOLERANCE`; em 12 ou 15 não caem e o corpo estampado é recusado antes
de a corrida alcançar o que se quer testar. Cada linha gerada carrega o próprio `version` e o próprio
digest de template porque os dois são eixos de UNIÃO (`SPLIT_GROUP_KEYS`): linhas que os compartilham são
um componente, e uma classe colapsada num componente reprova a guarda de geometria. Cada linha humana
carrega o próprio documento de origem pelo mesmo motivo. As cinco partições ficam povoadas.

**Achado do fixture, registrado porque vale para a Fase 3:** com `generatorVersion` na união do split, um
corpus REAL em que uma família compartilha uma versão entre suas linhas produz **um componente por
versão** — o mesmo problema de granularidade que L1-19 mediu no eixo `source`, no eixo do gerador. O
fixture escapa dando versão distinta a cada linha; um corpus de release não pode escapar assim, e a
escolha (versão por lote de geração, ou o eixo sair da união) é da Fase 3, junto da granularidade humana.

### Rodada de fechamento — as três correções que a revisão adversarial arrancou

A implementação acima foi submetida a uma rodada adversarial que **bloqueou** com três achados. Nenhum
deles foi refutado: os três eram verdadeiros e estão consertados. O padrão dos três é o mesmo, e vale
nomeá-lo — **frase publicada que o código não sustentava**: um contrato absoluto sobre shingles rodando
sobre chaves de 32 bits, uma guarda chamada `covers_the_dead_corpus` que só contava linhas, e um comentário
alegando cobertura dos pools sobre uma lista escrita a partir do slate.

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L2-20 | a chave de shingle passa de crc32 a **8 bytes de blake2b**, e a largura é parte declarada do contrato (`shingle_key`, `SEEN_SHINGLE_ENCODING`, artefato v2) | o par `aa7275 bb7275 cc7275 dd7275 ee7275` / `aa47144 bb47144 cc47144 dd47144 ee47144` colide em crc32 (232429220), e um par de documentos montado em torno dele media **exatamente 0,82** sobre cadeias e era MANTIDO: colisão dentro da interseção tira um elemento da interseção e um da união ao mesmo tempo, e 82/100 vira 81/99. Das três saídas — declarar a tela mais fraca, bifurcar texto/artefato, ou alargar a chave —, alargar mantém UMA implementação e põe o resíduo em `n²/2⁶⁵ ≈ 3e-7` sobre as 3,3 M chaves reais. Bifurcar deixaria o caminho que a release roda com a tela mais fraca; declarar sem alargar deixaria um par construtível em segundos atravessando a barra. Uma tela por chaves nunca é absoluta sobre shingles — para ser, teria de guardar os shingles, isto é, o texto —, então o honesto é dizer a largura e o número | trocar a função de chave; o artefato v1 é recusado por nome (`shingleEncoding`, `version` e nome de arquivo) |
| L2-21 | `assert_the_seen_index_covers_the_dead_corpus` confere o **digest** do que foi indexado contra `DEAD_CORPUS_SHA256` (`SeenIndexOfAnotherCorpus`) | contagem de documentos não identifica material: um índice construído por engano sobre os pools frescos (13.880 candidatos em disco) satisfaz `documents >= 10.000`, a montagem segue, e imprime como contaminação o resultado de comparar os pools contra si mesmos. É o mesmo modo de falha que `SeenIndexMissing` existe para eliminar, nas palavras do próprio código: um corpus montado sem tela nenhuma é indistinguível, pelos próprios artefatos, de um que passou pela tela. E o digest medido estava no repositório como **prosa em comentário** — medição que nada compara é folclore | apagar três linhas |
| L2-22 | **terceiro papel** — `EXCLUDED_GENERATOR_FAMILIES`: nove famílias `madras_*` de proveniência indeterminada, cujas linhas SAEM do corpus, contadas por família | os dois papéis não cobriam `ai_reserved.jsonl`: 1.185 linhas em nove famílias que a linha identifica por nome de corpus e nenhum provedor (`openrouter*` é ROTEADOR entre provedores, `victory_*` não diz nada, `gptoss5` nomeia justamente o provedor reservado). Core treinaria numa linha possivelmente OpenAI e destruiria a alegação de provedor ausente — a única alegação de gerador não visto deste release; reservar publicaria "gerador ausente do treino" sem saber o provedor, e as nove estão sob o piso de 200. É a leitura fail-safe de § 3.3. Distinto de `HELD_OUT_INELIGIBLE`: lá o provedor é conhecido (Google) e só a resolução do alias não é, e as linhas FICAM como IA comum | mover entradas entre dicts, no dia em que a linha registrar provedor |
| L2-23 | `POOL_GENERATOR_FAMILIES` — censo medido dos pools — e a cobertura conferida nos DOIS sentidos | "as listas cobrem os pools" era alegação de comentário, e falsa nas duas direções: a lista continha famílias que as lanes não põem e deixava nove famílias do pool fora. Agora família do pool sem papel recusa (`SlateContradiction`) e papel sobre família que o pool não entrega recusa também — a segunda é a que produziu o erro, porque uma lista escrita a partir do slate de geração passa a ser lida como derivada dos pools. O censo é literal porque os pools não estão no Git; o comentário carrega o comando de re-medição, e a guarda de igualdade força re-medir quando os pools mudarem | apagar as duas conferências |
| L2-24 | a ordem ascendente das chaves é conferida na **leitura** do artefato | é a única invariante do artefato cuja violação enfraquece **em silêncio** o único limite absoluto do módulo: `indexed_keys_from` lê a fatia INICIAL da ordem, então uma linha fora de ordem indexa subconjunto arbitrário e o limite de `MINWISE_FRACTION` deixa de valer, com todo o resto do contrato batendo. A mutação registrada antes cobria só o escritor | apagar a conferência |
| L2-25 | `read_seen_index` passa a **streamar** de fato — cabeçalho, depois linha a linha | a justificativa de formato descrevia um leitor que não existia: o comentário dizia "uma linha por documento para que um índice de 10.000 documentos STREAME em vez de ser mantido como um valor JSON" e a leitura materializava o arquivo inteiro antes de interpretar qualquer coisa. Consertar o leitor é mais barato que rebaixar a frase, e o arquivo dobrou de tamanho nesta rodada | voltar a materializar |
| L2-26 | `positive_rows_per_family` é função nomeada, e a docstring declara **qual população** o piso da reserva magra conta | o piso do lab conta LINHAS e o selado conta linhas ELEGÍVEIS (`countsTowardHeldOutFloor` -> `recordEligibility`), então o lab é limite superior e o raciocínio de L2-10 ("sobra uma saída só") dependia de as duas contagens serem a mesma. O lab NÃO passa a espelhar elegibilidade, e a razão é medida: no ponto da corrida em que o piso roda, `generationBatch` é `unknown` em toda linha gerada — é derivado depois do particionamento, porque `generatedAt` entra na chave do lote —, então a contagem por elegibilidade daria ZERO para toda família, e espelhar exigiria uma segunda cópia PARCIAL da regra selada: exatamente o defeito "duas grafias que nunca se encontram" pelo qual o módulo selado já está anotado. `harnessVersion` é o eixo que faz as duas contagens diferirem de verdade nos pools de hoje | o lab passa a contar elegibilidade; `test_the_floor_counts_lines_and_not_the_sealed_eligible_population` fica vermelho |
| L2-27 | o `MANIFESTO-DE-TRANSPLANTE.md` deixa de mandar apontar `seen_texts` para os textos do corpus antigo | era o procedimento que L2-14 acabara de proibir, num documento de produção. A varredura repo-wide de alegações é da Fase 7, mas uma frase que contradiz regra em vigor custa uma linha | — |

### Prova por mutação

**Unidade:** 20 mutações, 20 vermelhas no teste NOMEADO, base verde nas duas pontas (255 testes + 19
subtests) e restauração conferida por sha256 idêntico nos dois arquivos de produção. Cobrem: o fallback de
governança de volta (2 vermelhos); `declared_held_out_families` substituindo em vez de recusar (3); o papel
voltando a prefixo de nome (2); o papel lendo `generation.family` (2); a reserva não sendo assentada no
bloco cego; `>=`→`>` na borda do bloco cego; o bloco cego conferindo só a classe `ai`; as três conferências
do slate, uma a uma; a poda global não filtrando os pools; release sem artefato deixando de recusar; índice
parcial deixando de recusar; as quatro conferências de leitura do artefato; a proveniência voltando a ser
livre; o `+1` do subconjunto garantido na versão por chaves; e as chaves de shingle deixando de sair
ordenadas.

**Rodada de fechamento:** 14 mutações, base verde nas duas pontas (266 testes + 19 subtests) e restauração
conferida por sha256 nos dois arquivos de produção. As sete que a revisão pediu: a chave voltando a crc32
(**vermelho no par de colisão pinado — é a prova de que o achado 1 era real e de que o conserto o mata**);
o digest do corpus morto deixando de ser conferido; chaves em ordem descendente aceitas na leitura; família
de pool classificada por DEFAULT em vez de parar a corrida; a cobertura do censo deixando de ser conferida;
`drop_seen` voltando a comparar cadeias enquanto `drop_seen_against` compara chaves; o print inalcançável
trocado por `raise` (**verde, como pedido — é a prova de que estava morto, e é por isso que ele virou
recusa**); e o piso passando a contar elegibilidade. Mais seis re-provas sobre o código que esta rodada
refatorou: o fallback de reserva vazia, o papel por prefixo, o `+1` do subconjunto garantido, as chaves não
ordenadas na escrita, release sem artefato, e a recusa nova no carimbo.

**Uma ressalva honesta sobre a mutação "`drop_seen` volta a cadeias".** Ela fica vermelha, mas o que a mata
é a igualdade das ESTATÍSTICAS (`candidates_evaluated`) e não a divergência de veredito: com a chave a 64
bits, uma implementação por cadeias e uma por chaves concordam em todo par construtível, e essa concordância
É o que a largura compra. O teste ganhou uma expectativa calculada sobre as CADEIAS dentro do próprio teste,
que é o que o achado 5 pedia — duas implementações por chave concordando entre si não dizem nada sobre
nenhuma delas honrar a frase que publicam.

### O que esta unidade NÃO fez, de propósito

- **o lado SELADO não impõe a reserva.** `sealDataset` confere a contagem de positivos por família
  declarada, não que as famílias reservadas pela política estejam na lista. Hoje o lab é o único produtor
  e a guarda vive nele; um gate selado é caminho selado (tríade completa, e move o `evaluatorDigest`), e
  fica **como dívida com dono na Fase 3, item 3**, junto do congelamento do split;
- **a reserva não foi dimensionada.** L2-9 recusa uma reserva que enche o bloco cego, e com os pools de
  hoje ela recusaria: 1.402 contra 800. Quantas linhas cada lane gera é cota de coleta, da Fase 3;
- **`benchmark/data/dataset/{train,dev}.jsonl` deixam de ser telados** (L2-13), com a retratação escrita;
- `load_humans` continua lendo `reserved.jsonl` por constante de módulo — achado de L1, ainda aberto; o
  fixture desta unidade redireciona `DATASET` para não montar a reserva real;
- **o lado selado não conhece o terceiro papel.** `sealDataset` não sabe que existe família excluída; a
  exclusão é do produtor, e um corpus montado por outra ferramenta poderia trazer as nove. Mesma dívida de
  "o lado selado não impõe a reserva", mesmo dono (Fase 3, item 3);
- **as 1.185 linhas excluídas são cota de coleta que a Fase 3 tem de fechar**, junto do dimensionamento da
  reserva. Custo hoje: zero medido — as nove famílias já morriam em `UnmappableLane` por metadado ausente,
  e é exatamente a re-extração que as reviveria sem papel, se a cobertura não fosse conferida;
- `ESTADO.md` **não foi reescrito**: a reescrita das seções 1 e 5 é a última unidade desta fila. As linhas
  que esta unidade torna verdadeiras no código são a de § 3.3 ("famílias OpenAI ficam reservadas ao teste
  de gerador não visto; nenhuma entra em treino") e a de § 3.3/A3 (`drop_seen`), cuja descrição não muda.

## Fase 2, unidade L3 — licença por documento e gate antiartefato: D8 e D13 (2026-08-05)

Duas divergências, e as duas eram frase publicada sem código por baixo: o ESTADO.md § 3.3 diz "licença
lida **por documento** (header TEI), com allowlist fail-closed no extrator" e diz "gate antiartefato
**pré-treino**" — a primeira metade era verdadeira e a segunda não existia.

### D8 — onde a licença morria, medido

`cell_of` devolvia `HUMAN_SOURCE[domainSource]`, e o segundo elemento da tupla era a licença. Isto é: a
licença do registro vinha do **ESTRATO**, e o `licenseId` que o extrator escreveu na linha do pool nunca
era lido — `grep licenseId assemble_corpus.py` não tinha uma única leitura do candidato. Todo registro da
Carolina saía `cc-by-nc-sa-4.0` qualquer que fosse o header que o documento declarou.

A perda era silenciosa por acidente do pool e não por desenho, e o acidente é **estreito** — medido por par
(`domainSource`, `licenseId`) sobre os 11.600 documentos da Carolina em disco, e não sobre uma amostra:

| escopo | documentos | licenças |
|---|---:|---|
| em moldura (judicial + social + universitário) | 7.774 | `cc-by-nc-sa-4.0` só |
| `carolina.jsonl` inteiro | 8.000 | `cc-by-nc-sa-4.0` 7.997, `cc-by-sa-4.0` **3** |
| `carolina_fresh.jsonl` inteiro | 3.600 | `cc-by-nc-sa-4.0` só |
| Wikipédia (`wikipedia_fresh.jsonl`) | 5.000 | `cc-by-sa-4.0` só |

Os 3 heterogêneos estão em `carolina_public_domain_works`, tipologia FORA da moldura: é só por isso que a
constante e a leitura concordavam. `SourceCarriesTwoLicenses` é portanto **alcançável e já está em disco**,
não é defensiva — o primeiro documento em moldura com header diferente aborta a montagem inteira, e a Fase 3
re-extrai de 38.189 + 26.409 + 8.863 documentos. Os dois remédios que a recusa nomeia ficam fora do lab e
são da Fase 3: dividir `src_carolina` por licença (uma fonte por licença no manifesto revisado), ou levar a
licença a um caminho por registro no esquema selado. O extrator admite **quatro** licenças
(`extract_carolina.LICENSE_MAP`), e é a primeira Carolina com um documento `cc by 4.0` que teria publicado
NC sobre material que não é NC.

O conserto e as três decisões que ele forçou:

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L3-1 | `HUMAN_SOURCE` passa a `domainSource -> sourceId`, e a licença sai dele. `document_license(cand)` é a única origem da licença de um registro **humano** | um mapa do estrato para a licença é a constante que engoliu a leitura; mantê-lo como conferência per-fonte seria a mesma constante mais gentil, e recusaria justamente a fonte que legitimamente passe a trazer duas | uma tupla |
| L3-1b | a licença de um registro **gerado** é a concessão deste repositório (`GENERATED_LICENSE`), e `generated_license(cand)` RECUSA o candidato que declare outra | o texto foi produzido aqui, então a licença não é lida da linha — mas isso vale só enquanto todo pool gerado é geração NOSSA, e `import_public_corpus.py` é produtor VIVO do outro caso: escreve o corpus gerado de um terceiro sob a licença desse terceiro (`odc-by-1.0`, 12.000 linhas em `ai_public_madras.jsonl`). Republicar aquelas linhas como `geracao-propria-v1` seria publicar uma concessão que ninguém aqui pode fazer. Aborta, e à FRENTE de todo descarte: uma queda contada linha por linha é o jeito silencioso de acabar com um corpus sob a licença errada | uma função |
| L3-2 | o `entryId` da evidência de rótulo passa a nomear a licença | `assertLabelEvidenceResolves` indexa `entryId -> UM digest` e a licença está DENTRO dos bytes digeridos. Sem ela no id, dois documentos de um snapshot sob licenças diferentes dão uma chave e dois digests: a dedução por `entryId` guarda o último e todo registro apontando para o outro reprova por divergência de digest — a única recusa desse caminho que não nomeia nada em que agir | uma f-string; nenhum corpus selado existe, `issuedAt` é nulo |
| L3-3 | `governance-inputs.licenses[]` e a licença de cada `sources[]` passam a ser PROJETADOS dos registros, contra a allowlist `LICENSE_INVENTORY` | `validateDatasetManifest` recusa registro cuja licença não esteja no inventário (`DATASET_LICENSE_INVALID`), e um inventário com entrada que nenhuma linha usa declara termos a que o corpus não está sujeito. As duas direções são guarda | duas funções |

**A recusa é graduada, e a graduação é a de `UndecidedDomainSource`.** Licença ausente ou que o inventário
revisado não publica: `MissingDocumentLicense`, subclasse de `UnwritableInV3` — a linha sai, contada, com o
nome do documento. Licença que **nenhuma** das duas listas nomeia: `UndecidedDocumentLicense`, que para a
corrida. `cc-by-4.0` e `public-domain` ficam nomeadas em `UNREVIEWED_DOCUMENT_LICENSES` com a razão:
registrar os termos de uma licença é ato do inventário do corpus (`CORPUS_LICENSE_REGISTRY`, que não tem
nenhuma das duas), e "domínio público" é um **status** e não um instrumento — qual regime coloca o
documento lá é o que decide as obrigações. A conferência é contra a allowlist do EXTRATOR, então uma
licença acrescentada lá sem decisão aqui aparece como teste vermelho.

**A fonte sob duas licenças RECUSA** (`SourceCarriesTwoLicenses`). `ReviewedSourceEntryV1.licenseId` é uma
string: o manifesto revisado declara uma licença por fonte. Quando os documentos de uma base declaram
duas, toda escolha é falsa sobre parte das linhas e escolher a maioria é a pior delas por ser invisível.
Levantar o limite é decisão de esquema no lado **selado** (caminho de licença por registro), então o lab
recusa em vez de escolher — e este é o achado de desenho que o transporte revelou.

**Efeito medido na corrida real** (smoke 400 sobre os pools de hoje): as 160 linhas que morriam com
`MissingLabelEvidence` agora morrem 40 com `MissingDocumentLicense` + 120 com `MissingLabelEvidence`. São
as MESMAS linhas, recusadas um passo mais cedo pelo primeiro fato ausente: as 40 são os humanos
"reservados-limpos" que `load_humans` sintetiza de `reserved.jsonl`, que não carregam licença nem data.

### D13 — o gate antiartefato, em código

`benchmark/lab/artifact_gate.py`, chamado por `main()` **depois** da exclusão de famílias do slate e
**antes** de toda contagem por família e de `assign_partitions`. "Pré-treino" tem um significado exato
aqui: o conjunto de treino é o `train.jsonl` do split, o split é cortado destes registros, logo um corpus
que passe daqui é um corpus que um treino pode ler. A recusa fica **à frente de `records.jsonl`**: um
corpus contaminado não chega a existir em disco.

**Não é condicionado a `--sample`**, diferente do piso de documentos de origem (L1-6) e da reserva magra
(L2). A distinção é de tipo de grandeza e está registrada: um PISO é uma contagem sobre a cota de release
e uma fumaça carrega uma fração dela por construção, então comparar fumaça com piso reprova toda fumaça
pela única razão que não é defeito; uma FRAÇÃO de contaminação não tem essa propriedade, e um artefato
detectado é um artefato tenha sido achado em fumaça ou em release.

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| L3-4 | as sondas de `prompt-echo` derivam de `generate_ai.RECIPES`, só da parte anterior a `{reference}` | "a saída repete o prompt" significa os prompts que ESTE repositório emite. O eco da referência é quase-duplicata de linha humana, decisão do `near_dupes`, e contá-lo aqui seria o mesmo fato com dois nomes | uma função |
| L3-5 | mais quatro sondas de FORMA de instrução, independentes de quem emitiu o prompt | os ecos MEDIDOS nos pools são ecos do prompt de um TERCEIRO: as linhas `madras` carregam "aproximadamente 1000 palavras em portugues brasileiro", sentença que nenhum template nosso contém. Só com os templates, essas linhas sairiam classificadas como `harness-signature` e o eco ao lado do marcador passaria | um dicionário de 4 entradas |
| L3-6 | as sondas de `refusal` exigem o OBJETO da recusa ("com isso", "esse pedido"), e posição não é usada | medido: as três frases de recusa que casam prosa HUMANA nos pools ("não posso ajudar ninguém", "não posso escrever aqui um testamento", "eu não posso te ajudar porém tenho uma informação") estão nos offsets 10, 67 e 214 — dentro de qualquer janela de abertura que valha a pena. O que separa recusa de prosa é o objeto, não o lugar | uma tupla |
| L3-7 | as sondas de `metaconversation` são FRAMES (entrega, oferta, autoidentificação em primeira pessoa) | "inteligência artificial" é TEMA de 26 das 4.048 linhas geradas, todas prosa sobre IA; "aqui está" casa "aqui está o bean responsável"; "segue abaixo" casa "segue abaixo a relação dos agrupamentos". O frame nomeia o artefato entregue, a frase solta nomeia o assunto | uma tupla |
| L3-8 | as sondas de `harness-signature` são `CLI_BANNER_PREFIXES` + `GEMINI_AUTH_MARKERS` do próprio gerador, o marcador de turno `assistant`, os tokens `<\|…\|>`/`[INST]` e bytes de controle de terminal | uma lista copiada seria segunda autoridade capaz de divergir. Das quatro lanes congeladas só a `gemini-cli` filtra banner antes de escrever e a `agy` grava `proc.stdout` cru — a assimetria é medida no código, não suposta. `<s>`/`</s>` ficam FORA: são HTML válido e os pools carregam respostas com HTML. `user`/`system` soltos ficam fora: casam "user-agent: *" e "System.ArgumentOutOfRangeException" | duas tuplas e uma regex |
| L3-8b | a fronteira do marcador de turno é a **LINHA** (`fold_lines` sob `re.MULTILINE`), não a pontuação de frase | a forma canônica do vazamento de chat template é o marcador SOZINHO na própria linha, e o fold achatado colapsa toda quebra em espaço — a forma canônica fica sem fronteira à frente e não é detectada. Medido: pontuação de frase alcança 24 das 4.048 linhas geradas, a fronteira de linha alcança 146, e as duas dão ZERO nas 42.100 linhas dos pools humanos. Sem isso, 95 linhas com a forma canônica não disparavam detecção nenhuma | um argumento de `re.search` |
| L3-9 | numa linha mista, só os VÃOS `origin: "ai"` são varridos | medido: varrer as 2.135 mistas inteiras acha 15 despedidas de assistente e varrer só os vãos gerados acha 1 — as outras 14 são respostas de fórum em pt-BR que terminam em "espero ter ajudado", vindas do PAI humano. Sem a restrição, a metade humana decide o veredito da lane | uma função |
| L3-9b | linha de geração controlada cuja projeção de vãos gerados seja VAZIA recusa (`GeneratedRowCarriesNoGeneratedSpan`) | `mixed_record` calcula `aiFraction` desses mesmos vãos e não recusa zero, então a forma é construível: uma linha que vai para treino como geração controlada e que sai do denominador da própria família em silêncio. O gate cuja saída inteira é uma fração por família não pode ter linha fora do denominador sem dizer — é o mesmo fail-closed de `LineNotAttributable`, no eixo do vão | três linhas |
| L3-10 | o teto lê CONSTANTE (`Fraction(2, 100)`) e não a política | `preregistration-v4.json` está congelada e não tem campo de contaminação; acrescentar um seria mudança de política e não leitura dela. `Fraction` e não `float` porque A4 diz "mais de 2 %" e a fronteira não pode depender de 0,02 ser representável em binário | uma constante, no dia em que a pré-inscrição ganhar o campo |
| L3-11 | o relatório **não nomeia linha nenhuma** | é assim que a poda seletiva que A4 proíbe deixa de ser alcançável em vez de apenas desaconselhada: não há o que derrubar a jusante. O que o relatório publica por detecção é a SONDA que casou, que é o diagnóstico acionável ("esta família ecoa a diretiva de contagem de palavras"), sem identificar a linha | um campo |
| L3-11b | `artifact-gate.json` é escrito **antes** do veredito, então a recusa também o publica | a mensagem da recusa carrega o nome das detecções e as contagens; as SONDAS que casaram — o diagnóstico que L3-11 chama de acionável — vivem só no relatório, e publicá-lo só quando o gate PASSA é publicar diagnóstico exatamente quando não há o que diagnosticar. É o único artefato que uma corrida recusada escreve: nem `records.jsonl`, nem `governance-inputs.json`. Não reabre a poda, porque continua sem nomear linha | duas linhas movidas |
| L3-11c | **não há denominador mínimo**, e em fumaça o teto degenera a tolerância zero — declarado, com teste que pina o comportamento em n pequeno | com 6 linhas numa família a menor fração não nula é 1/6, então uma detecção recusa. A alternativa é uma família que o gate MEDE e sobre a qual não age: um terceiro desfecho além de passar e recusar, e é para ele que se estende a mão sob prazo. Uma fração é adimensional e um artefato é artefato em qualquer n; e o remédio custa menos exatamente quando a lane é pequena. É a diferença deliberada em relação ao piso de L1-6, que é uma CONTAGEM sobre a cota de release | uma condição |

**Por que regenerar a lane e não podar, formalmente.** Derrubar as linhas contaminadas deixa como corpus
justamente as que o detector NÃO pegou: a seleção passa a depender do mecanismo de detecção — dado
faltante não aleatório (Rubin, 1976) — e o viés da lane entra no corpus sem registro. É o Ponto 3 de
Deming aplicado a um pipeline de geração: a triagem em massa não muda o processo que produziu o defeito, e
aqui o processo É a lane.

### O que o gate mede hoje, e a convergência com L2

Medido em 2026-08-05, sobre os pools em disco:

| medição | valor |
|---|---:|
| linhas geradas com ao menos uma detecção | 148 de 4.048 (3,656 %) |
| por detecção | `harness-signature` 146, `prompt-echo` 42, `metaconversation` 5 |
| `madras_synthetic_corpusqwn` | 146 de 150 (**97,33 %**) → regenerar a lane |
| `madras_synthetic_corpus_openrouter23` | 2 de 147 (1,36 %) → limpa |
| controle humano, que o gate nunca lê | 0 de 42.100 no marcador de turno; 2 de 8.600 no total (0,023 %) |
| registros gerados que a montagem constrói **sem** a poda global | 1.170 |
| famílias que chegam ao gate, nessa condição | 5, todas `clear`, 0 de 1.170 |
| registros gerados que chegam ao gate **com** a poda global | 0 — sobram 19 candidatos `ai` e 135 mistos, e os 154 são recusados em `MissingRecipe`/`UnmappableLane` |
| lanes a regenerar hoje | nenhuma, nas duas condições |

O gate está verde hoje, e a razão é boa: a única família acima do teto é
`madras_synthetic_corpusqwn`, que **L2 já exclui** por proveniência não registrada, e as demais famílias
contaminadas morrem antes em `MissingRecipe`/`UnmappableLane` por metadado ausente. Duas guardas
independentes recusam a mesma família por razões diferentes — a de L2 é sobre o PROVEDOR que a linha não
registra, a de L3 é sobre o ARTEFATO que o texto carrega —, e é isso que faz de 97,33 % um número a
publicar em vez de uma hipótese: se a re-extração da Fase 3 revivesse aquelas linhas com metadado
completo, o gate as pegaria.

O controle de falso positivo de 0,023 % sobre 8.600 linhas humanas é 87 vezes menor que o teto, e é ele
que sustenta manter as frases de despedida como sonda em vez de descartá-las: mesmo se a classe IA
carregasse a mesma taxa de registro de fórum, ela não chegaria perto de 2 %.

Um falso positivo medido foi consertado no desenho: `de 3 a 5 palavras-chave`, numa chamada de trabalhos
de documento universitário da Carolina, casava a sonda de contagem de palavras. `palavras(?![-\w])` entra
na sonda de diretiva **e na derivação dos chunks de template**, e é a segunda metade que mata a classe:
dois chunks de `generate_ai.RECIPES` terminam nessa palavra, então `com aproximadamente 5 palavras-chave`
casava a sonda DERIVADA mesmo com a de diretiva consertada. Medido: das 8.600 linhas humanas, 4 contêm o
composto e nenhuma casa.

### O que a rodada adversarial pegou, e o que ela mediu

Um bloqueante e sete menores; **nenhum refutado**, os oito eram verdadeiros e sete viraram guarda nova.
O padrão é o mesmo das duas unidades anteriores: frase publicada que o código não sustentava.

O **bloqueante** era o marcador de turno (L3-8b acima). A sonda rodava contra o texto ACHATADO, onde toda
quebra de linha virou espaço, exigindo `.!?:` à frente — então a forma canônica do vazamento não era
detectada, e o docstring publicava 24 como censo do que existe. Reproduzido e medido: 141 das 4.048 linhas
carregam a forma de linha, a sonda alcançava 24, e **95 linhas não disparavam detecção nenhuma**.
`madras_synthetic_corpusqwn` vai de 51/150 a 146/150. Nenhum veredito de HOJE muda, porque as 95 estão
todas na família que o slate já exclui — e é bloqueante por isso mesmo: o gate existe para a re-extração da
Fase 3, que o próprio registro diz que revive aquelas linhas.

As outras sete, e o que cada uma consertou: a derivação de template sem o lookahead do composto (a frase
"mata a classe inteira" era falsa em três documentos de produção); `artifact-gate.json` nunca escrito na
recusa (L3-11b); `test_the_probes_are_the_generators_own_constants` que passava com
`_echo_probes_from_templates()` devolvendo `{}` inteiro, porque o rótulo escrito à mão `responda apenas com`
está nos quatro templates — quem pegava a mutação era outro teste, e o comentário prometia o que a asserção
não guardava; a licença constante da classe GERADA contra o L3-1 sem qualificação (L3-1b); a medição
"3.600 candidatos" que media 3.600 de 11.600 e escondia que o caso de duas licenças **está em disco**; a
linha mista sem vão gerado (L3-9b); e o teto sem denominador mínimo (L3-11c).

### Verificação

- `pytest`: **304 passed + 19 subtests** (base da unidade 266 + 19; +38 no total, +6 no fechamento).
  `ruff check` limpo nos quatro arquivos;
- `npx vitest run`: 169 arquivos / 2.760 testes (linha de base — nenhum arquivo TypeScript foi tocado);
- `npm run typecheck` limpo; `npm run lint` 13 problemas pré-existentes; `format:check` verde;
  `docs:check` OK; `git ls-files --eol | grep w/crlf` vazio;
- **`evaluatorDigest` NÃO move**: nenhum dos quatro arquivos tocados é membro de `EVALUATOR_FILES`
  (conferido em node contra os 52 membros — interseção vazia);
- **prova por mutação: 26 na unidade + 9 no fechamento**, base verde nas duas pontas e restauração
  conferida por sha256. Na unidade, duas tentativas iniciais sobreviveram por defeito do DRIVER
  (`{} or {...}` avalia para o segundo operando: a mutação era no-op) e uma sobreviveu de verdade — o
  refator de `GEMINI_NOISE` não tinha teste e ganhou um. No fechamento, duas sobreviveram na primeira
  rodada e as duas são achados honestos:
  - **M33 era falso-verde do meu próprio fixture**, e o defeito é exatamente o que D8 nomeia: com as
    licenças que os pools declaram por padrão, a constante por estrato CONCORDA com a leitura, então o
    teste de ponta a ponta passava com a projeção revertida. O fixture ganhou um parâmetro que faz os
    documentos da Carolina declararem a licença enciclopédica — o caso que a constante não consegue
    reproduzir — e a mutação passou a vermelho;
  - **M35 (`>` vira `>=`) é no-op no teste de n pequeno, por aritmética**: `ratio == 2/100` exige
    denominador múltiplo de 50, e com n=6 nenhuma fração alcançável está na fronteira. A mutação não está
    indetectada — ela sai VERMELHA em `test_the_ceiling_is_exclusive_at_exactly_two_percent`, que é o teste
    a quem a fronteira pertence (20/1000), conferido.

### O que esta unidade NÃO fez, de propósito

- **o lado SELADO não confere licença por registro contra a fonte.** `auditRecords` junta
  `provenance.sourceId` ao manifesto e não compara a licença; quem recusa uma licença fora do inventário é
  `validateDatasetManifest`. Uma guarda que exigisse concordância registro↔fonte é caminho selado e move o
  `evaluatorDigest`; fica como **dívida com dono na Fase 3, item 1**, junto do inventário de material;
- **`cc-by-4.0` e `public-domain` continuam sem termos revisados.** Entram no
  `CORPUS_LICENSE_REGISTRY` quando o inventário do corpus as revisar; hoje custam zero, medido — nenhum
  dos **11.600** documentos da Carolina em disco declara qualquer uma das duas;
- **a fonte sob duas licenças recusa, e a Fase 3 vai bater nisso.** Está em disco hoje (3 documentos em
  `carolina_public_domain_works`), fora da moldura por sorte da tipologia, não por desenho. O remédio —
  dividir `src_carolina` por licença, ou licença por registro no manifesto selado — é decisão de esquema e
  fica com dono na Fase 3, ao lado do inventário de material;
- **o gate não roda sobre os POOLS, só sobre os registros.** O número de 3,656 % foi medido por sonda
  fora da montagem; pôr o gate na coleta seria uma segunda autoridade sobre a mesma pergunta, e a que
  decide é a que roda antes do treino;
- **`train_detector.py` não confere o relatório do gate.** Hoje o único caminho até um `train.jsonl` passa
  pela montagem, então a guarda está onde precisa estar; um segundo produtor de corpus tornaria isso
  falso, e é a mesma dívida de "o lado selado não impõe a reserva" (L2);
- **a montagem de release continua reprovando antes do gate**, em `CellBelowOriginDocumentFloor` com zero
  documento de origem por célula — blocker de L1, desbloqueado pela re-extração da Fase 3;
- `ESTADO.md` **não foi reescrito**: a reescrita das seções 1 e 5 é a última unidade desta fila. As linhas
  que esta unidade torna verdadeiras no código são as duas de § 3.3: "licença lida por documento (header
  TEI), com allowlist fail-closed no extrator" e "gate antiartefato pré-treino" / "família com >2 %
  contaminada regenera a lane inteira".

---

## O inventário de material: a janela ratificada e a versão medida (2026-08-04/05)

**Status:** a janela de aquisição é **RATIFICADA PELO OPERADOR** (2026-08-04); as quatro decisões de
grafia e de recorte são `EM-VIGOR (delegada)`. Nada aqui é para implementar agora — o produtor do
inventário é a **Fase 3, item 1**, com dono e entrada declarada. O que esta seção resolve é outra coisa:
os fatos abaixo eram a única parte do estado do projeto que vivia num arquivo **fora do Git**, e um lote
de material cujos campos só existem fora do repositório é a proveniência inventada que R4 proíbe,
atrasada em um passo.

`SourceMaterialBatchV1` exige cinco campos (`benchmark/source-manifest.ts:238`), e três deles —
`materialVersion`, `acquisitionWindow` e `evidence` — são fatos que **nenhum código deste repositório
detém**. É por isso que a entrada é declarada e não sintetizada.

### Ratificado pelo operador — a janela de aquisição dos dois lotes

| lote | janela | âncora |
|---|---|---|
| `smb_ptwiki-20220301` | pontual, `startedAt === endedAt` = `1784753446707` | mtime de `ptwiki-20220301-pages-articles.xml.bz2` |
| `smb_carolina-2_0-bea` | pontual, `startedAt === endedAt` = `1784752441472` | mtime de `archive.zip` |

`acquisitionWindow` admite o evento pontual por desenho — o comentário do campo diz que
`startedAt === endedAt` é legítimo —, então a forma não foi forçada para caber.

**Por que foi PEDIDA em vez de assumida.** O mtime é **evidência**, não declaração: nada nele distingue
"baixado naquele instante" de "copiado naquele instante". A diferença é material, porque um lote é a
identidade do que foi adquirido, e um instante de cópia nomeia a última movimentação do arquivo e não a
aquisição. Assumir seria o agente decidindo, por inferência do sistema de arquivos, um fato sobre o mundo
de que só o operador é testemunha. Custo de reversão da ratificação: reemitir o lote com outra janela move
o `sourceManifestDigest`, logo move toda evidência publicada sobre o corpus — barato hoje (`issuedAt` é
nulo, 0 tags, nenhum corpus selado existe), irreversível depois da Fase 5.

### Decisões do agente, com razão e custo de reversão

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| M-1 | a versão da Carolina é **MEDIÇÃO** e não declaração: o header TEI a carrega em **dois lugares independentes** — `<title type="sub">Version 2.0 (Bea)</title>` e o `href` do `xml-model` apontando para `.../corpus-carolina/raw/v2.0/corpus/schema.rng` —, e a varredura dos **46** arquivos das três tipologias da moldura deu `v2.0` em 46/46 e `Version 2.0 (Bea)` em 46/46, zero divergência | a hipótese que a varredura exclui é **pacote de versão mista**, e ela não é remota: um zip é um contêiner, e nada impede que membros tenham sido montados de releases diferentes. Sob versão mista um `batchId` só seria uma **mentira** — declararia uma versão imutável para material que não a tem, e todo registro humano resolveria contra um lote que não descreve a linha. Duas âncoras e não uma porque um `<title>` é texto editável e um `href` de schema é o contrato de validação: divergirem é o sinal, concordarem nos 46 é a medição | reabrir a varredura, que custa a leitura dos 46 headers e nada mais |
| M-2 | `materialVersion` = **`carolina-2.0-bea`**, e não o verbatim `Version 2.0 (Bea)` | o verbatim vira o `batchId` `smb_Version_2_0_Bea` sob a canonização de identificadores, e esse nome tem dois defeitos que se somam: **não nomeia a fonte** (um lote é lido ao lado de outros, e "Version 2.0" não diz de quê) e **colide** com qualquer corpus futuro que também se chame "Version 2.0". A verificabilidade não mora na grafia: mora nas duas âncoras do TEI, que entram em `evidence`. Trocar a grafia pelo verbatim não acrescenta prova nenhuma e perde a desambiguação | um literal, enquanto nenhum manifesto v2 estiver escrito |
| M-3 | **um** `batchId` para as três tipologias da Carolina, e não três | as tipologias são **partições de um download**, não três aquisições: um arquivo, um instante, um digest. Três lotes declarariam três eventos de aquisição que não ocorreram, e o campo é sobre aquisição. É a mesma medição de G0.1-bis vista do outro lado — um evento de aquisição por fonte é exatamente o que mantém `sourceMaterialBatch` **fora** da união do split; se cada tipologia fosse um lote, o eixo recuperaria granularidade e a tentação de unir sobre ele voltaria com ela, com o mesmo desfecho já medido (um bloco por célula) | dividir em três exige refazer janela e digest por tipologia, o que o arquivo em disco não sustenta |
| M-4 | o digest do lote é do **arquivo adquirido**, não do extraído | `materialVersion` pede "a versão concreta e imutável do que foi adquirido"; o extraído é derivado e muda com o extrator, então um digest do extraído dataria o **nosso** código e não o material | recomputar, ao custo da leitura dos dois arquivos |

### Os digests, medidos em 2026-08-04 e reconferidos em 2026-08-05

| lote | `sourceId` | arquivo | bytes | sha256 |
|---|---|---|---:|---|
| `smb_ptwiki-20220301` | `src_wikipedia_pt` | `ptwiki-20220301-pages-articles.xml.bz2` | 1.955.910.144 | `70c9ec4f700205ab586ab86dd21a5fe62fc543a5341770c84a28c343225f8b52` |
| `smb_carolina-2_0-bea` | `src_carolina` | `archive.zip` | 3.131.075.648 | `3fde823cc3abe9521d2bff119732f1c0bce52bf8ccc15cc893fba5f7531dbc19` |

Os dois arquivos vivem **fora** do repositório, e é por isso que o digest é o que os torna verificáveis
por terceiro. `src_wikipedia_pt` e `src_carolina` são as duas fontes que `HUMAN_SOURCE`
(`benchmark/lab/assemble_corpus.py`) já declara, então o lote não introduz fonte nova: ele data e
identifica as que existem.

---

## A emenda da moldura: a alegação passa a UMA célula — DECIDIDA PELO OPERADOR em 2026-08-05

**Status:** `EM-VIGOR`. A decisão da moldura é do operador; a medição que a sustenta e as escolhas de
grafia, de aritmética e de recusa são do agente, registradas abaixo com razão e custo de reversão.

A moldura amostral publicada passa a ter **uma** célula: **texto enciclopédico, Wikipédia pt, dump
2022-03-01**. As três tipologias da Carolina — *judicial branch*, *university domains*, *social media* —
saem da moldura. Com elas saem `m=7`, α por hipótese 0,007143 e o teto de 1,6337 %; entram `m=4`,
α 0,0125 e **dois** pontos declarados do teto.

### A cadeia de evidência, medida

A revisão adversarial da Fase 2 (unidade L1, `.codex-reviews/fase2-L1-review.md`) achou duas coisas, e a
segunda é a que abriu esta emenda:

1. o gate de composição lê como **documento de origem** o eixo `source`
   (`benchmark/composition-gate.ts`, `ORIGIN_DOCUMENT_AXIS = "source"`), e o extrator da Carolina emite
   nesse eixo o **arquivo-membro** do pacote (`extract_carolina.py`, `carolina_member_<arquivo>`). As três
   tipologias da moldura têm **37 / 7 / 2** arquivos-membro contra piso de **300** unidades, sob
   `collection.maximumLinesPerOriginDocument = 1`. Nenhuma re-extração muda isso: o pacote não tem mais
   arquivo-membro;
2. o vocabulário da célula estava escrito em **duas** grafias que ninguém comparava — `humanCoreStrata`
   (`encyclopedic`/`judicial`/…) e `preRegistration.quotaAxis.cells` (`ptwiki`/`carolina-judicial`/…) —, e
   nenhum gate lia a primeira.

A medição própria sobre `snapshots/archive.zip`, **por header de documento** (2026-08-05, nunca corpo):

| tipologia | documentos | pré-corte | autores declarados | hosts |
|---|---:|---:|---:|---|
| *judicial branch* | 38.187 | 38.187 | **0** | 5, todos `*.stf.jus.br` (redir 31.713 · portal 4.241 · notícias 1.089 · stf 611 · 533 sem URL) |
| *university domains* | 26.409 | 26.409 | **0** | 1, `jornal.usp.br` |
| *social media* | 8.862 | 3.294 | 104 (o maior com 200 documentos) | 1, `wattpad.com` |

As três células da Carolina são de **instituição única**. Isso tem duas consequências, e elas são
independentes: **unidades insuficientes** (104 contra 300 na melhor delas; zero nas outras duas, porque
sem autor a unidade recua ao arquivo-membro) e **população mal declarada** — publicar "FPR em texto
judiciário" a partir do STF, "em domínio universitário" a partir de um jornal e "em rede social" a partir
de ficção do Wattpad é over-claim.

A afirmação precisa, nestes termos: **o material não carrega a proveniência necessária para estabelecer
independência na escala que a alegação exige.** Não é que o STF valha uma unidade; é que entre 1 e 38.187
o material não oferece base para escolher. Célula cuja independência não se estabelece na escala que o
intervalo assume não é alegação mais estreita — é alegação sem sustentação, e nenhum `n` a conserta.

O **contraste** que justifica a célula que fica: `extract_wikipedia.py` emite
`source = known("ptwiki_page_" + page_id)` — a **página** — e `author = not_applicable(NO_SINGLE_AUTHOR)`.
A unidade é a página, o piso de 300 é trivial, e o dump de 1,96 GB é a reserva.

### O ganho, que é contraintuitivo e vai ser questionado

**Reduzir a moldura ESTREITOU o teto publicado**, de 1,63 % para 0,55 %. Duas coisas se somam:

- `m` cai de 7 para 4, então α por hipótese sobe de 0,05/7 = 0,007143 para 0,05/4 = 0,0125, e um α maior
  aperta o teto sob zero eventos; e
- o orçamento de coleta **concentra numa célula**: 4.000 linhas em vez de 1.750, então o bloco cego vai de
  350 para 800 linhas, e `1 − α^(1/n)` decresce em `n`.

Medido: `1 − 0,0125^(1/800) = 0,0054626` contra `1 − 0,007143^(1/300) = 0,0163372`. A opção de 0,55 % da
Etapa 0 (G0.3) custava **16.000** linhas humanas a quatro células; ela agora custa **4.000** a uma.
**Errata de 2026-08-11:** as 16.000 são a aritmética de **`m=4`** (4 × 4.000, porque 20 % de 4.000
são as 800 linhas de `test` que dão 0,5463 %). A Etapa 0 decidiu G0.3 sob **`m=7`**, e ali o mesmo
teto custava **17.940** (α = 0,05/7 pede n = 897 em `test`, isto é 4.485 por célula). O número
publicado é uma **recomputação** sob a família de hoje, não o que a decisão custava quando foi
tomada — refeito nesta unidade: sob `m=4` o primeiro `n` com teto ≤ 0,55 % é 795, e n = 800 realiza
0,5463 %.

### O que NÃO se alega mais

- FPR em **texto judiciário**, em **texto de domínio universitário** e em **rede social** — em nenhum `n`,
  com nenhum material deste pacote. Não há linha na tabela publicada para essas populações;
- que a Carolina cubra a moldura de qualquer forma: `FRAME_TYPOLOGIES` está **vazia**,
  `humanSources.snapshots` não estoca `carolina`, e `V3_HUMAN_SOURCE_INVENTORY` não a registra;
- cobertura de **quatro** registros comparáveis. `poolingIsResolutionLoss` fica congelado em `true` porque
  é a regra sob a qual uma segunda célula entraria, não uma comparação que hoje tenha o que fazer.

O que **continua** alegável é o que sempre foi: uma linha, uma população declarada, e "fora da moldura não
há alegação de erro — nem melhor, nem pior".

### Decisões do agente, com razão e custo de reversão

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| E-1 | as duas grafias da célula **colapsam numa constante única**, e a que sobrevive é o **id de célula** (`ptwiki`), não a palavra de registro (`encyclopedic`) | três autoridades já leem o id: o valor de fatia de `CELL_FPR_AXIS` (`gates.ts`), `quotaAxis.cells` e o sufixo `fpr-<célula>` de `multiplicity.primaryFamily`. `humanCoreStrata` não tinha consumidor que decidisse nada, então é o lado que cede. **Compartilhada** (`FROZEN_HUMAN_CORE_STRATA = FROZEN_QUOTA_AXIS_CELLS`) e não conferida em runtime: com uma constante atrás dos dois `frozenList` nenhuma política consegue fazê-las discordar, e comparação que nenhuma entrada reprova se lê como defesa sem ser uma | um literal, enquanto nenhuma evidência estiver publicada |
| E-2 | o teto sob zero eventos passa a declarar **DOIS** pontos, e os dois são **re-derivados no load** | os dois respondem perguntas diferentes e publicar só um é como o leitor fica com o número errado: o teto no **piso** (300 linhas) é o **critério de recusa** — o pior teto que ainda sela —, e o teto no **alvo** (800 linhas) é a **expectativa**, o número que o model card imprime. Derivar só o primeiro deixaria justamente o número publicado sem conferência. A contagem de linhas do segundo é derivada de `humanLinesPerCellTarget × partitionFractions.test`, nunca escrita ao lado: um terceiro número para a mesma quantidade é a deriva que o bloco existe para recusar | mexer em qualquer dos dois move o `evaluatorDigest`; hoje é barato (`issuedAt` nulo, 0 tags, nenhum `fit` selado) |
| E-3 | os valores são **0,014501** e **0,005463**, calculados e não copiados | `1 − 0,0125^(1/300) = 0,0145006` e `1 − 0,0125^(1/800) = 0,0054626`. O contrato desta unidade trazia 0,014497 e 0,005464, errados no último dígito; `DERIVED_TOLERANCE` é 1e-6 e os dois são **recusados** pelo parser (medido: mutações M5a e M5b) | recomputar, ao custo de duas exponenciações |
| E-4 | `extract_carolina.py` **fica na árvore**, com `FRAME_TYPOLOGIES` vazia e recusa em `CarolinaOutOfFrame` no ponto de entrada | mesma convenção do PT.SO (bloqueado por nome) e do B2W: extrator que desaparece não deixa rastro do motivo, e readmitir a base viraria edição de uma linha que funciona em vez de emenda que tem de nomear a célula que acrescentaria. A recusa é no **ponto de entrada** e não uma passada que termina vazia, porque uma corrida que lê 3,1 GB e escreve zero linha se lê como arquivo ruim, e o operador iria procurar o arquivo em vez de ler a moldura. Como `typologies` pode chegar por chamada direta, a moldura é conferida **na função** e não só no tipo do argparse | um nome em `FRAME_TYPOLOGIES` mais a célula em `quotaAxis.cells` e o membro `fpr-<célula>` em `primaryFamily` — que é exatamente o preço que a convenção quer cobrar |
| E-5 | a tabela de reamostragem é **re-derivada**: `groups.domainSource` deixa de ser nível em `human-specificity` e em `calibration`, e as duas linhas caem por **fallback** para `groups.source` com `fallbackToIndependentRows: false` | com uma célula declarada, `groups.domainSource` carrega **um** valor no corpus inteiro: um nível de um valor sorteia a mesma unidade em toda réplica, e uma tabela que o nomeasse se leria como se o intervalo publicado tivesse contabilizado variação entre estratos que ele nunca viu. `fallbackToIndependentRows: false` mantém fechada a rota para o bootstrap i.i.d. que o C4 removeu | o nível volta com a segunda célula, e é o custo aritmético de acrescentar uma |
| E-6 | as seis famílias hard-negative **ficam** e todas passam a apontar para `ptwiki` | `RELEASE_CORPUS_POLICY.requiredHardNegativeFamilies` exige as seis, e derrubar uma seria mover decisão selada para desviar de escassez. O custo é aritmético e está cobrado em `hard_negative_demand_per_cell`: a demanda sobre a célula é 6 × `tag_per`. Três das seis (`repetitive`, `non-native`, `motivational`) são de texto curto informal e passam a ser procuradas em lede de Wikipédia, onde são mais raras — dívida declarada no ESTADO § 7, não silêncio | remapear é um dict, mas a cota por célula muda com ele |
| E-7 | o **pino cross-lista** é um teste único que compara as **seis** listas que alcançam `humanSourceType` — `preRegistration.quotaAxis.cells`, os sufixos `fpr-*` de `multiplicity.primaryFamily`, `assemble_corpus.REGISTER`, `assemble_corpus.QUOTA_CELLS`, `humanCoreStrata` e `RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` (esta última parseada de `dataset-manifest.ts`, que é o artefato que `sealDataset` lê) — e cada asserção nomeia o lugar que discorda | "os vocabulários divergem" é inútil sem saber qual deles se moveu. Provado nas três direções por mutação (M6a/M6b/M6c) | é teste, custo zero |
| E-8 | a comparação `ceilingAtCollectionTarget >= ceilingAtAdoptedFloor` **sai** do parser | é ramo que nenhuma política admissível alcança: o piso de coleta está congelado em 1.500 linhas, o alvo é recusado se não o exceder, a fração de `test` é congelada, e `1 − α^(1/n)` decresce estritamente em `n`. Medido: removê-la deixava a suíte **verde** (mutação M10), e o caso que a testava era satisfeito pela recusa **errada** (`collection.humanLinesPerCellTarget`) sob um `toBeInstanceOf` sem `path`. A relação em que a ordem realmente se apoia — piso × fração de `test` = denominador do FPR — já é pinada por teste. O próprio módulo enuncia o padrão: comparação que nenhuma entrada alcança se lê como defesa e não é uma | reintroduzir é três linhas; o que não volta é a falsa cobertura |
| E-9 | `REJECTED_CELL` do fixture de evidência passa a ser **lido** de `quotaAxis.cells[0]` | estava cravado em `carolina-judicial`, então o fixture publicava `covers: true` ao lado de uma hipótese que a família não carrega — relatório que nenhuma política de gate consegue emitir, que é exatamente o que o comentário do próprio fixture proíbe. O irmão (`profile-artifact.fixtures.ts`) já lia da política | é fixture, custo zero |

### O custo de reversão da emenda inteira

Baixo **hoje** e irreversível depois da Fase 5. Hoje: `issuedAt` é nulo, há 0 tags de release,
`gateDecision` é `pending`, `profileDigests` está vazio, nenhum corpus selado existe e nenhum `fit`
certificador rodou. O que a emenda move é o `evaluatorDigest`, que em HEAD era `9bc4e749…` — o valor
vigente vive em ESTADO § 5.6 e é lido por teste, e **não** é repetido aqui, porque um número que se move
a cada edição de arquivo do avaliador transformado em fato histórico é a forma de envelhecer em silêncio
que esta unidade acabou de consertar. Mover o digest antes de existir evidência publicada não custa
nada. Depois de `consume-holdout`, mover a moldura mata todo teto publicado e exige material cego
fresco em toda célula alegada (ESTADO § 3.2).

Voltar a quatro células **não é** uma edição: exige a célula em `quotaAxis.cells`, o membro `fpr-<célula>`
em `primaryFamily`, `primaryFamilySize`, α recomputado, os dois pontos do teto recomputados, o alvo e o
total de coleta, `RELEASE_CORPUS_POLICY.counts`, `requiredHumanSourceTypes`, `humanSources.snapshots`,
`V3_HUMAN_SOURCE_INVENTORY`, `FRAME_TYPOLOGIES`, `REGISTER`, `HUMAN_SOURCE`, `HN_REGISTER` e a tabela de
reamostragem — e, antes de tudo isso, uma proveniência que o pacote da Carolina não tem. É o preço que a
convenção de "declarado, não apagado" quer cobrar.

### Consequência que a emenda cria e que ninguém pediu

Com a Carolina fora, **nenhuma licença em moldura impõe `non-commercial`**: as obrigações medidas do
inventário estocado são `attribution` e `share-alike`, e o `non-commercial` chegava com o
`cc-by-nc-sa-4.0` da Carolina. O regime NC sobrevive porque é decisão própria deste projeto
(`commercialUse: false`) — o que é exatamente o que a posição (a) afirma, e agora não tem em que se
apoiar. Está no ESTADO § 7 com dono: é B1, e B1 é do operador.

### Prova por mutação

Doze mutações, cada uma aplicada ao arquivo de **produção**, com linha de base verde antes, vermelho no
teste nomeado, restauração e conferência sha256 byte a byte. O log dos cinco passos está no relatório da
unidade (`.codex-reviews/emenda-moldura-implementacao.md`).

| # | mutação | resultado |
|---|---|---|
| M1 | `m` volta a 7 (família, `primaryFamilySize`, α, quatro células) | recusa em `preRegistration.quotaAxis.cells` |
| M2 | α volta a 0,007143 | recusa em `multiplicity.perHypothesisAlpha`, com o `m=4` na mensagem |
| M3 | `quotaAxis.cells` com quatro células | recusa em `preRegistration.quotaAxis.cells` |
| M4 | teto antigo 0,016337 no piso | recusa em `ceilingAtAdoptedFloor`, com `1 - 0.0125^(1/300)` na mensagem |
| M5a | teto no piso a 0,014497 (o valor errado do contrato) | recusa em `ceilingAtAdoptedFloor` |
| M5b | teto no alvo a 0,005464 (o valor errado do contrato) | recusa em `ceilingAtCollectionTarget`, com `1 - 0.0125^(1/800)` |
| M5c | bloco cego do alvo a 350 linhas, com o teto coerente | recusa em `blindBlockLinesAtCollectionTarget` |
| M6a | `REGISTER` do lab muda de grafia | vermelho nomeando `assemble_corpus.REGISTER` |
| M6b | `quotaAxis.cells` muda de grafia | vermelho nomeando `assemble_corpus.REGISTER` contra `quotaAxis.cells` |
| M6c | sufixo `fpr-*` de `primaryFamily` muda | vermelho nomeando `multiplicity.primaryFamily` |
| M7 | inventário de gates escrito à mão com a família de 7 | vermelho em "covers the family at the frozen m, and passes" e em 13 outros |
| M8/M9 | guarda do teto no alvo e do bloco cego derivado removidas | vermelho em "refuses a collection-target ceiling that is not the formula at its own n" |
| M10 | guarda do **aperto** removida | **verde** — achado, e é o que E-8 resolve |
| M11 | piso de coleta a 1.000 linhas nas DUAS autoridades (o literal congelado e o JSON) | vermelho em "keeps the five fractions summing to one, which is what a fifth edit would break", com `expected 200 to be 300` — é esta asserção, **pré-existente**, que carrega a ordem dos dois tetos |

### A emenda da moldura, FECHADA: o que as duas lentes acharam (2026-08-05)

Duas revisões adversariais (contrato e mutação) deram **block**, com 8 bloqueantes e 22 menores entre as
duas. O padrão dos bloqueantes é um só e vale nomear: **a emenda mudou os números e não mudou tudo que os
repetia.** Nenhum era erro de política; todos eram a mesma quantidade escrita duas vezes com dois valores.

| # | achado bloqueante | veredito |
|---|---|---|
| 1 | `evaluatorDigest` publicado no ESTADO e no registro divergia do que a árvore hasheia | **procede** — recomputado, e agora **lido por teste** (references § N7) |
| 2 | `split-audit.ts:118` (membro de `EVALUATOR_FILES`) afirmava 7.000 humanas e bloco cego de 1.400 | **procede** — reescrito para 4.000 / 800, e varrido contra `counts` |
| 3 | `corpus-collection-runbook.md` ficou com 13,46 % e "blocos de 25 %", aritmética de quatro células | **procede** — re-derivado: 40 % do corpo, 100 % da classe |
| 4 | `corpus-sources.md` dava `src_carolina` como snapshot congelado e apontava `m = 7` como vigente | **procede em parte** — ver E-18 |
| 5 | `NOTICE.md` seguia listando Carolina e B2W como dado de treino | **procede** — reescrito e varrido contra o inventário estocado |
| 6 | `test_connectivity_feasibility.py` era guarda de estado verde sobre a moldura aposentada | **procede** — células derivadas de `REGISTER`, e a viabilidade sob UMA célula passou a ser medida |
| 7 | `total !== target * cells`: o fator não é alcançado por política admissível | **procede** — e a saída é o contrário de E-8; ver E-10 |
| 8 | a asserção nova de `preregistration-v4.test.ts` não podia reprovar, e M11 provava a pré-existente | **procede** — ver E-11 |

### Decisões do agente ao fechar a emenda

| # | decisão | razão | custo de reversão |
|---|---|---|---|
| E-10 | a derivação do total de coleta ganha **nome** (`derivedHumanLinesTotal`, exportada) e é pinada em **duas e quatro** células, em vez de o fator sair do parser | não é o caso de E-8, e a diferença é qual coisa é inalcançável: em E-8 era a **comparação** — o ramo não decidia nada. Aqui é um **valor do insumo**: a comparação decide (um total errado é recusado) e só o fator fica sem exercício, porque a moldura tem uma célula. Tirar o fator gravaria no código a coincidência de haver hoje uma célula, que é a classe de erro que a emenda existe para desfazer. Metodologia em `references.md` § N6. Provado: M12 fica **vermelho** em teste nomeado | uma função de uma linha |
| E-11 | a asserção `blindBlockLinesAtCollectionTarget > criticalFprHumanNegatives` **sai** do teste, e a atribuição da prova é corrigida | os três escalares são congelados: o lado esquerdo é sempre > 300, e a asserção só pode reprovar junto da pré-existente, nunca sozinha. **Medido** (M20b, réplica de M11): o vermelho nomeado é "keeps the five fractions summing to one…" com `expected 200 to be 300` — a asserção **pré-existente**, exatamente como a revisão afirmou. A ordem dos dois tetos continua pinada por ela, e o invariante fica enunciado no comentário | duas linhas; o que não volta é a redundância |
| E-12 | a composição ratificada citada em **prosa** dentro dos módulos do bench passa a ser varrida contra `RELEASE_CORPUS_POLICY.counts` | comentário não se muta, e dois módulos carregaram a composição aposentada por uma emenda inteira com a suíte verde. A varredura roda sobre **todo** módulo do bench e não só sobre `EVALUATOR_FILES`, porque o gêmeo que também divergiu (`viability-preflight.ts`) **não** é arquivo do avaliador — uma varredura escopada ao digest teria deixado sem leitura justamente a cópia que derivou | é teste, custo zero |
| E-13 | o `evaluatorDigest` que o ESTADO publica é conferido contra a **árvore viva** por teste nomeado | é o conserto do bloqueante 1 na raiz: o número estava errado e nada reprovava. **Medido** (M22): trocado por zeros, o teste nomeado fica vermelho e `docs:check` continua **verde** — isto é, `docs:check` nunca guardou o número. Caiu com ele o comentário de `digests.test.ts` que dizia haver arquivo declarado ainda inexistente: os 52 existem, e a recomputação sobre a árvore real corre | é teste; o preço recorrente é uma linha do ESTADO por commit que toque arquivo do avaliador, e é o preço certo |
| E-14 | a lista `## Dados de treino` do NOTICE é varrida contra `V3_HUMAN_SOURCE_INVENTORY`, `OUT_OF_FRAME_HUMAN_SOURCES` e `A1_BLOCKED_HUMAN_SOURCES`, e passa a nomear cada fonte pelo `sourceId` | as varreduras que existiam liam a lista de licenças e a frase do regime NC, não a lista de bases — então o NOTICE afirmava treinar em Carolina e B2W três parágrafos acima de a própria emenda declarar as duas fora da moldura. A varredura lê só os **itens da lista** e não a seção: a prosa abaixo nomeia as excluídas de propósito. Provado: M15 vermelho | é teste; o NOTICE fica com um id por base |
| E-15 | `docs/corpus-sources.md` passa a **renderizar** `humanSources.snapshots` e o `m` vigente, e os dois são varridos | é o arquivo que o montador cita como autoridade do inventário revisado (`assemble_corpus.py`), e ele publicava a lista de snapshots errada e um ponteiro de "o que vale" invertido. Provado: M16 vermelho | é teste, custo zero |
| E-16 | o fixture de viabilidade **deriva** as células de `assemble_corpus.REGISTER`/`HUMAN_SOURCE`, e a viabilidade das cinco partições **por classe com UMA célula** passa a ser medida | o arquivo se apresenta como guarda de estado e condena no próprio docstring provar sobre "corpus imaginário" — e cravava quatro células e o lote da Carolina, material que nenhuma autoridade declara. Sob uma célula as duas direções (estrato e lote) colapsam no MESMO componente de 100 %, e a recusa troca de ramo: passa a ser a do **maior**, não a do menor. A medição que faltava usa `author`, que É eixo de união v4, então a degenerescência humana é alcançável **sem mock**: 40 % do corpo (cabe em `train`) e 100 % da classe `human`. Provado: M19 e M23 vermelhos | é teste; o fixture passa a acompanhar a moldura sem edição |
| E-17 | a regra N5 ganha **qualificação**: o proibido é fator degenerado **sem declaração**, não fator degenerado | a mesma tabela carrega o caso contrário e ele fica — `resampling.estimandClasses.mixed.levels[1]` nomeia `groups.promptTemplate` **com** `proxyFor` e `proxyReason`, e o `proxyReason` diz que o fator é degenerado por construção até um eixo de operação existir. Remover essa linha esconderia a lacuna, que é o erro simétrico. E o lado declarado **já tem guarda de parser**: medido (M21b), apagar `proxyReason` recusa com "`proxyReason` is required whenever the other is present"; renomear a chave (M21) recusa por chave fora do conjunto fechado | é prosa de `references.md` |
| E-18 | **refutação parcial** do bloqueante 4: a tabela "Fase 0.2" de `corpus-sources.md` **mantém** 250 unidades, `n=250`, `n=512` e o eixo de quatro células | ela se declara **seção HISTÓRICA da pré-inscrição v3** no próprio cabeçalho, e esses são os valores que a v3 congelou; corrigi-los para os vigentes apagaria o registro do que foi abandonado, contra a convenção "declarado, não apagado". O que estava errado e foi consertado é outra coisa: o **blockquote que diz qual moldura vale** estava invertido (dizia que o vigente é `m = 7` e que `m = 4` não se aplica; é o contrário), e a cláusula "gate a implementar em E3 da Fase 1" era falsa — o gate existe (`benchmark/composition-gate.ts`). O blockquote agora nomeia os quatro valores superados e diz que o `m = 4` das duas tabelas é **coincidência de contagem** e não continuidade: a família v3 tinha o pior estrato como manchete, a v4 tem um `fpr-<célula>` por célula | é prosa |
| E-19 | a queda da população que ajusta o limiar (1.050 → 600 linhas) é **registrada como dívida** e **não** consertada com piso pré-inscrito novo | acrescentar entrada a `powerFloors` é mudar a política **selada** e decidir sobre poder do quantil — número que a tabela ratificada pelo operador não carregava e que ninguém mediu. Inventá-lo aqui seria congelar um piso sem medição para fechar um achado. O que a unidade deve é nomear a consequência: está no ESTADO § 7, com vencimento | reabrir é a mesma dívida |

### Refutações e o que ficou de fora, com razão

- **`viability-agreement.json` continua com células `carolina-*`** e não foi tocado: é catálogo de corpos
  **hipotéticos** que o preflight julga, e o preflight não lê a moldura. Mutar ali seria mutar a forma da
  política em vez do corpus.
- **A tabela histórica da v3** fica com os valores da v3 (E-18).
- **`graphify-out/`**, não rastreado no início da sessão anterior, não está mais em disco. Nenhum comando
  desta unidade nem da anterior remove diretório não rastreado; é saída de skill e não trabalho do projeto,
  e a regeneração é decisão do operador.
- **A intermitência de `consume-holdout.test.ts` e `digests.test.ts`** não foi consertada: é dívida de
  rodada própria (ESTADO § 7, agora generalizada para os dois arquivos).

### Prova por mutação — segunda bateria (fechamento)

Doze mutações, os mesmos cinco passos: base verde, mutação no arquivo de produção, rodada do teste alvo,
restauração e conferência sha256 byte a byte.

| # | mutação | resultado |
|---|---|---|
| M12 | `derivedHumanLinesTotal` perde o fator de células | vermelho em "derives the collection total by SUMMING the per-cell target over the cells", `expected 4000 to be 8000` |
| M13 | `REJECTED_CELL` cravado numa célula aposentada | vermelho em "names only hypotheses the frozen primary family carries", nomeando `fpr-carolina-judicial` |
| M14 | `quota_cells_of` devolve tupla escrita à mão | vermelho em `test_the_quota_denominator_follows_the_register_past_one_cell` |
| M15 | NOTICE nomeia `src_carolina` na lista de dado de treino | vermelho em "the NOTICE's training-data list names every stocked source and no out-of-frame or blocked one" |
| M16 | `corpus-sources.md` põe `carolina` de volta na lista de snapshots | vermelho em "makes the source inventory doc state the frozen snapshot list and the frozen m" |
| M17 | comentário de `split-audit.ts` volta a 7.000 | vermelho na varredura, nomeando `benchmark/split-audit.ts` |
| M17b | `RELEASE_CORPUS_POLICY.counts.human` 4.000 → 7.000 | dois vermelhos: o pino da cota selada **e** a varredura, nomeando `split-audit.ts` — a direção que antes passava calada |
| M18 | comentário de `viability-preflight.ts` volta a 7.000 | vermelho na varredura, nomeando `benchmark/viability-preflight.ts` |
| M19 | células do fixture de viabilidade escritas à mão com uma célula aposentada | vermelho em `test_o_fixture_roda_sobre_as_celulas_DA_MOLDURA` |
| M20b | piso de coleta a 1.000 nas duas autoridades (réplica de M11) | vermelho em "keeps the five fractions summing to one…", `expected 200 to be 300` — confirma a atribuição de E-11 |
| M21 / M21b | `proxyReason` renomeado / apagado | recusa no load: chave fora do conjunto fechado, e "`proxyReason` is required whenever the other is present" |
| M22 | digest publicado no ESTADO trocado por zeros | vermelho em "is published in the ESTADO at the value the LIVE tree hashes to"; `docs:check` **verde** sob a mesma mutação |
| M23 | a guarda de viabilidade perde o escopo por CLASSE | vermelho em `test_com_UMA_celula_a_recusa_e_da_CLASSE_humana_e_nao_do_corpo` |

Uma mutação **não** isolou o que se pretendia, e está registrada como tal: **M20** (`FROZEN_FLOOR_PER_CELL`
300 → 900 sozinho) recusa no **load** — "`powerFloors.samplingUnits` is frozen at 900" — antes de qualquer
teste rodar, então não diz nada sobre asserção alguma. É por isso que M20b move as **duas** autoridades
juntas.

---

## A emenda do backbone (W1): o selado passa a BERTimbau — DECIDIDA PELO OPERADOR em 2026-08-05

**Status:** `EM-VIGOR`. A troca do backbone é decisão do operador. A cadeia de evidência, a aritmética do
teto de bytes, as recusas em código e a separação entre medido e não medido são do agente, registradas
abaixo com razão e custo de reversão.

O backbone congelado passa de `xlm-roberta-base` para **`neuralmind/bert-base-portuguese-cased`**
(BERTimbau base). `backboneBakeOff` **permanece `false`**: a troca se decide por literatura e pela forma
do pipeline existente, **não** por medição sobre os nossos dados. Nenhuma comparação de qualidade entre
backbones foi rodada, e nenhuma será na v3.

### A cadeia de evidência, conferida antes de mexer

Três sítios já diziam que o selado era o BERTimbau, e um dizia o contrário:

- `docs/references.md` (§ "Normalização de texto, backbone e sinal") registrava o BERTimbau como "o
  backbone efetivamente selado … sem bake-off na v3", e o XLM-R como "candidato … **descartado** como
  bake-off";
- `benchmark/lab/train_detector.py:54` tinha o BERTimbau como **default** do `--model`; o
  `xlm-roberta-base` aparecia na linha 13, dentro de um **exemplo** de bake-off no docstring;
- `benchmark/rebuild-v3-policy.json:3` congelava `neuralmind/bert-base-portuguese-cased`, com o teto de
  109 681 931 na linha 183 — a terceira testemunha, que a contagem afirmava e a lista não enumerava (achado
  M4 do `consolidado-w1`, fechado em 2026-08-10). É o mesmo arquivo que o parse fechado da unidade R2 passou a
  recusar como política selada, por outro motivo: ele declara `policyVersion: rebuild-v3-policy-v1`;
- `benchmark/preregistration-v4.json` congelava `xlm-roberta-base`.

A divergência **D17** leu a linha de exemplo e pinou o XLM-R; o Commit C o congelou e **elevou** o teto de
bytes de 1,09 × 10⁸ para 3,4 × 10⁸ para acomodá-lo. A justificativa registrada é **circular** — o teto foi
apresentado como razão da escolha quando era consequência dela — e está retratada na seção da Fase 1.

**Uma divergência medida contra a própria cadeia (D-W1-1).** O item que atribuía a exceção do WordPiece do
BERTimbau (`[UNK]` por ideograma CJK isolado) a `contracts/text-normalization.ts` linhas 208-210 e 505-507
é **falso**: esse arquivo não menciona tokenizer nem `[UNK]` em nenhuma linha, e a única vez que diz
"IDEOGRAPH" (linha 600) é o nome Unicode de `㈠ U+3220`, num contexto de dobra NFKC e não de tokenizer. A
exceção existe, com exatamente esses números de linha, em **`src/inference/model-runtime.ts`** — que
**não** é membro de `EVALUATOR_FILES` — e um terceiro sítio a repete para o fake de teste
(`tests/helpers/wordpiece-tokenizer.ts:6`). A substância da restrição sobrevive intacta e até mais forte (o
código fixa a semântica do `BasicTokenizer` com `handle_chinese_chars` e afirma que o vocabulário do
BERTimbau não tem ideograma nu); o que estava errado era o ponteiro, e ele foi corrigido em
`references.md`. Nenhum byte de `contracts/text-normalization.ts` foi tocado, e o `evaluatorDigest` não se
move por essa causa.

### A restrição técnica que a emenda preserva: o pipeline inteiro é BERT-shaped

Não é preferência de arquitetura, é a forma dos artefatos que a entrega já produz:

- `benchmark/lab/export_onnx.py` **publica** um grafo de exatamente **três** entradas — `input_ids`,
  `attention_mask`, `token_type_ids` — e emite `vocab.txt`. Só o **fallback** (sem `optimum`) as nomeia ao
  exportar; o caminho via `optimum` delega a forma à biblioteca, e é por isso que a revisão exigiu
  **perguntar ao artefato**: a sessão é aberta e `assert_inputs_are_the_emitted_shape` recusa qualquer
  conjunto que não seja o das três. O XLM-R é da família RoBERTa: **não tem** `token_type_ids` e usa
  SentencePiece, não `vocab.txt`;
- `public/models/cleanfeed-ptbr-v1/` entrega `vocab.txt`;
- `src/inference/model-runtime.ts` parte **todo ideograma CJK em palavra própria** porque o vocabulário do
  BERTimbau não tem ideograma nu, e sem isso `deriveWordPieceOffsets` degrada o documento inteiro.

O custo de ignorar isso é pior do que uma falha: um export com a forma errada **passa pelo gate de
paridade**. A paridade compara o grafo exportado contra os mesmos pesos torch, então um grafo cuja terceira
entrada o runtime nunca alimenta concorda consigo mesmo e é publicado como se tivesse sido medido. É por
isso que a recusa entrou no `export_onnx.py`, e não como nota no README.

### O teto de bytes volta a ser medido, com a folga declarada

`onnxMaximumInt8Bytes` = **130 000 000**, e a aritmética é esta:

| quantidade | valor | origem |
|---|---:|---|
| export int8 real desta arquitetura | 109 681 931 bytes | `snapshots/cleanfeed-ptbr-v1/onnx/model_int8.onnx`, medido em 2026-08-05 |
| o mesmo número, **rastreado** | 109 681 931 bytes, `sha256 d8f77f87…` | `models/cleanfeed-ptbr-v1/source-lock.json` e `cleanfeed-model.json` — conferidos contra o teto por teste, porque um teto que nada mede não é teto |
| paridade do mesmo export | 120 amostras, `meanAbsDelta` 0,000595, `maxAbsDelta` 0,00895, 0 inversões | `parity_report.json` ao lado |
| teto adotado | 130 000 000 bytes | decisão do agente |
| folga | 20 318 069 bytes (18,5 % do medido) | 130 000 000 − 109 681 931 |

**Por que não o medido cru.** Um teto de ajuste exato reprova um re-export legítimo que difira por poucos
KB: versão de opset, escala/zero-point por canal contra por tensor, e a forma da cabeça de classificação
mudam a contagem de bytes sem mudar quais pesos o artefato carrega. O campo é **teto, não alvo** — um
export menor passa, e nada exige aproximar-se dele.

**Por que a folga é pequena.** As duas recusas que justificam o campo continuam valendo: a matriz de
embeddings de 29 794 × 768 é 22 881 792 bytes em int8 e 91 527 168 em fp32, logo um export que a deixe
sem quantizar mede ~1,78 × 10⁸ e **reprova**; e um encoder de família RoBERTa com 250 002 linhas de
embedding é ~2,8 × 10⁸ em int8, mais que o dobro do teto. O número nomeia **uma** arquitetura.

**O que o artefato medido sustenta e o que não sustenta.** Ele é de um fine-tune **antigo**. O que ele
mede é o **tamanho** e a **paridade** de um export desta arquitetura, e é só nisso que o teto ancora.
Nenhuma alegação sobre a qualidade do candidato da v1 sai dele.

### Medido × não medido, sem confundir os dois

**MEDIDO neste repositório:**

- o `config.json` do checkpoint dá `vocab_size` **29 794**, `hidden_size` 768, 12 camadas, e o `vocab.txt`
  servido tem exatamente 29 794 linhas — é esse número, e não `model_type`, que identifica o backbone;
- export int8 de **109 681 931 bytes** com paridade de **zero** inversões, e o mesmo número declarado em
  dois descritores **rastreados** (`models/cleanfeed-ptbr-v1/source-lock.json` e `cleanfeed-model.json`,
  com `sha256`), que é onde o teto passou a ser conferido por teste;
- o `opset_import` do artefato ancorante é **18** (ir_version 8, produtor `onnx.quantize`) — não 14, que
  era literal do fallback do exportador copiado para dentro da descrição da medição;
- o pipeline BERT-shaped: `token_type_ids`, `vocab.txt`, a exceção de normalização por ideograma.

**DERIVADO das contagens publicadas, não medido aqui:**

- 110 M parâmetros contra 278 M, e o **encoder idêntico** nas duas arquiteturas (~85 M: 12 × (4 × 768² +
  2 × 768 × 3072)). Nenhum XLM-R foi baixado nem exportado neste projeto: os 250 002 × 768 e os 278 M vêm
  de Conneau et al. (2020). **Praticamente** toda a diferença está na matriz de embeddings — 22,9 M contra
  192 M —, e o "praticamente" é literal: embeddings de posição (512 contra 514), `type_vocab_size`
  (2 contra 1) e a forma da cabeça também diferem, em ordens de grandeza irrelevantes para o teto.

**NÃO MEDIDO, e registrado como tal:**

- **nenhuma vantagem de qualidade de detecção** foi medida, e não será. `backboneBakeOff: false` não é
  "ainda não medimos": é a decisão de não medir;
- a **latência não muda**. O encoder é idêntico e a busca de embedding é O(1) por token; o ganho é de
  **tamanho**;
- a **fertilidade do tokenizer** (palavras por janela de 512) foi levantada como argumento e **retirada**
  por não ter sido medida. Não deve ser reintroduzida como fato.

**O que a emenda abdica de propósito, e isto tem de estar escrito:** o único ganho real do XLM-R — encoder
pré-treinado em corpus muito maior (CommonCrawl filtrado, 100 línguas) — é abandonado. É uma perda
possível de qualidade que o projeto aceita **sem medir**, em troca da forma do pipeline, de um teto
ancorado em medição e de um artefato três vezes menor.

### As recusas em código, e por que cada uma é recusa

| onde | recusa | razão de ser recusa e não aviso |
|---|---|---|
| `preregistration-v4.ts`, `literal(root, "", "backbone", …)` | qualquer backbone fora do selado, nomeando o path | o campo é lido por gate; um valor "válido por forma" é um valor que qualquer política pode ocupar |
| `preregistration-v4.ts`, `frozenNumber(… "onnxMaximumInt8Bytes" …)` | o teto de 3,4 × 10⁸, e todo outro valor | era `integer(… ≥ 1)`: a magnitude que decide se o export da Fase 4 é publicável passava a qualquer valor positivo |
| `train_detector.py`, `assert_model_is_the_sealed_backbone` | `--model` divergente, e política com `backboneBakeOff: true` | um segundo modelo base não é corrida extra: o checkpoint dele é elegível ao mesmo gate de export e à mesma medição, e escolher entre dois depois de ver o `dev` é a seleção que a pré-inscrição existe para proibir |
| `train_detector.py`, `assert_seed_is_the_publishable_one` | `--seed` fora de `seeds.publishableCheckpoint` | o default embarcado era **42**, não 712019 — a seed pré-fixada existia só em prosa. Uma segunda seed é um segundo sorteio |
| `export_onnx.py`, `assert_sealed_backbone_is_exportable` | política que nomeie backbone de outra forma, ou backbone cuja forma o script nunca viu | falha fechada: uma arquitetura desconhecida não pode ser *presumida* como a que o grafo fixa |
| `export_onnx.py`, `assert_checkpoint_matches_sealed_backbone` | checkpoint cujo `config.json` divirja em `model_type`, `vocab_size`, `hidden_size` ou `num_hidden_layers` | é o caso que passa pela paridade e entrega artefato que não é o medido. `model_type` **sozinho não identifica**: vale `"bert"` para todo BERT, e a revisão mostrou `bert-base-cased` (28 996) sendo aceito como o selado. O vocabulário é o que separa, e ele está no mesmo arquivo |
| `export_onnx.py`, `assert_inputs_are_the_emitted_shape` | grafo (ou tokenizer) cujas entradas não sejam exatamente as três | a forma era **presumida**: só o fallback nomeia as entradas, o caminho via `optimum` delega à biblioteca, e a montagem do feed da paridade *descartava em silêncio* a entrada ausente. Agora a sessão é perguntada |
| `export_onnx.py`, `assert_export_is_within_the_sealed_ceiling` via `quantize_within_the_ceiling` | artefato acima do teto, que fica em **staging** e é apagado | **decisão do agente**, além do pedido: o teto era número que nenhum código lia, e quantidade escrita e não lida é exatamente o defeito que a emenda da moldura corrigiu em oito sítios. O staging é da revisão: a guarda só roda **depois** de quantizar, e o reprovado não pode ficar onde o empacotamento lê |
| `export_onnx.py`, fim do passo 3 | `out/vocab.txt` ausente | o bundle servido é carregado por tokenizer WordPiece; checkpoint cujo tokenizer não escreve `vocab.txt` não é o do backbone selado |
| ambos os scripts, `sealed_policy_path` | política selada ausente, nomeando os **dois** paths tentados | o pedido "suba só o script" do README quebrava com `FileNotFoundError` cru. Não há default embarcado para cair: a recusa diz qual arquivo subir |

Os dois scripts do lab **leem** a pré-inscrição viva (`benchmark/preregistration-v4.json`) em vez de
retypar valor, pelo mesmo motivo de `assemble_corpus.POLICY_PATH`: os bytes desse arquivo estão em
`EVALUATOR_FILES`, e um espelho no lab seria autoridade que o `evaluatorDigest` não vigia. Os defaults de
`--model` e `--seed` no argparse também vêm de lá — não há literal repetido do lado do lab.

**Custo de reversão.** Baixo e mecânico enquanto `issuedAt` é nulo e não há tag: dois valores no JSON
selado, dois pins no parser, as tabelas declaradas nos dois scripts do lab, e os pinos de teste. O que
**não** é reversível de graça é a escolha em si depois de treinar: um checkpoint de outro backbone não é o
artefato para o qual o teto e a medição certificadora foram congelados.

### `license-review.json` — conferido, não tocado

`declaredLicense` já dizia "Base BERTimbau (MIT)", e com a emenda voltou a ser **verdadeiro**. `status`
permanece `pending`, `reviewer` e `reviewedAt` permanecem `null`: a assinatura é do operador e espera o
pacote da Fase 6.

### O que a revisão cruzada pegou, e que está consertado neste mesmo commit

Seis achados bloqueantes, todos conferidos contra o código antes de mexer e todos confirmados:

1. **A conferência byte a byte de seis das nove provas certificava bytes inexistentes.** Os hashes
   publicados de `train_detector.py` (`7d897a03…`) e `export_onnx.py` (`b3b2d3cc…`) não eram os da árvore
   (`3d21ad66…` e `b57157af…`): os arquivos foram editados **depois** da bateria — "rodado de novo após o
   apara de dois comentários" — e a suíte foi rerodada, as provas não. O quinto passo estava vazio.
   Remédio: a bateria inteira foi rerodada sobre os bytes **finais**, e os hashes abaixo são os que a
   árvore carrega.
2. **As quatro guardas podiam sair de `main()` sem um único vermelho.** Medido em cópia isolada: apagados
   os quatro sítios de chamada, `18 passed`. Os testes chamavam as funções `assert_*` diretamente e nada
   exercitava o sítio. Remédio: `GuardCallSites` dirige `main()` com `sys.argv` remendado — é barato porque
   toda recusa acontece **antes** do `import torch`/`numpy`, então nenhum teste baixa modelo.
3. **`assert_checkpoint_matches_sealed_backbone` não identificava o modelo.** Medido: `bert-base-cased`
   (`vocab_size` 28 996) e um BERT de 6 camadas foram **aceitos** como o selado, porque só `model_type` era
   comparado — e `"bert"` é o que todo BERT declara. Nenhum dos dois é pego pelo teto: 28 996 × 768 dá
   ~1,09 × 10⁸ bytes em int8, **abaixo** de 130 000 000. Remédio: `BACKBONE_CONFIG_SHAPE` compara também
   `vocab_size`, `hidden_size` e `num_hidden_layers`, recusando nomeando 29 794.
4. **O T4 documentado quebrou.** O README mandava subir só `dataset.tgz` e o script, e `main()` passou a
   ler a política na primeira instrução: `FileNotFoundError` cru, inclusive em `--help` (reproduzido num
   diretório plano). Remédio: `sealed_policy_path` recusa nomeando os **dois** paths tentados e dizendo
   qual arquivo subir; o layout plano do Colab é encontrado ao lado do script (o path do checkout tem
   precedência, para que uma cópia solta nunca sombreie o arquivo rastreado); e o README lista o terceiro
   upload, com o T5 finalmente documentado.
5. **O registro afirmava duas vezes o mesmo campo selado, uma delas falsa.** A seção de 340 000 000
   (Fase 1) seguia sem marca de retratação, e quem navega por grep a encontra primeiro. Remédio: marca de
   **RETRATADO** no cabeçalho dela.
6. **O parágrafo 1 do ESTADO ficou falso pelas adições desta unidade.** Quatro números medidos errados
   (2.768 / 310 / 1.708 / 1.398 contra 2.771 / 343+18 / 1.744 / 1.401), e **nenhum teste os lê** — MW19
   confirma: falsificados os quatro, a suíte fica verde. Remédio: os quatro corrigidos aqui. Guarda
   **recusada** com razão: um teste que afirme a própria contagem de testes é circular (acrescentá-lo muda
   o número que ele afirma) e quebraria a cada teste futuro; o que dá para vigiar sem circularidade — o
   `evaluatorDigest` — já é vigiado.

E os menores aplicados: `opset 14` era literal do fallback do exportador copiado para dentro da descrição
da medição — o `opset_import` do artefato ancorante é **18** (decodificado do `ModelProto`: `ir_version` 8,
produtor `onnx.quantize`, um único `opset_import` de domínio vazio); o "caminho de export inteiro é
BERT-shaped" ganhou o qualificador de que só o **fallback** fixa as três entradas; o bloco MEDIDO devolveu
à literatura os 278 M do XLM-R e a identidade do encoder; o teto passou a ser conferido contra os
descritores **rastreados**; o artefato reprovado não fica mais no diretório de onde o empacotamento lê; e o
docstring do teto perdeu a promessa de pertencimento, que um limite **superior** não pode cumprir (medido:
um artefato de 55 MB passa, e deve passar).

**Menores recusados, com razão.** (i) **Piso de bytes** ancorado no medido: exigiria campo selado novo
(`onnxMinimumInt8Bytes`) ou um literal de 109 681 931 no lab — a segunda autoridade que esta unidade existe
para fechar. O que responde "pertence?" é identidade, e identidade agora é `vocab_size` + forma do grafo;
o docstring deixou de prometer o que o teto não faz. (ii) **Recusa por forma no treino** (`train_detector`
chamando a tabela do exportador): acoplaria os dois scripts e somaria um upload ao T4, para um cenário que
o `literal()` do parser já torna inalcançável — uma política que sele backbone inexportável não passa pelo
parser. (iii) **Verificador de docs** que falhe quando o registro afirma, para campo selado, valor que a
política viva contradiz: é análise de prosa, e a marca de retratação resolve o caso concreto.

### Prova por mutação — vinte mutações, cinco passos cada

Base verde, mutação no arquivo de produção, rodada do teste alvo, restauração, conferência sha256 byte a
byte. Hashes **medidos na árvore entregue**, idênticos antes e depois de cada mutação:

| arquivo | sha256 |
|---|---|
| `benchmark/preregistration-v4.ts` | `fa9c3d92c95e6ec1769ee30a0b17345d0e1f690f8d415d9cef3cc9f356b9c8a7` |
| `benchmark/preregistration-v4.json` | `71046cea188cf63f4ce05d775a30e882231048284a60890c6b1ccfdf8b263207` |
| `benchmark/lab/train_detector.py` | `961eb1f716be3a0cb19656a091629847c6af77e3d2c7e55cc4cf94d0a1a69ca0` |
| `benchmark/lab/export_onnx.py` | `f1e5d82af88e5f5ef828f4f90810e52ea74ff461546688da772ec3496f87b6ef` |
| `models/cleanfeed-ptbr-v1/source-lock.json` | `688394cf2e4d303671fde4a1e28a6956f8a2b18b0e8d15fe2e7b304fb058a6e9` |
| `models/cleanfeed-ptbr-v1/cleanfeed-model.json` | `872d6093a86ec8374a76d8d550d08e0293d18b7116651e999a8881b950219dcd` |

Base dos alvos: `test_backbone_policy.py` **33 passed**; `benchmark/tests/preregistration-v4.test.ts`
**48 passed**.

| # | mutação | resultado |
|---|---|---|
| MW1 | `backbone` volta a `text()` no parser (aceita qualquer string) | 2 failed / 46 passed: "refuses the discarded bake-off candidate as the backbone" e "pins each frozen field to its value, naming the path" (`backbone: expected null to be an instance of PreregistrationV4Error`) |
| MW2 | `onnxMaximumInt8Bytes` volta a `integer(… ≥ 1)` | 2 failed / 46 passed: "refuses the export ceiling that was sized for the discarded candidate" e a tabela de pins, nomeando `onnxMaximumInt8Bytes` |
| MW3 | guarda de `--model` deixa de comparar | 2 failed / 31 passed: `test_it_refuses_the_discarded_candidate_naming_the_sealed_one` (`ValueError not raised`) e `GuardCallSites::test_train_main_refuses_the_discarded_candidate` |
| MW4 | guarda de seed compara `< 0` em vez de igualdade | 2 failed / 31 passed: `test_it_refuses_the_argparse_default_that_used_to_be_shipped` e o mesmo caso via `main()` |
| MW5 | comparação de `model_type` do checkpoint deixa de comparar | 3 failed / 30 passed: `…_of_another_architecture`, `…_that_declares_no_architecture` e `GuardCallSites::test_export_main_refuses_a_checkpoint_of_another_architecture` |
| MW6 | teto do export compara contra `ceiling * 2` | 2 failed / 31 passed: `test_it_refuses_an_artifact_one_byte_above_the_ceiling` (65 bytes aceitos contra teto 64) e `test_a_rejected_export_is_not_left_where_the_packaging_reads` |
| MW7 | `onnxMaximumInt8Bytes` do **JSON** volta a 340 000 000 | recusa no **load**: `PREREGISTRATION_V4_INVALID: onnxMaximumInt8Bytes is frozen at 130000000` — o arquivo de teste inteiro não roda |
| MW8 | tabela de formas mapeia o BERTimbau para `xlm-roberta` | 10 failed / 23 passed, entre eles `test_the_sealed_backbone_is_exportable_by_the_shape_this_script_emits` e `test_the_exporter_pins_the_sealed_backbone_shape` |
| MW9 | docstring do treino recebe de volta a instrução de bake-off | 1 failed / 32 passed: `test_the_docstring_carries_no_bake_off_instruction` (`'Bake-off' unexpectedly found`) |
| MW10 | os **dois** `assert_*` saem de `train_detector.main()` | 2 failed / 31 passed: os dois `GuardCallSites` do treino. O vermelho é `ModuleNotFoundError: transformers` em vez de `ValueError` — a execução **passou** da guarda e chegou ao import, que é exatamente o que a mutação nega |
| MW11 | `assert_checkpoint_matches_sealed_backbone` sai de `export_onnx.main()` | 1 failed / 32 passed: `GuardCallSites::test_export_main_refuses_a_checkpoint_of_another_architecture`, `ModuleNotFoundError: onnxruntime` |
| MW12 | `main()` volta a chamar `quantize_dynamic` direto, sem o teto | 1 failed / 32 passed: `test_export_main_publishes_the_int8_artifact_through_the_ceiling_guard` (`'quantize_within_the_ceiling(' not found`) |
| MW13 | comparação de `vocab_size`/`hidden_size`/`num_hidden_layers` desaparece | 3 failed / 30 passed: `…_a_fine_tune_of_another_bert_by_vocabulary`, `…_with_half_the_encoder`, `…_that_declares_no_vocabulary_size` |
| MW14 | `EMITTED_GRAPH_INPUTS` perde `token_type_ids` | 2 failed / 31 passed: `test_a_graph_without_segment_ids_is_refused_naming_the_missing_input` e o pin das três entradas |
| MW16 | `sealed_policy_path` volta a devolver o path sem conferir | 2 failed / 31 passed: `test_neither_script_falls_back_when_the_policy_is_absent` (`FileNotFoundError` cru) e `test_the_colab_layout_finds_the_policy_beside_the_script` |
| MW17 | `onnxMaximumInt8Bytes` do JSON vai a 150 000 000 | 1 failed / 32 passed **do lado Python**: `test_the_policy_seals_bertimbau_without_a_bake_off` (`150000000 != 130000000`) — o pin literal do lab, não só o do parser |
| MW20a | `source-lock.json` declara 130 000 001 bytes | 1 failed / 47 passed: "keeps the shipped artifact descriptors under the export ceiling" (`expected 2 to be 1` — os dois descritores discordam) |
| MW20b | **os dois** descritores declaram 130 000 001 | 1 failed / 47 passed: o mesmo teste, agora na comparação com o teto (`expected 130000001 to be less than or equal to 130000000`) |

Três "mutações" pedidas pela revisão **não são de código**, e ficam registradas como o que são. **MW15**:
medido que um artefato de 55 MB passa pelo teto — e deve passar, porque um limite superior não é
pertencimento; o remédio foi tirar a promessa do docstring, e um piso selado foi recusado acima com razão.
**MW18**: marca de retratação em prosa, sem teste. **MW19**: falsificados os quatro números do parágrafo 1
do ESTADO, `169 arquivos / 2.771 testes` e `343 passed, 18 subtests` seguem **verdes** — nenhum teste os lê,
e é por isso que envelheceram; corrigidos aqui, com a guarda recusada por circularidade.

Três mutações **não** isolaram o que se pretendia, e estão registradas como tais. **MW7** recusa no load,
antes de qualquer asserção rodar — mesma classe de M20 na emenda da moldura, e prova que o pin alcança o
dado selado, não que algum teste o afirme. **MW8** derruba dez testes, vários deles asserções de recusa que
passam a falhar pela razão errada: `assert_checkpoint_matches_sealed_backbone` chama
`assert_sealed_backbone_is_exportable` primeiro, então a guarda da política dispara antes da do checkpoint.
Isso é a ordem correta — a política é a autoridade — e o preço é que a mutação da tabela não isola.
**MW10** e **MW11** ficam vermelhas por `ModuleNotFoundError` e não pela recusa esperada: o teste afirma
`ValueError`, a mutação deixa a execução seguir até o import de `transformers`/`onnxruntime`, e o vermelho é
"a guarda não estava lá". É o vermelho certo pela razão certa, com a mensagem de outra classe.

**O que nenhum teste desta unidade alcança, declarado.** O sítio de chamada do teto em `main()` só é
observável por `inspect.getsource` (MW12): exercitá-lo de verdade exigiria `onnxruntime`, `torch` e um
checkpoint real de ~440 MB. E a mutação silenciosa que a revisão descreveu — tirar `token_type_ids` do
fallback e publicar um grafo de duas entradas — agora é recusada em execução por
`assert_inputs_are_the_emitted_shape`, mas **não** por teste: nada no lab abre uma sessão ONNX.

## O gate antiartefato passa a DEZ detecções (W2, D13) — 2026-08-05

**Status:** `EM-VIGOR`. Nenhuma decisão desta unidade é da lista de nunca-delegado: o teto continua em
`Fraction(2, 100)`, a política selada não foi tocada, nada foi publicado. O que é do agente — os padrões
concretos de cada sonda, as sondas recusadas por medição, e a regra de calibração que as recusas
produziram — está registrado abaixo com razão e custo de reversão.

As quatro detecções de **L12** (`prompt-echo`, `refusal`, `metaconversation`, `harness-signature`)
permanecem exatamente como estavam. O que deixou de valer é o **número quatro**: são dez.

| detecção nova | o que acusa | humano em moldura | `ai` | mistas (vãos) |
|---|---|---:|---:|---:|
| `spacing-anomaly` | corrida de espaço, espaço terminal por linha, tab dentro da linha | **0 %** | 0 % | 8,76 % |
| `encoding-corruption` | mojibake, dupla codificação UTF-8, U+FFFD | **0 %** | 0,05 % | 0 % |
| `invisible-character` | ZWSP, ZWNJ, ZWJ em palavra, corrida de NBSP, hífen suave, BOM, word joiner, marcas de direção | 0,59 % | 0,02 % | 0,05 % |
| `markdown-formatting` | cerca de código, marcador de lista, ênfase por asterisco, tabela de pipe | 0,11 % | **44,72 %** | 4,12 % |
| `heading-line` | `## `, `Título:`, numeração de seção, sublinha setext | 0,06 % | **20,72 %** | 1,55 % |
| `prompt-boilerplate` | o texto reproduz a FORMA de uma instrução de template | 0,05 % | 3,11 % | 0,05 % |

União das dez, por linha: **0,809 %** nas 11.000 linhas ptwiki · 9,71 % nas 31.100 humanas fora de moldura
· **49,07 %** nas 19.673 linhas `ai` · 10,30 % nas 2.135 mistas. Denominadores são linhas de ARQUIVO de
pool, sem dedup — não são os 4.048 candidatos `ai` de § 5.4 do ESTADO, onde os 3,656 % de quatro detecções
foram medidos.

### A decisão central: o gate acusa o que a normalização de inferência apaga

`contracts/text-normalization.ts` remove os invisíveis de `REMOVED_INVISIBLE_CHARACTERS`, dobra todo
separador em U+0020/U+000A e roda NFKC por grafema **antes** da tokenização. Logo o modelo pode nunca ver
um ZWSP — e o gate tem de continuar acusando, porque **o que ele mede não é o que o modelo vê**: é
contaminação da lane. Uma lane que emite uma marca a uma taxa que a classe humana não tem entrega o rótulo
de graça, e A4 manda regenerar a lane inteira acima de 2 %. Poda seletiva continua inalcançável: o
relatório não nomeia linha.

Isso está pinado por um teste que **lê o outro lado**: `_characters_the_inference_normalization_removes`
parseia o literal de `REMOVED_INVISIBLE_CHARACTERS` do arquivo TypeScript e afirma que, para cada code
point que o contrato remove e o gate sonda, o gate ainda acusa — e que o texto **sem** o caractere (o que o
modelo recebe) não dispara nada. Custo de reversão: nenhum, é teste.

### As sondas que a medição RECUSOU, e a regra que elas produziram

Cinco formas foram medidas e ficaram fora. Duas delas o parente desta unidade pediu explicitamente, e a
medição as derrubou:

| recusada | humano em moldura | gerado | razão |
|---|---:|---:|---|
| **espaço antes de pontuação** | **7,15 %** | 0,55 % | direção invertida (13×) e acima do teto no lado humano |
| **NBSP nu**, em vez de corrida | **1,45 %** | 0,005 % | sozinha levava a união humana a **2,18 %**, acima do teto |
| linha curta terminada em dois-pontos | 1,63 % | 5,25 % | é a forma de um dois-pontos, não de um cabeçalho |
| `no formato` solto | 0,20 % | 0,13 % | prosa comum |
| `atue como` sem substantivo de papel | 0,02 % | 0,01 % | verbo de prosa: "atue como mediador" |

**A regra de calibração, agora escrita no módulo:** a união das dez detecções sobre a classe humana **em
moldura** fica ABAIXO do teto de recusa. Uma lane recusada por ser tão limpa quanto a classe negativa é um
gate que recusa lanes por serem humanas — e com o NBSP nu era exatamente isso que aconteceria, a 2,18 %
contra um teto de 2 %. A classe que calibra é a **em moldura** (ptwiki) e não os pools fora de moldura:
Stack Overflow escreve Markdown de verdade e a célula publicada não é Stack Overflow.

O NBSP não foi apagado: virou **corrida** de dois ou mais, 0,04 % no humano e 0 no gerado. Um NBSP
tipográfico não se repete — é o que fica entre número e unidade; enchimento se repete. Custo de reversão
de cada recusa: **uma linha** na tabela de sondas, e os testes que pinam a recusa apontam a linha.

### O que a medição refutou e não estava no roteiro

**Os invisíveis rodam invertidos na célula publicada.** Não é só o NBSP: ZWSP 0,38 %, marcas de direção
0,12 %, hífen suave 0,05 % no humano em moldura, contra 0,02 % nas linhas `ai`. Na moldura ptwiki um
invisível é marca do lado HUMANO — vem da fonte wiki, e nenhum extrator o remove. A detecção fica como
guarda contra um harness FUTURO, com a inversão declarada no próprio módulo em vez de implícita.

**A assimetria de `spacing-anomaly` é do pipeline, não das lanes.** Todo pool escrito por
`CandidateWriter.offer` passou por `common.normalize_text`; `make_mixed.emit` escreve `text: edited` cru.
Daí 8,67 % de corrida de espaço e 5,29 % de espaço terminal nos vãos mistos contra 0 em tudo mais. O gate
acusa corretamente — a marca está no corpus e o rótulo sai de graça —, mas o remédio verdadeiro é o
escritor, não regenerar a lane. Fica como dívida no ESTADO, e a decisão de qual remédio aplicar é da
Fase 3, quando um pool misto novo existir.

**A sonda de espaço terminal não pode ler o fim do vão.** Um vão misto é FATIA: um vão que termina em
espaço pode ser só onde `mixture.spans` cortou. Medido, o braço `\Z` acrescentaria 2 linhas de 2.135 e as
duas são corte. A sonda exige `\n`.

### Decisões do agente, com razão e custo de reversão

| decisão | razão | custo de reversão |
|---|---|---|
| o teto continua **constante em código**, não campo de política | `preregistration-v4.json` está selada e não tem campo de contaminação; acrescentar um é mudança de política, não leitura dela. Reconfirmado, não redecidido: o teste que afirma a ausência do campo já existia (L12) e segue verde | uma constante, no dia em que a pré-inscrição ganhar o campo |
| ordem canônica **acrescenta** as seis ao fim, sem intercalar | a ordem é o que faz duas corridas sobre um corpus produzirem os mesmos bytes; intercalar mexeria em todo relatório já escrito sem ganho | reordenar a tupla |
| numeração ordinada (`1. `) mora em `heading-line`, não em `markdown-formatting` | é a mesma sintaxe nas duas leituras, e em prosa pt-BR gerada é número de seção muito mais vezes que lista ordenada; uma casa só mantém o diagnóstico inequívoco para o dono da lane | mover uma entrada de tabela |
| tabela de pipe exige linha SEPARADORA ou duas linhas seguidas com dois pipes | uma linha com dois pipes chega a 0,10 % do humano em moldura (a Wikipédia pt escreve sintaxe de tabela) contra 0,49 % do gerado — separação insuficiente para agir; a forma estrita é 0 contra 0,40 % | frouxar o padrão |
| ZWJ só conta com vizinho **alfanumérico** | um ZWJ entre pictogramas é o juntador de uma sequência de emoji, que `text-normalization.ts` preserva por razão medida; 158 das 19.673 linhas `ai` carregam um e nenhum está dentro de palavra. O que parte token é o ZWJ em palavra: 0 em tudo medido | tirar o lookaround |
| mojibake exige a **cauda** Latin-1/C1 e não a cabeça | `Ã` e `Â` são maiúsculas de pt-BR (`SÃO`, `MÃE`, `CÂMARA`) e nelas o caractere seguinte é letra ASCII | frouxar a classe |
| todo code point invisível é escrito como **escape**, no módulo e nos testes | uma sonda escrita com o caractere é sonda que ninguém revisa em diff e que um editor apaga sem deixar um. Guardado por teste sobre o fonte do próprio módulo | tirar o teste |
| a classe que calibra é a humana **em moldura** | é a classe negativa contra a qual o rótulo sairia de graça; os pools fora de moldura foram medidos e ficam no registro, não na calibração | trocar o conjunto de calibração |

### O que esta unidade NÃO fez, de propósito

- **não** acrescentou campo ao JSON selado, nem tocou `preregistration-v4.{json,ts}`;
- **não** consertou `make_mixed.emit` — normalizar lá muda o texto de 2.135 candidatos e é decisão de
  pipeline de corpus, não de gate; ficou como dívida com o número medido;
- **não** normalizou o caminho de treino (`train_detector.py`, `build_dataset.py` não normalizam, e
  `contracts/text-normalization.ts` roda só na inferência): é train/serving skew medido nesta unidade e
  registrado como dívida, e mexer nele move o texto que o treino lê;
- **não** tocou `license-review.json`, nem o byte NUL de `near-duplicates.ts`;
- **não** rodou o gate sobre partição cega nenhuma: as sondas leram pools de candidatos e imprimiram
  contagens, nunca conteúdo.

### Prova por mutação — vinte e seis mutações, cinco passos cada

Base verde antes e depois (`41 passed, 237 deselected, 13 subtests` em `-k AntiArtifact`), com
`sha256(artifact_gate.py) = 29f253b4be9a325d713d53645ebd22b8b3ebe6cda11b5d4a68f059e00f7001d0` e
`sha256(contracts/text-normalization.ts) = 5e608c45e349601818003b1d9f3e804fd3707fb24effd0e29dc1b00292dae55b`
idênticos nos dois extremos e depois de cada uma das 26 restaurações. A bateria **inteira** foi rerodada
sobre os bytes finais, depois das duas guardas que a revisão cruzada exigiu: um hash que certifica 24
mutações não certifica a árvore que ganhou uma sonda depois. Cada mutação é **um** sítio de código de
produção, e o vermelho é sempre no teste NOMEADO.

| # | mutação | vermelho em |
|---|---|---|
| MW1 | sonda `space-run` apagada | `test_anomalous_whitespace_is_named_spacing_anomaly` |
| MW2 | sonda `trailing-space-before-newline` apagada | idem |
| MW3 | sonda recusada de espaço antes de pontuação **re-adicionada** | `test_a_space_before_punctuation_is_not_a_spacing_anomaly` |
| MW4 | espaço terminal ancorado no fim do vão (`\Z`) | `test_a_space_at_the_end_of_the_span_is_not_a_trailing_space` |
| MW5 | sonda de mojibake apagada | `test_broken_encoding_is_named_encoding_corruption` |
| MW6 | mojibake frouxada para a cabeça sozinha | `test_a_capital_a_tilde_of_ordinary_portuguese_is_not_mojibake` |
| MW7 | sonda de dupla codificação apagada | `test_broken_encoding_is_named_encoding_corruption` |
| MW8 | sonda de U+FFFD apagada | idem |
| MW9 | sonda `zero-width-space` apagada | `test_an_invisible_code_point_is_named_invisible_character` |
| MW9b | a mesma deleção, vista pelo pin da normalização | `test_the_invisible_detection_fires_on_what_the_normalization_removes` |
| MW10 | NBSP sondado **nu** em vez de corrida | `test_one_no_break_space_is_typography_and_not_an_artifact` |
| MW11 | sonda de corrida de NBSP apagada | `test_an_invisible_code_point_is_named_invisible_character` |
| MW12 | ênfase `**…**` apagada | `test_markdown_syntax_is_named_markdown_formatting` |
| MW13 | marcador de lista perde a âncora de linha | `test_a_dash_inside_a_sentence_is_not_a_list_marker` |
| MW14 | cerca de código apagada | `test_markdown_syntax_is_named_markdown_formatting` |
| MW15 | `## ` apagado | `test_a_title_line_is_named_heading_line` |
| MW16 | numeração de seção apagada | idem |
| MW17 | linha de rótulo (`Título:`) apagada | idem |
| MW18 | frame `write-the-artifact` apagado | `test_a_reproduced_instruction_is_named_prompt_boilerplate` |
| MW19 | `assume-a-role` frouxado para o verbo nu | `test_an_ordinary_verb_of_prose_is_not_a_role_assignment` |
| MW20 | contaminação contada **por detecção** em vez de por linha | `test_a_line_with_two_detections_is_one_contaminated_line` |
| MW21 | a recusa para de nomear quais detecções dispararam | `test_a_family_over_the_ceiling_on_an_added_detection_regenerates_its_lane` |
| MW22 | `heading-line` tirada da ordem canônica | `test_the_report_publishes_all_ten_detection_names` |
| MW23 | sonda escrita com o caractere **literal** | `test_no_probe_is_spelled_with_a_literal_invisible_character` |
| MW24 | 11.ª sonda com 7,15 % medido no humano em moldura (espaço antes de pontuação) acrescentada | `test_the_union_over_the_in_frame_human_class_stays_below_the_ceiling` |
| MW25 | code point novo (U+206A) em `REMOVED_INVISIBLE_CHARACTERS`, no lado TypeScript, sem sonda no gate | `test_the_invisible_detection_fires_on_what_the_normalization_removes` |

**MW20 é a que prova a contagem por linha**, e os números do teste foram escolhidos para que a mutação
mude o VEREDITO e não só uma contagem: duas linhas em cem que casam duas detecções dão 2 % (limpo) e, contadas
uma vez por detecção, 4 % (recusa).

**MW24 e MW25 são as duas mutações que a revisão cruzada mostrou SILENCIOSAS**, e é por elas que existem as
duas guardas novas. Antes, acrescentar uma sonda invertida deixava a suíte inteira verde (só as duas recusas
pontuais estavam pinadas, por MW3 e MW10) e acrescentar um code point ao contrato do lado TypeScript não
alcançava teste nenhum do lab (o pin afirmava 8 dos 27, nomeados à mão). Depois: MW24 dá
`AssertionError: Fraction(41, 500) not less than Fraction(1, 50)` — a classe humana em moldura a 82/1000 —
e MW25 dá `Lists differ: ['0x206a'] != []`.

### O que a revisão cruzada pegou, e o que virou guarda

Nenhum achado foi aceito por deferência: cada um foi remedido contra o código antes de qualquer edição.

**(1) Um veredito publicado ficou falso, e era do ESTADO.** § 5.4 dizia que, sem a poda global, "as 5
famílias que chegam saem todas `clear` (0 de 1.170)" — medido com **quatro** detecções. Remedido com as dez,
rodando a montagem com a poda global desligada: **24 de 1.170** (2,05 %), `gemini-3_1-flash-lite` em
**16/256 = 6,25 %**, acima do teto, veredito `regenerate-lane`, lane `gemini-api`. A única detecção que
dispara é `markdown-formatting`. A linha foi emendada e a armadilha entrou em § 6. Com ela cai metade do
que o relatório de implementação declarava como incompleto ("as dez não têm efeito de produção hoje"): a
segunda metade continua verdadeira — com a poda global ligada, 0 registro gerado chega ao gate — e a
primeira não, porque o efeito existe sobre o material de hoje e atinge `gemini-api`, não a lane mista.

**(2) O pin cross-linguagem afirmava menos do que o README prometia.** O README dizia que o teste garante
que o gate acusa **cada** code point que `REMOVED_INVISIBLE_CHARACTERS` remove; medido, o gate acusava 16
dos 27 e o teste afirmava 8, nomeados à mão. Escolhido o remédio forte em vez do hedge: quatro sondas novas
fecham o conjunto — CGJ, separador vogal mongol, os quatro enchimentos Hangul e os operadores invisíveis
U+2061–U+2064 — e o teste passou a afirmar **igualdade de conjuntos**. As quatro dão **0** nas 11.000 linhas
em moldura, **0** nas 19.673 `ai` e **0** nas 2.135 mistas (1 linha entre as 31.100 fora de moldura, que já
contaminava por outra marca), então nenhuma união publicada se move: 0,809 % · 9,71 % · 49,07 % · 10,30 %
remedidos idênticos. Custo de reversão: quatro linhas de tabela e uma asserção.

**(3) Três taxas congeladas estavam escritas com dois valores diferentes.** O comentário do teste de
Markdown dizia 0,21 %/44,73 % onde o módulo diz 0,11 %/44,72 %; remedido, 12/11.000 = 0,109 % e
8.798/19.673 = 44,721 %, e o módulo é que estava certo. `references.md` e este registro escreviam hífen
suave 0,06 % onde 6/11.000 = 0,0545 % arredonda para 0,05 %, e `atue como` nu no lado gerado como 0,02 %
onde 2/19.673 = 0,010 %. Os três passaram ao valor medido.

**A regra de calibração deixou de ser só uma frase.** O achado menor e certo era que a regra central — a
união das dez sobre a classe humana em moldura fica abaixo do teto — não era imposta por nada: uma 11.ª
sonda com 3 % no lado humano entrava com a suíte verde. Agora
`test_the_union_over_the_in_frame_human_class_stays_below_the_ceiling` roda o próprio `measure` sobre 1.000
linhas com a composição medida da classe, as quatro formas recusadas incluídas na taxa em que a Wikipédia pt
as escreve, e exige `clear`. A fixture **contém o excluído**, que é o que faz a guarda morder: 1,0 % hoje,
8,2 % com a sonda recusada de volta. O que **fica como dívida** é o medidor: as taxas vêm de script de sonda
que não está no repositório, porque os pools são gitignored, e nenhuma das ~50 é reproduzível de um
checkout (§ 7 do ESTADO). Cada número desta unidade foi remedido por sonda própria antes da emenda — união
89/11.000 = 0,809 %, e com o NBSP nu 240/11.000 = 2,182 %, idênticos ao publicado.
## As sondas diagnósticas (W3) e o baseline como detector de vazamento (D19) — 2026-08-05

**Status:** `EM-VIGOR`. Nenhuma decisão desta unidade é da lista de nunca-delegado. A política selada não
foi tocada, `m` continua 4, nada foi publicado, nenhuma partição cega foi lida. O que é do agente — os
dois números que fazem a sonda 1 recusar, o recorte de cada sonda, a unidade de token da dispersão e a
escolha de `analyzer="char"` — está abaixo com razão e custo de reversão.

### O que a emenda da moldura fez com o roteiro das sondas

Com quatro células, a sonda que valia era "prever de qual célula o texto veio": um detector que aprende a
célula publica uma FPR por célula que é, na verdade, um classificador de célula. A moldura publicada tem
**uma** célula (`ptwiki`), então essa sonda não tem alvo — e o risco mudou de lugar. Com fonte única, o que
ameaça a medição não é o detector aprender a célula; é ele aprender **comprimento**, **tópico** ou a
assinatura tipográfica de uma **lane**. As quatro sondas implementadas são esses riscos, e a quarta é a
razão pela qual o projeto passa a poder dizer em que sinal o modelo se apoia.

### A camada de governança: só a sonda 1 recusa, e a forma do relatório impõe isso

`benchmark/gates.ts` já distingue gate `certifying` de gate `diagnostic`. As sondas 2, 3 e 4, o viés
ortográfico, a dispersão entre janelas e o baseline são **diagnóstico publicado que não decide**: não
entram na família primária, não gastam alpha e não viram hipótese. A imposição não é uma convenção de
leitura — é a **forma** do relatório: o dicionário que as sondas 2, 3 e 4 devolvem **não tem campo de
veredito**, então nenhum chamador sob prazo pode lê-lo como recusa. É a mesma disciplina que
`artifact_gate` aplica ao omitir o identificador da linha, aplicada aqui.

A sonda 1 recusa, e recusa a **MONTAGEM** — antes de qualquer treino. Ela usa dois números congelados em
código e não na pré-inscrição, pela razão que `artifact_gate` escreve sobre o próprio teto:
`preregistration-v4.json` está selada e não tem campo para regra de aceitação de montagem, e criar um seria
mudança de política e não leitura dela.

| número | valor | por que dois e não um |
|---|---:|---|
| `PARTITION_PREDICTABILITY_AUC_FLOOR` | 0,60 | o EFEITO. A 10.000 linhas uma AUC de 0,52 é significante e não pode importar |
| `PARTITION_PREDICTABILITY_SIGNIFICANCE` | 0,01 | o RUÍDO. A 60 linhas uma AUC de 0,75 é uma dobra com sorte |

**Nenhum dos dois é fração do alpha familiar**, e o teste o afirma lendo o próprio fonte: o módulo não
contém `perHypothesisAlpha`, `familyAlpha` nem `primaryFamily` em nenhuma forma. Uma sonda ligada ao alpha
familiar mudaria `m`, e `m` é do operador. Custo de reversão dos dois números: uma linha cada, e a suíte
reprova nomeando o teste.

### O que a sonda 1 é, e o que ela NÃO vê

É um **classifier two-sample test** (Lopez-Paz & Oquab, 2017) sobre `train`, `dev` e `cal-A` — AUC
um-contra-resto fora de dobra por partição, com p-valor de Mann-Whitney sob permutabilidade. O que ela
mede é permutabilidade das três partições abertas, e o que uma AUC alta significa é que o número que `dev`
reporta não estima nada que `train` tenha ajustado (Ben-David et al., 2010).

**A refutação do roteiro, e ela é medida.** O roteiro pedia "fixture com vazamento plantado entre train e
dev → a sonda 1 recusa". Um texto presente nas DUAS partições é **invisível** a um classificador de
partição por construção: as mesmas features carregam dois rótulos opostos, então o par duplicado não move
a AUC em nenhuma direção. Está afirmado por teste
(`test_a_text_duplicated_across_partitions_is_invisible_to_the_auc`: macro AUC abaixo do piso, e a razão
`partition-predictable` ausente). Duas consequências:

1. a sonda 1 carrega **duas** razões de recusa, não uma: `partition-predictable` (a AUC) e
   `text-shared-across-partitions` (sobreposição por texto normalizado exato entre duas das três abertas).
   A segunda é o que responde ao vazamento que o roteiro descreve, e ela nomeia o par de partições;
2. a versão profunda dessa checagem — quase-duplicata como componente conexo, Jaccard ≥ 0,82 — **não** foi
   duplicada aqui: é de `near_dupes`, de `benchmark/split.ts` e de
   `assemble_corpus.assert_components_can_fill_five_partitions`. Redecidir o limiar aqui daria ao corpus
   dois limiares.

O "vazamento" que a AUC vê é o outro: `dev` sorteada de material que `train` não tem. A fixture que o
prova planta um marcador que só `dev` carrega, e a recusa nomeia a partição, a AUC, o p-valor, o `n` e o
piso — asserido pelos **valores** e não só pelas palavras, porque uma recusa que nomeia a métrica sem o
número deixa o operador escolhendo entre re-dividir e re-coletar sem base.

### Cegueira: a sonda seleciona, conta e nunca nomeia

`BLIND_PARTITIONS` é espelho de `benchmark/cluster-exposure-ledger.ts` (`cal-B`, `test`), pinado por teste
contra o fonte TypeScript; `OPEN_PARTITIONS` é **derivada** de `assemble_corpus.BLOCK_TIME` menos as cegas,
para que uma sexta partição criada lá não fique sem sonda em silêncio. A partição de uma linha é lida do
`createdAt` — `assemble_corpus` mantém a partição como mapa lateral e não como campo do registro, e uma
segunda cópia poderia discordar do carimbo.

O relatório publica os abertos e **um** contador agregado do que foi posto de lado como cego: com as cinco
frações congeladas, o total é aritmética que qualquer um faz do tamanho do corpus, enquanto um detalhamento
por partição cega **diria quais linhas estão em qual bloco**. Dois testes serializam e conferem: um o
relatório da sonda 1, outro o relatório INTEIRO de `_probe_all`, exigindo que nenhuma das duas grafias cegas
apareça e que as três abertas apareçam — sem a segunda metade a asserção passaria sobre um relatório que não
nomeia partição nenhuma. O segundo teste também fixa o conjunto de chaves de `_probe_all`, porque a hora em
que essa asserção envelhece é a hora em que um CAMPO NOVO entra no relatório e ninguém relê a asserção
antiga; foi o que aconteceu ao entrar `inputs`. E `_assert_no_blind_partition_reached` roda **dentro** da
sonda: alargar `OPEN_PARTITIONS` reprova em vez de treinar sobre um bloco não gasto.

### A taxa de erro ortográfico: sonda de viés, nunca feature — e a guarda que impõe

Erro ortográfico correlaciona com escrita não nativa e vocabulário limitado, que são as populações cuja
taxa de falso positivo este projeto se comprometeu a vigiar (Liang et al., 2023). Medir para saber protege;
alimentar o modelo constrói o viés **dentro** dele, onde nenhuma fatia o encontra depois. A construção:

- dois registros — `STYLOMETRIC_FEATURES` (19 features) e `SPELLING_BIAS_MEASURES` (1 medida);
- `assert_no_bias_measure_reaches_the_features` compara **nome** e **callable**, porque nenhuma das duas
  checagens implica a outra: registrar a mesma função com outro nome derrota a de nome, e um wrapper de uma
  linha com o mesmo nome derrota a de identidade;
- a guarda é chamada dentro de `feature_row` e `feature_matrix`, isto é, no **caminho de escore** e não
  apenas num teste: quem chegou à matriz está a um `fit` de um escore.

**Medido nos pools em moldura:** 0,00581 acerto por 100 palavras na classe humana contra 0,00083 na `ai`. A
direção é a que importa: o lado **humano** carrega ~7,0× a taxa do gerado, então a feature seria proxy de
"humano" e portanto motor de falso positivo exactamente na população vigiada. **A agregação está nomeada**
porque as duas dão números diferentes: o valor publicado é a média POR DOCUMENTO da taxa por 100 palavras
(é o que `probe_stylometry` emite, via `statistics.fmean`), e agrupando acertos e palavras dos dois lados —
37 acertos em 705.526 palavras humanas contra 2 em 402.068 geradas — a razão é 10,5×. Publicar "acertos por
100 palavras" sem dizer qual das duas é um número que não reproduz.

O valor absoluto é minúsculo porque a lede da Wikipédia pt é texto editado — o que a sonda mede na v1 é a
lista fechada de formas declarada em `PT_BR_SPELLING_SHAPES`, e **não** um corretor. `esta`, `publico`,
`pos` e `so` estão deliberadamente FORA da lista: cada um também é palavra correta, e contá-los inventaria
erro.

**E `ate` e `quiz` estavam DENTRO, contra o comentário logo acima delas** ("formas sem homógrafo não
acentuado"): `ate` é subjuntivo/imperativo de *atar* ("ate o sapato") e `quiz` é estrangeirismo corrente
("um quiz"). O teste que guardava isso iterava as seis palavras que o autor já havia excluído, então passava
verde com as duas na lista — a mesma vacuidade de fixture da sonda 2, e prova por mutação não a encontra
porque o defeito está no dado do teste. Remediado: as duas saíram, o teste passou a DERIVAR os candidatos
casando cada forma contra um vocabulário de palavras corretas de pt-BR (uma forma correta acrescentada em
qualquer posição da lista agora reprova), e a taxa humana caiu de 0,00624 para 0,00581 — 2 dos 39 acertos
eram esses. A exclusão custa as duas formas mais comuns de todas (`até`, `quis`) e é paga de qualquer jeito,
porque o erro que ela evita cai no lado **humano**, que é o lado de que a leitura de ~7× depende. `quizer`
fica: não é palavra.

A grosseria corta num sentido só e está declarada: um documento só-ASCII lê como maximamente errado, que é
a segunda razão pela qual o número não pode alcançar escore nenhum.

### Estilometria: 19 features, coeficientes publicados, e o achado

Regressão logística sobre features padronizadas, e **não** floresta nem boosting: legibilidade é a entrega,
e um ranking de importância não diz DIREÇÃO (Rudin, 2019). Importância por permutação fica ao lado, como
leitura de robustez, porque as features são correlacionadas — taxa de hapax e TTR medem o mesmo eixo — e a
colinearidade parte um sinal em dois coeficientes de sinais opostos (Fisher, Rudin & Dominici, 2019).

Medido sobre 7.572 linhas em moldura dos pools (5.000 humanas ptwiki + 2.572 `ai` das **três** lanes com
material fresco — `codex`, `gemini-api`, `agy`), AUC fora de dobra **0,9853**, seed 42 pinada e coeficientes
idênticos byte a byte em re-execução:

| feature | coeficiente | importância por permutação (queda de AUC) |
|---|---:|---:|
| `hapax-rate` | **+3,564** | **+0,191** |
| `type-token-ratio` | −3,273 | +0,051 |
| `parenthesis-rate` | **−3,108** | **+0,070** |
| `flesch-pt` | −2,155 | +0,062 |
| `sentence-length-mean` | −2,054 | +0,042 |
| `mtld` | +1,988 | +0,053 |

**O achado, e é sobre a fonte e não sobre autoria:** o sinal mais legível e mais carregado depois da
diversidade lexical é `parenthesis-rate`, **negativo** para `ai` — a lede da Wikipédia pt é cheia de
parênteses (datas, nomes alternativos, transliteração) e o gerado não é. Um modelo barato chega a AUC 0,985
apoiando-se em dispersão de vocabulário e na convenção parentética da Wikipédia. Isso é artefato de fonte
no sentido exacto do D19: alto desempenho aqui não é qualidade.

`cal-A` fica **fora** da sonda 4 embora não seja cega: com `dev` a 5 % e `cal-A` a 10 %, é **dois terços**
(10/15) da população que ajusta o limiar provisório — `benchmark/commands/fit.ts` diz que a população são os
negativos humanos de `dev` + `cal-A` —, ou 600 linhas sob a moldura de uma célula (dívida de § 7 do ESTADO),
e um diagnóstico não tem por que ser a razão de alguém tê-la olhado.

### Comprimento: AUC no acaso, e a tabela por faixa dizendo outra coisa

Medido nos pools em moldura: AUC **0,5009**, e ao lado o rank AUC da contagem crua **0,5017**. Mediana 102
palavras no humano contra 90 na `ai`.

**As duas colunas não são a mesma quantidade, e a versão anterior deste parágrafo alegava que coincidiam
"porque uma logística de uma feature é monótona nela — afirmado por teste".** A monotonia vale DENTRO de uma
dobra; a AUC publicada agrupa as predições fora de dobra de cinco modelos, cada um com seu intercepto e seu
coeficiente, e uma união de cinco mapas monótonos não é monótona. O teste que "afirmava" a coincidência
rodava sobre uma fixture perfeitamente separada onde as duas AUCs são exatamente `1,0`, então nenhuma mutação
da sonda podia avermelhá-lo — e a própria medição publicada (diferença 8,6e-4) reprovaria a tolerância que
ele exigia (`places=6`). Remediado nos dois lados: o teste passou a rodar sobre a fixture de comprimentos
sobrepostos, onde as dobras discordam de SINAL e a AUC agrupada cai **abaixo** do acaso enquanto a crua está
acima, asserindo que as duas DIVERGEM; e a fixture degenerada ficou com teste próprio que declara a
degeneração em vez de a esconder. `coefficientPerFold` é publicado para que o caso seja legível: divergência
com um sinal só é ruído de amostragem, divergência com dois sinais são dobras que discordam.

**E a AUC no acaso NÃO significa distribuições iguais.** A tabela por decil pooled mostra a fração `ai`
oscilando 0,21 → 0,59 → 0,40 → 0,29 → 0,28 → 0,23 → 0,20 → 0,15 → 0,43 → 0,57: a distribuição gerada é
bimodal DENTRO da faixa humana, então nenhuma domina estocasticamente a outra e a AUC monótona não vê a
diferença de forma. É por isso que as duas quantidades são publicadas juntas, e é a razão de
`_band_lower_bounds` usar limites INFERIORES deduplicados em vez de uma lista de arestas: num corpus bimodal
metade dos decis cai em cada modo, e deduplicar arestas colapsaria os dois modos numa única faixa que
contém tudo.

### Lane: 0,9713 de AUC macro — a assinatura de gerador é quase perfeita

Medido sobre 2.572 linhas `ai`: `codex` 0,9911 (1.402 linhas) · `agy` 0,9696 (419) · `gemini-api` 0,9533
(751), macro **0,9713**. É o número mais alto desta unidade e é território de D13/W2: uma lane que um
classificador nomeia pelo texto entrega o rótulo de graça, e o remédio de A4 é **regenerar a lane**, não
filtrar o que a sonda achou. A sonda aponta e não decide — mas o que ela aponta é que as três lanes medidas
são distinguíveis quase perfeitamente entre si.

**São TRÊS lanes, e a contagem importa mais que a palavra.** A primeira redação desta unidade escreveu
"quatro lanes frescas" no ESTADO e aqui, ao lado de uma tabela que enumerava três. Não existe
`ai_fresh_fable.jsonl` em `benchmark/data/candidates`: de `fable` só há `lane_parents_fable.jsonl`, 60 pais
humanos. A quarta lane congelada **não tem material gerado fresco nenhum**, e a leitura de que D13/W2 varreu
as quatro é falsa. O parágrafo escondia um fato de Fase 3 em vez de o expor, e é por isso que a correção não
é só numérica.

### Dispersão entre janelas: de graça, real, e quase vazia neste material

O escore de documento já vem de agregação sobre janelas, então a dispersão é a quantidade que a agregação
joga fora. O módulo espelha a regra de janelamento **selada** — `contentTokens` 510, `overlapTokens` 64,
`maxWindows` 8, LIDOS de `models/cleanfeed-ptbr-v1/cleanfeed-model.json` — e a seleção
`round(i·(total−1)/(limit−1))` de `src/inference/chunker.ts`, com `floor(x + 0,5)` porque o `round` do
Python arredonda a meia para PAR e o do JavaScript para cima (witness pinado: 6 candidatos em 3 vagas dá
`[0, 3, 5]` e não `[0, 2, 5]`).

**Divergência técnica declarada:** o runtime lateia tokens WordPiece; o lab lateia tokens de espaço, porque
um tokenizador WordPiece é download de modelo e um diagnóstico não paga um. A REGRA é a selada; a UNIDADE é
mais grosseira, então as fronteiras não são as do runtime. É diagnóstico, não decide, e a comparação é
entre documentos medidos do mesmo jeito.

Medido com o escore da estilometria por janela, **sobre os documentos que têm mais de uma janela**: `mixed`
**0,622** de amplitude média (n=66) contra `human` 0,147 (n=78) e `ai` 0,185 (**n=4**) — 4× de separação
entre `mixed` e `human`, que é o sinal natural de autoria mista que a literatura de detecção de fronteira
descreve. **O `n` entra na mesma linha do valor** porque o de `ai` é média sobre QUATRO documentos, publicado
antes ao lado de médias sobre 66 e 78 sem nada que o distinguisse: a manchete de 4× sobrevive, o 0,185 não é
medição de nada. **E o achado que limita a sonda:** a 510 tokens de janela, **9.559 dos 9.707**
documentos varridos têm UMA única janela (2.069 dos 2.135 mistos, 4.922 das 5.000 humanas, 2.568 dos 2.572
`ai`), e uma janela tem amplitude zero por aritmética e não por concordância. Com a mediana em ~100
palavras, o escore de documento **é** o escore de uma janela para a grande maioria das linhas, e a dispersão
não está disponível como sinal para elas. Isso vale para o runtime também: 510 subtokens WordPiece são
~350-400 palavras em pt-BR, ainda muito acima da mediana. Entra como dívida.

### D19: o baseline ganha n-grama de CARACTERE, e a razão não é desempenho

`baseline_tfidf.py` usava só n-grama de palavra (1,2). Agora roda **duas** vetorizações em paralelo e
reporta as duas lado a lado — palavra (1,2) e caractere (3,6) —, num dicionário `VECTORIZATIONS` para que
um chamador não possa rodar uma sem a outra: reportar só a AUC de palavra é a leitura que D19 existe para
impedir. O papel deste baseline na Fase 4 é ser **detector de vazamento**, e n-grama de palavra atravessa
sem ver exactamente os artefatos tipográficos que a W2 caça — `**`, linha de cabeçalho, NBSP, mojibake não
são palavras.

`analyzer="char"` e **não** `char_wb`: o `char_wb` do sklearn confina os n-gramas ao interior das palavras,
e as marcas medidas vivem ATRAVESSANDO a fronteira (`** `, ` | `, espaço antes de quebra). Confinar
compraria de volta o ponto cego que o n-grama de caractere entrou para fechar. Custo de reversão: uma
string, e `CharacterNgramBaselineTests` reprova.

**A prova é a metade sem ruído.** Sobre uma fixture cujo único sinal é tipográfico, o analisador de palavra
produz **o mesmo fluxo de tokens** para o texto marcado e para o texto limpo — `**palavra**` e `palavra`
dão o mesmo token —, afirmado por igualdade de listas; o de caractere adquire `** ` e ` **`, que são
justamente os n-gramas de fronteira. A AUC vem depois, como consequência: palavra abaixo de 0,65 e
caractere acima de 0,95.

**E um achado medido sobre o próprio baseline:** numa fixture PAREADA por tópico — cada linha gerada é a
gêmea marcada de uma humana, que é o desenho do piloto — a AUC de palavra cai a **0,019**, muito abaixo do
acaso. As gêmeas são o mesmo ponto no espaço de palavras com rótulos opostos, então fora de dobra o modelo
prevê o rótulo da gêmea que viu. Ler uma AUC de palavra abaixo do acaso como "nenhum artefato aqui" é o
erro, e há teste que o afirma.

### Onde a sonda 1 é imposta, e a dívida que isso abre

A sonda 1 **não** roda dentro de `assemble_corpus.main()`, e a decisão é deliberada: o montador é
stdlib-only e determinístico, e uma validação cruzada de 5 dobras dentro dele rodaria em cada uma das
fixtures de montagem, a maioria com menos linhas por partição do que há dobras. A imposição é o código de
saída do comando próprio, que é passo do runbook — **a mesma forma da dívida já registrada** de que
`train_detector.py` não confere o relatório do gate antiartefato. Entra em § 7 com o mesmo dono.

E há uma segunda dívida herdada: as taxas desta unidade foram medidas sobre os pools de
`benchmark/data/candidates`, que são gitignored, então nenhuma é reproduzível de um checkout. A diferença
em relação à dívida que a W2 abriu é que **o medidor agora está no repositório** — `diagnostic_probes.py`
com `--pools`, `--pool-file` e `--in-frame-pools` — e o que falta é o material.

### A receita registrada não produzia o número, e por que registrar prosa não bastava

A primeira redação registrou a medição como `diagnostic_probes.py --pools`, em três lugares. **Isso lê 67.934
linhas e não 9.707**: `--pools` sem restrição varre o diretório inteiro, arrastando `ptso.jsonl` +
`ptso_fresh.jsonl` (18.000 linhas do material que o projeto **bloqueia por nome**, F0-6, e que este adaptador
rotularia `human`), `carolina*` (11.600 fora de moldura), `ai_openai` + `ai_public_madras` (14.004, incluindo
a família reservada ao OOD) e `wikipedia.jsonl`, o dump pré-moldura. A seleção de 9 arquivos que de fato dá
9.707 não estava registrada em lugar nenhum — o exemplo do README passava 2 dos 9 —, então o número era
irreproduzível mesmo por quem tinha o material.

O remédio é **duplo, e nenhuma das metades fecha sozinha**:

1. a seleção virou constante no código, `IN_FRAME_POOLS` com a flag `--in-frame-pools`, e não argumento que
   o operador redigita. Cada nome ausente está ausente por uma razão que o plano declara, e um teste afirma
   as ausências (`ptso*`, `carolina*`, `b2w*`, `ai_openai`, `ai_public_madras`, e `wikipedia.jsonl` por nome
   exato, porque é prefixo de `wikipedia_fresh.jsonl`). Receita em prosa envelhece em silêncio; constante
   sob teste, não;
2. o relatório passou a carregar `inputs.rowsPerFile` — arquivo por arquivo, com contagem. "Em moldura" é
   uma alegação sobre a ENTRADA, e sem esse campo um relatório rodado fora da moldura é indistinguível de
   um rodado dentro dela para quem só tem o artefato. Um total agregado não serve: uma dúzia de seleções
   diferentes produz o mesmo total.

Cada linha de pool carrega agora o arquivo de onde veio (`poolFile`), que é o que permite (2). Custo de
reversão: uma chave no dicionário da linha e a função `input_provenance`; `PoolAdapterTests` reprova, e o
teste que morde de verdade é o que confere que `names` SELECIONA — ignorar o argumento não falha alto, apenas
publica a estilometria de uma população que a alegação não nomeia.

### A contagem de referências entra sob teste, porque foi a terceira vez que envelheceu

O ESTADO publicava **349** marcadores de link em `references.md` "sob qualquer regra reproduzível". Ao
encontrar o achado a árvore tinha **410** (391 em `HEAD`, e a W3 acrescentara 19); nenhuma regra alternativa
chega a 349 — URLs únicas 289, pares (rótulo, URL) únicos 348, linhas com link 372. Todo o resto da frase
confere: 18 seções `##`, 41 declarações literais, 13 em outra forma. **Só o número que a frase existia para
remediar estava errado**, e errado do mesmo modo que a emenda da moldura já pagou duas vezes: medido antes do
último conserto, publicado depois.

E o conserto reproduziu a armadilha em miniatura: esta própria revisão acrescentou 3 referências (Forman &
Scholz, Airola et al., Gebru et al.), levando a contagem de 410 para **413**, que é o valor publicado. Contar
antes de terminar de editar é o modo de falha, não um descuido de quem contou — é a razão de a contagem ir
para debaixo de teste em vez de para uma nota mais cuidadosa.

Duas coisas foram consertadas, não uma. A primeira é o valor. A segunda é a **regra**: "`[link]` seguido de
URL entre parênteses" parece exata e não é, porque `references.md` quebra a ~100 colunas e **38 rótulos de
link atravessam a quebra de linha** — `[O'Brien & Fleming,\n1977]` mais `(https://…)` na linha seguinte. Um
regex `\[rótulo\]\(url\)`
aplicado por linha devolve 372 e um aplicado ao arquivo inteiro devolve 410, e as duas são leituras honestas
da mesma frase. A regra registrada agora é a ocorrência da junta `](` seguida de URL, contada no arquivo
inteiro: a junta não pode atravessar quebra, porque uma quebra entre `]` e `(` deixa de ser link markdown.

E a contagem passou a ser **lida por teste nomeado** (`benchmark/tests/estado-counts.test.ts`), pela razão
que a própria frase do ESTADO dava para o envelhecimento — "nenhum teste os lê". É a mesma disciplina que o
`evaluatorDigest` já tinha: prosa não reconta. O teste também afirma a diferença entre as duas contagens,
com a fixture do rótulo quebrado, para que a próxima pessoa não "conserte" o contador de volta para 372.

### Duas correções de alegação que não mudam comportamento

`PartitionProbeNeedsAnAssembledCorpus` **saiu**: era classe de exceção com docstring de contrato ("*deriving
one here would produce a probe that passes over a partitioning no corpus has*") que nunca era levantada — o
caminho de pool levanta `CorpusIsNotStamped`, e é isso que `PoolAdapterTests` afirma. Exceção nomeada que
documenta uma recusa que nunca dispara é alegação em código de produção, e apagá-la não muda nada além de
tirar a alegação.

O **pino do laterio** pinava duas expressões e não o algoritmo: `test_the_tiling_mirrors_build_content_windows`
afirmava que `"plan.contentTokens - plan.overlapTokens"` e `"Math.min(start + plan.contentTokens,
totalTokenCount)"` ocorrem em `chunker.ts`, mas a **condição de parada** (`if (end === totalTokenCount)
break;`) não estava pinada de nenhum lado. Nem por substring, nem por valor: o caso `content + 1` termina
pela guarda do laço (`start < total`) com ou sem o break, então não é witness. O witness precisa de um total
em que uma janela termina exactamente E o próximo início ainda está dentro do documento — `2·step + 1`, ou
`13` com `content` 10 e `overlap` 4, onde sem o break aparece uma terceira janela `(2, 12, 13)` de um token
aninhada na segunda. Agora estão pinados os dois: a substring da parada e o valor.

### O que a bateria de mutação pegou

30 mutações, cinco passos cada, `sha256(diagnostic_probes.py) = 7f4a0a71…` e
`sha256(baseline_tfidf.py) = 893a0539…` idênticos nos dois extremos. **Três mutações passaram SILENCIOSAS
na primeira rodada** e as três viraram asserção:

1. redigir o VALOR da AUC da mensagem de recusa passava, porque o teste afirmava a palavra
   "one-vs-rest AUC" e não o número. Agora afirma AUC, p-valor, `n` e o piso, todos por valor;
2. trocar `floor(x + 0,5)` por `round(x)` passava, porque o caso pinado era `4 em 3` — cujo meio é 1,5, e o
   arredondamento bancário do Python manda 1,5 para 2 igual ao JavaScript. O witness verdadeiro é uma meia
   com piso PAR: 2,5 vai para 2 no Python e para 3 no JavaScript, e `6 em 3` cai exactamente lá;
3. transformar os limites inferiores das faixas em lista de arestas passava contra a fixture bimodal, onde
   as duas derivações concordam. A fixture que separa é a de comprimentos sobrepostos, com 10 faixas.

E **duas mutações eram vermelho FALSO**: registrar a medida de viés dentro do literal de
`STYLOMETRIC_FEATURES` dá `NameError`, porque o registro é definido ANTES de `spelling_error_rate` — o
vermelho vinha da importação e não da guarda. Refeitas como atribuição depois da definição, que é a forma
realista da mudança, a guarda dispara e `probe_stylometry` recusa **antes de qualquer ajuste**, nos dois
casos (por nome e por callable).

---

## As duas ratificações do operador de 2026-08-05: a barreira de `cal-B` e o ramo de B1

As duas foram dadas **depois** de o commit de docs da Fase 2 ter o contrato fixado, então viveram fora do
Git até esta entrada. Nenhuma das duas move uma linha de código: a primeira ratifica política já
implementada e medida como conforme, a segunda escolhe entre dois ramos de uma decisão que continua **sem
assinatura**.

### A barreira de `cal-B` — RATIFICADA

**Quem:** o operador, em 2026-08-05. **O que:** cluster exposto é barrado das **duas** partições cegas,
`test` e `cal-B`, e não só do `test`. A linha passa de `AG · ratificar` para `OP` no ESTADO § 3.3, e o item
sai da lista de abertas do § 4.

**Custo zero nesta release, e o custo é medido e não estimado.** O ledger de exposição real tem **0 bytes**
— nenhum evento foi escrito — e o corpus novo não reaproveita material do morto, porque `drop_seen` é
global (as ~1.600 linhas humanas recuperáveis são abdicadas de propósito). Não existe, hoje, cluster
exposto para barrar. A barreira já estava implementada e medida como **conforme** (C16): a ratificação não
muda uma linha de código nem um byte de artefato. Ela morde na **próxima** release.

**Por que a HORA importa, e a razão está no próprio módulo.** `BLIND_PARTITIONS` é política **de oferta**, e
está escrito no comentário imediatamente acima da constante, em `benchmark/cluster-exposure-ledger.ts`:
"*OFFER-TIME policy only. It decides what a request may claim now and never reinterprets events already on
disk: a record already recorded against `cal-B` keeps the meaning it had when it was written.*" Com o ledger vazio, a regra
ratificada agora se aplica **uniformemente a toda a história** do ledger. Ratificada depois do primeiro
evento, o mesmo arquivo append-only ficaria governado por **duas** regras, e dizer qual vale para qual
linha exigiria datar cada evento contra a data da política — arqueologia sobre o artefato que existe
justamente para dispensá-la. Fixar regra de cegueira **antes** de qualquer resultado é também o que § 3.4
exige: depois de ver resultados, ela proíbe.

**Alternativas recusadas.**

| alternativa | por que não |
|---|---|
| relaxar para só o `test` | mataria a opção conformal da v2, cuja população a pré-inscrição selada fixa em `cal-b-humans` (`conformal.population`, pinada por `literal()`). Uma `cal-B` que admite cluster exposto não é bloco cego, e a v2 teria de despinar política selada para usá-la |
| barrar das **cinco** partições | contradiz a graduação de § 3.4, que é imposta por código: exposição de nível de cluster **não** invalida material para `train`, `dev` e `cal-A`. Alargada a todas, a barreira fecha o corpus sem comprar cegueira em lugar nenhum — é desligamento e não controle, e o comentário de `BLIND_PARTITIONS` diz que a assimetria **é** o controle |

**Custo de reversão:** trivial no documento — uma célula de coluna e uma linha de lista — enquanto o ledger
está vazio; **alto depois do primeiro evento**, e é exatamente essa assimetria que torna barato ratificar
hoje.

**Referências obrigatórias:** `docs/references.md` § 2.2j (o **instante** da ratificação: regra de oferta
fixada com o ledger vazio, com Nosek et al. 2018 e Haber & Stornetta 1991, e "sem precedente" declarado para
o caso específico), § 2.1 (pré-registro das frações e dos gates), § 1.1 (cegueira informacional) e
§ "Integridade, custódia e falha fechada" (o encadeamento que torna a ordem dos eventos verificável).

### B1 — o RAMO escolhido: risco assumido por escrito

**Quem:** o operador, em 2026-08-05. **O que:** dos dois ramos de B1 — parecer jurídico da posição (a), ou
risco assumido por escrito — está escolhido o **segundo**. Isto **não é a assinatura**, e B1 **não sai** da
lista de abertas do ESTADO § 4: a assinatura, com nome, data e a razão de assumir em vez de consultar, é do
operador.

**A razão é de custo, não de mérito jurídico.** O ramo do parecer tinha **duas** dimensões de custo e o
plano precificava só uma: prazo de terceiro — a Fase 7 era a única fase cuja duração dependia de agenda
externa, e "prazo externo de B1" estava escrito no cabeçalho dela e na tabela de estimativa — **e**
desembolso acima do envelope de A6, que é R$60/mês e já é ocupado pelo Colab. O dinheiro não estava escrito
em lugar nenhum. O ramo do risco escrito não tem nenhuma das duas dimensões, e as duas menções ao prazo
externo saem do plano nesta entrada.

**O que a escolha NÃO resolve, e tem de ficar dito.** `license-review.json` continua `status: "pending"`,
com `reviewer` e `reviewedAt` em `null`. Os três esperam o **pacote da Fase 6**, e a razão é material:
`models/cleanfeed-ptbr-v1/` é o layout **antigo**, e D27 — bundles servidos declarando MIT como licença dos
**pesos** — só é consertado lá. Aprovar antes seria assinar um pacote com arquivos legais **sabidamente**
errados, o que é pior que não assinar. Duas dívidas de § 7 mudam de vencimento por causa disso, e nenhuma
delas é nova: a dos bundles servidos passa a vencer na Fase 6 com a assinatura pendurada nela, e a do
`non-commercial` sem licença que o imponha passa a vencer na **assinatura** em vez de no ramo.

**A minuta não entra no Git.** Existe uma minuta da declaração, redigida para o operador revisar, na área
de trabalho e fora do repositório. Ela entra em `docs/` **quando ele devolver o texto assinado**; a razão
de assumir em vez de consultar é dele e não é redigida aqui. Commitar minuta não assinada como se fosse a
declaração produziria exatamente o artefato que a posição (a) precisa não ter: uma alegação de risco aceito
que ninguém aceitou.

**Onde esta unidade divergiu do que lhe foi pedido, e por quê.** O roteiro mandava a nota do ramo entrar na
linha `F0-4` do ESTADO § 3.6; ela entrou como linha **`B1` própria, com `quem = OP`**. `F0-4` está marcada
`AG`, que o cabeçalho do ESTADO define como "agente, ratificável", e o ramo de B1 não é nenhuma das duas
coisas: não foi decidido pelo agente e não é reversível por ele. Pendurar a escolha do operador numa linha
`AG` publicaria autoria falsa e ofereceria ao operador ratificar o que ele mesmo decidiu, e R4 proíbe as
duas. `F0-4` ficou com a razão do `pending`, que **é** do agente. **Custo de reversão:** apagar a linha
`B1` de § 3.6 e mover a nota para `F0-4`.

### O que esta unidade NÃO fez, de propósito

- **não** mexeu em `license-review.json` — nem `status`, nem `reviewer`, nem `reviewedAt`;
- **não** redigiu a razão do operador, nem commitou a minuta;
- **não** tocou código de produção. Fora de `docs/` mudou um **comentário** em
  `benchmark/tests/estado-counts.test.ts`, que republicava em prosa os absolutos de § 5.6 já envelhecidos
  (dizia que o regex por linha devolve 372 contra 410, quando o medido é 377 contra 415) e agora expressa o
  mesmo fato pela relação — um a menos por rótulo quebrado —, que não envelhece. O arquivo **não** é membro
  de `EVALUATOR_FILES`, então o `evaluatorDigest` não se move: segue
  `18b8465f9071c35b8efa0cfc24f96d231229452715d5177b5b99ce3a06342ba6` sobre 52 arquivos, e a suíte confere
  isso lendo o valor publicado em § 5.6 contra a árvore viva;
- **não** consertou o byte NUL de `benchmark/near-duplicates.ts`: segue na fila com commit próprio, porque
  o conserto **move** o `evaluatorDigest`;
- **não** fechou a rodada 13 do cross-review do E2 — o crédito do codex volta em 8 de agosto, e rodada do
  Fable não fecha dívida de codex.

### O que a revisão adversarial pegou, e o que ela leu errado

Nenhum achado tocou política; todos eram documento descrevendo estado que o arquivo não tinha.

1. **§ 6 descrevia um arquivo que não existe.** A entrada nova do backbone afirmava que as duas seções
   retratadas do registro estão marcadas "no próprio cabeçalho"; só **uma** está. A do teto de 340 000 000
   tem o bloco `RETRATADO` imediatamente abaixo do cabeçalho; a que congelava `backbone` com valores de
   XLM-R o tem 31 linhas **dentro** da seção, junto do parágrafo que o afirmava — e retrata esse parágrafo,
   não a seção. A frase passou a dizer isso.
2. **A divergência contra o roteiro vivia fora do Git**, num relatório sob `.codex-reviews/`, que o
   `.gitignore` exclui. Está registrada acima, com razão e custo de reversão.
3. **`references.md` § 2.2j era subseção órfã**: nada apontava para ela, e a entrada que ela ancora não a
   citava. A linha de referências obrigatórias da ratificação de `cal-B` fecha a remissão nas duas direções,
   que é o que a regra do projeto pede.
4. **O par de § 5.6 estava escrito duas vezes com valores diferentes**, e o segundo lugar era o comentário
   da guarda que existe para impedir exatamente esse envelhecimento (acima, no item do comentário).

E um **terceiro** modo de falha da suíte, que § 7 não tinha: `calibration-profile-contract.test.ts` varre
`benchmark/` com `readdir(recursive: true)` e não trata erro, então a chamada morre como `ENOENT … scandir`
se um subdiretório desaparecer no meio da caminhada. Medido em árvore sintética **fora** do repositório
(4 000 subdiretórios, um removido durante a varredura): controle sem erro em árvore estável, e a primeira
tentativa com remoção concorrente devolveu `ENOENT: no such file or directory, scandir '…/d003998'`. Não é
timeout nem disputa por disco, que são os dois modos que § 7 já nomeava. **Quem** cria o diretório
transitório sob `benchmark/` não foi medido — nenhum arquivo rastreado escreve o path que a revisão
observou —, então a dívida nomeia o mecanismo e não a causa.

**Um achado foi refutado em parte.** A revisão leu "só a Fase 3 depende dela", em `F0-4`, como
circularidade contra o sequenciamento novo: a Fase 3 exigindo uma assinatura que só pode existir depois da
Fase 6. Não é. "Fase 3" ali é a numeração do plano **antigo**, em que a Fase 3 **era** a publicação dos
pesos, e a lista de ABERTAS diz isso com todas as letras ("B1, que bloqueia somente a Fase 3 (publicação de
pesos) — as Fases 0 a 2 correm sem ela"). No roteiro vigente a publicação é a Fase 7. Não há dependência
circular; há numeração envelhecida em três frases, e é ela que § 6 passa a indexar.

## As faixas de comprimento pré-inscritas e a geração casada (X1) — DECIDIDA PELO OPERADOR em 2026-08-06

**A razão, e ela é o coração desta unidade.** Texto curto provavelmente **lisonjeia** o FPR. Em 120 palavras
o modelo tem pouco sinal, hesita e dispara menos, então a taxa medida fica baixa por **incerteza** e não por
competência. Um usuário analisando 600 palavras recebe um modelo mais confiante, que dispara mais, com um FPR
que a medição nunca estimou. O número não seria falso; ele não **transferiria** — e essa é a forma mais
difícil de detectar de número enganoso. Publicar o FPR por faixa é o que torna visível o número que
transfere.

**A decisão do operador.** Coleta em **distribuição natural**, sem filtro de comprimento: a população fica
"lead sections da Wikipédia pt", natural e fácil de declarar. A manchete continua **um** teto sobre a célula
inteira (0,55 % a n=800). E publica-se o **FPR por faixa de comprimento como diagnóstico que não decide** —
a camada que o `gates.ts` já tem para "todo o resto vira diagnóstico publicado sem decidir".

**Alternativas recusadas, com a razão.** (i) Coletar **estratificado por faixa**: a população deixaria de ser
natural e viraria "sorteadas por faixa", e filtrar por comprimento enviesa para artigo grande, isto é, para
tópico majoritário. (ii) Subir o **piso de coleta para 150 palavras**: perderia metade da população, que é
uso real, e deixaria dois números para a mesma ideia — abstenção em 50 e coleta em 150.

### A medição que abriu isto (2026-08-06, dump `ptwiki-20220301`)

Espelhando as funções **reais** do lab (`lead_section`, `normalize_text`, `word_count`, `pii_hits`,
`MINIMUM_WORDS=50`, `MAXIMUM_WORDS=5000`) sobre 60.000 páginas do dump, e **reconferida por esta unidade**
antes de qualquer escrita:

| quantidade | valor |
|---|---:|
| páginas lidas | 60.000 |
| fora do namespace principal | 3.765 |
| redirects | 10.125 |
| artigos | 46.110 |
| lead curto (< 50 palavras) | 21.066 |
| lead longo (> 5.000) | 1 |
| derrubados por PII (4 email, 3 handle, 1 cnpj) | 7 |
| **admissíveis** | **25.036** — 54,3 % dos artigos |
| páginas a ler para 4.000 admissíveis | ~7.366 (o dump tem ~1,1 milhão de artigos) |

Distribuição de palavras dos admissíveis: **p10=56 · p25=72 · p50=120 · p75=221 · p90=362 · max=1.774**.
Só **40 %** têm ≥150 palavras e só **15 %** têm ≥300.

### Os cortes, e por que redondos e não percentis

As faixas pré-inscritas são **[50,79] · [80,149] · [150,299] · [300,+∞)**, e as contagens por faixa são
medidas, não interpoladas:

| faixa | admissíveis | fração | `n` esperado a n=800 | teto diagnóstico nesse `n` |
|---|---:|---:|---:|---:|
| [50,79] | 7.452 | 29,77 % | 238 | 1,82 % |
| [80,149] | 7.462 | 29,81 % | 239 | 1,82 % |
| [150,299] | 6.395 | 25,54 % | 204 | 2,13 % |
| [300,+∞) | 3.727 | 14,89 % | 119 | **3,62 %** |

Os `n` esperados somam exatamente **800** (as frações × 800 dão 238,12 / 238,44 / 204,35 / 119,09, e a
apropriação é por **maior resto**, que é o único ponto em que a aritmética escolhe: o resto de uma linha vai
para a maior parte fracionária, que é a de [80,149]). O parser confere a soma contra
`blindBlockLinesAtCollectionTarget` e cada teto contra `1 − α^(1/n)` da **própria** faixa.

**Cortes redondos, e a alternativa recusada.** Os percentis medidos dariam quartis quase equilibrados —
[50,71] n≈195 · [72,119] n≈203 · [120,220] n≈202 · [221,+∞) n≈200, teto ≈2,2 % em todas —, isto é, um pior
teto de 2,22 % contra 3,62 %. Recusado assim mesmo: **uma aresta derivada de percentil é função de UMA
amostra**. Sorteie outras 60.000 páginas e p25 sai de 72; a definição da faixa passaria a ser uma quantidade
medida e não uma decisão, ninguém conseguiria restatá-la ("de 72 a 119 palavras"), e o pré-registro deixaria
de ser independente do dado num nível acima. O preço de arestas redondas é a faixa longa ficar larga, e ele
é **declarado por faixa** em vez de diluído numa média: `expectedBlindBlockLines` e
`diagnosticCeilingAtExpectedLines` viajam com a faixa, e o relatório imprime as duas colunas ao lado do `n`
realizado. **Faixa larga declarada como larga.**

O corte **100** saiu de propósito. Era aresta dos buckets não registrados que estas faixas substituem, e
[80,99] tem 11,25 % da população: a n=800 seria uma faixa de **90** linhas com teto de **4,75 %** — pior
poder que a faixa mais larga da tabela nova.

### Por que as faixas tinham de ser pré-inscritas

Fatia diagnóstica escolhida **depois** de ver o resultado é post-hoc mesmo quando não gasta alpha: quem
escolhe o corte depois escolhe o corte que conta a história que quer. É a regra de § 5.7 do ICH E9 para
subgrupo, e ela não depende de o subgrupo consumir alpha. As faixas entram na pré-inscrição selada **agora**,
antes de qualquer medição, e isso é legítimo precisamente porque nada foi medido ainda.

### O que o código já tinha, e o que estava errado nele

A medição encontrou o oposto de uma lacuna: o benchmark **já** fatiava FPR por comprimento. `sizeBucket`
(`benchmark/metrics.ts`) cortava em `0_49 / 50_79 / 80_99 / 100_149 / 150_299 / 300_PLUS`, a fatia
`lengthBucket` está em `FPR_AXES` e produz gate diagnóstico por bucket. Dois defeitos, e o primeiro é
exatamente o que esta unidade existe para não cometer:

1. **as arestas eram constante em código** — isto é, um corte que alguém pode mover depois de ver o
   resultado, que é a definição de post-hoc;
2. **a primeira faixa começava em 0**, nomeando uma população que a medição **abstém**
   (`wordFloor.abstainBelow` é 50). A fatia era publicada com denominador sobre linhas cuja taxa não foi
   medida.

Por isso as faixas não entraram como vocabulário novo: `sizeBucket` passa a **derivar** da pré-inscrição e
devolve `undefined` abaixo do piso, então toda tabela chaveada por faixa deixa de nomear população não
medida. Um segundo vocabulário para a mesma ideia é exatamente o que a decisão do operador recusou em
"abstenção 50 e coleta 150", e valeria igual aqui.

`RUNTIME_BUCKET_CONSTITUENTS` (`benchmark/profile-artifact.ts`) mapeia as faixas nas **três** bandas de
runtime do bundle (`profileBands`, `50-79 / 80-199 / 200-plus`) e continua sendo o único lugar em que os dois
vocabulários se encontram — são tabelas com trabalhos diferentes: a faixa é sobre que população se publica
uma taxa, a banda de runtime é qual perfil o bundle carrega.

### A fiação, e a prova de que a faixa não move `m`

O bloco novo é `lengthBands` em `benchmark/preregistration-v4.{json,ts}`, com `role: "diagnostic"`,
`decides: false` e `spendsAlpha: false`. O parser recusa: primeira faixa fora do piso de abstenção (nas duas
direções), sobreposição, lacuna, faixa não-última sem limite superior, faixa última **com** limite superior,
soma das cotas diferente do bloco cego, teto que a própria cota não produz, chave renomeada ou reordenada, e
qualquer um dos três campos de papel alterado.

O inventário obrigatório de gates continua **4** com as faixas presentes e continua 4 quando uma faixa é
acrescentada: ele deriva de `multiplicity.primaryFamily`, e nenhuma faixa está lá. O teste nomeado constrói
os gates com uma fatia por faixa, confirma que cada um é `diagnostic` sem hipótese, acrescenta uma **quinta**
faixa e mede que `observed`, `gateIds`, `familyAlpha` e `declared` não se movem — enquanto o número de gates
**publicados** cresce em dois. Se acrescentar faixa movesse `m`, a fiação estaria errada.

O relatório publica `## FPR por faixa de comprimento (diagnóstico)` com uma linha por faixa
**pré-inscrita** — negativos humanos, decididos, falsos positivos, FPR, `n` esperado e teto naquele `n` —,
construída a partir da lista congelada e não dos dados, então **faixa vazia aparece como vazia** em vez de
desaparecer. Faixa sem linha decidida publica FPR `null`, nunca 0: zero de zero não é taxa, e publicá-la como
taxa transforma faixa não medida em faixa perfeita.

### A geração casada, e o item 3 do roteiro estava errado sobre o código

O roteiro pedia trocar uma **constante** de comprimento no prompt por sorteio da distribuição humana. O
código não tinha constante: `generate_ai.py` já pedia o comprimento da **própria semente humana** —
`target_words = max(60, min(int(row["wordCount"]), 350))`. O pareamento já existia, e é mais forte que
sortear da distribuição: pareando cada semente, a distribuição casa por construção e sobrevive a uma troca
do material humano sem um segundo lugar a atualizar. **O defeito era o clamp**, e só ele: seguindo a
distribuição medida, ~13 % das sementes ficam abaixo de 60 palavras e são infladas para 60, e ~11 % ficam
acima de 350 e são truncadas para 350. A classe gerada era a humana **truncada nas duas caudas**.

`target_word_count` passa a ser função nomeada, devolve o comprimento da semente sem clamp, e **recusa**
semente fora da janela do extrator (`SeedLengthOutOfWindow`) em vez de prendê-la na faixa — semente de 20 ou
de 9.000 palavras não saiu das regras que a medição descreve, e gerar contra ela põe na classe IA um
comprimento que a classe humana não tem.

**E aqui a medição refutou o instrumento óbvio.** Sobre a distribuição humana medida, o clamp deixa a **AUC
de comprimento em 0,504** — praticamente no acaso. Ele é **invisível** a uma AUC monótona porque prende a
cauda curta para cima e a longa para baixo, e as duas inversões de posto se cancelam. O que o clamp produz e
a AUC não vê:

| fixture | AUC de posto | primeira faixa (50-59) | máximo gerado |
|---|---:|---|---:|
| casado (comprimento da semente) | **0,5000** exato | `aiShare` 0,500 | 1.774 = humano |
| clamp `max(60, min(n, 350))` | 0,5040 | `aiShare` **0,000** — nenhuma linha gerada | **350** contra 1.774 |

Uma faixa de `aiShare` 0,0 é rótulo de graça: 50 a 59 palavras é **humano com certeza**, um sétimo do
fixture. **Consequência registrada, e ela corrige a leitura do roteiro:** o critério de reprovação da
geração é a **tabela de faixas da sonda e os extremos**, não a AUC dela. Isto reforça o item de § 6 do
ESTADO que já recusava ler "AUC no acaso" como "distribuições iguais" — agora com um mecanismo nomeado,
truncamento bilateral, e não só com a bimodalidade.

### Divergências desta unidade contra o que lhe foi pedido

1. **Item 3 do roteiro: "em vez de usar constante".** Refutado pelo código — não havia constante, havia
   clamp sobre a contagem da semente. O conserto é remover o clamp, não trocar o mecanismo por sorteio.
   **Custo de reversão:** nenhum; a mudança é uma linha e a função nomeada.
2. **A guarda "faixa não pode ser hipótese" NÃO ficou no parser.** `multiplicity.primaryFamily` é
   `frozenList` e as chaves das faixas também são congeladas, então nenhuma política admissível faz as duas
   colidirem: uma comparação ali seria ramo que nenhuma entrada alcança — a forma nº 1 de não morder, e o
   próprio `preregistration-v4.ts` já recusa esse padrão em dois lugares. A regra está imposta por **teste
   sobre os dois literais**, onde mexer em qualquer um dos dois fica vermelho. **Custo de reversão:**
   reintroduzir o laço em `lengthBands` e o parâmetro `primaryFamily`.
3. **`sizeBucket` mudou de vocabulário**, o que o roteiro não pediu: `0_49` saiu e `80_99`+`100_149`
   colapsaram em `80_149`. Sem isso o release publicaria **duas** tabelas de FPR por comprimento com cortes
   diferentes, que é a mesma objeção de "dois números para a mesma ideia" que derrubou o piso de 150.
   **Custo de reversão:** restaurar os seis buckets literais em `metrics.ts`, o mapa de
   `RUNTIME_BUCKET_CONSTITUENTS` e a tabela de pins em `metrics.test.ts`.
4. **`zeroEventCeiling`, `wordFloor.abstainBelow` e `primaryFamily` foram hasteados** para fora do literal
   da política, porque `lengthBands` ordena antes de `preRegistration` e de `wordFloor` e leria os três
   antes de validados. A ordem entre eles é deliberada: `primaryFamily` primeiro, para que a política de
   `m=7` continue sendo recusada em `multiplicity.primaryFamily` e não no teto derivado dela. **Custo de
   reversão:** devolver as três expressões ao literal.


### O que a revisão cruzada pegou em X1, e o que ela refutou (2026-08-06)

Duas rodadas adversariais sobre a implementação, seis achados bloqueantes entre elas. **Três eram um
mesmo defeito visto de dois lados, e ele é o achado desta unidade**: a mudança de vocabulário de
`sizeBucket` deixou a fixture do caminho de publicação órfã em `80_99`, e o bucket de runtime
`80-199` caiu de `actionCeiling: "hide"` para `"indicator"` no bundle publicado **sem um único teste
vermelho** — porque a única asserção de teto lia `profiles.profiles[0]` e `BUILD_ORDER` põe
`200-plus` primeiro. Medido nas duas árvores com a MESMA fixture: HEAD `daa154a` devolve
`200-plus → hide · 80-199 → hide · 50-79 → indicator`, a árvore da implementação devolvia
`80-199 → indicator`. O conserto tem três partes, e a terceira é a que impede a repetição:

1. a fixture passa a ler as chaves de faixa **da própria pré-inscrição**
   (`PREREGISTRATION_V4.lengthBands.bands[1].key`), não de literais que envelhecem em silêncio;
2. um teste nomeado assere o teto de **cada um dos três** buckets publicados, e não do primeiro;
3. `RUNTIME_BUCKET_CONSTITUENTS` deixa de ser mapa por confiança: `assertLengthBandsAreMapped`
   **recusa a publicação** (`LENGTH_BAND_UNMAPPED`) quando uma faixa pré-inscrita não está no mapa
   ou quando o relatório traz gate de ação de faixa que o mapa não conhece. O comentário afirmava
   que faixa fora do mapa "autoriza nada, que é a direção fail-closed"; **medido, era fail-OPEN** —
   o filtro descartava o gate da faixa desconhecida, então a reprovação dela não capava nada e
   `200-plus` seguia autorizando `hide`. **Custo de reversão:** remover a chamada em
   `buildModelPublication` e o mapa volta a ser confiança.

**O clamp de comprimento saiu de mais dois lugares, e um deles era do outro lado do transporte.**

- `codex_batch.py` continuava pedindo `max(60, min(wordCount, 300))`. Não é código morto: é a lane
  `codex`, a das famílias OpenAI reservadas ao teste de gerador não visto, e `generationLane` é eixo
  de agrupamento — com uma lane clampada e as outras não, o comprimento passa a ser **proxy da
  lane**. Agora as duas drivers pedem pela mesma função.
- `MAX_OUTPUT_TOKENS = 1024`, constante, na lane REST `gemini`. Um token cobre uma fração de palavra
  de prosa pt-BR (~1,4–1,7 tokens por palavra), então 1 024 tokens cortam por volta de 600–700
  palavras — contra p90 = 362 e máximo 1 774 da distribuição humana que esta mesma unidade mediu. E
  a truncagem entrava **em silêncio**: a única recusa do caminho REST era texto vazio, `finishReason`
  não era lido, e `common.py` só confere a janela [50, 5 000]. O orçamento passa a escalar com o alvo
  (`max_output_tokens`, 2,0 tokens por palavra mais margem fixa) e `finishReason` diferente de `STOP`
  **recusa o item**, exatamente como `GEMINI_INCOMPLETE` já fazia na lane CLI. **Custo de reversão:**
  devolver a constante e apagar a leitura de `finishReason`; o parâmetro `target_words` de
  `call_provider` volta a ser dispensável.

**A guarda de comprimento não mordia onde RODA, e isso estava certo.** Nenhum teste dirigia
`generate_ai.main()`: medido pela revisão, devolver o clamp **na linha de `main()`** deixava os seis
testes novos verdes, porque todos afirmavam sobre `target_word_count`. Agora `main()` é dirigido com
o transporte substituído (`GeneratedLengthReachesTheProviderTests`), e o teste confere, para cada
par, que o prompt que sai pediu o comprimento da **própria semente** e que o orçamento de saída é o
que o alvo implica. A regra é a que `test_backbone_policy.py` já escrevia: uma guarda só guarda onde
é chamada.

**Dois achados foram refutados com medição, e a refutação muda o comentário do código.**

1. **"O straddle `150_299` capa os dois buckets se reprovar."** Não hoje. Um gate de ação de fatia
   que reprova — inclusive o **inelegível**, cujo braço reprova de propósito — entra em
   `failedAction`, e `failedAction.length > 0` capa o release inteiro em `indicator-only`, onde todo
   bucket já é `indicator`. Logo, com `pass`, todo gate de ação presente passou, e o que a agregação
   decide por bucket é **presença de evidência**: bucket cujas faixas constituintes não produziram
   gate nenhum autoriza nada. A mutação "tirar `150_299` de `200-plus`" **sobrevive por construção
   da política**, não por teste fraco, e o comentário do mapa passa a dizer isso — a sobreposição
   fica como resposta conservadora se a regra de decisão deixar de capar globalmente.
2. **"O pin `reads its edges from the pre-registered bands` não prova a derivação."** Estava certo, e
   o conserto não é outro pin sobre a política vigente: contra UMA lista de faixas, uma implementação
   com arestas em literal responde igual a uma que as lê, e nenhuma asserção separa as duas. A
   derivação foi extraída em `lengthBandKeyOf(bands, wordCount)` e é exercitada contra uma lista de
   faixas **que não é a embarcada** ([50,89] · [90,+∞)), onde 89 é a palavra que separa ler as arestas
   de copiá-las. **Custo de reversão:** reinlinhar a função em `sizeBucket` e perder a única
   asserção que distingue as duas implementações.

**Três consequências que a revisão pediu para declarar, e elas ficam declaradas.**

- **O inventário do TIER DE AÇÃO encolheu**: aposentar `0_49` e fundir `80_99`+`100_149` remove três
  gates de ação de comprimento que podiam reprovar (`action.fpr.slice.lengthBucket.{0_49,80_99,100_149}`
  aparecem em `failedAction` no artefato medido em árvore). Não move decisão hoje — `common.py` recusa
  linha com menos de 50 palavras, então `0_49` não se materializa, e no alvo de coleta nenhuma faixa
  alcança o piso de 300 negativos, logo todo gate de ação de comprimento reprova nas duas versões.
  Fica declarado porque o custo de reversão registrado citava só `metrics.ts`, o mapa e os pins.
- **"Faixa de comprimento" nomeia QUATRO partições neste repositório**, e o registro dizia duas: as
  quatro pré-inscritas; os decis da sonda (`LENGTH_PROBE_DECILES`, renomeado nesta rodada justamente
  por isso, e derivados do dado porque a sonda não decide); as três bandas de perfil do runtime; e
  `lengthBucket` de `benchmark/split-audit.ts`, que corta em `short/medium/long` sob o **mesmo nome de
  eixo** dentro do próprio benchmark. Mais a grafia antiga (`80_99`, `100_149`) que sobrevive no
  caminho **embutido não calibrado** de `src/inference/calibration.ts`, declarado lá como "NOT the
  scientific calibration profile". Nenhuma das quatro é a outra, e § 3.1 do ESTADO passa a dizer isso.
- **A fração por faixa não é restatável a partir do repositório.** As frações que apropriam
  238/239/204/119 vêm de uma varredura de 60 000 páginas do dump por script que não está na árvore, e
  o dump tem 1,96 GB fora do repositório: commitar o medidor moveria a dívida de "sem medidor" para
  "medidor que nenhum checkout roda", que é a dívida que § 7 já carrega para as taxas de § 5.4. O que
  o parser confere é o que a política **impõe** — a soma contra `blindBlockLinesAtCollectionTarget` e
  cada teto contra `1 − α^(1/n)` da própria faixa —, nunca a fração. Fica em § 7 com esse nome.

**E uma correção de prosa que era uma alegação falsa:** a linha "máximo gerado 1 774, igual ao humano"
de § 5.7b do ESTADO é propriedade do **fixture** (que sintetiza o texto a partir do alvo), não do
gerador — o gerador não rodou. A coluna passa a se chamar pelo que é, **comprimento pedido**, e o que
o gerador entrega ganhou a guarda de truncagem acima.

## A dívida do byte NUL: o separador era SIGNIFICATIVO, e o defeito era a grafia (X2) — 2026-08-06

**O que o ESTADO registrava, e o que a medição achou.** A célula de uma linha do § 7 do ESTADO dizia "byte
NUL literal em arquivo de `EVALUATOR_FILES` (`near-duplicates.ts`)" e não dizia o que o byte fazia — mas o
**achado 12 desta mesma folha** (linhas 586-595) já dizia: nomeava o sítio (`` `${left}\x00${right}` ``, "num
separador de chave composta"), o offset **11.283**, o segundo arquivo com o offset dele, e a regra já escrita
em `benchmark/split-audit.ts`. Quem lê só o ESTADO não sabia; o registro sabia. Medido antes de qualquer
conserto, sobre `near-duplicates.ts` em `4fe8fdb` (sha256 `bb469c7c…`, 13.822 bytes): **um** byte 0x00, no
offset **11.283**, dentro de `` `${left}<0x00>${right}` `` — a chave que **deduplica os pares candidatos**
em `collectCandidatePairs`. Não é comentário e não é byte espúrio de arquivo: é **conteúdo de uma chave de
dedup**. E o arquivo já escrevia o **mesmo code point** como escape `\0` na chave de permutação de
`minHashSignature`, doze linhas acima — isto é, carregava **duas grafias do mesmo separador**, uma visível
e uma invisível.

**Logo o conserto não é apagar, e essa era a bifurcação da unidade.** O separador é o que torna a junção
**injetiva**: sem ele os ids `("a","bc")` e `("ab","c")` produzem a MESMA chave `abc`, o segundo par é
descartado por `pairs.has(pairKey)` como já visto, e um par de quase-duplicatas real **nunca chega à
confirmação por Jaccard** — os dois membros ficam livres para atravessar o corte
`train`/`dev`/`cal-A`/`cal-B`/`test`, que é exatamente o vazamento que o módulo existe para impedir.
Apagar o byte seria a regressão; escrevê-lo como escape é o conserto. Está medido, não argumentado: com o
separador removido, `candidatePairCount` cai de 2 para 1 no corpo de quatro linhas que a guarda usa.

**A grafia certa já existia no repositório, em outro membro da mesma lista.**
`benchmark/bootstrap.ts:328-335` declara a regra inteira — "They are written as ESCAPES and never as
literal bytes: a literal control byte makes this file 'binary' to grep and ripgrep, which then report a
match without ever showing the line" — e define `KEY_FIELD_SEPARATOR` e `KEY_PAIR_SEPARATOR` como escapes
de U+0000 e U+0001. `benchmark/split-audit.ts:423-425` escreve a mesma regra para U+001F ("Written as an
escape, never as a literal control byte"). `near-duplicates.ts` era o **único violador dentro de
`EVALUATOR_FILES`** — o outro byte cru da árvore, em `import-export.test.ts`, não é separador de chave e
está abaixo —, e por isso o conserto adota o **mesmo nome** e a mesma grafia nos dois sítios de chave do
módulo, em vez de inventar um terceiro vocabulário.

**O custo do byte cru, medido em 2026-08-06 e não estimado.** Duas ferramentas, dois efeitos:

- **a busca de código não via o arquivo.** ripgrep considera binário "if and only if it contains a `NUL`
  byte somewhere in its contents" e o modo padrão "is to attempt to remove binary files from a search
  completely". Medido: busca recursiva por `clusterNearDuplicates` sob `benchmark/` devolvia
  `corpus-import.ts` e `tests/near-duplicates.test.ts` e **omitia o módulo que define a função**; `git
  grep` pelo mesmo termo o listava. O módulo que decide o que é quase-duplicata estava invisível à busca
  de código do repositório;
- **`git diff` escapava por acidente de offset.** O heurístico do git olha os primeiros 8000 bytes.
  Medido primeiro com dois pares de arquivos idênticos exceto na posição do byte: no offset 3, `git diff`
  imprime "Binary files … differ" e **nenhuma linha**; no offset 20.003, diffa como texto. E depois medido
  **dentro deste próprio commit**, que carrega os dois casos e é o experimento natural: `git diff HEAD
  --stat` devolve `benchmark/near-duplicates.ts | 35 +++++++++++++++++++++++++------` (NUL no offset 11.283
  de 13.822, **fora** da janela) e `tests/unit/storage/import-export.test.ts | Bin 6119 -> 6124 bytes` (NUL
  no offset 5.071, **dentro** dela). Mesmo defeito, mesmo commit, e do segundo arquivo o diff **não mostra
  uma linha** —
  encurtar o cabeçalho de `near-duplicates.ts`, ou o byte subir, e toda mudança num membro de
  `EVALUATOR_FILES` passaria a ser invisível assim.

**A prova de que a semântica não mudou.** Os dois módulos — o de `4fe8fdb` e o consertado — foram
importados no MESMO processo e comparados sobre o mesmo corpo de entrada: 3 conjuntos de opções
(`NEAR_DUPLICATE_V1_OPTIONS`, `seed: 20260726`, `bands: 16`) × 2 ordens de entrada, mais 7 impressões
digitais, **13 saídas serializadas, 0 divergências**, digest `b2b1abf6…` nos dois lados. É a comparação
antes/depois que a unidade pediu, e ela é vacuosa por construção — o code point é o mesmo —, o que é
justamente por que o defeito sobreviveu a uma suíte de 2.805 testes.

**As três guardas, e a dívida existia porque não havia nenhuma.** Cada mutação mata um teste nomeado
diferente. Rodadas **por último**, sobre os bytes finais (base `near-duplicates.ts` sha256 `d65e3d32…`,
`import-export.test.ts` `a9de254a…`), e cada uma restaurada byte a byte com conferência de sha256:

| mutação | teste que fica vermelho | o que fica verde |
|---|---|---|
| separador removido da chave de par (`044c7069…`) | `keeps two candidate pairs whose ids concatenate to the same string` (expected 1 to be 2) e `reproduces the frozen v1 clustering byte for byte, cluster ids included` | os outros **seis** testes do módulo |
| escape reescrito como byte 0x00 cru (`f2273b7b…`) | `carry no raw control byte, so no code-search tool can skip an evaluator file` **e** `leaves no raw control byte in a tracked path the repo calls text`, os dois com `benchmark/near-duplicates.ts:255:30 carries 0x00 at byte offset 10446`; de tabela, `is published in the ESTADO at the value the LIVE tree hashes to` | **todo** teste de comportamento, os 8 do módulo inclusive |
| separador trocado de U+0000 para U+0001 (`e88b0238…`) | `reproduces the frozen MinHash signature, whose permutation key is joined the same way` | a chave de par e o agrupamento congelado, 7 de 8 |
| byte cru num arquivo **fora** de `EVALUATOR_FILES` (`import-export.test.ts`, `f3fe5c1e…`) | só `leaves no raw control byte in a tracked path the repo calls text`, com `tests/unit/storage/import-export.test.ts:167:26 carries 0x00 at byte offset 5071` | `digests.test.ts` **inteiro** |

A segunda linha é o achado: **nenhum teste de comportamento pode pegar a grafia**, porque o code point é o
mesmo. Uma dívida de byte invisível só é fechável por uma guarda que leia **bytes**, e as duas que existem
agora recusam controle C0 fora de LF, TAB e CR apontando `arquivo:linha:coluna` mais o offset. CR fica de
fora de propósito: o fim de linha é da disciplina de EOL da árvore, e falhar aqui por configuração de
checkout seria um defeito diferente usando o nome deste teste. A quarta linha é a que separa as duas
guardas: um infrator fora da lista fechada deixa `digests.test.ts` inteiramente verde, e é por isso que a
varredura da árvore não é redundância dela.

**Um segundo byte cru, fora da lista fechada — que o achado 12 já tinha nomeado.** O outro é
`tests/unit/storage/import-export.test.ts:167`, o `repeat(MAX_IMPORT_BYTES + 1)` que só precisa exceder o
teto de 5 MiB; a linha 588 desta folha já dava o caminho e o offset **5.071**, e a varredura de
`git ls-files` desta unidade confirmou que ele continuava lá. Reescrito como escape do MESMO code point —
string idêntica, zero mudança de comportamento. Não está em `EVALUATOR_FILES`, então não move o
`evaluatorDigest`.

**E a guarda passou a ser da árvore, não da lista.** Publicar "na árvore inteira também é zero" com uma
guarda que só varre 52 dos 574 arquivos rastreados seria republicar o defeito de origem: número medido uma
vez, que nada relê. `tests/unit/repo/line-endings.test.ts` — o arquivo que já lia a árvore real por
`git ls-files` e já parseava as extensões `binary` de `.gitattributes` — ganhou
`leaves no raw control byte in a tracked path the repo calls text`. A isenção é a extensão **declarada**
binária, nunca a classificação `i/-text` do próprio git: essa classificação é **causada** pelo byte
procurado, então filtrar por ela pularia exatamente o infrator.

E isso está medido, não deduzido — com um índice temporário (`GIT_INDEX_FILE` + `read-tree HEAD`, que não
toca o índice real), `git ls-files --eol` no HEAD devolve `i/-text` para **os dois** arquivos, e a medição
corrige de passagem uma frase que esta entrada dizia com o mecanismo errado: são **duas** classificações com
janelas diferentes. A do `diff` olha os primeiros 8000 bytes — é por ela que `near-duplicates.ts` diffava
como texto e `import-export.test.ts` saía como `Bin`. A da conversão/EOL não usa janela nenhuma: o NUL de
`near-duplicates.ts`, no offset 11.283 **de** 13.822, já bastava para `i/-text`. Consequência: os quatro
guardas de EOL, que filtram `i/-text` por linha de código, pularam **os dois** arquivos — o de 17 de julho
(`6dff262`) e o membro de `EVALUATOR_FILES` — e nenhum deles ficou vermelho por isso. Uma guarda que se
protege com a classificação que o defeito produz não protege nada. Nenhuma extensão declarada binária é
rastreada hoje, então a varredura cobre os 574 arquivos e o número deixa de precisar ser publicado como
memória.

**O `evaluatorDigest` moveu, e mover era o propósito do commit isolado:**
`71674ff2a11730f90adbf590613e991fdcfb3cee5bdb7b450b929573a0d79480` →
`46a51915db4d2c1188161d9c76e7b4bdfc1b60670fea65f0ed77c9e03061e895`, 52 arquivos, recomputado **por último**
sobre os bytes finais — inclusive depois de o comentário do separador ser reescrito pelo achado 1 da
revisão, que mexe em bytes de um membro da lista e por isso move o digest outra vez. Barato hoje: `issuedAt`
é nulo, 0 tags de release, nenhum `fit` selado.

**Custo de reversão.** Devolver o byte cru é uma substituição de um code point em `near-duplicates.ts`, mais
apagar as **duas** guardas de bytes (`digests.test.ts` e `line-endings.test.ts`) e republicar o digest
antigo — os três testes de comportamento desta unidade ficariam verdes com o byte cru no lugar do escape, e
é essa exata insensibilidade que justifica guarda que lê bytes. Reverter a **injetividade** (voltar a
`${left}${right}`) custa dois testes nomeados, e é o que não deve ser revertido.

### O que a revisão pegou, e o que mudou por causa dela

A revisão cruzada devolveu `pass` com cinco achados menores. Os cinco foram aplicados; um foi aplicado por
outro mecanismo que o sugerido, e está nas divergências abaixo.

1. **A razão escrita no código de produção era refutada pelo alfabeto medido do próprio repositório.** O
   comentário do separador afirmava que "a record id and a shingle may both contain any printable
   character". As duas metades são falsas contra o código: `benchmark/schema.ts:298` define
   `PSEUDONYM = /^[A-Za-z0-9_-]+$/` e recusa todo id que não case, e `normalizeTokens` + `shingleSet` fazem
   de um shingle apenas tokens de letra/número unidos por **um** espaço. A frase tinha vindo de
   `bootstrap.ts`, onde é verdadeira (nome de eixo e id de grupo são livres) — e `references.md`, no mesmo
   commit, já escrevia a versão medida. Ou seja: o commit publicava **duas justificativas incompatíveis** e
   a falsa era a que vivia no código. Consertado com o que está medido, mais a restrição que de fato
   congela U+0000 e que o comentário não dizia: o separador está **dentro da chave de permutação**, logo
   dentro de toda assinatura já gravada no cluster-exposure ledger, que tem de comparar igual anos depois.
   E o comentário passa a dizer que o módulo **não valida** id nenhum — `NearDuplicateInput` aceita
   qualquer `{ id, text }` —, então o alfabeto do esquema é do chamador e não daqui.
2. **A mensagem da guarda emitia `caminho:offsetDeByte` na convenção universal `caminho:linha`.** Um
   `near-duplicates.ts:9940` — offset de byte num arquivo que tinha 385 linhas — manda o editor, o anotador
   de CI e o humano para lugar nenhum. Agora emite `caminho:linha:coluna` e mantém o offset exato
   **rotulado** no fim da mensagem, porque a coluna conta bytes e só coincide com caractere em linha ASCII.
   Medido nas mutações: `benchmark/near-duplicates.ts:255:30 carries 0x00 at byte offset 10446` e
   `tests/unit/storage/import-export.test.ts:167:26 carries 0x00 at byte offset 5071`.
3. **O comentário lia como exaustivo sobre "the composite keys below" e o módulo tem três chaves
   compostas.** A terceira é o balde de banda LSH, que junta por `:` e não usa a constante. Não é defeito
   de corretude — decimal e hexadecimal não contêm `:` e a aridade por banda é fixa —, mas era uma segunda
   convenção indocumentada sob um comentário que se apresentava como a regra. O comentário passou a nomear
   as duas chaves de id/shingle, e o balde de banda ganhou a linha que diz por que `:` basta ali.
4. **Quatro frases desta entrada afirmavam como fato o que esta mesma folha refuta 4.850 linhas acima.**
   Corrigidas: a dívida cega era a célula do § 7 do ESTADO e **não** o registro (o achado 12 já tinha
   sítio, offset e o segundo arquivo); "único violador" passou a "único violador dentro de
   `EVALUATOR_FILES`"; `split-audit.ts:423-425` entrou junto de `bootstrap.ts` como quem já tinha escrito a
   regra; e o histograma do `--stat`, citado com quatro barras de cada lado, passou a ser o real.
5. **O ESTADO publicava um número medido que nenhum teste relê** (574 arquivos rastreados), três linhas
   acima da linha que registra a lição de que número não lido envelhece em silêncio. Aplicado por outro
   mecanismo — veja a divergência 4.

### Divergências desta unidade contra o que lhe foi pedido

1. **Não ficou um literal solto no sítio do byte cru: ficou a constante nomeada `KEY_FIELD_SEPARATOR`, e o
   segundo sítio de chave do módulo mudou junto.** O pedido admitia o escape ou `String.fromCharCode(0)`
   no sítio do byte. A constante põe a restrição técnica em **um** lugar e alinha o módulo com
   `bootstrap.ts`, que já tinha a mesma constante com o mesmo nome; deixar `\0` no sítio da permutação
   manteria duas grafias do mesmo separador no mesmo arquivo, que é metade do defeito original. A saída é
   byte-idêntica nos dois sítios, provado pelo A/B acima. **Custo de reversão:** reinlinhar o literal nos
   dois sítios e apagar oito linhas de comentário.
2. **Um arquivo fora de `EVALUATOR_FILES` foi tocado** (`tests/unit/storage/import-export.test.ts`), o que
   a unidade não pediu. A razão é que o ESTADO passa a publicar "na árvore inteira também é zero", e
   publicar isso com um byte cru na árvore seria a alegação falsa que N7 existe para impedir. **Custo de
   reversão:** uma substituição de code point; não move digest nenhum.
3. **A guarda de bytes ficou em `digests.test.ts`, que § 7 já registra como sensível a contenção de
   I/O.** A alternativa era pô-la num arquivo barato, mas o inventário que ela varre é declarado ali e é
   ali que um revisor procura. Medido: o arquivo roda em ~3 s isolado com a guarda dentro, e a varredura
   acrescenta **uma** passada de leitura sobre 52 arquivos, contra as dezenas de árvores temporárias de 52
   arquivos que os outros testes do mesmo arquivo escrevem. **Custo de reversão:** mover o `describe` para
   `near-duplicates.test.ts` e perder a cobertura dos outros 51 membros.
4. **O achado 5 da revisão foi aplicado pelo mecanismo oposto ao sugerido, e isso fecha uma dívida do § 7
   que tinha outro dono.** A sugestão era pinar **574** num teste, como `estado-counts.test.ts` faz com as
   contagens de `references.md`. Recusada: uma asserção sobre a contagem de arquivos rastreados fica
   vermelha em **todo** commit que acrescenta arquivo, cobra o pedágio de cada unidade seguinte e treina
   quem passa por ali a atualizar o número sem reler o que ele afirma — que é o modo de falha da própria
   lição. O que a linha do ESTADO afirma de útil não é o 574: é o **zero**. Então a varredura passou a ser
   da árvore (`tests/unit/repo/line-endings.test.ts`), o escopo passa a ser derivado de `git ls-files` a
   cada rodada, e o número saiu da prosa. Efeito colateral que a unidade não pediu: a linha "a guarda cobre
   os 52 e não a árvore" sai do § 7, cujo dono era "unidade que precisar da varredura fora da lista
   fechada". Medido: a varredura custa **441 ms** e lê 574 arquivos / 9.265.278 bytes numa passada, num
   arquivo cujos vizinhos já custam 1.544 ms e 1.374 ms em chamadas a `git check-attr`. **Custo de
   reversão:** apagar um `describe` de 35 linhas e devolver a linha ao § 7.

## Fase 3, item 1 — o inventário de material e a extração da célula (2026-08-06)

O consumidor do cruzamento `groups.sourceMaterialBatch` → inventário existia desde o Commit A da Fase 1.
O **produtor** não. Esta unidade o escreve, roda a extração da célula pelo runbook e mede o número que
nenhuma unidade anterior havia medido: a perda que a poda global contra o corpus morto cobra da coleta.

### As três medições que valem

**1. A perda pela poda global é 0,049 %, e a leitura que importa não é ela.** As 4.100 linhas frescas do
pool são teladas por `near_dupes.drop_seen_against` contra o artefato do corpus morto (10.000 documentos,
3.323.576 chaves de shingle, `sha256` do corpus indexado conferido no cabeçalho — nenhum token do
material cego é lido). Resultado: **2** linhas derrubadas, **0** por hash exato de conteúdo tokenizado e
**2** por Jaccard ≥ 0,82. O plano limitava a perda por cima sem medi-la, raciocinando que a fatia de
Wikipédia das ~1.600 linhas humanas do corpus morto é pequena contra uma piscina de ~1,1 milhão de
artigos; o limite estava certo. **O que a medição acrescenta é o `highest_similarity_kept`: 0,81.** Uma
linha fica um centésimo abaixo da barra de recusa. É o comportamento esperado de reextrair a mesma fonte
— a mesma página noutra revisão volta com edições pequenas —, e é exatamente o caso que o runbook manda
investigar antes de selar. Não é folga: é a barra decidindo no limite, e é a razão de a coleta pedir
4.100 para uma cota de 4.000. Sobre a união que o montador real tela (4.613 candidatos, incluindo 514
humanas do pool reservado) os números são 6 derrubadas, 0 por hash exato, maior mantida 0,81.

**2. A célula tem 4.000 unidades independentes, não 1.** O § 5.6 do ESTADO publicava **1** componente
por célula, porque o pool de 24/07 não carregava `groupAxes` e toda linha caía no balde único de origem
irrecuperável. A extração nova emite `groups.source = ptwiki_page_<page_id>`, e o corpo estampado de
4.000 linhas tem **4.000 componentes conexos, todos de tamanho 1** — o piso pré-inscrito de 300
`samplingUnits` fica 13,3× folgado, `assert_cells_can_meet_the_origin_document_floor` passa com 4.097
documentos de origem distintos **no pool**, `preflight-viability` passa nos dois escopos com a declaração
de que passar é necessário e não suficiente, e `auditCorpusSources` devolve `status=ready` com **zero**
motivos de bloqueio. A dívida do inventário de material fecha aqui, e fecha medida.

As duas contagens de documento de origem são de objetos diferentes e não devem ser somadas nem
confundidas: **4.097** é do POOL, na barreira que antecede a seleção, e conta só origem `known` (as 4.100
frescas menos as 3 que as duas podas tiraram, com as 510 reservadas sobreviventes fora da conta porque não
nomeiam origem); **4.000** é do CORPO, uma linha por documento, que é o teto pré-inscrito de
`maximumLinesPerOriginDocument` realizado com igualdade. Ler a barreira como resultado é a mesma classe de
erro que deixou "1 unidade por célula" viver por semanas.

**3. As frações por faixa que a pré-inscrição congelou estão erradas, e a faixa larga é a que dói.** Os
valores `expectedBlindBlockLines` 238/239/204/119 vieram de uma varredura das primeiras **60.000
páginas** do dump. A extração real — amostragem determinística de 1 em 40 sobre **394.414** artigos —
realiza **271/269/192/68**, e a faixa `[300,+∞)` cai de 14,89 % para **8,53 %** da população: o teto
diagnóstico dela passa de **3,62 %** para **6,24 %**. A causa é medida e tem nome: um dump do MediaWiki é
ordenado por `page_id`, que é ordem de criação, e artigo antigo é artigo maduro com lede longa — um
prefixo é amostra de conveniência correlacionada com a própria variável medida (referências § 4.2b-bis).
A admissão cai de 54,3 % para 41,3 %, a mediana de 120 para 106 palavras, e o máximo sobe de 1.774 para
2.256.

O parser da pré-inscrição confere a **soma** das quatro parcelas contra
`blindBlockLinesAtCollectionTarget` e cada teto contra `1 − α^(1/n)` do próprio `n`, e **nunca** a
fração. Os quatro valores congelados são portanto internamente consistentes e externamente errados, e
nenhum gate os pega. A consequência concreta é da Fase 6: o model card imprimiria 3,62 % para uma faixa
que a população realiza com 68 linhas.

**Por que esta unidade não corrigiu a política.** Corrigir `preregistration-v4.json` move
`evaluatorDigest` (a política está em `EVALUATOR_FILES`), o que obriga as duas lentes seguintes a
reverificar o digest de uma unidade cujo escopo era outro, e é emenda de pré-inscrição — legítima aqui,
porque o que se viu é a **estrutura da população** e não resultado (ESTADO § 3.4), mas de outro dono. A
faixa é diagnóstica: `role: "diagnostic"`, `decides: false`, `spendsAlpha: false`, e `m` continua 4. Então
a decisão é medir, publicar a divergência com a causa e registrar o dono — a unidade que emendar a
pré-inscrição, **antes** da Fase 6. **Custo de reversão da escolha:** nenhum; corrigir a política depois
é o mesmo trabalho que corrigi-la agora, mais o digest.

### O produtor do inventário, e por que ele recusa antes de escrever

`benchmark/lab/build_governance.ts` escrevia `schemaVersion: 1` em dois lugares e não emitia
`materialBatches`. Agora escreve **v2** e nada mais, com o lote declarado em
`DECLARED_MATERIAL_BATCHES`:

| campo | valor | como foi obtido |
|---|---|---|
| `batchId` | `smb_ptwiki-20220301` | **rodando** `group_axes.material_batch_id("ptwiki-20220301")` |
| `sourceId` | `src_wikipedia_pt` | `extract_wikipedia.SOURCE_ID`, declarado no manifesto |
| `materialVersion` | `ptwiki-20220301` | o nome do arquivo em disco |
| `acquisitionWindow` | `startedAt = endedAt = 1784753446707` | **ratificado pelo operador em 2026-08-04**; reconferido contra o `mtime` do arquivo |
| `evidence` | sha256 `70c9ec4f…`, 1.955.910.144 bytes, a URL do diretório do dump | **recomputados** sobre `snapshots/ptwiki-20220301-pages-articles.xml.bz2` |

A declaração vive no **writer**, em código versionado, e não em `governance-inputs.json` nem num JSON de
`benchmark/data/`. As duas alternativas seriam forjáveis pelo próprio passo que consome o inventário, e o
`sourceManifestDigest` cobriria a forja — que é o oposto do que a cobertura por digest existe para dar.
Três dos cinco campos são fatos de um download que nenhum código deste repositório observou; sintetizá-los
seria a proveniência inventada que R4 proíbe.

Duas recusas, e as duas disparam **antes do primeiro byte escrito** (`writeGovernance` valida e só depois
faz `mkdir`):

- `MATERIAL_BATCHES_EMPTY` — inventário vazio. É estado que o esquema **expressa**: o manifesto seria
  válido, com digest correto, e faria `auditCorpusSources` bloquear **toda** linha humana com
  `SOURCE_REFERENCE_MISSING`. O operador receberia 4.000 recusas idênticas em vez de uma frase sobre o
  inventário, e o arquivo escrito pareceria revisado. **Sem precedente encontrado** para a direção
  (referências § 2.2h-ter): a literatura descreve o que documentar e como cobrir a declaração por digest,
  não fail-closed no escritor;
- `MATERIAL_BATCH_SOURCE_UNDECLARED` — lote cuja `sourceId` o manifesto não declara, nomeando o lote, a
  fonte e as fontes que existem. É a forma real da falha: as `sources` do manifesto são **projetadas dos
  registros**, então um corpus sem linha humana projeta nenhuma fonte e o lote ptwiki resolve contra nada.

A lista de lotes chega a `reviewedSourceManifestBodyOf` **por parâmetro** e não é lida direto da
constante. Não é conveniência de teste: contra UMA lista embarcada, um writer que salta as duas checagens
responde igual a um que as roda, e só a exercitação contra uma lista que não é a embarcada separa os dois
— a mesma razão pela qual `lengthBandKeyOf` recebe as faixas por parâmetro.

**O lote da Carolina não deixou vestígio no código.** Procurado por nome (`smb_carolina*`,
`carolina-2_0-bea`): as únicas ocorrências são o `--snapshot-version carolina-v2.0` de
`extract_carolina.py` — o extrator que `CarolinaOutOfFrame` recusa antes de abrir o arquivo — e fixtures.
Não havia inventário declarado para remover. Fica registrada uma discordância de grafia entre documentos:
o ESTADO § 5.1 chama o lote de `smb_carolina-2_0-bea` e o extrator derivaria `smb_carolina-v2_0` de
`carolina-v2.0`. Custo zero — a fonte está fora da moldura — e o nome correto é o que o extrator deriva.

### O que a montagem de release faz, e por que a recusa é o gate funcionando

`assemble_corpus.py --candidates-dir ../data/candidates-f3` roda até a governança e para em
**`HeldOutReserveEmpty`**: nenhuma família pode ser declarada held-out e o manifesto selado recusa lista
vazia. **A causa sobre este pool é que `candidates-f3` não tem classe gerada nenhuma** — `load_ai` e
`load_mixed` devolvem 0, e a mesma corrida avisa que a mista está 2.000 linhas abaixo da cota. Sobre o
pool de 24/07 a recusa é a mesma com outra causa: lá existem geradas e é a poda global que não deixa
nenhuma sobreviver; e sem a poda global a montagem constrói 1.170 geradas e o gate antiartefato manda a
lane `gemini-api` para regeneração (ESTADO § 5.4). Três saídas, três recusas, todas corretas: a classe
gerada é o **item 2** da Fase 3.

Antes de parar, a corrida real mede o que interessa a este item: 4.097 documentos de origem distintos no
POOL — a contagem que a barreira do piso de poder lê, não a do corpo estampado, que é 4.000 com uma linha
por documento —, o piso de documentos de origem **passando**, e `tag_hard_negatives` etiquetando 20 linhas em cada
uma das **seis** famílias — o que fecha a dívida "três das seis famílias hard-negative são de texto curto
informal e podem não encher". Não era escassez. Fica no lugar dela a alegação que a etiqueta **não** faz:
`hardNegativeFamily` é atribuída por pertença de célula, não por leitura de estilo, e ler estilo é ato de
revisão humana que a v1 não faz (R4).

Para dar à auditoria e ao preflight um corpo estampado, a classe humana foi montada por um **arnês** que
chama as mesmas funções do montador na mesma ordem (`load_humans`, `prune`, `drop_seen_against`,
`assert_cells_can_meet_the_origin_document_floor`, `balanced_humans`, `human_record`,
`tag_hard_negatives`, `assign_partitions`, `assert_stamped_corpus_is_splittable`). O arnês não está na
árvore, e é a mesma dívida de material das taxas de § 5.4 e § 5.7: os pools são gitignored.

### Uma descoberta de ordem no runbook

`preflight-viability` lê `records.jsonl` por `parseBenchmarkDataset`, que **exige**
`normalizedTextSha256`; `assemble_corpus` omite o campo de propósito, porque o `ingest` o recomputa e
preenche. Então o preflight só corre sobre o diretório **ingerido** — que é onde o runbook o coloca, entre
os passos 2 e 3 —, e nunca sobre a saída crua do montador. Nesta unidade o campo foi **escrito** por um
script de fora da árvore chamando a função de produção `corpusContentDigest`, que é a mesma que o `ingest`
recomputa; o `ingest` não rodou, porque `sealDataset` compara a composição por igualdade exata e a classe
gerada não existe. Conferir depois os 4.000 valores contra essa mesma função **não** é medição de digest
correto — é a função respondendo sobre o que ela própria escreveu —, e por isso a linha saiu do ESTADO.

### Divergências desta unidade contra o que lhe foi pedido

1. **A extração pediu 4.100 linhas e não 4.000.** O alvo pré-inscrito de coleta é 4.000 e continua sendo;
   4.100 é o **pool**, e a cota trunca em 4.000 (`balanced_humans`). A razão é **medida, e o contrafactual
   também**: são **três** as linhas frescas que as podas derrubam — posição **245** pela poda intra-pool,
   **369** e **1.084** pela poda global, em contagem 1-indexada —, e as três estão dentro das primeiras
   4.000. A amostragem é determinística sobre a chave da página e a leitura do dump é sequencial, então as
   primeiras 4.000 linhas do pool são exatamente o que `--limit 4000` teria escrito — uma extração de 4.000
   exatas entregaria **3.997**, e a composição de release, que `sealDataset` compara por igualdade
   **exata**, ficaria **três** linhas curta. E isso é execução, não aritmética sobre a taxa de perda: o
   pipeline completo (`dedup` → `prune` → `drop_seen_against`) foi rodado nos dois cenários e devolve 4.097
   frescas sobre as 4.100 e 3.997 sobre as primeiras 4.000. **Custo de reversão:** rodar a extração de novo
   com `--limit 4000` e aceitar um corpus que não sela.
2. **Não usei `--exclude`.** A extração de 24/07 passava `_exclude_ids.txt` para ser disjunta por ID do
   que já havia sido usado. Aqui isso destruiria a própria medição pedida: excluir por id as linhas que a
   poda global pegaria faz a perda medida ser zero por construção. A poda global é a tela declarada, e
   medi-la exige que ela tenha o que pegar. **Custo de reversão:** um flag.
3. **A dívida "o lado selado não confere licença registro↔fonte" tinha esta unidade como dono e foi
   re-datada em vez de fechada.** Medido: `source_licenses` projeta a `licenseId` da entrada A PARTIR dos
   registros e recusa fonte com duas licenças (`SourceCarriesTwoLicenses`), então o desacordo
   registro↔fonte não é construtível pelo produtor que existe. O dono passa a ser o segundo produtor de
   corpus, que é quem o constrói. **Custo de reversão:** nenhum código foi tocado.
4. **Dois dos cinco testes que a unidade pedia já existiam, e foram conferidos em vez de duplicados.**
   O cruzamento registro↔inventário nas duas direções, nomeando o `recordId`, está em
   `benchmark/tests/corpus-source-audit.test.ts` ("passes a row whose batch the inventory declares…" e
   "blocks a row whose batch the inventory does not declare"), com dois casos a mais que a unidade não
   pediu (lote de geração no eixo de material; lote declarado para outra fonte). A limpeza do artefato de
   vistos está em `benchmark/lab/test_near_dupes.py::SeenIndexArtifactTests::test_the_artifact_carries_no_clear_text`,
   que afirma sobre os BYTES do arquivo. Acrescentar um terceiro par diria a mesma coisa em outro arquivo.
   Além dos testes, o artefato **real** em disco foi varrido: 10.000 linhas, zero fora da forma fechada
   (campo do conjunto declarado, digest em hex de 64, blob base64 de chaves inteiras de 8 bytes).
5. **A extração já recusava rodar sem `--snapshot-version`, e o que faltava era a recusa da linha de
   comando.** `required=True` estava lá e `extract()` recusa por `material_batch_id("")`; o teste que
   existia exercita a FUNÇÃO, e com `required=True` removido ele fica verde enquanto a corrida passa a
   morrer num `AttributeError` sobre `None`. O teste novo dirige o script como subprocesso, pela mesma
   razão registrada no teste gêmeo da Carolina.

### A releitura da unidade, depois da queda de rede (2026-08-06)

A unidade caiu por rede (ENOTFOUND) depois da Parte A e foi retomada. O inventário que a retomada recebeu
dizia que a extração nunca havia rodado; o **disco dizia o contrário** — `benchmark/data/candidates-f3/` e
`benchmark/data/corpus-build-f3/` existiam, com as Partes B e C já executadas e os documentos já escritos.
Vale a regra da precedência: código e artefato medidos vencem o inventário. Cada número que estes
documentos publicam para a Fase 3, item 1 foi **re-executado** nesta releitura, pelas funções de produção
chamadas direto sobre os artefatos em disco, e a montagem real foi re-rodada até a recusa.

**Reproduziu exatamente, sem uma casa de diferença:** a extração (394.414 varridos, 231.441 fora da
janela, 39 por PII, 4.100 escritos); a poda global (4.100 teladas, 0 por hash exato, 2 por Jaccard, maior
mantida 0,81, 25.151 pares, 174 buckets); a união do montador real (4.614 pós-dedup, 4.613, 6 derrubadas);
os quantis do corpo (56 / 70 / 106 / 176 / 282 pela convenção `w[⌊q·n⌋]`, máximo 2.256); as quatro faixas por `lengthBandKeyOf`
(1.355 / 1.347 / 957 / 341, e 271 / 269 / 192 / 68 a n=800, tetos 1,60 / 1,62 / 2,26 / 6,24 %); o
`[80,99]` (519 linhas, n=104, teto 4,13 %); os 4.000 componentes de tamanho 1; os 20 × 6 hard-negatives;
`auditCorpusSources` em `ready` com 0 motivos; `preflight-viability` passando nos dois escopos; o
`sourceManifestDigest` `dfcd17cd…` recomputado pela função de produção; a recusa `HeldOutReserveEmpty`; e
as três evidências do lote declarado, recomputadas sobre o arquivo de 1,96 GB (1.955.910.144 bytes, sha256
`70c9ec4f…`, mtime 1784753446707). Acrescentou uma medição que faltava: o artefato de vistos **real**
(36.425.322 bytes) tem 10.000 linhas com zero desvio da forma fechada.

**Três correções, e as três são da mesma família — número certo, objeto errado:**

1. **Os 4.097 documentos de origem estavam publicados como propriedade do CORPO ESTAMPADO**, dentro da
   tabela que descreve o corpo. São do POOL, na barreira que antecede a seleção. Medido: o corpo de 4.000
   linhas tem **4.000** documentos de origem distintos, com no máximo **1** linha por documento — o teto de
   `maximumLinesPerOriginDocument` realizado com igualdade. Não era erro de aritmética (4.097 está certo
   para o que `origin_documents_per_cell` conta, que é só origem `known` sobre as 4.607 sobreviventes), e é
   por isso que nenhum teste o pegaria.
2. **A causa da recusa `HeldOutReserveEmpty` estava atribuída à poda global.** Medido sobre
   `candidates-f3`: `load_ai` e `load_mixed` devolvem **0** — não existe classe gerada para a poda
   derrubar, e a mesma corrida avisa que a mista está 2.000 linhas abaixo da cota. A causa "a poda global
   não deixa nenhuma gerada sobreviver" é verdadeira, mas do pool de 24/07. Duas recusas com a mesma
   exceção e causas diferentes, e só uma delas é desta corrida.
3. **A decomposição da união dizia "4.100 frescas mais 514 reservadas".** Medido: `load_humans` devolve
   **4.680** (4.100 + **580**), e a dedup exata derruba **66**, todas reservadas — o corpus morto de que o
   pool reservado vem foi construído da mesma Wikipédia, a linha fresca entra primeiro e a cópia reservada
   sai. O 514 é pós-dedup e estava certo; o que faltava era dizer de onde os 66 saem.

**Uma fronteira que o parcial cruzou, registrada em vez de escondida.** O arnês da corrida de 2026-08-06
foi até `assign_partitions`, então o corpo em disco carregava o `BLOCK_TIME` de cada partição em
`createdAt`/`provenance.collectedAt`, e esta unidade tinha por limite "não congelar o split nem criar
`test`/`cal-B`". A releitura publicou isso como "carimbo de timestamp, não partição" — leitura que a
revisão cruzada **refutou pelo código**, e o fechamento da unidade corrigiu. Ver a seção do fechamento.

**Números da árvore que a releitura moveu, porque a suíte mediu diferente do que o ESTADO dizia:** a
releitura mediu **171 arquivos / 2.815 testes** (vitest) e **431 testes + 84 subtests** (pytest), com o
avaliador em **1.875** (1.444 em 45 arquivos de `benchmark/tests`, 431 no lab) — o fechamento acrescentou
um teste de subprocesso e os vigentes estão no ESTADO § 1. E o **lint caiu de 13 para 12
problemas**: os 10 erros que ficam estão **todos** sob `.cache/chrome-for-testing/`, um Chrome baixado que
`.gitignore` cobre e nenhum commit carrega. A releitura atribuiu a queda ao cache; **a revisão cruzada
refutou a atribuição** e ela está corrigida no fechamento.

### O fechamento da unidade: o que as duas lentes pegaram, e as duas leituras que o código refutou (2026-08-06)

Duas revisões adversariais leram o parcial inteiro — uma contra o contrato da unidade, uma contra os
invioláveis. Nenhuma das duas foi refutada; as duas encontraram a mesma família de defeito que esta sessão
já pagou três vezes, **valor copiado onde o contrato manda medir**, e desta vez em prosa em vez de em
número: as contagens estavam certas e as **causas** eram sintetizadas.

**1. A causa da queda do lint estava inventada, e a refutação já estava no mesmo documento.** A releitura
publicou que o lint caiu de 13 para 12 problemas "sem que nenhuma linha do repositório mudasse", atribuindo
a queda à versão do Chrome no cache. Medido rodando o ESLint sobre a versão anterior do arquivo: o 11.º
erro era o `dirname` importado sem uso em `build_governance.ts:14`, que **esta unidade apagou** — 11 = 1 do
repositório + 10 do cache. O registro da entrada 13 já dizia exatamente isso, e a releitura não o leu. O
ESTADO agora publica a propriedade que vale — **nenhum erro de lint em caminho rastreado** — e a atribuição
errada entrou em § 6 por nome. **Custo de reversão:** nenhum; nenhuma linha de código depende disso.

**2. O contrafactual da margem de coleta era 3.997 e não 3.998, e o próprio ESTADO se contradizia.** A
releitura converteu o contrafactual de estimativa em medição, mas mediu só a poda global: as duas linhas
que ela derruba estão nas posições 369 e 1.084. Falta a **terceira**, que a poda **intra-pool** derruba na
posição 245 — e a mesma seção do ESTADO dizia "4.097 é 4.100 menos as **3** frescas que as duas podas
tiraram", que não coexiste com "duas dentro das primeiras 4.000". Rodei o pipeline completo (`dedup` →
`prune` → `drop_seen_against`) nos dois cenários: sobre as 4.100 sobrevivem **4.097** frescas, sobre as
primeiras 4.000 sobrevivem **3.997**. A conclusão não muda — a margem é necessária —, e o número que a
sustenta agora é de execução. As posições também estavam publicadas 0-indexadas sem dizer, e agora são
1-indexadas por escrito.

**3. A leitura de que o corpo local "não tinha partição" é falsa, e o corpo foi apagado.** O parcial
publicou que os carimbos de bloco eram "timestamp em dado gitignored, não split congelado", e que
`test`/`cal-B` só passariam a existir no item 3. O código refuta a primeira metade:
`assemble_corpus.stamp_block` escreve o `BLOCK_TIME` da partição em `createdAt`, e
`diagnostic_probes.partition_of` devolve a partição **desse campo**, porque a pertença é fato derivado e de
propósito não é campo do registro. Um corpo estampado **tem** pertença de bloco, inclusive nas duas cegas.

O que a revisão não viu, e que decide o remédio, é que a colisão é **estrutural**: `schema.ts` exige
`createdAt` numérico em todo registro e o **único** escritor desse campo é `stamp_block`. Logo um corpo que
passe `parseBenchmarkDataset` — o que `preflight-viability` exige — carrega carimbo por construção, e
"medir o corpo estampado" e "não criar `test`/`cal-B`" são objetivos que o esquema torna incompatíveis. Não
foi descuido do arnês: era a única forma de a auditoria e o preflight terem corpo para ler.

**A decisão:** medir e então **apagar**. `benchmark/data/corpus-build-f3/records.jsonl` e
`cluster-report.json` (cuja chave de fatia é `partição/classe`) saíram do disco; ficaram os dois arquivos
de governança e a evidência de rótulo, que não carregam pertença de bloco. O ESTADO publica o **agregado**
de 1.600 linhas postas de lado — a regra que § 3.3 impõe e que `open_partition_rows` executa — e não mais
uma contagem por partição cega, uma linha para cada, que a própria § 3.3 proíbe. **Custo de reversão:**
re-montar, cerca
de três minutos; o pool ficou em disco, e os números de pool seguem reproduzíveis dele. **O que se perde:**
os números do corpo deixam de ser reproduzíveis sem re-montar, que é a dívida de § 7 que já os cobria.
**O que se ganha:** nenhuma medição futura sobre aquele diretório toca uma linha que o próprio código
chama de `test`.

**4. O runbook ensinava o manifesto que a auditoria bloqueia.** O § 3.3 descreve o manifesto de fontes na
v1, sem `materialBatches`, e é a seção que alguém abre para escrever o arquivo. Medido, escrevendo o
manifesto nessa forma pelas funções de produção e rodando a auditoria sobre o corpo real: `status=blocked`
com **4.000** `SOURCE_REFERENCE_MISSING`, um por linha humana, contra `ready` com 0 motivos pelo manifesto
v2 do produtor. É literalmente o cenário que a dívida do Commit A descrevia. O § 3.3 ganhou o callout de
v2 na forma do que o § 2 já tinha para o registro v4, e o runbook ganhou o **passo 3.3b**, que é o comando
`build_governance.ts` entre a montagem e o `ingest` — antes não havia nenhuma ocorrência de
`build_governance` no runbook, e o passo de `ingest` recebia `--sources` como arquivo de mão. A reescrita
campo a campo entra como dívida de § 7. E o comentário de `corpus-source-audit.ts` que dizia que o
inventário "is still owed … See Fase 3" foi corrigido, o que move o `evaluatorDigest` para
`a79a9ee6cf…` — barato enquanto `issuedAt` é nulo.

**5. Duas guardas novas ganharam prova, e uma delas era fail-open.** O teste que cruza o lote declarado
com o id que o extrator deriva raspava o TypeScript com um regex de **layout** — `batchId` → `sourceId` →
`materialVersion` em linhas adjacentes. Medido: contra um texto com três lotes ele casa **um**; um lote com
os campos em outra ordem, ou com um comentário entre eles, fica invisível, inclusive um com
`materialVersion` errada. Agora o literal do array é fatiado por profundidade de chave, cada objeto entrega
seus três campos **por nome** e o teste exige que os três estejam lá, então um campo renomeado fica
vermelho em vez de desaparecer. A asserção de `sourceId` deixou de ser "todo lote é o da Wikipédia" — que
ficaria vermelha numa readmissão legítima — e passou a ser "exatamente um lote nomeia a fonte da
Wikipédia", com a derivação `batchId == material_batch_id(materialVersion)` exigida de **todos**.

A segunda: a entrada de linha de comando de `build_governance.ts` passou a ser um predicado sobre
`argv[1]`, e **nenhum** teste a exercitava — mutá-la para `if (false)` deixava a bateria inteira verde
enquanto o comando documentado saía com código 0 sem escrever nada. Um teste novo dirige o script como
subprocesso e afirma os dois arquivos escritos mais o digest impresso, que é a mesma razão pela qual o
teste de subprocesso do extrator existe.

**6. Três correções de comentário e de prosa, todas da forma "a frase promete o que o código não faz".**
A docstring de `writeGovernance` dizia "Writes both governance files, or neither" com duas escritas não
atômicas: uma falha de I/O na segunda deixa manifesto revisado sem template. O título passou a ser o que o
código garante — nenhuma recusa deixa arquivo atrás — e a não atomicidade está escrita ao lado. O escritor
emite `heldOutGeneratorFamilies: []` sem recusar, contra o princípio que o seu próprio comentário declara;
a razão está agora no comentário, e é que este writer também corre sobre o intermediário **só humano**,
onde não há família gerada para reservar, e é `validateDatasetManifest` que recusa a lista vazia no selo. E
o ESTADO publicava a recusa de inventário vazio como recusa do produtor de hoje: ela **não é alcançável**
pelo `main()` atual, que passa uma constante de um elemento, e guarda um produtor que **derive** a lista —
que é exatamente por que a lista chega por parâmetro.

**7. Duas convenções que decidiam número publicado e não estavam escritas.** O `p90 = 282` só sai da
convenção `w[⌊q·n⌋]`: medido, os vizinhos do índice 3.600 são `[280, 281, 281, 281, 282, 282, 282]`, o
*nearest-rank* dá 281 e a interpolação linear 281,1 — e os outros quatro quantis coincidem nas três
convenções, então só p90 dependia. E o `n` por faixa a n=800: as parcelas exatas são 271,0 / 269,4 / 191,4
/ 68,2, os pisos somam 799, sobra **uma** cadeira e há **empate** de resto (0,4) entre `[80,149]` e
`[150,299]`. "Maior resto" sozinho não escolhe; o desempate publicado dá a cadeira à faixa de maior limite
inferior, que é a de pior poder. As duas estão escritas em § 5.1b e ancoradas em § 4.2b-ter de
`references.md`.

### O que NÃO foi aplicado, com a razão

1. **`749.166 chaves distintas` no artefato de vistos.** A revisão está certa: o número é
   `len(SeenIndex.postings)`, o índice invertido **amostrado em 1/16**, e as chaves distintas de todos os
   documentos são 2.838.602. Mas a alegação nunca saiu do relatório interno da unidade (gitignored):
   `grep` de `749166` em `docs/`, `benchmark/`, `src/` e `contracts/` não devolve nada, e o que o ESTADO
   publica — 10.000 documentos, **3.323.576** chaves de shingle — é `shingle_keys()`, que está certo e foi
   reconferido contra o cabeçalho do artefato. Não há documento rastreado a corrigir.
2. **Tornar as duas escritas de `writeGovernance` atômicas** (temporário + rename). A não atomicidade está
   agora declarada; torná-la atômica é mudança de comportamento sem consumidor que a exija — o `ingest`
   recebe os dois caminhos e falha alto se um faltar. Fica para a unidade que tocar o escritor.
3. **As frações por faixa da pré-inscrição** (238/239/204/119 contra 271/269/192/68) seguem erradas e
   seguem no lugar: corrigi-las move `evaluatorDigest` **e** é emenda de pré-inscrição, de outro dono, com
   prazo em § 7 — antes da Fase 6, que é onde o model card imprime a tabela.

### As sete provas por mutação do fechamento, rodadas por último sobre os bytes finais

Linha de base dos quatro arquivos mutáveis, e o valor a que os quatro voltaram, conferido:
`build_governance.ts` `434d7579…` (10.713 bytes) · `test_extractors.py` `e5ebface…` (349.929) ·
`extract_wikipedia.py` `71a7b2db…` (9.051) · `build-governance.test.ts` `0675f3c6…` (6.600).

| # | mutação | vermelho em | sha256 sob a mutação |
|---|---|---|---|
| M1 | `if (materialBatches.length === 0)` → `if (false && …)` | `refuses to write an empty material inventory, and leaves no file behind` (1 de 6) | `885d74e3…` |
| M2 | `if (!declaredSourceIds.has(batch.sourceId))` → `if (false && …)` | `refuses a batch whose sourceId the manifest does not declare…` **e** `refuses the declared inventory itself when the corpus declares no source at all` (2 de 6) | `230865841…` |
| M3 | `--snapshot-version` com `required=False` na argparse | `test_the_wikipedia_command_line_refuses_a_run_without_the_flag`, e a falha é a que o comentário prevê: quebra em `assertFalse(output.exists())` com `True is not false` — sem o flag obrigatório a corrida ABRE o material e CRIA a saída antes de morrer | `66a4287d…` |
| M4 | `batchId: "smb_ptwiki-20220301"` → `"smb_ptwiki-2022-03-01"` | `test_the_declared_inventory_names_the_batch_the_extractor_stamps`, nomeando as duas grafias | `085bc6e0…` |
| M5 | um **segundo** lote, com comentário entre `batchId` e `sourceId` e `materialVersion` errada | o mesmo teste, agora acusando `'smb_ptwiki-20220301' != 'smb_ptwiki-WRONG-VERSION'` — é a prova de que o parse novo VÊ o lote que o regex de layout não via. Do lado TS, 3 de 6 reprovam | `ab19cbbe…` |
| M6 | `if (argv[1] !== undefined && argv[1] === fileURLToPath(…))` → `if (false)` | `writes both files and prints the digest of the manifest it wrote`. Sob a mutação, o comando documentado **sai com código 0 e escreve 0 arquivos**, e a bateria inteira reprova em **exatamente um** teste — o novo: 1 de 2.816 no vitest, 431 + 84 verdes no pytest. É a medição de que antes dele não havia cobertura nenhuma | `b81b8931…` |
| M7 | trocar a **ordem** das duas escritas em `writeGovernance` | **nada.** 6 de 6 verdes e typecheck limpo, com o arquivo do mesmo tamanho (10.713 bytes) e sha256 diferente (`5f70ddb0…`). É a medição que sustenta a reescrita da docstring: a atomicidade que a frase prometia não é afirmada por teste nenhum, e não passou a ser | `5f70ddb0…` |

M1 e M2 já constavam do parcial e foram **re-rodadas** aqui, porque a prova vale sobre os bytes finais e o
arquivo mudou depois delas. M7 é a única cujo resultado esperado é verde: a mutação existe para medir a
ausência de cobertura, não para exercitá-la, e o remédio escolhido foi corrigir a frase e não o código —
com a razão em "O que NÃO foi aplicado".

---

## As quatro sondas de dependência de tema (2026-08-07)

Quatro instrumentos que medem se o veredito lê **assunto** ou lê **estrutura**, mais a leitura do resultado
da família reservada. **Nenhum decide gate e nenhum gasta alpha.** Estado vigente em ESTADO § 3.3 e § 5.8;
referências em `references.md` § O.

### De onde veio, e a separação entre o estabelecido e o especulado

Eu (o agente principal) levantei que o detector poderia aprender **implausibilidade de co-ocorrência** como
atalho: texto cuja combinação de entidades é improvável seria lido como IA. Perseguindo o argumento com o
operador, ele ficou **mais fraco** do que eu o enunciei, e a honestidade sobre isso é parte do contrato
desta unidade. A separação, nestes termos:

- **ESTABELECIDO.** O pré-treino MLM do BERTimbau tem como OBJETIVO prever token por contexto, logo as
  representações codificam estatística de co-ocorrência. Isso é arquitetura, não especulação.
- **ESPECULADO — meu, e eu afirmei como se soubesse.** Que a representação AGRUPADA que a cabeça de
  classificação lê exponha essa implausibilidade de forma utilizável. Existe método padrão para medir
  surpresa com MLM — pseudo-perplexidade, Salazar et al. 2020 — e o nosso classificador **não a calcula**.
- **SOBREVIVE.** O pareamento controla o ASSUNTO, não a CORREÇÃO. A linha de IA inventa entidade que a seção
  humana não tem, então dentro de um par de tópico idêntico o erro factual ainda diferencia.
- **DISSOLVE-SE EM GRANDE PARTE.** As famílias de treino são modelos de fronteira, que raramente confabulam
  em prosa enciclopédica curta sobre tópico conhecido: o gradiente é fino no treino. A confabulação pesada
  vive no modelo pequeno RESERVADO, que é só teste — reservado não ensina, apenas infla a leitura.

**O objetivo dos instrumentos era DECIDIR se a hipótese valia, não confirmá-la.** Ela não valeu, e a
medição que a refuta está em ESTADO § 5.8: contra o artefato antigo, mascarar toda entidade, data e numeral
**não** move o veredito, e mascarar uma quantidade igual de palavras comuns move o escore 4,7× mais.

### Decisão 1 — o mascaramento tem TRÊS braços, e o terceiro é o que o torna legível

Decidido: `original`, `entity-masked` e `placebo-masked`, com o placebo casando a contagem de vãos **e** o
multiconjunto de comprimentos de vão. Razão: `[MASK]` é um token que a cabeça ajustada nunca viu depois do
fine-tuning, então inserir quinze deles move o escore qualquer que seja o que substituíram — um único braço
não distingue "as entidades carregavam o escore" de "marcadores movem o escore". A quantidade lida é o
**excesso** do braço de entidades sobre o placebo. **Custo de reversão:** baixo — remover o braço placebo é
uma linha, e o preço é que o instrumento deixa de decidir qualquer coisa; o teste
`test_the_placebo_matches_span_count_and_run_lengths` reprova.

### Decisão 2 — heurística de entidade em vez de tagger, com a recall declarada

Decidido: o achador de entidades é heurístico — maiúscula em meio de frase, siglas, numerais, datas — e
stdlib puro. **Medido antes de decidir, sobre `ner_pilot.py`, que está na árvore:** o caminho `screen` dele
exige `transformers` + `torch` e baixa dois checkpoints do HF; a própria docstring declara que só `tally` e
as funções puras são stdlib. O interpretador em que a suíte do lab roda (`py -3.13`) **não tem
`transformers`**, então uma transformação de mascaramento construída sobre ele ficaria fora da bateria que
roda a cada mudança, e um diagnóstico ganharia um download de modelo. O que o piloto oferece acima de um
tagger — janelamento por offsets, dedup de vão, mapeamento fail-closed de rótulo — pressupõe o tagger.

A heurística **sub-mascara** e isso é declarado, não escondido: um capital que só abre frase é
indistinguível de substantivo próprio por caixa. É recuperado quando a mesma forma aparece capitalizada no
meio de outra frase do mesmo documento (`proper_forms`), e não é recuperado quando não aparece — há teste
para as duas direções. Sub-mascarar só pode empurrar o veredito para `survives`, então `collapses` é o
veredito forte e `survives` viaja com a fração de palavras efetivamente mascarada ao lado.
**Custo de reversão:** baixo enquanto ninguém publicar um número sobre a recall do achador; alto depois.

### Decisão 3 — o critério de colapso, e o piso medido que ele tem de superar

Decidido: colapso quando, na classe `ai`, `excesso de queda média ≥ 0,10` **ou** `excesso de taxa de virada
de veredito ≥ 0,20`. Os dois números são declarados e sem precedente. O piso que eles têm de superar é
**medido**: o relatório de paridade do export int8 que ancora o teto de bytes aceita `maxAbsDelta`
**0,008950** e **zero** viradas em 120 amostras, então 0,10 é onze vezes o maior delta que o gate de
paridade tolera e não pode ser confundido com quantização. O veredito lê a classe `ai` porque a hipótese é
sobre texto gerado; um movimento na classe humana é a direção do falso positivo e é **reportado ao lado**,
nunca decidido. **Custo de reversão:** baixo — os dois números são constantes lidas por teste de fronteira
(`test_the_verdict_reads_collapse_exactly_at_each_threshold`), e mover qualquer um deixa a bateria vermelha.

### Decisão 4 — `topic` é eixo de FATIA, e explicitamente NÃO de união

Decidido: `topic` entra em `SliceAxis`, `AXIS_ORDER` e nos extratores de `benchmark/slices.ts`, e entra em
`DIAGNOSTIC_AXES`. **Conferido antes de mexer**, e as três coisas eram verdade: `benchmark/schema.ts:98` e
`:1741` declaram `topic: string` obrigatório em v2 e v3, `topic` não está entre os 14 eixos de agrupamento,
e não aparecia em `benchmark/slices.ts`.

`topic` **não** entra em `GROUP_KEYS`, e a razão tem duas partes. Primeira: tópico não é campo observado
como `source` — ele seria derivado de uma escolha de agrupamento, e congelar um eixo de UNIÃO que depende de
um *clustering* põe uma decisão de modelagem dentro da política selada. Segunda: conglomerado temático é
grande, o que traz de volta a degenerescência de poucos blocos grandes que a emenda da moldura acabou de
resolver.

**O achado que a implementação produziu, e que não estava no roteiro:** a inelegibilidade a gate **não
bastava**. `summarizeSlices` macro-averageia TODAS as fatias, elegíveis ou não, e a média macro é publicada
no relatório — então um eixo diagnóstico moveria um número publicado. São **duas** barreiras e nenhuma
implica a outra: `buildSlices` nunca marca uma fatia diagnóstica como elegível, e `summarizeSlices` tira as
diagnósticas da média macro **e** da busca do pior caso, o que vale mesmo para uma fatia que chegue elegível
de outro lugar. Há teste para cada barreira, mais um em `gates.test.ts` com uma fatia de tópico forçada a
elegível e FPR de 0,99: o inventário continua 4, nenhum gate de tópico é construído e a decisão é `pass`.
**Custo de reversão:** médio — remover o eixo move `evaluatorDigest` de novo (`slices.ts` e `report.ts` são
membros de `EVALUATOR_FILES`), e é barato só enquanto `issuedAt` é nulo.

### Decisão 5 — o piso barato ESTENDE o baseline de D19, e é publicado DECOMPOSTO em dois ramos

Decidido: `baseline_tfidf.VECTORIZATIONS` passa a ter **cinco** entradas — palavra (1,2), caractere (3,6),
`funcionais`, `estilometria` e `funcionais+estilometria` —, no mesmo registro que impede rodar uma sem as
outras. `funcionais` é um TF-IDF com `vocabulary=` fixado na lista fechada de palavras funcionais que a sonda
estilométrica já mantém (`diagnostic_probes.FUNCTION_WORDS`, **lida** e não copiada); `estilometria` são as 19
features da W3 (`probes.feature_matrix`, que recusa antes de qualquer `fit` se uma medida de viés estiver
registrada como feature); a terceira é a união. Precedente: Mosteller & Wallace (1963) atribuíram os
*Federalist Papers* disputados usando só palavras funcionais, precisamente porque são independentes de tema.

**A decisão anterior publicava a união como "cego a tema", e a medição refutou isso.** Medido sobre 253 pares
(§ 5.8): a união chega a **0,9767** e `estilometria` **sozinha** a **0,9712** — 98,8 % da separação acima do
acaso da união —; o ramo de funcionais acrescenta 0,0055 de AUC. Sete das 19 features são funções das palavras
de conteúdo e `_stylometry_matrix` recebe o texto **inteiro**, então "conteúdo estruturalmente barrado" era
falso da união. O ramo genuinamente cego a tema é `funcionais`, com **0,9313** — logo **abaixo** de palavra
(0,9327) e de caractere (0,9319), não acima. `THEME_BLIND_VECTORIZATIONS` nomeia em código qual dos cinco
números limita a fração temática, e a asserção do registro recusa um rótulo que não aponte para uma
vetorização existente. A união continua publicada, com o papel de **piso barato** do critério da Decisão 6,
onde ser cega a tema nunca foi exigência.

Duas correções de instrumento vieram da mesma medição. (1) O `token_pattern` default do sklearn descarta todo
token de um caractere, então `a`, `e`, `o`, `à` e `é` — as três palavras mais frequentes do pt-BR e o material
que Mosteller & Wallace contam — estavam no vocabulário com massa **zero permanente**; custo medido **0,0369** de
AUC (0,8944 em vez de 0,9313 — o registro publicou 0,041 até 2026-08-11,
e a subtração é 0,0369), e nenhum teste podia notar porque a fixture não tinha palavra funcional nenhuma
(matriz de zeros 40×120). (2) A guarda de "nenhuma palavra de conteúdo" era uma **lista negra** de 42 palavras
medidas: medido, `brasil` declarado funcional passava pelas duas guardas — a pós-`fit` porque compara o
ajustado contra a lista já contaminada — e chegava ao vocabulário. Substituída por **igualdade de conjuntos**
contra as 120 palavras enumeradas por classe gramatical fechada em `DECLARED_FUNCTION_WORD_CLASSES`, que
recusa admissão e remoção. As 42 palavras ficam para **nomear a falha** na mensagem de erro.
`POST_FIT_GUARDS` tem as mesmas chaves de `VECTORIZATIONS`, então uma sexta vetorização não chega sem decisão
sobre a sua conferência. **Custo de reversão:** baixo.

O que sobra medido, e é bastante: um linear que lê **só 120 palavras funcionais** separa este material com AUC
0,93, empatando com as duas vetorizações que leem conteúdo. No enquadramento de D19 continua a não ser boa
notícia — é artefato de fonte —, mas o limite publicável é o de `funcionais`, não o da união.

### Decisão 6 — o critério de aceitação da família reservada, e o fail-open que a medição achou

Decidido: `lift(família) = (AUC_piso − 0,5) / (AUC_detector − 0,5)`, a fração da separação acima do acaso
que um baseline burro já alcança; a reservada mede FACILIDADE quando o excesso de `lift` dela sobre as
*core* alcança `0,10`. Adimensional de propósito, para ser comparável entre famílias.

**A primeira versão do critério era fail-open, e a corrida de smoke o mostrou.** Medido sobre os pais
pareados: piso barato 0,9830 contra detector 0,9898 põe o `lift` das *core* em **0,9861** e o excesso em
**0,0070** — não podia ser outro número. Uma margem de 0,10 é irresolúvel se as *core* não deixam pelo menos
0,10 de `lift` sem reclamar, e um excesso pequeno **por construção** lido como aceitação é exatamente a
direção que publica um número OOD como generalização. Acrescentado: `folga = 0,10` e um **terceiro
veredito**, `no-headroom`, que `assert_reserved_family_measures_generalization` **recusa** do mesmo modo que
recusa `measures-easiness`. Ordem dos vereditos pinada: facilidade primeiro, abstenção depois, aceitação por
último — uma corrida sem folga E com excesso acima da margem mediu facilidade, e reportá-la como abstenção
perderia o achado. Quarto número: `piso de separação = 0,51`, abaixo do qual o detector está no acaso e a
razão não tem denominador — a função **recusa** em vez de devolver um `lift` enorme.

**Custo de reversão:** baixo hoje, alto depois da Fase 5 — este é o número pelo qual a fatia OOD é publicada
como generalização ou como limite otimista, e afrouxá-lo depois de ver o resultado é a classe de decisão que
§ 3.4 do ESTADO proíbe.

### Decisão 7 — o smoke roda em `python` 3.11, e a razão é medida

Decidido: os testes das quatro sondas são stdlib/numpy/sklearn e rodam onde a bateria do lab roda
(`py -3.13`); a **pontuação** contra o artefato antigo roda em `python` 3.11. Razão medida: `onnxruntime`
está ausente do `py -3.13` e presente no 3.11 (1.27.0), junto de `transformers` 5.14.1 — e
`score_pilot_local.py`, que já existia, é o scorer. Declarado como dívida em § 7: a corrida de smoke não é
reproduzível de um `py -3.13` limpo.

### O que NÃO foi aplicado, e por quê

1. **`topic` em `GROUP_KEYS`** — decisão 4 acima; é eixo de relato, nunca de união selada.
2. **Corrigir as frações por faixa da pré-inscrição** (238/239/204/119 contra 271/269/192/68) — segue de
   outro dono, com prazo em § 7 do ESTADO: antes da Fase 6.
3. **Um tagger de NER no lab** — `spacy`/`stanza` estão fora por política desta unidade, e `ner_pilot.py`
   exige `transformers` + `torch` e dois downloads. A heurística basta e a sua recall é declarada.
4. **Dar um `topic` real ao extrator** — `assemble_corpus` escreve `"topic": "geral"` constante, então a
   fatia existe com uma chave. Mudar isso é mexer no extrator e no montador, que é outra unidade; a dívida
   está em § 7.
5. **Calcular pseudo-perplexidade** (Salazar et al. 2020) para medir surpresa de MLM diretamente — seria o
   instrumento correto para a hipótese como enunciada, exige o backbone MLM carregado e um passe por token,
   e o mascaramento com braço placebo respondeu à pergunta por três ordens de grandeza menos custo.

### Decisão 8 — os quatro achados bloqueantes da revisão, aplicados; e o que a revisão errou

Decidido depois da revisão adversarial da unidade das sondas: **quatro** achados bloqueantes procedem e foram
consertados, um quinto procede e foi consertado, e um menor foi **refutado com medição**. O que segue é o
registro do que mudou e da razão, porque cada item move um número publicado.

**(1) O piso "cego a tema" não era cego a tema.** Aplicado — Decisão 5 acima reescrita, § O3 de
`references.md` reescrito, ESTADO § 5.8 e § 6 reescritos. Medido: `estilometria` sozinha reclama 98,8 % da
separação acima do acaso da união, e o ramo genuinamente cego (0,9313) fica **abaixo** de palavra e de
caractere. O erro era fail-open para a pergunta da própria unidade: publicava-se como limite superior da
fração temática um número que features sensíveis a conteúdo carregavam.

**(2) Cinco das 120 palavras funcionais nunca eram contadas.** Aplicado — `token_pattern` fixado em
`(?u)\b\w+\b`, fixture trocada por prosa pt-BR real (a anterior produzia matriz de zeros 40×120, e sobre
zeros toda guarda de vocabulário passa), e teste novo afirmando que **toda** entrada da lista é alcançável
pelo analisador e que `a`, `e`, `o`, `à`, `é` carregam massa positiva. Custo medido do defeito: **0,0369** de AUC (0,9313 − 0,8944; o valor 0,041 que este registro
publicou até 2026-08-11 não é a subtração).

**(3) A guarda de conteúdo era lista negra.** Aplicado — igualdade de conjuntos contra
`DECLARED_FUNCTION_WORD_CLASSES`, 120 palavras sob sete classes gramaticais fechadas, verificada como
**partição** (a soma das classes é o tamanho do conjunto, então uma palavra sob duas classes reprova). Medido
antes do conserto: `brasil` declarado funcional chegava ao vocabulário ajustado.

**(4) O critério da família reservada media o arquivo `--humans` inteiro.** Aplicado —
`assert_every_human_row_is_a_paired_parent` recusa a chamada, e `main()` passa os pais pareados. Também
`main()` passou a **filtrar** as linhas `ai` pelos pais presentes, o que era a causa de a tabela publicada não
ser reprodutível pela invocação documentada (2.319 das 2.572 linhas frescas não pareiam com
`wikipedia_fresh.jsonl`). Os comandos exatos entraram em ESTADO § 5.8.

**(5) A falta do placebo era declarada publicada e não era.** Aplicado — `read_masking` publica
`placeboShortfallWords`, `placeboShortfallRecords` e `maxPlaceboShortfallWords` por classe, `--masking` deixou
de ser opcional, e um registro pontuado sem entrada de mascaramento **recusa**. Medido: a classe humana tem 47
palavras de falta em 5 das 60 linhas. A direção do viés está escrita: falta do placebo **superestima** o
excesso, e o excesso aponta para `collapses`, que neste instrumento é o alarme e não a dispensa.

**Menor aplicado:** o corte de 512 tokens faz dos três braços três janelas diferentes em 9 das 240 linhas (6
`ai`, 3 humanas, medidas com o tokenizador do próprio snapshot); `--max-length 512` fixado no runbook e a
contagem registrada em § 5.8. E o teto de ruído passou de `assertAlmostEqual` para `assertEqual`, porque sete
casas decimais deixavam o valor derivar a partir da oitava.

**Menor REFUTADO, com medição.** A revisão afirmou que `report.ts:1080` mede um caminho que o corpo real não
produz — que uma fatia sem negativos devolve FPR **não-finito** e portanto o primeiro termo (`negatives === 0`)
seria inútil. Medido: `metrics.ts` carrega **as duas** convenções para denominador zero —
`proportionEstimate` (linha 3733) devolve `NaN` e `ratio` (linha 489) devolve `0` — e a fatia usa a primeira,
o que confirma a metade factual da observação e **refuta** a conclusão: com as duas convenções vivas no mesmo
arquivo, uma fatia sem negativos chegando com `0` finito está a um refactor de distância, e imprimir `0` ali é
publicar tópico perfeito. Os **dois** termos ficam. O que a revisão apontou de real é a fixture: ela fixava
`0` para a célula vazia, que não é o que a produção produz. Corrigido — a célula vazia passa a `NaN`
(a forma real, agora afirmada contra `buildSlices` em `slices.test.ts`) e uma linha **nova** com `0` finito e
zero negativos pina o termo defensivo. Cada termo tem agora a sua própria linha vermelha.

**Menor aceito sem conserto:** a sonda de tópico continua sem material (`topic` é constante `"geral"`), então
das quatro exigências do contrato esta fica formalmente **descumprida** — dito com essas palavras em § 5.8 e
com dívida em § 7. Corrigir exige mexer no extrator e no montador, que é outra unidade.

### Decisão 9 — a dívida do corte ficou ÓRFÃ entre o Commit C e o Commit D, e R1 a pagou

Decidido em 2026-08-10, ao consertar os achados da cross-review de dez unidades. A unidade é R1; o que
segue é a razão, porque o item move o `evaluatorDigest` e invalida todo `fit` anterior.

**O que estava errado.** A pré-inscrição selada fixa `threshold.basis` e `calibrationGate.scoreBasis` em
`document-raw-score`, e o operador decidiu (ESTADO § 3.5) **sem calibrador probabilístico na v1**. O código
decidia sobre o escore **calibrado**: `buildEvaluationItem` aplicava `applyFrozenCalibration`, o relatório
estampava `thresholdSource: "frozen-calibration-threshold"`, e `profile-artifact.ts` publicava o perfil de
runtime a partir de `frozen.calibrators`. Duas autoridades apontavam para o mesmo lado e o código estava do
outro.

**Por que ficou órfã, que é o ponto do registro.** A dívida TINHA dono declarado: a linha 85 do plano de
entrega afirma, no Commit D, que ele "inclui a metade que o Commit C não fechou" e **nomeia os quatro
arquivos** que mudariam juntos. Medido: `git show --name-only 1aa5751` não toca nenhum dos quatro. O que D
entregou foi a **detecção** — `gates.ts` emite `score-basis-mismatch` quando as duas bases divergem — e as
duas divergiam SEMPRE, então o gate de calibração global reprovava **por construção** em toda corrida
certificadora. Isto é: o Commit D instalou o alarme correto sobre um defeito que não consertou, e o plano
declarou o defeito consertado. Custo de a afirmação falsa ficar de pé: **17 commits**, ao fim dos quais o
raio de alcance havia crescido dos seis arquivos da linha 85 para dez.

**A lição operacional, e é o motivo de isto ser decisão e não nota:** um dono declarado no plano não é um
dono. A detecção de uma divergência é entregável separado do conserto dela, e um commit que entrega só a
detecção deve dizer isso na linha do plano — porque a alternativa, medida aqui, é um alarme perpétuo lido
como conserto por qualquer um que releia o plano em vez de rodar o gate.

**O que R1 mudou, nos dois lados no mesmo commit.** Metade sozinha é pior que o estado anterior — escore cru
sob corte calibrado, ou corte cru sob perfil de runtime calibrado, faz o corte MEDIDO e o corte ENTREGUE
divergirem em silêncio —, então:

- o lado **medido**: `buildEvaluationItem` recebe o corte pré-inscrito e compara `documentRawScore >=`
  limiar; `documentScore` é o escore cru sem transformação, logo o ECE-15 passa a ser a estatística da
  própria hipótese; a base medida é **derivada dos números** por `measuredCalibrationScoreBasis`, que
  devolve `cut.basis` só quando todo item pontuado carrega o escore da própria linha byte a byte
  (ver Decisão 10, achado 1); e `metrics.ts` estampa
  `thresholdSource: "preregistered-provisional-threshold"`;
- o lado **entregue**: `contracts/calibration-profile.ts` ganha o kind `identity` (a união admitia `platt`,
  `beta` e `isotonic`, e nenhum é a identidade — um platt de inclinação 1 é uma sigmoide), e
  `profile-artifact.ts` publica `documentIndicator` = limiar pré-inscrito atrás de calibrador `identity`,
  com `assertServedCutIsTheMeasuredCut` recusando qualquer perfil que sirva outro corte ou outro calibrador;
- a **ação visual sai da v1**, e isso é a política falando: a pré-inscrição declara **um** corte sobre
  **uma** base e pina `rollout.maximumStage: "indicator"` com `actionsPromoted: false` por `literal()`.
  Não existe corte de ação pré-inscrito para a medição aplicar, então `action.available` reprova e a
  decisão teta em `indicator-only` — que é exatamente o teto declarado. O limiar visual do artefato
  congelado vive numa escala que esta medição não tem mais, e lê-lo seria comparar número de uma escala
  com escore de outra;
- o **calibrador continua sendo ajustado e selado**, como diagnóstico que não decide: `calibrator.reservedFor`
  o reserva à v2 e a evidência de seleção é insumo dessa v2, congelado antes do bloco cego. Apagá-lo
  destruiria material e não é o que as duas autoridades pedem — o que elas pedem é que ele não participe da
  **decisão**, e agora nenhum consumidor o lê para decidir.

**Os outros quatro achados da mesma unidade.** (a) O congelamento sela **sete** digests e o leitor comparava
**três**: `THRESHOLD_DIGEST_KEYS` passa a ser derivada de um `Record<keyof ThresholdDigests, true>`, então a
lista é total por tipo e um caso vermelho por campo a mede. Os quatro que faltavam eram auditoria, readiness
e os **dois manifestos de predição** — isto é, um corte cujo quantil saiu das predições de OUTRO fit era
aceito como pertencente a esta corrida, com política e split conferidos e população não. (b) A leitura era
`as ProvisionalThresholdArtifact`, cast puro: agora é `parseProvisionalThresholdArtifact`, parser de forma
fechado que recusa nomeando o path do campo, e um artefato v1 redigerido como `schemaVersion: 2` deixa de
atravessar. (c) A conferência acontece **antes da lease**, no trecho de pré-exposição de
`consume-holdout.ts`, ao lado da confirmação de identidade do avaliador — e não só antes das predições de
`test` dentro de `evaluate`. A distinção é o achado: no fluxo certificador o `evaluate` roda DEPOIS de
`beginHoldoutConsumption` ter escrito `started` e depois de o bloco cego ter sido pontuado, então "antes das
predições" ali não protegia bloco nenhum (ver Decisão 10, achado 2). Provado nos dois níveis: com o corte
truncado, `runConsumeHoldout` recusa sem NENHUM evento no ledger, sem marcador e sem diretório de shards; e
dentro de `evaluate` a ordem contra as predições segue afirmada pelo par
`FILE_MISSING` × `THRESHOLD_ARTIFACT_MALFORMED` contra um diretório inexistente. (d) A evidência pública
omitia o corte: `FitReport` passa a carregar o artefato inteiro (só contagens) e `fit-summary.json` projeta
valor, base, quantil, partições, população e `artifactDigest`. A **projeção** não move o `evaluatorDigest`
(nem `evidence-sanitizer.ts` nem `publish-evidence.ts` são membros de `EVALUATOR_FILES`), mas **levar o corte
até lá move**: o carregador é `candidate-preflight.ts` e o produtor é `commands/fit.ts`, e os dois SÃO
membros. Uma unidade futura que queira só (d) precisa saber disso.

### Decisão 10 — a revisão de R1 devolveu três bloqueantes, e os três eram meia-verdade da própria unidade

Decidido em 2026-08-10, sobre os relatórios `.codex-reviews/R1-review-contrato.md` e
`R1-review-mutacao.md`. Nenhum foi refutado; cada um apontava uma metade entregue com a outra metade
declarada em comentário. Fica registrado porque a forma do erro repete a Decisão 9 numa escala menor: **a
frase que descreve a guarda foi escrita antes de a guarda existir**, e passou.

**Achado 1 — o detector virou tautologia no commit que dizia torná-lo significativo.** A base MEDIDA passou a
ser LIDA de `PREREGISTRATION_V4.calibrationGate.scoreBasis`, que é o MESMO campo contra o qual
`benchmark/gates.ts:891` a compara. Medido pela lente: `ScoreBasis` tem um membro, pinado por `literal()`,
logo o ramo de recusa não tinha estado alcançável em política nenhuma — e o comentário afirmava o contrário
do que o código fazia. Consertado **derivando a base dos números**: `measuredCalibrationScoreBasis(cut, rows)`
devolve `cut.basis` apenas quando todo item pontuado tem `documentScore === prediction.documentRawScore`, e
`document-calibrated-score` no primeiro passo representável de diferença. Agora a declaração é um fato sobre
o mapeamento que rodou, e recalibrar dentro de `buildEvaluationItem` faz `warning.calibration-ece` reprovar
com `score-basis-mismatch` — que é a mutação M-A da lente, exigida e executada. Ganho secundário:
`cut.basis` deixa de ser campo morto (era o nono achado, menor, da outra lente).

**Achado 2 — a ordem certa contra o objeto errado.** Ver Decisão 9, item (c), reescrito. A conferência do
corte migrou para o trecho de pré-exposição de `consume-holdout.ts`, entre a identidade do avaliador e
`beginHoldoutConsumption`. Duas alegações falsas foram apagadas: um comentário em `evaluate.ts` e o próprio
item (c) deste registro.

**Achado 3 — meia igualdade no caminho localizado, e o encoding que ninguém honrava.** O perfil servia
`localizedIndicator = 1` chamando isso de "desabilitado", e o runtime comparava `localizedScore >= 1`. Um
escore localizado é o **máximo** sobre softmaxes de janela e um softmax saturado é exatamente 1,0 em ponto
flutuante: `1 >= 1` dispara. Logo o runtime podia levantar um gatilho localizado — `LOCALIZED_SIGNAL`,
apresentação ao usuário — num caminho cujo FPR a medição não estimou. `documentAction = 1` tinha o mesmo
defeito, e a asimetria era NOVA nesta empreitada (`calibration-pipeline.ts` computava a união dos dois
caminhos). Decidido: **o 1 passa a ser um desligado verificável**, não uma convenção. `contracts/calibration-profile.ts`
exporta `DISABLED_THRESHOLD` e `thresholdFires(score, threshold)`, que é `threshold < 1 && score >= threshold`,
e `src/inference/calibration.ts` compara pelos três limiares através dele. A colisão que isso cria — um corte
MEDIDO cujo valor seja 1 — é recusada na publicação por `PROFILE_CUT_AT_DISABLED_SENTINEL`, porque o parser do
artefato admite `threshold: 1` e servir esse número entregaria um gatilho que nunca dispara enquanto a medição
contou como aviso todo sorteio em 1. E `assertServedCutIsTheMeasuredCut` passa a conferir também
`localizedIndicator` e `documentAction`, que era a barreira que o ESTADO § 3.5 nomeava e o código não tinha.

**Por que o encoding e não um `null` no contrato.** O contrato JÁ codifica desligado com 1: `parseProfile`
exige `documentAction === 1` de toda release `indicator-only`. Trocar por `null` seria introduzir uma segunda
convenção para dizer a mesma coisa, com a primeira ainda pinada no parser; honrar a que existe é o conserto
menor e o que mantém uma única leitura. O custo é a colisão, e ela é fechada por código com nome próprio.

**Os menores aplicados sem discussão:** a fixture de `cli.test.ts` tinha o mesmo defeito que a gêmea de
`consume-holdout.test.ts` (corte 0,95 acima de TODAS as predições, matriz de decisão constante) e recebeu a
mesma correção mais uma asserção sensível à matriz; a allowlist do segundo cenário fim-a-fim parou de aceitar
`score-basis-mismatch`; `publish-evidence.ts` passou a parsear o bloco do corte antes de projetá-lo, porque o
cast que o terceiro achado condenou ganhara um dereference novo; o corte passou a ser amarrado aos digests de
manifesto **selados** (`frozen.predictionManifestDigests`) em vez dos recomputados, o que é o que torna a
ligação transitiva e disponível antes da lease; e `applyFrozenCalibration` foi **removida** — não tinha
chamador de produção e decidia por limiar calibrado, que é literalmente a religação silenciosa que o ESTADO
§ 7 registrava como risco residual. O risco fecha por deleção e a linha de § 7 diz isso.

**Os quatro achados do consolidado-c que o contrato de R1 não nomeava e a lente cobrou** (M2–M5) entram
neste commit, todos medidos: o comentário de tolerância citava `0,0163372175`, teto do α retirado — o teto em
vigor é `1 - 0,0125^(1/300) = 0,0145005943`, armazenado `0,014501`, a 4,06e-7 do valor, dentro do 1e-6;
"nove códigos de bloqueio" virou **onze** nos três sítios (`benchmark/README.md`,
`contracts/source-readiness.ts`, `benchmark/corpus-source-audit.ts`) contra a lista que tem onze membros
contados; as três ratificações que afirmavam 7.000 linhas humanas ganharam marca de **SUPERADO** apontando os
4.000 da emenda da moldura (marca e não reescrita: o registro é histórico, e o que envelheceu foi a vigência,
não a decisão); e `assemble_corpus.lane_rows()` deixou de levantar `KeyError` cru no import — `PolicyLanesUnreadable`
nomeia o arquivo e o bloco, com dois casos de pytest.
## R2 — o passo do OPERADOR: paridade não é validade, e o export publica por último (2026-08-10)

Unidade R2, decidida ao consertar os quatro bloqueantes de Fase 4 da cross-review consolidada
(`.codex-reviews/consolidado-w1-backbone.md`, achados A1 a A4). **Os quatro procedem; nenhum foi
refutado.** O que segue é a razão de cada escolha, mais o que a conferência do T5 achou e o que esta
unidade deliberadamente não fez.

O eixo comum dos quatro: eles se realizam num passo que **nenhum teste desta suíte executa** — o operador
num Colab, com torch, onnxruntime e um checkpoint de ~440 MB. Um defeito ali não reprova nada; ele produz
um ZIP. Por isso a forma do conserto foi, nos quatro casos, mover a decisão para uma função **pura ou
injetada** que a suíte possa dirigir, em vez de acrescentar mais uma asserção sobre o código-fonte de
`main()`.

### Decisão 1 — variância de escore nula é RECUSA, e o piso é a própria tolerância do gate

`build_parity_report` passa a publicar `torchScoreIqr`/`onnxScoreIqr` (o intervalo interquartil) e
`torchScoreRange`/`onnxScoreRange` (a amplitude, informativa), e a marcar `degenerate` quando o menor dos
dois **intervalos interquartis** não supera `PARITY_MEAN_DELTA_TOLERANCE` (0,02) — o mesmo número contra o
qual os deltas são comparados. `degenerate` reprova o gate.

**A estatística é interquartil, e não amplitude, porque a segunda lente mediu a amplitude sendo derrubada por
um único documento:** 119 escores em 0,5 e um em 0,9 dão amplitude 0,4, `meanAbsDelta` 0, zero inversões e
`pass: true` — o detector é constante em 119 de 120 casos e o piso não o via. `max − min` é uma estatística
que um outlier move sozinho; o interquartil não. O preço é que o interquartil depende da COMPOSIÇÃO da
amostra, e é por isso que a amostra passou a ser sorteada balanceada (abaixo).

**A amostra de paridade é balanceada entre as duas classes, espaçada pelo arquivo inteiro.** A primeira lente
mediu o que o piso fazia sobre a amostra que o runbook mandava usar: `dev.jsonl` é **agrupado** — 4 118
linhas, `label` 0 nas posições 0 a 2 639 e `label` 1 nas 2 640 a 4 117 —, e `--parity-samples 120` tomava as
120 **primeiras**, isto é, 120 documentos humanos. Sobre uma classe só, o escore de um detector confiante é
tão achatado quanto o de um constante, então o piso recusaria o export legítimo como `ESCORE DEGENERADO` — e,
pela decisão 3, essa recusa já teria apagado a publicação anterior. A amostra passa a ser metade de cada
classe (contagens iguais por construção, espaçadas dentro de cada classe), `label` ausente ou fora de
`{0,1}` é recusado nomeando a linha, arquivo de uma classe só é recusado nomeando `label`, e
`parity_report.json` publica `sampleLabelCounts`. Contagens **iguais** é o que dispensa escolher uma fração
mínima de minoria: qualquer fração seria número novo que alguém pode mover.

**Por que o piso é a tolerância e não um número novo.** A afirmação que o gate faz é "os deltas ficam abaixo
de 0,02". Sobre uma faixa de escore mais estreita que 0,02 essa desigualdade é verdadeira **por
construção**, qualquer que seja a quantização — então o piso natural é exatamente a tolerância: abaixo dele
a frase não fala de quantização. Qualquer outro valor seria constante escolhida à parte, isto é, número que
alguém pode mover depois de ver o resultado, que é a classe de coisa que esta pré-inscrição existe para
impedir.

**A percepção que organiza o conserto**, escrita como restrição técnica em `export_onnx.py` ao lado do
cálculo: paridade é verificação de **autoconsistência**, não de validade, e um modelo degenerado a
**maximiza**. Não é que a paridade seja fraca contra a cabeça não treinada — ela é *perfeita* nela.

**Medido, e é a primeira vez** (ESTADO § 5.9): cabeça de duas classes zerada devolve logitos exatamente
`[0,0]` para 8 textos distintos, `P(ai)` = 0,5 com **um** valor distinto, `meanAbsDelta` 0, `maxAbsDelta` 0,
zero inversões — veredito antigo `pass: true`. As duas lentes sustentaram o achado por fluxo estático; a
metade dinâmica estava declarada como não executada por ninguém, e agora está executada.

**O limite honesto:** o lado ONNX não rodou (o módulo `onnx` não existe em nenhum dos dois interpretadores
desta máquina), então a igualdade dos dois lados segue sustentada por eles lerem os mesmos pesos. Dívida
escrita em § 7.

### Decisão 2 — a cabeça é lida em três lugares, e nenhum deles prova treino

Três exigências novas, todas no caminho barato (antes do `import torch`), menos a terceira:

1. `architectures == ["BertForSequenceClassification"]` — um checkpoint base declara `BertForMaskedLM`;
2. contrato binário de labels: `num_labels`/`id2label` declaram **dois**, `id2label` é um **mapa** (tipo
   conferido: um array ou string estourava `AttributeError` em vez de recusar por nome) e o mapa é
   exatamente `{0: human, 1: ai}`;
3. ausência de `classifier.*` **e de `bert.pooler.*`** em `missing_keys`/`mismatched_keys` do carregamento.

**Por que a ordem dos labels e não só a contagem.** O índice 1 é P(ai) em todo o caminho a jusante — gate de
paridade, manifesto do runtime, e `scripts/package-own-model.mjs`, que **estampa** `{0: human, 1: ai}` no
config servido. Um checkpoint que nomeasse as classes ao contrário não seria pego a jusante: seria
**sobrescrito** por uma afirmação que os pesos contradizem.

**O par anônimo `LABEL_0`/`LABEL_1` é RECUSADO, e essa é uma correção do primeiro fechamento desta unidade.**
Ele havia sido admitido com o argumento de "não reprovar o checkpoint legítimo", porque é o que `num_labels=2`
deixa sozinho. A segunda lente notou que o argumento se anulou na mesma unidade: `train_detector.py` passou a
gravar `id2label`/`label2id` nomeados, então o único checkpoint que chega com o par anônimo é um que o
produtor **selado** não escreveu — e nenhum checkpoint existe ainda, logo aceitar o par não protegia
artefato nenhum. Uma forma legal em vez de duas, e a mensagem de recusa nomeia `train_detector.py` como o
remédio.

**O pooler entra na guarda porque ele está no caminho da cabeça.**
`BertForSequenceClassification` alimenta o classificador com `bert.pooler.dense`; um pooler construído ao azar
entrega entrada aleatória a uma cabeça treinada, e o resultado é o mesmo ruído uma camada antes — igualmente
invisível para a paridade, que compara os dois lados sobre os **mesmos** pesos inventados.

**Por que ler `missing_keys` e não confiar no config.** Medido em `transformers` 5.14.1 (§ 5.9):
`AutoModelForSequenceClassification.from_pretrained` sobre um checkpoint sem os tensores da cabeça
**carrega**, constrói o classificador ao azar e imprime um `LOAD REPORT` com `MISSING` e a nota *"Consider
training on your downstream task"*. O próprio repositório já documentava a armadilha do lado da pontuação
(`score_pilot_local.py`) e nenhuma guarda a lia. A guarda **exige** que o carregador reporte as duas listas:
um dicionário sem elas é recusado, porque um relatório ausente faria a guarda aprovar tudo.

**O que continua não provado, dito com essas palavras:** nada disso prova que a cabeça foi **treinada**. A
prova é o recibo F6 ligando corpus, split, política, seed e hash dos pesos ao checkpoint, e ela não existe —
é a primeira linha de § 7, e o que esta unidade acrescentou lá é a **metade local** do recibo.

### Decisão 3 — staging, todas as guardas, promoção; e a saída anterior morre no COMEÇO

`publish_only_after_every_guard(out, build_into_staging)` monta o bundle inteiro em `<out>.staging`, roda
teto, tokenizer, vocabulário, forma do grafo e paridade lá, zipa em `<archive>.staging.zip`, e só então
promove os dois com `Path.replace`. Qualquer exceção apaga staging e o ZIP de staging.

**A ordem antiga não era "quase certa": ela publicava o artefato e conferia depois.**
`staging.replace(int8_path)` acontecia assim que o teto aceitava — quatro guardas depois disso —, e o ZIP
nascia por último. Cada recusa a jusante deixava um estado diferente no caminho canônico, e o pior deles é o
da **segunda corrida**: `zipfile.ZipFile(…, "w")` só trunca se a execução chegar até ele, então uma recusa
preservava o ZIP **aprovado** da corrida A ao lado do diretório rejeitado da corrida B, sem nada em nenhum
dos dois que dissesse de qual corrida veio.

**Por que apagar a publicação anterior no começo, e não no fim.** Apagar no fim é o que a promoção faz
naturalmente; a decisão aqui é apagar **antes**, para que o estado após uma recusa seja *vazio* em vez de
*antigo*. O consumidor é humano: o operador baixa o ZIP do diretório de saída. Preferir não ter nada a ter um
artefato aprovado que se apresenta como produto de uma corrida que reprovou é a direção fail-closed, e o
custo — reexportar — é determinístico. A remoção é **impressa**.

**A guarda que o próprio conserto exigiu, e que o primeiro fechamento errou.** Apagar `--out` é perigoso se
`--out` apontar para outra coisa, e a primeira versão do predicado aceitava um diretório que carregasse
**qualquer um** dos sete arquivos de bundle. As duas lentes mediram a consequência, independentemente:
`save_pretrained` deixa `config.json`, `vocab.txt`, `tokenizer.json`, `tokenizer_config.json` e
`special_tokens_map.json` — cinco dos sete nomes —, então `--out bertimbau/best` era reconhecido como
publicação anterior e `shutil.rmtree` levava os pesos treinados, ~440 MB de GPU, **antes** de qualquer
guarda. O caminho era novo: o código anterior fazia `mkdir(exist_ok=True)` e nunca apagava.

O predicado passou a ser estreito nos três lados:

- só é removido o diretório que carregue os **dois** marcadores que este exportador escreve
  (`onnx/model_int8.onnx` **e** `parity_report.json`) — a promoção é atômica, então um bundle publicado sempre
  os tem — ou um diretório vazio, que o operador pode ter criado;
- diretório que carregue arquivo de checkpoint (`model.safetensors`, `pytorch_model.bin`, `training_args.bin`,
  `optimizer.pt`, `scheduler.pt`, `trainer_state.json`) é recusado **nomeando o arquivo**, antes de qualquer
  outra leitura;
- `--out` igual ao `--checkpoint`, contido nele ou contendo-o é recusado antes de qualquer remoção — o
  predicado sozinho não bastaria, porque `--out bertimbau` (o pai de `best/`) não carrega arquivo de
  checkpoint algum.

Os dois caminhos derivados também deixaram de ser apagados sem conferência, que era o resíduo que a primeira
lente apontou: `<out>.staging` é reconhecido por qualquer membro de bundle **ou** pelo diretório de scratch
`_fp32` (uma corrida que morreu no meio deixa bundle parcial, então exigir os marcadores impediria a
retomada) e recusa arquivo de checkpoint do mesmo jeito; e um arquivo no caminho do ZIP que não seja ZIP
(`zipfile.is_zipfile`) é recusado em vez de apagado.

### Decisão 4 — um leitor, um parse, e o recibo diz qual arquivo governou

`benchmark/lab/sealed_policy.py` é novo e é o **único** leitor da pré-inscrição do lado Python; os dois
scripts do Colab o importam. Ele resolve o path (checkout, depois a cópia ao lado do script), **parseia** e
devolve `SealedPolicy` com os quatro valores tipados, o `sha256` do arquivo lido e `origin`.

**O achado, na sua forma exata:** `json.loads` não é parse. Todo objeto JSON o satisfaz — e
`benchmark/rebuild-v3-policy.json` está na árvore, tem `backbone` e `onnxMaximumInt8Bytes`, e era aceito
como política selada. O parser pina `policyVersion` e recusa nomeando **campo e path**, incluindo o caso do
booleano onde se espera inteiro (`isinstance(True, int)` é verdadeiro em Python, então `backboneBakeOff:
true` leria como a seed 1).

**Por que virou módulo, contra o instinto de manter cada script autocontido.** O upload do Colab é plano, e
um script autocontido é um arquivo a menos para o operador esquecer. Mas a duplicação era do **resolvedor de
autoridade** — as duas cópias decidiam qual arquivo é a política selada —, e duas cópias de uma decisão
dessas é exatamente a segunda autoridade que este projeto passa o tempo removendo. O preço é um terceiro
arquivo no upload e uma falha nova possível (`ModuleNotFoundError`), que é **alta** e imediata, não silenciosa.
O README foi corrigido nos dois passos.

**Nomear os campos não é identidade: o digest é PINADO.** Esta é a cláusula do A4 que o primeiro fechamento
não pagou — o consolidado dizia "exigir o arquivo e **afirmar o digest**, não aceitar qualquer um", e o
conserto tinha entrado com `policyVersion` pinado e o digest apenas **gravado** no recibo. As duas lentes
mediram a mesma brecha: uma cópia plana com a versão selada, `seeds.publishableCheckpoint: 42` e teto
340 000 000 era **aceita** pelos dois scripts, e a guarda de seed voltava a comparar 42 com 42. Registrar a
divergência num recibo que vive **dentro** do artefato que a corrida divergente produziu não é uma guarda.

`SEALED_POLICY_SHA256` passa a ser literal em `sealed_policy.py`, e o leitor recusa nomeando path, digest
medido e digest esperado. Medido de ponta a ponta num diretório plano isolado: a cópia híbrida é recusada, e
um `json.dumps` da própria política (11 956 bytes contra os 11 742 rastreados) também — uma política recolada
num editor de texto tem outros bytes.

**Por que o digest e não os valores.** Pinar os valores seria reintroduzir a segunda autoridade que este
módulo existe para remover; um digest não é legível como backbone, seed ou teto, então ele afirma **qual
arquivo** sem afirmar o que ele diz. `policyVersion` não serve para isso: ele **não se move** quando a
pré-inscrição é emendada (quatro emendas até aqui, a última três commits atrás), logo não separa uma emenda da
outra.

**O custo, declarado:** emendar `benchmark/preregistration-v4.json` obriga a reescrever o literal no mesmo
commit. O teste do lab compara os dois e reprova até que isso aconteça — é o mesmo pino triplo da Decisão 5,
e a alternativa era um pino que se ajusta sozinho, que não é pino.

**O espelho do argparse saiu.** `--model` e `--seed` tinham default lido do objeto de política que as guardas
conferem, então, quando o operador não passava nada, a guarda comparava um valor consigo mesmo. Agora o
default é `None`: ausente, o valor é **delegado** e a corrida imprime `DELEGADO … (nao conferido)`; presente,
é conferido. `build_parser()` foi extraído para que o teste observe os defaults em vez de ler o código-fonte.

**Registrar a divergência** continua sendo a segunda metade: os dois recibos (`metrics.json` do treino,
`parity_report.json` do export) gravam `policyVersion`, `policyPath`, `policySha256` e `policyOrigin`; o
treino grava também a **seed**, que faltava. `policyOrigin` tem três estados (`tracked`,
`beside-the-script`, `explicit-path`) porque o booleano anterior mentia por omissão: ele dizia `false` também
para um path passado explicitamente e para uma cópia "um nível acima" fora de checkout. O marcador diz
**onde** o arquivo estava; quem diz **o quê** ele continha é o digest. O campo `values`, que ninguém lia, saiu.

### Decisão 5 — oito campos, o vocabulário como ARQUIVO, e o pino vindo da testemunha

`BACKBONE_CONFIG_SHAPE` passa a declarar oito campos por backbone (os quatro anteriores mais
`intermediate_size`, `num_attention_heads`, `max_position_embeddings`, `type_vocab_size`), e um teste de
**totalidade** recusa entrada que não declare todos — uma entrada parcial faria a comparação pular campo em
silêncio.

**O que o remédio anterior não fechou.** A W1 acrescentou `vocab_size`, `hidden_size` e
`num_hidden_layers` a pedido da primeira lente, e o codex mediu o resíduo: um BERT 12×768 de vocabulário
29 794 com `intermediate_size: 16` satisfaz os quatro, exporta limpo, emite as três entradas, escreve
`vocab.txt`, fica **mais** abaixo do teto por ter encoder menor, passa a paridade contra os próprios pesos —
e a função **devolvia** o nome do backbone selado como se tivesse verificado identidade.

**O vocabulário é conferido no arquivo.** `config.json` é editável à mão; `vocab.txt` é o material. Um
fine-tune do BERT cased inglês com o campo corrigido passa por toda comparação de número e não passa pela
contagem de linhas. A conferência roda **duas** vezes: no checkpoint (antes do `import torch`) e no bundle
montado (depois de o tokenizer salvar).

**O pino do teste deixou de ser circular.** Ele era `BACKBONE_CONFIG_SHAPE[SEALED_BACKBONE]`, derivado do
dicionário que deveria verificar. Agora são três asserções: o literal de oito campos; a testemunha
`public/models/cleanfeed-ptbr-v1/config.json` conferida por `sha256` quando ela está no checkout; e — a que
**sempre** roda — que os dois descritores rastreados (`source-lock.json`, `cleanfeed-model.json`) ainda
declaram aquele `sha256` para `config.json` e para `vocab.txt`. Um repack move os descritores, o teste
reprova, e a forma tem de ser rederivada da testemunha nova em vez de ficar sendo o que o dicionário diz.

### O T5 conferido: o procedimento documentado não funcionava, e a causa era desta unidade

Rodado como está escrito, num diretório plano isolado, com `python` 3.11: **`ModuleNotFoundError: No module
named 'sealed_policy'`** na primeira linha do script. A causa é a Decisão 4 — o módulo novo é um arquivo novo
no upload — e o README dos dois passos foi corrigido para subir três arquivos. Um procedimento que só
funciona para quem sabe o que ele não diz não está documentado.

Duas observações da mesma corrida, ambas medidas:

- com o módulo ao lado, o resolvedor achou a política **um nível acima** e não a cópia ao lado, porque havia
  uma cópia solta no diretório pai do isolamento. Ela era byte-idêntica à rastreada, então a corrida não
  divergiu — mas é o mecanismo exato que o recibo passou a registrar: fora de um checkout, "um nível acima"
  não é o arquivo rastreado, é o que estiver lá. Num diretório pai limpo, a cópia plana é usada e a corrida
  imprime `(copia AO LADO do script — layout plano do Colab)`;
- o fallback sem `optimum` chama `torch.onnx.export` com a API do exportador TorchScript, que em `torch` ≥ 2.9
  deixou de ser o default (medido: `DeprecationWarning` em 2.13.0, e o ensaio de § 5.9 precisou de
  `dynamo=False` explícito). O caminho documentado instala `optimum`, então o fallback não roda lá; fixar o
  `kwarg` quebraria `torch` antigo, que não o aceita. Dívida escrita em § 7, sem conserto às cegas.

### Extras aplicados, declarados como extras

- **M2 do `consolidado-w1`** (menor, "vence agora"): a porcentagem de folga do teto não dizia o
  denominador. Agora diz, nos dois sítios: 18,5 % **sobre o medido** (130 000 000 = 1,1852 × 109 681 931),
  com a leitura errada nomeada ao lado (15,63 % se o denominador for o teto).
- `--eval` ausente, vazio, ou `--parity-samples` abaixo de 2 passam a recusar **antes** dos imports pesados,
  nomeando a flag. A razão publicada no primeiro fechamento era falsa e a primeira lente a mediu: amostra
  vazia **nunca** passou — `np.mean([])` é `nan`, `nan < 0,02` é falso, e `np.max([])` **estoura**. O que a
  guarda muda é o momento: a recusa acontece antes dos imports em vez de estourar depois de o int8 já ter sido
  escrito.
- a verificação de `vocab.txt` no bundle passou de "existe" para "existe e tem 29 794 entradas".

### O que esta unidade NÃO fez

- **não** mexeu na pré-inscrição selada: nenhum campo novo foi selado, então `evaluatorDigest` não se move e
  nenhum `fit` é invalidado. A forma de oito campos vive no lab, que está fora de `EVALUATOR_FILES`;
- **não** produziu recibo F6 nem hash de pesos: a metade que liga corpus, split e pesos continua devendo,
  agora com a metade local escrita;
- **não** rodou export real: nenhum artefato ONNX foi produzido nesta unidade, aqui ou fora daqui;
- **não** tocou o M1 do `consolidado-w1` (o pino de 109 681 931 que reprovaria o export legítimo da Fase 6):
  é achado de Fase 6 e move um teste de `preregistration-v4.test.ts`, fora do contrato desta unidade.

### O fechamento de R2: nove bloqueantes das duas lentes, nenhum refutado (2026-08-10)

As duas lentes devolveram `block` com **nove** bloqueantes distintos (três em comum, contados uma vez) e onze
menores. Todos foram medidos antes de consertar, e **nenhum** foi refutado. O tema é único e é o mesmo do
contrato: as guardas estavam **certas como funções** e frouxas onde rodam.

**Os quatro que mudaram uma decisão desta unidade** estão reescritos acima, no lugar da decisão que
substituem, e não como adendo: o piso passa a ser interquartil sobre amostra balanceada (Decisão 1), o par
anônimo de labels é recusado e o pooler entra na guarda (Decisão 2), o predicado de remoção fica estreito nos
três lados (Decisão 3), e o digest da política é afirmado em vez de gravado (Decisão 4).

**Os três que eram de LIGAÇÃO, e o conserto que os fecha de uma vez.** A segunda lente mediu, sobre os bytes
finais, que comentar a chamada de `assert_the_head_came_from_the_checkpoint`, fazer a lambda montar em
`args.out` em vez do staging recebido, ou comentar a asserção de forma do tokenizer deixavam a suíte **verde**
— porque o único teste dessas ligações era `assertIn` sobre o **texto** de `main()`, e uma linha comentada
contém o texto. Uma asserção que não distingue uma chamada de um comentário não é uma asserção.

O conserto: `main(argv=None, build_backend=torch_onnx_backend)` recebe a fábrica do backend, o backend real
saiu para `torch_onnx_backend(args)`, e as duas guardas que leem o **modelo carregado** passaram para o fluxo
(`build_bundle_into_staging`), atrás de dois métodos novos do protocolo — `loading_info()` e
`tokenizer_inputs()`. Agora oito testes dirigem `main()` de ponta a ponta com o `FakeBackend`: publicação
bem-sucedida, cabeça inventada, tokenizer de duas entradas, detector degenerado, `--out` no checkpoint,
`--eval` de uma classe, `--eval` ausente e checkpoint de outra arquitetura. A asserção textual que sobrou é
declarada como cinto e não como prova.

Efeito colateral bom: a asserção de tokenizer deixou de rodar 120 vezes (uma por documento) e passou a rodar
uma vez, sobre um texto de sonda, antes do export.

**Os menores aplicados:** o tipo de `id2label` conferido (era `AttributeError`), o comentário e a mensagem que
atribuíam `meanAbsDelta 0` à cabeça **aleatória** corrigidos para separar zerada (delta exatamente 0) de
aleatória (amplitude medida 0,00358), a alegação falsa sobre amostra vazia trocada pelo fato medido, os dois
caminhos derivados (`<out>.staging`, o ZIP de staging) deixando de ser apagados sem conferência, o marcador de
origem da política com três estados, o campo `values` removido, e o M4 do `consolidado-w1` fechado — a
terceira testemunha (`rebuild-v3-policy.json`) agora está na lista que a contagem afirmava.

**O menor que NÃO foi aplicado, com a razão:** o M3 do `consolidado-w1` — nenhum teste semântico amarra
vocabulário real + três entradas do grafo + três entradas alimentadas em `src/inference/onnx-classifier.ts` —
continua aberto. Ele exige um artefato ONNX real (`onnxruntime` não existe no interpretador do lab) e
atravessa a fronteira TS↔Python, que é outra unidade; a metade que se podia pagar aqui está paga (a forma do
grafo é observada no artefato, e a contagem de linhas do vocabulário é conferida no checkpoint e no bundle).
Dono: a unidade que rodar o export real, ou a Fase 4 na primeira corrida do operador. Está na dívida de § 7
junto do lado ONNX da degenerescência.

### A bateria de mutação do fechamento: 36 + 2, rodada por último sobre os bytes finais

Cinco passos por mutação (base verde → mutação → vermelho no **teste nomeado** → restauração → `sha256`
conferido), a suíte do lab verde nas duas pontas (118 testes + 31 subtests, contra 85 + 25 antes), e
`sha256` inicial igual ao final nos três arquivos de produção mutados: `export_onnx.py`
`40527204fa44b8c5ba406a6396e1b19bc99a4c577f3a798b7c4b0b6a6da2f228`, `sealed_policy.py`
`c1cead33c16f68d519b8e22cd682a906acea416e65aebd32470ec6bec49664de`, `train_detector.py`
`c147a82e1f9453500e024f5b63df2a541d5ef433e4bae886df78f2100f603ac7`.

As **onze** mutações que as duas lentes pediram por nome estão todas vermelhas: a guarda da cabeça comentada
(N01), a asserção do tokenizer comentada (N02), a lambda montando em `args.out` (N03b), a estatística do piso
voltando a ser amplitude (N05), a amostra de uma classe voltando a ser aceita (N09), o diretório com pesos de
treino voltando a ser apagado (N16), `--out` igual ao checkpoint deixando de ser recusado (N19), o staging
alheio voltando a ser apagado (N21), o digest da política deixando de ser afirmado (N29), `id2label` de tipo
errado voltando a estourar (N26), o pooler saindo do conjunto que não pode ser inventado (N25). As demais
cobrem o resto do diff: quantil, veredito, sorteio, marcadores, anúncio da remoção, ZIP, origem da política,
espelho do argparse.

**Honestidade da bateria:** duas mutações da primeira passada não morderam por **erro de alvo meu**, não por
lacuna de guarda, e o diagnóstico é medido. N03 apontava para o teste da cabeça inventada, cuja recusa
acontece no **primeiro** passo do fluxo — montar em `args.out` não deixa nada lá porque nada foi escrito
ainda; contra a recusa a jusante (detector degenerado, que escreve o bundle inteiro antes de reprovar) fica
vermelha. N18 pedia alargar a lista de marcadores, que sob `all(...)` é mutação de **estriteza** e não de
frouxura: ela recusa a publicação anterior legítima, então quem a pega é a corrida que publica **duas** vezes
— e aí fica vermelha. A frouxura equivalente é `all` → `any`, que é N17 e morde. O adendo com N03b e N18b
rodou **depois**, sobre os mesmos bytes finais, com `sha256` conferido.

---

## A auditoria de 2026-08-10: oito dos dez consolidados nunca foram processados

Levantamento feito a pedido do operador ("havia correções após a validação do codex e do Fable; veja se
ainda falta algo"). **Somente leitura**: nenhum arquivo do repositório foi editado, nenhuma suíte rodou,
nenhuma partição cega foi tocada. Treze agentes — dez auditores, um por relatório, e três refutadores —,
622 leituras de arquivo, achado por achado contra o HEAD `23e26cb`.

**O fato estrutural, e é ele que responde à pergunta.** A cross-review de dez unidades de 2026-08-09
devolveu dez relatórios. Desde então entraram **dois** commits de conserto: `f5bb548` (R1), que pagou o
`consolidado-c`, e `23e26cb` (R2), que pagou o `consolidado-w1`. **Os outros oito relatórios nunca foram
processados** — não foram consertados, não foram refutados e não foram declarados como dívida com dono.
`git diff --name-only 9894492..HEAD` não contém a maioria dos arquivos que eles citam, e a auditoria
confirmou por leitura que o mecanismo de cada achado está intacto, com os identificadores nos mesmos
sítios e os números de linha deslocados onde o código andou.

**O placar, depois da refutação adversarial.** Dos 30 bloqueantes que a primeira passada declarou abertos,
**7 foram refutados** e **23 confirmados**. Os menores abertos somam **31**, e eles **não** passaram pela
refutação — o número é da primeira passada e vale como estimativa, não como veredito.

### Os 7 refutados, e por que nenhum deve ser consertado

| achado | por que cai |
|---|---|
| `parent-disagreement` vacuosa (consolidado-a #2, na leitura de um segundo auditor) | `assertDerivedParentsResolve` **não** é ramo morto: `benchmark/commands/split.ts:116` a chama antes de `createBlockedSplit`, e `benchmark/split.ts:481-485` contradiz a premissa de que o pai da linha mista nunca está no array |
| `generatorVersion` colapsa a classe gerada (consolidado-b #2) | já é dívida com dono em `ESTADO.md` § 7 — o que **não** está declarado é o co-causador `promptTemplate`, e isso ficou na fila |
| `lengthBucket` de `slices.ts` decide (sondas-tema B5) | `benchmark/slices.ts:288` lido contra `preregistration-v4.json:245` e `gates.ts:849-850`: a fatia não é elegível a gate |
| a barreira de cluster nomeia partição do vocabulário antigo (emenda-moldura B5) | `registro-de-decisoes.md:4189` já traz a decisão, com a razão escrita |
| a exclusão de `generatorFamily` da união (emenda-moldura B3, primeira leitura) | `benchmark/split.ts:173-184` contra `registro-de-decisoes.md:2417-2438` e `ESTADO.md` § 3.4: a exclusão é a política, não um descuido |
| `corpus-sources.md` publica fonte fora da moldura (emenda-moldura B4) | `docs/corpus-sources.md:602-604` já a declara fora |
| o mascaramento de entidades promovido a hipótese (sondas-tema B3) | `ESTADO.md` § 3.1 (AG) e `entity_masking.py:87` declaram as quatro sondas como diagnóstico |

### Os 9 que mordem AGORA — comando que o operador roda na Fase 3 ou 4

Cada um foi lido nos sítios que o mecanismo ocupa, e nenhum tinha linha em § 7 nem no registro:

1. **`validate` sela e sai 0 sobre corpus bloqueado.** `benchmark/commands/validate.ts:121-130` grava
   `source-readiness.json` e devolve `Dataset sealed: …` sem ler `readiness.status`; a face que recusa
   (`assertMaterialBatchesResolve`, `benchmark/schema.ts:3851`) segue sem chamador de produção, com
   docstring afirmando o contrário. A mitigação existe a jusante (`candidate-preflight.ts:294`,
   `commands/fit.ts:291`), então nenhuma calibração congela sobre corpus bloqueado — o dano é o comando
   de selagem publicar sucesso.
2. **`groups: {}` atravessa o ledger inteiro.** `cluster-exposure-ledger.ts:534-539` só exige objeto não
   nulo; `buildEventRecords` (:1892-1893) itera as entradas e sai com `groupDigests` vazio;
   `validateEventShape` confere presença de chave e não completude; `exposureInputsFromRecords` (:2505),
   o único que derivaria os eixos dos registros, não tem chamador de produção. Exposição registrada sem
   eixo é barreira de cluster que não barra.
3. **`extractionRun` continua sendo o nome do arquivo de pool.** `assemble_corpus.py:2676` estampa
   `extraction_{fname}` por `setdefault`, sob comentário que afirma "the pool FILE is the run", então a
   recusa nova `MissingExtractionRun` (:1361-1366) **nunca morde no caminho de pool** e o valor inventado
   chega ao registro selado com estado `known`. O item 6 de `2026-08-02-lotes-e-unidade-de-dependencia.md`
   segue vencido.
4. **A guarda de viabilidade recusa o corpo que os próprios construtores montam.**
   `assert_components_can_fill_five_partitions` é a primeira instrução de `assign_partitions`
   (`assemble_corpus.py:2591`) e a fração é **por classe** (:2288-2318), enquanto `promptTemplate` (:1104)
   e `generatorVersion` (:1106) unem a classe gerada num componente que lê 1,0000 — `UnsplittableCorpus`
   aborta antes de qualquer carimbo, com `records.jsonl` não escrito. Tirar só `generatorVersion` deixa o
   maior componente em 54,79 %, acima de 45 % + 2 pp: **continua recusado**, e `promptTemplate` não está
   declarado em dívida nenhuma.
5. **`requiredHumanSourceTypes` exige presença, não pertença.** `dataset-manifest.ts:915-921` reprova só
   quando a contagem da célula é zero, `:894-896` não conta a ausência e `humanSourceType` é opcional no
   esquema (`schema.ts:2245-2250`): uma linha humana sem célula passa o gate da moldura.
6. **O manifesto de fontes promete não carregar URL e o produtor grava uma.**
   `build_governance.ts:75-79` põe `https://dumps.wikimedia.org/…` em `evidence`, contra a promessa de
   `source-manifest.ts:23-31` ("carries NO source URL, name, handle or raw consent receipt"), repetida no
   runbook:427-428. Nenhuma guarda confere.
7. **O gate de composição não deixa recibo.** `auditReleaseComposition` tem um único sítio
   (`commands/split.ts:169`, dentro de `scientificUse === "release"`), o veredito só alimenta a mensagem
   de erro, e nenhuma das 14 chaves de `SEALED_ARTIFACT_KEYS` (`split-artifact.ts:103-118`) o carrega:
   **passar não deixa prova**.
8. **O piso barato compara as duas AUCs contra o mesmo vetor humano inteiro.**
   `baseline_tfidf.py:717-726` monta `reserved` (108) e `core` (145) contra as **mesmas** 253 humanas, sem
   `class_weight`, e `read_ood_easiness` lê uma contra a outra — o pareamento vale para a união, não dentro
   de cada família.
9. **A junção parcial da sonda passa silenciosa.** `baseline_tfidf.py:740-747` só recusa população
   **vazia**; 20 de 253 humanas casadas rodam a AUC enquanto `block["rows"]` (:707-716), montado antes de
   o arquivo de escores ser lido, continua publicando 108/145/253 do pool.

### Os 14 que mordem antes de PUBLICAR — Fase 6 ou 7

Nenhum deles muda o comportamento de um comando de hoje; todos entram num artefato ou num número que a
Fase 6 imprime. Agrupados pela forma do defeito:

- **prosa selada que descreve moldura de quatro células**, viva em cinco sítios (`split-audit.ts:93`,
  `preregistration-v4.ts:390`, `assemble_corpus.py:2121`, `references.md:822` e `:846`,
  `cross-validation.ts:31`) enquanto `preregistration-v4.json:266-268` declara uma. `split.ts:176-181` já
  foi reescrito e mostra a leitura certa;
- **aritmética publicada de `m=7` apresentada como custo vigente**: os "16.000 linhas humanas" de
  `registro:4091` e `plano-entrega-modelo.md:49` são de α = 0,05/7; sob `m=4` o teto de 0,55 % pede 897
  linhas em `test`, não 800;
- **duas errata de número**: `references.md:4631` e `registro:6114`/`:6186` dizem "0,041 de AUC" onde
  0,9313 − 0,8944 = **0,0369**; e `ESTADO.md` § 7 dizia "53.º maior de 1.050" onde o código
  (`provisional-threshold.ts:243-244`, `ceil(q·n)` zero-based) dá **52** — a prosa publicava o número da
  convenção que o comentário do próprio código recusa por nome. O "30.º de 600" está certo, e a linha de
  § 7 foi corrigida nesta unidade porque errata de um número não precisa de unidade própria;
- **duas grafias do mesmo conceito, uma delas pinada no selado**: `independentUnit:
  "origin-document-components"` (`preregistration-v4.json:48`, pinada por `literal()` em
  `preregistration-v4.ts:1549-1553`) contra `powerInventoryUnit: "connected-components"` (:261); e
  `reportedAxes` (política) contra `REPORTED_GROUP_AXES` (auditoria), hoje **coincidentes em valor** — o
  que falta é a costura de igualdade, e o risco é a deriva futura entrar num artefato selado;
- **quatro guardas cujo alcance é menor que a alegação que fazem**: `digests.test.ts:344` usa `toContain`
  sem âncora de seção (passa hoje só porque o digest ocorre uma vez em `ESTADO.md`, e um bloco "Histórico"
  com o valor novo satisfaria a asserção com a linha viva estagnada);
  `dataset-manifest.test.ts:1434-1453` varre `benchmark/*.ts` e `benchmark/commands/*.ts` e por
  construção **não** vê `benchmark/tests/**` nem `benchmark/lab/*.py`, e não lê o número do bloco cego que
  derivou junto (`split-audit.ts:119-120`); `source-manifest.test.ts:830-839` proíbe o `sourceId` entre
  backticks e não o **nome** publicado, então um bullet "Corpus Carolina — CC BY-NC-SA" passa; e o
  fatiador de `test_extractors.py:1526-1539` conta profundidade de chave sem noção de string ou
  comentário, com docstring afirmando que "comments and field order irrelevant" — o dano hoje é zero
  (`build_governance.ts:65-81` declara um lote sem chave dentro de string), e o fail-open real é o lote que
  nunca chega a ser fatia e desaparece sem ninguém contar quantos objetos a fonte declara;
- **`BenchmarkReport` sem parser**: três `as BenchmarkReport` sobrevivem (`publish-evidence.ts:152`,
  `publish-profile.ts:40`, `verify-evidence.ts:35`), e `verify-evidence.ts:53` decide o ramo lendo o
  objeto castado;
- **dois defeitos de medição no lab**: `entity_masking.py:551` usa `labels.get(row_id) == wanted`, e id sem
  rótulo sai das **duas** classes sem ninguém contar (`:536-546` fecha a igualdade só entre os três braços);
  e `baseline_tfidf.py:590-618` deixa o lado `ai` dependente da **ordem dos argumentos** — o único `sorted`
  do caminho é o dos pais (:605), então a AUC publicada muda se a ordem dos arquivos de pool mudar;
- **a alegação das "quarenta mutações" do Commit A** não tem portador rastreado: o único arquivo que a
  carrega está sob `.gitignore:63`. O padrão de bateria registrada **existe e foi cumprido duas vezes**
  (`registro:6661` e `:5031`), o que torna a lacuna deste commit visível por contraste.

### Custo de reversão e o que esta unidade NÃO fez

Zero em código: nada foi consertado, e a única edição fora deste registro é a fila em `ESTADO.md` § 7 mais
a errata do ordinal do quantil. A fila não é documento novo de plano (§ 3.7 proíbe) — é dívida no arquivo
de estado. Os 31 menores abertos **não** foram refutados um a um e ficam declarados como estimativa; a
refutação deles é da unidade que abrir cada relatório.

**RETRATADO em 2026-08-11 — o parágrafo desta unidade sobre a cota do codex estava errado, e o erro é de
inferência.** O que ele dizia: *"A cota do codex também foi sondada nesta unidade e não voltou: a mensagem
de 2026-08-10 diz `try again at Aug 16th, 2026 6:51 PM`, contra os 8 de agosto que a medição anterior
imprimia. A data que a mensagem publica é móvel, então a etapa 3 continua sendo do Fable."* Fica na
íntegra porque este registro é append-only e porque o erro ensina.

O que a evidência de arquivo mostra, reconstituída a pedido do operador com quatro leituras independentes:

- a cota **voltou** na janela que a mensagem de 2026-08-02 prometia (`Aug 8th, 2026 4:25 AM`), e a data
  estava **correta**;
- ela foi **gasta** numa rodada única na noite de **9 de agosto**: `run-codex-dez-unidades.sh` (mtime
  18:50:55) disparou **dez** chamadas reais de `codex exec` — dez `session id` distintos —, das quais
  **oito** terminaram com `EXIT=0` entre 19:08:14 e 22:04:24, consumindo **3.102.744** tokens (245.145 a
  487.438 por unidade) e produzindo vereditos de 0,7 a 3,3 MB;
- a janela fechou **no meio da própria rodada**, entre a oitava e a nona unidade, com **4 segundos** entre
  o último veredito (22:04:24,019) e o primeiro estouro (22:04:28,187). As duas cortadas foram as posições
  9 e 10 da fila, que o script ordenou por consequência exatamente para isso: *"se a cota acabar no meio, o
  corte cai nas menos consequentes"*. Morreram com `EXIT=1` e **zero token**;
- o operador passou as duas ao **Fable** na mesma noite (`fable-e` 22:59:54, `fable-f` 23:00:20), e as duas
  se declaram substituição no cabeçalho, com seção própria dizendo que continuam **devendo** rodada de
  codex;
- **nada rodou no dia 8**: não há um arquivo com mtime de 2026-08-08 em `.codex-reviews/`, nem commit entre
  2026-08-07 14:12 e 2026-08-10 12:14. O dia 8 é quando a janela abriu, não quando foi usada.

**Onde exatamente eu errei, porque a forma do erro é reutilizável.** A sonda de 2026-08-10 não descobriu
nada: `Aug 16th, 2026 6:51 PM` ocorre **quatro** vezes na árvore, todas as quatro dentro dos dois arquivos
`*COTA-ESGOTADA*` escritos na noite anterior. Eu li uma data futura como prova de que a cota **nunca**
voltou, quando ela é um **selo de fim de janela recalculado a cada estouro** — afirma que a janela atual
está fechada e nada sobre as janelas anteriores. Pior: a árvore em que eu escrevi "não voltou" continha, um
dia antes, oito vereditos de codex com `EXIT=0` e 3,1 milhões de tokens gastos. **A evidência do contrário
estava no diretório que eu estava auditando.** A regra derivada está em `ESTADO.md` § 7 como regra de
leitura permanente.

**Um segundo achado, que é armadilha de método e não de fato:** `run-codex-dez-unidades.sh:20` escreve a
sentinela `===CODEX-<u>-PRONTO=== N bytes` **depois** do `EXIT=$?` e **sem condição**, então
`.sentinelas.log` publica `PRONTO` para as dez unidades — inclusive para as duas que morreram na cota
(`20233` e `23241` bytes de eco de prompt). Um runner cuja sentinela não distingue sucesso de estouro
transforma o padrão de continuidade em fonte de falso positivo: quem audita pela sentinela lê 10/10
concluídas. Sentinela de conclusão precisa carregar o código de saída, não só o fato de o processo ter
terminado.

Nada disso muda o placar da auditoria — os oito relatórios cujos achados ninguém processou continuam sendo
oito, e dois deles (`fable-e`, `fable-f`) são do Fable e não do codex, o que já era verdade quando a
auditoria os leu. O que muda é a moldura: a etapa 3 da rodada das dez foi majoritariamente **do codex**, e
as unidades que devem codex hoje são quatro, nomeadas em § 4.

**A leitura de método que a auditoria produziu, e vale como regra:** um relatório de cross-review não é
uma dívida registrada. Oito relatórios com veredito `block` ficaram nove dias na árvore sem que nenhuma
linha de § 7 os mencionasse, e a única razão pela qual isso foi descoberto é o operador ter perguntado.
**Fechar uma rodada de revisão inclui escrever, no arquivo de estado, o que ela achou e não se consertou —
com dono e vencimento.** Sem isso, `block` viaja como se fosse `pass`.

---

## A onda A1: quatro dos nove que mordiam agora, e as duas rodadas que a revisão exigiu (2026-08-11)

Primeira onda de conserto da fila que a auditoria de 2026-08-10 levantou. **Quatro unidades, escolhidas
por PROPRIEDADE DE ARQUIVO DISJUNTA** para poderem correr ao mesmo tempo sem se invalidarem — a lição
registrada de que agentes em paralelo mutando a mesma árvore destroem a verificação que se pediu. Cada
unidade recebeu a tríade completa: desenho antes do código, implementação contra o contrato,
cross-review adversarial.

| unidade | defeito | veredito |
|---|---|---|
| U1 | `validate` selava e saía 0 sobre corpus `blocked` | `pass` na 1.ª rodada |
| U2 | `groups: {}` atravessava parse, evento e atestado do ledger | `pass` na 2.ª |
| U6 | o manifesto prometia não carregar URL e o produtor gravava uma | `pass` na 3.ª |
| U8 | o piso barato comparava as duas AUCs contra o mesmo vetor humano, e a junção parcial passava silenciosa | `pass` na 3.ª |

### O que a revisão adversarial pegou, e por que ela é o passo que decide

**Três das quatro voltaram `block` na primeira rodada**, e nenhum dos três bloqueantes era erro de
mecanismo: os três eram **guardas certas que não mordiam onde rodam**, ou comentários prometendo mais do
que o código impõe. É a mesma família que este registro já nomeou três vezes.

- **U2** — a metade CLI da guarda não tinha teste nenhum, nem textual: o revisor apagou dois dos quatro
  sítios de `axisCoverageNote` e a suíte deu **99 passed**. O conserto fez o teste dirigir `runCli` e
  afirmar a string impressa; as duas mutações do revisor ficaram vermelhas em teste nomeado.
- **U6** — o comentário da guarda nova afirmava que a whitelist de forma fechava a CLASSE de localizador
  em `evidence`, e o revisor mediu pela API pública que `dumps.wikimedia.org (10 bytes)` é **aceito**. A
  prosa passou a dizer o que de fato está fechado, e cada resíduo declarado ficou **fixado por teste como
  aceito** — para que a próxima pessoa não releia a declaração como promessa. Na terceira rodada a mesma
  espécie apareceu num **terceiro** sítio (o doc do próprio campo `evidence`), e é a que esta unidade
  fechou por último.
- **U8** — a guarda G3 não estava fixada em nenhuma das duas pontas: o revisor a matou apagando o sítio de
  chamada (**57 passed**) e trocando `set(...) == set(...)` por `len(...) == len(...)` (**57 passed**),
  que é literalmente a condição-suficiente-deduzida-do-critério. Consertada, a segunda reconferência
  achou que o sítio de chamada estava fixado só para **metade** do que faz: restringir o laço a
  `("reserved",)` deixava a suíte verde, e a fatia `core` — que é o denominador de `excessLift` — ficava
  sem observação. O teste passou a ser parametrizado sobre as duas fatias.

### O que isto ensina sobre a bateria de mutação

A bateria não é cerimônia: **em três de quatro unidades ela foi o único instrumento que separou "guarda
escrita" de "guarda que morde"**, e nas duas reconferências ela pegou meia-cobertura que a leitura do diff
não pegaria. O padrão que se repete é sempre o mesmo — o implementador testa a guarda **chamando-a
direto**, e o defeito vive na LIGAÇÃO entre ela e o fluxo. Um teste que chama a guarda direto prova o
critério e nada sobre o sítio; o que prende o sítio é um teste que atravessa a API pública.

Uma nota de honestidade sobre a segunda reconferência de U8: a mutação que sobreviveu (`for name in
populations:` → `for name in ("reserved",):`) **não** é mutante equivalente, e o revisor provou em vez de
alegar — com a mutação aplicada, um `core` lido sobre duas populações diferentes publica `excessLift`
−0,5 e veredito `no-headroom` com todas as contagens de acordo.

### Integração, e o que ela custou

Feita com a árvore quieta, depois de as quatro unidades fecharem.

- **`evaluatorDigest` moveu**, como tinha de mover: cinco dos arquivos tocados são membros de
  `EVALUATOR_FILES`. `d69f62bc…` → `c04d7b94a9f71a6a32ba9a76fba921c10d4c1faf7c58de1d9d0f610ee4248062`.
  Durante a onda o `digests.test.ts` ficou vermelho de propósito e as unidades foram instruídas a não o
  tocar — republicar o digest é ato de integração, e uma unidade que o "consertasse" estaria escondendo o
  que ela mesma moveu.
- **Uma regressão real, em arquivo que nenhuma unidade podia tocar**: a guarda nova de U6 derrubou 5
  testes de `corpus-source-audit.test.ts`, cujas fixtures usavam
  `https://exemplo.invalido/…sha256` **como evidência**. A guarda está certa e a fixture era ilegítima
  sob o contrato novo: as duas entradas passaram a ser um digest e um arquivo com bytes. O implementador de
  U6 declarou essa consequência e o revisor a mediu — foi declarada, não descoberta na integração, e é a
  diferença entre dívida e surpresa.
- **Um comentário falsificado por reordenamento**, também fora da propriedade: `benchmark/lab/audit_sources.ts`
  dizia que `validate` roda a auditoria "only AFTER sealDataset", que era o defeito que U1 consertou. O
  WHY da ferramenta standalone continua válido — ler os códigos de governança de um build **incompleto**
  —, e é isso que o comentário diz agora.

**Medido na integração, com a árvore quieta e em rodada ÚNICA:** vitest **172 arquivos / 2.929 testes**,
verde; pytest do lab **577 testes / 117 subtests**, verde; `tsc` limpo nos três projetos; `prettier`
limpo; lint nos mesmos **12** pré-existentes (10 sob `.cache/chrome-for-testing/`, 2 avisos de
`react-refresh` em `src/`). A suíte cresceu 64 testes no vitest e 46 no pytest.

**Custo de reversão:** cada unidade é um conjunto de arquivos disjunto, e reverter uma não move as outras;
o digest volta ao valor anterior recomputando. As referências entraram como § R de `references.md`, no
mesmo commit, com as quatro âncoras (Saltzer & Schroeder 1975 para as duas recusas fail-closed, *Parse,
Don't Validate* para a totalidade do eixo, RFC 3986 § 3.2 para o critério de localizador, Stuart 2010 para
o pareamento como propriedade da análise).

**A dívida de codex permanece nas quatro.** A etapa 3 foi do Fable, e rodada do Fable não fecha dívida de
codex — a janela de cota está fechada até 16 de agosto, e a decisão de em que gastá-la é do operador
(§ 4 do ESTADO).

---

## A onda A2: as três passaram na primeira rodada, e o que mudou foi o mandato (2026-08-11)

Segunda onda da mesma fila, mesma forma: três unidades de propriedade de arquivo disjunta, correndo em
paralelo, cada uma pela tríade desenho → implementação → cross-review adversarial.

| unidade | defeito | veredito |
|---|---|---|
| U3 | `extractionRun` era o nome do arquivo de pool, e o `setdefault` do loader fazia a recusa nunca morder | `pass` na 1.ª rodada |
| U5 | `requiredHumanSourceTypes` exigia PRESENÇA de uma linha da célula, não pertença de todas | `pass` na 1.ª |
| U7 | o gate de composição não deixava recibo: passar não produzia prova | `pass` na 1.ª |

**Três de três na primeira rodada, contra uma de quatro em A1.** A diferença não está nas unidades — está
no mandato: as lições que A1 pagou com duas rodadas extra entraram escritas no prompt de A2. Em concreto,
os implementadores foram instruídos de antemão que (i) o comentário não pode prometer mais do que o
mecanismo impõe, com o exemplo medido da whitelist que fechava uma grafia e a prosa dizia classe; (ii) um
teste que chama a guarda direto prova o critério e **nada** sobre o sítio de chamada; (iii) se o sítio é um
laço, o teste tem de exercitar todos os casos, porque restringir o laço a um deixou uma suíte verde. Os
três revisores atacaram exatamente essas formas e não acharam nenhuma.

O que isso sugere, e vale como método: **a revisão adversarial não é só o filtro, é a fonte do próximo
mandato.** Uma rodada de `block` que produz apenas um conserto foi mal aproveitada; a mesma rodada, lida
como uma lista de famílias de defeito para o prompt seguinte, muda o rendimento da onda inteira.

### As três decisões de desenho, e por que cada uma é a que é

**U3 — quem carimba, e com quê.** O eixo passou a ser derivado no extrator, no mesmo `writer.offer` que já
escreve o lote, como `er_<módulo>_<versão do material>_<sha256 dos bytes do módulo>`. Não há relógio no
valor, por decisão de recomputabilidade — o id é reproduzível de quem tem o módulo e a versão —, e o preço
está declarado: **duas execuções sobre o mesmo dump com `--limit` diferentes compartilham o id**, o que é
fixado por teste em vez de silenciado. O que o valor nomeia é o módulo e a versão do material, e nada mais
largo; o vocabulário do plano de 2026-08-02 pedia "o que rodou, quando, com que código", e o *quando* é a
única palavra que o eixo entregue abandona.

Pool que o extrator não carimbou é **contado fora**, não abortado — a simetria com `MissingMaterialBatch`,
que é a decisão já vigente para queda de linha por eixo ausente.

**U5 — gate e não esquema.** A alternativa era tornar `humanSourceType` obrigatório no esquema da linha
humana. Foi recusada com medição: `assemble_corpus.py` já escreve a célula em **toda** linha humana
(inclusive as seis famílias de hard negative, que `HN_REGISTER` aponta para `ptwiki`), então o critério do
gate é satisfazível pelo material de 2026-08-06 **sem** mudar esquema — e a rota do esquema transformaria
86 literais `label: "human"` do próprio bench em erro de parse sem ganhar nada. A recusa nomeia cada grafia
observada fora da moldura, em ordem, e diz quantas deixou de listar.

**U7 — o recibo dentro do artefato selado.** A alternativa era arquivo ao lado. Foi recusada pela ligação:
o valor de um recibo é ser **transitivamente ligado** ao que ele atesta, e um arquivo vizinho é atestado de
nada. `compositionReceipt` virou chave obrigatória de `SplitArtifact` (`null` fora de `release`), o critério
dos três limites é **chamado** e não copiado — `compositionBoundsOf` lê cada limite do seu próprio campo da
política —, e `validateSplitArtifact` **reconta** o recibo a partir dos registros e das atribuições,
comparando por digest canônico. Mais o par: atestado e recibo caem juntos, porque os dois derivam de
`scientificUse: "release"` e um sem o outro descreve um corpus que é release e não é.

### Os minores que ficaram, com dono

Nenhum bloqueante sobrou; os revisores devolveram nove minores, todos declarados. Os que valem registro:

- o sítio de `commands/split.ts` está preso à **recusa**, não a ler o recibo **selado**: trocar
  `artifact.compositionReceipt` por uma recontagem local deixa a suíte verde. O revisor mediu e não
  bloqueou porque a propriedade **não é observável por construção** — as duas formas chamam a mesma função
  sobre o mesmo objeto —, e o que sobra é prosa afirmando um desenho que nenhum teste sustenta;
- `COMPOSITION_RECEIPT_ABSENT` é inalcançável em produção e, ao contrário do irmão
  `SPLIT_ARTIFACT_COMPOSITION_RECEIPT_UNEXPECTED`, não está declarado como tal;
- uma cláusula aritmética de boa-formação (`linesInBusiestOriginDocument <= humanNegativeLines`) não tem
  teste e não aparece na prosa que enumera as outras quatro;
- o comentário de `extraction_run_id` diz "nobody can reuse one run's name for another run", e o mecanismo
  permite exatamente isso; o que ele impõe é "nobody can hand-pick a run's name";
- o comentário do braço de release de `sealDataset` atribui ao `runSplit` uma proteção que ele não impõe: o
  audit liga-se aos BYTES dos registros, nunca à *release-ness* do selo.

### Integração

- **`evaluatorDigest`**: `c04d7b94…` → `fdb42887ade3715d10470c778282a76e5bc44e6fb0210b13dd5635b863f551fb`.
- **A chave nova quebrou duas fixtures de publicação**, declarado por U7 e fora da sua propriedade:
  `evidence.fixtures.ts` monta `SplitArtifact` à mão. O conserto **não** foi digitar um recibo: os dois
  sítios passaram a chamar um helper que autora a linha da célula e **deriva** os limites e o veredito das
  funções de produção (`compositionBoundsOf`, `compositionBreachesOf`) — um veredito digitado ali
  concordaria com uma política mudada e ninguém notaria. E o teste que anula o atestado passou a anular o
  recibo junto, porque o par é conferido antes e ele provaria a guarda vizinha.
- Medido em rodada ÚNICA, árvore quieta: vitest **172 arquivos / 2.975 testes** verde; pytest do lab
  **589 testes / 124 subtests** verde; `tsc` limpo; `prettier` limpo; lint nos mesmos **12**
  pré-existentes; `docs:check` 207/207.

**A dívida de codex permanece nas três**, como nas quatro de A1: a etapa 3 foi do Fable, e a janela de cota
está fechada até 16 de agosto.

---

## U4 — a lista de união cai de sete para cinco, e o carimbo passa a ser por componente (2026-08-11)

Último dos nove bloqueantes que mordiam agora, e o único que **emenda a pré-inscrição selada**. Decidido
sob a autonomia que o operador delegou em 2026-08-11 ("implementação de todos os itens bloqueantes sem
consulta prévia, o agente decide e registra para conferência posterior, com os três gates"). **Isto é o
registro para essa conferência**: o que segue é suficiente para reverter sem reconstruir o raciocínio.

### O defeito, e por que ele não era o que parecia

`assert_components_can_fill_five_partitions` é a primeira instrução de `assign_partitions` e compara a
fração **por classe**. Com `promptTemplate` e `generatorVersion` na união, a classe gerada colapsava num
componente de 100 % e `UnsplittableCorpus` abortava a montagem antes de qualquer carimbo. A leitura fácil
era "`generatorVersion` é a família sob outro nome, e unir por família já é inadmissível". **Essa leitura é
falsa, medida:** `generatorVersion` tem **cinco** identidades contra **uma** de `generatorFamily`, e as duas
coincidem em **0 de 1170** linhas — version REFINA family, logo unir por version é estritamente mais
**fraco** que unir por família, e o argumento da família não alcança este eixo.

Medido por mim, com os helpers do próprio catálogo, sobre `forma-medida-da-classe-gerada` (1170 linhas):

| eixos na união | componentes | maior | cabe? |
|---|---:|---|---|
| base (os cinco de hoje) | 1.170 | 1 (0,09 %) | sim |
| + `generatorVersion` | 5 | 493 (**42,14 %**) | **sim** |
| + `promptTemplate` | 4 | 641 (54,79 %) | não |
| + os dois | **1** | 1.170 (**100 %**) | não |

**É o FECHO DO PAR que compra a exclusão**, e nenhum dos dois eixos sozinho: uma corrida de versão
atravessa fronteiras de template e um template atravessa corridas de versão, então juntos eles fecham
transitivamente sobre a classe inteira. A perna que CABE entrou no catálogo como
`generatorVersionOnly` e é afirmada nos dois lados — ela existe para impedir a razão falsa de voltar.

### O que foi decidido

1. **`GROUP_KEYS` cai de sete para cinco**: `author`, `source`, `generationBatch`, `nearDuplicate`,
   `derivationRoot`. `promptTemplate` e `generatorVersion` passam a **REPORTADOS**, que é o padrão já
   ratificado em G0.1-bis para `domainSource` e `sourceMaterialBatch`.
2. **A lista tem CRITÉRIO, e ele é condição NECESSÁRIA — nunca definição.** Todo eixo da união satisfaz
   (a) identificar material (`EXPOSURE_IDENTITY_AXES`) ou (b) ser **inerte medido** sobre o corpo
   (`INERT_UNION_AXES`, export novo, dois membros admitidos por medição). `GROUP_KEYS ⊆ (a) ∪ (b)` é
   asserção executável, então um sexto eixo não chega com parágrafo.
3. **A recíproca é declarada FALSA**, com os dois eixos que a refutam nomeados no próprio texto:
   `humanSeed` cumpre (a) e está em `PARENT_LINKAGE_AXES`; `extractionRun` cumpre (b) e é diagnóstico. Ler
   o critério como bicondicional concluiria que `humanSeed` deve entrar na união — a mudança que esta
   unidade **rejeitou**, e sobre o exato eixo em que a casa registra ter publicado alegação falsa uma vez.
4. **A situação de um eixo é decidida por QUATRO listas**, não pelas pernas: `groupAxisRole` é função total
   sobre os quinze eixos, e o **resíduo** que as quatro não cobrem está escrito —
   `generatorFamily`, `generationLane`, `harnessVersion` e o v3-only `collectionBatch`.
5. **`assign_partitions` carimba por COMPONENTE CONEXO**, com a guarda chamada de dentro dela. Era passeio
   por posição, que corta componente por aritmética quando a fronteira cai em índice ímpar.

### Onde a dependência de prompt passa a viver, e o que perdemos

**Não** no ledger: `cluster-exposure-ledger.ts` exclui os eixos de receita da comparação de elegibilidade
**por decisão ratificada** (ESTADO § 3.4 — conhecimento de estrato, lote, receita ou semântica não invalida
material). Ela passa a viver na **tabela de reamostragem congelada**, que é mecanismo e não promessa:
`resampling.estimandClasses["ai-recall"]` é hierárquica em `generatorFamily → promptTemplate →
generationBatch`, `required: true`, `fallbackToIndependentRows: false`, e `bootstrap.ts` diz por escrito que
**não** usa `connectedComponentRoots` — um nível de reamostragem agrupa por UMA identidade de eixo, então a
unidade do intervalo lê o EIXO e nunca a lista de união. Tirar `promptTemplate` da união não move um bit do
intervalo publicado.

**Perdemos a CO-LOCAÇÃO da receita**, e não há atenuante: 1170/1170 linhas têm o seu template em mais de
uma partição, 182.017 pares mesmo-template caem em partições distintas e 46.193 desses são train × test.
Uma medição no bloco cego passa a ler "sobre prompts VISTOS e sementes não vistas". O único limite medido
sobre essa sobreposição é o crivo de quase-duplicata do próprio pipeline (maior similaridade mantida 0,461).

### O que a revisão adversarial pegou, em duas rodadas

**Rodada 1, três bloqueantes.** O pino do lab não fora reescrito (`SEALED_POLICY_SHA256`), e sem ele o
Colab **recusa a política**: 41 testes vermelhos e treino/export inoperantes — paguei na integração. O
critério publicado era um bicondicional falso. E os dois laços novos de `_plano_de_blocos` tinham um caso
cada: trocar `all(`→`any(` no teto por classe e `any(`→`all(` na detecção de reserva deixava a suíte verde,
porque **nenhuma fixture montava componente de classe mista nem componente reservado de mais de uma linha**.

**Rodada 2, um bloqueante novo** — e é o de maior valor da unidade: a justificativa que substituiu a
anterior afirmava, com a palavra "medido", que `generatorVersion` carrega a identidade de `generatorFamily`.
Refutada em 0 de 1170. Os quatro sítios foram reescritos para a razão verdadeira (o fecho do par), e o fato
ficou **preso por teste nos dois lados**. Mais três minores: o escopo da perna (b) para
`sourceMaterialBatch` (ele é inerte sobre o corpo todo-gerado, pela mesma razão vacuosa de `extractionRun`),
a posição no laço da reserva (`membros[raiz][:1]` sobrevivia porque em toda fixture a linha reservada era a
primeira — a fixture passou a rodar as duas ordens), e dois "seventh union axis" sobreviventes.

### O que fica para a sua ratificação

- **A emenda em si.** Ela é legítima hoje por ESTADO § 3.4 (abandonar ou emendar pré-inscrição depois de ver
  a ESTRUTURA dos grupos é legítimo; depois de ver RESULTADOS, não), e nenhum resultado foi visto:
  `issuedAt` é nulo, 0 tags, nenhum `fit` selado. Reverter custa o retrabalho desta unidade e a recomputação
  dos dois digests.
- **A exceção nova que o critério revelou**: o par `(mixed, generatorVersion)`. A classe `mixed` reamostra
  `humanSeed × promptTemplate` e não declara nível de gerador algum, então nem versão nem família é nível
  dela. Está registrada como entrada NOMEADA com razão escrita em `EXCEPTIONS`, e a igualdade das duas
  listas fica vermelha se alguém acrescentar exceção sem decidir. A classe mista constrói **zero** linhas
  hoje.
- **O resíduo do critério não tem dono nomeado na política.** Pôr `generatorFamily`, `generationLane` e
  `harnessVersion` em `REPORTED_GROUP_AXES` seria emenda de política, e não foi feita: o resíduo está
  declarado no comentário e fixado por teste.
- **`domainSource` segue dívida declarada**: é REPORTADO, é `known` em 1170/1170 linhas geradas, e nenhum
  dos dois gates o lê. Agora há assertiva que o mantém visível.

### Honestidade do processo

O painel de desenho tinha **três** ângulos e o terceiro **morreu** por falha de ferramenta (o agente
estourou o limite de tentativas da saída estruturada), então a síntese escolheu entre **dois**. O ângulo
perdido era o que perguntava se o defeito estava na COMPOSIÇÃO do material e não no eixo — se poucas
receitas com muitas linhas cada tornam o corpus indivisível por construção. Essa pergunta **não foi
respondida** e vale para a Fase 3 item 2: a geometria medida aqui é MONO-CLASSE (a classe humana constrói
zero e a mista zero), então "corpus" e "ai" são a mesma comparação em tudo que se mediu, e não se sabe se a
condição agregada recusa onde a por classe passa.

### Integração

`evaluatorDigest`: `fdb42887…` → `b32243258f3d7cd95b2e40b01f4732a7139c85c8cb3b1cffad8134c93151af04`.
`SEALED_POLICY_SHA256`: `0b7eaf9a…` → `54122b273f19af37243118c330840820d3eee79c96660924c847268e5fd1d562`.
Mais duas consequências declaradas e pagas: um `TS7053` em `preregistration-v4.test.ts` e quatro arquivos
convertidos a CRLF por um round-trip de `read_text`/`write_text` do harness — revertidos a LF, com
`git ls-files --eol | grep -c w/crlf` = **0** conferido, e o harness passou a operar em bytes.

Medido em rodada ÚNICA, árvore quieta: vitest **172 arquivos / 2.993 testes** verde; pytest do lab
**609 testes / 286 subtests** verde; `tsc` limpo; `prettier` limpo; lint nos mesmos **12** pré-existentes;
`docs:check` 207/207.

**A dívida de codex permanece.** A etapa 3 foi do Fable nas duas rodadas, e rodada do Fable não fecha
dívida de codex — a janela de cota reabre em 16 de agosto, e em que gastá-la é decisão do operador (§ 4).

---

## A onda B1: três das catorze de pré-publicação, e um agente que morreu no meio (2026-08-11)

Primeira sub-onda da fila "morde antes de PUBLICAR". Três unidades de propriedade disjunta pela tríade.
Nenhuma muda o comportamento de um comando de hoje; todas entram num artefato ou num número que a Fase 6
imprime — e isso **não abaixou a barra**, porque uma guarda que promete alcance que não tem é o defeito.

| unidade | defeito | veredito |
|---|---|---|
| W3 | quatro guardas cujo alcance era menor que a alegação que fazem | `pass` na 2.ª rodada |
| W4 | `BenchmarkReport` chegava por cast e decidia ramo | ver abaixo |
| W5 | rótulo ausente saía das duas classes; a AUC mudava com a ordem dos argumentos | `pass` na 2.ª rodada |

### O que W3 consertou, e o defeito real que ela achou de passagem

As quatro varreduras ganharam alcance **medido**: a de `digests.test.ts` passou a ancorar na LINHA de
publicação (e a contar multiplicidade, porque uma única linha carregando o digest vivo **e** um hex velho
era aceita); a de `dataset-manifest.test.ts` passou de 49 para **141** arquivos (103 `.ts` + 38 `.py`) e
passou a ler também o número do bloco cego, que derivou junto; a de `source-manifest.test.ts` passou a
proibir o **nome publicado** e não só o token entre backticks; e o docstring do fatiador deixou de prometer
que "comments and field order irrelevant".

**E a varredura alargada encontrou uma deriva real**: `split-audit.test.ts:625` afirmava que o bloco cego
comporta no máximo **880** linhas, onde a autoridade congelada (`blindBlockLinesAtCollectionTarget`) diz
**800** — 20 % de 4.000, e não 22 %. Corrigido nesta integração, em arquivo que nenhuma unidade podia tocar.
É o melhor argumento a favor da unidade: a guarda cujo alcance foi consertado achou um defeito no primeiro
lugar novo em que passou a olhar.

### O que W5 consertou, e a mutação que ela mesma descobriu

`entity_masking.py` passou a **impor partição** em vez de só cobertura, porque as duas condições que
faltavam correspondem a defeitos reais de número publicado: um registro em duas classes é contado uma vez em
`records` e pesado em duas médias, e uma linha de classe fora dos ids pontuados é média sobre registro que
`records` não conta.

`baseline_tfidf.py` passou a **renderizar a população canonicamente** antes de entregá-la ao `StratifiedKFold`
— era a ordem dos argumentos que decidia as dobras, então dois operadores com os mesmos arquivos em ordem
diferente publicavam números diferentes, e nada avisava.

A reconferência achou o bloqueante que importa: a guarda tem **duas** condições (ordem e multiconjunto) e o
sítio fixava **uma**. Capturar `received` depois da renderização tornava a segunda metade tautologia e a
suíte ficava verde; combinada com a perda de uma linha, **toda AUC publicada passava a ser calculada sobre a
população recebida menos uma linha, sempre a mesma em qualquer ordem** — logo invisível a qualquer bateria de
permutação. Fechado por um teste de sítio com renderização **lacunar**.

E o conserto descobriu uma terceira, que ninguém havia pedido: nada impunha o que acontece **entre** a guarda
e o `folds.split`. Uma linha inserida ali entrega ao splitter arrays que a guarda nunca leu. Fechada fixando
a posição por teste.

### W4 — o agente morreu no meio, e o gate 3 revelou o que faltava

O implementador de W4 **morreu por erro de API** (`Connection closed mid-response`) depois de escrever o
código e antes de escrever os testes. O código estava na árvore, não commitado, com 49/49 verde — e foi
exatamente por isso que ele quase passou.

A cross-review que faltava mediu, em bytes com `sha256` conferido, que **o mecanismo não mordia**: trocar o
corpo inteiro do parser por `return value as BenchmarkReport` deixava 49/49 verde; remover a chamada de cada
um dos três sítios, um por vez, deixava 49/49 verde; tirar `releaseDecision` — o campo que **decide o ramo** —
do selo deixava 49/49 verde. E `git grep BENCHMARK_REPORT` fora de `report.ts` devolvia **um** hit, que era um
comentário: **zero testes nomeavam qualquer um dos oito códigos de recusa**.

O sinal estava no lint: **sete erros de `no-unused-vars`** em `evidence-sanitizer.test.ts`, e os sete eram
exatamente a caixa de ferramentas da matriz de forjas que nunca foi escrita — `parseBenchmarkReport`,
`BenchmarkReportError`, `reportDigestOf` importados e não usados, mais `mundo` hasteado ao escopo de módulo
com `perfilOpcoes` acrescentado só para alimentá-la. Dois comentários do arquivo **citavam a matriz como se
ela existisse**.

**A leitura de método, e é a mais importante desta onda:** um agente que morre depois de escrever o código e
antes de escrever os testes deixa uma unidade que **passa a suíte e não tem guarda nenhuma**. Suíte verde não
é evidência de que a guarda morde; foi o gate 3 que separou as duas coisas, e ele existe precisamente para
isso. O lint vermelho foi o único sinal automático, e ele é fraco: sete `no-unused-vars` são fáceis de ler
como ruído.

### Custo de reversão

Cada unidade é um conjunto de arquivos disjunto. W3 e W5 são reversíveis isoladamente. W4 tem o parser
correto (os três casts saíram da produção, os oito códigos seguem a convenção da casa, e os doze caminhos
que os comandos dereferenciam estão cobertos, inclusive `releaseDecision` por três vias) — o que faltava era
a prova, e é ela que a integração escreveu.

---

## W4 — o parser de `BenchmarkReport`, e a unidade que quase passou sem guarda (2026-08-11)

Sétima das catorze de pré-publicação, e a que mais ensina sobre o processo.

### O defeito

Três sítios faziam `(await readJsonFile(...)) as BenchmarkReport` — `publish-evidence.ts`,
`publish-profile.ts`, `verify-evidence.ts` — e `git grep parseBenchmarkReport` devolvia zero. O que fazia
disso bloqueante era o que vinha depois do cast: `verify-evidence.ts` lê `report.releaseDecision` do objeto
**castado** e **decide o ramo** com ele. A dívida estava declarada em `ESTADO.md` § 7 desde a unidade R1.

### O conserto

`parseBenchmarkReport` em `benchmark/report.ts`, com **oito** códigos de recusa na convenção da casa, ligado
nos três sítios — os três casts saíram da produção. Cobre os doze caminhos que os comandos dereferenciam,
inclusive `releaseDecision` por três vias, e recomputa o selo.

### O que aconteceu, e é o registro que importa

**O agente de implementação morreu por erro de API** (`Connection closed mid-response`) depois de escrever o
código e antes de escrever os testes. O código ficou na árvore, não commitado, com **49/49 verde**.

Foi o **gate 3** que separou "suíte verde" de "guarda que morde". Medido em bytes, com `sha256` conferido:

| mutação | antes do gate 3 |
|---|---|
| corpo do parser → `return value as BenchmarkReport` | **49 passed, verde** |
| chamada removida de `verify-evidence.ts` (o sítio que decide o ramo) | **49 passed, verde** |
| chamada removida de `publish-evidence.ts` | **49 passed, verde** |
| chamada removida de `publish-profile.ts` | **49 passed, verde** |
| `releaseDecision` fora de `reportDigestInput` | **49 passed, verde** |

E `git grep BENCHMARK_REPORT` fora de `report.ts` devolvia **um** hit, que era um comentário: **zero testes
nomeavam qualquer um dos oito códigos**.

O único sinal automático era o lint — **sete erros de `no-unused-vars`**, e os sete eram exatamente a caixa
de ferramentas da matriz de forjas que nunca foi escrita (`parseBenchmarkReport`, `BenchmarkReportError`,
`reportDigestOf` importados e não usados, mais `mundo` hasteado ao escopo de módulo com `perfilOpcoes`
acrescentado só para alimentá-la). **Dois comentários do arquivo citavam a matriz como se ela existisse.**

**A regra que isto produz:** um agente que morre entre o código e o teste deixa uma unidade que passa a
suíte e não tem guarda nenhuma — e a única pista fica num lint que sete `no-unused-vars` fazem parecer ruído.
Antes de commitar unidade cujo agente não relatou, rode a bateria do gate 3 sobre o sítio de chamada. Suíte
verde não é evidência.

### A prova, escrita depois

49 → **64** testes: a matriz de forjas (nove forjas cobrindo os oito códigos, mais o caso de **aceite**, sem
o qual um parser que recusasse tudo satisfaria a matriz), um teste por sítio de chamada, e um que prende
`releaseDecision` no selo. As cinco mutações acima ficaram **vermelhas em teste nomeado**.

Duas forjas merecem registro, porque são o que faz duas delas morderem:

- a de `verify-evidence` usa a edição **coordenada e não re-selada**: `releaseDecision` + `gates.decision` →
  `pass` no relatório e `gateDecision: pass` no descritor. **Sem o parser esse mundo é coerente para as
  quatro guardas e o comando APROVA**;
- a de `publish-evidence` precisou de **duas** forjas, porque o comando delega a `runVerifyEvidence`, que
  parseia o mesmo arquivo: uma forja só seria recusada pelo mesmo código pela delegação e não distinguiria
  os dois sítios.

### O comentário que ultrapassava o mecanismo

`verify-evidence.ts` afirmava que o parser faz com que *"a coordinated edit of the decision plus the
descriptor cannot walk past the four guards below"*. **Falso**: a receita é exportada e determinista, e
`release.json` não sela `evidenceDigest`/`gateDecision`, então uma edição **re-selada** passa. O que o parser
fecha é a edição **não re-selada** — que é o que o docstring do próprio parser já dizia certo. O comentário
do sítio foi limitado a isso, e o limite ficou **preso por teste**.

### Integração

`evaluatorDigest`: `b3224325…` → `8f4923440043f0f9643fd1a9586bf30f2501e297472e22e30959b96950102b0d`.
Um resíduo de formatação em `report.ts` (linha acima de 80 colunas) ficou por fora da propriedade do agente,
que a declarou em vez de violar o escopo — pago aqui.

Uma alegação do agente que **não se sustentou, e é bom registrar a refutação**: ele leu o commit `94a7e07`
como tendo publicado um snapshot antigo de `evidence-sanitizer.test.ts`/`evidence.fixtures.ts`. Conferido: o
commit é **anterior** à onda B1 e acrescentou 3 e 35 linhas (as edições de integração de A2), que continuam
na árvore. Nada foi deslocado — o próprio agente já dizia isso, e a leitura de "snapshot antigo" vinha de
comparar o commit com uma árvore que tem trabalho não commitado por cima.

Medido em rodada ÚNICA, árvore quieta: vitest **172 arquivos / 3.032 testes** verde; `tsc` limpo; `prettier`
limpo; `eslint` nos mesmos **12** pré-existentes (os sete `no-unused-vars` sumiram); `docs:check` 207/207;
`git ls-files --eol` sem CRLF.

---

## A alegação das "quarenta mutações" do Commit A não tem portador rastreado (2026-08-11)

Achado 5 do `consolidado-a-schema-v4`, e o último dos que a auditoria de 2026-08-10 confirmou como
bloqueante de pré-publicação. Não é defeito de código: é defeito de **prova**.

**O que a mensagem de `a028c8a` afirma**, verbatim: *"Quarenta mutações rodadas com os cinco passos, todas
vermelhas no teste nomeado (duas verdes de propósito, para medir o que a rede de compilação compra), e a
restauração conferida byte a byte por `git diff --no-index` contra o instantâneo pré-mutação."*

**O que a árvore carrega:** nada disso. O único arquivo que traria a tabela —
`.codex-reviews/fase1-commitA-implementacao.md` — está coberto por `.gitignore:63`, e o relatório que ele
contém registra **23** mutações (`grep -c "^| G"` → 23), não 40. O `review-mutacao.md` daquela unidade
**propõe** 21. Nenhum arquivo rastreado diz quais 38 ficaram vermelhas nem quais 2 ficaram verdes, nem qual
teste nomeado cada uma matou.

**Não é retratação da bateria.** Não há evidência de que ela não rodou; há ausência de evidência de que
rodou, e as duas coisas são diferentes. O que se declara aqui é que **a alegação não é verificável de um
checkout**, e que ela permanece assim: reconstruir uma bateria de 2026-08-04 sobre bytes que quinze commits
depois já se moveram produziria outra bateria, não aquela.

**Honestidade sobre a procedência do achado**, que o próprio consolidado registrou: ele foi **dirigido pelo
prompt** — o texto que foi ao codex já afirmava que a alegação era autocontraditória e que a tabela não
estava no Git. O codex confirmou uma suspeita escrita em vez de descobrir uma. Isso não o torna falso; torna
o crédito devido a quem escreveu o prompt.

**A regra que isto produz, e ela é a razão de o item valer registro:** uma bateria de mutação é a prova de que
uma guarda morde, e **prova que vive só num arquivo ignorado não é prova de um checkout**. Duas coisas
seguem: (a) a contagem citada numa mensagem de commit tem de ser a contagem do artefato que a carrega — 40
contra 23 é a divergência que denuncia a ausência; (b) quando a bateria for grande demais para o corpo do
commit, o que entra nele é o **digest** do relatório mais onde ele vive, e não um número solto.

Duas unidades desta mesma fila já cumprem o padrão dentro do repositório (as baterias registradas em § "A
bateria de mutação do fechamento" e a de R1), o que é o contraste que torna a lacuna deste commit visível.

**Vence:** permanece declarado. Não há dono de conserto, porque não há conserto possível — o que há é o
registro de que a Fase 6 não pode citar aquela bateria como evidência.

---

## A onda B2: as três últimas de pré-publicação, e a prosa que descrevia um mundo que não existe (2026-08-12)

Fecha a fila que a auditoria de 2026-08-10 levantou. Três defeitos numa unidade só, porque compartilham
`preregistration-v4.{json,ts}` e `split-audit.ts`.

### (1) A aritmética de quatro células é CONTRAFACTUAL, e agora diz que é

Quatro sítios de prosa selada descreviam frações humanas "em múltiplos de ~25 %" — a aritmética de uma
moldura de **quatro** células — enquanto a moldura declara **uma**. O conserto não foi apagar: a aritmética
de quatro células é o argumento pelo qual `domainSource` e `sourceMaterialBatch` ficam fora da união sob
**qualquer** moldura, e apagá-la apagaria a razão. Ela ficou **rotulada como contrafactual**, e o desenho
mediu duas coisas que nenhum dos sítios dizia:

- **o ramo da recusa se move com a contagem.** Com n células a fração é 1/n, que a partir de **n = 3** cai
  sob 0,47 e a recusa passa a ser a do **MENOR** componente, não a do maior;
- **"mais células só suavizam sem reparar" tem limite**: em **n = 15** (6,67 %, sob 0,07) o preflight **para
  de recusar**.

E parar de recusar **não é viabilidade** — o preflight decide duas condições necessárias e declara que não
decide a atribuição completa, que é soma de subconjuntos. Essa distinção teve de ser corrigida **dentro da
própria unidade**: a revisão pegou o resíduo declarado afirmando que a frase do modelo "é FALSA a partir de
15 células", quando o medido é "o preflight para de recusar" — a mesma inferência que a unidade proíbe em
três sítios. Reescrito: o resíduo é o **limite ausente**, não uma alegação refutada.

**`cross-validation.ts` era caso separado, e estava simplesmente ERRADO.** "They carry dependence BETWEEN
cells" não é contrafactual: com uma célula não existe par de células entre as quais uma relação valha. A
relação que esses dois eixos estão **registrados** a carregar tem outro nome —
`connectivity.dependencyAxis`, a dependência **entre aquisições** — e sob esta moldura ela também não tem
par vivo (um snapshot, um evento de aquisição). A prosa nova diz isso, e a revisão cobrou o que faltava: as
**duas premissas** da frase (uma célula, um snapshot) não eram lidas por nada, então o parágrafo podia
envelhecer com a suíte verde. Agora são lidas — e o alcance está declarado em vez de exagerado: são pinos de
**documentação**, não a guarda discriminante, porque uma emenda incompleta é recusada antes pelos literais
congelados do parser (medido: json de duas células mais `FROZEN_QUOTA_AXIS_CELLS` de duas ainda falha ao
importar).

### (2) A unidade de independência passa a ter UMA grafia

`connectivity.independentUnit: "origin-document-components"` e
`preRegistration.powerInventoryUnit: "connected-components"` nomeavam a mesma grandeza no mesmo arquivo
selado, a primeira pinada por `literal()`. **Unificado em `connected-components`**, e a razão é medida:
componentes e documentos de origem **divergem**. Em `composition-gate.test.ts`, `independentUnits` é **1**
contra `originDocuments` **2** — o componente fecha sobre os cinco eixos de `GROUP_KEYS`, então qualificá-lo
por um deles convida a ler a unidade como **uma por documento**, que **sobredeclara poder** na direção que
`composition-gate.ts` recusa por escrito.

Costurar as duas grafias como sinônimas foi **descartado por medição**, não por gosto: uma asserção
declarando-as a mesma unidade deixaria viva a grafia que sobredeclara.

### (3) A costura de igualdade que faltava

`reportedAxes` (política) e `REPORTED_GROUP_AXES` (auditoria) não podiam ser comparados por import — o
`split-audit.ts` importa a política, então o caminho inverso é ciclo. O selado era pinado contra o literal do
**próprio** arquivo, e as duas listas tinham **duas âncoras e nenhuma costura**: acrescentar um eixo a uma e
atualizar só a âncora dela deixava as duas divergentes com a suíte inteira verde. Medido nesta unidade que
continua sendo **costura ausente** e não divergência viva — as duas coincidem hoje, agora com quatro nomes
depois de U4. O modelo do conserto é a costura que já existia para `splitUnionAxes` ↔ `GROUP_KEYS`.

### O que a revisão pegou, e é a lição desta onda

Três bloqueantes, e os três eram **a unidade cometendo o defeito que ela veio consertar**:

1. a guarda que refuta a grafia retirada **não tinha controle positivo sobre o próprio padrão** — a
   não-vacuidade oferecida exercitava um RegExp **diferente**, então um typo a desarmaria em silêncio e o
   `toEqual([])` ficaria vacuamente verde para sempre. E o padrão era **sensível a caixa** sobre uma grafia,
   deixando a mesma alegação falsa passar em minúscula;
2. a prosa mais dependente de moldura da unidade tinha **as duas premissas sem leitor**;
3. o resíduo declarado **deduzia** "a frase é falsa" de "o preflight para de recusar".

Ao fechar (1), a guarda insensível a caixa **achou um sítio real**: um comentário de
`cross-validation.test.ts` que citava a grafia retirada justamente para rejeitá-la. É a armadilha clássica —
a varredura que proíbe uma frase pega o texto que explica por que ela é proibida. O remédio foi a menção
deixar de usar a grafia exata, com a razão escrita ao lado, em vez de uma exceção na varredura: exceção é
buraco em que qualquer sítio futuro se esconde.

### Integração

`evaluatorDigest`: `8f492344…` → `d4a294f780f86bfdb42ec767ee6bc93d89cb534c09bac9e0cc72fa18ce2a0ebc`.
`SEALED_POLICY_SHA256`: `54122b27…` → `1b392d3b9cb731c562448eadeab398be4308de820f248a4c9a2e454347a61ae8`
— o pino do lab, que a unidade declarou em vez de tocar, e sem o qual `test_backbone_policy.py` iria a 41
falhas.

Mais três emendas de `references.md` que a unidade propôs e não podia aplicar, e que **a bibliografia devia
ao código**: § 2.2i dizia que `GROUP_KEYS` nomeia **sete** eixos (são **cinco** desde U4); a aritmética de
~25 % era afirmada como fato do presente e agora é rotulada contrafactual com a tabela n → veredito; e
entrou § 2.2j sobre a unidade de independência com uma só grafia, com a divergência 1 contra 2 medida e um
"sem precedente" declarado para a decisão de nomenclatura.

Medido em rodada ÚNICA, árvore quieta: vitest **172 arquivos / 3.039 testes** verde; pytest do lab
**646 testes / 292 subtests** verde; `tsc` limpo; `prettier` limpo; lint nos mesmos **12** pré-existentes;
`docs:check` 207/207; `git ls-files --eol` sem CRLF.

**Com esta onda, as 23 bloqueantes que a auditoria confirmou estão pagas.** Todas devem rodada de codex: a
etapa 3 foi do Fable em todas, e rodada do Fable não fecha dívida de codex.

---

## A onda C: os prompts voltam a ser retidos, e o corpus passa a ter de ser construído em ilhas (2026-08-12)

**Decisão do OPERADOR**, tomada depois de ler o troco medido. Reverte parte de U4.

### A pergunta que ele respondeu

Com os eixos de receita fora da união, medido sobre o caso de referência de 1.170 linhas:
**1.170/1.170** linhas têm o seu template em mais de uma partição, e **46.193** pares mesmo-template caem
em train × test. O teto de FPR quase não é afetado (negativos humanos não carregam eixo de receita), mas o
**recall** — um dos quatro membros da família certificadora — passava a ser medido sobre prompts já vistos,
com erro de direção conhecida (otimista) e **magnitude que o próprio corpus não permite dimensionar**: medir
quanto o prompt memorizado inflou exigiria prompts retidos.

O que tornou a reversão barata: **a classe gerada ainda não existe**. A restrição é paga no desenho do
slate, antes de gastar cota, e não em regeneração.

### A decisão de desenho que o agente tomou dentro dela, e vai a ratificação

**Só `promptTemplate` voltou à união. `generatorVersion` ficou REPORTADO.** Não é o que o operador pediu ao
pé da letra, e a razão é medida:

- o eixo de versão da ilha **não era imposto em sítio algum onde a corrida roda**. A guarda particionava um
  *slot* que nem `generate_ai` nem `codex_batch` leem, e duas ilhas com o mesmo `--model` gravavam a mesma
  identidade — medido. As duas se fundiam, e o colapso apareceria na montagem, **depois da cota**;
- e não havia como consertar escrevendo o slot: `GeneratorVersionIsTheFamilyTests` recusa qualquer linha
  `ai` em que `version` e `family` divirjam (1.170/1.170), e `family` vem do id do modelo. **20 ilhas
  exigiriam 20 modelos distintos**, contra as cinco identidades do slate;
- e a versão **não é o que quebra o corpus**: sozinha ela dá 5 componentes com o maior em **42,14 %**, que
  cabe. Quem quebra é `promptTemplate` (54,79 %), e o par (100 %).

**O que se perde, declarado e FIXADO por teste:** a co-locação de versão não é modelada — duas linhas da
mesma versão podem cair em partições diferentes, e nenhum relatório pode chamar uma partição deste corpus de
independente **no gerador**. A perna de novidade de gerador é a **reserva OOD por família**, que é outro
mecanismo.

### A descoberta de desenho: a ilha não é um conjunto de templates

Medido: um corpo em que cada template pertence a uma corrida — satisfazendo a restrição como ela foi
enunciada — colapsa de 20 componentes para **11, com o maior em 60 %**, e é recusado. A ponte é a classe
**mista**: `derivationRoot` é eixo de união por valor, então uma linha mista cujo pai humano é a semente de
uma linha `ai` de **outra** ilha funde as duas.

**A ilha é um bloco de MATERIAL HUMANO**, e toda linha gerada ou mista semeada nesse bloco pertence a ela.
Com os pais mistos dentro do bloco da ilha, os mesmos 10.000 registros dão 20 componentes de 500 e realizam
**45/5/10/20/20 exato nas três classes**.

### A guarda que recusa antes da cota

Na fronteira do `argparse` do driver (`type=island_plan`), pelo precedente de `--provider`/`frozen_lane` —
antes do arquivo de sementes, antes do `.lock`, antes da primeira chamada de provedor. O revisor removeu a
chamada e três testes ficaram vermelhos, então o sítio está preso.

A aritmética é **derivada** de `FIVE_TARGETS`, `CLASS_TOLERANCE` e `RELEASE_CORPUS_POLICY.counts`, nunca
digitada: teto por classe 1.880 linhas (`ai`/`human`) e 940 (`mixed`), ao menos uma ilha ≤ 280, e **≥ 15
ilhas uniformes**. Medido nas duas bordas: 14 ilhas são recusadas pelo preflight (o menor componente vale
**7,14 %** contra 7 %), 15 passam o preflight e erram `cal-A` em **6,6667 %** contra 10 %, 16 e 18 passam o
preflight e `_plano_de_blocos` não as atribui, e **20 de 200 realizam 45/5/10/20/20 exato**.

### O que a revisão pegou, em duas rodadas

A reversão foi **cirúrgica** — conferido um por um que sobreviveram o carimbo por componente conexo com a
guarda chamada de dentro, o teto por classe, a detecção de reserva pelo componente, as fixtures de
componente misto e de reserva nas duas ordens, o critério com recíproca declarada falsa, `groupAxisRole`
total, `independentUnit: "connected-components"`, a costura dos eixos reportados e a rotulação contrafactual
dos ~25 %.

Oito bloqueantes ao longo das duas rodadas, e o mais instrutivo é o último, que **eu mesmo causei ao
consertar**: a guarda de partição conferia disjunção **por CAMPO**, e dois dos seus três campos escrevem o
**mesmo eixo de registro** (`groups.promptTemplate` — o de geração nas linhas `ai`, o de mistura nas
mistas). Um plano cujo `mixingTemplate` fosse o `templates` de outra ilha passava as três pernas e o corpo
colapsava: medido, **19 componentes onde o plano declara 20**. Os dois campos passaram a partilhar um
namespace, e o dono nomeia o campo de onde o valor veio.

E ao provar isso por mutação a minha **própria asserção sobreviveu**: eu afirmava que a mensagem cita
`templates` e `mixingTemplate`, e a prosa **estática** da recusa cita os dois nomes — a asserção era
satisfeita pelo texto e não pela carga. Passou a afirmar o par `ilha/campo`. É a mesma família de defeito que
esta sessão inteira perseguiu, cometida por mim no penúltimo passo.

Também caiu, e por medição: o fundamento novo de `generationBatch` como inerte por **contenção da chave**,
declarado incondicional, é **falso num caso alcançável** — a identidade de `promptTemplate` é
`{recipe}_{digest[:16]}` e o nome da receita não está na chave do lote, então duas linhas do mesmo digest com
`recipe` diferente tomam **um** lote e **duas** identidades de template. O fundamento voltou a ser o
verdadeiro: `stamp_block` sobrescreve `generatedAt`, e é `test_a_batch_never_straddles_two_partitions` que o
prende.

### Integração

`evaluatorDigest`: `d4a294f7…` → `0d278f872b829d413b0aa69e63ede695621e3a39e6612ed37919e9e68357295c` —
**calculado por mim**, porque o valor que a entrega declarou (`6f77d84c…`) estava errado, e publicar um
digest declarado sem recomputá-lo é a forma de pôr no ESTADO um número que concorda com nada.
`SEALED_POLICY_SHA256`: → `d08c5f64ccf099775f423f2244a2cac1d07d30b34ba400a79664f05c40790538`.

Medido em rodada ÚNICA, árvore quieta: vitest **172 arquivos / 3.046 testes** verde; pytest do lab
**668 testes / 437 subtests** verde; `tsc` limpo; `prettier` limpo; `git ls-files --eol` sem CRLF.

### O que fica para o operador

1. **O SLATE.** `island_plan` recusa **toda** ilha hoje: o plano declara 40 identidades de template e
   `RECIPES` declara 4. Ou `RECIPES` cresce até cobrir o plano, ou o plano é emendado para menos templates
   por ilha — mínimo **15 ilhas, um template cada**. Isto é a guarda funcionando antes da cota, não um
   defeito, e nenhuma linha pode ser gerada até a decisão.
2. **A guarda pré-cota da classe MISTA não existe.** Os três `make_mixed*.py` ficaram fora da propriedade
   das unidades, e hoje usam um template único de mistura. Medido: template único leva o corpo de 20
   componentes a **um de 100 %**, e pais mistos espalhados também. A cota mista ainda não foi gasta, então a
   janela está aberta — é a próxima unidade.
3. **O nível de gerador da classe mista continua ABERTO.** A exceção que U4 registrou dissolveu-se; a
   pergunta não. `mixed.levels` é `humanSeed × promptTemplate` e nenhum nível de gerador aparece nela.
4. **A decisão de deixar `generatorVersion` reportado**, com o resíduo acima.

---

## A classe mista da v1: o gate desarmado, e a curva construída em células (2026-08-12)

Quatro decisões encadeadas, na ordem em que o operador as pediu — decidir o gate primeiro, porque produzir
a classe é o que armava a condição de recusa. As duas primeiras foram levantadas por agentes de decisão
(modelo Fable, somente leitura sobre a árvore); a integração, a conferência das linhas citadas e a medição
de células são minhas. Nada disto foi implementado: o produto é a decisão, e o código é a unidade seguinte.

### O que estava aberto, e por que doía

`counts.mixed = 2000` é herança de um plano apagado — escrita em 2026-07-19 (commit `dc02262`) como bullet de
invariante, **sem derivação**, e a ratificação de 2026-08-04 cobre a razão do número do `ai` com a coluna
"alternativa recusada" vazia. Em cima dessa cota sem razão havia um gate vivo, `warning.mixed-recall ≥ 0,50`,
e a leitura da regra de decisão de release diz o que ele faz:

```
benchmark/gates.ts:605-612
  failedCertifying.length > 0 || failedIntegrity.length > 0 || failedWarning.length > 0
    ? "reject"
    : failedAction.length > 0 ? "indicator-only" : "pass"
```

O ramo lê o **tier**, não o `role`. `warning.mixed-recall` declara `role: "diagnostic"` — não sustenta
alegação, não gasta alpha, não é membro de `multiplicity.primaryFamily` (fora de `multiplicity.gateIds`,
preso por teste) — e ainda assim, em tier `warning`, **reprovado ele rejeita o release inteiro**.

E a v1 teta em `indicator-only` por construção: a pré-inscrição declara **um** corte sobre **uma** base, então
`evaluate` chega ao gate com `visualActionAvailable: false` e `action.available` reprova (ESTADO § 3.5).
Logo, na v1, o efeito marginal de todo gate de aviso é binário e assimétrico: **passar não habilita nada;
reprovar mata tudo.**

Contra isso, o teto documentado da tarefa. O vencedor do PAN 2025 Voight-Kampff Subtask 2 — a única
competição que propôs formalmente autoria mista — fez **64,46 % de recall macro com um Qwen3-4B ajustado**,
contra 48,32 % da linha de base roberta-base; o HART mede **AUROC 0,502** (azar) e **8 % de TPR@5%FPR** para
um classificador RoBERTa de **documento** sobre conteúdo humanizado. O nosso detector é um BERTimbau base de
110M em WASM, de documento. O corpus morto mediu **11,6 %** de recall em misto. O
`docs/detector-rebuild-assessment.md` § 4.5 já concluía: *"um limite de 50 % para um encoder de 110M em WASM
não é ambicioso, é inatingível pela formulação atual"*, e nomeava este como **o único gate cujo valor ele
recomenda mudar — e só depois de a formulação mudar**.

A conjunção era insatisfazível: a cota exige exatamente 2.000 mistas por igualdade exata em `sealDataset`;
D4 obriga os pontos ≥ 0,50 a entrarem no gate; o gate exige 0,50 em tier que rejeita; e a literatura põe o
piso acima do teto da arquitetura. Um dos lados tinha de mover.

### Decisão 1 — o gate é DESARMADO na v1, e o piso fica congelado como alvo de rearme

**O gate sai da disjunção de decisão do release.** O bloco misto continua **medido e publicado** — a coorte
`mixed.atLeastHalfAi`, `gateEvidence.overall.mixedRecall` no perfil, e a curva por nível quando D4 existir. O
piso **0,50** permanece congelado em `materialAssistance.minimumWarningRecall`
(`benchmark/preregistration-v4.json:221`) como **alvo de REARME**, e rearmar exige, escrito na própria
política, **duas** condições: formulação nova (cabeça de sentença ou de token, não classificador de
documento) **e** piso derivado de evidência com fonte.

**O critério, e não é "o gate é difícil":**

1. **Um gate cuja reprovação é predeterminada por evidência externa ex ante não protege nada — garante
   recusa permanente.** E a assimetria de tier o torna indefensável: `role: "diagnostic"` já declara que ele
   não sustenta alegação nenhuma, então reprovado ele destrói alegações **que não são dele**.
2. **A janela de legitimidade fecha quando a primeira linha mista nascer.** Hoje é emenda estrutural sob
   ESTADO § 3.4 — *"abandonar pré-inscrição depois de ver a estrutura dos grupos é legítimo; depois de ver
   resultados, não"* —, ancorada em literatura **externa** e não em espiada no nosso dado. Conferido:
   `release.json` tem `issuedAt: null`, `gateDecision: "pending"`, `profileDigests: []`, e `git tag` devolve
   zero. Existe um `frozen-calibration.json` em disco, gitignored, de 2026-07-25: é o fit do corpus **morto**,
   da lease já registrada como gasta. Sob a v4 não existe fit nem resultado. Depois da primeira linha
   gerada, o mesmo ato viraria R3 — "nenhum gate é afrouxado para passar".

**Por que não reancorar o VALOR hoje.** Não existe fonte honesta para um número. O PAN mede macro-recall de
seis classes com um decoder de 4B; o HART mede documento 100 % IA humanizado; o único número interno (11,6 %)
mede o que o assessment chama de "uma tarefa mal formulada", sobre uma população que D4 **substitui** (trechos
de mediana 16 caracteres → operações contíguas). O próprio assessment ordena: formulação primeiro, valor
depois. Escolher um número hoje seria a priori vestido de evidência.

**Por que não trocar de tier.** `GateTier` é fechado em três valores. Mover para `action` faria uma coorte que
"nunca autoriza ação visual" reger a promoção de ações sobre **outra** população pós-v1 — a mesma doença um
andar acima.

**Por que não remover o gate.** Apagar o piso deixaria `minimumWarningRecall` sem leitor ou sem existência: a
primeira é prosa prometendo o que nada impõe, a segunda é afrouxamento além do necessário. O desarme guarda o
valor congelado, o bloco publicado, e obriga um teste que afirme a não-decisão **nas duas direções** — o
precedente da casa é `assert_theme_probes_decide_no_hypothesis`, que recusa sonda promovida a hipótese **e**
família que deixou de ter quatro membros.

**O que se perde, sem atenuar.** A v1 pode ser lançada cega a texto misto ≥ 50 % IA, e **nenhum mecanismo
impede**. O recall esperado é da ordem de 11–20 % pela literatura e pelo corpus morto; o número viaja no
relatório e no perfil, mas nada o lê para decidir. O produto avisará em menos da metade dos textos que a
própria política define como positivos de aviso. A barreira contra um model card que omita a limitação passa
a ser **texto mais teste de presença**, não gate — e esta casa considera isso mais fraco, com razão.

**Custo de reversão.** Em código, barato: repor o gate na lista e reverter os testes; a evidência publicada
não muda de forma. Em legitimidade, caro e de mão única: rearmar com 0,50 **depois** de ver resultados v4
seria postdição. Na prática, só o caminho v2 rearma.

### Decisão 2 — a curva tem nove pontos publicados, e sete deles são linhas mistas

Os níveis são os de D4, congelados: 0 %, 15 %, 25 %, 40 %, **50 %**, 60 %, 75 %, 90 %, 100 %
(plano v3 `:7499-7501`, espelhados em `MIXED_FRACTION_BUCKETS`). A classe mista realiza **v1–v7**. **v0 e v8
não são linhas mistas**, e a razão é do mecanismo, não de gosto:

- `aiFraction` 0 e 1 **são** numericamente expressáveis — `fraction()` admite `[0,1]` inclusive
  (`benchmark/schema.ts:939`) e a soma-1 é satisfeita por 0+1. A recusa não vem do validador de campo;
- **v0 é inselável**: uma linha 0 % IA é o texto do pai palavra por palavra, o pai é linha humana **da mesma
  ilha**, e `parseBenchmarkDataset` recusa `normalizedTextSha256` repetido (`schema.ts:515-520`);
- **v8 é a classe `ai` por doutrina do próprio esquema**: `mixture` é proibida fora de `mixed` porque
  *"o bloco descreve um documento de origem dividida"* (`schema.ts:2293-2298`), e D4 manda o texto livremente
  reescrito receber **rótulo de documento**.

Os dois extremos da curva publicada são lidos das **classes puras das mesmas ilhas**: v0 = os pais (uma taxa
de aviso sobre humano, isto é um FPR) e v8 = as linhas `ai` da ilha. Cada ponto nomeia a sua população, e
nenhum é agregado com os outros. Isto é **emenda à leitura literal de D4** ("a curva v0–v8 montada nas três
operações"): montada nas operações são as sete interiores.

**A alocação da cota, que fecha exata em 2.000:**

| nível | alvo | banda | linhas/ilha | total |
|---|---|---|---|---|
| v1 | 0,15 | [0,10–0,20] | 10 | 200 |
| v2 | 0,25 | [0,20–0,30] | 15 | 300 |
| v3 | 0,40 | [0,35–0,45] | 15 | 300 |
| v4 | 0,50 | **[0,50–0,55]** | 15 | 300 |
| v5 | 0,60 | [0,55–0,65] | 15 | 300 |
| v6 | 0,75 | [0,70–0,80] | 15 | 300 |
| v7 | 0,90 | [0,85–0,95] | 15 | 300 |
| | | | **100** | **2.000** |

A banda de v4 é fechada por baixo em 0,50 porque a coorte lida é a de fração **observada**
`≥ minimumAiFraction` — um v4 que aterrissa em 0,48 sai da coorte. Coorte ≥ 0,50 = v4–v7 = **1.200 linhas
(60 %)**; sub-0,50 = 800 (40 %), no papel congelado `mixedBelowHalfAiRole: "diagnostic-curve-only"`. No bloco
cego (`test` = 20 % = 4 ilhas) a coorte ≥ 0,50 mede **240**, acima dos 200 de `criticalRecallPositives` — o
desenho **não fecha a porta do rearme por falta de denominador**.

O nível é **alvo da operação**, nunca a fração observada: a errata 13 do plano já mediu que chavear pela
fração obtida daria uma chave por registro-linha, e obriga a pista de mistura a emitir a curva por nível
**antes** de qualquer leitura de `byFraction` como curva. A linha grava `mixLevel` e `mixOperation`.

**A opção que foi RECUSADA, e por dois motivos independentes.** Concentrar a distribuição abaixo de 0,50 para
esvaziar o gate: (a) é escolher o material para o gate não morder, e cega a avaliação no próprio ponto de
falha que o OpAI-Bench nomeia — nove níveis progressivos com **não-monotonicidade**, Fast-DetectGPT caindo de
F1 65,0 em v1 para 35,2 em v4; (b) **está morta em código** — `profile-artifact.ts:352-363` constrói
`gateEvidence.overall.mixedRecall` com `requireSampleSize(mixed.sampleSize)`, e `requireSampleSize`
**reprova em zero** com `GATE_EVIDENCE_INCOMPLETE` (`:283-288`). Coorte vazia não passa de graça: **impede a
publicação do perfil.**

### Decisão 3 — três operações, e a partição pede IDENTIDADES, não operações

**As operações são as três de D4 e nenhuma além delas** (plano `:7493-7495`): substituição de seção contígua,
inserção de seção contígua, e concatenação de introdução humana com corpo de IA — cada uma registrando
offsets antes/depois e hashes dos segmentos.

Candidatas recusadas: *continuação* (é a concatenação com outro nome); *edição salpicada por diff* (é a pista
legada que D4 aposentou — mediana de 16 caracteres, spans que ensinariam o oposto); *expansão de esboço*
(colapsa em concatenação); *transferência de estilo* (é eixo de `transformation`, não de mistura).

**E vinte operações distintas não existem, nem são alegadas.** O que o plano de ilhas exige não são vinte
operações: são vinte-e-tantas **identidades disjuntas** no namespace de `groups.promptTemplate`, e identidade
é o **digest dos bytes** do template. A diferença se paga com instanciação por ilha — prompt materialmente
distinto por ilha × operação (gênero da seção, registro, estrutura da instrução), com o nível como
**parâmetro preenchido**, que não muda o digest.

E reduzir a cota não resolve nada: o piso de ilhas é sobre **fração**,
`1/n ≤ menor alvo + tolerância = 0,05 + 0,02` (`FIVE_TARGETS` sobre `BLOCK_FRACTIONS`, `CLASS_TOLERANCE` de
0,02, comparação inclusiva com epsilon) — **livre de escala**: encolher a cota encolhe a ilha, nunca o número
de ilhas. Eu mesmo errei isto numa volta anterior e corrigi na seguinte; fica registrado porque o erro é
atraente.

**Hoje os três prompts de `make_mixed.py` não são três operações** — conferido: um alvo de fração com **dois
corretivos de nudge retry**, com o modo de falha dependente do registro do pai (em texto informal o modelo
reescreve tudo e `aiFraction` passa de 0,7; em texto polido devolve cópia idêntica em 0,0). E as três pistas
declaram o **mesmo** `TEMPLATE_ID = "mix_edit_v1"`. A banda legada `MIXED_BAND = (0,05, 0,7)` **recusaria v6 e
v7**: a pista nova não pode herdá-la.

**O dimensionamento, com a conta:**

- **20 ilhas** (`ISLAND_COUNT`, `assemble_corpus.py:191`), derivadas e não escolhidas: 14 recusa o preflight
  (menor componente em 7,14 % contra 7 %), 15 passa e erra `cal-A` em 6,65 % contra 10 %, 16 e 18 passam a
  geometria e não atribuem, e 20 realizam 45/5/10/20/20 exato nas três classes;
- mistas por ilha: 2.000 // 20 = **100**;
- **cinco identidades de template por ilha, 100 no total**: 2 de geração + **3 de mistura, uma por operação**.
  O plano *como declarado hoje* pede 3N = 60 (o comentário em `assemble_corpus.py` conta só as 40 de geração;
  o preço inteiro já era 60, porque `mixingTemplate` escreve o mesmo eixo). A razão de subir para 5N é
  medida: com **um** template de mistura por ilha, a operação **confunde-se com a ilha**, e `dev` (1 ilha) e a
  ilha core do bloco cego carregariam **uma operação só** — a mesma cegueira estrutural, num ponto de falha
  nomeado, que a § 6.1 do assessment condena;
- por ilha, **20 células de 5 linhas**: 7 níveis × 3 operações **menos v1 × inserção**. 20 × 5 = 100, exato.
  Totais por operação: substituição 700, concatenação 700, inserção 600.

**A célula excluída, medida com a função de produção.** Sonda no scratchpad importando `shingles_of` e
`jaccard` de `benchmark/lab/near_dupes.py`, contra o contrato de poda (Jaccard ≥ 0,82 sobre shingles de 5
tokens), com pais de 100 a 1.200 tokens e tokens todos distintos (a suposição fica declarada: texto real
repete token, e o efeito sobre a contagem de shingles distintos não é obviamente monótono):

**v1 × inserção cruza o limite em TODO comprimento de pai** — 0,848 a 0,869 —, e a poda derrubaria um dos dois
membros do par. A ordem de prioridade da poda derruba o **pai humano**, que é o que quebraria a contagem e a
ponte da ilha. Nenhuma outra célula se aproxima: a segunda mais alta é v2 × inserção em **0,774**, e todas as
de substituição e concatenação ficam em 0,735 ou abaixo. Uma volta anterior da minha própria álgebra dizia
que a exclusão dependeria do comprimento do pai (cruzando só acima de ~205 tokens, o que produziria uma
célula **enviesada por comprimento**, pior que morta); **a medição refuta isso** — é morta em todo
comprimento, com margem.

Esses números são de **sonda**, não de teste: a unidade que escrever a pista deve prendê-los por fixture,
senão a alegação "célula morta por medição" é memória e não medição.

**O que a seleção de pais tem de obedecer:**

1. **pai = linha humana do corpus, da MESMA ilha.** Pai fora do bloco funde ilhas — a onda C mediu 2
   componentes virando 1 — porque `derivationRoot` une por valor e `humanSeed` é linhagem;
2. **um nível por pai, um pai por linha**: `id = mix_<pai>` mais a recusa de id duplicado impõem uma mista por
   pai, então 100 dos 200 humanos da ilha viram pais. Pilhas de versões de um mesmo pai — o desenho
   **intra-documento** do OpAI-Bench — são **inexprimíveis** sem mudar o esquema de id, e o v0 da pilha
   colidiria por hash. A nossa curva é **entre coortes de pais distintos**, e isso é declarado na referência;
3. **os clusters de operação distribuem os seus pais pelas duas metades de template de geração da ilha**, que
   é o que faz a ilha fechar em um componente;
4. **pai com proveniência completa**: `family` na moldura e `sourceMaterialBatch` presente, senão a linha cai
   contada; e toda linha grava o digest do próprio template;
5. **screen de par na GERAÇÃO**, não só na montagem: cada par pai/mista passa o contrato de `near_dupes` antes
   de a linha ser escrita — a matriz mata a célula estrutural, mas uma seção inserida que **cite** o pai pode
   cruzar o limite mesmo em v2;
6. **"nunca treinado" é entregue por co-locação**: `assign_partitions` carimba por componente, então pai e
   mista aterrissam no **mesmo** bloco. Nenhum pai de mista de bloco cego é visto em treino por construção, e
   não por manter um pool separado.

### Decisão 4 — o eixo de operação: o que a decisão 3 resolve, e o que fica de dívida

A pré-inscrição vigente declara, no estimando misto, `unitKind: multiway` com os níveis `groups.humanSeed` e
`groups.promptTemplate`, o segundo com `proxyFor: "operação de edição"` e uma `proxyReason` que termina:
*"...tem um único nível sobre as linhas mistas montadas, logo este fator é degenerado por construção até um
eixo de operação existir"*.

**A decisão 3 torna essa frase FALSA**, e isso é consequência a pagar, não a comemorar em silêncio: com três
templates de mistura por ilha, um por operação, `groups.promptTemplate` passa a ter **três níveis por ilha**
sobre as linhas mistas, e a reamostragem aninhada `humanSeed × promptTemplate` **isola a operação dentro da
ilha**. O fator deixa de ser degenerado. Logo o texto selado tem de ser emendado na mesma unidade — uma
`proxyReason` que descreve um mecanismo que deixou de existir é exatamente o comentário que promete mais do
que o código impõe, com o sinal invertido.

**O que permanece dívida da v2:** o eixo de **primeira classe**. O eixo carrega o digest do template, não a
operação, então duas identidades da **mesma** operação numa ilha são indistinguíveis de duas operações, e
nada no esquema recusa esse plano. Um `groups.mixOperation` (ou `mixture.operation` promovido a eixo de grupo)
é o que faria a operação ser **lida** em vez de inferida do digest, e faria a partição por operação ser
**imponível por mecanismo**. É mudança de eixos do esquema v4 — move `evaluatorDigest`, `V4_GROUP_AXES` e o
espelho Python —, e não é pré-requisito para gerar a classe.

### O que fica para o operador ratificar

1. **A emenda da pré-inscrição**: o desarme do gate mais as duas condições de rearme escritas na política.
   Mesma classe do que foi ratificado em 2026-08-04, e muda a regra de decisão de release.
2. **A aceitação escrita do resíduo**: a v1 pode sair cega a misto ≥ 50 % IA, com o número publicado e nada o
   lendo para decidir. Isso vira obrigação de `limitations.md` e do model card na Fase 6.
3. **A curva, a alocação, as três operações e as cinco identidades por ilha** — inclusive a subida de 3N para
   5N identidades, que é preço de prompt a escrever.
4. **A razão da cota `mixed = 2000`**, que segue sem razão própria no registro: a ratificação de 2026-08-04
   cobre o `ai`. Gerar a classe vai gastá-la. Ratificar a razão junto, ou mandá-la de volta.

### O que a unidade seguinte muda no código, sítio por sítio

- `benchmark/preregistration-v4.json` — o bloco `materialAssistance` ganha a declaração de que o piso **não
  decide na v1** e as duas condições de rearme; a `proxyReason` do estimando misto é reescrita. `policyVersion`
  **não** se move (é emenda), e `benchmark/lab/sealed_policy.py` tem o `SEALED_POLICY_SHA256` repinado **no
  mesmo commit**, senão 41 testes do lab ficam vermelhos;
- `benchmark/preregistration-v4.ts` — o parser fechado pina os campos novos por `literal()`;
- `benchmark/gates.ts` — `mixedRecallGate` sai da lista que alimenta a disjunção e o bloco passa a ser
  diagnóstico publicado **fora** de `gates` (precedente: diagnóstico "sem campo de veredito"); a função
  permanece como produtora do bloco; os comentários do piso são reescritos;
- `benchmark/tests/gates.test.ts` — os quatro sítios que pinam tier e reject passam a pinar o contrato novo
  **nas duas direções**: o gate não decide, **e** o bloco é publicado com piso e valor, para rearme silencioso
  ficar vermelho;
- `benchmark/lab/assemble_corpus.py` — `_island()` passa de um slot `mixingTemplate` para três, um por
  operação; a guarda de partição lê os campos novos **no mesmo namespace**; `_island_component` modela três
  clusters mistos com pais nas duas metades; guarda nova exigindo digests reais disjuntos entre ilhas (hoje só
  o **plano** é particionado);
- `benchmark/lab/make_mixed_v3.py` e o seu teste (novos, D4) — as três operações mecânicas com offsets e
  hashes via `originalSpanFromNormalized`; `mixLevel`/`mixOperation` por linha; bandas por nível com v4
  fechada por baixo; recusa de alvo v0/v8 e da célula v1 × inserção; screen de par antes de escrever; um nível
  por pai; **não herda** `MIXED_BAND` nem os prompts `mix_edit_v1`;
- `benchmark/schema.ts` — `mixture` ganha `level` e `operation` com vocabulário fechado e coerência
  `|aiFraction − alvo| ≤ banda`;
- `benchmark/metrics.ts` — `mixed.byLevel` (nível × operação) ao lado de `byFraction`, e o join reverso de
  `derivationRoot` para a fatia "pais de mista" que publica v0;
- `benchmark/report.ts` — a linha do gate sai da tabela de decisão e entra como tabela diagnóstica com o piso
  declarado e "não decide";
- os três `make_mixed*.py` legados — papel declarado fora da cota;
- **não mudam, e o PR declara**: `profile-artifact.ts` e `contracts/calibration-profile.ts` (a evidência já lê
  `metrics`, não o gate), e `benchmark/rebuild-v3-policy.ts` (pré-inscrição abandonada é imutável).

---

## A ratificação das cinco da classe mista, e a geometria que ninguém tinha medido (2026-08-12)

O operador ratificou **cinco** linhas, e o escopo foi perguntado e respondido em vez de deduzido: as duas da
onda C (`generatorVersion` reportado, e a leitura superada do fecho do par) e as duas antigas — **B4**
(GitHub para código e evidência, Hugging Face *gated* para pesos) e **B5** (mismatch pós-exposição é
terminal) — **continuam pendentes**. A pergunta veio de o "então" da autorização se referir a uma verificação
que cobria só a classe mista; estampar B4 numa conversa sobre contagem de templates seria falsear o registro
na fonte da verdade.

As cinco ratificadas: o gate `warning.mixed-recall` fora da decisão de release; os sete níveis interiores da
curva com v0 e v8 lidos das classes puras; a alocação de 20 células de 5 por ilha; as três operações de D4
com 100 identidades de template; e a seleção de pais.

### A verificação que faltava, e o operador foi quem a pediu

A pergunta dele: *"Nós iríamos verificar essa condição da quantidade com o fable?"* — e a resposta honesta
era **não, e não foi feita**. As 100 identidades eram aritmética sobre a forma do plano; a **condição** — que
um plano com três clusters de mistura por ilha ainda feche cada ilha em um componente e realize
45/5/10/20/20 — nunca foi medida. A onda C mediu com **um** template de mistura por ilha, que é outra forma
de plano, e foi precisamente uma medição desse tipo que derrubou a primeira versão da obrigação de ilha (20
componentes → 11, maior em 60 %).

Medido com as funções de produção (`connected_components`, `assert_components_can_fill_five_partitions`,
`_plano_de_blocos`, `within_class_tolerance`), com o plano emendado construído **fora da árvore**:

| plano | componentes | tamanhos | preflight | atribui | frações |
|---|---|---|---|---|---|
| hoje, 1 template de mistura por ilha | 20 | 500 × 20 | passa | sim | realizadas |
| emendado, 3 clusters, pais contíguos | **20** | 500 × 20 | passa | sim | **realizadas** |
| emendado, 3 clusters, pais intercalados | **20** | 500 × 20 | passa | sim | **realizadas** |

E a contagem: **40 identidades de geração + 60 de mistura = 100**, disjuntas, **zero colisões** no namespace
único. O plano de hoje soma 60, então a emenda acrescenta 40 — o número que é preço de prompt a escrever, e
que não deve ser confundido com o total.

### A razão que eu publiquei estava errada, e a diferença é medível

Eu havia escrito que "os clusters de operação distribuem os seus pais pelas duas metades de template de
geração da ilha, **que é o que faz a ilha fechar em um componente**". Duas medições não distinguiam a
alegação, então rodei o caso que ela proíbe:

| atribuição de pai | componentes |
|---|---|
| natural (pais h₀…h₉₉, as duas paridades) | **20** de 500 |
| todas as mistas com pai de índice PAR | **40** — 200 e 300 |
| cada cluster preso a uma paridade, os três **somados** cobrindo as duas | **40** — 230 e 270 |
| **um** cluster alcançando as duas, os outros dois presos | **20** de 500 |

Duas conclusões, e nenhuma é a que eu tinha escrito. A exigência é **real** — eu suspeitava que fosse
decorativa, e o caso `cluster-preso` mostra que não é: cobertura só **coletiva** racha a ilha em dois. Mas o
**critério** é *ao menos um* cluster alcançar as duas metades, e "todo cluster alcança" é **condição
suficiente deduzida** dele — o caso de um cluster livre fecha em 20 com dois clusters presos.

É a mesma família de defeito que esta sessão perseguiu inteira, cometida por mim outra vez: **a guarda
enuncia o critério, nunca uma condição suficiente deduzida dele.** A linha do ESTADO foi corrigida para
enunciar o critério, com os quatro casos.

### O estado da evidência, dito sem atenuar

Estes números são **sonda**, não teste. Vivem num arquivo do scratchpad que importa as funções de produção, e
nada na árvore os prende. A unidade que emendar `_island()` tem de prender os quatro casos — **inclusive os
dois que racham**, porque sem o caso vermelho a guarda volta a afirmar a condição suficiente. Enquanto isso
não existir, "a geometria aguenta três clusters" é memória e não medição, e a dívida da § 7 diz isso.

---

## A unidade do desarme: o gate misto deixa de ser gate, e a forma foi medida contra a alternativa (2026-08-12)

Primeira unidade de mecanismo depois da ratificação das cinco. Três portões, uma rodada de `block` com cinco
bloqueantes, e um sexto que só apareceu na re-revisão — este o mais instrutivo, porque é a família que a
sessão inteira perseguiu.

### A forma, e por que a alternativa cai

Duas formas produziam o mesmo veredito, e a escolha foi medida com sonda fora da árvore.

**Escolhida:** o bloco sai de `pointWarningGates`, o id **deixa de existir** como `GateResult`, e a função
vira produtora de um bloco **sem campo de veredito** publicado ao lado dos gates — molde de
`metrics.lengthBands`. A não-decisão e as duas condições de rearme moram na política:
`materialAssistance.decides: false` por `literal`, `rearmRequires` por `frozenList`.

**Recusada:** dar a `GateTier` um quarto valor que não decide. Funciona — medido, 0,30 devolve
`indicator-only` em vez de `reject` — e cai por três medições:

1. **não existe leitor fail-closed de `tier`.** `failedIds` filtra por igualdade; `profile-artifact.ts`
   filtra `tier === "action"` e o próprio arquivo escreve que *"filtering an unknown key out is the fail-OPEN
   direction"*; `parseBenchmarkReport` **nunca lê `tier`** e declara o interior de `gates.gates[i]` fora de
   cobertura. Nenhum `Record<GateTier, true>` existe na árvore;
2. **o quarto valor é um interruptor silencioso para hipótese certificadora** — e este é achado próprio, hoje
   dívida da § 7: alargando `IntervalGateSpec.tier` e dando o tier novo a `warning.recall.overall`, o gate
   **desaparece** de `gates` (24 → 23) enquanto `multiplicity.gateIds` continua nomeando a hipótese e
   `covers` continua `true`. A causa é estrutural: `hypotheses` e `certifyingIds` são montados de
   `intervalSpecs` **antes** da partição por tier, que não é exaustiva;
3. **colisão de vocabulário:** `role: "diagnostic"` já existe, e o relatório imprimiria
   `- [diagnostic] [diagnostic] warning.mixed-recall` numa seção filtrada por `!gate.passed` — publicando um
   gate "reprovou" num release `indicator-only`, com campo de veredito e sem nada dizendo que não decide.

E o suposto ganho não se sustentava: rearmar por tier é um token, re-inserir na lista é uma linha. Empate — e
a (b) paga o empate com o interruptor de (2).

**O que ficou selado sem campo novo no relatório:** o piso já viaja no `evaluatorDigest`, porque
`preregistration-v4.json` é membro de `EVALUATOR_FILES` e o digest é um dos catorze fatos de
`reportDigestInput`. O `required` de um `GateResult` está **fora** do fingerprint de nove campos — ou seja, o
piso de antes, dentro do gate, era **insellado**. A forma escolhida melhora isso.

### Os cinco bloqueantes, e um é meu

1. **O resíduo "executável" não era executável.** O teste que existia para tornar executável a frase "a v1
   pode sair cega a texto misto" montava o relatório com a coorte a `warningRecall: 0,3` e depois chamava uma
   fixture que **reconstruía** a entrada de `overallMetrics(true)`, cuja coorte está a 0,7 — **acima** do
   piso. O objeto sob teste nunca via a coorte sub-piso, e uma recusa de piso inserida em
   `profile-artifact.ts` **sobrevivia verde**. Fechado carregando a coorte explicitamente até o publicador
   **e** até o parser de runtime.
2. **`evaluatorDigest` moveu e a árvore ficou com teste nomeado vermelho** sem a unidade declarar. A linha é
   de quem integra, mas o silêncio é o defeito.
3. **`metrics.ts` nomeava um gate que a emenda apagou** ("resolved over the cohort *its gate reads*"), na
   mesma frase que carrega a alegação de nível único.
4. **Um teste declarava o resíduo fechado por uma guarda que ninguém escreveu** — "três digests de template
   de mistura disjuntos por ilha". Medido: a montagem dá **um** por ilha.
5. **A emenda da `proxyReason` selada, e o erro é do MEU mandato.** Eu mandei incluí-la; a linha 1038 do
   ESTADO, que eu mesmo escrevi no dia anterior, agenda essa emenda para o **mesmo commit** dos três
   templates por ilha. Pior que fora de escopo: era **permissiva** — apagava do documento selado uma
   declaração **ainda verdadeira** (a montagem entrega um por ilha, medido `20 20`), isto é, prosa que **para
   de declarar** uma limitação que o mecanismo ainda tem. Revertida byte a byte, conferida contra
   `git show HEAD:`, e ela viaja com a unidade B.

### O sexto, que a re-revisão achou e eu fechei

**A guarda da não-decisão afirmava uma condição suficiente, não o critério.** O critério ratificado é que
**nenhuma** propriedade da coorte de assistência material move `report.decision`. O teste provava algo mais
fraco: numa única evidência-base, com `sampleSize` fixo em 100 e todo o resto passando, variar
`warningRecall` entre 0,8 e 0,3 não muda a decisão. Duas mutações sobreviviam verdes:

- um termo de reject que só dispara com `failedAction` **não vazio** — invisível numa fixture onde tudo passa;
- um termo que dispara em coorte **vazia** — invisível a `sampleSize: 100`.

Substituído por uma **matriz**: seis estados de coorte (não medida, recall zero, vinte pontos abaixo,
exatamente no piso, acima, perfeita numa linha) × três vizinhanças, uma por veredito alcançável (`pass`,
`indicator-only`, `reject`). Dentro de cada vizinhança, o veredito **e as quatro listas de falha** são
invariantes. As duas mutações ficam vermelhas, e a de recolocar o bloco na lista continua vermelha.

É a terceira vez nesta sessão que a mesma família aparece — e a segunda em que eu a cometo.

### As medições de fechamento

- Bateria do critério: **3/3 vermelhas**, restaurações byte-idênticas.
- Bateria do parser selado: **6/6 vermelhas** — ausência de `decides`, `decides: true`, ausência de
  `rearmRequires`, **ordem trocada**, condição a menos e condição alienígena. Conferido que o vermelho é da
  recusa nomeada do parser (`PREREGISTRATION_V4_INVALID: materialAssistance.decides is frozen at false`) e
  não de sintaxe: a remoção leva a vírgula da linha anterior.
- Política: `sha256` `e2a52278…` casando com o pino de `sealed_policy.py`; `policyVersion` **não** se moveu;
  `proxyReason` e `proxyFor` idênticos a `HEAD`.
- `evaluatorDigest`: `0d278f87…` → `1bd5f072213defea6abb5678ee00531514f8542ec2fed30d47738c51e1c57b71`,
  recomputado por mim pela função de produção. As contagens de `references.md` não se moveram (492/25/67).
- Prosa: varridas e vazias as frases de mecanismo morto — `its gate reads`, `GATED denominator`,
  `SEVEN certifying`, `What did change`, `three disjoint mixture-template`. O `mixedRecallGate` sobrevive só
  onde descreve o **v3 abandonado** e no registro; a citação do PAN 2025 em `references.md` passou a apontar
  o símbolo que existe.

### O que NÃO foi feito, de propósito

A guarda que fecharia o interruptor do quarto tier — todo spec que declara hipótese tem de aparecer nos gates
emitidos. É código novo **depois** da revisão, logo código não revisado, e vale mais como unidade própria com
os três portões do que como emenda contrabandeada no fim desta. Está na § 7 com a medição.

E a emenda de plano da unidade B, cujo contrato já existe: três templates de mistura por ilha em dicionário
chaveado pela operação, o vocabulário nascendo no lab, as nove asserções com os **dois casos que racham** a
ilha, e a perna 5 de `island_plan` que eu decidi acrescentar — digests de templates servidos distintos dois a
dois, porque a identidade gravada prefixa o **nome** da receita e cem nomes servidos por cem cópias do mesmo
prompt passam todas as guardas de hoje.

---

## Marca d'água de texto: o Claude fica no núcleo, e a condição é a janela única (2026-08-12)

Decisão do **OPERADOR**, contra a minha recomendação, e ele estava certo. Fica registrado com a retratação
porque o erro de raciocínio é reutilizável.

### O que apareceu, e o que foi medido de fora

A Anthropic publicou que marca conteúdo gerado: *"Watermarking will be applied at the model level, which
means it will be present no matter which Claude product or surface the text comes from"*, com o Claude
Platform (API) e o Claude Code listados, sobre **todo** texto gerado; modelos novos a partir de **2 de agosto
de 2026** já saem marcados e os existentes estão em *"transition period in progress"*. O detector para
terceiros é prometido e **não existe** — "forthcoming technical documentation".

E a peça que decide o outro lado: **o Gemini pela API NÃO é marcado.** Resposta de engenheiro do Google no
fórum de desenvolvedores, **5 de agosto de 2026**, a uma pergunta que citava `gemini-3.1-flash-lite`:
*"Generated text from the API is NOT SynthID-watermarked. There is no machine-readable provenance signal"*, e
*"native text watermarking is not planned at the moment"*. O SynthID de texto roda nas superfícies de consumo,
não no `generateContent`.

Consequência para o slate, lida de `DEFAULT_MODELS`: a lane `agy` é **`claude-sonnet-4-6`** — marcada, ou a
caminho disso, sem data e sem sinal observável. As lanes `gemini` e `gemini_cli` são API, logo limpas. A
família reservada ao OOD é OpenAI (`gpt-5.6-luna`), que não embarcou marca.

### As duas propostas minhas que caíram, e por quê

**1. Gravar presença de marca como eixo por linha — RETIRADA pelo operador antes de eu escrevê-la.** Ele
observou que os esquemas conhecidos são de **chave secreta**: green list / red list (Kirchenbauer et al.,
2023) semeia por hash do contexto e detecta por teste z sobre a contagem de verdes; o SynthID-Text usa
*tournament sampling* com g-funções. Construções diferentes, mesma propriedade — **sem a chave não há
detecção**. Logo o eixo valeria `unknown` em toda linha Claude, para sempre. Um fator cujo único nível é
`unknown` é o degenerado por construção que esta mesma sessão acabou de reverter da `proxyReason`: eu teria
escrito o mesmo defeito com o sinal invertido.

E a consequência que ele nomeou e eu não tinha: **não podemos auditar o nosso próprio corpus**, nem hoje nem
quando o detector sair — um detector responde "isto é saída do Claude", que para a nossa lane já se sabe.
Ressalva a registrar: indetectável **como marca** não é invisível para um aprendiz. A perturbação está nas
estatísticas de token de qualquer forma, então um classificador pode aprender a consequência sem nomear a
causa. É a combinação ruim: auditável por ninguém, aprendível pelo modelo.

**2. Tirar o Claude do núcleo — RECUSADA, e a recusa é correta.** Eu invoquei "viés que ninguém pode medir não
pode estar no núcleo". Três razões derrubam isso:

- **o princípio se vira contra o proponente**: "o classificador vai aprender a marca" também não é alegação
  medida, é hipótese. Eu pesei um risco não quantificável contra um custo quantificável — monocultura de
  provedor no núcleo — e escolhi errado;
- **a consequência já é medida**: a reserva OOD por família existe para detectar que o detector aprendeu algo
  específico de gerador. Marca d'água é sinal específico de gerador. Se o detector estiver montado nela, o
  recall na família reservada cai. O aparelho não nomeia a causa e mede o dano;
- **e o núcleo misto é mais forte que o puro**, que é o argumento do operador: com Gemini sem marca e Claude
  com marca no mesmo núcleo, a marca **não pode ser a história inteira** do desempenho, porque o detector tem
  de funcionar na metade que não tem marca nenhuma.

**3. O experimento de separabilidade antes-e-depois — RETIRADO por mim.** Comparar a AUC de lane de `agy`
antes e depois do rollout, usando as 419 linhas do corpus morto como referência diagnóstica, deixa de valer a
cota: com a lane gerada numa janela só não há antes-e-depois, e a reserva OOD já mede a consequência.

### A condição de desenho que a decisão impõe

O que sobra da preocupação não é a **presença** da marca — é a **variação dela dentro da família**. O
`claude-sonnet-4-6` está no meio da transição declarada, então linhas geradas em momentos diferentes podem
diferir, e aí `generatedAt` vira proxy de presença de marca: um eixo **oculto** que nenhum eixo declarado
absorve.

**A lane `agy` é gerada dentro de UMA janela**, e a janela é registrada. Assim a marca — presente ou ausente,
e não há como saber qual — fica **constante dentro da família**, e perturbação constante dentro da família é
indistinguível da impressão digital da própria família: o corpus já a nomeia (`generatorFamily`), já a mede (a
sonda de lane, `agy` em AUC 0,9696 um-contra-resto) e já a guarda (a reserva OOD).

### O resíduo, declarado

O núcleo inclui um provedor que marca a saída em **nível de modelo**; a força, o esquema e a robustez a
paráfrase são **desconhecidos** e não verificáveis por terceiros; nenhuma medição nossa pode isolar a
contribuição da marca para o recall; e a perna de gerador não visto é o mecanismo que faria isso aparecer.
Vence na Fase 6, em `limitations.md` e no model card.

### O que isto NÃO muda

A manchete. O teto de FPR é alegação sobre a classe **humana**, e marca d'água é instrumento de um lado só —
pode dizer "isto é saída do Claude", nunca "isto é humano". Ausência de marca não é evidência de autoria
humana. E a composição que eu havia imaginado — checar a marca primeiro e usar o detector no resíduo — **não
está disponível para nós** enquanto a verificação depender de chave do provedor, o que também é a razão de o
detector estatístico continuar sendo a única coisa que roda sem chave, sem rede e sem permissão de ninguém.

---

## A unidade B: três slots de mistura por ilha, e a retratação de um número que eu publiquei (2026-08-12)

O plano passa a hospedar o desenho ratificado, e a unidade contém um erro meu de medição que ela mesma
descobriu ao tentar prender o número por teste. A retratação vem primeiro, porque é a parte que importa.

### A retratação: `shingles_of` recebe LISTA de tokens

Publiquei que a célula v1 × inserção é **inalcançável em todo comprimento de pai**, com Jaccard de
**0,848 a 0,869** — no ESTADO, neste registro e em duas mensagens de commit. Está errado. A sonda que
produziu esses números fazia

```python
jaccard(shingles_of(" ".join(pai)), shingles_of(" ".join(filho)))
```

e `shingles_of` recebe **lista de tokens**, não texto. Passando a string, ela fatiou **caracteres**: o que eu
medi foram 5-gramas de caractere, que é outra quantidade.

Medido com a API correta, sobre pais de 100 a 1.200 tokens:

| nível | 100 | 150 | 200 | 300 | 600 | 1200 |
|---|---|---|---|---|---|---|
| v1 (15 %) × inserção | 0,780 | 0,807 | 0,817 | **0,827** | **0,839** | **0,844** |
| v2 (25 %) × inserção | 0,692 | 0,710 | 0,719 | 0,730 | 0,740 | 0,745 |

A célula cruza o limite de 0,82 **a partir de ~223 tokens de pai** e fica **abaixo** dele em pai curto. Isto
é: a álgebra que eu havia feito antes — fronteira em torno de 205 tokens — estava **certa**, e a medição com
que eu a declarei refutada é que estava quebrada. Eu preferi a sonda à álgebra porque a sonda importava
funções de produção, e essa preferência é normalmente correta; o que ela não cobre é passar o **tipo errado**
para a função certa. O número sai parecendo medido.

**A consequência muda a razão, não a decisão.** A célula continua fora, e o motivo é melhor: ela seria
alcançável **só para pai curto**, logo existiria apenas em documento pequeno, e a **operação viraria proxy do
comprimento** — que é eixo de fatia diagnóstica declarado, com as faixas pré-inscritas indo de 50 palavras a
300 e mais. Célula enviesada por comprimento é pior que célula vazia, porque ninguém lê o viés. E agora está
**presa por teste nos dois lados da fronteira**, mais a fronteira dentro de uma faixa afirmada.

### O que a unidade entregou

**A forma:** `_island()` declara `mixingTemplates` como **dicionário chaveado pela operação**. O critério da
escolha é o que a guarda precisa: duas identidades da mesma operação ficam **irrepresentáveis** pela estrutura,
o dono de uma colisão nomeia `ilha_19/mixingTemplates[concatenacao]` — tupla posicional diria só
`ilha_19/mixingTemplates`, e a mensagem deixaria de apontar o conserto —, e o vocabulário fica comparável a
uma constante em vez de virar grafia de campo.

**O vocabulário:** `MIX_OPERATIONS` nasce no lab, junto das constantes do plano, e a guarda de partição o
confere por **uma igualdade** antes do passeio: chave alienígena, chave faltante e a grafia acentuada
(`inserção`) caem todas nela. `schema.ts` **não** entra — o eixo de primeira classe segue dívida da v2.

**A alocação é derivada, e a função é total.** `mix_cells()` dá sete níveis × três operações menos a excluída
= 20 células; `mix_lines_by_operation(mistas)` divide igualmente e distribui o resto pelas primeiras células.
No plano de produção realiza 35/30/35, e isso está pinado — mas a função responde para qualquer cota, porque
20 ilhas é escolha **derivada** e não um dado. A primeira versão que eu escrevi **recusava** cota diferente de
100, e nove testes de geometria ficaram vermelhos: as fixtures variam o número de ilhas de propósito, e
`2000 // 15` são 133 mistas por ilha. Foi a suíte que apontou que a rigidez era minha.

**O invariante de ilha:** `assert_island_plan_realizes_the_five_fractions` passou a exigir
`len(componentes) == len(plan)` antes de julgar frações. É o critério do próprio conceito de ilha — não uma
condição deduzida dele —, e sem ele a guarda julgava as frações de um corpo cujas ilhas podiam ter-se fundido.

**A perna 5, que eu acrescentei ao contrato:** `island_plan` recusa um slate que sirva receitas de **bytes
idênticos**. A identidade gravada é `{recipe}_{digest[:16]}`, com o **nome** no prefixo, então cem nomes
servindo cem cópias do mesmo prompt produzem cem identidades distintas: o grafo continua particionado, a
partição fica **nominal**, e o recall volta a ser medido sobre prompts já vistos — que é exactamente o que a
obrigação de ilha existe para impedir. Nada guardava isso: a perna 4 confere **nomes** contra `RECIPES`, e o
teste que computava digests só afirmava que cada linha leva um digest da própria ilha.

### As asserções, e as duas que sustentam o critério

Dez testes novos. O critério é **ao menos um** cluster de operação alcançar as duas metades de template de
geração, e três asserções o separam da condição suficiente:

| caso | componentes |
|---|---|
| natural | **20** de 500 |
| **VERMELHO** — pais de uma paridade só | **40** (2 por ilha) |
| **VERMELHO** — os três clusters cobrindo as duas paridades **somados**, nenhum individualmente | **40** |
| **VERDE de fronteira** — um cluster livre, os outros dois presos | **20** de 500 |

Sem o verde de fronteira, os dois vermelhos e o caso natural seriam todos consistentes com o enunciado errado
— e é o enunciado errado que eu escrevi na linha 113 do ESTADO anteontem.

### A bateria

Sete mutações, sete vermelhas, restaurações byte-idênticas: regressão ao slot único, perna de vocabulário
removida, invariante de ilha removido, dono que para de nomear a operação, clusters em *round-robin*
(34/33/33 em vez de 35/30/35), pais de uma paridade, e perna 5 removida.

Medido em rodada única: pytest do lab **679 testes / 450 subtests** verde; vitest **172 arquivos / 3.056**
verde; `evaluatorDigest` **inalterado** (`1bd5f072…`) porque os arquivos do lab não são do avaliador; sem
CRLF.

### O que fica

O slate continua não cumprindo o plano — `RECIPES` declara 4 identidades contra 100 —, e agora com a perna 5
a exigir que as 100 sejam de **bytes** distintos, não só de nomes distintos. É trabalho de agente, e a cota
que ele vai gastar é chave do operador.

---

## O ciclo de cross-review do codex: 21 defeitos que três lentes com bateria aprovaram (2026-08-16/17)

Decisão do operador: manter o codex na revisão, gastando menos. O que saiu disso vale mais pelo método do
que pelos consertos, e o método é uma retratação da confiança que eu tinha na bateria de mutação.

### O custo, e o que o produziu

| medida | rodada de 09/08 | agora | fator |
|---|---|---|---|
| tokens por unidade | 245.145 a 487.438 | **70.939** e **34.886** | 3,5× a 14× |
| comandos | 51 a 89 | **12** e **2** | 4× a 44× |
| transcrito | 0,7 a 3,3 MB | 140 KB e 69 KB | 5× a 48× |

A causa do desperdício, medida: o `.txt` do `codex exec` é o transcrito agêntico, e **99 % dele era saída
de comando**. Um único `rg -n -C 8` sem teto devolveu **1,04 MB**, e num laço agêntico cada passo re-envia
o contexto acumulado — aquele megabyte viajou em todos os passos seguintes. Ele também grepava o próprio
diretório de saída, lendo transcritos irmãos de 1,7 MB.

Os quatro cortes: o **diff inline** (65 KB no pior caso) em vez de descoberto; **teto de bytes** em toda
leitura, com `rg -m 40`, no máximo `-C 3`, tudo em `head -c 20000`; **orçamento de doze comandos** com
justificativa antes de cada; e **proibição** de ler `.codex-reviews/`, o registro e o `references.md` na
íntegra. O esforço de raciocínio **ficou em `xhigh`** por decisão do operador — o desperdício não estava
ali, e baixá-lo seria trocar acurácia por palpite.

Uma armadilha mecânica no caminho: com o diff inline o prompt passa de 70 KB e **estoura o limite de
argv do Windows** — `EXIT=126` em um segundo, zero token gasto. O prompt vai por **stdin**, com `-` no
lugar do argumento. Os prompts antigos, de 16 a 20 KB, cabiam por acidente de tamanho.

### O resultado, e ele é um veredito sobre o meu processo

Duas unidades, **21 achados reais** depois de verificação local por mutação, **um refutado**. E **nenhum**
deles havia sido pego pelas lentes adversariais que rodaram antes, **com bateria de mutação** — as
mesmas que aprovaram as duas unidades.

**Por que a bateria não os vê, medido.** Ela responde uma pergunta só: *dada esta frase sobre o que está
guardado, a guarda morde?* — e mordia, corretamente. Ela não pode perguntar se a frase ao lado é
verdadeira, nem se o critério que a frase enuncia é o critério que a guarda mede. **Comentário falso não
tem mutante.** Título de teste que promete demais está verde antes e depois.

Dois corolários, os dois medidos:

1. **As lentes procuram no vocabulário da própria unidade** — o único dialeto em que ela está certa. Os
   achados vivem em palavras que a unidade não introduziu: o quantificador *EVERY*, o numeral *NINETEEN*,
   a frase *"the only place it may come from"*.
2. **Toda bateria perturbou linha existente; nenhuma acrescentou uma.** Medido nas duas direções: editar
   o tier de uma spec mata nove testes e o buraco *parece* defendido; **acrescentar** uma spec com quarto
   tier deixa 81/81 verdes.

E o caso que fecha o argumento: o teste `test_o_plano_de_producao_fecha_cada_ilha_em_UM_componente`
promete no **nome** a propriedade por ilha e afirma `len(tamanhos) == 20` mais
`set(tamanhos.values()) == {500}`. Um corpo com duas ilhas rachadas **e** fundidas cruzado — 20
componentes, todos de 500, todos com perfil 200/200/100, idêntico ao natural — passou com **437 verdes,
zero vermelho**. O invariante que eu havia escrito dois dias antes aceita exactamente o corpo que ele
existe para recusar.

### Os consertos, e as duas voltas que eles precisaram

Primeira volta: 21 achados consertados em dois conjuntos disjuntos. As duas lentes novas — uma lendo cada
sentença acrescentada como especificação, outra mutando só por **introdução** — devolveram `block` com
**seis bloqueantes**, todos nos próprios consertos, e três deles eram **frases substitutas falsas**: um
parágrafo sobre tier que **inverteu** a consequência, um título dizendo "each gate" sobre um corpo que lia
`gates.at(0)`, e uma alegação de quebra de compilação falsa para dois de três tipos.

Daí nasceu a terceira regra, e ela entra no mandato de toda onda seguinte: **a frase substituta também é
especificação.** Prefira a frase mais fraca que você consegue **aferir** à mais forte em que acredita.

Segunda volta: cinco dos seis fecharam com prova. O sexto — o comentário que descrevia a fixture de três
gates — fechou mal duas vezes: dizia "carrying none of those four" sobre um gate que carrega
`hypothesis`, e enumerava "an index, a tier, a slice scope" quando a fixture não tinha gate do tier
**`action`**, que é justamente o tier que `profile-artifact.ts` filtra por igualdade. Fechei eu mesmo:
quarto gate de tier `action`, e a frase reescrita para o que os quatro realizam. A mutação que a lente
nomeou — campo projetado só nos gates de `action` — era **verde** e ficou **vermelha**.

### O que ficou de mecanismo

- a matriz do critério deixou de ter "EVERY" como prosa: o laço faz **walk recursivo em runtime** sobre a
  união dos blocos e exige que **cada folha** seja movida por alguma coorte, com a mensagem
  `no cohort varies mixed.<path>`; duas folhas aninhadas são fixadas por nome, porque o laço sozinho não
  sustenta "nested ones included";
- o invariante de ilha virou **bijeção**: ilha → conjunto de raízes, recusando em qualquer das duas
  direções, com a ilha e a raiz nomeadas na mensagem;
- a guarda de vocabulário ficou **total** em três partes — recusar o que não é mapa, comparar por
  conjuntos, ordenar só para a mensagem com `key=repr` —, porque a correção óbvia (conjuntos) deixava uma
  tupla dos três nomes passar e morrer depois em `AttributeError`;
- `make_mixed.py` ganhou `--island` com o mesmo `type=island_plan` do precedente, e a pista de mistura
  deixou de alcançar `call_provider` sem preflight nenhum;
- e o teste de "recusa **antes** de gastar cota" virou **in-process** com `assert_not_called` no funil do
  provedor, porque o subprocesso anterior não podia observar gasto: um toque no provedor como primeira
  instrução de `main`, embrulhado em `try/except`, mantinha o exit 2 e o teste verde.

### As alegações minhas que caíram

- **"0,745 no máximo, em comprimento algum"** era o máximo sobre os comprimentos que eu testei; a fórmula
  **tende a 0,75** e para 10.000 tokens dá ~0,7494. Cota trocada pela verdadeira e presa nos dois lados.
- **"a partir de ~223 tokens"** não é o que a serra faz: o primeiro cruzamento é em **218** e o sinal só
  fica monótono a partir de **232**; entre os dois alterna com o arredondamento do enxerto.
- **"publicado ao lado dos gates"** vale do Markdown renderizado, não do artefato serializado — e a
  ausência do bloco é **tolerada**. Corrigida a alegação no ESTADO § 3.1; a recusa de mexer na receita do
  selo **fica**, e agora está escrita como decisão e não como ausência.

### Medições de fechamento

vitest **172 arquivos / 3.059 testes** verde em rodada única; pytest do lab **685 / 480 subtests**; `tsc`
limpo; prettier limpo; lint nos mesmos 12 pré-existentes; `docs:check` 207/207; sem CRLF.
`evaluatorDigest` `1bd5f072…` → `bff3e1c054c8f58f215645114d79b55dcbb294d4d5cd2d9b0a1d097eed997eec`,
recomputado por mim pela função de produção — e o implementador reproduziu a receita em Python
independentemente, batendo com o node.

Uma nota de disciplina: a suíte inteira pegou uma falha que os dois agentes não podiam ver, porque cada um
rodou só os seus arquivos. Era a linha do digest, que é de quem integra — mas o padrão vale: **rodada
parcial verde não é suíte verde.**

---

## A onda do dano irreversível: cinco unidades antigas revisadas, e onde eu parei (2026-08-17)

O operador mandou manter o codex na revisão gastando menos, e depois seguir com a implementação em série.
Isto registra o que fechou, o que ficou aberto com o ataque escrito, e a decisão de parar.

### A economia, medida nas sete unidades

| | rodada de 09/08 | as duas de 16/08 | as cinco de 17/08 |
|---|---|---|---|
| tokens por unidade | 245.145 a 487.438 | 70.939 e 34.886 | 16.437 a 158.080 |
| comandos | 51 a 89 | 12 e 2 | 0 a 13 |
| total | 3.102.744 por oito | 105.825 por duas | **425.518 por cinco** |

Sete unidades por 531 mil tokens, contra os ~2,7 milhões que a forma antiga custaria. A causa do
desperdício antigo estava medida: 99 % do transcrito era saída de comando, e um único `rg -C 8` sem teto
devolveu 1,04 MB que viajava em cada passo do laço. O esforço de raciocínio ficou em `xhigh` por decisão do
operador — o desperdício não estava ali.

O caso extremo é o E2: **zero comandos, 16.437 tokens**, revisão feita inteira do diff inline. E o contrato
dele foi o primeiro a criar o rótulo `INVERSO` para a linha de bateria que a fonte sustenta pela medição
inversa; a conferência disse que devia ser o padrão dos cinco, e apliquei.

### O veredito sobre o processo, e ele é duro

**16 bloqueantes e 16 menores nas cinco.** Verificação local por mutação: **35 medidos, 24 reais, 9 com
escopo diferente, 2 refutados, ZERO já consertados a jusante** — todos ainda vivos em disco, mais de cem
commits depois.

E nenhum deles havia sido pego pelas lentes que aprovaram as mesmas unidades **com bateria de mutação**. A
razão, medida e já registrada na seção anterior: a bateria responde *"a guarda morde?"* e nunca *"a frase ao
lado é verdadeira?"*. Comentário falso não tem mutante.

### O que fechou, com prova

**Cinco bloqueantes de caminho destrutivo no exportador.** A proteção contra checkpoint passou a buscar em
qualquer profundidade (`rglob`) e nomeia o caminho relativo; o ZIP passou a exigir os marcadores publicados
como sufixo de algum membro, com a frase fraca — *o ZIP em `<path>` não carrega os dois marcadores* — e nunca
autoria; o reconhecimento de staging trocou a lista de nomes genéricos pela dupla que a montagem carrega em
qualquer instante (`_fp32`, `onnx/model_int8.onnx`), medida passo a passo; `id2label` ausente com
`num_labels: 2` virou recusa; e `train_detector` deixou de entregar o objeto PyTorch onde esperava o nome do
backbone, com `write_metrics` extraída e amarrada a `main` por teste que fica vermelho sob
`backbone = detector`.

Sete testes novos ficam vermelhos contra o código antigo, com o motivo conferido — `ValueError not raised`
nos quatro do exportador. E dez mutações, **todas por acréscimo**, com a precaução de `rmtree` respeitada:
nenhuma medição precisou apagar nada fora do temporário.

**A amarração do corte, na fronteira do processo e na do CLI.** O corte abençoado antes da lease viaja como
digesto até quem decide; a retomada o confere contra o recibo **antes** de reescrevê-lo; e uma invocação
fresca sobre bloco que aquele ledger registra como gasto é recusada **antes** do write.

Duas alternativas foram medidas e **rejeitadas**, e as razões valem mais que o conserto:
- adquirir a lease antes de escrever o recibo **funciona** (59/59 verdes) e foi recusada por **custo**: move
  um write falível para depois do passo de mão única, e o próprio cabeçalho do comando diz que a recusa antes
  da lease "costs the run and nothing else";
- recusar a sobrescrita do recibo **não serve**: apagar o `pre-exposure-check.json` é o mesmo acesso a disco
  que a troca do corte exige. *"(b) protege um arquivo com um arquivo."*
A terceira forma — ancorar no **ledger append-only**, que não vive no `--work-dir` — é a que o código
sustenta, e reusa `HOLDOUT_ALREADY_CONSUMED` de propósito: é o mesmo fato, reportado mais cedo.

No CLI, o cenário novo dirige `evaluate` por `runCli` sobre manifesto `release` e afere a recusa; ele fica
vermelho sob as **três** variantes de suprimento — no `buildEvaluate`, no nível acima, e no nível abaixo.

### As quatro regras de método, e a quarta nasceu aqui

1. **Toda sentença declarativa é especificação** — comentário falso não tem mutante.
2. **A mutação que prova tem de INTRODUZIR um X novo**, nunca alterar um existente.
3. **A frase substituta também é especificação** — prefira a mais fraca que se afere.
4. **A prova de ordem tem de cobrir a fronteira do PROCESSO, não só a do fluxo** — e a volta seguinte
   mostrou que ela é incompleta: falta a fronteira do **ARGUMENTO**. Um argumento correto sobre a sequência
   de linhas não diz nada sobre duas invocações; e um correto sobre duas invocações não diz nada sobre os
   parâmetros que o chamador escolhe.

Três voltas de conserto, e cada uma fechou de verdade o que a anterior mediu e foi atacada numa fronteira
nova. Uma disciplina que vale registrar: numa delas o implementador rodou uma mutação que saiu **verde** e,
em vez de declarar a asserção furada, diagnosticou que **o mutante era inerte** — o `raise` seguia
executando — e refez. Noutra, ele achou por conta própria uma frase da própria onda que era falsa sobre o
código atual e a cortou.

### Onde eu parei, e por quê

A terceira volta devolveu `block` com três bloqueantes: dois são a **fronteira do argumento** — o recibo é
chaveado só pelo `--work-dir` e não nomeia bloco algum — e o terceiro era a linha do digest, minha.

Parei aqui, com autorização do operador, e a razão é a assimetria: **o mecanismo forte com a limitação
declarada vale mais que a frase perfeita não entregue.** Cinco caminhos destrutivos fechados são dano
irreversível a menos no repositório, hoje. As duas sequências que ficam abertas estão medidas, escritas na
§ 7 com o ataque reproduzível, e — o que importa mais — **as frases que alegavam o contrário saíram do
código**. A prosa do `consume-holdout` agora diz o que é aferido (o escopo é o ledger apontado) e nomeia o
resíduo (os dois argumentos que o chamador escolhe).

Fechar aquilo exige o recibo chaveado pela consumação, que é unidade própria com os três portões — e tem de
vir **antes** de `consume-holdout` ser apertado, não depois.

### Medições de fechamento

vitest **172 arquivos / 3.079 testes** verde em rodada única; pytest do lab **705 / 480 subtests**; `tsc`
limpo; prettier limpo; lint nos mesmos 12 pré-existentes; `docs:check` 207/207; sem CRLF.
`evaluatorDigest` `bff3e1c0…` → `8e6dac1363454120693b22a2213da0699ac4b4c4a63869756543d51b6b732a1e`,
recomputado por mim depois das minhas próprias edições de prosa.

Uma nota que a lente ganhou: a onda declarou a árvore verde tendo um teste **vermelho** que o HEAD não
tinha — era a linha do digest, que é de quem integra, mas a alegação de verde estava errada como escrita.
**Rodada parcial verde não é suíte verde**, e é a segunda vez que isso aparece nesta sessão.

### O que fica na fila

A onda 2 — Commit E, Commit F e E2 — com quatro bloqueantes menos graves e os menores restantes, todos
verificados e com remédio nomeado. E as cinco unidades continuam devendo o **fechamento** do que ficou
aberto, não uma revisão nova: o codex já as julgou.

## A onda 2: os quinze achados de Commit E, Commit F e E2, e as duas vezes que a medição corrigiu o remédio (2026-08-17)

Fechei os quinze do mandato — três bloqueantes e doze menores, todos levantados por cross-review
independente e medidos por mutação antes de mim. HEAD na abertura era `1363fdc`, o mesmo da geração do
mandato, e os sete sha256 de produção que ele registra bateram byte por byte: a árvore que consertei é a
que foi medida.

### As duas vezes em que a medição corrigiu o remédio escrito

**Achado 3 — uma das duas contagens que o remédio pedia não tem mutante, e saiu.** O remédio nomeava duas:
contar `sourceId` em qualquer grafia de chave, e contar as ENTRADAS do array. Implementei as duas e rodei a
bateria: **estreitar a contagem de chaves de volta à grafia nua deixou os dez casos VERDES**, porque a
contagem de entradas pega tudo o que ela pegaria — toda entrada não lida vale uma abertura de `{` a mais.
Guarda sem mutante não é defesa; é decoração que se lê como defesa. Então a contagem de chaves saiu, ficou
só a de entradas, e a grafia larga sobrevive **apenas na mensagem**, para nomear a fonte omitida — e essa tem
mutante (estreitá-la derruba a asserção do nome). Contra a contagem exata de origem (`sourceId:` mais valor
entre aspas duplas), os seis casos novos ficam vermelhos. É a regra "mutação que sobrevive verde é achado"
aplicada ao meu próprio conserto.

O resíduo ficou escrito no código e **fixado por teste**: contar aberturas de `{` conta objeto ANINHADO como
entrada, então uma entrada bem formada que carregue um deles é RECUSADA em vez de lida. Fail-fechado e
declarado, não um parse correto.

**Achado 10 — o parêntese do remédio está invertido, e o código decide.** O remédio dizia "para train: share
acima do teto; para as do meio e test: share abaixo do piso". A região em que as duas formas DISCORDAM com a
correta aceitando é a oposta: a poda de `train` é um teto (`atMost`), então o que a inversão para piso recusa
é banda **abaixo** de alvo menos tolerância; as outras quatro são pisos, e o que a inversão para teto recusa
é banda **acima** de alvo mais tolerância. Construí os cinco corpos nessa faixa e a matriz 5x5 saiu
**diagonal**: cada prova morre sob a inversão do seu sítio e sobrevive às outras quatro. As cinco invertidas
de uma vez — a mutação que o mandato mediu sobrevivendo 31/31 — agora derrubam as cinco.

A folga que essas provas exigem entre a banda e o realizado vem do **componente que atravessa um corte**: ele
cai inteiro em `train`, então `train` recebe massa que a banda dele não conta e as bandas do meio perdem
massa que a banda delas conta. No sítio de `test` a folga é outra: a reserva entra na quantidade comparada
duas vezes por desenho, e 3 % de reserva põem a quantidade em 23 % com `test` realizando 20 % exatos. E o que
faz a colocação ser ÚNICA é um instante por BLOCO, não por linha: com um instante por linha o grid tem
duzentos candidatos e a colocação passa a ser a que ele preferir — errei isso na primeira tentativa, e os
quatro primeiros corpos foram aceitos com colocação diferente da desenhada.

### O que decidi em cada um dos outros treze

**Achado 1 (bloqueante).** O caminho positivo do condicional de release não tinha entrada: os dois casos que
dirigem `runSplit` com corpus release esperavam recusa, então `if (true)` — recusar TODO corpus release —
sobrevivia verde. O caso novo leva o par manifesto/corpus cujo recibo selado já é afirmado `passed` pelo
COMANDO inteiro e lê o recibo de volta **do arquivo**. Duas correções que só o caminho de disco exige, e que
o fixture em memória não: digest de texto por linha (o parser lê digest repetido como linha duplicada) e a
linha mista apontando `derivationRoot` para o humano do slot, porque o fixture a deixa apontando para si
mesma e o parser exige um PAI.

**Achado 2 (bloqueante).** As duas conferências que os dois lados faziam são MARGINAIS — tamanhos e totais
por classe — e um materializador divergido acerta as duas: trocar um componente 1H+3A e um 3H+1A por dois
2H+2A preserva os dez tamanhos e os dois totais. Acrescentei a terceira, o CONJUNTO (linhas por componente E
por classe), nos dois lados, e a chave canônica escreve TODA classe com a contagem dela — `human=1` e
`human=1,mixed=0` seriam duas grafias do mesmo componente e os dois lados poderiam discordar por omissão. A
mutação exata do mandato (x2/x2/x6 contra a declaração x1/x1/x8), que sobrevivia 54/54, derruba um teste em
cada lado. E as três frases que alegavam o contrário foram enfraquecidas para o que se afere.

**Achado 4.** O cap é NECESSÁRIO e não suficiente, e a diferença está medida no baseline verde: uma célula
pode satisfazer o cap a uma linha por documento, ter exatamente o piso de linhas e ainda carregar menos
unidades que linhas, porque a coautoria une linhas que documentos distintos não uniram. A frase nova nomeia o
teste que a afere e não promete o invariante que aquele caso refuta.

**Achado 5.** A frase invertida saiu, e a substituta **não** adota "over-count units" — um skip não pode
sobrecontar. Ela nomeia o que o skip faz de verdade: a linha já foi contada em linhas, então ela ficaria fora
do conjunto de unidades E do balde do documento, e o máximo por documento poderia ler abaixo do verdadeiro
(zero, no caso em que toda linha da célula salta). Essa é a direção que sobredeclara poder, e é a que a frase
antiga nem nomeava.

**Achado 6.** A ordem entre a auditoria de vazamento e a composição não estava presa: nenhum corpus da
árvore era vazado E curto ao mesmo tempo. O caso novo une uma linha do bloco de `test` ao documento de origem
da mais antiga — o componente atravessa e cai em `train`, levando tempo da banda de teste — e o mesmo corpus
SEM a união é recusado pela composição, que é o que faz dele prova de ORDEM. A linha escolhida não é da
família reservada de propósito: uma reservada com pai antigo faz o splitter recusar antes, por elegibilidade
temporal, e a recusa medida seria outra.

**Achado 7.** O preflight passa a **recusar decidir** quando o menor alvo não excede a tolerância, porque
nessa faixa o zero é share legal e a condição do menor componente deixa de ser necessária. A premissa do
cabeçalho, que era afirmada como fato, passou a ser premissa imposta. Não espelhei a guarda no lab: a guarda
de lá não recebe política por parâmetro, então a situação não é expressável naquele lado — fica registrado
como resíduo, não como esquecimento. E não afirmei em comentário que o splitter aceita o corpo que o
preflight recusaria: isso exigiria política de mão com `as unknown as` para contornar os tipos literais, e o
que o teste afere é a aritmética que sustenta a premissa (`|0 - 0,01| <= 0,02` verdadeiro, `|0 - 0,05| <=
0,02` falso).

**Achado 8.** O escopo `mixed` do preflight não era construído por corpo algum do catálogo: saltar a classe
`mixed` na produção sobrevivia 54/54. O caso novo — quatro componentes de um pai humano com cinco mistas
cada, mais 26 humanos avulsos — é o único em que o escopo `mixed` decide: no corpo e na classe `human` tudo
cabe. Ele exercita os DOIS lados, e as duas mutações (o escopo apagado no TS e no lab) ficam vermelhas. Ele
também mede que a mistura **não racha a ilha do pai**: pai e cinco mistas são um componente de seis, porque a
mista compartilha o autor dele e o nomeia nos dois eixos de linhagem.

**Achado 9.** `viabilityScope` com escopo ausente passa a ter asserção, e ela pina a MENSAGEM nomeando o
escopo pedido, porque `scopeDenominator` usa essa função como denominador do relato: sob o mutante ela
devolveria a contagem do CORPO sob o nome de uma classe.

**Achado 11.** `development`/`calibration` viraram `trainRows`/`devRows`, e os dois comentários passaram a
descrever as partições que a fixture realmente atribui. Não varri cego: `split-artifact.test.ts` usa o
vocabulário antigo DE PROPÓSITO, num caso que o recusa.

**Achado 12.** A oração falsa saiu. A forma que a sentença condenava (comparar contra o mais novo dos quatro)
é EQUIVALENTE às quatro comparações; o que não seria é a CADEIA vizinho-a-vizinho, e `train` é por quê — ele
é o fallback e pode ser mais novo que `cal-B` por desenho. O que o laço compra é o rótulo e a não-vacuidade
por partição, e é isso que a frase nova diz.

**Achado 13.** A narrativa de processo saiu, e o bloco para na frase que enuncia a propriedade.

**Achado 14.** O sítio dos três digests ganhou tabela — a guarda é uma disjunção, e com um caso só dois dos
três comparados podem ser apagados sem cor mudar. O `datasetId` fica intacto de propósito: é o que separa
essa recusa da vizinha, que carrega o mesmo código. Medido: a tabela fica vermelha sob `void new` no sítio
dos digests e verde sob o do dataset trocado. O outro sobrevivente é INALCANÇÁVEL, e agora está declarado no
código nomeando o lock de outro módulo que o torna inalcançável — no molde que `split-artifact.ts` já usa. E
a sentença de unicidade falsa saiu de `corpus-import.test.ts`: depois desta onda toda guarda ALCANÇÁVEL de
`commands/split.ts` tem teste.

**Achado 15.** As duas bordas inclusivas onde a guarda RODA, não no helper. Os dois mutantes reproduzem os
sha256 que o mandato registrou (`277c5519…` na auditoria, `03767f86…` no artefato) e agora ficam vermelhos
onde sobreviviam verdes. A não-vacuidade é a metade que importa: nas duas células o float CRU recusaria, por
um bit, então o que as faz passar é o epsilon do comparador.

### Medições de fechamento

vitest **172 arquivos / 3.097 testes** verde em rodada única; pytest do lab **708 / 488 subtests**; `tsc`
limpo; prettier limpo; lint nos mesmos **12** pré-existentes (10 em `.cache/`, 2 avisos em `src/`);
`docs:check` 207/207; `git ls-files --eol | grep w/crlf` vazio. `evaluatorDigest` `8e6dac13…` →
`dac12c932ad1ae56ec6823c153b8d18ff7a66ac877fbb23ef6f92cd89595781e`, recomputado pela função de produção
depois das minhas edições e republicado na § 5.6.

A § 1 do ESTADO tinha **duas** contagens envelhecidas, e não uma: a linha do avaliador dizia "1.489 em 45
arquivos, 531 no lab" quando a medição dá **1.720 em 46** e **708**. O 531 era o TOTAL do lab de 10/08, que a
linha de cima já tinha atualizado para 705 sem que esta seguisse. Prosa não reconta: as duas foram reescritas
pelo que a rodada de hoje mediu.

### O que fica na fila

Nada da onda 2. As cinco unidades antigas continuam devendo o fechamento do que a onda anterior deixou aberto
na § 7 — o recibo de `consume-holdout` chaveado pela consumação —, e isso é unidade própria, não revisão
nova.

### O que saiu do ESTADO depois da onda 2, e por quê (2026-08-17)

Duas linhas deixaram de descrever o que É, e a fonte da verdade não pode carregar alegação vencida:

- **§ 4, a dívida de codex das unidades que carregavam só revisão do Fable.** A linha nomeava **Fase 1
  Commit E** (gate de composição) e **Fase 1 Commit F** (preflight de viabilidade) como devedoras. As duas
  tiveram rodada de codex em 2026-08-16/17 — é dela que saíram os quinze achados desta onda, todos fechados
  com bateria. A linha ficou com **R1** e **R2**, que continuam devendo, e a trava perdeu a data impressa:
  ler a data que a mensagem de cota imprime como promessa de retorno é o erro que a própria § 7 registra
  como regra de leitura;
- **§ 7, "rodada 13 do cross-review do E2: nunca rodou".** Rodou. O mandato desta onda rotula sete dos
  quinze achados como `e2-r13-cinco-particoes`, e os sete estão fechados. A linha saiu inteira em vez de
  ser reescrita, porque não sobrou dívida a descrever: as doze rodadas anteriores tinham veredito e agora a
  décima terceira também tem.

O que **não** mudei, e a razão: a fila de dez unidades (§ 7) continua dizendo que a dívida que resta é a de
codex, porque ela fala de outra fila — os 23 bloqueantes da auditoria de 2026-08-10, mais as 14 de
pré-publicação e as 31 menores. Nenhum achado desta onda mordeu naquela lista, então mexer nela seria
declarar pago o que não foi.

## Etapa 1 da unidade das duas guardas pré-cota: o desenho refutou o próprio ESTADO em três pontos (2026-08-17)

O escopo autorizado era: crescer o slate até o plano, emendar `_island()` para três slots de mistura, e a
guarda pré-cota da classe mista — só as duas guardas, nenhuma chamada de provedor, pelas três etapas. A
etapa 1 mediu o estado antes de desenhar, e o que ela achou muda a unidade.

**1. O número não é 100, é 40.** `island_plan` (leg 4) confere `island["templates"]` contra `RECIPES`, e
`templates` são DOIS por ilha sobre vinte ilhas. As 100 identidades são do CORPUS — 40 de geração mais 60
de mistura —, e as de mistura são servidas pela pista mista, que `RECIPES` não alcança. O docstring de
`_island()` já dizia quarenta; a linha da § 7 dizia cem. É o mesmo erro que esta semana registrou duas
vezes: um número que viaja para o lugar errado e passa a descrever outra coisa.

**2. Os três slots de mistura JÁ EXISTEM.** `_island()` declara `mixingTemplates` como dicionário chaveado
pela operação, derivado de `MIX_OPERATIONS`, com a razão escrita no próprio docstring — um slot único
confundiria a operação com a ilha, porque `dev` recebe uma ilha só. A § 7 dizia que "a forma do plano
também não hospeda o desenho"; hospeda. Metade do item que eu ia implementar estava feita desde 12-08, e
foi a § 3.3 que registrou certo enquanto a § 7 envelheceu.

**3. O que sobra da guarda mista é real, e é outra coisa.** Medido agora: `make_mixed_agy.py:39` e
`make_mixed_codex.py:41` declaram `TEMPLATE_ID = "mix_edit_v1"`, `make_mixed.py:562` escreve o mesmo, e
`MIXED_BAND = (0.05, 0.7)` em `make_mixed.py:132` recusaria os níveis 75 e 90 da curva ratificada. Então a
dívida não é a forma do plano — é a pista **escrever a identidade por ilha × operação** em vez de um nome
só, e a banda admitir a curva que a política congelou.

### A pergunta que fica, e por que ela não é minha

Crescer `RECIPES` a 40 é escrever **quarenta prompts materialmente distintos**. O digest guarda contra
cópia literal (`island_plan` recusa bytes idênticos, com a razão escrita: a partição de ilha ficaria
NOMINAL), mas não contra quarenta variações vazias — e "materialmente distinto por ilha" é justamente o
que sustenta a independência de template que o split modela e o recall certifica. Dois documentos desta
árvore discordam sobre de quem é isso: `_island()` e `island_plan` declaram por escrito que o slate é
**decisão de coleta do operador** e que este arquivo não a toma; a § 7 diz que **deixou de ser pendência do
operador** porque o número foi ratificado.

A leitura que eu adoto, e registro: o que foi ratificado em 12-08 foi o NÚMERO, não a autoria dos prompts.
Escrever quarenta prompts é material de corpus, e material de corpus com uma frase falsa ao lado é pior que
material ausente — a semana inteira foi sobre isso. Então parei neste item e não no outro: a guarda da
pista mista é mecanismo, é minha, e segue; os quarenta prompts vão ao operador com a medição na mão.

### A segunda refutação da mesma etapa: a guarda mista também existe, e o acoplamento que a renomeação quebraria (2026-08-18)

Continuei a medição do desenho e a § 7 errou pela quarta vez na mesma unidade.

**A guarda pré-cota da classe mista EXISTE.** `make_mixed.py:213` tem o seu próprio `type=island_plan`,
fiado no argparse em `:347`, com as quatro pernas da pista de geração — pelas mesmas funções de produção — e
uma **quinta**: confere os três `mixingTemplates` da ilha contra `MIX_TEMPLATES`. A interseção dos dois
conjuntos é vazia hoje, e o docstring diz por escrito que é vazia "para as sessenta identidades do plano e
não só para a ilha de uma corrida". Então ela recusa toda ilha, antes de qualquer chamada de provedor, com
a mensagem nomeando o que falta. `MIX_TEMPLATES` serve três receitas `mix_*_v1`, uma por banda de nudge, e
os três escritores pinam `mix_edit_v1`.

**Conclusão que reorganiza a unidade:** as duas guardas que eu ia construir já estão construídas, as duas
recusam, e o que falta às duas é a MESMA coisa — material. 40 identidades de geração e 60 de mistura, as
100 que a § 3.3 já contava certo. Não há mecanismo de guarda a escrever; há um slate a escrever e duas
dívidas pequenas de mecanismo (a banda, e a identidade por linha vir da ilha × operação).

**E um acoplamento que a renomeação quebraria em silêncio.** `assemble_corpus.py:1247` declara
`REWRITING_RECIPES = {"parafrase"}` e `:1727` o lê para decidir se `derivationRoot` nomeia o pai:
`if parent and recipe in REWRITING_RECIPES`. Isto é CONECTIVIDADE — só a reescrita faz a linha ser derivação
do pai; `original`, `social` e `humanizado` nomeiam a semente e não a derivação. Trocar os quatro nomes de
gênero por quarenta nomes de ilha (`pt-ilha-NN-a`) faria esse conjunto casar com nada, e toda linha gerada
sairia `notApplicable` no eixo — componentes diferentes, sem um teste vermelho, porque nenhum teste compara
a classificação com a tarefa que a receita pede.

Logo o slate de 40 não pode ser um dicionário de nomes opacos: cada entrada tem de DECLARAR a tarefa (e o
registro), e a classificação a jusante passa a ler o campo em vez de casar o nome. É a mesma correção de
forma que a onda 2 fez três vezes: a decisão lê o que foi declarado, não o que o nome sugere.

Uma segunda cópia do slate está em `codex_batch.py:49-66`, com os quatro prompts escritos de novo. Ela entra
na mesma emenda ou passa a servir outro corpus que o plano não descreve.

### O slate de 40 foi construído e medido, e parou num bloqueio que não é meu (2026-08-18)

Construí o slate inteiro sob as duas listas que o operador aprovou — oito tarefas × cinco registros — e a
implementação **funciona**. Ela está preservada como patch fora do repositório; a árvore voltou verde
(708 / 488) porque o bloqueio que apareceu no fim é decisão, não conserto.

**O que ficou medido, e vale independentemente do bloqueio:**

- **40 entradas, 40 pares (tarefa, registro) distintos, 40 digests distintos**, e os nomes do slate iguais
  aos que `_island()` declara em `templates` — por igualdade, não por pertinência;
- a regra das duas coordenadas funciona: o slot `a` tira a tarefa das quatro primeiras e o `b` das quatro
  últimas, com o registro deslocado de dois, então **nenhuma ilha repete tarefa nem registro**. `ilha_00`
  sai `(original, formal)` e `(verbete, coloquial)`; `ilha_07`, `(parafrase, coloquial)` e
  `(noticia, apressado)`;
- **a razão de derivar em vez de escrever quarenta literais é MEDIDA, e é o gate antiartefato.** Ele deriva
  as sondas de ECO da prosa de instrução de cada template, chaveadas pelo chunk, e a taxa dessas sondas
  sobre a classe humana em moldura tem teto pré-inscrito de 2 %. Quatro templates dão **19** sondas; os
  quarenta compostos dão **32** — e quarenta prompts de prosa própria dariam da ordem de 190, décuplo,
  contra esse teto. A frase repetida vale UMA sonda, e é isso que a composição compra;
- **um ciclo de import real**, que só aparece ao tentar derivar o slate lendo o plano: `generate_ai` importa
  `assemble_corpus`, que importa `artifact_gate`, que lê `RECIPES` no import dele — e `RECIPES` ainda não
  existe. O slate ficou espelho local com igualdade pinada por teste, que é o idioma da casa;
- **o picker por provedor (`recipe_for`) estava quebrado para o slate novo e não tinha chamador de
  produção**: baldes de dez sobre pesos somando quarenta alcançam só as dez primeiras receitas. Saiu, com
  guarda de que não volta.

**O bloqueio, e por que ele é do operador.** `REWRITING_RECIPES` decidia por NOME se a linha é derivação do
pai; passou a ler o campo `task` do slate, e uma receita que o slate não declara é recusada **linha por
linha** (`MissingRecipe`) em vez de classificada por chute — adivinhar `False` escreveria `notApplicable`
num eixo de conectividade sem nada acusar. A consequência apareceu no fim: os **pools em disco foram
gerados sob o slate de quatro**, então nenhuma linha deles é classificável sob o slate novo, e dois testes
que medem um FATO dos pools através de `ai_record` — `version == family` sobre as 1.170 linhas, e as
corridas de template 641/231/213/85 que o caso `forma-medida-da-classe-gerada` cita — deixam de ter
portador.

Isso é o mecanismo funcionando: o plano diz que a classe gerada tem de ser CONSTRUÍDA em ilhas, e a forma
dos pools é justamente a que a emenda de 2026-08-12 passou a recusar. Mas as duas medições que perdem
portador estão **citadas no catálogo compartilhado e no comentário de `SPLIT_GROUP_KEYS`**, e reescrevê-las
para medir o fato direto do pool em vez de pela montagem muda o que dois testes afirmam. Trocar o que um
teste mede é exatamente a classe de mudança que esta semana mostrou ser onde os defeitos moram, e fazê-la no
fim de uma unidade, sem etapa de desenho própria, seria repetir o erro.

Então o slate fica no patch, a árvore fica verde, e a decisão que falta é uma só: as duas medições passam a
ser lidas **do pool** (o fato não precisa do montador), ou o slate de 40 espera a unidade que aposentar os
pools do slate de quatro.
