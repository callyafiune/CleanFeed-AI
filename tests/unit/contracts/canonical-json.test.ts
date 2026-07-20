import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "../../../contracts/canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys recursively and stays compact (sealed fix vector)", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
  });

  it("preserves array order but canonicalizes nested objects", () => {
    expect(canonicalJson([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe(
      '[{"a":1,"b":2},{"c":3,"d":4}]',
    );
  });

  it("serializes the empty array as []", () => {
    expect(canonicalJson([])).toBe("[]");
  });

  it("emits no trailing newline and no insignificant whitespace", () => {
    const output = canonicalJson({ a: [1, 2, 3], b: "x" });
    expect(output).toBe('{"a":[1,2,3],"b":"x"}');
    expect(output.endsWith("\n")).toBe(false);
  });

  it("is independent of the caller's key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("rejects undefined anywhere in the value", () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson({ a: Number.NEGATIVE_INFINITY })).toThrow();
  });

  it("rejects non-plain prototypes", () => {
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(new Map())).toThrow();
    class Custom {
      value = 1;
    }
    expect(() => canonicalJson(new Custom())).toThrow();
  });

  it("rejects dangerous prototype-polluting keys", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expect(() => canonicalJson(hostile)).toThrow();
  });

  it("rejects functions, symbols and bigint", () => {
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(Symbol("x"))).toThrow();
    expect(() => canonicalJson(10n)).toThrow();
  });
});

describe("canonicalSha256", () => {
  it("hashes the empty array to the sealed empty-set digest", async () => {
    expect(await canonicalSha256([])).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });

  it("is stable regardless of key order (same canonical bytes)", async () => {
    expect(await canonicalSha256({ z: 1, a: { y: 2, x: 3 } })).toBe(
      await canonicalSha256({ a: { x: 3, y: 2 }, z: 1 }),
    );
  });

  it("hashes the exact canonical UTF-8 bytes", async () => {
    // Independent SHA-256 of the canonical string '{"a":{"x":3,"y":2},"z":1}'.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update('{"a":{"x":3,"y":2},"z":1}', "utf8")
      .digest("hex");
    expect(await canonicalSha256({ z: 1, a: { y: 2, x: 3 } })).toBe(expected);
  });
});
