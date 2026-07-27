import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auditModelPackage } from "../../scripts/audit-model-package.mjs";
import type { AuditModelPackageDependencies } from "../../scripts/audit-model-package.mjs";
import { computeRuntimeParityDigest } from "../../scripts/runtime-parity.mjs";
import {
  createModelManifestV2,
  createSourceArtifacts,
} from "../helpers/model-fixtures";
import type { ArtifactRecord } from "../../scripts/verify-model-bundle.mjs";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "model-release");
const NOW = Date.parse("2026-08-01T00:00:00.000Z");
const PARITY_DIGEST_FIELDS = {
  schemaVersion: 1 as const,
  modelId: "cleanfeed-ptbr-v1",
  modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
  bundleDigest:
    "2d47d6f3e0a6f2c7836b03c9a47b1b81f6c34159aa35ae1bdffe3507e4dc25bc",
  aggregationVersion: "tmr-aggregation-v3",
  contentCompositionVersion: "lexical-content-v1",
  tokenizerDigest:
    "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135",
  inferenceCoreDigest: "5".repeat(64),
};
const PARITY_DIGEST = computeRuntimeParityDigest(PARITY_DIGEST_FIELDS);

/** Skip the evidence-chain + runtime-parity layers to isolate package content. */
const isolateContent: AuditModelPackageDependencies = {
  verifyEvidenceChain: async () => {},
  verifyRuntimeParity: async () => {},
};

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cleanfeed-pkg-audit-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Builds internally-consistent synthetic assets, manifest and lock. */
function synthetic(): {
  contents: Record<string, Buffer>;
  artifacts: ArtifactRecord[];
  manifest: ReturnType<typeof createModelManifestV2>;
  lock: { artifacts: ArtifactRecord[] };
} {
  const contents: Record<string, Buffer> = {};
  for (const artifact of createSourceArtifacts()) {
    contents[artifact.path] = Buffer.from(`synthetic :: ${artifact.path}`);
  }
  const artifacts: ArtifactRecord[] = createSourceArtifacts().map(
    (artifact) => ({
      path: artifact.path,
      bytes: contents[artifact.path].length,
      sha256: sha256(contents[artifact.path]),
    }),
  );
  const manifest = createModelManifestV2({ artifacts });
  return { contents, artifacts, manifest, lock: { artifacts } };
}

/**
 * Stages a metadata dir (release/profiles/lock) for a fixture branch and,
 * for a packaged branch, a matching 12-file dist bundle. Returns the paths.
 */
async function stage(
  branch: string,
  options: { includeBundle: boolean },
): Promise<{
  distDir: string;
  metadataDir: string;
  target: string;
  lock: { artifacts: ArtifactRecord[] };
}> {
  const distDir = join(workDir, branch, "dist");
  const metadataDir = join(workDir, branch, "metadata");
  const target = join(distDir, "models", "cleanfeed-ptbr-v1");
  await mkdir(distDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });

  const releaseBytes = await readFile(
    join(FIXTURE_ROOT, branch, "release.json"),
  );
  const profilesBytes = await readFile(
    join(FIXTURE_ROOT, branch, "calibration-profiles.json"),
  );
  await writeFile(join(metadataDir, "release.json"), releaseBytes);
  await writeFile(
    join(metadataDir, "calibration-profiles.json"),
    profilesBytes,
  );

  const { contents, manifest, lock } = synthetic();
  await writeFile(
    join(metadataDir, "source-lock.json"),
    JSON.stringify({ artifacts: lock.artifacts }, null, 2),
  );
  // The versioned metadata dir also carries the legal + manifest sources that
  // are materialized into the package.
  await writeFile(
    join(metadataDir, "cleanfeed-model.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(join(metadataDir, "LICENSE"), "MIT synthetic\n");
  await writeFile(join(metadataDir, "NOTICE.md"), "# synthetic notice\n");

  if (options.includeBundle) {
    await mkdir(target, { recursive: true });
    for (const [path, buffer] of Object.entries(contents)) {
      const filePath = join(target, ...path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    }
    await writeFile(
      join(target, "cleanfeed-model.json"),
      JSON.stringify(manifest, null, 2),
    );
    await writeFile(join(target, "LICENSE"), "MIT synthetic\n");
    await writeFile(join(target, "NOTICE.md"), "# synthetic notice\n");
    await writeFile(join(target, "release.json"), releaseBytes);
    await writeFile(join(target, "calibration-profiles.json"), profilesBytes);
  }

  return { distDir, metadataDir, target, lock };
}

async function run(
  distDir: string,
  metadataDir: string,
  lock: { artifacts: ArtifactRecord[] },
  extra: AuditModelPackageDependencies = {},
): Promise<string | undefined> {
  try {
    await auditModelPackage({
      distDir,
      metadataDir,
      evidenceDir: join(workDir, "no-evidence"),
      now: NOW,
      dependencies: { ...isolateContent, lock, ...extra },
    });
    return undefined;
  } catch (error) {
    return (error as { message?: string }).message;
  }
}

describe("auditModelPackage — reject omits the model", () => {
  it("passes a reject dist with no TMR directory", async () => {
    const { distDir, metadataDir, lock } = await stage("reject", {
      includeBundle: false,
    });
    expect(await run(distDir, metadataDir, lock)).toBeUndefined();
  });

  it("fails a reject dist that still carries a stray TMR directory", async () => {
    const { distDir, metadataDir, target, lock } = await stage("reject", {
      includeBundle: false,
    });
    await mkdir(join(target, "onnx"), { recursive: true });
    await writeFile(join(target, "config.json"), "{}\n");
    expect(await run(distDir, metadataDir, lock)).toContain(
      "MODEL_MUST_BE_ABSENT",
    );
  });
});

describe("auditModelPackage — packaged inventory has teeth", () => {
  it("passes an intact indicator-only 12-file package", async () => {
    const { distDir, metadataDir, lock } = await stage("indicator-only", {
      includeBundle: true,
    });
    expect(await run(distDir, metadataDir, lock)).toBeUndefined();
  });

  it("passes an intact pass/actions 12-file package", async () => {
    const { distDir, metadataDir, lock } = await stage("pass-actions", {
      includeBundle: true,
    });
    expect(await run(distDir, metadataDir, lock)).toBeUndefined();
  });

  it("fails when a required legal file is missing", async () => {
    const { distDir, metadataDir, target, lock } = await stage(
      "indicator-only",
      { includeBundle: true },
    );
    await rm(join(target, "NOTICE.md"));
    expect(await run(distDir, metadataDir, lock)).toBeDefined();
  });

  it("fails when the packaged release.json is missing", async () => {
    const { distDir, metadataDir, target, lock } = await stage("pass-actions", {
      includeBundle: true,
    });
    await rm(join(target, "release.json"));
    expect(await run(distDir, metadataDir, lock)).toBeDefined();
  });

  it("fails when a packaged asset's bytes were altered", async () => {
    const { distDir, metadataDir, target, lock } = await stage(
      "indicator-only",
      { includeBundle: true },
    );
    await writeFile(join(target, "config.json"), "tampered-longer-bytes\n");
    expect(await run(distDir, metadataDir, lock)).toBeDefined();
  });

  it("fails when the packaged release.json is not byte-equal to the versioned source", async () => {
    const { distDir, metadataDir, target, lock } = await stage("pass-actions", {
      includeBundle: true,
    });
    await writeFile(join(target, "release.json"), "{}\n");
    expect(await run(distDir, metadataDir, lock)).toBeDefined();
  });

  it("fails with UNEXPECTED_MODEL_FILE when a benchmark report leaks into the package", async () => {
    const { distDir, metadataDir, target, lock } = await stage(
      "indicator-only",
      { includeBundle: true },
    );
    await writeFile(join(target, "release-report.json"), "{}\n");
    expect(await run(distDir, metadataDir, lock)).toContain(
      "UNEXPECTED_MODEL_FILE",
    );
  });
});

describe("auditModelPackage — runtime parity and evidence chain", () => {
  async function writeParity(distDir: string, digest: string): Promise<void> {
    await writeFile(
      join(distDir, "runtime-parity.json"),
      JSON.stringify(
        { ...PARITY_DIGEST_FIELDS, runtimeParityDigest: digest },
        null,
        2,
      ),
    );
  }

  async function writeEvidence(
    evidenceDir: string,
    options: { reportDigest: string; parityDigest: string },
  ): Promise<void> {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      join(evidenceDir, "evidence-digest.json"),
      JSON.stringify({
        scientificEvidenceDigest: "a".repeat(64),
        publicationDigest: "7".repeat(64),
      }),
    );
    await writeFile(
      join(evidenceDir, "benchmark-report.json"),
      JSON.stringify({
        reportDigest: options.reportDigest,
        runtimeParityDigest: options.parityDigest,
      }),
    );
  }

  it("fails RUNTIME_PARITY_MISMATCH when dist runtime-parity disagrees with the report", async () => {
    const { distDir, metadataDir, lock } = await stage("indicator-only", {
      includeBundle: true,
    });
    const evidenceDir = join(workDir, "ev-parity");
    await writeParity(distDir, PARITY_DIGEST);
    await writeEvidence(evidenceDir, {
      reportDigest: "a".repeat(64),
      parityDigest: "0".repeat(64),
    });
    let message: string | undefined;
    try {
      await auditModelPackage({
        distDir,
        metadataDir,
        evidenceDir,
        now: NOW,
        dependencies: { lock, verifyEvidenceChain: async () => {} },
      });
    } catch (error) {
      message = (error as { message?: string }).message;
    }
    expect(message).toContain("RUNTIME_PARITY_MISMATCH");
  });

  it("fails when the evidence digest chain diverges", async () => {
    const { distDir, metadataDir, lock } = await stage("indicator-only", {
      includeBundle: true,
    });
    const evidenceDir = join(workDir, "ev-chain");
    await writeParity(distDir, PARITY_DIGEST);
    await writeEvidence(evidenceDir, {
      reportDigest: "b".repeat(64),
      parityDigest: PARITY_DIGEST,
    });
    let message: string | undefined;
    try {
      await auditModelPackage({
        distDir,
        metadataDir,
        evidenceDir,
        now: NOW,
        dependencies: {
          lock,
          verifyRuntimeParity: async () => {},
          verifyPublishedEvidence: async () => {},
        },
      });
    } catch (error) {
      message = (error as { message?: string }).message;
    }
    expect(message).toContain("EVIDENCE_DIGEST_MISMATCH");
  });

  it("passes a fully coherent packaged release end to end", async () => {
    const { distDir, metadataDir, lock } = await stage("pass-actions", {
      includeBundle: true,
    });
    const evidenceDir = join(workDir, "ev-ok");
    await writeParity(distDir, PARITY_DIGEST);
    await writeEvidence(evidenceDir, {
      reportDigest: "a".repeat(64),
      parityDigest: PARITY_DIGEST,
    });
    await expect(
      auditModelPackage({
        distDir,
        metadataDir,
        evidenceDir,
        now: NOW,
        dependencies: { lock, verifyPublishedEvidence: async () => {} },
      }),
    ).resolves.toBeUndefined();
  });
});
