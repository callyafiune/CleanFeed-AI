#!/usr/bin/env node
// Builds the four TEST-ONLY release variants used by tests/e2e/tmr-release.spec.ts.
// Each variant is a full, unpacked extension whose ONLY difference from the real
// build is a synthetic `release.json` + `calibration-profiles.json` aliased in by
// the `--mode e2e-release-variant` plugin. The synthetic descriptors carry REAL
// digests bound to the SEALED bundle identity (so the closed parsers and the
// runtime CalibrationRegistry accept them), zero thresholds and isotonic knots
// mapping every score to 1 (so the calibrated path presents), and — for the
// `expired` variant — a profile 180 days past its issuance (so the TMR abstains).
//
//   node scripts/build-e2e-release-variants.mjs
//
// It NEVER touches `models`, `public/models`, `dist` or any inferenceCoreDigest
// entry: every byte it writes lives under `test-results/release-variants`. Each
// variant carries the SAME `runtimeParityDigest` as the real core, because the
// parity manifest is derived from the canonical model manifest, never the variant.

import { spawn } from "node:child_process";
import console from "node:console";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv, env, execPath, exit } from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_DIR = join(REPO_ROOT, "models", "cleanfeed-ptbr-v1");
const VARIANTS_ROOT = join(REPO_ROOT, "test-results", "release-variants");
const VITE_BIN = join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
const E2E_MODE = "e2e-release-variant";
const DAY_MS = 24 * 60 * 60 * 1000;
const DUMMY_DIGEST = "f".repeat(64);

/** The four variant names, in a deterministic build order. */
export const VARIANT_NAMES = Object.freeze([
  "shadow",
  "indicator-only",
  "pass",
  "expired",
]);

function coded(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  return error;
}

/** Spawns a Node child, resolving on exit 0 and rejecting otherwise. */
function run(command, args, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...env, ...extraEnv },
      cwd: REPO_ROOT,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else
        reject(coded("VITE_BUILD_FAILED", `${args.join(" ")} exited ${code}`));
    });
  });
}

/** One Wilson-style proportion gate estimate with the given sample size. */
function gate(estimate, sampleSize) {
  return {
    estimate,
    lowerBound95: Math.max(0, estimate - 0.01),
    upperBound95: Math.min(1, estimate + 0.01),
    sampleSize,
  };
}

/** The shared, sample-sound gate-evidence block (real thresholds are irrelevant). */
function gateEvidence(decision) {
  return {
    decision,
    intervalMethod: "wilson-one-sided-95",
    ece: { value: 0.02, bins: 15, sampleSize: 5000 },
    overall: {
      indicatorFpr: gate(0.03, 2500),
      indicatorRecall: gate(0.7, 1200),
      actionFpr: gate(0.01, 2500),
      actionRecall: gate(0.6, 1200),
      coverage: gate(0.97, 3000),
      mixedRecall: gate(0.65, 1200),
    },
    criticalFprSlices: {
      "topic:tech": {
        indicatorFpr: gate(0.03, 400),
        actionFpr: gate(0.01, 400),
      },
    },
    criticalRecallSlices: {
      "topic:tech": {
        indicatorRecall: gate(0.7, 300),
        actionRecall: gate(0.6, 300),
      },
    },
  };
}

const ZERO_KNOTS = {
  kind: "isotonic",
  interpolation: "linear",
  clamp: true,
  knots: [
    { rawScore: 0, calibratedScore: 1 },
    { rawScore: 1, calibratedScore: 1 },
  ],
};

/**
 * Builds one calibration profile bound to the sealed identity. `decision`/
 * `actionCeiling`/`documentAction` are chosen by the caller to satisfy the closed
 * cross-field policy (indicator-only requires documentAction === 1; the 50-79
 * bucket and every indicator ceiling stay indicator; a hide ceiling needs pass).
 */
async function buildProfile(
  identity,
  { lengthBucket, decision, actionCeiling, documentAction, issuedAt },
  computeProfileDigest,
) {
  const expiresAt = new Date(Date.parse(issuedAt) + 180 * DAY_MS).toISOString();
  const draft = {
    schemaVersion: 1,
    profileId: `e2e-${lengthBucket}`,
    modelId: identity.modelId,
    modelVersion: identity.modelVersion,
    bundleDigest: identity.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    platform: "linkedin",
    locale: "pt-BR",
    lengthBucket,
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
    datasetDigest: "c".repeat(64),
    splitDigest: "d".repeat(64),
    evaluatorDigest: "e".repeat(64),
    issuedAt,
    expiresAt,
    calibrators: { document: ZERO_KNOTS, localized: ZERO_KNOTS },
    thresholds: {
      documentIndicator: 0,
      localizedIndicator: 0,
      documentAction,
    },
    evidencePolicy: {
      minimumCoverage: 0,
      minimumLexicalRatio: 0,
      maximumStdDev: 1,
      minimumChunkAgreement: 0,
      exactTokenizerRequired: true,
    },
    gateEvidence: gateEvidence(decision),
    actionCeiling,
    profileDigest: "",
  };
  draft.profileDigest = await computeProfileDigest(draft);
  return draft;
}

/**
 * Materializes `release.json` + `calibration-profiles.json` for a recipe. The
 * two profiles (50-79 and 80-199) match the fixture's short-qualified and long
 * posts; only the `pass`/`expired` 80-199 profile carries a hide ceiling.
 */
async function materializeMetadata(variantDir, recipe, identity, contracts) {
  const { computeCalibrationProfileDigest, computeCalibrationSetDigest } =
    contracts;
  const expired = recipe.profileMode === "expired";
  const issuedAt = expired
    ? "2023-11-14T22:13:20.000Z"
    : new Date(Date.now() - DAY_MS).toISOString();

  const indicatorOnly = recipe.profileMode === "valid-indicator";
  const decision = indicatorOnly ? "indicator-only" : "pass";
  // indicator-only requires documentAction === 1; a pass profile keeps it at 0
  // so the action gate can fire when the ceiling and rollout allow it.
  const documentAction = indicatorOnly ? 1 : 0;
  const longCeiling = indicatorOnly ? "indicator" : "hide";

  const shortProfile = await buildProfile(
    identity,
    {
      lengthBucket: "50-79",
      decision,
      actionCeiling: "indicator",
      documentAction,
      issuedAt,
    },
    computeCalibrationProfileDigest,
  );
  const longProfile = await buildProfile(
    identity,
    {
      lengthBucket: "80-199",
      decision,
      actionCeiling: longCeiling,
      documentAction,
      issuedAt,
    },
    computeCalibrationProfileDigest,
  );

  const profiles = [shortProfile, longProfile];
  const profileDigests = profiles.map((profile) => profile.profileDigest);
  const calibrationSetDigest =
    await computeCalibrationSetDigest(profileDigests);

  const release = {
    schemaVersion: 1,
    modelId: identity.modelId,
    modelVersion: identity.modelVersion,
    bundleDigest: identity.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
    calibrationSetDigest,
    profileDigests,
    rolloutState: recipe.rolloutState,
    gateDecision: recipe.gateDecision,
    issuedAt: new Date(Date.now() - DAY_MS).toISOString(),
    evidenceDigest: DUMMY_DIGEST,
  };

  await writeFile(
    join(variantDir, "calibration-profiles.json"),
    `${JSON.stringify({ schemaVersion: 1, profiles }, null, 2)}\n`,
  );
  await writeFile(
    join(variantDir, "release.json"),
    `${JSON.stringify(release, null, 2)}\n`,
  );
  return { release, profiles };
}

/**
 * Builds a single variant: materialize the metadata, run the two Vite builds
 * with the alias mode + env, seal the shared runtime-parity manifest and
 * sanitize. Returns the absolute dist path the E2E launches.
 */
export async function buildReleaseVariant(name, recipe, outputDirectory) {
  const variantDir = resolve(outputDirectory);
  const distDir = join(variantDir, "dist");
  await rm(variantDir, { recursive: true, force: true });
  await mkdir(variantDir, { recursive: true });

  const [
    {
      parseCalibrationProfilesFileV1,
      computeCalibrationProfileDigest,
      computeCalibrationSetDigest,
    },
    { parseModelReleaseDescriptorV1 },
    { buildRuntimeParityManifest, writeRuntimeParityManifest },
    { sanitizeOfflineBundle },
  ] = await Promise.all([
    import("../contracts/calibration-profile.ts"),
    import("../contracts/model-release.ts"),
    import("./runtime-parity.mjs"),
    import("./sanitize-offline-bundle.mjs"),
  ]);

  const manifest = JSON.parse(
    await readFile(join(MODELS_DIR, "cleanfeed-model.json"), "utf8"),
  );
  const identity = {
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    bundleDigest: manifest.bundleDigest,
    tokenizerDigest: manifest.tokenizerDigest,
    aggregationVersion: manifest.aggregationVersion,
    contentCompositionVersion: manifest.contentCompositionVersion,
  };

  const { release, profiles } = await materializeMetadata(
    variantDir,
    recipe,
    identity,
    {
      computeCalibrationProfileDigest,
      computeCalibrationSetDigest,
    },
  );

  // Self-validate the synthetic descriptors through the SAME closed parsers the
  // runtime uses, so a malformed variant fails here, not silently in the browser.
  await parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles });
  await parseModelReleaseDescriptorV1(release);

  // Build the extension twice with the alias mode + env pointing at the variant.
  const variantEnv = { CLEANFEED_E2E_VARIANT_METADATA_DIR: variantDir };
  await run(
    execPath,
    [
      VITE_BIN,
      "build",
      "--mode",
      E2E_MODE,
      "--outDir",
      distDir,
      "--emptyOutDir",
    ],
    variantEnv,
  );
  await run(
    execPath,
    [
      VITE_BIN,
      "build",
      "--config",
      "vite.manual-analysis.config.ts",
      "--mode",
      E2E_MODE,
      "--outDir",
      distDir,
    ],
    variantEnv,
  );

  // The parity manifest is derived from the CANONICAL model manifest, so every
  // variant carries the same runtimeParityDigest as the real core.
  const parity = await buildRuntimeParityManifest({
    repoRoot: REPO_ROOT,
    modelManifestPath: join(MODELS_DIR, "cleanfeed-model.json"),
  });
  await writeRuntimeParityManifest(parity, distDir);

  await sanitizeOfflineBundle({ distDir });
  // Cross-level coherence (identity match, expiry, calibration-set digest) is
  // enforced by the runtime's own `crossValidateRuntimeDescriptor` when the
  // extension loads in the browser; the contract parsers above already reject a
  // structurally invalid variant here.

  return distDir;
}

async function runCli() {
  const { createReleaseVariantRecipe } =
    await import("../tests/e2e/fixtures/release-variants.ts");
  await mkdir(VARIANTS_ROOT, { recursive: true });
  for (const name of VARIANT_NAMES) {
    const recipe = createReleaseVariantRecipe(name);
    const distDir = await buildReleaseVariant(
      name,
      recipe,
      join(VARIANTS_ROOT, name),
    );
    console.log(`variant OK — ${name} -> ${distDir}`);
  }
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli()
    .then(() => exit(0))
    .catch((error) => {
      console.error(
        `build-e2e-release-variants FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
