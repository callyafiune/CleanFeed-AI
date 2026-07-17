# Limitações conhecidas

- O adaptador MVP depende da estrutura atual do DOM do LinkedIn; mudanças no
  site podem impedir a detecção ou extração até que os seletores sejam revisados.
- A classificação é mock e determinística nesta fase. Ela não mede autoria,
  qualidade, intenção ou veracidade e não deve ser usada para decisões sobre
  pessoas.
- Mesmo quando houver modelo real, classificações serão probabilísticas e podem
  produzir falsos positivos e falsos negativos.
- Textos abaixo do mínimo configurado são ignorados por padrão para evitar
  conclusões frágeis.
- O filtro automático desta fase está limitado ao LinkedIn. Outros adaptadores
  dependem do mesmo contrato, mas ainda não foram implementados.

## Apresentação e explicações

- Apenas `possibly_ai` e `strong_ai_indication` acima do limiar de marcação
  podem ser desfocados, recolhidos ou ocultados; humano, inconclusivo,
  evidência insuficiente e resultados abstidos nunca são filtrados.
- A agressividade é sempre limitada pelo teto de ação (`actionCeiling`) da
  calibração por tamanho; um modelo não calibrado só pode indicar.
- As explicações listam somente sinais calculados e usam linguagem
  probabilística; não interpretam neurônios, estilo ou intenção e não afirmam que
  um texto "foi escrito por IA".
- O feedback local não altera o modelo nem os limiares; ele só é registrado para
  uso futuro neste navegador.

## Análise manual

- Em sites genéricos, a análise manual apenas exibe o resultado no próprio painel
  e não aplica nenhum modo visual automaticamente; ações visuais só ocorrem em
  plataformas com adaptador e sob clique explícito do usuário.

## Desempenho

- O observador do feed processa no máximo 100 candidatos por ciclo síncrono e
  cede a thread principal (`scheduler.yield`, com fallback `setTimeout(0)`) entre
  ciclos, para que uma inserção grande da rolagem virtual não bloqueie a página.
  O orçamento real de 50 ms por tarefa é verificado em Chrome real no portão E2E.
