# Validação de modelo e calibração versionada

Este documento descreve o contrato de calibração que separa um modelo real e
verificado de um modelo ainda não calibrado, e o procedimento de smoke para o
artefato candidato. O objetivo é garantir que um detector real só possa agir de
forma agressiva depois de ter uma calibração de benchmark comprovada.

## Contrato de calibração (gating)

A calibração é **versionada**. Cada perfil de calibração é vinculado ao artefato
exato que o produziu por cinco coordenadas:

- `modelId`
- `modelVersion`
- `platform`
- `language`
- `lengthBucket` (`50_79`, `80_99`, `100_149`, `150_299`, `300_PLUS`)

O `CalibrationRegistry` (`src/inference/calibration-registry.ts`) indexa os
perfis por essas coordenadas:

- `add(profile)` só aceita perfis já calibrados (`calibrated: true`). Tudo o que
  está no registro é, por definição, calibrado.
- `get(query)` só retorna um perfil quando **todas** as coordenadas batem. Ele
  nunca reaproveita uma calibração de outra `modelVersion` ou de outro
  `modelId`, e também erra em plataforma, idioma ou faixa de tamanho diferentes.
- Qualquer falha de correspondência devolve a constante
  `CONSERVATIVE_UNCALIBRATED_PROFILE`, cujo `calibrated` é `false` e cujo
  `actionCeiling` é `"indicator"`.

### Efeito na apresentação

A função aditiva `calibrateWithRegistry(result, registry, options?)`
(`src/inference/calibration.ts`) envolve `calibrateResult` sem alterar o seu
contrato:

1. A decisão base é calculada exatamente como antes por `calibrateResult`.
2. O registro é consultado para **todo** resultado. Se houver uma calibração
   verificada para as cinco coordenadas exatas do modelo, a decisão base é
   mantida.
3. Sem calibração verificada — o que inclui, por definição, o mock de
   demonstração e a heurística estilométrica, já que o registro recusa perfis
   não calibrados — o `actionCeiling` é rebaixado para `"indicator"`.

Ou seja, um classificador não calibrado (real, mock ou heurístico) ainda pode
expor um score e um status (úteis em modo debug), mas **nunca** desfoca,
recolhe ou oculta um post. Só a indicação é permitida. O pipeline de inferência
(`completePreparedRequest` em `src/inference/inference-worker.ts`) aplica esse
gating em todos os resultados que produz.

O mock e a heurística estilométrica permanecem explicitamente identificados
como demonstração e reportados como não calibrados na página de opções: os
scores do mock derivam de um hash de texto, os da heurística são estatísticas
de estilo transparentes, e nenhum dos dois é evidência de autoria humana ou por
IA.

## Procedimento de smoke do modelo real

O smoke real é a **única** prova de que o modelo TMR executa de verdade. Ele
**não** é um teste Vitest: nenhum teste Vitest pode ser o portão do modelo real.
São duas camadas complementares.

### Camada 1 — orquestração (Vitest, não é o portão)

`tests/integration/real-model-smoke.test.ts` exercita somente a **orquestração**
ao redor do classificador — parsing de manifesto a partir de arquivo temporário,
o harness de profiling (`profileClassifier`) e o resolvedor de modelo ativo
(`resolveActiveModelProfile`) — com um **gateway injetado em memória**. Ele
**não** carrega Transformers.js nem ONNX e um verde ali **não** prova que o
modelo real roda. É deliberadamente rápido, offline e determinístico.

### Camada 2 — smoke real em Chrome (o portão)

A prova real vive em `../tests/e2e/real-model-smoke.spec.ts`, dirigida por
`npm run test:model:smoke` (modo candidate). O runner
`../scripts/run-real-model-tests.mjs`:

1. falha fechado com `MODEL_ARTIFACT_MISSING` enquanto o binário ONNX selado não
   foi adquirido — nunca um PASS falso, nunca um skip silencioso;
2. quando o binário existe, roda `model:verify`, constrói a extensão de smoke
   isolada (`build:model-smoke` → `dist-model-smoke/`, jamais a produção) e
   executa o Playwright no Chromium empacotado e pinado;
3. qualquer teste `skipped` ou a ausência do spec esperado vira
   `MODEL_SMOKE_SKIPPED`.

A página `model-smoke.html` inicializa o runtime coeso via
`createModelRuntime`/`ExactTokenizer` (offsets nativos por
`return_offsets_mapping`, `specialTokenCount` **medido**, nunca reconstruído por
substring), roda duas inferências fixas e não sensíveis e publica em
`window.__cleanfeedModelSmoke` um `ModelSmokeReport` **sem texto, tokens, URL da
página ou scores por amostra**. O spec exige, com o bundle presente:

- identidade `bundle` com os digests esperados;
- `exactTokenizer === true` e `specialTokenCount === 2` medido;
- no máximo oito janelas e agregação v2;
- `documentRawScore` e `localizedRawScore` finitos em `[0, 1]`;
- cold start e warm inference finitos e positivos, apenas **registrados** (os
  orçamentos 10 s / 2 s / 512 MiB pertencem só à lane de referência da Fase 4);
- memória via CDP `Performance.getMetrics` quando disponível, senão `null`;
- rede zero: qualquer requisição `http:`/`https:` reprova o smoke;
- cenário de asset corrompido: uma única troca para o fallback builtin
  **indicador** (`errorCode: "MODEL_ASSET_CORRUPTED"`), sem loop.

### Portão de integração e release

Um artefato só é integrado quando o portão de entrada está satisfeito: bundle
licenciado, checksums SHA-256 conferidos, labels validados e uma calibração de
benchmark registrada. O portão de release (`npm run test:model:release`) falha
fechado com `MODEL_RELEASE_NOT_PROMOTED` enquanto a decisão está `pending`;
quando promovido, delega a `build:release` (que roda o smoke exato do candidato,
o build do modo e a auditoria) e depois o E2E normal. Enquanto isso não ocorre, o
classificador ativo permanece a heurística estilométrica de demonstração, e tanto
a interface quanto os relatórios deixam esse estado explícito.

## Ver também

- O passo a passo de integração (manifesto, assets, checksums, calibração e
  benchmark) está em [model-integration.md](model-integration.md).
- O benchmark científico e a métrica principal (precisão entre bloqueados) estão
  em [benchmark/README.md](../benchmark/README.md).
- A decisão de projeto por trás da abstenção e do teto de ação está em
  [decisions.md](decisions.md) (ADR-004) e o risco de drift em
  [risks.md](risks.md).

Nenhum número de precisão ou acurácia é publicado enquanto o backend ativo for o
mock; a calibração garante que um detector real só possa agir de forma agressiva
depois de uma calibração de benchmark comprovada.
