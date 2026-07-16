export interface OfflineAsset {
  file: string;
  sha256: string;
}

export interface OfflineAssetManifest {
  version: 1;
  runtime: {
    transformers: string;
    onnxruntimeWeb: string;
  };
  assets: OfflineAsset[];
}

export interface CopyTransformersAssetsOptions {
  sourceDirectory?: string;
  transformersDistDirectory?: string;
  outputDirectory?: string;
}

export function copyTransformersAssets(
  options?: CopyTransformersAssetsOptions,
): Promise<OfflineAssetManifest>;

export function assertOfflineAssetInventory(
  assetDirectory: string,
  requiredAssets?: string[],
): Promise<OfflineAssetManifest>;

export function resolveTransformersWasmAssets(
  transformersDistDirectory: string,
): Promise<string[]>;
