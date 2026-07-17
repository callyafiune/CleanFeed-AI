# Benchmark científico do CleanFeed AI

Ferramenta independente para avaliar um classificador de texto AI/humano com
rigor estatístico. Ela vive **fora** do bundle da extensão: nenhum módulo aqui
importa de `src/`, e nada aqui é embarcado na extensão.

O objetivo é responder, com honestidade, a uma pergunta operacional: **entre os
posts que a extensão bloquearia, quantos eram de fato gerados por IA?** Essa é a
métrica principal (`precisionAmongBlocked`). "Acurácia" nunca é usada como
headline, porque um detector com muitos falsos positivos é inaceitável mesmo
que "acerte" a maioria.

## Módulos

| Arquivo      | Responsabilidade                                                      |
| ------------ | --------------------------------------------------------------------- |
| `schema.ts`  | `BenchmarkRecord` e `validateBenchmarkRecord` (licença + pseudônimo). |
| `split.ts`   | `groupTimeSplit`: split sem vazamento por autor e por tempo.          |
| `metrics.ts` | `computeBinaryMetrics` e segmentação; matriz de confusão e curvas.    |
| `report.ts`  | `buildBenchmarkReport`: relatório com métrica principal e segmentos.  |
| `cli.ts`     | Entrada `npm run benchmark`.                                          |
| `data/`      | Datasets locais. Git-ignorados (exceto `.gitkeep`).                   |

## Registro (`BenchmarkRecord`)

```ts
interface BenchmarkRecord {
  id: string;
  text: string;
  label: "human" | "ai" | "hybrid";
  authorGroup: string; // pseudônimo: [A-Za-z0-9_-], nunca PII
  createdAt: number; // timestamp para o corte temporal
  platform: string;
  language: string;
  topic: string;
  generatorModel?: string;
  transformation?: "none" | "humanized" | "translated" | "edited";
  license: string; // obrigatório: datasets precisam ser auditáveis
}
```

`validateBenchmarkRecord` rejeita registros sem licença, com `authorGroup` que
pareça PII (espaços, `@`, `.`), rótulo desconhecido, `createdAt` não finito ou
campos ausentes.

## Split sem vazamento (`groupTimeSplit`)

Dois vazamentos inflam qualquer benchmark de detecção e ambos são bloqueados:

1. **Autor**: o mesmo `authorGroup` nunca aparece em mais de uma partição, para
   o modelo não memorizar o estilo de um autor.
2. **Tempo**: todo registro de teste é estritamente mais novo que qualquer
   registro de calibração, para a calibração não "espiar" o futuro.

Grupos inteiros são atribuídos a uma única partição. Um grupo só entra em
`test`/`calibration` quando todos os seus registros caem do lado correto do
corte temporal; grupos que atravessam a fronteira caem em `train`, mantendo o
corte calibração/teste estrito.

## Métricas (`computeBinaryMetrics`)

- Matriz de confusão: TP, FP, TN, FN.
- `precisionAmongBlocked` (principal), precision, recall, F1.
- FPR, FNR.
- ROC-AUC por integração trapezoidal; PR-AUC por average precision.
- Recall a um FPR-alvo configurável (`--target-fpr`).
- Latência (p50/p95/máx) e memória quando as amostras trazem esses dados.

Segmentos sempre reportam o tamanho da amostra e cobrem: tamanho em palavras
(`50_79`, `80_99`, ...), idioma, plataforma, `generatorModel` e
`transformation`. Registros `hybrid` ficam fora da matriz binária e são
contabilizados à parte.

## CLI

```powershell
npm run benchmark -- --input benchmark/data/dataset.jsonl --output benchmark/out --split group-time
```

Flags:

- `--input <jsonl>` (obrigatório): dataset JSONL de `BenchmarkRecord`.
- `--output <dir>` (obrigatório): diretório de saída.
- `--split group-time` (obrigatório para decisões de lançamento).
- `--split random --comparison-only`: baseline de comparação; o relatório é
  marcado como **não apto** a decisões de lançamento. `--split random` sem
  `--comparison-only` é recusado.
- `--predictions <jsonl>` (opcional): linhas `{ "id", "aiScore", "latencyMs"?,
"memoryBytes"?, "modelId"?, "modelVersion"? }` com a saída do modelo para a
  partição de teste.
- `--block-threshold <n>` (padrão `0.92`), `--target-fpr <n>` (padrão `0.01`).

Sem `--predictions` (nenhum modelo real fornecido), a CLI valida o dataset,
gera o split, confirma a ausência de vazamento e escreve apenas um
`split-audit.json`. Isso é um passo de infraestrutura, não um resultado
científico: o backend ativo continua sendo o mock.

## Privacidade dos dados

Datasets nunca entram no Git: `benchmark/data/*` é ignorado, exceto `.gitkeep`.
Os grupos de autor são pseudonimizados e cada registro carrega uma licença.

## Ver também

- Como um artefato aprovado é integrado à extensão:
  [../docs/model-integration.md](../docs/model-integration.md).
- O contrato de calibração e gating que impede ação agressiva sem benchmark:
  [../docs/model-validation.md](../docs/model-validation.md).

Sem um modelo real e um dataset aprovado, nenhum número de precisão ou acurácia é
publicado, e o backend ativo da extensão permanece o mock.
