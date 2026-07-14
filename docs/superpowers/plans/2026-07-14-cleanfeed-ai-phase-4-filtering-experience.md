# CleanFeed AI Phase 4 — Filtering Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar todos os modos reversíveis de apresentação, explicações e feedback locais, análise manual em qualquer site, menus de contexto, popup/opções completos e acessibilidade validada.

**Architecture:** O PresentationController aplica somente classes, atributos e nós pertencentes à extensão, mantendo o post original conectado. O painel manual é injetado sob gesto do usuário e montado em Shadow DOM; comunicação continua pelos contratos runtime validados.

**Tech Stack:** React, DOM/Shadow DOM, Chrome contextMenus/activeTab/scripting, CSS, Testing Library, Vitest, Playwright Chromium e axe-core.

## Global Constraints

- Aplicam-se o [plano mestre](./2026-07-14-cleanfeed-ai-master.md) e as Fases 1–3.
- Nenhum modo remove permanentemente o post do DOM; reveal/restore é imediato e navegável por teclado.
- Abstenção, humano provável e inconclusivo nunca acionam blur/collapse/hide automaticamente.
- Regra de tamanho/calibração sempre limita a agressividade, mesmo se o usuário escolheu `hide`.
- A análise manual não modifica a página além do painel próprio, salvo ação posterior explícita do usuário.

---

### Task 26: PresentationController e estado reversível por sessão

**Files:**
- Create: `src/content/presentation/presentation-controller.ts`
- Modify: `src/content/session-state.ts`
- Modify: `src/content/presentation/badge.ts`
- Modify: `src/content/presentation/restore.ts`
- Modify: `src/platforms/linkedin/presenter.ts`
- Test: `tests/unit/content/presentation-controller.test.ts`

**Interfaces:**
- Produces: `PresentationController.apply/reveal/restore/ignore/clearAll`.
- Consumes: `ClassificationResult`, `EffectiveSettings`, `DecisionOutcome`.

- [ ] **Step 1: Testar decisão, idempotência e propriedade dos nós**

```typescript
it("does not filter human, inconclusive or abstained results", () => {
  for (const status of ["probably_human", "inconclusive", "insufficient_evidence"] as const) {
    controller.apply(post, result({ status, aiScore: 0.99 }), hideSettings);
    expect(post).not.toHaveClass("cleanfeed-hidden", "cleanfeed-blurred", "cleanfeed-collapsed");
    controller.restore(post);
  }
});

it("applies the least aggressive mode allowed by calibration", () => {
  controller.apply(
    post,
    result({ aiScore: 0.999, decision: { ...decision, actionCeiling: "blur" } }),
    hideSettings,
  );
  expect(post).toHaveClass("cleanfeed-blurred");
  expect(post).not.toHaveClass("cleanfeed-hidden");
});

it("is idempotent and removes only owned nodes", () => {
  const hostNode = post.querySelector("[data-host-node]");
  controller.apply(post, aiResult, settings);
  controller.apply(post, aiResult, settings);
  expect(document.querySelectorAll("[data-cleanfeed-owned='badge']")).toHaveLength(1);
  controller.restore(post);
  expect(hostNode).toBeConnected();
  expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(0);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/content/presentation-controller.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar state machine por elemento**

```typescript
type PresentationState =
  | { kind: "clean" }
  | { kind: "presented"; mode: PresentationMode; result: ClassificationResult }
  | { kind: "revealed"; mode: PresentationMode; result: ClassificationResult }
  | { kind: "ignored"; result: ClassificationResult };

const MODE_RANK: Record<PresentationMode, number> = {
  indicator: 0,
  blur: 1,
  collapse: 2,
  hide: 3,
};
```

Guardar estado em `WeakMap`; manter `Set<HTMLElement>` somente para `clearAll`, removendo elementos desconectados em cada operação. `apply` calcula modo permitido por score/settings/actionCeiling. `reveal` remove classe visual e mantém badge; `restore` remove todas as marcas/owned nodes e incrementa `restored`; `ignore` impede reaplicação durante a sessão. Nunca serializar WeakMap ou elemento.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/content/presentation-controller.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/content src/platforms/linkedin/presenter.ts tests/unit/content/presentation-controller.test.ts
git commit -m "feat: manage reversible post presentation"
```

---

### Task 27: Blur, collapse, hide e reveal acessível

**Files:**
- Create: `src/content/presentation/blur.ts`
- Create: `src/content/presentation/collapse.ts`
- Create: `src/content/presentation/hide.ts`
- Modify: `src/content/presentation/restore.ts`
- Modify: `src/content/presentation/presentation-controller.ts`
- Modify: `src/styles/injected.css`
- Test: `tests/unit/content/presentation-modes.test.ts`
- Test: `tests/integration/presentation-restoration.test.ts`

**Interfaces:**
- Produces: `applyBlur`, `applyCollapse`, `applyHide`, `revealPost`, todos retornando cleanup idempotente.

- [ ] **Step 1: Testar DOM, texto, foco e restauração**

```typescript
it("blur leaves content in place and exposes an immediate reveal button", async () => {
  applyBlur(post, onReveal);
  expect(post).toHaveClass("cleanfeed-blurred");
  const button = screen.getByRole("button", { name: "Mostrar publicação" });
  await userEvent.click(button);
  expect(onReveal).toHaveBeenCalledOnce();
});

it.each([
  ["collapse", "Publicação recolhida por apresentar fortes indícios de geração por IA."],
  ["hide", "Uma publicação foi ocultada pelo filtro."],
])("%s keeps the original post connected behind an accessible placeholder", (mode, copy) => {
  controller.apply(post, strongAiResult, settingsFor(mode as PresentationMode));
  expect(post).toBeConnected();
  expect(screen.getByText(copy)).toBeVisible();
  expect(screen.getByRole("button", { name: "Mostrar conteúdo" })).toBeVisible();
});

it("restores original inline styles and aria attributes exactly", () => {
  const before = snapshotAttributes(post);
  controller.apply(post, strongAiResult, hideSettings);
  controller.restore(post);
  expect(snapshotAttributes(post)).toEqual(before);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/content/presentation-modes.test.ts tests/integration/presentation-restoration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar modos sem innerHTML**

Blur aplica classe somente ao content region identificado pelo adapter e insere toolbar não desfocada. Collapse/hide inserem um `section` sibling imediatamente antes do post, salvam presença/valor original de `hidden` e `aria-hidden`, e ocultam o original com classe. Placeholder tem texto via `textContent`, botão real e `aria-live="polite"` somente na primeira aplicação.

CSS usa `filter: blur(5px)` no conteúdo, não `opacity: 0`; `pointer-events: none` no corpo e `pointer-events: auto` na toolbar. Focus outline mínimo 2px. Em `prefers-reduced-motion: reduce`, nenhuma transição. Alto contraste usa border/texto, não só cor.

- [ ] **Step 4: Rodar testes de apresentação**

Run: `npm test -- --run tests/unit/content/presentation-modes.test.ts tests/integration/presentation-restoration.test.ts`

Expected: PASS; post original nunca é removido.

- [ ] **Step 5: Commit**

```powershell
git add src/content/presentation src/styles/injected.css tests
git commit -m "feat: add reversible filtering modes"
```

---

### Task 28: Explanation panel e feedback local por hash

**Files:**
- Create: `src/content/presentation/explanation-panel.ts`
- Create: `src/storage/feedback.ts`
- Modify: `src/content/presentation/badge.ts`
- Modify: `src/content/post-controller.ts`
- Test: `tests/unit/content/explanation-panel.test.ts`
- Test: `tests/unit/storage/feedback.test.ts`

**Interfaces:**
- Produces: `createExplanationPanel(result, callbacks): HTMLElement`.
- Produces: `FeedbackRepository.add/list/clear`, sem texto/autor.

- [ ] **Step 1: Testar reasons calculados, copy e storage mínimo**

```typescript
it("renders only calculated evidence under the approved heading", () => {
  const panel = createExplanationPanel(resultWithReasons(["HIGH_AVERAGE_SCORE"]), callbacks);
  document.body.append(panel);
  expect(screen.getByRole("heading", { name: "Indícios observados" })).toBeVisible();
  expect(screen.getByText(/pontuação média/u)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/provas|foi escrito por IA/u);
});

it("stores feedback keyed by hash without text or author", async () => {
  await feedback.add({
    textHash: HASH,
    predictedScore: 0.91,
    predictedStatus: "possibly_ai",
    feedback: "human",
    modelVersion: "mock-v1",
    platform: "linkedin",
    createdAt: 1,
  });
  expect(JSON.stringify(await storage.dump())).not.toContain(PORTUGUESE_TEXT);
  expect((await feedback.list())[0].textHash).toBe(HASH);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/content/explanation-panel.test.ts tests/unit/storage/feedback.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar painel DOM e feedback versionado**

Mapear `ReasonCode` para frases estáticas. Mostrar model ID/version/backend, word/token count, chunks/consistência e profile somente se presentes. Não interpretar neurônios, estilo ou intenção. O disclosure abre com botão (`aria-expanded`, `aria-controls`) e move foco ao heading; fechar devolve foco ao badge.

Feedback oferece “Era humano”, “Era IA”, “Não sei”. Validar score/status/hash/model/platform, limitar 2.000 registros por LRU e substituir feedback anterior do mesmo hash/modelVersion. Exibir confirmação local sem dizer que o modelo foi treinado.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/content/explanation-panel.test.ts tests/unit/storage/feedback.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/content src/storage/feedback.ts tests
git commit -m "feat: explain results and collect local feedback"
```

---

### Task 29: Painel React de análise manual em qualquer site

**Files:**
- Create: `src/manual-analysis/inject.ts`
- Create: `src/manual-analysis/App.tsx`
- Create: `src/manual-analysis/components/ManualResult.tsx`
- Create: `src/manual-analysis/components/ManualEmptyState.tsx`
- Create: `src/background/manual-analysis-controller.ts`
- Modify: `vite.config.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/shared/message-validation.ts`
- Test: `tests/unit/manual-analysis/App.test.tsx`
- Test: `tests/integration/manual-analysis-flow.test.ts`

**Interfaces:**
- Produces: mensagens `SHOW_MANUAL_ANALYSIS`, `MANUAL_ANALYSIS_READY`, `MANUAL_ANALYSIS_RESULT`.
- Consumes: selection text fornecido por ação do usuário; envia `CLASSIFY_TEXT` com `manual: true`.

- [ ] **Step 1: Testar injeção idempotente, prioridade e não modificação da página**

```typescript
it("mounts one isolated panel and preserves host DOM", async () => {
  document.body.innerHTML = '<main id="host">conteúdo original</main>';
  injectManualAnalysisPanel();
  injectManualAnalysisPanel();
  expect(document.querySelectorAll("[data-cleanfeed-manual-host]")).toHaveLength(1);
  expect(document.querySelector("#host")?.textContent).toBe("conteúdo original");
  expect(document.querySelector("[data-cleanfeed-manual-host]")?.shadowRoot).not.toBeNull();
});

it("sends manual requests at maximum priority and displays result only in the panel", async () => {
  render(<App api={api} selectedText={PORTUGUESE_LONG_TEXT} />);
  await userEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));
  expect(api.classify).toHaveBeenCalledWith(expect.objectContaining({ manual: true }));
  expect(await screen.findByText(/Resultado inconclusivo|Possivelmente/u)).toBeVisible();
});

it("explains minimum length failures", async () => {
  render(<App api={api} selectedText="texto curto" />);
  expect(screen.getByText("Este conteúdo possui menos palavras do que o mínimo configurado.")).toBeVisible();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/manual-analysis tests/integration/manual-analysis-flow.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar injeção por gesto e Shadow DOM**

Service worker executa `chrome.scripting.executeScript({ target: { tabId }, files: [manualEntry] })`; após resolve, envia `SHOW_MANUAL_ANALYSIS` com selection limitada a 100.000 caracteres. `inject.ts` cria um host fixo com closed-over React root, ShadowRoot open para testes e styles próprios via `<style>.…</style>` criado de constante confiável; nunca insere texto selecionado como HTML.

Painel mostra contagem de palavras, status, confiança, aviso mock, reasons, fechar, retry e aplicar ação visual somente se o usuário clicar e o site tiver adapter; em site genérico não há alteração automática.

- [ ] **Step 4: Rodar testes e build de entry programático**

Run: `npm test -- --run tests/unit/manual-analysis tests/integration/manual-analysis-flow.test.ts && npm run build`

Expected: PASS; entry manual aparece no `dist` e não é content script global.

- [ ] **Step 5: Commit**

```powershell
git add src/manual-analysis src/background src/shared vite.config.ts tests
git commit -m "feat: analyze selected text on demand"
```

---

### Task 30: Menus de contexto e ações do post atual

**Files:**
- Create: `src/background/context-menu.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/manual-analysis-controller.ts`
- Modify: `src/content/content-script.ts`
- Modify: `src/content/post-controller.ts`
- Test: `tests/unit/background/context-menu.test.ts`
- Test: `tests/integration/current-post-actions.test.ts`

**Interfaces:**
- Produces: IDs estáveis `analyze-selection`, `analyze-current-post`, `report-missed`, `report-wrong`, `pause-site`, `open-options`.
- Consumes: `contextmenu` no content script para lembrar somente o HTMLElement atual em WeakRef/memória.

- [ ] **Step 1: Testar criação, contexts e dispatch**

```typescript
it("creates author-free context menu entries on installation", () => {
  createContextMenus();
  expect(chrome.contextMenus.create.mock.calls.map(([item]) => item.id)).toEqual([
    "analyze-selection",
    "analyze-current-post",
    "report-missed",
    "report-wrong",
    "pause-site",
    "open-options",
  ]);
  expect(JSON.stringify(chrome.contextMenus.create.mock.calls)).not.toMatch(/autor|perfil/u);
});

it("uses selectionText only after the user invokes analyze selection", async () => {
  await handleContextMenuClick(
    { menuItemId: "analyze-selection", selectionText: PORTUGUESE_LONG_TEXT },
    { id: 7, url: "https://example.com/article" },
  );
  expect(manual.open).toHaveBeenCalledWith(7, PORTUGUESE_LONG_TEXT);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/background/context-menu.test.ts tests/integration/current-post-actions.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar comandos e estado efêmero do clique direito**

`onInstalled` remove todos e recria menus para idempotência. Selection menu usa context `selection` em qualquer URL permitida por activeTab. Current-post/report items enviam comando ao tab LinkedIn; content script guarda `lastContextPost` no evento `contextmenu` sem autor/URL e descarta ao navegar/desconectar.

“Reportar conteúdo não detectado” incrementa somente métrica local e abre análise manual. “Classificação incorreta” abre feedback do hash atual. “Pausar” grava override de sessão/domínio sem path. “Abrir configurações” chama `chrome.runtime.openOptionsPage()`.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/background/context-menu.test.ts tests/integration/current-post-actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/background src/content tests
git commit -m "feat: add privacy-preserving context actions"
```

---

### Task 31: Popup completo e controles de página

**Files:**
- Modify: `src/popup/App.tsx`
- Create: `src/popup/components/ExtensionStatus.tsx`
- Modify: `src/popup/components/PageStatsSummary.tsx`
- Create: `src/popup/components/ModelStatusCard.tsx`
- Create: `src/popup/components/PageActions.tsx`
- Modify: `src/background/message-router.ts`
- Modify: `src/content/content-script.ts`
- Test: `tests/unit/popup/full-popup.test.tsx`

**Interfaces:**
- Consumes: page stats, settings, model status, pause e clear presentation.
- Produces: todos os campos pedidos no popup sem URL completa.

- [ ] **Step 1: Testar todos os dados e botões**

```tsx
it("renders all requested counters and model state", async () => {
  render(<App api={apiWithFullStats} />);
  for (const label of [
    "Encontrados", "Analisados", "Ignorados por tamanho", "Ignorados por idioma",
    "Marcados", "Desfocados", "Recolhidos", "Ocultados", "Restaurados",
    "Latência média", "Fila", "Modelo", "Versão", "Backend", "Estado",
  ]) {
    expect(await screen.findByText(label)).toBeVisible();
  }
});

it("pauses only the current hostname and can clear page presentation", async () => {
  render(<App api={api} />);
  await userEvent.click(screen.getByRole("button", { name: "Pausar neste site" }));
  expect(api.pauseDomain).toHaveBeenCalledWith("www.linkedin.com");
  await userEvent.click(screen.getByRole("button", { name: "Limpar resultados visuais" }));
  expect(api.clearPagePresentation).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/popup/full-popup.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Completar popup com estados de erro úteis**

Resolver tab atual no mount; se não houver content script, mostrar “Plataforma não suportada” sem erro técnico. Exibir somente `URL.hostname`. Toggle geral, pausa, options e clear têm loading/disabled enquanto pendentes; erro recuperável aparece em `role="status"`. Warning mock ocupa a primeira região após título.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/popup && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/popup src/background/message-router.ts src/content/content-script.ts tests/unit/popup
git commit -m "feat: complete popup status and page controls"
```

---

### Task 32: Opções Geral, Plataformas, Desempenho, Privacidade e Avançado

**Files:**
- Modify: `src/options/App.tsx`
- Modify: `src/options/components/GeneralSettings.tsx`
- Create: `src/options/components/PlatformSettings.tsx`
- Modify: `src/options/components/PerformanceSettings.tsx`
- Modify: `src/options/components/PrivacyNotice.tsx`
- Create: `src/options/components/AdvancedSettings.tsx`
- Create: `src/options/components/DangerZone.tsx`
- Test: `tests/unit/options/settings-sections.test.tsx`
- Test: `tests/integration/settings-roundtrip.test.ts`

**Interfaces:**
- Produces: seções funcionais para settings existentes; Rules/Import/History entram na Fase 5.
- Consumes: settings repository e clear cache/feedback/metrics.

- [ ] **Step 1: Testar seções, validação e limpeza confirmada**

```tsx
it("organizes the requested settings into accessible sections", async () => {
  render(<App api={api} />);
  for (const name of ["Geral", "Plataformas", "Desempenho", "Privacidade", "Avançado"]) {
    expect(await screen.findByRole("heading", { name })).toBeVisible();
  }
});

it("blocks inconsistent thresholds before persistence", async () => {
  render(<App api={api} />);
  await userEvent.clear(screen.getByLabelText("Limiar de desfoque"));
  await userEvent.type(screen.getByLabelText("Limiar de desfoque"), "0.70");
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/ordem dos limiares/u);
  expect(api.save).not.toHaveBeenCalled();
});

it("requires explicit confirmation before clearing feedback", async () => {
  render(<App api={api} />);
  await userEvent.click(screen.getByRole("button", { name: "Limpar feedback" }));
  expect(api.clearFeedback).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirmar limpeza de feedback" }));
  expect(api.clearFeedback).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/options/settings-sections.test.tsx tests/integration/settings-roundtrip.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar formulário draft/validate/save**

Carregar snapshot, editar draft local, validar no submit e salvar uma operação atômica. Geral: enabled/platform/min words/language/mode/visible-only/experimental/manual/score/explanation. Plataforma: LinkedIn enabled, overrides e reset. Performance: backend, GPU/WASM, queue, concurrency, rate, batching, chunks, timeout, cache. Privacidade: explicação, history off, store text off e clear actions. Avançado: thresholds/model/calibration/debug/diagnostic/reset.

Campos indisponíveis antes da Fase 5 aparecem somente quando seus serviços existem; não renderizar controles decorativos sem efeito. Reset mostra diff/resumo antes de confirmar.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/options tests/integration/settings-roundtrip.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/options tests/unit/options tests/integration/settings-roundtrip.test.ts
git commit -m "feat: complete configurable extension settings"
```

---

### Task 33: Acessibilidade, segurança, performance, E2E e portão da Fase 4

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/extension.spec.ts`
- Create: `tests/e2e/fixtures/linkedin-server.ts`
- Create: `tests/e2e/helpers/load-extension.ts`
- Create: `tests/integration/security-boundaries.test.ts`
- Create: `tests/integration/main-thread-budget.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/privacy.md`
- Modify: `docs/limitations.md`
- Create: `docs/manual-analysis.md`
- Create: `docs/phase-reports/phase-4.md`

**Interfaces:**
- Produces: `npm run test:e2e` carregando `dist` em persistent Chromium context.
- Verifies: offline, keyboard, restore, permissions, no network e budget da main thread.

- [ ] **Step 1: Criar testes de boundary e cenário Chrome real**

```typescript
test("loads unpacked, classifies fixture offline and restores with keyboard", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("chrome-extension://") && !request.url().startsWith(FIXTURE_ORIGIN)) {
      requests.push(request.url());
    }
  });
  await page.goto(`${FIXTURE_ORIGIN}/linkedin-feed.html`);
  await page.getByTestId("long-post").scrollIntoViewIfNeeded();
  const badge = page.getByRole("button", { name: /indícios|inconclusivo|pessoa/u });
  await expect(badge).toBeVisible();
  await badge.press("Enter");
  await expect(page.getByRole("heading", { name: "Indícios observados" })).toBeVisible();
  expect(requests).toEqual([]);
});

it("rejects forged runtime messages and dangerous HTML", () => {
  expect(() => parseExtensionMessage(forgedPageMessage)).toThrow("INVALID_MESSAGE");
  const panel = createExplanationPanel(resultWithText('<img src=x onerror="boom">'), callbacks);
  expect(panel.querySelector("img")).toBeNull();
});
```

- [ ] **Step 2: Confirmar RED antes de instalar Playwright/axe**

Run: `npm test -- --run tests/integration/security-boundaries.test.ts tests/integration/main-thread-budget.test.ts`

Expected: FAIL até helpers/guards existirem.

- [ ] **Step 3: Implementar harness e checks objetivos**

Playwright usa Chrome/Chromium persistent context com `--disable-extensions-except=<dist>` e `--load-extension=<dist>`. Fixture server é local e sem internet. Cobrir: load, observer visibility, cache, popup, options, blur/reveal/restore, manual selection em domínio genérico, context menu via controller integration e falha do worker.

Adicionar `axe-core` somente aos roots próprios (popup/options/manual/presentation) e corrigir violações serious/critical. `PerformanceObserver({ entryTypes: ["longtask"] })` na fixture atribui tasks ao pipeline de teste; também instrumentar callbacks de observer/extraction e falhar se qualquer callback síncrono exceder 50 ms em fixture de 500 posts. Mutation batches têm cap de 100 candidatos/ciclo e yield via `scheduler.yield` quando disponível, fallback `setTimeout(0)`.

Security test verifica CSP, permissões, zero `eval`/`new Function`, zero `innerHTML` em `src/`, limite de mensagens e ausência das chaves proibidas `authorName`, `authorId`, `profileUrl` em storage dumps.

- [ ] **Step 4: Executar portão completo com rede bloqueada**

Run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run test:e2e
```

Expected: todos exit 0; E2E registra zero requests externos, zero violações serious/critical e zero long tasks atribuídas à extensão acima de 50 ms.

- [ ] **Step 5: Documentar e commit**

README passa a cobrir análise manual, modos reversíveis, acessibilidade, permissões e como carregar/testar. Relatório registra máquina/Chrome, latências e qualquer skip.

```powershell
git add package.json package-lock.json playwright.config.ts src tests README.md docs
git commit -m "feat: complete the accessible filtering experience"
```

## Phase 4 Exit Criteria

- Indicator/blur/collapse/hide respeitam status, score e action ceiling.
- Reveal/restore/ignore são imediatos, idempotentes e não perdem DOM original.
- Explicações usam apenas sinais calculados e linguagem probabilística.
- Feedback é local e vinculado somente ao hash.
- Seleção pode ser analisada em qualquer site por gesto activeTab, sem host permission global.
- Popup e opções cobrem o escopo existente e têm estados de erro acessíveis.
- E2E offline, keyboard, segurança e budget de 50 ms passam em Chrome real.
