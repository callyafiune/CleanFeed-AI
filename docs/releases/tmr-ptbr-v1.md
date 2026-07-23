# CleanFeed AI — TMR PT-BR v1 release evidence

> **Nota (2026-07):** o bundle candidato foi substituído por `cleanfeed-ptbr-v1`
> (BERTimbau fine-tunado pelo próprio projeto). Referências históricas a
> `models/tmr-ai-text-detector/*` neste documento correspondem hoje a
> `models/cleanfeed-ptbr-v1/*`; o estado de gate segue `pending`/`bundle-verified`.

> Superfície de evidência de release do candidato TMR PT-BR/LinkedIn. Enquanto
> não houver uma decisão científica selada, este documento é mantido à mão e
> declara o estado real; a versão **gerada** (com os digests canônicos, os gates
> estatísticos, os perfis e o desempenho medido) é produzida por
> `npm run release:evidence` e verificada por `npm run release:evidence:check`.
> Nenhuma alegação de acurácia ou qualidade do TMR é feita aqui — nem poderia,
> porque nenhum relatório selado existe ainda.

## Estado atual

- **Decisão de gate:** `pending`. Nenhuma decisão científica (`reject`,
  `indicator-only` ou `pass`) foi emitida.
- **Rollout:** `bundle-verified`. Integração e smoke real em Chrome estão verdes,
  mas o TMR **não** classifica o feed.
- **Runtime ativo:** identidade `builtin`, a heurística **fallback estilométrico**
  transparente (`stylometric-v1`), limitada ao teto de ação `indicator`. Ela só
  pode indicar — nunca desfoca, recolhe ou oculta — e não é um detector validado.
- **Evidência científica:** ausente. `benchmark/evidence/tmr-ptbr-v1/**` não
  contém `benchmark-report.json`, `decision.json` nem `evidence-digest.json`;
  `models/tmr-ai-text-detector/release.json` traz `evidenceDigest: null` e
  `issuedAt: null`; `models/tmr-ai-text-detector/calibration-profiles.json` está
  vazio; `models/tmr-ai-text-detector/license-review.json` está `pending`.

## O que ainda é um passo de operador (deferido)

A calibração e a decisão de release exigem, em ordem, passos reais que **não**
foram executados neste worktree e cujos artefatos nunca entram no Git:

1. construir o corpus real PT-BR/LinkedIn (~10k itens) licenciado e
   pseudonimizado;
2. consumir o **holdout** temporal bloqueado uma única vez (ledger append-only) e
   pontuar os gates;
3. medir o desempenho real na máquina de referência pinada (Windows 11, quatro
   CPUs lógicas, 8 GiB, Chrome for Testing `150.0.7871.129`, backend WASM);
4. revisar e **aprovar** a licença do bundle e emitir o descritor/perfis.

O passo-a-passo exato — composição/cobertura do corpus, schema por registro, os
arquivos de governança e a sequência de comandos do pipeline (`ingest` →
`consume-holdout` → `publish-profile`) — está no
[runbook de coleta do corpus](../corpus-collection-runbook.md).

Enquanto esses passos não produzirem um descritor decidido, a lane de release
**falha fechada** em `pending`:

- `npm run release:evidence` termina com `RELEASE_EVIDENCE_PENDING` e não escreve
  a versão gerada deste documento;
- `npm run release:assert-publishable` termina com `RELEASE_DECISION_PENDING`;
- `npm run test:model:release` termina com `MODEL_RELEASE_NOT_PROMOTED`.

## Como a evidência é gerada e verificada quando houver decisão

`scripts/render-release-evidence.mjs` é determinístico e deriva cada afirmação do
descritor versionado, do relatório sanitizado da Fase 3, do manifesto de
evidência, dos perfis publicados e do recibo de desempenho de referência. Ele
exige que `release.evidenceDigest`, `evidence-digest.scientificEvidenceDigest` e
`benchmark-report.reportDigest` coincidam e chama o verificador publicado da Fase
3 para validar o `publicationDigest`. O documento gerado registra exatamente a
`gateDecision`, o `rolloutState`, os perfis publicados e o estado do gate de
desempenho — e nada além disso; nunca corpus, previsões, autores, hashes de
conteúdo ou scores individuais.

Uma segunda geração não altera bytes, e `--check` reprova se o arquivo comprometido
divergir do descritor canônico. A matriz completa de publicação está em
[../release-checklist.md](../release-checklist.md) e o contrato de calibração em
[../model-validation.md](../model-validation.md); a estatística vive no
[benchmark científico](../../benchmark/README.md).

## Matriz final de publicação (referência)

| gateDecision | rolloutState | TMR em `dist` | Runtime ativo | Apresentação | Publicável |
| --- | --- | --- | --- | --- | --- |
| pending | bundle-verified | não | builtin stylometric | indicator | **não** (estado atual) |
| reject | bundle-verified | não | builtin stylometric | indicator | sim (pacote fallback; candidato ainda foi smoked) |
| indicator-only | indicator | sim | bundle TMR | indicator | sim; todo perfil tem teto indicator |
| pass | indicator | sim | bundle TMR | indicator | não; estágio pré-ativação dos gates |
| pass | actions | sim | bundle TMR | preferência até hide | sim; `50–79` e trigger localizado seguem indicator |

## Limitação de interpretação

Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por IA.
Isso não comprova sua origem.
