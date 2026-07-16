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
    sha256Hex.test(value.model as string) &&
    sha256Hex.test(value.tokenizer as string) &&
    sha256Hex.test(value.config as string)
  );
}

function modelLoadFailed(): never {
  throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
}
