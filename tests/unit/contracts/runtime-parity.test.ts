import { describe, expect, it } from "vitest";

import {
  computeRuntimeParityDigest,
  parseRuntimeParityManifestV1,
  type RuntimeParityManifestV1,
} from "../../../contracts/runtime-parity";

type ParityFields = Omit<RuntimeParityManifestV1, "runtimeParityDigest">;

const baseFields: ParityFields = {
  schemaVersion: 1,
  modelId: "cleanfeed-ptbr-v1",
  modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
  bundleDigest: "b".repeat(64),
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  tokenizerDigest:
    "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135",
  inferenceCoreDigest: "c".repeat(64),
};

async function buildManifest(
  overrides: Partial<ParityFields> = {},
): Promise<RuntimeParityManifestV1> {
  const fields: ParityFields = { ...baseFields, ...overrides };
  const runtimeParityDigest = await computeRuntimeParityDigest(fields);
  return { ...fields, runtimeParityDigest };
}

describe("runtime parity manifest", () => {
  it("round-trips a well-formed manifest", async () => {
    const manifest = await buildManifest();
    const parsed = await parseRuntimeParityManifestV1(manifest);
    expect(parsed).toEqual(manifest);
  });

  it("rejects a runtimeParityDigest that does not match the recomputed value", async () => {
    const manifest = await buildManifest();
    await expect(
      parseRuntimeParityManifestV1({
        ...manifest,
        runtimeParityDigest: "d".repeat(64),
      }),
    ).rejects.toThrow(/runtimeParityDigest/);
  });

  it("rejects an unknown key", async () => {
    const manifest = await buildManifest();
    await expect(
      parseRuntimeParityManifestV1({ ...manifest, extra: 1 }),
    ).rejects.toThrow(/unknown key/);
  });

  it("rejects a non-hex digest field", async () => {
    const manifest = await buildManifest();
    await expect(
      parseRuntimeParityManifestV1({ ...manifest, tokenizerDigest: "nope" }),
    ).rejects.toThrow(/tokenizerDigest/);
  });

  it("rejects a wrong schemaVersion", async () => {
    const manifest = await buildManifest();
    await expect(
      parseRuntimeParityManifestV1({ ...manifest, schemaVersion: 2 }),
    ).rejects.toThrow(/schemaVersion/);
  });

  it("binds every identity field into the digest", async () => {
    const baseline = await computeRuntimeParityDigest(baseFields);
    const mutations: ParityFields[] = [
      { ...baseFields, modelId: "other" },
      { ...baseFields, modelVersion: "other" },
      { ...baseFields, bundleDigest: "0".repeat(64) },
      { ...baseFields, aggregationVersion: "tmr-aggregation-v3" },
      { ...baseFields, contentCompositionVersion: "lexical-content-v2" },
      { ...baseFields, tokenizerDigest: "1".repeat(64) },
      { ...baseFields, inferenceCoreDigest: "2".repeat(64) },
    ];
    const digests = await Promise.all(
      mutations.map((mutated) => computeRuntimeParityDigest(mutated)),
    );
    for (const digest of digests) {
      expect(digest).not.toBe(baseline);
    }
  });
});
