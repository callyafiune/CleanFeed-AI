// Scores topic-paired human/AI candidates through the REAL sealed TMR via the
// model-benchmark harness (offline Chromium + unpacked candidate extension).
// Lab bench: raw scores only, for the separation go/no-go — never sealed science.
//
//   node benchmark/lab/score_pairs.mjs \
//     --ai <ai_*.jsonl ...> --humans <human_*.jsonl ...> --output <scores.jsonl>
//
// Output rows: {id, class: "human"|"ai", family, pairedWith, status,
//               documentRawScore, reasonCode, words}

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const LAB_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIR = resolve(LAB_DIR, "..", "..", "dist-model-benchmark");

function parseArgs(argv) {
  const out = { ai: [], humans: [], output: null };
  let key = null;
  for (const token of argv) {
    if (token === "--ai" || token === "--humans" || token === "--output") {
      key = token.slice(2);
    } else if (key === "output") {
      out.output = token;
    } else if (key) {
      out[key].push(token);
    }
  }
  if (!out.ai.length || !out.humans.length || !out.output) {
    throw new Error(
      "usage: --ai <files...> --humans <files...> --output <file>",
    );
  }
  return out;
}

function readJsonl(path) {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const aiRows = args.ai.flatMap(readJsonl);
  const humansById = new Map();
  for (const path of args.humans) {
    for (const row of readJsonl(path)) humansById.set(row.candidateId, row);
  }

  // Work list: every AI row + each UNIQUE human parent (a parent picked by two
  // providers is scored once and referenced by both pairs).
  const work = [];
  const parentIds = new Set();
  for (const row of aiRows) {
    work.push({
      id: row.candidateId,
      class: "ai",
      family: row.meta.family,
      pairedWith: row.meta.pairedWith,
      words: row.wordCount,
      text: row.text,
    });
    parentIds.add(row.meta.pairedWith);
  }
  for (const parentId of parentIds) {
    const row = humansById.get(parentId);
    if (!row) {
      console.error(`parent ausente nos humanos: ${parentId}`);
      continue;
    }
    work.push({
      id: parentId,
      class: "human",
      family: row.domainSource,
      pairedWith: null,
      words: row.wordCount,
      text: row.text,
    });
  }
  console.log(
    `a pontuar: ${work.length} textos (${aiRows.length} ai + ${parentIds.size} humanos)`,
  );

  const context = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${CANDIDATE_DIR}`,
      `--load-extension=${CANDIDATE_DIR}`,
    ],
  });
  const results = [];
  try {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        void route.abort();
        return;
      }
      void route.continue();
    });
    const [existing] = context.serviceWorkers();
    const worker = existing ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/model-benchmark.html`);
    await page.waitForFunction(
      () => globalThis.__cleanfeedModelBenchmark !== undefined,
      null,
      { timeout: 180000 },
    );
    const status = await page.evaluate(
      () => globalThis.__cleanfeedModelBenchmark.status,
    );
    if (status.state !== "ready")
      throw new Error(`harness: ${status.errorCode}`);

    let index = 0;
    for (const item of work) {
      index += 1;
      const score = await page.evaluate(
        (text) => globalThis.__cleanfeedModelBenchmark.score(text),
        item.text,
      );
      results.push({
        id: item.id,
        class: item.class,
        family: item.family,
        pairedWith: item.pairedWith,
        words: item.words,
        status: score.status,
        documentRawScore: score.documentRawScore,
        reasonCode: score.reasonCode,
      });
      if (index % 20 === 0) console.log(`  ${index}/${work.length}`);
    }
  } finally {
    await context.close();
  }
  writeFileSync(
    args.output,
    results.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf-8",
  );
  const scored = results.filter((row) => row.status === "scored").length;
  console.log(`pontuados: ${scored}/${results.length} -> ${args.output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
