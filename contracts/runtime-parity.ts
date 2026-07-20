// Pure, closed runtime-parity contract. This module identifies the SAME
// inference core across the benchmark (Phase 2/3 scoring) and the shipped
// release (Phase 4), so a candidate can never be evaluated with one core and
// promoted with another. It touches NO Node, DOM or Chrome API: it depends only
// on the canonical-json digest helper from Phase 1.
//
// "Closed" means the parser validates every object against an exact key set with
// no coercion: any unknown key, wrong schemaVersion, malformed digest, or a
// `runtimeParityDigest` that no longer matches the recomputed self-digest is a
// hard failure. The script `scripts/runtime-parity.mjs` DERIVES the field values
// from repository bytes; this contract only defines the shape, seals the digest,
// and is consumed — never redeclared — by later phases.

import { canonicalSha256 } from "./canonical-json.ts";

export interface RuntimeParityManifestV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  inferenceCoreDigest: string;
  runtimeParityDigest: string;
}

export type RuntimeParityDigestInput = Omit<
  RuntimeParityManifestV1,
  "runtimeParityDigest"
>;

/** Coded, fail-closed error thrown by the runtime-parity parser. */
export class RuntimeParityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeParityError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RuntimeParityError(code, message);
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const ROOT_KEYS = [
  "schemaVersion",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "tokenizerDigest",
  "inferenceCoreDigest",
  "runtimeParityDigest",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail("RUNTIME_PARITY_SCHEMA_INVALID", `${label} must be an object`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail("RUNTIME_PARITY_SCHEMA_INVALID", `unknown key "${key}" in ${label}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("RUNTIME_PARITY_SCHEMA_INVALID", `${label} is missing key "${key}"`);
    }
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("RUNTIME_PARITY_FIELD_INVALID", `${name} must be a non-empty string`);
  }
  return value;
}

function lowercaseSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "RUNTIME_PARITY_FIELD_INVALID",
      `${name} must be a lowercase 64-character sha256 hex digest`,
    );
  }
  return value;
}

/**
 * SHA-256 (hex) of the canonical bytes of the eight identity fields. Because the
 * fields are flat primitives, the canonical serialization is exactly the
 * alphabetically key-sorted, compact JSON that `scripts/runtime-parity.mjs`
 * reproduces, so a digest computed by the Node build and by this contract match
 * byte for byte.
 */
export async function computeRuntimeParityDigest(
  value: RuntimeParityDigestInput,
): Promise<string> {
  return canonicalSha256({
    schemaVersion: value.schemaVersion,
    modelId: value.modelId,
    modelVersion: value.modelVersion,
    bundleDigest: value.bundleDigest,
    aggregationVersion: value.aggregationVersion,
    contentCompositionVersion: value.contentCompositionVersion,
    tokenizerDigest: value.tokenizerDigest,
    inferenceCoreDigest: value.inferenceCoreDigest,
  });
}

/** Closed parser for the runtime-parity manifest. Rejects any drift. */
export async function parseRuntimeParityManifestV1(
  value: unknown,
): Promise<RuntimeParityManifestV1> {
  const root = assertExactObject(value, "manifest", ROOT_KEYS, ROOT_KEYS);

  if (root.schemaVersion !== 1) {
    fail("RUNTIME_PARITY_SCHEMA_INVALID", "schemaVersion must be 1");
  }

  const digestInput: RuntimeParityDigestInput = {
    schemaVersion: 1,
    modelId: nonEmptyString(root.modelId, "modelId"),
    modelVersion: nonEmptyString(root.modelVersion, "modelVersion"),
    bundleDigest: lowercaseSha256(root.bundleDigest, "bundleDigest"),
    aggregationVersion: nonEmptyString(
      root.aggregationVersion,
      "aggregationVersion",
    ),
    contentCompositionVersion: nonEmptyString(
      root.contentCompositionVersion,
      "contentCompositionVersion",
    ),
    tokenizerDigest: lowercaseSha256(root.tokenizerDigest, "tokenizerDigest"),
    inferenceCoreDigest: lowercaseSha256(
      root.inferenceCoreDigest,
      "inferenceCoreDigest",
    ),
  };

  const runtimeParityDigest = lowercaseSha256(
    root.runtimeParityDigest,
    "runtimeParityDigest",
  );
  const expectedDigest = await computeRuntimeParityDigest(digestInput);
  if (expectedDigest !== runtimeParityDigest) {
    fail(
      "RUNTIME_PARITY_DIGEST_MISMATCH",
      "runtimeParityDigest does not match the recomputed runtime parity digest",
    );
  }

  return { ...digestInput, runtimeParityDigest };
}
