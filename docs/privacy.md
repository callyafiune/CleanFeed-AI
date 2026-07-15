# Privacidade

- A extensão processa o texto de posts localmente.
- Não transmite texto, autor, URL, DOM ou resultado de classificação para um
  servidor remoto.
- Configurações, hashes de conteúdo e métricas agregadas são armazenados em
  `chrome.storage.local`; o hash evita reclassificações, mas não é exibido na UI.
- O popup mostra apenas o domínio da aba atual e contadores agregados da página.
- O usuário pode restaurar a apresentação sem apagar ou modificar o conteúdo
  original do post.

O MVP não implementa histórico de posts nem coleta dados para treinamento.
