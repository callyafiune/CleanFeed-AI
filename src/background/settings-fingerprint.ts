export interface SettingsVersionReader {
  getVersion(): Promise<number>;
}

/**
 * Produces cache-key material from the validated, persisted setting versions.
 * A fresh value is read for each classification so a saved setting never reuses
 * a result classified under a previous configuration.
 */
export function createSettingsFingerprintProvider(
  globalSettings: SettingsVersionReader,
  platformSettings: SettingsVersionReader,
): (platformId: string) => Promise<string> {
  return async () => {
    const [globalVersion, platformVersion] = await Promise.all([
      globalSettings.getVersion(),
      platformSettings.getVersion(),
    ]);
    return `global-${globalVersion}:platform-${platformVersion}`;
  };
}
