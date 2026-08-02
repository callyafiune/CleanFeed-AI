# CleanFeed AI TMR/PT-BR Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o TMR ONNX como candidato local, validá-lo em PT-BR/LinkedIn e promover somente os avisos e ações que passarem por gates estatísticos, de segurança, privacidade e desempenho.

**Architecture:** O plano separa o artefato e o runtime, o benchmark e a calibração, a construção do corpus e a experiência de release. O classificador produz dois sinais calibráveis — documento e trecho localizado — enquanto perfis imutáveis e expirantes governam a decisão; o estilométrico continua sendo fallback indicativo. O resultado científico determina `pass`, `indicator-only` ou `reject`; somente a Fase 4 pode fazer a transição monotônica de um `pass` inicialmente indicativo para ações visuais depois dos gates de pacote e desempenho.

**Tech Stack:** TypeScript 5.9, Node.js 22.18+, Vitest 4, Vite 8, Chrome MV3, Transformers.js 4, ONNX int8, React 19, Playwright 1.61, axe-core, JSON/JSONL canônico e SHA-256.

## Global Constraints

- Fonte de verdade: `docs/superpowers/specs/2026-07-19-tmr-ptbr-classifier-design.md`.
- Candidato fixado: `onnx-community/tmr-ai-text-detector-ONNX`, revisão `b9aa251e5bcda7e429fcc936767d921435945b60`.
- Artefato ONNX: `onnx/model_int8.onnx`, 125.855.418 bytes, SHA-256 `a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79`.
- Tokenizer fixado: SHA-256 canônico `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9`, obrigatório em modelo, perfil, release, predictions e cache.
- Nenhum download ocorre em runtime; `connect-src 'self'` permanece inalterado.
- O build normal pode usar o fallback sem o binário; `build:release` deve falhar se o bundle real estiver ausente ou divergente.
- A interface nunca afirma autoria por IA e nunca mostra o score bruto no feed.
- Copy obrigatória: “Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA. Isso não comprova sua origem.”
- Gate de aviso: UCB unilateral de 95% do FPR <= 5% overall e em cada slice crítico elegível.
- Gate de ação: UCB unilateral de 95% do FPR <= 2% overall e em cada slice crítico elegível.
- Utilidade: LCB95 do recall >= 60% para aviso, >= 35% para ação, cobertura >= 80%, ECE-15 <= 0,05 e recall >= 50% em mistos com fração de IA >= 0,50.
- Textos de 50–79 palavras têm teto `indicator`; abaixo de 50 palavras são `unsupported` no feed.
- Agregação TMR v2: 510 tokens de conteúdo, dois especiais, overlap 64 e no máximo oito janelas distribuídas.
- Ação visual usa apenas o score global do documento; o score localizado pode gerar somente aviso.
- O usuário escolhe `indicator|blur|collapse|hide`, mas não escolhe os limiares científicos do TMR.
- A remoção dos limiares legados, suas migrações e o controller fail-closed terminam na Fase 1 antes de calcular `runtimeParityDigest`; não existe fallback de apresentação baseado em score.
- Perfil ausente, incompatível ou expirado, bundle/tokenizer divergente, evidência `unsupported`, OOD ou falha faz o TMR abster; evidência `limited` pode somente indicar. O estilométrico separado continua apenas como fallback indicativo identificado.
- Perfis expiram exatamente 180 dias após `issuedAt`.
- O corpus v1 tem exatamente 4.000 humanos, 4.000 IA e 2.000 mistos, somente com licença/consentimento e auditoria de PII.
- O teste temporal bloqueado nunca serve para tuning; uma avaliação consumida exige novo holdout para nova tentativa.
- Depois de congelar a calibração, nenhum byte coberto por `inferenceCoreDigest` pode mudar. Qualquer correção nesse inventário invalida a evidência e exige novo scoring, fit e consumo de holdout.
- Métricas e diagnósticos persistidos nunca contêm texto, URL, autor, hash do conteúdo ou score individual.
- Orçamentos na referência mínima Windows 11/4 processadores lógicos/8 GiB/Chrome for Testing Stable `150.0.7871.129`/WASM: tarefa síncrona <= 50 ms, cold start <= 10 s, warm p95 <= 2 s/post, memória incremental <= 512 MiB e erros < 1%. E2E funcional comum usa o Chromium pinado pelo Playwright; ambos registram versão completa.
- O adaptador LinkedIn continua sendo o único implementado; contratos de plataforma não devem impedir adaptadores futuros.
- A suíte existente deve permanecer verde; o smoke real não pode ser `skip` no job de release.
- Use `git commit --no-verify` neste projeto, conforme autorização do usuário, e nunca inclua `public/models/**` ou `benchmark/data/**` no commit.

---

## Estrutura dos planos

| Ordem | Plano | Resultado independentemente testável |
| --- | --- | --- |
| 1 | [Fase 1 — Bundle e runtime](2026-07-19-cleanfeed-ai-tmr-ptbr-phase-1-model-runtime.md) | Bundle reprodutível, contratos fechados, pipeline TMR correto e fallback seguro, ainda sem promoção |
| 2 | [Fase 2 — Benchmark e calibração](2026-07-19-cleanfeed-ai-tmr-ptbr-phase-2-benchmark-calibration.md) | Ferramenta científica estrita capaz de gerar decisão e perfil verificável |
| 3 | [Fase 3 — Corpus e validação](2026-07-19-cleanfeed-ai-tmr-ptbr-phase-3-corpus-validation.md) | Corpus v1 selado, scores completos, holdout consumido uma vez e decisão real |
| 4 | [Fase 4 — Rollout e release](2026-07-19-cleanfeed-ai-tmr-ptbr-phase-4-rollout-release.md) | UI probabilística, estágio autorizado, auditoria offline, E2E e checklist de release |

## Mapa de dependências

| Marco | Depende de | Libera |
| --- | --- | --- |
| Contratos compartilhados de modelo, evidência, perfil e release | Fase 1 / Tasks 1–3 | runtime, benchmark e UI |
| Agregação v2 + evidence quality | Fase 1 / Tasks 4–5 | scoring exato e calibração |
| Runtime com registry, settings fail-closed, identidade, circuit breaker e smoke real | Fase 1 / Tasks 6–9 | scoring de conformidade |
| Schema, split, estatística, gates, perfis e CLI | Fase 2 / Tasks 1–13 | corpus selado e avaliação |
| Corpus + predictions completos | Fase 3 / Tasks 1–3 | fit e teste bloqueado |
| Decisão `pass|indicator-only|reject` | Fase 3 / Task 5 | descriptor/profile finais e rollout |
| UI, auditoria, desempenho, E2E e documentação | Fase 4 / Tasks 1–7 | release verificável |

O Graphify identifica `ClassificationResult`, `UserSettings`, `WorkerHost` e `PipelineRunner` como hubs. Por isso, Tasks 1–3 da Fase 1 são o único eixo serial. Depois delas:

- aquisição/verificação do bundle e schema do benchmark podem avançar em paralelo;
- copy/UI e auditoria de pacote podem avançar depois do contrato de rollout;
- coleta do corpus pode ocorrer enquanto o runtime e as métricas são implementados;
- avaliação bloqueada e promoção são estritamente sequenciais.

## Checkpoints do plano mestre

- [ ] **Checkpoint 1: concluir Fase 1 sem ativar TMR no feed**

Verificar:

~~~powershell
npm run format:check
npm run lint
npm run typecheck
npx vitest run tests/unit/inference tests/unit/offscreen tests/unit/storage/cache.test.ts tests/unit/background/message-router.test.ts
npm run model:verify:metadata
npm run model:fetch
npm run model:verify
npm run test:model:smoke
~~~

Esperado: todos passam com o bundle de sete ativos materializado; `models/.../release.json` continua em `bundle-verified/pending` e o fallback estilométrico segue ativo no build normal.

- [ ] **Checkpoint 2: concluir Fase 2 sem acessar o holdout final**

Verificar:

~~~powershell
npx vitest run benchmark/tests
npm run typecheck:benchmark
npm run benchmark -- --help
~~~

Esperado: todos passam; nenhuma função de fit aceita IDs marcados como `test`.

- [ ] **Checkpoint 3: selar corpus e executar a avaliação uma única vez**

Verificar:

~~~powershell
npm run browser:install:test
npm run model:verify
npm run build:model-benchmark
npm run benchmark -- ingest --input benchmark/data/incoming/records.jsonl --review-ledger benchmark/data/incoming/review-ledger.jsonl --sources benchmark/data/incoming/sources.json --dataset-manifest-template benchmark/data/incoming/dataset-manifest-template.json --dataset-dir benchmark/data/ptbr-linkedin-v1
npm run benchmark -- validate --dataset-dir benchmark/data/ptbr-linkedin-v1 --output benchmark/out/ptbr-v1/validate
npm run benchmark -- split --dataset-dir benchmark/data/ptbr-linkedin-v1 --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --output benchmark/out/ptbr-v1/split --seed 20260726
npm run benchmark -- score --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition dev --candidate-extension-dir dist-model-benchmark --output benchmark/out/ptbr-v1/predictions/dev
npm run benchmark -- score --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition cal-A --candidate-extension-dir dist-model-benchmark --output benchmark/out/ptbr-v1/predictions/cal-A
npm run benchmark -- validate-predictions --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition dev --predictions benchmark/out/ptbr-v1/predictions/dev --runtime-parity dist-model-benchmark/runtime-parity.json
npm run benchmark -- validate-predictions --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition cal-A --predictions benchmark/out/ptbr-v1/predictions/cal-A --runtime-parity dist-model-benchmark/runtime-parity.json
npm run benchmark -- fit --dataset-dir benchmark/data/ptbr-linkedin-v1 --source-readiness benchmark/out/ptbr-v1/validate/source-readiness.json --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --development-predictions benchmark/out/ptbr-v1/predictions/dev --calibration-predictions benchmark/out/ptbr-v1/predictions/cal-A --runtime-parity dist-model-benchmark/runtime-parity.json --output benchmark/out/ptbr-v1/fit --seed 712019
$split = Get-Content benchmark/out/ptbr-v1/split/split-artifact.json -Raw | ConvertFrom-Json
npm run benchmark -- consume-holdout --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --candidate-extension-dir dist-model-benchmark --work-dir benchmark/work/holdout --output benchmark/out/ptbr-v1/evaluate --bootstrap-seed 712019 --confirm-split-digest $split.splitDigest
$report = Get-Content benchmark/out/ptbr-v1/evaluate/benchmark-report.json -Raw | ConvertFrom-Json
npm run benchmark -- publish-profile --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --issued-at $report.generatedAt --model-dir models/tmr-ai-text-detector
npm run benchmark -- publish-evidence --source-readiness benchmark/out/ptbr-v1/validate/source-readiness.json --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --fit-report benchmark/out/ptbr-v1/fit/fit-report.json --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --consumption-id $report.holdoutConsumptionId --model-dir models/tmr-ai-text-detector --output benchmark/evidence/tmr-ptbr-v1
npm run benchmark -- verify-published-evidence --evidence-dir benchmark/evidence/tmr-ptbr-v1 --model-dir models/tmr-ai-text-detector
~~~

Esperado: todos os 10.000 IDs possuem exatamente uma linha `scored|abstained|error`; `benchmark-report.json` contém decisão, runtime parity e digests completos, ligados a um único consumo do holdout.

- [ ] **Checkpoint 4: aplicar somente o resultado autorizado**

Regras:

- `reject`: manter fallback estilométrico, publicar arquivo de perfis vazio e omitir o TMR do pacote final;
- `indicator-only`: publicar perfis com `actionCeiling: "indicator"`;
- `pass`: publicar inicialmente em `rolloutState: "indicator"`; a Fase 4 pode ativar `actions` após todos os gates, mantendo 50–79 palavras em `indicator`.

- [ ] **Checkpoint 5: executar gate completo de release**

~~~powershell
npm run model:evidence:verify
npm run model:fetch
npm run verify:release
npm run test:performance:release
$releaseBefore = Get-Content models/tmr-ai-text-detector/release.json -Raw | ConvertFrom-Json
npm run release:activate -- --expected-evidence-digest $releaseBefore.evidenceDigest
npm run verify
npm run model:verify
npm run test:model:release
npm run build:release
npm run audit
npm run audit:model
npm run verify:build
npm run test:e2e:release
npm run test:performance:release
npm run release:evidence
npm run release:evidence:check
npm run release:assert-publishable
npm run docs:check
git status --short
~~~

Esperado: todos os comandos retornam 0; os únicos arquivos não versionados permitidos estão sob `public/models/`, `benchmark/data/`, `benchmark/work/`, `benchmark/out/` e `test-results/`.

## Definição de pronto

A etapa termina quando:

1. o bundle real é reproduzível e auditável;
2. o runtime aplica o perfil exato e falha fechado;
3. o benchmark rejeita vazamento, previsão faltante e evidência incompleta;
4. o corpus v1 satisfaz quotas, revisão e proveniência;
5. o holdout gera uma decisão criptograficamente ligada ao modelo e ao avaliador;
6. a extensão publica somente o estágio autorizado;
7. UI, privacidade, acessibilidade, desempenho, operação offline e rollback passam em Chrome real;
8. documentação não contém alegações de acurácia além do relatório gerado.
