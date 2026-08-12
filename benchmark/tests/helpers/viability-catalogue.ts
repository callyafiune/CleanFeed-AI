// O lado TypeScript do catálogo de viabilidade compartilhado
// (`benchmark/tests/fixtures/viability-agreement.json`).
//
// O arquivo declara GEOMETRIA — quantos componentes, com quantas linhas de que classe,
// em que célula, sob que estrato e que lote de material —, nunca registros prontos. A
// razão é que os dois lados que têm de concordar escrevem registro em idiomas
// diferentes: aqui um `BenchmarkRecord` v4 que passa pelo validador de verdade, no lab
// um dicionário com os eixos que `assemble_corpus` escreve. O que precisa ser comum é o
// corpo, e o corpo é a geometria.
//
// A REGRA DE MATERIALIZAÇÃO está escrita no próprio JSON e implementada duas vezes, uma
// por lado. Uma segunda escrita de uma regra é sempre um risco de divergência, e o que
// o fecha é cada lado conferir o histograma de componentes e as contagens por classe
// MEDIDOS contra os DECLARADOS antes de comparar veredito: um materializador que
// divergiu produz outro histograma e fica vermelho no próprio lado.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  groupAxisIdentity,
  validateBenchmarkRecordV4,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type GroupAxis,
} from "../../schema.ts";
import {
  connectedComponentRoots,
  GROUP_KEYS,
  IMPOSED_UNION_AXES,
} from "../../split.ts";
import { known, v4Ai, v4Human, withAxis } from "./v3-record-fixture.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

export const CATALOGUE_PATH = join(
  AQUI,
  "..",
  "fixtures",
  "viability-agreement.json",
);

export interface ComponentRun {
  readonly count: number;
  /** Lines of each class every component of the run holds. */
  readonly lines: Readonly<Partial<Record<BenchmarkLabel, number>>>;
}

export interface CatalogueCell {
  readonly cell: string;
  /** `null` for a cell that declares no human line. */
  readonly stratum: string | null;
  readonly materialBatch: string | null;
  readonly components: readonly ComponentRun[];
}

export interface CatalogueBreach {
  readonly scope: string;
  readonly kind: string;
}

/**
 * The prompt-template and generator-version identities a case's GENERATED lines share,
 * as runs over the order they are materialized in.
 *
 * A case without this block gives every generated line its own template and version,
 * which is the fine-grained shape no assembler produces. A case WITH it describes the
 * measured shape: one recipe covering hundreds of lines.
 */
export interface GeneratedRecipe {
  readonly promptTemplateRuns: readonly number[];
  readonly generatorVersionRuns: readonly number[];
}

/**
 * The union list MINUS the IMPOSED axes: the base each `recipeUnioned` leg is measured on.
 *
 * DERIVED and never retyped, so the base cannot drift from the production list. Adding a
 * leg's axes back to this base is what makes `promptTemplateOnly` the PRODUCTION geometry,
 * `generatorVersionOnly` the relation production does NOT take, and `bothRecipeAxes` the
 * counterfactual of taking both; measuring a leg as `[...GROUP_KEYS, axis]` would be a
 * no-op for the template and every leg would report the same histogram.
 */
export const RECIPE_UNION_BASE_AXES: readonly GroupAxis[] = GROUP_KEYS.filter(
  (axis) => !(IMPOSED_UNION_AXES as readonly string[]).includes(axis),
);

/** One geometry a SUB-RELATION of the production union produces over a case's corpus. */
export interface RecipeUnionedGeometry {
  readonly axes: readonly string[];
  readonly components: number;
  readonly histogram: readonly number[];
  readonly breaches: readonly CatalogueBreach[];
}

export interface ViabilityCase {
  readonly name: string;
  readonly cells: readonly CatalogueCell[];
  readonly generatedRecipe?: GeneratedRecipe;
  readonly expected: {
    readonly recordLines: number;
    readonly classLines: Readonly<Partial<Record<BenchmarkLabel, number>>>;
    readonly distinctStrata: number;
    readonly distinctMaterialBatches: number;
    readonly breaches: readonly CatalogueBreach[];
    readonly splitterRefuses: boolean;
    /** Substring of the `SplitConstraintError` message; `null` when it accepts. */
    readonly splitterRefusal: string | null;
    readonly splitSizes?: Readonly<Record<string, number>>;
    readonly recipeUnioned?: {
      /**
       * The leg the splitter does NOT take, and the measurement that says it never needed
       * to: on the shape the pools produce it FITS — five runs, the largest 42.14%, no
       * breach — so unioning on the version would not have bought the granularity. What
       * does not fit is the template, which is the axis production does union on.
       */
      readonly generatorVersionOnly: RecipeUnionedGeometry;
      /** The PRODUCTION geometry: the base plus the one imposed axis. */
      readonly promptTemplateOnly: RecipeUnionedGeometry;
      /** The COUNTERFACTUAL: the closure unioning on both would have produced. */
      readonly bothRecipeAxes: RecipeUnionedGeometry;
    };
  };
}

export interface ViabilityCatalogue {
  readonly generatedStratum: string;
  readonly expectedBreachVocabulary: readonly string[];
  readonly extremeTargets: {
    readonly largest: { readonly partition: string; readonly fraction: number };
    readonly smallest: {
      readonly partition: string;
      readonly fraction: number;
    };
    readonly tolerance: number;
  };
  readonly cases: readonly ViabilityCase[];
}

/**
 * Reads the shared catalogue, refusing an empty case list.
 *
 * Fail-closed on emptiness because every assertion below is `it.each` over the cases:
 * a catalogue that parsed to zero cases would run zero tests and report green.
 */
export async function loadCatalogue(): Promise<ViabilityCatalogue> {
  const catalogue = JSON.parse(
    await readFile(CATALOGUE_PATH, "utf8"),
  ) as ViabilityCatalogue;
  if (catalogue.cases.length === 0) {
    throw new Error(
      `${CATALOGUE_PATH} declara zero casos: um catálogo vazio deixaria a suíte de concordância verde sem medir nada`,
    );
  }
  return catalogue;
}

/**
 * The identity of each generated line on one recipe axis, expanded from the declared
 * runs. Fails closed when the runs do not cover the case's generated lines exactly: a
 * short run list would leave the tail on per-line identities and quietly measure a
 * finer shape than the case declares.
 */
function recipeLabels(
  runs: readonly number[],
  prefix: string,
  generatedLines: number,
  caseName: string,
): string[] {
  const labels: string[] = [];
  runs.forEach((count, index) => {
    for (let line = 0; line < count; line += 1)
      labels.push(`${prefix}_${index}`);
  });
  if (labels.length !== generatedLines) {
    throw new Error(
      `o caso "${caseName}" declara corridas de ${prefix} somando ${labels.length} e tem ${generatedLines} linha(s) gerada(s)`,
    );
  }
  return labels;
}

/** Generated lines a case declares, which is what the recipe runs must cover. */
function generatedLineCount(testCase: ViabilityCase): number {
  return testCase.cells.reduce(
    (total, cell) =>
      total +
      cell.components.reduce(
        (perCell, run) => perCell + run.count * (run.lines.ai ?? 0),
        0,
      ),
    0,
  );
}

/**
 * Materializes one case as v4 record-lines.
 *
 * The human lines of a component SHARE an author — `author` is a v4 union axis — and
 * the generated lines of the same component name the component's first human line in
 * `humanSeed`, the PARENT LINKAGE axis, which is how a generated row is dependent on
 * the material it was seeded from. A component with no human line seeds off an absent
 * id, so it unions nothing. Every line carries its own origin document, its own
 * near-duplicate group and, when generated, its own generation batch, so the component
 * size is the declared number of lines and nothing else glues them.
 *
 * `promptTemplate` and `generatorVersion` are per line TOO, unless the case declares
 * `generatedRecipe`: then they come from the declared runs, in materialization order. Only
 * the TEMPLATE is a union axis, so a declared template run really does union its lines —
 * which is why a case with `generatedRecipe` must declare its components at the size the
 * TEMPLATE runs produce, not one component per line and not one per version run. A version
 * run unions nothing here; it is what the `recipeUnioned` sub-relations are measured over.
 * Two run lists over the same materialization order yield a PARTITION exactly when the
 * boundaries of one refine the boundaries of the other, and {@link templateToVersionMap} is
 * what makes a case assert that instead of inheriting it by coincidence.
 *
 * `createdAt` is a distinct increasing slot per line and `normalizedTextSha256` a
 * distinct digest per line, because the corpus is also handed to `createBlockedSplit`
 * (which searches over DISTINCT timestamps) and to `parseBenchmarkDataset` (which
 * refuses a repeated digest). A fixture with one timestamp would be refused by the
 * splitter for having no candidate cut at all, which would prove nothing about
 * geometry.
 */
export function buildCatalogueCorpus(
  testCase: ViabilityCase,
  generatedStratum: string,
): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  let slot = 0;
  const nextSlot = (): { createdAt: number; digest: string } => {
    slot += 1;
    return {
      createdAt: slot * 1_000,
      digest: slot.toString(16).padStart(64, "0"),
    };
  };

  const generatedLines = generatedLineCount(testCase);
  const recipe = testCase.generatedRecipe;
  const templateLabels =
    recipe === undefined
      ? undefined
      : recipeLabels(
          recipe.promptTemplateRuns,
          "pt",
          generatedLines,
          testCase.name,
        );
  const versionLabels =
    recipe === undefined
      ? undefined
      : recipeLabels(
          recipe.generatorVersionRuns,
          "gv",
          generatedLines,
          testCase.name,
        );
  let generatedIndex = 0;

  testCase.cells.forEach((cell, cellIndex) => {
    let componentIndex = 0;
    for (const run of cell.components) {
      for (let copy = 0; copy < run.count; copy += 1) {
        const tag = `${cellIndex}_${componentIndex}`;
        const humanLines = run.lines.human ?? 0;
        for (let line = 0; line < humanLines; line += 1) {
          const { createdAt, digest } = nextSlot();
          if (cell.stratum === null || cell.materialBatch === null) {
            throw new Error(
              `a célula "${cell.cell}" declara linha humana sem estrato ou sem lote de material`,
            );
          }
          let raw: Record<string, unknown> = {
            ...v4Human(),
            id: `h_${tag}_${line}`,
            humanSourceType: cell.cell,
            createdAt,
            normalizedTextSha256: digest,
          };
          raw = withAxis(raw, "author", known(`au_hmac_${tag}`));
          raw = withAxis(raw, "source", known(`th_doc_${tag}_${line}`));
          raw = withAxis(raw, "nearDuplicate", known(`nd_${tag}_${line}`));
          raw = withAxis(raw, "domainSource", known(cell.stratum));
          raw = withAxis(raw, "sourceMaterialBatch", known(cell.materialBatch));
          records.push(
            validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord,
          );
        }
        const aiLines = run.lines.ai ?? 0;
        for (let line = 0; line < aiLines; line += 1) {
          const { createdAt, digest } = nextSlot();
          let raw: Record<string, unknown> = {
            ...v4Ai(),
            id: `a_${tag}_${line}`,
            createdAt,
            normalizedTextSha256: digest,
          };
          raw = withAxis(
            raw,
            "promptTemplate",
            known(templateLabels?.[generatedIndex] ?? `pt_${tag}_${line}`),
          );
          raw = withAxis(
            raw,
            "generatorVersion",
            known(versionLabels?.[generatedIndex] ?? `gv_${tag}_${line}`),
          );
          generatedIndex += 1;
          raw = withAxis(raw, "generationBatch", known(`gb_${tag}_${line}`));
          raw = withAxis(raw, "nearDuplicate", known(`nd_a_${tag}_${line}`));
          raw = withAxis(raw, "domainSource", known(generatedStratum));
          raw = withAxis(
            raw,
            "humanSeed",
            known(humanLines > 0 ? `h_${tag}_0` : `h_ausente_${tag}_${line}`),
          );
          records.push(
            validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord,
          );
        }
        componentIndex += 1;
      }
    }
  });
  return records;
}

/**
 * The template -> version map a case's declared runs produce, or `undefined` for a case
 * that declares no runs.
 *
 * What it makes checkable is the DECLARATION and not the island plan: the plan partitions
 * templates, seed blocks and mixing templates, and NOT the version, so nothing downstream
 * asks a template to sit inside one version run. What does ask is the counterfactual leg —
 * a case whose run boundaries straddle each other makes `bothRecipeAxes` close over a
 * coarser set than the declared version runs, so the leg would report a geometry no
 * declaration in the case names. The function property is what keeps that leg readable.
 */
export function templateToVersionMap(
  testCase: ViabilityCase,
): Map<string, Set<string>> | undefined {
  const recipe = testCase.generatedRecipe;
  if (recipe === undefined) return undefined;
  const generatedLines = generatedLineCount(testCase);
  const templates = recipeLabels(
    recipe.promptTemplateRuns,
    "pt",
    generatedLines,
    testCase.name,
  );
  const versions = recipeLabels(
    recipe.generatorVersionRuns,
    "gv",
    generatedLines,
    testCase.name,
  );
  const map = new Map<string, Set<string>>();
  templates.forEach((template, index) => {
    const seen = map.get(template) ?? new Set<string>();
    seen.add(versions[index] as string);
    map.set(template, seen);
  });
  return map;
}

/** The declared component sizes of a case, ascending — what the histogram must match. */
export function declaredHistogram(testCase: ViabilityCase): number[] {
  return testCase.cells
    .flatMap((cell) =>
      cell.components.flatMap((run) =>
        Array.from(
          { length: run.count },
          () => (run.lines.human ?? 0) + (run.lines.ai ?? 0),
        ),
      ),
    )
    .sort((a, b) => a - b);
}

/** Component sizes in ascending order, by the splitter's own connectivity. */
export function componentHistogram(
  records: readonly BenchmarkRecord[],
): number[] {
  const sizeByRoot = new Map<string, number>();
  for (const root of connectedComponentRoots(records).values()) {
    sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
  }
  return [...sizeByRoot.values()].sort((a, b) => a - b);
}

/**
 * Connected components under an EXPLICIT axis list, so a test can measure the geometry a
 * SUB-RELATION of the production union produces — or the geometry a list the splitter does
 * NOT use would produce.
 *
 * `connectedComponentRoots` reads `GROUP_KEYS` from the module, and a const export cannot
 * be substituted at runtime, so measuring "what would happen with only `promptTemplate` of
 * the pair" needs a walk that takes the list. A second walk is a divergence risk, and
 * {@link expectWalkerMatchesProduction} is what closes it: handed the production lists,
 * this walk must reproduce `connectedComponentRoots` root for root.
 */
export function componentsUnderAxes(
  records: readonly BenchmarkRecord[],
  valueAxes: readonly GroupAxis[],
  linkageAxes: readonly GroupAxis[],
): Map<string, string> {
  const parent = new Map<string, string>();
  for (const record of records) parent.set(record.id, record.id);
  const find = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) {
      const next = parent.get(current) as string;
      parent.set(current, parent.get(next) as string);
      current = parent.get(current) as string;
    }
    return current;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    // The smaller root becomes the parent, which is what `DisjointSet` in split.ts does:
    // a different rule gives the same PARTITION under different root names, and the pin
    // below compares root names.
    if (a === b) return;
    if (a < b) parent.set(b, a);
    else parent.set(a, b);
  };
  for (const axis of valueAxes) {
    const firstByValue = new Map<string, string>();
    for (const record of records) {
      const value = groupAxisIdentity(record, axis);
      if (value === undefined) continue;
      const first = firstByValue.get(value);
      if (first === undefined) firstByValue.set(value, record.id);
      else union(first, record.id);
    }
  }
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    for (const axis of linkageAxes) {
      const named = groupAxisIdentity(record, axis);
      if (named !== undefined && named !== record.id && ids.has(named)) {
        union(record.id, named);
      }
    }
  }
  const roots = new Map<string, string>();
  for (const record of records) roots.set(record.id, find(record.id));
  return roots;
}

/** Component sizes ascending, under an explicit axis list. */
export function histogramUnderAxes(
  records: readonly BenchmarkRecord[],
  valueAxes: readonly GroupAxis[],
  linkageAxes: readonly GroupAxis[],
): number[] {
  const sizeByRoot = new Map<string, number>();
  for (const root of componentsUnderAxes(
    records,
    valueAxes,
    linkageAxes,
  ).values()) {
    sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
  }
  return [...sizeByRoot.values()].sort((a, b) => a - b);
}

/** Measured lines per class, the denominator the per-class conditions divide by. */
export function measuredClassLines(
  records: readonly BenchmarkRecord[],
): Record<string, number> {
  const lines: Record<string, number> = {};
  for (const record of records) {
    lines[record.label] = (lines[record.label] ?? 0) + 1;
  }
  return lines;
}
