export interface OfflineAsset {
  file: string;
  sha256: string;
}

export interface OfflineAssetManifest {
  version: 1;
  assets: OfflineAsset[];
}

export interface CopyTransformersAssetsOptions {
  sourceDirectory?: string;
  outputDirectory?: string;
}

export function copyTransformersAssets(
  options?: CopyTransformersAssetsOptions,
): Promise<OfflineAssetManifest>;

export function assertOfflineAssetInventory(
  assetDirectory: string,
): Promise<OfflineAssetManifest>;
