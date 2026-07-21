export type ActiveRuntimeKind = "builtin" | "bundle";
export type MaximumActionCeiling = "indicator" | "hide";

export interface ReleasePackagingPolicy {
  includeTmr: boolean;
  activeRuntimeKind: ActiveRuntimeKind;
  maximumActionCeiling: MaximumActionCeiling;
}

/** The structural slice of the release descriptor the policy reads. */
export interface ReleasePolicyDescriptor {
  gateDecision: "pending" | "reject" | "indicator-only" | "pass";
  rolloutState: "bundle-verified" | "shadow" | "indicator" | "actions";
  profileDigests: readonly string[];
  tokenizerDigest: string;
  evidenceDigest: string | null;
}

/** The structural slice of a calibration profile the policy reads. */
export interface ReleasePolicyProfile {
  profileId?: string;
  profileDigest: string;
  tokenizerDigest: string;
  lengthBucket: "50-79" | "80-199" | "200-plus";
  actionCeiling: "indicator" | "hide";
  expiresAt: string;
}

export interface ReleasePolicyProfilesFile {
  profiles: readonly ReleasePolicyProfile[];
}

export declare const LOCKED_TOKENIZER_DIGEST: string;

export declare function assertExactProfileSet(
  profileDigests: readonly string[],
  profiles: readonly ReleasePolicyProfile[],
): void;

export declare function assertProfilesCurrent(
  profiles: readonly ReleasePolicyProfile[],
  now: number,
): void;

export declare function resolveReleasePolicy(
  release: ReleasePolicyDescriptor,
  profilesFile: ReleasePolicyProfilesFile,
  now?: number,
): ReleasePackagingPolicy;
