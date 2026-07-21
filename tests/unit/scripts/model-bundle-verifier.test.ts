import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materializeModelBundle } from "../../../scripts/acquire-model-assets.mjs";
import { SOURCE_ARTIFACTS } from "../../../scripts/model-lock.mjs";
import {
  computeBundleDigest,
  computeCalibrationSetDigest,
  computeTokenizerDigest,
  RELEASE_INVENTORY,
  verifyMaterializedBundle,
  verifyModelMetadata,
  verifyReleaseModelDirectory,
} from "../../../scripts/verify-model-bundle.mjs";
import type { ArtifactRecord } from "../../../scripts/verify-model-bundle.mjs";
import {
  createCalibrationProfilesFileV1,
  createModelManifestV2,
  createReleaseDescriptorV1,
  createSourceArtifacts,
} from "../../helpers/model-fixtures";

const BUNDLE_DIGEST_LITERAL =
  "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c";
const TOKENIZER_DIGEST_LITERAL =
  "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9";
const EMPTY_SET_DIGEST =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

const TEN_FILE_INVENTORY = [
  "LICENSE",
  "NOTICE.md",
  "cleanfeed-model.json",
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

const TWELVE_FILE_INVENTORY = [
  "LICENSE",
  "NOTICE.md",
  "calibration-profiles.json",
  "cleanfeed-model.json",
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "release.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

const RELEASE_JSON_BYTES = '{ "release": "descriptor" }\n';
const PROFILES_JSON_BYTES = '{ "schemaVersion": 1, "profiles": [] }\n';

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Runs `fn`, returning the thrown error's `.code` (or undefined if none). */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function catchCodeAsync(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const lock = { artifacts: createSourceArtifacts() };

describe("canonical bundle/tokenizer digests", () => {
  it("computeBundleDigest over the pinned records equals the sealed literal", () => {
    expect(computeBundleDigest([...SOURCE_ARTIFACTS])).toBe(
      BUNDLE_DIGEST_LITERAL,
    );
  });

  it("computeTokenizerDigest over the pinned records equals the sealed literal", () => {
    expect(computeTokenizerDigest([...SOURCE_ARTIFACTS])).toBe(
      TOKENIZER_DIGEST_LITERAL,
    );
  });

  it("is order- and key-order-independent (proves the canonicalization, not a hardcode)", () => {
    // Reverse the record order and shuffle every record's KEY order. A correct
    // canonicalization (sort by path, alphabetical keys, compact separators)
    // must still land on the exact sealed literal.
    const scrambled: ArtifactRecord[] = [...SOURCE_ARTIFACTS]
      .reverse()
      .map((artifact) => ({
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        path: artifact.path,
      }));
    expect(computeBundleDigest(scrambled)).toBe(BUNDLE_DIGEST_LITERAL);
    expect(computeTokenizerDigest(scrambled)).toBe(TOKENIZER_DIGEST_LITERAL);
  });

  it("computeCalibrationSetDigest of the empty set is the canonical empty-set digest", () => {
    expect(computeCalibrationSetDigest([])).toBe(EMPTY_SET_DIGEST);
  });
});

describe("verifyModelMetadata (no local binary required)", () => {
  it("accepts a coherent manifest", () => {
    expect(() =>
      verifyModelMetadata({ manifest: createModelManifestV2(), lock }),
    ).not.toThrow();
  });

  it("accepts manifest + calibration + release together", () => {
    expect(() =>
      verifyModelMetadata({
        manifest: createModelManifestV2(),
        calibrationProfiles: createCalibrationProfilesFileV1(),
        release: createReleaseDescriptorV1(),
        lock,
      }),
    ).not.toThrow();
  });

  it("rejects an extra artifact", () => {
    const artifacts: ArtifactRecord[] = [
      ...createSourceArtifacts(),
      { path: "extra.bin", bytes: 1, sha256: "a".repeat(64) },
    ];
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ artifacts }),
          lock,
        }),
      ),
    ).toBe("ARTIFACT_SET_MISMATCH");
  });

  it("rejects a missing artifact", () => {
    const artifacts = createSourceArtifacts().slice(1);
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ artifacts }),
          lock,
        }),
      ),
    ).toBe("ARTIFACT_SET_MISMATCH");
  });

  it("rejects an artifact whose hash was altered", () => {
    const artifacts = createSourceArtifacts();
    artifacts[0] = { ...artifacts[0], sha256: "b".repeat(64) };
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ artifacts }),
          lock,
        }),
      ),
    ).toBe("ARTIFACT_SET_MISMATCH");
  });

  it("rejects an artifact whose size was altered", () => {
    const artifacts = createSourceArtifacts();
    artifacts[0] = { ...artifacts[0], bytes: artifacts[0].bytes + 1 };
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ artifacts }),
          lock,
        }),
      ),
    ).toBe("ARTIFACT_SET_MISMATCH");
  });

  it("rejects a divergent bundleDigest", () => {
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ bundleDigest: "0".repeat(64) }),
          lock,
        }),
      ),
    ).toBe("BUNDLE_DIGEST_MISMATCH");
  });

  it("rejects a divergent tokenizerDigest", () => {
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2({ tokenizerDigest: "0".repeat(64) }),
          lock,
        }),
      ),
    ).toBe("TOKENIZER_DIGEST_MISMATCH");
  });

  it("rejects a wrong schemaVersion", () => {
    const manifest = {
      ...createModelManifestV2(),
      schemaVersion: 3 as unknown as 2,
    };
    expect(catchCode(() => verifyModelMetadata({ manifest, lock }))).toBe(
      "MANIFEST_SCHEMA_INVALID",
    );
  });

  it("rejects a tampered fixed field (modelFile)", () => {
    const manifest = {
      ...createModelManifestV2(),
      modelFile: "onnx/other.onnx",
    };
    expect(catchCode(() => verifyModelMetadata({ manifest, lock }))).toBe(
      "MANIFEST_FIELD_INVALID",
    );
  });

  it("rejects an incoherent release calibrationSetDigest", () => {
    const release = createReleaseDescriptorV1({
      calibrationSetDigest: "0".repeat(64),
    });
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2(),
          release,
          lock,
        }),
      ),
    ).toBe("RELEASE_DIGEST_MISMATCH");
  });

  it("rejects a calibration file with the wrong schemaVersion", () => {
    const calibrationProfiles = {
      ...createCalibrationProfilesFileV1(),
      schemaVersion: 2 as unknown as 1,
    };
    expect(
      catchCode(() =>
        verifyModelMetadata({
          manifest: createModelManifestV2(),
          calibrationProfiles,
          lock,
        }),
      ),
    ).toBe("CALIBRATION_SCHEMA_INVALID");
  });
});

describe("verifyMaterializedBundle (exact ten-file inventory)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-bundle-verify-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** Writes a synthetic (small) but internally-consistent 10-file bundle. */
  async function writeSyntheticBundle(root: string): Promise<{
    lock: { artifacts: ArtifactRecord[] };
  }> {
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

    for (const [path, buffer] of Object.entries(contents)) {
      const filePath = join(root, ...path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    }
    await writeFile(
      join(root, "cleanfeed-model.json"),
      JSON.stringify(manifest, null, 2),
    );
    await writeFile(join(root, "LICENSE"), "MIT synthetic\n");
    await writeFile(join(root, "NOTICE.md"), "# synthetic notice\n");
    return { lock: { artifacts } };
  }

  it("accepts exactly the ten materialized paths", async () => {
    const root = join(workDir, "bundle");
    const { lock: syntheticLock } = await writeSyntheticBundle(root);
    const result = await verifyMaterializedBundle(root, {
      lock: syntheticLock,
    });
    expect(result.paths).toEqual([...TEN_FILE_INVENTORY]);
    expect(result.fileCount).toBe(10);
  });

  it("rejects a bundle missing a legal file", async () => {
    const root = join(workDir, "bundle");
    const { lock: syntheticLock } = await writeSyntheticBundle(root);
    await rm(join(root, "NOTICE.md"));
    expect(
      await catchCodeAsync(() =>
        verifyMaterializedBundle(root, { lock: syntheticLock }),
      ),
    ).toBe("BUNDLE_SET_MISMATCH");
  });

  it("rejects a bundle that copied license-review.json in", async () => {
    const root = join(workDir, "bundle");
    const { lock: syntheticLock } = await writeSyntheticBundle(root);
    await writeFile(join(root, "license-review.json"), "{}\n");
    expect(
      await catchCodeAsync(() =>
        verifyMaterializedBundle(root, { lock: syntheticLock }),
      ),
    ).toBe("BUNDLE_SET_MISMATCH");
  });

  it("rejects a bundle whose asset bytes were altered", async () => {
    const root = join(workDir, "bundle");
    const { lock: syntheticLock } = await writeSyntheticBundle(root);
    await writeFile(join(root, "config.json"), "tampered-longer-bytes\n");
    const code = await catchCodeAsync(() =>
      verifyMaterializedBundle(root, { lock: syntheticLock }),
    );
    expect(["SIZE_MISMATCH", "HASH_MISMATCH"]).toContain(code);
  });
});

describe("verifyReleaseModelDirectory (exact twelve-file package)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-release-dir-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /**
   * Writes a synthetic twelve-file release package plus a versioned metadata
   * dir whose release.json / calibration-profiles.json are byte-equal to the
   * packaged copies.
   */
  async function writeReleasePackage(): Promise<{
    target: string;
    metadataDir: string;
    lock: { artifacts: ArtifactRecord[] };
  }> {
    const target = join(workDir, "dist", "models", "tmr-ai-text-detector");
    const metadataDir = join(workDir, "models");
    await mkdir(target, { recursive: true });
    await mkdir(metadataDir, { recursive: true });

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
    await writeFile(join(target, "release.json"), RELEASE_JSON_BYTES);
    await writeFile(
      join(target, "calibration-profiles.json"),
      PROFILES_JSON_BYTES,
    );

    await writeFile(join(metadataDir, "release.json"), RELEASE_JSON_BYTES);
    await writeFile(
      join(metadataDir, "calibration-profiles.json"),
      PROFILES_JSON_BYTES,
    );
    return { target, metadataDir, lock: { artifacts } };
  }

  it("accepts exactly the twelve packaged paths", async () => {
    const {
      target,
      metadataDir,
      lock: syntheticLock,
    } = await writeReleasePackage();
    const result = await verifyReleaseModelDirectory(target, {
      lock: syntheticLock,
      metadataDir,
    });
    expect(result.paths).toEqual([...TWELVE_FILE_INVENTORY]);
    expect(result.fileCount).toBe(12);
    expect([...RELEASE_INVENTORY]).toEqual([...TWELVE_FILE_INVENTORY]);
  });

  it("rejects a package missing calibration-profiles.json", async () => {
    const {
      target,
      metadataDir,
      lock: syntheticLock,
    } = await writeReleasePackage();
    await rm(join(target, "calibration-profiles.json"));
    expect(
      await catchCodeAsync(() =>
        verifyReleaseModelDirectory(target, {
          lock: syntheticLock,
          metadataDir,
        }),
      ),
    ).toBe("RELEASE_SET_MISMATCH");
  });

  it("rejects a package that leaked a benchmark report", async () => {
    const {
      target,
      metadataDir,
      lock: syntheticLock,
    } = await writeReleasePackage();
    await writeFile(join(target, "benchmark-report.json"), "{}\n");
    expect(
      await catchCodeAsync(() =>
        verifyReleaseModelDirectory(target, {
          lock: syntheticLock,
          metadataDir,
        }),
      ),
    ).toBe("RELEASE_SET_MISMATCH");
  });

  it("rejects a packaged release.json that is not byte-equal to the versioned source", async () => {
    const {
      target,
      metadataDir,
      lock: syntheticLock,
    } = await writeReleasePackage();
    await writeFile(join(target, "release.json"), '{ "tampered": true }\n');
    expect(
      await catchCodeAsync(() =>
        verifyReleaseModelDirectory(target, {
          lock: syntheticLock,
          metadataDir,
        }),
      ),
    ).toBe("RELEASE_METADATA_DRIFT");
  });
});

describe("materializeModelBundle (seven -> ten promotion)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-materialize-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** Seeds a source staging (seven assets) and a versioned dir (three files). */
  async function seed(
    sourceDir: string,
    versionedDir: string,
  ): Promise<{ lock: { artifacts: ArtifactRecord[] } }> {
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
    for (const [path, buffer] of Object.entries(contents)) {
      const filePath = join(sourceDir, ...path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    }
    await mkdir(versionedDir, { recursive: true });
    await writeFile(
      join(versionedDir, "cleanfeed-model.json"),
      JSON.stringify(createModelManifestV2({ artifacts }), null, 2),
    );
    await writeFile(join(versionedDir, "LICENSE"), "MIT synthetic\n");
    await writeFile(join(versionedDir, "NOTICE.md"), "# synthetic notice\n");
    return { lock: { artifacts } };
  }

  it("promotes exactly the ten verified files into a fresh target", async () => {
    const sourceDir = join(workDir, "source");
    const versionedDir = join(workDir, "versioned");
    const target = join(workDir, "public", "tmr-ai-text-detector");
    await mkdir(dirname(target), { recursive: true });
    const { lock: syntheticLock } = await seed(sourceDir, versionedDir);

    const result = await materializeModelBundle({
      sourceStaging: sourceDir,
      versionedDir,
      target,
      lock: syntheticLock,
    });

    expect(result).toEqual({ fileCount: 10, target });
    const verified = await verifyMaterializedBundle(target, {
      lock: syntheticLock,
    });
    expect(verified.paths).toEqual([...TEN_FILE_INVENTORY]);
  });

  it("re-acquires from a fresh staging and leaves no staging siblings behind", async () => {
    const versionedDir = join(workDir, "versioned");
    const target = join(workDir, "public", "tmr-ai-text-detector");
    await mkdir(dirname(target), { recursive: true });

    const firstSource = join(workDir, "source-1");
    const { lock: syntheticLock } = await seed(firstSource, versionedDir);
    await materializeModelBundle({
      sourceStaging: firstSource,
      versionedDir,
      target,
      lock: syntheticLock,
    });

    const secondSource = join(workDir, "source-2");
    await seed(secondSource, join(workDir, "versioned-2"));
    await materializeModelBundle({
      sourceStaging: secondSource,
      versionedDir,
      target,
      lock: syntheticLock,
    });

    const remaining = await readdir(dirname(target));
    expect(remaining).toEqual(["tmr-ai-text-detector"]);
  });
});
