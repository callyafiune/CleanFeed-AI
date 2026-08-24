// The closed registry of assurance profiles a corpus seal may be qualified by.
//
// An assurance profile does not change WHAT a corpus asserts — `scientificUse`
// still says `release` or `infrastructure-only` — it declares under what ROBUSTNESS
// the assertion is made, the way a named identity-assurance level does (NIST SP
// 800-63-3) and the way an assurance engagement states whether it is reasonable or
// limited (ISAE 3000 Revised). Two profiles of the same `scientificUse` therefore
// support DIFFERENT claims, and the seal enforces a different corpus-level rule for
// each.
//
// THREE PROPERTIES ARE LOAD-BEARING, and without them a named profile is a wider
// claim wearing a narrower name:
//
//   * OBLIGATORY — a `release` manifest with no profile is refused, so there is no
//     default a reader could mistake for the strongest one;
//   * VERSIONED — the version is part of the name, so a later profile with looser
//     content cannot inherit the readers of the earlier one;
//   * IMPOSSIBLE TO CONFUSE — `humanReviewPerRecord` is declared explicitly by every
//     profile, so "a person read every record" is a field and never an inference.
//
// ACTIVATION IS SEPARATE FROM PRE-REGISTRATION. A profile may be written, reviewed
// and frozen here while still refusing every seal, and that is the state a profile is
// in before any execution has demonstrated that its gates are passable. Flipping
// `activation` is an edit to a file inside `EVALUATOR_FILES`, so it moves the
// evaluator digest and cannot happen quietly.

import type { AutomatedFilterName } from "./schema.ts";

export const ASSURANCE_PROFILE_NAMES = [
  "full-human-review-v1",
  "census-pii-screen-v1",
] as const;
export type AssuranceProfileName = (typeof ASSURANCE_PROFILE_NAMES)[number];

/**
 * Why a profile may or may not qualify a seal yet.
 *
 * `pre-registered` is a REFUSAL state and not a warning: the profile exists, its
 * claim is frozen, and no corpus may be sealed under it. `activationRequires` is
 * what the refusal names, so the message is actionable rather than merely negative.
 */
export type AssuranceProfileActivation =
  | {
      state: "active";
      /**
       * The execution that demonstrated the gates are passable, where activation
       * needed one. `null` for a profile whose robustness is a per-record human
       * receipt: there is no run to point at, the receipts ARE the evidence.
       */
      qualifyingRun: {
        receiptDigest: string;
        ratifiedBy: string;
        ratifiedAt: string;
      } | null;
    }
  | { state: "pre-registered"; activationRequires: readonly string[] };

export interface AssuranceProfile {
  name: AssuranceProfileName;
  /**
   * Did a person read every record? This is the axis the whole registry exists to
   * keep unambiguous, so it is stated and never derived from the other fields.
   */
  humanReviewPerRecord: boolean;
  /**
   * The automated filter every record must carry with `outcome: "passed"` for the
   * corpus to support this profile's claim. `null` where the evidence is not a
   * filter run.
   */
  requiredAutomatedFilter: AutomatedFilterName | null;
  asserts: readonly string[];
  doesNotAssert: readonly string[];
  declaredRisks: readonly string[];
  /**
   * ALWAYS null, and typed as null rather than as a number so no profile can ever
   * publish one: sensitivity measured on seeded controls does not transport to a
   * bound on the prevalence of real PII in the corpus, and a number here would be
   * exactly that unvalidated extrapolation.
   */
  prevalenceBound: null;
  satisfiesR4: boolean;
  activation: AssuranceProfileActivation;
}

export type AssuranceProfileRegistry = Readonly<
  Record<AssuranceProfileName, AssuranceProfile>
>;

export const ASSURANCE_PROFILES: AssuranceProfileRegistry = Object.freeze({
  "full-human-review-v1": Object.freeze({
    name: "full-human-review-v1",
    humanReviewPerRecord: true,
    requiredAutomatedFilter: null,
    asserts: Object.freeze([
      "cada registro do corpus sustenta uma alegação de revisão humana, com recibo próprio: revisores distintos, decisão por revisor, adjudicação atrás de toda divergência e cegueira a escore e a classe candidata",
    ]),
    doesNotAssert: Object.freeze([
      "sensibilidade medida da revisão humana: não há S, nem intervalo, nem estrato",
      "ausência de deriva de critério do revisor ao longo do corpus",
    ]),
    declaredRisks: Object.freeze([
      "sensibilidade humana não medida",
      "deriva de critério ao longo de um corpus grande",
    ]),
    prevalenceBound: null,
    satisfiesR4: true,
    activation: Object.freeze({ state: "active", qualifyingRun: null }),
  }),
  "census-pii-screen-v1": Object.freeze({
    name: "census-pii-screen-v1",
    humanReviewPerRecord: false,
    requiredAutomatedFilter: "llm-pii-screen",
    asserts: Object.freeze([
      "censo sobre bytes digestados: todo registro do corpus foi triado, e a disposição de cada par (id, sha256 do texto) está no ledger",
      "desempenho por subtipo apenas nos controles pré-inscritos, com S_control e seus limites de Wilson por estrato",
    ]),
    doesNotAssert: Object.freeze([
      "ausência ou prevalência de PII real",
      "S_real: a sensibilidade do triador sobre instâncias reais",
      "completude taxonômica: categoria que a taxonomia não nomeia não é medida",
      "leitura humana por registro",
      "validação humana dos rótulos",
    ]),
    declaredRisks: Object.freeze([
      "verification bias / selective labels: só o sinalizado é examinado, e o não sinalizado nunca entra no denominador",
      "confirmação humana: quem revê o sinalizado sabe que o triador o sinalizou",
      "falso cleared: o não sinalizado é tratado como limpo sem evidência de que o seja",
      "feedback adaptativo: ajustar o triador contra os próprios achados fecha o laço e apaga a medição",
      "contaminação por componente: o registro sai e o componente conexo dele fica",
      "conflito com split temporal/OOD: o drop pode esvaziar um bloco cego ou uma família reservada",
      "mutação de bytes: o texto muda entre o snapshot e o registro escrito",
      "PII relacional: a pessoa é identificada pela relação com outra nomeada, sem identificador próprio",
      "confusão de PPV: a taxa de acerto entre os sinalizados não é a sensibilidade nem o FPR do corpus",
    ]),
    prevalenceBound: null,
    satisfiesR4: false,
    activation: Object.freeze({
      state: "pre-registered",
      activationRequires: Object.freeze([
        "uma execução do llm-pii-screen cujo recibo declare TODO estrato da taxonomia acima do seu piso, pelo limite inferior de Wilson unilateral",
        "os gates adversariais aprovados por vetor, na taxa de PARES corretos, com o teto de falso positivo dos shams respeitado",
        "o teste de equivalência de indistinguibilidade dentro da margem pré-inscrita, incluindo a amostra lida pelo operador",
        "o digesto do recibo dessa execução inscrito em qualifyingRun, com quem ratificou e quando",
        "ratificação do operador: ativar o perfil é marco, e marco não se atravessa sem ratificação",
      ]),
    }),
  }),
} satisfies AssuranceProfileRegistry);

/**
 * Does this profile give the seal anything to ASK?
 *
 * A profile qualifies a release claim, and the seal can only enforce two kinds of
 * evidence: a human receipt on every record, or a named automated filter on every
 * record. A profile that declares neither is a level of robustness with nothing behind
 * it — both release refusals stay silent and the corpus seals on the strength of a
 * name. `sealDataset` refuses such a profile rather than trusting the registry to hold
 * only sound ones, because the registry is a parameter there.
 */
export function assuranceProfileEnforcesSomething(
  profile: AssuranceProfile,
): boolean {
  return (
    profile.humanReviewPerRecord || profile.requiredAutomatedFilter !== null
  );
}

export function isAssuranceProfileName(
  value: unknown,
): value is AssuranceProfileName {
  return (
    typeof value === "string" &&
    (ASSURANCE_PROFILE_NAMES as readonly string[]).includes(value)
  );
}

export function assuranceProfileOf(
  value: unknown,
): AssuranceProfile | undefined {
  return isAssuranceProfileName(value) ? ASSURANCE_PROFILES[value] : undefined;
}
