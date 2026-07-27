import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeRuntimeParityDigest,
  parseRuntimeParityManifestV1,
} from "../../../contracts/runtime-parity";
import {
  buildRuntimeParityManifest,
  parseRuntimeParityCliArgs,
  writeRuntimeParityManifest,
} from "../../../scripts/runtime-parity.mjs";
import {
  computeBundleDigest,
  computeTokenizerDigest,
} from "../../../scripts/verify-model-bundle.mjs";

// The sealed manifest whose tokenizer/bundle digests the parity script
// recomputes from the artifact records (never from disk). Imported from the
// checked-in source of truth so a re-pin regenerates these expectations.
import sealedManifest from "../../../models/cleanfeed-ptbr-v1/cleanfeed-model.json";

const MODEL_MANIFEST = sealedManifest;

const CORE_FILES = [
  "contracts/calibration-profile.ts",
  "contracts/content-composition.ts",
  "contracts/model-release.ts",
  "contracts/runtime-parity.ts",
  "contracts/text-normalization.ts",
  "package-lock.json",
  "src/offscreen/worker-host.ts",
  "src/shared/constants.ts",
  "src/shared/types.ts",
  "src/inference/aggregator.ts",
  "src/inference/classifier.ts",
];

async function writeRepoFile(
  repoRoot: string,
  relative: string,
  content: string,
): Promise<void> {
  const target = join(repoRoot, ...relative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixtureRepo(
  manifest: unknown = MODEL_MANIFEST,
): Promise<{ repoRoot: string; modelManifestPath: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "cf-parity-"));
  created.push(repoRoot);
  for (const relative of CORE_FILES) {
    await writeRepoFile(
      repoRoot,
      relative,
      `// ${relative}\nexport const x = 1;\n`,
    );
  }
  const modelManifestPath = join(
    repoRoot,
    "models",
    "cleanfeed-ptbr-v1",
    "cleanfeed-model.json",
  );
  await mkdir(dirname(modelManifestPath), { recursive: true });
  await writeFile(modelManifestPath, JSON.stringify(manifest, null, 2));
  return { repoRoot, modelManifestPath };
}

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  created.length = 0;
});

describe("runtime parity script", () => {
  it("builds a manifest the pure contract accepts, binding the pinned tokenizer digest", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const manifest = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });

    expect(manifest.tokenizerDigest).toBe(sealedManifest.tokenizerDigest);
    expect(manifest.bundleDigest).toBe(sealedManifest.bundleDigest);
    expect(manifest.runtimeParityDigest).toBe(
      await computeRuntimeParityDigest({
        schemaVersion: manifest.schemaVersion,
        modelId: manifest.modelId,
        modelVersion: manifest.modelVersion,
        bundleDigest: manifest.bundleDigest,
        aggregationVersion: manifest.aggregationVersion,
        contentCompositionVersion: manifest.contentCompositionVersion,
        tokenizerDigest: manifest.tokenizerDigest,
        inferenceCoreDigest: manifest.inferenceCoreDigest,
      }),
    );
    await expect(parseRuntimeParityManifestV1(manifest)).resolves.toEqual(
      manifest,
    );
  });

  it("is deterministic across identical builds", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const a = await buildRuntimeParityManifest({ repoRoot, modelManifestPath });
    const b = await buildRuntimeParityManifest({ repoRoot, modelManifestPath });
    expect(b.runtimeParityDigest).toBe(a.runtimeParityDigest);
  });

  it("changes the digest when an inference-core file changes", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const before = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    await writeRepoFile(
      repoRoot,
      "src/inference/aggregator.ts",
      "// tampered\n",
    );
    const after = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    expect(after.runtimeParityDigest).not.toBe(before.runtimeParityDigest);
    expect(after.inferenceCoreDigest).not.toBe(before.inferenceCoreDigest);
  });

  it("changes the digest when the lockfile changes", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const before = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    await writeRepoFile(repoRoot, "package-lock.json", '{"tampered":true}\n');
    const after = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    expect(after.runtimeParityDigest).not.toBe(before.runtimeParityDigest);
  });

  it("changes the digest when a tokenizer asset changes", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const before = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });

    const tampered = structuredClone(MODEL_MANIFEST);
    tampered.artifacts = tampered.artifacts.map((artifact) =>
      artifact.path === "vocab.txt"
        ? { ...artifact, sha256: "9".repeat(64) }
        : artifact,
    );
    tampered.tokenizerDigest = computeTokenizerDigest(tampered.artifacts);
    tampered.bundleDigest = computeBundleDigest(tampered.artifacts);
    const other = await fixtureRepo(tampered);
    const after = await buildRuntimeParityManifest({
      repoRoot: other.repoRoot,
      modelManifestPath: other.modelManifestPath,
    });
    expect(after.runtimeParityDigest).not.toBe(before.runtimeParityDigest);
  });

  it("does not change the digest when a non-inventoried harness file changes", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const before = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    await writeRepoFile(repoRoot, "scripts/harness-shell.mjs", "// shell\n");
    const after = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    expect(after.runtimeParityDigest).toBe(before.runtimeParityDigest);
  });

  it("fails closed when the manifest tokenizerDigest does not match its records", async () => {
    const other = await fixtureRepo({
      ...MODEL_MANIFEST,
      tokenizerDigest: "7".repeat(64),
    });
    await expect(
      buildRuntimeParityManifest({
        repoRoot: other.repoRoot,
        modelManifestPath: other.modelManifestPath,
      }),
    ).rejects.toThrow();
  });

  it("fails closed on an un-inventoried extra file under src/inference", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    await writeRepoFile(repoRoot, "src/inference/notes.md", "not source\n");
    await expect(
      buildRuntimeParityManifest({ repoRoot, modelManifestPath }),
    ).rejects.toThrow();
  });

  it("writes runtime-parity.json that round-trips through the parser", async () => {
    const { repoRoot, modelManifestPath } = await fixtureRepo();
    const manifest = await buildRuntimeParityManifest({
      repoRoot,
      modelManifestPath,
    });
    const outputDir = join(repoRoot, "out");
    await writeRuntimeParityManifest(manifest, outputDir);
    const written = JSON.parse(
      await readFile(join(outputDir, "runtime-parity.json"), "utf8"),
    );
    await expect(parseRuntimeParityManifestV1(written)).resolves.toEqual(
      manifest,
    );
  });
});

describe("runtime parity CLI", () => {
  it("parses the single closed write subcommand", () => {
    const args = parseRuntimeParityCliArgs([
      "write",
      "--model-manifest",
      "models/cleanfeed-ptbr-v1/cleanfeed-model.json",
      "--output-dir",
      "benchmark/work/runtime-parity",
    ]);
    expect(args.command).toBe("write");
    expect(args.outputDir).toBe("benchmark/work/runtime-parity");
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseRuntimeParityCliArgs(["read"])).toThrow();
  });

  it("rejects an unknown flag", () => {
    expect(() =>
      parseRuntimeParityCliArgs([
        "write",
        "--model-manifest",
        "m.json",
        "--output-dir",
        "out",
        "--inputs",
        "a,b",
      ]),
    ).toThrow();
  });
});
