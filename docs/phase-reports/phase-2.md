# Fase 2 — Pipeline local de inferência

## Resultado

A Fase 2 entrega o pipeline local no Dedicated Worker com detecção de idioma,
tokenização aproximada, chunks sobrepostos, agregação, calibração, abstenção,
fila com cancelamento e timeout, além de status e controles de desempenho.

## Telemetria observável

- O popup mostra a fila da página, versão do modelo, backend e estado localizado.
- Métricas persistidas guardam contadores, uso de backend e até 100 amostras de
  latência, das quais são calculadas média e mediana.
- Timings detalhados só retornam quando a opção de depuração está ativa; texto e
  traces detalhados não são persistidos.

## Verificação

Em 16 de julho de 2026, o portão completo concluiu com sucesso:

- `npm run format:check`: aprovado.
- `npm run lint`: 0 erros (2 avisos preexistentes de `react-refresh` nos
  arquivos de entrada de options e popup).
- `npm run typecheck`: aprovado.
- `npm run test -- --run`: 41 arquivos e 269 testes aprovados.
- `npm run build`: aprovado; o bundle não referencia `navigator.gpu` e mantém
  o caminho offline/mock.

## Limitações conhecidas

- A tokenização heurística e o backend mock são aproximações e não equivalem a
  tokens ou probabilidades de um modelo de produção.
- A disponibilidade de WebGPU depende do navegador; sua ausência usa o caminho
  local mock e não ativa qualquer serviço remoto.
- Os timings de depuração descrevem estágios no worker. Etapas externas ao
  worker continuam representadas por métricas agregadas, não por texto ou URLs.
