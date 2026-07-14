import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  EffectiveSettings,
  PlatformSettings,
  UserSettings,
} from "@/shared/settings-types";
import { assertUserSettings } from "@/storage/settings";

export interface EffectiveSettingsInput {
  global?: Partial<UserSettings>;
  platform?: PlatformSettings;
  session?: Partial<UserSettings>;
}

export function resolveEffectiveSettings(
  input: EffectiveSettingsInput,
): EffectiveSettings {
  const platform = { ...input.platform };
  delete platform.platformId;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input.global,
    ...platform,
    ...input.session,
  };

  assertUserSettings(settings);
  return settings;
}
