import { describe, expect, it, vi } from "vitest";

import {
  createValidatedRuntimeHost,
  crossValidateRuntimeDescriptor,
  loadRuntimeDescriptor,
  parseModelManifest,
  verifyModelBundle,
  type RuntimeDescriptor,
  type RuntimeDescriptorSources,
} from "@/inference/model-bundle";
import {
  buildCatalogCandidates,
  ModelCatalog,
  selectCatalogRuntime,
} from "@/inference/model-catalog";
import { computeCalibrationSetDigest } from "../../../contracts/calibration-profile";
import { promotedDescriptor } from "../../helpers/promoted-descriptor";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";
import bundledManifest from "../../../models/cleanfeed-ptbr-v1/cleanfeed-model.json";
import bundledRelease from "../../../models/cleanfeed-ptbr-v1/release.json";
import bundledProfiles from "../../../models/cleanfeed-ptbr-v1/calibration-profiles.json";
import bundledSourceLock from "../../../models/cleanfeed-ptbr-v1/source-lock.json";

const NOW = Date.parse("2026-07-20T00:00:00.000Z");

function validSources(): RuntimeDescriptorSources {
  return structuredClone({
    manifest: bundledManifest,
    release: bundledRelease,
    profiles: bundledProfiles,
    sourceLock: bundledSourceLock,
  });
}

describe("model bundles", () => {
  it("accepts an explicit binary AI/human manifest", () => {
    expect(parseModelManifest(validManifest)).toMatchObject({
      schemaVersion: 1,
      task: "ai_text_detection",
      labels: { human: 0, ai: 1 },
      maximumTokens: 256,
    });
  });

  it.each([
    { ...validManifest, labels: { human: 1, ai: 1 } },
    { ...validManifest, modelPath: "../../outside.onnx" },
    { ...validManifest, supportedLanguages: [] },
    { ...validManifest, license: "" },
    { ...validManifest, sha256: { model: "not-a-hash" } },
  ])("rejects unsafe or ambiguous manifest %#", (manifest) => {
    expect(() => parseModelManifest(manifest)).toThrowError(
      "MODEL_LOAD_FAILED",
    );
  });

  it("rejects a checksum array even when its string coercion is a valid digest", () => {
    expect(() =>
      parseModelManifest({
        ...validManifest,
        sha256: {
          ...validManifest.sha256,
          model: [validManifest.sha256.model],
        },
      }),
    ).toThrowError("MODEL_LOAD_FAILED");
  });

  it("verifies each bundle file below its extension-local model directory", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const body = input.endsWith(validManifest.modelPath)
        ? "model"
        : input.endsWith("tokenizer.json")
          ? "tokenizer"
          : "config";
      return new Response(body, { status: 200 });
    });

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).resolves.toEqual(parseModelManifest(validManifest));

    expect(fetchImpl).toHaveBeenCalledWith(
      `chrome-extension://cleanfeed/models/cleanfeed-detector-v1/${validManifest.modelPath}`,
      { redirect: "error" },
    );
  });

  it("rejects bundle fetches that leave their extension-local origin", async () => {
    const fetchImpl = vi.fn(async () => new Response("model", { status: 200 }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "https://models.example/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a fetched artifact whose checksum differs from its manifest", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("tampered", { status: 200 }),
    );

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("rejects a redirected local artifact response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      redirected: true,
      url: "",
      arrayBuffer: () => new Response("model").arrayBuffer(),
    }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("rejects a nonempty final URL outside the expected extension origin", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      redirected: false,
      url: "chrome-extension://another-extension/models/cleanfeed-detector-v1/model.onnx",
      arrayBuffer: () => new Response("model").arrayBuffer(),
    }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("indexes only validated local manifests by id", () => {
    const manifest = parseModelManifest(validManifest);
    const catalog = new ModelCatalog([manifest]);

    expect(catalog.get(manifest.id)).toEqual(manifest);
    expect(catalog.list()).toEqual([manifest]);
    expect(() =>
      catalog.add({ ...validManifest, id: "../../escape" }),
    ).toThrowError("MODEL_LOAD_FAILED");
  });
});

describe("runtime descriptor cross-validation", () => {
  it("loads and jointly validates the sealed bundle-verified descriptor", async () => {
    const descriptor = await loadRuntimeDescriptor(validSources());

    await expect(
      crossValidateRuntimeDescriptor(descriptor, NOW),
    ).resolves.toBeUndefined();
    expect(descriptor.release.rolloutState).toBe("bundle-verified");
    expect(descriptor.profiles.profiles).toHaveLength(0);
  });

  it("never constructs the host when the descriptor JSON is invalid", async () => {
    const createWorkerHost = vi.fn();
    const sources = validSources();
    (sources.manifest as { bundleDigest: unknown }).bundleDigest = "not-a-sha";

    await expect(
      createValidatedRuntimeHost(createWorkerHost, sources, NOW),
    ).rejects.toBeDefined();
    expect(createWorkerHost).not.toHaveBeenCalled();
  });

  it("never constructs the host when the manifest and release digests diverge", async () => {
    const createWorkerHost = vi.fn();
    const sources = validSources();
    (sources.release as { bundleDigest: string }).bundleDigest = "f".repeat(64);

    await expect(
      createValidatedRuntimeHost(createWorkerHost, sources, NOW),
    ).rejects.toBeDefined();
    expect(createWorkerHost).not.toHaveBeenCalled();
  });

  it("never constructs the host when the manifest carries an artifact absent from the source lock", async () => {
    const createWorkerHost = vi.fn();
    const sources = validSources();
    (sources.manifest as { artifacts: unknown[] }).artifacts.push({
      path: "extra.bin",
      bytes: 1,
      sha256: "a".repeat(64),
    });

    await expect(
      createValidatedRuntimeHost(createWorkerHost, sources, NOW),
    ).rejects.toBeDefined();
    expect(createWorkerHost).not.toHaveBeenCalled();
  });

  it("never constructs the host when a listed profile is already expired at init", async () => {
    const createWorkerHost = vi.fn();
    const profileDigest = "a".repeat(64);
    const setDigest = await computeCalibrationSetDigest([profileDigest]);
    const manifest = bundledManifest;
    const descriptor = {
      manifest: structuredClone(manifest),
      sourceLock: structuredClone(bundledSourceLock),
      release: {
        ...structuredClone(bundledRelease),
        rolloutState: "indicator",
        gateDecision: "pass",
        profileDigests: [profileDigest],
        calibrationSetDigest: setDigest,
        issuedAt: "2026-01-01T00:00:00.000Z",
        evidenceDigest: "b".repeat(64),
      },
      profiles: {
        schemaVersion: 1,
        profiles: [
          {
            profileId: "expired",
            modelId: manifest.modelId,
            modelVersion: manifest.modelVersion,
            bundleDigest: manifest.bundleDigest,
            tokenizerDigest: manifest.tokenizerDigest,
            aggregationVersion: manifest.aggregationVersion,
            contentCompositionVersion: manifest.contentCompositionVersion,
            profileDigest,
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        ],
      },
    } as unknown as RuntimeDescriptor;

    await expect(
      createValidatedRuntimeHost(
        createWorkerHost,
        undefined,
        NOW,
        async () => descriptor,
      ),
    ).rejects.toBeDefined();
    expect(createWorkerHost).not.toHaveBeenCalled();
  });
});

describe("chain-of-integrity guards of the runtime descriptor", () => {
  // Every forgery asserts the `code`, never a message substring: a
  // `RuntimeDescriptorError` message does not carry its own code, so
  // `rejects.toThrowError("PROFILE_SET_MISMATCH")` fails even against the correct
  // error and pressures the assertion down to a bare `rejects`, which passes for
  // any rejection — including the one a DIFFERENT guard raises.
  const rejectsWith = (code: string) => ({
    name: "RuntimeDescriptorError",
    code,
  });

  it("passes the promoted baseline untouched", async () => {
    const { descriptor } = await promotedDescriptor();

    await expect(
      crossValidateRuntimeDescriptor(descriptor, NOW),
    ).resolves.toBeUndefined();
    expect(descriptor.release.rolloutState).toBe("actions");
    expect(descriptor.profiles.profiles).toHaveLength(1);
  });

  it("refuses a manifest that does not match the sealed schema", async () => {
    const sources = validSources();
    // `task` is chosen because nothing downstream reads it: with the schema guard
    // disabled the whole pipeline resolves, so this test can only be green because
    // of the guard.
    (sources.manifest as { task: string }).task = "";

    await expect(loadRuntimeDescriptor(sources)).rejects.toMatchObject(
      rejectsWith("MANIFEST_SCHEMA_INVALID"),
    );
  });

  it("refuses a source lock that does not match the sealed schema", async () => {
    const sources = validSources();
    // `revision` and not `artifacts`: cross-validation compares only the artifact
    // list, so an `artifacts` forgery would be caught by ARTIFACT_MISMATCH whether
    // or not the schema guard exists.
    (sources.sourceLock as { revision: string }).revision = "";

    await expect(loadRuntimeDescriptor(sources)).rejects.toMatchObject(
      rejectsWith("SOURCE_LOCK_INVALID"),
    );
  });

  it("refuses a profile whose identity diverges from the manifest", async () => {
    // `promotedDescriptor` embeds the shared manifest and source-lock singletons,
    // so a mutation without cloning first would leak into every other test in the
    // process.
    const { descriptor } = await promotedDescriptor();
    const forged = structuredClone(descriptor);
    forged.profiles.profiles[0].aggregationVersion = "forged";

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("PROFILE_IDENTITY_MISMATCH"));
  });

  it("refuses two profiles carrying one digest", async () => {
    const { descriptor } = await promotedDescriptor();
    const forged = structuredClone(descriptor);
    forged.profiles.profiles.push(structuredClone(forged.profiles.profiles[0]));

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("DUPLICATE_PROFILE"));
  });

  it("refuses a release naming a profile set the file does not carry", async () => {
    const { descriptor } = await promotedDescriptor();
    const forged = structuredClone(descriptor);
    // The RELEASE side is mutated and `calibrationSetDigest` left alone. Forging
    // the file's digest instead would reach this same guard first — but only the
    // release-side forgery RESOLVES once this guard's throw is deleted, which is
    // the strongest red. The file-side one would fall through to
    // CALIBRATION_SET_MISMATCH: a rejection carrying the wrong code, not a pass.
    forged.release.profileDigests = ["b".repeat(64)];

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("PROFILE_SET_MISMATCH"));
  });

  // The three guards below cannot fire on a descriptor that came through
  // `loadRuntimeDescriptor` — but the release parser is not what closes the path.
  // It constrains `rolloutState` against `release.profileDigests` only, never
  // against the profiles FILE, which a different parser handles: a parsed
  // descriptor can carry a promoted state with an empty file. What makes the two
  // rollout guards unfireable is PROFILE_SET_MISMATCH refusing before them, so
  // reordering the guards reopens the path. For CALIBRATION_SET_MISMATCH the set
  // equality that same guard forces, plus the sort-and-dedupe inside the digest,
  // makes the condition itself false — there nothing refuses, because there is
  // nothing to refuse.
  //
  // They exist for the descriptor that arrives over `postMessage` at the inference
  // worker, which revalidates because it cannot verify who validated before it. A
  // direct call is the faithful model of that caller, not a shortcut around the
  // parser.

  it("refuses a release whose calibration digest is not the digest of its profile set", async () => {
    const { descriptor } = await promotedDescriptor();
    const forged = structuredClone(descriptor);
    forged.release.calibrationSetDigest = "0".repeat(64);

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("CALIBRATION_SET_MISMATCH"));
  });

  it("refuses a promoted rollout state carrying no profile", async () => {
    const descriptor = await loadRuntimeDescriptor(validSources());
    const forged = structuredClone(descriptor);
    // Flipping the state on the EMPTY sealed descriptor is the only single
    // mutation that reaches this guard: emptying the profiles of a promoted
    // release is caught by PROFILE_SET_MISMATCH before it.
    (forged.release as { rolloutState: string }).rolloutState = "indicator";

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("ROLLOUT_WITHOUT_PROFILES"));
  });

  it("refuses a bundle-verified rollout state carrying a profile", async () => {
    const { descriptor } = await promotedDescriptor();
    const forged = structuredClone(descriptor);
    (forged.release as { rolloutState: string }).rolloutState =
      "bundle-verified";

    await expect(
      crossValidateRuntimeDescriptor(forged, NOW),
    ).rejects.toMatchObject(rejectsWith("BUNDLE_VERIFIED_WITH_PROFILES"));
  });
});

describe("selectCatalogRuntime", () => {
  it.each([
    {
      rolloutState: "bundle-verified",
      validProfileCount: 0,
      buildMode: "production",
      primary: "stylometric",
      shadowTmr: false,
    },
    {
      rolloutState: "shadow",
      validProfileCount: 1,
      buildMode: "development",
      primary: "stylometric",
      shadowTmr: true,
    },
    {
      rolloutState: "shadow",
      validProfileCount: 1,
      buildMode: "production",
      primary: "stylometric",
      shadowTmr: false,
    },
    {
      rolloutState: "indicator",
      validProfileCount: 1,
      buildMode: "production",
      primary: "tmr",
      shadowTmr: false,
    },
    {
      rolloutState: "actions",
      validProfileCount: 1,
      buildMode: "development",
      primary: "tmr",
      shadowTmr: false,
    },
    {
      rolloutState: "indicator",
      validProfileCount: 0,
      buildMode: "production",
      primary: "stylometric",
      shadowTmr: false,
    },
    {
      rolloutState: "actions",
      validProfileCount: 0,
      buildMode: "production",
      primary: "stylometric",
      shadowTmr: false,
    },
  ] as const)(
    "maps $rolloutState/$validProfileCount/$buildMode to $primary (shadowTmr=$shadowTmr)",
    ({ rolloutState, validProfileCount, buildMode, primary, shadowTmr }) => {
      const selection = selectCatalogRuntime({
        rolloutState,
        validProfileCount,
        buildMode,
      });

      expect(selection.primary).toBe(primary);
      expect(selection.shadowTmr).toBe(shadowTmr);
    },
  );

  it("never uses the string 'fallback' as a release state and flags a promoted release with no usable profile", () => {
    const selection = selectCatalogRuntime({
      rolloutState: "indicator",
      validProfileCount: 0,
      buildMode: "production",
    });

    expect(selection.primary).toBe("stylometric");
    expect(selection.reasonCodes).toContain("MODEL_PROFILE_MISSING");
  });

  it("keeps the TMR candidate and the stylometric builtin as distinct identities", async () => {
    const descriptor = await loadRuntimeDescriptor(validSources());
    const candidates = buildCatalogCandidates(descriptor, {
      id: "stylometric-v1",
      version: "1.0.0",
    });

    expect(candidates.tmr).toMatchObject({
      kind: "bundle",
      modelId: descriptor.manifest.modelId,
      bundleDigest: descriptor.manifest.bundleDigest,
    });
    expect(candidates.stylometric).toEqual({
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    });
    expect(candidates.stylometric).not.toHaveProperty("bundleDigest");
    expect(candidates.stylometric).not.toHaveProperty("calibrationSetDigest");
  });
});
