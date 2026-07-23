#!/usr/bin/env node
// The reference-lane runner. It inspects the CANONICAL release descriptor and,
// for indicator-only/pass, installs the pinned Chrome for Testing, rebuilds and
// audits the canonical package, verifies the reference environment, runs the
// Playwright performance spec against `dist`, and finally enforces the budget
// gate — a regression BLOCKS the lane. For reject it audits the ABSENCE of the
// TMR and writes only the closed `not-applicable` receipt; no synthetic Task-5
// variant ever participates.
//
//   node scripts/run-release-performance.mjs \
//     --release models/cleanfeed-ptbr-v1/release.json \
//     --output test-results/tmr-release-performance.json
//
// NOTE (operator step): the REAL numbers require the pinned Chrome for Testing
// 150.0.7871.129 on the reference hardware (Windows 11 / 4 logical CPUs / 8 GiB
// / WASM). Where that binary is absent the run stops at browser install; the
// harness, the budget gate and their tests still PROVE the enforcement.

import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { argv, env, execPath, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import { assertReleasePerformanceEvidence } from "./assert-performance-report.mjs";
import {
  installLockedTestBrowser,
  loadTestBrowserLock,
  resolveLockedTestBrowser,
} from "./test-browser-lock.mjs";

function coded(code, message) {
  const error = new Error(`${code} — ${message}`);
  error.code = code;
  return error;
}

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveRepoPath(value) {
  return isAbsolute(value) ? value : join(repoRoot(), value);
}

/** Runs a command, inheriting stdio; a non-zero exit fails closed. */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot(),
      stdio: "inherit",
      env: { ...env, ...options.env },
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(coded("SUBPROCESS_FAILED", `${command} exited with ${code}`));
    });
  });
}

function runNpm(script, options) {
  const npm = env.npm_execpath;
  if (typeof npm === "string" && npm.length > 0) {
    return runCommand(execPath, [npm, "run", script], options);
  }
  return runCommand("npm", ["run", script], options);
}

function writeCanonical(value, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = join(
    dirname(outputPath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  renameSync(temporary, outputPath);
}

async function readReleaseDescriptor(releasePath) {
  let raw;
  try {
    raw = await readFile(releasePath, "utf8");
  } catch (error) {
    throw coded("RELEASE_UNREADABLE", `cannot read ${releasePath}: ${error}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw coded(
      "RELEASE_UNREADABLE",
      `${releasePath} is not valid JSON: ${error}`,
    );
  }
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
    if (flag === "--release") assign("releasePath");
    else if (flag === "--output") assign("outputPath");
    else if (flag === "--browser-lock") assign("browserLockPath");
    else throw coded("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
  }
  if (options.releasePath === undefined)
    throw coded("MISSING_FLAG", "--release is required");
  if (options.outputPath === undefined)
    throw coded("MISSING_FLAG", "--output is required");
  return options;
}

/**
 * Orchestrates the reference lane for a parsed descriptor. Kept exported so a
 * harness test can drive it with injected command runners.
 */
export async function runReleasePerformance(options) {
  const releasePath = resolveRepoPath(options.releasePath);
  const outputPath = resolveRepoPath(options.outputPath);
  const distDir = join(repoRoot(), "dist");
  const tmrDir = join(distDir, "models", "cleanfeed-ptbr-v1");

  const release = await readReleaseDescriptor(releasePath);
  const descriptorDigest = await canonicalSha256(release);
  const { gateDecision, rolloutState } = release;

  if (gateDecision === "pending" || rolloutState === "shadow") {
    throw coded(
      "RELEASE_NOT_ELIGIBLE",
      `gateDecision=${gateDecision} rolloutState=${rolloutState} cannot enter the reference lane`,
    );
  }

  await runNpm("build:release");
  await runNpm("audit:model");

  if (gateDecision === "reject") {
    if (existsSync(tmrDir)) {
      throw coded("REJECT_MUST_STRIP_TMR", `reject must not package ${tmrDir}`);
    }
    const evidence = {
      status: "not-applicable",
      gateDecision: "reject",
      rolloutState: "bundle-verified",
      descriptorDigest,
    };
    assertReleasePerformanceEvidence(evidence, {
      descriptorDigest,
      gateDecision,
      rolloutState,
      tmrDirectoryPresent: false,
    });
    writeCanonical(evidence, outputPath);
    console.log(
      `reference performance not-applicable — reject/bundle-verified, TMR absent (${descriptorDigest.slice(0, 12)}…)`,
    );
    return;
  }

  // indicator-only / pass: install the pinned browser and run the real spec.
  const lock = await loadTestBrowserLock(options.browserLockPath);
  await installLockedTestBrowser(lock);
  const { executablePath } = await resolveLockedTestBrowser(lock);

  const envFile = join(
    repoRoot(),
    "test-results",
    "reference-environment.json",
  );
  await runCommand(execPath, [
    join(repoRoot(), "scripts", "assert-reference-environment.mjs"),
    "--browser-lock",
    options.browserLockPath ?? join(repoRoot(), "tests", "browser-lock.json"),
    "--output",
    envFile,
  ]);

  await runCommand(
    "npx",
    ["playwright", "test", "tests/e2e/tmr-performance.spec.ts"],
    {
      env: {
        CLEANFEED_REFERENCE_EXECUTABLE: executablePath,
        CLEANFEED_REFERENCE_ENV_FILE: envFile,
        CLEANFEED_PERFORMANCE_OUTPUT: outputPath,
      },
    },
  );

  await runCommand(execPath, [
    join(repoRoot(), "scripts", "assert-performance-report.mjs"),
    outputPath,
    "--release",
    releasePath,
    "--parity",
    join(distDir, "runtime-parity.json"),
    "--browser-lock",
    options.browserLockPath ?? join(repoRoot(), "tests", "browser-lock.json"),
  ]);

  console.log(
    `reference performance measured — ${gateDecision}/${rolloutState} (${descriptorDigest.slice(0, 12)}…)`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runReleasePerformance(parseCliArgs(argv.slice(2))).catch((error) => {
    console.error(
      `reference performance BLOCKED — ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  });
}
