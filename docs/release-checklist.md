# Checklist de release — CleanFeed AI (MVP)

Lista de verificação a ser executada antes de empacotar/publicar uma versão do
CleanFeed AI. Cada item deve ter evidência (comando, print ou observação) antes
de marcar. O portão automatizado é `npm run verify` (formato, lint, typecheck,
testes, build, auditoria e E2E) e `npm run verify:build` (build reproduzível).

## 1. Compatibilidade de navegador (Chrome)

- [ ] `manifest.json` declara `minimum_chrome_version: "116"` e `manifest_version: 3`.
- [ ] Testado em Chrome/Chromium estável recente (o gate E2E roda no Chromium do
      Playwright, headless).
- [ ] Service worker de módulo, offscreen document e `chrome.scripting` disponíveis
      na versão mínima suportada.

## 2. Diferença de permissões (permission diff)

- [ ] `permissions` ⊆ `{ storage, contextMenus, activeTab, scripting, offscreen }`.
- [ ] `host_permissions` = `["https://www.linkedin.com/*"]` (nenhum host global).
- [ ] CSP travada: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
      worker-src 'self'; connect-src 'self'` (sem `'unsafe-eval'`, sem origem
      remota).
- [ ] `npm run audit` sai com código 0 sobre o `dist` empacotado (rejeita
      qualquer widening de permissão/host/CSP e qualquer import/fetch/`new URL`
      remoto, `eval`, `new Function` de primeira parte, sourcemap externo ou
      artefato de código-fonte vazado).

## 3. Operação offline

- [ ] Nenhuma requisição externa durante uso normal (verificado no E2E, que
      monitora página, service worker e offscreen e exige lista vazia).
- [ ] Bundle offline: `scripts/sanitize-offline-bundle.mjs` neutraliza referências
      a `huggingface.co`/`cdn.jsdelivr.net`; assets do runtime WASM vêm de
      `vendor/transformers-wasm/` local.
- [ ] Classificação, análise manual e apresentação funcionam sem rede.

## 4. Status de modelo / mock

- [ ] Backend ativo no MVP é o **mock determinístico** (`demo: true`,
      `backend: "mock"`); o popup e o painel manual exibem o aviso de demonstração.
- [ ] Nenhuma métrica de qualidade de detecção é afirmada na UI ou nas docs.
- [ ] Nenhum modelo/dataset sem licença entrou no repositório (`dist/models/`
      contém apenas `.gitkeep`).
- [ ] Pipeline "real-ready": se um modelo calibrado for fornecido, o seletor de
      backend o usa; sem calibração registrada, o teto de ação é `indicator`.

## 5. Acessibilidade

- [ ] axe-core sem violações graves/críticas no feed, popup e página de opções
      (E2E `extension.spec.ts`).
- [ ] Selo, painel de explicação e painel manual operáveis por teclado, com foco
      gerenciado e regiões `role`/`aria-*` corretas.
- [ ] Suporte a `prefers-reduced-motion` e `forced-colors`.

## 6. Limpeza de dados (data clear)

- [ ] Opções permitem limpar cache (`CACHE_CLEAR`), métricas (`METRICS_CLEAR`),
      histórico e texto do histórico de forma independente e atômica.
- [ ] Após limpar, o dump de armazenamento não retém entradas órfãs.

## 7. Import/export e rollback

- [ ] Export valida o schema; import mostra preview, exige confirmação e faz
      rollback atômico em caso de erro (`tests/integration/import-atomicity.test.ts`).
- [ ] Export genérico nunca inclui texto completo (apenas linhas sem texto).

## 8. Versão de cache

- [ ] Chave de cache inclui `platform:model:settingsFingerprint:hash`, de modo que
      trocar modelo ou configuração invalida entradas antigas sem colisão.
- [ ] TTL e limite de entradas dentro dos limites configuráveis.

## 9. Prints e textos (store listing)

- [ ] Prints do selo, do painel de explicação, do popup e das opções atualizados.
- [ ] Textos da store deixam claro que é um filtro **probabilístico** e não um
      detector definitivo; sem promessas de acurácia.

## 10. Ausência de preferência de autor

- [ ] Nenhuma configuração ou armazenamento guarda nome de autor, id de autor ou
      URL de perfil (verificado em `tests/integration/storage-privacy-audit.test.ts`
      e `security-boundaries.test.ts`).
- [ ] Overrides por domínio guardam apenas o hostname normalizado, nunca URL,
      caminho ou query.

## 11. Limitações conhecidas

- [ ] As limitações do release estão documentadas e refletidas na store
      (ver `docs/phase-reports/phase-5.md` e `docs/limitations.md`).

## 12. Build reproduzível

- [ ] `npm run verify:build` sai com código 0 (dois builds limpos idênticos por
      SHA-256 e conjunto de nomes de arquivo).

## 13. Evidência científica do benchmark (Fase 2)

Aplicável apenas quando um perfil de release é emitido a partir de um corpus real
e das previsões TMR da Fase 3; a infraestrutura pode estar verde sem que nenhuma
decisão científica exista.

- [ ] dataset/dataset-audit/source/review/source-readiness/split/evaluator/model/runtime-parity/report digests conferem
- [ ] prediction completeness é 100%; nenhuma linha extra ou duplicada
- [ ] manifests development/calibration/test estão ligados ao freeze/report e usam backend WASM
- [ ] holdout foi consumido uma única vez
- [ ] pass/indicator-only publicam perfis; reject publica arquivo de perfis vazio e descritor bundle-verified
- [ ] perfil expira em 180 dias e possui identidade exata do bundle/tokenizer/agregação/composição
- [ ] nenhum dataset, label privado ou texto entrou no Git
