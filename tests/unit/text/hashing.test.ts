import { describe, expect, it } from "vitest";

import { sha256 } from "@/shared/hashing";

describe("sha256", () => {
  it("returns the deterministic lowercase SHA-256 digest", async () => {
    await expect(sha256("CleanFeed")).resolves.toBe(
      "06c7c4ce641409981d9847c9ccdae314497abcce9e0ab92b14c7956908e125e2",
    );
  });

  it("does not expose input text in its digest", async () => {
    const text = "texto privado que não deve aparecer no resultado";

    await expect(sha256(text)).resolves.not.toContain(text);
  });
});
