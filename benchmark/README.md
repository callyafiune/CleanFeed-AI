# Benchmark científico do CleanFeed AI

> Os números deste arquivo (frações `45/5/10/20/20`, corpus `6k/4k/2k`) descrevem o **código como
> implementado**. O desenho vigente de partições e corpus vive em `docs/ESTADO.md` (§ 3.3 e § 6), que
> vence este arquivo.

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

## Fluxo obrigatório (nove subcomandos)

```text
validate -> split -> validate-predictions -> fit -> evaluate -> publish-profile
  -> verify-evidence -> publish-evidence -> verify-published-evidence
```

O scoring real das previsões (dev/cal-A e o holdout) pertence à
**Fase 3**, que orquestra o browser scorer em shards de 100 registros e chama os
primitives de ledger/validação deste pacote. A Fase 2 nunca executa inferência.

| Subcomando             | Faz                                                                                                                                                                                                                            | Flags                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`             | Sela o corpus (4k/4k/2k) e emite `dataset-audit.json` + `source-readiness.json`.                                                                                                                                               | `--dataset-dir --output`                                                                                                                                 |
| `split`                | Congela o split 45/5/10/20/20 sem vazamento e a auditoria em `split-artifact.json`; escreve `train.jsonl`, `dev.jsonl`, `cal-A.jsonl`, `test-input.jsonl` (sem labels) e, sob `private/`, `cal-B.jsonl` + `test-labels.jsonl`. | `--dataset-dir --dataset-audit --output --seed`                                                                                                          |
| `validate-predictions` | Verifica completude exata + shards + paridade de runtime.                                                                                                                                                                      | `--dataset-dir --split-artifact --partition --predictions --runtime-parity` (para `test` também `--ledger --consumption-id`)                             |
| `fit`                  | Ajusta calibradores e limiares (5%/2%) **sem ler o teste**; emite `frozen-calibration.json` (selado) e `cross-validation.json` (diagnóstico da CV agrupada, fora do selo).                                                     | `--dataset-dir --dataset-audit --source-readiness --split-artifact --runtime-parity --development-predictions --calibration-predictions --output --seed` |
| `evaluate`             | Etapa final interna de uma sessão de holdout já aberta; computa métricas/gates e sela `benchmark-report.{json,md}` + `gate-report.json`.                                                                                       | `--dataset-dir --split-artifact --frozen-calibration --test-predictions --test-labels --ledger --consumption-id --output --bootstrap-seed`               |
| `publish-profile`      | Escreve `calibration-profiles.json` + `release.json` (vazio + `bundle-verified` em `reject`).                                                                                                                                  | `--report --frozen-calibration --issued-at --model-dir`                                                                                                  |
| `verify-evidence`      | Reexecuta os parsers da Fase 1 e confere todos os digests report/perfis/release.                                                                                                                                               | `--report --frozen-calibration --model-dir`                                                                                                              |

| `publish-evidence` | Emite o conjunto FECHADO de sete arquivos sanitizados; recusa ledger não concluído, digest divergente, licença de modelo não aprovada ou relatório ausente. Reaproveita `publish-profile`/`verify-evidence` e nunca reconstrói release/perfis. | `--source-readiness --dataset-audit --split-artifact --frozen-calibration --fit-report --report --ledger --consumption-id --model-dir --output` |
| `verify-published-evidence` | Revalida um clone limpo usando só a evidência versionada + metadados do modelo (sem `benchmark/out`); aceita a promoção monotônica `pass/indicator -> pass/actions`. | `--evidence-dir --model-dir` |

`npm run benchmark -- --help` imprime o resumo acima.

## Evidência pública sanitizada (`benchmark/evidence/tmr-ptbr-v1`)

`publish-evidence` escreve APENAS sete arquivos com esquema fechado —
`dataset-summary.json`, `split-summary.json`, `fit-summary.json`,
`benchmark-report.json`, `benchmark-report.md`, `decision.json` e
`evidence-digest.json`. Nenhum registro, linha de previsão, caminho de shard/raw
ou array com ≥ 100 ids escalares entra na evidência; chaves de nível de registro
(`text`, `url`, `author`, `prompt`, `contentSha256`, `consentReceiptDigest`,
`sourceIdentifier`, `records`, `recordIds`, `predictionRows`, `predictions`) são
recusadas. Agregados seguros como `predictionManifestDigests` são preservados.
`evidence-digest.json` sela `scientificEvidenceDigest`
(== `release.evidenceDigest` == `benchmark-report.reportDigest`), o inventário
canônico ordenado dos outros seis arquivos, o `calibrationSetDigest` e
`publicationDigest = sha256(canonicalJson({schemaVersion: 1, files}))`.

A publicação real da decisão/evidência e do descritor autorizado (os passos 4–6
do plano) é uma etapa de operador DIFERIDA: exige uma execução de holdout real
concluída. O `.gitkeep` só é removido quando essa evidência real for publicada.

## Separação de labels e o holdout

- `split` escreve `test-input.jsonl` **sem rótulos** para o scorer da Fase 3 e um
  `private/test-labels.jsonl` separado com a verdade de campo.
- `fit` recebe apenas previsões de dev/cal-A e recusa qualquer id
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

## Governança de fontes e a fronteira de aquisição

Os protocolos normativos `protocols/collection-v1.md` e
`protocols/generation-v1.md` (ao lado de `annotation-v1`, `pii-review-v1` e
`corpus-v1` da Fase 2) definem os únicos caminhos autorizados de aquisição. O
`source-manifest.ts` é o manifesto de fontes revisado, fechado: chaves
desconhecidas (incluindo qualquer URL, nome, handle ou recibo bruto de
consentimento), uma fonte licenciada sem `licenseId`, uma fonte de
consentimento sem `consentReceiptDigest`, uma receita de geração incompleta,
revisores legais não distintos ou um `sourceManifestDigest` divergente são
falhas duras. O `corpus-source-audit.ts` é o **único produtor** do
`CorpusSourceReadinessReport` da Fase 2 (`auditCorpusSources` +
`assertCorpusSourcesReady`): ele consome — sem redefinir — o contrato puro de
`contracts/source-readiness.ts` e emite apenas os nove códigos de bloqueio; a
saída é determinística (permutar registros produz bytes idênticos) e nunca
carrega texto, URL, prompt, grupo de autor, recibo de consentimento ou hash de
conteúdo. O `sourceManifestDigest` é o auto-digest canônico do manifesto
(distinto do SHA-256 bruto do arquivo, que fica no `DatasetManifest`).

**Fronteira de aquisição:** concluir este código **não** implica que o corpus
exista ou esteja disponível. A prontidão só pode ser satisfeita por entradas
locais autorizadas — contribuição consentida ou fonte licenciada aprovada,
sob os protocolos acima. A coleta real, a geração, a pontuação e a publicação
de evidências permanecem uma etapa de operador diferida; nada aqui coleta,
gera ou baixa dados.

## Smoke de escala

`tests/helpers/generate-synthetic-release-corpus.ts` gera de forma determinística
10.000 registros sintéticos (`scientificUse: "infrastructure-only"`, nunca release
eligible) sob `benchmark/work/` para exercitar `validate` + `split` em escala.

## Ver também

- Como um artefato aprovado é integrado à extensão:
  [../docs/model-integration.md](../docs/model-integration.md).
- O contrato de calibração e gating: [../docs/model-validation.md](../docs/model-validation.md).
