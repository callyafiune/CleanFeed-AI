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

O MVP não implementa histórico de posts nem coleta dados para treinamento; o
feedback local não treina o modelo.
