// Assembles the schema v2 benchmark report and its sealing digest.
//
// A release evaluation binds together three things that must never drift apart:
// the governance decision (the sealed dataset audit and source-readiness
// digests), the atomic holdout session (the active consume-holdout id) and the
// three scoring runs (the development/calibration/test prediction manifest
// digests). Before anything is assembled, `buildBenchmarkReport` re-checks that
// the identity recomputed at evaluate time (`observed`) is byte-identical to the
// identity frozen at fit/consume time (`frozen`) — the dataset audit, source
// readiness, active consumption id, the full model identity (including the
// tokenizer digest), the runtime-parity digest and every scoring-runtime field.
// Any divergence is a hard failure raised BEFORE metrics are consulted; there is
// no last-write-wins and no silent reconciliation.
//
// `reportDigest` seals governance, session and the three executions plus the gate
// outcomes, so changing the dataset audit, source readiness, runtime-parity
// digest, consumption id, any prediction-manifest digest or any gate flips it.
// `runtimeParityDigest` is surfaced at the top level so Phase 4 can compare it to
// the release build; the extension build digest, backend and Chrome version stay
// auditable but do not enter that cross-shell parity comparison.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// It reuses ONLY the pure canonical-json digest helper from contracts/ and the
// prediction-manifest digest recipe from the benchmark package. Deterministic
// for a fixed input (the caller supplies `generatedAt`).

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import type { GateReport, ReleaseDecision } from "./gates.ts";
import type {
  CalibrationSliceMetrics,
  DecisionFamilies,
  DecisionMetrics,
  EvaluationMetrics,
  FrozenThresholdMetrics,
  LabelBasisSlice,
  MetricEstimate,
  ResolutionBreakdown,
  ResolutionSlice,
} from "./metrics.ts";
import {
  computePredictionManifestDigest,
  type PredictionManifestV1,
} from "./prediction-schema.ts";
import type { SliceSummary } from "./slices.ts";
import type { SplitAudit } from "./split-audit.ts";

export const SPLIT_STRATEGY = "blocked-group-time-v1" as const;
export type SplitStrategy = typeof SPLIT_STRATEGY;

/** Coded, fail-closed error raised when the active identity diverges from the frozen seal. */
export class ReportGovernanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportGovernanceError";
  }
}

// The full governance/session/identity fingerprint of a release evaluation. The
// frozen copy is sealed at fit/consume time; the observed copy is recomputed at
// evaluate time. They must match literally, field by field.
export interface GovernanceSeal {
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  holdoutConsumptionId: string;
  runtimeParityDigest: string;
  model: {
    id: string;
    version: string;
    bundleDigest: string;
    tokenizerDigest: string;
    aggregationVersion: string;
    contentCompositionVersion: string;
  };
  scoringRuntime: {
    extensionBuildDigest: string;
    backend: "wasm";
    chromeVersion: "150.0.7871.129";
  };
}

export interface BenchmarkReportInput {
  generatedAt: string;
  dataset: { id: string; version: string; digest: string };
  split: { digest: string; strategy: SplitStrategy; audit: SplitAudit };
  evaluatorDigest: string;
  calibrationArtifactDigest: string;
  // Identity sealed at fit/consume time (authoritative).
  frozen: GovernanceSeal;
  // Identity recomputed at evaluate time from the active session and test run.
  observed: GovernanceSeal;
  // The three prediction manifests: development and calibration copied from the
  // freeze, test from the active consume-holdout session.
  predictionManifests: {
    development: PredictionManifestV1;
    calibration: PredictionManifestV1;
    test: PredictionManifestV1;
  };
  metrics: EvaluationMetrics;
  slices: SliceSummary;
  gates: GateReport;
}

export interface BenchmarkReport {
  schemaVersion: 2;
  generatedAt: string;
  holdoutConsumptionId: string;
  dataset: { id: string; version: string; digest: string };
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  split: { digest: string; strategy: SplitStrategy; audit: SplitAudit };
  evaluatorDigest: string;
  runtimeParityDigest: string;
  model: {
    id: string;
    version: string;
    bundleDigest: string;
    tokenizerDigest: string;
    aggregationVersion: string;
    contentCompositionVersion: string;
  };
  scoringRuntime: {
    extensionBuildDigest: string;
    backend: "wasm";
    chromeVersion: "150.0.7871.129";
  };
  predictionManifestDigests: {
    development: string;
    calibration: string;
    test: string;
  };
  calibrationArtifactDigest: string;
  metrics: EvaluationMetrics;
  slices: SliceSummary;
  gates: GateReport;
  releaseDecision: ReleaseDecision;
  reportDigest: string;
  notes: string[];
}

export async function buildBenchmarkReport(
  input: BenchmarkReportInput,
): Promise<BenchmarkReport> {
  // Governance/session/identity is verified FIRST — before any metric is read —
  // so a divergent evaluation never produces a sealed report.
  assertSealMatches(input.frozen, input.observed);

  const predictionManifestDigests = {
    development: await computePredictionManifestDigest(
      input.predictionManifests.development,
    ),
    calibration: await computePredictionManifestDigest(
      input.predictionManifests.calibration,
    ),
    test: await computePredictionManifestDigest(input.predictionManifests.test),
  };

  const seal = input.frozen;
  const releaseDecision = input.gates.decision;

  const reportDigest = await canonicalSha256({
    datasetAuditDigest: seal.datasetAuditDigest,
    sourceReadinessDigest: seal.sourceReadinessDigest,
    holdoutConsumptionId: seal.holdoutConsumptionId,
    dataset: input.dataset,
    splitDigest: input.split.digest,
    splitStrategy: input.split.strategy,
    evaluatorDigest: input.evaluatorDigest,
    runtimeParityDigest: seal.runtimeParityDigest,
    calibrationArtifactDigest: input.calibrationArtifactDigest,
    model: seal.model,
    scoringRuntime: seal.scoringRuntime,
    predictionManifestDigests,
    releaseDecision,
    gates: gateFingerprint(input.gates),
  });

  return {
    schemaVersion: 2,
    generatedAt: input.generatedAt,
    holdoutConsumptionId: seal.holdoutConsumptionId,
    dataset: input.dataset,
    datasetAuditDigest: seal.datasetAuditDigest,
    sourceReadinessDigest: seal.sourceReadinessDigest,
    split: input.split,
    evaluatorDigest: input.evaluatorDigest,
    runtimeParityDigest: seal.runtimeParityDigest,
    model: seal.model,
    scoringRuntime: seal.scoringRuntime,
    predictionManifestDigests,
    calibrationArtifactDigest: input.calibrationArtifactDigest,
    metrics: input.metrics,
    slices: input.slices,
    gates: input.gates,
    releaseDecision,
    reportDigest,
    notes: buildNotes(releaseDecision),
  };
}

// A stable, NaN-free projection of the gate report for the sealing digest: the
// decision, the failed-gate lists and each gate's identity plus its eligibility
// and pass/fail outcome. Observed statistics can be NaN and are excluded, but the
// pass/fail flag captures every gate change that matters to the seal.
function gateFingerprint(gates: GateReport): unknown {
  return {
    decision: gates.decision,
    failedIntegrity: gates.failedIntegrity,
    failedWarning: gates.failedWarning,
    failedAction: gates.failedAction,
    gates: gates.gates.map((gate) => ({
      id: gate.id,
      tier: gate.tier,
      scope: gate.scope,
      slice: gate.slice ?? null,
      eligible: gate.eligible,
      passed: gate.passed,
    })),
  };
}

function assertSealMatches(
  frozen: GovernanceSeal,
  observed: GovernanceSeal,
): void {
  const mismatches: string[] = [];
  if (observed.datasetAuditDigest !== frozen.datasetAuditDigest) {
    mismatches.push("datasetAuditDigest");
  }
  if (observed.sourceReadinessDigest !== frozen.sourceReadinessDigest) {
    mismatches.push("sourceReadinessDigest");
  }
  if (observed.holdoutConsumptionId !== frozen.holdoutConsumptionId) {
    mismatches.push("holdoutConsumptionId");
  }
  if (observed.runtimeParityDigest !== frozen.runtimeParityDigest) {
    mismatches.push("runtimeParityDigest");
  }
  const modelKeys = [
    "id",
    "version",
    "bundleDigest",
    "tokenizerDigest",
    "aggregationVersion",
    "contentCompositionVersion",
  ] as const;
  for (const key of modelKeys) {
    if (observed.model[key] !== frozen.model[key]) {
      mismatches.push(`model.${key}`);
    }
  }
  const runtimeKeys = [
    "extensionBuildDigest",
    "backend",
    "chromeVersion",
  ] as const;
  for (const key of runtimeKeys) {
    if (observed.scoringRuntime[key] !== frozen.scoringRuntime[key]) {
      mismatches.push(`scoringRuntime.${key}`);
    }
  }
  if (mismatches.length > 0) {
    throw new ReportGovernanceError(
      `evaluate identity diverges from the frozen seal: ${mismatches.join(", ")}`,
    );
  }
}

function buildNotes(decision: ReleaseDecision): string[] {
  const notes: string[] = [];
  notes.push(`Decisão de release: ${decision}.`);
  notes.push(
    "Precisão observada e precisões simuladas por prevalência são grandezas distintas; " +
      "a precisão observada reflete a prevalência artificial do benchmark, não a de produção.",
  );
  notes.push('"Acurácia" nunca é métrica principal.');
  notes.push(
    "Cada ponto de operação sai em duas famílias: fim-a-fim (denominador = todo o " +
      "conjunto elegível, um registro sem decisão conta como não-detecção) e " +
      'condicional a status = "scored". Um erro de inferência nunca recebe escore ' +
      "nem entra como verdadeiro negativo; ele aparece nas células sem decisão e " +
      "nas tabelas de cobertura e erro por fonte, classe, faixa e plataforma.",
  );
  notes.push(
    "A família condicional é sensível a falha seletiva: se justamente os documentos " +
      "que pontuariam mal falharem na inferência, ela melhora sem que nada tenha " +
      "melhorado. É por isso que toda métrica condicional aqui vem acompanhada da " +
      "taxa de erro da mesma população, e que a comparação entre as duas famílias — " +
      "não a leitura de uma delas — é o que revela o efeito.",
  );
  notes.push(
    "Papéis: recall e FPR no limiar congelado, fim-a-fim, são a métrica de release. " +
      "AUROC, PR-AUC e TPR@1%FPR são diagnóstico de separabilidade e não decidem " +
      "release em nenhuma direção.",
  );
  notes.push(
    "Intervalos individuais de 95% são descritivos. Os gates leem os limites " +
      "unilaterais simultâneos por Bonferroni em alpha_família / m.",
  );
  return notes;
}

// Markdown report. It leads with the decision and its reasons, then the gates,
// the overall operating points, the macro average, the worst slice and finally
// every slice. Accuracy is never a headline; observed precision and the
// prevalence-simulated projections are labelled distinctly.
export function renderReportMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Decisão de release: ${report.releaseDecision}`);
  lines.push("");
  lines.push(`- Sessão de holdout: \`${report.holdoutConsumptionId}\``);
  lines.push(`- Digest do relatório: \`${report.reportDigest}\``);
  lines.push(
    `- Digest de paridade de runtime: \`${report.runtimeParityDigest}\``,
  );
  lines.push("");

  lines.push("## Razões dos gates");
  lines.push("");
  const failed = report.gates.gates.filter((gate) => !gate.passed);
  if (failed.length === 0) {
    lines.push("Todos os gates obrigatórios passaram.");
  } else {
    for (const gate of failed) {
      const scope =
        gate.slice === undefined
          ? "overall"
          : `${gate.slice.axis}/${gate.slice.key}`;
      const reason = gate.reasons[0] ?? "gate reprovado";
      lines.push(`- [${gate.tier}] ${gate.id} (${scope}): ${reason}`);
    }
  }
  lines.push("");

  lines.push("## Gates");
  lines.push("");
  lines.push(
    "A coluna **limite** é o bound que decidiu o gate; a coluna **95% (descritivo)** " +
      "é o intervalo individual, publicado e nunca usado como veredito.",
  );
  lines.push("");
  lines.push(
    "| Gate | Tier | Escopo | Limite | Observado | 95% (descritivo) | Evidência | Elegível | Resultado |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const gate of report.gates.gates) {
    const scope =
      gate.slice === undefined
        ? gate.scope
        : `${gate.slice.axis}/${gate.slice.key}`;
    lines.push(
      `| ${gate.id} | ${gate.tier} | ${scope} | ${gate.bound} | ${fmt(gate.observed)} | ` +
        `${fmt(gate.descriptive?.value)} | ${gate.evidence} | ` +
        `${gate.eligible ? "sim" : "não"} | ${gate.passed ? "passou" : "reprovou"} |`,
    );
  }
  lines.push("");

  lines.push("## Multiplicidade");
  lines.push("");
  const multiplicity = report.gates.multiplicity;
  if (multiplicity === undefined) {
    lines.push("_Sem declaração de multiplicidade._");
  } else {
    lines.push(
      `- Correção: ${multiplicity.correction} (congelada em ${multiplicity.frozenAt})`,
    );
    lines.push(`- alpha_família: ${multiplicity.familyAlpha}`);
    lines.push(
      `- m pré-registrado: ${multiplicity.declared ?? "não declarado"} · ` +
        `gates estatísticos obrigatórios neste relatório: ${multiplicity.observed} · ` +
        `cobre: ${multiplicity.covers ? "sim" : "não"}`,
    );
    lines.push(
      `- alpha por gate: ${multiplicity.perGateAlpha ?? "n/a"} · ` +
        `intervalos de ${multiplicity.descriptiveConfidence} são descritivos`,
    );
    lines.push(
      "- Uma célula sem poder permanece em m e reprova; o divisor nunca encolhe.",
    );
  }
  lines.push("");

  const release = report.metrics.release;
  lines.push("## Métrica de release (limiar congelado)");
  lines.push("");
  if (release === undefined) {
    lines.push("_Sem bloco de release._");
  } else {
    lines.push(
      "Recall e FPR **no limiar congelado**, família fim-a-fim: esta é a métrica " +
        "de release. Cada número condicional vem com a taxa de erro da mesma " +
        "população ao lado, porque a família condicional é sensível a falha " +
        "seletiva.",
    );
    lines.push("");
    lines.push(frozenThresholdTable("Aviso", release.warning));
    lines.push("");
    if (release.visualAction !== null && release.visualAction !== undefined) {
      lines.push(frozenThresholdTable("Ação visual", release.visualAction));
      lines.push("");
    }
  }

  lines.push("## Overall");
  lines.push("");
  lines.push(
    "As duas famílias de métrica saem sempre em par: **fim-a-fim** tem como " +
      "denominador todo o conjunto elegível e conta um registro sem decisão como " +
      'não-detecção; **condicional** só considera `status = "scored"`. Nenhuma ' +
      "das duas é *a* métrica.",
  );
  lines.push("");
  lines.push(decisionFamilyTable("Aviso", report.metrics.warning));
  lines.push("");
  const visualAction = report.metrics.visualAction;
  if (visualAction !== null && visualAction !== undefined) {
    lines.push(decisionFamilyTable("Ação visual", visualAction));
    lines.push("");
  }
  lines.push(`- Cobertura: ${fmt(report.metrics.coverage?.value)}`);
  lines.push(`- Abstenção: ${fmt(report.metrics.abstentionRate?.value)}`);
  lines.push(`- Erro de inferência: ${fmt(report.metrics.errorRate?.value)}`);
  lines.push(
    `- Precisão simulada (prev. 1%/5%/10%): ${fmt(report.metrics.simulatedPrecision?.prevalence01)} / ` +
      `${fmt(report.metrics.simulatedPrecision?.prevalence05)} / ${fmt(report.metrics.simulatedPrecision?.prevalence10)}`,
  );
  lines.push("");

  const separability = report.metrics.separability;
  lines.push("## Diagnóstico de separabilidade (não decide release)");
  lines.push("");
  if (separability === undefined) {
    lines.push("_Sem bloco de separabilidade._");
  } else {
    lines.push(
      "Qualidade de ordenação, medida sobre as linhas escoradas. É exatamente a " +
        "família de números que descola do comportamento em orçamento baixo de FPR, " +
        "então ela nunca decide release — nem a favor, nem contra.",
    );
    lines.push("");
    lines.push(
      `- AUROC: ${fmt(separability.auroc?.value)} ` +
        `(IC95 descritivo ${fmt(separability.auroc?.lower95)}–${fmt(separability.auroc?.upper95)})`,
    );
    lines.push(`- PR-AUC: ${fmt(separability.prAuc?.value)}`);
    lines.push(
      `- TPR@1%FPR: ${fmt(separability.tprAtOnePercentFpr?.tpr)} ` +
        `(FPR atingido ${fmt(separability.tprAtOnePercentFpr?.achievedFpr)}, ` +
        `limiar ${fmt(separability.tprAtOnePercentFpr?.threshold)}, ` +
        `n=${separability.tprAtOnePercentFpr?.sampleSize})`,
    );
    lines.push(
      `- Taxa de erro da mesma população: ${fmt(separability.errorRate?.value)}`,
    );
    lines.push("");
  }

  const calibration = report.metrics.calibration;
  lines.push("## Calibração");
  lines.push("");
  if (calibration === undefined) {
    lines.push("_Sem bloco de calibração._");
  } else {
    lines.push(
      `- ECE equal-mass (${calibration.bins} bins, **estatística do gate**): ` +
        `${fmt(calibration.eceEqualMass15?.value)} ` +
        `(IC95 descritivo ${fmt(calibration.eceEqualMass15?.lower95)}–${fmt(calibration.eceEqualMass15?.upper95)}; ` +
        `limite simultâneo ${fmt(calibration.eceEqualMass15?.simultaneous?.upper)})`,
    );
    lines.push(
      `- ECE equal-width de 15 bins (diagnóstico): ${fmt(report.metrics.ece15?.value)}`,
    );
    lines.push(`- Brier: ${fmt(calibration.brier?.value)}`);
    lines.push(`- log-loss: ${fmt(calibration.logLoss)}`);
    lines.push(
      `- Reta de calibração: intercept ${fmt(calibration.intercept)} · ` +
        `slope ${fmt(calibration.slope)}`,
    );
    lines.push(
      `- Taxa de erro da mesma população: ${fmt(calibration.errorRate?.value)}`,
    );
    lines.push("");
    const reliability = calibration.reliability ?? [];
    if (reliability.length > 0) {
      lines.push("### Diagrama de confiabilidade (equal-mass)");
      lines.push("");
      lines.push("| Bin | n | p média | Taxa observada | Faixa de escore |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const bin of reliability) {
        lines.push(
          `| ${bin.index} | ${bin.count} | ${fmt(bin.meanProbability)} | ${fmt(bin.positiveRate)} | ` +
            `${fmt(bin.lowestProbability)}–${fmt(bin.highestProbability)} |`,
        );
      }
      lines.push("");
    }
    for (const [title, rows] of [
      ["Por faixa de comprimento", calibration.byLengthBucket ?? []],
      ["Por fonte", calibration.bySource ?? []],
      ["Por estrato linguístico", calibration.byLinguisticStratum ?? []],
    ] as ReadonlyArray<readonly [string, readonly CalibrationSliceMetrics[]]>) {
      lines.push(`### ${title}`);
      lines.push("");
      if (rows.length === 0) {
        lines.push("_Sem linhas escoradas._");
      } else {
        lines.push(
          "| Chave | n escorado | Unidades amostrais | Brier | log-loss | ECE equal-mass | Taxa de erro |",
        );
        lines.push("| --- | --- | --- | --- | --- | --- | --- |");
        for (const row of rows) {
          lines.push(
            `| ${row.key} | ${row.count} | ${row.samplingUnits} | ${fmt(row.brier)} | ` +
              `${fmt(row.logLoss)} | ${fmt(row.eceEqualMass)} | ${fmt(row.errorRate?.value)} |`,
          );
        }
      }
      lines.push("");
    }
  }

  const labelBasis = report.metrics.labelBasis;
  lines.push("## Bases de rótulo humano");
  lines.push("");
  if (labelBasis === undefined) {
    lines.push("_Sem bloco de base de rótulo._");
  } else {
    lines.push(
      "Contagem, número de unidades amostrais e intervalo de cada base, sempre " +
        "separados: agregar as bases esconderia de qual evidência vem o número. " +
        "Uma base abaixo do poder pré-registrado é diagnóstico suplementar — " +
        "**não aprova gate, não eleva teto de ação e não sustenta alegação mais " +
        "forte para o agregado**.",
    );
    lines.push("");
    lines.push(
      `- Campo \`labelBasis\` presente nos registros: ${labelBasis.fieldPresent ? "sim" : "não"} · ` +
        `alegação agregada permitida: ${labelBasis.pooledClaimAllowed ? "sim" : "não"}`,
    );
    lines.push("");
    const bases: readonly LabelBasisSlice[] = labelBasis.bases ?? [];
    if (bases.length === 0) {
      lines.push("_Sem negativos humanos elegíveis._");
    } else {
      lines.push(
        "| Base | Negativos | Escorados | Erros | Unidades amostrais | Eixo | FPR | FPR UCB95 | Taxa de erro | Poder | Papel |",
      );
      lines.push(
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const row of bases) {
        lines.push(
          `| ${row.basis} | ${row.count} | ${row.scored} | ${row.errored} | ${row.samplingUnits} | ` +
            `${row.samplingUnitAxis} | ${fmt(row.falsePositiveRate?.value)} | ` +
            `${fmt(row.falsePositiveRate?.upper95)} | ${fmt(row.errorRate?.value)} | ` +
            `${row.powered ? `>= ${row.powerFloor}` : `< ${row.powerFloor}`} | ${row.evidenceRole} |`,
        );
      }
    }
    lines.push("");
  }

  const predictiveValue = report.metrics.predictiveValue;
  lines.push("## PPV e NPV por prevalência");
  lines.push("");
  if (predictiveValue === undefined) {
    lines.push("_Sem projeção de valor preditivo._");
  } else {
    lines.push(
      `A prevalência do benchmark é ${fmt(predictiveValue.benchmarkPrevalence)} — ` +
        "perto de 50/50 — e um feed real é majoritariamente humano. Logo o escore " +
        "calibrado sob este prior **não** é probabilidade posterior de autoria: as " +
        "linhas abaixo projetam PPV e NPV em prevalências plausíveis, a partir do " +
        "ponto de operação fim-a-fim.",
    );
    lines.push("");
    lines.push("| Prevalência | PPV | NPV |");
    lines.push("| --- | --- | --- |");
    for (const row of predictiveValue.byPrevalence ?? []) {
      lines.push(`| ${fmt(row.prevalence)} | ${fmt(row.ppv)} | ${fmt(row.npv)} |`);
    }
    lines.push("");
  }

  lines.push("## Cobertura e erro por fatia");
  lines.push("");
  for (const [title, rows] of resolutionSections(report.metrics.resolution)) {
    lines.push(`### ${title}`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("_Sem registros elegíveis._");
    } else {
      lines.push(
        "| Chave | Elegíveis | Escorados | Abstenções | Erros | Cobertura | Taxa de erro |",
      );
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const row of rows) {
        lines.push(
          `| ${row.key} | ${row.eligible} | ${row.scored} | ${row.abstained} | ${row.errored} | ` +
            `${fmt(row.coverage?.value)} | ${fmt(row.errorRate?.value)} |`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Macro");
  lines.push("");
  lines.push(
    `- Aviso FPR (macro, fim-a-fim): ${fmt(report.slices.macro.warningFpr)}`,
  );
  lines.push(
    `- Aviso recall (macro, fim-a-fim): ${fmt(report.slices.macro.warningRecall)}`,
  );
  lines.push("");

  lines.push("## Pior slice");
  lines.push("");
  const worstWarningFpr = report.slices.worst.warningFpr;
  lines.push(
    worstWarningFpr === undefined
      ? "- Aviso FPR: sem slice elegível."
      : `- Aviso FPR (fim-a-fim, UCB95): ${worstWarningFpr.axis}/${worstWarningFpr.key} = ` +
          fmt(
            worstWarningFpr.metrics.warning?.endToEnd?.falsePositiveRate
              ?.upper95,
          ),
  );
  lines.push("");

  lines.push("## Slices");
  lines.push("");
  if (report.slices.slices.length === 0) {
    lines.push("_Sem slices._");
  } else {
    lines.push("| Eixo | Chave | Amostra | Elegível FPR | Elegível recall |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const slice of report.slices.slices) {
      lines.push(
        `| ${slice.axis} | ${slice.key} | ${slice.sampleSize} | ${slice.fprGateEligible ? "sim" : "não"} | ${slice.recallGateEligible ? "sim" : "não"} |`,
      );
    }
  }
  lines.push("");

  if (report.notes.length > 0) {
    lines.push("## Notas");
    lines.push("");
    for (const note of report.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// One decision, both families, side by side. Publishing them in a single table
// is the point: there is no row a reader can mistake for "the" FPR, and the
// difference between the columns IS the cost of the failed inferences.
function decisionFamilyTable(
  subject: string,
  families: DecisionFamilies,
): string {
  const rows: ReadonlyArray<
    readonly [string, (metrics: DecisionMetrics) => string]
  > = [
    ["Positivos (denominador)", (m) => String(m?.positives)],
    ["Negativos (denominador)", (m) => String(m?.negatives)],
    ["Sem decisão (positivos)", (m) => String(m?.undecidedPositives)],
    ["Sem decisão (negativos)", (m) => String(m?.undecidedNegatives)],
    ["FPR entre decididos (UCB95)", (m) => fmt(m?.falsePositiveRate?.upper95)],
    ["Taxa de liberação correta", (m) => fmt(m?.clearanceRate?.value)],
    ["Recall (LCB95)", (m) => fmt(m?.recall?.lower95)],
    ["Recall (ponto)", (m) => fmt(m?.recall?.value)],
  ];
  const lines: string[] = [];
  lines.push(`### ${subject}`);
  lines.push("");
  lines.push("| Grandeza | fim-a-fim | condicional a status=scored |");
  lines.push("| --- | --- | --- |");
  for (const [label, read] of rows) {
    lines.push(
      `| ${label} | ${read(families?.endToEnd)} | ${read(families?.conditionalOnScored)} |`,
    );
  }
  return lines.join("\n");
}

// One decision at its frozen threshold. The release row is the end-to-end one;
// the conditional row sits underneath it WITH the error rate of the same
// population, because that comparison is what exposes selective failure.
function frozenThresholdTable(
  subject: string,
  metrics: FrozenThresholdMetrics,
): string {
  const lines: string[] = [];
  lines.push(`### ${subject}`);
  lines.push("");
  lines.push(
    "| Papel | Família | Recall | Recall (LCB95 descritivo) | FPR | FPR (UCB95 descritivo) | FPR (limite simultâneo) | Taxa de erro |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  const row = (
    role: string,
    family: string,
    recall: MetricEstimate | undefined,
    fpr: MetricEstimate | undefined,
    errorRate: MetricEstimate | undefined,
  ): string =>
    `| ${role} | ${family} | ${fmt(recall?.value)} | ${fmt(recall?.lower95)} | ` +
    `${fmt(fpr?.value)} | ${fmt(fpr?.upper95)} | ${fmt(fpr?.simultaneous?.upper)} | ` +
    `${fmt(errorRate?.value)} |`;
  lines.push(
    row(
      "release",
      "fim-a-fim",
      metrics.recall,
      metrics.falsePositiveRate,
      metrics.errorRate,
    ),
  );
  lines.push(
    row(
      "diagnóstico (sensível a falha seletiva)",
      "condicional a status=scored",
      metrics.conditional?.recall,
      metrics.conditional?.falsePositiveRate,
      metrics.conditional?.errorRate,
    ),
  );
  return lines.join("\n");
}

function resolutionSections(
  resolution: ResolutionBreakdown | undefined,
): ReadonlyArray<readonly [string, readonly ResolutionSlice[]]> {
  return [
    ["Por fonte", resolution?.bySource ?? []],
    ["Por classe", resolution?.byClass ?? []],
    ["Por faixa de comprimento", resolution?.byLengthBucket ?? []],
    ["Por plataforma", resolution?.byPlatform ?? []],
  ];
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}
