import {
  bundledCalibrationProfiles,
  bundledModelManifest,
  bundledReleaseDescriptor,
  bundledSourceLock,
  type BundledArtifactRecord,
  type BundledModelManifest,
  type BundledSourceLock,
} from "@/inference/bundled-model-metadata";
import {
  computeCalibrationSetDigest,
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
} from "../../contracts/calibration-profile";
import {
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../../contracts/model-release";
import { CleanFeedError } from "@/shared/errors";

export interface CleanFeedModelManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  task: "ai_text_detection";
  architecture: string;
  modelPath: string;
  tokenizerPath: string;
  configPath: string;
  supportedLanguages: string[];
  maximumTokens: number;
  quantization: "none" | "int8" | "int4";
  labels: { human: number; ai: number };
  output: { name: string; kind: "logits" | "probabilities" };
  license: string;
  source: string;
  calibrationVersion: string;
  sha256: Record<"model" | "tokenizer" | "config", string>;
}

export type BundleFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "arrayBuffer" | "ok" | "redirected" | "url">>;

const manifestKeys = [
  "schemaVersion",
  "id",
  "name",
  "version",
  "task",
  "architecture",
  "modelPath",
  "tokenizerPath",
  "configPath",
  "supportedLanguages",
  "maximumTokens",
  "quantization",
  "labels",
  "output",
  "license",
  "source",
  "calibrationVersion",
  "sha256",
] as const;

const safePath = /^[a-z0-9._/-]+$/;
const sha256Hex = /^[a-f0-9]{64}$/;

export function parseModelManifest(value: unknown): CleanFeedModelManifest {
  if (!isExactRecord(value, manifestKeys)) modelLoadFailed();

  if (
    value.schemaVersion !== 1 ||
    !isSafePath(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.version) ||
    value.task !== "ai_text_detection" ||
    !isNonEmptyString(value.architecture) ||
    !isSafePath(value.modelPath) ||
    !isSafePath(value.tokenizerPath) ||
    !isSafePath(value.configPath) ||
    !isSupportedLanguages(value.supportedLanguages) ||
    !isMaximumTokens(value.maximumTokens) ||
    !["none", "int8", "int4"].includes(value.quantization as string) ||
    !hasBinaryLabels(value.labels) ||
    !hasOutput(value.output) ||
    !isNonEmptyString(value.license) ||
    !isNonEmptyString(value.source) ||
    !isNonEmptyString(value.calibrationVersion) ||
    !hasSha256(value.sha256)
  ) {
    modelLoadFailed();
  }

  return value as unknown as CleanFeedModelManifest;
}

export async function verifyModelBundle(
  manifest: CleanFeedModelManifest,
  modelsBaseUrl: string,
  fetchImpl: BundleFetch = fetch,
): Promise<CleanFeedModelManifest> {
  const parsedManifest = parseModelManifest(manifest);
  const bundleBaseUrl = extensionModelDirectory(
    modelsBaseUrl,
    parsedManifest.id,
  );

  await Promise.all(
    (
      [
        ["model", parsedManifest.modelPath],
        ["tokenizer", parsedManifest.tokenizerPath],
        ["config", parsedManifest.configPath],
      ] as const
    ).map(async ([key, path]) => {
      const url = new URL(path, bundleBaseUrl);
      if (!url.href.startsWith(bundleBaseUrl.href)) modelLoadFailed();

      let response: Awaited<ReturnType<BundleFetch>>;
      try {
        response = await fetchImpl(url.href, { redirect: "error" });
      } catch {
        modelLoadFailed();
      }
      if (
        !response.ok ||
        response.redirected ||
        (response.url !== "" && response.url !== url.href)
      ) {
        modelLoadFailed();
      }

      const digest = await sha256Buffer(await response.arrayBuffer());
      if (digest !== parsedManifest.sha256[key]) modelLoadFailed();
    }),
  );

  return parsedManifest;
}

function extensionModelDirectory(modelsBaseUrl: string, id: string): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(modelsBaseUrl);
  } catch {
    return modelLoadFailed();
  }
  if (
    baseUrl.protocol !== "chrome-extension:" ||
    baseUrl.hostname === "" ||
    baseUrl.pathname !== "/models/" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    modelLoadFailed();
  }

  const bundleBaseUrl = new URL(`${id}/`, baseUrl);
  if (
    bundleBaseUrl.protocol !== baseUrl.protocol ||
    bundleBaseUrl.hostname !== baseUrl.hostname ||
    !bundleBaseUrl.pathname.startsWith(`${baseUrl.pathname}${id}/`)
  ) {
    modelLoadFailed();
  }
  return bundleBaseUrl;
}

async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    safePath.test(value) &&
    value.split("/").every((segment) => segment !== "" && segment !== ".") &&
    !value.includes("..") &&
    !value.startsWith("/")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupportedLanguages(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (language) => typeof language === "string" && language.length > 0,
    )
  );
}

function isMaximumTokens(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 32 &&
    value <= 512
  );
}

function hasBinaryLabels(
  value: unknown,
): value is { human: number; ai: number } {
  return (
    isExactRecord(value, ["human", "ai"]) &&
    Number.isSafeInteger(value.human) &&
    Number.isSafeInteger(value.ai) &&
    [value.human, value.ai].sort().join(",") === "0,1"
  );
}

function hasOutput(
  value: unknown,
): value is { name: string; kind: "logits" | "probabilities" } {
  return (
    isExactRecord(value, ["name", "kind"]) &&
    isNonEmptyString(value.name) &&
    (value.kind === "logits" || value.kind === "probabilities")
  );
}

function hasSha256(
  value: unknown,
): value is Record<"model" | "tokenizer" | "config", string> {
  return (
    isExactRecord(value, ["model", "tokenizer", "config"]) &&
    isSha256(value.model) &&
    isSha256(value.tokenizer) &&
    isSha256(value.config)
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && sha256Hex.test(value);
}

function modelLoadFailed(): never {
  throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
}

// ---------------------------------------------------------------------------
// Verified runtime descriptor: manifest + release + profiles + source lock.
//
// `loadRuntimeDescriptor` CLONES the immutable bundled imports (so nothing can
// mutate the sealed identity), runs the three closed parsers and returns the
// parsed descriptor. `crossValidateRuntimeDescriptor` then proves the three
// levels agree BEFORE any WorkerHost or ONNX session is built. Any drift fails
// closed with a coded `RuntimeDescriptorError`.
// ---------------------------------------------------------------------------

/** The three versioned descriptors plus the pinned source lock, all parsed. */
export interface RuntimeDescriptor {
  manifest: BundledModelManifest;
  release: ModelReleaseDescriptorV1;
  profiles: CalibrationProfilesFileV1;
  sourceLock: BundledSourceLock;
}

/** Raw, unparsed JSON inputs for {@link loadRuntimeDescriptor}. */
export interface RuntimeDescriptorSources {
  manifest: unknown;
  release: unknown;
  profiles: unknown;
  sourceLock: unknown;
}

/** Coded, fail-closed error thrown by the joint cross-validation. */
export class RuntimeDescriptorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeDescriptorError";
    this.code = code;
  }
}

const RUNTIME_IDENTITY_KEYS = [
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "aggregationVersion",
  "contentCompositionVersion",
] as const;

const MANIFEST_V2_KEYS = [
  "schemaVersion",
  "modelId",
  "modelVersion",
  "task",
  "backend",
  "modelFile",
  "aggregationVersion",
  "contentCompositionVersion",
  "tokenizerDigest",
  "windowing",
  "artifacts",
  "bundleDigest",
] as const;

const SOURCE_LOCK_KEYS = [
  "schemaVersion",
  "modelId",
  "revision",
  "baseUrl",
  "artifacts",
] as const;

/** Closed parser for the sealed schemaVersion-2 runtime manifest. */
export function parseBundledRuntimeManifest(
  value: unknown,
): BundledModelManifest {
  if (!isExactRecord(value, MANIFEST_V2_KEYS)) runtimeManifestInvalid();
  if (
    value.schemaVersion !== 2 ||
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.modelVersion) ||
    !isNonEmptyString(value.task) ||
    !isNonEmptyString(value.backend) ||
    !isSafePath(value.modelFile) ||
    !isNonEmptyString(value.aggregationVersion) ||
    !isNonEmptyString(value.contentCompositionVersion) ||
    !isSha256(value.tokenizerDigest) ||
    !isWindowing(value.windowing) ||
    !isArtifactArray(value.artifacts) ||
    !isSha256(value.bundleDigest)
  ) {
    runtimeManifestInvalid();
  }
  return value as unknown as BundledModelManifest;
}

/** Closed parser for the pinned upstream source lock. */
export function parseBundledSourceLock(value: unknown): BundledSourceLock {
  if (!isExactRecord(value, SOURCE_LOCK_KEYS)) sourceLockInvalid();
  if (
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.revision) ||
    !isNonEmptyString(value.baseUrl) ||
    !isArtifactArray(value.artifacts)
  ) {
    sourceLockInvalid();
  }
  return value as unknown as BundledSourceLock;
}

function defaultRuntimeDescriptorSources(): RuntimeDescriptorSources {
  return {
    manifest: bundledModelManifest,
    release: bundledReleaseDescriptor,
    profiles: bundledCalibrationProfiles,
    sourceLock: bundledSourceLock,
  };
}

/**
 * Clones the immutable bundled imports, runs the closed parsers and returns the
 * parsed descriptor. It performs NO cross-level check — call
 * {@link crossValidateRuntimeDescriptor} before constructing any WorkerHost.
 */
export async function loadRuntimeDescriptor(
  sources: RuntimeDescriptorSources = defaultRuntimeDescriptorSources(),
): Promise<RuntimeDescriptor> {
  const cloned = structuredClone(sources);
  const manifest = parseBundledRuntimeManifest(cloned.manifest);
  const release = await parseModelReleaseDescriptorV1(cloned.release);
  const profiles = await parseCalibrationProfilesFileV1(cloned.profiles);
  const sourceLock = parseBundledSourceLock(cloned.sourceLock);
  return { manifest, release, profiles, sourceLock };
}

/**
 * Proves the manifest, the release and every calibration profile agree, that
 * the manifest artifacts equal the source lock, that the calibration set digest
 * is coherent, and that no listed profile is already expired at `now`.
 */
export async function crossValidateRuntimeDescriptor(
  descriptor: RuntimeDescriptor,
  now: number = Date.now(),
): Promise<void> {
  const { manifest, release, profiles, sourceLock } = descriptor;

  if (!artifactsEqual(manifest.artifacts, sourceLock.artifacts)) {
    throw new RuntimeDescriptorError(
      "ARTIFACT_MISMATCH",
      "manifest artifacts do not exactly equal the embedded source lock",
    );
  }

  for (const key of RUNTIME_IDENTITY_KEYS) {
    if (manifest[key] !== release[key]) {
      throw new RuntimeDescriptorError(
        "RELEASE_IDENTITY_MISMATCH",
        `release.${key} does not match the manifest`,
      );
    }
  }

  const fileDigests: string[] = [];
  for (const profile of profiles.profiles) {
    for (const key of RUNTIME_IDENTITY_KEYS) {
      if (profile[key] !== manifest[key]) {
        throw new RuntimeDescriptorError(
          "PROFILE_IDENTITY_MISMATCH",
          `profile ${profile.profileId} disagrees with the manifest on ${key}`,
        );
      }
    }
    if (Date.parse(profile.expiresAt) <= now) {
      throw new RuntimeDescriptorError(
        "PROFILE_EXPIRED",
        `profile ${profile.profileId} is already expired at init`,
      );
    }
    fileDigests.push(profile.profileDigest);
  }

  if (new Set(fileDigests).size !== fileDigests.length) {
    throw new RuntimeDescriptorError(
      "DUPLICATE_PROFILE",
      "two profiles share the same digest",
    );
  }
  const releaseSet = new Set(release.profileDigests);
  const fileSet = new Set(fileDigests);
  if (
    releaseSet.size !== fileSet.size ||
    [...releaseSet].some((digest) => !fileSet.has(digest))
  ) {
    throw new RuntimeDescriptorError(
      "PROFILE_SET_MISMATCH",
      "release profileDigests and the profiles file are not the same set",
    );
  }

  const expectedSetDigest = await computeCalibrationSetDigest(fileDigests);
  if (release.calibrationSetDigest !== expectedSetDigest) {
    throw new RuntimeDescriptorError(
      "CALIBRATION_SET_MISMATCH",
      "calibrationSetDigest does not match the ordered/unique profile digests",
    );
  }

  const promoted =
    release.rolloutState === "indicator" || release.rolloutState === "actions";
  if (promoted && profiles.profiles.length === 0) {
    throw new RuntimeDescriptorError(
      "ROLLOUT_WITHOUT_PROFILES",
      "a promoted rollout requires at least one calibration profile",
    );
  }
  if (
    release.rolloutState === "bundle-verified" &&
    profiles.profiles.length !== 0
  ) {
    throw new RuntimeDescriptorError(
      "BUNDLE_VERIFIED_WITH_PROFILES",
      "a bundle-verified release carries no calibration profiles",
    );
  }
}

/**
 * Loads + cross-validates the descriptor and ONLY THEN calls the injected
 * `createWorkerHost` factory. On any parse or cross-validation failure the
 * factory is never invoked (no WorkerHost, no ONNX session is constructed).
 */
export async function createValidatedRuntimeHost<T>(
  createWorkerHost: (descriptor: RuntimeDescriptor) => T | Promise<T>,
  sources?: RuntimeDescriptorSources,
  now: number = Date.now(),
  load: (
    sources?: RuntimeDescriptorSources,
  ) => Promise<RuntimeDescriptor> = loadRuntimeDescriptor,
): Promise<T> {
  const descriptor = await load(sources);
  await crossValidateRuntimeDescriptor(descriptor, now);
  return createWorkerHost(descriptor);
}

function artifactsEqual(
  left: readonly BundledArtifactRecord[],
  right: readonly BundledArtifactRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const other = right[index]!;
    return (
      record.path === other.path &&
      record.bytes === other.bytes &&
      record.sha256 === other.sha256
    );
  });
}

function isWindowing(value: unknown): boolean {
  return (
    isExactRecord(value, [
      "modelMaxTokens",
      "contentTokens",
      "overlapTokens",
      "maxWindows",
    ]) &&
    Number.isSafeInteger(value.modelMaxTokens) &&
    Number.isSafeInteger(value.contentTokens) &&
    Number.isSafeInteger(value.overlapTokens) &&
    Number.isSafeInteger(value.maxWindows)
  );
}

function isArtifactArray(value: unknown): value is BundledArtifactRecord[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (record) =>
        isExactRecord(record, ["path", "bytes", "sha256"]) &&
        isSafePath(record.path) &&
        Number.isSafeInteger(record.bytes) &&
        (record.bytes as number) >= 0 &&
        isSha256(record.sha256),
    )
  );
}

function runtimeManifestInvalid(): never {
  throw new RuntimeDescriptorError(
    "MANIFEST_SCHEMA_INVALID",
    "the sealed runtime manifest is malformed",
  );
}

function sourceLockInvalid(): never {
  throw new RuntimeDescriptorError(
    "SOURCE_LOCK_INVALID",
    "the pinned source lock is malformed",
  );
}
