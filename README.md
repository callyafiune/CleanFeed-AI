# CleanFeed AI

Extensão Chrome Manifest V3 para reduzir ruído no feed com classificação local e
probabilística. O MVP opera no LinkedIn e marca posts longos elegíveis com uma
apresentação reversível. Ele não afirma autoria e não é um detector definitivo.

## Estado atual

Esta fase usa um classificador **mock** determinístico. Nenhum modelo real está
em uso; qualquer resultado é somente uma demonstração do fluxo local.

A infraestrutura para um modelo real local já está pronta — carregador ONNX
verificado, empacotamento offline, seleção WebGPU/WASM com fallback, calibração
versionada e ferramenta de benchmark — mas permanece inativa até que um artefato
treinado e um dataset auditável passem pelo portão de modelo. Um modelo sem
calibração de benchmark só pode indicar, nunca ocultar.

## Experiência de filtragem

Toda apresentação é reversível e nunca remove permanentemente o post do DOM:

- **Indicador**: um selo (`role="button"`) irmão do post, navegável por teclado,
  que abre o painel "Indícios observados".
- **Desfoque / recolher / ocultar**: aplicados apenas a `possibly_ai` e
  `strong_ai_indication` acima do limiar de marcação, e sempre limitados pelo
  teto de ação (`actionCeiling`) da calibração. Cada modo expõe um controle
  imediato de "mostrar" e um `restore` que devolve o post ao estado original.
- **Resultados humanos, inconclusivos e abstidos nunca são filtrados**,
  independentemente da pontuação.
- **Explicações** usam apenas os sinais calculados (frases estáticas por
  `ReasonCode`, contagens e perfil de calibração) e linguagem probabilística;
  nunca afirmam autoria.
- **Feedback local** ("Era humano", "Era IA", "Não sei") é guardado apenas neste
  navegador, vinculado ao hash do texto — nunca ao texto, autor ou URL.

Consulte as [limitações](docs/limitations.md) e a
[análise manual](docs/manual-analysis.md).

## Análise manual em qualquer site

Sob um gesto explícito do usuário (menu de contexto sobre uma seleção), a
extensão injeta um painel isolado em Shadow DOM via `activeTab`/`scripting`,
sem host permission global e sem alterar a página além do próprio painel.
Detalhes em [docs/manual-analysis.md](docs/manual-analysis.md).

## Acessibilidade

Os selos e o painel de explicação são operáveis por teclado: o selo é um botão
com `aria-expanded`/`aria-controls`, abrir move o foco ao título do painel e
fechar devolve o foco ao selo. O texto do painel é declarado como `pt-BR`. Os
modos visuais respeitam `prefers-reduced-motion` e usam borda/texto além de cor.
As raízes próprias (popup, opções, painel manual e apresentação) são auditadas
com `axe-core` no portão E2E, sem violações graves ou críticas.

## Instalação

```powershell
npm ci
npm run build
```

No Chrome, abra `chrome://extensions`, ative o modo de desenvolvedor, escolha
**Carregar sem compactação** e selecione a pasta `dist`.

## Desenvolvimento e verificação

```powershell
npm run dev
npm test -- --run
npm run lint
npm run typecheck
npm run format:check
npm run build
npm run test:e2e
```

Os testes unitários e de integração rodam com Vitest. O `npm run test:e2e`
(Playwright) carrega a extensão empacotada de `dist` em um contexto Chromium
persistente e navega até um feed-mock servido localmente, **sem acesso à
internet** (o fixture é endereçado como `www.linkedin.com` via
`--host-resolver-rules`, mapeado para o servidor local, para que o guard de host
do content script rode inalterado). Em um Chrome real ele verifica que um post
recebe um selo acessível, que Enter abre e fecha o painel "Indícios observados",
que **nenhuma requisição externa** ocorre, que `axe-core` não acusa violações
graves/críticas no feed, popup e opções, e que o processamento de um feed grande
não gera long task acima de 50 ms. Rode `npm run build` antes do E2E.

## Benchmark científico

A validação de qualidade de um modelo real vive fora do bundle da extensão, em
[`benchmark/`](benchmark/README.md). Ela usa split por autor/período (sem
vazamento) e reporta a precisão entre bloqueados como métrica principal — nunca a
acurácia isolada.

```powershell
npm run benchmark -- --split group-time --input benchmark/data/dataset.jsonl --output benchmark/out
```

O dataset nunca entra no Git (`benchmark/data/*` é ignorado, exceto `.gitkeep`) e
precisa ser licenciado e pseudonimizado. Sem um modelo real e um dataset aprovado,
o detector permanece no mock e o relatório de benchmark não habilita decisões de
lançamento.

## Permissões

O manifest solicita `storage`, `contextMenus`, `activeTab`, `scripting` e
`offscreen`. A permissão persistente de host é limitada a
`https://www.linkedin.com/*`. `activeTab` permite a ação explícita do usuário
na aba atual, sem conceder acesso permanente a outros sites.

## Arquitetura e privacidade

O content script só observa candidatos estruturais do feed, normaliza e verifica
o tamanho antes de encaminhar texto ao worker local. O service worker coordena o
cache e o documento offscreen hospeda o worker. O armazenamento contém somente
configurações, hashes e métricas agregadas — não o texto, autor ou URL do post.

Consulte [a arquitetura](docs/architecture.md), a
[nota de privacidade](docs/privacy.md) e as [limitações](docs/limitations.md).

## Cache e worker

Classificações são indexadas por hash de texto, plataforma, modelo e versões de
configuração. O cache reduz inferências repetidas; o texto é mantido apenas pelo
tempo necessário para a solicitação local. O worker é dedicado e executado a
partir de um documento offscreen, evitando bloquear a thread da página.
