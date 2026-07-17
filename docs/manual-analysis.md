# Análise manual em qualquer site

A análise manual permite avaliar um texto selecionado em qualquer página, sem
conceder acesso permanente a outros sites e sem modificar a página além do
próprio painel.

## Como funciona

1. O usuário seleciona um texto e escolhe **"Analisar seleção com o CleanFeed
   AI"** no menu de contexto (contexto `selection`).
2. O service worker injeta, sob esse gesto, o entry programático
   `manual-analysis.js` via `chrome.scripting.executeScript` usando `activeTab`.
   Não há host permission global; o acesso é concedido apenas àquela aba e
   apenas naquele momento.
3. A seleção (limitada a 100.000 caracteres) é entregue ao painel por uma
   mensagem de runtime validada (`SHOW_MANUAL_ANALYSIS`). Um handshake
   (`MANUAL_ANALYSIS_READY`) reentrega a seleção caso o painel ainda não esteja
   ouvindo.
4. O painel monta um host fixo com **Shadow DOM** e estilos próprios a partir de
   uma constante confiável. O texto selecionado nunca é inserido como HTML.
5. A classificação usa o mesmo pipeline local (`CLASSIFY_TEXT` com
   `manual: true`), com prioridade máxima na fila.

## Garantias de privacidade

- Nenhuma seleção é lida sem a ação explícita do usuário.
- O painel não altera o DOM da página hospedeira; ele vive isolado no seu próprio
  host em Shadow DOM.
- Em sites genéricos, o resultado é exibido apenas no painel. Ações visuais
  (desfocar/recolher/ocultar) só existem em plataformas com adaptador e sob nova
  ação explícita do usuário.
- Seleções muito curtas recebem uma explicação clara ("Este conteúdo possui
  menos palavras do que o mínimo configurado.") em vez de um resultado frágil.

## Estado do modelo

Como no restante do MVP, a análise manual usa o classificador **mock**
determinístico. O resultado é uma demonstração do fluxo local e não é evidência
de autoria humana ou por IA.
