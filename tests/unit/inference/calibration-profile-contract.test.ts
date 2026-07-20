// @vitest-environment node
// Runs in the Node environment: this boundary test loads the benchmark package
// through real file URLs and reads its sources from disk, which the default
// jsdom environment (http-scheme import.meta.url) cannot do.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  computeCalibrationProfileDigest,
  parseCalibrationProfilesFileV1,
} from "../../../contracts/calibration-profile";
import {
  computeCalibrationSetDigest,
  parseModelReleaseDescriptorV1,
} from "../../../contracts/model-release";

// The benchmark module is loaded through a runtime file URL (not a static
// import) on purpose: the `benchmark/**` package is executed by Node's native
// TypeScript with explicit `.ts` import specifiers, which the app's `tsc`
// program (no `allowImportingTsExtensions`) rejects. Loading it dynamically
// keeps this typechecked test off that path while still exercising the real
// builder and the real Phase 1 parsers at the shared boundary.
type ModelPublication = { profiles: unknown; release: unknown };
type BuildModelPublication = (input: unknown) => Promise<ModelPublication>;

async function loadBuilder(): Promise<{
  buildModelPublication: BuildModelPublication;
  passInput: unknown;
  rejectInput: unknown;
}> {
  const builderUrl = new URL(
    "../../../benchmark/profile-artifact.ts",
    import.meta.url,
  ).href;
  const fixturesUrl = new URL(
    "../../../benchmark/tests/profile-artifact.fixtures.ts",
    import.meta.url,
  ).href;
  const builder = (await import(builderUrl)) as {
    buildModelPublication: BuildModelPublication;
  };
  const fixtures = (await import(fixturesUrl)) as {
    passInput: unknown;
    rejectInput: unknown;
  };
  return {
    buildModelPublication: builder.buildModelPublication,
    passInput: fixtures.passInput,
    rejectInput: fixtures.rejectInput,
  };
}

describe("calibration profile / release runtime boundary", () => {
  it("produces profiles and a release that pass the Phase 1 parsers with recomputed digests", async () => {
    const { buildModelPublication, passInput } = await loadBuilder();
    const publication = await buildModelPublication(passInput);

    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    const release = await parseModelReleaseDescriptorV1(publication.release);

    expect(profiles.profiles.length).toBe(3);
    for (const profile of profiles.profiles) {
      const recomputed = await computeCalibrationProfileDigest(profile);
      expect(recomputed).toBe(profile.profileDigest);
    }
    const setDigest = await computeCalibrationSetDigest(release.profileDigests);
    expect(setDigest).toBe(release.calibrationSetDigest);
    expect(release.profileDigests).toEqual(
      profiles.profiles.map((profile) => profile.profileDigest),
    );
    expect(release.rolloutState).toBe("indicator");
    expect(release.gateDecision).toBe("pass");
  });

  it("publishes an empty, self-consistent set for a reject", async () => {
    const { buildModelPublication, rejectInput } = await loadBuilder();
    const publication = await buildModelPublication(rejectInput);

    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    const release = await parseModelReleaseDescriptorV1(publication.release);

    expect(profiles.profiles).toEqual([]);
    expect(release.profileDigests).toEqual([]);
    expect(release.calibrationSetDigest).toBe(
      await computeCalibrationSetDigest([]),
    );
    expect(release.gateDecision).toBe("reject");
    expect(release.rolloutState).toBe("bundle-verified");
  });

  it("keeps every benchmark module free of extension-bundle (src/) imports", async () => {
    const benchmarkDir = fileURLToPath(
      new URL("../../../benchmark/", import.meta.url),
    );
    const entries = await readdir(benchmarkDir, {
      recursive: true,
      withFileTypes: true,
    });
    const specifierPatterns = [
      /(?:import|export)\b[^"'`]*?from\s*["'`]([^"'`]+)["'`]/g,
      /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
      /^\s*import\s*["'`]([^"'`]+)["'`]/gm,
    ];
    const isSrcImport = (specifier: string): boolean =>
      /^@\//.test(specifier) || /(?:\.\.\/)+src(?:\/|$)/.test(specifier);

    const importViolations: Array<{ file: string; specifier: string }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const path = `${entry.parentPath}/${entry.name}`;
      const content = await readFile(path, "utf8");
      for (const pattern of specifierPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const specifier = match[1];
          if (isSrcImport(specifier)) {
            importViolations.push({ file: path, specifier });
          }
        }
      }
    }

    expect(importViolations).toEqual([]);
  });
});
