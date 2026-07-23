#!/usr/bin/env node
// The REAL-model test runner. Cross-platform and fail-closed: it never depends
// on a Unix shell and never lets a skipped test masquerade as a pass.
//
//   node scripts/run-real-model-tests.mjs candidate
//   node scripts/run-real-model-tests.mjs release
//
// Every child is spawned with `process.execPath` + `process.env.npm_execpath`,
// so no `sh`/`bash` is required (Windows-safe). If `npm_execpath` is missing the
// runner returns NPM_EXEC_PATH_MISSING.
//
// candidate: verify the materialized bundle, build the isolated smoke extension
//   and run the real Playwright smoke in the bundled Chromium. If the sealed ONNX
//   binary has not been acquired the correct, structured result is
//   MODEL_ARTIFACT_MISSING. Any skipped test — or a missing expected spec — is
//   MODEL_SMOKE_SKIPPED, never a silent green.
//
// release: a pending gate decision is MODEL_RELEASE_NOT_PROMOTED and nothing is
//   built. A promoted decision defers to `build:release` (which itself runs the
//   exact candidate smoke, the mode build and the audit) and then the normal E2E.

import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, env, execPath as nodeExecPath, exit } from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRootDefault = join(scriptDir, "..");

const SMOKE_SPEC = "real-model-smoke.spec.ts";
const PLAYWRIGHT_REPORT = join("test-results", "model-smoke.json");
const ONNX_PATH = join(
  "public",
  "models",
  "cleanfeed-ptbr-v1",
  "onnx",
  "model_int8.onnx",
);
const RELEASE_PATH = join("models", "cleanfeed-ptbr-v1", "release.json");

/** Spawns `command args`, resolving on exit 0 and rejecting otherwise. */
function defaultRunNode(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `command failed (exit ${code}): ${command} ${args.join(" ")}`,
          ),
        );
    });
  });
}

/** Spawns a child and RESOLVES with its exit code (never rejects on nonzero). */
function defaultRunToCode(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? env,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ exitCode: code ?? 1 }));
  });
}

/** Flattens a Playwright JSON report into its per-spec test statuses. */
function collectSpecStatuses(report) {
  const specs = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const statuses = (spec.tests ?? []).map((testCase) => testCase.status);
      specs.push({ file: spec.file ?? suite.file ?? "", statuses });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return specs;
}

/**
 * Runs the real-model test lane for a mode. Returns a coded result object; only
 * propagates (throws) when an actual child process breaks, so callers can tell
 * "the gate said no" from "a step crashed".
 */
export async function runRealModelTests({ mode, dependencies = {} }) {
  const runNode = dependencies.runNode ?? defaultRunNode;
  const runToCode = dependencies.runPlaywright ?? defaultRunToCode;
  const execPath = dependencies.execPath ?? nodeExecPath;
  const npmExecPath =
    "npmExecPath" in dependencies ? dependencies.npmExecPath : env.npm_execpath;
  const repoRoot = dependencies.repoRoot ?? repoRootDefault;
  const onnxPresent =
    dependencies.onnxPresent ??
    (() => {
      const path = join(repoRoot, ONNX_PATH);
      return existsSync(path) && statSync(path).size > 0;
    });
  const readReleaseGateDecision =
    dependencies.readReleaseGateDecision ??
    (async () => {
      const release = JSON.parse(
        await readFile(join(repoRoot, RELEASE_PATH), "utf8"),
      );
      return typeof release?.gateDecision === "string"
        ? release.gateDecision
        : "";
    });
  const readPlaywrightReport =
    dependencies.readPlaywrightReport ??
    (async () => {
      const raw = await readFile(join(repoRoot, PLAYWRIGHT_REPORT), "utf8");
      return JSON.parse(raw);
    });

  if (mode === "release") {
    const gateDecision = await readReleaseGateDecision();
    if (gateDecision === "pending") {
      return { ok: false, code: "MODEL_RELEASE_NOT_PROMOTED" };
    }
    if (!npmExecPath) {
      return { ok: false, code: "NPM_EXEC_PATH_MISSING" };
    }
    if (!onnxPresent()) {
      return { ok: false, code: "MODEL_ARTIFACT_MISSING" };
    }
    // A promoted release: `build:release` runs the exact candidate smoke, the
    // mode build and the audit; then the normal E2E must also pass.
    await runNode(execPath, [npmExecPath, "run", "build:release"], {
      stdio: "inherit",
    });
    await runNode(execPath, [npmExecPath, "run", "test:e2e"], {
      stdio: "inherit",
    });
    return { ok: true, code: "RELEASE_TESTS_PASSED", mode };
  }

  if (mode !== "candidate") {
    return { ok: false, code: "MODEL_RELEASE_DESCRIPTOR_INVALID" };
  }

  if (!npmExecPath) {
    return { ok: false, code: "NPM_EXEC_PATH_MISSING" };
  }
  // Fail closed the moment the sealed ONNX binary has not been acquired.
  if (!onnxPresent()) {
    return { ok: false, code: "MODEL_ARTIFACT_MISSING" };
  }

  await runNode(execPath, [npmExecPath, "run", "model:verify"], {
    stdio: "inherit",
  });
  await runNode(execPath, [npmExecPath, "run", "build:model-smoke"], {
    stdio: "inherit",
  });
  const { exitCode } = await runToCode(
    execPath,
    [
      npmExecPath,
      "exec",
      // The `--` separator is mandatory: without it npm consumes
      // `--config playwright.model-smoke.config.ts` as its own option and
      // Playwright runs under the default config, which does not match the
      // smoke spec and reports "No tests found" (surfaced as
      // MODEL_SMOKE_SKIPPED). Everything after `--` is the child command.
      "--",
      "playwright",
      "test",
      "--config",
      "playwright.model-smoke.config.ts",
    ],
    { stdio: "inherit" },
  );

  // A skipped test (or a missing expected spec) is never tolerated.
  let report;
  try {
    report = await readPlaywrightReport();
  } catch {
    return { ok: false, code: "MODEL_SMOKE_SKIPPED", exitCode };
  }
  const specs = collectSpecStatuses(report);
  const ranExpectedSpec = specs.some((spec) => spec.file.endsWith(SMOKE_SPEC));
  const anySkipped = specs.some(
    (spec) =>
      spec.statuses.length === 0 ||
      spec.statuses.some((status) => status === "skipped"),
  );
  if (!ranExpectedSpec || anySkipped) {
    return { ok: false, code: "MODEL_SMOKE_SKIPPED", exitCode };
  }
  if (exitCode !== 0) {
    return { ok: false, code: "MODEL_SMOKE_FAILED", exitCode };
  }
  return { ok: true, code: "MODEL_SMOKE_PASSED", mode };
}

async function runCli() {
  const mode = argv[2];
  if (mode !== "candidate" && mode !== "release") {
    console.error(
      "usage: node scripts/run-real-model-tests.mjs candidate | release",
    );
    exit(2);
  }
  const result = await runRealModelTests({ mode });
  if (!result.ok) {
    console.error(`real-model tests BLOCKED — ${result.code}`);
    exit(result.exitCode && result.exitCode !== 0 ? result.exitCode : 1);
  }
  console.log(`real-model tests OK — ${result.code} (${result.mode})`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      `real-model tests FAILED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
