# CleanFeed AI TMR/PT-BR — Phase 1 Model and Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o bundle ONNX quantizado do TMR de forma local, reproduzível e fail-closed, criando os contratos de runtime que as fases de benchmark, validação e release consumirão.

**Architecture:** A fase separa aquisição de fonte, materialização do bundle e promoção estatística. O runtime identifica integralmente modelo, agregação e conjunto de calibração; aplica o perfil exato quando existir; e troca uma única vez para o classificador estilométrico indicativo quando o TMR não puder produzir uma decisão segura.

**Tech Stack:** TypeScript 5.9, Node.js 22, Vite 8, Vitest 4, Transformers.js 4, ONNX Runtime via Transformers.js, Chrome MV3 e Playwright.

## Global Constraints

- Fixar `onnx-community/tmr-ai-text-detector-ONNX` na revisão imutável `b9aa251e5bcda7e429fcc936767d921435945b60`.
- O runtime e o build nunca acessam rede. Somente `npm run model:fetch` pode baixar artefatos, por URLs HTTPS derivadas do lock.
- O staging de fonte contém exatamente sete ativos upstream. O bundle materializado contém exatamente dez arquivos: os sete ativos mais `cleanfeed-model.json`, `LICENSE` e `NOTICE.md`.
- `models/tmr-ai-text-detector/license-review.json` usa somente `status: "pending" | "approved"`. A build normal continua disponível sem o binário. Release indicator/actions exige revisão `approved` e pacote TMR íntegro; release científico reject exige smoke do candidato e omite integralmente o TMR do pacote final.
- O TMR usa janelas de 510 tokens de conteúdo mais dois tokens especiais medidos no tokenizer, overlap 64 e no máximo oito janelas.
- A agregação v2 preserva separadamente `documentRawScore` e `localizedRawScore`; nenhum peso arbitrário combina os dois.
- Evidência `sufficient` exige tokenizer exato, cobertura >= 0,95, razão lexical >= 0,60, desvio-padrão <= 0,25 e concordância >= 0,50. As faixas intermediárias são `limited`; limites inferiores ou incompatibilidade produzem `unsupported`.
- Textos de 50–79 palavras têm teto `indicator`; abaixo de 50 palavras o caminho TMR se abstém no feed.
- Perfil TMR ausente, vencido ou incompatível sempre produz abstenção do TMR. O fallback estilométrico pode somente indicar.
- `bundle-verified` não apresenta resultado TMR. `shadow` executa apenas em desenvolvimento e sempre retorna `presentationAllowed: false`.
- Cache usa identidade do bundle, versão da agregação e digest do conjunto de calibração. O digest do perfil selecionado permanece no resultado e sua expiração limita o TTL.
- A inicialização faz no máximo uma troca imediata para o fallback. Três falhas operacionais do TMR em dez minutos abrem o circuit breaker até reinício, atualização ou nova tentativa explícita.
- Toda migração de contratos é atômica: atualize produtores, validadores, consumidores, fixtures e UI no mesmo task. Antes de cada commit rode testes focados e `npm run typecheck`.
- Commits usam paths explícitos em `git add` e `git commit --no-verify`; nunca use um diretório amplo para encobrir mudanças não relacionadas.

---

## Mapa de arquivos e responsabilidades

- `models/tmr-ai-text-detector/source-lock.json`: revisão, URLs, tamanhos e hashes dos sete ativos upstream.
- `models/tmr-ai-text-detector/cleanfeed-model.json`: manifesto fechado do bundle e parâmetros imutáveis de runtime.
- `models/tmr-ai-text-detector/{LICENSE,NOTICE.md,license-review.json}`: licença distribuída, atribuição e aprovação humana.
- `models/tmr-ai-text-detector/{calibration-profiles.json,release.json}`: templates canônicos que a Fase 2 substitui por evidência publicada.
- `contracts/{canonical-json,content-composition,calibration-profile,model-release}.ts`: contratos compartilhados pelo runtime e benchmark.
- `scripts/{model-lock,acquire-model-assets,verify-model-bundle,run-release-build,run-real-model-tests}.mjs`: aquisição atômica, verificação e gates.
- `src/inference/{model-bundle,model-catalog,backend-selector,tokenizer,chunker,aggregator,calibration-registry,calibration}.ts`: bundle, execução, agregação e política estatística.
- `src/shared/types.ts`: identidade, evidência, decisão, resultado e status transmitidos entre contextos.
- `src/offscreen/worker-host.ts`, `src/inference/inference-worker.ts`, `src/inference/worker-protocol.ts`: lifecycle primário/fallback e transporte validado.
- `src/storage/cache.ts`, `src/background/message-router.ts`: chave de cache integral, TTL e circuit breaker.
- `src/content/presentation/presentation-controller.ts`: aplicação fail-closed do teto decidido pelo runtime.
- `tests/e2e/real-model-smoke.spec.ts`: execução do modelo real em Chrome, sem substituir o gateway por fake.

### Task 1: Fixar e adquirir atomicamente os sete ativos upstream

**Files:**

- Create: `models/tmr-ai-text-detector/source-lock.json`
- Create: `models/tmr-ai-text-detector/LICENSE`
- Create: `models/tmr-ai-text-detector/NOTICE.md`
- Create: `models/tmr-ai-text-detector/license-review.json`
- Create: `scripts/model-lock.mjs`
- Create: `scripts/model-lock.d.mts`
- Create: `scripts/acquire-model-assets.mjs`
- Create: `tests/unit/scripts/model-lock.test.ts`
- Create: `tests/integration/model-acquisition.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**

- Produces: `SOURCE_ARTIFACTS`, `readSourceLock(path)`, `verifyStagedAssets(directory, lock)` e `replaceDirectoryAtomically(staging, target, fsAdapter)`.
- Consumes: apenas Node `fs`, `crypto`, `path` e `fetch`; nenhum módulo do runtime.

- [ ] **Step 1: Escrever o lock fechado e a revisão de licença**

`source-lock.json` deve declarar `schemaVersion: 1`, a revisão fixa, `baseUrl: "https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/b9aa251e5bcda7e429fcc936767d921435945b60/"` e este inventário literal:

| path | bytes | sha256 |
| --- | ---: | --- |
| `config.json` | 866 | `d9d45b537b9cf386a0ce958f8b2f840b0529ed846e45c4e26bc53a62dcb06f1f` |
| `merges.txt` | 456318 | `1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5` |
| `onnx/model_int8.onnx` | 125855418 | `a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79` |
| `special_tokens_map.json` | 958 | `f23c8e6099631c233c16d9bf8dab198f610826cdd1b358f270f6d55c1863e857` |
| `tokenizer.json` | 3558741 | `1f33749d010b4d63908e5c174c341622cb45039dd73a139dcd95bd74cc7e304b` |
| `tokenizer_config.json` | 1354 | `288b4077af1ffb3beead6d96fccfc93beb2df9b689cbb038c4eb329165efc43a` |
| `vocab.json` | 798293 | `ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e` |

`license-review.json` começa exatamente assim e somente uma revisão humana altera o status:

```json
{
  "schemaVersion": 1,
  "modelId": "tmr-ai-text-detector",
  "status": "pending",
  "declaredLicense": "MIT",
  "reviewedAt": null,
  "reviewer": null,
  "evidence": []
}
```

Copie para `LICENSE` o texto MIT da revisão fixada e registre em `NOTICE.md` o repositório, revisão, arquivo ONNX e obrigação de redistribuição. Ignore `public/models/tmr-ai-text-detector/`, mas não ignore `models/tmr-ai-text-detector/`.

- [ ] **Step 2: Escrever testes vermelhos do lock e do staging de sete arquivos**

Os testes criam diretórios temporários e afirmam:

```ts
expect(lock.artifacts.map((item) => item.path)).toEqual([
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);
await expect(verifyStagedAssets(validSeven, lock)).resolves.toEqual({ fileCount: 7 });
await expect(verifyStagedAssets(withExtraFile, lock)).rejects.toMatchObject({ code: "UNEXPECTED_ARTIFACT" });
```

Cubra arquivo ausente, tamanho incorreto, hash incorreto, path absoluto, `..`, URL fora do host/revisão fixados e duplicidade normalizada de path.

- [ ] **Step 3: Executar os testes para observar a falha esperada**

Run: `npx vitest run tests/unit/scripts/model-lock.test.ts tests/integration/model-acquisition.test.ts`

Expected: FAIL por módulos `scripts/model-lock.mjs` e `scripts/acquire-model-assets.mjs` inexistentes.

- [ ] **Step 4: Implementar parser fechado e aquisição sem rede implícita**

`readSourceLock` rejeita chaves desconhecidas, exige sete paths relativos POSIX e compara tamanho/hash em streaming. `acquireModelAssets` recebe dependências testáveis:

```ts
export interface AcquireDependencies {
  fetch: typeof globalThis.fetch;
  randomUUID(): string;
  fs: AtomicDirectoryFs;
}

export async function acquireModelSourceAssets(options: {
  lockPath: string;
  stagingParent: string;
  dependencies?: Partial<AcquireDependencies>;
}): Promise<{ fileCount: 7; stagingDirectory: string }>;
```

Baixe cada resposta para `public/models/.tmr-ai-text-detector.source-<uuid>`, usando `redirect: "error"`, status 200, limite de bytes e hash incremental. `verifyStagedAssets` valida que esse source staging contém exatamente os sete ativos. Esta função não renomeia source staging para o target público: somente a Task 2, depois de acrescentar os três metadados, promove um bundle de dez arquivos.

- [ ] **Step 5: Tornar a substituição de diretório recuperável no Windows**

`replaceDirectoryAtomically` deve: validar paths absolutos irmãos; renomear target existente para `.backup-<uuid>`; renomear staging para target; restaurar o backup se a segunda renomeação falhar; e apagar o backup somente depois do sucesso. Nunca faça remoção recursiva fora do pai validado. Nesta task ele é exercitado com diretórios sintéticos; o fluxo real passa a chamá-lo somente após materialização 10/10 na Task 2.

Teste os cenários target ausente, target preexistente, falha na primeira renomeação, falha na segunda renomeação com rollback e nova execução após sucesso. O fake de `fetch` devolve bytes locais e lança se receber uma URL não prevista, provando que o teste não usa rede.

- [ ] **Step 6: Expor comandos e validar a task**

Adicionar:

```json
{
  "model:verify:assets": "node scripts/model-lock.mjs --verify public/models/tmr-ai-text-detector"
}
```

Run: `npx vitest run tests/unit/scripts/model-lock.test.ts tests/integration/model-acquisition.test.ts`

Expected: PASS, incluindo rollback e inventário 7/7.

Run: `npm run typecheck`

Expected: exit 0 antes do commit.

- [ ] **Step 7: Commit com paths explícitos**

```bash
git add scripts/model-lock.mjs scripts/model-lock.d.mts scripts/acquire-model-assets.mjs models/tmr-ai-text-detector/source-lock.json models/tmr-ai-text-detector/LICENSE models/tmr-ai-text-detector/NOTICE.md models/tmr-ai-text-detector/license-review.json tests/unit/scripts/model-lock.test.ts tests/integration/model-acquisition.test.ts package.json .gitignore
git commit --no-verify -m "build: pin atomic TMR asset acquisition"
```

### Task 2: Materializar e verificar o bundle fechado de dez arquivos

**Files:**

- Create: `models/tmr-ai-text-detector/cleanfeed-model.json`
- Create: `models/tmr-ai-text-detector/calibration-profiles.json`
- Create: `models/tmr-ai-text-detector/release.json`
- Create: `scripts/verify-model-bundle.mjs`
- Create: `scripts/verify-model-bundle.d.mts`
- Create: `scripts/run-release-build.mjs`
- Create: `src/inference/bundled-model-metadata.ts`
- Create: `tests/helpers/model-fixtures.ts`
- Create: `tests/unit/scripts/model-bundle-verifier.test.ts`
- Create: `tests/integration/release-build-gate.test.ts`
- Modify: `scripts/acquire-model-assets.mjs`
- Modify: `scripts/audit-build.mjs`
- Modify: `scripts/sanitize-offline-bundle.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `verifyModelMetadata`, `verifyMaterializedBundle`, `computeBundleDigest`, `computeTokenizerDigest`, `runReleaseBuild` e fixtures `createModelManifestV2`, `createCalibrationProfilesFileV1`, `createReleaseDescriptorV1`.
- Consumes: `readSourceLock` e `verifyStagedAssets` da Task 1.

- [ ] **Step 1: Escrever manifesto e descritores iniciais canônicos**

`cleanfeed-model.json` usa `schemaVersion: 2` e fixa:

```json
{
  "schemaVersion": 2,
  "modelId": "tmr-ai-text-detector",
  "modelVersion": "b9aa251e5bcda7e429fcc936767d921435945b60",
  "task": "text-classification",
  "backend": "transformers-onnx",
  "modelFile": "onnx/model_int8.onnx",
  "aggregationVersion": "tmr-aggregation-v2",
  "contentCompositionVersion": "lexical-content-v1",
  "tokenizerDigest": "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
  "windowing": { "modelMaxTokens": 512, "contentTokens": 510, "overlapTokens": 64, "maxWindows": 8 },
  "artifacts": [],
  "bundleDigest": "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c"
}
```

Substitua `artifacts: []` pelos sete registros exatos do lock, em ordem lexicográfica. O digest do bundle é SHA-256 do JSON canônico desses sete registros; não inclui o próprio manifesto nem os metadados legais. A canonicalização é exata e não negociável: array JSON dos registros ordenados lexicograficamente por `path`, cada registro serializado com as chaves em ordem alfabética (`bytes`, `path`, `sha256`), separadores compactos (`,` e `:`, sem espaços nem quebras de linha) e sem newline final — em Node, `JSON.stringify(records.map(({bytes,path,sha256}) => ({bytes,path,sha256})))`; em Python, `json.dumps(records, separators=(",",":"), sort_keys=True)`. `computeTokenizerDigest` usa a mesma canonicalização sobre o subconjunto ordenado `merges.txt`, `special_tokens_map.json`, `tokenizer.json`, `tokenizer_config.json` e `vocab.json`, produzindo exatamente `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9` (valor reverificado contra os bytes reais dos cinco arquivos; o `bundleDigest` `32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c` foi reverificado com o registro pinado do `onnx/model_int8.onnx`).

`calibration-profiles.json` começa como `{"schemaVersion":1,"profiles":[]}`. `release.json` começa em `bundle-verified`, `gateDecision: "pending"`, `profileDigests: []`, `evidenceDigest: null` e traz o digest canônico do conjunto vazio. `src/inference/bundled-model-metadata.ts` importa os três JSON versionados por `resolveJsonModule`; Vite os incorpora ao código. Release/perfis não entram no diretório materializado de dez arquivos nesta fase.

- [ ] **Step 2: Escrever testes vermelhos para inventário 10 e gate de licença**

Use os helpers concretos para construir fixtures em diretório temporário. Afirme que o conjunto aceito é exatamente:

```ts
expect(materializedPaths).toEqual([
  "LICENSE",
  "NOTICE.md",
  "cleanfeed-model.json",
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);
```

Cubra manifesto com artifact extra/ausente, hash ou tamanho alterado, `bundleDigest` ou `tokenizerDigest` divergente, metadado legal ausente, `license-review.json` copiado indevidamente ao bundle, licença `pending` e release `bundle-verified/pending` no gate de release. Mesmo com licença approved, decisão pending precisa falhar. Cubra também reject publicado: exige smoke exato do candidato, executa build fallback e falha se `dist/models/tmr-ai-text-detector` existir.

- [ ] **Step 3: Executar os testes para observar a falha esperada**

Run: `npx vitest run tests/unit/scripts/model-bundle-verifier.test.ts tests/integration/release-build-gate.test.ts`

Expected: FAIL porque o verificador e `build:release` ainda não existem.

- [ ] **Step 4: Implementar materialização 7 → 10 e verificação em runtime**

Depois de verificar os sete downloads, `acquire-model-assets.mjs` copia `cleanfeed-model.json`, `LICENSE` e `NOTICE.md` da árvore versionada para um novo materialized staging, executa `verifyMaterializedBundle` e somente então chama `replaceDirectoryAtomically`. Uma segunda aquisição parte de novos source/materialized stagings; nunca mistura arquivos com o target existente. Em `finally`, apaga somente os stagings irmãos validados.

`verifyMaterializedBundle` rejeita qualquer diferença de conjunto e verifica sequencialmente os sete ativos para limitar memória. `verifyModelMetadata` valida os JSON versionados mesmo quando o binário local não existe, permitindo CI e build de desenvolvimento.

- [ ] **Step 5: Criar o gate `build:release` sem dependência de shell Unix**

`runReleaseBuild` primeiro rejeita `gateDecision: "pending"`. Para `reject`, exige `rolloutState: "bundle-verified"`, `evidenceDigest` não nulo e perfis vazios; verifica e roda o smoke exato do candidato local, então constrói em modo fallback e exige ausência total do diretório TMR em `dist`. Para indicator/actions, exige licença approved, bundle íntegro, perfis não vazios, `calibrationSetDigest` válido e gateDecision indicator-only/pass coerente. Use `process.execPath` + `process.env.npm_execpath`:

```ts
await runNode(process.execPath, [process.env.npm_execpath!, "run", "test:model:smoke"], { stdio: "inherit" });
await runNode(process.execPath, [process.env.npm_execpath!, "run", "build"], {
  stdio: "inherit",
  env: { ...process.env, CLEANFEED_MODEL_RELEASE_MODE: release.gateDecision === "reject" ? "reject" : "package" },
});
```

Se `npm_execpath` estiver ausente, retorne `NPM_EXEC_PATH_MISSING`; pending retorna `MODEL_RELEASE_NOT_PROMOTED`; indicator/actions com licença pending retorna `MODEL_LICENSE_NOT_APPROVED`. `sanitize-offline-bundle.mjs` aceita somente `CLEANFEED_MODEL_RELEASE_MODE=reject|package`: no branch reject remove o diretório TMR apenas dentro do `dist` resolvido/validado; no branch package não remove nada. Em reject, `audit-build.mjs` exige que o diretório TMR esteja ausente; em indicator/actions, confirma o inventário permitido e delega ao verificador. Antes da Task 9 existir, a chamada ausente a `test:model:smoke` faz qualquer release falhar fechado; a Task 9 fornece esse gate separado sem criar ciclo com `build:release`.

- [ ] **Step 6: Expor scripts e validar build normal e release fail-closed**

Adicionar:

```json
{
  "model:verify:metadata": "node scripts/verify-model-bundle.mjs --metadata",
  "model:fetch": "node scripts/acquire-model-assets.mjs",
  "model:verify": "node scripts/verify-model-bundle.mjs --bundle public/models/tmr-ai-text-detector",
  "audit:model": "node scripts/verify-model-bundle.mjs --bundle dist/models/tmr-ai-text-detector",
  "build:release": "node scripts/run-release-build.mjs"
}
```

Run: `npx vitest run tests/unit/scripts/model-bundle-verifier.test.ts tests/integration/release-build-gate.test.ts`

Expected: PASS; os testes capturam `MODEL_RELEASE_NOT_PROMOTED`, `MODEL_LICENSE_NOT_APPROVED`, reject sem smoke e diretório TMR indevido no pacote reject. Um runner injetado prova que reject bem formado chama smoke antes de build/audit fallback.

Run: `npm run model:verify:metadata && npm run build`

Expected: exit 0 sem exigir o ONNX.

Run: `npm run typecheck`

Expected: exit 0 antes do commit.

- [ ] **Step 7: Commit com paths explícitos**

```bash
git add scripts/verify-model-bundle.mjs scripts/verify-model-bundle.d.mts scripts/run-release-build.mjs scripts/acquire-model-assets.mjs scripts/audit-build.mjs scripts/sanitize-offline-bundle.mjs src/inference/bundled-model-metadata.ts models/tmr-ai-text-detector/cleanfeed-model.json models/tmr-ai-text-detector/calibration-profiles.json models/tmr-ai-text-detector/release.json tests/helpers/model-fixtures.ts tests/unit/scripts/model-bundle-verifier.test.ts tests/integration/release-build-gate.test.ts package.json
git commit --no-verify -m "build: verify closed TMR model bundle"
```

### Task 3: Criar contratos canônicos, composição lexical e identidade integral

**Files:**

- Create: `contracts/canonical-json.ts`
- Create: `contracts/content-composition.ts`
- Create: `contracts/calibration-profile.ts`
- Create: `contracts/model-release.ts`
- Create: `tests/unit/contracts/canonical-json.test.ts`
- Create: `tests/unit/contracts/content-composition.test.ts`
- Create: `tests/unit/contracts/calibration-profile.test.ts`
- Create: `tests/unit/contracts/model-release.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/message-validation.ts`
- Modify: `src/inference/mock-classifier.ts`
- Modify: `src/inference/stylometric-classifier.ts`
- Modify: `src/inference/onnx-classifier.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/offscreen/worker-host.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/manual-analysis/components/ManualResult.tsx`
- Modify: `src/options/components/ModelSettings.tsx`
- Modify: `src/popup/components/ModelStatusCard.tsx`
- Modify: `tests/helpers/model-fixtures.ts`
- Modify: `tests/setup/chrome.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Modify: `eslint.config.js`

**Interfaces:**

- Produces: `canonicalJson`, `canonicalSha256`, `computeContentComposition`, `parseCalibrationProfilesFileV1`, `computeCalibrationProfileDigest`, `parseModelReleaseDescriptorV1`, `computeCalibrationSetDigest` e os contratos públicos abaixo.
- Consumes: Web Crypto no browser e `node:crypto` apenas no adaptador Node; ambos recebem exatamente os bytes UTF-8 canônicos.

- [ ] **Step 1: Escrever testes vermelhos de serialização e composição compartilhada**

`canonicalJson` ordena recursivamente chaves de objetos simples, preserva ordem de arrays, usa `JSON.stringify` compacto sem newline e rejeita `undefined`, valores não finitos, protótipos não simples e chaves desconhecidas antes do digest. Fixe estes vetores:

```ts
expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
expect(await canonicalSha256([])).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
```

Para `CONTENT_COMPOSITION_VERSION = "lexical-content-v1"`, normalize CRLF para LF, separe unidades por whitespace Unicode e classifique, nesta precedência: URL; hashtag; sequência somente emoji/modifier/variation-selector/ZWJ; lexical quando contém letra ou número Unicode; other. `lexicalRatio = lexicalUnits / totalUnits`, ou zero para entrada vazia.

Teste uma fixture literal com URL, hashtag, emoji composto, palavras acentuadas e números tanto em `eligibility` quanto no contrato; os dois devem retornar contagens idênticas. Isso impede que benchmark e runtime criem definições concorrentes.

- [ ] **Step 2: Escrever os contratos fechados de calibração e release**

Use estas uniões discriminadas:

```ts
export type SerializedCalibratorV1 =
  | { kind: "platt"; slope: number; intercept: number }
  | { kind: "beta"; alpha: number; beta: number; intercept: number }
  | {
      kind: "isotonic";
      interpolation: "linear";
      clamp: true;
      knots: Array<{ rawScore: number; calibratedScore: number }>;
    };

export interface ProportionGateEvidenceV1 {
  estimate: number;
  lowerBound95: number;
  upperBound95: number;
  sampleSize: number;
}
```

O branch isotonic interpola linearmente entre knots estritamente crescentes e faz clamp nas extremidades; nunca use função degrau. Platt e beta preservam o calibrador vencedor do benchmark.

```ts
export interface RuntimeCalibrationProfileV1 {
  schemaVersion: 1;
  profileId: string;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  platform: string;
  locale: "pt-BR";
  lengthBucket: "50-79" | "80-199" | "200-plus";
  aggregationVersion: string;
  contentCompositionVersion: string;
  datasetDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
  issuedAt: string;
  expiresAt: string;
  calibrators: { document: SerializedCalibratorV1; localized: SerializedCalibratorV1 };
  thresholds: { documentIndicator: number; localizedIndicator: number; documentAction: number };
  evidencePolicy: {
    minimumCoverage: number;
    minimumLexicalRatio: number;
    maximumStdDev: number;
    minimumChunkAgreement: number;
    exactTokenizerRequired: true;
  };
  gateEvidence: {
    decision: "indicator-only" | "pass";
    intervalMethod: "wilson-one-sided-95";
    ece: { value: number; bins: 15; sampleSize: number };
    overall: {
      indicatorFpr: ProportionGateEvidenceV1;
      indicatorRecall: ProportionGateEvidenceV1;
      actionFpr: ProportionGateEvidenceV1;
      actionRecall: ProportionGateEvidenceV1;
      coverage: ProportionGateEvidenceV1;
      mixedRecall: ProportionGateEvidenceV1;
    };
    criticalFprSlices: Record<string, {
      indicatorFpr: ProportionGateEvidenceV1;
      actionFpr: ProportionGateEvidenceV1;
    }>;
    criticalRecallSlices: Record<string, {
      indicatorRecall: ProportionGateEvidenceV1;
      actionRecall: ProportionGateEvidenceV1 | null;
    }>;
  };
  actionCeiling: "indicator" | "hide";
  profileDigest: string;
}

export interface CalibrationProfilesFileV1 {
  schemaVersion: 1;
  profiles: RuntimeCalibrationProfileV1[];
}
```

`computeCalibrationProfileDigest` exclui somente `profileDigest`. O parser exige `expiresAt = issuedAt + 180 dias` em UTC, digest correto, knots/thresholds finitos em [0,1], ECE com exatamente 15 bins, pelo menos 2.000 negativos overall para aprovação de FPR, `sampleSize >= 300` em cada entrada de `criticalFprSlices` e `sampleSize >= 200` em cada recall não nulo de `criticalRecallSlices`. Um slice de ação não aplicável usa `actionRecall: null`, nunca omite o campo. Reject publica o arquivo de perfis vazio e, portanto, não pertence à união do perfil. `indicator-only` exige `actionCeiling: "indicator"` e `documentAction: 1`; a faixa `50-79` sempre exige teto indicator; `pass` pode usar `hide` nas outras faixas somente quando os bounds de 5%/2%, recall, cobertura, mistos e ECE comprovam os gates.

```ts
export type RolloutState = "bundle-verified" | "shadow" | "indicator" | "actions";
export type GateDecision = "pending" | "reject" | "indicator-only" | "pass";

export interface ModelReleaseDescriptorV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  calibrationSetDigest: string;
  profileDigests: string[];
  rolloutState: RolloutState;
  gateDecision: GateDecision;
  issuedAt: string | null;
  evidenceDigest: string | null;
}
```

`computeCalibrationSetDigest` ordena e deduplica os digests, serializa o array canônico e aplica SHA-256. O conjunto vazio vale `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`. O descritor não contém estado ou campo de fallback. `bundle-verified` aceita pending sem evidência ou reject com `issuedAt/evidenceDigest` não nulos, sempre com perfis vazios; `shadow` nunca autoriza apresentação; `indicator` exige `indicator-only` ou `pass`; `actions` exige `pass` e ao menos um perfil com teto hide.

- [ ] **Step 3: Executar os testes de contrato para observar a falha esperada**

Run: `npx vitest run tests/unit/contracts/canonical-json.test.ts tests/unit/contracts/content-composition.test.ts tests/unit/contracts/calibration-profile.test.ts tests/unit/contracts/model-release.test.ts`

Expected: FAIL por imports ausentes em `contracts/`.

- [ ] **Step 4: Implementar os contratos e incluir `contracts/` em todas as ferramentas**

Implemente parsers de schema fechado sem coerção. Adicione `contracts` ao `include` de `tsconfig.json`; adicione `scripts/**/*.d.mts` e os configs Playwright novos ao `tsconfig.node.json`; e inclua `contracts/**/*.{ts,tsx}` no bloco TypeScript do ESLint. Exporte os mesmos tipos para runtime e benchmark; nenhum deles redefine o shape.

Refatore `src/inference/eligibility.ts` para importar `computeContentComposition`; a Fase 2 deve importar a mesma função. A versão da composição e o digest exato do tokenizer entram no perfil, release, identidade e cache.

- [ ] **Step 5: Migrar identidade, evidência, decisão e status atomicamente**

Em `src/shared/types.ts`, defina:

```ts
export type RuntimeModelIdentity =
  | {
      kind: "bundle";
      modelId: string;
      modelVersion: string;
      bundleDigest: string;
      tokenizerDigest: string;
      aggregationVersion: string;
      contentCompositionVersion: string;
      calibrationSetDigest: string;
    }
  | {
      kind: "builtin";
      modelId: "mock" | "stylometric";
      modelVersion: string;
      implementationVersion: string;
    };

export type EvidenceQuality = "sufficient" | "limited" | "unsupported";
export type DecisionTrigger = "document" | "localized";
```

`DecisionReasonCode` deve enumerar ao menos `LOCALIZED_SIGNAL`, `LIMITED_EVIDENCE`, `UNSUPPORTED_LANGUAGE`, `TEXT_TOO_SHORT`, `LOW_COVERAGE`, `TRUNCATED_INPUT`, `TOKENIZER_APPROXIMATE`, `NON_LEXICAL_CONTENT`, `CHUNK_DISAGREEMENT`, `MODEL_PROFILE_MISSING`, `MODEL_PROFILE_MISMATCH`, `PROFILE_EXPIRED`, `BACKEND_ERROR`, `ARTIFACT_MISMATCH`, `DOCUMENT_EVIDENCE_PENDING` e `CIRCUIT_BREAKER_OPEN`.

```ts
export interface EvidenceAssessment {
  quality: EvidenceQuality;
  coverage: number;
  lexicalRatio: number;
  truncated: boolean;
  exactTokenizer: boolean;
  reasonCodes: DecisionReasonCode[];
}

export interface DecisionOutcome {
  status: ClassificationStatus;
  calibratedScore: number;
  actionCeiling: PresentationMode;
  abstained: boolean;
  presentationAllowed: boolean;
  triggers: DecisionTrigger[];
  reasonCodes: DecisionReasonCode[];
}
```

`ClassificationResult` mantém `confidence` por compatibilidade, mas torna obrigatórios `evidence`, `runtimeIdentity` e `decision`; adiciona `selectedProfileDigest?: string` e `cacheValidUntil?: string`. `selectedProfileDigest` identifica apenas o perfil usado naquela requisição e nunca entra no status global.

```ts
export interface ModelStatus {
  state: "unavailable" | "initializing" | "ready" | "degraded" | "disposing" | "error";
  backend: Backend;
  runtimeIdentity: RuntimeModelIdentity | null;
  calibrationCoverage: "none" | "partial" | "complete";
  calibrationSetDigest: string | null;
  profileCount: number;
  earliestExpiry: string | null;
  reasonCodes: DecisionReasonCode[];
  initializedAt?: number;
  supportsBatching?: boolean;
}
```

Atualize no mesmo step todo produtor, validator fechado, mensagem Chrome, mock, fixture, status card, opções e análise manual. Não deixe um commit intermediário em que `ClassificationResult` ou `ModelStatus` compile apenas parcialmente. `ModelStatus` representa o conjunto carregado: `none` para zero perfis, `partial` quando faltam coordenadas suportadas e `complete` somente quando todas as coordenadas declaradas no release têm perfil válido.

- [ ] **Step 6: Completar factories válidas e testes de protocolo/UI**

`tests/helpers/model-fixtures.ts` exporta factories completas com overrides profundos: `createModelManifestV2`, `createCalibrationProfileV1`, `createCalibrationProfilesFileV1`, `createReleaseDescriptorV1`, `createBundleRuntimeIdentity`, `createBuiltinRuntimeIdentity`, `createEvidenceAssessment`, `createDecisionOutcome`, `createClassificationResult` e `createModelStatus`. Cada factory calcula seus digests depois dos overrides; não use casts para omitir campos obrigatórios.

Teste arrays `triggers` com zero, um e dois elementos; rejeite duplicados e ordem não canônica (`document` antes de `localized`). Teste status de conjunto com zero, parte e todas as coordenadas, sem campo singular de perfil.

- [ ] **Step 7: Validar a migração atômica**

Run: `npx vitest run tests/unit/contracts tests/unit/inference tests/unit/offscreen tests/unit/background/message-router.test.ts tests/unit/popup/model-status.test.tsx tests/unit/manual-analysis/App.test.tsx`

Expected: PASS sem resultado ou status antigo aceito pelo protocolo.

Run: `npm run typecheck && npm run lint`

Expected: ambos retornam exit 0 antes do commit.

- [ ] **Step 8: Commit com paths explícitos**

```bash
git add contracts/canonical-json.ts contracts/content-composition.ts contracts/calibration-profile.ts contracts/model-release.ts src/shared/types.ts src/shared/message-validation.ts src/inference/eligibility.ts src/inference/mock-classifier.ts src/inference/stylometric-classifier.ts src/inference/onnx-classifier.ts src/inference/inference-worker.ts src/offscreen/worker-host.ts src/background/message-router.ts src/manual-analysis/components/ManualResult.tsx src/options/components/ModelSettings.tsx src/popup/components/ModelStatusCard.tsx tests/helpers/model-fixtures.ts tests/setup/chrome.ts tests/unit/contracts/canonical-json.test.ts tests/unit/contracts/content-composition.test.ts tests/unit/contracts/calibration-profile.test.ts tests/unit/contracts/model-release.test.ts tsconfig.json tsconfig.node.json eslint.config.js
git commit --no-verify -m "feat: define canonical model evidence contracts"
```

### Task 4: Unificar tokenizer real, locale e limites de janela

**Files:**

- Create: `src/inference/model-runtime.ts`
- Create: `tests/unit/inference/model-runtime.test.ts`
- Modify: `src/inference/classifier.ts`
- Modify: `src/inference/backend-selector.ts`
- Modify: `src/inference/transformers-environment.ts`
- Modify: `src/inference/tokenizer.ts`
- Modify: `src/inference/chunker.ts`
- Modify: `src/inference/language-detector.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/settings-types.ts`
- Modify: `src/shared/validation.ts`
- Modify: `src/options/components/PerformanceSettings.tsx`
- Modify: `tests/unit/inference/backend-selector.test.ts`
- Modify: `tests/unit/inference/transformers-tokenizer.test.ts`
- Modify: `tests/unit/inference/chunker.test.ts`
- Modify: `tests/unit/inference/language-detector.test.ts`
- Modify: `tests/unit/options/performance-settings.test.tsx`
- Modify: `docs/inference-pipeline.md`
- Modify: `docs/model-integration.md`

**Interfaces:**

- Produces: `ModelRuntime`, `ExactTokenizer`, `normalizeCalibrationLocale`, `createTmrChunkPlan`.
- Consumes: manifesto v2 e `RuntimeModelIdentity` da Task 3.

- [ ] **Step 1: Escrever testes vermelhos do runtime coeso**

Defina o seam único:

```ts
export interface ModelRuntime {
  classifier: TextClassifier;
  tokenizer: ExactTokenizer;
  identity: RuntimeModelIdentity;
  chunkPlan: { modelMaxTokens: number; contentTokens: number; overlapTokens: number; maxWindows: number };
}
```

Teste que backend e tokenizer vêm da mesma carga de assets; que `normalizeCalibrationLocale("pt")` e `normalizeCalibrationLocale("pt-BR")` retornam `pt-BR`; e que variantes fora dessa lista não selecionam perfil PT-BR.

Para o tokenizer real, faça um probe com `add_special_tokens` ligado e desligado e afirme que a diferença é exatamente o valor reservado pelo manifesto. O teste deve falhar se a implementação apenas escrever o literal 2 sem medir o tokenizer carregado.

- [ ] **Step 2: Executar os testes para observar a falha esperada**

Run: `npx vitest run tests/unit/inference/model-runtime.test.ts tests/unit/inference/transformers-tokenizer.test.ts tests/unit/inference/chunker.test.ts tests/unit/inference/language-detector.test.ts`

Expected: FAIL porque `ModelRuntime`, offsets nativos e normalização canônica ainda não existem.

- [ ] **Step 3: Implementar tokenizer exato com offsets nativos**

`ExactTokenizer.encodeWithOffsets(text)` usa `return_offsets_mapping: true` no tokenizer Transformers efetivamente carregado e retorna token ids, offsets de caracteres e `specialTokenCount`. Meça os tokens especiais uma vez na inicialização; exija 2 para este manifesto e derive `contentTokens = modelMaxTokens - specialTokenCount`. Não reconstrua offsets por busca de substrings e não use o tokenizer heurístico no TMR.

`transformers-environment.ts` continua com `allowRemoteModels = false`, `allowLocalModels = true` e URLs obtidas exclusivamente por `chrome.runtime.getURL`. Um teste intercepta `fetch` e rejeita qualquer `http:` ou `https:`.

- [ ] **Step 4: Alinhar configurações e chunker na mesma migração**

Atualize constantes, schema de settings, defaults e `PerformanceSettings` para aceitar `maximumTokens: 512`, `chunkSize: 510` e `chunkOverlap: 64`. O chunker TMR ignora esses campos editáveis e sempre usa o `chunkPlan` do manifesto; eles continuam disponíveis somente para runtimes experimentais/builtin compatíveis.

Faça a mudança de limite nesta task, antes da agregação: não deixe `maximumTokens: 256` convivendo com o modelo 512 em nenhum commit. Teste primeiro/último offset, overlap exato, caracteres Unicode e ausência de token cortado.

- [ ] **Step 5: Normalizar locale antes de suporte e lookup de perfil**

`normalizeCalibrationLocale` recebe BCP-47, normaliza case e permite somente `pt`/`pt-BR` como `pt-BR`. `language-detector`, worker e registry usam o valor normalizado antes de decidir `supported` ou formar a chave de perfil. `pt-PT`, `en` e linguagem desconhecida permanecem unsupported para TMR.

- [ ] **Step 6: Validar runtime e UI de limites**

Run: `npx vitest run tests/unit/inference/model-runtime.test.ts tests/unit/inference/backend-selector.test.ts tests/unit/inference/transformers-tokenizer.test.ts tests/unit/inference/chunker.test.ts tests/unit/inference/language-detector.test.ts tests/unit/options/performance-settings.test.tsx`

Expected: PASS com 512 total, 510 de conteúdo, dois especiais medidos e overlap 64.

Run: `npm run typecheck && npm run lint`

Expected: ambos retornam exit 0 antes do commit.

- [ ] **Step 7: Commit com paths explícitos**

```bash
git add src/inference/model-runtime.ts src/inference/classifier.ts src/inference/backend-selector.ts src/inference/transformers-environment.ts src/inference/tokenizer.ts src/inference/chunker.ts src/inference/language-detector.ts src/inference/inference-worker.ts src/shared/constants.ts src/shared/settings-types.ts src/shared/validation.ts src/options/components/PerformanceSettings.tsx tests/unit/inference/model-runtime.test.ts tests/unit/inference/backend-selector.test.ts tests/unit/inference/transformers-tokenizer.test.ts tests/unit/inference/chunker.test.ts tests/unit/inference/language-detector.test.ts tests/unit/options/performance-settings.test.tsx docs/inference-pipeline.md docs/model-integration.md
git commit --no-verify -m "feat: align TMR tokenizer and window limits"
```

### Task 5: Implementar seleção distribuída, agregação v2 e qualidade de evidência

**Files:**

- Create: `src/inference/evidence.ts`
- Create: `tests/unit/inference/evidence.test.ts`
- Modify: `src/inference/chunker.ts`
- Modify: `src/inference/aggregator.ts`
- Modify: `src/inference/calibration.ts`
- Modify: `src/inference/explanation.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/unit/inference/chunker.test.ts`
- Modify: `tests/unit/inference/aggregator.test.ts`
- Modify: `tests/unit/inference/calibration.test.ts`
- Modify: `tests/unit/inference/explanation.test.ts`
- Modify: `tests/integration/inference-pipeline.test.ts`

**Interfaces:**

- Produces: `distributedIndices(total, limit)`, `aggregateWindowsV2(windows, totalTokenCount)`, `assessEvidence(input)` e `AggregationResultV2`.
- Consumes: offsets nativos e `CONTENT_COMPOSITION_VERSION` das Tasks 3–4.

- [ ] **Step 1: Escrever testes vermelhos da seleção de no máximo oito janelas**

Use a fórmula literal `round(i * (total - 1) / (limit - 1))` para `i = 0..limit-1`, eliminando duplicatas defensivamente. Fixe:

```ts
expect(distributedIndices(0, 8)).toEqual([]);
expect(distributedIndices(3, 8)).toEqual([0, 1, 2]);
expect(distributedIndices(20, 8)).toEqual([0, 3, 5, 8, 11, 14, 16, 19]);
```

A primeira e a última janela são sempre preservadas. O resultado inclui `candidateWindowCount`, `selectedWindowCount`, índices selecionados, intervalos cobertos e `truncated: candidateWindowCount > selectedWindowCount`.

- [ ] **Step 2: Escrever a fixture numérica exata da agregação**

Use três janelas de conteúdo sem tokens especiais:

```ts
const windows = [
  { index: 0, tokenStart: 0, tokenEnd: 510, rawScore: 0.2 },
  { index: 1, tokenStart: 446, tokenEnd: 956, rawScore: 0.8 },
  { index: 2, tokenStart: 892, tokenEnd: 1200, rawScore: 0.6 },
];
```

Os pesos de tokens únicos são `[510, 446, 244]`; portanto `documentRawScore = (0.2*510 + 0.8*446 + 0.6*244) / 1200 = 0.5043333333333333`, `localizedRawScore = 0.8`, `coverage = 1`, `median = 0.6`, `min = 0.2`, `max = 0.8` e `highScoreRatio = 1/3` usando limiar diagnóstico bruto >= 0,80. Esse fixture substitui números soltos sem origem.

Defina `chunkAgreement` como a fração de janelas cujo score está a no máximo 0,15 de `documentRawScore`; defina `stdDev` como desvio-padrão populacional ponderado pelos mesmos tokens únicos.

- [ ] **Step 3: Escrever matriz vermelha de evidência e precedência**

`EvidenceInput` é fechado:

```ts
export interface EvidenceInput {
  locale: string;
  wordCount: number;
  coverage: number;
  lexicalRatio: number;
  stdDev: number;
  chunkAgreement: number;
  truncated: boolean;
  exactTokenizer: boolean;
  backendError: boolean;
  artifactMismatch: boolean;
}
```

Teste esta precedência determinística de qualidade:

1. `artifactMismatch`, `backendError`, locale diferente de `pt-BR`, menos de 50 palavras ou tokenizer aproximado no TMR => `unsupported`.
2. cobertura < 0,50 ou lexicalRatio < 0,40 => `unsupported`.
3. cobertura < 0,95, lexicalRatio < 0,60, stdDev > 0,25 ou chunkAgreement < 0,50 => `limited`.
4. demais entradas => `sufficient`.

Razões são acumuladas na ordem do enum, sem duplicatas. `truncated` sempre adiciona `TRUNCATED_INPUT`, mas sozinho não rebaixa uma entrada que ainda tenha cobertura >= 0,95.

- [ ] **Step 4: Executar os testes para observar as falhas esperadas**

Run: `npx vitest run tests/unit/inference/chunker.test.ts tests/unit/inference/aggregator.test.ts tests/unit/inference/evidence.test.ts`

Expected: FAIL por seleção distribuída, campos v2 e assessor ausentes.

- [ ] **Step 5: Implementar agregação sem misturar os dois sinais**

`AggregationResultV2` contém:

```ts
export interface AggregationResultV2 {
  version: "tmr-aggregation-v2";
  documentRawScore: number;
  localizedRawScore: number;
  coverage: number;
  truncated: boolean;
  weightedMean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  highScoreRatio: number;
  chunkAgreement: number;
  candidateWindowCount: number;
  selectedWindowIndices: number[];
}
```

Calcule cobertura pela união dos intervals de tokens de conteúdo selecionados dividida por `totalTokenCount`. Desconte overlap somente uma vez, atribuindo cada token à primeira janela selecionada que o cobre. `weightedMean` é igual a `documentRawScore`; `localizedRawScore` é o maior score válido. Mediana, máximo, mínimo, desvio e high-score ratio são diagnósticos e não entram numa fórmula de decisão.

Na mesma alteração, remova o antigo `finalScore` de `calibration.ts`, `explanation.ts`, worker, testes e mensagens. Esses consumidores recebem explicitamente os dois raw scores; não deixe um estado intermediário que falhe no typecheck.

- [ ] **Step 6: Implementar e testar qualidade de evidência compartilhada**

Implemente `assessEvidence` como função pura e faça worker e análise manual consumirem a mesma saída. Uma entrada dominada por URL/hashtag/emoji é expressa pela razão lexical versionada, sem segunda regex no pipeline.

Run: `npx vitest run tests/unit/inference/chunker.test.ts tests/unit/inference/aggregator.test.ts tests/unit/inference/evidence.test.ts tests/unit/inference/calibration.test.ts tests/unit/inference/explanation.test.ts tests/integration/inference-pipeline.test.ts`

Expected: PASS, inclusive fixture 20→8, união de cobertura e matriz de limites.

Run: `npm run typecheck`

Expected: exit 0 antes do commit.

- [ ] **Step 7: Commit com paths explícitos**

```bash
git add src/inference/evidence.ts src/inference/chunker.ts src/inference/aggregator.ts src/inference/calibration.ts src/inference/explanation.ts src/inference/inference-worker.ts src/shared/types.ts tests/unit/inference/evidence.test.ts tests/unit/inference/chunker.test.ts tests/unit/inference/aggregator.test.ts tests/unit/inference/calibration.test.ts tests/unit/inference/explanation.test.ts tests/integration/inference-pipeline.test.ts
git commit --no-verify -m "feat: add distributed TMR evidence aggregation"
```

### Task 6: Aplicar perfil exato, migrar settings e fechar toda apresentação por decisão

**Files:**

- Create: `tests/helpers/calibration-vectors.ts`
- Modify: `src/inference/calibration-registry.ts`
- Modify: `src/inference/calibration.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/inference/worker-protocol.ts`
- Modify: `src/content/presentation/presentation-controller.ts`
- Modify: `src/content/presentation/badge.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/settings-types.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/message-validation.ts`
- Modify: `src/shared/diagnostic-types.ts`
- Modify: `src/shared/export-validation.ts`
- Modify: `src/shared/validation.ts` somente se ainda houver consumidores não relacionados a limiar
- Modify: `src/storage/settings.ts`
- Modify: `src/storage/platform-settings.ts`
- Modify: `src/storage/effective-settings.ts`
- Modify: `src/storage/import-export.ts`
- Modify: `src/storage/diagnostics.ts`
- Modify: `src/background/settings-fingerprint.ts`
- Modify: `src/options/components/GeneralSettings.tsx`
- Modify: `src/options/components/AdvancedSettings.tsx`
- Modify: `tests/unit/inference/calibration-registry.test.ts`
- Modify: `tests/unit/inference/calibration.test.ts`
- Modify: `tests/unit/inference/worker-protocol.test.ts`
- Modify: `tests/unit/content/presentation-controller.test.ts`
- Modify: `tests/unit/content/presentation-modes.test.ts`
- Modify: `tests/unit/options/App.test.tsx`
- Modify: `tests/unit/options/settings-sections.test.tsx`
- Modify: `tests/unit/storage/settings.test.ts`
- Modify: `tests/unit/storage/platform-settings.test.ts`
- Modify: `tests/unit/storage/import-export.test.ts`
- Modify: `tests/unit/storage/diagnostics.test.ts`
- Modify: `tests/unit/shared/message-validation.test.ts`
- Modify: `tests/unit/shared/validation.test.ts` somente se o módulo continuar existindo
- Modify: `tests/integration/settings-roundtrip.test.ts`
- Modify: `tests/integration/effective-settings-precedence.test.ts`
- Modify: `tests/integration/presentation-restoration.test.ts`

**Interfaces:**

- Produces: `CalibrationRegistry.findExact(coordinates, now)`, `applySerializedCalibrator(calibrator, score)` e `decideWithProfile(input)`.
- Produces: `UserSettings` sem `markingThreshold`, `blurThreshold`, `collapseThreshold` ou `hideThreshold`; migração atômica do envelope persistido v3 para v4 e do export v1 para v2.
- Produces: `resolveMode(result, settings)` que usa somente `DecisionOutcome.presentationAllowed`, `abstained`, `actionCeiling` e a preferência visual.
- Consumes: perfis verificados, `AggregationResultV2`, `EvidenceAssessment` e `ModelReleaseDescriptorV1`.

- [ ] **Step 1: Escrever testes vermelhos do lookup integral e dos calibradores**

A chave do registry inclui exatamente `modelId`, `modelVersion`, `bundleDigest`, `tokenizerDigest`, `platform`, `locale`, `lengthBucket`, `aggregationVersion` e `contentCompositionVersion`. Além disso, o `profileDigest` precisa pertencer ao `profileDigests` do release e o `calibrationSetDigest` precisa conferir. Teste match exato, cada coordenada divergente isoladamente, digest fora do conjunto, `now === expiresAt`, perfil expirado, duplicata de chave e release/profile com chaves desconhecidas. Ausência, expiração ou mismatch retornam uma razão tipada; nunca retornam o perfil “mais próximo”.

Platt aplica `sigmoid(slope * score + intercept)`. Beta exige `alpha >= 0` e `beta >= 0`, limita o raw score a `[1e-6, 1-1e-6]` e aplica `sigmoid(alpha*ln(p) - beta*ln(1-p) + intercept)`. Isotonic faz clamp e interpolação linear entre knots adjacentes. Fixe o mesmo vetor numérico em `tests/helpers/calibration-vectors.ts` e importe-o nos testes do runtime desta fase e do fit/serialização da Fase 2. Para knots `(0,0.1),(0.5,0.4),(1,0.9)`: score 0.25 => 0.25; score -1 => 0.1; score 2 => 0.9. Rejeite knots não crescentes e saídas fora de `[0,1]`.

- [ ] **Step 2: Escrever a matriz RED de decisão e apresentação fail-closed**

`decideWithProfile` segue esta ordem:

1. evidência unsupported => abstém sem apresentação;
2. perfil ausente, vencido, incompatível ou fora do release => TMR abstém com razão específica;
3. calibra separadamente document e localized;
4. cria `triggers` em ordem canônica: document quando passa `documentIndicator`, localized quando passa `localizedIndicator`;
5. `calibratedScore` é o maior score entre triggers; sem trigger, usa o score document calibrado;
6. sem trigger => não apresenta;
7. localized isolado, evidência limited ou 50–79 palavras => teto indicator;
8. ação visual exige trigger document, `documentAction`, evidência sufficient, perfil `pass`, teto hide e rollout `actions`;
9. `bundle-verified` e `shadow` sempre definem `presentationAllowed: false`; rollout `indicator` limita a indicator.

Teste `triggers: []`, `["document"]`, `["localized"]` e `["document","localized"]`. Teste que resultado sem `decision`, com `presentationAllowed: false`, abstido ou com status não apresentável sempre retorna `null`, mesmo com `aiScore = 1`. Teste que `resolveMode` reduz `hide`, `collapse` e `blur` a `indicator` quando esse for o teto, e aceita `collapse` quando o teto for `hide`. Stylometric builtin pode apresentar somente `indicator`; TMR sem perfil não herda esse direito e precisa produzir uma nova identidade builtin pelo fallback.

- [ ] **Step 3: Escrever testes RED da remoção dos thresholds e das migrações**

Persistir envelope `schemaVersion: 3` com as quatro chaves legadas, chamar `SettingsRepository.get()` e esperar `schemaVersion: 4` sem essas chaves. Provar que overrides antigos de plataforma são descartados, mas `presentationMode` e `minimumWordCount` sobrevivem; import v1 normaliza para export v2; diagnostics, mensagens, fingerprints e protocolo do worker jamais transportam thresholds, inclusive quando a entrada é forjada por cast. O novo parser aceita as chaves legadas somente no formato/versionamento exato da migração e rejeita campos desconhecidos.

Na UI, exigir as opções `Apenas indicador`, `Desfocar`, `Recolher` e `Ocultar`, nenhuma label de limiar e a nota: “A escolha define somente como apresentar um resultado autorizado. O perfil calibrado pode reduzir esta ação, nunca aumentá-la.”

- [ ] **Step 4: Executar os testes para observar as falhas esperadas**

Run:

```powershell
npx vitest run tests/unit/inference/calibration-registry.test.ts tests/unit/inference/calibration.test.ts tests/unit/inference/worker-protocol.test.ts tests/unit/content/presentation-controller.test.ts tests/unit/options/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/storage/settings.test.ts tests/unit/storage/platform-settings.test.ts tests/unit/storage/import-export.test.ts tests/unit/storage/diagnostics.test.ts tests/unit/shared/message-validation.test.ts
```

Expected: FAIL porque lookup integral, calibradores serializados, migração v4 e apresentação sem score ainda não existem.

- [ ] **Step 5: Implementar registry, calibração e TTL do resultado**

Faça parse/digest uma vez na carga e indexe somente perfis válidos. `decideWithProfile` registra `selectedProfileDigest` e `cacheValidUntil = expiresAt` no resultado. Não altere `RuntimeModelIdentity.calibrationSetDigest` para o perfil selecionado; identidade de runtime descreve o conjunto carregado. Perfil sem evidência de gate coerente é rejeitado na carga. Nenhum booleano legado `calibrated` autoriza decisão. O `confidence` legado deriva da evidência (`high` para sufficient, `low` para limited/unsupported) e não substitui a política.

- [ ] **Step 6: Remover thresholds do contrato do usuário e migrar dados atomicamente**

Remover as quatro propriedades de `UserSettings`, `DEFAULT_SETTINGS`, `DiagnosticSettingsSummary`, validadores, protocolo do worker, export, fingerprints e resumos. Limiares científicos continuam existindo exclusivamente em `RuntimeCalibrationProfileV1.thresholds`; nunca são copiados de settings. Em `src/storage/settings.ts`, usar `SCHEMA_VERSION = 4`, uma lista fechada `LEGACY_THRESHOLD_KEYS` e `withoutLegacyThresholds()`; validar integralmente o envelope v3 antes de migrar. `EXPORT_SCHEMA_VERSION` passa a 2, aceitando v1 somente como entrada normalizada. Aplicar a mesma remoção a overrides de plataforma.

Antes de excluir qualquer helper, executar `rg -n "validateThresholds|src/shared/validation" src tests`. Se `src/shared/validation.ts` ainda tiver consumidor não relacionado, manter o módulo e remover somente a API de thresholds; excluir módulo e teste juntos apenas quando a busca e o typecheck provarem que ficaram sem uso.

- [ ] **Step 7: Fechar o controller e atualizar a UI sem fallback legado**

`isPresentable` exige simultaneamente `decision.presentationAllowed === true`, `decision.abstained === false` e status filterable. `resolveMode` nunca lê `aiScore`, `calibratedScore`, status isolado, faixa de palavras ou threshold legado; escolhe apenas o menor rank entre `settings.presentationMode` e `decision.actionCeiling`. Não existe branch transitório para resultado sem `decision`.

Expor os quatro modos em `GeneralSettings.tsx` e remover `THRESHOLD_FIELDS`, drafts, validadores e a seção de limiares de `AdvancedSettings.tsx`. Resultado shadow, perfil inválido ou TMR abstido nunca produz badge, blur, collapse ou hide. Localized-only e estilométrico nunca ultrapassam indicator.

- [ ] **Step 8: Validar política, migração, restauração e contratos**

Run:

```powershell
npx vitest run tests/unit/inference/calibration-registry.test.ts tests/unit/inference/calibration.test.ts tests/unit/inference/worker-protocol.test.ts tests/unit/content/presentation-controller.test.ts tests/unit/content/presentation-modes.test.ts tests/unit/options/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/storage/settings.test.ts tests/unit/storage/platform-settings.test.ts tests/unit/storage/import-export.test.ts tests/unit/storage/diagnostics.test.ts tests/unit/shared/message-validation.test.ts tests/integration/settings-roundtrip.test.ts tests/integration/effective-settings-precedence.test.ts tests/integration/presentation-restoration.test.ts
npm run typecheck
npm run lint
```

Expected: tudo PASS; nenhuma referência de produção aos quatro campos de limiar permanece e nenhuma apresentação bypassa `DecisionOutcome`.

- [ ] **Step 9: Commit com paths explícitos**

```bash
git add src/inference/calibration-registry.ts src/inference/calibration.ts src/inference/inference-worker.ts src/inference/worker-protocol.ts src/content/presentation/presentation-controller.ts src/content/presentation/badge.ts src/shared/types.ts src/shared/settings-types.ts src/shared/constants.ts src/shared/message-validation.ts src/shared/diagnostic-types.ts src/shared/export-validation.ts src/storage/settings.ts src/storage/platform-settings.ts src/storage/effective-settings.ts src/storage/import-export.ts src/storage/diagnostics.ts src/background/settings-fingerprint.ts src/options/components/GeneralSettings.tsx src/options/components/AdvancedSettings.tsx tests/helpers/calibration-vectors.ts tests/unit/inference/calibration-registry.test.ts tests/unit/inference/calibration.test.ts tests/unit/inference/worker-protocol.test.ts tests/unit/content/presentation-controller.test.ts tests/unit/content/presentation-modes.test.ts tests/unit/options/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/storage/settings.test.ts tests/unit/storage/platform-settings.test.ts tests/unit/storage/import-export.test.ts tests/unit/storage/diagnostics.test.ts tests/unit/shared/message-validation.test.ts tests/integration/settings-roundtrip.test.ts tests/integration/effective-settings-precedence.test.ts tests/integration/presentation-restoration.test.ts
git add -A -- src/shared/validation.ts tests/unit/shared/validation.test.ts
git commit --no-verify -m "feat: enforce calibrated presentation ceilings"
```

### Task 7: Integrar catálogo, release e lifecycle primário/fallback

**Files:**

- Modify: `src/inference/model-bundle.ts`
- Modify: `src/inference/model-catalog.ts`
- Modify: `src/inference/model-loader.ts`
- Modify: `src/inference/backend-selector.ts`
- Modify: `src/inference/inference-worker.ts`
- Modify: `src/inference/worker-protocol.ts`
- Modify: `src/offscreen/offscreen.ts`
- Modify: `src/offscreen/worker-host.ts`
- Modify: `src/background/offscreen-manager.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/unit/inference/model-bundle.test.ts`
- Modify: `tests/unit/inference/backend-selector.test.ts`
- Modify: `tests/unit/inference/worker-protocol.test.ts`
- Modify: `tests/unit/offscreen/worker-host.test.ts`
- Modify: `tests/integration/backend-fallback.test.ts`
- Modify: `tests/integration/mock-worker-flow.test.ts`

**Interfaces:**

- Produces: `loadRuntimeDescriptor`, `crossValidateRuntimeDescriptor`, `selectCatalogRuntime`, `WorkerHostState` e `classifyWithFallback`.
- Consumes: manifesto, release, perfis e `ModelRuntime` verificados nas Tasks 2–6.

- [ ] **Step 1: Escrever testes vermelhos de cross-validation antes do host**

`loadRuntimeDescriptor` recebe os imports imutáveis de `src/inference/bundled-model-metadata.ts`, clona-os para impedir mutação, executa parsers fechados e valida em conjunto:

- modelId, modelVersion, bundleDigest, tokenizerDigest e versões de agregação/composição iguais nos três níveis;
- `calibrationSetDigest` igual ao array ordenado/único de profile digests;
- todos os digests do release presentes uma única vez no arquivo de perfis e nenhum perfil extra;
- rollout/gateDecision coerentes;
- artifacts exatamente iguais ao source lock incorporado no manifesto.

Injete uma factory `createWorkerHost(descriptor)` no teste e afirme `not.toHaveBeenCalled()` para JSON inválido, digest divergente, perfil expirado na inicialização e artifact extra. Assim o parse/cross-validation termina antes de qualquer construção de `WorkerHost` ou sessão ONNX.

- [ ] **Step 2: Escrever a matriz vermelha de seleção do catálogo**

`selectCatalogRuntime` retorna:

```ts
export interface CatalogSelection {
  primary: "tmr" | "stylometric";
  shadowTmr: boolean;
  reasonCodes: DecisionReasonCode[];
}
```

Casos obrigatórios:

| release | perfis válidos | build | primary | shadowTmr |
| --- | --- | --- | --- | --- |
| bundle-verified | 0 | production | stylometric | false |
| shadow | >=1 | development | stylometric | true |
| shadow | >=1 | production | stylometric | false |
| indicator | >=1 | qualquer | tmr | false |
| actions | >=1 pass | qualquer | tmr | false |
| indicator/actions | 0 ou incompatível | qualquer | stylometric | false |

Não use a string `fallback` como estado no release; ela descreve somente o comportamento local do host.

- [ ] **Step 3: Escrever testes vermelhos da máquina de estados**

```ts
export type WorkerHostState =
  | { mode: "primary"; phase: "initializing" | "ready"; runtime: ModelRuntime }
  | { mode: "fallback"; phase: "initializing" | "ready"; runtime: ModelRuntime; reasonCodes: DecisionReasonCode[] }
  | { mode: "terminal"; phase: "error"; reasonCodes: DecisionReasonCode[] };
```

Teste: sucesso primário; WebGPU falha e WASM funciona dentro do mesmo TMR; ambos os backends TMR falham e stylometric inicializa uma vez; worker TMR morre depois de ready e stylometric inicializa uma vez; stylometric falha e vai a terminal; worker cai já em fallback e vai a terminal; chamadas concorrentes observam a mesma promise de transição. Conte factories para provar que nenhuma sequência reinicia o TMR ou alterna em loop.

- [ ] **Step 4: Executar os testes para observar as falhas esperadas**

Run: `npx vitest run tests/unit/inference/model-bundle.test.ts tests/unit/inference/backend-selector.test.ts tests/unit/offscreen/worker-host.test.ts tests/integration/backend-fallback.test.ts`

Expected: FAIL porque release/perfis não são cross-validados antes do host e o fallback ainda não é uma transição única.

- [ ] **Step 5: Implementar carga, catálogo e transporte atômicos**

`offscreen.ts` aguarda `loadRuntimeDescriptor` e `crossValidateRuntimeDescriptor`; somente depois chama `createWorkerHost`. `WorkerInitializePayload` transporta o descritor já parseado e o protocolo rejeita chaves desconhecidas. Ainda assim o worker revalida os digests como fronteira de confiança antes de abrir assets.

`model-catalog.ts` mantém o TMR candidato e o stylometric builtin como objetos distintos. A identidade builtin é `{kind:"builtin",modelId:"stylometric",modelVersion,implementationVersion}`; ela nunca copia bundleDigest ou calibrationSetDigest do TMR.

- [ ] **Step 6: Implementar a transição imediata e única**

`backend-selector.ts` tenta WebGPU e, após descarte integral da sessão parcial, uma vez WASM. Se o TMR não inicializar ou seu worker morrer, `WorkerHost` descarta listeners/sessão e inicializa stylometric imediatamente, sem aguardar três falhas. Se o fallback falhar, entra em terminal; não há caminho automático de volta.

Em uma requisição TMR cujo perfil exato esteja ausente/vencido/incompatível, preserve a abstenção TMR no diagnóstico e rode stylometric uma vez para produzir um novo resultado indicativo com identidade builtin. Outros unsupported de conteúdo não acionam fallback e permanecem abstidos.

Publique `ModelStatus` do conjunto: `calibrationCoverage`, `calibrationSetDigest`, `profileCount` e `earliestExpiry`. Estado `degraded` identifica fallback ativo ou cobertura parcial; nunca publique um perfil selecionado no status.

- [ ] **Step 7: Validar lifecycle e protocolo**

Run: `npx vitest run tests/unit/inference/model-bundle.test.ts tests/unit/inference/backend-selector.test.ts tests/unit/inference/worker-protocol.test.ts tests/unit/offscreen/worker-host.test.ts tests/integration/backend-fallback.test.ts tests/integration/mock-worker-flow.test.ts`

Expected: PASS; cada cenário tem contagem exata de inicializações e disposes.

Run: `npm run typecheck && npm run lint`

Expected: ambos retornam exit 0 antes do commit.

- [ ] **Step 8: Commit com paths explícitos**

```bash
git add src/inference/model-bundle.ts src/inference/model-catalog.ts src/inference/model-loader.ts src/inference/backend-selector.ts src/inference/inference-worker.ts src/inference/worker-protocol.ts src/offscreen/offscreen.ts src/offscreen/worker-host.ts src/background/offscreen-manager.ts src/background/service-worker.ts src/shared/types.ts tests/unit/inference/model-bundle.test.ts tests/unit/inference/backend-selector.test.ts tests/unit/inference/worker-protocol.test.ts tests/unit/offscreen/worker-host.test.ts tests/integration/backend-fallback.test.ts tests/integration/mock-worker-flow.test.ts
git commit --no-verify -m "feat: activate verified model lifecycle"
```

### Task 8: Vincular cache à identidade e abrir circuit breaker sem corrida

**Files:**

- Create: `src/inference/circuit-breaker.ts`
- Create: `tests/unit/inference/circuit-breaker.test.ts`
- Modify: `src/storage/cache.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/background/offscreen-manager.ts`
- Modify: `src/offscreen/worker-host.ts`
- Modify: `src/storage/diagnostics.ts`
- Modify: `src/shared/diagnostic-types.ts`
- Modify: `tests/unit/storage/cache.test.ts`
- Modify: `tests/unit/background/message-router.test.ts`
- Modify: `tests/unit/offscreen/worker-host.test.ts`
- Modify: `tests/integration/inference-pipeline.test.ts`

**Interfaces:**

- Produces: `buildRuntimeModelKey(identity)`, `getCachedClassification(key, now, identity)`, `CircuitBreaker.recordFailure`, `CircuitBreaker.canAttempt` e `CircuitBreaker.resetExplicitly`.
- Consumes: `RuntimeModelIdentity`, `cacheValidUntil` e status ready da Task 7.

- [ ] **Step 1: Escrever testes vermelhos da chave de runtime**

Serializar canonicamente cada branch:

```ts
buildRuntimeModelKey({
  kind: "bundle",
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  bundleDigest: "a".repeat(64),
  tokenizerDigest: "c".repeat(64),
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  calibrationSetDigest: "b".repeat(64),
});
```

Mudar isoladamente bundle, tokenizer, agregação, composição ou conjunto de calibração muda a chave. Para builtin, mudar `implementationVersion` muda a chave. `selectedProfileDigest` não pertence à chave porque ele é conhecido somente depois do lookup; sua expiração pertence ao registro armazenado.

- [ ] **Step 2: Escrever testes vermelhos do fluxo de cache em duas fases**

O router deve obter `ModelStatus.state === "ready" | "degraded"` e sua identidade antes do read. Sem identidade pronta, pula cache. Após classificar, recalcula a chave com `result.runtimeIdentity`; grava somente sob essa identidade e define `expiresAt = min(ttlNormal, Date.parse(result.cacheValidUntil))` quando existir.

Teste: hit com identidade igual; miss após mudança de calibrationSetDigest; resultado que troca TMR por stylometric não escrito sob chave TMR; perfil expirado mesmo antes do TTL; registro com identidade antiga rejeitado; status inicializando não lê; remoção da chave estilométrica fixa antiga.

- [ ] **Step 3: Escrever testes vermelhos do breaker móvel**

`CircuitBreaker` guarda timestamps em memória do host. Conte somente códigos operacionais de modelo/tokenização/inferência/timeout. Não conte cancelamento, unsupported, perfil ausente, erro de regra ou falha de UI. A falha de inicialização da Task 7 causa fallback imediato e não é aguardada nem contada novamente no limiar.

Com relógio fake, fixe:

```ts
breaker.recordFailure("MODEL_INFERENCE_FAILED", 0);
breaker.recordFailure("MODEL_TIMEOUT", 599_999);
expect(breaker.canAttempt(599_999)).toBe(true);
breaker.recordFailure("TOKENIZATION_FAILED", 600_000);
expect(breaker.canAttempt(600_000)).toBe(false);
```

Após avançar além da janela, o breaker permanece aberto até `resetExplicitly`; reinício/atualização cria nova instância. Teste que 20 falhas concorrentes acionam exatamente um dispose e uma inicialização do fallback.

- [ ] **Step 4: Executar os testes para observar as falhas esperadas**

Run: `npx vitest run tests/unit/storage/cache.test.ts tests/unit/inference/circuit-breaker.test.ts tests/unit/background/message-router.test.ts tests/unit/offscreen/worker-host.test.ts`

Expected: FAIL por chave incompleta, TTL de perfil ausente e breaker inexistente.

- [ ] **Step 5: Implementar cache e transição sincronizada**

Use `canonicalJson(identity)` como componente da chave e compare novamente `record.result.runtimeIdentity` no read. Nunca derive identidade de campos legados `modelId/modelVersion`. O write ocorre somente depois do resultado final do primary/fallback.

No host, proteja abertura/transição com uma única promise compartilhada. Ao terceiro erro elegível em `[now-600000, now]`, marque `CIRCUIT_BREAKER_OPEN`, descarte TMR uma vez, faça a transição única para stylometric e publique status degraded. Diagnósticos guardam apenas contadores, timestamps limitados e reason code; nenhum texto ou URL.

- [ ] **Step 6: Validar cache, breaker e pipeline concorrente**

Run: `npx vitest run tests/unit/storage/cache.test.ts tests/unit/inference/circuit-breaker.test.ts tests/unit/background/message-router.test.ts tests/unit/offscreen/worker-host.test.ts tests/integration/inference-pipeline.test.ts`

Expected: PASS, incluindo troca de identidade e uma única transição concorrente.

Run: `npm run typecheck && npm run lint`

Expected: ambos retornam exit 0 antes do commit.

- [ ] **Step 7: Commit com paths explícitos**

```bash
git add src/inference/circuit-breaker.ts src/storage/cache.ts src/background/message-router.ts src/background/offscreen-manager.ts src/offscreen/worker-host.ts src/storage/diagnostics.ts src/shared/diagnostic-types.ts tests/unit/inference/circuit-breaker.test.ts tests/unit/storage/cache.test.ts tests/unit/background/message-router.test.ts tests/unit/offscreen/worker-host.test.ts tests/integration/inference-pipeline.test.ts
git commit --no-verify -m "feat: bind cache and breaker to runtime identity"
```

### Task 9: Executar smoke real do TMR em Chrome e fechar gates

**Files:**

- Create: `src/model-smoke/model-smoke.html`
- Create: `src/model-smoke/main.ts`
- Create: `tests/e2e/model-smoke-manifest.ts`
- Create: `tests/e2e/real-model-smoke.spec.ts`
- Create: `vite.model-smoke.config.ts`
- Create: `playwright.model-smoke.config.ts`
- Create: `scripts/run-real-model-tests.mjs`
- Create: `scripts/run-real-model-tests.d.mts`
- Modify: `tests/integration/real-model-smoke.test.ts`
- Modify: `tsconfig.node.json`
- Modify: `package.json`
- Modify: `docs/model-validation.md`
- Modify: `docs/model-integration.md`

**Interfaces:**

- Produces: página de smoke test-only, `runRealModelTests({mode})` e scripts `build:model-smoke`, `test:model:smoke`, `test:model:release`.
- Consumes: bundle materializado, runtime real, Chromium pinado pelo Playwright e `build:release`.

- [ ] **Step 1: Separar o teste Vitest do smoke real**

Refatore `tests/integration/real-model-smoke.test.ts` para testar somente orchestration com gateway injetado e arquivos temporários. Renomeie os casos para deixar explícito que não provam Transformers/ONNX real. Nenhum teste Vitest pode ser o gate do modelo real.

Escreva primeiro `tests/e2e/real-model-smoke.spec.ts` esperando uma página de extensão que exponha somente:

```ts
export interface ModelSmokeReport {
  state: "passed" | "failed";
  runtimeIdentity: RuntimeModelIdentity | null;
  exactTokenizer: boolean;
  specialTokenCount: number;
  candidateWindowCount: number;
  selectedWindowCount: number;
  documentRawScore: number | null;
  localizedRawScore: number | null;
  coldStartMs: number;
  warmInferenceMs: number;
  peakMemoryBytes: number | null;
  errorCode: string | null;
}
```

O relatório não contém texto, tokens, URL da página ou scores por amostra.

- [ ] **Step 2: Construir uma extensão de smoke isolada da produção**

`vite.model-smoke.config.ts` gera `dist-model-smoke/` com manifesto MV3 de teste e `model-smoke.html`, importa o runtime real e copia o bundle verificado. Esse entrypoint nunca entra em `vite.config.ts`, `manifest.config.ts` ou `dist/` de produção.

`main.ts` obtém assets por `chrome.runtime.getURL("models/tmr-ai-text-detector/...")`, inicializa o TMR real, mede special tokens, roda duas inferências fixas não sensíveis e publica somente `ModelSmokeReport` em `window.__cleanfeedModelSmoke`. Não injete classifier, tokenizer ou Transformers gateway fake.

- [ ] **Step 3: Bloquear rede e verificar execução real no Chromium do Playwright**

O teste lança o Chromium bundled e pinado pelo Playwright com `channel: "chromium"` e `dist-model-smoke`, resolve o ID pelo service worker (a fixture fixa `abcdefghijklmnopabcdefghijklmnop`), abre `chrome-extension://abcdefghijklmnopabcdefghijklmnop/model-smoke.html` e falha se qualquer request tiver protocolo `http:` ou `https:`. Aguarda estado terminal e exige:

- identidade kind bundle com digests esperados;
- `exactTokenizer === true` e `specialTokenCount === 2` medido;
- no máximo oito janelas e aggregationVersion v2;
- ambos raw scores finitos em [0,1];
- cold start e warm inference finitos, positivos e registrados, sem tratá-los como gate de desempenho fora do ambiente de referência;
- erro nulo e página ainda responsiva;
- cenário de asset corrompido trocando uma fixture local que ativa fallback builtin indicador sem loop.

Use o canal CDP `Performance.getMetrics` quando disponível para memória; se indisponível, reporte null no candidate smoke e torne a medição obrigatória no Chrome for Testing de referência da Fase 4. Os limites de 10 s/2 s/512 MiB pertencem somente a essa lane controlada; não finja zero nem bloqueie o smoke funcional por variação da máquina do desenvolvedor.

- [ ] **Step 4: Criar runner cross-platform e scripts sem skip silencioso**

`run-real-model-tests.mjs` usa `process.execPath` e `process.env.npm_execpath` para executar os subcomandos. Ele falha com `NPM_EXEC_PATH_MISSING`, propaga exit code e analisa o JSON reporter do Playwright; qualquer teste skipped ou ausência do spec esperado retorna `MODEL_SMOKE_SKIPPED`.

Adicionar:

```json
{
  "build:model-smoke": "vite build --config vite.model-smoke.config.ts",
  "test:model:smoke": "node scripts/run-real-model-tests.mjs candidate",
  "test:model:release": "node scripts/run-real-model-tests.mjs release"
}
```

Modo candidate executa `model:verify`, `build:model-smoke` e Playwright real. Modo release rejeita pending; para reject científico, executa primeiro o mesmo smoke exato do candidato, chama `build:release`, roda E2E normal e audita que o pacote fallback não contém `dist/models/tmr-ai-text-detector`; para indicator/actions, exige licença approved, perfis válidos, pacote TMR, `build:release`, smoke real e E2E normal. Perfil expirado, teste skipped ou pacote incoerente falham com reason code.

- [ ] **Step 5: Executar testes de orchestration e typecheck**

Run: `npx vitest run tests/integration/real-model-smoke.test.ts tests/integration/release-build-gate.test.ts`

Expected: PASS sem rede e sem depender do ONNX local.

Run: `npm run typecheck && npm run lint`

Expected: ambos retornam exit 0 antes do commit.

- [ ] **Step 6: Executar o gate candidate quando os sete ativos estiverem materializados**

Run: `npm run model:verify && npm run test:model:smoke`

Expected: exit 0, Playwright executado no Chromium bundled real, zero skipped e relatório com identidade bundle.

Se o binário ainda não foi adquirido, o resultado correto é erro estruturado `MODEL_ARTIFACT_MISSING`; não marque a task completa até executar esse comando num workspace com os sete ativos.

- [ ] **Step 7: Provar o gate release inicialmente fechado**

Run: `npm run test:model:release`

Expected nesta fase inicial: exit diferente de zero com `MODEL_RELEASE_NOT_PROMOTED` porque a decisão ainda é pending. Após a publicação científica: reject retorna exit 0 somente depois de smoke exato e build/audit fallback sem TMR; indicator/actions retorna exit 0 somente com licença approved, perfis válidos, smoke e pacote TMR íntegro. Nenhum código é alterado para contornar o gate.

- [ ] **Step 8: Commit com paths explícitos**

```bash
git add src/model-smoke/model-smoke.html src/model-smoke/main.ts tests/e2e/model-smoke-manifest.ts tests/e2e/real-model-smoke.spec.ts vite.model-smoke.config.ts playwright.model-smoke.config.ts scripts/run-real-model-tests.mjs scripts/run-real-model-tests.d.mts tests/integration/real-model-smoke.test.ts tsconfig.node.json package.json docs/model-validation.md docs/model-integration.md
git commit --no-verify -m "test: gate TMR with real Chrome smoke"
```

## Final Phase 1 Verification

- [ ] **Code gate em clone limpo, sem ONNX**

Run: `npm ci && npm run format:check && npm run lint && npm run typecheck && npx vitest run && npm run model:verify:metadata && npm run build && npm run audit && npm run docs:check`

Expected: todos retornam exit 0; a build normal não baixa nem exige o binário.

- [ ] **Artifact gate com bundle local**

Run: `npm run model:verify && npm run test:model:smoke`

Expected: inventário materializado 10/10, hashes íntegros, Chromium bundled real, zero rede e zero skipped.

- [ ] **Release gate**

Run: `npm run build:release && npm run test:model:release`

Expected enquanto a decisão está pending: ambos falham de forma estruturada. Expected após decisão: reject retorna exit 0 e não contém TMR no dist; indicator/actions retorna exit 0 e contém somente o inventário TMR permitido.

- [ ] **Varredura final do documento**

Run:

```powershell
rg -n "T[O]DO|T[B]D|F[I]XME|place[h]older|valid[V]2|fetch[A]ll|bundle[V]erifiedRelease|valid[P]rofile|valid[I]nput|cross[-]env|git[ ]add[ ]tests|git[ ]add[ ]\." docs/superpowers/plans/2026-07-19-cleanfeed-ai-tmr-ptbr-phase-1-model-runtime.md
```

Expected: nenhuma saída.

## Definition of Done

- Os sete ativos upstream são fixados, adquiridos em staging e promovidos atomicamente; o bundle final verifica exatamente dez arquivos.
- Decisão pending bloqueia release sem bypass; reject gera release fallback somente após smoke exato e sem TMR no dist; indicator/actions exige licença approved e pacote TMR íntegro.
- Contratos canônicos são compartilhados com benchmark, incluídos em typecheck/lint e vinculam modelo, agregação, composição e conjunto de perfis.
- TMR sem perfil válido se abstém; stylometric permanece um resultado builtin novo e somente indicativo.
- Tokenizer real mede tokens especiais, usa offsets nativos e controla janelas 510/64/8.
- Agregação preserva sinais document/localized e produz evidência determinística.
- Política de apresentação exige `presentationAllowed` e respeita action ceiling em todos os modos.
- Cache nunca atravessa identidade, conjunto ou expiração; breaker e lifecycle nunca oscilam em loop.
- O smoke candidato roda ONNX/Transformers real em Chrome offline; o gate release falha fechado até licença e evidência promovidas.
