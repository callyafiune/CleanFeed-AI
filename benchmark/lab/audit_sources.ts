// Runs the corpus source governance audit on a build directory, standalone.
//
// WHY: `validate` runs this audit, but only AFTER sealDataset has enforced the
// exact class quotas — so while the corpus is still being filled, the nine
// governance blocking codes stay invisible behind a composition error. This lets
// them be found and fixed against an incomplete build instead of surfacing at
// the very end, when the only remaining task is supposed to be sealing.
//
// Reports status and blocking reasons grouped by code. Read-only: it writes
// nothing and consumes only the build's records + reviewed source manifest.
//
// Usage:
//   node --experimental-transform-types benchmark/lab/audit_sources.ts <build-dir>

import { readFile } from "node:fs/promises";
import { argv } from "node:process";

import { auditCorpusSources } from "../corpus-source-audit.ts";
import type { BenchmarkRecord } from "../schema.ts";

const directory = argv[2];
if (directory === undefined) {
  throw new Error("usage: audit_sources.ts <build-dir>");
}

const records = (await readFile(`${directory}/records.jsonl`, "utf8"))
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as BenchmarkRecord);
const sourceManifest = JSON.parse(
  await readFile(`${directory}/private/source-manifest.json`, "utf8"),
);

const report = await auditCorpusSources({ records, sourceManifest });
const reasons = report.blockingReasons ?? [];

console.log(
  `status=${report.status} records=${records.length} ` +
    `sources=${sourceManifest.sources.length} motivos=${reasons.length}`,
);

const byCode = new Map<string, number>();
for (const reason of reasons) {
  byCode.set(reason.code, (byCode.get(reason.code) ?? 0) + 1);
}
for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code}: ${count}`);
}
// A couple of verbatim reasons per code make the fix obvious without dumping
// thousands of lines; the reasons carry only pseudonymised ids by contract.
const shown = new Map<string, number>();
for (const reason of reasons) {
  const seen = shown.get(reason.code) ?? 0;
  if (seen >= 2) continue;
  shown.set(reason.code, seen + 1);
  console.log(`  exemplo ${reason.code}: ${JSON.stringify(reason)}`);
}
