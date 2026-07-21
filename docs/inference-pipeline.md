# Pipeline local de inferência

O CleanFeed AI analisa texto inteiramente no dispositivo. O content script extrai
um post e envia uma solicitação identificada ao service worker; o service worker
normaliza, calcula o hash, consulta o cache e encaminha somente a solicitação ao
documento offscreen. O documento offscreen mantém um Dedicated Worker, que é o
único contexto que executa detecção de idioma, tokenização, chunking,
classificação, agregação e calibração.

## Contratos entre contextos

- `CLASSIFY_TEXT` leva texto, plataforma e `requestId` do content script ao
  background. Respostas nunca repetem o texto recebido.
- `OFFSCREEN_CLASSIFY` leva uma cópia validada das configurações para o
  documento offscreen. O worker não lê `chrome.storage`.
- O worker responde com resultado, erro serializado, cancelamento ou status.
  O service worker consulta o WorkerHost pelo documento offscreen, em vez de
  inventar um estado pronto. `MODEL_STATUS_REQUEST`/`MODEL_STATUS_RESULT`
  expõem `unavailable`, `initializing`, `downloading`, `ready` ou `error`,
  versão, backend e capacidades do modelo.
- `GET_PAGE_STATS` retorna apenas contadores da página atual, latência média e
  tamanho da fila. O popup atualiza esses dados, enquanto está aberto, no máximo
  uma vez por segundo.

## Fila, cancelamento e falhas

A fila é limitada, prioriza análises manuais e posts visíveis, deduplica tarefas
compatíveis e expira solicitações antigas. `CANCEL_CLASSIFICATION` usa o
`requestId`: uma tarefa pendente é removida e uma tarefa em execução recebe
cancelamento no worker. Cada solicitação também tem timeout; seu vencimento gera
um resultado recuperável com `INFERENCE_TIMEOUT`, sem deixar promises pendentes.

Os limites aplicados às configurações são: fila de 1–500, concorrência WASM fixa
em 1, concorrência WebGPU de 1–4, timeout de 1.000–120.000 ms, chunks de 32–512
tokens (padrão 510 de conteúdo com overlap 64), overlap menor que o chunk e cache
de 10–5.000 entradas. Esses campos de janela só valem para runtimes
experimentais/builtin: o caminho TMR calibrado ignora as configurações editáveis
e usa sempre o plano de janela selado do manifesto (510 de conteúdo, 64 de
overlap, 512 no total, com os dois tokens especiais medidos no tokenizer).

## Telemetria e privacidade

`PerformanceTrace` descreve as etapas de extração, normalização, elegibilidade,
hash, fila, idioma, tokenização, inferência, agregação, apresentação e total.
O router constrói um trace seguro a partir do resultado do worker e o repositório
de métricas persiste somente total, backend, status e amostras limitadas de
latência. Os detalhes de timing da inferência são incluídos na resposta local
somente se `debugMode` estiver ativo. Antes de qualquer resultado entrar no
cache — inclusive entradas legadas lidas do storage — esses timings são
removidos. Storage não armazena texto, URL ou traces detalhados.

As configurações globais usam um envelope versionado. A migração de v1 para v2
preserva todas as preferências existentes e adiciona `debugMode: false`, para
que atualizações não habilitem telemetria detalhada nem descartem preferências.

## Precisão do pipeline

Nesta fase, `HeuristicTokenizer` segmenta Unicode e marca seus tokens como
aproximados (`exact: false`). O classificador mock também é local e produz
resultados de demonstração; ele não representa uma inferência de modelo real. O
contrato de chunks trabalha com offsets, então um tokenizador exato entra sem
alterá-lo. O caminho TMR usa `ExactTokenizer` (em `model-runtime.ts`): ele carrega
o tokenizer real junto com o backend na mesma materialização de assets, mede uma
única vez os tokens especiais com um probe `add_special_tokens` ligado/desligado
(exigindo 2 neste manifesto) e devolve offsets nativos via
`return_offsets_mapping`, sem reconstruí-los por busca de substrings nem recorrer
ao tokenizador heurístico. O fallback sem `navigator.gpu` mantém o pipeline
offline usando o backend WASM.

O caminho TMR só se torna runtime primário por uma decisão científica selada.
Hoje ele está `bundle-verified`/`pending`: o classificador ativo é o fallback
estilométrico e nenhum número de acurácia do TMR é publicado — a evidência, quando
existir, vem só de [releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md)
via `npm run release:evidence`. Quando o TMR se abstém, o estilométrico pode emitir
um resultado **separado**, sempre limitado a indicador; os dois nunca somam um
score único.

A localidade de calibração é normalizada por `normalizeCalibrationLocale` antes de
decidir suporte ou formar a chave de perfil: apenas `pt` e `pt-BR` (qualquer
caixa) resolvem para o `pt-BR` canônico; `pt-PT`, `en` e tags desconhecidas
permanecem sem suporte.
