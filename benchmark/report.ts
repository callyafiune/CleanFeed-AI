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
import type {
  PublishedBoundProvenance,
  PublishedBoundSource,
  PublishedSimultaneousProvenance,
  ResamplingPlan,
  ResamplingUnitDeclaration,
} from "./bootstrap.ts";
import {
  assertGeneratorFamiliesEqual,
  type GeneratorFamily,
} from "./generator-family.ts";
import type { GateReport, ReleaseDecision } from "./gates.ts";
import { boundProvenanceOf } from "./metrics.ts";
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
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import type { SliceSummary } from "./slices.ts";
import type { SplitAudit } from "./split-audit.ts";

export const SPLIT_STRATEGY = "blocked-group-time-v1" as const;
export type SplitStrategy = typeof SPLIT_STRATEGY;

// The two FPR upper bounds the frozen-threshold table publishes per row. They
// live here, once, because the release section's prose points an auditor at ONE
// of them by name: `SIMULTANEOUS_FPR_COLUMN` is the cell a release gate reads
// (`evaluateReleaseGates` requires `estimate.simultaneous` and fails with
// `missing-simultaneous-interval` rather than falling back), while
// `DESCRIPTIVE_FPR_COLUMN` is the individual 95% interval, uncorrected over the
// gate family, which certifies nothing. Hand-copying either label into the
// paragraph let a rename of the header desynchronize the two silently: the
// published `benchmark-report.md` would then point at a column that does not
// exist, leaving the descriptive bound as the only recognizable one — the exact
// misreading R7 forbids. One constant per label makes that impossible.
const SIMULTANEOUS_FPR_COLUMN = "FPR (limite simultâneo)";
const DESCRIPTIVE_FPR_COLUMN = "FPR (UCB95 descritivo)";

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
  split: {
    digest: string;
    strategy: SplitStrategy;
    // The DECLARED reserved families, copied from the sealed split artifact. The
    // report is the fourth place they have to agree (see
    // benchmark/generator-family.ts): buildBenchmarkReport refuses to assemble a
    // report whose published list diverges from the audit's derived one.
    heldOutGeneratorFamilies: readonly GeneratorFamily[];
    audit: SplitAudit;
  };
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
  split: {
    digest: string;
    strategy: SplitStrategy;
    heldOutGeneratorFamilies: readonly GeneratorFamily[];
    audit: SplitAudit;
  };
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

  // The report is the fourth place the reserved generator families must agree, and
  // the only one a reader sees. Divergence between the list this report publishes
  // and the list the independent audit derived off the partitions is a hard
  // failure here, before any metric is consulted: an `unseen` generator slice
  // computed over a different set than the one printed beside it is not a
  // measurement, it is a mislabel.
  assertGeneratorFamiliesEqual(
    "published",
    input.split.heldOutGeneratorFamilies,
    "derived",
    input.split.audit.heldOutGeneratorFamilies,
  );

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

  // The reserved families are PUBLISHED, not implied: the `generatorExposure`
  // slice below reports an `unseen` bucket, and a reader cannot check what
  // "unseen" means without seeing the set. buildBenchmarkReport already refused to
  // assemble this report if the list disagreed with the audit's derived one, so
  // the two lines below are guaranteed to name the same set.
  lines.push("## Famílias geradoras retidas (não vistas no treino)");
  lines.push("");
  const heldOut = report.split.heldOutGeneratorFamilies;
  if (heldOut.length === 0) {
    lines.push(
      "Nenhuma família geradora foi reservada: a fatia `generatorExposure` não " +
        "tem bucket `unseen` e nada aqui mede gerador não visto.",
    );
  } else {
    lines.push(`- Declaradas e publicadas: \`${heldOut.join("`, `")}\``);
    lines.push(
      `- Reserva honrada pelas partições (auditoria do split): \`${report.split.audit.heldOutGeneratorFamilies.join("`, `")}\``,
    );
  }
  // The incidental concentrations, printed as DIAGNOSIS and separated from the
  // reservation above. A family whose every record-line landed in the blind block
  // without anyone reserving it is not a reserve — it sustains no unseen-generator
  // claim, it gates nothing, and it is not one of the hypotheses the family-wise
  // correction counts. It is printed because it spends blind-block capacity, and
  // because reading it as a reservation is exactly the inference A4-fix removed.
  const incidental = report.split.audit.incidentalTestOnlyGeneratorFamilies;
  if (incidental.length > 0) {
    lines.push(
      `- Concentradas no bloco cego sem reserva declarada (diagnóstico, não ` +
        `reserva e não gate): \`${incidental.join("`, `")}\``,
    );
  }
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
    "| Gate | Tier | Escopo | Limite | Observado | 95% (descritivo) | n (denominador) | Evidência | Elegível | Resultado |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const gate of report.gates.gates) {
    const scope =
      gate.slice === undefined
        ? gate.scope
        : `${gate.slice.axis}/${gate.slice.key}`;
    // The denominator of the statistic, and the population it came out of when
    // they differ: an n larger than the denominator overstates the verdict.
    const denominator =
      gate.populationSize === undefined
        ? String(gate.sampleSize)
        : `${gate.sampleSize} de ${gate.populationSize}`;
    lines.push(
      `| ${gate.id} | ${gate.tier} | ${scope} | ${gate.bound} | ${fmt(gate.observed)} | ` +
        `${fmt(gate.descriptive?.value)} | ${denominator} | ${gate.evidence} | ` +
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
    // The effort behind the resampled bound, at the alpha it is read at. Without
    // it a reader cannot tell that a simultaneous percentile bound at
    // alpha_família/m is an interpolation between a couple of order statistics.
    const resampled = report.metrics.calibration?.eceEqualMass15?.simultaneous;
    lines.push(
      resampled === undefined || resampled.replicates === undefined
        ? "- Esforço de reamostragem do limite simultâneo: não publicado " +
            "(nenhum limite de percentil foi produzido)."
        : `- Esforço de reamostragem do limite simultâneo (ECE): ${resampled.replicates} ` +
            `réplicas em alpha=${resampled.alpha}, cauda de ` +
            `${resampled.tailReplicates ?? 0} réplicas.`,
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
    // Where the certified bound comes from, said in the section a reader reaches
    // holding the frozen artifact. The fit's own bound is nominal on the data
    // that selected the threshold and certifies nothing (R7, assessment §4.8).
    // The table below publishes TWO upper bounds per row and only one of them is
    // read by a gate, so the sentence names the cell instead of saying "esta
    // tabela": a paragraph written to kill an overclaim must not leave the
    // reader to pick a column.
    lines.push(
      `O limite de FPR **certificado** é a célula \`${SIMULTANEOUS_FPR_COLUMN}\` da ` +
        "tabela abaixo: medida uma única vez no **teste cego**, no limiar já " +
        "congelado, com correção de multiplicidade de Bonferroni " +
        "(`alpha_família/m`). É essa coluna — e nenhuma outra — que o gate de " +
        "release lê; sem ela o gate reprova por `missing-simultaneous-interval` " +
        `em vez de cair no limite individual. A coluna \`${DESCRIPTIVE_FPR_COLUMN}\` ` +
        "é o intervalo individual de 95%, sem correção sobre a família de gates: " +
        "é **descritiva** e **não certifica** nada. O número gravado no artefato " +
        "de calibração sob `selectionFprUpper95Nominal` é o limite de Wilson " +
        "*nominal* do par vencedor, calculado nos mesmos registros que o " +
        "escolheram — é diagnóstico e **não certifica** nada. No artefato, " +
        "`certifiedFprUpper` permanece nulo **por construção**: o " +
        "`frozen-calibration.json` é selado por `artifactDigest` e imutável, " +
        "então a cota certificada nunca é escrita lá — ela vive aqui, nesta " +
        "seção, e no bundle de evidência.",
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
  lines.push(
    decisionFamilyTable(
      "Aviso",
      report.metrics.warning,
      report.metrics.decisionPopulationErrorRate,
    ),
  );
  lines.push("");
  const visualAction = report.metrics.visualAction;
  if (visualAction !== null && visualAction !== undefined) {
    lines.push(
      decisionFamilyTable(
        "Ação visual",
        visualAction,
        report.metrics.decisionPopulationErrorRate,
      ),
    );
    lines.push("");
  }
  lines.push(`- Cobertura: ${fmt(report.metrics.coverage?.value)}`);
  lines.push(`- Abstenção: ${fmt(report.metrics.abstentionRate?.value)}`);
  // Three denominators, three lines, each named. The whole eligible set is the
  // integrity gate's denominator; the two narrower populations are the companions
  // of the blocks measured over them. Printing one rate for all three is what made
  // the heading "mesma população" false whenever the corpus holds a mixed<50% row.
  lines.push(
    `- Erro de inferência (todo o conjunto elegível): ${fmt(report.metrics.errorRate?.value)}`,
  );
  lines.push(
    "- Erro de inferência (população das duas famílias de decisão): " +
      fmt(report.metrics.decisionPopulationErrorRate?.value),
  );
  lines.push(
    "- Erro de inferência (população binária, denominador das curvas): " +
      fmt(report.metrics.binaryPopulationErrorRate?.value),
  );
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
      `- Taxa de erro da mesma população (${separability.errorRatePopulation}): ` +
        fmt(separability.errorRate?.value),
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
      `- Denominadores: ${calibration.scored} linhas escoradas de uma população ` +
        `de ${calibration.populationSize} (${calibration.population})`,
    );
    lines.push(
      `- Taxa de erro da mesma população (${calibration.errorRatePopulation}): ` +
        fmt(calibration.errorRate?.value),
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
          "| Chave | n escorado | n da população | Unidades amostrais | Unidade de reamostragem | Brier | log-loss | ECE equal-mass | Taxa de erro |",
        );
        lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
        for (const row of rows) {
          lines.push(
            `| ${row.key} | ${row.count} | ${row.populationSize} | ` +
              `${resamplingUnitCount(row.resamplingUnit)} | ` +
              `${resamplingUnitLabel(row.resamplingUnit)} | ` +
              `${fmt(row.brier)} | ${fmt(row.logLoss)} | ${fmt(row.eceEqualMass)} | ` +
              `${fmt(row.errorRate?.value)} |`,
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
      // The provenance of each basis's published bound belongs HERE and not only in
      // the resampling section: the plan carries ONE entry for all the bases, so
      // averaging their provenance into it would invent a fact, and the entry points
      // at this column instead.
      lines.push(
        "| Base | Negativos | Escorados | Erros | Unidades amostrais | Eixo | FPR | FPR UCB95 | Procedência do limite | Taxa de erro | Poder | Papel |",
      );
      lines.push(
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const row of bases) {
        lines.push(
          `| ${row.basis} | ${row.count} | ${row.scored} | ${row.errored} | ` +
            `${resamplingUnitCount(row.resamplingUnit)} | ` +
            `${resamplingUnitLabel(row.resamplingUnit)} | ${fmt(row.falsePositiveRate?.value)} | ` +
            `${fmt(row.falsePositiveRate?.upper95)} | ` +
            `${estimateBoundLabel(row.falsePositiveRate)} | ${fmt(row.errorRate?.value)} | ` +
            `${row.powered ? `>= ${row.powerFloor}` : `< ${row.powerFloor}`} | ${row.evidenceRole} |`,
        );
      }
    }
    lines.push("");
  }

  lines.push(...resamplingSection(report.metrics.resampling));

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
      lines.push(
        `| ${fmt(row.prevalence)} | ${fmt(row.ppv)} | ${fmt(row.npv)} |`,
      );
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
  errorRate: MetricEstimate | undefined,
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
    // Never a conditional column without the error rate of the same population in
    // the same table: the two families differ by exactly the rows this rate counts.
    // "Mesma população" is literal — the caller hands in the rate over the eligible
    // positives and human negatives, which is what both columns count, and NOT the
    // rate over the whole eligible set.
    [
      "Taxa de erro (mesma população: elegíveis positivos/negativos)",
      () => fmt(errorRate?.value),
    ],
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
  // Both bound columns come from the shared constants, so the release section's
  // prose and this header can never name different cells.
  lines.push(
    "| Papel | Família | Recall | Recall (LCB95 descritivo) | FPR | " +
      `${DESCRIPTIVE_FPR_COLUMN} | ${SIMULTANEOUS_FPR_COLUMN} | Taxa de erro |`,
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

// --- resampling units (C4) -------------------------------------------------
//
// Every published estimand names its unit HERE, in the report, and not only in
// the code. THREE things travel with the name because a reader cannot recover them
// from it: whether the design ran at all; which estimator supplied the limit that
// got published, which is a separate question because the frozen
// `resampling.publishedBound` rule can publish the analytic limit over a design
// that ran; and whether any level of the unit degenerated to one level per
// record-line — the state in which a "clustered" interval is an i.i.d. one.

/** The estimator behind one published limit, in the reader's words. */
function boundEstimatorName(from: "analytic" | "resampled"): string {
  return from === "analytic" ? "Wilson" : "reamostrado";
}

function boundSides(source: PublishedBoundSource): string {
  return `inf ${boundEstimatorName(source.lowerFrom)} / sup ${boundEstimatorName(
    source.upperFrom,
  )}`;
}

// The three states of the simultaneous slot, each in its own words. "One estimator"
// and "no simultaneous limit" are different facts, and the second is the DEFAULT of
// the sealed pipeline: without a pre-registered gate count there is no Bonferroni
// family, so nothing is published at any family alpha. Printing "um estimador só"
// there would name an estimator and send the reader to a field that is absent.
function simultaneousBoundLabel(
  provenance: PublishedSimultaneousProvenance,
): string {
  switch (provenance.kind) {
    case "both-estimators":
      return `simultâneo: ${boundSides(provenance)}`;
    case "single-estimator":
      return `simultâneo: um estimador só (${provenance.method})`;
    case "none":
      return "sem limite simultâneo publicado";
  }
}

// Which estimator's limits were published, never derived from whether the design
// ran: on a zero-count rate the design runs and Wilson's limit is the published one.
function publishedBoundLabel(
  provenance: PublishedBoundProvenance | null | undefined,
): string {
  if (provenance === null || provenance === undefined) return "não declarada";
  switch (provenance.kind) {
    case "envelope":
      return (
        `envelope \`${provenance.rule}\` · 95%: ${boundSides(provenance.individual)} · ` +
        simultaneousBoundLabel(provenance.simultaneous)
      );
    case "resampled-only":
      return "percentil reamostrado (nenhum limite analítico concorre pelo lugar)";
    case "analytic-only":
      return "Wilson analítico";
    case "no-published-bound":
      return "nenhum limite publicado";
    case "per-interval":
      return `por intervalo — ${provenance.where}`;
  }
}

// The same fact read off one estimate, for the tables that print the number itself.
// The derivation is NOT repeated here: `boundProvenanceOf` owns the rule that maps an
// estimate to its provenance, and a second copy of it would classify a new method
// name differently from the plan's copy without anything failing.
function estimateBoundLabel(
  estimate: MetricEstimate | null | undefined,
): string {
  // An absent metric is a missing cell, not a metric that published no limit: the
  // row has no number to carry a provenance for.
  if (estimate === null || estimate === undefined) return "—";
  return publishedBoundLabel(boundProvenanceOf(estimate));
}

function resamplingUnitCount(
  unit: ResamplingUnitDeclaration | null | undefined,
): string {
  return unit === null || unit === undefined ? "n/a" : String(unit.units);
}

function resamplingUnitLabel(
  unit: ResamplingUnitDeclaration | null | undefined,
): string {
  if (unit === null || unit === undefined) return "não resolvida";
  const separator = unit.method === "hierarchical" ? " ⊃ " : " × ";
  const axes = unit.axes.join(separator);
  const demoted = unit.demotions
    .map((demotion) => `${demotion.from}→${demotion.to} (${demotion.items})`)
    .join("; ");
  const suffix = demoted === "" ? "" : ` · rebaixamento: ${demoted}`;
  const degenerate = unit.degenerate ? " · **degenerada**" : "";
  return `${unit.method}: ${axes}${suffix}${degenerate}`;
}

// The rows the plan STRETCHES, printed inside the coverage paragraph rather than
// beside the table: a reader who takes "o plano cobre estes estimandos" literally
// would otherwise count a stretched row as a row that names the estimand. Read from
// the frozen contract, so the list cannot drift from the file that decides it.
function resamplingExtensionLines(): string[] {
  const extensions = Object.entries(
    REBUILD_V3_POLICY.resampling.estimandExtensions,
  );
  if (extensions.length === 0) return [];
  // The COUNT comes from the list, never from prose: the contract owns how many
  // estimands are stretched, and a sentence carrying its own number would publish a
  // false count the first time the file changes.
  const count = extensions.length;
  const lines = [
    `**${count} cobertura${count === 1 ? " é" : "s são"} extensão declarada, não ` +
      "linha própria.** A linha da tabela congelada não nomeia estes estimandos; " +
      "eles herdam a unidade dela e isso está dito aqui em vez de ficar implícito " +
      "no mapeamento:",
    "",
  ];
  for (const [estimand, extension] of extensions) {
    lines.push(
      `- \`${estimand}\` herda a linha "${extension.standsInFor}" — ${extension.reason}`,
    );
  }
  lines.push("");
  return lines;
}

function resamplingSection(plan: ResamplingPlan | undefined): string[] {
  const lines = ["## Unidades de reamostragem", ""];
  if (plan === undefined) {
    lines.push(
      "_Sem plano de reamostragem._ Sem ele nenhum gate de intervalo decide: " +
        "o contrato congelado põe `resampling.fallbackToIndependentRows` em " +
        "`false`, logo a ausência do plano reprova por evidência ausente e nunca " +
        "cai para linhas independentes.",
    );
    lines.push("");
    return lines;
  }
  lines.push(
    `Plano \`${plan.planId}\`, lido de \`${plan.source}\`. Não existe uma única ` +
      '"unidade real": a unidade depende do estimando, e cada linha abaixo diz ' +
      "qual é a dela e quantos níveis cada fator tinha na população medida. " +
      "Uma unidade **degenerada** tem uma unidade por registro-linha: reamostrá-la " +
      "é reamostrar linhas, e o número está aqui em vez de escondido.",
  );
  lines.push("");
  // The distinction the previous round asserted in prose while printing only the
  // first half of it. Spelled out because the two columns are easy to conflate and
  // conflating them is exactly the R7 error: reading the design's existence as the
  // provenance of the number.
  lines.push(
    "**Desenho executado e limite publicado são fatos diferentes.** " +
      "`executed` diz apenas que o desenho rodou; a regra congelada " +
      "`resampling.publishedBound` publica então o **mais largo** entre o limite " +
      "reamostrado e o de Wilson, e numa taxa de contagem zero o reamostrado é 0 — " +
      "logo o número que o gate decide é o de Wilson **sob um desenho que rodou**. " +
      "A coluna *Limite publicado* diz de qual estimador saiu cada limite, para o " +
      "par individual de 95% e para o simultâneo, que é o único que gate lê (R7).",
  );
  lines.push("");
  lines.push(
    "**O plano cobre estes estimandos e nenhum outro.** As taxas com gate (FPR, " +
      "especificidade e recall dos dois alvos, por base de rótulo e por fatia) e as " +
      "cinco estatísticas contínuas de ranking e calibração saem por aqui. " +
      "Cobertura, abstenção, as três taxas de erro, precisão, as fatias de " +
      "resolução, o recall do caminho localizado e as faixas diagnósticas da curva " +
      "mista **não têm unidade declarada em nenhum lugar**: nenhuma linha da tabela " +
      "congelada cobre esses estimandos, elas publicam o intervalo analítico de " +
      "Wilson e inventar uma unidade para elas seria inventar o contrato. " +
      "`MetricEstimate.method` diz qual estimador produziu cada número.",
  );
  lines.push("");
  lines.push(...resamplingExtensionLines());
  lines.push(
    "| Estimando | Método | Unidade declarada | Réplicas | Desenho executado | Limite publicado | Unidades medidas | Níveis por fator | Rebaixamento |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of plan.entries) {
    const separator = entry.unitKind === "hierarchical" ? " ⊃ " : " × ";
    const measured = entry.measured ?? null;
    const demoted =
      measured === null || measured.demotions.length === 0
        ? "—"
        : measured.demotions
            .map(
              (demotion) =>
                `${demotion.from}→${demotion.to} (${demotion.items})`,
            )
            .join("; ");
    const units =
      measured === null
        ? `não medida${entry.measurementNote ? ` — ${entry.measurementNote}` : ""}`
        : `${measured.units}/${measured.items}${measured.degenerate ? " (degenerada)" : ""}`;
    // Per FACTOR, not just the leaf count: a crossed design with one level in one
    // of its factors has nothing to cross, and the total unit count hides that.
    const perFactor =
      measured === null
        ? "—"
        : measured.levels
            .map(
              (level) =>
                `${level.axis}=${level.levels}${level.degenerate ? " (uma por linha)" : ""}`,
            )
            .join("; ");
    lines.push(
      `| ${entry.estimand} | ${entry.unitKind} | ${entry.unitAxes.join(separator)} | ` +
        `${entry.replicates} | ${entry.executed ?? "não declarado"} | ` +
        `${publishedBoundLabel(entry.publishedBound)} | ${units} | ` +
        `${perFactor} | ${demoted} |`,
    );
  }
  lines.push("");
  // The substitutions, printed where they cannot be missed. A factor of the frozen
  // table that no axis of the schema records is read through a stand-in, and a
  // reader of the table alone would take the row for implemented.
  const proxies = plan.entries.flatMap((entry) =>
    (entry.proxies ?? []).map((proxy) => ({ entry, proxy })),
  );
  if (proxies.length > 0) {
    lines.push(
      "**Fatores substituídos.** A tabela congelada nomeia um fator que nenhum " +
        "eixo do schema registra, e o eixo abaixo entra no lugar dele. Isso não é " +
        "sinônimo: o intervalo cruzado desta linha não é o da tabela.",
    );
    lines.push("");
    for (const { entry, proxy } of proxies) {
      lines.push(
        `- \`${entry.estimand}\`: \`${proxy.axis}\` no lugar de "${proxy.standsInFor}" — ${proxy.reason}`,
      );
    }
    lines.push("");
  }
  return lines;
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}
