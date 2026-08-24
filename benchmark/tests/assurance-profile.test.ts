import { describe, expect, it } from "vitest";

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSURANCE_PROFILE_NAMES,
  ASSURANCE_PROFILES,
  assuranceProfileOf,
  isAssuranceProfileName,
} from "../assurance-profile.ts";
import { EVALUATOR_FILES } from "../digests.ts";
import { AUTOMATED_FILTERS } from "../schema.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("the closed registry of assurance profiles", () => {
  it("names exactly the two profiles the seal knows how to enforce", () => {
    expect([...ASSURANCE_PROFILE_NAMES]).toEqual([
      "full-human-review-v1",
      "census-pii-screen-v1",
    ]);
  });

  it("refuses a name outside the registry, including a version that does not exist", () => {
    expect(isAssuranceProfileName("census-pii-screen-v2")).toBe(false);
    expect(isAssuranceProfileName("census-pii-screen")).toBe(false);
    expect(assuranceProfileOf("census-pii-screen-v2")).toBeUndefined();
  });

  it("makes the two impossible to confuse on the one axis that matters", () => {
    expect(
      ASSURANCE_PROFILES["full-human-review-v1"].humanReviewPerRecord,
    ).toBe(true);
    expect(
      ASSURANCE_PROFILES["census-pii-screen-v1"].humanReviewPerRecord,
    ).toBe(false);
  });

  it("binds no profile to a bound on real PII prevalence", () => {
    for (const name of ASSURANCE_PROFILE_NAMES) {
      expect(ASSURANCE_PROFILES[name].prevalenceBound).toBeNull();
    }
  });

  it("keeps the census profile PRE-REGISTERED, so nothing can be sealed under it yet", () => {
    const profile = ASSURANCE_PROFILES["census-pii-screen-v1"];
    expect(profile.activation.state).toBe("pre-registered");
    if (profile.activation.state !== "pre-registered") return;
    expect(profile.activation.activationRequires.length).toBeGreaterThan(0);
  });

  it("has the human profile active, because it is the semantics the seal already enforced", () => {
    expect(ASSURANCE_PROFILES["full-human-review-v1"].activation.state).toBe(
      "active",
    );
  });

  it("declares that neither profile satisfies R4 by itself, and the census one says so", () => {
    expect(ASSURANCE_PROFILES["census-pii-screen-v1"].satisfiesR4).toBe(false);
  });

  it("names the census profile's required filter, and it is a member of the closed filter union", () => {
    const required =
      ASSURANCE_PROFILES["census-pii-screen-v1"].requiredAutomatedFilter;
    expect(required).toBe("llm-pii-screen");
    expect(AUTOMATED_FILTERS as readonly string[]).toContain("llm-pii-screen");
  });

  it("requires no automated filter of the human profile, whose evidence is the per-record receipt", () => {
    expect(
      ASSURANCE_PROFILES["full-human-review-v1"].requiredAutomatedFilter,
    ).toBeNull();
  });

  it("declares the nine risks the census profile is not allowed to leave unnamed", () => {
    const risks = ASSURANCE_PROFILES["census-pii-screen-v1"].declaredRisks;
    expect(risks).toHaveLength(9);
    for (const fragment of [
      "verification bias",
      "confirmação humana",
      "falso cleared",
      "feedback adaptativo",
      "componente",
      "split temporal",
      "mutação de bytes",
      "PII relacional",
      "PPV",
    ]) {
      expect(risks.join(" | ")).toContain(fragment);
    }
  });

  it("lists what the census profile does NOT assert, including the two a reader would assume", () => {
    const doesNot =
      ASSURANCE_PROFILES["census-pii-screen-v1"].doesNotAssert.join(" | ");
    expect(doesNot).toContain("prevalência");
    expect(doesNot).toContain("leitura humana por registro");
    expect(doesNot).toContain("completude taxonômica");
    expect(doesNot).toContain("S_real");
    expect(doesNot).toContain("validação humana dos rótulos");
  });

  it("is part of the evaluator's identity, because its bytes decide which corpus may be sealed", () => {
    expect(EVALUATOR_FILES as readonly string[]).toContain(
      "benchmark/assurance-profile.ts",
    );
  });

  it("is never handed a registry by production code: the activation seam is for tests only", async () => {
    // DISCOVERED and not enumerated. A named list of callers answers a question about
    // the files someone remembered: a module that starts sealing tomorrow is not on it,
    // and the guard passes by not looking. So the walk finds every production module
    // that names the function, and the two assertions below are about what it found.
    const walked = await productionModules();
    const callers = new Map<string, number[]>();
    let declarationSeen = false;
    for (const [path, source] of walked) {
      if (source.includes("export async function sealDataset(")) {
        declarationSeen = true;
      }
      const arities = sealDatasetCallArities(source);
      if (arities.length > 0) callers.set(path, arities);
    }
    // ANTI-VACUITY, and it is the declaration itself rather than a count of files: a
    // walk that reached nothing would report no caller and pass, and a total over the
    // whole bench would move with every unrelated module added.
    expect(
      declarationSeen,
      "the walk did not reach benchmark/dataset-manifest.ts, so it proves nothing",
    ).toBe(true);
    // The production callers, by name. ONE, and a second one appearing is a decision
    // someone has to write down rather than a number that drifts.
    expect([...callers.keys()].sort()).toEqual([
      "benchmark/commands/validate.ts",
    ]);
    for (const [path, arities] of callers) {
      for (const arity of arities) {
        expect(
          arity,
          `${path} passes a registry to sealDataset; activation is a versioned literal, not a call-site argument`,
        ).toBeLessThanOrEqual(4);
      }
    }
  });
});

/**
 * Every production module of the bench and the extension, as (repo-relative path,
 * source). Test directories are out: they are where the seam is legitimately used.
 */
async function productionModules(): Promise<Array<[string, string]>> {
  const skipped = new Set([
    "node_modules",
    "tests",
    "data",
    "work",
    "evidence",
    "__pycache__",
    ".pytest_cache",
    "dist",
  ]);
  const wanted = /\.(?:ts|mts|mjs|js)$/u;
  const out: Array<[string, string]> = [];
  async function walk(relative: string): Promise<void> {
    const entries = await readdir(resolve(REPO_ROOT, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipped.has(entry.name)) continue;
        await walk(`${relative}/${entry.name}`);
        continue;
      }
      if (!wanted.test(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      out.push([path, await readFile(resolve(REPO_ROOT, path), "utf8")]);
    }
  }
  for (const root of ["benchmark", "src", "scripts", "contracts"]) {
    await walk(root);
  }
  return out;
}

/**
 * Top-level argument count of every `sealDataset(...)` CALL in a module.
 *
 * Balanced-paren scan and not a regex: an argument may itself be an object literal
 * or a nested call, so counting commas over the matched text answers a different
 * question. The declaration is skipped by the `function ` before the name — its
 * parameter list would otherwise read as the widest call in the file.
 */
function sealDatasetCallArities(source: string): number[] {
  const arities: number[] = [];
  const needle = "sealDataset(";
  for (let at = source.indexOf(needle); at !== -1;) {
    const before = source.slice(Math.max(0, at - 9), at);
    const open = at + needle.length;
    if (!before.endsWith("function ")) {
      let depth = 1;
      let index = open;
      let segmentStart = open;
      const segments: string[] = [];
      for (; index < source.length && depth > 0; index += 1) {
        const char = source[index];
        if (char === "(" || char === "[" || char === "{") depth += 1;
        else if (char === ")" || char === "]" || char === "}") {
          depth -= 1;
          if (depth === 0) segments.push(source.slice(segmentStart, index));
        } else if (char === "," && depth === 1) {
          segments.push(source.slice(segmentStart, index));
          segmentStart = index + 1;
        }
      }
      // A trailing comma leaves an empty last segment, which is formatting and not an
      // argument: prettier writes one on every multi-line call in this repo.
      arities.push(segments.filter((part) => part.trim().length > 0).length);
    }
    at = source.indexOf(needle, open);
  }
  return arities;
}
