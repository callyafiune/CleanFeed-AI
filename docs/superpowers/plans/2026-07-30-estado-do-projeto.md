# Estado do projeto — 2026-07-30

**Para que serve:** este documento existe porque o raciocínio de três decisões grandes desta sessão
vivia só na conversa. Uma sessão nova que leia isto, o `2026-07-30-registro-de-decisoes.md` e o
`2026-07-30-plano-v1-minima.md` retoma o trabalho sem depender do histórico. Se algo aqui divergir do código,
**o código medido vence** — os `file:line` abaixo foram verificados em `05bf5fb` e o repositório se
moveu 24+ vezes no dia em que isto foi escrito.

## Onde as coisas estão

| item | estado |
|---|---|
| branch de trabalho | `cleanfeed-mvp`, HEAD `05bf5fb`, árvore limpa |
| suíte | 162 arquivos / 2296 testes verdes |
| `evaluatorDigest` | `99a993f1cc18243eed168db7bc804b931b25a0799a8ad0ec0c1bb9314cdf8b62` (mudou 3× no dia: `afa31a9d` → `6948ed00` → `99a993f1`) |
| ledger de consumo real | `2040fb7a…d88cd` — intocado; registra a concessão gasta em 2026-07-25 |
| fases do plano v3 | **A2 fecha como NÃO CONCLUÍDA** contra a própria definição de pronto (falta medir `calibration` fim a fim; `calibration/150_299 = 0,359 %` contra teto de 0,1 %); A1 e A5 entregues; o piloto de **C5 refutou** o próprio dimensionamento e empurrou três saídas para D1; **D em diante não começou**. Detalhe em `2026-07-30-v1-escopo-e-retomada.md` §2 |
| WIP arquivado | `wip/holdout-witness-attestation` (`9e6fcc7`) — testemunha de altura, cortada do escopo |
| `stash@{0}` | `wip: options-UI refactor`, de outra sessão — **não tocar** |

## Decisão 1 — Regime 2, e por que ele dissolve o problema em vez de resolvê-lo

**O problema.** Uma segunda tentativa de release reusa o mesmo bloco cego. Se o projeto alegasse
controle de erro *familiar* ao longo da história do produto, `FWER = 1 − (1 − 0,05)^K` para K
tentativas independentes — e cada tentativa **capaz de aceitar** conta, independentemente do
resultado realizado. Eu tentei escrever uma cláusula de futilidade que gastaria alfa só na aceitação;
o codex refutou corretamente: alfa é limite *ex ante* sobre a probabilidade de falsa aceitação.

**A saída adotada.** Regime 2: cada release certifica **somente a própria hipótese versionada**, com
confiança marginal (95% unilateral, não ajustada por família). A alegação de erro familiar ao longo
da história do produto é **expressamente abandonada**. Em troca, **toda execução certificadora é
publicada, passe ou reprove**.

**Por que é honesto e não é truque:** o que se perde é uma alegação que o projeto nunca poderia
sustentar de qualquer forma (K não é conhecido antecipadamente, e as tentativas não são
independentes). O que se ganha é uma alegação verdadeira e verificável. O leitor vê todas as
tentativas e julga a história completa por si.

**Consequência que quase passou batido:** o faseamento v1.0 → v2.0 só é gratuito *por causa* do
Regime 2. Sob validade por versão, uma v1.0 sem alegação e uma v2.0 com alegação medida não têm
problema de família nenhum. Sob Regime 1, o mesmo faseamento custaria alfa.

## Decisão 2 — a proteção escala com a ALEGAÇÃO, não com o produto

Este é o reenquadramento que motivou o corte de escopo, e o que faltava em disco.

O operador perguntou se não estávamos matando formiga com bazuca. A resposta medida: **a formiga não
é pequena** (falso positivo é acusação contra pessoa; o dano da área é documentado — Turnitin, viés
contra escritor não nativo, estudantes acusados), **mas a bazuca estava apontada para a alegação, não
para o produto.**

- ferramenta que diz *"padrões compatíveis com IA; não quantificamos nosso erro"* → precisa de model
  card, datasheet, limitações. É o padrão da área.
- ferramenta que diz *"FPR ≤ X% com 95% de confiança"* → precisa de tudo que construímos.

São produtos diferentes, e o operador nunca havia sido perguntado qual queria.

**O erro que eu cometi e que este documento registra:** recomendei a testemunha de altura no keyring
*depois* de o Regime 2 ter sido adotado, sem re-escopar. Quase toda a maquinaria de imposição
(identidade de bloco, testemunha, marcador pegajoso, fixação de caminho) defende contra **o próprio
desenvolvedor** — um operador que viu escores ruins e quer rodar de novo. Esse é modelo de ameaça de
produto comercial. Para projeto solo open-source, com publicação obrigatória de toda execução, o
controle é **detectabilidade por par**, não impedimento por código que o fraudador controla: quem
reconsome o bloco tem de publicar as duas corridas (visível) ou suprimir uma (fraude que nenhum
código impede — ele é dono do disco).

Construímos a camada de imposição **antes** de escolher o regime de divulgação, e não voltamos para
cortar depois de escolher.

**O que ficou e por quê:** os commits `cf970ae` (identidade de bloco separada da do candidato) e
`937dc80` (ledger ausente ≠ bloco não gasto; arquivo apagado ≠ álibi) **ficam**, porque impedem a
queima **acidental** — que foi literalmente a falha de 2026-07-25, um acidente procedural, não
fraude. O que saiu é a camada anti-fraude.

## Decisão 3 — licença: a posição (a), e o que ela realmente compra

**O conflito.** Se o modelo for obra derivada das fontes de treino, as obrigações colidem de forma
insolúvel: **CC BY-SA** (Wikipedia) proíbe acrescentar restrição, logo proíbe NC; **CC BY-NC-SA**
(Carolina, B2W) exige que o derivado saia sob a mesma licença, que inclui NC. Não existe licença que
satisfaça as duas — a própria Creative Commons documenta a incompatibilidade.

**A posição adotada (a):** as obrigações das fontes regem aquisição, preparação e uso do **corpus**;
o projeto sustenta que **não se propagam automaticamente aos pesos**. Sob (a), nenhuma das duas
famílias impõe obrigação ao artefato, e a escolha de NC passa a ser **política própria do projeto**
(`noncommercial-v1`), não obrigação herdada.

**O que (a) NÃO é:** não é consenso jurídico, e não é conclusão da Creative Commons. O primer da CC
diz que modelos frequentemente não são adaptações, **mas ressalva** que treino envolve cópias e que
jurisdições divergem — e o Brasil não tem exceção clara de mineração de dados. É **decisão de risco
do operador**, e o plano exige que seja escrita como tal, nunca implícita.

**O que ela exige em código, e não é troca de parágrafo:** `source-manifest.ts` hoje *afirma o
oposto* — `artifactLicenseObligations` deriva as obrigações do artefato da união das licenças de
fonte, e testes nomeados prendem essa união. Reescopar significa separar `source/corpus obligations`
de `weight/output policy`, mudar os testes para **recusar** a frase "pesos herdam as obrigações", e
mover o `evaluatorDigest` deliberadamente — antes de qualquer `fit`.

**Independente de (a):** o dump do Stack Overflow tem termo de acesso (2024) que exclui projetos de
treino de LLM. Termo de acesso é **independente** da tese sobre obra derivada. Documentar não resolve:
ou disposição jurídica verificável, ou a fonte sai. Decisão A1 do registro: **sai**.

## O que a auditoria externa estabeleceu (2026-07-30)

10 benchmarks, 7 shared tasks, 12 repositórios. Não existe na área: uso único de teste,
pré-registro (**zero** ocorrências), controle de FWER, inferência cluster-robusta, cota
distribution-free, manchete de pior estrato, tratamento de erro de inferência, estado epistêmico de
grupo, **nem um único arquivo de teste automatizado**. Artefato mediano: README + licença + paper.

Quatro erros de dosagem nossos, todos corrigidos no registro: `m=61` era autodestrutivo
(α=0,00082 → cota 2,8% em n=250); `cal-B` do tamanho de `dev`; cota estratificada só por comprimento;
e cota de FPR publicada sem número de poder.

**A parte valiosa e inédita do projeto não é o detector — é o avaliador.** O detector é uma semana de
fine-tune que qualquer um faz; a bancada honesta é o que ninguém fez. Isso é o que sustenta o
caminho 2 (estudo) como alternativa de valor equivalente e custo muito menor.

## O que trava agora

Uma decisão: **D0** — caminho 1 (detector v1.0→v2.0, 4,5–7 semanas + parecer), caminho 2 (estudo,
1,5–3 semanas, ~R$0), caminho 3 (encerrar bem, 2-3 dias). Recomendação registrada: **2**.

Todo o resto está decidido e em vigor por delegação em `2026-07-30-registro-de-decisoes.md`.
