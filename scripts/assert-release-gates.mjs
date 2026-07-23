#!/usr/bin/env node
// The local aggregator for the release lane. It proves, in one fail-closed pass,
// that a release build is allowed to proceed AT ALL:
//
//   1. the versioned descriptors parse and the pure policy matrix resolves
//      (a `pending` descriptor fails closed here with RELEASE_DECISION_PENDING);
//   2. the REAL sealed model is actually present — the directory exists
//      (REAL_MODEL_REQUIRED) and carries a non-empty `onnx/model_int8.onnx`
//      (MODEL_INT8_ONNX_REQUIRED). This is mandatory for ALL three decisions,
//      including a scientific reject: reject only STRIPS the model from `dist`
//      later, it never lets the candidate be validated without the source ONNX;
//   3. the materialized bundle verifies against the pinned source-lock;
//   4. the built `dist` is audited against the authorized decision.
//
//   node scripts/assert-release-gates.mjs \
//     --model public/models/cleanfeed-ptbr-v1 \
//     --metadata models/cleanfeed-ptbr-v1 \
//     --evidence benchmark/evidence/tmr-ptbr-v1 \
//     --dist dist
//
// It ALSO validates the `package.json` script map so the real smoke keeps a
// single Playwright owner: `build:release` -> run-release-build.mjs and
// `test:model:release` -> run-real-model-tests.mjs, and NO script runs a real
// model smoke through Vitest (REAL_MODEL_SMOKE_MUST_USE_PLAYWRIGHT). It never
// executes or replaces the Chrome smoke runner itself.

import console from "node:console";
import { readFile as nodeReadFile, stat as nodeStat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { parseCalibrationProfilesFileV1 } from "../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../contracts/model-release.ts";
import { auditModelPackage as defaultAuditModelPackage } from "./audit-model-package.mjs";
import { readSourceLock as defaultReadSourceLock } from "./model-lock.mjs";
import { resolveReleasePolicy as defaultResolveReleasePolicy } from "./release-policy.mjs";
import { verifyMaterializedBundle as defaultVerifyMaterializedBundle } from "./verify-model-bundle.mjs";

/** The single owners of the release build and the real Playwright smoke. */
const RELEASE_BUILD_OWNER = "scripts/run-release-build.mjs";
const REAL_SMOKE_OWNER = "scripts/run-real-model-tests.mjs";

/** The sealed, int8 ONNX binary that every release candidate must carry. */
const ONNX_RELATIVE = join("onnx", "model_int8.onnx");

/** The redistribution notices a packaged release must carry alongside the model. */
const REQUIRED_NOTICES = Object.freeze(["LICENSE", "NOTICE.md"]);

/** The repo-relative defaults the CLI uses when a flag is omitted. */
const DEFAULT_MODEL_DIR = join("public", "models", "cleanfeed-ptbr-v1");
const DEFAULT_METADATA_DIR = join("models", "cleanfeed-ptbr-v1");
const DEFAULT_EVIDENCE_DIR = join("benchmark", "evidence", "tmr-ptbr-v1");
const DEFAULT_DIST_DIR = "dist";

/** A greppable, coded error whose MESSAGE begins with the stable code. */
function coded(code, message) {
  const error = new Error(`${code}${message ? ` — ${message}` : ""}`);
  error.code = code;
  return error;
}

/**
 * Parses and closed-validates the two versioned descriptors under
 * `metadataDirectory`. Returns the parsed `{ release, profilesFile }`; throws a
 * coded error when either descriptor is unreadable or invalid.
 */
export async function assertReleaseMetadata(
  metadataDirectory,
  dependencies = {},
) {
  const readFile = dependencies.readFile ?? nodeReadFile;
  const read = async (name, code) => {
    let raw;
    try {
      raw = await readFile(join(metadataDirectory, name), "utf8");
    } catch (error) {
      throw coded(
        code,
        `cannot read ${name} in ${metadataDirectory}: ${error}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw coded(code, `${name} is not valid JSON: ${error}`);
    }
  };

  const release = await parseModelReleaseDescriptorV1(
    await read("release.json", "RELEASE_METADATA_UNREADABLE"),
  );
  const profilesFile = await parseCalibrationProfilesFileV1(
    await read("calibration-profiles.json", "PROFILES_METADATA_UNREADABLE"),
  );
  return { release, profilesFile };
}

/**
 * Proves the REAL sealed model is present: the directory exists
 * (REAL_MODEL_REQUIRED) and it carries a non-empty `onnx/model_int8.onnx`
 * (MODEL_INT8_ONNX_REQUIRED). It never inspects the bytes' validity — that is
 * the bundle verifier's job — only that a real, non-empty binary is there.
 */
export async function assertRealModelFiles(modelDirectory, dependencies = {}) {
  const stat = dependencies.stat ?? nodeStat;
  let dirStat;
  try {
    dirStat = await stat(modelDirectory);
  } catch {
    throw coded(
      "REAL_MODEL_REQUIRED",
      `the real model directory ${modelDirectory} is absent; the candidate ONNX must be materialized`,
    );
  }
  if (!dirStat.isDirectory()) {
    throw coded("REAL_MODEL_REQUIRED", `${modelDirectory} is not a directory`);
  }

  const onnxPath = join(modelDirectory, ONNX_RELATIVE);
  let onnxStat;
  try {
    onnxStat = await stat(onnxPath);
  } catch {
    throw coded(
      "MODEL_INT8_ONNX_REQUIRED",
      `the sealed int8 ONNX binary is missing at ${onnxPath}`,
    );
  }
  if (!onnxStat.isFile() || onnxStat.size <= 0) {
    throw coded(
      "MODEL_INT8_ONNX_REQUIRED",
      `the sealed int8 ONNX binary at ${onnxPath} is empty`,
    );
  }
}

/**
 * Verifies the materialized bundle in `modelDirectory` against the pinned
 * source-lock read from `metadataDirectory`. A thin wrapper over the Phase-1
 * `verifyMaterializedBundle` — it never redefines the closed inventory.
 */
export async function verifyModelBundle(
  modelDirectory,
  { metadataDirectory, dependencies = {} } = {},
) {
  const readSourceLock = dependencies.readSourceLock ?? defaultReadSourceLock;
  const verifyMaterializedBundle =
    dependencies.verifyMaterializedBundle ?? defaultVerifyMaterializedBundle;
  const lock = await readSourceLock(
    join(metadataDirectory, "source-lock.json"),
  );
  await verifyMaterializedBundle(modelDirectory, { lock });
}

/**
 * Validates the `package.json` script map: the real smoke keeps a single
 * Playwright owner. `build:release` must invoke run-release-build.mjs and
 * `test:model:release` must invoke run-real-model-tests.mjs; and NO script may
 * run a real-model smoke through Vitest.
 */
export function assertReleaseScriptOwners(packageJson) {
  const scripts =
    packageJson && typeof packageJson === "object" && packageJson.scripts
      ? packageJson.scripts
      : {};

  const buildRelease = scripts["build:release"];
  if (
    typeof buildRelease !== "string" ||
    !buildRelease.includes(RELEASE_BUILD_OWNER)
  ) {
    throw coded(
      "BUILD_RELEASE_OWNER_INVALID",
      `build:release must invoke ${RELEASE_BUILD_OWNER}`,
    );
  }

  const testModelRelease = scripts["test:model:release"];
  if (
    typeof testModelRelease !== "string" ||
    !testModelRelease.includes(REAL_SMOKE_OWNER)
  ) {
    throw coded(
      "TEST_MODEL_RELEASE_OWNER_INVALID",
      `test:model:release must invoke ${REAL_SMOKE_OWNER}`,
    );
  }

  // No script may masquerade a Vitest run as the REAL model smoke. The real
  // smoke is the offline Chrome Playwright spec, owned only by the runner.
  const looksLikeModelSmoke = /model.*smoke|smoke.*model|test:model/iu;
  const usesVitest = /(^|\s|&&|\|\||;|\/)vitest(\s|$)/u;
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue;
    if (looksLikeModelSmoke.test(name) && usesVitest.test(command)) {
      throw coded(
        "REAL_MODEL_SMOKE_MUST_USE_PLAYWRIGHT",
        `${name} runs a real-model smoke through Vitest; the real smoke must run ${REAL_SMOKE_OWNER} (Playwright)`,
      );
    }
  }
}

/**
 * The single aggregator: metadata -> policy -> real model files -> bundle ->
 * audit. Fail-closed and ordered — a pending descriptor never reaches the model
 * checks, and the real ONNX gate runs before the bundle verification and audit.
 * Returns the resolved packaging policy.
 */
export async function assertReleaseInputs({
  modelDirectory,
  metadataDirectory,
  distDirectory,
  evidenceDirectory = DEFAULT_EVIDENCE_DIR,
  now = Date.now(),
  dependencies = {},
}) {
  const loadReleaseMetadata =
    dependencies.loadReleaseMetadata ??
    ((directory) => assertReleaseMetadata(directory));
  const resolvePolicy =
    dependencies.resolveReleasePolicy ?? defaultResolveReleasePolicy;
  const assertRealModel =
    dependencies.assertRealModelFiles ??
    ((directory) => assertRealModelFiles(directory));
  const verifyBundle =
    dependencies.verifyModelBundle ??
    ((directory, options) => verifyModelBundle(directory, options));
  const audit = dependencies.auditModelPackage ?? defaultAuditModelPackage;

  const { release, profilesFile } =
    await loadReleaseMetadata(metadataDirectory);
  const policy = resolvePolicy(release, profilesFile, now);

  await assertRealModel(modelDirectory);
  await verifyBundle(modelDirectory, { metadataDirectory });
  await audit({
    distDir: distDirectory,
    metadataDir: metadataDirectory,
    evidenceDir: evidenceDirectory,
    now,
  });

  return policy;
}

/**
 * The DESCRIPTOR-level publication decision from the plan's final release table.
 * `assertReleaseInputs`/`resolveReleasePolicy` already fail closed on `pending`
 * and reject every invalid rollout pairing, but they still ACCEPT `pass` at the
 * pre-activation `indicator` stage (its runtime ceiling is `indicator`). That
 * stage is explicitly NOT publishable — a `pass` candidate is only publishable
 * once the single monotonic `pass/indicator -> pass/actions` transition has been
 * applied. This is the added publication tooth over the base packaging policy.
 */
export function assertPublicationDescriptor(release) {
  if (release.gateDecision === "pass" && release.rolloutState !== "actions") {
    throw coded(
      "RELEASE_NOT_ACTIVATED",
      `a pass release is only publishable at rolloutState "actions"; pass/${String(release.rolloutState)} is the pre-activation engineering stage`,
    );
  }
}

/**
 * A packaged release (indicator-only or pass) may only be published with an
 * APPROVED licence review and the redistribution notices present. A reject
 * release ships the fallback package WITHOUT the model bundle, so the upstream
 * bundle licence is not a publication blocker for it (mirrors the packaging
 * policy's `includeTmr`).
 */
export async function assertPublicationLicense(
  metadataDirectory,
  policy,
  dependencies = {},
) {
  if (!policy.includeTmr) return;
  const readFile = dependencies.readFile ?? nodeReadFile;
  const stat = dependencies.stat ?? nodeStat;

  let review;
  try {
    review = JSON.parse(
      await readFile(join(metadataDirectory, "license-review.json"), "utf8"),
    );
  } catch (error) {
    throw coded(
      "PUBLICATION_LICENSE_NOT_APPROVED",
      `cannot read license-review.json in ${metadataDirectory}: ${error}`,
    );
  }
  if (review?.status !== "approved") {
    throw coded(
      "PUBLICATION_LICENSE_NOT_APPROVED",
      `a packaged release requires an approved licence review (found "${String(review?.status)}")`,
    );
  }

  for (const notice of REQUIRED_NOTICES) {
    try {
      const noticeStat = await stat(join(metadataDirectory, notice));
      if (!noticeStat.isFile() || noticeStat.size <= 0) {
        throw coded(
          "PUBLICATION_NOTICE_MISSING",
          `redistribution notice ${notice} is empty`,
        );
      }
    } catch (error) {
      if (error.code === "PUBLICATION_NOTICE_MISSING") throw error;
      throw coded(
        "PUBLICATION_NOTICE_MISSING",
        `redistribution notice ${notice} is missing from ${metadataDirectory}`,
      );
    }
  }
}

/** The single connect-src value declared by the built manifest's CSP. */
function connectSrcValue(csp) {
  const match = /connect-src([^;]*)(?:;|$)/u.exec(csp ?? "");
  return match === undefined || match === null ? undefined : match[1].trim();
}

/**
 * Confirms the BUILT extension does not widen the network or permission surface
 * at publish time: the CSP `connect-src` must stay exactly `'self'` (no new
 * network origin) and no optional permissions/hosts may be declared (no new
 * permission). This is the capstone posture check; the exhaustive static
 * permission/host/CSP allowlist audit is owned by `npm run audit`.
 */
export async function assertPublicationManifest(
  distDirectory,
  dependencies = {},
) {
  const readFile = dependencies.readFile ?? nodeReadFile;
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(distDirectory, "manifest.json"), "utf8"),
    );
  } catch (error) {
    throw coded(
      "PUBLICATION_MANIFEST_UNREADABLE",
      `cannot read manifest.json in ${distDirectory}: ${error}`,
    );
  }

  const connect = connectSrcValue(
    manifest?.content_security_policy?.extension_pages,
  );
  if (connect !== "'self'") {
    throw coded(
      "PUBLICATION_NETWORK_ORIGIN_ADDED",
      `the shipped CSP connect-src must remain 'self'; found ${connect ?? "(absent)"}`,
    );
  }

  for (const key of ["optional_permissions", "optional_host_permissions"]) {
    const declared = manifest?.[key];
    if (Array.isArray(declared) && declared.length > 0) {
      throw coded(
        "PUBLICATION_PERMISSION_ADDED",
        `${key} widens the shipped surface: ${declared.join(", ")}`,
      );
    }
  }
}

/**
 * The FINAL publication gate. Composes the base release inputs (which fail
 * closed on `pending` and prove the audited offline package, the exact evidence
 * chain and the undersized-slice guard via the closed parsers) with the
 * publication-only conditions: the pass activation stage, the approved licence
 * plus notices, and the unwidened network/permission posture. Returns the
 * resolved packaging policy.
 */
export async function assertPublicationInputs({
  modelDirectory,
  metadataDirectory,
  distDirectory,
  evidenceDirectory = DEFAULT_EVIDENCE_DIR,
  now = Date.now(),
  dependencies = {},
}) {
  const loadReleaseMetadata =
    dependencies.loadReleaseMetadata ??
    ((directory) => assertReleaseMetadata(directory));

  // Fail closed FIRST: a pending descriptor never reaches the publication-only
  // checks, and the real model / bundle / offline-package audit run here.
  const policy = await assertReleaseInputs({
    modelDirectory,
    metadataDirectory,
    distDirectory,
    evidenceDirectory,
    now,
    dependencies,
  });

  const { release } = await loadReleaseMetadata(metadataDirectory);
  assertPublicationDescriptor(release);
  await assertPublicationLicense(metadataDirectory, policy, dependencies);
  await assertPublicationManifest(distDirectory, dependencies);

  return policy;
}

function parseCliArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    const assign = (key) => {
      if (value === undefined)
        throw coded("MISSING_FLAG_VALUE", `${flag} needs a value`);
      options[key] = value;
      index += 1;
    };
    if (flag === "--publication") options.publication = true;
    else if (flag === "--model") assign("modelDirectory");
    else if (flag === "--metadata") assign("metadataDirectory");
    else if (flag === "--evidence") assign("evidenceDirectory");
    else if (flag === "--dist") assign("distDirectory");
    else throw coded("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  return options;
}

async function runCli() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseCliArgs(argv.slice(2));
  const resolveDir = (value, fallback) => {
    const chosen = value ?? fallback;
    return isAbsolute(chosen) ? chosen : join(repoRoot, chosen);
  };
  const modelDirectory = resolveDir(options.modelDirectory, DEFAULT_MODEL_DIR);
  const metadataDirectory = resolveDir(
    options.metadataDirectory,
    DEFAULT_METADATA_DIR,
  );
  const evidenceDirectory = resolveDir(
    options.evidenceDirectory,
    DEFAULT_EVIDENCE_DIR,
  );
  const distDirectory = resolveDir(options.distDirectory, DEFAULT_DIST_DIR);

  // Collect EVERY blocking reason, in a stable order, before failing closed.
  const reasons = [];
  const collect = async (step) => {
    try {
      await step();
    } catch (error) {
      reasons.push(
        error.code ? `${error.code} — ${error.message}` : String(error),
      );
    }
  };

  await collect(async () => {
    const packageJson = JSON.parse(
      await nodeReadFile(join(repoRoot, "package.json"), "utf8"),
    );
    assertReleaseScriptOwners(packageJson);
  });
  await collect(async () => {
    if (options.publication) {
      await assertPublicationInputs({
        modelDirectory,
        metadataDirectory,
        distDirectory,
        evidenceDirectory,
      });
    } else {
      await assertReleaseInputs({
        modelDirectory,
        metadataDirectory,
        distDirectory,
        evidenceDirectory,
      });
    }
  });

  if (reasons.length > 0) {
    const label = options.publication ? "publication gate" : "release gate";
    for (const reason of reasons) {
      console.error(`${label} BLOCKED — ${reason}`);
    }
    exit(1);
  }
  console.log(
    options.publication
      ? "publication gates OK — decision publishable, package audited, notices and posture verified."
      : "release gates OK — real model present and package audited.",
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `release gates FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
