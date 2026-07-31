# Plano v1.0 mínima publicável — v2, pós-codex — PARA APROVAÇÃO DO OPERADOR

**Estado: APROVADO para execução. Nada implementado ainda.** D0 foi decidido pelo operador em
2026-07-30 (caminho 1, o detector) e as três decisões que antes bloqueavam a aprovação estão
resolvidas por delegação no registro: **A1** (Stack Overflow sai), **A2** (eixo da cota) e **B6**
(calendário, satisfeito pela própria escolha do caminho). Sobra **B1** — parecer jurídico —, que
bloqueia somente a Fase 3.

Revisão codex: **(b) aprovar com modificações**, todas incorporadas abaixo. O veredito e suas
prescrições estão registrados em `2026-07-30-auditorias-externas.md`; onde o codex reescreveu, vale a
reescrita dele.

## O que a v1.0 É — e a frase que a governa

> **v1.0 = detector pt-BR por adesão explícita, desligado por padrão, sempre rotulado como
> experimental, sem alegação de erro e com `actionCeiling = indicator` em todo resultado.**
> A v1.0 **não executa `fit` certificador, não abre concessão e não produz evidência científica de
> release**. v2.0 = o mesmo hash de pesos (salvo rejeição explícita antes da selagem), com análise
> pré-registrada, `cal-B` conformal e **uma** medição cega em `test`.

`test` e `cal-B` permanecem privados e byte-intocados até a v2.0. A v1.0 publica somente
**commitments agregados** (`datasetDigest`, `splitDigest`, instante, contagens não reconstruíveis);
seed, assignments e hashes por registro só saem **depois** da medição v2 (higiene contra membership
inference — pesos sozinhos não queimam `cal-B`/`test`, mas pesos + universo candidato + hashes por
registro estreitam demais). Três proibições que completam a higiene, e que faltavam: **não publicar o
universo candidato reproduzível**; **não publicar relatório externo sobre o mesmo candidato antes da
v2**; e **qualquer resultado de terceiro sobre este candidato que o operador vier a ver conta como
exposição e é registrado como tal**. Paridade v1 = zero inversões em `dev + cal-A`; paridade v2 = zero
inversões em `dev + cal-A + cal-B`. **São dois contratos por versão, não um contrato afrouxado** —
emendam R3, F5b, dependências de G5 e a tabela congelada antes da selagem.

### Defeitos do produto atual que a v1.0 corrige antes de publicar (achados codex, verificados)

- o runtime experimental **permite `blur/collapse/hide`** (`inference-worker.ts:717-765`; o teste
  exige `hide` em `inference-pipeline.test.ts:1041-1062`) — contradiz `model-validation.md:41-49`.
  O teto `indicator` vira **estrutural**, não copy;
- **não existe estado publicável "experimental"**: `release-policy.mjs:66-75` recusa `pending`;
  `indicator` exige decisão científica + perfil + evidência (`model-release.ts:217-235`). A v1.0
  cria uma **lane experimental** que `release:assert-publishable` aceita somente com: opt-in,
  zero perfis, zero evidência científica, nenhuma ação visual, licença `approved`. **Não** reutiliza
  `indicator-only`, que significa decisão científica;
- **R1 só começa na v2.0** — declarado, e **somente depois de todos os arquivos do avaliador estarem
  finais**. O limiar experimental é artefato não certificador, fora da cadeia de concessão; nenhum
  `frozen-calibration.json` da v1 destina-se à v2.

### Piso ético (mais forte que "não seja evidência única"; fontes: Weber-Wulff 2023, Liang 2023)

opt-in desligado por padrão · teto `indicator` estrutural · proibição explícita de uso disciplinar,
acadêmico, empregatício ou decisório · **não iniciar acusação formal com base no sinal** · nenhum
rótulo de autoria nem confiança numérica · disclosure persistente em cada resultado · **os pesos
viajam com a mesma política de uso** (a copy da extensão não acompanha pesos extraídos) · e a
ressalva que fecha o conjunto: **revisão humana não salva automaticamente um sinal não validado** —
ela precisa usar evidência independente de processo, não apenas "confirmar" o detector.

Fontes: Weber-Wulff et al. 2023 (detectores inadequados como evidência de misconduct), Liang et al.
2023 (viés contra escritor não nativo) e a própria orientação do Turnitin, que posiciona o sinal como
gatilho de conversa e não como veredito. Ver `2026-07-30-auditorias-externas.md`.

Frase R7-correta no lugar de "erro desconhecido":

> "A taxa de erro desta versão no domínio de uso não foi estimada em holdout independente.
> Resultados de desenvolvimento não são estimativas publicáveis e não sustentam conclusão sobre
> autoria ou sobre pessoas."

---

## Fase 0 — Licença e selagem (4–7 dias úteis + prazo externo de parecer)

### 0.1 Licença — e é retrabalho de código, não troca de parágrafo

- código MIT; **pesos sob licença própria nomeada, não comercial e com usos de alto risco
  proibidos**; documentação/evidência CC BY 4.0;
- **posição (a) como decisão de risco do operador, por escrito** — obrigações das fontes regem
  aquisição/preparação/uso do **corpus**; o projeto sustenta que não se propagam automaticamente aos
  pesos. Nunca descrita como consenso jurídico nem como conclusão da CC (o primer da CC ressalva
  cópias no treino e jurisdições divergentes);
- **`source-manifest.ts` e testes reescopados**: `source/corpus obligations` ≠ `weight/output
  policy`; nenhuma função ou teste volta a chamar a união das licenças de fonte de obrigação herdada
  pelos pesos — `FROZEN_ARTIFACT_OBLIGATIONS` (`source-manifest.ts:274-297`) e
  `artifactLicenseObligations`, que hoje faz literalmente `union.add(obligation)` sobre as licenças de
  fonte (`:542-557`); os testes que prendem a união estão em `source-manifest.test.ts:561` e no
  `describe` de `:720-795`;
- **`models/cleanfeed-ptbr-v1/NOTICE.md` é item de trabalho, não consequência** — é o primeiro lugar
  onde o repositório afirma o oposto da posição (a): `NOTICE.md:10-16` diz que as obrigações das
  fontes são herdadas pelos pesos e propagadas a qualquer derivado. Reescrever é obrigatório, e sem
  virar tratado jurídico;
- **`license-review.json` também tem o campo errado, não só o status**: `artifactObligations`
  (`:7-10`) lista `attribution + non-commercial + share-alike` como obrigação **do artefato**. Sob a
  posição (a) esse campo é reescopado, e o NC passa a constar como política própria;
- `commercialUse: false` permanece política própria; `attributionRequired`/`shareAlikeRequired`
  reescopados por tipo de artefato. **Move o `evaluatorDigest` deliberadamente** — antes de todo fit;
- `license-review.json`: `pending → `**`approved`** (o gate exige literalmente `approved`,
  `assert-release-gates.mjs:273-297`), com decisão, data, revisor, evidências;
- **Stack Overflow BLOQUEADO para incorporação** até registro verificável de data/mecanismo de
  aquisição + disposição jurídica do termo de acesso do dump (2024). Sem isso, **a fonte sai do
  corpus v1/v2**. Documentar a limitação não conclui a tarefa. ⚠️ Consequência a decidir: SO é a
  fonte natural do estrato `qa-informal` — a saída dele afeta a cobertura de registro.

### 0.2 Selagem — decisões exatas, não faixas

- eixo da cota v2 = **registro linguístico, CINCO células**: `qa-informal`, `encyclopedic`,
  `social-media`, `university`, `institutional` (`rebuild-v3-policy.json:114-120`). Meu rascunho
  dizia "4 células" confundindo **fontes** com **registros** e omitindo `university`. Se o operador
  preferir 4, o eixo é renomeado para **fonte** e o pooling é justificado como perda de resolução;
- **a lista exata de gates da família primária é anexada antes da selagem** — "3–6" não é
  pré-registro. Até existir, dimensiona-se com `m=6`: teto 1,7% sob zero eventos ⇒ **≥280 clusters
  independentes por célula**;
- partições `train 45 / dev 5 / cal-A 10 / cal-B 20 / test 20`;
- inventário de poder por **componentes conectados reais**, não linhas; célula abaixo do piso
  **falha antes da selagem**;
- análise primária, candidato elegível e política de não adaptação a feedback público **congelados
  antes da publicação v1**.

## Fase 1 — Corpus uma vez só (2–3 semanas; inclui horas humanas do operador)

1. `drop_seen()` consertado e descrito **somente** como hash exato + Jaccard ≥ 0,82 — nunca como
   "independência corpus↔treino" (R7);
2. **gate antiartefato PRÉ-TREINO** (não diferível: artefato de geração contamina o treino, não só a
   medição): eco de prompt, recusa, metaconversa, assinatura de harness, em todas as classes;
   excluir ou regenerar. O **probe adversarial de FPR fica para a v2**;
3. D1 + D3 com todo registro nascendo `automated/unreviewed` (R4); auditoria amostral de PII **não
   produz `passed` por registro**;
4. **linhagem fail-closed**: todo gerado referencia pai humano presente; a execução chama
   `assertDerivedParentsResolve` **antes do split** e colocaliza pai+gerações+derivados. Referência
   ausente reprova. A função existe em **`benchmark/schema.ts:3440`** e hoje só é chamada por
   `benchmark/tests/schema-v3.test.ts` — o comando de split **não** a chama, e `benchmark/split.ts:419`
   apenas a menciona em comentário. A brecha declarada de `humanSeed` está em `split.ts:208-225`, que
   registra "C2 measured 782 of 783 parent references resolving to no row";
5. E2 congela as cinco partições (⚠️ **o splitter atual é estruturalmente de TRÊS partições** —
   `split.ts:143-155`, `commands/split.ts:108-115` — a migração é trabalho real, não configuração);
   E3 mínimo prova contagens por célula, componentes independentes, pareamento, resolução de
   linhagem e ausência de artefatos. Caminho selado ⇒ revisão adversarial.

**Cortados da v1.0 pelo codex além do meu rascunho**: probe adversarial (v2), datasheet separada
(vira seção do model card), **reserva de segunda tentativa** (aceitável só porque o objetivo
declarado é literalmente uma única medição v2).

## Fase 2 — Treino e artefato (1–2 semanas, Colab)

1. F1 com **cross-entropy e seed `712019` pré-fixadas, SEM ablação** — duas corridas com perdas e
   seeds diferentes misturam tratamento com ruído (pseudoablação). Segunda corrida só como retry
   técnico, nunca seleção;
2. **sem calibrador probabilístico na v1**: limiar experimental provisório, versionado, jamais
   descrito como "conservador", "alta confiança" ou probabilidade;
3. gate interno de não degeneração em `dev + cal-A` (smoke sem erro, saída não constante, sem
   inversão grosseira, nenhuma célula core colapsada). **Valores observados não publicados** (R8);
4. piso de abstenção **no WASM** + `actionCeiling = indicator` incondicional no modo experimental;
5. **a lane de publicação experimental** (ver acima) — trabalho de contrato + testes;
6. paridade v1 (`dev + cal-A`, zero inversões) + **F6 mínimo** (vínculo treino→modelo).

## Fase 3 — Publicação (4–7 dias úteis)

1. model card com a frase R7-correta; riscos de evasão e viés **qualitativos, sem percentuais**;
   usos proibidos explícitos;
2. seção "Dados e proveniência" no model card (fontes, licenças, corte temporal, governança
   `automated/unreviewed`, não redistribuição, commitments agregados — **nenhum hash por registro**);
3. varredura repo-wide: nenhuma métrica de qualidade da v1 em lugar nenhum; números administrativos
   em allowlist; números de literatura só pós-v2 ou em seção inequivocamente externa. Inclui os 13
   lugares já mapeados + o bloco "QUESTÃO ABERTA" de H3b;
4. E2E real prova: opt-in off por padrão, disclosure em todo resultado, nenhum score, nenhum rótulo
   de autoria, **nenhum blur/collapse/hide**, texto curto abstém, falha de runtime não vira score
   (R5 com teste nomeado);
5. publica somente se: lane experimental verde, licença `approved`, bundle auditado, commitments.

## Estimativa (corrigida pelo codex; a minha excluía trabalho que o repo prova existir)

| fase | duração |
|---|---|
| 0 | 4–7 dias úteis **+ prazo externo de parecer (fora do controle)** |
| 1 | 2–3 semanas |
| 2 | 1–2 semanas |
| 3 | 4–7 dias úteis |
| **v1.0 total** | **4,5–7 semanas de engenharia solo** |

Riscos que movem: migração 3→5 partições, geração multi-lane, resolução de linhagem, semântica de
licença dentro de `EVALUATOR_FILES`, lane nova de release, export/paridade WASM, e as 2–4 rodadas de
revisão já medidas nesta sessão.

## Decisões que só o operador pode tomar (bloqueiam a aprovação)

1. **Stack Overflow**: buscar disposição jurídica do termo do dump, ou **remover a fonte** (afeta o
   estrato `qa-informal`).
2. **Eixo da cota**: 5 células de registro (recomendado) ou 4 por fonte com pooling justificado.
3. **Parecer jurídico da posição (a)**: buscar antes de publicar, ou publicar com o risco documentado
   e assumido por escrito.
4. **Aceitar 4,5–7 semanas**, ou cortar mais fundo (o que restou é o mínimo que o codex e eu
   consideramos honesto para publicar um detector não calibrado).

## O que o codex não conseguiu refutar

Faseamento experimental→cega válido · pesos não queimam `cal-B`/`test` por si · `45/5/10/20/20`
razoável · antiartefato essencial pré-treino · paridade por contrato de versão defensável · F6 vale ·
a copy selada é boa — o defeito estava na autoridade do runtime, não na frase.
