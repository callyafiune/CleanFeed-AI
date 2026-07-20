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

// A copy of the sealed manifest whose tokenizer/bundle digests the parity
// script recomputes from the artifact records (never from disk).
const MODEL_MANIFEST = {
  schemaVersion: 2,
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  task: "text-classification",
  backend: "transformers-onnx",
  modelFile: "onnx/model_int8.onnx",
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  tokenizerDigest:
    "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
  windowing: {
    modelMaxTokens: 512,
    contentTokens: 510,
    overlapTokens: 64,
    maxWindows: 8,
  },
  artifacts: [
    {
      path: "config.json",
      bytes: 866,
      sha256:
        "d9d45b537b9cf386a0ce958f8b2f840b0529ed846e45c4e26bc53a62dcb06f1f",
    },
    {
      path: "merges.txt",
      bytes: 456318,
      sha256:
        "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5",
    },
    {
      path: "onnx/model_int8.onnx",
      bytes: 125855418,
      sha256:
        "a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79",
    },
    {
      path: "special_tokens_map.json",
      bytes: 958,
      sha256:
        "f23c8e6099631c233c16d9bf8dab198f610826cdd1b358f270f6d55c1863e857",
    },
    {
      path: "tokenizer.json",
      bytes: 3558741,
      sha256:
        "1f33749d010b4d63908e5c174c341622cb45039dd73a139dcd95bd74cc7e304b",
    },
    {
      path: "tokenizer_config.json",
      bytes: 1354,
      sha256:
        "288b4077af1ffb3beead6d96fccfc93beb2df9b689cbb038c4eb329165efc43a",
    },
    {
      path: "vocab.json",
      bytes: 798293,
      sha256:
        "ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e",
    },
  ],
  bundleDigest:
    "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c",
};

const CORE_FILES = [
  "contracts/calibration-profile.ts",
  "contracts/content-composition.ts",
  "contracts/model-release.ts",
  "contracts/runtime-parity.ts",
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
    "tmr-ai-text-detector",
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

    expect(manifest.tokenizerDigest).toBe(
      "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
    );
    expect(manifest.bundleDigest).toBe(
      "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c",
    );
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
      artifact.path === "vocab.json"
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
      "models/tmr-ai-text-detector/cleanfeed-model.json",
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
