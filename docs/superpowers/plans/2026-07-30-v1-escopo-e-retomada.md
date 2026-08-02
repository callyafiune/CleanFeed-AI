# LEIA PRIMEIRO — escopo da v1.0 e retomada do trabalho

Documento de entrada para quem retoma o CleanFeed AI. Escrito em 2026-07-30, no fim de uma sessão
longa, para que a próxima **não dependa do histórico dela**.

> **Regra que atravessa tudo:** se algo aqui divergir do código, **o código medido vence**. Os
> `file:line` foram verificados em `05bf5fb`; o repositório se moveu 24+ vezes no dia em que isto foi
> escrito. Confirme antes de agir — nesta sessão, oito afirmações de briefs escritos por mim estavam
> erradas, e quem as verificou contra o disco acertou em todas.

## 1. O que é o projeto

Detector de texto gerado por IA em **português do Brasil**, extensão de navegador, modelo local de
~106 MB em WASM. Um desenvolvedor solo, sem verba, código público revisado por pares, política não
comercial. O diferencial não é o detector — é o **avaliador**: a auditoria registrada em
`2026-07-30-auditorias-externas.md` não achou na área uso único de teste, pré-registro, controle de
FWER, inferência cluster-robusta, cota distribution-free, manchete de pior estrato, nem um único
arquivo de teste automatizado. O artefato mediano da área é README + licença + paper.

## 2. Estado

| item | valor |
|---|---|
| branch | `cleanfeed-mvp`, árvore limpa. HEAD `05bf5fb` quando isto foi escrito; a **Fase 0 foi executada em 2026-07-31** e moveu o que segue |
| suíte | 162 arquivos / **2306** testes verdes (eram 2296 antes da Fase 0) |
| `evaluatorDigest` | **movido de propósito pela Fase 0, antes de qualquer `fit`:** `99a993f1cc18…` → o valor atual sai de `computeEvaluatorDigest`, que é onde se deve ler em vez daqui |
| ledger de consumo real | `2040fb7a…d88cd` — intocado; registra a concessão gasta em 2026-07-25 |
| arquivado | `wip/holdout-witness-attestation` (`9e6fcc7`) — testemunha de altura; a mensagem do commit a reserva para uma eventual **v3.0** |
| não tocar | `stash@{0}` (`wip: options-UI refactor`, de outra sessão) |

**Fases do plano v3 — o que está de fato fechado** (não diga "A e C concluídas"; o plano v3 registra o
contrário em dois lugares):

- **A:** A1 e A5 entregues. **A2 fecha como NÃO CONCLUÍDA contra a própria definição de pronto** —
  falta medir `calibration` fim a fim, e o número que reprova está registrado
  (`calibration/150_299 = 2/557 = 0,359 %` contra teto de 0,1 %). A3, A4, A6, A6-REMAT, A7 e LAT não
  têm registro de entrega.
- **B:** são decisões, não código.
- **C:** C2 e C5 com artefatos em disco. **O piloto de C5 refutou o próprio dimensionamento** e
  empurrou três saídas para a decisão de D1.
- **D em diante:** não começou (nenhum diretório `d*` em `benchmark/out/rebuild-v3/`). Note que
  `eol/` e `eol-review/` ali **não** são de A nem de C — vêm de `2225e37`.

## 3. D0 — DECIDIDO: caminho 1, o detector

**O operador decidiu em 2026-07-30: continuar o detector.** v1.0 experimental, sem alegação de
erro → v2.0 com **uma** medição cega. Estimativa: **4,5–7 semanas de engenharia** para a v1.0, mais
2-3 semanas para a v2.0, mais prazo externo de parecer jurídico.

As alternativas ficam registradas como descartadas: estudo de bancada (1,5–3 semanas, ~R$0) e
encerramento (2-3 dias). A recomendação do agente era o estudo; o operador decidiu pelo detector, que
é prerrogativa dele — e a decisão está registrada com essa autoria, por R4.

**Consequência: a execução está liberada.** Começa pela Fase 0 do plano da v1.0 — **executada em
2026-07-31**. As decisões que ela tomou estão em `2026-07-30-registro-de-decisoes.md`
§ "Decisões da Fase 0" (F0-1 a F0-9), com quatro achados abertos listados ali. A próxima unidade é
a **Fase 1** (corpus uma vez só). Uma coisa da Fase 0 termina esperando assinatura: `license-review
.json` ficou `pending`, porque marcar `approved` seria o agente assinando a revisão de licença no
lugar do operador.

**Uma decisão permanece aberta, e não bloqueia agora:**

- **B1 — parecer jurídico da posição (a)**: buscar parecer antes de publicar pesos, ou assumir o
  risco por escrito. Bloqueia somente a **Fase 3** (publicação); as Fases 0 a 2 correm sem ela. Não é
  delegável — o risco é pessoal do operador, não do projeto.

## 4. Ordem de leitura

Tudo em `docs/superpowers/plans/`:

1. **este documento** — orientação e escopo;
2. `2026-07-30-estado-do-projeto.md` — o *porquê* das três decisões grandes (Regime 2; a proteção
   escala com a alegação e não com o produto; posição (a) de licença). É o que não estava em disco;
3. `2026-07-30-registro-de-decisoes.md` — as decisões **em vigor por delegação**, com razão, custo de
   reversão e marco de ratificação;
4. `2026-07-30-plano-v1-minima.md` — o plano da v1.0, pós-revisão do codex. **É o roteiro de execução**;
5. `2026-07-30-auditorias-externas.md` — a auditoria da área e o veredito do codex sobre o plano, com
   fontes. É o lastro das afirmações dos outros documentos;
6. `2026-07-26-detector-v3-rebuild-implementation.md` — o plano completo; **vira o caminho da v2.0**;
7. `../../references.md` — a bibliografia: 242 entradas com link, ancoradas por decisão, com
   *Âncora* / *Onde no projeto* / *Fato citado* em cada uma. Criada em `cd6f879`. Traz também a lista
   das **24 práticas ainda sem referência** — trabalho aberto, não silêncio.

## 5. Escopo da v1.0 — o que ficou e o que a revisão do codex cortou

A revisão adversarial de 2026-07-30 (veredito **(b) aprovar com modificações**) cortou mais fundo que
o meu rascunho. **Cortado do escopo original:**

| cortado | destino | razão |
|---|---|---|
| ablação CE × label-smoothing (era 6 corridas, virou 2, agora **zero**) | v2 | duas corridas com perdas *e* seeds diferentes misturam tratamento com ruído — pseudoablação. Fica CE + seed `712019` pré-fixadas; segunda corrida só como retry técnico |
| calibrador probabilístico de G1 | v2 | a versão é declaradamente não calibrada; basta limiar provisório, jamais descrito como "conservador" ou probabilidade |
| probe adversarial de FPR com boilerplate | v2 | diagnóstico, não pré-requisito. **O gate antiartefato pré-treino NÃO é cortado** |
| reserva de segunda tentativa + ledger dedicado | fora | aceitável só porque o objetivo declarado é literalmente **uma** medição na v2 |
| datasheet como artefato separado | seção do model card | preserva a informação, poupa uma rodada documental |
| ensaio jurídico longo BY-SA × BY-NC-SA | matriz por artefato | basta matriz (código/pesos/docs) + posição assumida + riscos. **Não transformar o NOTICE em tratado** |
| desenho dos diagnósticos não certificadores da v2 | v2 | preservar agora só o que define split, poder, multiplicidade e análise primária |
| testemunha de altura no keyring, marcador pegajoso, fixação de caminho canônico | `wip/holdout-witness-attestation` | anti-fraude; sob Regime 2 o controle é detectabilidade por par, não código que o dono do disco controla |
| D0 completo (ICC), D2/MULTITuDE, D4, D5, cadeia de publicação, `role` do perfil | v2 | só importam quando há evidência a publicar |

**O que o codex recusou cortar** — e portanto é o mínimo honesto: gate antiartefato **pré-treino**
(artefato de geração contamina o treino, não só a medição), split e commitment de `cal-B`/`test`,
colocalização de linhagem, piso de abstenção no WASM, F6 mínimo, model card, varredura de alegações,
licença `approved`, e **teto `indicator` estrutural**.

**Três defeitos do produto atual que a v1.0 tem de corrigir antes de publicar:**

1. o runtime experimental **permite `blur/collapse/hide`** — `decideExperimentalUncalibrated`
   (`inference-worker.ts:727-766`, com `actionCeiling: shortText ? "indicator" : "hide"` em `:760`); um
   teste *exige* `hide` (`inference-pipeline.test.ts:1060`) — contradiz `model-validation.md:41-46`,
   que promete "**nunca** desfoca, recolhe ou oculta um post". O teto `indicator` precisa ser
   estrutural, não copy;
2. **não existe estado publicável "experimental"** — `release-policy.mjs:66-75` recusa `pending`, e
   `indicator` exige decisão científica (`model-release.ts:217-235`). Precisa de **lane nova**, que
   não reutilize `indicator-only`;
3. **R1 só começa na v2.0**, declarado — se a v1 usar o `fit` certificador, a janela congelada abre
   cedo demais e as edições da v2 em `EVALUATOR_FILES` a violam.

## 6. Como trabalhar

**Decidir–registrar–ratificar.** O agente decide ancorado no escopo, registra com razão e custo de
reversão, e **não para**. O operador ratifica lendo o registro; ratificação só é obrigatória antes de
marcos irreversíveis (selagem do corpus, publicação externa, consumo de partição selada).
Honestidade de autoria (R4): o registro diz **quem** decidiu — nunca afirmar que o operador decidiu o
que não decidiu.

**Nunca delegado:** D0; risco jurídico pessoal (parecer da posição (a)); calendário do operador;
apertar botão de publicação externa; ler `test`/`cal-B`/ledger real; dinheiro além de R$60/mês (Colab).

**Revisão em dois níveis.** Caminho selado (`EVALUATOR_FILES`, split, selagem): implementação + spec +
adversarial, repetindo até `PASS`. Todo o resto: uma rodada, achados menores registrados. Rodadas de
revisão são onde os tokens moram — nesta sessão, uma unidade "cirúrgica" consumiu 4 workflows e 11
agentes, e as rodadas acharam 10 defeitos reais.

**Referências obrigatórias.** Toda decisão metodológica entra em `docs/references.md` no mesmo commit
que a implementa, com link — de **qualquer** área, não só detecção de MGT. Hierarquia de alegação:
(i) importada com fonte revisada → citar origem e transferência; (ii) combinação nova de partes
estabelecidas → citar cada parte, a novidade é de engenharia; (iii) teoria genuinamente nova → o
projeto **não tem e não deve ter** nada nesta categoria.

**Cross-review pelo codex** antes de fechar unidade do caminho selado:
`codex exec --sandbox read-only -m gpt-5.6-sol -c model_reasoning_effort=xhigh "<prompt>"`.

## 6b. Como NÃO deixar o trabalho parado (obrigatório, medido em 2026-08-01)

Entre 2026-07-31 e 08-01 o trabalho parou repetidamente, e **sempre o operador foi quem notou**.
Quatro causas distintas foram diagnosticadas e consertadas; o desenho abaixo é o que sobrou de pé e
vale para toda sessão, não só para a unidade que o descobriu.

**Trabalho externo longo (`codex exec`, build, suíte grande) vai com TRÊS camadas, e cada uma cobre
a falha da anterior. Nenhuma isolada basta.**

1. **`nohup`, para sobreviver ao timeout da ferramenta.** O `timeout` do Bash tem **máximo de 10
   minutos** e uma revisão do codex leva ~1,5 h — `run_in_background` sozinho corre o risco de ser
   morto no meio, em silêncio. `nohup <cmd> > saida.txt 2>&1 &`.
2. **Sentinela na saída, para conclusão detectável por CONTEÚDO.** O comando anexa
   `===<NOME>-CONCLUIDA status=$?===` ao terminar, e também a `.codex-reviews/.sentinelas.log`.
   Assim um `tail` responde "acabou?" mesmo se o rastreamento se perder, e o status separa conclusão
   de crash.
3. **`Monitor` com `persistent: true`, condicionado à SENTINELA** — é a ferramenta feita para watch
   de duração de sessão:
   `tail -f -n 0 .codex-reviews/.sentinelas.log | grep --line-buffered -E 'CONCLUIDA|VEREDITO|FALHOU'`.

**E a regra que engloba as três: nunca encerre um turno sem trabalho em voo.** Termine lançando a
próxima verificação em background, para que o fim de um turno *cause* o início do próximo — o harness
re-invoca na conclusão. Encadeamento, não vigilância.

4. **Interruptor de homem morto, para a falha que as três não conseguem VER.** As camadas 1 a 3 são
   detectores de trabalho que EXISTE: sentinela e Monitor precisam de algo rodando para observar. A
   falha medida em 2026-08-02 foi outra — **turno encerrado com nada em voo**, terminando numa
   pergunta ao operador. Nenhuma sentinela existia, então nenhuma camada podia disparar, e quem notou
   foi o operador. Outra vez.

   A regra acima ("nunca encerre um turno sem trabalho em voo") era **resolução, não mecanismo**, e o
   único mecanismo que a implementaria — cron — está listado abaixo como morto. O conserto é um
   temporizador feito **só** de mecanismos já provados aqui:

   ```bash
   nohup bash armar-retomada.sh <segundos> <MOTIVO> > /dev/null 2>&1 &
   # sleep N; echo "===RETOMAR-AGORA-CONCLUIDA motivo=... ===" >> .codex-reviews/.sentinelas.log
   ```

   `nohup` (camada 1) + sentinela (camada 2) + o `Monitor persistent` que já observa o log (camada 3).
   Nenhum mecanismo novo. ~~Quando um turno terminaria sem nada em voo, arme isto antes de terminar.~~ — **esta instrução
   FALHOU; ver a correção logo abaixo.**

**A instrução "arme antes de terminar o turno" FALHOU, medida em 2026-08-02.** O mecanismo estava
   pronto e provado, e eu simplesmente não o armei — o operador voltou a perguntar "o que está
   rodando?" e a resposta era nada. **Um mecanismo que depende do agente lembrar de acioná-lo não
   conserta esquecimento: ele move o ponto de falha para dentro do agente.**

   **O que vale é BATIMENTO PERMANENTE, armado UMA vez por sessão:**

   ```bash
   nohup bash batimento.sh 1200 > /dev/null 2>&1 &
   # while true; do sleep 1200; echo "===BATIMENTO-CONCLUIDA n=N===" >> .sentinelas.log; done
   ```

   A diferença não é o mecanismo — é ONDE a decisão acontece. Com o interruptor por turno, "continuar
   ou parar" era decidido no fim do turno, que é precisamente o momento em que o agente erra. Com o
   batimento, nunca existe turno sem fonte de despertar pendente, e a decisão passa a ser tomada
   **acordado**, ao receber o batimento, olhando o estado real: há item pendente no todo? há bloqueio
   externo? Se o trabalho realmente acabou, mate o batimento (`pkill -f batimento.sh`) — parar passa a
   ser um ATO explícito, e não a ausência de um.

   Continua feito só do que foi provado aqui: `nohup`, sentinela com token que casa o padrão vivo do
   Monitor, e `Monitor persistent`. Nada de cron.

   **O token TEM de casar o padrão do Monitor.** A primeira versão emitia `RETOMAR-AGORA` e o padrão
   vivo é `CONCLUIDA|VEREDITO|FALHOU` — a sentinela cairia num log que ninguém observa, que é a mesma
   guarda inalcançável que o E2 passou dez rodadas consertando. **Medir o padrão pelo que de fato
   acordou a sessão, não pelo que este documento afirma**, e provar a camada com um disparo curto antes
   de confiar nela: a prova de 90 s foi feita em 2026-08-02 e o Monitor acordou.

   Vale também como rede para morte silenciosa: a primeira tentativa da rodada 10 do cross-review morreu
   por refresh de token (`EXIT=1`) e a notificação de conclusão chegou normalmente — mas se não tivesse
   chegado, só um temporizador traria a sessão de volta.

**E o teste de conteúdo, porque a falha de 2026-08-02 foi volitiva e não mecânica:** se a última frase
do turno é uma pergunta ao operador, o item está na lista fechada de nunca-delegado (§ "Emenda ao
decidir–registrar–ratificar")? Se **não** está, a pergunta é a falha — decida, registre e siga. Disparar
uma rodada de revisão, escolher entre duas implementações, ordenar consertos: nada disso está na lista.

**AUDITORIA DE MUTAÇÃO EM LOTE, para a família de defeito mais frequente desta unidade.** "Teste que
passa pelo motivo errado" apareceu em quatro rodadas de cross-review. Ela é automatizável: para cada
código de erro do módulo, desligue TODOS os `throw` daquele código trocando `throw new X(` por
`void new X(` — mesma aridade, mesmo construtor, sem lançar — rode a suíte e registre se algo ficou
vermelho. Guarda cuja remoção deixa tudo verde não tem teste que a exercite.

Medido em `benchmark/split-artifact.ts` (2026-08-02): **29 guardas, 17 exercitadas, 7 sem teste
nenhum** — entre elas as duas do atestado de composição, que são o centro da regra que exige o
atestado derivado. Sete testes foram escritos a partir disso.

Três exigências que o arnês precisa ter, aprendidas errando:

1. **Verifique a LINHA DE BASE verde antes de mutar.** Sem isso, "suíte vermelha" não distingue
   mutação eficaz de suíte já quebrada.
2. **Restaure num `finally`, com backup conferido por `diff` depois.** O script muta o mesmo arquivo
   dezenas de vezes; a restauração é a única parte que não pode falhar.
3. **Capture BYTES e decodifique à mão.** `text=True` no Python usa cp1252 no Windows e o vitest emite
   UTF-8 — isso matou duas tentativas, e é falha do arnês, não do alvo.

E o limite do método, que precisa ser dito: o padrão só muta `throw` cujo código é literal ali. Guarda
que lança de dentro de um helper (o código vira parâmetro) aparece como "não mutável" e tem de ser
conferida à mão — foi o caso de quatro delas.

**O que NÃO funciona, medido, para ninguém tentar de novo:**

- **`nohup` dentro de chamada em primeiro plano.** Entrega o processo ao SO e não deixa nada para o
  harness rastrear.
- **Esperar por NOME de processo.** `ps -W | grep -ci codex` casa o `codex.exe` da extensão do VS
  Code, que **nunca morre** — a condição fica insatisfazível por construção e o laço gira até o
  timeout sem avisar nada.
- **Cron (`CronCreate`) como rede de segurança.** Um watchdog `*/5 * * * *` foi criado e **nunca
  disparou nem uma vez**, mesmo com intervalos bem maiores que cinco minutos entre prompts. A causa
  está fora do que o agente consegue observar (não há log de disparos legível), então cron **não** é
  confiável aqui. `Monitor persistent` é — e foi observado funcionando.
- **Encerrar turno em RELATÓRIO.** Foi a segunda causa mais frequente: dimensionar a tarefa e
  resumi-la virou substituto de fazê-la. Relatório não é entregável; se há o que dizer, diga em
  poucas linhas **junto com** a próxima ação, nunca em lugar dela.
- **Cron continua morto, e o watchdog fantasma é pior que nenhum.** O job `*/5 * * * *` criado em
  2026-08-01 **ainda existia em 2026-08-02**, nunca disparou uma vez, e o conteúdo dele esperava por
  NOME de processo — a técnica que esta mesma lista já marcava como quebrada. Deletado. Watchdog que
  não dispara não é rede de segurança: é falsa garantia, e faz o agente confiar numa camada inexistente.

**Duas regras de evidência que vêm no mesmo pacote:**

- Só afirme "estou aguardando X" **depois** de ter conferido X pelo menos uma vez naquele turno.
  Aguardar não é estado que se presume; é estado que se verifica. Afirmei duas vezes estar aguardando
  revisões que já estavam prontas.
- Imprima `pwd` na **mesma invocação** de qualquer medição que valha como evidência. A cwd derivou
  para o tree principal **três vezes**, e numa delas eu li o arquivo errado e conclui errado por
  várias chamadas. Uma varredura que devolve "limpo" é indistinguível de uma varredura no diretório
  errado.

## 7. Regras invioláveis do repositório

- **NUNCA** ler a partição `test`, `test-labels.jsonl`, nem nada sob
  `benchmark/data/corpus-build/private/`. Calcular o sha256 do ledger para provar que não mudou é
  permitido; escrever, não. Testar em `mkdtemp`.
- **NUNCA** rodar `consume-holdout` de verdade.
- Commits exigem `--no-verify` (hook de nome de branch da organização).
- Repo é `* text=auto eol=lf`: `git ls-files --eol | grep w/crlf` tem de sair vazio.
- **Comentários no código:** proibido comentar processo, histórico, número de tarefa, "antes era
  assim". Só regra de domínio que o código não revela, restrição técnica não óbvia, ou armadilha de
  biblioteca. Regra do operador, vale mais que qualquer convenção.
- `node --experimental-strip-types` **apaga tipos**: parameter properties
  (`constructor(private readonly x)`) não funcionam na CLI. Campo declarado + atribuição no corpo.
  Este defeito já matou a CLI com 2126 testes verdes ao lado.

## 8. Armadilhas que custaram tempo (não repita)

- **citar por linha.** O plano tem 8.500+ linhas e se moveu 24 vezes num dia. Cite por **âncora**
  (título de seção + frase);
- **`od -c f | grep -c '\r'`** com aspas simples casa toda linha com a letra "r" — centenas de falsos
  positivos. Meça CR com Python;
- **acreditar em brief meu sem verificar.** Oito afirmações erradas numa unidade;
- **`m=61` no Bonferroni** era autodestrutivo: α=0,00082 → cota 2,8% em n=250, quando publicar ~1%
  exigiria 700+ registros por célula. Corrigido para família primária **m=4**;
- **fonte ≠ registro.** A política congelada tem **cinco** estratos
  (`rebuild-v3-policy.json:114-120`), não quatro; quatro é o número de *fontes*;
- **`license-review.json` precisa de `approved`**, não `reviewed` — o gate exige a string literal
  (`assert-release-gates.mjs:273-297`);
- **o splitter era estruturalmente de três partições, e a migração foi trabalho real** — feita
  em 2026-07-31 (E2). Hoje `split.ts` deriva `Partition` de uma tupla única de cinco nomes e a
  auditoria lê os alvos do pré-registro. A citação `commands/split.ts:108-115` que este documento
  trazia caía num comentário de linhagem, não na evidência estrutural.
