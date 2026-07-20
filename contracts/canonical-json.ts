// Canonical JSON serialization and SHA-256 digest, shared verbatim by the
// runtime (browser Web Crypto) and the benchmark/build tooling (Node
// `node:crypto`). Both paths hash EXACTLY the same canonical UTF-8 bytes, so a
// digest computed in one environment is byte-identical in the other.
//
// Canonicalization rules (non-negotiable — profiles, releases and cache keys
// depend on them):
//   - object keys sorted lexicographically, recursively;
//   - array order preserved;
//   - compact `JSON.stringify` (no spaces), no trailing newline;
//   - `undefined`, non-finite numbers, functions, symbols, bigint,
//     non-plain-prototype objects and prototype-polluting keys are REJECTED
//     before any bytes are produced (never silently coerced or dropped).

/** Thrown when a value cannot be canonicalized under the closed rules above. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively rebuilds `value` into a canonical, JSON-safe mirror: objects gain
 * lexicographically sorted keys, arrays keep their order, and every leaf is
 * validated. Rejection (never coercion) is the whole point — a NaN or a stray
 * `undefined` must fail loudly rather than become `null`.
 */
function canonicalize(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  const kind = typeof value;

  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(
        "non-finite numbers cannot be canonicalized",
      );
    }
    return value;
  }

  if (kind === "string" || kind === "boolean") {
    return value;
  }

  if (kind === "undefined") {
    throw new CanonicalJsonError("undefined cannot be canonicalized");
  }

  if (kind === "bigint" || kind === "function" || kind === "symbol") {
    throw new CanonicalJsonError(`${kind} cannot be canonicalized`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (kind === "object") {
    if (!isPlainObject(value as object)) {
      throw new CanonicalJsonError(
        "only plain objects (Object.prototype or null) can be canonicalized",
      );
    }

    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new CanonicalJsonError(`refusing to canonicalize key "${key}"`);
      }
      const child = source[key];
      if (child === undefined) {
        throw new CanonicalJsonError(
          `property "${key}" is undefined and cannot be canonicalized`,
        );
      }
      result[key] = canonicalize(child);
    }
    return result;
  }

  throw new CanonicalJsonError("value cannot be canonicalized");
}

/** Deterministic, key-sorted, compact JSON string for `value`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.subtle !== undefined) {
    const digest = await webCrypto.subtle.digest(
      "SHA-256",
      bytes as unknown as ArrayBuffer,
    );
    return toHex(new Uint8Array(digest));
  }

  // Node adapter: only reached where Web Crypto is absent. Fed the identical
  // canonical bytes, so the digest matches the browser path exactly.
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 (hex) of the canonical UTF-8 bytes of `value`. */
export async function canonicalSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return sha256Hex(bytes);
}
