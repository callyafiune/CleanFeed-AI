import { normalizeHostname } from "@/shared/hostname";
import type { StorageArea } from "@/storage/storage-area";

const DOMAIN_PAUSE_KEY = "cleanfeed.domain-pause.v1";
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_HOSTNAMES = 1_000;

interface PersistedDomainPause {
  schemaVersion: typeof SCHEMA_VERSION;
  hostnames: string[];
}

export interface DomainPauseRepositoryOptions {
  maximumHostnames?: number;
}

/**
 * The set of hostnames the user has paused CleanFeed on. It stores nothing but
 * the hostname of each paused site: never a path, query, post text or author.
 * Mirrors the other storage repositories — a single serialized value guarded by
 * an allowlist validator, a serialized mutation queue and versioned recovery.
 */
export class DomainPauseRepository {
  private mutation = Promise.resolve();
  private readonly maximumHostnames: number;

  constructor(
    private readonly storage: StorageArea,
    options: DomainPauseRepositoryOptions = {},
  ) {
    const maximumHostnames = options.maximumHostnames ?? DEFAULT_MAX_HOSTNAMES;
    if (!Number.isSafeInteger(maximumHostnames) || maximumHostnames < 1) {
      throw new RangeError("maximumHostnames must be a positive safe integer.");
    }
    this.maximumHostnames = maximumHostnames;
  }

  isPaused(hostname: string): Promise<boolean> {
    const normalized = normalizeHostname(hostname);
    if (normalized === undefined) {
      return Promise.resolve(false);
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return persisted.hostnames.includes(normalized);
    });
  }

  /** Persists a hostname as paused; rejects anything that is not a hostname. */
  pause(hostname: string): Promise<void> {
    const normalized = normalizeHostname(hostname);
    if (normalized === undefined) {
      return Promise.reject(new Error("INVALID_HOSTNAME"));
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      if (persisted.hostnames.includes(normalized)) {
        return;
      }

      const hostnames = [...persisted.hostnames, normalized].slice(
        -this.maximumHostnames,
      );
      await this.storage.set<PersistedDomainPause>(DOMAIN_PAUSE_KEY, {
        schemaVersion: SCHEMA_VERSION,
        hostnames,
      });
    });
  }

  resume(hostname: string): Promise<void> {
    const normalized = normalizeHostname(hostname);
    if (normalized === undefined) {
      return Promise.resolve();
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      if (!persisted.hostnames.includes(normalized)) {
        return;
      }

      await this.storage.set<PersistedDomainPause>(DOMAIN_PAUSE_KEY, {
        schemaVersion: SCHEMA_VERSION,
        hostnames: persisted.hostnames.filter((entry) => entry !== normalized),
      });
    });
  }

  list(): Promise<string[]> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return [...persisted.hostnames];
    });
  }

  clear(): Promise<void> {
    return this.runMutation(() => this.storage.remove(DOMAIN_PAUSE_KEY));
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readPersisted(): Promise<PersistedDomainPause> {
    const value = await this.storage.get<unknown>(DOMAIN_PAUSE_KEY);
    if (value === undefined) {
      return { schemaVersion: SCHEMA_VERSION, hostnames: [] };
    }

    if (!isPersistedDomainPause(value)) {
      await this.storage.remove(DOMAIN_PAUSE_KEY);
      return { schemaVersion: SCHEMA_VERSION, hostnames: [] };
    }

    return value;
  }
}

function isPersistedDomainPause(value: unknown): value is PersistedDomainPause {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(value.hostnames) &&
    value.hostnames.every((entry) => normalizeHostname(entry) === entry)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
