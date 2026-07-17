# Fase 3 — Integração e validação de modelo real

## Resultado

A Fase 3 entrega toda a infraestrutura para um detector real local, substituível
e auditável, mantendo o backend ativo no mock enquanto nenhum artefato treinado é
fornecido:

- Manifesto de bundle próprio com labels, arquivos, checksums SHA-256 e licença,
  verificado antes de qualquer carregamento; caminhos e IDs restritos e sem
  travessia de diretório.
- Runtime Transformers.js empacotado offline (`env.allowRemoteModels = false`),
  com WASM e tokenizer copiados localmente e inventário de assets verificado no
  build.
- `OnnxTextClassifier` com tokenizer exato, mapeamento de labels pelo manifesto
  (sem assumir ordem de saída), softmax numericamente estável e validação de I/O.
- Seleção de backend WebGPU/WASM com fallback exatamente uma vez, aviso visível
  de fallback e um ciclo de vida do modelo serializado e recuperável (inclusive
  drenagem de inferências em voo antes de descartar o classificador).
- Registro de calibração **versionado**: uma calibração nunca é reutilizada entre
  IDs ou versões de modelo diferentes; um modelo sem calibração de benchmark é
  tratado como não calibrado e só pode **indicar** (`actionCeiling: "indicator"`),
  nunca borrar, recolher ou ocultar.
- Ferramenta de benchmark científico fora do bundle da extensão, com split por
  autor/período sem vazamento, precisão entre bloqueados como métrica principal e
  proibição de acurácia como manchete.

## Portão de modelo real

Nenhum artefato de modelo treinado nem dataset auditável foi fornecido. Portanto:

- `activeClassifierId` permanece `mock-v1`; o detector real **não** foi ativado.
- O smoke de modelo real (`tests/integration/real-model-smoke.test.ts`) é ignorado
  com a razão "real model artifact not supplied" quando `CLEANFEED_TEST_MODEL_DIR`
  não está definido. Isso é um *skip* documentado, não uma validação científica
  aprovada.
- As opções expõem o ID/versão/backend do modelo, o status de calibração e um
  controle "usar modelo mock"; sem artefato, o status reportado é o do mock e não
  calibrado.

## Verificação

Em 17 de julho de 2026, o portão completo concluiu com sucesso:

- `npm run format:check`: aprovado.
- `npm run lint`: 0 erros (2 avisos preexistentes de `react-refresh` nos arquivos
  de entrada de options e popup).
- `npm run typecheck`: aprovado.
- `npm run test -- --run`: 52 arquivos, 373 testes aprovados e 3 ignorados (o bloco
  de smoke de modelo real).
- `npm run build`: aprovado; o bundle continua offline e não referencia origem
  remota de modelo ou WASM.

## Limitações conhecidas

- O backend ativo continua sendo o mock determinístico; nenhuma métrica de
  qualidade de detecção é afirmada nesta fase.
- Como não há dataset de benchmark versionado, o registro de calibração está vazio
  e qualquer modelo real carregado seria tratado como não calibrado (apenas
  indicador) até um benchmark aprovar um perfil por versão/idioma/tamanho/plataforma.
- Os dados de benchmark nunca entram no Git (`benchmark/data/*` é ignorado, exceto
  `.gitkeep`); a validação científica depende de um dataset externo licenciado e
  pseudonimizado.
