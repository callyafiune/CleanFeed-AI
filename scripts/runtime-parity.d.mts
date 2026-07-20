export interface RuntimeParityManifestV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  inferenceCoreDigest: string;
  runtimeParityDigest: string;
}

export type RuntimeParityDigestInput = Omit<
  RuntimeParityManifestV1,
  "runtimeParityDigest"
>;

export interface BuildRuntimeParityOptions {
  repoRoot: string;
  modelManifestPath: string;
}

export interface RuntimeParityCliArgs {
  command: "write";
  modelManifestPath: string;
  outputDir: string;
}

export declare class RuntimeParityScriptError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare function computeRuntimeParityDigest(
  fields: RuntimeParityDigestInput,
): string;

export declare function computeInferenceCoreDigest(
  repoRoot: string,
): Promise<string>;

export declare function buildRuntimeParityManifest(
  options: BuildRuntimeParityOptions,
): Promise<RuntimeParityManifestV1>;

export declare function writeRuntimeParityManifest(
  manifest: RuntimeParityManifestV1,
  outputDirectory: string,
): Promise<string>;

export declare function parseRuntimeParityCliArgs(
  args: readonly string[],
): RuntimeParityCliArgs;
