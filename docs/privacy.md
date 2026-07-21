# Privacidade

- A extensão processa o texto de posts localmente.
- Não transmite texto, autor, URL, DOM ou resultado de classificação para um
  servidor remoto. O portão E2E confirma zero requisições externas enquanto a
  extensão opera sobre o feed.
- Configurações, hashes de conteúdo e métricas agregadas são armazenados em
  `chrome.storage.local`; o hash evita reclassificações, mas não é exibido na UI.
- O feedback do usuário ("Era humano", "Era IA", "Não sei") é local e vinculado
  somente ao hash do texto, com pontuação/status previstos, versão do modelo e
  plataforma. Nunca guarda o texto, o autor ou a URL do post.
- As chaves `authorName`, `authorId` e `profileUrl` nunca são persistidas; um
  teste de fronteira (`tests/integration/security-boundaries.test.ts`) despeja
  todo o armazenamento após exercitar cada repositório e falha se elas aparecerem.
- O popup mostra apenas o domínio da aba atual e contadores agregados da página.
- O usuário pode restaurar a apresentação sem apagar ou modificar o conteúdo
  original do post.

## Análise manual e menus de contexto

- A análise manual é injetada apenas sob um gesto explícito (menu de contexto),
  usando `activeTab`/`scripting`. Não há host permission global e nenhuma seleção
  é lida sem a ação do usuário. A seleção é limitada a 100.000 caracteres antes de
  ser enviada ao pipeline local.
- Os itens de menu de contexto e o post sob o clique direito são lembrados apenas
  em memória (via `WeakRef`), sem autor, sem URL e sem path, e descartados ao
  navegar ou desconectar.
- "Pausar neste site" grava somente o hostname (nunca o path ou a query).

## Fronteiras de segurança

- O código-fonte não usa `eval`, `new Function` nem sinks de HTML
  (`innerHTML`/`outerHTML`/`insertAdjacentHTML`); todo conteúdo é inserido via
  `textContent`/APIs de DOM, então campos hostis de um resultado nunca injetam nós.
- A CSP das páginas da extensão é restrita a `'self'` mais `'wasm-unsafe-eval'`
  (necessário ao runtime WASM), sem `'unsafe-eval'` ou `'unsafe-inline'`.
- As mensagens de runtime são validadas por um contrato allowlist; mensagens
  forjadas de origem/rota inválida são rejeitadas com `INVALID_MESSAGE`.

O MVP não coleta dados para treinamento; o feedback local não treina o modelo.

## Histórico, regras e configurações por site

- **Histórico**: desligado por padrão. Uma escrita com o histórico desabilitado
  não toca no armazenamento. Quando habilitado, cada linha é sanitizada para uma
  allowlist fixa (hash do texto, plataforma, status, score, timestamp e, quando
  houver, origem/ação/feedback) — nunca o texto, o autor ou a URL. O texto
  completo só é persistido sob opt-in explícito, em uma chave **separada** e
  independentemente apagável, e nunca entra em nenhum export.
- **Regras de palavra-chave**: os padrões do usuário são avaliados localmente;
  padrões `regex` só compilam em um worker descartável após passar por um
  validador de segurança. Uma regra não guarda conteúdo de post.
- **Configurações por domínio**: "pausar neste site" e desativar por site gravam
  apenas o hostname normalizado — nunca o path, a query, o autor ou o texto.
- **Import/export de dados locais**: a importação mostra uma pré-visualização e
  exige confirmação antes de aplicar qualquer mudança; um export genérico nunca
  carrega o texto completo do histórico.

## Diagnóstico compartilhável

O relatório de diagnóstico é montado copiando apenas campos em allowlist para um
objeto novo: versão, ambiente (Chrome/SO), **permissões da API** (padrões de
host e qualquer token em forma de URL são removidos), métricas agregadas, status
do modelo e um resumo das configurações. Ele não contém hosts, URLs, texto,
autor nem qualquer PII.

A evidência de release ([releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md),
gerada por `npm run release:evidence`) segue a mesma disciplina: só metadados
técnicos e métricas agregadas — nunca texto, URL, autor, hash de conteúdo, score
individual, histórico ou feedback. Todo o runtime permanece offline
(`connect-src 'self'`), e o gate final de publicação recusa qualquer nova origem
de rede ou permissão.
