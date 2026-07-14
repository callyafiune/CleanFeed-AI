# CleanFeed AI — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma extensão Chrome Manifest V3, local e reversível, que analise publicações longas do LinkedIn com um classificador probabilístico substituível, permita análise manual em qualquer site e nunca apresente o resultado como prova de autoria.

**Architecture:** O content script conhece o DOM e delega extração/apresentação ao adaptador do LinkedIn. O service worker coordena configurações, cache, métricas, menu de contexto e mensageria; um documento offscreen mantém a fila e hospeda um Dedicated Web Worker, onde todo o pipeline de classificação é executado. Popup, opções e painel de análise manual usam os mesmos contratos e serviços tipados.

**Tech Stack:** Chrome Extension Manifest V3, TypeScript strict, Vite, React, `@crxjs/vite-plugin`, Web Worker, Transformers.js com modelos ONNX locais, ONNX Runtime Web por WASM e WebGPU opcional, Web Crypto, `chrome.storage.local`, Vitest, Testing Library, jsdom, Playwright Chromium, ESLint e Prettier.

## Global Constraints

- Todo texto e todo feedback permanecem no dispositivo; nenhuma chamada de rede de produção é permitida.
- Não usar scripts remotos, `eval`, código baixado e executado dinamicamente, APIs pagas ou telemetria remota.
- O `MockClassifier` é determinístico e deve sempre exibir: “Modo de demonstração: nenhum modelo real está sendo utilizado.”
- O produto nunca afirma autoria; usar somente: “Provavelmente escrito por uma pessoa”, “Resultado inconclusivo”, “Possivelmente gerado por IA”, “Fortes indícios de texto gerado por IA” e “Conteúdo insuficiente para análise confiável”.
- O mínimo padrão é 100 palavras; oferecer 50, 80, 100, 150 e valor personalizado.
- Menos de 50 palavras nunca é classificado automaticamente; 50–79 somente no modo experimental; 80–99 tem confiança reduzida; 100–149 não sofre ocultação agressiva; 150+ usa análise completa.
- Chunk padrão: 192 tokens; sobreposição: 32 tokens; máximo configurável inicial: 256 tokens.
- Faixas provisórias: 0,00–0,39 humano provável; 0,40–0,79 inconclusivo; 0,80–0,91 possível IA; 0,92–1,00 fortes indícios.
- Limiares sempre satisfazem `markingThreshold <= blurThreshold <= collapseThreshold <= hideThreshold`.
- WASM é o backend padrão com concorrência 1; WebGPU é aceleração opcional com fallback automático.
- Somente posts visíveis ou dentro de `rootMargin: "500px"` entram na fila; posts fora da região não são processados automaticamente.
- Nenhuma tarefa causada pela extensão deve ocupar mais de 50 ms da main thread.
- Cache usa SHA-256 de texto normalizado, TTL e LRU; texto integral não é armazenado por padrão.
- Não armazenar nomes, IDs ou URLs de autores; não criar preferências persistentes por autor.
- Não remover posts do DOM; toda apresentação é reversível na mesma sessão.
- Não usar `innerHTML` com conteúdo extraído da página; todo DOM é entrada não confiável.
- Mensagens, configurações e importações são validadas em runtime e têm limites explícitos de tamanho.
- O histórico é opt-in e sem texto integral por padrão.
- Código, modelo, tokenizer e binários WASM necessários à execução offline devem estar empacotados na extensão.
- Cada fase termina com testes, typecheck, lint, build e um relatório honesto de limitações/falhas.

---

## 1. Resumo da arquitetura

```text
LinkedIn (isolated content-script)
  ├─ adapter registry → LinkedInAdapter → texto limpo
  ├─ IntersectionObserver + MutationObserver
  ├─ normalização/elegibilidade/hash
  └─ apresentação reversível + PageStats
                    │ mensagens validadas
                    ▼
MV3 service worker (coordenador efêmero)
  ├─ settings/effective settings
  ├─ cache SHA-256 + métricas agregadas
  ├─ context menus + análise manual
  └─ garante lifecycle do offscreen document
                    │ chrome.runtime Port
                    ▼
Offscreen document (reason: WORKERS)
  ├─ fila priorizada, deduplicação e cancelamento
  └─ Dedicated Web Worker
       ├─ idioma → tokenizer → chunks
       ├─ MockClassifier | OnnxTextClassifier
       ├─ agregação → calibração → abstenção
       └─ ClassificationResult + PerformanceTrace

Popup / Options / Manual panel
  └─ mesmos contratos, settings e status do modelo
```

O documento offscreen é necessário porque service workers MV3 são efêmeros e não devem ser usados como processos permanentes; a razão oficial `WORKERS` existe especificamente para hospedar workers. `minimum_chrome_version` será 116 para usar `runtime.getContexts()` sem compatibilidade legada. O manifesto solicitará somente `storage`, `contextMenus`, `activeTab`, `scripting` e `offscreen`, com host permission restrita a `https://www.linkedin.com/*`.

## 2. Decisões técnicas

| Decisão | Escolha | Consequência |
|---|---|---|
| Empacotamento | Vite + `@crxjs/vite-plugin`; `manifest.config.ts` é a fonte e `dist/manifest.json` é o artefato verificável | Resolve content scripts não modulares, múltiplas páginas e workers sem scripts manuais frágeis |
| Contexto de inferência | offscreen document + Dedicated Worker | Acrescenta a permissão `offscreen`, mas mantém inferência fora da página e compatível com MV3 |
| Biblioteca de ML | `@huggingface/transformers` com modelos ONNX empacotados | Fornece tokenizer e ONNX Runtime Web juntos; `env.allowRemoteModels = false` e caminhos locais serão obrigatórios |
| Backend | WASM default; WebGPU opt-in/auto com fallback | Funciona offline e em máquinas sem GPU compatível |
| Modelo | `MockClassifier` até existir artefato treinado, licenciado e validado | A Fase 3 tem um portão de entrada científico; não serão inventados pesos ou métricas |
| Estado de UI no post | atributos/classes `data-cleanfeed-*` e nós irmãos próprios | Não altera conteúdo textual nem a ordem de leitura; restauração é idempotente |
| Persistência | repositórios tipados sobre `chrome.storage.local` | Nenhum componente acessa chaves cruas fora de `src/storage/` |
| Validação | type guards/schemas próprios pequenos e funções puras | Evita dependência de schema em todos os bundles; importação usa limites defensivos explícitos |
| Testes | Vitest para unidades/integrações e Playwright somente para smoke MV3 | Testa DOM, storage mockado e carregamento real da extensão |
| Regras regex | worker separado, validador estrutural, limites e timeout com terminação | Uma regex do usuário não consegue congelar o content script nem o worker de ML |
| Benchmark | pacote Node separado em `benchmark/`, sem dados pessoais no repositório | Permite group/time split e métricas científicas sem entrar no bundle da extensão |

### Defaults fechados pelo plano

```typescript
export const DEFAULT_SETTINGS = {
  enabled: true,
  minimumWordCount: 100,
  languageMode: "portuguese_only",
  presentationMode: "indicator",
  markingThreshold: 0.8,
  blurThreshold: 0.92,
  collapseThreshold: 0.96,
  hideThreshold: 0.99,
  processVisibleOnly: true,
  experimentalShortTextDetection: false,
  manualAnalysisEnabled: true,
  showScore: false,
  showExplanation: true,
  backendPreference: "auto",
  webGpuEnabled: true,
  wasmEnabled: true,
  wasmConcurrency: 1,
  webGpuConcurrency: 2,
  maximumQueueSize: 50,
  maximumPostsPerMinute: 30,
  batchingEnabled: false,
  chunkSizeTokens: 192,
  chunkOverlapTokens: 32,
  maximumTokens: 256,
  inferenceTimeoutMs: 20_000,
  cacheMaximumEntries: 500,
  cacheTtlMs: 604_800_000,
  historyEnabled: false,
  historyRetentionDays: 30,
  storeFullText: false,
} as const;
```

## 3. Riscos e portões

| Risco | Mitigação planejada | Portão objetivo |
|---|---|---|
| DOM do LinkedIn muda sem aviso | seletores semânticos alternativos, heurísticas estruturais e fixtures por variante | falha controlada, sem analisar menus/autores; atualização concentrada em `selectors.ts` |
| Detector produz falsos positivos | mínimo 100, thresholds conservadores, abstenção, ação default “indicador” | nenhuma ação agressiva em 100–149 palavras; precisão de bloqueio é métrica prioritária |
| Não existe modelo válido fornecido | mock explícito e contrato completo; Fase 3 bloqueada até pacote e dataset existirem | UI nunca chama mock de detector real |
| CSP/model assets quebram offline | todos os assets locais, teste com rede desabilitada e CSP restrita | smoke Playwright conclui classificação mock offline |
| WebGPU falha ou varia por driver | inicialização isolada e fallback único para WASM | falha de WebGPU não interrompe navegação nem deixa modelo em loop |
| service worker suspende | nenhuma fila em memória no SW; offscreen hospeda fila/worker; estado durável no storage | reinício do SW não perde configurações/cache e chamadas recebem erro tipado ou retomam |
| fila cresce com scroll infinito | máximo 50, expiração, deduplicação por hash, rate limit por plataforma e cancelamento ao sair da viewport | tamanho nunca excede limite; `cancelledTasks` é incrementado |
| storage excede quota/corrompe | payloads limitados, índice LRU, validação na leitura e limpeza recuperável | entrada inválida é removida sem derrubar a extensão |
| apresentação quebra acessibilidade | DOM original preservado, foco visível, `aria-live` moderado e reveal imediato | testes axe/Testing Library + navegação por teclado |
| regex causa ReDoS | análise em worker descartável, padrões <= 256, texto <= 20.000 e timeout 20 ms | timeout termina worker e desativa apenas a regra problemática |
| benchmark vaza dados ou mede autores nos dois lados | dados externos ignorados pelo Git; splits por autor/período/plataforma/assunto/modelo | relatório registra estratégia de split; não aceita split aleatório simples como resultado principal |

### Portão obrigatório antes da Fase 3 real

Não iniciar avaliação real enquanto não houver, em `models/<model-id>/`:

1. pesos ONNX quantizados;
2. tokenizer/configs compatíveis;
3. mapa inequívoco de labels (`human` e `ai`);
4. licença redistribuível registrada;
5. checksum SHA-256 dos artefatos;
6. idiomas e máximo de tokens documentados;
7. corpus de benchmark com origem, consentimento/licença e rótulos auditáveis;
8. partições por autor e período sem vazamento.

Sem esse conjunto, a Fase 3 entrega o carregador, os validadores e o benchmark, mas o produto continua honestamente em modo mock.

## 4. Estrutura final de arquivos

```text
.
├─ manifest.config.ts
├─ package.json
├─ package-lock.json
├─ vite.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ tsconfig.json
├─ tsconfig.node.json
├─ eslint.config.js
├─ .prettierrc.json
├─ .gitignore
├─ public/
│  ├─ icons/
│  └─ models/<model-id>/
│     ├─ cleanfeed-model.json
│     ├─ config.json
│     ├─ tokenizer.json
│     ├─ tokenizer_config.json
│     └─ onnx/model_quantized.onnx
├─ src/
│  ├─ background/
│  │  ├─ service-worker.ts
│  │  ├─ message-router.ts
│  │  ├─ context-menu.ts
│  │  ├─ offscreen-manager.ts
│  │  └─ manual-analysis-controller.ts
│  ├─ offscreen/
│  │  ├─ offscreen.html
│  │  ├─ offscreen.ts
│  │  └─ worker-host.ts
│  ├─ content/
│  │  ├─ content-script.ts
│  │  ├─ post-controller.ts
│  │  ├─ page-stats.ts
│  │  ├─ session-state.ts
│  │  ├─ observers/intersection-observer.ts
│  │  ├─ observers/mutation-observer.ts
│  │  └─ presentation/
│  │     ├─ presentation-controller.ts
│  │     ├─ badge.ts
│  │     ├─ blur.ts
│  │     ├─ collapse.ts
│  │     ├─ hide.ts
│  │     ├─ restore.ts
│  │     └─ explanation-panel.ts
│  ├─ platforms/
│  │  ├─ platform-adapter.ts
│  │  ├─ registry.ts
│  │  └─ linkedin/
│  │     ├─ linkedin-adapter.ts
│  │     ├─ selectors.ts
│  │     ├─ extractor.ts
│  │     └─ presenter.ts
│  ├─ inference/
│  │  ├─ classifier.ts
│  │  ├─ classifier-types.ts
│  │  ├─ mock-classifier.ts
│  │  ├─ onnx-classifier.ts
│  │  ├─ model-bundle.ts
│  │  ├─ model-loader.ts
│  │  ├─ inference-worker.ts
│  │  ├─ worker-protocol.ts
│  │  ├─ tokenizer.ts
│  │  ├─ chunker.ts
│  │  ├─ aggregator.ts
│  │  ├─ calibration.ts
│  │  ├─ language-detector.ts
│  │  ├─ eligibility.ts
│  │  └─ explanation.ts
│  ├─ queue/
│  │  ├─ inference-queue.ts
│  │  ├─ priority-queue.ts
│  │  └─ task-registry.ts
│  ├─ storage/
│  │  ├─ storage-area.ts
│  │  ├─ cache.ts
│  │  ├─ settings.ts
│  │  ├─ effective-settings.ts
│  │  ├─ platform-settings.ts
│  │  ├─ metrics.ts
│  │  ├─ feedback.ts
│  │  ├─ history.ts
│  │  ├─ keyword-rules.ts
│  │  └─ import-export.ts
│  ├─ rules/
│  │  ├─ rule-engine.ts
│  │  ├─ regex-safety.ts
│  │  ├─ rule-worker.ts
│  │  └─ rule-worker-client.ts
│  ├─ shared/
│  │  ├─ messages.ts
│  │  ├─ message-validation.ts
│  │  ├─ types.ts
│  │  ├─ settings-types.ts
│  │  ├─ constants.ts
│  │  ├─ errors.ts
│  │  ├─ validation.ts
│  │  ├─ hashing.ts
│  │  ├─ text-normalization.ts
│  │  └─ word-count.ts
│  ├─ popup/
│  │  ├─ popup.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  └─ components/
│  ├─ options/
│  │  ├─ options.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  └─ components/
│  ├─ manual-analysis/
│  │  ├─ inject.ts
│  │  ├─ App.tsx
│  │  └─ components/
│  └─ styles/
│     ├─ theme.css
│     └─ injected.css
├─ tests/
│  ├─ setup/
│  │  ├─ chrome.ts
│  │  └─ dom.ts
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  └─ fixtures/linkedin-feed.html
├─ benchmark/
│  ├─ README.md
│  ├─ schema.ts
│  ├─ split.ts
│  ├─ metrics.ts
│  ├─ report.ts
│  ├─ cli.ts
│  ├─ tests/
│  └─ data/.gitkeep
└─ docs/
   ├─ architecture.md
   ├─ privacy.md
   ├─ platform-adapters.md
   ├─ model-integration.md
   ├─ model-validation.md
   ├─ limitations.md
   ├─ decisions.md
   ├─ risks.md
   └─ superpowers/plans/
```

## 5. Contratos que atravessam todas as fases

Estes nomes são canônicos. Planos posteriores não podem renomeá-los sem atualizar todos os consumidores e testes.

```typescript
export type ClassificationStatus =
  | "probably_human"
  | "inconclusive"
  | "possibly_ai"
  | "strong_ai_indication"
  | "insufficient_evidence"
  | "classification_failed";

export type PresentationMode = "indicator" | "blur" | "collapse" | "hide";
export type LanguageMode = "portuguese_only" | "model_supported" | "experimental_any";
export type Backend = "mock" | "wasm" | "webgpu";

export interface DecisionOutcome {
  status: ClassificationStatus;
  calibratedScore: number;
  actionCeiling: PresentationMode;
  abstained: boolean;
  reasonCodes: ReasonCode[];
}

export interface ClassificationResult {
  aiScore: number;
  humanScore: number;
  confidence: "low" | "medium" | "high";
  status: ClassificationStatus;
  wordCount: number;
  tokenCount: number;
  language?: string;
  chunks?: ChunkResult[];
  aggregation?: AggregationResult;
  explanation?: ClassificationExplanation;
  decision?: DecisionOutcome;
  modelVersion: string;
  modelId: string;
  backend: Backend;
  processingTimeMs: number;
  errorCode?: ErrorCode;
  demo: boolean;
}

export interface ClassifierMetadata {
  id: string;
  name: string;
  version: string;
  backend: Backend;
  quantization?: "none" | "int8" | "int4";
  supportedLanguages: string[];
  maximumTokens: number;
  supportsBatching: boolean;
}

export interface TextClassifier {
  initialize(): Promise<void>;
  classify(text: string, options?: ClassificationOptions): Promise<ClassificationResult>;
  dispose(): Promise<void>;
  getMetadata(): ClassifierMetadata;
}

export interface BatchTextClassifier extends TextClassifier {
  classifyBatch(
    texts: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult[]>;
}

export interface ModelStatus {
  state: "unavailable" | "initializing" | "ready" | "disposing" | "error";
  classifierId: string;
  modelVersion: string;
  backend: Backend;
  fallbackFrom?: "webgpu";
  errorCode?: ErrorCode;
  initializedAt?: number;
}

export interface PlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  findFeedRoot(document: Document): HTMLElement | null;
  findPostElements(root: ParentNode): HTMLElement[];
  extractPost(element: HTMLElement): ExtractedPost | null;
  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void;
  restorePresentation(element: HTMLElement): void;
  isPostElement(element: HTMLElement): boolean;
}

export interface StorageArea {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getMany<T>(keys: string[]): Promise<Record<string, T>>;
}

export interface Clock {
  now(): number;
}
```

Mensagens carregam `source`, `target`, `type`, `requestId` quando aplicável e payload limitado. O envelope evita que o offscreen responda a si mesmo e permite validar a direção da mensagem.

```typescript
export type ExtensionContext = "content" | "popup" | "options" | "background" | "offscreen" | "worker";

export interface MessageEnvelope<TType extends string, TPayload> {
  source: ExtensionContext;
  target: ExtensionContext;
  type: TType;
  requestId?: string;
  payload: TPayload;
}
```

## 6. Planos de execução

1. [Fase 1 — Fundação funcional](./2026-07-14-cleanfeed-ai-phase-1-foundation.md): toolchain, MV3, contratos, settings, texto, mock, cache, métricas, LinkedIn, observers, selo, popup/opções e primeira classificação em worker.
2. [Fase 2 — Pipeline local](./2026-07-14-cleanfeed-ai-phase-2-inference-pipeline.md): idioma, tokenização, chunks, agregação, calibração, abstenção, fila, cancelamento, timeout, offscreen e status de backend.
3. [Fase 3 — Modelo real e validação](./2026-07-14-cleanfeed-ai-phase-3-real-model-validation.md): contrato de bundle, carregamento ONNX local, WebGPU/WASM, validação de I/O, benchmark científico e documentação; ativação depende do portão do modelo.
4. [Fase 4 — Experiência de filtragem](./2026-07-14-cleanfeed-ai-phase-4-filtering-experience.md): blur/collapse/hide, restauração, explicações, feedback, análise manual, menu de contexto, UI completa e acessibilidade.
5. [Fase 5 — Personalização e diagnóstico](./2026-07-14-cleanfeed-ai-phase-5-personalization-diagnostics.md): settings por plataforma, regras seguras, histórico, import/export, métricas avançadas, diagnóstico e hardening final.

As fases são sequenciais. Dentro de cada fase, somente tarefas explicitamente sem dependências podem ser delegadas em paralelo; alterações em contratos compartilhados são serializadas e revisadas antes das tarefas consumidoras.

## 7. Portão de qualidade ao final de cada fase

Executar exatamente:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Quando a fase incluir smoke E2E:

```powershell
npm run test:e2e
```

O relatório da fase deve registrar:

- commit inicial e final;
- tarefas concluídas;
- testes executados e contagens;
- duração do build;
- limitações conhecidas;
- falhas e warnings ainda existentes;
- impacto nas permissões;
- confirmação de que nenhum request externo foi feito no smoke offline.

Não avançar com teste, lint, typecheck ou build vermelho.

## 8. Critérios de validação do MVP e rastreabilidade

| # | Critério | Fase/tarefa responsável |
|---|---|---|
| 1 | Carregar no Chrome em modo desenvolvedor | F1/T1, F4/T33, F5/T42 |
| 2 | Reconhecer posts do LinkedIn | F1/T7–T8 |
| 3 | Ignorar abaixo do mínimo | F1/T4 |
| 4 | Processar apenas visíveis/próximos | F1/T8, F2/T16 |
| 5 | Usar MockClassifier | F1/T5, F1/T9 |
| 6 | Classificar fora da main thread | F1/T9, F2/T17 |
| 7 | Aplicar selo | F1/T10 |
| 8 | Desfocar | F4/T27 |
| 9 | Revelar | F4/T27 |
| 10 | Restaurar | F4/T26–T27 |
| 11 | Não reprocessar cache | F1/T6, F2/T18 |
| 12 | Mostrar estatísticas no popup | F1/T10–T11, F4/T31 |
| 13 | Alterar configurações | F1/T3, F1/T11, F4/T32 |
| 14 | Pausar no domínio | F4/T31, F5/T34 |
| 15 | Funcionar offline | F3/T21, F4/T33, F5/T42 |
| 16 | Não enviar texto | restrição global + F4/T33/F5/T42 |
| 17 | Não armazenar autor | contratos F1/T2, testes F5/T42 |
| 18 | Analisar seleção em qualquer site | F4/T29–T30 |
| 19 | Testes automatizados | todas as tarefas |
| 20 | Documentar ONNX | F3/T20–T25 |
| 21 | Avisar quando mock ativo | F1/T5, F1/T11 |
| 22 | Linguagem probabilística | F1/T2, F1/T10, F4/T28 |
| 23 | Permitir abstenção | F2/T15 |
| 24 | Sem preferências por autor | restrição global + F5/T42 |
| 25 | Erros não bloqueiam navegação | F2/T19, F4/T33 |

### Cobertura das 53 seções do pedido

| Seção | Assunto | Implementação planejada |
|---|---|---|
| 1 | Objetivo e linguagem probabilística | restrições globais; F1/T2, T10–T11; F4/T28 |
| 2 | LinkedIn + análise manual + extensibilidade | F1/T7; F4/T29–T30; F5/T40 |
| 3 | Tecnologias e proibições | F1/T1; F3/T21; F4/T33; F5/T42 |
| 4 | Fluxo geral | arquitetura master; F1/T8–T10; F2/T18 |
| 5 | Regras de tamanho | F1/T4; F2/T16 |
| 6 | Elegibilidade | F1/T4, T10; F2/T12 |
| 7 | Normalização | F1/T4 |
| 8 | Textos longos/chunks | F2/T13–T14 |
| 9 | Agregação | F2/T15 |
| 10 | Contrato de classificação | master §5; F1/T2, T5 |
| 11 | Mock e ONNX | F1/T5; F3/T20–T24 |
| 12 | Worker, concorrência, cancelamento, fallback, batch | F1/T9; F2/T17–T19; F3/T23 |
| 13 | Fila de prioridade | F2/T17–T18 |
| 14 | PlatformAdapter | F1/T7; F5/T40 |
| 15 | LinkedIn | F1/T7–T8 |
| 16 | DOM observers | F1/T8; F2/T18 |
| 17 | Cache | F1/T6, T9; F5/T42 |
| 18 | Idioma | F2/T12; F3/T22 |
| 19 | Calibração por tamanho | F2/T16; F3/T24 |
| 20 | Faixas/thresholds | defaults master; F2/T16; F4/T32 |
| 21 | Abstenção | F2/T16, T18 |
| 22 | Explicação | F2/T16; F4/T28 |
| 23 | Indicator/blur/collapse/hide | F1/T10; F4/T26–T27 |
| 24 | Restauração | F4/T26–T27 |
| 25 | Ações somente no post | F4/T28, T30; F5/T35 |
| 26 | Menu de contexto | F4/T29–T30 |
| 27 | Settings por plataforma/domínio | F1/T3; F4/T32; F5/T34 |
| 28 | Regras personalizadas | F5/T35, T39 |
| 29 | Feedback | F4/T28; F5/T36 |
| 30 | Personalização futura separada | F5/T36 |
| 31 | Histórico local | F5/T36, T39 |
| 32 | Import/export | F5/T37, T39 |
| 33 | Privacidade | master constraints; F1/T11; F4/T32–T33; F5/T42 |
| 34 | Permissões MV3 | F1/T1; F4/T29, T33; F5/T42 |
| 35 | Popup | F1/T11; F2/T19; F4/T31 |
| 36 | Página de configurações | F1/T11; F4/T32; F5/T39 |
| 37 | Métricas locais | F1/T6; F2/T19; F5/T38 |
| 38 | Acessibilidade | F4/T26–T33; F5/T39 |
| 39 | Segurança | F1/T2, T4; F4/T33; F5/T35, T37, T42 |
| 40 | Mensageria | F1/T2, T9; F2/T18; F4/T29–T31 |
| 41 | Estrutura | master §4 |
| 42 | Testes | ciclo TDD em T1–T42 |
| 43 | Fixtures | F1/T7; F4/T33 |
| 44 | Performance | F1/T8; F2/T17–T19; F4/T33 |
| 45 | Erros | F1/T2, T9; F2/T18–T19; F3/T23 |
| 46 | Cinco fases | master §6 e cinco planos vinculados |
| 47 | Critérios de aceitação | tabela anterior; F5/T42 |
| 48 | Fora do escopo | restrições globais; auditoria F5/T42 |
| 49 | Entregáveis | T1–T42; docs F1/T11, F3/T25, F5/T40–T42 |
| 50 | README | F1/T11; F4/T33; F5/T41 |
| 51 | Forma de trabalho/portões | master §7; tasks finais T11, T19, T25, T33, T42 |
| 52 | Validação científica | F3/T24–T25 |
| 53 | Resultado esperado | Definition of Done; F5/T42 |

## 9. Limitações do modelo

- Um classificador de texto não prova autoria e pode confundir escrita formal, não nativa, revisada ou altamente estruturada com geração por IA.
- Textos humanizados, híbridos, traduzidos ou editados podem reduzir recall; novos modelos geradores causam drift.
- Scores não são probabilidades calibradas até haver um conjunto de calibração representativo por idioma, tamanho e plataforma.
- O mock mede apenas o fluxo de software; nunca mede qualidade de detecção.
- Um modelo multilíngue pode ter resultados diferentes em português e outros idiomas; thresholds não são transferidos sem validação.
- Chunks perdem contexto global e podem divergir; por isso um único pico não autoriza bloqueio agressivo.
- A UI default omite score numérico para não sugerir precisão inexistente; ele pode ser habilitado no modo avançado.
- A ativação do modelo real continua bloqueada se licença, labels, tokenizer ou benchmark não forem verificáveis.

## 10. Estratégia científica futura

O benchmark externo implementa métricas de precisão, recall, F1, ROC-AUC, PR-AUC, FPR, FNR, precisão entre bloqueados e recall em FPR fixo. Todo relatório segmenta por faixa de tamanho, idioma, plataforma, modelo gerador e tipo (humano, IA, híbrido, humanizado), e mede latência/memória.

A divisão principal é por grupos e tempo: autores nunca aparecem simultaneamente em treino/calibração/teste e o teste deve conter período posterior. Plataforma, assunto e modelo gerador entram como dimensões de auditoria. Split aleatório simples pode existir apenas como comparação secundária explicitamente rotulada.

Métrica de decisão do produto:

```text
precision_among_blocked = true_ai_blocked / all_blocked
```

Nenhum texto é ocultado por padrão até que essa métrica atinja o limiar de lançamento definido na Fase 3 com intervalo de confiança e FPR máximo registrados.

## 11. Referências técnicas oficiais

- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension security e CSP](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- [Transformers.js — custom/local models](https://huggingface.co/docs/transformers.js/en/custom_usage)
- [Transformers.js — WebGPU](https://huggingface.co/docs/transformers.js/en/guides/webgpu)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)

## 12. Definition of Done global

O projeto só é considerado concluído quando os 25 critérios de aceitação estiverem verdes, os cinco portões de fase tiverem relatórios, o pacote `dist/` carregar em Chrome sem erros, o smoke offline passar, nenhuma permissão fora da lista aprovada aparecer no manifesto e o README declarar claramente mock, incerteza, privacidade, limitações e ausência de prova de autoria.
