// Conservative, behaviour-preserving runtime metadata for the demonstration
// classifiers (mock, stylometric) and for results produced without a bundle
// (language abstention, worker timeout). The REAL evidence assessment and the
// profile-driven decision policy land in later tasks; these helpers only
// populate the now-required identity/evidence/decision fields so the existing
// pipeline and presentation behave EXACTLY as before.

import { computeContentComposition } from "../../contracts/content-composition";
import type {
  ClassificationStatus,
  DecisionOutcome,
  DecisionReasonCode,
  DecisionTrigger,
  EvidenceAssessment,
  RuntimeModelIdentity,
} from "@/shared/types";

/**
 * Maps a builtin classifier's metadata id to the closed `RuntimeModelIdentity`
 * builtin union (`"mock" | "stylometric"`). Every non-mock builtin (the
 * stylometric heuristic, and any test stub standing in for it) resolves to
 * `"stylometric"`; the concrete id (e.g. `"stylometric-v1"`) is preserved in
 * `implementationVersion`.
 */
export function builtinModelId(metadataId: string): "mock" | "stylometric" {
  return metadataId === "mock" ? "mock" : "stylometric";
}

/** Builds the builtin identity for a classifier from its metadata. */
export function buildBuiltinIdentity(metadata: {
  id: string;
  version: string;
}): RuntimeModelIdentity {
  return {
    kind: "builtin",
    modelId: builtinModelId(metadata.id),
    modelVersion: metadata.version,
    implementationVersion: metadata.id,
  };
}

/**
 * A conservative `limited` evidence assessment for a builtin result: the whole
 * text is "covered" (no windowing yet), the tokenizer is approximate, and the
 * lexical ratio is measured with the shared content-composition contract.
 */
export function buildBuiltinEvidence(
  text: string,
  overrides: Partial<EvidenceAssessment> = {},
): EvidenceAssessment {
  return {
    quality: "limited",
    coverage: 1,
    lexicalRatio: computeContentComposition(text).lexicalRatio,
    truncated: false,
    exactTokenizer: false,
    reasonCodes: [],
    ...overrides,
  };
}

export interface BuiltinDecisionInput {
  status: ClassificationStatus;
  calibratedScore: number;
  abstained?: boolean;
  reasonCodes?: DecisionReasonCode[];
  triggers?: DecisionTrigger[];
}

/**
 * A conservative decision for a builtin result. Builtins are uncalibrated and
 * may NEVER exceed the indicator ceiling (spec §5.5), so `actionCeiling` is
 * always `"indicator"`. `presentationAllowed` mirrors current behaviour: a
 * non-abstained result is presentable at its ceiling.
 */
export function buildBuiltinDecision(
  input: BuiltinDecisionInput,
): DecisionOutcome {
  const abstained = input.abstained ?? false;
  return {
    status: input.status,
    calibratedScore: input.calibratedScore,
    actionCeiling: "indicator",
    abstained,
    presentationAllowed: !abstained,
    triggers: input.triggers ?? [],
    reasonCodes: input.reasonCodes ?? [],
  };
}
