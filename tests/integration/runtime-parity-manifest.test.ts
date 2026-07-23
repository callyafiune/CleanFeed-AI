import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeRuntimeParityDigest,
  parseRuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import {
  buildRuntimeParityManifest,
  computeInferenceCoreDigest,
} from "../../scripts/runtime-parity.mjs";

// The repository root, resolved from this test file's location.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_MODEL_MANIFEST = join(
  REPO_ROOT,
  "models",
  "cleanfeed-ptbr-v1",
  "cleanfeed-model.json",
);
const CANDIDATE_ENTRY = join(REPO_ROOT, "src", "model-benchmark", "main.ts");

// The fixed inference-core files OUTSIDE src/inference, mirrored from the owner
// script so the synthetic repo is a faithful, minimal inference core.
const FIXED_CORE_FILES = [
  "contracts/calibration-profile.ts",
  "contracts/content-composition.ts",
  "contracts/model-release.ts",
  "contracts/runtime-parity.ts",
  "package-lock.json",
  "src/offscreen/worker-host.ts",
  "src/shared/constants.ts",
  "src/shared/types.ts",
];

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  created.length = 0;
});

async function writeRepoFile(
  repoRoot: string,
  relative: string,
  content: string,
): Promise<void> {
  const target = join(repoRoot, ...relative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function syntheticCore(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "cf-parity-int-"));
  created.push(repoRoot);
  for (const relative of FIXED_CORE_FILES) {
    await writeRepoFile(
      repoRoot,
      relative,
      `// ${relative}\nexport const x = 1;\n`,
    );
  }
  await writeRepoFile(
    repoRoot,
    "src/inference/model-runtime.ts",
    "// synthetic inference core\nexport const core = 1;\n",
  );
  return repoRoot;
}

describe("Phase 3 runtime parity manifest binding", () => {
  it("binds the real inference core: the owner script builds a manifest the closed contract accepts", async () => {
    const manifest = await buildRuntimeParityManifest({
      repoRoot: REPO_ROOT,
      modelManifestPath: REAL_MODEL_MANIFEST,
    });
    // The parity digest is a pure function of the eight identity fields, INCLUDING
    // the inference-core digest — so it binds the core.
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

  it("changes the inference-core digest and the parity digest when one core byte changes", async () => {
    const repoRoot = await syntheticCore();
    const before = await computeInferenceCoreDigest(repoRoot);
    await writeRepoFile(
      repoRoot,
      "src/inference/model-runtime.ts",
      "// synthetic inference core (tampered)\nexport const core = 2;\n",
    );
    const after = await computeInferenceCoreDigest(repoRoot);
    expect(after).not.toBe(before);

    // The bound parity digest follows the core digest.
    const fields = {
      schemaVersion: 1 as const,
      modelId: "cleanfeed-ptbr-v1",
      modelVersion: "1.0.0",
      bundleDigest: "a".repeat(64),
      aggregationVersion: "tmr-aggregation-v2",
      contentCompositionVersion: "lexical-content-v1",
      tokenizerDigest: "b".repeat(64),
    };
    expect(
      await computeRuntimeParityDigest({
        ...fields,
        inferenceCoreDigest: before,
      }),
    ).not.toBe(
      await computeRuntimeParityDigest({
        ...fields,
        inferenceCoreDigest: after,
      }),
    );
  });

  it("rejects an emitted manifest whose parity digest no longer matches its core (embedded/emitted drift)", async () => {
    const manifest = await buildRuntimeParityManifest({
      repoRoot: REPO_ROOT,
      modelManifestPath: REAL_MODEL_MANIFEST,
    });
    // Emit a manifest that keeps the trusted parity digest but swaps in a second
    // inference core: the closed contract refuses the drift.
    const drifted = {
      ...manifest,
      inferenceCoreDigest: "c".repeat(64),
    };
    await expect(parseRuntimeParityManifestV1(drifted)).rejects.toThrow(
      /RUNTIME_PARITY_DIGEST_MISMATCH|does not match/u,
    );
  });

  it("keeps the candidate browser entry importing only the exact uncalibrated TMR core", async () => {
    const source = await readFile(CANDIDATE_ENTRY, "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);

    const forbidden = [
      "backend-selector",
      "calibration-registry",
      "calibration",
      "release-selector",
      "stylometr",
      "presentation",
      "builtin-runtime",
      "/dist",
      "dist/",
    ];
    for (const specifier of specifiers) {
      for (const needle of forbidden) {
        expect(
          specifier.includes(needle),
          `candidate entry must not import "${specifier}" (matched forbidden "${needle}")`,
        ).toBe(false);
      }
      // Every extension-internal import stays inside the inference core / shared
      // types; nothing reaches presentation, product state or a second model.
      if (specifier.startsWith("@/")) {
        expect(
          specifier.startsWith("@/inference/") ||
            specifier.startsWith("@/shared/"),
          `candidate entry import "${specifier}" is outside the inference core`,
        ).toBe(true);
      }
    }
  });
});
