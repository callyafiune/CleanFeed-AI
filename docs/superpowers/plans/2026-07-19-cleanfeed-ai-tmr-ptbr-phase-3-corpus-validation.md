# CleanFeed AI TMR/PT-BR — Phase 3 Corpus and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir e selar o corpus PT-BR/LinkedIn de 10.000 registros, pontuar desenvolvimento e calibração com o runtime TMR exato e consumir uma única vez o teste temporal bloqueado para produzir uma decisão científica auditável.

**Architecture:** Dados licenciados ou consentidos permanecem em um plano local ignorado pelo Git; somente protocolos, digests, artefatos de split e relatórios sanitizados são versionáveis. Um scorer controla a extensão real em Chrome, portanto benchmark e produto usam o mesmo tokenizer, janelamento e ONNX sem importar `src/`. O calibrador é congelado antes do teste, e um ledger append-only torna o primeiro início de scoring do holdout uma consumação irreversível daquela versão.

**Tech Stack:** TypeScript 5.9 sob Node.js 22.18+, Vitest 4, Playwright, Chrome for Testing Stable `150.0.7871.129`, JSONL canônico, SHA-256, contratos da Fase 1 e CLI estatística da Fase 2.

## Global Constraints

- Esta fase começa somente após os checkpoints das Fases 1 e 2.
- O corpus selado contém exatamente 4.000 `human`, 4.000 `ai` e 2.000 `mixed`.
- Conteúdo LinkedIn humano vem apenas de contribuição autorizada ou fonte com licença compatível; scraping indiscriminado e coleta de perfis são proibidos.
- Todo item tem dois revisores distintos; desacordo exige terceiro adjudicador distinto antes do selo.
- Proveniência, licença/base legal, linhagem e auditoria de PII são fatos documentais; detector algum pode criar ou corrigir o rótulo.
- Pelo menos uma família geradora inteira fica exclusivamente no teste e é marcada `unseen`.
- Split fixo por classe: 20% desenvolvimento, 30% calibração e 50% teste temporal bloqueado, com tolerância absoluta máxima de dois pontos percentuais após agrupamento.
- Nenhum grupo conectado por autor, fonte, versão/lote gerador, template, lote de coleta, quase duplicata ou derivação cruza splits.
- O teste possui ao menos 2.000 negativos humanos; cada slice crítico de FPR elegível tem ao menos 300 negativos e cada slice crítico de recall elegível tem ao menos 200 positivos.
- `score` pode ler somente desenvolvimento e calibração. O teste é acessado exclusivamente por `consume-holdout` depois do congelamento.
- O primeiro estado `started` no ledger consome o holdout, mesmo se a execução cair; somente o mesmo `consumptionId` e os mesmos digests podem retomar.
- Prediction shards têm 100 IDs, escrita atômica e exatamente um resultado `scored|abstained|error` por ID; nunca armazenam texto, URL, autor ou prompt.
- Predictions release-eligible são produzidas com backend WASM, igual ao ambiente mínimo dos gates; WebGPU pode gerar apenas uma execução `comparison-only` separada e nunca alimentar fit/evaluate.
- Scoring científico e desempenho usam Chrome for Testing Stable `150.0.7871.129` pinado; E2E funcional comum usa o Chromium empacotado pelo Playwright. Chrome branded não é automatizado por flags de sideload removidas. Referências: [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing/) e [mudança de `--load-extension`](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ).
- Nenhuma saída pública contém texto, URL, nome, autor pseudonimizado, prompt completo, consent receipt ou hash individual de conteúdo.
- `benchmark/data/**`, `benchmark/out/**` e `benchmark/work/**` permanecem locais e ignorados. Somente `benchmark/evidence/tmr-ptbr-v1/**` sanitizado pode entrar no Git.
- Falha de gate produz `indicator-only` ou `reject`; não se ajusta regra, threshold, calibrador ou OOD depois de observar o teste.
- Commits usam `--no-verify`, conforme autorização do usuário.

---

## File map

**Create**

- `benchmark/protocols/collection-v1.md` e `generation-v1.md`; os protocolos `annotation-v1`, `pii-review-v1` e `corpus-v1` vêm da Fase 2.
- `benchmark/source-manifest.ts`, `benchmark/corpus-source-audit.ts` e `benchmark/corpus-import.ts`.
- `benchmark/browser-scorer.ts`, `benchmark/prediction-shards.ts`.
- `benchmark/commands/ingest.ts`, `score.ts`, `consume-holdout.ts`, `publish-evidence.ts` e `verify-published-evidence.ts`.
- `src/model-benchmark/**`, `vite.model-benchmark.config.ts`, `playwright.model-benchmark.config.ts`, browser lock/resolver and corresponding tests.
- `benchmark/evidence/tmr-ptbr-v1/.gitkeep`; `benchmark/out` and `benchmark/work` are created on demand and remain wholly ignored.

**Modify**

- `.gitignore`, `package.json`, `benchmark/cli.ts`, `benchmark/README.md`.
- Os módulos da Fase 2 são consumidos por suas interfaces públicas; esta fase não redefine `BenchmarkRecord`, `DatasetManifest`, `SplitArtifact`, `FrozenCalibrationArtifact`, `ModelPublication`, `RuntimeCalibrationProfileV1`, `CalibrationProfilesFileV1` nem `HoldoutConsumption`.
- `models/tmr-ai-text-detector/release.json` and `calibration-profiles.json` only after the holdout decision.

---

### Task 1: Complete source governance and readiness checks

**Files:**
- Create: `benchmark/protocols/collection-v1.md`
- Create: `benchmark/protocols/generation-v1.md`
- Create: `benchmark/source-manifest.ts`
- Create: `benchmark/corpus-source-audit.ts`
- Test: `benchmark/tests/source-manifest.test.ts`
- Test: `benchmark/tests/corpus-source-audit.test.ts`
- Modify: `benchmark/README.md`

**Interfaces:**
- Consumes: `DatasetManifest` and `BenchmarkRecord` plus the pure `CorpusSourceReadinessReport`, parser and digest helper from Phase 2, and a closed reviewed source manifest.
- Produces: `ReviewedSourceManifestV1`, `auditCorpusSources(input): CorpusSourceReadinessReport` and `assertCorpusSourcesReady(report): void`; post-split sample/leakage readiness remains exclusively the Phase 2 `SplitAudit`.

- [ ] **Step 1: Write the two remaining normative protocols**

`collection-v1.md` permits exactly two human-source paths: explicit contribution with a consent-receipt digest, or a source whose license review is `approved`. It forbids scraping authenticated pages, copying a profile wholesale and retaining names, handles or URLs.

`generation-v1.md` requires provider, family, model, version, prompt-template digest, temperature, generation date, batch and seed or a null reason. A complete family selected before ingestion is reserved for test.

Reference, without duplicating, the Phase 2 `annotation-v1.md`, `pii-review-v1.md` and `corpus-v1.md`. `collection-v1.md` requires those exact protocol versions for every accepted source.

- [ ] **Step 2: Write failing readiness tests**

Cover legal approval, LinkedIn source policy, collection/generation protocol versions, source-to-record linkage, consent/license evidence and legal-reviewer independence. Reuse compact Phase 2 record factories; class quotas, annotation/adjudication, mixed lineage, held-out family and slice minima stay in their existing Phase 2 tests.

Define and test this closed source manifest; unknown keys fail, `licensed` requires `licenseId`, `consent` requires `consentReceiptDigest`, generated batches require a complete recipe, reviewers must be distinct, and neither entries nor the top level may contain source URL, name, handle or raw receipt:

~~~ts
export type ReviewedSourceEntryV1 =
  | {
      sourceId: string;
      sourceType: "linkedin-contribution";
      acquisition: "consent";
      evaluationUseApproved: true;
      licenseId: null;
      consentReceiptDigest: string;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    }
  | {
      sourceId: string;
      sourceType: "licensed-corpus";
      acquisition: "licensed";
      evaluationUseApproved: true;
      licenseId: string;
      consentReceiptDigest: null;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    }
  | {
      sourceId: string;
      sourceType: "controlled-generation";
      acquisition: "generated";
      evaluationUseApproved: true;
      licenseId: string;
      consentReceiptDigest: null;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    };

export interface GenerationBatchV1 {
  batchId: string;
  sourceId: string;
  generationProtocolVersion: "generation-v1";
  provider: string;
  family: string;
  model: string;
  version: string;
  promptTemplateDigest: string;
  temperature: number;
  generatedAt: number;
  seed: string | null;
  seedNullReason: string | null;
}

export interface ReviewedSourceManifestV1 {
  schemaVersion: 1;
  sources: ReviewedSourceEntryV1[];
  generationBatches: GenerationBatchV1[];
  sourceManifestDigest: string;
}
~~~

Exactly one of `seed` and non-empty `seedNullReason` is present. Every controlled-generation record links `provenance.sourceId` to a generated source and `groups.collectionBatch` to one batch; audit exact provider/family/model/version/prompt digest/temperature/date/seed fields against its `generation` object. Human records cannot link a generation batch. Compute `sourceManifestDigest` over canonical JSON without that field. This self-digest is distinct from the raw SHA-256 of the manifest bytes: the Phase 2 `DatasetManifest`/`DatasetAudit` bind the raw file SHA-256, while `CorpusSourceReadinessReport.sourceManifestDigest` binds the recalculated self-digest. `validate` and `fit` must require both links simultaneously, preventing a readiness report from another corpus from being paired only by record count. The public report never repeats consent-receipt digests or recipes.

~~~ts
expect(auditCorpusSources(validAuthorizedSources)).toMatchObject({
  status: "ready",
  blockingReasons: [],
});
expect(auditCorpusSources(withUnapprovedConsent).blockingReasons).toContainEqual(
  expect.objectContaining({ code: "LINKEDIN_SOURCE_NOT_AUTHORIZED" }),
);
~~~

- [ ] **Step 3: Run the test and verify RED**

Run: `npx vitest run benchmark/tests/source-manifest.test.ts benchmark/tests/corpus-source-audit.test.ts`

Expected: FAIL because `benchmark/corpus-source-audit.ts` does not exist.

- [ ] **Step 4: Implement the closed readiness report**

Import, without redeclaring, `CorpusSourceBlockingCode`, `CorpusSourceReadinessReport`, `parseCorpusSourceReadinessReport` and `computeSourceReadinessDigest` from `contracts/source-readiness.ts`. Populate every contract field: source-manifest digest, record/source counts, acquisition counts `consent|licensed|generated`, the five literal protocol versions, sorted reasons and `reportDigest`. Emit only the nine Phase 2 reason codes; do not invent local strings.

Reuse Phase 2 record/schema checks instead of recalculating them. This report adds source authorization, consent/license evidence and collection/generation protocol coverage only. Compute `reportDigest` with the shared helper over canonical JSON without that field; the fit artifact, holdout tuple and benchmark report bind it as `sourceReadinessDigest`. `validate` combines its status with the separate `DatasetAudit`; `split` later remains the sole producer of leakage/slice reasons. Sort source reasons deterministically and never include text or human-readable source identifiers.

- [ ] **Step 5: Test privacy and deterministic output**

Serialize the report and assert it does not contain `text`, `url`, `prompt`, `authorGroup`, `consentReceiptDigest` or `contentSha256`. Permuting records must produce byte-identical canonical output.

Run: `npx vitest run benchmark/tests/source-manifest.test.ts benchmark/tests/corpus-source-audit.test.ts`

Expected: PASS.

- [ ] **Step 6: Document the acquisition boundary and commit**

Explain that code completion does not imply corpus availability and only authorized local inputs may satisfy readiness.

~~~powershell
git add benchmark/protocols/collection-v1.md benchmark/protocols/generation-v1.md benchmark/source-manifest.ts benchmark/corpus-source-audit.ts benchmark/tests/source-manifest.test.ts benchmark/tests/corpus-source-audit.test.ts benchmark/README.md
git commit --no-verify -m "feat(benchmark): enforce corpus governance"
~~~

---

### Task 2: Ingest authorized records and materialize the Phase 2 seal/split

**Files:**
- Create: `benchmark/corpus-import.ts`
- Create: `benchmark/commands/ingest.ts`
- Test: `benchmark/tests/corpus-import.test.ts`
- Consume: tracked `benchmark/data/.gitkeep`
- Create: `benchmark/evidence/tmr-ptbr-v1/.gitkeep`
- Modify: `benchmark/cli.ts`
- Modify: `benchmark/commands/validate.ts`
- Modify: `benchmark/tests/cli.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: local JSONL records, independent review ledger, reviewed source manifest and a closed dataset-manifest template without derived file fields.
- Produces: the canonical Phase 2 dataset directory; existing `validate` and `split` commands produce `DatasetAudit` and `SplitArtifact` as the only scientific seal/split contracts.

- [ ] **Step 1: Write failing import and integration tests**

Test NFC/LF normalization, opaque ID validation, exact/near-duplicate refusal, atomic write, stable digest, exact quotas and closed source metadata. Incoming records must already carry opaque IDs issued by the authorized collection workflow; the importer never derives an ID from text. Integration tests pass the imported directory, reviewed source manifest and independent review ledger to `runValidate`, then pass its audit to `runSplit`; validate all digests and prove any later record, source manifest or review-ledger change invalidates downstream artifacts. The holdout ledger permanently binds the version once consumption starts.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run benchmark/tests/corpus-import.test.ts benchmark/tests/dataset-manifest.test.ts benchmark/tests/split-artifact.test.ts`

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Implement local-only atomic ingestion**

~~~ts
export interface IngestRequest {
  inputRecordsPath: string;
  inputReviewLedgerPath: string;
  inputSourceManifestPath: string;
  inputDatasetManifestTemplatePath: string;
  datasetDirectory: string;
  expectedDatasetId: "ptbr-linkedin-v1";
}
export function ingestAuthorizedRecords(request: IngestRequest): Promise<{
  accepted: number;
  rejected: Array<{ inputLine: number; code: string }>;
  outputDigest?: string;
}>;
~~~

`inputDatasetManifestTemplatePath` is a closed `Omit<DatasetManifest, "recordsFile" | "recordsSha256" | "reviewLedgerFile" | "reviewLedgerSha256" | "sourceManifestFile" | "sourceManifestSha256">`; filenames and all three SHA-256 values are generated, never accepted from the caller. Parse and validate every input before replacing any target. Recompute every content digest, reject conflicting caller-derived hashes, unknown keys, malformed/non-opaque IDs, duplicate ID/hash, cross-lineage near duplicate and absent immutable source entries. Atomically write exactly `records.jsonl`, `private/review-ledger.jsonl`, `private/source-manifest.json` and `dataset-manifest.json`. Never print text excerpts.

- [ ] **Step 4: Add ingest and reuse the Phase 2 validate/split commands**

~~~powershell
npm run benchmark -- ingest --input benchmark/data/incoming/records.jsonl --review-ledger benchmark/data/incoming/review-ledger.jsonl --sources benchmark/data/incoming/sources.json --dataset-manifest-template benchmark/data/incoming/dataset-manifest-template.json --dataset-dir benchmark/data/ptbr-linkedin-v1
npm run benchmark -- validate --dataset-dir benchmark/data/ptbr-linkedin-v1 --output benchmark/out/ptbr-v1/validate
npm run benchmark -- split --dataset-dir benchmark/data/ptbr-linkedin-v1 --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --output benchmark/out/ptbr-v1/split --seed 712019
~~~

`ingest` exits 0 only with zero rejected records. The modified `validate` command resolves the two private paths exclusively from `DatasetManifest`, recalculates their hashes, executes `sealDataset` and `auditCorpusSources`, and writes `dataset-audit.json` plus `source-readiness.json`; no CLI flag can substitute another source manifest or ledger. `split` executes near-duplicate clustering, blocked assignment and leakage/slice audit. No second sealing implementation is introduced.

Expected final stdout matches:

~~~text
Dataset sealed: 10000 records (human=4000, ai=4000, mixed=2000).
Split frozen: development=20%, calibration=30%, test=50%; leakage=0.
~~~

- [ ] **Step 5: Protect local and generated paths**

Use these rules:

~~~gitignore
benchmark/data/*
!benchmark/data/.gitkeep
benchmark/out/
benchmark/work/
benchmark/evidence/tmr-ptbr-v1/*
!benchmark/evidence/tmr-ptbr-v1/.gitkeep
~~~

Publication later force-allows a closed sanitized file set. It never uses `git add -f` for source data.

- [ ] **Step 6: Run tests and static checks**

Run: `npx vitest run benchmark/tests/corpus-import.test.ts benchmark/tests/dataset-manifest.test.ts benchmark/tests/split-audit.test.ts benchmark/tests/split-artifact.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS; benchmark imports only `contracts/**`, Node built-ins and benchmark modules, never `src/**`.

- [ ] **Step 7: Commit ingestion and sealing code**

~~~powershell
git add .gitignore package.json benchmark/cli.ts benchmark/commands/ingest.ts benchmark/commands/validate.ts benchmark/corpus-import.ts benchmark/tests/cli.test.ts benchmark/tests/corpus-import.test.ts benchmark/evidence/tmr-ptbr-v1/.gitkeep
git commit --no-verify -m "feat(benchmark): seal the authorized PT-BR corpus"
~~~

- [ ] **Step 8: Perform real local collection and seal the readiness checkpoint**

Import only materials backed by recorded consent/license. Add authorized batches until `seal` reaches the exact composition and every critical slice minimum. Human coverage includes corporate prose, broetry, recruiting, sales, career, technology, formal, polished/repetitive/formulaic/motivational and non-native PT-BR writing. AI/mixed coverage includes every transformation in the approved spec.

~~~powershell
npm run benchmark -- validate --dataset-dir benchmark/data/ptbr-linkedin-v1 --output benchmark/out/ptbr-v1/validate
npm run benchmark -- split --dataset-dir benchmark/data/ptbr-linkedin-v1 --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --output benchmark/out/ptbr-v1/split --seed 712019
~~~

Expected: both exit 0; the audit proves per-class 20/30/50 within ±2 points, strict temporal ordering, no connected-group leakage, one unseen family and at least 2.000 test humans. Do not commit the dataset or run directory.

---

### Task 3: Score development and calibration with a candidate-only Chrome harness

**Files:**
- Create: `src/model-benchmark/model-benchmark.html`
- Create: `src/model-benchmark/main.ts`
- Create: `vite.model-benchmark.config.ts`
- Create: `playwright.model-benchmark.config.ts`
- Consume: `contracts/runtime-parity.ts`, `scripts/runtime-parity.mjs` and `scripts/runtime-parity.d.mts` from Phase 2
- Create: `scripts/test-browser-lock.mjs`
- Create: `scripts/test-browser-lock.d.mts`
- Create: `tests/browser-lock.json`
- Create: `benchmark/browser-scorer.ts`
- Create: `benchmark/prediction-shards.ts`
- Create: `benchmark/commands/score.ts`
- Test: `benchmark/tests/browser-scorer.test.ts`
- Test: `benchmark/tests/prediction-shards.test.ts`
- Test: `tests/integration/runtime-parity-manifest.test.ts`
- Test: `tests/integration/test-browser-lock.test.ts`
- Test: `tests/e2e/benchmark-browser-scorer.spec.ts`
- Modify: `benchmark/cli.ts`
- Modify: `benchmark/tests/cli.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.node.json`

**Interfaces:**
- Consumes: sealed split, verified TMR bundle, the Phase 1 `ModelRuntime`/windowing/aggregation/evidence modules and the Phase 2 `RuntimeParityManifestV1`, `PredictionManifestV1` and `StrictPredictionV2` contracts.
- Produces: `dist-model-benchmark`, raw TMR prediction shards and a strict prediction manifest. Node-side `benchmark/**` never imports `src/**`; only the isolated browser entry imports the production inference core.

- [ ] **Step 1: Write failing parity, browser-protocol and shard tests**

Define the Node-side run input without `RuntimeModelIdentity` and with every scientific identity field represented once:

~~~ts
export interface BrowserScoreRun {
  schemaVersion: 1;
  runId: string;
  datasetDigest: string;
  splitDigest: string;
  partition: "development" | "calibration" | "test";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  chromeVersion: typeof RELEASE_CHROME_VERSION;
  backend: "wasm";
  holdoutConsumptionId: string | null;
  shardSize: 100;
}

export interface PredictionShardStore {
  open(run: BrowserScoreRun): Promise<void>;
  completedIds(): Promise<ReadonlySet<string>>;
  writeAtomic(index: number, rows: readonly StrictPredictionV2[]): Promise<void>;
  finalize(expectedIds: readonly string[]): Promise<PredictionManifestV1>;
}
~~~

Import `RELEASE_CHROME_VERSION` from the Phase 2 prediction contract; its literal is `"150.0.7871.129"`. For test scoring require `runId === holdoutConsumptionId === HoldoutConsumption.consumptionId`; development/calibration use an opaque run ID and null consumption. Test the Phase 2 closed runtime-parity input list through its public script, one changed inference-core byte, browser-lock unknown keys/version drift, a crash after temporary shard write, exact resume including the full four-part browser version, identity mismatch, duplicate/extra/missing IDs and forbidden serialized keys. Test that `partition: "test"` is rejected unless the internal call receives the active Phase 2 `HoldoutConsumption` returned by `beginHoldoutConsumption` or `resumeHoldoutConsumption`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/integration/runtime-parity-manifest.test.ts tests/integration/test-browser-lock.test.ts benchmark/tests/browser-scorer.test.ts benchmark/tests/prediction-shards.test.ts benchmark/tests/cli.test.ts`

Expected: FAIL because the candidate browser entry, parity embedding and scorer modules do not exist.

- [ ] **Step 3: Build an isolated candidate-TMR entrypoint**

`vite.model-benchmark.config.ts` must generate only `dist-model-benchmark/`, with a test-only MV3 manifest and `model-benchmark.html`. Its `main.ts` imports the exact Phase 1 `ModelRuntime`, exact tokenizer, `createTmrChunkPlan`, `aggregateWindowsV2` and `assessEvidence`; it initializes WASM from the verified local bundle and directly invokes this uncalibrated TMR inference core. It must not import or call `backend-selector`, calibration registry, release selector, stylometric classifier, presentation policy or production `dist/`. Thus a pending release or zero published profiles cannot silently turn benchmark predictions into stylometric scores.

Expose only this page-local Playwright API:

~~~ts
export interface ModelBenchmarkStatusV1 {
  schemaVersion: 1;
  state: "ready" | "failed";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  backend: "wasm";
  exactTokenizer: boolean;
  errorCode: string | null;
}

export interface ModelBenchmarkScoreV1 {
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}
~~~

The API exists only inside the unpacked test extension; do not declare `externally_connectable`, a content script, a network listener or a production build entry. Unsupported input abstains; asset/backend failure returns `error` and never falls back.

- [ ] **Step 4: Generate and bind the runtime parity manifest**

Call the Phase 2 `scripts/runtime-parity.mjs write` command unchanged. That module already owns the closed, lexicographically sorted inference-core input list, computes `inferenceCoreDigest`, verifies model/tokenizer/version fields and calls `computeRuntimeParityDigest` over:

~~~ts
{
  schemaVersion: 1,
  modelId,
  modelVersion,
  bundleDigest,
  aggregationVersion,
  contentCompositionVersion,
  tokenizerDigest,
  inferenceCoreDigest,
}
~~~

`build:model-benchmark` first asks that owner command to write `benchmark/work/model-benchmark/runtime-parity.json`; Vite embeds that exact object in the page and emits the same JSON in `dist-model-benchmark`. The browser scorer hashes the closed built-directory inventory into the separate `extensionBuildDigest`. The Phase 3 integration test rejects a digest mismatch between embedded/emitted objects and a build that imports a second inference implementation; the Phase 2 tests own unknown/missing parity input and path-traversal cases. Phase 4 calls the same owner command for the final extension; it does not require its distinct `extensionBuildDigest` to equal this harness build.

- [ ] **Step 5: Implement the Playwright driver and deterministic shards**

Commit this closed browser lock:

~~~json
{
  "schemaVersion": 1,
  "product": "chrome",
  "channel": "stable",
  "version": "150.0.7871.129"
}
~~~

`scripts/test-browser-lock.mjs` exports `readTestBrowserLock`, `installLockedTestBrowser` and `resolveLockedTestBrowser` over the pinned `@puppeteer/browsers` package. Installation is explicit, local/cache-only during scoring, and the resolver launches the returned `executablePath`, checks `browser.version()` for the exact lock version and records it in `PredictionManifestV1`; it never falls back to system Chrome or bundled Chromium.

Resolve `dist-model-benchmark` absolutely, launch that locked Chrome for Testing with a persistent context plus `--disable-extensions-except` and `--load-extension`, open `model-benchmark.html`, block any `http:`/`https:` request and require `ModelBenchmarkStatusV1.state === "ready"`. Compare every identity/parity field to the model metadata and emitted parity manifest before sending any corpus text.

For each item, map the page response plus opaque ID to exactly `StrictPredictionV2`; never serialize input text, explanation spans, author/source groups, URL, prompt or content hash. Order by opaque IDs in `split-artifact.json`; shard `000000.jsonl` owns indexes 0–99. Write a same-directory temporary file, fsync and rename before updating the manifest. Resume only when every `BrowserScoreRun` field matches. `finalize` invokes the Phase 2 strict completeness validator and writes `prediction-manifest.json` as `PredictionManifestV1` with the exact shard inventory.

- [ ] **Step 6: Add candidate build and guarded score commands**

Add these scripts:

~~~json
{
  "browser:install:test": "node scripts/test-browser-lock.mjs install --lock tests/browser-lock.json",
  "build:model-benchmark": "node scripts/runtime-parity.mjs write --model-manifest models/tmr-ai-text-detector/cleanfeed-model.json --output-dir benchmark/work/model-benchmark && vite build --config vite.model-benchmark.config.ts",
  "test:model-benchmark": "playwright test --config playwright.model-benchmark.config.ts tests/e2e/benchmark-browser-scorer.spec.ts"
}
~~~

Run:

~~~powershell
npm run benchmark -- score --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition development --candidate-extension-dir dist-model-benchmark --output benchmark/out/ptbr-v1/predictions/development
npm run benchmark -- score --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition calibration --candidate-extension-dir dist-model-benchmark --output benchmark/out/ptbr-v1/predictions/calibration
~~~

CLI parsing rejects `--partition test` with `HOLDOUT_REQUIRES_CONSUME_COMMAND`, rejects the production `dist` directory and accepts `--resume` only for an identical manifest. Register `score` in `benchmark/cli.ts` and cover its flags in `benchmark/tests/cli.test.ts`.

- [ ] **Step 7: Prove exact browser inference and zero fallback**

The Playwright spec materializes the verified bundle, resolves the locked Chrome for Testing Stable, builds the candidate harness, scores fixed public fixtures and asserts browser version `150.0.7871.129`, exact model revision/bundle/tokenizer/aggregation/composition/parity digests, WASM, measured exact tokenizer, finite supported raw scores in [0,1], unsupported abstention, artifact-error status, zero external requests and no recomputation of completed IDs. A spy makes any stylometric/backend-selector call fail the test.

Run: `npm run browser:install:test && npm run model:verify && npm run build:model-benchmark`

Expected: PASS and `dist-model-benchmark/runtime-parity.json` matches the embedded status.

Run: `npx vitest run tests/integration/runtime-parity-manifest.test.ts tests/integration/test-browser-lock.test.ts benchmark/tests/browser-scorer.test.ts benchmark/tests/prediction-shards.test.ts benchmark/tests/cli.test.ts && npm run test:model-benchmark`

Expected: PASS with the real bundle and Chrome; missing model, skipped E2E or non-WASM backend is a checkpoint failure.

- [ ] **Step 8: Commit the candidate scorer**

~~~powershell
git add src/model-benchmark/model-benchmark.html src/model-benchmark/main.ts vite.model-benchmark.config.ts playwright.model-benchmark.config.ts scripts/test-browser-lock.mjs scripts/test-browser-lock.d.mts tests/browser-lock.json benchmark/browser-scorer.ts benchmark/prediction-shards.ts benchmark/commands/score.ts benchmark/cli.ts benchmark/tests/browser-scorer.test.ts benchmark/tests/prediction-shards.test.ts benchmark/tests/cli.test.ts tests/integration/runtime-parity-manifest.test.ts tests/integration/test-browser-lock.test.ts tests/e2e/benchmark-browser-scorer.spec.ts package.json package-lock.json tsconfig.node.json
git commit --no-verify -m "feat(benchmark): score the exact TMR candidate in Chrome"
~~~

- [ ] **Step 9: Generate complete development/calibration predictions**

Run `npm run browser:install:test`, `npm run model:fetch`, `npm run model:verify`, `npm run build:model-benchmark`, then both Step 6 score commands. Verify:

~~~powershell
npm run benchmark -- validate-predictions --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition development --predictions benchmark/out/ptbr-v1/predictions/development --runtime-parity dist-model-benchmark/runtime-parity.json
npm run benchmark -- validate-predictions --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --partition calibration --predictions benchmark/out/ptbr-v1/predictions/calibration --runtime-parity dist-model-benchmark/runtime-parity.json
~~~

Expected: zero missing, extra or duplicate IDs; both manifests have the identical candidate/runtime parity tuple and `backend: "wasm"`. Do not inspect or generate test predictions.

---

### Task 4: Fit the Phase 2 calibrators and freeze the candidate without opening the holdout

**Files:**
- Create: `benchmark/candidate-preflight.ts`
- Test: `benchmark/tests/candidate-preflight.test.ts`
- Modify: `benchmark/commands/fit.ts`
- Modify: `benchmark/cli.ts`
- Test: `benchmark/tests/cli.test.ts`

**Interfaces:**
- Consumes: complete development/calibration predictions and sealed metadata.
- Produces: the Phase 2 `FrozenCalibrationArtifact`; the Phase 2 append-only ledger remains unopened because it has no event before `beginHoldoutConsumption`.

- [ ] **Step 1: Write failing candidate-preflight tests**

~~~ts
export interface CandidatePreflightReport {
  status: "ready" | "blocked";
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  model: Pick<
    PredictionManifestV1,
    | "modelId"
    | "modelVersion"
    | "bundleDigest"
    | "aggregationVersion"
    | "contentCompositionVersion"
    | "tokenizerDigest"
    | "runtimeParityDigest"
    | "extensionBuildDigest"
    | "backend"
    | "chromeVersion"
  >;
  developmentPredictionManifestDigest: string;
  calibrationPredictionManifestDigest: string;
  freeDiskBytes: number;
  blockingReasons: string[];
}
~~~

Test ready source/dataset/split audits and their exact digests, exact matching prediction identities/parity and coverage, verified bundle/license, WASM-only candidate manifests, absence of any test-prediction input and at least 20 GiB free disk. Phase 2 tests remain the single source for calibrator/threshold digest and consumption uniqueness.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run benchmark/tests/candidate-preflight.test.ts benchmark/tests/calibration-pipeline.test.ts benchmark/tests/holdout-ledger.test.ts`

Expected: FAIL because `candidate-preflight.ts` does not exist.

- [ ] **Step 3: Implement fit preflight and freeze**

Extend the Phase 2 `fit` CLI with required `--dataset-audit`; keep its existing `--source-readiness` and `--runtime-parity` paths. Call the Phase 2 pipeline unchanged: five-fold author-grouped selection on development/calibration only, refit on calibration and joint warning/document-only visual thresholds. `runFit` first requires a ready `CandidatePreflightReport`, then verifies that `FrozenCalibrationArtifact.datasetAuditDigest === CandidatePreflightReport.datasetAuditDigest` and `FrozenCalibrationArtifact.sourceReadinessDigest === CandidatePreflightReport.sourceReadinessDigest`, in addition to the exact development/calibration prediction-manifest digests and their common model, tokenizer, aggregation, composition, runtime-parity, build, WASM and Chrome identity. Recalculate the reviewed source manifest self-digest and raw file SHA-256 here as a defense-in-depth check against the readiness report and `DatasetManifest`/`DatasetAudit`. Critical test sample sizes may be read from labels/metadata, but no test score or prediction path is accepted.

- [ ] **Step 4: Add fit command and unopened ledger**

~~~powershell
npm run benchmark -- fit --dataset-dir benchmark/data/ptbr-linkedin-v1 --source-readiness benchmark/out/ptbr-v1/validate/source-readiness.json --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --development-predictions benchmark/out/ptbr-v1/predictions/development --calibration-predictions benchmark/out/ptbr-v1/predictions/calibration --runtime-parity dist-model-benchmark/runtime-parity.json --output benchmark/out/ptbr-v1/fit --seed 712019
~~~

Expected stdout is `Calibration frozen without test access; warning UCB target=0.05; action UCB target=0.02.` Outputs include `frozen-calibration.json`, `fit-report.json` and candidate profile input; no ledger event or test metric exists yet.

- [ ] **Step 5: Prove holdout independence**

Change hidden test labels/scores in a fixture and assert a byte-identical evaluation plan. Passing a test-prediction flag to `fit` is an unknown-flag error. The fit report contains no test metric.

Run: `npx vitest run benchmark/tests/candidate-preflight.test.ts benchmark/tests/calibration-pipeline.test.ts benchmark/tests/profile-artifact.test.ts benchmark/tests/holdout-ledger.test.ts benchmark/tests/cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit freeze/ledger code**

~~~powershell
git add benchmark/candidate-preflight.ts benchmark/commands/fit.ts benchmark/cli.ts benchmark/tests/candidate-preflight.test.ts benchmark/tests/cli.test.ts
git commit --no-verify -m "feat(benchmark): freeze evaluation before holdout"
~~~

- [ ] **Step 7: Freeze the real candidate**

Run Step 4. Review only corpus/split counts, identities, fit/CV metrics and frozen thresholds. Do not inspect test content or scores. Manual editing of `frozen-calibration.json` is forbidden.

---

### Task 5: Consume the temporal holdout exactly once and issue the decision

**Files:**
- Create: `benchmark/commands/consume-holdout.ts`
- Test: `benchmark/tests/consume-holdout.test.ts`
- Modify: `benchmark/browser-scorer.ts`
- Modify: `benchmark/cli.ts`
- Modify: `benchmark/tests/cli.test.ts`

**Interfaces:**
- Consumes: Phase 2 append-only ledger, `FrozenCalibrationArtifact`, sealed test input/labels and the verified `dist-model-benchmark` candidate harness.
- Produces: complete test predictions, structured gate report and one `pass|indicator-only|reject`.

- [ ] **Step 1: Write failing transactional-consumption tests**

Cover wrong split-digest confirmation without ledger mutation; atomic `started` before first test text; unexpected process crash/resume of the same active consumption; terminal scoring failure that remains consumed; refusal of a new tuple run; exact completion; all three decision branches without threshold mutation; and report privacy.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run benchmark/tests/consume-holdout.test.ts`

Expected: FAIL because the command does not exist.

- [ ] **Step 3: Implement the one-way holdout lease**

Call the Phase 2 `beginHoldoutConsumption` exactly once after checking `--confirm-split-digest` against `SplitArtifact.splitDigest`. That function obtains the lock, verifies the full scientific tuple and persists/fsyncs the `started` event before returning `consumptionId`. The browser scorer's internal test-partition entry point accepts only that active consumption object; the public `score` subcommand still rejects test. An unexpected process death leaves the session `started` and may resume only through `resumeHoldoutConsumption` with the same ID, tuple and shards. A recognized irrecoverable failure calls `failHoldoutConsumption`; `completed` and `failed` are terminal and consumed. Deleting/resetting a ledger is unsupported.

The resume form is explicit and cannot create another ID:

~~~powershell
$active = Get-Content benchmark/work/holdout/active-session.json -Raw | ConvertFrom-Json
npm run benchmark -- consume-holdout --resume-consumption $active.consumptionId --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --candidate-extension-dir dist-model-benchmark --work-dir benchmark/work/holdout --output benchmark/out/ptbr-v1/evaluate --bootstrap-seed 712019
~~~

- [ ] **Step 4: Score and evaluate in one command**

~~~powershell
$split = Get-Content benchmark/out/ptbr-v1/split/split-artifact.json -Raw | ConvertFrom-Json
npm run benchmark -- consume-holdout --dataset-dir benchmark/data/ptbr-linkedin-v1 --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --candidate-extension-dir dist-model-benchmark --work-dir benchmark/work/holdout --output benchmark/out/ptbr-v1/evaluate --bootstrap-seed 712019 --confirm-split-digest $split.splitDigest
~~~

The command browser-scores `test-input.jsonl` under the active consumption, validates all predictions, then invokes the Phase 2 `evaluate` with private labels and the same `consumptionId`. The frozen evaluator computes Wilson/bootstrap/ECE/slices, writes aggregate outputs and appends a terminal ledger event. It never invokes fit code after starting consumption.

Expected stdout is one of:

~~~text
HOLDOUT_COMPLETED decision=pass
HOLDOUT_COMPLETED decision=indicator-only
HOLDOUT_COMPLETED decision=reject
~~~

- [ ] **Step 5: Delegate the decision exactly to the Phase 2 gates**

Do not restate or fork gate policy in this command. After shard validation, call the Phase 2 evaluator and preserve its `GateReport` byte-for-byte. Missing, extra or duplicate prediction IDs are a hard command failure and produce no scientific decision. Individual `error` rows are valid complete observations and contribute to the Phase 2 error-rate gate; only its configured `< 1%` check decides their effect. Ineligible/undersized action evidence caps the result at `indicator-only`; failed integrity or warning gates produce `reject`; only every required warning and action gate passing produces `pass`.

- [ ] **Step 6: Test recovery, decisions and privacy**

Run: `npx vitest run benchmark/tests/consume-holdout.test.ts benchmark/tests/gates.test.ts benchmark/tests/report.test.ts benchmark/tests/holdout-ledger.test.ts`

Expected: PASS.

Run: `npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the engine before reading real test data**

~~~powershell
git add benchmark/commands/consume-holdout.ts benchmark/browser-scorer.ts benchmark/cli.ts benchmark/tests/cli.test.ts benchmark/tests/consume-holdout.test.ts
git commit --no-verify -m "feat(benchmark): consume holdouts transactionally"
~~~

- [ ] **Step 8: Consume the real holdout once**

Run the focused tests, execute Step 4 once and retain its unmodified output. If interrupted, use the exact `--resume-consumption` form from Step 3; never delete, restore or reset the ledger from a backup. Record the literal decision. Any later tuning requires dataset `ptbr-linkedin-v2` and a new temporal holdout.

---

### Task 6: Publish only sanitized evidence and the authorized descriptor

**Files:**
- Delete: `benchmark/evidence/tmr-ptbr-v1/.gitkeep` created in Task 2 when real evidence is published
- Create: `benchmark/evidence-sanitizer.ts`
- Create: `benchmark/commands/publish-evidence.ts`
- Create: `benchmark/commands/verify-published-evidence.ts`
- Test: `benchmark/tests/evidence-sanitizer.test.ts`
- Modify: `benchmark/cli.ts`
- Modify: `benchmark/tests/cli.test.ts`
- Consume: `benchmark/commands/publish-profile.ts` and `verify-evidence.ts` from Phase 2
- Runtime output: `models/tmr-ai-text-detector/release.json`
- Runtime output: `models/tmr-ai-text-detector/calibration-profiles.json`
- Modify: `benchmark/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: completed `HoldoutConsumption`, aggregate report, frozen calibration, dataset/split audits and the Phase 2 model publication.
- Produces: a closed sanitized evidence directory and `verify-published-evidence`, which revalidates a clean clone without private/raw run outputs; Phase 2 remains the sole builder of release/profile artifacts.

- [ ] **Step 1: Write failing evidence-publication tests**

Reuse Phase 2 tests for the three decision mappings. Here require a completed ledger/report pair whose dataset, split, evaluator, calibration and model digests all match. Unfinished ledger, digest mismatch, unapproved model license or missing report refuses publication. Add closed-schema tests that preserve safe aggregate `predictionManifestDigests` while rejecting prediction rows, shard paths, record IDs and disguised record-ID arrays. A clean-clone fixture containing only the seven allowlisted evidence files plus model metadata must pass `verifyPublishedEvidence`; altered/missing/extra evidence must fail.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run benchmark/tests/evidence-sanitizer.test.ts benchmark/tests/profile-artifact.test.ts`

Expected: FAIL because `benchmark/evidence-sanitizer.ts` does not exist.

- [ ] **Step 3: Implement a closed output allowlist**

`publish-evidence` may write only:

~~~text
benchmark/evidence/tmr-ptbr-v1/dataset-summary.json
benchmark/evidence/tmr-ptbr-v1/split-summary.json
benchmark/evidence/tmr-ptbr-v1/fit-summary.json
benchmark/evidence/tmr-ptbr-v1/benchmark-report.json
benchmark/evidence/tmr-ptbr-v1/benchmark-report.md
benchmark/evidence/tmr-ptbr-v1/decision.json
benchmark/evidence/tmr-ptbr-v1/evidence-digest.json
~~~

Summaries contain counts, aggregate metrics, digests, model/browser identity, runtime parity, gate reasons and timestamps. `evidence-digest.json` contains `scientificEvidenceDigest` (identical to `release.evidenceDigest` and `benchmark-report.json.reportDigest`), the canonical sorted relative-file/hash inventory `files` of the other six evidence files, `calibrationSetDigest` and `publicationDigest`. Compute the latter exactly as `sha256(canonicalJson({schemaVersion: 1, files}))`; scientific/calibration digests are cross-checks outside that payload, and the manifest never hashes itself or the mutable bytes of `release.json`.

Every public file has a closed schema. Safe aggregate fields such as `predictionManifestDigests` are required where defined. Reject exact record-level keys `text`, `url`, `author`, `prompt`, `contentSha256`, `consentReceiptDigest`, `sourceIdentifier`, `records`, `recordIds`, `predictionRows` and `predictions`, any shard/raw path and arrays with at least 100 scalar IDs. Phase 2 `publish-profile` separately writes only the two model metadata files defined by Phase 1.

The verifier reads current model metadata separately and checks model identity, `gateDecision`, allowed `rolloutState`, `release.evidenceDigest`, `calibrationSetDigest` and exact `profileDigests`. It accepts the monotonic Phase 4 transition `pass/indicator -> pass/actions` without rewriting scientific evidence; `indicator-only` remains indicator and `reject` remains bundle-verified. A full release-file digest is deliberately absent so rollout activation cannot stale the immutable publication.

Make the Git allowlist equally closed:

~~~gitignore
benchmark/evidence/*
!benchmark/evidence/tmr-ptbr-v1/
benchmark/evidence/tmr-ptbr-v1/*
!benchmark/evidence/tmr-ptbr-v1/dataset-summary.json
!benchmark/evidence/tmr-ptbr-v1/split-summary.json
!benchmark/evidence/tmr-ptbr-v1/fit-summary.json
!benchmark/evidence/tmr-ptbr-v1/benchmark-report.json
!benchmark/evidence/tmr-ptbr-v1/benchmark-report.md
!benchmark/evidence/tmr-ptbr-v1/decision.json
!benchmark/evidence/tmr-ptbr-v1/evidence-digest.json
~~~

- [ ] **Step 4: Publish from the completed immutable run**

~~~powershell
$report = Get-Content benchmark/out/ptbr-v1/evaluate/benchmark-report.json -Raw | ConvertFrom-Json
npm run benchmark -- publish-profile --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --issued-at $report.generatedAt --model-dir models/tmr-ai-text-detector
npm run benchmark -- publish-evidence --source-readiness benchmark/out/ptbr-v1/validate/source-readiness.json --dataset-audit benchmark/out/ptbr-v1/validate/dataset-audit.json --split-artifact benchmark/out/ptbr-v1/split/split-artifact.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --fit-report benchmark/out/ptbr-v1/fit/fit-report.json --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --ledger benchmark/data/ptbr-linkedin-v1/private/holdout-ledger.jsonl --consumption-id $report.holdoutConsumptionId --model-dir models/tmr-ai-text-detector --output benchmark/evidence/tmr-ptbr-v1
~~~

Expected: both exit 0 and preserve the report decision/evidence SHA-256. `publish-evidence` requires the matching completed ledger event and refuses any other consumption. No override exists for decision, thresholds or expiry; `expiresAt = issuedAt + 180 * 86_400_000`. In `pass`, publication starts fail-closed at `rolloutState: "indicator"`; only Phase 4 may activate actions. In `reject`, profiles are empty and the descriptor stays `gateDecision: "reject"`, `rolloutState: "bundle-verified"`.

- [ ] **Step 5: Verify evidence and privacy**

Run: `npm run benchmark -- verify-evidence --report benchmark/out/ptbr-v1/evaluate/benchmark-report.json --frozen-calibration benchmark/out/ptbr-v1/fit/frozen-calibration.json --model-dir models/tmr-ai-text-detector`

Expected: PASS with byte-identical digests.

Run: `npm run benchmark -- verify-published-evidence --evidence-dir benchmark/evidence/tmr-ptbr-v1 --model-dir models/tmr-ai-text-detector`

Expected: PASS using only tracked evidence/model metadata; renaming `benchmark/out` must not affect the command.

Run: `rg -n -i '"(text|url|author|prompt|contentSha256|consentReceiptDigest|sourceIdentifier|records|recordIds|predictionRows|predictions)"\s*:' benchmark/evidence/tmr-ptbr-v1`

Expected: no matches.

Run: `npx vitest run benchmark/tests/evidence-sanitizer.test.ts benchmark/tests/profile-artifact.test.ts benchmark/tests/cli.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Stage only allowlisted evidence and commit**

Inspect `git status --short`; no `benchmark/data`, `benchmark/out`, `benchmark/work`, `public/models` or raw prediction path may be staged.

~~~powershell
git rm benchmark/evidence/tmr-ptbr-v1/.gitkeep
git add .gitignore benchmark/cli.ts benchmark/README.md benchmark/evidence-sanitizer.ts benchmark/commands/publish-evidence.ts benchmark/commands/verify-published-evidence.ts benchmark/tests/evidence-sanitizer.test.ts benchmark/tests/cli.test.ts benchmark/evidence/tmr-ptbr-v1/dataset-summary.json benchmark/evidence/tmr-ptbr-v1/split-summary.json benchmark/evidence/tmr-ptbr-v1/fit-summary.json benchmark/evidence/tmr-ptbr-v1/benchmark-report.json benchmark/evidence/tmr-ptbr-v1/benchmark-report.md benchmark/evidence/tmr-ptbr-v1/decision.json benchmark/evidence/tmr-ptbr-v1/evidence-digest.json models/tmr-ai-text-detector/release.json models/tmr-ai-text-detector/calibration-profiles.json
git diff --cached --check
git commit --no-verify -m "data: publish TMR PT-BR validation decision"
~~~

---

## Phase 3 checkpoint

- [ ] Confirm the seal reports exactly 10.000 records and all governance checks ready.
- [ ] Confirm split proportions, temporal ordering, connected-group isolation, unseen family and sample minima.
- [ ] Confirm development/calibration predictions are complete under one exact candidate/runtime-parity identity, Chrome for Testing `150.0.7871.129` and WASM.
- [ ] Confirm the frozen evaluator predates ledger `startedAt` and no test score entered fitting.
- [ ] Confirm the ledger completed exactly once and its result digest matches the report.
- [ ] Confirm `pass|indicator-only|reject` follows gates mechanically.
- [ ] Confirm committed evidence contains no record-level data and passes the privacy allowlist.
- [ ] Confirm release/profile artifacts match the decision and expire in exactly 180 days.

Run:

~~~powershell
npm run model:verify
npm run browser:install:test
npm run build:model-benchmark
npx vitest run benchmark/tests
npm run test:model-benchmark
npm run benchmark -- verify-published-evidence --evidence-dir benchmark/evidence/tmr-ptbr-v1 --model-dir models/tmr-ai-text-detector
npm run lint
npm run typecheck
git diff --check
git status --short
~~~

Expected: every command passes; status contains no sensitive dataset, run or model binary. Continue to Phase 4 only with the literal decision emitted here—never with an inferred/manual upgrade.
