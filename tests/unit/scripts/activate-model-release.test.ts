import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activateModelRelease } from "../../../scripts/activate-model-release.mjs";
import type { ActivationDependencies } from "../../../scripts/activate-model-release.mjs";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "model-release");
const EVIDENCE_DIGEST =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARITY_DIGEST = "9".repeat(64);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cleanfeed-activate-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Stages a fixture branch plus a coherent minimal evidence dir. */
async function stage(
  branch: string,
  overrides: { reportDigest?: string; scientificEvidenceDigest?: string } = {},
): Promise<{
  releasePath: string;
  profilesPath: string;
  evidenceDir: string;
}> {
  const modelDir = join(workDir, branch, "model");
  const evidenceDir = join(workDir, branch, "evidence");
  await mkdir(modelDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await cp(
    join(FIXTURE_ROOT, branch, "release.json"),
    join(modelDir, "release.json"),
  );
  await cp(
    join(FIXTURE_ROOT, branch, "calibration-profiles.json"),
    join(modelDir, "calibration-profiles.json"),
  );
  await writeFile(
    join(evidenceDir, "evidence-digest.json"),
    JSON.stringify({
      scientificEvidenceDigest:
        overrides.scientificEvidenceDigest ?? EVIDENCE_DIGEST,
      publicationDigest: "7".repeat(64),
    }),
  );
  await writeFile(
    join(evidenceDir, "benchmark-report.json"),
    JSON.stringify({
      reportDigest: overrides.reportDigest ?? EVIDENCE_DIGEST,
      runtimeParityDigest: PARITY_DIGEST,
    }),
  );
  return {
    releasePath: join(modelDir, "release.json"),
    profilesPath: join(modelDir, "calibration-profiles.json"),
    evidenceDir,
  };
}

/** A no-op published-evidence verifier so the transition logic is isolated. */
const passingEvidence: ActivationDependencies = {
  verifyPublishedEvidence: async () => {},
};

describe("activateModelRelease — monotonic pass/indicator -> pass/actions", () => {
  it("advances only rolloutState and preserves every scientific field", async () => {
    const { releasePath, profilesPath, evidenceDir } =
      await stage("pass-indicator");
    const before = JSON.parse(await readFile(releasePath, "utf8"));

    const result = await activateModelRelease({
      releasePath,
      profilesPath,
      evidenceDir,
      expectedEvidenceDigest: EVIDENCE_DIGEST,
      dependencies: passingEvidence,
    });

    expect(result.activated).toBe(true);
    expect(result.rolloutState).toBe("actions");

    const after = JSON.parse(await readFile(releasePath, "utf8"));
    expect(after.rolloutState).toBe("actions");
    // Every field other than rolloutState is byte-for-byte unchanged.
    delete before.rolloutState;
    delete after.rolloutState;
    expect(after).toEqual(before);
  });

  it("is idempotent on pass/actions and rewrites no bytes", async () => {
    const { releasePath, profilesPath, evidenceDir } =
      await stage("pass-actions");
    const before = await readFile(releasePath, "utf8");
    const result = await activateModelRelease({
      releasePath,
      profilesPath,
      evidenceDir,
      expectedEvidenceDigest: EVIDENCE_DIGEST,
      dependencies: passingEvidence,
    });
    expect(result.activated).toBe(false);
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });

  it("does not activate indicator-only and rewrites no bytes", async () => {
    const { releasePath, profilesPath, evidenceDir } =
      await stage("indicator-only");
    const before = await readFile(releasePath, "utf8");
    const result = await activateModelRelease({
      releasePath,
      profilesPath,
      evidenceDir,
      expectedEvidenceDigest: EVIDENCE_DIGEST,
      dependencies: passingEvidence,
    });
    expect(result.activated).toBe(false);
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });

  it("does not activate reject and rewrites no bytes", async () => {
    const { releasePath, profilesPath, evidenceDir } = await stage("reject");
    const before = await readFile(releasePath, "utf8");
    const result = await activateModelRelease({
      releasePath,
      profilesPath,
      evidenceDir,
      expectedEvidenceDigest: EVIDENCE_DIGEST,
      dependencies: passingEvidence,
    });
    expect(result.activated).toBe(false);
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });

  it("refuses to activate pending and rewrites no bytes", async () => {
    const { releasePath, profilesPath, evidenceDir } = await stage("pending");
    const before = await readFile(releasePath, "utf8");
    await expect(
      activateModelRelease({
        releasePath,
        profilesPath,
        evidenceDir,
        dependencies: passingEvidence,
      }),
    ).rejects.toThrow("RELEASE_DECISION_PENDING");
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });
});

describe("activateModelRelease — evidence and atomicity teeth", () => {
  it("fails on a divergent benchmark-report reportDigest without touching the file", async () => {
    const { releasePath, profilesPath, evidenceDir } = await stage(
      "pass-indicator",
      { reportDigest: "b".repeat(64) },
    );
    const before = await readFile(releasePath, "utf8");
    await expect(
      activateModelRelease({
        releasePath,
        profilesPath,
        evidenceDir,
        expectedEvidenceDigest: EVIDENCE_DIGEST,
        dependencies: passingEvidence,
      }),
    ).rejects.toThrow("EVIDENCE_DIGEST_MISMATCH");
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });

  it("fails when --expected-evidence-digest disagrees with the descriptor", async () => {
    const { releasePath, profilesPath, evidenceDir } =
      await stage("pass-indicator");
    const before = await readFile(releasePath, "utf8");
    await expect(
      activateModelRelease({
        releasePath,
        profilesPath,
        evidenceDir,
        expectedEvidenceDigest: "c".repeat(64),
        dependencies: passingEvidence,
      }),
    ).rejects.toThrow("EVIDENCE_DIGEST_MISMATCH");
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });

  it("leaves release.json byte-identical when the atomic rename fails", async () => {
    const { releasePath, profilesPath, evidenceDir } =
      await stage("pass-indicator");
    const before = await readFile(releasePath, "utf8");
    const failingRename: ActivationDependencies = {
      verifyPublishedEvidence: async () => {},
      rename: async () => {
        throw new Error("simulated rename failure");
      },
    };
    await expect(
      activateModelRelease({
        releasePath,
        profilesPath,
        evidenceDir,
        expectedEvidenceDigest: EVIDENCE_DIGEST,
        dependencies: failingRename,
      }),
    ).rejects.toThrow("simulated rename failure");
    expect(await readFile(releasePath, "utf8")).toBe(before);
  });
});
