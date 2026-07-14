# CleanFeed AI Phase 3 — Real Model Integration and Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um carregador ONNX local, substituível e seguro, com tokenizer exato, seleção WebGPU/WASM, validação de I/O e um benchmark científico; ativar um detector real somente quando um artefato treinado e um dataset auditável passarem pelo portão de modelo.

**Architecture:** Transformers.js fornece tokenizer e ONNX Runtime Web dentro do worker. Um manifesto próprio descreve labels, arquivos, checksums e calibração; o classificador nunca infere sem validar esse contrato. O benchmark vive fora do bundle da extensão e usa splits por autor/período.

**Tech Stack:** `@huggingface/transformers`, ONNX Runtime Web (transitivo), WebGPU opcional, WASM padrão, Web Crypto, TypeScript e Vitest.

## Global Constraints

- Aplicam-se o [plano mestre](./2026-07-14-cleanfeed-ai-master.md) e as Fases 1–2.
- `env.allowRemoteModels = false`; modelos, tokenizers e WASM são sempre locais.
- A extensão permanece no mock se faltar qualquer artefato, label, licença, checksum ou benchmark exigido.
- Scores de um modelo não são considerados calibrados até o benchmark aprovar um perfil por idioma/tamanho/plataforma.

## Entrada obrigatória da fase

A implementação do carregador e do benchmark pode começar sem modelo. A ativação do backend real exige o pacote `public/models/<id>/` e um dataset externo conforme o portão do master. Se esses itens não existirem, concluir tasks 20–25 com fixtures/mocks de runtime, manter `activeClassifierId: "mock-v1"` e registrar “modelo real não fornecido” no relatório.

---

### Task 20: Manifesto de bundle, checksums e catálogo local

**Files:**
- Create: `src/inference/model-bundle.ts`
- Create: `src/inference/model-catalog.ts`
- Create: `public/models/.gitkeep`
- Create: `docs/model-integration.md`
- Test: `tests/unit/inference/model-bundle.test.ts`
- Fixture: `tests/fixtures/models/valid/cleanfeed-model.json`
- Fixture: `tests/fixtures/models/invalid/cleanfeed-model.json`

**Interfaces:**
- Produces: `CleanFeedModelManifest`, `parseModelManifest`, `verifyModelBundle`, `ModelCatalog`.
- Consumes: base URL passado pelo offscreen; não usa rede remota.

- [ ] **Step 1: Testar schema, labels, path traversal e checksums**

```typescript
it("accepts an explicit binary AI/human manifest", () => {
  expect(parseModelManifest(validManifest)).toMatchObject({
    schemaVersion: 1,
    task: "ai_text_detection",
    labels: { human: 0, ai: 1 },
    maximumTokens: 256,
  });
});

it.each([
  { ...validManifest, labels: { human: 1, ai: 1 } },
  { ...validManifest, modelPath: "../../outside.onnx" },
  { ...validManifest, supportedLanguages: [] },
  { ...validManifest, license: "" },
  { ...validManifest, sha256: { model: "not-a-hash" } },
])("rejects unsafe or ambiguous manifest %#", (manifest) => {
  expect(() => parseModelManifest(manifest)).toThrowError("MODEL_LOAD_FAILED");
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/model-bundle.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar contrato fechado**

```typescript
export interface CleanFeedModelManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  task: "ai_text_detection";
  architecture: string;
  modelPath: string;
  tokenizerPath: string;
  configPath: string;
  supportedLanguages: string[];
  maximumTokens: number;
  quantization: "none" | "int8" | "int4";
  labels: { human: number; ai: number };
  output: { name: string; kind: "logits" | "probabilities" };
  license: string;
  source: string;
  calibrationVersion: string;
  sha256: Record<"model" | "tokenizer" | "config", string>;
}
```

IDs e paths aceitam apenas `[a-z0-9._/-]`, sem `..`, backslash, protocolo ou caminho absoluto. `maximumTokens` fica 32–512, mas settings continuam limitados ao menor entre 256 e o manifesto no MVP. `verifyModelBundle` faz fetch somente de URLs sob `chrome-extension://<id>/models/<model-id>/`, calcula SHA-256 e rejeita redirect/origin diferente.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- --run tests/unit/inference/model-bundle.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/inference/model-bundle.ts src/inference/model-catalog.ts public/models docs/model-integration.md tests
git commit -m "feat: define verified local model bundles"
```

---

### Task 21: Empacotamento offline de Transformers.js, tokenizer e WASM

**Files:**
- Create: `src/inference/transformers-environment.ts`
- Create: `src/inference/model-loader.ts`
- Create: `scripts/copy-transformers-assets.mjs`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `manifest.config.ts`
- Test: `tests/unit/inference/transformers-environment.test.ts`
- Test: `tests/integration/offline-assets.test.ts`

**Interfaces:**
- Produces: `configureTransformersEnvironment(paths): void`, `loadLocalSequenceClassifier(manifest, backend)`.
- Produces: build reproduzível contendo binários WASM que correspondem exatamente à versão lockada.

- [ ] **Step 1: Testar bloqueio remoto e inventário de assets**

```typescript
it("disables all remote model access", () => {
  configureTransformersEnvironment({
    modelBaseUrl: "chrome-extension://test/models/",
    wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
  });
  expect(env.allowRemoteModels).toBe(false);
  expect(env.allowLocalModels).toBe(true);
  expect(env.localModelPath).toBe("chrome-extension://test/models/");
  expect(env.backends.onnx.wasm.wasmPaths).toBe(
    "chrome-extension://test/vendor/transformers-wasm/",
  );
});

it("fails the build inventory when a referenced WASM asset is absent", async () => {
  await expect(assertOfflineAssetInventory(missingAssetDir)).rejects.toThrow("MODEL_LOAD_FAILED");
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/transformers-environment.test.ts tests/integration/offline-assets.test.ts`

Expected: FAIL.

- [ ] **Step 3: Configurar ambiente antes de qualquer import/model load**

```typescript
import { env } from "@huggingface/transformers";

export function configureTransformersEnvironment(paths: TransformerAssetPaths): void {
  assertExtensionUrl(paths.modelBaseUrl);
  assertExtensionUrl(paths.wasmBaseUrl);
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = paths.modelBaseUrl;
  env.backends.onnx.wasm.wasmPaths = paths.wasmBaseUrl;
}
```

O script copia somente `.wasm`/`.mjs` requeridos da versão instalada para `public/vendor/transformers-wasm/`, gera `assets-manifest.json` com hashes e falha se o inventário não bater. `prebuild` executa essa cópia; não baixa nada. Passar `assetBaseUrl` e `wasmBaseUrl` no `INITIALIZE` a partir do offscreen, que pode usar `chrome.runtime.getURL()`.

Acrescentar os assets locais ao `web_accessible_resources` somente se o worker exigir; matches continuam restritos ao LinkedIn. O smoke da Fase 4 provará que páginas genéricas não podem carregar o modelo sem gesto `activeTab`.

- [ ] **Step 4: Verificar build offline**

Run: `npm run build && npm test -- --run tests/integration/offline-assets.test.ts`

Expected: PASS; `dist/vendor/transformers-wasm/` contém apenas assets locais e nenhum arquivo aponta para CDN/Hugging Face.

- [ ] **Step 5: Commit**

```powershell
git add src/inference scripts package.json package-lock.json vite.config.ts manifest.config.ts tests
git commit -m "feat: package the inference runtime offline"
```

---

### Task 22: Tokenizer exato e OnnxTextClassifier

**Files:**
- Modify: `src/inference/tokenizer.ts`
- Create: `src/inference/onnx-classifier.ts`
- Modify: `src/inference/classifier.ts`
- Test: `tests/unit/inference/onnx-classifier.test.ts`
- Test: `tests/unit/inference/transformers-tokenizer.test.ts`

**Interfaces:**
- Produces: `TransformersTokenizer`, `OnnxTextClassifier` implementando `TextClassifier`.
- Consumes: `CleanFeedModelManifest` e gateway injetável `TransformersModelGateway`.

- [ ] **Step 1: Testar labels, softmax, shape e metadados**

```typescript
it("maps manifest labels instead of assuming output order", async () => {
  const classifier = createClassifier({
    manifest: { ...validManifest, labels: { human: 1, ai: 0 } },
    output: { logits: [[2, -1]] },
  });
  await classifier.initialize();
  const result = await classifier.classify(PORTUGUESE_TEXT);
  expect(result.aiScore).toBeGreaterThan(result.humanScore);
  expect(result.aiScore + result.humanScore).toBeCloseTo(1, 8);
});

it.each([
  { logits: [] },
  { logits: [[Number.NaN, 1]] },
  { logits: [[1]] },
  { probabilities: [[0.7, 0.7]] },
])("rejects malformed model output %#", async (output) => {
  const classifier = createClassifier({ output });
  await classifier.initialize();
  await expect(classifier.classify(PORTUGUESE_TEXT)).rejects.toMatchObject({
    code: "INFERENCE_FAILED",
  });
});

it("reports exact model token count and never silently truncates", async () => {
  const tokenized = await tokenizer.encode(PORTUGUESE_TEXT);
  expect(tokenized.exact).toBe(true);
  expect(tokenized.tokenCount).toBe(gateway.inputIds.length - gateway.specialTokenCount);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/onnx-classifier.test.ts tests/unit/inference/transformers-tokenizer.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar gateway pequeno sobre Transformers.js**

```typescript
export interface TransformersModelGateway {
  load(manifest: CleanFeedModelManifest, backend: "wasm" | "webgpu"): Promise<void>;
  tokenize(text: string): Promise<ModelTokens>;
  run(tokens: ModelTokens): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export class OnnxTextClassifier implements TextClassifier {
  constructor(
    private readonly manifest: CleanFeedModelManifest,
    private readonly gateway: TransformersModelGateway,
    private readonly backend: "wasm" | "webgpu",
  ) {}
  // initialize verifica bundle e carrega uma vez; classify valida I/O; dispose é idempotente.
}
```

Usar `AutoTokenizer` e `AutoModelForSequenceClassification` locais. Tokenizar sem truncamento no pipeline; o chunker garante limite. Adicionar special tokens somente na chamada do modelo e validar comprimento final <= `maximumTokens`. Para logits, aplicar softmax numericamente estável (`exp(x - max)`). Para probabilities, validar soma em `[0.999, 1.001]`. O resultado retorna scores crus; calibration permanece fora do classificador.

AbortSignal é verificado antes da tokenização, antes da sessão e depois da sessão. ONNX em execução não é interrompível com segurança; timeout duro faz o host terminar/recriar o worker e isso deve estar documentado.

- [ ] **Step 4: Rodar testes sem pesos reais**

Run: `npm test -- --run tests/unit/inference/onnx-classifier.test.ts tests/unit/inference/transformers-tokenizer.test.ts && npm run typecheck`

Expected: PASS usando gateway fake; nenhuma métrica de qualidade é afirmada.

- [ ] **Step 5: Commit**

```powershell
git add src/inference tests/unit/inference
git commit -m "feat: add a validated ONNX text classifier"
```

---

### Task 23: Seleção WebGPU, fallback WASM e lifecycle do modelo

**Files:**
- Create: `src/inference/backend-selector.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/inference/worker-protocol.ts`
- Modify: `src/offscreen/worker-host.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/unit/inference/backend-selector.test.ts`
- Test: `tests/integration/backend-fallback.test.ts`

**Interfaces:**
- Produces: `selectBackend`, `ClassifierLifecycleManager`, `ModelStatus` detalhado.
- Consumes: settings `auto|wasm|webgpu`, disponibilidade de `navigator.gpu`, bundle e factory.

- [ ] **Step 1: Testar auto, opt-out, fallback e erro duplo**

```typescript
it("uses WASM when WebGPU is unavailable", async () => {
  const result = await selector.initialize({ preference: "auto", hasWebGpu: false });
  expect(result.backend).toBe("wasm");
});

it("falls back exactly once when WebGPU initialization fails", async () => {
  factory.webgpu.mockRejectedValue(new Error("adapter failed"));
  const result = await selector.initialize({ preference: "auto", hasWebGpu: true });
  expect(factory.webgpu).toHaveBeenCalledTimes(1);
  expect(factory.wasm).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ backend: "wasm", fallbackFrom: "webgpu" });
});

it("reports unavailable when both backends fail", async () => {
  factory.webgpu.mockRejectedValue(new Error("gpu"));
  factory.wasm.mockRejectedValue(new Error("wasm"));
  await expect(selector.initialize({ preference: "auto", hasWebGpu: true })).rejects.toMatchObject({
    code: "MODEL_LOAD_FAILED",
  });
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/backend-selector.test.ts tests/integration/backend-fallback.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar máquina de estados e reinicialização atômica**

```typescript
export type ModelLifecycleState = "unavailable" | "initializing" | "ready" | "disposing" | "error";

export interface ModelStatus {
  state: ModelLifecycleState;
  classifierId: string;
  modelVersion: string;
  backend: Backend;
  fallbackFrom?: "webgpu";
  errorCode?: ErrorCode;
  initializedAt?: number;
}
```

Serializar initialize/dispose/switch em uma promise chain. Nunca manter duas sessões ativas após switch. Em auto: tentar WebGPU somente se setting e `navigator.gpu`; em falha, limpar sessão parcial, registrar métrica local e iniciar WASM. Preferência explícita `webgpu` ainda faz fallback, mas mostra aviso. Preferência `wasm` não tenta GPU.

Timeout duro: `worker-host` termina o worker, rejeita todas as tasks running com erro recuperável, cria novo worker e reinicializa o último backend/bundle; queued tasks não iniciadas continuam na fila se ainda não expiraram.

- [ ] **Step 4: Executar testes de lifecycle**

Run: `npm test -- --run tests/unit/inference/backend-selector.test.ts tests/integration/backend-fallback.test.ts`

Expected: PASS; disposals chamados uma vez.

- [ ] **Step 5: Commit**

```powershell
git add src/inference src/offscreen src/shared/types.ts tests
git commit -m "feat: select and recover inference backends"
```

---

### Task 24: Integração do artefato candidato, profiling e calibração versionada

**Files:**
- Create: `src/inference/model-profile.ts`
- Create: `src/inference/calibration-registry.ts`
- Modify: `src/inference/calibration.ts`
- Modify: `src/options/App.tsx`
- Create: `src/options/components/ModelSettings.tsx`
- Create: `docs/model-validation.md`
- Test: `tests/unit/inference/calibration-registry.test.ts`
- Test: `tests/integration/real-model-smoke.test.ts`

**Interfaces:**
- Produces: `CalibrationRegistry.get(model, platform, language, bucket)`.
- Produces: smoke condicionado a `CLEANFEED_TEST_MODEL_DIR`; skip explícito quando não existe modelo.

- [ ] **Step 1: Testar isolamento de calibração por versão e fallback conservador**

```typescript
it("never reuses calibration from a different model version", () => {
  registry.add(profile({ modelId: "candidate", modelVersion: "1.0.0", markingThreshold: 0.8 }));
  expect(registry.get(query({ modelVersion: "1.0.1" }))).toEqual(CONSERVATIVE_UNCALIBRATED_PROFILE);
});

it("marks missing benchmark calibration as uncalibrated", () => {
  expect(registry.get(query({ modelId: "new-model" })).calibrated).toBe(false);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run tests/unit/inference/calibration-registry.test.ts`

Expected: FAIL.

- [ ] **Step 3: Integrar pacote somente se portão de entrada estiver satisfeito**

Se houver modelo candidato, copiar apenas artefatos licenciados para `public/models/<id>/`, registrar hashes e adicionar entrada no catálogo. Smoke real valida: load offline, tokenizer, shape, labels, 5 textos portugueses de sanidade sem afirmar ground truth, latency warm/cold e memória aproximada quando `performance.measureUserAgentSpecificMemory` existir.

Sem modelo, manter diretório vazio, smoke com `describe.skipIf(!process.env.CLEANFEED_TEST_MODEL_DIR)` e mensagem “real model artifact not supplied”; isso é skip documentado, não PASS científico.

Perfil não calibrado pode produzir indicador/score em modo debug, mas `actionCeiling: "indicator"`. Options mostra model ID/version/backend, status de calibração e botão de fallback para mock.

- [ ] **Step 4: Rodar smoke conforme disponibilidade**

Run: `npm test -- --run tests/unit/inference/calibration-registry.test.ts tests/integration/real-model-smoke.test.ts`

Expected with no artifact: unit PASS e smoke SKIP com razão registrada. Expected with artifact: todos PASS e zero fetch para origem HTTP(S).

- [ ] **Step 5: Commit**

```powershell
git add src public/models docs/model-validation.md tests
git commit -m "feat: gate real models behind verified calibration"
```

---

### Task 25: Benchmark científico, relatório e portão da Fase 3

**Files:**
- Create: `benchmark/README.md`
- Create: `benchmark/schema.ts`
- Create: `benchmark/split.ts`
- Create: `benchmark/metrics.ts`
- Create: `benchmark/report.ts`
- Create: `benchmark/cli.ts`
- Create: `benchmark/tests/split.test.ts`
- Create: `benchmark/tests/metrics.test.ts`
- Create: `benchmark/data/.gitkeep`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/phase-reports/phase-3.md`

**Interfaces:**
- Produces: `validateBenchmarkRecord`, `groupTimeSplit`, `computeBinaryMetrics`, `buildBenchmarkReport`.
- Produces: `npm run benchmark -- --input <jsonl> --output <dir>`.

- [ ] **Step 1: Testar ausência de vazamento e métricas conhecidas**

```typescript
it("keeps authors disjoint and test records later than calibration records", () => {
  const split = groupTimeSplit(DATASET, { groupBy: "authorGroup", timeBy: "createdAt" });
  expect(intersection(authors(split.train), authors(split.calibration))).toEqual([]);
  expect(intersection(authors(split.train), authors(split.test))).toEqual([]);
  expect(Math.min(...split.test.map((row) => row.createdAt))).toBeGreaterThan(
    Math.max(...split.calibration.map((row) => row.createdAt)),
  );
});

it("computes precision among blocked as the primary metric", () => {
  const metrics = computeBinaryMetrics([
    prediction("ai", 0.99), prediction("human", 0.98),
    prediction("ai", 0.2), prediction("human", 0.1),
  ], { blockThreshold: 0.92 });
  expect(metrics.precisionAmongBlocked).toBe(0.5);
  expect(metrics.truePositives).toBe(1);
  expect(metrics.falsePositives).toBe(1);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- --run benchmark/tests`

Expected: FAIL.

- [ ] **Step 3: Implementar schema, split, métricas e segmentos**

```typescript
export interface BenchmarkRecord {
  id: string;
  text: string;
  label: "human" | "ai" | "hybrid";
  authorGroup: string;
  createdAt: number;
  platform: string;
  language: string;
  topic: string;
  generatorModel?: string;
  transformation?: "none" | "humanized" | "translated" | "edited";
  license: string;
}
```

Dados nunca entram no Git: ignorar `benchmark/data/*` exceto `.gitkeep`. Validador exige licença e grupos pseudonimizados. Métricas implementam confusion matrix, precision, recall, F1, FPR/FNR, ROC-AUC por integração trapezoidal, PR-AUC, recall em FPR configurável, latência e memória. Relatório segmenta tamanho (`50_79` etc.), idioma, plataforma, generatorModel e transformation, sempre incluindo tamanho da amostra.

CLI exige `--split group-time`; `--split random` só é permitido com `--comparison-only` e marca o relatório como não apto a decisões de lançamento. O relatório nunca usa “acurácia” isolada como headline.

- [ ] **Step 4: Executar portão da fase**

Run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Expected: todos exit 0. Se não houver modelo/dataset, relatório de fase registra claramente tasks de infraestrutura completas, smoke real skipped e backend ativo ainda mock.

- [ ] **Step 5: Commit**

```powershell
git add benchmark .gitignore package.json package-lock.json README.md docs src tests public/models
git commit -m "feat: add scientific model validation tooling"
```

## Phase 3 Exit Criteria

- Nenhum modelo ou WASM é obtido remotamente em runtime.
- Bundle/labels/checksums/licença são validados antes de load.
- OnnxTextClassifier é testado por gateway e não assume ordem de labels.
- WebGPU tem fallback WASM e lifecycle recuperável.
- Calibração é versionada e modelo não calibrado só pode indicar.
- Benchmark impede vazamento por autor/tempo e prioriza precisão entre bloqueados.
- Se artefato/dataset não existirem, UI e relatório mantêm modo mock explicitamente; isso não é tratado como falha escondida nem como detector real concluído.
