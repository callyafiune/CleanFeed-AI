import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runReleaseBuild } from "../../scripts/run-release-build.mjs";
import type { ReleaseRunnerDependencies } from "../../scripts/run-release-build.mjs";
import type {
  ReleasePolicyDescriptor,
  ReleasePolicyProfilesFile,
} from "../../scripts/release-policy.mjs";

const repoRoot = process.cwd();
const FIXTURE_ROOT = join(repoRoot, "tests", "fixtures", "model-release");
const FUTURE = Date.parse("2026-08-01T00:00:00.000Z");

interface Fixture {
  release: ReleasePolicyDescriptor;
  profilesFile: ReleasePolicyProfilesFile;
}

async function readFixture(branch: string): Promise<Fixture> {
  const release = JSON.parse(
    await readFile(join(FIXTURE_ROOT, branch, "release.json"), "utf8"),
  );
  const profilesFile = JSON.parse(
    await readFile(
      join(FIXTURE_ROOT, branch, "calibration-profiles.json"),
      "utf8",
    ),
  );
  return { release, profilesFile };
}

/**
 * Builds an injected dependency set whose every side-effecting step records its
 * name into `order`. resolveReleasePolicy and assertDistributionLicense are left
 * to their real defaults so the policy matrix and the license gate get teeth.
 */
async function makeDeps(options: {
  branch: string;
  licenseStatus?: "approved" | "pending";
  variantMetadataDir?: string;
}): Promise<{
  dependencies: ReleaseRunnerDependencies;
  order: string[];
}> {
  const { release, profilesFile } = await readFixture(options.branch);
  const order: string[] = [];
  const record = (name: string) => async (): Promise<void> => {
    order.push(name);
  };

  const dependencies: ReleaseRunnerDependencies = {
    loadReleaseMetadata: async () => {
      order.push("loadMetadata");
      return {
        release,
        profilesFile,
        licenseReview: { status: options.licenseStatus ?? "approved" },
        sourceLock: { artifacts: [] },
        publicModelDirectory: "public/models/tmr-ai-text-detector",
        modelsDirectory: "models/tmr-ai-text-detector",
        evidenceDirectory: "benchmark/evidence/tmr-ptbr-v1",
        modelManifestPath: "models/tmr-ai-text-detector/cleanfeed-model.json",
        benchmarkReportPath:
          "benchmark/evidence/tmr-ptbr-v1/benchmark-report.json",
      };
    },
    verifySanitizedEvidence: record("evidence"),
    verifyBundle: record("verifyBundle"),
    runSmoke: record("smoke"),
    runViteBuild: record("vite"),
    buildParity: async () => {
      order.push("buildParity");
      return { runtimeParityDigest: "x" };
    },
    writeParity: record("writeParity"),
    assertParity: record("assertParity"),
    materializeMetadata: record("materialize"),
    verifyReleaseDir: record("verifyReleaseDir"),
    removePath: record("rm"),
    listPackagedFiles: async () => {
      order.push("listFiles");
      return [];
    },
    variantMetadataDir: options.variantMetadataDir,
  };
  return { dependencies, order };
}

async function build(dependencies: ReleaseRunnerDependencies) {
  return runReleaseBuild({
    repositoryRoot: repoRoot,
    publicDirectory: join(repoRoot, "public"),
    distDirectory: join(repoRoot, "dist"),
    now: FUTURE,
    dependencies,
  });
}

describe("runReleaseBuild — policy-driven staging", () => {
  it("fails closed on a pending descriptor before any build step", async () => {
    const { dependencies, order } = await makeDeps({ branch: "pending" });
    await expect(build(dependencies)).rejects.toThrow(
      "RELEASE_DECISION_PENDING",
    );
    expect(order).toEqual(["loadMetadata"]);
  });

  it("packages nothing and removes the TMR directory for a reject decision", async () => {
    const { dependencies, order } = await makeDeps({ branch: "reject" });
    const result = await build(dependencies);
    expect(result.includeTmr).toBe(false);
    expect(result.activeRuntimeKind).toBe("builtin");
    expect(result.maximumActionCeiling).toBe("indicator");
    expect(order).toContain("rm");
    expect(order).not.toContain("materialize");
    // The mandatory pre-build order: verify bundle -> smoke -> Vite -> stage.
    expect(order.indexOf("verifyBundle")).toBeLessThan(order.indexOf("smoke"));
    expect(order.indexOf("smoke")).toBeLessThan(order.indexOf("vite"));
    expect(order.indexOf("vite")).toBeLessThan(order.indexOf("rm"));
  });

  it("materializes the intact bundle for an approved indicator-only decision", async () => {
    const { dependencies, order } = await makeDeps({
      branch: "indicator-only",
    });
    const result = await build(dependencies);
    expect(result.includeTmr).toBe(true);
    expect(result.activeRuntimeKind).toBe("bundle");
    expect(result.maximumActionCeiling).toBe("indicator");
    expect(order).toContain("materialize");
    expect(order).toContain("verifyReleaseDir");
    expect(order).not.toContain("rm");
    expect(order.indexOf("smoke")).toBeLessThan(order.indexOf("vite"));
    expect(order.indexOf("vite")).toBeLessThan(order.indexOf("materialize"));
  });

  it("lifts the ceiling to hide for a pass/actions decision", async () => {
    const { dependencies } = await makeDeps({ branch: "pass-actions" });
    const result = await build(dependencies);
    expect(result.includeTmr).toBe(true);
    expect(result.maximumActionCeiling).toBe("hide");
  });

  it("blocks an indicator-only decision when the license is not approved", async () => {
    const { dependencies, order } = await makeDeps({
      branch: "indicator-only",
      licenseStatus: "pending",
    });
    await expect(build(dependencies)).rejects.toThrow(
      "MODEL_LICENSE_NOT_APPROVED",
    );
    expect(order).not.toContain("smoke");
    expect(order).not.toContain("vite");
  });

  it("still builds the reject fallback even when the license is not approved", async () => {
    const { dependencies, order } = await makeDeps({
      branch: "reject",
      licenseStatus: "pending",
    });
    const result = await build(dependencies);
    expect(result.includeTmr).toBe(false);
    expect(order).toContain("rm");
    expect(order).toContain("smoke");
  });

  it("refuses to build when release-test variant metadata is present", async () => {
    const { dependencies, order } = await makeDeps({
      branch: "indicator-only",
      variantMetadataDir: "/tmp/variant-metadata",
    });
    await expect(build(dependencies)).rejects.toThrow(
      "RELEASE_TEST_METADATA_FORBIDDEN",
    );
    // The forbidden metadata is caught after the bundle is verified but before
    // anything is smoked or built.
    expect(order).toContain("verifyBundle");
    expect(order).not.toContain("smoke");
    expect(order).not.toContain("vite");
  });
});

describe("audit-build.mjs reject mode", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-audit-reject-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function runAudit(
    distDir: string,
    mode: string,
  ): { status: number | null; output: string } {
    const result = spawnSync(
      process.execPath,
      ["scripts/audit-build.mjs", distDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, CLEANFEED_MODEL_RELEASE_MODE: mode },
      },
    );
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  it("passes a clean dist when the TMR dir is absent under reject", async () => {
    const distDir = join(workDir, "dist-clean");
    await cp(join(repoRoot, "tests", "fixtures", "secure-dist-min"), distDir, {
      recursive: true,
    });
    const { status } = runAudit(distDir, "reject");
    expect(status).toBe(0);
  });

  it("fails when the TMR dir is present under reject", async () => {
    const distDir = join(workDir, "dist-tmr");
    await cp(join(repoRoot, "tests", "fixtures", "secure-dist-min"), distDir, {
      recursive: true,
    });
    await mkdir(join(distDir, "models", "tmr-ai-text-detector", "onnx"), {
      recursive: true,
    });
    await writeFile(
      join(distDir, "models", "tmr-ai-text-detector", "config.json"),
      "{}\n",
    );
    const { status, output } = runAudit(distDir, "reject");
    expect(status).toBe(1);
    expect(output).toContain("tmr-ai-text-detector");
  });
});

describe("sanitize-offline-bundle.mjs release mode", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-sanitize-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function seedDist(): Promise<string> {
    const distDir = join(workDir, "dist");
    await mkdir(join(distDir, "models", "tmr-ai-text-detector"), {
      recursive: true,
    });
    await writeFile(
      join(distDir, "models", "tmr-ai-text-detector", "config.json"),
      "{}\n",
    );
    return distDir;
  }

  function runSanitize(mode: string | undefined): number | null {
    const env = { ...process.env };
    if (mode === undefined) delete env.CLEANFEED_MODEL_RELEASE_MODE;
    else env.CLEANFEED_MODEL_RELEASE_MODE = mode;
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts", "sanitize-offline-bundle.mjs")],
      { cwd: workDir, encoding: "utf8", env },
    );
    return result.status;
  }

  it("removes the TMR dir from dist under reject mode", async () => {
    const distDir = await seedDist();
    expect(runSanitize("reject")).toBe(0);
    await expect(
      stat(join(distDir, "models", "tmr-ai-text-detector")),
    ).rejects.toThrow();
  });

  it("keeps the TMR dir under package mode", async () => {
    const distDir = await seedDist();
    expect(runSanitize("package")).toBe(0);
    await expect(
      stat(join(distDir, "models", "tmr-ai-text-detector")),
    ).resolves.toBeDefined();
  });
});
