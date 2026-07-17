import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  DomainSettings,
  EffectiveSettings,
  PlatformSettings,
  SettingsSource,
  SettingsSourceMap,
  UserSettings,
} from "@/shared/settings-types";
import { platformSettingsOverrides } from "@/storage/platform-settings";
import { assertUserSettings } from "@/storage/settings";

export interface EffectiveSettingsInput {
  global?: Partial<UserSettings>;
  platform?: PlatformSettings;
  domain?: DomainSettings;
  session?: Partial<UserSettings>;
}

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<
  keyof UserSettings
>;

/**
 * Projects a domain override onto the user-settings surface. A domain may only
 * change its presentation and whether CleanFeed runs at all; `pausedUntil` and
 * `hostname` are storage bookkeeping and never merge into the resolved settings.
 */
function domainOverrides(
  domain: DomainSettings | undefined,
): Partial<UserSettings> {
  if (domain === undefined) {
    return {};
  }

  const overrides: Partial<UserSettings> = {};
  if (domain.presentationMode !== undefined) {
    overrides.presentationMode = domain.presentationMode;
  }
  if (domain.disabled === true) {
    overrides.enabled = false;
  }
  return overrides;
}

/**
 * Merges the configuration layers in the documented precedence order —
 * defaults → global → platform → domain → session — with the session winning
 * every tie. In debug mode the result also carries a `sourceMap` naming the
 * layer each value came from, so the origin of any effective value is traceable.
 */
export function resolveEffectiveSettings(
  input: EffectiveSettingsInput,
): EffectiveSettings {
  const layers: ReadonlyArray<
    readonly [SettingsSource, Partial<UserSettings>]
  > = [
    ["global", input.global ?? {}],
    ["platform", platformSettingsOverrides(input.platform)],
    ["domain", domainOverrides(input.domain)],
    ["session", input.session ?? {}],
  ];

  const settings: UserSettings = { ...DEFAULT_SETTINGS };
  const sourceMap = Object.fromEntries(
    SETTINGS_KEYS.map((key) => [key, "default" as SettingsSource]),
  ) as SettingsSourceMap;

  for (const [source, overrides] of layers) {
    for (const key of SETTINGS_KEYS) {
      if (Object.hasOwn(overrides, key) && overrides[key] !== undefined) {
        Object.assign(settings, { [key]: overrides[key] });
        sourceMap[key] = source;
      }
    }
  }

  assertUserSettings(settings);

  return settings.debugMode ? { ...settings, sourceMap } : settings;
}
