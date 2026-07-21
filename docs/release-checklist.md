# Checklist de release — CleanFeed AI (TMR PT-BR v1)

Lista de verificação executável antes de empacotar/publicar o CleanFeed AI. Cada
item automatizado **referencia o comando que o prova**; itens manuais exigem
assinatura (nome + data) e **não** podem ser pré-marcados. O portão agregado é
`npm run verify:release` seguido de `npm run test:performance:release` na máquina
de referência e do gate final `npm run release:assert-publishable`.

Estado atual: `gateDecision: pending`, `rolloutState: bundle-verified`. Sem uma
decisão científica selada, os gates abaixo **falham fechados** e nada é
publicável. A evidência versionada é gerada por `npm run release:evidence` em
[releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md).

## 1. Decisão e digests da Fase 3

- [ ] `npm run model:evidence:verify` sai 0: dataset/dataset-audit/source/review/
      source-readiness/split/evaluator/model/runtime-parity/report digests
      conferem e a `gateDecision` do descritor bate com a evidência publicada.
- [ ] Prediction completeness é 100%; nenhum hash ou previsão ausente, nenhuma
      linha extra ou duplicada.
- [ ] Nenhum segmento crítico abaixo da amostra mínima (parser fechado
      `parseCalibrationProfilesFileV1` → `INSUFFICIENT_SLICE_SAMPLE`).
- [ ] Holdout consumido uma única vez (ledger append-only).

## 2. Paridade de runtime (sem confundir build digests)

- [ ] `runtimeParityDigest` é idêntico entre
      `dist-model-benchmark/runtime-parity.json`, o relatório sanitizado
      (`benchmark/evidence/tmr-ptbr-v1/benchmark-report.json`) e
      `dist/runtime-parity.json`; `npm run audit:model` reprova
      `RUNTIME_PARITY_MISMATCH` em qualquer divergência.

## 3. Licença e avisos

- [ ] `models/tmr-ai-text-detector/license-review.json` está `approved` e
      `LICENSE` + `NOTICE.md` acompanham o bundle (gate `--publication`:
      `PUBLICATION_LICENSE_NOT_APPROVED` / `PUBLICATION_NOTICE_MISSING`).

## 4. Perfis: expiração e teto

- [ ] Cada perfil expira exatamente 180 dias após `issuedAt` e carrega a
      identidade exata de bundle/tokenizer/agregação/composição.
- [ ] Faixa `50–79` permanece `indicator` mesmo em `pass`; score localizado nunca
      libera blur/collapse/hide (`SHORT_TEXT_ACTION_BYPASS`).

## 5. Smoke real (todas as decisões, inclusive reject)

- [ ] `npm run test:model:release` sai 0 e o Playwright de
      `tests/e2e/real-model-smoke.spec.ts` roda **sem skip** — inclusive para
      reject; ausência do ONNX ou teste pulado reprova (`MODEL_SMOKE_SKIPPED`,
      `MODEL_ARTIFACT_MISSING`). Enquanto `pending`: `MODEL_RELEASE_NOT_PROMOTED`.

## 6. Pacote exato (ou ausência do TMR em reject)

- [ ] `npm run audit:model` sai 0: em `indicator-only`/`pass`, exatamente os doze
      arquivos autorizados, íntegros e com os dois descritores byte-idênticos aos
      versionados; em `reject`, o diretório `dist/models/tmr-ai-text-detector`
      está **inteiramente ausente**.

## 7. Diferença de permissões (permission/CSP diff)

- [ ] `permissions` ⊆ `{ storage, contextMenus, activeTab, scripting, offscreen }`
      e `host_permissions` = `["https://www.linkedin.com/*"]`.
- [ ] CSP travada: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
      worker-src 'self'; connect-src 'self'`.
- [ ] `npm run audit` sai 0 sobre o `dist` (rejeita qualquer widening de
      permissão/host/CSP, import/fetch/`new URL` remoto, `eval`, `new Function` de
      primeira parte, sourcemap externo ou artefato de código-fonte vazado).
- [ ] O gate final confirma nenhuma nova origem de rede nem permissão opcional
      (`PUBLICATION_NETWORK_ORIGIN_ADDED` / `PUBLICATION_PERMISSION_ADDED`).

## 8. Operação offline nas duas lanes de browser

- [ ] Nenhuma requisição externa em uso normal (E2E monitora página, service
      worker e offscreen e exige lista vazia).
- [ ] Bundle offline: `scripts/sanitize-offline-bundle.mjs` neutraliza referências
      a CDNs; assets WASM vêm de `vendor/transformers-wasm/` local.
- [ ] Classificação, análise manual e apresentação funcionam sem rede em **ambas**
      as lanes de browser.

## 9. Lanes de browser identificadas sem mistura

- [ ] Lane funcional MV3 roda no **Chromium empacotado pelo Playwright**
      (`channel: "chromium"`), verificada pelo recibo
      `test-results/tmr-functional-browser.json` (por causa das restrições atuais
      de sideload do Chrome branded).
- [ ] Lane científica/performance roda no **Chrome for Testing Stable
      `150.0.7871.129`** pinado por `tests/browser-lock.json`. Uma lane nunca é
      rotulada como a outra.

## 10. Acessibilidade

- [ ] `npm run test:e2e:release` (axe-core) sem violações graves/críticas no feed,
      popup e opções dos roots da extensão.
- [ ] Selo, painel de explicação e painel manual operáveis por teclado, com foco
      gerenciado e regiões `role`/`aria-*` corretas; `prefers-reduced-motion` e
      `forced-colors` suportados.

## 11. Desempenho na máquina de referência

- [ ] `npm run test:performance:release` seguido de
      `node scripts/assert-performance-report.mjs …` sai 0 na referência
      (Windows 11 / 4 CPUs lógicas / 8 GiB / Chrome for Testing `150.0.7871.129` /
      WASM): cold ≤ 10 s, warm p95 ≤ 2 s, memória incremental ≤ 512 MiB, erro
      < 1%, maior tarefa da thread principal ≤ 50 ms.
- [ ] Em `reject`, a evidência de desempenho é `not-applicable` (candidato ausente
      do pacote), sem números artificiais.

## 12. Rollback local e circuit breaker

- [ ] Perfil ausente, expirado ou incompatível, OOD, artifact mismatch ou circuit
      breaker fazem o TMR se abster; o fallback estilométrico só pode indicar.
- [ ] Rollback é local (integridade, circuit breaker, atualização da extensão);
      não há kill switch remoto. O estado degradado é visível em opções e
      diagnósticos.

## 13. Build reproduzível e transição monotônica

- [ ] `npm run verify:build` sai 0 (dois builds limpos idênticos por SHA-256 e
      conjunto de nomes de arquivo).
- [ ] A única mutação pós-gate permitida é `pass/indicator -> pass/actions`
      (`npm run release:activate`); indicator-only e reject não alteram byte algum.

## 14. Evidência gerada e gate final

- [ ] `npm run release:evidence` gera [releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md)
      e `npm run release:evidence:check` confirma que o documento comprometido não
      diverge (uma segunda geração não altera bytes).
- [ ] `npm run release:assert-publishable` sai 0 **somente** para
      `reject/bundle-verified`, `indicator-only/indicator` ou `pass/actions`;
      `pending`, `shadow`, `indicator-only/bundle-verified`, `pass/bundle-verified`
      e `pass/indicator` não são publicáveis.

## 15. Ausência de dados de autor e limpeza de dados

- [ ] Nenhuma configuração ou armazenamento guarda nome/id de autor ou URL de
      perfil (`tests/integration/storage-privacy-audit.test.ts`,
      `security-boundaries.test.ts`).
- [ ] Overrides por domínio guardam apenas o hostname normalizado.
- [ ] Cache, métricas, histórico e texto do histórico limpáveis de forma
      independente e atômica, sem entradas órfãs.

## 16. Aprovação do responsável pelo release (manual)

- [ ] Prints do selo, painel de explicação, popup e opções atualizados; textos da
      store falam em filtro **probabilístico** e **sinais compatíveis**, sem
      promessa de acurácia.
- [ ] Limitações do release documentadas ([limitations.md](limitations.md)).
- [ ] **Assinatura do responsável pelo release:** ____________________ (nome/data)
