import { buildBuiltinIdentity } from "@/inference/builtin-runtime";
import {
  parseModelManifest,
  type CleanFeedModelManifest,
  type RuntimeDescriptor,
} from "@/inference/model-bundle";
import { CleanFeedError } from "@/shared/errors";
import type { DecisionReasonCode, RuntimeModelIdentity } from "@/shared/types";

/** A local-only index of manifests that have passed the closed schema parser. */
export class ModelCatalog {
  private readonly manifests = new Map<string, CleanFeedModelManifest>();

  constructor(manifests: Iterable<unknown> = []) {
    for (const manifest of manifests) this.add(manifest);
  }

  add(value: unknown): CleanFeedModelManifest {
    const manifest = parseModelManifest(value);
    if (this.manifests.has(manifest.id)) {
      throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
    }
    this.manifests.set(manifest.id, manifest);
    return manifest;
  }

  get(id: string): CleanFeedModelManifest | undefined {
    return this.manifests.get(id);
  }

  list(): CleanFeedModelManifest[] {
    return [...this.manifests.values()];
  }
}

/**
 * The two DISTINCT catalog candidates. The TMR candidate is the sealed bundle
 * identity; the stylometric builtin is a separate object that NEVER copies the
 * bundle/calibration digests — its identity is only
 * `{kind:"builtin",modelId:"stylometric",modelVersion,implementationVersion}`.
 */
export interface CatalogCandidates {
  tmr: Extract<RuntimeModelIdentity, { kind: "bundle" }>;
  stylometric: Extract<RuntimeModelIdentity, { kind: "builtin" }>;
}

/** Builds the two distinct catalog identities from a verified descriptor. */
export function buildCatalogCandidates(
  descriptor: RuntimeDescriptor,
  stylometricMetadata: { id: string; version: string },
): CatalogCandidates {
  const { manifest, release } = descriptor;
  const stylometric = buildBuiltinIdentity(stylometricMetadata);
  if (stylometric.kind !== "builtin") {
    throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
  }
  return {
    tmr: {
      kind: "bundle",
      modelId: manifest.modelId,
      modelVersion: manifest.modelVersion,
      bundleDigest: manifest.bundleDigest,
      tokenizerDigest: manifest.tokenizerDigest,
      aggregationVersion: manifest.aggregationVersion,
      contentCompositionVersion: manifest.contentCompositionVersion,
      calibrationSetDigest: release.calibrationSetDigest,
    },
    stylometric,
  };
}

/** The runtime the catalog selects as primary, and whether TMR shadows it. */
export interface CatalogSelection {
  primary: "tmr" | "stylometric";
  shadowTmr: boolean;
  reasonCodes: DecisionReasonCode[];
}

export interface CatalogSelectionInput {
  /** The release rollout state; never the string `fallback`. */
  rolloutState: string;
  /** Profiles that are valid AND compatible with the current bundle. */
  validProfileCount: number;
  buildMode: "development" | "production";
}

/**
 * Chooses the primary runtime for the SET. TMR becomes primary only for a
 * promoted (`indicator`/`actions`) release that ships at least one usable
 * profile; `shadow` runs TMR silently only in development; every other state
 * keeps the indicative stylometric builtin as primary. Never presents "fallback"
 * as a release state — that word only describes the local host transition.
 */
export function selectCatalogRuntime(
  input: CatalogSelectionInput,
): CatalogSelection {
  const { rolloutState, validProfileCount, buildMode } = input;

  if (rolloutState === "indicator" || rolloutState === "actions") {
    if (validProfileCount >= 1) {
      return { primary: "tmr", shadowTmr: false, reasonCodes: [] };
    }
    return {
      primary: "stylometric",
      shadowTmr: false,
      reasonCodes: ["MODEL_PROFILE_MISSING"],
    };
  }

  if (rolloutState === "shadow") {
    return {
      primary: "stylometric",
      shadowTmr: validProfileCount >= 1 && buildMode === "development",
      reasonCodes: [],
    };
  }

  // bundle-verified (or any not-yet-promoted state): stylometric only.
  return { primary: "stylometric", shadowTmr: false, reasonCodes: [] };
}
