import type { GateDecision, RolloutState } from "../../contracts/model-release";
import type {
  DiagnosticReleaseStatus,
  ModelDiagnosticsView,
} from "@/shared/diagnostic-types";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ModelStatus } from "@/shared/types";

/**
 * The single client for the sanitized diagnostics view. Both the popup and the
 * options page call it over the closed `MODEL_DIAGNOSTICS_*` route; the
 * background combines the active {@link ModelStatus} with only the descriptor's
 * rollout coordinates and sanitizes before responding. A non-result response
 * yields `null` so callers degrade gracefully.
 */
export async function requestModelDiagnostics(
  source: "options" | "popup",
): Promise<ModelDiagnosticsView | null> {
  const response = await chrome.runtime.sendMessage({
    source,
    target: "background",
    type: "MODEL_DIAGNOSTICS_REQUEST",
    payload: undefined,
  });
  const message = parseExtensionMessage(response);
  return message.type === "MODEL_DIAGNOSTICS_RESULT" ? message.payload : null;
}

/**
 * The rollout state described in plain language. It reports where the descriptor
 * stands in the release process; it never claims quality or authorship.
 */
export const ROLLOUT_COPY: Record<RolloutState, string> = {
  "bundle-verified": "Bundle verificado; inativo no feed",
  shadow: "Modo sombra; sem apresentação",
  // Diz o que e, sem alegar qualidade: o preview roda sem calibracao verificada, entao o
  // texto nao pode sugerir medicao alguma.
  experimental: "Preview experimental; sem calibração verificada",
  indicator: "Avisos autorizados",
  actions: "Ações visuais autorizadas",
};

/** The calibration coverage described in plain language. */
export const CALIBRATION_COPY: Record<
  ModelStatus["calibrationCoverage"],
  string
> = {
  none: "Sem perfil aplicável; o detector se abstém e o fallback local pode apenas indicar.",
  partial: "Cobertura parcial de calibração",
  complete: "Cobertura completa de calibração",
};

/** The scientific gate decision described in plain language. */
export const GATE_COPY: Record<GateDecision, string> = {
  pending: "Validação pendente",
  reject: "Candidato não autorizado no pacote",
  "indicator-only": "Autorizado somente para avisos",
  pass: "Elegível para ações conforme rollout e perfil",
};

/** The operational state of the loaded runtime described in plain language. */
const MODEL_STATE_COPY: Record<ModelStatus["state"], string> = {
  unavailable: "indisponível",
  initializing: "inicializando",
  ready: "pronto",
  degraded: "degradado",
  disposing: "liberando modelo",
  error: "erro",
};

/** Shown when the active runtime is the built-in stylometric fallback. */
export const BUILTIN_FALLBACK_COPY = "Fallback estilométrico ativo";

/** Shown when the TMR circuit breaker is open and the fallback is serving. */
export const CIRCUIT_BREAKER_COPY =
  "Detector temporariamente desativado; usando fallback local.";

/** Shown when the opt-in uncalibrated experimental TMR preview is the active runtime. */
export const EXPERIMENTAL_UNCALIBRATED_COPY =
  "Detector experimental ativo (preview / não calibrado): resultados são apenas indicativos, sem decisão científica. Pode errar.";

/** Shown for a null `earliestExpiry` (no applicable profile). */
export const NO_PROFILE_EXPIRY_COPY = "Nenhum perfil aplicável";

const EXPIRY_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function modelRolloutLabel(release: DiagnosticReleaseStatus): string {
  return ROLLOUT_COPY[release.rolloutState];
}

export function modelGateLabel(release: DiagnosticReleaseStatus): string {
  return GATE_COPY[release.gateDecision];
}

export function modelCalibrationLabel(status: {
  calibrationCoverage: ModelStatus["calibrationCoverage"];
}): string {
  return CALIBRATION_COPY[status.calibrationCoverage];
}

export function modelOperationLabel(
  state: ModelStatus["state"] | undefined,
): string {
  return state === undefined ? "indisponível" : MODEL_STATE_COPY[state];
}

/** Formats `earliestExpiry` in pt-BR (UTC); a null/invalid value is plain text. */
export function formatEarliestExpiry(iso: string | null): string {
  if (iso === null) {
    return NO_PROFILE_EXPIRY_COPY;
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return NO_PROFILE_EXPIRY_COPY;
  }
  return EXPIRY_FORMAT.format(timestamp);
}
