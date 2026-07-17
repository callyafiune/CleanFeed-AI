import { normalizeHostname } from "@/shared/hostname";
import type { DomainSettings } from "@/shared/settings-types";
import type { Clock, PresentationMode, StorageArea } from "@/shared/types";

const DOMAIN_SETTINGS_KEY = "cleanfeed.domains.v1";
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_HOSTNAMES = 500;

const PRESENTATION_MODES = [
  "indicator",
  "blur",
  "collapse",
  "hide",
] as const satisfies readonly PresentationMode[];

interface PersistedDomainSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  domains: Record<string, DomainSettings>;
}

export interface DomainSettingsRepositoryOptions {
  maximumHostnames?: number;
}

/**
 * Per-site overrides keyed by normalized hostname. Like the other storage
 * repositories it keeps a single serialized value guarded by an allowlist
 * validator, a serialized mutation queue and versioned recovery. It stores only
 * the hostname and the small set of allowed settings — never a full URL, path,
 * query string, author or post text. One-hour pauses are absolute timestamps and
 * expire lazily on read (and eagerly through `clearExpired`).
 */
export class DomainSettingsRepository {
  private mutation = Promise.resolve();
  private readonly maximumHostnames: number;

  constructor(
    private readonly storage: StorageArea,
    private readonly clock: Clock,
    options: DomainSettingsRepositoryOptions = {},
  ) {
    const maximumHostnames = options.maximumHostnames ?? DEFAULT_MAX_HOSTNAMES;
    if (!Number.isSafeInteger(maximumHostnames) || maximumHostnames < 1) {
      throw new RangeError("maximumHostnames must be a positive safe integer.");
    }
    this.maximumHostnames = maximumHostnames;
  }

  /** Returns the active override, dropping (and forgetting) an expired pause. */
  get(input: string): Promise<DomainSettings | undefined> {
    const hostname = normalizeDomainInput(input);
    if (hostname === undefined) {
      return Promise.resolve(undefined);
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const entry = ownEntry(persisted.domains, hostname);
      if (entry === undefined) {
        return undefined;
      }

      const active = this.withoutExpiredPause(entry);
      if (active === undefined) {
        await this.persistWithout(persisted, hostname);
        return undefined;
      }
      if (active !== entry) {
        await this.persistWith(persisted, active);
      }
      return active;
    });
  }

  /** Pauses a site for `durationMs`, recorded as an absolute expiry timestamp. */
  pauseFor(input: string, durationMs: number): Promise<void> {
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      return Promise.reject(new Error("INVALID_DURATION"));
    }
    const hostname = normalizeDomainInput(input);
    if (hostname === undefined) {
      return Promise.reject(new Error("INVALID_HOSTNAME"));
    }

    const pausedUntil = this.clock.now() + durationMs;
    return this.upsert(hostname, (entry) => ({ ...entry, pausedUntil }));
  }

  /** Disables CleanFeed on a site until it is explicitly resumed. */
  disable(input: string): Promise<void> {
    const hostname = normalizeDomainInput(input);
    if (hostname === undefined) {
      return Promise.reject(new Error("INVALID_HOSTNAME"));
    }

    return this.upsert(hostname, (entry) => ({ ...entry, disabled: true }));
  }

  /** Clears a site's pause and disabled flag; drops the entry if nothing remains. */
  resume(input: string): Promise<void> {
    const hostname = normalizeDomainInput(input);
    if (hostname === undefined) {
      return Promise.resolve();
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const entry = ownEntry(persisted.domains, hostname);
      if (entry === undefined) {
        return;
      }

      const trimmed = keepPresentationOnly(entry);
      if (isEmpty(trimmed)) {
        await this.persistWithout(persisted, hostname);
        return;
      }
      await this.persistWith(persisted, trimmed);
    });
  }

  /** Eagerly removes lapsed pauses (and any entry left holding only one). */
  clearExpired(): Promise<void> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      let changed = false;
      const domains: Record<string, DomainSettings> = {};

      for (const [hostname, entry] of Object.entries(persisted.domains)) {
        const active = this.withoutExpiredPause(entry);
        if (active === undefined) {
          changed = true;
          continue;
        }
        if (active !== entry) {
          changed = true;
        }
        domains[hostname] = active;
      }

      if (changed) {
        await this.write(domains);
      }
    });
  }

  private withoutExpiredPause(
    entry: DomainSettings,
  ): DomainSettings | undefined {
    if (
      entry.pausedUntil === undefined ||
      entry.pausedUntil > this.clock.now()
    ) {
      return entry;
    }

    const trimmed = keepPresentationAndDisabled(entry);
    return isEmpty(trimmed) ? undefined : trimmed;
  }

  private upsert(
    hostname: string,
    update: (entry: DomainSettings) => DomainSettings,
  ): Promise<void> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const existing = ownEntry(persisted.domains, hostname) ?? { hostname };
      const next = sanitize(update(existing), hostname);
      await this.persistWith(persisted, next);
    });
  }

  private persistWith(
    persisted: PersistedDomainSettings,
    entry: DomainSettings,
  ): Promise<void> {
    const domains = { ...persisted.domains, [entry.hostname]: entry };
    return this.write(
      capHostnames(domains, entry.hostname, this.maximumHostnames),
    );
  }

  private persistWithout(
    persisted: PersistedDomainSettings,
    hostname: string,
  ): Promise<void> {
    if (!Object.hasOwn(persisted.domains, hostname)) {
      return Promise.resolve();
    }
    const domains = { ...persisted.domains };
    delete domains[hostname];
    return this.write(domains);
  }

  private write(domains: Record<string, DomainSettings>): Promise<void> {
    return this.storage.set<PersistedDomainSettings>(DOMAIN_SETTINGS_KEY, {
      schemaVersion: SCHEMA_VERSION,
      domains,
    });
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readPersisted(): Promise<PersistedDomainSettings> {
    const value = await this.storage.get<unknown>(DOMAIN_SETTINGS_KEY);
    if (value === undefined) {
      return { schemaVersion: SCHEMA_VERSION, domains: {} };
    }

    if (!isPersistedDomainSettings(value)) {
      await this.storage.remove(DOMAIN_SETTINGS_KEY);
      return { schemaVersion: SCHEMA_VERSION, domains: {} };
    }

    return value;
  }
}

/**
 * Reduces any accepted input to a normalized hostname. A full URL is parsed and
 * only its hostname survives — never the path or query string — and embedded
 * credentials are rejected. A bare value must already be a hostname, so a path,
 * wildcard or free text is refused.
 */
function normalizeDomainInput(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(input);
    if (url.username !== "" || url.password !== "") {
      return undefined;
    }
    return normalizeHostname(url.hostname);
  } catch {
    return normalizeHostname(input);
  }
}

/** Rebuilds an entry from allowlisted fields only so nothing extra is stored. */
function sanitize(entry: DomainSettings, hostname: string): DomainSettings {
  const result: DomainSettings = { hostname };
  if (entry.disabled === true) {
    result.disabled = true;
  }
  if (typeof entry.pausedUntil === "number") {
    result.pausedUntil = entry.pausedUntil;
  }
  if (entry.presentationMode !== undefined) {
    result.presentationMode = entry.presentationMode;
  }
  return result;
}

function keepPresentationAndDisabled(entry: DomainSettings): DomainSettings {
  const result: DomainSettings = { hostname: entry.hostname };
  if (entry.disabled === true) {
    result.disabled = true;
  }
  if (entry.presentationMode !== undefined) {
    result.presentationMode = entry.presentationMode;
  }
  return result;
}

function keepPresentationOnly(entry: DomainSettings): DomainSettings {
  const result: DomainSettings = { hostname: entry.hostname };
  if (entry.presentationMode !== undefined) {
    result.presentationMode = entry.presentationMode;
  }
  return result;
}

function isEmpty(entry: DomainSettings): boolean {
  return (
    entry.disabled === undefined &&
    entry.pausedUntil === undefined &&
    entry.presentationMode === undefined
  );
}

function ownEntry(
  domains: Record<string, DomainSettings>,
  hostname: string,
): DomainSettings | undefined {
  return Object.hasOwn(domains, hostname) ? domains[hostname] : undefined;
}

function capHostnames(
  domains: Record<string, DomainSettings>,
  keep: string,
  maximum: number,
): Record<string, DomainSettings> {
  const keys = Object.keys(domains);
  if (keys.length <= maximum) {
    return domains;
  }

  const result = { ...domains };
  for (const key of keys) {
    if (Object.keys(result).length <= maximum) {
      break;
    }
    if (key !== keep) {
      delete result[key];
    }
  }
  return result;
}

function isPersistedDomainSettings(
  value: unknown,
): value is PersistedDomainSettings {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !isRecord(value.domains)
  ) {
    return false;
  }

  return Object.entries(value.domains).every(
    ([hostname, entry]) =>
      normalizeHostname(hostname) === hostname &&
      isDomainSettings(entry, hostname),
  );
}

function isDomainSettings(
  value: unknown,
  hostname: string,
): value is DomainSettings {
  if (!isRecord(value) || value.hostname !== hostname) {
    return false;
  }

  const allowed = new Set([
    "hostname",
    "disabled",
    "pausedUntil",
    "presentationMode",
  ]);
  if (!Object.keys(value).every((key) => allowed.has(key))) {
    return false;
  }

  if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
    return false;
  }
  if (
    value.pausedUntil !== undefined &&
    !(
      Number.isSafeInteger(value.pausedUntil) &&
      (value.pausedUntil as number) >= 0
    )
  ) {
    return false;
  }
  if (
    value.presentationMode !== undefined &&
    !PRESENTATION_MODES.includes(value.presentationMode as PresentationMode)
  ) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
