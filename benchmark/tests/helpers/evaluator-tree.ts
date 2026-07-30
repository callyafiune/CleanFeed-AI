// A synthetic tree that satisfies the evaluator inventory. Nothing imports from
// it: `computeEvaluatorDigest` only hashes path + NUL + bytes, so one synthetic
// line per declared path is a complete stand-in for the real source tree — and a
// far cheaper one than hashing the repository on every scenario.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EVALUATOR_FILES } from "../../digests.ts";

/** Creates an empty temporary directory for a synthetic evaluator tree. */
export async function makeEvaluatorRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cleanfeed-evaluator-"));
}

/**
 * Writes one synthetic file per path in `EVALUATOR_FILES`. `mutate` receives the
 * relative path and the baseline content so a caller can move exactly one file and
 * prove the aggregate digest follows it.
 */
export async function writeEvaluatorFixture(
  root: string,
  mutate?: (relativePath: string, content: string) => string,
): Promise<void> {
  for (const relativePath of EVALUATOR_FILES) {
    const absolute = join(root, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    const base = `// fixture content for ${relativePath}\n`;
    await writeFile(
      absolute,
      mutate ? mutate(relativePath, base) : base,
      "utf8",
    );
  }
}
