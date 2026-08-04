# ESTADO — a fonte da verdade do projeto

> **Este é o documento que se lê primeiro, e o que vale em caso de conflito.** Precedência: o **código
> medido** vence tudo, inclusive este arquivo; **este arquivo** vence qualquer outro documento; os planos
> e o registro trazem a **razão**, não o estado. Um documento que contradiga este deve ser emendado para
> apontar para cá.
>
> **Sobrescrito, não acrescentado.** Diz o que **é**, nunca o que aconteceu: sem histórico, sem o que
> entrou ou saiu, sem justificativa. Razão, narrativa e retratação ficam no registro
> (`superpowers/plans/2026-07-30-registro-de-decisoes.md`); os **valores medidos vigentes** vivem em
> § 5, cada um com a data ou o artefato da medição.
>
> Coluna **quem**: `OP` = operador, não reversível pelo agente · `AG` = agente, ratificável ·
> `código` = imposto por código medido · `herdado` = valor da pré-inscrição v3 abandonada que a nova
> reafirma, até a nova dizer diferente.

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
| **texto de domínio universitário** | Carolina, tipologia *university domains* |
| **rede social** | Carolina, tipologia *social media* |

Fora da moldura: *legislative branch*, *public domain works*, *wikis*, *datasets and other corpora*,
Stack Overflow pt, resenha de produto (B2W).

---

## 3. Vigente

### 3.1 Alegação

| # | vigente | quem |
|---|---|---|
| | a alegação é **escopada e publicada como tabela por célula**, com a moldura declarada | OP |
| | "texto em pt-BR em geral" **não é alegável** — sem moldura amostral não há estimando | OP |
| | a família certificadora é **por estrato**: quatro tetos de FPR (um por célula) + recall no limiar + calibração global + integridade — **`m=7`**, α = 0,05/7 ≈ 0,0071 | OP |
| Regime 2 | cada release certifica **só a própria hipótese versionada**; erro familiar ao longo da história do produto **não é alegado**. Toda execução certificadora é publicada, passe ou reprove | OP |
| | piso de linhas: 300 negativos humanos por célula em `test` (`criticalFprHumanNegatives`) | herdado |
| | alvo de coleta: **~1.750 linhas humanas por célula** (~7.000 no total) — o piso derivado permanece 1.500/célula, e a folga existe para o sorteio não reprovar o gate de 300 em `test` por flutuação; teto sob zero eventos ≈ **1,63 %** por célula | OP |
| | teto sob zero eventos: `1 − α^(1/n)`; célula abaixo do piso **reprova antes da selagem** | herdado |

### 3.2 Modelo e melhoria

| vigente | quem |
|---|---|
| a medição vale para **um** hash de pesos (`eligibleCandidate: same-weight-hash-as-v1`) | herdado |
| acrescentar domínio à **avaliação**: pesos idênticos, bloco cego novo só para a célula nova, linha nova na tabela. As linhas antigas seguem válidas | AG |
| acrescentar domínio ao **treino**: hash novo, **todo teto publicado morre**, e é preciso material cego fresco em toda célula alegada | AG |
| melhorias de modelo são **agrupadas**, não iteradas — cada retreino custa re-medição completa | AG |
| material cego é reservado na **aquisição**, não no corte | AG |
| `blindReserveCompleteAttempts: 2` · `plannedCertifyingMeasurements: 1` | herdado |

### 3.3 Corpus

| # | vigente | quem |
|---|---|---|
| | rótulo `human` = corte de data **pré-ChatGPT** (`< 2022-11-30`), por campo do documento — nunca por declaração. Na Carolina o corte pelo header TEI é **load-bearing**: a Bea 2.0 contém datas de 2024 e 2025 | OP |
| | licença lida **por documento** (header TEI), com allowlist fail-closed no extrator | AG |
| A1 | Stack Overflow está fora do corpus | OP |
| F0-6 | Stack Overflow bloqueado **por nome**, não apagado | AG |
| A3 | `drop_seen()` = hash exato + Jaccard ≥ 0,82 sobre shingles de 5 tokens, descrito só como isso | OP |
| A4 | gate antiartefato **pré-treino** | OP |
| | família com >2 % contaminada **regenera a lane inteira** — poda seletiva mascara o viés da lane | AG |
| R4 | todo registro gerado nasce **`automated/unreviewed`**; a auditoria de PII é **amostral** e não produz `passed` por registro | OP |
| | linhagem: todo gerado **que declara pai** referencia pai presente; `assertDerivedParentsResolve` roda antes do split. A admissão de pai `notApplicable` é lacuna aberta (§ 7) | AG |
| | famílias OpenAI ficam **reservadas ao teste de gerador não visto** (OOD); nenhuma entra em treino | AG |
| | `domainSource` é **estrato**; `sourceMaterialBatch` carrega a dependência como eixo de **registro, manifesto e ledger** — **não** entra na união do split (`splitUnionsOnDependencyAxis: false`); a dependência intra-célula fica com `author`, `source`, `nearDuplicate` e linhagem | OP |
| | **unidades independentes** = componentes conexos por **documento de origem**, com ≤ 1 linha por documento por célula | OP |
| | partições cegas = `test` e `cal-B`, privadas e byte-intocadas até a v2.0 | OP |
| | cluster exposto é barrado das **duas** partições cegas | AG · ratificar |
| | o vocabulário de partições do código é `train / dev / cal-A / cal-B / test`; o **desenho** de partições da pré-inscrição nova é re-derivável, incluindo a existência de `cal-B` | AG |
| | só bases públicas; sem coleta autorizada individual | OP |
| | `ptbr-generic-v1` está morto como dataset | OP |
| C4 | `test` e `cal-B` selados ficam preservados | AG |

### 3.4 Gasto e cegueira

O que "corpus inutilizado" significa — a semântica é **graduada**, nunca tudo-ou-nada.

| vigente | quem |
|---|---|
| a cegueira é **informacional** (R2): digest novo, id novo ou repositório novo **não** a restauram | OP |
| registro-linha que esteve em `test` consumido: fora das **cinco** partições, para sempre. Quase-duplicata desse conteúdo (hash exato ou Jaccard ≥ 0,82): fora das **cegas** | código |
| cluster exposto em **qualquer** partição anterior: fora **só** das cegas — segue elegível para `train`, `dev` e `cal-A` | código |
| conhecimento de nível de **estrato, lote, receita ou semântica** não invalida material. A comparação de exposição lê `author`, `source`, `humanSeed`, `derivationRoot` e conteúdo — nada mais | código |
| a lease do holdout é consumida no **`started`**, de mão única; `completed` e `failed` são terminais; **ledger ausente ≠ bloco não gasto** | código |
| abandonar pré-inscrição depois de ver a **estrutura dos grupos** é legítimo; depois de ver **resultados**, não | OP |
| resultado de **terceiro** sobre o candidato que o operador venha a ver conta como **exposição** e é registrado como tal | OP |

### 3.5 Produto e treino

| vigente | quem |
|---|---|
| **a entrega principal é o MODELO** — pesos + tokenizer + model card + tabela por célula —, **abstraído de toda questão técnica de navegador**. A extensão é consumidora downstream, fora da entrega principal | OP |
|---|---|
| o preview experimental **não faz alegação de erro**, não executa `fit` certificador e não abre concessão; **R1 só começa na v2.0** | OP |
| a única descrição de erro publicável antes de medição é a frase R7-correta: *"A taxa de erro desta versão no domínio de uso não foi estimada em holdout independente. Resultados de desenvolvimento não são estimativas publicáveis e não sustentam conclusão sobre autoria ou sobre pessoas."* | OP |
| teto de ação **`indicator` estrutural** no caminho não calibrado (tipo de retorno pinado); a lane `experimental` é o único `pending` publicável — `profileDigests: []`, `evidenceDigest: null`, `issuedAt` obrigatório | código |
| opt-in **desligado por padrão**; disclosure persistente em cada resultado; nenhum rótulo de autoria nem confiança numérica | OP |
| proibição de uso disciplinar, acadêmico, empregatício ou decisório; não iniciar acusação formal com base no sinal; revisão humana não salva sinal não validado — exige evidência independente do processo | OP |
| os pesos viajam com a mesma política de uso — a copy da extensão não acompanha pesos extraídos | OP |
| treino: **cross-entropy + seed `712019` pré-fixadas, sem ablação**; segunda corrida só como retry técnico, nunca seleção | OP |
| **sem calibrador probabilístico na v1**: limiar experimental provisório, versionado, jamais descrito como "conservador", "alta confiança" ou probabilidade | OP |
| probe adversarial de FPR: **v2** | OP |
| datasheet = **seção do model card**, não artefato separado | OP |
| reserva dedicada de segunda tentativa: **fora do escopo da v1** — o valor congelado `2` permanece (F0-8), a divergência é declarada | OP |
| gate interno de não degeneração em `dev + cal-A`; **valores observados não publicados** (R8) | OP |
| a v1 publica somente **commitments agregados** (`datasetDigest`, `splitDigest`, instante, contagens não reconstruíveis); seed, assignments e hashes por registro só saem **depois** da medição v2 | OP |
| **não** publicar o universo candidato reproduzível; **não** publicar relatório externo sobre o mesmo candidato antes da v2 | OP |

### 3.6 Licença

| # | vigente | quem |
|---|---|---|
| posição (a) | as obrigações das fontes regem aquisição, preparação e uso do **corpus**, e não se propagam aos pesos. NC é política própria. **Não é consenso jurídico** | OP |
| F0-1 | licença dos pesos: `cleanfeed-weights-nc-1.0`, família OpenRAIL-M | AG |
| F0-2 | restrição comercial só nos pesos; código MIT | AG |
| F0-3 | documentação e evidência sob CC BY 4.0 | AG |
| F0-4 | `license-review.json` está `pending` | AG |
| B2 | pesos sob NC + proibição de uso disciplinar, acadêmico, empregatício e decisório | OP |
| B4 | GitHub para código e evidência; Hugging Face **gated** para pesos | AG · ratificar |

### 3.7 Processo

| # | vigente | quem |
|---|---|---|
| | **decidir–registrar–ratificar**: o agente decide ancorado no escopo, registra com razão e custo de reversão, e não para. Ratificação obrigatória só antes de marco irreversível | OP |
| | a **fila de endurecimento permanece parada** até o artefato principal existir; nenhum documento de plano além do plano único de entrega do modelo | OP |
| | **nunca delegado**: D0; risco jurídico pessoal (B1); calendário; apertar botão de publicação externa; ler `test`/`cal-B`/ledger real; dinheiro além de R$60/mês | OP |
| | **três etapas por unidade**: verificação de desenho antes do código · implementação contra o contrato · cross-review adversarial | OP |
| | a etapa 3 é do **Fable** enquanto o crédito do codex não voltar; rodada do Fable não fecha dívida de codex | OP |
| A5 | revisão adversarial em caminho selado, uma rodada no resto | OP |
| | toda decisão metodológica entra em `references.md` no mesmo commit, com link | OP |
| A6 | Colab Pro até R$60/mês | OP |
| A7 | rajadas pelo rate limit; teto semanal bateu, a fila pausa e retoma | AG |
| B5 | mismatch pós-exposição é terminal | AG · ratificar |
| F0-7 | `access-terms-unresolved` abaixo da rota, acima da licença | AG |
| | bancada em TypeScript, lab em Python | AG |

### 3.8 Invioláveis

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
| **B1** — parecer jurídico da posição (a), ou risco assumido por escrito | publicação de pesos (Fase 7); `license-review.json` → `approved` |
| ratificar a **barreira de `cal-B`** (cluster exposto barrado das duas cegas, § 3.3) | a montagem do corpus novo (Fase 3) |
| **`consume-holdout`** — o botão irreversível da medição | Fase 5 |
| re-rodar ou não o codex nas unidades do caminho selado revisadas **só pelo Fable** | no retorno do crédito do codex |

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

Megabyte não é a unidade: *legislative branch* rende 0,89 documento por megabyte.

### 5.2 Aritmética da cota

`1 − α^(1/n)`, α = 0,0125. A coluna "por célula" assume `test` = 20 % do corpus — suposição provisória
até a pré-inscrição nova fixar as frações (§ 3.3); mudá-las muda a coluna.

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
| ledger de exposição real | **0 bytes** — nenhum evento real foi escrito |
| holdout-ledger real | 2.638 bytes — o consumo de 2026-07-25, `decision: reject` |
| memória da exposição por linha | `benchmark/data/corpus-build/out/split/split-artifact.json` — pertença de `test`, só o operador lê |

---

## 6. NÃO APLICAR — aparecem no registro e não valem

- `A2` (eixo de 4 células por fonte, com B2W);
- de `B3`, o piso de **250 componentes por célula** e a manchete do **pior estrato** com `m=4` — a
  família vigente é `m=7` por estrato (§ 3.1, decisão G0.2 de 2026-08-03);
- `F0-5` (cinco estratos com `qa-informal` declarado);
- piso de **≈20 mil linhas humanas**;
- frações `45/5/10/20/20`;
- regra condicional 6 (codex indisponível → selado espera);
- bloco C inteiro, exceto `C4`;
- a pré-inscrição v3 (`benchmark/rebuild-v3-policy.json`, marcada em `.ABANDONADA.md`) — os valores que a
  nova reafirma estão marcados `herdado` em § 3;
- **qualquer leitura de "gasto" sem a graduação de § 3.4** — inclusive afirmações anteriores, no registro
  e em memórias de sessão, de que o `ptbr-generic-v1` "não pode mais ser usado" ou de que o material
  estaria "descegado" por conhecimento de estrato.

---

## 7. Dívidas

| dívida | vence |
|---|---|
| registro-linha congelado em `cal-B` não tem a proteção do de `test` | antes da v2.0, ou antes de um segundo corpus sobrepor um split vivo |
| `worker-protocol` admite `sourceLock: undefined`; a revalidação morre como `TypeError` sem código | — |
| nenhum vínculo F6 prova em que corpus os pesos atuais foram treinados | antes de publicar pesos |
| rodada 13 do cross-review do E2 | crédito do codex, 8 de agosto |
| F0-9 — duas telas antigas com over-claim de autoria humana | — |
| linhagem admite pai `notApplicable` sem recusa — a pergunta de desenho está aberta | unidade que tocar linhagem ou E3 |
| bundles servidos (`public/`, `dist*`) carregam arquivos legais pré-Fase-0 (MIT como licença dos pesos) | antes de empacotar qualquer release |
| teste intermitente em caminho selado (`consume-holdout.test.ts`) | rodada própria |
| byte NUL literal em arquivo de `EVALUATOR_FILES` (`near-duplicates.ts`) | commit próprio — o conserto move o `evaluatorDigest` |

---

## 8. Ordem de leitura

1. **este arquivo**;
2. `superpowers/plans/2026-08-03-plano-entrega-modelo.md` — **o roteiro de execução**: sete fases até o
   modelo publicado, com os gates do operador na Etapa 0;
3. `superpowers/plans/2026-08-03-decisao-de-corte-A-ou-B.md` — a decisão de corte, preenchida (opção C);
4. `MANIFESTO-DE-TRANSPLANTE.md` — o dia zero de um repo novo; ocorre **depois** da entrega, se ocorrer;
5. `superpowers/plans/2026-07-30-v1-escopo-e-retomada.md` — **como trabalhar** e as armadilhas. A parte
   de estado dele está **superada por este arquivo**;
6. `superpowers/plans/2026-07-30-registro-de-decisoes.md` — a **razão** de cada decisão; procure a seção;
7. `detector-rebuild-assessment.md` — os oito defeitos de 25/07;
8. `references.md` — 270 entradas, 222 links, ancoradas por decisão.

Superado como estado: `superpowers/plans/2026-07-30-estado-do-projeto.md` — permanece como razão das três
decisões de 2026-07-30. Dormente, consulta e não execução:
`superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`.
