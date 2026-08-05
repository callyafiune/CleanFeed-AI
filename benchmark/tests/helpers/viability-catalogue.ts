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
  validateBenchmarkRecordV4,
  type BenchmarkLabel,
  type BenchmarkRecord,
} from "../../schema.ts";
import { connectedComponentRoots } from "../../split.ts";
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

export interface ViabilityCase {
  readonly name: string;
  readonly cells: readonly CatalogueCell[];
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
 * Materializes one case as v4 record-lines.
 *
 * The human lines of a component SHARE an author — `author` is a v4 union axis — and
 * the generated lines of the same component name the component's first human line in
 * `humanSeed`, the PARENT LINKAGE axis, which is how a generated row is dependent on
 * the material it was seeded from. A component with no human line seeds off an absent
 * id, so it unions nothing. Every line carries its own origin document and its own
 * near-duplicate group, and every generated line its own prompt template, generator
 * version and generation batch, so the component size is the declared number of lines
 * and nothing else glues them.
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
          raw = withAxis(raw, "promptTemplate", known(`pt_${tag}_${line}`));
          raw = withAxis(raw, "generatorVersion", known(`gv_${tag}_${line}`));
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
