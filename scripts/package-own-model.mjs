#!/usr/bin/env node
// Packages a SELF-TRAINED detector checkpoint export into the sealed bundle
// layout (T7 for cleanfeed-ptbr-v1 and every future retrain).
//
//   node scripts/package-own-model.mjs --artifacts <dir-from-export-zip> \
//     --model-id cleanfeed-ptbr-v1
//
// It copies the runtime assets into public/models/<id>/, stamps the label
// semantics into config.json ({0: human, 1: ai} — the runtime manifest
// contract), computes the canonical artifact/tokenizer/bundle digests with the
// EXACT algorithm scripts/runtime-parity.mjs verifies, and writes the four
// tracked descriptors under models/<id>/ (manifest, source-lock, pending
// release, empty calibration profiles) plus LICENSE/NOTICE. The model version
// is the first 40 hex of the onnx SHA-256 — deterministic and auditable.
//
// Provenance: unlike the TMR (pinned Hugging Face download), this bundle is
// trained by the project itself; the source-lock's baseUrl uses the reserved
// `.invalid` TLD to state, syntactically-URL but unresolvable, that there is
// no upstream to fetch from. The verifier constants (scripts/model-lock.mjs)
// must be regenerated from this script's output — it prints the block.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The closed asset set of a WordPiece (BERT-family) bundle. */
const ASSET_PATHS = Object.freeze([
  "config.json",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
]);

/** Tokenizer subset whose records seal tokenizerDigest (canonical order). */
const TOKENIZER_PATHS = Object.freeze([
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
]);

const EMPTY_CALIBRATION_SET_DIGEST =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** Mirrors scripts/runtime-parity.mjs canonicalArtifactRecords byte-for-byte. */
function canonicalArtifactRecords(records) {
  const sorted = [...records].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return JSON.stringify(
    sorted.map(({ bytes, path, sha256 }) => ({ bytes, path, sha256 })),
  );
}

function parseArgs() {
  const out = {};
  for (let index = 2; index < argv.length; index += 2) {
    out[argv[index].replace(/^--/, "")] = argv[index + 1];
  }
  if (!out.artifacts || !out["model-id"]) {
    console.error(
      "usage: package-own-model.mjs --artifacts <dir> --model-id <id>",
    );
    exit(1);
  }
  return out;
}

function main() {
  const args = parseArgs();
  const modelId = args["model-id"];
  const source = args.artifacts;
  const publicDir = join(REPO_ROOT, "public", "models", modelId);
  const trackedDir = join(REPO_ROOT, "models", modelId);

  // 1. Copy assets, stamping the label semantics into config.json.
  mkdirSync(join(publicDir, "onnx"), { recursive: true });
  mkdirSync(trackedDir, { recursive: true });
  for (const assetPath of ASSET_PATHS) {
    const from = join(source, assetPath);
    if (!existsSync(from)) {
      console.error(`asset ausente no export: ${assetPath}`);
      exit(1);
    }
    const to = join(publicDir, assetPath);
    mkdirSync(dirname(to), { recursive: true });
    if (assetPath === "config.json") {
      const config = JSON.parse(readFileSync(from, "utf-8"));
      config.id2label = { 0: "human", 1: "ai" };
      config.label2id = { human: 0, ai: 1 };
      writeFileSync(to, JSON.stringify(config, null, 2) + "\n");
    } else {
      copyFileSync(from, to);
    }
  }

  // 2. Canonical records and digests.
  const artifacts = ASSET_PATHS.map((path) => {
    const bytes = statSync(join(publicDir, path)).size;
    const sha256 = sha256Hex(readFileSync(join(publicDir, path)));
    return { path, bytes, sha256 };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const onnx = artifacts.find((a) => a.path === "onnx/model_int8.onnx");
  const modelVersion = onnx.sha256.slice(0, 40);
  const tokenizerDigest = sha256Hex(
    canonicalArtifactRecords(
      artifacts.filter((a) => TOKENIZER_PATHS.includes(a.path)),
    ),
  );
  const bundleDigest = sha256Hex(canonicalArtifactRecords(artifacts));

  // 3. The four tracked descriptors (+ runtime manifest copy).
  const manifest = {
    schemaVersion: 2,
    modelId,
    modelVersion,
    task: "text-classification",
    backend: "transformers-onnx",
    modelFile: "onnx/model_int8.onnx",
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest,
    windowing: {
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    },
    artifacts,
    bundleDigest,
  };
  const sourceLock = {
    schemaVersion: 1,
    modelId,
    revision: modelVersion,
    baseUrl: `https://self-trained.invalid/${modelId}/${modelVersion}/`,
    artifacts,
  };
  const release = {
    schemaVersion: 1,
    modelId,
    modelVersion,
    bundleDigest,
    tokenizerDigest,
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    calibrationSetDigest: EMPTY_CALIBRATION_SET_DIGEST,
    profileDigests: [],
    rolloutState: "bundle-verified",
    gateDecision: "pending",
    issuedAt: null,
    evidenceDigest: null,
  };
  const licenseReview = {
    schemaVersion: 1,
    modelId,
    status: "pending",
    declaredLicense:
      "Projeto não-comercial; base BERTimbau (MIT); dados de treino conforme NOTICE.md",
    reviewedAt: null,
    reviewer: null,
    evidence: [],
  };

  const write = (dir, name, value) =>
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
  write(publicDir, "cleanfeed-model.json", manifest);
  write(trackedDir, "cleanfeed-model.json", manifest);
  write(trackedDir, "source-lock.json", sourceLock);
  write(trackedDir, "release.json", release);
  writeFileSync(
    join(trackedDir, "calibration-profiles.json"),
    '{ "schemaVersion": 1, "profiles": [] }\n',
  );
  write(trackedDir, "license-review.json", licenseReview);

  const notice = `# NOTICE — ${modelId}

Detector de texto gerado por IA para pt-BR, treinado pelo projeto CleanFeed AI
(fine-tune de BERTimbau-base — neuralmind/bert-base-portuguese-cased, MIT).

Uso NÃO-COMERCIAL: o conjunto de treino inclui dados sob CC BY-NC-SA 4.0
(Corpus Carolina/USP), condicionando este modelo ao regime não-comercial do
projeto. Demais dados de treino: Stack Exchange PT e Wikipédia PT (CC BY-SA
4.0, snapshots pré-2022-11), subset sintético de Madras1/corpus-ptbr-v1
(ODC-By 1.0) e gerações próprias (OpenAI/Gemini/Anthropic via APIs/CLI).

O modelo emite um score TÉCNICO não calibrado até que uma decisão científica
selada exista (release.json permanece "pending"); nenhuma saída constitui
alegação de autoria.
`;
  writeFileSync(join(trackedDir, "NOTICE.md"), notice);
  writeFileSync(join(publicDir, "NOTICE.md"), notice);
  const license = readFileSync(join(REPO_ROOT, "LICENSE"), "utf-8");
  writeFileSync(join(trackedDir, "LICENSE"), license);
  writeFileSync(join(publicDir, "LICENSE"), license);

  // 4. The verifier-constants block for scripts/model-lock.mjs.
  console.log(`modelId:        ${modelId}`);
  console.log(`modelVersion:   ${modelVersion}`);
  console.log(`bundleDigest:   ${bundleDigest}`);
  console.log(`tokenizerDigest:${tokenizerDigest}`);
  console.log("\n// SOURCE_ARTIFACTS para scripts/model-lock.mjs:");
  console.log(JSON.stringify(artifacts, null, 2));
}

main();
