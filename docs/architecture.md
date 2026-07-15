# Arquitetura

```text
LinkedIn DOM
    │ candidatos estruturais e visíveis
    ▼
Content script ── GET_PAGE_STATS / limpar ── Popup
    │ normalização, elegibilidade e hash
    ▼
Service worker ── configurações, cache e métricas ── chrome.storage.local
    │
    ▼
Documento offscreen
    │
    ▼
Worker de inferência local
```

O `PlatformAdapter` delimita cada plataforma: encontra o feed, extrai o texto e
aplica/restaura a apresentação. O `PostController` não classifica posts fora do
viewport, curtos, duplicados ou já cancelados. A mensagem para o background é
validada em ambas as pontas e só aceita rotas conhecidas.

O worker atual é mock. A troca futura por ONNX/WASM/WebGPU preservará o contrato
de classificação e continuará sem chamadas de rede para conteúdo de posts.
