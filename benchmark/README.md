# Benchmark científico do CleanFeed AI

Ferramenta independente para validar dados e previsões, congelar um split
temporal sem vazamento, ajustar calibradores sem consultar o holdout, emitir
`pass | indicator-only | reject` e publicar perfis imutáveis. Ela vive **fora**
do bundle da extensão: nenhum módulo aqui importa de `src/`, e nada aqui é
embarcado na extensão. Ela consome apenas os contratos puros de `contracts/`.

Executa sob a execução nativa de TypeScript do Node (Node ≥ 22.18), é
determinística (sem `Date.now`, sem `Math.random` nos artefatos científicos) e
falha fechada: qualquer campo desconhecido, id/hash repetido, score fora de
`[0,1]`, metadado contraditório, previsão ausente ou digest divergente é uma
falha dura — nunca `last-write-wins` nem exclusão silenciosa.

## Fluxo obrigatório (sete subcomandos)

```text
validate -> split -> validate-predictions -> fit -> evaluate -> publish-profile -> verify-evidence
```

O scoring real das previsões (development/calibration e o holdout) pertence à
**Fase 3**, que orquestra o browser scorer em shards de 100 registros e chama os
primitives de ledger/validação deste pacote. A Fase 2 nunca executa inferência.

| Subcomando             | Faz                                                                                                                                                                                                      | Flags                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`             | Sela o corpus (4k/4k/2k) e emite `dataset-audit.json` + `source-readiness.json`.                                                                                                                         | `--dataset-dir --output`                                                                                                                                 |
| `split`                | Congela o split 20/30/50 sem vazamento e a auditoria em `split-artifact.json`; escreve `development.jsonl`, `calibration.jsonl`, `test-input.jsonl` (sem labels) e `private/test-labels.jsonl` separado. | `--dataset-dir --dataset-audit --output --seed`                                                                                                          |
| `validate-predictions` | Verifica completude exata + shards + paridade de runtime.                                                                                                                                                | `--dataset-dir --split-artifact --partition --predictions --runtime-parity` (para `test` também `--ledger --consumption-id`)                             |
| `fit`                  | Ajusta calibradores e limiares (5%/2%) **sem ler o teste**; emite `frozen-calibration.json`.                                                                                                             | `--dataset-dir --dataset-audit --source-readiness --split-artifact --runtime-parity --development-predictions --calibration-predictions --output --seed` |
| `evaluate`             | Etapa final interna de uma sessão de holdout já aberta; computa métricas/gates e sela `benchmark-report.{json,md}` + `gate-report.json`.                                                                 | `--dataset-dir --split-artifact --frozen-calibration --test-predictions --test-labels --ledger --consumption-id --output --bootstrap-seed`               |
| `publish-profile`      | Escreve `calibration-profiles.json` + `release.json` (vazio + `bundle-verified` em `reject`).                                                                                                            | `--report --frozen-calibration --issued-at --model-dir`                                                                                                  |
| `verify-evidence`      | Reexecuta os parsers da Fase 1 e confere todos os digests report/perfis/release.                                                                                                                         | `--report --frozen-calibration --model-dir`                                                                                                              |

`npm run benchmark -- --help` imprime o resumo acima.

## Separação de labels e o holdout

- `split` escreve `test-input.jsonl` **sem rótulos** para o scorer da Fase 3 e um
  `private/test-labels.jsonl` separado com a verdade de campo.
- `fit` recebe apenas previsões de development/calibration e recusa qualquer id
  do teste; ele nunca lê rótulos de teste.
- `evaluate` é a etapa final interna de uma sessão `consume-holdout` **já aberta**
  pela Fase 3; ele não abre a sessão nem inicia o scoring. O holdout só pode ser
  pontuado dentro dessa sessão atômica, registrada no ledger append-only
  (`holdout-ledger.ts`), cuja lease é de mão única: o primeiro `started` consome a
  tupla científica mesmo em caso de crash; só o mesmo `consumptionId` com digests
  idênticos retoma; `completed`/`failed` são terminais. `evaluate` consome o
  holdout **mesmo quando reprova**.

## Gates (`pass | indicator-only | reject`)

- Um gate de **integridade** ou de **aviso** reprovado ⇒ `reject`.
- Todos os avisos passam mas um gate de **ação** falha ⇒ `indicator-only`.
- Todos os gates de aviso e ação passam ⇒ `pass`.

Wilson unilateral usa `z = 1.6448536269514722`; AUC/calibração usam 2.000
réplicas de bootstrap clusterizadas por autor. Detalhes da estatística, dos
calibradores e do holdout em
[../docs/model-validation.md](../docs/model-validation.md).

## Privacidade dos dados

Datasets, labels privados e textos nunca entram no Git: `benchmark/data/*`,
`benchmark/out/` e `benchmark/work/` são ignorados (exceto `benchmark/data/.gitkeep`).
Os grupos de autor são pseudonimizados e cada registro carrega uma licença.

## Smoke de escala

`tests/helpers/generate-synthetic-release-corpus.ts` gera de forma determinística
10.000 registros sintéticos (`scientificUse: "infrastructure-only"`, nunca release
eligible) sob `benchmark/work/` para exercitar `validate` + `split` em escala.

## Ver também

- Como um artefato aprovado é integrado à extensão:
  [../docs/model-integration.md](../docs/model-integration.md).
- O contrato de calibração e gating: [../docs/model-validation.md](../docs/model-validation.md).
