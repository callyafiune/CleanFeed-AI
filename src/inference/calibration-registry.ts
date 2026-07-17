import type {
  CalibrationProfile,
  LengthBucket,
  PresentationMode,
} from "@/shared/types";

/**
 * A calibration profile bound to the exact model artifact that produced it.
 * Reusing a profile across model versions is a scientific error, so the
 * identifying coordinates travel with the thresholds.
 */
export interface VersionedCalibrationProfile extends CalibrationProfile {
  modelId: string;
  modelVersion: string;
  /** Only benchmark-verified profiles are ever stored as calibrated. */
  calibrated: boolean;
  /** The most aggressive presentation this calibration authorizes. */
  actionCeiling: PresentationMode;
}

/** The coordinates that uniquely identify a calibration profile. */
export interface CalibrationQuery {
  modelId: string;
  modelVersion: string;
  platform: string;
  language: string;
  lengthBucket: LengthBucket;
}

/**
 * Returned whenever no benchmark-verified calibration exists for the queried
 * model. It never blurs, collapses, or hides: an uncalibrated model may only
 * indicate, and its thresholds are intentionally conservative.
 */
export const CONSERVATIVE_UNCALIBRATED_PROFILE: VersionedCalibrationProfile = {
  id: "uncalibrated-conservative",
  modelId: "",
  modelVersion: "",
  platform: "default",
  language: "und",
  lengthBucket: "50_79",
  markingThreshold: 0.9,
  blurThreshold: 1,
  collapseThreshold: 1,
  hideThreshold: 1,
  calibrated: false,
  actionCeiling: "indicator",
};

/**
 * A local, versioned index of calibration profiles. A profile is only ever
 * returned for the exact model id, model version, platform, language, and
 * length bucket it was measured against; any miss yields the conservative
 * uncalibrated fallback.
 */
export class CalibrationRegistry {
  private readonly profiles = new Map<string, VersionedCalibrationProfile>();

  constructor(profiles: Iterable<VersionedCalibrationProfile> = []) {
    for (const profile of profiles) this.add(profile);
  }

  add(profile: VersionedCalibrationProfile): void {
    if (!profile.calibrated) {
      throw new RangeError(
        "Only benchmark-verified calibration profiles may be registered.",
      );
    }
    this.profiles.set(keyOf(profile), profile);
  }

  get(query: CalibrationQuery): VersionedCalibrationProfile {
    return this.profiles.get(keyOf(query)) ?? CONSERVATIVE_UNCALIBRATED_PROFILE;
  }
}

function keyOf(
  coordinates: CalibrationQuery | VersionedCalibrationProfile,
): string {
  return JSON.stringify([
    coordinates.modelId,
    coordinates.modelVersion,
    coordinates.platform,
    coordinates.language,
    coordinates.lengthBucket,
  ]);
}
