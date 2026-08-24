import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DECLARED_MATERIAL_BATCHES,
  reviewedSourceManifestBodyOf,
  writeGovernance,
  type GovernanceInputs,
} from "../lab/build_governance.ts";
import { parseReviewedSourceManifest } from "../source-manifest.ts";

/** The governance inputs `assemble_corpus.py` emits for a one-cell corpus. */
function inputs(): GovernanceInputs {
  return {
    datasetId: "cleanfeed-ptbr-cells-v1",
    sources: [
      {
        sourceId: "src_wikipedia_pt",
        sourceType: "licensed-corpus",
        licenseId: "cc-by-sa-4.0",
      },
      {
        sourceId: "src_ai",
        sourceType: "controlled-generation",
        licenseId: "internal-generation-v1",
      },
    ],
    heldOutGeneratorFamilies: ["gpt-5_6-luna"],
    licenses: [
      {
        id: "cc-by-sa-4.0",
        name: "Creative Commons Attribution-ShareAlike 4.0",
        url: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
    ],
    generationBatches: [],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-governance-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the governance writer mints a v2 reviewed manifest", () => {
  it("writes schemaVersion 2 with the declared acquisition inventory, and the closed parser accepts the self-digest", async () => {
    await writeGovernance(inputs(), root, DECLARED_MATERIAL_BATCHES);

    const raw = JSON.parse(
      await readFile(join(root, "private", "source-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(2);
    expect(raw.materialBatches).toEqual([...DECLARED_MATERIAL_BATCHES]);

    // The parser is the authority on the digest: at v2 `materialBatches` enters the
    // hashed projection unconditionally, so a writer that hashed the v1 projection
    // fails here rather than one step later, on a file nobody edited by hand.
    const parsed = await parseReviewedSourceManifest(raw);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.materialBatches).toEqual([...DECLARED_MATERIAL_BATCHES]);
  });

  it("declares one acquisition, keyed on the concrete dump, for the Wikipedia source", () => {
    expect(DECLARED_MATERIAL_BATCHES).toHaveLength(1);
    expect(DECLARED_MATERIAL_BATCHES[0]).toMatchObject({
      batchId: "smb_ptwiki-20220301",
      sourceId: "src_wikipedia_pt",
      materialVersion: "ptwiki-20220301",
      acquisitionWindow: { startedAt: 1784753446707, endedAt: 1784753446707 },
    });
    // Evidence non-empty is what the parser demands; what makes it evidence is that a
    // third party can recompute it, so the digest and the byte count travel with it.
    expect(DECLARED_MATERIAL_BATCHES[0]?.evidence).toContain(
      "sha256:70c9ec4f700205ab586ab86dd21a5fe62fc543a5341770c84a28c343225f8b52",
    );
  });
});

describe("the governance writer, driven as the documented command", () => {
  it("writes both files and prints the digest of the manifest it wrote", async () => {
    // Driven as a subprocess because the entry point is a PREDICATE over `argv[1]`, not a
    // top-level call: every other test here imports `writeGovernance` and would stay green
    // with the predicate stuck at `false`, while the documented command exits 0 having
    // written nothing.
    const script = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../lab/build_governance.ts",
    );
    const inputsPath = join(root, "governance-inputs.json");
    await writeFile(
      inputsPath,
      JSON.stringify(inputs(), null, 2) + "\n",
      "utf8",
    );

    const run = spawnSync(execPath, [script, inputsPath, root], {
      encoding: "utf8",
    });

    expect(run.status, run.stderr).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(root, "private", "source-manifest.json"), "utf8"),
    ) as { schemaVersion: number; sourceManifestDigest: string };
    expect(manifest.schemaVersion).toBe(2);
    expect(await exists(join(root, "manifest-template.json"))).toBe(true);
    // The printed digest is the one in the file: a run that reported someone else's digest
    // would hand the operator a value to paste that certifies a body it did not write.
    expect(run.stdout).toContain(manifest.sourceManifestDigest.slice(0, 12));
    expect(run.stdout).toContain("1 lote(s) de material");
  });

  it("mints a template whose release claim carries the assurance profile it is made under", async () => {
    await writeGovernance(inputs(), root, DECLARED_MATERIAL_BATCHES);

    const template = JSON.parse(
      await readFile(join(root, "manifest-template.json"), "utf8"),
    ) as { scientificUse: string; assuranceProfile?: string };
    // The two together, because either alone is a manifest the seal cannot parse: a
    // release corpus with no profile is refused, and a profile on a corpus that is not
    // release is refused too.
    expect(template.scientificUse).toBe("release");
    expect(template.assuranceProfile).toBe("census-pii-screen-v1");
  });
});

describe("the governance writer refuses an inventory a v4 corpus cannot resolve against", () => {
  it("refuses to write an empty material inventory, and leaves no file behind", async () => {
    await expect(writeGovernance(inputs(), root, [])).rejects.toMatchObject({
      code: "MATERIAL_BATCHES_EMPTY",
    });
    expect(await exists(join(root, "private", "source-manifest.json"))).toBe(
      false,
    );
    expect(await exists(join(root, "manifest-template.json"))).toBe(false);
  });

  it("refuses a batch whose sourceId the manifest does not declare, naming batch and source", async () => {
    const orphan = {
      ...DECLARED_MATERIAL_BATCHES[0],
      batchId: "smb_carolina-2_0-bea",
      sourceId: "src_carolina",
    };
    await expect(
      writeGovernance(inputs(), root, [orphan]),
    ).rejects.toMatchObject({
      code: "MATERIAL_BATCH_SOURCE_UNDECLARED",
      message: expect.stringContaining("smb_carolina-2_0-bea"),
    });
    await expect(
      writeGovernance(inputs(), root, [orphan]),
    ).rejects.toMatchObject({
      message: expect.stringContaining("src_carolina"),
    });
    expect(await exists(join(root, "private", "source-manifest.json"))).toBe(
      false,
    );
    expect(await exists(join(root, "manifest-template.json"))).toBe(false);
  });

  it("o escritor recusa lote cuja evidência nomeia a URL do dump, e não deixa arquivo atrás", async () => {
    // O caminho de ESCRITA tem recusa PRÓPRIA: um manifesto recusado na leitura já foi escrito em
    // disco, e o inventário declarado aqui é a mesma coisa que o produtor grava. `governance-inputs`
    // vem do lado Python, então a recusa precisa acontecer antes do primeiro `mkdir`.
    const comUrl = {
      ...DECLARED_MATERIAL_BATCHES[0],
      evidence: [
        ...(DECLARED_MATERIAL_BATCHES[0]?.evidence ?? []),
        "https://dumps.wikimedia.org/ptwiki/20220301/",
      ],
    };
    await expect(
      writeGovernance(inputs(), root, [comUrl]),
    ).rejects.toMatchObject({ code: "SOURCE_MANIFEST_SOURCE_LOCATOR" });
    expect(await exists(join(root, "private", "source-manifest.json"))).toBe(
      false,
    );
    expect(await exists(join(root, "manifest-template.json"))).toBe(false);

    // E o inventário DECLARADO passa por essa mesma recusa: o localizador nunca foi carga, porque
    // `materialVersion` já nomeia o dump e o digest é o que um terceiro recomputa.
    await expect(
      writeGovernance(inputs(), root, DECLARED_MATERIAL_BATCHES),
    ).resolves.toMatchObject({ sources: 2 });
  });

  it("refuses the declared inventory itself when the corpus declares no source at all", () => {
    // The real shape of the failure: a corpus with no human row projects no
    // `src_wikipedia_pt` entry, and then the ptwiki batch resolves against nothing.
    expect(() =>
      reviewedSourceManifestBodyOf(
        { ...inputs(), sources: [] },
        DECLARED_MATERIAL_BATCHES,
      ),
    ).toThrow(/no source at all/u);
  });
});
