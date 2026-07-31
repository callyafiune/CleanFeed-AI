import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { derivePackagedPolicyFiles } from "../../../scripts/package-own-model.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const POLICY_DIRECTORY = join(REPO_ROOT, "models", "cleanfeed-ptbr-v1");

async function trackedPolicyFiles(): Promise<{
  licenseReviewJson: string;
  noticeText: string;
}> {
  return {
    licenseReviewJson: await readFile(
      join(POLICY_DIRECTORY, "license-review.json"),
      "utf8",
    ),
    noticeText: await readFile(join(POLICY_DIRECTORY, "NOTICE.md"), "utf8"),
  };
}

// scripts/package-own-model.mjs derives the two legal files of a freshly
// packaged model from the tracked ones instead of restating the licence policy
// in its own literals (which is how a repackage used to revert B1 silently).
// The derivation is pinned here as a pure function, so it is covered without
// packaging a bundle: the script itself needs an --artifacts export directory
// and would rewrite the model on disk.
describe("packaged licence-policy files", () => {
  it("keeps the frozen policy of the tracked review", async () => {
    const { licenseReviewJson, noticeText } = await trackedPolicyFiles();
    const tracked = JSON.parse(licenseReviewJson) as Record<string, unknown>;
    const { licenseReview } = derivePackagedPolicyFiles({
      licenseReviewJson,
      noticeText,
      modelId: "cleanfeed-ptbr-v2",
    });
    expect(licenseReview.commercialUse).toBe(tracked.commercialUse);
    expect(licenseReview.usePolicyId).toBe(tracked.usePolicyId);
    expect(licenseReview.sourceLicenses).toEqual(tracked.sourceLicenses);
    expect(licenseReview.sourceLicensesScope).toBe(tracked.sourceLicensesScope);
    expect(licenseReview.corpusObligations).toEqual(tracked.corpusObligations);
    expect(licenseReview.weightPolicy).toEqual(tracked.weightPolicy);
    expect(licenseReview.modelId).toBe("cleanfeed-ptbr-v2");
  });

  it("resets the review state, because a fresh package has no review", async () => {
    const { licenseReviewJson, noticeText } = await trackedPolicyFiles();
    const reviewed = JSON.stringify({
      ...(JSON.parse(licenseReviewJson) as Record<string, unknown>),
      status: "approved",
      reviewedAt: "2026-07-27T00:00:00.000Z",
      reviewer: "legal_a",
      evidence: ["receipt-1"],
    });
    const { licenseReview } = derivePackagedPolicyFiles({
      licenseReviewJson: reviewed,
      noticeText,
      modelId: "cleanfeed-ptbr-v2",
    });
    expect(licenseReview.status).toBe("pending");
    expect(licenseReview.reviewedAt).toBeNull();
    expect(licenseReview.reviewer).toBeNull();
    expect(licenseReview.evidence).toEqual([]);
  });

  it("changes only the NOTICE heading", async () => {
    const { licenseReviewJson, noticeText } = await trackedPolicyFiles();
    const { notice } = derivePackagedPolicyFiles({
      licenseReviewJson,
      noticeText,
      modelId: "cleanfeed-ptbr-v2",
    });
    const before = noticeText.split(/\r?\n/u);
    const after = notice.split(/\r?\n/u);
    expect(after[0]).toBe("# NOTICE — cleanfeed-ptbr-v2");
    expect(after.slice(1)).toEqual(before.slice(1));
    // The obligations paragraph is text, never regenerated from a literal.
    expect(notice).toContain("`commercialUse: false`");
  });
});
