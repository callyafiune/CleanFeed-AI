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
| A5 | Revisão adversarial só em caminho selado; 1 rodada no resto, menores registrados | rodadas de revisão são onde os tokens moram; o selado protege a bala, o resto não | subir de nível a qualquer momento | — |
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
escrita com caracteres **backspace** (`0x08`) no lugar de ``, por escape perdido no pipeline de
edição. Um regex com backspace simplesmente nunca casa, a suíte ficou verde, e o único sinal foi
inspecionar os bytes. Registro porque a falha é invisível por construção: teste verde sobre padrão
que não casa nada.

**Não afirmado pelo codex:** ele não conseguiu rodar a vitest (sandbox read-only bloqueou
`node_modules/.vite-temp`), então o veredito dele **não** inclui "a suíte passa". Essa parte é
medição minha: 162 arquivos / 2307 testes verdes.

**Achados abertos, registrados e não consertados** (rule 3 do bloco D):

1. `HUMAN_LABEL_DENIAL` (`benchmark/source-manifest.ts`) não inclui `nenhum`/`nenhuma`, então
   `humanLabelOverclaimIn` e `reviewOverclaimIn` recusam denegações corretas. Conserto é de uma
   linha; o efeito é afrouxar duas telas de caminho selado, então quer rodada própria.
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

## Protocolo de exceção

Exceção genuína (fora deste registro): a unidade afetada pausa, as demais seguem, e as perguntas
acumulam num relatório único — contexto em 3 linhas, opções com recomendação, consequência de cada.
Você responde quando sentar.

**Delegado sem consulta:** nomes de campos/códigos de erro, parsers para nomes antigos, redação de
comentários dentro das regras do projeto, ordem interna das unidades numa fase, retry técnico.
