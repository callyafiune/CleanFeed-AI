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
- **o splitter atual é estruturalmente de três partições** (`split.ts:143-155`,
  `commands/split.ts:108-115`). Migrar para cinco é trabalho real, não configuração.
