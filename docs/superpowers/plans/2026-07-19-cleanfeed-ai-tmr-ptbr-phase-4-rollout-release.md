# CleanFeed AI TMR/PT-BR — Phase 4 Rollout and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar exclusivamente o estágio autorizado pela validação PT-BR/LinkedIn, apresentar sinais com linguagem probabilística e produzir um pacote Chrome offline cuja política, acessibilidade, privacidade e desempenho sejam verificáveis.

**Architecture:** A Fase 4 consome o descritor, os perfis e a evidência sanitizada já publicados pela Fase 3, sem recalcular estatística ou reconstruir perfis. A apresentação confia somente no `DecisionOutcome` produzido pela Fase 1 e nunca em limiares escolhidos pelo usuário; o `actionCeiling` do resultado já reflete o perfil selecionado. Copy e diagnóstico técnico ficam separados, enquanto a política e a auditoria estendem o único `build:release` da Fase 1 antes que Playwright e o gate de release executem sobre o pacote real.

**Tech Stack:** TypeScript 5.9 strict, React 19, Chrome MV3, Vite 8, Node.js 22.18+, Vitest 4, Testing Library, jsdom, Playwright 1.61, axe-core, Transformers.js 4, ONNX Runtime Web, JSON canônico, SHA-256 e GitHub Actions.

## Global Constraints

- Fonte de verdade: docs/superpowers/specs/2026-07-19-tmr-ptbr-classifier-design.md e docs/superpowers/plans/2026-07-19-cleanfeed-ai-tmr-ptbr-master.md.
- Esta fase começa somente depois da Fase 1 concluir Tasks 1–9 e da Fase 3 publicar `benchmark/evidence/tmr-ptbr-v1/**`, `models/tmr-ai-text-detector/release.json` e `models/tmr-ai-text-detector/calibration-profiles.json`.
- A Fase 1/Task 6 já removeu `markingThreshold`, `blurThreshold`, `collapseThreshold` e `hideThreshold` de settings/UI, migrou os schemas e tornou `resolveMode` fail-closed antes do freeze; esta fase testa e consome esse contrato, não o reimplementa.
- Consumir sem renomear `ModelReleaseDescriptorV1`, `CalibrationProfilesFileV1`, `RuntimeCalibrationProfileV1`, `ModelStatus`, `EvidenceAssessment`, `DecisionOutcome`, `ClassificationResult` e `RuntimeModelIdentity` definidos na Fase 1, nem `RuntimeParityManifestV1`/`computeRuntimeParityDigest` definidos em `contracts/runtime-parity.ts` pela Fase 2.
- Depois da evidência da Fase 3, não criar nem modificar qualquer entrada de `inferenceCoreDigest`: `src/inference/**/*.ts`, `src/offscreen/worker-host.ts`, `src/shared/constants.ts`, `src/shared/types.ts`, os contracts de paridade e `package-lock.json`. Se uma correção exigir qualquer byte desse inventário, interromper o rollout e executar novamente scoring/calibração/holdout; nunca “atualizar” somente o digest.
- `RuntimeModelIdentity` é discriminado por `kind`: `bundle` carrega `modelId`, `modelVersion`, `bundleDigest`, `tokenizerDigest`, `aggregationVersion`, `contentCompositionVersion` e `calibrationSetDigest`; `builtin` carrega `modelId: "mock" | "stylometric"`, `modelVersion` e `implementationVersion`. O tokenizer TMR v1 está fixado em `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9`.
- `ModelStatus` mantém exatamente `state`, `backend`, `runtimeIdentity`, `calibrationCoverage: "none" | "partial" | "complete"`, `calibrationSetDigest`, `profileCount`, `earliestExpiry`, `reasonCodes` e os opcionais `initializedAt`/`supportsBatching`. Esta fase não adiciona estado de perfil singular nem redefine esse contrato.
- `DecisionOutcome` usa `triggers: Array<"document" | "localized">`; `selectedProfileDigest` e `cacheValidUntil` pertencem ao `ClassificationResult`, não ao status nem à decisão.
- Resultado legado sem `decision`, ou `DecisionOutcome.presentationAllowed === false`, é fail-closed: nenhum selo e nenhuma ação são aplicados.
- A preferência do usuário escolhe somente indicator, blur, collapse ou hide; nenhum limiar científico permanece editável ou persistível como UserSettings.
- A preferência nunca ultrapassa DecisionOutcome.actionCeiling.
- `gateDecision: "reject"` mantém o descritor em `rolloutState: "bundle-verified"`, mas produz pacote fallback sem diretório `dist/models/tmr-ai-text-detector`; o runtime ativo usa identidade `builtin`.
- `gateDecision: "indicator-only"` pode empacotar e ativar o TMR em `rolloutState: "indicator"`, mas todos os perfis e resultados têm teto `indicator`.
- `gateDecision: "pass"` pode autorizar ações somente depois de `rolloutState: "actions"`, com perfil válido, evidence sufficient, sinal global do documento e faixa de pelo menos 80 palavras. Enquanto estiver em `indicator`, pass continua limitado a indicador.
- Toda faixa `50-79` permanece indicator mesmo em pass; score localizado nunca produz blur, collapse ou hide.
- A interface nunca afirma autoria e nunca mostra score bruto no feed.
- Copy obrigatória: “Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA. Isso não comprova sua origem.”
- Score aparece somente no diagnóstico avançado, desligado por padrão, como score calibrado do modelo e nunca como probabilidade real de autoria.
- Perfil ausente, expirado ou incompatível faz o TMR se abster; um resultado separado do fallback estilométrico pode somente indicar. Artifact mismatch, OOD, bundle-verified, circuit breaker ou erro também nunca autoriza ação visual.
- `shadow` exige `presentationAllowed === false`; nenhum badge ou ação pode aparecer por resultado TMR nesse estágio.
- Perfis expiram exatamente 180 dias após issuedAt; o instante expiresAt já é expirado.
- Diagnósticos exportáveis contêm somente metadados técnicos e métricas agregadas: nunca texto, URL, autor, hash de conteúdo, score individual, history ou feedback.
- Todo runtime permanece offline; connect-src 'self', permissões e host_permissions não podem ser ampliados.
- Orçamentos na referência Windows 11/4 processadores lógicos disponíveis/8 GiB/Chrome for Testing Stable `150.0.7871.129` fixado por `tests/browser-lock.json`/WASM: tarefa síncrona <= 50 ms, cold start <= 10 s, warm p95 <= 2 s/post, memória incremental <= 512 MiB e erros < 1%.
- Há duas lanes deliberadas: E2E funcional MV3 usa o Chromium completo empacotado pelo Playwright (`channel: "chromium"`); scoring científico e performance usam o Chrome for Testing pinado, resolvido por `scripts/test-browser-lock.mjs` e lançado por `executablePath`. Uma lane nunca substitui nem é rotulada como a outra.
- `tests/browser-lock.json` tem schema fechado somente com `schemaVersion`, `product`, `channel` e `version`; o lock fixa `150.0.7871.129`, não um hash oficial do binário. A Fase 4 calcula localmente o SHA-256 do executável resolvido, sela esse fato no relatório de performance e o verificador o recalcula.
- O smoke real é o Playwright Chrome de `tests/e2e/real-model-smoke.spec.ts`, criado pela Fase 1. O job de release deve executar `npm run test:model:release`; ausência do ONNX ou teste pulado falha.
- Nunca versionar public/models/**, benchmark/data/**, benchmark/work/**, benchmark/out/** ou test-results/**.
- Cada task termina em um commit pequeno com git commit --no-verify, conforme autorização expressa do usuário.

---

## File map

- src/content/presentation/ — política fail-closed, selo, explicação e ações reversíveis.
- src/shared/classification-copy.ts — única fonte de copy probabilística e ressalvas técnicas.
- src/options/ e src/popup/ — escolha explícita do efeito e visibilidade do rollout/degradação.
- src/storage/settings.ts e src/storage/platform-settings.ts — migração que descarta limiares legados.
- src/storage/diagnostics.ts — allowlist compartilhável sem score individual.
- scripts/release-policy.mjs — matriz pura entre decisão científica e estágio de rollout.
- scripts/activate-model-release.mjs — única alteração permitida após os gates: `pass/indicator -> pass/actions`.
- scripts/run-release-build.mjs — owner da Fase 1, estendido para materializar os metadados canônicos e aplicar a política.
- contracts/runtime-parity.ts — owner da Fase 2; fonte única do manifesto/digest usado pelo harness e pelo build final.
- scripts/runtime-parity.mjs — owner da Fase 2; gera atomicamente o manifesto a partir do inventário fechado compartilhado.
- scripts/audit-model-package.mjs — inventário, digests, licença, decisão e ausência de rede.
- scripts/build-e2e-release-variants.mjs — builds de teste com descritores válidos, nunca publicáveis.
- tests/e2e/tmr-release.spec.ts — rollout, quatro modos, reversão, offline e reinício no Chromium completo da lane MV3.
- tests/e2e/tmr-performance.spec.ts — medição real de cold start, warm p95, memória, erro e long tasks.
- .github/workflows/tmr-release.yml — gate completo e upload somente depois da máquina de referência.
- docs/release-checklist.md e docs/model-validation.md — evidência e operação do release.

---

### Task 1: Centralizar copy probabilística e restringir score ao diagnóstico avançado

**Files:**
- Create: src/shared/classification-copy.json
- Create: src/shared/classification-copy.ts
- Modify: src/content/presentation/badge.ts
- Modify: src/content/presentation/explanation-panel.ts
- Modify: src/content/presentation/blur.ts
- Modify: src/content/presentation/collapse.ts
- Modify: src/content/presentation/hide.ts
- Modify: src/content/presentation/presentation-controller.ts
- Modify: src/content/post-controller.ts
- Modify: src/manual-analysis/components/ManualResult.tsx
- Modify: src/options/components/AdvancedSettings.tsx
- Modify: src/options/components/PrivacyNotice.tsx
- Modify: src/options/components/HistoryTable.tsx
- Test: tests/unit/content/badge.test.ts
- Test: tests/unit/content/explanation-panel.test.ts
- Test: tests/unit/content/presentation-modes.test.ts
- Test: tests/unit/manual-analysis/App.test.tsx
- Test: tests/unit/options/settings-sections.test.tsx
- Test: tests/unit/options/history.test.tsx
- Test: tests/integration/security-boundaries.test.ts

**Interfaces:**
- Produces: `classification-copy.json` como fonte serializável única das duas ressalvas; `PROBABILISTIC_DISCLOSURE`, `TECHNICAL_SCORE_DISCLAIMER`, `CLASSIFICATION_STATUS_COPY`, `EVIDENCE_QUALITY_COPY`, `PRESENTATION_COPY` e `FEEDBACK_COPY` como API TypeScript.
- Produces: ExplanationPanelOptions={showTechnicalScore?: boolean}.
- Produces: createExplanationPanel(result, callbacks, options?) sem score por default.

- [ ] **Step 1: Escrever testes RED para copy única e ausência de porcentagem no feed**

Em badge.test.ts, testar DEFAULT_SETTINGS e uma cópia com showScore true:

~~~ts
for (const showScore of [false, true]) {
  applyBadge(post, result("possibly_ai"), {
    ...DEFAULT_SETTINGS,
    showScore,
  });
  expect(screen.getByRole("button").textContent).toBe("◌ Sinais detectados");
  expect(screen.getByRole("button").textContent).not.toMatch(/%|0[.,]9/u);
}
~~~

Em explanation-panel.test.ts, exigir a copy obrigatória literal, os novos rótulos de feedback e ausência de score quando options não é informado.

- [ ] **Step 2: Escrever testes RED para score técnico opt-in**

~~~ts
const panel = createExplanationPanel(makeResult({
  runtimeIdentity: createBundleRuntimeIdentity(),
  selectedProfileDigest: PROFILE_DIGEST,
  decision: {
    ...decision,
    calibratedScore: 0.84321,
  },
}), { onFeedback: vi.fn() }, { showTechnicalScore: true });

expect(panel).toHaveTextContent("Score calibrado do modelo: 0,843");
expect(panel).toHaveTextContent(
  "Este score não equivale à probabilidade real de autoria por IA.",
);
expect(panel).not.toHaveTextContent("84%");
~~~

Adicionar testes que omitem toda a seção quando `showTechnicalScore` é false, a identidade é builtin/stylometric, `selectedProfileDigest` está ausente ou `decision.abstained` é true. Somente um resultado bundle com perfil efetivamente selecionado pode chamar o valor de calibrado.

- [ ] **Step 3: Executar testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/content/badge.test.ts tests/unit/content/explanation-panel.test.ts tests/unit/content/presentation-modes.test.ts tests/unit/manual-analysis/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/options/history.test.tsx
~~~

Expected: FAIL porque a copy ainda está duplicada, o badge pode mostrar aiScore e o painel não possui diagnóstico técnico opt-in.

- [ ] **Step 4: Criar a fonte única de copy**

~~~json
{
  "probabilisticDisclosure": "Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA. Isso não comprova sua origem.",
  "technicalScoreDisclaimer": "Este score não equivale à probabilidade real de autoria por IA."
}
~~~

Em `classification-copy.ts`:

~~~ts
import type {
  ClassificationStatus,
  EvidenceQuality,
  PresentationMode,
} from "@/shared/types";
import classificationCopy from "@/shared/classification-copy.json";

export const PROBABILISTIC_DISCLOSURE =
  classificationCopy.probabilisticDisclosure;

export const TECHNICAL_SCORE_DISCLAIMER =
  classificationCopy.technicalScoreDisclaimer;

export const CLASSIFICATION_STATUS_COPY: Record<
  ClassificationStatus,
  string
> = {
  probably_human: "Sinais não detectados",
  inconclusive: "Resultado inconclusivo",
  possibly_ai: "Sinais detectados",
  strong_ai_indication: "Sinais mais fortes",
  insufficient_evidence: "Evidência limitada",
  classification_failed: "Avaliação indisponível",
};

export const EVIDENCE_QUALITY_COPY: Record<EvidenceQuality, string> = {
  sufficient: "Evidência suficiente para o perfil aplicado",
  limited: "Evidência limitada",
  unsupported: "Conteúdo fora do escopo avaliado",
};

export const PRESENTATION_COPY: Record<
  Exclude<PresentationMode, "indicator">,
  { message: string; reveal: string }
> = {
  blur: {
    message: "Texto desfocado porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
  collapse: {
    message: "Texto recolhido porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
  hide: {
    message: "Texto ocultado porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
};

export const FEEDBACK_COPY = {
  human: "Não deveria ter sido marcado",
  ai: "A marcação parece correta",
  unknown: "Não sei",
} as const;
~~~

Importar essas constantes em todos os consumidores; nenhum componente mantém cópia própria equivalente.

- [ ] **Step 5: Remover score do feed e adicionar diagnóstico avançado**

Remover de applyBadge qualquer leitura de settings.showScore e result.aiScore. Alterar createExplanationPanel:

~~~ts
export interface ExplanationPanelOptions {
  showTechnicalScore?: boolean;
}

export function createExplanationPanel(
  result: ClassificationResult,
  callbacks: ExplanationPanelCallbacks,
  options: ExplanationPanelOptions = {},
): HTMLElement {
  // construir heading, disclosure, evidência e metadados existentes
  if (
    options.showTechnicalScore &&
    result.runtimeIdentity.kind === "bundle" &&
    result.selectedProfileDigest !== undefined &&
    !result.decision.abstained
  ) {
    panel.append(buildTechnicalDiagnostics(doc, result.decision));
  }
  return panel;
}

function buildTechnicalDiagnostics(
  doc: Document,
  decision: DecisionOutcome,
): HTMLElement {
  const details = doc.createElement("details");
  const summary = doc.createElement("summary");
  summary.textContent = "Diagnóstico avançado";
  const score = doc.createElement("p");
  score.textContent =
    "Score calibrado do modelo: " +
    decision.calibratedScore.toLocaleString("pt-BR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  const warning = doc.createElement("p");
  warning.textContent = TECHNICAL_SCORE_DISCLAIMER;
  details.append(summary, score, warning);
  return details;
}
~~~

PostController passa showTechnicalScore: settings.showScore ao abrir a explicação. Em AdvancedSettings, expor checkbox “Exibir score técnico no diagnóstico avançado”, desligado por DEFAULT_SETTINGS; o texto adjacente explica que o score não aparece no selo e não mede probabilidade real de autoria.

- [ ] **Step 6: Aplicar copy a modos, manual e feedback**

Blur, collapse e hide usam PRESENTATION_COPY e botão “Mostrar texto”. `ManualResult` remove Confidence e usa `result.evidence.quality` com `EVIDENCE_QUALITY_COPY`, seguido de `PROBABILISTIC_DISCLOSURE`. `HistoryTable` troca origem “IA” por “Modelo” e remove por completo a coluna/valor `row.score`; o campo legado pode permanecer no armazenamento somente para migração/identidade, mas a UI normal nunca o renderiza. Adicionar teste negativo com `row.score: 0.999` e exigir ausência de `0,999`, `99,9%`, “Score” e “Confiança”. Feedback mantém os valores internos `human|ai|unknown`, mas renderiza `FEEDBACK_COPY`.

- [ ] **Step 7: Verificar copy, XSS e ausência de alegações**

Run:

~~~powershell
npx vitest run tests/unit/content/badge.test.ts tests/unit/content/explanation-panel.test.ts tests/unit/content/presentation-modes.test.ts tests/unit/manual-analysis/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/options/history.test.tsx tests/integration/security-boundaries.test.ts
rg -n "Possivelmente gerado|Fortes indícios de IA|Era humano|Era IA|Math\.round\(result\.aiScore|foi escrito por IA|comprovadamente artificial" src
~~~

Expected: Vitest PASS; rg não retorna nenhuma ocorrência. Todos os textos entram por textContent ou React text nodes.

- [ ] **Step 8: Commit**

~~~powershell
git add -- src/shared/classification-copy.json src/shared/classification-copy.ts src/content/presentation/badge.ts src/content/presentation/explanation-panel.ts src/content/presentation/blur.ts src/content/presentation/collapse.ts src/content/presentation/hide.ts src/content/presentation/presentation-controller.ts src/content/post-controller.ts src/manual-analysis/components/ManualResult.tsx src/options/components/AdvancedSettings.tsx src/options/components/PrivacyNotice.tsx src/options/components/HistoryTable.tsx tests/unit/content/badge.test.ts tests/unit/content/explanation-panel.test.ts tests/unit/content/presentation-modes.test.ts tests/unit/manual-analysis/App.test.tsx tests/unit/options/settings-sections.test.tsx tests/unit/options/history.test.tsx tests/integration/security-boundaries.test.ts
git commit --no-verify -m "feat: present calibrated signals with probabilistic copy"
~~~

---

### Task 2: Expor rollout, calibração e degradação com diagnóstico privacy-safe

**Files:**
- Modify: src/shared/diagnostic-types.ts
- Modify: src/shared/messages.ts
- Modify: src/shared/message-validation.ts
- Create: src/shared/model-diagnostics-client.ts
- Modify: src/storage/diagnostics.ts
- Modify: src/options/api-types.ts
- Modify: src/options/App.tsx
- Modify: src/options/components/AdvancedSettings.tsx
- Modify: src/options/components/ModelSettings.tsx
- Modify: src/popup/components/ModelStatusCard.tsx
- Modify: src/popup/App.tsx
- Modify: src/background/message-router.ts
- Test: tests/unit/storage/diagnostics.test.ts
- Test: tests/unit/options/settings-sections.test.tsx
- Test: tests/unit/popup/model-status.test.tsx
- Test: tests/unit/background/message-router.test.ts
- Test: tests/integration/storage-privacy-audit.test.ts

**Interfaces:**
- Consumes: `ModelStatus` exato da Fase 1 e, separadamente, `gateDecision`/`rolloutState` do `ModelReleaseDescriptorV1`; o status ativo nunca é confundido com o estágio de evidência do descritor.
- Produces: `ModelDiagnosticsView={status: DiagnosticRuntimeStatus; release: DiagnosticReleaseStatus}` e APIs que preservam somente essa allowlist sanitizada.
- Produces: `modelRolloutLabel(release)` e `modelCalibrationLabel(status)` com copy estável; não produz um segundo `ModelStatus`.

- [ ] **Step 1: Escrever testes RED para todos os estados de rollout**

Em model-status.test.tsx, usar uma tabela:

~~~tsx
it.each([
  ["bundle-verified", "pending", "Bundle verificado; inativo no feed"],
  ["shadow", "pass", "Modo sombra; sem apresentação"],
  ["indicator", "indicator-only", "Avisos autorizados"],
  ["actions", "pass", "Ações visuais autorizadas"],
] as const)(
  "renders rollout %s with decision %s as %s",
  async (rolloutState, gateDecision, label) => {
    const api = fakePopupApi();
    vi.mocked(api.getModelDiagnostics).mockResolvedValue({
      status: readyStatus,
      release: {
        gateDecision,
        rolloutState,
      },
    });
    render(<App api={api} />);
    expect(await screen.findByText(label)).toBeVisible();
  },
);

it("renders builtin fallback separately from descriptor rollout", async () => {
  const api = fakePopupApi();
  vi.mocked(api.getModelDiagnostics).mockResolvedValue({
    status: {
      ...readyStatus,
      runtimeIdentity: createBuiltinRuntimeIdentity({ modelId: "stylometric" }),
      calibrationCoverage: "none",
    },
    release: { gateDecision: "reject", rolloutState: "bundle-verified" },
  });
  render(<App api={api} />);
  expect(await screen.findByText("Fallback estilométrico ativo")).toBeVisible();
  expect(screen.getByText("Bundle verificado; inativo no feed")).toBeVisible();
});
~~~

Adicionar casos para `calibrationCoverage` `none`, `partial` e `complete`. `none` exige “Sem perfil aplicável; o TMR se abstém e o fallback local pode apenas indicar.”; `partial` exige “Cobertura parcial de calibração”; `complete` exige “Cobertura completa de calibração”. Para `reasonCodes: ["CIRCUIT_BREAKER_OPEN"]`, exigir “TMR temporariamente desativado; usando fallback local.”

- [ ] **Step 2: Escrever testes RED para diagnóstico por allowlist**

Construir um ModelStatus com todos os campos permitidos e campos hostis adicionados por cast:

~~~ts
const source = {
  status: {
    ...fullModelStatus(),
    selectedProfileDigest: PROFILE_DIGEST,
    cacheValidUntil: "2026-08-01T00:00:00.000Z",
  },
  release: fullReleaseDescriptor(),
  aiScore: 0.97,
  calibratedScore: 0.96,
  postText: PORTUGUESE_TEXT,
  author: "Pessoa",
  url: "https://www.linkedin.com/in/pessoa",
  contentHash: HASH,
};

const report = await diagnosticsWithStatus(source).buildReport();
expect(report.modelStatus).toEqual({
  status: {
    state: "ready",
    backend: "wasm",
    runtimeIdentity: {
      kind: "bundle",
      modelId: "tmr-ai-text-detector",
      modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
      bundleDigest: BUNDLE_DIGEST,
      tokenizerDigest: TOKENIZER_DIGEST,
      aggregationVersion: "tmr-aggregation-v2",
      contentCompositionVersion: "lexical-content-v1",
      calibrationSetDigest: CALIBRATION_SET_DIGEST,
    },
    calibrationCoverage: "partial",
    calibrationSetDigest: CALIBRATION_SET_DIGEST,
    profileCount: 3,
    earliestExpiry: "2027-01-15T00:00:00.000Z",
    reasonCodes: [],
    initializedAt: 1_784_000_000_000,
    supportsBatching: true,
  },
  release: {
    gateDecision: "indicator-only",
    rolloutState: "indicator",
  },
});
const serialized = JSON.stringify(report);
expect(serialized).not.toMatch(
  /aiScore|calibratedScore|selectedProfileDigest|cacheValidUntil|postText|author|https:\/\//u,
);
expect(serialized).not.toContain(CONTENT_HASH);
~~~

- [ ] **Step 3: Executar os testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/storage/diagnostics.test.ts tests/unit/options/settings-sections.test.tsx tests/unit/popup/model-status.test.tsx tests/unit/background/message-router.test.ts tests/integration/storage-privacy-audit.test.ts
~~~

Expected: FAIL porque Options não consulta a visão combinada, a UI não distingue descritor de runtime e o diagnóstico ainda não possui a allowlist fechada.

- [ ] **Step 4: Estender somente a allowlist do diagnóstico**

~~~ts
export type DiagnosticRuntimeStatus = Pick<
  ModelStatus,
  | "state"
  | "backend"
  | "runtimeIdentity"
  | "calibrationCoverage"
  | "calibrationSetDigest"
  | "profileCount"
  | "earliestExpiry"
  | "reasonCodes"
  | "initializedAt"
  | "supportsBatching"
>;

export type DiagnosticReleaseStatus = Pick<
  ModelReleaseDescriptorV1,
  "gateDecision" | "rolloutState"
>;

export interface ModelDiagnosticsView {
  status: DiagnosticRuntimeStatus;
  release: DiagnosticReleaseStatus;
}
~~~

`sanitizeModelDiagnostics` copia cada campo explicitamente e discrimina `runtimeIdentity.kind` antes de copiar seus campos. Não espalhar status, descriptor, runtimeIdentity ou objetos de origem. `selectedProfileDigest` e `cacheValidUntil` pertencem ao resultado individual e são deliberadamente omitidos. `DiagnosticSettingsSummary` continua aceitando `showScore` como booleano, mas já chega sem os quatro limiares removidos pela Fase 1/Task 6 antes do freeze de paridade.

- [ ] **Step 5: Ligar o status real à página de opções**

Adicionar a `OptionsApi` e à API do popup:

~~~ts
getModelDiagnostics?(): Promise<ModelDiagnosticsView | null>;
~~~

Implementar uma função compartilhada no módulo:

~~~ts
async function requestModelDiagnostics(
  source: "options" | "popup",
): Promise<ModelDiagnosticsView | null> {
  const response = await chrome.runtime.sendMessage({
    source,
    target: "background",
    type: "MODEL_DIAGNOSTICS_REQUEST",
    payload: undefined,
  });
  const message = parseExtensionMessage(response);
  return message.type === "MODEL_DIAGNOSTICS_RESULT" ? message.payload : null;
}
~~~

Definir esse helper em `src/shared/model-diagnostics-client.ts`; `createChromeOptionsApi` chama `requestModelDiagnostics("options")` e `createChromePopupApi` chama `requestModelDiagnostics("popup")`, preservando as rotas fechadas. O background combina o `ModelStatus` ativo com somente `gateDecision`/`rolloutState` do descritor imutável e executa `sanitizeModelDiagnostics` antes da resposta. `createChromeOptionsApi` usa a mesma chamada tanto na UI quanto no provider do `DiagnosticsRepository`. App carrega settings, platform e a visão em paralelo e a passa a AdvancedSettings e ModelSettings. Uma falha de diagnóstico não impede editar settings.

- [ ] **Step 6: Renderizar estado operacional sem alegação de qualidade**

`ModelStatusCard` e `ModelSettings` mostram identidade ativa, operação, decisão científica, rollout, cobertura, quantidade de perfis e validade mínima. Usar:

~~~ts
const ROLLOUT_COPY: Record<
  ModelReleaseDescriptorV1["rolloutState"],
  string
> = {
  "bundle-verified": "Bundle verificado; inativo no feed",
  shadow: "Modo sombra; sem apresentação",
  indicator: "Avisos autorizados",
  actions: "Ações visuais autorizadas",
};

const CALIBRATION_COPY: Record<
  ModelStatus["calibrationCoverage"],
  string
> = {
  none: "Sem perfil aplicável; o TMR se abstém e o fallback local pode apenas indicar.",
  partial: "Cobertura parcial de calibração",
  complete: "Cobertura completa de calibração",
};

const GATE_COPY: Record<ModelReleaseDescriptorV1["gateDecision"], string> = {
  pending: "Validação pendente",
  reject: "Candidato não autorizado no pacote",
  "indicator-only": "Autorizado somente para avisos",
  pass: "Elegível para ações conforme rollout e perfil",
};
~~~

Se `runtimeIdentity.kind === "builtin"`, mostrar “Fallback estilométrico ativo” e manter a decisão/rollout do descritor em linha separada. Formatar `earliestExpiry` com `Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" })`; `null` vira “Nenhum perfil aplicável”. Não apresentar métricas de acurácia, score individual, `selectedProfileDigest` ou `cacheValidUntil` nesses cartões. `calibrationSetDigest` pode aparecer somente no diagnóstico avançado como digest técnico do conjunto, nunca como hash do conteúdo.

- [ ] **Step 7: Executar testes de UI e privacidade**

Run:

~~~powershell
npx vitest run tests/unit/storage/diagnostics.test.ts tests/unit/options/settings-sections.test.tsx tests/unit/popup/model-status.test.tsx tests/unit/background/message-router.test.ts tests/integration/storage-privacy-audit.test.ts tests/integration/security-boundaries.test.ts
npm run typecheck
~~~

Expected: PASS; o status degradado aparece em popup/opções/diagnóstico e o relatório não contém score individual ou dados de navegação.

- [ ] **Step 8: Commit**

~~~powershell
git add src/shared/diagnostic-types.ts src/shared/messages.ts src/shared/message-validation.ts src/shared/model-diagnostics-client.ts src/storage/diagnostics.ts src/options/api-types.ts src/options/App.tsx src/options/components/AdvancedSettings.tsx src/options/components/ModelSettings.tsx src/popup/components/ModelStatusCard.tsx src/popup/App.tsx src/background/message-router.ts tests/unit/storage/diagnostics.test.ts tests/unit/options/settings-sections.test.tsx tests/unit/popup/model-status.test.tsx tests/unit/background/message-router.test.ts tests/integration/storage-privacy-audit.test.ts
git commit --no-verify -m "feat: expose privacy-safe model rollout status"
~~~

---

### Task 3: Materializar e auditar a decisão científica no pacote

**Files:**
- Consume: contracts/runtime-parity.ts
- Consume: scripts/runtime-parity.mjs
- Consume: scripts/runtime-parity.d.mts
- Create: scripts/release-policy.mjs
- Create: scripts/release-policy.d.mts
- Create: scripts/activate-model-release.mjs
- Create: scripts/activate-model-release.d.mts
- Create: scripts/audit-model-package.mjs
- Create: scripts/audit-model-package.d.mts
- Modify: scripts/run-release-build.mjs
- Modify: scripts/verify-model-bundle.mjs
- Modify: scripts/verify-model-bundle.d.mts
- Modify: scripts/sanitize-offline-bundle.mjs
- Modify: scripts/audit-build.mjs
- Modify: package.json
- Test: tests/unit/scripts/release-policy.test.ts
- Test: tests/unit/scripts/activate-model-release.test.ts
- Test: tests/unit/scripts/model-bundle-verifier.test.ts
- Test: tests/integration/model-package-audit.test.ts
- Test: tests/integration/audit-build.test.ts
- Test: tests/integration/release-build-gate.test.ts
- Fixture: tests/fixtures/model-release/reject/release.json
- Fixture: tests/fixtures/model-release/reject/calibration-profiles.json
- Fixture: tests/fixtures/model-release/indicator-only/release.json
- Fixture: tests/fixtures/model-release/indicator-only/calibration-profiles.json
- Fixture: tests/fixtures/model-release/pass-indicator/release.json
- Fixture: tests/fixtures/model-release/pass-indicator/calibration-profiles.json
- Fixture: tests/fixtures/model-release/pass-actions/release.json
- Fixture: tests/fixtures/model-release/pass-actions/calibration-profiles.json
- Fixture: tests/fixtures/model-release/pending/release.json
- Fixture: tests/fixtures/model-release/pending/calibration-profiles.json

**Interfaces:**
- Consumes: `benchmark/evidence/tmr-ptbr-v1/{dataset-summary,split-summary,fit-summary,benchmark-report,decision,evidence-digest}.json`, o relatório Markdown sanitizado e os dois artefatos canônicos em `models/tmr-ai-text-detector` publicados pela Fase 3.
- Consumes: os parsers fechados de `contracts/model-release.ts` e `contracts/calibration-profile.ts`, além do owner `scripts/run-release-build.mjs` e do script `build:release` criados na Fase 1.
- Produces: `resolveReleasePolicy(release: ModelReleaseDescriptorV1, profilesFile: CalibrationProfilesFileV1, now?): ReleasePackagingPolicy`.
- Produces: activateModelRelease(options): Promise<ActivationResult>, que pode alterar somente `rolloutState` de `indicator` para `actions` quando `gateDecision` é `pass`.
- Produces: auditModelPackage(options): Promise<void>.
- Produces: `dist/runtime-parity.json` pelo gerador compartilhado e exige igualdade com `benchmark-report.json.runtimeParityDigest`; nunca compara `extensionBuildDigest` com o build final.
- Produces: `assertRuntimeParity(manifest, reportPath): Promise<void>` como composição do parser/helper compartilhado, sem reimplementar o digest.

- [ ] **Step 1: Escrever a matriz de política como testes RED**

~~~ts
expect(resolveReleasePolicy(rejectRelease, emptyProfilesFile)).toEqual({
  includeTmr: false,
  activeRuntimeKind: "builtin",
  maximumActionCeiling: "indicator",
});

expect(resolveReleasePolicy(indicatorRelease, indicatorProfiles)).toEqual({
  includeTmr: true,
  activeRuntimeKind: "bundle",
  maximumActionCeiling: "indicator",
});

expect(resolveReleasePolicy(passIndicatorRelease, passProfiles)).toEqual({
  includeTmr: true,
  activeRuntimeKind: "bundle",
  maximumActionCeiling: "indicator",
});

expect(resolveReleasePolicy(passActionsRelease, passProfiles)).toEqual({
  includeTmr: true,
  activeRuntimeKind: "bundle",
  maximumActionCeiling: "hide",
});

expect(() => resolveReleasePolicy(pendingRelease, emptyProfilesFile)).toThrow(
  "RELEASE_DECISION_PENDING",
);
~~~

As fixtures usam exatamente: `reject/bundle-verified`, `indicator-only/indicator`, `pass/indicator`, `pass/actions` e `pending/bundle-verified`. Adicionar casos que rejeitam `indicator-only` fora de `indicator`, `pass` em `bundle-verified` ou `shadow`, `indicator-only` com `actionCeiling: "hide"`, pass com perfil `50-79` acima de `indicator`, profile digest ausente do descritor, evidence digest divergente, `tokenizerDigest` divergente do valor locked em release/profile/runtime parity e perfil expirado no instante do build. `thresholds.documentAction` continua obrigatório pelo schema da Fase 1, mas jamais supera `actionCeiling: "indicator"`. O descritor reject continua `bundle-verified`; somente a política ativa o runtime `builtin` e omite o diretório TMR.

Em `release-build-gate.test.ts`, provar que licença não aprovada bloqueia indicator-only/pass antes de empacotar, mas não bloqueia o build fallback reject; neste último caso o bundle real ainda é verificado e smoked, e o diretório inteiro do candidato deve estar ausente de `dist`. Para todas as decisões, um runner injetado registra e exige a ordem `verify bundle -> test:model:smoke -> Vite -> materialize/audit`; smoke ausente/falho impede o Vite. Um processo com `CLEANFEED_E2E_VARIANT_METADATA_DIR` também deve falhar `RELEASE_TEST_METADATA_FORBIDDEN` antes do build. Após sucesso ou falha, `public/models/tmr-ai-text-detector` continua com os dez arquivos exatos e `npm run model:verify` permanece válido.

- [ ] **Step 2: Escrever auditoria RED para conteúdo exato do pacote**

Em model-package-audit.test.ts, construir dist temporários sob o diretório de temp do sistema:

1. reject + diretório TMR presente -> falha MODEL_MUST_BE_ABSENT;
2. reject + diretório ausente -> passa;
3. indicator/pass + arquivo ausente, extra, tamanho errado ou SHA errado -> falha;
4. indicator/pass sem `LICENSE`, `NOTICE.md`, `release.json` ou `calibration-profiles.json` -> falha;
5. pacote que contém `release-report.json`, corpus, prediction ou qualquer arquivo não inventariado -> falha `UNEXPECTED_MODEL_FILE`;
6. `evidence-digest.json.scientificEvidenceDigest`, `benchmark-report.json.reportDigest` e `release.evidenceDigest` diferentes entre si -> falha;
7. `publicationDigest` divergente do SHA-256 canônico dos outros seis arquivos públicos -> falha; `evidence-digest.json`, `release.json` e `calibration-profiles.json` ficam fora desse cálculo;
8. `dist/runtime-parity.json` ausente, inválido ou com digest diferente de `benchmark-report.json.runtimeParityDigest` -> falha `RUNTIME_PARITY_MISMATCH`;
9. pacote correto, evidência sanitizada verificada e sem origem remota executável -> passa.

- [ ] **Step 3: Executar os testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/scripts/release-policy.test.ts tests/unit/scripts/activate-model-release.test.ts tests/integration/model-package-audit.test.ts tests/integration/audit-build.test.ts
~~~

Expected: FAIL porque os scripts de política/ativação/auditoria não existem e o build base ainda não aplica a decisão ao inventário do modelo.

- [ ] **Step 4: Implementar a matriz pura de release**

~~~js
export function resolveReleasePolicy(release, profilesFile, now = Date.now()) {
  const profiles = profilesFile.profiles;
  if (release.gateDecision === "pending") {
    throw new Error("RELEASE_DECISION_PENDING");
  }
  if (release.gateDecision === "reject") {
    if (
      release.rolloutState !== "bundle-verified" ||
      release.profileDigests.length !== 0 ||
      profiles.length !== 0
    ) {
      throw new Error("REJECT_MUST_NOT_PUBLISH_PROFILES");
    }
    return {
      includeTmr: false,
      activeRuntimeKind: "builtin",
      maximumActionCeiling: "indicator",
    };
  }

  assertExactProfileSet(release.profileDigests, profiles);
  assertProfilesCurrent(profiles, now);

  if (release.gateDecision === "indicator-only") {
    if (
      release.rolloutState !== "indicator" ||
      profiles.some((profile) => profile.actionCeiling !== "indicator")
    ) {
      throw new Error("INDICATOR_ONLY_ACTION_BYPASS");
    }
    return {
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "indicator",
    };
  }

  if (
    release.rolloutState !== "indicator" &&
    release.rolloutState !== "actions"
  ) {
    throw new Error("PASS_ROLLOUT_NOT_PUBLIC");
  }

  for (const profile of profiles) {
    if (
      profile.lengthBucket === "50-79" &&
      profile.actionCeiling !== "indicator"
    ) {
      throw new Error("SHORT_TEXT_ACTION_BYPASS");
    }
  }
  return {
    includeTmr: true,
    activeRuntimeKind: "bundle",
    maximumActionCeiling:
      release.rolloutState === "actions" ? "hide" : "indicator",
  };
}
~~~

`assertExactProfileSet` compara conjuntos ordenados, rejeita duplicatas e usa os parsers da Fase 1 antes da política. A política não inventa `rolloutState: "fallback"`: fallback é observado no `ModelStatus.runtimeIdentity.kind === "builtin"`, enquanto o descritor reject permanece `bundle-verified`.

- [ ] **Step 5: Implementar ativação monotônica sem republicar a ciência**

`activate-model-release.mjs` recebe somente artefatos já publicados:

~~~powershell
node scripts/activate-model-release.mjs --release models/tmr-ai-text-detector/release.json --profiles models/tmr-ai-text-detector/calibration-profiles.json --evidence-dir benchmark/evidence/tmr-ptbr-v1 --expected-evidence-digest $evidenceDigest
~~~

O script executa os parsers fechados, exige igualdade entre `--expected-evidence-digest`, `release.evidenceDigest`, `evidence-digest.json.scientificEvidenceDigest` e `benchmark-report.json.reportDigest`, confere separadamente o `publicationDigest` e o conjunto exato de profiles. `publicationDigest` é recalculado somente sobre os outros seis arquivos de evidência; `evidence-digest.json`, `release.json` e `calibration-profiles.json` ficam fora dele. A transição de rollout não exige refresh nem altera qualquer digest científico/publicado.

- `pass/indicator` -> alterar somente `rolloutState` para `actions`;
- `pass/actions` -> retornar idempotentemente sem alterar bytes;
- `indicator-only/indicator` e `reject/bundle-verified` -> retornar `activated: false` sem alterar bytes;
- `pending`, `shadow`, combinação inválida, digest divergente ou perfil expirado -> falhar sem alterar o arquivo.

Antes de gravar, comparar uma cópia do objeto removendo `rolloutState`; qualquer diferença entre entrada e saída falha `ACTIVATION_MUTATED_SCIENTIFIC_FIELDS`. Serializar canonicamente em arquivo temporário no mesmo diretório, fazer rename atômico e nunca regravar thresholds, `gateDecision`, `tokenizerDigest`, profile digests, calibration set digest ou evidência. Os testes simulam falha antes do rename e comprovam que `release.json` permanece byte a byte igual.

- [ ] **Step 6: Estender o owner único do build com staging seguro e condicional**

Não criar um segundo runner. Estender a função exportada por `scripts/run-release-build.mjs`, criada na Fase 1, para receber a política:

~~~js
export async function runReleaseBuild({
  repositoryRoot,
  publicDirectory,
  distDirectory,
  now = Date.now(),
}) {
  const metadata = await loadReleaseMetadata(repositoryRoot);
  const policy = resolveReleasePolicy(
    metadata.release,
    metadata.profilesFile,
    now,
  );
  await assertDistributionLicense(metadata.licenseReview, policy);
  await verifySanitizedEvidence(
    join(repositoryRoot, "benchmark/evidence/tmr-ptbr-v1"),
    metadata.release,
  );

  await verifyMaterializedBundle(
    metadata.publicModelDirectory,
    metadata.sourceLock,
  );
  if (process.env.CLEANFEED_E2E_VARIANT_METADATA_DIR !== undefined) {
    throw new Error("RELEASE_TEST_METADATA_FORBIDDEN");
  }

  await runRequiredRealModelSmoke();
  await runBaseViteBuild();
  const parityManifest = await buildRuntimeParityManifest({
    repoRoot: repositoryRoot,
    modelManifestPath: join(
      repositoryRoot,
      "models/tmr-ai-text-detector/cleanfeed-model.json",
    ),
  });
  await writeRuntimeParityManifest(parityManifest, distDirectory);
  await assertRuntimeParity(
    parityManifest,
    join(repositoryRoot, "benchmark/evidence/tmr-ptbr-v1/benchmark-report.json"),
  );
  const target = assertChildPath(
    distDirectory,
    join(distDirectory, "models/tmr-ai-text-detector"),
  );
  if (!policy.includeTmr) {
    await rm(target, { recursive: true, force: true });
  } else {
    await materializeCanonicalMetadata({
      sourceDirectory: join(repositoryRoot, "models/tmr-ai-text-detector"),
      targetDirectory: target,
    });
    await verifyReleaseModelDirectory(target, metadata);
  }
  await verifyMaterializedBundle(
    metadata.publicModelDirectory,
    metadata.sourceLock,
  );
  return { ...policy, packagedFiles: await listRelativeFilesIfPresent(target) };
}
~~~

`verifyMaterializedBundle` da Fase 1 permanece estrito aos dez arquivos de aquisição em `public` e é executado antes e depois do build. Acrescentar somente `verifyReleaseModelDirectory`, que exige exatamente doze no pacote final. `materializeCanonicalMetadata` roda depois do Vite e escreve diretamente no target validado dentro de `dist`; nunca altera `public`. Assim, `model:verify` continua idempotente em builds repetidos. O bundle real permanece obrigatório antes do build inclusive para reject. Mover o gate de licença já existente dentro do mesmo `runReleaseBuild`, sem criar outro runner: `assertDistributionLicense` exige `approved` sempre que `includeTmr` é true; reject pode gerar o pacote fallback com revisão não aprovada porque todo o diretório, inclusive LICENSE/NOTICE do candidato, será removido de `dist` e a auditoria prova a ausência.

`runRequiredRealModelSmoke` preserva literalmente a chamada da Fase 1 a `test:model:smoke` via `process.execPath`/`npm_execpath` antes de `runBaseViteBuild`; ausência/falha interrompe toda decisão, inclusive reject. O teste RED injeta um runner e exige a ordem `verify bundle -> smoke -> Vite -> metadata/parity -> audit`. `runBaseViteBuild` recebe um env construído explicitamente sem `CLEANFEED_E2E_VARIANT_METADATA_DIR` e o runner falha se o caller tentar fornecê-la, impedindo metadata test-only em release.

`materializeCanonicalMetadata` copia `release.json` e `calibration-profiles.json` da fonte versionada `models/tmr-ai-text-detector` diretamente para `dist/models/tmr-ai-text-detector`. O alvo de qualquer escrita/remoção é resolvido e comprovado dentro de `dist` antes da operação. Nunca escrever/remover `public/models` nem `models`, e nunca materializar `benchmark/evidence` dentro da extensão.

Importar `buildRuntimeParityManifest`/`writeRuntimeParityManifest` de `scripts/runtime-parity.mjs` e o parser/helper de `contracts/runtime-parity.ts`; não copiar algoritmo ou lista de arquivos. O digest é SHA-256 do JSON canônico `{schemaVersion:1,modelId,modelVersion,bundleDigest,aggregationVersion,contentCompositionVersion,tokenizerDigest,inferenceCoreDigest}`. Antes de comparar o digest composto, exigir que manifest, release e todos os perfis tragam o `tokenizerDigest` locked `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9`. `benchmarkBuildDigest`, `extensionBuildDigest`, shell do harness, backend e browser continuam auditáveis no relatório, mas ficam fora do parity digest e nunca são comparados ao digest do `dist` final.

- [ ] **Step 7: Auditar inventário, integridade, licença e rede**

`auditModelPackage` exige o inventário exato: os sete `LockedArtifact` (`onnx/model_int8.onnx`, `config.json`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `merges.txt`, `special_tokens_map.json`) mais `cleanfeed-model.json`, `LICENSE`, `NOTICE.md`, `release.json` e `calibration-profiles.json`. Para indicator/pass, qualquer diferença de conjunto, tamanho ou SHA falha. Os dois JSON versionados em `models/tmr-ai-text-detector` devem ser byte a byte iguais aos materializados em `public` e `dist`. Para reject, qualquer arquivo sob `dist/models/tmr-ai-text-detector` falha. `benchmark-report.json`, `benchmark-report.md`, predictions e dados nunca entram no inventário da extensão.

Antes da auditoria do pacote, executar a verificação da Fase 3 e exigir a cadeia sem ciclo: `release.evidenceDigest == evidence-digest.json.scientificEvidenceDigest == benchmark-report.json.reportDigest`; depois recalcular separadamente `evidence-digest.json.publicationDigest` sobre os outros seis arquivos públicos, excluindo o próprio manifesto e os metadados de modelo:

~~~powershell
npm run benchmark -- verify-published-evidence --evidence-dir benchmark/evidence/tmr-ptbr-v1 --model-dir models/tmr-ai-text-detector
~~~

Esse verificador pertence à Fase 3 e opera em checkout limpo: não lê `benchmark/out`, `benchmark/work` ou `benchmark/data`. Ele recalcula a allowlist e o `publicationDigest`, cruza decision/report/scientific evidence/calibration set/profile digests com o descritor atual e permite somente que `rolloutState` tenha avançado monotonicamente pela Fase 4.

Modificar `sanitize-offline-bundle.mjs` para processar somente js, mjs, cjs, html e css; JSON de proveniência não é reescrito. `audit-build` continua proibindo formas executáveis remotas, confirma que manifest permissions, host_permissions e CSP não mudaram e exige `dist/runtime-parity.json` fechado/íntegro como arquivo raiz autorizado.

- [ ] **Step 8: Integrar scripts de build e auditoria**

Adicionar:

~~~json
{
  "scripts": {
    "model:evidence:verify": "npm run benchmark -- verify-published-evidence --evidence-dir benchmark/evidence/tmr-ptbr-v1 --model-dir models/tmr-ai-text-detector",
    "release:activate": "node scripts/activate-model-release.mjs --release models/tmr-ai-text-detector/release.json --profiles models/tmr-ai-text-detector/calibration-profiles.json --evidence-dir benchmark/evidence/tmr-ptbr-v1",
    "audit:model": "node scripts/audit-model-package.mjs --dist dist --metadata models/tmr-ai-text-detector --evidence benchmark/evidence/tmr-ptbr-v1"
  }
}
~~~

Não redefinir `build:release`: ele continua apontando exclusivamente para `scripts/run-release-build.mjs`, criado na Fase 1. O runner passa a falhar para `pending`, `shadow`, `pass/bundle-verified` e `indicator-only/bundle-verified`; `reject/bundle-verified` conclui com runtime builtin e sem TMR; `indicator-only/indicator`, `pass/indicator` e `pass/actions` exigem bundle materializado e verificado.

- [ ] **Step 9: Executar política, build e auditorias**

Run:

~~~powershell
npx vitest run tests/unit/scripts/release-policy.test.ts tests/unit/scripts/activate-model-release.test.ts tests/unit/scripts/model-bundle-verifier.test.ts tests/integration/model-package-audit.test.ts tests/integration/release-build-gate.test.ts tests/integration/audit-build.test.ts tests/integration/offline-assets.test.ts
npm run model:evidence:verify
npm run model:verify
npm run build:release
npm run audit
npm run audit:model
~~~

Expected: todos retornam 0 para a decisão real da Fase 3. Se ela for reject, `Test-Path dist/models/tmr-ai-text-detector` retorna `False`; caso contrário, `audit:model` lista exatamente os doze arquivos autorizados, sem relatório de benchmark ou extras. Um `pass/indicator` permanece empacotado porém limitado a indicador; esta task não o ativa.

- [ ] **Step 10: Commit**

~~~powershell
git add -- scripts/release-policy.mjs scripts/release-policy.d.mts scripts/activate-model-release.mjs scripts/activate-model-release.d.mts scripts/audit-model-package.mjs scripts/audit-model-package.d.mts scripts/run-release-build.mjs scripts/verify-model-bundle.mjs scripts/verify-model-bundle.d.mts scripts/sanitize-offline-bundle.mjs scripts/audit-build.mjs package.json tests/unit/scripts/release-policy.test.ts tests/unit/scripts/activate-model-release.test.ts tests/unit/scripts/model-bundle-verifier.test.ts tests/integration/model-package-audit.test.ts tests/integration/audit-build.test.ts tests/integration/release-build-gate.test.ts tests/fixtures/model-release/reject/release.json tests/fixtures/model-release/reject/calibration-profiles.json tests/fixtures/model-release/indicator-only/release.json tests/fixtures/model-release/indicator-only/calibration-profiles.json tests/fixtures/model-release/pass-indicator/release.json tests/fixtures/model-release/pass-indicator/calibration-profiles.json tests/fixtures/model-release/pass-actions/release.json tests/fixtures/model-release/pass-actions/calibration-profiles.json tests/fixtures/model-release/pending/release.json tests/fixtures/model-release/pending/calibration-profiles.json
git commit --no-verify -m "build: package only the benchmark-authorized model release"
~~~

---

### Task 4: Tornar smoke real e pacote auditado obrigatórios no CI de release

**Files:**
- Create: .github/workflows/tmr-release.yml
- Create: scripts/assert-release-gates.mjs
- Create: scripts/assert-release-gates.d.mts
- Modify: package.json
- Test: tests/unit/scripts/release-gates.test.ts
- Consume: tests/integration/real-model-smoke.test.ts

**Interfaces:**
- Consumes: `model:fetch`, `model:verify`, `build:release`, `build:model-smoke`, `test:model:smoke` e `test:model:release` produzidos pela Fase 1; o smoke é `tests/e2e/real-model-smoke.spec.ts` no Chromium completo do Playwright.
- Produces: assertReleaseInputs({modelDirectory, metadataDirectory, distDirectory}): Promise<void>.
- Produces: `verify:release:base` e o job `verify-release`, sem redefinir owner, spec, fixture ou config do smoke real.

- [ ] **Step 1: Escrever testes RED para ausência do artefato e owner único**

~~~ts
await expect(
  assertReleaseInputs({
    modelDirectory: missingDirectory,
    metadataDirectory,
    distDirectory,
  }),
).rejects.toThrow("REAL_MODEL_REQUIRED");

await expect(
  assertReleaseInputs({
    modelDirectory: directoryWithoutOnnx,
    metadataDirectory,
    distDirectory,
  }),
).rejects.toThrow("MODEL_INT8_ONNX_REQUIRED");

await expect(
  assertReleaseInputs({
    modelDirectory: missingDirectory,
    metadataDirectory: rejectMetadataDirectory,
    distDirectory: fallbackDistDirectory,
  }),
).rejects.toThrow("REAL_MODEL_REQUIRED");
~~~

Adicionar teste que lê um `package.json` de fixture e exige owner único: `build:release` aponta para `scripts/run-release-build.mjs`; `test:model:release` aponta para `scripts/run-real-model-tests.mjs`; não existe outro script que execute um smoke real via Vitest. Uma fixture insegura que tenta usar `vitest run` como smoke do modelo falha `REAL_MODEL_SMOKE_MUST_USE_PLAYWRIGHT`.

- [ ] **Step 2: Executar testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/scripts/release-gates.test.ts tests/integration/real-model-smoke.test.ts
~~~

Expected: FAIL porque `assert-release-gates` não existe e a cadeia de release ainda não audita owner/política em conjunto.

- [ ] **Step 3: Preservar o smoke Chrome obrigatório da Fase 1**

Não modificar `scripts/run-real-model-tests.mjs`, `tests/e2e/real-model-smoke.spec.ts`, `src/model-smoke/model-smoke.html`, `tests/e2e/model-smoke-manifest.ts` ou `playwright.model-smoke.config.ts`. Verificar que o contrato recebido da Fase 1 continua assim:

1. `test:model:release` valida `cleanfeed-model.json` e `onnx/model_int8.onnx` antes de iniciar;
2. executa Playwright com `playwright.model-smoke.config.ts` e `tests/e2e/real-model-smoke.spec.ts` no Chromium completo da lane MV3;
3. ausência do bundle, browser, suite ou caso executado retorna exit code diferente de zero;
4. não existe `describe.skipIf`, loader de filesystem em Vitest ou fallback para mock;
5. mede a execução real offline, mas não fixa alegação de autoria para textos de smoke.

Run:

~~~powershell
rg -n "real-model-smoke.spec.ts|playwright.model-smoke.config.ts" scripts/run-real-model-tests.mjs package.json
rg -n "describe\.skip|skipIf|vitest" tests/e2e/real-model-smoke.spec.ts scripts/run-real-model-tests.mjs
~~~

Expected: a primeira busca encontra o runner/config canônicos; a segunda não encontra skip nem Vitest.

- [ ] **Step 4: Criar o agregador dos gates locais**

~~~js
export async function assertReleaseInputs({
  modelDirectory,
  metadataDirectory,
  distDirectory,
}) {
  const metadata = await assertReleaseMetadata(metadataDirectory);
  const policy = resolveReleasePolicy(
    metadata.release,
    metadata.profilesFile,
  );
  await assertRealModelFiles(modelDirectory);
  await verifyModelBundle(modelDirectory);
  await auditModelPackage({
    distDirectory,
    metadataDirectory,
    evidenceDirectory: "benchmark/evidence/tmr-ptbr-v1",
  });
  return policy;
}
~~~

O CLI aceita `--model`, `--metadata`, `--evidence` e `--dist`, usa os defaults do repositório e retorna exit code 1 com todos os motivos ordenados. Também valida o mapa de scripts de `package.json`, sem executar ou substituir o runner Chrome.

- [ ] **Step 5: Adicionar scripts de release**

~~~json
{
  "scripts": {
    "verify:release:base": "npm run format:check && npm run lint && npm run typecheck && vitest run && npm run model:evidence:verify && npm run model:verify && npm run test:model:release && npm run build:release && npm run audit && npm run audit:model && npm run verify:build && npm run docs:check"
  }
}
~~~

Não alterar `npm run verify`, `build:release` ou `test:model:release`; o novo comando apenas compõe os owners existentes. O bundle candidato e o smoke Playwright real são obrigatórios para todas as três decisões, inclusive reject. A diferença é posterior: `build:release` omite o diretório TMR de `dist` em reject, mas isso nunca permite validar o candidato sem o ONNX de origem.

- [ ] **Step 6: Criar workflow Windows sem permissões ampliadas**

~~~yaml
name: TMR release gate

on:
  workflow_dispatch:
  push:
    tags:
      - "v*"

permissions:
  contents: read

jobs:
  verify-release:
    runs-on: windows-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.18.0"
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run model:fetch
      - run: npm run verify:release:base
~~~

Nenhum secret, token de escrita ou endpoint é usado. Este job deliberadamente não publica `dist`. A Task 5 acrescentará o E2E de rollout, e a Task 6 acrescentará a máquina de referência e o único job de upload; `windows-latest` não será usado para alegar os limites de hardware.

- [ ] **Step 7: Executar runner e gates locais**

Run:

~~~powershell
npx vitest run tests/unit/scripts/release-gates.test.ts tests/integration/real-model-smoke.test.ts
npm run model:evidence:verify
npm run model:verify
npm run test:model:release
npm run build:release
npm run audit
npm run audit:model
~~~

Expected: todos retornam 0; a saída identifica `tests/e2e/real-model-smoke.spec.ts` executado no bundled Chromium real e não contém skipped. Nenhum teste Vitest tenta carregar `model_int8.onnx` diretamente do filesystem.

- [ ] **Step 8: Commit**

~~~powershell
git add .github/workflows/tmr-release.yml scripts/assert-release-gates.mjs scripts/assert-release-gates.d.mts tests/unit/scripts/release-gates.test.ts package.json
git commit --no-verify -m "ci: require the real TMR release gates"
~~~

---

### Task 5: Validar rollout, modos, acessibilidade e offline no Chromium MV3 real

**Files:**
- Consume: contracts/runtime-parity.ts
- Consume: scripts/runtime-parity.mjs
- Create: scripts/build-e2e-release-variants.mjs
- Create: scripts/build-e2e-release-variants.d.mts
- Create: scripts/assert-functional-browser-receipt.mjs
- Create: scripts/assert-functional-browser-receipt.d.mts
- Create: tests/e2e/fixtures/release-variants.ts
- Create: tests/e2e/helpers/functional-browser-receipt.ts
- Create: tests/e2e/tmr-release.spec.ts
- Create: tests/unit/scripts/functional-browser-receipt.test.ts
- Modify: vite.config.ts
- Modify: vite.manual-analysis.config.ts
- Modify: tests/e2e/helpers/load-extension.ts
- Modify: tests/e2e/fixtures/linkedin-feed.html
- Modify: tests/e2e/extension.spec.ts
- Modify: tests/e2e/full-mvp.spec.ts
- Modify: playwright.config.ts
- Modify: .github/workflows/tmr-release.yml
- Modify: package.json
- Test: tests/unit/inference/model-bundle.test.ts
- Test: tests/unit/content/presentation-controller.test.ts

**Interfaces:**
- Produces: buildReleaseVariant(name, recipe, outputDirectory): Promise<string>.
- Produces: createReleaseVariantRecipe("shadow"|"indicator-only"|"pass"|"expired"): ReleaseVariantRecipe com `gateDecision`/`rolloutState` canônicos.
- Produces: launchExtension(distPath, userDataDirectory?): Promise<BrowserContext>.
- Produces: `test-results/tmr-functional-browser.json` com browser kind/channel/versão completa, versão Playwright e revisão empacotada, sem confundi-lo com Chrome for Testing.
- Produces: `assertFunctionalBrowserReceipt(receipt, lock): void`, com parser de chaves exatas reutilizável pelo CI e renderer.
- Consome o TMR real, mas usa perfis sintéticos test-only com digests válidos e limiares zero somente para testar wiring/presentação; esses perfis nunca entram em `build:release` e `audit:model` deve rejeitá-los.

- [ ] **Step 1: Escrever testes RED que substituem a aceitação insegura antiga**

Em full-mvp.spec.ts, substituir a expectativa “fallback + preferência blur desfoca” por:

~~~ts
await setPresentationMode(serviceWorker, "hide");
await feed.reload();
const badge = feed.locator(
  "button.cleanfeed-badge[data-cleanfeed-mode='indicator']",
);
await expect(badge).toBeVisible();
await expect(feed.getByTestId("long-post")).not.toHaveClass(
  /cleanfeed-(blurred|collapsed|hidden)/u,
);
~~~

O teste usa o fallback não calibrado normal e prova o teto indicator de ponta a ponta.

- [ ] **Step 2: Escrever os cenários RED de rollout**

Em tmr-release.spec.ts:

1. shadow + preferência hide -> `DecisionOutcome.presentationAllowed === false`, nenhum badge/classe;
2. indicator-only + preferência hide -> badge “Sinais detectados”, modo indicator, nenhuma classe;
3. perfil expirado + preferência hide -> TMR se abstém; a fixture estilométrica determinística pode produzir somente badge indicator, nunca ação; popup mostra `calibrationCoverage: none`, razão de expiração e identidade builtin ativa;
4. pass + cada preferência blur/collapse/hide -> classe correspondente e botão “Mostrar texto”;
5. pass + post de 70 palavras -> apenas indicator;
6. revelar remove classe/placeholder e mantém badge;
7. restaurar remove todos os data-cleanfeed-owned e preserva texto original;
8. rede observada contém somente chrome-extension e fixture local;
9. um resultado TMR com perfil selecionado expõe `selectedProfileDigest` e `cacheValidUntil`, enquanto shadow/expired não os inventam;
10. `triggers: ["localized"]` nunca autoriza modo visual, mesmo com preferência hide;
11. o `dist` canônico já produzido por `build:release` corresponde ao descriptor source: reject usa runtime builtin e não possui diretório TMR; indicator-only/pass usam identidade bundle com `tokenizerDigest`/`calibrationSetDigest` exatos e nunca excedem a política atual.
12. o receipt funcional identifica `browserKind: "playwright-bundled-chromium"`, `channel: "chromium"`, versão Chromium completa de quatro componentes, versão Playwright do lock e revisão correspondente; qualquer label `chrome-stable` ou `chrome-for-testing` falha.

Usar test.each para os três modos visuais:

~~~ts
test.each([
  ["blur", "cleanfeed-blurred"],
  ["collapse", "cleanfeed-collapsed"],
  ["hide", "cleanfeed-hidden"],
] as const)("pass applies explicit %s and remains reversible", async (
  mode,
  className,
) => {
  const { context, feed, serviceWorker } = await openVariant("pass");
  await setPresentationMode(serviceWorker, mode);
  await feed.reload();
  const post = feed.getByTestId("long-post");
  await expect(post).toHaveClass(new RegExp(className, "u"));
  await feed.getByRole("button", { name: "Mostrar texto" }).click();
  await expect(post).not.toHaveClass(new RegExp(className, "u"));
  await expect(feed.getByRole("button", { name: /Sinais mais fortes/u }))
    .toBeVisible();
  await context.close();
});
~~~

- [ ] **Step 3: Executar a aceitação atual e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/scripts/functional-browser-receipt.test.ts tests/unit/inference/model-bundle.test.ts tests/unit/content/presentation-controller.test.ts
npm run build
npx playwright test tests/e2e/full-mvp.spec.ts
~~~

Expected: FAIL porque o receipt/plugin test-only ainda não existem e/ou na expectativa antiga de blur da fixture.

- [ ] **Step 4: Criar receitas de release test-only válidas**

~~~ts
export interface ReleaseVariantRecipe {
  rolloutState: "shadow" | "indicator" | "actions";
  gateDecision: "pass" | "indicator-only";
  profileMode: "valid-indicator" | "valid-actions" | "expired";
}

export function createReleaseVariantRecipe(
  name: "shadow" | "indicator-only" | "pass" | "expired",
): ReleaseVariantRecipe {
  if (name === "shadow") {
    return {
      rolloutState: "shadow",
      gateDecision: "pass",
      profileMode: "valid-actions",
    };
  }
  if (name === "indicator-only") {
    return {
      rolloutState: "indicator",
      gateDecision: "indicator-only",
      profileMode: "valid-indicator",
    };
  }
  if (name === "expired") {
    return {
      rolloutState: "actions",
      gateDecision: "pass",
      profileMode: "expired",
    };
  }
  return {
    rolloutState: "actions",
    gateDecision: "pass",
    profileMode: "valid-actions",
  };
}
~~~

O builder usa a identidade real do source-lock e o `tokenizerDigest` locked, emite profiles para `50-79` e `80-199`, calcula cada `profileDigest`, o `calibrationSetDigest` e o evidence digest com `contracts/canonical-json.ts` da Fase 1 (também consumido pela Fase 2) e passa descriptor/arquivo de profiles pelos parsers da Fase 1. Descriptor, profiles, runtime identity e `runtime-parity.json` devem repetir exatamente `8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9`. O perfil `80-199` de pass usa calibrador isotonic com knots `[{rawScore:0,calibratedScore:1},{rawScore:1,calibratedScore:1}]` e thresholds `documentIndicator/localizedIndicator/documentAction: 0`; o perfil `50-79` sempre usa `actionCeiling: "indicator"`, mesmo contendo `documentAction` por exigência do schema. Expired usa `issuedAt: "2023-11-14T22:13:20.000Z"` e `expiresAt: "2024-05-12T22:13:20.000Z"`, com relógio do teste posterior à expiração. O status sintético respeita o shape final: `backend`, `calibrationCoverage`, `calibrationSetDigest`, `profileCount`, `earliestExpiry`, `reasonCodes`, `initializedAt` e `supportsBatching`; nunca adiciona perfil singular ao `ModelStatus`.

- [ ] **Step 5: Permitir alias de metadata apenas durante build de teste**

`src/inference/bundled-model-metadata.ts` da Fase 1 permanece byte a byte intacto e continua importando metadata canônica. Em `vite.config.ts`, criar um plugin test-only que substitui esse módulo somente durante o build de variants:

~~~ts
const canonicalMetadataModule = normalizePath(
  fileURLToPath(
    new URL("./src/inference/bundled-model-metadata.ts", import.meta.url),
  ),
);

export function e2eReleaseMetadataPlugin(mode: string): Plugin {
  const directory = process.env.CLEANFEED_E2E_VARIANT_METADATA_DIR;
  if (mode !== "e2e-release-variant") {
    if (directory !== undefined) throw new Error("E2E_METADATA_OUTSIDE_TEST_MODE");
    return { name: "cleanfeed-canonical-model-metadata" };
  }
  const variantDirectory = assertChildPath(
    resolve("test-results/release-variants"),
    requireAbsoluteDirectory(directory),
  );
  return {
    name: "cleanfeed-e2e-model-metadata",
    enforce: "pre",
    load(id) {
      if (normalizePath(cleanUrl(id)) !== canonicalMetadataModule) return null;
      return renderVariantMetadataModule(variantDirectory);
    },
  };
}
~~~

`renderVariantMetadataModule` emite os mesmos exports fechados do módulo canônico, importando `cleanfeed-model.json` canônico e apenas `release.json`/`calibration-profiles.json` do diretório test-only. `vite.manual-analysis.config.ts` reutiliza o mesmo plugin. O modo exige diretório absoluto dentro de `test-results/release-variants`; path traversal, diretório ausente, chave extra ou execução fora do modo falham. `scripts/run-release-build.mjs` da Task 3 rejeita explicitamente `CLEANFEED_E2E_VARIANT_METADATA_DIR`, portanto herança de ambiente hostil nunca contamina release. Cada variant é produzido por Vite `--mode e2e-release-variant`, nunca pelo owner `build:release`; `audit:model` compara os JSON empacotados com os canônicos e um variant jamais passa como release.

- [ ] **Step 6: Construir variants isolados e adaptar o launcher**

`build-e2e-release-variants.mjs` cria metadata e bundles em `test-results/release-variants/{shadow,indicator-only,pass,expired}`, executa os dois builds Vite com `--mode e2e-release-variant` e `CLEANFEED_E2E_VARIANT_METADATA_DIR` apontando ao variant, chama o gerador compartilhado da Fase 2 para gravar `runtime-parity.json` em cada output e sanitiza o resultado. Nunca altera `models`, `public/models`, `dist` ou qualquer entrada do inferenceCoreDigest; todos os variants devem ter o mesmo `runtimeParityDigest` do core real, embora descriptor/profile digests sejam test-only.

Em load-extension.ts:

~~~ts
export async function launchExtension(
  distPath: string,
  userDataDirectory: string = "",
): Promise<BrowserContext> {
  const extensionPath = prepareExtension(distPath);
  return chromium.launchPersistentContext(userDataDirectory, {
    headless: true,
    channel: "chromium",
    args: [
      "--disable-extensions-except=" + extensionPath,
      "--load-extension=" + extensionPath,
      "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1, EXCLUDE localhost",
    ],
  });
}
~~~

Adicionar à fixture um post PT-BR lexical de 70 palavras com data-testid short-qualified-post e um post longo 150–299 sem links dominantes.

`functional-browser-receipt.ts` lê `context.browser().version()`, a versão de `playwright/package.json` e a revisão Chromium do `browsers.json` resolvido pelo mesmo pacote. Exige browser version `^\d+\.\d+\.\d+\.\d+$`, Playwright `1.61.x`, `channel: "chromium"` e `browserKind: "playwright-bundled-chromium"`; grava JSON canônico atômico sem executable path, perfil ou hostname. `tmr-release.spec.ts` confere que todos os contexts usam a mesma versão e grava uma vez em `test-results/tmr-functional-browser.json`. `assert-functional-browser-receipt.mjs` refaz o parser fechado e cruza Playwright/revisão com o lock local; o unit test rejeita versão parcial, campo extra e rótulo de CfT.

- [ ] **Step 7: Cobrir foco, axe e reinício**

No variant pass, verificar teclado Enter/Space, foco indo ao heading da explicação e voltando ao badge, inert/aria-hidden durante collapse/hide e zero violações serious/critical em feed, popup, options e painel manual.

Para reinício, lançar com userDataDirectory temporário, classificar, fechar o BrowserContext, relançar com o mesmo diretório e dist, e provar que settings persistem, service worker/offscreen reinicializam uma vez e não duplicam badge/placeholder. Durante uma reload com inferência pendente, provar que cancelamento não gera classificação_failed visível.

- [ ] **Step 8: Executar E2E completo**

Adicionar sem substituir os scripts da Fase 1:

~~~json
{
  "scripts": {
    "test:e2e:release": "node scripts/build-e2e-release-variants.mjs && playwright test tests/e2e/tmr-release.spec.ts",
    "verify:release": "npm run verify:release:base && npm run test:e2e:release"
  }
}
~~~

No job `verify-release`, trocar a execução de `verify:release:base` por `verify:release`. Continuar sem upload.

Depois do comando, publicar somente o receipt técnico:

~~~yaml
      - uses: actions/upload-artifact@v4
        with:
          name: tmr-functional-browser
          path: test-results/tmr-functional-browser.json
          if-no-files-found: error
~~~

Run:

~~~powershell
npx vitest run tests/unit/scripts/functional-browser-receipt.test.ts tests/unit/inference/model-bundle.test.ts tests/unit/content/presentation-controller.test.ts
npm run build:release
npm run test:e2e:release
~~~

Expected: PASS para shadow, indicator-only, pass e expired; zero requests externas, zero violações serious/critical, nenhuma ação acima do teto e receipt com Chromium/Playwright completos. Nenhum build altera `src/inference`, `src/offscreen/worker-host.ts` ou o parity digest.

- [ ] **Step 9: Commit**

~~~powershell
git add scripts/build-e2e-release-variants.mjs scripts/build-e2e-release-variants.d.mts scripts/assert-functional-browser-receipt.mjs scripts/assert-functional-browser-receipt.d.mts tests/e2e/fixtures/release-variants.ts tests/e2e/helpers/functional-browser-receipt.ts tests/e2e/tmr-release.spec.ts tests/unit/scripts/functional-browser-receipt.test.ts vite.config.ts vite.manual-analysis.config.ts tests/e2e/helpers/load-extension.ts tests/e2e/fixtures/linkedin-feed.html tests/e2e/extension.spec.ts tests/e2e/full-mvp.spec.ts playwright.config.ts .github/workflows/tmr-release.yml package.json tests/unit/inference/model-bundle.test.ts tests/unit/content/presentation-controller.test.ts
git commit --no-verify -m "test: verify authorized rollout in Chrome"
~~~

---

### Task 6: Medir e bloquear regressões de desempenho no ambiente de referência

**Files:**
- Consume: tests/browser-lock.json
- Consume: scripts/test-browser-lock.mjs
- Consume: scripts/test-browser-lock.d.mts
- Consume: src/shared/types.ts
- Consume: src/shared/messages.ts
- Consume: src/shared/message-validation.ts
- Create: scripts/assert-reference-environment.mjs
- Create: scripts/assert-reference-environment.d.mts
- Create: scripts/assert-performance-report.mjs
- Create: scripts/assert-performance-report.d.mts
- Create: scripts/run-release-performance.mjs
- Create: scripts/run-release-performance.d.mts
- Create: tests/e2e/helpers/cdp-extension-metrics.ts
- Create: tests/e2e/helpers/release-performance.ts
- Create: tests/e2e/tmr-performance.spec.ts
- Create: tests/unit/e2e/cdp-extension-metrics.test.ts
- Create: tests/unit/e2e/release-performance.test.ts
- Create: tests/unit/scripts/performance-report.test.ts
- Modify: tests/e2e/helpers/load-extension.ts
- Modify: .github/workflows/tmr-release.yml
- Modify: package.json
- Test: tests/integration/main-thread-budget.test.ts
- Test: tests/integration/storage-privacy-audit.test.ts

**Interfaces:**
- Consumes: `browser:install:test`, `readTestBrowserLock`, `installLockedTestBrowser` e `resolveLockedTestBrowser` produzidos pela Fase 3; não descobre browser do sistema.
- Produces: `ReleasePerformanceRecorder` test-only, alimentado por `ClassificationResult.processingTimeMs` do protocolo existente e ligado a uma identidade `bundle`, sem texto, URL, hash de conteúdo ou score.
- Produces: `sampleExtensionHeap(client, extensionId): Promise<ExtensionHeapSample>` no harness de referência, usando CDP e sem alterar o runtime de produção.
- Produces: `assertReferenceEnvironment`, `assertPerformanceReport` e `assertReleasePerformanceEvidence`.
- Produces: `test-results/tmr-release-performance.json` como evidência não versionada, medida para TMR ou explicitamente `not-applicable` somente para reject.
- Consumes: o `dist` canônico criado pelo único `npm run build:release`; a lane de performance nunca usa os profiles/descritores sintéticos da Task 5.

- [ ] **Step 1: Escrever testes RED das métricas e percentil**

~~~ts
const recorder = new ReleasePerformanceRecorder();
recorder.recordCold({
  durationMs: 9_500,
  failed: false,
  runtimeIdentity: identity,
  backend: "wasm",
});
for (const duration of [...Array(95).fill(1_000), ...Array(5).fill(1_900)]) {
  recorder.recordWarm({
    durationMs: duration,
    failed: false,
    runtimeIdentity: identity,
    backend: "wasm",
  });
}

expect(recorder.snapshot()).toMatchObject({
  coldStartMs: 9_500,
  warmInferenceCount: 100,
  warmInferenceP95Ms: 1_000,
  inferenceErrorRate: 0,
});
~~~

Adicionar casos que fixam nearest-rank p95 em ceil(0.95*n)-1, erro 1/100 = 0.01, duração não finita rejeitada, cold ausente/duplicado, identidade/backend divergentes e máximo de 1.000 amostras. O recorder aceita somente os cinco campos escalares do outcome; não recebe nem retém `ClassificationResult`, texto ou metadados do post.

- [ ] **Step 2: Escrever testes RED do gate exato**

~~~ts
expect(() => assertPerformanceReport(validReport)).not.toThrow();
expect(() =>
  assertPerformanceReport({ ...validReport, coldStartMs: 10_001 }),
).toThrow("COLD_START_BUDGET_EXCEEDED");
expect(() =>
  assertPerformanceReport({ ...validReport, warmInferenceP95Ms: 2_001 }),
).toThrow("WARM_P95_BUDGET_EXCEEDED");
expect(() =>
  assertPerformanceReport({
    ...validReport,
    incrementalMemoryBytes: 512 * 1024 * 1024 + 1,
  }),
).toThrow("MEMORY_BUDGET_EXCEEDED");
expect(() =>
  assertPerformanceReport({ ...validReport, inferenceErrorRate: 0.01 }),
).toThrow("ERROR_RATE_BUDGET_EXCEEDED");
~~~

Também reprovar `incrementalMemoryBytes: null`, `maximumMainThreadTaskMs: 50.001`, backend diferente de wasm, menos de 100 inferências, ambiente que não seja Windows 11 com ao menos quatro processadores lógicos e 8 GiB, `browserKind` diferente de `chrome-for-testing`, versão diferente de `150.0.7871.129`, SHA-256 diferente dos bytes do executável resolvido localmente ou `browserLockDigest` diferente do JSON canônico do lock fechado.

Em `cdp-extension-metrics.test.ts`, usar o ID de fixture válido `abcdefghijklmnopabcdefghijklmnop` e transporte CDP falso para provar que a amostra inclui somente targets `page|service_worker|worker` da origem `chrome-extension://abcdefghijklmnopabcdefghijklmnop` (incluindo worker `blob:` dessa origem), executa `HeapProfiler.collectGarbage` antes de `Runtime.getHeapUsage`, soma `totalSize + embedderHeapUsedSize + backingStorageSize`, rejeita resposta não finita/negativa, target desaparecido e amostra sem target de runtime. Na spec real, resolver o ID instalado a partir do service worker da extensão e passá-lo ao helper; o literal existe somente no teste unitário. A diferença pós-warm-up menos baseline deve reprovar quando negativa; nunca usar clamp para esconder a medição.

Reprovar também `releaseDescriptorDigest` divergente do `release.json` fornecido e `runtimeParityDigest` divergente do manifesto final/`benchmarkReport.runtimeParityDigest`; não comparar `benchmarkBuildDigest` ou `extensionBuildDigest` como substituto de paridade.

Adicionar a união de release: `not-applicable` passa apenas com o descritor `gateDecision: "reject"`, `rolloutState: "bundle-verified"`, digest exato e diretório TMR ausente. A mesma evidência com indicator-only/pass, digest divergente ou modelo presente falha `PERFORMANCE_EVIDENCE_INVALID`.

- [ ] **Step 3: Executar testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/e2e/cdp-extension-metrics.test.ts tests/unit/e2e/release-performance.test.ts tests/unit/scripts/performance-report.test.ts
~~~

Expected: FAIL porque não existem recorder test-only, amostrador CDP ou parsers do relatório.

- [ ] **Step 4: Definir snapshot agregado e privacy-safe**

~~~ts
export interface HarnessPerformanceSnapshot {
  runtimeIdentity: Extract<RuntimeModelIdentity, { kind: "bundle" }>;
  backend: Backend;
  coldStartMs: number;
  warmInferenceCount: number;
  warmInferenceP95Ms: number;
  inferenceErrorRate: number;
}

export interface ReleasePerformanceReport
  extends HarnessPerformanceSnapshot {
  schemaVersion: 1;
  measuredAt: string;
  releaseDescriptorDigest: string;
  runtimeParityDigest: string;
  memoryMeasurement: "cdp-runtime-heap-v1";
  incrementalMemoryBytes: number;
  environment: {
    operatingSystem: string;
    logicalProcessors: number;
    totalMemoryBytes: number;
    browserKind: "chrome-for-testing";
    browserVersion: "150.0.7871.129";
    browserExecutableSha256: string;
    browserLockDigest: string;
  };
  maximumMainThreadTaskMs: number;
  inferenceAttempts: number;
}

export type ReferenceEnvironmentFacts = ReleasePerformanceReport["environment"];

export type ReleasePerformanceEvidence =
  | { status: "measured"; report: ReleasePerformanceReport }
  | {
      status: "not-applicable";
      gateDecision: "reject";
      rolloutState: "bundle-verified";
      descriptorDigest: string;
    };
~~~

Esses tipos vivem em `tests/e2e/helpers/release-performance.ts`; os scripts Node expõem assinaturas equivalentes em seus `.d.mts`, sem criar módulo em `src`. Validadores usam lista exata de chaves e limites numéricos. `runtimeIdentity.kind` deve ser `bundle`; `tokenizerDigest` e `calibrationSetDigest` devem corresponder ao descritor medido; `releaseDescriptorDigest` deve identificar o descritor canônico usado no job; e `runtimeParityDigest` deve corresponder a `dist/runtime-parity.json`/relatório científico. `memoryMeasurement` deve ser literalmente `cdp-runtime-heap-v1`; não aceitar substituição silenciosa por `performance.memory` nem pela API experimental `measureUserAgentSpecificMemory`. Product/channel/version e `browserLockDigest` são derivados do lock fechado; `browserExecutableSha256` é calculado sobre os bytes do `executablePath` resolvido e precisa ser recalculado pelo validator. Chromium bundled nunca satisfaz essa lane. A variante `not-applicable` só é aceita quando o descritor canônico é exatamente `reject/bundle-verified` e o pacote auditado não contém o TMR. Nenhum campo opcional aceita payload livre.

- [ ] **Step 5: Medir pelo protocolo existente sem alterar o core selado**

`tests/e2e/helpers/release-performance.ts` cria uma página em `manual-analysis.html` e usa exatamente o envelope `CLASSIFY_TEXT` já validado pela Fase 1:

~~~ts
const response = await manualPage.evaluate(
  ({ text, requestId }) =>
    chrome.runtime.sendMessage({
      source: "manual",
      target: "background",
      type: "CLASSIFY_TEXT",
      requestId,
      payload: { text, platform: "linkedin", manual: true },
    }),
  { text, requestId },
);
const message = parseExtensionMessage(response);
if (message.type !== "CLASSIFICATION_RESULT") {
  throw new Error("PERFORMANCE_CLASSIFICATION_RESULT_REQUIRED");
}
return message.payload;
~~~

Antes disso, a página de options envia `UPDATE_SETTINGS` para fixar `backendPreference: "wasm"`, `webGpuEnabled: false`, `wasmEnabled: true`, histórico desabilitado e o restante dos settings canônicos. A primeira requisição elegível é o cold sample; como `processingTimeMs` da Fase 1 começa antes de `initialize()`, ela inclui a carga. Depois de um warm-up descartado, executar 100 textos PT-BR/LinkedIn elegíveis e únicos em sequência para impedir cache hit. Cada resultado passa por `assertClassificationResult`; o recorder copia somente `processingTimeMs`, `backend`, `runtimeIdentity` e `status === "classification_failed"`. Promise rejeitada, resposta ausente/inválida, timeout ou identidade divergente contam como falha; texto nunca entra no recorder/report. Não adicionar mensagens, rotas, storage ou instrumentação a `src/inference`, `src/offscreen` ou `src/background`.

- [ ] **Step 6: Implementar inspeção do ambiente e relatório**

`assert-reference-environment.mjs` usa os módulos `os` e `process` para verificar platform win32, release do Windows com build >= 22000, `cpus().length >= 4` e `totalmem() >= 8*1024^3`. Ele consome `readTestBrowserLock`/`resolveLockedTestBrowser` de `scripts/test-browser-lock.mjs`, exige product/channel/version exatos (`chrome`, `stable`, `150.0.7871.129`), calcula `browserLockDigest` do JSON canônico com as quatro chaves e calcula `browserExecutableSha256` lendo o `executablePath` resolvido. Depois confirma por CDP `Browser.getVersion` que esse processo é o mesmo Chrome for Testing. O lock não contém nem finge fornecer SHA oficial. Flags que desabilitem WASM falham. `assertReferenceEnvironment` retorna um `ReferenceEnvironmentFacts` com lista exata de chaves; o CLI aceita `--browser-lock` e `--output`, grava JSON canônico atômico e não inclui path, hostname, usuário ou outras informações da máquina.

`tests/e2e/helpers/cdp-extension-metrics.ts` implementa um cliente CDP mínimo sobre o endpoint registrado em `DevToolsActivePort`. Ele chama `Target.getTargets`, anexa com `Target.attachToTarget({flatten:true})` apenas aos targets da extensão e, em cada sessão, executa `HeapProfiler.collectGarbage` seguido de `Runtime.getHeapUsage`. `footprintBytes` é a soma fechada de `totalSize + embedderHeapUsedSize + backingStorageSize`; a amostra guarda somente contagens e totais numéricos, nunca URLs. O helper de launch da lane de referência usa o `executablePath` pinado, user-data-dir temporário e `--remote-debugging-port=0`, espera o arquivo de porta, conecta o Playwright ao mesmo Chrome e fecha processo/endpoint no teardown. O canal loopback do DevTools é somente controle do harness e não conta como request de conteúdo; qualquer request HTTP(S) originado pela extensão continua bloqueado.

`tmr-performance.spec.ts` abre exclusivamente o `dist` canônico recém-criado por `build:release`, exige igualdade byte a byte de seus `release.json`/`calibration-profiles.json` com `models/tmr-ai-text-detector`, tira baseline CDP depois do bootstrap e antes da primeira classificação, executa cold/warm-up/100 warm pelo helper do Step 5 e tira a segunda amostra após a última resposta. Targets offscreen/worker podem surgir com a inicialização e entram na amostra posterior; o teste rejeita somente target que desapareça durante uma amostra ou delta agregado negativo. Ele define `incrementalMemoryBytes = after.footprintBytes - before.footprintBytes`, coleta `PerformanceObserver` longtask da página manual e combina isso ao `HarnessPerformanceSnapshot`. Cada resultado deve repetir backend WASM e a identidade bundle/calibration set do descriptor canônico. Para esta spec, o launcher usa o path passado em `CLEANFEED_REFERENCE_EXECUTABLE`, lê/valida os facts fechados de `CLEANFEED_REFERENCE_ENV_FILE` e não define `channel`; os demais E2E continuam em bundled Chromium. Antes de gravar `{status:"measured",report}` no path `CLEANFEED_PERFORMANCE_OUTPUT`, o teste chama `assertPerformanceReport(report)` e `assertReleasePerformanceEvidence(evidence)`. `run-release-performance.mjs` inspeciona o descritor canônico: indicator-only/pass instala/resolve o browser pinado, reconstrói/audita o pacote canônico, executa ambiente, Playwright e gate; reject audita a ausência do TMR e grava somente a evidência `not-applicable` fechada.

- [ ] **Step 7: Adicionar runner de referência**

~~~json
{
  "scripts": {
    "test:performance:release": "node scripts/run-release-performance.mjs --release models/tmr-ai-text-detector/release.json --output test-results/tmr-release-performance.json",
    "release:assert-publishable": "node scripts/assert-release-gates.mjs --publication --model public/models/tmr-ai-text-detector --metadata models/tmr-ai-text-detector --evidence benchmark/evidence/tmr-ptbr-v1 --dist dist"
  }
}
~~~

Para indicator-only/pass, o runner executa, nesta ordem, `installLockedTestBrowser`, `npm run build:release`, `npm run audit:model`, `assert-reference-environment.mjs --browser-lock tests/browser-lock.json --output test-results/reference-environment.json`, Playwright `tests/e2e/tmr-performance.spec.ts` contra `dist` com as três variáveis `CLEANFEED_REFERENCE_EXECUTABLE`, `CLEANFEED_REFERENCE_ENV_FILE` e `CLEANFEED_PERFORMANCE_OUTPUT`, e por fim `assert-performance-report.mjs` com report/release/parity/lock/executable explícitos. O relatório copia a identidade/runtime parity/calibration set do pacote real e o `releaseDescriptorDigest` dos bytes canônicos medidos. Para reject, o runner ainda executa `build:release`/`audit:model`, confirma ausência do TMR e só aceita o receipt `not-applicable` descrito no Step 4; nenhum variant sintético da Task 5 participa desta lane. `reference-environment.json` permanece ignorado e só o arquivo final de performance é enviado como artifact.

Acrescentar ao workflow:

~~~yaml
  reference-performance:
    needs: verify-release
    runs-on: [self-hosted, Windows, X64, cleanfeed-reference]
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.18.0"
          cache: npm
      - run: npm ci
      - run: npm run browser:install:test
      - run: npm run model:fetch
      - run: npm run model:verify
      - run: npm run test:performance:release
      - uses: actions/upload-artifact@v4
        with:
          name: tmr-release-performance
          path: test-results/tmr-release-performance.json
          if-no-files-found: error

  publish-package:
    needs: [verify-release, reference-performance]
    runs-on: windows-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.18.0"
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run browser:install:test
      - run: npm run model:fetch
      - run: npm run model:verify
      - run: npm run test:model:release
      - run: npm run build:release
      - run: npm run audit
      - run: npm run audit:model
      - run: npm run verify:build
      - uses: actions/download-artifact@v4
        with:
          name: tmr-release-performance
          path: test-results
      - run: node scripts/assert-performance-report.mjs test-results/tmr-release-performance.json --release models/tmr-ai-text-detector/release.json --parity dist/runtime-parity.json --browser-lock tests/browser-lock.json
      - run: npm run release:assert-publishable
      - uses: actions/upload-artifact@v4
        with:
          name: cleanfeed-extension
          path: dist
          if-no-files-found: error
~~~

O label `cleanfeed-reference` é condição de publicação. Um job ausente, cancelado ou sem runner não autoriza upload para store. `publish-package` é o único job que envia `dist`; ele faz checkout novo, reconstrói e reauda o descritor canônico já commitado. O relatório baixado deve ter o mesmo `releaseDescriptorDigest` e `runtimeParityDigest` do pacote recém-reconstruído. Para evidência measured, `assert-performance-report.mjs` resolve novamente o browser do lock já instalado, recalcula o SHA-256 local e exige igualdade com o relatório; o hash é uma observação reprodutível do artefato instalado, não um campo do lock. Em modo publication, aceitar somente `reject/bundle-verified`, `indicator-only/indicator` ou `pass/actions`; `pass/indicator`, pending e shadow falham antes do upload.

- [ ] **Step 8: Executar testes unitários e integração privacy-safe**

Run:

~~~powershell
npx vitest run tests/unit/e2e/cdp-extension-metrics.test.ts tests/unit/e2e/release-performance.test.ts tests/unit/scripts/performance-report.test.ts tests/integration/main-thread-budget.test.ts tests/integration/storage-privacy-audit.test.ts
npm run typecheck
~~~

Expected: PASS; o harness usa somente o protocolo/resultados já selados, snapshots têm apenas agregados e o limite de 1% é estrito, portanto 0,01 reprova. `git diff --exit-code -- src/inference src/offscreen/worker-host.ts src/shared/constants.ts src/shared/types.ts package-lock.json` continua vazio nesta task.

- [ ] **Step 9: Executar na máquina de referência**

Run:

~~~powershell
npm run test:performance:release
~~~

Expected: para indicator-only/pass, PASS e `test-results/tmr-release-performance.json` registra `status: "measured"`, Chrome for Testing `150.0.7871.129`, `browserLockDigest` canônico e SHA-256 recalculável do executável local, WASM, identidade bundle/calibration set exata, `releaseDescriptorDigest`/`runtimeParityDigest` exatos, pelo menos 100 tentativas, `coldStartMs <= 10000`, `warmInferenceP95Ms <= 2000`, `incrementalMemoryBytes <= 536870912`, `inferenceErrorRate < 0.01` e `maximumMainThreadTaskMs <= 50`. Para reject, PASS com `status: "not-applicable"`, descritor digest exato e confirmação de TMR ausente; nenhum número sintético é fabricado.

- [ ] **Step 10: Commit**

~~~powershell
git add scripts/assert-reference-environment.mjs scripts/assert-reference-environment.d.mts scripts/assert-performance-report.mjs scripts/assert-performance-report.d.mts scripts/run-release-performance.mjs scripts/run-release-performance.d.mts tests/e2e/helpers/cdp-extension-metrics.ts tests/e2e/helpers/release-performance.ts tests/e2e/tmr-performance.spec.ts tests/unit/e2e/cdp-extension-metrics.test.ts tests/unit/e2e/release-performance.test.ts tests/unit/scripts/performance-report.test.ts tests/e2e/helpers/load-extension.ts .github/workflows/tmr-release.yml package.json tests/integration/main-thread-budget.test.ts tests/integration/storage-privacy-audit.test.ts
git commit --no-verify -m "test: enforce real TMR performance budgets"
~~~

---

### Task 7: Atualizar documentação, registrar evidência e executar o gate final

**Files:**
- Create: scripts/render-release-evidence.mjs
- Create: scripts/render-release-evidence.d.mts
- Create: docs/releases/tmr-ptbr-v1.md (gerado do relatório, descritor e performance)
- Modify: README.md
- Modify: docs/architecture.md
- Modify: docs/inference-pipeline.md
- Modify: docs/model-integration.md
- Modify: docs/model-validation.md
- Modify: docs/privacy.md
- Modify: docs/limitations.md
- Modify: docs/release-checklist.md
- Modify: docs/decisions.md
- Modify: docs/risks.md
- Modify: docs/phase-reports/phase-4.md
- Modify: package.json
- Test: tests/unit/docs/required-content.test.ts
- Test: tests/unit/docs/release-evidence.test.ts

**Interfaces:**
- Consome: `benchmark/evidence/tmr-ptbr-v1/benchmark-report.json`, `decision.json`, `evidence-digest.json`, `models/tmr-ai-text-detector/release.json`, `calibration-profiles.json`, `src/shared/classification-copy.json` e `test-results/tmr-release-performance.json`.
- Produz: renderReleaseEvidence(inputs): string determinístico, sem corpus ou score individual.
- Produz: documento de release que reflete exatamente `gateDecision`, `rolloutState`, cobertura publicada e estado do gate de desempenho.

- [ ] **Step 1: Escrever testes RED do conteúdo obrigatório**

~~~ts
expect(rendered).toContain("Decisão: indicator-only");
expect(rendered).toContain("UCB95(FPR) de aviso");
expect(rendered).toContain("Validade dos perfis");
expect(rendered).toContain("Publication digest");
expect(rendered).toContain("Runtime parity digest");
expect(rendered).toContain("Tokenizer digest");
expect(rendered).toContain("WASM");
expect(rendered).toContain(
  "Isso não comprova sua origem.",
);
expect(rendered).not.toMatch(
  /postText|authorName|profileUrl|calibratedScore|aiScore/u,
);
~~~

Adicionar testes por decisão:

- reject contém “TMR não empacotado; fallback estilométrico ativo”;
- indicator-only contém “Ações visuais desabilitadas”;
- pass contém “Ações limitadas ao perfil e à preferência” e “50–79: somente indicador”.

- [ ] **Step 2: Executar testes e confirmar RED**

Run:

~~~powershell
npx vitest run tests/unit/docs/required-content.test.ts tests/unit/docs/release-evidence.test.ts
~~~

Expected: FAIL porque os documentos ainda descrevem o MVP mock/limiares antigos e não existe renderer.

- [ ] **Step 3: Implementar o renderer determinístico**

~~~js
export function renderReleaseEvidence({
  release,
  report,
  evidenceManifest,
  profilesFile,
  performanceEvidence,
  probabilisticDisclosure,
}) {
  const lines = [
    "# CleanFeed AI — TMR PT-BR v1 release evidence",
    "",
    "Decisão: " + release.gateDecision,
    "Rollout: " + release.rolloutState,
    "Modelo: " + release.modelId + " " + release.modelVersion,
    "Bundle digest: " + release.bundleDigest,
    "Tokenizer digest: " + release.tokenizerDigest,
    "Scientific evidence digest: " + release.evidenceDigest,
    "Publication digest: " + evidenceManifest.publicationDigest,
    "Runtime parity digest: " + report.runtimeParityDigest,
    "",
    "## Gates estatísticos",
    renderGateTable(report),
    "",
    "## Perfis publicados",
    renderProfiles(profilesFile.profiles),
    "",
    "## Desempenho WASM",
    renderPerformance(performanceEvidence),
    "",
    "## Limitação de interpretação",
    probabilisticDisclosure,
  ];
  return lines.join("\n") + "\n";
}
~~~

O CLI lê `src/shared/classification-copy.json` com parser de chaves exatas e passa `probabilisticDisclosure` explicitamente ao renderer; não importa TypeScript no Node nem duplica a frase. Antes de renderizar, exige `release.evidenceDigest == evidenceManifest.scientificEvidenceDigest == report.reportDigest` e chama o verificador publicado da Fase 3 para validar `publicationDigest`. Ordenar perfis por `lengthBucket` e `profileId`; formatar métricas com casas fixas; não incluir exemplos, predictions, prompts, autores, hashes de conteúdo ou scores individuais. `performanceEvidence.status: "not-applicable"` é renderizado somente como “Não aplicável: candidato rejeitado e ausente do pacote”, sem números artificiais. O CLI grava `docs/releases/tmr-ptbr-v1.md` e falha se o arquivo existente divergir de `--check`.

- [ ] **Step 4: Atualizar arquitetura, modelo, privacidade e limitações**

Documentar:

1. TMR é candidato local PT-BR/LinkedIn, não detector universal;
2. stylometric-v1 é fallback explicativo e nunca voto somado;
3. descriptor/profile exatos governam rollout e expiram em 180 dias;
4. score técnico não é probabilidade de autoria;
5. nenhuma telemetria, texto ou score individual sai do dispositivo;
6. novos geradores, paráfrase, mistos, drift e mudança do DOM continuam riscos;
7. E2E MV3 funcional usa bundled Chromium por causa das restrições atuais de sideload do Chrome branded, enquanto scoring/performance usa o Chrome for Testing Stable pinado;
8. Reddit, X/Twitter, Facebook, Instagram, Medium, fóruns, artigos e comentários genéricos permanecem apenas como adaptadores futuros.

README e store copy usam somente “sinais compatíveis” e remetem ao relatório versionado para números.

- [ ] **Step 5: Substituir checklist MVP por gates executáveis de TMR**

docs/release-checklist.md deve incluir comandos e campos de assinatura para:

- decisão e digests da Fase 3;
- igualdade de `runtimeParityDigest` entre `dist-model-benchmark/runtime-parity.json`, relatório sanitizado e `dist/runtime-parity.json`, sem confundir build digests;
- licença e NOTICE;
- expiração e `50-79` indicator;
- smoke real `tests/e2e/real-model-smoke.spec.ts` sem skip para todas as decisões, inclusive reject;
- pacote exato ou ausência do TMR em reject;
- permission/CSP diff;
- operação offline nas duas lanes de browser;
- lane funcional no bundled Chromium e lane científica/performance no Chrome for Testing `150.0.7871.129`, ambas identificadas sem mistura;
- axe sem serious/critical;
- cold/warm/memória/erro/long task;
- rollback local/circuit breaker;
- build reproduzível e transição monotônica `pass/indicator -> pass/actions`;
- aprovação do responsável pelo release.

Não pré-marcar verificações manuais. Os itens automatizados referenciam o comando que os prova.

- [ ] **Step 6: Gerar e verificar a evidência**

Adicionar:

~~~json
{
  "scripts": {
    "release:evidence": "node scripts/render-release-evidence.mjs",
    "release:evidence:check": "node scripts/render-release-evidence.mjs --check"
  }
}
~~~

Run:

~~~powershell
npm run release:evidence
npm run release:evidence:check
npm run docs:check
npx vitest run tests/unit/docs/required-content.test.ts tests/unit/docs/release-evidence.test.ts
~~~

Expected: todos retornam 0; uma segunda geração não altera bytes e o documento corresponde aos digests canônicos.

- [ ] **Step 7: Executar os gates pré-ativação e aplicar a única transição permitida**

Run:

~~~powershell
npm run model:evidence:verify
npm run model:fetch
npm run verify:release
npm run test:performance:release
npm run release:evidence
npm run release:evidence:check
$releaseBefore = Get-Content -Raw models/tmr-ai-text-detector/release.json | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($releaseBefore.evidenceDigest)) {
  throw "release sem evidenceDigest verificado"
}
npm run release:activate -- --expected-evidence-digest $releaseBefore.evidenceDigest
if ($LASTEXITCODE -ne 0) { throw "ativação falhou" }
~~~

Expected: todos retornam exit code 0. O bundle TMR exato é baixado, verificado e executado no Chrome mesmo para reject. `pass/indicator` torna-se `pass/actions`; pass já actions é idempotente; indicator-only e reject não alteram byte algum. Nenhum threshold, decisão, profile digest, calibration set digest ou evidence digest muda.

- [ ] **Step 8: Reconstruir e executar o gate final sobre o descritor canônico**

Run:

~~~powershell
npm run model:fetch
npm run release:evidence
npm run format:check
npm run lint
npm run typecheck
npx vitest run
npm run model:evidence:verify
npm run model:verify
npm run test:model:release
npm run build:release
npm run audit
npm run audit:model
npm run verify:build
npm run test:e2e:release
npm run test:performance:release
npm run release:evidence
npm run release:evidence:check
npm run release:assert-publishable
npm run docs:check
npx vitest run tests/unit/docs/required-content.test.ts tests/unit/docs/release-evidence.test.ts
~~~

Expected: todos retornam exit code 0 sobre o descritor pós-ativação. O smoke real não contém skip; nenhuma lane de browser faz request externo; pass está em actions, indicator-only em indicator e reject em bundle-verified sem TMR no `dist`; a evidência de performance satisfaz os limites ou registra N/A somente para reject.

- [ ] **Step 9: Verificar a matriz final no artefato**

Run:

~~~powershell
$release = Get-Content -Raw models/tmr-ai-text-detector/release.json | ConvertFrom-Json
$profilesFile = Get-Content -Raw models/tmr-ai-text-detector/calibration-profiles.json | ConvertFrom-Json
$profiles = @($profilesFile.profiles)
$tmrPath = "dist/models/tmr-ai-text-detector"
$lockedTokenizerDigest = "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9"
$parity = Get-Content -Raw dist/runtime-parity.json | ConvertFrom-Json
if ($release.tokenizerDigest -ne $lockedTokenizerDigest) { throw "release com tokenizer divergente" }
if ($parity.tokenizerDigest -ne $lockedTokenizerDigest) { throw "parity com tokenizer divergente" }
if ($profiles.Where({ $_.tokenizerDigest -ne $lockedTokenizerDigest }).Count -ne 0) {
  throw "perfil com tokenizer divergente"
}
switch ($release.gateDecision) {
  "reject" {
    if ($release.rolloutState -ne "bundle-verified") { throw "reject com rollout inválido" }
    if ($profiles.Count -ne 0) { throw "reject publicou perfil" }
    if (Test-Path $tmrPath) { throw "reject empacotou TMR" }
  }
  "indicator-only" {
    if ($release.rolloutState -ne "indicator") { throw "indicator-only com rollout inválido" }
    if (-not (Test-Path $tmrPath)) { throw "indicator-only sem TMR" }
    if ($profiles.Where({ $_.actionCeiling -ne "indicator" }).Count -ne 0) {
      throw "indicator-only publicou ação"
    }
  }
  "pass" {
    if ($release.rolloutState -ne "actions") { throw "pass não foi ativado" }
    if (-not (Test-Path $tmrPath)) { throw "pass sem TMR" }
    if ($profiles.Where({
      $_.lengthBucket -eq "50-79" -and $_.actionCeiling -ne "indicator"
    }).Count -ne 0) {
      throw "pass liberou ação para 50-79"
    }
  }
  default { throw "gateDecision não publicável" }
}
~~~

Expected: nenhuma exceção e `npm run audit:model` confirma o inventário exato. `pass/indicator` não passa neste gate final.

- [ ] **Step 10: Commit de ativação, documentação e evidência**

~~~powershell
git add models/tmr-ai-text-detector/release.json scripts/render-release-evidence.mjs scripts/render-release-evidence.d.mts docs/releases/tmr-ptbr-v1.md README.md docs/architecture.md docs/inference-pipeline.md docs/model-integration.md docs/model-validation.md docs/privacy.md docs/limitations.md docs/release-checklist.md docs/decisions.md docs/risks.md docs/phase-reports/phase-4.md package.json tests/unit/docs/required-content.test.ts tests/unit/docs/release-evidence.test.ts
git commit --no-verify -m "release: record the authorized TMR PT-BR rollout"
~~~

- [ ] **Step 11: Confirmar árvore de trabalho e artefatos ignorados**

Run:

~~~powershell
git status --short
git log -8 --oneline
~~~

Expected: nenhuma mudança produzida por esta fase permanece sem commit. Arquivos grandes e dados continuam apenas nos diretórios ignorados `public/models`, `benchmark/data`, `benchmark/work`, `benchmark/out` e `test-results`; mudanças preexistentes do usuário permanecem intactas.

---

## Final release decision table

| gateDecision | rolloutState | TMR em dist | Runtime ativo | Apresentação máxima | Publicável |
| --- | --- | --- | --- | --- | --- |
| reject | bundle-verified | não | builtin stylometric | indicator | sim, como pacote fallback; o bundle candidato ainda foi smoked |
| indicator-only | indicator | sim | bundle TMR | indicator | sim; todo profile tem actionCeiling indicator |
| pass | indicator | sim | bundle TMR | indicator | não; estágio pré-ativação dos gates de engenharia |
| pass | actions | sim | bundle TMR | preferência até hide | sim; `50-79` e trigger somente localizado continuam indicator |

`pending`, `shadow`, `indicator-only/bundle-verified` e `pass/bundle-verified` não são publicáveis. `bundle-verified/reject` é a única exceção publicável porque o TMR é removido do pacote e o runtime usa identidade builtin. Perfil TMR ausente, expirado ou incompatível faz o TMR se abster; o fallback estilométrico pode emitir um novo resultado separado, sempre limitado a indicator. Erro, OOD, artifact mismatch ou circuit breaker também nunca autoriza ação visual.
