/** The tracked legal files a repackage derives from, as contents and not paths. */
export interface PackagedPolicyInput {
  licenseReviewJson: string;
  noticeText: string;
  modelId: string;
}

export interface PackagedPolicyFiles {
  licenseReview: Record<string, unknown>;
  notice: string;
}

export declare function derivePackagedPolicyFiles(
  input: PackagedPolicyInput,
): PackagedPolicyFiles;
