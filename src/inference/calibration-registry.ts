import { normalizeCalibrationLocale } from "@/inference/model-runtime";
import {
  computeCalibrationSetDigest,
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
  type LengthBucketV1,
  type RuntimeCalibrationProfileV1,
} from "../../contracts/calibration-profile";
import {
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../../contracts/model-release";

/**
 * The nine coordinates that uniquely identify a calibration profile. `locale` is
 * normalized (`pt`/`pt-BR` → `pt-BR`) before it forms the lookup key so the two
 * tags share one profile, and every other coordinate must match byte-exactly.
 */
export interface CalibrationCoordinates {
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  platform: string;
  locale: string | null | undefined;
  lengthBucket: LengthBucketV1;
  aggregationVersion: string;
  contentCompositionVersion: string;
}

/**
 * A fail-closed lookup result. It NEVER carries the "closest" profile: a miss,
 * an out-of-release digest and an expired profile each surface a typed reason
 * that the decision policy turns into a TMR abstention.
 */
export type ProfileLookup =
  | { status: "found"; profile: RuntimeCalibrationProfileV1 }
  | { status: "missing"; reason: "MODEL_PROFILE_MISSING" }
  | { status: "out-of-release"; reason: "MODEL_PROFILE_MISMATCH" }
  | { status: "expired"; reason: "PROFILE_EXPIRED" };

export class CalibrationRegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CalibrationRegistryError";
    this.code = code;
  }
}

/**
 * A local index of calibration profiles bound to ONE promoted release. A profile
 * is returned only for the exact nine coordinates it was measured against, only
 * when its digest belongs to the release's calibration set, and only while it is
 * unexpired. Parsing and digesting happen once, at load; every miss is a typed
 * reason, never a fallback profile.
 */
export class CalibrationRegistry {
  private readonly byKey = new Map<string, RuntimeCalibrationProfileV1>();
  private readonly releaseDigests: ReadonlySet<string>;

  constructor(
    readonly release: ModelReleaseDescriptorV1,
    profilesFile: CalibrationProfilesFileV1,
  ) {
    this.releaseDigests = new Set(release.profileDigests);
    for (const profile of profilesFile.profiles) {
      const key = keyOf({
        modelId: profile.modelId,
        modelVersion: profile.modelVersion,
        bundleDigest: profile.bundleDigest,
        tokenizerDigest: profile.tokenizerDigest,
        platform: profile.platform,
        locale: profile.locale,
        lengthBucket: profile.lengthBucket,
        aggregationVersion: profile.aggregationVersion,
        contentCompositionVersion: profile.contentCompositionVersion,
      });
      if (this.byKey.has(key)) {
        throw new CalibrationRegistryError(
          "DUPLICATE_PROFILE_KEY",
          "two profiles share the same coordinate key",
        );
      }
      this.byKey.set(key, profile);
    }
  }

  /**
   * Parses and validates a raw release descriptor and profiles file (both closed
   * schemas reject unknown keys), verifies their calibration-set digests agree,
   * then indexes only valid profiles.
   */
  static async load(
    rawRelease: unknown,
    rawProfiles: unknown,
  ): Promise<CalibrationRegistry> {
    const release = await parseModelReleaseDescriptorV1(rawRelease);
    const profilesFile = await parseCalibrationProfilesFileV1(rawProfiles);
    const expected = await computeCalibrationSetDigest(release.profileDigests);
    if (expected !== release.calibrationSetDigest) {
      throw new CalibrationRegistryError(
        "CALIBRATION_SET_MISMATCH",
        "release calibrationSetDigest does not match its profileDigests",
      );
    }
    return new CalibrationRegistry(release, profilesFile);
  }

  /** The exact-match lookup. `now` is compared inclusively against expiry. */
  findExact(coordinates: CalibrationCoordinates, now: number): ProfileLookup {
    const profile = this.byKey.get(keyOf(coordinates));
    if (profile === undefined) {
      return { status: "missing", reason: "MODEL_PROFILE_MISSING" };
    }
    if (!this.releaseDigests.has(profile.profileDigest)) {
      return { status: "out-of-release", reason: "MODEL_PROFILE_MISMATCH" };
    }
    if (now >= Date.parse(profile.expiresAt)) {
      return { status: "expired", reason: "PROFILE_EXPIRED" };
    }
    return { status: "found", profile };
  }
}

function keyOf(coordinates: CalibrationCoordinates): string {
  return JSON.stringify([
    coordinates.modelId,
    coordinates.modelVersion,
    coordinates.bundleDigest,
    coordinates.tokenizerDigest,
    coordinates.platform,
    normalizeCalibrationLocale(coordinates.locale),
    coordinates.lengthBucket,
    coordinates.aggregationVersion,
    coordinates.contentCompositionVersion,
  ]);
}
