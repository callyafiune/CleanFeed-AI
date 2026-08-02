export type ActiveRuntimeKind = "builtin" | "bundle";
export type MaximumActionCeiling = "indicator" | "hide";

export interface ReleasePackagingPolicy {
  includeTmr: boolean;
  activeRuntimeKind: ActiveRuntimeKind;
  maximumActionCeiling: MaximumActionCeiling;
}

/**
 * The structural slice of the release descriptor the policy reads.
 *
 * ATENCAO: as duas enumeracoes abaixo sao COPIA A MAO de `RolloutState` e `GateDecision` em
 * `contracts/model-release.ts`, e acrescentar um estado exige mexer nos DOIS lugares.
 *
 * Importar o tipo foi tentado e nao serve: este `.d.mts` pertence ao projeto `tsconfig.node.json`,
 * e importar de `contracts/` arrasta aquele diretorio para um projeto com alvo e flags diferentes —
 * o resultado sao dezenas de erros sem relacao com esta mudanca. A copia fica, declarada, porque
 * copia silenciosa e o que envelhece.
 */
export interface ReleasePolicyDescriptor {
  gateDecision: "pending" | "reject" | "indicator-only" | "pass";
  rolloutState:
    "bundle-verified" | "shadow" | "experimental" | "indicator" | "actions";
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
