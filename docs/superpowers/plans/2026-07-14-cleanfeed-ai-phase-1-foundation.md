# CleanFeed AI Phase 1 — Functional Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma extensão MV3 carregável que detecta posts elegíveis do LinkedIn, classifica com mock em Web Worker, usa cache local, aplica selo probabilístico e expõe settings/estatísticas básicas.

**Architecture:** O content script limita-se ao DOM; o service worker faz storage e roteamento; um offscreen document hospeda o worker mock. Todos os contratos são definidos antes dos consumidores, e cada serviço recebe dependências explícitas para ser testável.

**Tech Stack:** TypeScript strict, Vite, React, CRXJS, Chrome MV3, Web Crypto, `chrome.storage.local`, Vitest, jsdom, Testing Library, ESLint e Prettier.

## Global Constraints

- Aplicam-se todas as restrições e defaults do [plano mestre](./2026-07-14-cleanfeed-ai-master.md).
- Esta fase usa somente `MockClassifier`; toda UI mostra o aviso de demonstração.
- Nenhuma classificação pode executar na main thread da página.
- Host permission somente para `https://www.linkedin.com/*`; análise genérica entra na Fase 4 via `activeTab`.

---

### Task 1: Toolchain, manifest e shells carregáveis

**Files:**
- Create: `package.json`
- Create: `package-lock.json` (gerado por `npm install`)
- Create: `manifest.config.ts`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `src/background/service-worker.ts`
- Create: `src/content/content-script.ts`
- Create: `src/offscreen/offscreen.html`
- Create: `src/offscreen/offscreen.ts`
- Create: `src/popup/popup.html`
- Create: `src/popup/main.tsx`
- Create: `src/popup/App.tsx`
- Create: `src/options/options.html`
- Create: `src/options/main.tsx`
- Create: `src/options/App.tsx`
- Test: `tests/unit/manifest.test.ts`

**Interfaces:**
- Produces: scripts `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `format`, `format:check`.
- Produces: `manifest` com MV3, Chrome 116+, service worker module, popup/options, content script LinkedIn, CSP e permissões mínimas.

- [ ] **Step 1: Criar o teste que fixa as permissões e os contextos**

```typescript
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.config";

describe("manifest", () => {
  it("uses MV3 and only the approved permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions).toEqual([
      "storage",
      "contextMenus",
      "activeTab",
      "scripting",
      "offscreen",
    ]);
    expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/*"]);
  });

  it("packages no remote execution capability", () => {
    expect(manifest.content_security_policy?.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
    );
    expect(JSON.stringify(manifest)).not.toContain("http://");
  });
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha por ausência do manifesto**

Run: `npm test -- --run tests/unit/manifest.test.ts`

Expected: FAIL porque `manifest.config.ts` ainda não existe.

- [ ] **Step 3: Criar package/toolchain e manifesto**

O `package.json` deve declarar `type: "module"`, `engines.node: ">=22"`, React/React DOM e `@huggingface/transformers` como dependências; CRXJS, Vite, TypeScript, Vitest, jsdom, ESLint, types do Chrome/React, Prettier e Testing Library como devDependencies. Instalar versões estáveis atuais e deixar `package-lock.json` fixá-las.

```typescript
// manifest.config.ts
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  minimum_chrome_version: "116",
  name: "CleanFeed AI",
  version: "0.1.0",
  description: "Filtro local e probabilístico para publicações longas.",
  permissions: ["storage", "contextMenus", "activeTab", "scripting", "offscreen"],
  host_permissions: ["https://www.linkedin.com/*"],
  background: { service_worker: "src/background/service-worker.ts", type: "module" },
  action: { default_popup: "src/popup/popup.html", default_title: "CleanFeed AI" },
  options_page: "src/options/options.html",
  content_scripts: [
    {
      matches: ["https://www.linkedin.com/*"],
      js: ["src/content/content-script.ts"],
      css: ["src/styles/injected.css"],
      run_at: "document_idle",
      world: "ISOLATED",
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
  },
});
```

`vite.config.ts` usa `plugins: [react(), crx({ manifest })]`, `base: "./"`, aliases `@ -> src` e inclui `src/offscreen/offscreen.html` em `build.rollupOptions.input` para garantir o documento não referenciado diretamente pelo manifesto. Os shells React renderizam somente `<h1>CleanFeed AI</h1>`; `service-worker.ts`, `content-script.ts` e `offscreen.ts` exportam `{}` até seus respectivos tasks. Criar `src/styles/injected.css` vazio para que o entry do manifesto exista.

- [ ] **Step 4: Instalar e verificar o toolchain**

Run: `npm install`

Run: `npm run typecheck && npm run lint && npm test -- --run tests/unit/manifest.test.ts && npm run build`

Expected: todos PASS; `dist/manifest.json`, popup, options, service worker e content script presentes.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json manifest.config.ts vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json eslint.config.js .prettierrc.json .gitignore src tests/unit/manifest.test.ts
git commit -m "chore: scaffold the MV3 extension"
```

---

### Task 2: Contratos de domínio, erros e validação de mensagens

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/settings-types.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/errors.ts`
- Create: `src/shared/messages.ts`
- Create: `src/shared/message-validation.ts`
- Create: `src/shared/validation.ts`
- Test: `tests/unit/shared/message-validation.test.ts`
- Test: `tests/unit/shared/validation.test.ts`

**Interfaces:**
- Produces: todos os contratos canônicos do plano mestre, `UserSettings`, `EffectiveSettings`, `PageStats`, `ModelStatus`, `ExtensionMessage`, `ErrorCode` e `CleanFeedError`.
- Produces: `parseExtensionMessage(value: unknown): ExtensionMessage` e `validateThresholds(...)`.

- [ ] **Step 1: Escrever testes para mensagens inválidas, payload excessivo e thresholds**

```typescript
import { describe, expect, it } from "vitest";
import { parseExtensionMessage } from "@/shared/message-validation";
import { validateThresholds } from "@/shared/validation";

describe("parseExtensionMessage", () => {
  it("accepts a bounded classify request", () => {
    expect(
      parseExtensionMessage({
        source: "content",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId: "r-1",
        payload: { text: "texto válido", platform: "linkedin", manual: false },
      }).type,
    ).toBe("CLASSIFY_TEXT");
  });

  it.each([
    {},
    { type: "UNKNOWN" },
    { source: "content", target: "background", type: "CLASSIFY_TEXT", payload: {} },
    {
      source: "content",
      target: "background",
      type: "CLASSIFY_TEXT",
      requestId: "r-1",
      payload: { text: "x".repeat(100_001), platform: "linkedin", manual: false },
    },
  ])("rejects %j", (value) => expect(() => parseExtensionMessage(value)).toThrow());
});

it("rejects unordered thresholds", () => {
  expect(() =>
    validateThresholds({ marking: 0.8, blur: 0.7, collapse: 0.9, hide: 1 }),
  ).toThrowError("INVALID_SETTINGS");
});
```

- [ ] **Step 2: Executar e confirmar falha pelos módulos ausentes**

Run: `npm test -- --run tests/unit/shared`

Expected: FAIL por imports não resolvidos.

- [ ] **Step 3: Definir contratos e constantes sem campos de autor**

Copiar para `types.ts` as interfaces `TextLengthInfo`, `EligibilityResult`, `TextChunk`, `ChunkResult`, `AggregationResult`, `ClassificationResult`, `ClassificationExplanation`, `PerformanceTrace`, `AggregateMetrics`, `CachedClassification`, `LanguageDetectionResult`, `CalibrationProfile`, `InferenceTask`, `ExtractedPost` e `PlatformAdapter` especificadas no pedido. Aplicar as extensões canônicas do master (`decision`, `errorCode`, `demo`, `supportsBatching` e `ModelStatus`), acrescentar somente identificadores técnicos (`requestId`, `platform`, hashes) e nunca campos de autor.

```typescript
// src/shared/errors.ts
export type ErrorCode =
  | "MODEL_LOAD_FAILED"
  | "TOKENIZATION_FAILED"
  | "INFERENCE_FAILED"
  | "INFERENCE_TIMEOUT"
  | "WORKER_UNAVAILABLE"
  | "WEBGPU_UNAVAILABLE"
  | "CACHE_ERROR"
  | "STORAGE_ERROR"
  | "INVALID_SETTINGS"
  | "INVALID_MESSAGE"
  | "PLATFORM_EXTRACTION_FAILED";

export class CleanFeedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable = true,
  ) {
    super(message);
    this.name = "CleanFeedError";
  }
}
```

`ExtensionMessage` deve conter os tipos pedidos e ainda `GET_SETTINGS`, `SETTINGS_RESULT`, `CACHE_CLEAR`, `METRICS_CLEAR`, `OFFSCREEN_CLASSIFY`, `OFFSCREEN_RESULT` e `WORKER_STATUS`. `parseExtensionMessage` usa verificações explícitas de objeto/string/boolean, limita texto a 100.000 caracteres, `requestId` a 128 e rejeita chaves poluentes `__proto__`, `prototype`, `constructor` em payloads importáveis.

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test -- --run tests/unit/shared && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared tests/unit/shared
git commit -m "feat: define validated extension contracts"
```

---

### Task 3: Storage adapter, settings e resolução efetiva

**Files:**
- Create: `src/storage/storage-area.ts`
- Create: `src/storage/settings.ts`
- Create: `src/storage/platform-settings.ts`
- Create: `src/storage/effective-settings.ts`
- Create: `tests/setup/chrome.ts`
- Test: `tests/unit/storage/settings.test.ts`
- Test: `tests/unit/storage/effective-settings.test.ts`

**Interfaces:**
- Consumes: `UserSettings`, `PlatformSettings`, `EffectiveSettings`, `DEFAULT_SETTINGS`.
- Produces: `ChromeStorageArea`, `SettingsRepository.get/save/reset`, `PlatformSettingsRepository`, `resolveEffectiveSettings(input)`.

- [ ] **Step 1: Testar defaults, migração, merge e rejeição de thresholds**

```typescript
describe("resolveEffectiveSettings", () => {
  it("merges defaults, global, platform and session in that order", () => {
    const result = resolveEffectiveSettings({
      global: { minimumWordCount: 80, presentationMode: "blur" },
      platform: { platformId: "linkedin", minimumWordCount: 150 },
      session: { presentationMode: "indicator" },
    });
    expect(result.minimumWordCount).toBe(150);
    expect(result.presentationMode).toBe("indicator");
  });
});

it("recovers from a corrupt settings value", async () => {
  storage.seed("cleanfeed.settings.v1", { minimumWordCount: -3 });
  await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/settings.test.ts tests/unit/storage/effective-settings.test.ts`

Expected: FAIL por módulos ausentes.

- [ ] **Step 3: Implementar storage injetável e settings versionados**

```typescript
export interface StorageArea {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getMany<T>(keys: string[]): Promise<Record<string, T>>;
}

export class ChromeStorageArea implements StorageArea {
  async get<T>(key: string): Promise<T | undefined> {
    const value = await chrome.storage.local.get(key);
    return value[key] as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(keys: string | string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
  }
  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return (await chrome.storage.local.get(keys)) as Record<string, T>;
  }
}
```

Persistir `{ schemaVersion: 1, settings }` em `cleanfeed.settings.v1`. Validar enums, inteiros, máximos, booleans e thresholds antes de gravar. Valor customizado de palavras deve ficar entre 50 e 5.000. `settingsVersion` é SHA-256 futuro; nesta fase usar contador inteiro incrementado em toda alteração relevante.

- [ ] **Step 4: Verificar testes**

Run: `npm test -- --run tests/unit/storage && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage tests/setup/chrome.ts tests/unit/storage
git commit -m "feat: persist and resolve validated settings"
```

---

### Task 4: Normalização, contagem, elegibilidade e SHA-256

**Files:**
- Create: `src/shared/text-normalization.ts`
- Create: `src/shared/word-count.ts`
- Create: `src/shared/hashing.ts`
- Create: `src/inference/eligibility.ts`
- Test: `tests/unit/text/text-normalization.test.ts`
- Test: `tests/unit/text/word-count.test.ts`
- Test: `tests/unit/text/eligibility.test.ts`
- Test: `tests/unit/text/hashing.test.ts`

**Interfaces:**
- Produces: `normalizeText(text): string`, `getTextLengthInfo(text): TextLengthInfo`, `sha256(text): Promise<string>`, `evaluateEligibility(input): EligibilityResult`.

- [ ] **Step 1: Criar matriz de casos de texto**

```typescript
it("normalizes whitespace but preserves accents, case, punctuation, emojis, URLs and hashtags", () => {
  expect(normalizeText("  Olá\u200B,   MUNDO!\r\n\r\n#IA https://exemplo.dev 😀  ")).toBe(
    "Olá, MUNDO!\n\n#IA https://exemplo.dev 😀",
  );
});

it.each([
  ["palavra ".repeat(49), "BELOW_MINIMUM_LENGTH"],
  [Array.from({ length: 100 }, (_, i) => `https://e.dev/${i}`).join(" "), "MOSTLY_LINKS"],
  [Array.from({ length: 100 }, (_, i) => `#tag${i}`).join(" "), "MOSTLY_HASHTAGS"],
  ["😀 ".repeat(100), "MOSTLY_EMOJIS"],
  [["Ana Silva", "Bruno Souza", "Carla Lima", "Daniel Costa", "Eva Rocha"].join("\n"), "INSUFFICIENT_CONTENT"],
])("rejects ineligible content", (text, reason) => {
  expect(evaluateEligibility(baseInput(text)).reason).toBe(reason);
});

it("allows 50-79 words only in experimental mode", () => {
  expect(evaluateEligibility(baseInput("texto ".repeat(60))).eligible).toBe(false);
  expect(
    evaluateEligibility({ ...baseInput("texto ".repeat(60)), experimentalShortTextDetection: true })
      .eligible,
  ).toBe(true);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/text`

Expected: FAIL por funções ausentes.

- [ ] **Step 3: Implementar funções puras e limites lineares**

```typescript
export function normalizeText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

Contar palavras com `Intl.Segmenter("pt", { granularity: "word" })` quando disponível e fallback Unicode `/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu`. Elegibilidade calcula proporções por tokens lexicais com uma única passagem e thresholds documentados: links >= 60%, hashtags >= 60%, emojis >= 60%. Considerar lista de nomes apenas quando houver pelo menos cinco linhas, 80% delas tiverem uma a quatro palavras title-case e não houver pontuação de frase; menus/erros/legendas são sinalizados pelo adapter ou como `INSUFFICIENT_CONTENT`. Rejeitar flags disabled/domain/model/extraction antes das heurísticas. Duplicação é informada pelo chamador via `duplicateContent`.

- [ ] **Step 4: Verificar determinismo e performance básica**

Run: `npm test -- --run tests/unit/text && npm run typecheck`

Expected: PASS; hash de entrada igual é igual e não inclui texto no retorno.

- [ ] **Step 5: Commit**

```powershell
git add src/shared src/inference/eligibility.ts tests/unit/text
git commit -m "feat: add private text preprocessing"
```

---

### Task 5: Classifier contract e MockClassifier determinístico

**Files:**
- Create: `src/inference/classifier-types.ts`
- Create: `src/inference/classifier.ts`
- Create: `src/inference/mock-classifier.ts`
- Test: `tests/unit/inference/mock-classifier.test.ts`

**Interfaces:**
- Consumes: `TextClassifier`, `ClassificationResult`, `ClassifierMetadata`.
- Produces: `MockClassifier(options?: MockClassifierOptions)` com latência, erro e AbortSignal.

- [ ] **Step 1: Testar determinismo, faixas, erro e cancelamento**

```typescript
describe("MockClassifier", () => {
  it("returns the same bounded score for the same normalized text", async () => {
    const classifier = new MockClassifier({ latencyMs: 0 });
    await classifier.initialize();
    const first = await classifier.classify("texto ".repeat(100));
    const second = await classifier.classify("texto ".repeat(100));
    expect(second.aiScore).toBe(first.aiScore);
    expect(first.aiScore).toBeGreaterThanOrEqual(0);
    expect(first.aiScore).toBeLessThanOrEqual(1);
    expect(first.backend).toBe("mock");
  });

  it("honors AbortSignal during simulated latency", async () => {
    const controller = new AbortController();
    const promise = new MockClassifier({ latencyMs: 100 }).classify("texto", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/mock-classifier.test.ts`

Expected: FAIL por classe ausente.

- [ ] **Step 3: Implementar score derivado dos primeiros 32 bits do SHA-256**

```typescript
const scoreFromHash = (hash: string): number => Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;

export interface MockClassifierOptions {
  latencyMs?: number;
  failureRate?: number;
}

export class MockClassifier implements TextClassifier {
  // initialize/dispose alteram estado; classify rejeita se não inicializado.
  // status usa as faixas globais e confidence permanece "low" por ser mock.
}
```

A simulação de erro também é determinística: comparar o segundo bloco do hash com `failureRate`; nunca usar `Math.random()`. Espera cancelável usa `setTimeout` mais listener `{ once: true }` e sempre remove listener/timer.

- [ ] **Step 4: Rodar todos os testes do classificador**

Run: `npm test -- --run tests/unit/inference/mock-classifier.test.ts`

Expected: PASS, inclusive com fake timers.

- [ ] **Step 5: Commit**

```powershell
git add src/inference tests/unit/inference/mock-classifier.test.ts
git commit -m "feat: add deterministic mock classifier"
```

---

### Task 6: Cache LRU/TTL e métricas agregadas

**Files:**
- Create: `src/storage/cache.ts`
- Create: `src/storage/metrics.ts`
- Test: `tests/unit/storage/cache.test.ts`
- Test: `tests/unit/storage/metrics.test.ts`

**Interfaces:**
- Consumes: `StorageArea`, `CachedClassification`, `AggregateMetrics`, `Clock`.
- Produces: `ClassificationCache.get/set/clear/prune`, `MetricsRepository.record/get/clear`.

- [ ] **Step 1: Testar hit/miss, TTL, LRU, versões e corrupção**

```typescript
it("expires and removes stale entries", async () => {
  await cache.set(key, result);
  clock.advanceBy(DEFAULT_SETTINGS.cacheTtlMs + 1);
  await expect(cache.get(key)).resolves.toBeUndefined();
  expect(await storage.get(`cleanfeed.cache.entry.${key}`)).toBeUndefined();
});

it("evicts least recently used entries", async () => {
  const cache = createCache({ maximumEntries: 2 });
  await cache.set("a", result);
  await cache.set("b", result);
  await cache.get("a");
  await cache.set("c", result);
  await expect(cache.get("b")).resolves.toBeUndefined();
});

it("invalidates model and settings versions via the key", () => {
  expect(buildCacheKey("linkedin", "m1", "s1", "hash")).toBe("linkedin:m1:s1:hash");
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/cache.test.ts tests/unit/storage/metrics.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar entradas separadas e índice compacto**

```typescript
interface CacheIndexEntry {
  key: string;
  lastAccessedAt: number;
  expiresAt: number;
}

const INDEX_KEY = "cleanfeed.cache.index.v1";
const entryKey = (key: string) => `cleanfeed.cache.entry.${key}`;
export const buildCacheKey = (platform: string, model: string, settings: string, hash: string) =>
  `${platform}:${model}:${settings}:${hash}`;
```

Validar `ClassificationResult` ao ler; remover entrada e índice se inválidos. Serializar mutações com uma promise chain interna para evitar duas podas concorrentes. Métricas guardam apenas contadores, histogramas de latência limitados e `resultsByStatus/backendUsage`; nenhum método aceita texto ou URL.

- [ ] **Step 4: Executar testes de storage**

Run: `npm test -- --run tests/unit/storage && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage tests/unit/storage
git commit -m "feat: add bounded cache and local metrics"
```

---

### Task 7: PlatformAdapter e adaptador resiliente do LinkedIn

**Files:**
- Create: `src/platforms/platform-adapter.ts`
- Create: `src/platforms/registry.ts`
- Create: `src/platforms/linkedin/selectors.ts`
- Create: `src/platforms/linkedin/extractor.ts`
- Create: `src/platforms/linkedin/linkedin-adapter.ts`
- Create: `src/platforms/linkedin/presenter.ts`
- Create: `tests/fixtures/linkedin-feed.html`
- Test: `tests/unit/platforms/linkedin-adapter.test.ts`

**Interfaces:**
- Produces: `LinkedInAdapter`, `PlatformRegistry.match(url)`, `extractLinkedInPost(element)`.
- Produces: fixture com todas as variantes descritas no pedido, marcada somente por IDs de teste.

- [ ] **Step 1: Criar fixture e testes de extração**

```typescript
it("extracts only the post commentary text", () => {
  const post = fixture.querySelector<HTMLElement>("[data-test-post='long']")!;
  const extracted = adapter.extractPost(post)!;
  expect(extracted.platform).toBe("linkedin");
  expect(extracted.text).toContain("parágrafo principal");
  expect(extracted.text).not.toMatch(/Curtir|Comentar|Compartilhar|Enviar|123 comentários/u);
});

it.each(["menu", "comment", "author", "error-banner"])("does not treat %s as a post", (id) => {
  const element = fixture.querySelector<HTMLElement>(`[data-test-node='${id}']`)!;
  expect(adapter.isPostElement(element)).toBe(false);
});

it("supports sponsored, reposted and expanded variants without duplicating text", () => {
  for (const id of ["sponsored", "repost", "expanded"]) {
    const result = adapter.extractPost(getPost(id));
    expect(result?.text.length).toBeGreaterThan(0);
    expect(new Set(result?.text.split("\n\n")).size).toBe(result?.text.split("\n\n").length);
  }
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/platforms/linkedin-adapter.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar seletores alternativos e limpeza por clone**

```typescript
export const LINKEDIN_SELECTORS = {
  feedRoots: ["main", "[role='main']", ".scaffold-finite-scroll__content"],
  posts: ["article", "[data-urn^='urn:li:activity:']", ".feed-shared-update-v2"],
  commentary: ["[data-test-id='main-feed-activity-card__commentary']", ".update-components-text"],
  uiNoise: ["button", "nav", "[role='menu']", "[aria-label*='reaction']", "time"],
} as const;
```

`findPostElements` coleta candidatos de todos os seletores, deduplica por identidade e exige sinais estruturais: corpo textual + região de ações, sem estar dentro de comentário/menu. `extractor.ts` clona somente a região de commentary, remove `uiNoise`, usa `textContent`, normaliza parágrafos e nunca lê links de perfil. Post ID pode vir de `data-urn`, mas somente o hash do texto é persistido; documentar que o ID fica em memória e é opcional.

- [ ] **Step 4: Testar fixture inteira**

Run: `npm test -- --run tests/unit/platforms && npm run typecheck`

Expected: PASS para curto, 100 palavras, longo, múltiplos parágrafos, emojis, links, patrocinado, repost, expandido, removido/reinserido, botões, contadores, comentários, falso positivo estilístico e texto formal humano. As duas últimas fixtures validam extração/apresentação, não qualidade científica do mock.

- [ ] **Step 5: Commit**

```powershell
git add src/platforms tests/fixtures/linkedin-feed.html tests/unit/platforms
git commit -m "feat: extract LinkedIn posts through an adapter"
```

---

### Task 8: IntersectionObserver e MutationObserver protegidos

**Files:**
- Create: `src/content/observers/intersection-observer.ts`
- Create: `src/content/observers/mutation-observer.ts`
- Test: `tests/unit/content/intersection-observer.test.ts`
- Test: `tests/unit/content/mutation-observer.test.ts`

**Interfaces:**
- Produces: `createPostIntersectionObserver(callback)`, `createFeedMutationObserver(root, callback)`.
- Consumes: HTMLElements identificados pelo adapter; não extrai texto.

- [ ] **Step 1: Testar configuração, cancelamento, debounce e deduplicação**

```typescript
it("uses the required viewport margin", () => {
  createPostIntersectionObserver(onChange);
  expect(MockIntersectionObserver.lastOptions).toEqual({
    root: null,
    rootMargin: "500px",
    threshold: 0.01,
  });
});

it("batches mutations and ignores CleanFeed-owned nodes", async () => {
  const observer = createFeedMutationObserver(root, onCandidates, { debounceMs: 50 });
  observer.handle([mutationWith(post), mutationWith(post), mutationWith(cleanFeedBadge)]);
  await vi.advanceTimersByTimeAsync(50);
  expect(onCandidates).toHaveBeenCalledWith([post]);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/content/intersection-observer.test.ts tests/unit/content/mutation-observer.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar observers com cleanup explícito**

O wrapper de IntersectionObserver retorna `{ observe, unobserve, disconnect }` e traduz entries para `{ element, nearViewport }`. O MutationObserver usa somente `{ childList: true, subtree: true }` no feed root, nunca `attributes` ou `characterData`; coleta `addedNodes` HTMLElement, ignora `[data-cleanfeed-owned]`, agrupa em `Set` e limita callbacks a um lote a cada 100 ms.

```typescript
export const CLEANFEED_ATTRIBUTES = {
  state: "data-cleanfeed-state",
  hash: "data-cleanfeed-hash",
  version: "data-cleanfeed-version",
  owned: "data-cleanfeed-owned",
} as const;
```

- [ ] **Step 4: Rodar testes com fake timers**

Run: `npm test -- --run tests/unit/content && npm run typecheck`

Expected: PASS; `disconnect()` limpa timer pendente.

- [ ] **Step 5: Commit**

```powershell
git add src/content/observers src/shared/constants.ts tests/unit/content
git commit -m "feat: observe visible feed posts safely"
```

---

### Task 9: Offscreen document, worker mock e roteamento com cache

**Files:**
- Create: `src/background/offscreen-manager.ts`
- Create: `src/background/message-router.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/offscreen/offscreen.ts`
- Create: `src/offscreen/worker-host.ts`
- Create: `src/inference/worker-protocol.ts`
- Create: `src/inference/inference-worker.ts`
- Test: `tests/unit/background/offscreen-manager.test.ts`
- Test: `tests/integration/mock-worker-flow.test.ts`

**Interfaces:**
- Produces: `ensureOffscreenDocument(): Promise<void>`, `classifyThroughWorker(request): Promise<ClassificationResult>`.
- Consumes: `CLASSIFY_TEXT` validado; consulta cache antes de encaminhar.

- [ ] **Step 1: Testar criação única e round trip**

```typescript
it("creates one offscreen document with WORKERS reason", async () => {
  chrome.runtime.getContexts.mockResolvedValue([]);
  await Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]);
  expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
  expect(chrome.offscreen.createDocument).toHaveBeenCalledWith({
    url: "src/offscreen/offscreen.html",
    reasons: ["WORKERS"],
    justification: "Executar classificação local fora da thread da página.",
  });
});

it("returns cached results without posting to the worker", async () => {
  cache.get.mockResolvedValue(cached.result);
  const result = await router.handle(classifyMessage, sender);
  expect(result.payload).toEqual(cached.result);
  expect(offscreenClient.classify).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/background/offscreen-manager.test.ts tests/integration/mock-worker-flow.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar lifecycle, envelope direcionado e Dedicated Worker**

```typescript
let creating: Promise<void> | undefined;

export async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL("src/offscreen/offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Executar classificação local fora da thread da página.",
    })
    .finally(() => { creating = undefined; });
  await creating;
}
```

`worker-host.ts` cria `new Worker(new URL("../inference/inference-worker.ts", import.meta.url), { type: "module" })`, mantém `Map<requestId, resolver>` e rejeita todas as pendências em `worker.onerror`. O worker inicializa uma única instância de `MockClassifier`, valida `WorkerRequest`, responde com `WorkerResponse` e nunca toca DOM/storage/chrome APIs. O router cria cache key a partir de platform/model/settings/hash, registra hit/miss e só grava resultados válidos.

- [ ] **Step 4: Verificar fluxo isolado**

Run: `npm test -- --run tests/unit/background tests/integration/mock-worker-flow.test.ts && npm run build`

Expected: PASS; bundle de worker separado no `dist`; nenhuma importação de React no worker.

- [ ] **Step 5: Commit**

```powershell
git add src/background src/offscreen src/inference tests/unit/background tests/integration/mock-worker-flow.test.ts
git commit -m "feat: classify through an offscreen worker"
```

---

### Task 10: PostController, selo reversível e PageStats

**Files:**
- Create: `src/content/post-controller.ts`
- Create: `src/content/page-stats.ts`
- Create: `src/content/session-state.ts`
- Create: `src/content/presentation/badge.ts`
- Create: `src/content/presentation/restore.ts`
- Modify: `src/content/content-script.ts`
- Modify: `src/platforms/linkedin/presenter.ts`
- Modify: `src/styles/injected.css`
- Test: `tests/integration/content-pipeline.test.ts`
- Test: `tests/unit/content/badge.test.ts`

**Interfaces:**
- Produces: `PostController.start/stop/clearPresentation`, `PageStatsStore.snapshot`, `applyBadge`, `restorePresentation`.
- Consumes: adapter, settings, eligibility, hash, observers e `chrome.runtime.sendMessage`.

- [ ] **Step 1: Testar pipeline visível e reversão idempotente**

```typescript
it("classifies an eligible visible post once and applies probabilistic copy", async () => {
  controller.start();
  intersection.emit(post, true);
  await flushPromises();
  expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(post.querySelector("[data-cleanfeed-owned='badge']")?.textContent).toMatch(
    /Provavelmente escrito por uma pessoa|Resultado inconclusivo|Possivelmente gerado por IA|Fortes indícios/u,
  );
  expect(post.getAttribute("data-cleanfeed-state")).toBe("classified");
});

it("explains why a short post was skipped without classifying it", async () => {
  intersection.emit(shortPost, true);
  await flushPromises();
  expect(runtime.sendMessage).not.toHaveBeenCalled();
  expect(shortPost.dataset.cleanfeedState).toBe("below-minimum-length");
});

it("restores only nodes and classes owned by CleanFeed", () => {
  const original = post.textContent;
  applyBadge(post, result, settings);
  restorePresentation(post);
  restorePresentation(post);
  expect(post.textContent).toBe(original);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/integration/content-pipeline.test.ts tests/unit/content/badge.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar estado por elemento e orquestração**

Usar `WeakMap<HTMLElement, PostRuntimeState>` para controllers/abort flags e atributos somente para depuração/deduplicação. Fluxo: extract → normalize → word count/eligibility → SHA-256 → duplicate check de sessão → message → verificar `element.isConnected` e hash atual → present. Ao sair da viewport, cancelar se status `queued`; nesta fase, request em execução pode terminar, mas resultado não é aplicado se desconectado.

```typescript
export interface PageStats {
  platform: string | null;
  postsFound: number;
  analyzed: number;
  skippedByLength: number;
  skippedByLanguage: number;
  marked: number;
  blurred: number;
  collapsed: number;
  hidden: number;
  restored: number;
  averageInferenceMs: number;
  queueSize: number;
}
```

Badge é `button` para abrir explicação futura, inclui texto + ícone, `aria-label`, foco visível, e não mostra score por default. Classes começam com `cleanfeed-`; CSS respeita `prefers-reduced-motion`.

- [ ] **Step 4: Executar integração completa com fixture**

Run: `npm test -- --run tests/unit/content tests/integration/content-pipeline.test.ts && npm run typecheck`

Expected: PASS; posts invisíveis geram zero mensagens.

- [ ] **Step 5: Commit**

```powershell
git add src/content src/platforms/linkedin/presenter.ts src/styles/injected.css tests/unit/content tests/integration/content-pipeline.test.ts
git commit -m "feat: classify and label visible LinkedIn posts"
```

---

### Task 11: Popup, opções básicas, documentação e portão da Fase 1

**Files:**
- Modify: `src/popup/App.tsx`
- Create: `src/popup/components/DemoWarning.tsx`
- Create: `src/popup/components/PageStatsSummary.tsx`
- Modify: `src/options/App.tsx`
- Create: `src/options/components/GeneralSettings.tsx`
- Create: `src/options/components/PrivacyNotice.tsx`
- Modify: `src/background/message-router.ts`
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/privacy.md`
- Create: `docs/limitations.md`
- Test: `tests/unit/popup/App.test.tsx`
- Test: `tests/unit/options/App.test.tsx`
- Test: `tests/integration/phase-1-acceptance.test.ts`

**Interfaces:**
- Consumes: `GET_PAGE_STATS`, `GET_SETTINGS`, `UPDATE_SETTINGS`, `MODEL_STATUS_REQUEST`.
- Produces: controles básicos de enabled, minimum words, language, indicator/blur preference e aviso mock.

- [ ] **Step 1: Escrever testes de UI acessível e linguagem honesta**

```tsx
it("shows the mock warning and page counters", async () => {
  render(<App api={fakePopupApi({ backend: "mock", postsFound: 4, analyzed: 2 })} />);
  expect(
    await screen.findByText("Modo de demonstração: nenhum modelo real está sendo utilizado."),
  ).toBeVisible();
  expect(screen.getByText(/2 analisadas/u)).toBeVisible();
});

it("persists a valid minimum word count", async () => {
  const api = fakeOptionsApi(DEFAULT_SETTINGS);
  render(<OptionsApp api={api} />);
  await userEvent.selectOptions(screen.getByLabelText("Mínimo de palavras"), "150");
  expect(api.updateSettings).toHaveBeenCalledWith({ minimumWordCount: 150 });
});

it("contains no definitive authorship claim", () => {
  expect(document.body.textContent).not.toMatch(/foi escrito por IA|comprovadamente artificial/u);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/popup tests/unit/options tests/integration/phase-1-acceptance.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar APIs de UI e conteúdo documental da fase**

Popup consulta a tab ativa, envia `GET_PAGE_STATS`, mostra domínio sem URL/path, plataforma, encontrados/analisados/ignorados/marcados, latência, fila, modelo/backend/status; botões abrem options e limpam apresentação. Opções gerais validam antes de enviar e exibem privacidade local, textos curtos ignorados e falsos positivos/negativos. Não expor scores numéricos no fluxo default.

README nesta fase contém instalação (`npm ci`, `npm run build`, Load unpacked apontando para `dist`), desenvolvimento, testes, build, permissões, arquitetura, privacidade, cache, worker e limitação do mock. `architecture.md` inclui o diagrama do master; `limitations.md` registra fragilidade do DOM e ausência de detector real.

- [ ] **Step 4: Executar o portão completo da fase**

Run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Expected: todos exit 0; `dist/manifest.json` contém somente permissões aprovadas; o relatório manual confirma carregamento sem erro no `chrome://extensions` e aviso mock visível.

- [ ] **Step 5: Registrar relatório e commit**

Criar `docs/phase-reports/phase-1.md` com comandos/resultados, limitações e falhas pendentes observadas.

```powershell
git add src README.md docs tests
git commit -m "feat: complete the functional foundation"
```

## Phase 1 Exit Criteria

- Extensão carrega em Chrome 116+.
- Feed fixture e LinkedIn real detectam apenas candidatos estruturais.
- Post abaixo do mínimo não é enviado ao worker.
- Post visível elegível recebe exatamente uma classificação mock e um selo reversível.
- Cache impede segunda inferência do mesmo hash/config/modelo.
- Popup e opções respondem sem acesso a texto/autor.
- Todo resultado mostra linguagem probabilística e aviso mock.
- Testes, typecheck, lint e build estão verdes; limitações reais foram registradas.
