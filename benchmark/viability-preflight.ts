// The partition-viability preflight: whether the connected components of a stamped
// corpus can realise the five pre-registered partition fractions AT ALL.
//
// Two facts about `createBlockedSplit` generate everything here. It places a connected
// component ENTIRE into one partition, and it compares fractions PER CLASS — one row of
// five targets for every label present, over that label's own total (`classTotals`,
// `scoreCut`). So the unit of the question is a (scope, component) pair, where a scope
// is one label of the corpus, and from the two facts two NECESSARY conditions follow
// for EVERY scope. Both are written, because they bite in opposite directions and the
// second is the sharp one:
//
//   * EVERY COMPONENT FITS SOMEWHERE — a component whose share of a scope exceeds the
//     largest target plus the tolerance has no partition that can receive it whole.
//     This is the loose one: it only ever refuses a scope dominated by one block.
//   * EVERY PARTITION CAN BE FILLED — every target exceeds the tolerance, so every
//     partition must hold a NON-ZERO share of every scope, and any set of components
//     realising the SMALLEST target includes at least one component carrying that
//     scope. What binds is therefore the smallest NON-ZERO contribution to the scope,
//     not the largest, and the refusal is about GRANULARITY: growing the corpus while
//     keeping the number of components fixed changes no fraction.
//
// THE WHOLE CORPUS IS A SCOPE TOO, and it is neither decoration nor a duplicate of the
// per-class scopes:
//
//   * it IS necessary — a partition's aggregate share is the convex combination of its
//     per-class shares (weights = class totals), so it lies inside the same tolerance
//     band, and the band excludes zero;
//   * it is NOT implied by the per-class conditions — a corpus whose every component is
//     coarse in the aggregate while every CLASS has a fine component satisfies all
//     per-class conditions and still cannot fill the smallest partition;
//   * and the per-class conditions are NOT implied by it either. That direction is the
//     expensive one: at the ratified composition (4.000 human + 4.000 ai + 2.000 mixed,
//     `RELEASE_CORPUS_POLICY.counts`) a fine-grained generated half drags every aggregate
//     fraction down, so a human half degenerated into one component per quota cell — the
//     degeneracy this command exists to catch — passes an aggregate-only test and
//     surfaces only as `SplitConstraintError` after the whole assembly has run. With the
//     one cell the frame declares, that degenerate component is 40% of the corpus and
//     100% of the `human` class: coarse enough for `train` in the aggregate, and it still
//     leaves `dev` with no block of the class small enough to take.
//
// On a single-label corpus the corpus scope and that label's scope are the same
// comparison over the same rows, so a refusal there names both. That is a property of
// such a corpus, not of the rule.
//
// Neither condition is sufficient, and {@link VIABILITY_NECESSARY_NOT_SUFFICIENT} is
// the sentence that says so wherever a verdict reaches the operator. Deciding whether a
// complete assignment of components to five partitions exists is subset-sum, and this
// module does not decide it; nor does it see temporal ordering or held-out precedence,
// both of which can still refuse a corpus that passes here.
//
// ONE refusal here is NOT a necessary condition: `empty-corpus`. `createBlockedSplit`
// returns five empty partitions for an empty corpus rather than throwing, so this
// module is deliberately stricter than the splitter on that one input — a corpus with
// no component satisfies every comparison above and would pass by vacuity.
//
// `benchmark/lab/assemble_corpus.py::assert_components_can_fill_five_partitions` is
// the same conditions on the assembler's side, and the agreement between them is held
// by test over a shared corpus catalogue
// (`benchmark/tests/fixtures/viability-agreement.json`). If the two disagree, one of
// them is measuring something else.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import {
  PREREGISTRATION_V4,
  type PreregistrationV4,
} from "./preregistration-v4.ts";
import { type BenchmarkLabel, type BenchmarkRecord } from "./schema.ts";
import {
  CLASS_TOLERANCE,
  PARTITIONS,
  atMostWithinTolerance,
  connectedComponentRoots,
  type Partition,
} from "./split.ts";

/** The coded refusal a corpus outside any necessary condition produces. */
export const PARTITION_VIABILITY_NOT_MET = "PARTITION_VIABILITY_NOT_MET";

/**
 * The declaration that travels with every PASSING verdict.
 *
 * It is part of the output and not of a comment because the failure mode it guards
 * against is a reader taking a green preflight for a splittable corpus.
 */
export const VIABILITY_NECESSARY_NOT_SUFFICIENT =
  "Passar neste preflight é necessário e NÃO suficiente: as condições seguem de o " +
  "splitter pôr o componente conexo inteiro numa única partição e comparar fração " +
  "POR CLASSE, mas a atribuição completa dos componentes às cinco partições é soma " +
  "de subconjuntos e não é decidida aqui. O split ainda pode ser recusado por " +
  "tolerância de fração por classe, por ordenação temporal ou por precedência de " +
  "família reservada.";

/**
 * The policy key that carries each partition's target fraction.
 *
 * Written as a map rather than read by name because the two vocabularies differ —
 * the split spells `cal-A` and the frozen JSON spells `calA` — and `satisfies`
 * makes both halves total: a partition missing from this map and a key that no
 * longer exists on the policy are each a compile error, instead of a target silently
 * read as `undefined` and compared as `NaN`.
 *
 * `benchmark/split-audit.ts` declares the same correspondence as resolved TARGETS
 * (`PARTITION_TARGETS`). This one is the KEY half, because this module is handed a
 * policy as a parameter and has to read the field off it; the two exist for that
 * reason and not by accident.
 */
const FRACTION_KEY_BY_PARTITION = {
  train: "train",
  dev: "dev",
  "cal-A": "calA",
  "cal-B": "calB",
  test: "test",
} as const satisfies Record<
  Partition,
  keyof PreregistrationV4["preRegistration"]["partitionFractions"]
>;

/** The scope of a comparison: the whole corpus, or one class of it. */
export const CORPUS_SCOPE = "corpus";

export type ViabilityScope = typeof CORPUS_SCOPE | BenchmarkLabel;

/**
 * The order scopes are reported in, corpus first.
 *
 * `Record<BenchmarkLabel, number>` is what makes the list total: a label added to the
 * schema and forgotten here is a compile error, rather than a class whose fractions
 * stop being checked. The ORDER is declared for the same reason the component tie-break
 * is — a report ordered by first appearance would change under a reordering of rows.
 */
const LABEL_REPORT_ORDER: Record<BenchmarkLabel, number> = {
  human: 0,
  ai: 1,
  mixed: 2,
};

/** One connected component, named by its root so a refusal can point at it. */
export interface ComponentExtreme {
  /**
   * The component's root id, which is one of its own record ids
   * (`connectedComponentRoots`). Opaque but stable, and it is what makes the refusal
   * name a component rather than only a number.
   */
  readonly root: string;
  /** Lines the component holds IN THIS SCOPE, which is the compared quantity. */
  readonly recordLines: number;
  readonly fraction: number;
}

export interface PartitionTarget {
  readonly partition: Partition;
  readonly fraction: number;
}

/** One scope's component inventory: the denominator and the two extremes. */
export interface ScopeInventory {
  readonly scope: ViabilityScope;
  /** The denominator: the corpus size, or the class total. */
  readonly recordLines: number;
  /** Components holding at least one line of this scope. */
  readonly components: number;
  readonly largestComponent: ComponentExtreme | null;
  /** The smallest NON-ZERO contribution; components without a line here are out. */
  readonly smallestComponent: ComponentExtreme | null;
}

export const VIABILITY_BREACH_KINDS = [
  "empty-corpus",
  "largest-component-exceeds-largest-target",
  "smallest-component-exceeds-smallest-target",
] as const;

/**
 * Which necessary condition a corpus misses. `empty-corpus` is its own kind rather
 * than a missing extreme: a corpus with no component has no fraction to compare, and
 * reporting it as "the largest component fits" would be a pass by vacuity.
 */
export type ViabilityBreachKind = (typeof VIABILITY_BREACH_KINDS)[number];

export interface ViabilityBreach {
  readonly kind: ViabilityBreachKind;
  readonly scope: ViabilityScope;
  /** `null` only for `empty-corpus`, where there is no component to name. */
  readonly component: ComponentExtreme | null;
  readonly target: PartitionTarget | null;
}

export interface ViabilityReport {
  readonly recordLines: number;
  readonly components: number;
  readonly largestTarget: PartitionTarget;
  readonly smallestTarget: PartitionTarget;
  readonly classTolerance: number;
  /** The corpus, then every class present, in {@link LABEL_REPORT_ORDER}. */
  readonly scopes: readonly ScopeInventory[];
  /**
   * Every condition missed, in scope order and largest-condition first inside a scope
   * — the order the assembler's guard raises in, so "which one is reported first" is
   * one answer on both sides.
   */
  readonly breaches: readonly ViabilityBreach[];
  readonly passed: boolean;
}

/**
 * The five targets in {@link PARTITIONS} order, so the extremes below break ties by
 * that order and by nothing incidental.
 */
function partitionTargets(
  policy: PreregistrationV4,
): readonly PartitionTarget[] {
  const fractions = policy.preRegistration.partitionFractions;
  return PARTITIONS.map((partition) => ({
    partition,
    fraction: fractions[FRACTION_KEY_BY_PARTITION[partition]],
  }));
}

/**
 * STRICT comparison, so the first of two equal fractions wins: `cal-B` and `test`
 * both carry 0.20, and a tie broken by iteration accident would let the reported
 * partition name change under an unrelated edit.
 */
function extremeTarget(
  targets: readonly PartitionTarget[],
  pick: "largest" | "smallest",
): PartitionTarget {
  return targets.reduce((chosen, candidate) => {
    const better =
      pick === "largest"
        ? candidate.fraction > chosen.fraction
        : candidate.fraction < chosen.fraction;
    return better ? candidate : chosen;
  });
}

/**
 * The extreme component of one scope, with the lexicographically smallest root
 * breaking a tie in size. Several components of the identical extreme size is the
 * COMMON case — forty singletons — so without a declared tie-break the reported root
 * would be an artefact of record order.
 */
function extremeComponent(
  linesByRoot: ReadonlyMap<string, number>,
  denominator: number,
  pick: "largest" | "smallest",
): ComponentExtreme | null {
  let chosen: { root: string; size: number } | undefined;
  for (const [root, size] of linesByRoot) {
    if (chosen === undefined) {
      chosen = { root, size };
      continue;
    }
    const better =
      pick === "largest"
        ? size > chosen.size || (size === chosen.size && root < chosen.root)
        : size < chosen.size || (size === chosen.size && root < chosen.root);
    if (better) chosen = { root, size };
  }
  if (chosen === undefined) return null;
  return {
    root: chosen.root,
    recordLines: chosen.size,
    fraction: chosen.size / denominator,
  };
}

function inventoryOf(
  scope: ViabilityScope,
  linesByRoot: ReadonlyMap<string, number>,
  denominator: number,
): ScopeInventory {
  return {
    scope,
    recordLines: denominator,
    components: linesByRoot.size,
    largestComponent: extremeComponent(linesByRoot, denominator, "largest"),
    smallestComponent: extremeComponent(linesByRoot, denominator, "smallest"),
  };
}

/**
 * Counts the connected components of a stamped corpus and compares, for the corpus
 * and for every class present, the two extremes against the two extreme partition
 * targets.
 *
 * Connectivity comes from `connectedComponentRoots` — the splitter's own single
 * source of truth — and never from a second traversal: a preflight that enumerated
 * components by its own rule would answer about a corpus the splitter does not see,
 * which is the one way a preflight can be worse than no preflight.
 *
 * The tolerance is `CLASS_TOLERANCE` from benchmark/split.ts and not a policy field,
 * because the pre-registration carries no tolerance: the number the splitter actually
 * compares against lives there, `BlockedSplitPolicy.classTolerance` pins it as a
 * literal type, and the assembler mirrors that same constant. Reading it from
 * anywhere else would compare against a bound the splitter does not use.
 */
export function auditPartitionViability(
  records: readonly BenchmarkRecord[],
  policy: PreregistrationV4 = PREREGISTRATION_V4,
): ViabilityReport {
  const targets = partitionTargets(policy);
  const largestTarget = extremeTarget(targets, "largest");
  const smallestTarget = extremeTarget(targets, "smallest");

  const rootById = connectedComponentRoots(records);
  const corpusLines = new Map<string, number>();
  const linesByLabel = new Map<BenchmarkLabel, Map<string, number>>();
  for (const record of records) {
    const root = rootById.get(record.id);
    if (root === undefined) {
      // Unreachable: `connectedComponentRoots` maps every record it was handed. It
      // throws rather than skipping because a skipped row would shrink the corpus
      // this preflight measures, and a smaller corpus makes every component's
      // fraction LARGER — a refusal the corpus did not earn.
      throw new Error(
        `record ${record.id} has no connected component: the connectivity map must ` +
          "cover every row it was handed",
      );
    }
    corpusLines.set(root, (corpusLines.get(root) ?? 0) + 1);
    let ofLabel = linesByLabel.get(record.label);
    if (ofLabel === undefined) {
      ofLabel = new Map<string, number>();
      linesByLabel.set(record.label, ofLabel);
    }
    ofLabel.set(root, (ofLabel.get(root) ?? 0) + 1);
  }

  const scopes: ScopeInventory[] = [
    inventoryOf(CORPUS_SCOPE, corpusLines, records.length),
  ];
  for (const [label, linesByRoot] of [...linesByLabel].sort(
    ([a], [b]) => LABEL_REPORT_ORDER[a] - LABEL_REPORT_ORDER[b],
  )) {
    const total = [...linesByRoot.values()].reduce((sum, n) => sum + n, 0);
    scopes.push(inventoryOf(label, linesByRoot, total));
  }

  const breaches: ViabilityBreach[] = [];
  for (const inventory of scopes) {
    const { largestComponent, smallestComponent } = inventory;
    if (largestComponent === null || smallestComponent === null) {
      // Only reachable for the corpus scope: a class scope exists because a row
      // carries that label, so it always has a component.
      breaches.push({
        kind: "empty-corpus",
        scope: inventory.scope,
        component: null,
        target: null,
      });
      continue;
    }
    if (
      !atMostWithinTolerance(
        largestComponent.fraction,
        largestTarget.fraction,
        CLASS_TOLERANCE,
      )
    ) {
      breaches.push({
        kind: "largest-component-exceeds-largest-target",
        scope: inventory.scope,
        component: largestComponent,
        target: largestTarget,
      });
    }
    if (
      !atMostWithinTolerance(
        smallestComponent.fraction,
        smallestTarget.fraction,
        CLASS_TOLERANCE,
      )
    ) {
      breaches.push({
        kind: "smallest-component-exceeds-smallest-target",
        scope: inventory.scope,
        component: smallestComponent,
        target: smallestTarget,
      });
    }
  }

  return {
    recordLines: records.length,
    components: corpusLines.size,
    largestTarget,
    smallestTarget,
    classTolerance: CLASS_TOLERANCE,
    scopes,
    breaches,
    passed: breaches.length === 0,
  };
}

/** One scope's inventory, by name; throws rather than returning `undefined`. */
export function viabilityScope(
  report: ViabilityReport,
  scope: ViabilityScope,
): ScopeInventory {
  const found = report.scopes.find((inventory) => inventory.scope === scope);
  if (found === undefined) {
    throw new Error(`the viability report carries no scope "${scope}"`);
  }
  return found;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)} %`;
}

function describeTarget(target: PartitionTarget, tolerance: number): string {
  return `${target.partition}=${percent(target.fraction)} (±${percent(tolerance)})`;
}

function describeScope(scope: ViabilityScope): string {
  return scope === CORPUS_SCOPE ? "do corpo" : `da classe "${scope}"`;
}

function scopeDenominator(
  report: ViabilityReport,
  scope: ViabilityScope,
): number {
  return viabilityScope(report, scope).recordLines;
}

/**
 * The refusal text. Every breach names the SCOPE, the COMPONENT, its size and the
 * target it was compared against: a message carrying only the target leaves the
 * operator unable to tell a corpus two lines too coarse from one dominated by a single
 * block, the scope is what separates "the whole corpus is coarse" from "one class is",
 * and the root is what makes the offending component findable in the corpus at all.
 */
export function describeViabilityBreaches(report: ViabilityReport): string {
  return report.breaches
    .map((breach) => {
      if (breach.kind === "empty-corpus") {
        return "corpo vazio: não há componente a distribuir";
      }
      const { component, target } = breach;
      if (component === null || target === null) {
        // Unreachable: only `empty-corpus` carries nulls, and it returned above.
        throw new Error(
          `viability breach ${breach.kind} must carry a component and a target`,
        );
      }
      const head =
        `componente "${component.root}" tem ${component.recordLines} de ` +
        `${scopeDenominator(report, breach.scope)} linha(s) ` +
        `${describeScope(breach.scope)} (${percent(component.fraction)})`;
      if (breach.kind === "largest-component-exceeds-largest-target") {
        return (
          `o maior ${head} e o maior alvo é ` +
          `${describeTarget(target, report.classTolerance)}: nenhuma partição o ` +
          "recebe inteiro"
        );
      }
      return (
        `o MENOR ${head} e o menor alvo é ` +
        `${describeTarget(target, report.classTolerance)}: nenhum subconjunto não ` +
        "vazio realiza a menor partição, porque todo subconjunto inclui ao menos um " +
        "componente — isto é granularidade, não tamanho de corpo"
      );
    })
    .join("; ");
}

/**
 * The inventory line a PASSING verdict prints: for every scope, the two extremes and
 * the two targets they were compared against, so the operator reads the margin and
 * not only the word "passou".
 */
export function describeViabilityInventory(report: ViabilityReport): string {
  const perScope = report.scopes
    .map((inventory) => {
      const { largestComponent: largest, smallestComponent: smallest } =
        inventory;
      const extremes =
        largest === null || smallest === null
          ? "nenhum componente"
          : `maior "${largest.root}" com ${largest.recordLines} linha(s) ` +
            `(${percent(largest.fraction)}) contra ` +
            `${describeTarget(report.largestTarget, report.classTolerance)}; ` +
            `menor "${smallest.root}" com ${smallest.recordLines} linha(s) ` +
            `(${percent(smallest.fraction)}) contra ` +
            `${describeTarget(report.smallestTarget, report.classTolerance)}`;
      return (
        `${describeScope(inventory.scope)} — ${inventory.recordLines} linha(s) em ` +
        `${inventory.components} componente(s): ${extremes}`
      );
    })
    .join(" | ");
  return (
    `${report.recordLines} linha(s) em ${report.components} componente(s) sob os ` +
    `eixos de conectividade do split (valor compartilhado e linhagem de pai), e a ` +
    `comparação é por classe: ${perScope}`
  );
}
