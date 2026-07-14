# CleanFeed AI Phase 2 — Local Inference Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o worker mock da Fase 1 em um pipeline local completo com idioma, tokens, chunks, agregação, calibração, abstenção, fila priorizada, cancelamento, timeout e rastreamento de performance.

**Architecture:** O offscreen document é dono da fila e do registry de tarefas; o Dedicated Worker é dono dos classificadores e de todo processamento textual posterior ao hash. Mensagens de cancelamento usam `requestId`, pois `AbortSignal` não é transferível entre contextos.

**Tech Stack:** TypeScript, Web Worker, `Intl.Segmenter`, Performance API, Vitest, fake timers e Chrome runtime messaging.

## Global Constraints

- Aplicam-se o [plano mestre](./2026-07-14-cleanfeed-ai-master.md) e os contratos fechados na Fase 1.
- A tokenização heurística desta fase é marcada `exact: false`; somente a Fase 3 fornece tokens exatos do modelo.
- Nenhum texto sai do worker, exceto como parte do request local; respostas não repetem o texto.
- Um bloco isolado de score alto não pode, sozinho, causar ação agressiva.

---

### Task 12: Detecção leve de português e política de idioma

**Files:**
- Create: `src/inference/language-detector.ts`
- Test: `tests/unit/inference/language-detector.test.ts`

**Interfaces:**
- Produces: `LanguageDetector.detect(text): Promise<LanguageDetectionResult>`.
- Produces: `HeuristicPortugueseDetector` e `evaluateLanguagePolicy(result, mode, supportedLanguages)`.

- [ ] **Step 1: Escrever testes com português, inglês, misto e conteúdo insuficiente**

```typescript
describe("HeuristicPortugueseDetector", () => {
  it("recognizes long Portuguese prose with confidence", async () => {
    const result = await detector.detect(PORTUGUESE_FIXTURE);
    expect(result.language).toBe("pt");
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result.supported).toBe(true);
  });

  it("does not claim a language for insufficient lexical evidence", async () => {
    await expect(detector.detect("OK 😀")).resolves.toEqual({
      language: "und",
      confidence: 0,
      supported: false,
    });
  });

  it("lets experimental mode continue with a low-confidence language", () => {
    expect(
      evaluateLanguagePolicy(
        { language: "und", confidence: 0.2, supported: false },
        "experimental_any",
        ["pt"],
      ),
    ).toEqual({ allowed: true, abstain: false });
  });
});
```

- [ ] **Step 2: Executar e confirmar RED**

Run: `npm test -- --run tests/unit/inference/language-detector.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar detector linear e explícito**

Tokenizar palavras com o utilitário da Fase 1. Calcular sinais somente sobre até 2.000 palavras: stopwords portuguesas, combinações de caracteres (`ção`, `ões`, `nh`, `lh`), diacríticos e penalidade por stopwords inglesas/espanholas. Normalizar a pontuação por quantidade de palavras e limitar `[0, 1]`; abaixo de 20 tokens lexicais, retornar `und`.

```typescript
export interface LanguagePolicyDecision {
  allowed: boolean;
  abstain: boolean;
  reason?: "UNSUPPORTED_LANGUAGE" | "LOW_LANGUAGE_CONFIDENCE";
}

export function evaluateLanguagePolicy(
  detection: LanguageDetectionResult,
  mode: LanguageMode,
  supportedLanguages: string[],
): LanguagePolicyDecision;
```

`portuguese_only` exige `pt` e confiança >= 0,65. `model_supported` exige língua listada e confiança >= 0,65. `experimental_any` permite continuar, mas mantém a língua detectada no trace.

- [ ] **Step 4: Verificar testes e ausência de dependência pesada**

Run: `npm test -- --run tests/unit/inference/language-detector.test.ts && npm run typecheck`

Expected: PASS; bundle do detector não importa Transformers.js.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/language-detector.ts tests/unit/inference/language-detector.test.ts
git commit -m "feat: add lightweight Portuguese detection"
```

---

### Task 13: Tokenizer abstraction e tokenização heurística

**Files:**
- Create: `src/inference/tokenizer.ts`
- Test: `tests/unit/inference/tokenizer.test.ts`

**Interfaces:**
- Produces: `Tokenizer`, `TokenizedText`, `TokenSpan` e `HeuristicTokenizer`.
- Later consumer: chunker usa offsets, não IDs específicos do modelo.

- [ ] **Step 1: Testar offsets, Unicode, espaços e natureza aproximada**

```typescript
it("returns ordered spans that reconstruct source slices", async () => {
  const source = "Olá, mundo! #CleanFeed 😀";
  const tokenized = await tokenizer.encode(source);
  expect(tokenized.exact).toBe(false);
  expect(tokenized.spans.map((span) => source.slice(span.start, span.end))).toEqual([
    "Olá",
    ",",
    "mundo",
    "!",
    "#",
    "CleanFeed",
    "😀",
  ]);
  expect(tokenized.spans.every((span, index, all) => index === 0 || span.start >= all[index - 1].end))
    .toBe(true);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/tokenizer.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar interface substituível**

```typescript
export interface TokenSpan {
  id: number;
  start: number;
  end: number;
}

export interface TokenizedText {
  spans: TokenSpan[];
  tokenCount: number;
  exact: boolean;
}

export interface Tokenizer {
  readonly id: string;
  encode(text: string, signal?: AbortSignal): Promise<TokenizedText>;
}
```

O `HeuristicTokenizer` usa regex Unicode para palavras, pontuação e emoji. IDs são hashes FNV-1a de cada fatia e servem apenas aos testes/mock; offsets preservam o texto original. Verificar `signal.aborted` a cada 256 matches para permitir cancelamento de entradas grandes.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/inference/tokenizer.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/tokenizer.ts tests/unit/inference/tokenizer.test.ts
git commit -m "feat: add replaceable tokenization contracts"
```

---

### Task 14: Chunking com overlap e preservação do texto

**Files:**
- Create: `src/inference/chunker.ts`
- Test: `tests/unit/inference/chunker.test.ts`

**Interfaces:**
- Consumes: `TokenizedText` e texto original.
- Produces: `createTextChunks(text, tokenized, options): TextChunk[]`.

- [ ] **Step 1: Escrever testes de limite, overlap e ordem**

```typescript
it("keeps a short text in one non-empty chunk", () => {
  expect(createTextChunks(textOfTokens(10), tokens(10), options)).toEqual([
    expect.objectContaining({ index: 0, startToken: 0, endToken: 10 }),
  ]);
});

it("creates 192-token chunks with 32-token overlap", () => {
  const chunks = createTextChunks(textOfTokens(400), tokens(400), {
    chunkSizeTokens: 192,
    overlapTokens: 32,
    maximumTokens: 256,
  });
  expect(chunks.map(({ startToken, endToken }) => [startToken, endToken])).toEqual([
    [0, 192],
    [160, 352],
    [320, 400],
  ]);
  expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true);
});

it("rejects overlap equal to chunk size", () => {
  expect(() => createTextChunks("x", tokens(1), { ...options, overlapTokens: 192 })).toThrow(
    "INVALID_SETTINGS",
  );
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/chunker.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar janela deslizante sem truncamento silencioso**

O `endToken` é exclusivo. O texto de cada chunk vai de `spans[start].start` a `spans[end - 1].end`; espaços externos são removidos, mas offsets de token não mudam. Se o texto tiver zero tokens, retornar `[]`. Validar `1 <= chunkSizeTokens <= maximumTokens <= 256` e `0 <= overlap < chunkSize`.

```typescript
const step = options.chunkSizeTokens - options.overlapTokens;
for (let start = 0, index = 0; start < spans.length; start += step, index += 1) {
  const end = Math.min(start + options.chunkSizeTokens, spans.length);
  chunks.push({ index, startToken: start, endToken: end, text: sliceBySpans(text, spans, start, end) });
  if (end === spans.length) break;
}
```

- [ ] **Step 4: Executar testes**

Run: `npm test -- --run tests/unit/inference/chunker.test.ts`

Expected: PASS para vazio, pequeno, exato, grande e Unicode.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/chunker.ts tests/unit/inference/chunker.test.ts
git commit -m "feat: chunk long text without silent truncation"
```

---

### Task 15: Agregação robusta de chunks

**Files:**
- Create: `src/inference/aggregator.ts`
- Test: `tests/unit/inference/aggregator.test.ts`

**Interfaces:**
- Produces: `aggregateChunkResults(chunks, highThreshold): AggregationResult`.

- [ ] **Step 1: Fixar todos os cenários matemáticos**

```typescript
it.each([
  [[0.1, 0.2, 0.3], "low"],
  [[0.9, 0.92, 0.95], "high"],
  [[0.1, 0.1, 0.99], "isolated-high"],
  [[0.1, 0.9, 0.2, 0.8], "divergent"],
])("aggregates %j (%s) within bounds", (scores) => {
  const result = aggregateChunkResults(makeChunks(scores), 0.8);
  expect(result.finalScore).toBeGreaterThanOrEqual(0);
  expect(result.finalScore).toBeLessThanOrEqual(1);
  expect(result.minimum).toBe(Math.min(...scores));
  expect(result.maximum).toBe(Math.max(...scores));
});

it("does not let one tiny high chunk dominate", () => {
  const result = aggregateChunkResults(
    [chunk(0.1, 192), chunk(0.12, 192), chunk(0.99, 8)],
    0.8,
  );
  expect(result.finalScore).toBeLessThan(0.4);
});

it("uses the specified formula", () => {
  const result = aggregateChunkResults(makeChunks([0.8, 0.9]), 0.8);
  expect(result.finalScore).toBeCloseTo(
    0.5 * result.weightedMean + 0.25 * result.median + 0.15 * result.highScoreRatio +
      0.1 * result.maximum,
  );
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/aggregator.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar estatísticas puras**

Peso de chunk é `endToken - startToken`; sobreposição não deve inflar o peso da cauda, então limitar peso efetivo a `index === 0 ? length : min(length, startToken - previous.startToken)`. Mediana usa cópia ordenada. `chunkAgreement = clamp(1 - standardDeviation / 0.5)`. Entrada vazia lança `INSUFFICIENT_EVIDENCE`; NaN ou scores fora de `[0,1]` lançam `INFERENCE_FAILED`.

- [ ] **Step 4: Rodar testes matemáticos**

Run: `npm test -- --run tests/unit/inference/aggregator.test.ts && npm run typecheck`

Expected: PASS com tolerância `toBeCloseTo(..., 8)`.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/aggregator.ts tests/unit/inference/aggregator.test.ts
git commit -m "feat: aggregate chunk scores conservatively"
```

---

### Task 16: Calibração, decisão, abstenção e explicações verdadeiras

**Files:**
- Create: `src/inference/calibration.ts`
- Create: `src/inference/explanation.ts`
- Test: `tests/unit/inference/calibration.test.ts`
- Test: `tests/unit/inference/explanation.test.ts`

**Interfaces:**
- Produces: `getLengthBucket`, `resolveCalibrationProfile`, `calibrateResult`, `buildExplanation`.
- Produces: `DecisionOutcome` com `status`, `actionCeiling`, `abstained`, `reasonCodes`.

- [ ] **Step 1: Testar buckets, thresholds, abstenção e divergência**

```typescript
it.each([
  [50, "50_79"], [79, "50_79"], [80, "80_99"], [99, "80_99"],
  [100, "100_149"], [149, "100_149"], [150, "150_299"], [300, "300_PLUS"],
])("maps %i words to %s", (count, bucket) => expect(getLengthBucket(count)).toBe(bucket));

it("caps aggressive action for 100-149 words", () => {
  const outcome = calibrateResult(baseResult({ wordCount: 120, aiScore: 0.999 }));
  expect(outcome.actionCeiling).toBe("blur");
});

it("abstains on unsupported language and chunk disagreement", () => {
  const outcome = calibrateResult(
    baseResult({
      language: "und",
      aggregation: { ...aggregation, standardDeviation: 0.4, chunkAgreement: 0.2 },
    }),
  );
  expect(outcome.status).toBe("insufficient_evidence");
  expect(outcome.reasonCodes).toContain("CHUNK_DISAGREEMENT");
});

it("never invents stylistic reasons", () => {
  expect(buildExplanation(outcome).reasonCodes).not.toContain("FORMULAIC_STRUCTURE");
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/calibration.test.ts tests/unit/inference/explanation.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar perfis conservadores e reasons derivados**

Perfis default:

```typescript
const LENGTH_THRESHOLDS = {
  "50_79": { marking: 0.92, blur: 0.97, collapse: 1, hide: 1, actionCeiling: "indicator" },
  "80_99": { marking: 0.88, blur: 0.95, collapse: 1, hide: 1, actionCeiling: "blur" },
  "100_149": { marking: 0.8, blur: 0.92, collapse: 1, hide: 1, actionCeiling: "blur" },
  "150_299": { marking: 0.8, blur: 0.92, collapse: 0.96, hide: 0.99, actionCeiling: "hide" },
  "300_PLUS": { marking: 0.8, blur: 0.92, collapse: 0.96, hide: 0.99, actionCeiling: "hide" },
} as const;
```

Abster por: idioma não permitido/baixa confiança, erro de tokenizer/modelo/timeout, `chunkAgreement < 0.5`, `standardDeviation > 0.25`, diferença `abs(aiScore-humanScore) < 0.1` ou confiança low. Exceção explícita: backend `mock` pode simular faixas apesar de confidence baixa, mas resultado permanece `demo: true` e nunca é tratado como modelo real.

Reasons calculáveis nesta fase: consistência, maioria de chunks, média alta, mediana alta, evidência insuficiente, baixa confiança e divergência. Reasons estilísticos só entram quando uma função determinística correspondente existir e tiver teste.

- [ ] **Step 4: Rodar testes e validar mensagens de UI**

Run: `npm test -- --run tests/unit/inference/calibration.test.ts tests/unit/inference/explanation.test.ts`

Expected: PASS; toda abstenção tem `INSUFFICIENT_EVIDENCE`.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/calibration.ts src/inference/explanation.ts tests/unit/inference
git commit -m "feat: calibrate and abstain conservatively"
```

---

### Task 17: PriorityQueue, task registry e rate limiting

**Files:**
- Create: `src/queue/priority-queue.ts`
- Create: `src/queue/task-registry.ts`
- Create: `src/queue/inference-queue.ts`
- Test: `tests/unit/queue/priority-queue.test.ts`
- Test: `tests/unit/queue/inference-queue.test.ts`

**Interfaces:**
- Produces: `InferenceQueue.enqueue/cancel/stats/dispose`, `TaskRegistry`.
- Consumes: tasks com `manual`, `visibility`, `distancePx`, `createdAt`, `expiresAt`.

- [ ] **Step 1: Testar prioridade, dedupe, expiração, limite e concorrência**

```typescript
it("orders manual before visible before near viewport", async () => {
  queue.enqueue(task("near", { visibility: "near" }));
  queue.enqueue(task("visible", { visibility: "visible" }));
  queue.enqueue(task("manual", { manual: true }));
  expect(queue.pendingIds()).toEqual(["manual", "visible", "near"]);
});

it("deduplicates by text hash and fans out the result", async () => {
  const first = queue.enqueue(task("a", { textHash: "same" }));
  const second = queue.enqueue(task("b", { textHash: "same" }));
  await runner.resolveNext(result);
  await expect(Promise.all([first, second])).resolves.toEqual([result, result]);
  expect(runner.run).toHaveBeenCalledTimes(1);
});

it("never exceeds maximum size and evicts the lowest priority pending task", () => {
  const queue = createQueue({ maximumSize: 2 });
  queue.enqueue(lowTask);
  queue.enqueue(mediumTask);
  queue.enqueue(manualTask);
  expect(queue.size).toBe(2);
  expect(queue.has(lowTask.id)).toBe(false);
});

it("runs one task at a time on WASM", async () => {
  const queue = createQueue({ concurrency: 1 });
  queue.enqueue(task("a")); queue.enqueue(task("b"));
  expect(runner.activeCount).toBe(1);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/queue`

Expected: FAIL.

- [ ] **Step 3: Implementar heap estável e lifecycle de tarefa**

Prioridade base: manual 1.000, visível 100, near 50; desempate por `createdAt` (mais antigo primeiro). Recalcular aging apenas quando retirar do heap, sem timer contínuo. Estados discriminados: `queued`, `running`, `completed`, `cancelled`, `expired`, `failed`. Dedupe só ocorre quando hash/model/settings/platform são iguais. Rate limiter deslizante mantém timestamps por platform e rejeita/adianta além de 30 posts/min.

Cancelamento queued remove/ignora no heap e rejeita com `AbortError`; running chama callback `cancelRunner(requestId)`. `dispose` cancela tudo e limpa timers.

- [ ] **Step 4: Rodar suíte de fila com fake timers**

Run: `npm test -- --run tests/unit/queue && npm run typecheck`

Expected: PASS para serial e concurrency 2; nenhuma promise pendente ao final.

- [ ] **Step 5: Commit**

```powershell
git add src/queue tests/unit/queue
git commit -m "feat: add bounded priority inference queue"
```

---

### Task 18: Pipeline completo no worker e protocolo de cancelamento

**Files:**
- Modify: `src/inference/worker-protocol.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/offscreen/worker-host.ts`
- Modify: `src/offscreen/offscreen.ts`
- Modify: `src/background/message-router.ts`
- Test: `tests/integration/inference-pipeline.test.ts`
- Test: `tests/integration/cancellation-timeout.test.ts`

**Interfaces:**
- Produces: `PipelineRunner.classify`, worker messages `INITIALIZE`, `CLASSIFY`, `CANCEL`, `DISPOSE`, `STATUS`.
- Consumes: settings snapshot por request; não lê storage no worker.

- [ ] **Step 1: Escrever teste end-to-end do pipeline e cancelamento**

```typescript
it("runs language, tokenization, chunks, classification, aggregation and calibration", async () => {
  const result = await harness.classify(PORTUGUESE_LONG_TEXT, settings);
  expect(result.language).toBe("pt");
  expect(result.tokenCount).toBeGreaterThan(192);
  expect(result.chunks!.length).toBeGreaterThan(1);
  expect(result.aggregation).toBeDefined();
  expect(result.explanation?.calibrationProfile).toMatch(/linkedin:pt:/u);
  expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
});

it("cancels a queued or running request by requestId", async () => {
  const promise = harness.classify(PORTUGUESE_LONG_TEXT, slowSettings, "r-cancel");
  harness.cancel("r-cancel");
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(harness.stats().cancelledTasks).toBe(1);
});

it("batches only when the classifier declares support", async () => {
  classifier.getMetadata.mockReturnValue({ ...metadata, supportsBatching: true });
  await Promise.all([
    harness.classify(PORTUGUESE_TEXT_A, { ...settings, batchingEnabled: true }),
    harness.classify(PORTUGUESE_TEXT_B, { ...settings, batchingEnabled: true }),
  ]);
  expect(classifier.classifyBatch).toHaveBeenCalledOnce();
});

it("converts timeout into a recoverable classification failure", async () => {
  const result = await harness.classify(PORTUGUESE_LONG_TEXT, { ...settings, inferenceTimeoutMs: 1 });
  expect(result.status).toBe("classification_failed");
  expect(result.errorCode).toBe("INFERENCE_TIMEOUT");
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/integration/inference-pipeline.test.ts tests/integration/cancellation-timeout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar PipelineRunner e mensagens discriminadas**

Dentro do worker, `Map<requestId, AbortController>` controla jobs. A ordem exata é idioma → policy → tokenizer → chunks → classificar cada chunk com o mesmo signal → aggregation → calibration → explanation. Medir cada etapa com `performance.now()` e nunca incluir texto em logs/respostas.

```typescript
export type WorkerRequest =
  | { type: "INITIALIZE"; requestId: string; payload: WorkerInitializePayload }
  | { type: "CLASSIFY"; requestId: string; payload: WorkerClassifyPayload }
  | { type: "CANCEL"; requestId: string; payload: null }
  | { type: "STATUS"; requestId: string; payload: null }
  | { type: "DISPOSE"; requestId: string; payload: null };

export type WorkerResponse =
  | { type: "RESULT"; requestId: string; payload: ClassificationResult }
  | { type: "STATUS"; requestId: string; payload: ModelStatus }
  | { type: "CANCELLED"; requestId: string; payload: null }
  | { type: "ERROR"; requestId: string; payload: SerializedCleanFeedError };
```

Offscreen enfileira antes de postar ao worker, aplica timeout por tarefa e envia `CANCEL` quando expira. Quando `batchingEnabled` e `supportsBatching` forem verdadeiros, agrupar no máximo oito tarefas compatíveis durante uma janela de 10 ms e chamar `BatchTextClassifier.classifyBatch`; caso contrário, processar individualmente sem mudar a ordem das respostas. Resultados de elementos que saíram da viewport podem alimentar cache, mas o content script não aplica apresentação se o hash/elemento já não forem atuais.

- [ ] **Step 4: Verificar integrações e build**

Run: `npm test -- --run tests/integration/inference-pipeline.test.ts tests/integration/cancellation-timeout.test.ts && npm run build`

Expected: PASS; erro do worker é serializado e não produz unhandled rejection.

- [ ] **Step 5: Commit**

```powershell
git add src/inference src/offscreen src/background tests/integration
git commit -m "feat: run the complete local inference pipeline"
```

---

### Task 19: Model status, PerformanceTrace, UI e portão da Fase 2

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/storage/metrics.ts`
- Modify: `src/content/page-stats.ts`
- Modify: `src/popup/App.tsx`
- Modify: `src/options/App.tsx`
- Create: `src/options/components/PerformanceSettings.tsx`
- Create: `docs/inference-pipeline.md`
- Test: `tests/unit/storage/performance-metrics.test.ts`
- Test: `tests/unit/popup/model-status.test.tsx`
- Test: `tests/integration/phase-2-acceptance.test.ts`

**Interfaces:**
- Produces: `ModelStatus` (`unavailable|initializing|ready|error`), queue stats e traces de debug.
- Consumes: `MODEL_STATUS_REQUEST/RESULT`, `GET_PAGE_STATS`.

- [ ] **Step 1: Testar agregação de métricas e visibilidade de status**

```typescript
it("stores aggregate latency without storing traces or text by default", async () => {
  await metrics.recordInference(trace, "mock", "possibly_ai");
  const stored = await storage.dump();
  expect(stored).not.toHaveProperty("text");
  expect(JSON.stringify(stored)).not.toContain(PORTUGUESE_LONG_TEXT.slice(0, 30));
  expect((await metrics.get()).averageInferenceMs).toBe(trace.totalMs);
});

it("shows queue size, model version, backend and readiness", async () => {
  render(<App api={fakePopupApi({ queueSize: 3, backend: "mock", state: "ready" })} />);
  expect(await screen.findByText(/Fila: 3/u)).toBeVisible();
  expect(screen.getByText(/Backend: mock/u)).toBeVisible();
  expect(screen.getByText(/Estado: pronto/u)).toBeVisible();
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/storage/performance-metrics.test.ts tests/unit/popup/model-status.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Completar status, debug opt-in e opções de performance**

Popup atualiza no máximo uma vez por segundo enquanto aberto e para polling no unmount. Opções validam fila 1–500, concorrência WASM fixa em 1, WebGPU 1–4, timeout 1.000–120.000, chunks 32–256, overlap menor que chunk e cache 10–5.000. Traces detalhados existem apenas na resposta quando `debugMode === true`; storage mantém histogramas/bounded samples, nunca texto.

Documentar fluxo, contratos de worker, cancelamento, limites e diferença entre tokenização heurística/mock e exata/modelo.

- [ ] **Step 4: Executar portão completo**

Run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Expected: todos exit 0; nenhuma tarefa de teste fica aberta; bundle funciona com `navigator.gpu` ausente.

- [ ] **Step 5: Relatório e commit**

Criar `docs/phase-reports/phase-2.md` com resultados, métricas observadas e limitações.

```powershell
git add src docs tests
git commit -m "feat: complete the local inference pipeline"
```

## Phase 2 Exit Criteria

- Pipeline completo roda no Dedicated Worker.
- Idioma, token count aproximado, chunks, aggregation, calibration e explanation aparecem no resultado.
- Abstenção impede ação automática em evidência insuficiente.
- Fila é priorizada, limitada, deduplicada, cancelável, expira e respeita concorrência.
- Timeout/falha resultam em erro recuperável e restauração visual.
- Popup mostra status/versão/backend/fila; debug detalhado é opt-in.
- Build funciona sem WebGPU e continua integralmente offline com mock.
