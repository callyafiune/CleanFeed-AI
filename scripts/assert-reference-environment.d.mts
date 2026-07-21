/** The CLOSED reference-environment facts sealed into the performance report. */
export interface ReferenceEnvironmentFacts {
  operatingSystem: string;
  logicalProcessors: number;
  totalMemoryBytes: number;
  browserKind: "chrome-for-testing";
  browserVersion: "150.0.7871.129";
  browserExecutableSha256: string;
  browserLockDigest: string;
}

export declare const REFERENCE_BROWSER_KIND: "chrome-for-testing";
export declare const REFERENCE_BROWSER_VERSION: "150.0.7871.129";
export declare const REFERENCE_MINIMUM_LOGICAL_PROCESSORS: number;
export declare const REFERENCE_MINIMUM_TOTAL_MEMORY_BYTES: number;
export declare const REFERENCE_WINDOWS_MINIMUM_BUILD: number;

export declare class ReferenceEnvironmentError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

/** SHA-256 (hex) of the canonical JSON of the closed 4-key browser lock. */
export declare function referenceBrowserLockDigest(): string;

/** Validates the closed reference-environment facts and returns them. */
export declare function assertReferenceEnvironment(
  value: unknown,
  invalidCode?: string,
): ReferenceEnvironmentFacts;

export interface InspectReferenceEnvironmentOptions {
  browserLockPath?: string;
  testBrowserLockModule?: unknown;
  readFileBytes?: (path: string) => Uint8Array;
}

/** Inspects the live machine + resolved pinned browser and produces the facts. */
export declare function inspectReferenceEnvironment(
  options?: InspectReferenceEnvironmentOptions,
): Promise<{ facts: ReferenceEnvironmentFacts; executablePath: string }>;
