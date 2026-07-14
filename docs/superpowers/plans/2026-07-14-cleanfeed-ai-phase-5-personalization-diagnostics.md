# CleanFeed AI Phase 5 — Personalization and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar configurações por plataforma/domínio, regras pessoais seguras, histórico opt-in, importação/exportação, métricas/diagnóstico, documentação de extensibilidade e hardening final do MVP.

**Architecture:** Personalização permanece separada do classificador base. Regras geram `RuleMatchResult`, feedback/histórico são repositórios independentes e qualquer importação passa por parse/preview/confirm antes de mutar storage. Diagnósticos são agregados e nunca incluem texto, hashes ou URLs completas.

**Tech Stack:** TypeScript, `chrome.storage.local`, Web Worker separado para regex, React, Web Crypto, Vitest e Playwright.

## Global Constraints

- Aplicam-se o [plano mestre](./2026-07-14-cleanfeed-ai-master.md) e as Fases 1–4.
- Regras pessoais nunca são descritas como detecção de IA.
- Feedback é armazenado, mas não altera modelo/threshold automaticamente no MVP.
- Histórico continua desativado e sem texto por padrão.
- Importação nunca executa conteúdo, regex ou script durante preview.

---

### Task 34: Configurações por plataforma e overrides de domínio/sessão

**Files:**
- Modify: `src/storage/platform-settings.ts`
- Modify: `src/storage/effective-settings.ts`
- Create: `src/storage/domain-settings.ts`
- Modify: `src/shared/settings-types.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/popup/components/PageActions.tsx`
- Test: `tests/unit/storage/platform-settings.test.ts`
- Test: `tests/unit/storage/domain-settings.test.ts`
- Test: `tests/integration/effective-settings-precedence.test.ts`

**Interfaces:**
- Produces: `DomainSettingsRepository.pauseFor/disable/resume/clearExpired`.
- Produces: precedência defaults → global → platform → domain/session.

- [ ] **Step 1: Testar precedência, hostname e expiração**

```typescript
it("applies the documented precedence", () => {
  const effective = resolveEffectiveSettings({
    global: { minimumWordCount: 80, presentationMode: "blur" },
    platform: { platformId: "linkedin", minimumWordCount: 150 },
    domain: { hostname: "www.linkedin.com", presentationMode: "indicator" },
    session: { minimumWordCount: 100 },
  });
  expect(effective.minimumWordCount).toBe(100);
  expect(effective.presentationMode).toBe("indicator");
});

it("stores only a normalized hostname and expires one-hour pauses", async () => {
  await domains.pauseFor("https://www.LinkedIn.com/feed/?tracking=secret", 3_600_000);
  expect(await domains.get("www.linkedin.com")).toMatchObject({
    hostname: "www.linkedin.com",
    pausedUntil: clock.now() + 3_600_000,
  });
  expect(JSON.stringify(await storage.dump())).not.toContain("tracking=secret");
  clock.advanceBy(3_600_001);
  await expect(domains.get("www.linkedin.com")).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/platform-settings.test.ts tests/unit/storage/domain-settings.test.ts tests/integration/effective-settings-precedence.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar objetos parciais validados e expiração preguiçosa**

```typescript
export interface DomainSettings {
  hostname: string;
  disabled?: boolean;
  pausedUntil?: number;
  presentationMode?: PresentationMode;
}
```

Normalizar com `new URL(input).hostname.toLowerCase()` ou validar hostname direto; rejeitar credenciais, path e wildcard. Persistir mapa versionado em `cleanfeed.domains.v1`, máximo 500 hostnames. Pausa de uma hora usa timestamp; pausa de sessão vive somente no `SessionState` do tab e morre com content script. `resolveEffectiveSettings` retorna também `sourceMap` no debug para explicar a origem de cada valor.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/storage tests/integration/effective-settings-precedence.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage src/shared/settings-types.ts src/background src/popup tests
git commit -m "feat: add platform and domain configuration"
```

---

### Task 35: Keyword rules e regex isolada contra ReDoS

**Files:**
- Create: `src/rules/regex-safety.ts`
- Create: `src/rules/rule-worker.ts`
- Create: `src/rules/rule-worker-client.ts`
- Create: `src/rules/rule-engine.ts`
- Create: `src/storage/keyword-rules.ts`
- Modify: `src/content/post-controller.ts`
- Modify: `src/content/presentation/explanation-panel.ts`
- Test: `tests/unit/rules/regex-safety.test.ts`
- Test: `tests/unit/rules/rule-engine.test.ts`
- Test: `tests/integration/rule-worker-timeout.test.ts`

**Interfaces:**
- Produces: `KeywordRuleRepository`, `RuleEngine.evaluate(text, platform)`, `RuleMatchResult`.
- Consumes: normalized text, máximo 20.000 caracteres para regras; não substitui `ClassificationResult`.

- [ ] **Step 1: Testar contains/exact/regex, copy separada e padrões perigosos**

```typescript
it("returns a separate rule result without changing AI status", async () => {
  const result = await engine.evaluate("Compre CURSO agora", "linkedin", [
    rule({ pattern: "curso", matchType: "contains", caseSensitive: false, action: "blur" }),
  ]);
  expect(result).toMatchObject({ matched: true, action: "blur" });
  expect(result.label).toBe("Conteúdo filtrado por uma regra personalizada.");
  expect(result).not.toHaveProperty("aiScore");
});

it.each(["(a+)+$", "(a|aa)+$", "(.+)*", "(a{1,9}){1,9}", "(a)\\1", "(?<=a)b"])(
  "rejects risky regex %s",
  (pattern) => expect(validateRegexPattern(pattern)).toEqual(expect.objectContaining({ safe: false })),
);

it("terminates the rule worker after 20ms", async () => {
  worker.neverRespond();
  await expect(client.match(rule({ matchType: "regex" }), "a".repeat(20_000))).rejects.toMatchObject({
    code: "INFERENCE_TIMEOUT",
  });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("offers a current-post rule action only when personal rules are enabled", () => {
  const panel = createExplanationPanel(result, {
    ...callbacks,
    personalRulesEnabled: true,
    onCreateRule: vi.fn(),
  });
  document.body.append(panel);
  expect(screen.getByRole("button", { name: "Adicionar regra para este post" })).toBeVisible();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/rules tests/integration/rule-worker-timeout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar limites e worker descartável**

```typescript
export interface RuleMatchResult {
  matched: boolean;
  ruleId?: string;
  action?: "label" | "blur" | "collapse" | "hide";
  label?: "Conteúdo filtrado por uma regra personalizada.";
}
```

Regras: máximo 500, pattern 1–256 chars, platforms 1–20 IDs conhecidos. Contains/exact são comparações limitadas e lineares. Regex safety rejeita backreferences, lookbehind, nested/unbounded quantifiers e alternações prefix-overlap conhecidas. Regex aceita somente flags `u` e opcional `i`; sem `g`, `m`, `s`, `y`.

Cada batch regex roda no `rule-worker`; timeout de 20 ms termina/recria o worker. Avaliar no máximo texto normalizado de 20.000 chars. Uma regra inválida é desativada e gera diagnóstico local, sem afetar classificação de IA. Se regra e IA acionarem, UI mostra as duas origens separadamente. O painel do post oferece “Adicionar regra para este post” somente quando o recurso experimental está habilitado; abre o editor com texto vazio e plataforma preenchida, sem copiar automaticamente o post inteiro para o pattern.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/rules tests/integration/rule-worker-timeout.test.ts && npm run typecheck`

Expected: PASS; nenhuma regex roda em content script/main thread.

- [ ] **Step 5: Commit**

```powershell
git add src/rules src/storage/keyword-rules.ts src/content/post-controller.ts tests
git commit -m "feat: add isolated personal filtering rules"
```

---

### Task 36: Histórico opt-in, retenção e separação de feedback

**Files:**
- Create: `src/storage/history.ts`
- Create: `src/personalization/personalization-strategy.ts`
- Modify: `src/storage/feedback.ts`
- Modify: `src/content/post-controller.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/unit/storage/history.test.ts`
- Test: `tests/unit/personalization/personalization-strategy.test.ts`
- Test: `tests/integration/history-privacy.test.ts`

**Interfaces:**
- Produces: `HistoryRepository.add/query/clear/prune/export`.
- Consumes: hash/result/action/reveal/feedback; somente texto se `storeFullText === true` e usuário confirmou separadamente.

- [ ] **Step 1: Testar default off, retenção, limite e filtros**

```typescript
it("writes nothing while history is disabled", async () => {
  await history.add(entry, { historyEnabled: false, storeFullText: false });
  expect(await storage.dump()).toEqual({});
});

it("prunes by retention and maximum entries", async () => {
  const repository = createHistory({ retentionDays: 30, maximumEntries: 2 });
  await repository.add(entryAt(daysAgo(31)));
  await repository.add(entryAt(daysAgo(2)));
  await repository.add(entryAt(daysAgo(1)));
  await repository.add(entryAt(now()));
  const entries = await repository.query({});
  expect(entries).toHaveLength(2);
  expect(entries.every((item) => item.timestamp >= daysAgo(1))).toBe(true);
});

it("filters by platform, status and date without loading text", async () => {
  const rows = await history.query({
    platform: "linkedin",
    status: "possibly_ai",
    from: daysAgo(7),
    to: now(),
  });
  expect(rows.every((row) => !("text" in row))).toBe(true);
});

it("keeps feedback in collect-only mode in the MVP", () => {
  expect(getPersonalizationStage(150)).toEqual({
    stage: "collect_only",
    appliesThresholdAdjustment: false,
    trainsAuxiliaryClassifier: false,
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/history.test.ts tests/integration/history-privacy.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar storage paginado e opt-in explícito**

Persistir páginas de até 100 entries (`cleanfeed.history.page.<n>`) mais índice compacto; máximo configurável 100–10.000, default 1.000 quando habilitado. Cada entry corresponde à interface do pedido e nunca recebe autor/URL. Se `storeFullText` for habilitado, guardar texto em chave separada criptograficamente não é proteção suficiente contra o próprio usuário local; mostrar aviso claro e permitir limpeza independente. O default e todo export genérico continuam sem texto.

Feedback continua em repository próprio e não muda threshold/classifier. `personalization-strategy.ts` define a fronteira futura e retorna sempre `collect_only` no MVP; documenta 20–99 como possível ajuste de thresholds e 100+ como possível classificador auxiliar, mas ambos permanecem desativados até nova especificação e opt-in. Atualizar histórico por `textHash` quando reveal/feedback ocorrer, sem duplicar registro.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/storage/history.test.ts tests/integration/history-privacy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage src/content/post-controller.ts src/shared/types.ts tests
git commit -m "feat: add optional privacy-preserving history"
```

---

### Task 37: Importação/exportação versionada com preview e confirmação

**Files:**
- Create: `src/storage/import-export.ts`
- Create: `src/shared/export-validation.ts`
- Test: `tests/unit/storage/import-export.test.ts`
- Test: `tests/integration/import-atomicity.test.ts`

**Interfaces:**
- Produces: `buildExport`, `parseImport`, `previewImport`, `applyImport`.
- Consumes: repositories por categoria; transação compensatória em caso de falha.

- [ ] **Step 1: Testar schema, versão, pollution, merge e atomicidade**

```typescript
it("exports selected categories with metadata", async () => {
  const value = await buildExport({ includeFeedback: true, includeHistory: false, includeMetrics: false });
  expect(value).toMatchObject({ schemaVersion: 1, extensionVersion: expect.any(String) });
  expect(value.feedback).toBeDefined();
  expect(value.history).toBeUndefined();
});

it.each([
  "not json",
  JSON.stringify({ schemaVersion: 999 }),
  JSON.stringify({ schemaVersion: 1, __proto__: { polluted: true } }),
  JSON.stringify({ schemaVersion: 1, keywordRules: [{ pattern: "x".repeat(257) }] }),
])("rejects invalid input without mutation", async (input) => {
  const before = await storage.dump();
  await expect(parseImport(input)).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
  expect(await storage.dump()).toEqual(before);
});

it("rolls back every category if one repository write fails", async () => {
  repositories.history.save.mockRejectedValue(new Error("quota"));
  await expect(applyImport(validPreview, { mode: "replace", categories: ["settings", "history"] }))
    .rejects.toMatchObject({ code: "STORAGE_ERROR" });
  expect(await repositories.settings.get()).toEqual(originalSettings);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/import-export.test.ts tests/integration/import-atomicity.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar parse puro e apply em duas fases**

Limitar arquivo a 5 MiB antes de `JSON.parse`. Rejeitar dangerous keys recursivamente, profundidade > 20, arrays acima dos máximos e schema desconhecido. `previewImport` retorna apenas contagens/diffs e warnings; não compila regex nem grava storage. Usuário escolhe settings/platform/rules/feedback/history/metrics e merge/replace.

Antes de apply, snapshot das chaves afetadas. Validar novamente, aplicar repositórios em ordem e restaurar snapshot se qualquer write falhar. Export usa `ExtensionExport`, ISO timestamp e versão de `chrome.runtime.getManifest()`. Nunca incluir cache, texto ou domain settings a menos que uma categoria futura explicitamente os modele; MVP não exporta domínios.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/storage/import-export.test.ts tests/integration/import-atomicity.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage/import-export.ts src/shared/export-validation.ts tests
git commit -m "feat: import and export local data safely"
```

---

### Task 38: Métricas avançadas, histogramas e diagnóstico sanitizado

**Files:**
- Modify: `src/storage/metrics.ts`
- Create: `src/storage/diagnostics.ts`
- Create: `src/shared/diagnostic-types.ts`
- Test: `tests/unit/storage/metrics-advanced.test.ts`
- Test: `tests/unit/storage/diagnostics.test.ts`

**Interfaces:**
- Produces: percentis aproximados, queue max, cancellations, cache, reveals, backend/model.
- Produces: `DiagnosticsRepository.buildReport()` sem hashes/textos/URLs.

- [ ] **Step 1: Testar mediana/percentis e allowlist do diagnóstico**

```typescript
it("approximates latency percentiles from bounded histogram buckets", async () => {
  for (const latency of [10, 20, 30, 40, 100]) await metrics.recordLatency(latency);
  const snapshot = await metrics.get();
  expect(snapshot.averageInferenceMs).toBe(40);
  expect(snapshot.medianInferenceMs).toBeGreaterThanOrEqual(20);
  expect(snapshot.p95InferenceMs).toBeGreaterThanOrEqual(40);
});

it("diagnostics include only allowlisted aggregate fields", async () => {
  const report = await diagnostics.buildReport();
  expect(Object.keys(report).sort()).toEqual([
    "extension", "manifestPermissions", "metrics", "modelStatus", "platforms", "settingsSummary",
  ]);
  const serialized = JSON.stringify(report);
  expect(serialized).not.toMatch(/[a-f0-9]{64}/u);
  expect(serialized).not.toContain("https://");
  expect(serialized).not.toContain(PORTUGUESE_TEXT.slice(0, 20));
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/metrics-advanced.test.ts tests/unit/storage/diagnostics.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar histogramas bounded e relatório por allowlist**

Buckets de latência: `[5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, +Inf]`; guardar count/sum/min/max/buckets, não samples. Calcular mediana/p90/p95 aproximados pelo primeiro bucket cumulativo. `AggregateMetrics` inclui todos os campos pedidos e extensões `p90InferenceMs`, `p95InferenceMs`, `maximumQueueSize`, `modelUsage`.

Diagnóstico inclui versão, Chrome/OS em string agregada se disponível, permissões do manifesto, status/model/backend, settings somente como booleans/limites/modos, plataformas IDs e métricas. Excluir domínios, cache keys, feedback, histórico, selection, stack traces com URLs e qualquer hash.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/storage/metrics-advanced.test.ts tests/unit/storage/diagnostics.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage src/shared/diagnostic-types.ts tests/unit/storage
git commit -m "feat: add aggregate diagnostics without browsing data"
```

---

### Task 39: UI de regras, histórico, import/export e diagnóstico

**Files:**
- Create: `src/options/components/KeywordRulesSettings.tsx`
- Create: `src/options/components/KeywordRuleEditor.tsx`
- Create: `src/options/components/HistorySettings.tsx`
- Create: `src/options/components/HistoryTable.tsx`
- Create: `src/options/components/ImportExportSettings.tsx`
- Create: `src/options/components/ImportPreview.tsx`
- Modify: `src/options/components/AdvancedSettings.tsx`
- Modify: `src/options/App.tsx`
- Test: `tests/unit/options/keyword-rules.test.tsx`
- Test: `tests/unit/options/history.test.tsx`
- Test: `tests/unit/options/import-export.test.tsx`

**Interfaces:**
- Consumes: services das tasks 35–38.
- Produces: todos os controles das seções 36.4–36.6 do pedido.

- [ ] **Step 1: Testar fluxos completos e confirmações**

```tsx
it("creates, edits, disables and deletes a keyword rule", async () => {
  render(<App api={api} />);
  await userEvent.click(screen.getByRole("button", { name: "Criar regra" }));
  await userEvent.type(screen.getByLabelText("Palavra ou expressão"), "curso imperdível");
  await userEvent.selectOptions(screen.getByLabelText("Ação"), "blur");
  await userEvent.click(screen.getByRole("button", { name: "Salvar regra" }));
  expect(api.rules.create).toHaveBeenCalledWith(expect.objectContaining({ pattern: "curso imperdível" }));
});

it("does not enable full-text history without explicit acknowledgement", async () => {
  render(<App api={api} />);
  await userEvent.click(screen.getByLabelText("Armazenar texto integral"));
  expect(screen.getByRole("dialog", { name: "Confirmar armazenamento de texto" })).toBeVisible();
  expect(api.settings.save).not.toHaveBeenCalled();
});

it("shows import summary before enabling apply", async () => {
  render(<App api={api} />);
  await upload(screen.getByLabelText("Arquivo de importação"), validExportFile);
  expect(await screen.findByText(/3 regras, 12 feedbacks/u)).toBeVisible();
  expect(screen.getByRole("button", { name: "Aplicar importação" })).toBeEnabled();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/options/keyword-rules.test.tsx tests/unit/options/history.test.tsx tests/unit/options/import-export.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implementar UI acessível sem ações implícitas**

Rules table mostra pattern truncado visualmente mas completo em label, type/platform/action/enabled e erros de safety. History tem toggle, retention, max, filtros, paginação, export e clear confirmado; não renderiza coluna texto se setting off. Import usa File.text somente após checar size, mostra preview/warnings/categories/mode e requer confirmação final. Export exige checkboxes para categorias sensíveis. Advanced inclui download de diagnóstico sanitizado e reset.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/options && npm run typecheck`

Expected: PASS; navegação completa por Tab/Enter/Escape.

- [ ] **Step 5: Commit**

```powershell
git add src/options tests/unit/options
git commit -m "feat: expose local personalization controls"
```

---

### Task 40: Documentação de adaptadores e teste de extensibilidade

**Files:**
- Modify: `src/platforms/registry.ts`
- Create: `tests/fixtures/generic-adapter.html`
- Create: `tests/unit/platforms/registry.test.ts`
- Create: `tests/integration/sample-adapter-contract.test.ts`
- Create: `docs/platform-adapters.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Produces: `PlatformRegistry.register/get/match`, erro em IDs duplicados.
- Verifies: um adapter fake é adicionado em teste sem alterar pipeline/storage/presentation core.

- [ ] **Step 1: Testar registro e contrato de adapter externo**

```typescript
it("adds a new platform through registration only", async () => {
  const registry = new PlatformRegistry([linkedinAdapter]);
  registry.register(genericAdapter);
  expect(registry.match(new URL("https://forum.example/thread/1"))?.id).toBe("generic-test");
  const result = registry.match(new URL("https://forum.example/thread/1"))!.extractPost(fixturePost);
  expect(result).toMatchObject({ platform: "generic-test", text: expect.any(String) });
});

it("rejects duplicate adapter IDs", () => {
  const registry = new PlatformRegistry([linkedinAdapter]);
  expect(() => registry.register({ ...genericAdapter, id: "linkedin" })).toThrow();
});
```

- [ ] **Step 2: Confirmar RED se registry ainda não aceitar registro**

Run: `npm test -- --run tests/unit/platforms/registry.test.ts tests/integration/sample-adapter-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Finalizar registry e guia copiável**

O guia descreve arquivos mínimos, seletores isolados, proibição de author data/API privada, fixtures obrigatórias, registro, manifest host permission restrita e checklist de restore/accessibility. Incluir adapter completo de exemplo somente no documento/teste, não no bundle de produção. Especificar que `applyPresentation/restorePresentation` devem delegar ao PresentationController compartilhado.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/platforms tests/integration/sample-adapter-contract.test.ts`

Expected: PASS sem editar nenhum módulo do inference/storage para registrar fake.

- [ ] **Step 5: Commit**

```powershell
git add src/platforms/registry.ts tests docs/platform-adapters.md docs/architecture.md
git commit -m "docs: define the platform adapter contract"
```

---

### Task 41: README, decisões, riscos e documentação de operação

**Files:**
- Modify: `README.md`
- Create: `docs/decisions.md`
- Create: `docs/risks.md`
- Modify: `docs/privacy.md`
- Modify: `docs/limitations.md`
- Modify: `docs/model-integration.md`
- Modify: `docs/model-validation.md`
- Modify: `benchmark/README.md`
- Test: `tests/unit/docs/required-content.test.ts`

**Interfaces:**
- Produces: documentação completa exigida no pedido, com comandos reais do package.json.

- [ ] **Step 1: Testar presença dos avisos e tópicos obrigatórios**

```typescript
it.each([
  "não prova autoria",
  "classificação é probabilística",
  "falsos positivos",
  "falsos negativos",
  "processamento ocorre localmente",
  "MockClassifier não é um detector real",
  "como adicionar uma plataforma",
  "como integrar um modelo",
])("README contains %s", async (phrase) => {
  expect((await readFile("README.md", "utf8")).toLocaleLowerCase("pt-BR")).toContain(
    phrase.toLocaleLowerCase("pt-BR"),
  );
});

it("documents every manifest permission", async () => {
  const readme = await readFile("README.md", "utf8");
  for (const permission of manifest.permissions ?? []) expect(readme).toContain(`\`${permission}\``);
});
```

- [ ] **Step 2: Confirmar RED para seções ausentes**

Run: `npm test -- --run tests/unit/docs/required-content.test.ts`

Expected: FAIL listando tópicos ainda ausentes.

- [ ] **Step 3: Completar documentação sem promessas científicas**

README: objetivo, arquitetura, requisitos, `npm ci`, dev/build/test/e2e, Load unpacked, permissões, privacy, cache, manual analysis, adapters, offscreen/worker, mock vs real, model integration, new platform e troubleshooting. Docs: ADRs para offscreen, Transformers.js local, storage/cache, abstention e no-author; risk register com owner/signal/mitigation; limitações por DOM/idioma/tamanho/drift; model guide com manifest/assets/checksum/calibration/benchmark.

Usar somente comandos existentes. Não publicar números de precisão até existir relatório real versionado.

- [ ] **Step 4: Rodar testes documentais e link check local**

Run: `npm test -- --run tests/unit/docs/required-content.test.ts && npm run docs:check`

Expected: PASS; todo link relativo aponta para arquivo existente.

- [ ] **Step 5: Commit**

```powershell
git add README.md docs benchmark/README.md tests/unit/docs package.json package-lock.json
git commit -m "docs: complete project and model guidance"
```

---

### Task 42: Auditoria final, pacote reproduzível e portão do MVP

**Files:**
- Create: `scripts/audit-build.mjs`
- Create: `scripts/verify-reproducible-build.mjs`
- Create: `tests/e2e/full-mvp.spec.ts`
- Create: `tests/integration/storage-privacy-audit.test.ts`
- Modify: `package.json`
- Create: `docs/phase-reports/phase-5.md`
- Create: `docs/release-checklist.md`

**Interfaces:**
- Produces: `npm run audit`, `npm run verify:build`, `npm run verify`.
- Verifies: todos os 25 critérios de aceitação e restrições globais.

- [ ] **Step 1: Escrever auditorias que falham em permissão/código/rede indevidos**

```typescript
it("storage contains no author identity, full URL or text by default", async () => {
  await runRepresentativeSession();
  const dump = JSON.stringify(await chromeStorageDump());
  expect(dump).not.toContain(AUTHOR_NAME);
  expect(dump).not.toContain(PROFILE_URL);
  expect(dump).not.toContain(PORTUGUESE_LONG_TEXT.slice(0, 50));
});

test("all MVP acceptance criteria work in one offline session", async ({ extension, fixturePage }) => {
  await fixturePage.setOffline(true);
  await fixturePage.showLongLinkedInPost();
  await expect(fixturePage.cleanFeedBadge()).toBeVisible();
  await extension.setPresentationMode("blur");
  await fixturePage.reclassifyVisiblePost();
  await expect(fixturePage.showPostButton()).toBeVisible();
  await fixturePage.showPostButton().click();
  await expect(fixturePage.originalPostText()).toBeVisible();
  await extension.analyzeSelectionOnGenericSite(PORTUGUESE_LONG_TEXT);
  await expect(extension.manualResult()).toBeVisible();
});
```

- [ ] **Step 2: Confirmar que audit detecta um fixture deliberadamente inseguro**

Run: `node scripts/audit-build.mjs tests/fixtures/insecure-dist`

Expected: exit 1 citando permissão global, remote URL e `eval` presentes no fixture.

- [ ] **Step 3: Implementar audit e verificação reproduzível**

`audit-build.mjs dist` parseia manifest, compara allowlist de permissões/hosts/CSP, procura em JS/HTML por imports HTTP(S), `eval(`, `new Function`, sourcemaps com source externo e assets não inventariados. Exceções de strings documentais não entram no dist; a busca de URL usa AST/import patterns quando necessário para não acusar copy.

`verify-reproducible-build.mjs` executa dois builds limpos em diretórios temporários, normaliza apenas timestamps conhecidos do bundle e compara SHA-256/nomes. Não apaga nada fora dos temp dirs verificados. `npm run verify` encadeia format check, lint, typecheck, unit/integration, build, audit e E2E.

Release checklist cobre: Chrome version, permission diff, offline, mock/model status, benchmark status, accessibility, data clear, import rollback, cache version, screenshots/copy, known limitations e ausência de author preference.

- [ ] **Step 4: Executar o portão final completo**

Run:

```powershell
npm run verify
npm run verify:build
```

Expected: todos exit 0. Se modelo real/dataset não foram fornecidos, E2E espera backend mock e `docs/phase-reports/phase-5.md` registra essa limitação; o MVP funcional continua aceito com pipeline real-ready, não como detector cientificamente validado.

- [ ] **Step 5: Inspecionar `git diff`, registrar relatório e commit**

Confirmar que somente arquivos planejados fazem parte da mudança e que nenhum model/dataset sem licença entrou no Git.

```powershell
git add scripts package.json package-lock.json tests docs
git commit -m "chore: verify the complete CleanFeed AI MVP"
```

## Phase 5 Exit Criteria

- Overrides por plataforma/domínio funcionam sem armazenar URL completa.
- Regras são locais, isoladas, limitadas e claramente separadas de IA.
- Histórico é opt-in, retido/limitado e sem texto por padrão.
- Import/export valida, mostra preview, confirma e faz rollback atômico.
- Métricas/diagnósticos são agregados e não contêm texto/hash/autor/URL.
- Novo adapter pode ser registrado sem alterar inference/storage core.
- README e docs cobrem todos os entregáveis e limitações.
- `npm run verify` e build reproduzível passam; 25 critérios do MVP têm evidência automatizada/manual registrada.
