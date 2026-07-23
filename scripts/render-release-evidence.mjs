#!/usr/bin/env node
// Renders the SANITIZED, human-readable release-evidence document for TMR PT-BR
// v1. It is deterministic and derives every claim from the versioned descriptor,
// the sanitized Phase 3 report/evidence manifest, the published calibration
// profiles and the reference performance receipt. It never invents accuracy: the
// document states exactly the gate decision, rollout stage, published coverage
// and performance-gate status, and NOTHING beyond what the sealed report proves.
//
//   node scripts/render-release-evidence.mjs           # writes docs/releases/tmr-ptbr-v1.md
//   node scripts/render-release-evidence.mjs --check    # verifies the committed file
//
// Fail-closed and honest:
//   - a `pending` descriptor has no sealed decision or report, so the renderer
//     throws RELEASE_EVIDENCE_PENDING and NOTHING is written;
//   - the scientific evidence digest must agree across the descriptor, the
//     evidence manifest and the report (EVIDENCE_DIGEST_MISMATCH otherwise);
//   - the CLI calls the Phase 3 published-evidence verifier to validate the
//     publication digest before rendering.
// It emits no corpus, no predictions, no prompts, no authors, no content hashes
// and no per-sample scores — only aggregate, already-sanitized metrics.

import console from "node:console";
import { readFile as nodeReadFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** A greppable, coded error whose MESSAGE begins with the stable code. */
function coded(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  return error;
}

/** Formats a metric with fixed decimals; a non-finite input renders as "n/d". */
function fmt(value, decimals = 4) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(decimals)
    : "n/d";
}

/** The one-line publication posture that matches the gate decision exactly. */
function renderDecisionState(release) {
  switch (release.gateDecision) {
    case "reject":
      return "TMR não empacotado; fallback estilométrico ativo.";
    case "indicator-only":
      return "Ações visuais desabilitadas: todo perfil tem teto indicator.";
    case "pass":
      return [
        "Ações limitadas ao perfil e à preferência do usuário.",
        "50–79: somente indicador.",
      ].join("\n");
    default:
      throw coded(
        "RELEASE_EVIDENCE_INVALID",
        `unknown gateDecision "${String(release.gateDecision)}"`,
      );
  }
}

/** The statistical gate table plus the overall operating points. */
function renderGateTable(report) {
  const lines = [];
  const warning = report.metrics?.warning ?? {};
  lines.push(
    `- UCB95(FPR) de aviso: ${fmt(warning.falsePositiveRate?.upper95)}`,
  );
  lines.push(`- LCB95(recall) de aviso: ${fmt(warning.recall?.lower95)}`);
  const action = report.metrics?.action ?? {};
  lines.push(`- UCB95(FPR) de ação: ${fmt(action.falsePositiveRate?.upper95)}`);
  lines.push(`- LCB95(recall) de ação: ${fmt(action.recall?.lower95)}`);
  lines.push(`- Cobertura: ${fmt(report.metrics?.coverage?.value)}`);
  lines.push("");
  lines.push("| Gate | Tier | Escopo | Elegível | Resultado |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const gate of report.gates?.gates ?? []) {
    const scope =
      gate.slice === undefined || gate.slice === null
        ? (gate.scope ?? "overall")
        : `${gate.slice.axis}/${gate.slice.key}`;
    lines.push(
      `| ${gate.id} | ${gate.tier} | ${scope} | ${gate.eligible ? "sim" : "não"} | ${gate.passed ? "passou" : "reprovou"} |`,
    );
  }
  return lines.join("\n");
}

/** The published profiles, ordered by length bucket then id; aggregate only. */
function renderProfiles(profiles) {
  const lines = [];
  if (profiles.length === 0) {
    lines.push("Validade dos perfis: nenhum perfil publicado.");
    lines.push("");
    lines.push("Nenhum perfil publicado (candidato sem cobertura ativa).");
    return lines.join("\n");
  }

  const ordered = [...profiles].sort((a, b) => {
    if (a.lengthBucket !== b.lengthBucket)
      return a.lengthBucket < b.lengthBucket ? -1 : 1;
    return a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0;
  });

  const validity = ordered
    .map((profile) => `${profile.profileId} até ${profile.expiresAt}`)
    .join("; ");
  lines.push(`Validade dos perfis: ${validity}.`);
  lines.push("");
  lines.push(
    "| Perfil | Faixa | Teto | Idioma | Plataforma | UCB95(FPR) aviso | LCB95(recall) aviso |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const profile of ordered) {
    const overall = profile.gateEvidence?.overall ?? {};
    lines.push(
      `| ${profile.profileId} | ${profile.lengthBucket} | ${profile.actionCeiling} | ` +
        `${profile.locale} | ${profile.platform} | ` +
        `${fmt(overall.indicatorFpr?.upperBound95)} | ${fmt(overall.indicatorRecall?.lowerBound95)} |`,
    );
  }
  return lines.join("\n");
}

/** The reference WASM performance receipt, or the reject N/A statement. */
function renderPerformance(performanceEvidence) {
  if (performanceEvidence.status === "not-applicable") {
    return "Não aplicável: candidato rejeitado e ausente do pacote.";
  }
  if (performanceEvidence.status === "measured") {
    const report = performanceEvidence.report ?? {};
    return [
      `- Cold start: ${fmt(report.coldStartMs, 1)} ms`,
      `- Warm p95: ${fmt(report.warmInferenceP95Ms, 1)} ms`,
      `- Memória incremental: ${fmt(report.incrementalMemoryBytes, 0)} bytes`,
      `- Taxa de erro: ${fmt(report.inferenceErrorRate)}`,
      `- Maior tarefa da thread principal: ${fmt(report.maximumMainThreadTaskMs, 1)} ms`,
    ].join("\n");
  }
  throw coded(
    "RELEASE_EVIDENCE_INVALID",
    `unknown performance evidence status "${String(performanceEvidence.status)}"`,
  );
}

/**
 * Deterministically renders the release-evidence document. Fail-closed on a
 * pending descriptor and on any scientific-evidence digest disagreement.
 */
export function renderReleaseEvidence({
  release,
  report,
  evidenceManifest,
  profilesFile,
  performanceEvidence,
  probabilisticDisclosure,
}) {
  if (release.gateDecision === "pending") {
    throw coded(
      "RELEASE_EVIDENCE_PENDING",
      "a pending descriptor carries no sealed decision or report; there is no evidence to render",
    );
  }
  if (
    typeof probabilisticDisclosure !== "string" ||
    probabilisticDisclosure.length === 0
  ) {
    throw coded(
      "RELEASE_EVIDENCE_INVALID",
      "the probabilistic disclosure copy is required",
    );
  }
  if (
    release.evidenceDigest !== evidenceManifest.scientificEvidenceDigest ||
    release.evidenceDigest !== report.reportDigest
  ) {
    throw coded(
      "EVIDENCE_DIGEST_MISMATCH",
      "release.evidenceDigest, evidence manifest and report digest must agree",
    );
  }

  const lines = [
    "# CleanFeed AI — TMR PT-BR v1 release evidence",
    "",
    "> Documento gerado por `npm run release:evidence`. Não editar à mão.",
    "> Nenhuma alegação de acurácia além do que o relatório selado comprova.",
    "",
    "Decisão: " + release.gateDecision,
    "Rollout: " + release.rolloutState,
    "Modelo: " + release.modelId + " " + release.modelVersion,
    "Bundle digest: " + release.bundleDigest,
    "Tokenizer digest: " + release.tokenizerDigest,
    "Scientific evidence digest: " + release.evidenceDigest,
    "Publication digest: " + evidenceManifest.publicationDigest,
    "Runtime parity digest: " + report.runtimeParityDigest,
    "",
    "## Estado de publicação",
    renderDecisionState(release),
    "",
    "## Gates estatísticos",
    renderGateTable(report),
    "",
    "## Perfis publicados",
    renderProfiles(profilesFile.profiles),
    "",
    "## Desempenho WASM",
    renderPerformance(performanceEvidence),
    "",
    "## Limitação de interpretação",
    probabilisticDisclosure,
  ];
  return lines.join("\n") + "\n";
}

/** Reads a JSON file with a coded error on failure. */
async function readJson(readFile, path, code) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw coded(code, `cannot read ${path}: ${error}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw coded(code, `${path} is not valid JSON: ${error}`);
  }
}

/**
 * Reads the shared classification copy with an EXACT-key parser and returns the
 * probabilistic disclosure. It never imports the TypeScript module and never
 * duplicates the phrase.
 */
async function readProbabilisticDisclosure(readFile, path) {
  const copy = await readJson(readFile, path, "CLASSIFICATION_COPY_UNREADABLE");
  const keys = Object.keys(copy).sort();
  const expected = ["probabilisticDisclosure", "technicalScoreDisclaimer"];
  if (
    keys.length !== expected.length ||
    !expected.every((key, index) => key === keys[index])
  ) {
    throw coded(
      "CLASSIFICATION_COPY_INVALID",
      "classification-copy.json must carry exactly the two disclosure keys",
    );
  }
  if (
    typeof copy.probabilisticDisclosure !== "string" ||
    copy.probabilisticDisclosure.length === 0
  ) {
    throw coded(
      "CLASSIFICATION_COPY_INVALID",
      "probabilisticDisclosure must be a non-empty string",
    );
  }
  return copy.probabilisticDisclosure;
}

function parseCliArgs(args) {
  const options = { check: false };
  for (const flag of args) {
    if (flag === "--check") options.check = true;
    else throw coded("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  return options;
}

async function runCli() {
  const options = parseCliArgs(argv.slice(2));
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const resolveRepo = (relativePath) =>
    isAbsolute(relativePath) ? relativePath : join(repoRoot, relativePath);

  const metadataDir = resolveRepo(join("models", "cleanfeed-ptbr-v1"));
  const evidenceDir = resolveRepo(join("benchmark", "evidence", "tmr-ptbr-v1"));
  const outputPath = resolveRepo(join("docs", "releases", "tmr-ptbr-v1.md"));

  // Fail closed the moment the release has no sealed decision.
  const release = await readJson(
    nodeReadFile,
    join(metadataDir, "release.json"),
    "RELEASE_UNREADABLE",
  );
  if (release.gateDecision === "pending") {
    throw coded(
      "RELEASE_EVIDENCE_PENDING",
      "the release is pending; no scientific decision exists to render",
    );
  }

  const profilesFile = await readJson(
    nodeReadFile,
    join(metadataDir, "calibration-profiles.json"),
    "PROFILES_UNREADABLE",
  );
  const evidenceManifest = await readJson(
    nodeReadFile,
    join(evidenceDir, "evidence-digest.json"),
    "EVIDENCE_UNREADABLE",
  );
  const report = await readJson(
    nodeReadFile,
    join(evidenceDir, "benchmark-report.json"),
    "REPORT_UNREADABLE",
  );
  const probabilisticDisclosure = await readProbabilisticDisclosure(
    nodeReadFile,
    resolveRepo(join("src", "shared", "classification-copy.json")),
  );

  // Validate the published publication digest with the Phase 3 verifier.
  const { runVerifyPublishedEvidence } =
    await import("../benchmark/commands/verify-published-evidence.ts");
  await runVerifyPublishedEvidence({
    evidenceDirectory: evidenceDir,
    modelDirectory: metadataDir,
  });

  // Build the performance evidence: measured for a packaged release, N/A for a
  // reject descriptor whose model was stripped from the package.
  let performanceEvidence;
  if (release.gateDecision === "reject") {
    performanceEvidence = { status: "not-applicable" };
  } else {
    const report_ = await readJson(
      nodeReadFile,
      resolveRepo(join("test-results", "tmr-release-performance.json")),
      "PERFORMANCE_UNREADABLE",
    );
    performanceEvidence = { status: "measured", report: report_ };
  }

  const rendered = renderReleaseEvidence({
    release,
    report,
    evidenceManifest,
    profilesFile,
    performanceEvidence,
    probabilisticDisclosure,
  });

  if (options.check) {
    let onDisk;
    try {
      onDisk = await nodeReadFile(outputPath, "utf8");
    } catch (error) {
      throw coded(
        "RELEASE_EVIDENCE_CHECK_FAILED",
        `cannot read ${outputPath}: ${error}`,
      );
    }
    if (onDisk !== rendered) {
      throw coded(
        "RELEASE_EVIDENCE_CHECK_FAILED",
        `${outputPath} diverges from the regenerated evidence`,
      );
    }
    console.log(
      "release evidence OK — committed document matches the descriptor.",
    );
    return;
  }

  await writeFile(outputPath, rendered);
  console.log(`release evidence written — ${outputPath}`);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `release evidence BLOCKED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
