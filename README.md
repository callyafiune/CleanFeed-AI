# CleanFeed AI

Extensão Chrome Manifest V3 para reduzir ruído no feed com classificação local e
probabilística. O MVP opera no LinkedIn e marca posts longos elegíveis com uma
apresentação reversível. Ele não afirma autoria e não é um detector definitivo.

## Estado atual

Esta fase usa um classificador **mock** determinístico. Nenhum modelo real está
em uso; qualquer resultado é somente uma demonstração do fluxo local.

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
```

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
