// Post-build sanitizer. Two responsibilities:
//
//  1. Always: rewrite any residual remote runtime host in shipped text files to
//     "offline", so the packaged extension can never reach the network.
//  2. Model release mode (CLEANFEED_MODEL_RELEASE_MODE):
//       - absent  -> a normal build; nothing else happens.
//       - reject  -> the scientific reject release omits the model entirely, so
//                    the TMR directory is removed from INSIDE the resolved dist.
//       - package -> an indicator/actions release keeps the whole bundle;
//                    nothing is removed.
//       - other   -> fail closed.

import console from "node:console";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

// Only executable/style text is rewritten for the offline host. Provenance
// JSON (e.g. the materialized release.json / calibration-profiles.json and the
// offline asset manifest) is NEVER rewritten, so the package audit can compare
// it byte-for-byte against the versioned source.
const textFile = /\.(?:js|mjs|cjs|html|css)$/u;

async function sanitizeText(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sanitizeText(path);
    else if (textFile.test(entry.name)) {
      const source = await readFile(path, "utf8");
      const sanitized = source
        .replaceAll("https://huggingface.co", "offline")
        .replaceAll("https://cdn.jsdelivr.net", "offline")
        .replaceAll("https:\\/\\/huggingface.co", "offline")
        .replaceAll("https:\\/\\/cdn.jsdelivr.net", "offline");
      if (sanitized !== source) await writeFile(path, sanitized);
    }
  }
}

export async function sanitizeOfflineBundle({ distDir, releaseMode } = {}) {
  const dist = resolve(distDir ?? "dist");
  await sanitizeText(dist);

  if (releaseMode === undefined || releaseMode === "") return;
  if (releaseMode === "reject") {
    // Only ever touches a path INSIDE the resolved dist.
    const tmrDir = join(dist, "models", "cleanfeed-ptbr-v1");
    if (existsSync(tmrDir)) await rm(tmrDir, { recursive: true, force: true });
    return;
  }
  if (releaseMode === "package") return; // keep everything
  throw new Error(`unknown CLEANFEED_MODEL_RELEASE_MODE: ${releaseMode}`);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  sanitizeOfflineBundle({
    releaseMode: env.CLEANFEED_MODEL_RELEASE_MODE,
  }).catch((error) => {
    console.error(`sanitize FAILED — ${error.message ?? error}`);
    exit(1);
  });
}
