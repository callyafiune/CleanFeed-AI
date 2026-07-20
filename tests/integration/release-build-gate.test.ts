import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runReleaseBuild } from "../../scripts/run-release-build.mjs";
import type { ReleaseRunnerDependencies } from "../../scripts/run-release-build.mjs";
import {
  createModelManifestV2,
  createReleaseDescriptorV1,
  createSourceArtifacts,
} from "../helpers/model-fixtures";

const repoRoot = process.cwd();
const HEX64 = "a".repeat(64);

interface RunnerCall {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
}

/** Records every runNode invocation so tests can prove order and env. */
function makeRunner(): {
  runNode: NonNullable<ReleaseRunnerDependencies["runNode"]>;
  calls: RunnerCall[];
} {
  const calls: RunnerCall[] = [];
  const runNode: NonNullable<ReleaseRunnerDependencies["runNode"]> = async (
    command,
    args,
    options = {},
  ) => {
    calls.push({ command, args, env: options.env });
  };
  return { runNode, calls };
}

function baseDeps(
  overrides: Partial<ReleaseRunnerDependencies> = {},
): ReleaseRunnerDependencies {
  return {
    execPath: "/fake/node",
    npmExecPath: "/fake/npm-cli.js",
    verifyBundle: async () => {},
    ...overrides,
  };
}

const lock = { artifacts: createSourceArtifacts() };
const manifest = createModelManifestV2();

describe("runReleaseBuild gate", () => {
  it("refuses a pending gate even with an approved license", async () => {
    const { runNode, calls } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({ gateDecision: "pending" }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({ ok: false, code: "MODEL_RELEASE_NOT_PROMOTED" });
    expect(calls).toEqual([]);
  });

  it("refuses an indicator gate whose license review is still pending", async () => {
    const { runNode, calls } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "indicator",
        profileDigests: ["d".repeat(64)],
      }),
      licenseReview: { status: "pending" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({ ok: false, code: "MODEL_LICENSE_NOT_APPROVED" });
    expect(calls).toEqual([]);
  });

  it("fails closed with NPM_EXEC_PATH_MISSING for a well-formed reject", async () => {
    const { runNode, calls } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "reject",
        evidenceDigest: HEX64,
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode, npmExecPath: undefined }),
    });
    expect(result).toEqual({ ok: false, code: "NPM_EXEC_PATH_MISSING" });
    expect(calls).toEqual([]);
  });

  it("rejects a reject descriptor with a null evidenceDigest", async () => {
    const { runNode } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "reject",
        evidenceDigest: null,
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({
      ok: false,
      code: "MODEL_RELEASE_DESCRIPTOR_INVALID",
    });
  });

  it("rejects a reject descriptor that still carries profiles", async () => {
    const { runNode } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "reject",
        evidenceDigest: HEX64,
        profileDigests: ["d".repeat(64)],
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({
      ok: false,
      code: "MODEL_RELEASE_DESCRIPTOR_INVALID",
    });
  });

  it("rejects an indicator descriptor with no profiles", async () => {
    const { runNode } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "indicator",
        profileDigests: [],
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({
      ok: false,
      code: "MODEL_RELEASE_DESCRIPTOR_INVALID",
    });
  });

  it("runs smoke, then a reject-mode build, then a reject-mode audit for a well-formed reject", async () => {
    const { runNode, calls } = makeRunner();
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "reject",
        evidenceDigest: HEX64,
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({ runNode }),
    });
    expect(result).toEqual({
      ok: true,
      code: "RELEASE_COMPLETED",
      mode: "reject",
    });
    expect(calls).toHaveLength(3);
    // Smoke first, without a release-mode env — proves the candidate is smoked
    // before anything is built.
    expect(calls[0].args).toEqual([
      "/fake/npm-cli.js",
      "run",
      "test:model:smoke",
    ]);
    expect(calls[0].env).toBeUndefined();
    expect(calls[1].args).toEqual(["/fake/npm-cli.js", "run", "build"]);
    expect(calls[1].env?.CLEANFEED_MODEL_RELEASE_MODE).toBe("reject");
    expect(calls[2].args).toEqual(["/fake/npm-cli.js", "run", "audit"]);
    expect(calls[2].env?.CLEANFEED_MODEL_RELEASE_MODE).toBe("reject");
  });

  it("verifies the bundle then builds+audits in package mode for an approved indicator gate", async () => {
    const { runNode, calls } = makeRunner();
    let verifiedDir: string | undefined;
    const result = await runReleaseBuild({
      release: createReleaseDescriptorV1({
        gateDecision: "indicator",
        profileDigests: ["d".repeat(64)],
      }),
      licenseReview: { status: "approved" },
      manifest,
      lock,
      bundleDir: "public/models/tmr-ai-text-detector",
      dependencies: baseDeps({
        runNode,
        verifyBundle: async (dir: string) => {
          verifiedDir = dir;
        },
      }),
    });
    expect(verifiedDir).toBe("public/models/tmr-ai-text-detector");
    expect(result).toEqual({
      ok: true,
      code: "RELEASE_COMPLETED",
      mode: "package",
    });
    expect(calls[1].env?.CLEANFEED_MODEL_RELEASE_MODE).toBe("package");
    expect(calls[2].env?.CLEANFEED_MODEL_RELEASE_MODE).toBe("package");
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
