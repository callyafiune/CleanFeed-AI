# Fase 4 — Experiência de filtragem acessível

## Resultado

A Fase 4 entrega a experiência de filtragem completa, reversível e acessível
sobre o backend mock, além de um portão objetivo de acessibilidade, segurança,
desempenho e E2E:

- **Apresentação reversível por sessão**: indicador, desfoque, recolher e ocultar
  respeitam status, pontuação e teto de ação; `reveal`/`restore`/`ignore` são
  imediatos, idempotentes e mantêm o post original conectado.
- **Explicações e feedback local**: painel "Indícios observados" com apenas
  sinais calculados e linguagem probabilística; feedback vinculado somente ao
  hash, sem texto/autor/URL.
- **Análise manual em qualquer site**: injeção sob gesto (`activeTab`/`scripting`)
  em Shadow DOM, sem host permission global e sem modificar a página.
- **Menus de contexto e ações do post atual** sem autor/URL; estado do clique
  direito mantido apenas em memória.
- **Popup e opções** completos com estados de erro acessíveis, exibindo somente o
  hostname.
- **Portão objetivo**:
  - `tests/integration/security-boundaries.test.ts`: zero `eval`/`new Function`/
    `innerHTML` em `src/`, CSP e allowlist de permissões travadas, ausência das
    chaves `authorName`/`authorId`/`profileUrl` em qualquer dump de armazenamento,
    rejeição de mensagens forjadas com `INVALID_MESSAGE` e painel de explicação
    que trata campos hostis como texto (sem `<img>`/`<script>`).
  - `tests/integration/main-thread-budget.test.ts`: o observador do feed limita
    cada ciclo síncrono a 100 candidatos e cede a thread principal
    (`scheduler.yield`, com fallback `setTimeout(0)`) entre ciclos.
  - `tests/e2e/extension.spec.ts` (três testes em Chromium persistente):
    (1) carrega a extensão empacotada, classifica um post do feed-mock
    **offline**, abre e fecha o painel por teclado e verifica **zero requisições
    externas** (monitoradas no contexto — página, service worker e offscreen);
    (2) audita feed, popup e opções com **axe-core**, exigindo zero violações
    graves ou críticas; (3) injeta ~400 posts e confirma **nenhuma long task
    acima de 50 ms** atribuída à extensão.

## Desempenho da thread principal

O `createFeedMutationObserver` passou a processar candidatos em lotes de no
máximo `MAX_MUTATION_CANDIDATES_PER_CYCLE` (100), invocando o callback uma vez
por lote e cedendo a thread principal entre lotes. A verificação de parede de
50 ms por tarefa é feita em Chrome real no E2E (via `PerformanceObserver` de
`longtask`), já que o jsdom não reflete fielmente o custo de DOM do navegador.

## Harness E2E

- `tests/e2e/helpers/load-extension.ts` sobe um contexto persistente com a forma
  de launch verificada (`headless`, canal `chromium`, `--disable-extensions-except`
  e `--load-extension`). O fixture é endereçado como o host real
  (`--host-resolver-rules=MAP www.linkedin.com 127.0.0.1`, preservando a porta),
  para que o guard de host do content script publicado (`LinkedInAdapter.matches`)
  rode sem alteração; como o fixture é servido em `http`,
  `--unsafely-treat-insecure-origin-as-secure` marca essa origem como segura para
  que o `SubtleCrypto` (hash do content script) funcione como em `https`. O helper
  copia `dist` para um diretório temporário e adiciona apenas
  `http://www.linkedin.com/*` às listas de `matches` (content scripts e
  `web_accessible_resources`) da cópia — o `manifest.config.ts` publicado, a CSP e
  a allowlist de permissões permanecem intocados.
- `tests/e2e/fixtures/linkedin-server.ts` serve `tests/e2e/fixtures` numa porta
  efêmera de 127.0.0.1 (alcançada via o host `www.linkedin.com` mapeado), sem
  internet.
- O post longo do fixture usa um texto em português cujo texto extraído e
  normalizado é classificado como `strong_ai_indication` pelo pipeline real
  (verificado contra o `PipelineRunner`), garantindo um selo cujo nome acessível
  casa com `/indícios|inconclusivo|pessoa/u`.

## Verificação

Portão completo executado em 17 de julho de 2026 (Windows 11; Chromium do
Playwright — build chromium-1228 / Chrome 149 headless), todos com exit 0:

- `npm run format:check`: aprovado.
- `npm run lint`: 0 erros (2 avisos preexistentes de `react-refresh` em
  popup/options `App.tsx`).
- `npm run typecheck`: aprovado (agora inclui `playwright.config.ts` e
  `vite.manual-analysis.config.ts`).
- `npm run test -- --run` (Vitest): 70 arquivos, 529 testes aprovados e 3
  ignorados (o smoke de modelo real).
- `npm run build`: aprovado; bundle offline, sem referência a origem remota.
- `npm run test:e2e` (Playwright): 3 testes aprovados; confirmado estável em
  `--repeat-each=3` (9/9). Zero requisições externas, zero violações graves ou
  críticas de acessibilidade (axe-core no feed, popup e opções) e nenhuma long
  task acima de 50 ms ao processar ~400 posts injetados.

## Limitações conhecidas

- O backend ativo continua sendo o mock determinístico; nenhuma métrica de
  qualidade de detecção é afirmada.
- O E2E patcheia apenas as listas de `matches` de uma cópia do `dist` para servir
  o fixture em `http://127.0.0.1`; é uma conveniência de teste, não uma mudança de
  comportamento do artefato publicado.
- O teste de orçamento de thread em Vitest cobre o mecanismo (cap + yield); o
  limite de parede de 50 ms é verificado em Chrome real no E2E.
