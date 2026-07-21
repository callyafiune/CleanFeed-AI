# Integração de modelos locais

O CleanFeed AI aceita somente bundles **locais** abaixo de
`chrome-extension://<id>/models/<model-id>/`. O manifesto do modelo (JSON)
declara o contrato do classificador: os labels binários, a licença, a origem de
proveniência (`source`), a versão de calibração e os checksums SHA-256 de cada
artefato.

Antes de carregar qualquer modelo, o offscreen passa a URL base local ao
verificador (`parseModelManifest` / `verifyModelBundle`). Ele rejeita manifestos
com schema desconhecido, caminhos relativos inseguros, labels ambíguos, respostas
redirecionadas ou de outra origem e hashes incompatíveis. Nenhuma etapa consulta
rede HTTP(S).

O diretório `public/models/` fica vazio até que um candidato licenciado e
calibrado seja fornecido. Enquanto isso, o classificador ativo permanece o
fallback estilométrico transparente; a presença deste contrato **não** afirma a
disponibilidade de um detector real.

O candidato integrável é o **TMR** (`tmr-ai-text-detector`), um classificador
local para **português/LinkedIn** — não um detector universal. Ele está
`bundle-verified`/`pending`: o bundle é verificado e passa pelo smoke real, mas
sem uma decisão científica selada ele nunca vira runtime primário. A evidência de
qualquer decisão, quando existir, vive apenas no relatório versionado em
[releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md); este guia não publica número
de acurácia algum.

## Como integrar um modelo (passo a passo)

Nenhum destes passos habilita ações agressivas sozinho: o portão de modelo exige
todos eles satisfeitos. Enquanto isso, o backend ativo continua sendo o mock.

1. **Manifesto do modelo.** Escreva o manifesto JSON validado por
   `parseModelManifest` (`src/inference/model-bundle.ts`). Ele é um schema
   fechado — chaves extras ou ausentes reprovam. Os campos obrigatórios incluem:

   - `schemaVersion` (`1`), `id`, `name`, `version`;
   - `task` (`"ai_text_detection"`), `architecture`, `quantization`
     (`none` | `int8` | `int4`);
   - `modelPath`, `tokenizerPath`, `configPath` (caminhos relativos seguros);
   - `supportedLanguages`, `maximumTokens` (até 512, a capacidade do modelo TMR);
   - `labels` binários (`{ human, ai }` mapeados para `0`/`1`);
   - `output` (`{ name, kind: "logits" | "probabilities" }`);
   - `license` e `source` (proveniência auditável);
   - `calibrationVersion`;
   - `sha256` para `model`, `tokenizer` e `config`.

2. **Assets locais.** Coloque os artefatos referenciados sob
   `public/models/<model-id>/` para que sejam empacotados e servidos apenas via
   `chrome-extension://`. Nada é buscado remotamente; `connect-src 'self'`
   permanece.

3. **Checksums.** Gere o SHA-256 de cada artefato e registre-o no manifesto. No
   carregamento, cada arquivo é lido localmente e seu digest é conferido; um hash
   divergente reprova o bundle (`MODEL_LOAD_FAILED`).

   O runtime coeso (`ModelRuntime`, em `src/inference/model-runtime.ts`) liga em
   uma única carga de assets o classificador, o `ExactTokenizer` e o plano de
   janela (`createTmrChunkPlan`). O `ExactTokenizer` mede os tokens especiais uma
   vez na inicialização e usa offsets nativos (`return_offsets_mapping`); o plano
   de janela selado do manifesto (`windowing`: 512 total, 510 de conteúdo, 64 de
   overlap, no máximo 8 janelas) sempre prevalece sobre as configurações
   editáveis no caminho TMR.

4. **Calibração versionada.** Registre um perfil de calibração vinculado ao
   artefato exato pelas cinco coordenadas (`modelId`, `modelVersion`, `platform`,
   `language`, `lengthBucket`). Sem correspondência, o resultado cai no perfil
   conservador não calibrado, cujo teto de ação é `"indicator"`. Veja
   [model-validation.md](model-validation.md).

5. **Benchmark.** Rode a validação científica fora do bundle
   ([benchmark/README.md](../benchmark/README.md)) com split por autor/período e
   reporte a precisão entre bloqueados. Um relatório versionado com esse split é
   pré-requisito para qualquer decisão de lançamento.

6. **Smoke real em Chrome.** Depois de materializar os dez arquivos do bundle,
   rode `npm run test:model:smoke`. O runner
   ([run-real-model-tests.mjs](../scripts/run-real-model-tests.mjs)) constrói uma
   extensão de smoke **isolada** (`dist-model-smoke/`, nunca a produção) e executa
   o runtime real no Chromium empacotado, provando carga offline, tokenizer
   exato, janelas 510/64/8 e agregação v2. Enquanto o binário ONNX não é
   adquirido, o runner falha fechado com `MODEL_ARTIFACT_MISSING`; o portão de
   release (`npm run test:model:release`) permanece fechado com
   `MODEL_RELEASE_NOT_PROMOTED` até a decisão ser promovida. Detalhes e o contrato
   do `ModelSmokeReport` estão em [model-validation.md](model-validation.md).

Só quando manifesto, assets, checksums, calibração, benchmark e o smoke real em
Chrome estiverem satisfeitos o modelo é integrado. Até lá, tanto a interface
quanto os relatórios deixam explícito que o backend ativo é o mock. Nenhuma
métrica de precisão ou acurácia é publicada aqui.
