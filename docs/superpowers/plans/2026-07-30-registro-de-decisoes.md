# Registro de decisões — em vigor por delegação, ratificáveis nos marcos

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

## Regras condicionais (bloco D) — decididas, executam sozinhas

1. Célula < n mínimo → **sem cota**, nunca cota frouxa.
2. Bloqueante em caminho selado → conserta e re-revisa até PASS, sem perguntar.
3. Menor fora do selado → registra; lista consolidada por fase.
4. Suíte quebra em arquivo alheio → 1h de investigação; pré-existente = registra e segue.
5. Lane de geração cai → lane reserva; todas caírem → pausa só a fila de corpus.
6. Codex indisponível → fora do selado segue sem cross-review (registrado); selado espera.
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

## Protocolo de exceção

Exceção genuína (fora deste registro): a unidade afetada pausa, as demais seguem, e as perguntas
acumulam num relatório único — contexto em 3 linhas, opções com recomendação, consequência de cada.
Você responde quando sentar.

**Delegado sem consulta:** nomes de campos/códigos de erro, parsers para nomes antigos, redação de
comentários dentro das regras do projeto, ordem interna das unidades numa fase, retry técnico.
