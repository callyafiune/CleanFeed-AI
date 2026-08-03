# ESTADO — o que é verdade agora

> **Este arquivo é SOBRESCRITO, não acrescentado.** É a única exceção à convenção do projeto de nunca
> corrigir registro em silêncio — e existe justamente por causa dela.
>
> O registro de decisões (`superpowers/plans/2026-07-30-registro-de-decisoes.md`) cresce
> monotonicamente porque medição registrada não se corrige: toda correção é uma adição. Isso é certo
> para **medição** e errado para **estado**. Consequência medida: 3 mil linhas, e descobrir o que vale
> hoje virou arqueologia em ordem inversa.
>
> A divisão: **medição e retratação** ficam no registro, append-only. **Estado** fica aqui, e é
> reescrito. Se os dois divergirem, o **código medido** vence os dois.

**Última reescrita:** 2026-08-03

## Onde está

| item | valor |
|---|---|
| branch | `cleanfeed-mvp`, árvore limpa |
| suíte | 164 arquivos / **2.499** testes verdes |
| typecheck | limpo |
| lint | 13 problemas **pré-existentes** (7 num arquivo vendorizado do chrome-for-testing, 1 em `build_governance.ts`, 2 warnings de react-refresh) |
| tags de release | **0** — nada nunca foi publicado |
| `issuedAt` no descritor | `null` — nunca empacotado |

## A decisão que bloqueia tudo

**`2026-08-03-decisao-de-corte-A-ou-B.md`** está sem preencher. Enquanto estiver:

- nenhuma unidade nova é aberta;
- a fila de endurecimento está parada.

Opção A publica o preview (não alega nada, logo não precisa de corpus; bloqueada na assinatura de B1).
Opção B publica o avaliador (1,5–3 semanas, R$0, abandona o produto).

## O que está bloqueado, e por quem

| bloqueio | quem resolve | o que ele trava |
|---|---|---|
| **B1** — parecer jurídico da posição (a) ou risco assumido por escrito | operador | publicação de pesos (opção A) |
| `license-review.json` → `approved` | operador (é a assinatura de B1) | idem |
| **ratificação de `domainSource`** como estrato e não eixo de dependência | operador | o corpus inteiro — sem ela os outros seis passos da F1-5q são renomear campos |
| decisão de `cal-B` (herda a barreira de `test`) | operador, no marco da montagem | quais linhas entram em `cal-B` |

## O que está medido e não deve ser re-descoberto

| fato | número |
|---|---|
| corpus `ptbr-generic-v1` | **morto** como dataset; **1.600** das 4.000 linhas humanas recuperáveis após A1 |
| componentes independentes por célula | **1**, contra piso de **250** |
| FPR por registro na medição de 25/07 | B2W **7,12 %**, Carolina-universitário **2,68 %**, outros três 0 % |
| linhas humanas necessárias, material novo | **18.400**, das quais 8.000 de cluster inédito |
| fontes públicas | 3 utilizáveis; PT.SO **bloqueado** pelo termo de acesso de 2024 |
| guardas de integridade do pacote | **11** exercitadas, 0 sem teste |

## Dívidas nomeadas e não implementadas

1. **registro-linha congelado em `cal-B` não tem a proteção do de `test`** — consertar exige alargar
   `inTest`, que reinterpretaria eventos já em disco. Vence antes da v2.0 ou antes de um segundo corpus
   sobrepor um split vivo;
2. **`worker-protocol` admite `sourceLock: undefined`** — a revalidação morre como `TypeError` sem
   código. Fail-closed, fora da disciplina de erro codificado. O conserto certo é o worker **parsear** na
   fronteira, e isso dissolve também o `experimental`-com-perfis;
3. **nenhum vínculo F6** prova em que corpus os pesos atuais foram treinados.

## Ordem de leitura, curta

1. **este arquivo** — o que é verdade agora;
2. `superpowers/plans/2026-08-03-decisao-de-corte-A-ou-B.md` — a decisão aberta;
3. `superpowers/plans/2026-07-30-v1-escopo-e-retomada.md` — como trabalhar, e as armadilhas que já
   custaram tempo (a parte de estado dele foi superada por este arquivo);
4. `superpowers/plans/2026-07-30-registro-de-decisoes.md` — as decisões em vigor, com razão e custo de
   reversão. **Não leia inteiro**: procure a seção;
5. `detector-rebuild-assessment.md` — o diagnóstico dos oito defeitos de 25/07;
6. `references.md` — 270 entradas ancoradas por decisão.

Dormente, para consulta e não para execução: `superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`.

## O que foi apagado em 2026-08-03, e por quê

**11.782 linhas — 46 % do planejamento — removidas.** O git as preserva.

| geração | arquivos | linhas | razão |
|---|---:|---:|---|
| `2026-07-14-cleanfeed-ai-*` | 6 | 4.019 | **outro produto** — extensão de filtro de feed do LinkedIn com personalização. Zero citações externas |
| `docs/phase-reports/` | 5 | 439 | relatórios das fases daquele produto |
| `2026-07-19-cleanfeed-ai-tmr-*` | 5 | 6.524 | superada pelo plano v3, que era a única a citá-la |
| `superpowers/specs/2026-07-19-tmr-ptbr-classifier-design.md` | 1 | 632 | idem |
| `2026-07-22-cleanfeed-ptbr-detector-v2-finetune.md` | 1 | 168 | superada; citada só por `references.md` |

Os dois pontos que ficariam pendurados foram consertados no mesmo commit: a entrada de XLM-R em
`references.md` perdeu a citação ao 07-22 e manteve as válidas, e as duas menções do plano v3 foram
neutralizadas.
