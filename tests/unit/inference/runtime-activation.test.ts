import { describe, expect, it, vi } from "vitest";

import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import type { CalibrationCoordinates } from "@/inference/calibration-registry";
import type { RuntimeDescriptor } from "@/inference/model-bundle";
import { parseModelManifest } from "@/inference/model-bundle";
import {
  authorizesTmrPrimary,
  buildBundledRuntimeManifest,
  buildCalibratedRuntimeParts,
  buildWorkerInitializePayload,
} from "@/inference/runtime-activation";
import type { ClassifierMetadata, TextClassifier } from "@/shared/types";
import {
  fakeByteLevelTokenizer,
  promotedDescriptor,
} from "../../helpers/promoted-descriptor";

const BASE_URLS = {
  modelBaseUrl: "chrome-extension://abc/models/",
  wasmBaseUrl: "chrome-extension://abc/vendor/transformers-wasm/",
};

/** A minimal RuntimeDescriptor whose only relevant fields drive the gate. */
function descriptorWith(
  rolloutState: string,
  profileCount: number,
): RuntimeDescriptor {
  return {
    release: { rolloutState },
    profiles: { profiles: Array.from({ length: profileCount }, () => ({})) },
  } as unknown as RuntimeDescriptor;
}

function fakeClassifier(): TextClassifier {
  const metadata: ClassifierMetadata = {
    id: bundledModelManifest.modelId,
    name: "TMR",
    version: bundledModelManifest.modelVersion,
    backend: "wasm",
    supportedLanguages: ["pt"],
    maximumTokens: 512,
    supportsBatching: false,
  };
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => metadata,
  };
}

describe("authorizesTmrPrimary", () => {
  it("authorizes only a promoted release that ships at least one profile", () => {
    expect(authorizesTmrPrimary(descriptorWith("actions", 1))).toBe(true);
    expect(authorizesTmrPrimary(descriptorWith("indicator", 1))).toBe(true);
  });

  it("refuses a promoted release without profiles", () => {
    expect(authorizesTmrPrimary(descriptorWith("actions", 0))).toBe(false);
    expect(authorizesTmrPrimary(descriptorWith("indicator", 0))).toBe(false);
  });

  it("refuses non-promoted releases (pending/bundle-verified/shadow)", () => {
    expect(authorizesTmrPrimary(descriptorWith("bundle-verified", 0))).toBe(
      false,
    );
    expect(authorizesTmrPrimary(descriptorWith("shadow", 1))).toBe(false);
  });
});

describe("buildBundledRuntimeManifest", () => {
  it("derives a valid v1 manifest whose checksums come from the sealed artifacts", () => {
    const manifest = buildBundledRuntimeManifest();

    // It passes the closed v1 parser (schema, safe paths, binary labels, …).
    expect(() => parseModelManifest(manifest)).not.toThrow();
    expect(manifest.id).toBe(bundledModelManifest.modelId);
    expect(manifest.version).toBe(bundledModelManifest.modelVersion);
    const artifactSha = (path: string) =>
      bundledModelManifest.artifacts.find((a) => a.path === path)!.sha256;
    expect(manifest.sha256.model).toBe(
      artifactSha(bundledModelManifest.modelFile),
    );
    expect(manifest.sha256.tokenizer).toBe(artifactSha("tokenizer.json"));
    expect(manifest.sha256.config).toBe(artifactSha("config.json"));
  });
});

describe("buildWorkerInitializePayload", () => {
  it("carries the modelManifest ONLY when the descriptor authorizes TMR", async () => {
    const { descriptor } = await promotedDescriptor();

    const promoted = buildWorkerInitializePayload({ ...BASE_URLS, descriptor });
    expect(promoted.modelManifest).toEqual(buildBundledRuntimeManifest());
    // The descriptor always rides along for the worker's trust-boundary revalidation.
    expect(promoted.descriptor).toBe(descriptor);
  });

  it("omits the modelManifest for a pending/bundle-verified descriptor", () => {
    const payload = buildWorkerInitializePayload({
      ...BASE_URLS,
      descriptor: descriptorWith("bundle-verified", 0),
    });
    expect(payload.modelManifest).toBeUndefined();
    expect(payload.descriptor).toBeDefined();
    expect(payload.experimentalUncalibratedTmr).toBeUndefined();
  });

  it("loads the manifest UNCALIBRATED when the user opts into the experimental preview", () => {
    const payload = buildWorkerInitializePayload({
      ...BASE_URLS,
      descriptor: descriptorWith("bundle-verified", 0),
      experimentalUncalibratedTmr: true,
    });
    // The sealed model IS loaded, but the worker is told it is uncalibrated.
    expect(payload.modelManifest).toEqual(buildBundledRuntimeManifest());
    expect(payload.experimentalUncalibratedTmr).toBe(true);
  });

  it("prefers the CALIBRATED primary over the experimental flag for a promoted release", async () => {
    const { descriptor } = await promotedDescriptor();
    const payload = buildWorkerInitializePayload({
      ...BASE_URLS,
      descriptor,
      experimentalUncalibratedTmr: true,
    });
    // A promoted release is calibrated: the manifest loads, but it is NOT flagged
    // experimental (the calibrated registry, not the provisional mapping, decides).
    expect(payload.modelManifest).toEqual(buildBundledRuntimeManifest());
    expect(payload.experimentalUncalibratedTmr).toBeUndefined();
  });
});

describe("buildCalibratedRuntimeParts", () => {
  it("binds the sealed identity, a release-bound registry and an exact tokenizer", async () => {
    const { descriptor, profileDigest } = await promotedDescriptor();

    const parts = await buildCalibratedRuntimeParts({
      classifier: fakeClassifier(),
      descriptor,
      loadTokenizer: async () => fakeByteLevelTokenizer(),
    });

    // (1) The identity is the SEALED v2 bundle identity, carrying the release's
    // calibration-set digest — the coordinates the profiles were measured at.
    expect(parts.identity).toMatchObject({
      kind: "bundle",
      modelId: bundledModelManifest.modelId,
      bundleDigest: bundledModelManifest.bundleDigest,
      tokenizerDigest: bundledModelManifest.tokenizerDigest,
      aggregationVersion: bundledModelManifest.aggregationVersion,
      calibrationSetDigest: descriptor.release.calibrationSetDigest,
    });

    // (2) The registry findExact-matches at exactly that identity.
    const identity = parts.identity as Extract<
      typeof parts.identity,
      { kind: "bundle" }
    >;
    const coordinates: CalibrationCoordinates = {
      modelId: identity.modelId,
      modelVersion: identity.modelVersion,
      bundleDigest: identity.bundleDigest,
      tokenizerDigest: identity.tokenizerDigest,
      platform: "linkedin",
      locale: "pt",
      lengthBucket: "200-plus",
      aggregationVersion: identity.aggregationVersion,
      contentCompositionVersion: identity.contentCompositionVersion,
    };
    const lookup = parts.calibration.findExact(coordinates, Date.now());
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") {
      expect(lookup.profile.profileDigest).toBe(profileDigest);
    }

    // (3) The tokenizer reports EXACT native offsets tiling the text.
    const tokenized = await parts.tokenizer.encode("adoção");
    expect(tokenized.exact).toBe(true);
    expect(tokenized.spans[0]!.start).toBe(0);
    expect(tokenized.spans.at(-1)!.end).toBe("adoção".length);
  });

  it("encodes a post whose emoji and accented pt-BR bytes SPLIT across ByteLevel tokens without throwing", async () => {
    // ByteLevel-BPE virtually always splits a 4-byte emoji, and can split a
    // 2-byte accented pt-BR char whose byte-pair merge is absent. The producer
    // (deriveByteLevelOffsets) rounds each covering token OUTWARD to the full
    // char, yielding a legitimate shared/overlapping boundary (non-monotonic
    // START). The consumer (spansFromModelOffsets) must ACCEPT that instead of
    // throwing MODEL_TOKEN_OFFSETS_UNAVAILABLE — otherwise the whole post becomes
    // a hard classify error rather than a graceful chunk-planning input.
    const { descriptor } = await promotedDescriptor();
    const parts = await buildCalibratedRuntimeParts({
      classifier: fakeClassifier(),
      descriptor,
      loadTokenizer: async () => fakeByteLevelTokenizer(),
    });

    const text = "Olá 😀 coração";

    // The full buildCalibratedRuntimeParts → encode → spans path does NOT throw.
    const tokenized = await parts.tokenizer.encode(text);

    // Sane, coverage-clean spans: exact, tiling from 0 to the string length with a
    // non-decreasing END, every span well-formed and on code-point boundaries.
    expect(tokenized.exact).toBe(true);
    expect(tokenized.spans.length).toBeGreaterThan(0);
    expect(tokenized.spans[0]!.start).toBe(0);
    expect(tokenized.spans.at(-1)!.end).toBe(text.length);
    let previousEnd = 0;
    for (const { start, end } of tokenized.spans) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(text.length);
      expect(end).toBeGreaterThanOrEqual(previousEnd); // non-decreasing END
      // A well-formed (non-mid-codepoint) slice round-trips through UTF-16.
      const slice = text.slice(start, end);
      expect(slice).toBe(
        String.fromCodePoint(...Array.from(slice, (c) => c.codePointAt(0)!)),
      );
      previousEnd = end;
    }
    // The union of the (possibly overlapping) spans covers the whole document.
    const covered = new Set<number>();
    for (const { start, end } of tokenized.spans) {
      for (let index = start; index < end; index += 1) covered.add(index);
    }
    expect(covered.size).toBe(text.length);
  });
});
