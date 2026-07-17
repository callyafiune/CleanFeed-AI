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

## Extensibilidade: registro de plataformas

O `PlatformRegistry` (`src/platforms/registry.ts`) é o único ponto de extensão
para plataformas. Ele expõe `register(adapter)` — que **lança erro em ids
duplicados** —, `get(id)` e `match(url)`, que devolve o adapter dono da URL (ou
`null`). Adicionar uma plataforma é registrar um `PlatformAdapter`; nenhum
módulo de inferência, armazenamento ou apresentação precisa ser tocado. A
apresentação de qualquer adapter delega ao `PresentationController`
compartilhado, preservando reversibilidade e acessibilidade. O contrato
completo, as proibições de privacidade (sem dados de autor, sem APIs privadas) e
um exemplo copiável estão em [platform-adapters.md](platform-adapters.md).
