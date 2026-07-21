// The pure release-packaging matrix. Given the scientific gate decision (the
// closed release descriptor) and the published calibration profiles, it decides
// exactly what the package may contain and how far a runtime result may act. It
// derives NOTHING from user input and invents no rollout state: `reject` keeps
// the descriptor at `bundle-verified` while the ACTIVE runtime becomes
// `builtin`, and every ceiling is bounded by the rollout the science authorized.
//
// The function is intentionally pure and synchronous. Its inputs are the exact
// shapes produced by the Phase 1 closed parsers (contracts/model-release.ts and
// contracts/calibration-profile.ts); callers parse first, then apply the policy.
// Every guard throws an Error whose MESSAGE is a stable, greppable code.

/** The one tokenizer digest every promoted artifact must carry, forever. */
export const LOCKED_TOKENIZER_DIGEST =
  "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9";

function assertTokenizerLocked(tokenizerDigest, where) {
  if (tokenizerDigest !== LOCKED_TOKENIZER_DIGEST) {
    throw new Error(`TOKENIZER_DIGEST_NOT_LOCKED (${where})`);
  }
}

/**
 * Compares the descriptor's declared profile-digest set against the digests of
 * the profiles actually published. Order-independent, and duplicates on either
 * side are a hard failure.
 */
export function assertExactProfileSet(profileDigests, profiles) {
  const declared = [...profileDigests].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const actual = profiles
    .map((profile) => profile.profileDigest)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (
    new Set(declared).size !== declared.length ||
    new Set(actual).size !== actual.length
  ) {
    throw new Error("PROFILE_SET_MISMATCH (duplicate profile digest)");
  }
  if (declared.length !== actual.length) {
    throw new Error("PROFILE_SET_MISMATCH (count differs)");
  }
  for (let index = 0; index < declared.length; index += 1) {
    if (declared[index] !== actual[index]) {
      throw new Error("PROFILE_SET_MISMATCH (digest differs)");
    }
  }
}

/** Every profile must still be valid at the build instant. */
export function assertProfilesCurrent(profiles, now) {
  for (const profile of profiles) {
    if (!(Date.parse(profile.expiresAt) > now)) {
      throw new Error(`PROFILE_EXPIRED (${profile.profileId ?? "profile"})`);
    }
  }
}

/**
 * Resolves the packaging policy for a parsed release descriptor and its parsed
 * calibration profiles.
 *
 * @returns {{ includeTmr: boolean, activeRuntimeKind: "builtin" | "bundle", maximumActionCeiling: "indicator" | "hide" }}
 */
export function resolveReleasePolicy(release, profilesFile, now = Date.now()) {
  const profiles = profilesFile.profiles;

  if (release.gateDecision === "pending") {
    throw new Error("RELEASE_DECISION_PENDING");
  }

  // The locked tokenizer identity is required of every non-pending descriptor,
  // including a scientific reject.
  assertTokenizerLocked(release.tokenizerDigest, "release");

  if (release.gateDecision === "reject") {
    if (
      release.rolloutState !== "bundle-verified" ||
      release.profileDigests.length !== 0 ||
      profiles.length !== 0
    ) {
      throw new Error("REJECT_MUST_NOT_PUBLISH_PROFILES");
    }
    return {
      includeTmr: false,
      activeRuntimeKind: "builtin",
      maximumActionCeiling: "indicator",
    };
  }

  // Everything below is a PROMOTED decision (indicator-only or pass).
  if (release.evidenceDigest === null) {
    throw new Error("EVIDENCE_DIGEST_INVALID");
  }
  for (const profile of profiles) {
    assertTokenizerLocked(profile.tokenizerDigest, "profile");
  }
  assertExactProfileSet(release.profileDigests, profiles);
  assertProfilesCurrent(profiles, now);

  if (release.gateDecision === "indicator-only") {
    if (
      release.rolloutState !== "indicator" ||
      profiles.some((profile) => profile.actionCeiling !== "indicator")
    ) {
      throw new Error("INDICATOR_ONLY_ACTION_BYPASS");
    }
    return {
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "indicator",
    };
  }

  if (release.gateDecision === "pass") {
    if (
      release.rolloutState !== "indicator" &&
      release.rolloutState !== "actions"
    ) {
      throw new Error("PASS_ROLLOUT_NOT_PUBLIC");
    }
    for (const profile of profiles) {
      if (
        profile.lengthBucket === "50-79" &&
        profile.actionCeiling !== "indicator"
      ) {
        throw new Error("SHORT_TEXT_ACTION_BYPASS");
      }
    }
    return {
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling:
        release.rolloutState === "actions" ? "hide" : "indicator",
    };
  }

  throw new Error(`UNKNOWN_GATE_DECISION (${String(release.gateDecision)})`);
}
