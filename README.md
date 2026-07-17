# CleanFeed AI

Extensão Chrome Manifest V3 que reduz ruído no feed com classificação **local e
probabilística**. O MVP opera no LinkedIn e marca posts longos elegíveis com uma
apresentação reversível. A classificação é probabilística e local: ela
**não prova autoria** e não é um detector definitivo.

## Objetivo

Dar ao usuário um controle discreto e reversível sobre publicações longas que
_possivelmente_ foram geradas por IA, sem nunca:

- remover permanentemente conteúdo do DOM;
- afirmar que um texto específico "foi escrito por IA" ou por uma pessoa;
- enviar texto, autor, URL ou resultado de classificação para qualquer servidor.

Todo o processamento ocorre localmente no navegador. O armazenamento guarda
apenas configurações, hashes e métricas agregadas — nunca o texto, o autor ou a
URL do post.

## Arquitetura

Um content script observa candidatos estruturais do feed, normaliza e verifica o
tamanho antes de encaminhar o texto a um worker local; o service worker coordena
cache e métricas; um documento offscreen hospeda o worker de inferência. Os
detalhes, o diagrama e o contrato de mensagens estão em
[docs/architecture.md](docs/architecture.md).

## Estado atual

Esta fase usa um classificador **mock** determinístico (`MockClassifier`).
Nenhum modelo real está em uso; qualquer resultado é somente uma demonstração do
fluxo local. **O MockClassifier não é um detector real**: sua saída deriva de um
hash do texto e não é evidência de que um conteúdo foi escrito por uma pessoa ou
por IA. Nenhuma métrica de qualidade de detecção é afirmada neste estágio.

A infraestrutura para um modelo real local já existe — carregador com verificação
de manifesto/checksum, empacotamento offline, seleção WebGPU/WASM com fallback,
calibração versionada e ferramenta de benchmark — mas permanece inativa até que
um artefato treinado e um dataset auditável passem pelo portão de modelo. Um
modelo sem calibração de benchmark só pode indicar, nunca ocultar. Consulte
[Mock vs. modelo real](#mock-vs-modelo-real).

## Requisitos

- Node.js **>= 22** (veja `engines` em `package.json`).
- npm.
- Google Chrome/Chromium **116+** (versão mínima declarada no manifesto).

## Instalação

Instale as dependências de forma reprodutível e gere o pacote:

```powershell
npm ci
npm run build
```

No Chrome, abra `chrome://extensions`, ative o **modo de desenvolvedor**, clique
em **Carregar sem compactação** e selecione a pasta `dist`.

## Desenvolvimento e verificação

Todos os comandos abaixo existem em `package.json`; nenhum outro é necessário:

```powershell
npm run dev            # servidor de desenvolvimento (Vite)
npm run build          # build de produção da extensão e do painel manual
npm test -- --run      # testes unitários e de integração (Vitest)
npm run test:e2e       # portão E2E em Chrome real (Playwright); rode build antes
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit (app + config Node)
npm run format:check   # Prettier em modo verificação
npm run format         # Prettier corrigindo formatação
npm run docs:check     # verifica se todo link relativo da documentação existe
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

## Permissões

O manifesto solicita apenas o mínimo necessário. Cada permissão da API e por que
ela é usada:

- `storage` — persistir configurações, hashes de conteúdo e métricas agregadas
  em `chrome.storage.local`; nunca guarda texto, autor ou URL.
- `contextMenus` — oferecer o item de menu "Analisar seleção com o CleanFeed AI"
  sob um gesto explícito do usuário.
- `activeTab` — injetar o painel de análise manual apenas na aba atual e apenas
  no momento do clique, sem acesso permanente a outros sites.
- `scripting` — executar o entry programático da análise manual via
  `chrome.scripting.executeScript` sob esse mesmo gesto.
- `offscreen` — hospedar o documento offscreen que roda o worker de inferência
  fora da thread da página.

A única permissão persistente de host é `https://www.linkedin.com/*` (declarada
em `host_permissions`), o alcance mínimo do adaptador do MVP. A extensão não
pede `<all_urls>` nem qualquer host adicional.

## Privacidade

- Todo o processamento ocorre localmente; nada de texto, autor, URL, DOM ou
  resultado de classificação é transmitido para um servidor remoto. O portão E2E
  confirma zero requisições externas.
- O armazenamento contém apenas configurações, hashes de conteúdo e métricas
  agregadas. As chaves de identidade de autor (`authorName`, `authorId`,
  `profileUrl`) nunca são persistidas e um teste de fronteira falha se aparecerem.
- O feedback local ("Era humano", "Era IA", "Não sei") é vinculado somente ao
  hash do texto — nunca ao texto, autor ou URL — e não treina o modelo.

Detalhes completos em [docs/privacy.md](docs/privacy.md). As limitações
conhecidas (DOM, idioma, tamanho e drift) estão em
[docs/limitations.md](docs/limitations.md).

## Cache e worker (offscreen)

Classificações são indexadas por hash de texto, plataforma, modelo e versões de
configuração. O cache reduz inferências repetidas; o texto é mantido apenas pelo
tempo necessário para a solicitação local. O worker é dedicado e executado a
partir de um documento **offscreen**, evitando bloquear a thread da página.

## Análise manual em qualquer site

Sob um gesto explícito do usuário (menu de contexto sobre uma seleção), a
extensão injeta um painel isolado em Shadow DOM via `activeTab`/`scripting`, sem
host permission global e sem alterar a página além do próprio painel. Em sites
sem adaptador, o resultado aparece apenas no painel e nenhum modo visual é
aplicado. Detalhes em [docs/manual-analysis.md](docs/manual-analysis.md).

## Personalização e diagnóstico

- **Regras de palavra-chave**: regras pessoais (`contains`, `exact`, `regex`)
  avaliadas localmente. Uma regra não é detecção de IA — ela não carrega score e
  o post filtrado recebe um rótulo neutro. Padrões `regex` passam por um
  validador de segurança e são compilados em um worker descartável com
  kill-switch, para conter backtracking catastrófico (ReDoS).
- **Histórico opt-in**: desligado por padrão. Quando habilitado, guarda linhas
  sanitizadas (hash, plataforma, status, score, timestamp) com retenção e teto de
  entradas configuráveis; o texto completo só é guardado se o usuário optar
  explicitamente, em uma chave separada e independentemente apagável.
- **Import/export de dados locais**: exportação e importação dos seus dados
  locais com **pré-visualização e confirmação** antes de aplicar qualquer
  mudança.
- **Configurações por domínio/plataforma**: "pausar neste site" e desativar por
  site gravam apenas o hostname (nunca path, query, autor ou texto).
- **Diagnóstico**: um relatório compartilhável, montado apenas com campos em
  allowlist (versão, ambiente, permissões da API, métricas agregadas, status do
  modelo e resumo das configurações) — sem hosts, sem URLs, sem PII.

## Como adicionar uma plataforma

Adicionar suporte a uma nova plataforma significa **registrar um adaptador** no
`PlatformRegistry`; nenhum módulo de inferência, armazenamento ou apresentação
precisa ser tocado. O contrato completo, as proibições de privacidade (sem dados
de autor, sem APIs privadas), os arquivos mínimos, as fixtures obrigatórias e um
exemplo copiável estão no guia
[docs/platform-adapters.md](docs/platform-adapters.md). Adicione **apenas** o
host da nova plataforma às `host_permissions`/`matches`, sempre com o padrão mais
estreito possível.

## Como integrar um modelo

O CleanFeed aceita somente bundles de modelo **locais**, verificados por
manifesto e checksum SHA-256, com calibração versionada e validação de benchmark
antes de qualquer ação agressiva. O passo a passo — manifesto do modelo, assets
locais, checksums, calibração e benchmark — está em
[docs/model-integration.md](docs/model-integration.md), e o contrato de
calibração/gating em [docs/model-validation.md](docs/model-validation.md).

## Mock vs. modelo real

O classificador ativo é o `MockClassifier` determinístico, marcado como
demonstração em toda a interface. **O MockClassifier não é um detector real** e
nenhum número de precisão ou acurácia é publicado enquanto ele estiver ativo.

Um modelo real só é integrado quando o portão de entrada estiver satisfeito:
bundle licenciado, checksums conferidos, labels validados e uma calibração de
benchmark registrada. Mesmo então, a classificação continua probabilística e
pode produzir **falsos positivos** e **falsos negativos**; um modelo não
calibrado só pode indicar, nunca desfocar, recolher ou ocultar.

## Benchmark científico

A validação de qualidade de um modelo real vive fora do bundle da extensão, em
[benchmark/README.md](benchmark/README.md). Ela usa split por autor/período (sem
vazamento) e reporta a precisão entre bloqueados como métrica principal — nunca a
acurácia isolada.

```powershell
npm run benchmark -- --split group-time --input benchmark/data/dataset.jsonl --output benchmark/out
```

O dataset nunca entra no Git (`benchmark/data/*` é ignorado, exceto `.gitkeep`) e
precisa ser licenciado e pseudonimizado. Sem um modelo real e um dataset
aprovado, o detector permanece no mock e o relatório de benchmark não habilita
decisões de lançamento.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Privacidade](docs/privacy.md)
- [Limitações conhecidas](docs/limitations.md)
- [Análise manual](docs/manual-analysis.md)
- [Guia de adaptadores de plataforma](docs/platform-adapters.md)
- [Integração de modelos locais](docs/model-integration.md)
- [Validação e calibração de modelo](docs/model-validation.md)
- [Benchmark científico](benchmark/README.md)
- [Decisões de arquitetura (ADRs)](docs/decisions.md)
- [Registro de riscos](docs/risks.md)

## Solução de problemas

- **A extensão não aparece / não carrega**: rode `npm run build` e recarregue a
  pasta `dist` em `chrome://extensions` com **Carregar sem compactação**.
- **Nenhum post é marcado no LinkedIn**: só posts longos e elegíveis são
  avaliados, e o resultado do mock é aleatório por hash; humano, inconclusivo e
  resultados abstidos nunca são filtrados. Um layout novo do site pode exigir
  revisão dos seletores (veja [limitações](docs/limitations.md)).
- **O E2E falha ao iniciar**: rode `npm run build` antes de `npm run test:e2e`; o
  Playwright carrega a extensão a partir de `dist`.
- **Erros de tipo ou lint**: rode `npm run typecheck` e `npm run lint`; corrija a
  formatação com `npm run format`.
- **Link quebrado na documentação**: `npm run docs:check` aponta o arquivo e o
  alvo inexistente.
