# ESTADO — a fonte da verdade do projeto

> **Precedência:** o **código medido** vence tudo, inclusive este arquivo; **este arquivo** vence qualquer
> outro documento; os planos e o registro trazem a **razão**, não o estado.
>
> **Sobrescrito, não acrescentado.** Diz o que **é**, nunca o que aconteceu: sem histórico, sem o que
> entrou ou saiu, sem justificativa. Razão, medição e retratação ficam no registro
> (`superpowers/plans/2026-07-30-registro-de-decisoes.md`).
>
> Coluna **quem**: `OP` = operador, não reversível pelo agente. `AG` = agente, ratificável.

**Última reescrita:** 2026-08-03

---

## 1. Onde está

| item | valor |
|---|---|
| branch | `cleanfeed-mvp`, árvore limpa |
| suíte | 164 arquivos / 2.499 testes verdes (vitest) + 166 pytest no lab |
| dos quais, o avaliador | 1.265 — 1.099 em `benchmark/tests`, 166 no lab |
| typecheck | limpo |
| lint | 13 problemas pré-existentes |
| tags de release | 0 |
| `issuedAt` no descritor | `null` |

---

## 2. Domínios e células

A alegação é publicada como tabela, uma linha por célula.

| célula | material |
|---|---|
| **texto enciclopédico** | Wikipédia pt, dump 2022-03-01 |
| **texto judiciário** | Carolina, tipologia *judicial branch* |
| **domínio universitário** | Carolina, tipologia *university domains* |
| **rede social** | Carolina, tipologia *social media* |

Fora da moldura: `legislative branch`, `public domain works`, `wikis`, `datasets and other corpora`,
Stack Overflow pt, resenha de produto (B2W).

---

## 3. Vigente

### 3.1 Alegação

| # | vigente | quem |
|---|---|---|
| | a alegação é **escopada e publicada como tabela por célula**, com a moldura declarada | OP |
| | "texto em pt-BR em geral" **não é alegável** — sem moldura amostral não há estimando | OP |
| | **uma** alegação certificadora, calculada no **pior** estrato; os números por célula saem como diagnóstico não certificador, sem ajuste, rotulados como tal | OP |
| Regime 2 | cada release certifica **só a própria hipótese versionada**; erro familiar ao longo da história do produto **não é alegado**. Toda execução certificadora é publicada, passe ou reprove | OP |
| B3 | família primária `m=4`: FPR do pior estrato · recall no limiar · calibração global · integridade | OP |
| | piso de linhas: `criticalFprHumanNegatives: 300` por célula em `test` | política |
| | `zeroEventCeiling.formula` = `1 − perHypothesisAlpha^(1/n)`; célula abaixo do piso **reprova antes da selagem** | política |

### 3.2 Modelo e melhoria

| vigente | quem |
|---|---|
| `eligibleCandidate: same-weight-hash-as-v1` — a medição vale para **um** hash de pesos | política |
| acrescentar domínio à **avaliação**: pesos idênticos, bloco cego novo só para a célula nova, linha nova na tabela. As linhas antigas seguem válidas | AG |
| acrescentar domínio ao **treino**: hash novo, **todo teto publicado morre**, e é preciso material cego fresco em toda célula alegada | AG |
| melhorias de modelo são **agrupadas**, não iteradas — cada retreino custa re-medição completa | AG |
| material cego é reservado na **aquisição**, não no corte | AG |
| `blindReserveCompleteAttempts: 2`, `plannedCertifyingMeasurements: 1` | política |

### 3.3 Corpus

| vigente | quem |
|---|---|
| A1 | Stack Overflow está fora do corpus | OP |
| F0-6 | Stack Overflow bloqueado **por nome**, não apagado | AG |
| A3 | `drop_seen()` = hash exato + Jaccard ≥ 0,82 sobre shingles de 5 tokens, descrito só como isso | OP |
| A4 | antiartefato **pré-treino**; família com >2 % contaminada regenera a lane inteira | OP |
| | `domainSource` é **estrato**; a dependência é carregada por `sourceMaterialBatch` | AG · ratificar |
| | cluster exposto é barrado das **duas** partições cegas, `test` e `cal-B` | AG · ratificar |
| | só bases públicas; sem coleta autorizada individual | OP |
| | `ptbr-generic-v1` está morto como dataset | OP |
| C4 | `test` e `cal-B` selados ficam preservados | OP |

### 3.4 Licença

| # | vigente | quem |
|---|---|---|
| posição (a) | as obrigações das fontes regem aquisição, preparação e uso do **corpus**, e não se propagam aos pesos. NC é política própria. **Não é consenso jurídico** | OP |
| F0-1 | licença dos pesos: `cleanfeed-weights-nc-1.0`, família OpenRAIL-M | AG |
| F0-2 | restrição comercial só nos pesos; código MIT | AG |
| F0-3 | documentação e evidência sob CC BY 4.0 | AG |
| F0-4 | `license-review.json` está `pending` | AG |
| B2 | pesos sob NC + proibição de uso disciplinar, acadêmico, empregatício e decisório | OP |
| B4 | GitHub para código e evidência; Hugging Face **gated** para pesos | OP |

### 3.5 Processo

| vigente | quem |
|---|---|
| **decidir–registrar–ratificar**: o agente decide ancorado no escopo, registra com razão e custo de reversão, e não para. Ratificação obrigatória só antes de marco irreversível | OP |
| **nunca delegado**: D0; risco jurídico pessoal (B1); calendário; apertar botão de publicação externa; ler `test`/`cal-B`/ledger real; dinheiro além de R$60/mês | OP |
| **três etapas por unidade**: Fable verifica o desenho antes do código · Opus implementa contra o contrato · cross-review adversarial do implementado | OP |
| a etapa 3 é do **Fable** enquanto o crédito do codex não voltar; rodada do Fable não fecha dívida de codex | OP |
| A5 | revisão adversarial em caminho selado, uma rodada no resto | OP |
| toda decisão metodológica entra em `references.md` no mesmo commit, com link | OP |
| A6 | Colab Pro até R$60/mês | OP |
| A7 | rajadas pelo rate limit; teto semanal bateu, a fila pausa e retoma | OP |
| B5 | mismatch pós-exposição é terminal | OP |
| F0-7 | `access-terms-unresolved` abaixo da rota, acima da licença | AG |
| F0-8 | `blindReserveCompleteAttempts` = 2 | AG |
| | bancada em TypeScript, lab em Python | AG |

### 3.6 Invioláveis

| vigente |
|---|
| **nunca** ler `test`, `test-labels.jsonl`, nem nada sob `private/`. Calcular sha256 do ledger é permitido; escrever, não |
| **nunca** rodar `consume-holdout` de verdade |
| commits exigem `--no-verify` |
| `git ls-files --eol \| grep w/crlf` sai vazio |
| comentário no código: só regra de domínio, restrição técnica não óbvia, ou armadilha de biblioteca |
| `node --experimental-strip-types` apaga tipos: parameter properties não funcionam na CLI |

---

## 4. Abertas — só o operador

| decisão | trava |
|---|---|
| **B1** — parecer jurídico da posição (a), ou risco assumido por escrito | publicação de pesos; `license-review.json` → `approved` |
| ratificar `domainSource` como estrato | o corpus |
| manchete: **pior estrato** ou **por estrato** (`m=9`, α=0,0056, teto a n=300 vai de 1,45 % para 1,72 %) | o pré-registro |
| teto pretendido: 1,45 % (300 linhas em `test` por célula) ou 0,55 % (800) | o volume de coleta |
| corte A ou B — `superpowers/plans/2026-08-03-decisao-de-corte-A-ou-B.md` | o escopo do repositório |

---

## 5. Números medidos

### 5.1 Material em disco

| tipologia | MB | documentos |
|---|---:|---:|
| Carolina *judicial branch* | 994 | 38.189 |
| Carolina *university domains* | 169 | 26.409 |
| Carolina *social media* | 51 | 8.863 |
| Carolina *legislative branch* | 4.477 | 3.982 |
| Carolina *public domain works* | 4,7 | 26 |
| Carolina *wikis* | 5.587 | — |
| Carolina *datasets and other corpora* | 4.519 | — |
| Wikipédia pt, dump 2022-03-01 | 1.960 | — |
| B2W-Reviews01 | 49 | — |
| Stack Overflow pt (`Posts.xml`) | 784 | — |
| Madras `train-00017` (classe IA) | 263 | — |

Megabyte não é a unidade: `legislative branch` rende 0,89 documento por megabyte.

### 5.2 Aritmética da cota

`1 − α^(1/n)`, α = 0,0125, FPR medido em `test` (20 %):

| linhas em `test` | teto | por célula |
|---:|---:|---:|
| 250 | 1,74 % | 1.250 |
| 300 | 1,45 % | 1.500 |
| 800 | 0,55 % | 4.000 |

### 5.3 Medição de 25/07

Modelo **calibrado**, num limiar que o pacote atual não tem. Vale como prova de que a aritmética fecha,
não como resultado.

| estrato | FP / n | teto 98,75 % |
|---|---:|---:|
| Wikipédia | 0 / 800 | ≤ 0,55 % |
| Carolina institucional | 0 / 800 | ≤ 0,55 % |
| Carolina universitário | 20 / 745 | ≤ 4,34 % |
| B2W resenha | 57 / 800 | ≤ 9,43 % |

### 5.4 Outros

| fato | valor |
|---|---|
| componentes independentes por célula, hoje | 1 |
| guardas de integridade do pacote | 11 exercitadas, 0 sem teste |
| linhas humanas recuperáveis do corpus morto | ~1.600 após A1 |

---

## 6. NÃO APLICAR — aparecem no registro e não valem

`A2` · `B3` (só a metade do piso de 250 componentes; `m=4` vale) · `F0-5` · piso de ≈20 mil linhas
humanas · frações `45/5/10/20/20` · regra condicional 6 · bloco C inteiro exceto `C4` · pré-inscrição v3
(`benchmark/rebuild-v3-policy.json`, marcada em `.ABANDONADA.md`).

---

## 7. Dívidas

| dívida | vence |
|---|---|
| registro-linha congelado em `cal-B` não tem a proteção do de `test` | antes da v2.0, ou antes de um segundo corpus sobrepor um split vivo |
| `worker-protocol` admite `sourceLock: undefined`; a revalidação morre como `TypeError` sem código | — |
| nenhum vínculo F6 prova em que corpus os pesos atuais foram treinados | antes de publicar pesos |
| rodada 13 do cross-review do E2 | crédito do codex, 8 de agosto |
| F0-9 — duas telas antigas com over-claim de autoria humana | — |

---

## 8. Ordem de leitura

1. **este arquivo**;
2. `MANIFESTO-DE-TRANSPLANTE.md`;
3. `superpowers/plans/2026-08-03-decisao-de-corte-A-ou-B.md`;
4. `superpowers/plans/2026-07-30-v1-escopo-e-retomada.md` — como trabalhar e as armadilhas;
5. `superpowers/plans/2026-07-30-registro-de-decisoes.md` — a razão de cada decisão; procure a seção;
6. `detector-rebuild-assessment.md`;
7. `references.md`.

Dormente: `superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`.
