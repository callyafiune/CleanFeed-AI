import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Counts that `docs/ESTADO.md` § 5.6 publishes as MEASURED over `docs/references.md`.
 *
 * These exist because the published values aged in silence twice: prose does not
 * recount, so a number written before the last reference was added stays in the
 * document agreeing with nothing while the whole suite passes over it. Reading them
 * here is what makes them measurements rather than memories — the same reason
 * `digests.test.ts` reads the `evaluatorDigest` out of the same section.
 *
 * A failure here is not a defect in the code: it means `references.md` moved and § 5.6
 * has to be re-read. The message says so.
 */

/**
 * Occurrences of the `](` joint followed by a URL — the marker that makes a link a
 * link.
 *
 * COUNTED ON THE WHOLE FILE AND NOT PER LINE, which is the trap that produced the
 * wrong published value. `references.md` is wrapped at about 100 columns and 38 of its
 * link labels break across a line, so the `[label](url)` shape does not occur on any
 * single line for those; a per-line regex silently undercounts by one for each of them.
 * The joint cannot break, because a newline between `]` and `(` would stop it being a
 * markdown link at all.
 */
function countLinkMarkers(markdown: string): number {
  return markdown.split("](http").length - 1;
}

function countTopLevelSections(markdown: string): number {
  return markdown.split("\n").filter((line) => line.startsWith("## ")).length;
}

function countLiteral(markdown: string, literal: string): number {
  return markdown.split(literal).length - 1;
}

describe("the reference counts published in ESTADO § 5.6", () => {
  it("reproduce from references.md under the rule the section declares", async () => {
    const references = await readFile(
      resolve(REPO_ROOT, "docs/references.md"),
      "utf8",
    );
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");

    const markers = countLinkMarkers(references);
    const sections = countTopLevelSections(references);
    const declarations = countLiteral(references, "Sem precedente encontrado");

    expect(
      estado,
      `docs/ESTADO.md § 5.6 must publish **${markers}** link markers`,
    ).toContain(`**${markers}** marcadores de link`);
    expect(
      estado,
      `docs/ESTADO.md § 5.6 must publish **${sections}** \`##\` sections`,
    ).toContain(`**${sections}** seções de nível \`##\``);
    expect(
      estado,
      `docs/ESTADO.md § 5.6 must publish **${declarations}** literal declarations`,
    ).toContain(`**${declarations}** declarações literais`);
  });

  it("counts the joint and not the per-line shape, which is what undercounted", () => {
    // The wrapped label this file has 38 of. A per-line `[label](url)` regex misses it;
    // the joint does not.
    const wrapped =
      "veja [Lopez-Paz & Oquab,\n2017](https://example.org/a) e o resto";
    expect(countLinkMarkers(wrapped)).toBe(1);
    expect(
      wrapped
        .split("\n")
        .filter((line) => /\[[^\]]*\]\(http[^)]*\)/u.test(line)),
    ).toHaveLength(0);

    const twoOnOneLine = "[a](https://a.example) e [b](https://b.example)";
    expect(countLinkMarkers(twoOnOneLine)).toBe(2);
    expect(countLinkMarkers("nenhum link aqui")).toBe(0);
    // A relative link is not a reference: `docs:check` is what resolves those.
    expect(countLinkMarkers("[o plano](./plano.md)")).toBe(0);
  });
});
