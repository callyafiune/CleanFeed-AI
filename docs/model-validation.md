# Validação de modelo e calibração versionada

Este documento descreve o contrato de calibração que separa um modelo real e
verificado de um modelo ainda não calibrado, e o procedimento de smoke para o
artefato candidato. O objetivo é garantir que um detector real só possa agir de
forma agressiva depois de ter uma calibração de benchmark comprovada.

## Contrato de calibração (gating)

A calibração é **versionada**. Cada perfil de calibração é vinculado ao artefato
exato que o produziu por cinco coordenadas:

- `modelId`
- `modelVersion`
- `platform`
- `language`
- `lengthBucket` (`50_79`, `80_99`, `100_149`, `150_299`, `300_PLUS`)

O `CalibrationRegistry` (`src/inference/calibration-registry.ts`) indexa os
perfis por essas coordenadas:

- `add(profile)` só aceita perfis já calibrados (`calibrated: true`). Tudo o que
  está no registro é, por definição, calibrado.
- `get(query)` só retorna um perfil quando **todas** as coordenadas batem. Ele
  nunca reaproveita uma calibração de outra `modelVersion` ou de outro
  `modelId`, e também erra em plataforma, idioma ou faixa de tamanho diferentes.
- Qualquer falha de correspondência devolve a constante
  `CONSERVATIVE_UNCALIBRATED_PROFILE`, cujo `calibrated` é `false` e cujo
  `actionCeiling` é `"indicator"`.

### Efeito na apresentação

A função aditiva `calibrateWithRegistry(result, registry, options?)`
(`src/inference/calibration.ts`) envolve `calibrateResult` sem alterar o seu
contrato:

1. A decisão base é calculada exatamente como antes por `calibrateResult`.
2. O caminho do mock/demo (`backend === "mock"`) é preservado sem alterações e
   mantém a capacidade de desfoque de demonstração.
3. Para um modelo real, o registro é consultado. Se o modelo estiver calibrado,
   a decisão base é mantida. Se **não** estiver calibrado, o `actionCeiling` é
   rebaixado para `"indicator"`.

Ou seja, um modelo real não calibrado ainda pode expor um score e um status
(úteis em modo debug), mas **nunca** desfoca, recolhe ou oculta um post. Só a
indicação é permitida.

O mock permanece explicitamente identificado como demonstração e é reportado
como não calibrado na página de opções: seus scores derivam de um hash de texto
e não são evidência de autoria humana ou por IA.

## Procedimento de smoke do modelo real

O teste `tests/integration/real-model-smoke.test.ts` valida um artefato
candidato **sem afirmar ground truth**. Ele é condicionado à variável de
ambiente `CLEANFEED_TEST_MODEL_DIR`.

### Sem artefato

Sem `CLEANFEED_TEST_MODEL_DIR`, o bloco de smoke real é **pulado** com
`describe.skipIf`, exibindo a razão "real model artifact not supplied". Isso é
uma lacuna documentada, e não um PASS científico. O diretório `public/models/`
permanece vazio e o modelo ativo continua sendo o mock.

O harness de profiling (`profileClassifier`) e o resolvedor de modelo ativo
(`resolveActiveModelProfile`) continuam sendo exercitados com o mock, de modo que
a mecânica de medição é validada mesmo sem um artefato real.

### Com artefato

Defina `CLEANFEED_TEST_MODEL_DIR` apontando para um diretório local que contenha
`manifest.json` e os arquivos referenciados. O smoke então verifica:

- **Carga offline**: o manifesto passa pelo parser fechado
  (`parseModelManifest`) e todos os arquivos referenciados existem no disco.
  Zero requisições para origem HTTP(S).
- **Labels**: os labels são binários (`{human, ai}` mapeados para `0` e `1`).
- **Idioma**: há ao menos um idioma suportado declarado.
- **Textos de sanidade**: cinco textos em português são classificados e cada
  distribuição soma aproximadamente `1` (`aiScore + humanScore ≈ 1`). Nenhuma
  afirmação é feita sobre o rótulo correto de cada texto.
- **Latência**: `profileClassifier` mede a latência fria (primeira execução) e
  quente (mediana das execuções seguintes).
- **Memória**: quando `performance.measureUserAgentSpecificMemory` existe, uma
  estimativa aproximada de memória é registrada; caso contrário, o valor é
  `null` e o relatório degrada de forma controlada.

### Portão de integração

Um artefato só é integrado quando o portão de entrada está satisfeito: bundle
licenciado, checksums SHA-256 conferidos, labels validados e uma calibração de
benchmark registrada. Enquanto isso não ocorre, o modelo ativo permanece o mock,
e tanto a interface quanto os relatórios deixam esse estado explícito.
