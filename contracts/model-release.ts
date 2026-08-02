// Closed runtime release descriptor. It seals the identity of a promoted model
// and its calibration set; it carries NO runtime state and NO fallback field.
// The parser does no coercion and rejects unknown keys.

import { computeCalibrationSetDigest } from "./calibration-profile.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type RolloutState =
  | "bundle-verified"
  | "shadow"
  /**
   * O preview NAO CALIBRADO, publicavel e sem alegacao cientifica.
   *
   * Existe porque o runtime ja o executa — `buildWorkerInitializePayload` carrega o manifesto
   * quando nao ha calibracao e o usuario optou — mas nenhum `gateDecision` dizia "nao ha decisao"
   * de forma que o empacotamento aceitasse: `pending` era recusado de saida. Sem este estado a
   * lane travava na PUBLICACAO, nao na execucao.
   *
   * Deliberadamente NAO reutiliza `indicator-only`: aquele rotulo afirma uma decisao cientifica, e
   * o preview nao tem nenhuma. O desenho esta em
   * `docs/superpowers/plans/2026-08-02-lane-experimental.md`.
   */
  | "experimental"
  | "indicator"
  | "actions";
export type GateDecision = "pending" | "reject" | "indicator-only" | "pass";

export interface ModelReleaseDescriptorV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  calibrationSetDigest: string;
  profileDigests: string[];
  rolloutState: RolloutState;
  gateDecision: GateDecision;
  issuedAt: string | null;
  evidenceDigest: string | null;
}

/** Coded, fail-closed error thrown by the release parser. */
export class ModelReleaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelReleaseError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ModelReleaseError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const DESCRIPTOR_KEYS = [
  "schemaVersion",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "calibrationSetDigest",
  "profileDigests",
  "rolloutState",
  "gateDecision",
  "issuedAt",
  "evidenceDigest",
] as const;

const ROLLOUT_STATES: readonly RolloutState[] = [
  "bundle-verified",
  "shadow",
  "experimental",
  "indicator",
  "actions",
];
const GATE_DECISIONS: readonly GateDecision[] = [
  "pending",
  "reject",
  "indicator-only",
  "pass",
];

/** Closed parser for the runtime release descriptor. Rejects any drift. */
export async function parseModelReleaseDescriptorV1(
  value: unknown,
): Promise<ModelReleaseDescriptorV1> {
  if (!hasExactKeys(value, DESCRIPTOR_KEYS)) {
    fail("RELEASE_SCHEMA_INVALID", "descriptor has missing or unexpected keys");
  }
  if (value.schemaVersion !== 1) {
    fail("RELEASE_SCHEMA_INVALID", "schemaVersion must be 1");
  }
  if (
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.modelVersion) ||
    !isNonEmptyString(value.aggregationVersion) ||
    !isNonEmptyString(value.contentCompositionVersion)
  ) {
    fail(
      "RELEASE_FIELD_INVALID",
      "descriptor identity strings must be non-empty",
    );
  }
  if (!isSha256(value.bundleDigest) || !isSha256(value.tokenizerDigest)) {
    fail(
      "RELEASE_FIELD_INVALID",
      "bundle/tokenizer digests must be sha256 hex",
    );
  }
  if (!isSha256(value.calibrationSetDigest)) {
    fail("RELEASE_FIELD_INVALID", "calibrationSetDigest must be sha256 hex");
  }
  if (
    !Array.isArray(value.profileDigests) ||
    !value.profileDigests.every(isSha256)
  ) {
    fail(
      "RELEASE_FIELD_INVALID",
      "profileDigests must be an array of sha256 hex",
    );
  }
  if (!ROLLOUT_STATES.includes(value.rolloutState as RolloutState)) {
    fail("RELEASE_FIELD_INVALID", "unknown rolloutState");
  }
  if (!GATE_DECISIONS.includes(value.gateDecision as GateDecision)) {
    fail("RELEASE_FIELD_INVALID", "unknown gateDecision");
  }
  if (value.issuedAt !== null) {
    if (
      !isNonEmptyString(value.issuedAt) ||
      !Number.isFinite(Date.parse(value.issuedAt))
    ) {
      fail(
        "RELEASE_FIELD_INVALID",
        "issuedAt must be null or a valid timestamp",
      );
    }
  }
  if (value.evidenceDigest !== null && !isSha256(value.evidenceDigest)) {
    fail("RELEASE_FIELD_INVALID", "evidenceDigest must be null or sha256 hex");
  }

  const expectedSetDigest = await computeCalibrationSetDigest(
    value.profileDigests as string[],
  );
  if (value.calibrationSetDigest !== expectedSetDigest) {
    fail(
      "RELEASE_DIGEST_MISMATCH",
      "calibrationSetDigest does not match the canonical digest of profileDigests",
    );
  }

  const descriptor = value as unknown as ModelReleaseDescriptorV1;
  assertRolloutInvariants(descriptor);
  return descriptor;
}

function assertRolloutInvariants(descriptor: ModelReleaseDescriptorV1): void {
  const {
    rolloutState,
    gateDecision,
    profileDigests,
    issuedAt,
    evidenceDigest,
  } = descriptor;

  switch (rolloutState) {
    case "bundle-verified":
      if (gateDecision === "pending") {
        if (issuedAt !== null || evidenceDigest !== null) {
          fail(
            "RELEASE_STATE_INVALID",
            "a pending bundle-verified release carries no issuedAt/evidence",
          );
        }
        if (profileDigests.length !== 0) {
          fail("RELEASE_STATE_INVALID", "a pending release has no profiles");
        }
      } else if (gateDecision === "reject") {
        if (issuedAt === null || evidenceDigest === null) {
          fail(
            "RELEASE_STATE_INVALID",
            "a reject release requires non-null issuedAt and evidenceDigest",
          );
        }
        if (profileDigests.length !== 0) {
          fail("RELEASE_STATE_INVALID", "a reject release omits all profiles");
        }
      } else {
        fail(
          "RELEASE_STATE_INVALID",
          "bundle-verified only pairs with a pending or reject gate",
        );
      }
      break;
    case "experimental":
      // As quatro amarras que impedem o preview de alegar o que nao tem. Cada uma recusa uma
      // forma diferente de mentira: decisao que nao existe, perfil que nao existe, evidencia que
      // nao existe, e data de empacotamento ausente (sem ela nada pode expirar).
      if (gateDecision !== "pending") {
        fail(
          "RELEASE_STATE_INVALID",
          "an experimental preview carries no scientific decision, so gateDecision must be pending",
        );
      }
      if (profileDigests.length !== 0) {
        fail(
          "RELEASE_STATE_INVALID",
          "an experimental preview is uncalibrated and declares no profile",
        );
      }
      if (evidenceDigest !== null) {
        fail(
          "RELEASE_STATE_INVALID",
          "an experimental preview has no scientific evidence to bind",
        );
      }
      if (issuedAt === null) {
        fail(
          "RELEASE_STATE_INVALID",
          "an experimental preview requires issuedAt: it is a build fact, and what lets it expire",
        );
      }
      break;
    case "shadow":
      // Shadow runs only in development and never authorizes presentation at
      // runtime; the descriptor imposes no promotion, so no extra structural
      // rule beyond field validity.
      break;
    case "indicator":
      if (gateDecision !== "indicator-only" && gateDecision !== "pass") {
        fail(
          "RELEASE_STATE_INVALID",
          "indicator rollout requires indicator-only or pass",
        );
      }
      if (profileDigests.length === 0) {
        fail(
          "RELEASE_STATE_INVALID",
          "indicator rollout requires at least one profile",
        );
      }
      if (issuedAt === null || evidenceDigest === null) {
        fail(
          "RELEASE_STATE_INVALID",
          "a promoted release requires issuedAt and evidence",
        );
      }
      break;
    case "actions":
      if (gateDecision !== "pass") {
        fail("RELEASE_STATE_INVALID", "actions rollout requires a pass gate");
      }
      if (profileDigests.length === 0) {
        fail(
          "RELEASE_STATE_INVALID",
          "actions rollout requires at least one profile",
        );
      }
      if (issuedAt === null || evidenceDigest === null) {
        fail(
          "RELEASE_STATE_INVALID",
          "a promoted release requires issuedAt and evidence",
        );
      }
      break;
    default:
      fail("RELEASE_STATE_INVALID", "unknown rolloutState");
  }
}

export { computeCalibrationSetDigest };
