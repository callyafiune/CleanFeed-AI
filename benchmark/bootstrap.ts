// Clustered percentile bootstrap with the resampling unit chosen PER ESTIMAND.
//
// There is no single "real cluster". The unit of resampling depends on what is
// being estimated, and using one unit for everything is wrong in both
// directions, so this module models the unit as a first-class value — a
// RESAMPLING DESIGN — instead of the single `clusterBy` key it used to take. A
// composite key concatenating "author and source" is not an answer either: that
// is a flattened cluster, and it resamples the pair as one indivisible level
// instead of resampling sources and then authors within the drawn source.
//
// Two methods, and the choice is declared, never implied:
//
//   * HIERARCHICAL — nested levels, outer first. Each replicate draws the outer
//     level with replacement and then, FOR EACH DRAWN OCCURRENCE, draws the next
//     level inside that occurrence, independently. "Each occurrence" is the whole
//     point: a source drawn twice gets two independent author resamples. Reusing
//     one inner draw and multiplying it by the outer multiplicity understates the
//     variance.
//   * MULTIWAY (pigeonhole) — crossed factors that do not nest, such as the
//     human parent of a mixed row and the edit operation applied to it.
//     Independent multinomial weights are drawn per factor and MULTIPLIED per
//     cell. Nesting what is crossed understates the variance too.
//
// The three R6 states are two different answers, not one:
//
//   * `unknown` on a required unit FAILS. It never falls back to resampling
//     rows: the frozen contract sets `resampling.fallbackToIndependentRows` to
//     false, and the old failure mode was the worst possible one because it
//     produced intervals that LOOKED valid.
//   * `notApplicable` DEMOTES to the next unit the source declares for that
//     level, and the demotion is recorded in the published declaration. An
//     anonymous encyclopedic row has no author and is legitimately grouped by
//     the page it came from; that is not a defect and it is not silent either.
//
// The estimator never copies record-lines. `resolveResampling` maps each item to
// a leaf-cluster index once; a replicate is a WEIGHT VECTOR over those clusters,
// and the statistic is a function of that vector alone. That is what makes
// 100.000 replicates feasible, and it is also what makes the estimator correct:
// a statistic that cannot be written over cluster weights is not a statistic of
// the resampled design.
//
// This module deliberately does NOT reuse `clusterAssignments` /
// `connectedComponentRoots` (benchmark/cluster-exposure-ledger.ts,
// benchmark/split.ts). Those give the SPLIT/EXPOSURE cluster — the connected
// component of the union of every applicable axis — which governs co-location in
// the split and future test eligibility. It is a different question from "what is
// the unit of resampling for this estimand", and no connectivity is re-implemented
// here: a resampling level groups by ONE axis identity at a time, so there is no
// union to compute.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure apart from the caller-supplied seed: no Date, no wall-clock, no I/O.

import { percentileInterval } from "./intervals.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type {
  PublishedBoundRule,
  ResamplingUnitKind,
} from "./preregistration-v4.ts";

/**
 * One axis of one item, in the three states R6 allows and no fourth. It mirrors
 * `GroupAxisState` deliberately without importing the schema: this module stays
 * generic over the item type so it can be exercised on fixtures that are not
 * benchmark records.
 */
export type ResamplingIdentity =
  | { readonly state: "known"; readonly id: string }
  | { readonly state: "notApplicable" }
  | { readonly state: "unknown" };

/** One dependence axis, named as it is published, plus how to read it. */
export interface ResamplingLevel<T> {
  readonly axis: string;
  readonly identity: (item: T) => ResamplingIdentity;
  /**
   * The factor of the frozen table this axis STANDS IN FOR, when the table names
   * a factor no axis of the schema records. It travels into the published
   * declaration on purpose: a crossed design whose second factor is a substitute
   * is not the design the table froze, and a reader who cannot see the
   * substitution reads the row as implemented.
   */
  readonly proxyFor?: string;
  readonly proxyReason?: string;
}

/**
 * The unit declared for one level, plus the units the source declares AFTER it.
 * `fallbacks` is consulted only for `notApplicable`; an `unknown` state stops the
 * walk and fails, because the two states mean different things.
 */
export interface ResamplingLevelChain<T> {
  readonly declared: ResamplingLevel<T>;
  readonly fallbacks: readonly ResamplingLevel<T>[];
}

export interface HierarchicalDesign<T> {
  readonly method: "hierarchical";
  readonly estimand: string;
  /** Outer level first; each level nests inside the one before it. */
  readonly levels: readonly ResamplingLevelChain<T>[];
}

export interface MultiwayDesign<T> {
  readonly method: "multiway";
  readonly estimand: string;
  /** Crossed factors. The order is presentation only and is never nesting. */
  readonly factors: readonly ResamplingLevelChain<T>[];
}

export type ResamplingDesign<T> = HierarchicalDesign<T> | MultiwayDesign<T>;

/** A level whose declared unit was `notApplicable`, and what took its place. */
export interface ResamplingDemotion {
  readonly position: number;
  readonly from: string;
  readonly to: string;
  readonly items: number;
}

export interface ResamplingLevelReport {
  readonly position: number;
  readonly axis: string;
  /** Distinct units this level actually had over the population resolved. */
  readonly levels: number;
  /** The frozen table's factor this axis substitutes for, when it substitutes. */
  readonly proxyFor?: string;
  readonly proxyReason?: string;
  /**
   * One unit per record-line. Resampling this level IS resampling rows, so it is
   * published rather than left for a reader to infer from the counts. It is NOT
   * treated as a failure: after near-duplicate pruning an axis is legitimately
   * all singletons, and R6 forbids a "no axis may be all singletons" criterion.
   */
  readonly degenerate: boolean;
}

/** The resampling unit of one published statistic, named and measured. */
export interface ResamplingUnitDeclaration {
  readonly estimand: string;
  readonly method: ResamplingUnitKind;
  /** The DECLARED head axis of each level, outer to inner (or factor order). */
  readonly axes: readonly string[];
  readonly items: number;
  /** Leaf clusters the resolution produced. */
  readonly units: number;
  readonly levels: readonly ResamplingLevelReport[];
  readonly demotions: readonly ResamplingDemotion[];
  /** True when ANY level had one unit per record-line. */
  readonly degenerate: boolean;
}

/**
 * One estimand's resampling unit as C4 declares it to the release gate. The gate
 * (benchmark/gates.ts) refuses to decide an interval for an estimand this plan
 * does not cover, and never substitutes independent rows for a missing entry.
 *
 * `unitAxes` names the observable dependence axes the unit is built from;
 * `replicates` is the declared replicate count, which must reach the
 * pre-registered pilot floor.
 */
export interface ResamplingPlanEntry {
  readonly estimand: string;
  readonly unitKind: ResamplingUnitKind;
  readonly unitAxes: readonly string[];
  readonly replicates: number;
  /**
   * Whether a PUBLISHED interval for this estimand was produced by resampling
   * this unit, or whether the entry only declares the frozen table's unit while
   * the published interval comes from an analytic estimator. Optional so a
   * fixture may state the unit alone; producers set it.
   */
  readonly executed?: "percentile-bootstrap" | "declared-only";
  /**
   * Which estimator supplied the limits this run PUBLISHED for this estimand.
   * Absent on an entry that published nothing here — a declaration with no run
   * behind it, or a row measured in another plan. See `PublishedBoundProvenance`
   * for why this is not readable off `executed`.
   */
  readonly publishedBound?: PublishedBoundProvenance | null;
  /** The unit as measured over the population, when it was resolved. */
  readonly measured?: ResamplingUnitDeclaration | null;
  /**
   * WHY `measured` is null, when it is. Two things put it there and a reader has
   * to be able to tell them apart: the resolution failed over this population, or
   * this plan is not the one that measures this estimand (a slice's interval is
   * measured inside that slice's own plan). Silence would read as the first.
   */
  readonly measurementNote?: string | null;
  /**
   * Factors of the frozen table with no axis of their own, and the axis standing
   * in. Empty on every row whose axes are the table's own. It is published beside
   * the declaration because `unitAxes` alone shows a crossed design that looks
   * implemented while one of its factors is a substitute.
   */
  readonly proxies?: readonly ResamplingProxy[];
}

/** Which estimator supplied each published limit of one interval. */
export interface PublishedBoundSource {
  readonly lowerFrom: "analytic" | "resampled";
  readonly upperFrom: "analytic" | "resampled";
}

/**
 * The SIMULTANEOUS (Bonferroni) slot of an envelope's provenance — the limit a
 * release gate decides on.
 *
 * Three states and not two, because they are not the same claim and one of them
 * asserts an estimator that produced nothing. `single-estimator` is true when one
 * of the two produced a simultaneous limit and the other did not; `none` is true
 * when NEITHER did, which is the state of every estimand whenever the run declares
 * no pre-registered gate count — there is no Bonferroni family, so nothing was
 * published at any family alpha. Collapsing `none` onto `single-estimator` names an
 * estimator for a limit that does not exist (R7).
 */
export type PublishedSimultaneousProvenance =
  /** Both estimators produced one and the envelope's rule chose between them. */
  | ({ readonly kind: "both-estimators" } & PublishedBoundSource)
  /** Only one did, and it is named here rather than left to be looked up. */
  | { readonly kind: "single-estimator"; readonly method: string }
  /** Neither did: no simultaneous limit was published for this estimand. */
  | { readonly kind: "none" };

/**
 * Where one estimand's PUBLISHED limits came from — a different question from
 * `ResamplingPlanEntry.executed`, which says only that the design RAN.
 *
 * The two answers diverge routinely. Under the frozen `resampling.publishedBound`
 * rule the published limit is the wider of two estimators', so a zero-count rate
 * publishes the analytic bound while its design ran and its resampled upper bound is
 * 0. Reading provenance off `executed` therefore claims a property the number does
 * not have (R7), which is why it is recorded as its own fact and never derived.
 */
export type PublishedBoundProvenance =
  | {
      /** Two estimators produced a limit and the contract's rule chose between them. */
      readonly kind: "envelope";
      readonly rule: PublishedBoundRule;
      /** The individual 95% pair, which is descriptive. */
      readonly individual: PublishedBoundSource;
      /** The simultaneous limit — the only one a release gate decides on. */
      readonly simultaneous: PublishedSimultaneousProvenance;
    }
  /** The resampled percentile, with no analytic estimator competing for the slot. */
  | { readonly kind: "resampled-only" }
  /** The analytic bound, because the design published no limit for this estimand. */
  | { readonly kind: "analytic-only" }
  /**
   * NO estimator published a limit here — not the design and not Wilson. A rate
   * whose denominator is zero is the reachable case: `proportionEstimate` returns a
   * bare point with no interval at all, and the population it was measured over can
   * be non-empty (every row errored, which is never a score — R5). This case exists
   * because the alternative is `analytic-only`, which would name Wilson as the
   * estimator behind a limit Wilson never produced.
   */
  | { readonly kind: "no-published-bound" }
  /**
   * One entry standing for several intervals — one per label basis, say. Averaging
   * their provenance would invent a fact, so the entry names where each one is.
   */
  | { readonly kind: "per-interval"; readonly where: string };

/** One factor of the frozen table read through a substitute axis. */
export interface ResamplingProxy {
  readonly axis: string;
  readonly standsInFor: string;
  readonly reason: string;
}

export interface ResamplingPlan {
  readonly planId: string;
  readonly source: string;
  readonly entries: readonly ResamplingPlanEntry[];
}

/** A leaf of the hierarchical draw tree; `children === null` marks a cluster. */
export interface DrawNode {
  readonly children: readonly DrawNode[] | null;
  readonly cluster: number;
}

export interface MultiwayCell {
  /** Level index within each factor, in factor order. */
  readonly levelIndex: readonly number[];
  readonly cluster: number;
}

export type DrawStructure =
  | { readonly kind: "hierarchical"; readonly root: DrawNode }
  | {
      readonly kind: "multiway";
      readonly factorLevelCounts: readonly number[];
      readonly cells: readonly MultiwayCell[];
    };

export interface ResamplingResolution {
  readonly declaration: ResamplingUnitDeclaration;
  /** Leaf-cluster index of each item, in the order the items were given. */
  readonly clusterOf: readonly number[];
  readonly clusterCount: number;
  readonly draw: DrawStructure;
}

/**
 * A resampling unit that cannot be used, raised instead of quietly resampling
 * rows. It carries the estimand and the axis because "the unit is unknown" sends
 * an operator to a different place depending on which axis of which estimand it
 * was.
 */
export class ResamplingUnitError extends Error {
  readonly estimand: string;
  readonly axis: string;

  constructor(estimand: string, axis: string, detail: string) {
    super(
      `RESAMPLING_UNIT: estimando "${estimand}", eixo "${axis}": ${detail}`,
    );
    this.name = "ResamplingUnitError";
    this.estimand = estimand;
    this.axis = axis;
  }
}

export type ResampledPercentileMethod =
  "hierarchical-cluster-percentile" | "multiway-cluster-percentile";

// Separators for the composite keys the resolvers build below. They are CONTROL
// characters because an axis name or a group id may contain any printable character,
// so a printable separator could be forged inside an id and collapse two distinct
// keys into one. They are written as ESCAPES and never as literal bytes: a literal
// control byte makes this file "binary" to grep and ripgrep, which then report a
// match without ever showing the line — a whole module invisible to code search.
const KEY_FIELD_SEPARATOR = "\u0000";
const KEY_PAIR_SEPARATOR = "\u0001";

/** Is this the method name of a percentile bootstrap (as opposed to Wilson)? */
export function isResampledPercentileMethod(
  method: string,
): method is ResampledPercentileMethod {
  return (
    method === "hierarchical-cluster-percentile" ||
    method === "multiway-cluster-percentile"
  );
}

// A percentile bound, WITH the resampling effort that produced it. The effort is
// not decoration: a percentile read at alpha sits `alpha * (n - 1)` order
// statistics from the extreme of the replicate distribution, so at a Bonferroni
// alpha the same replicates that give a comfortable 95% bound can leave the
// simultaneous bound resting on two or three of them. A consumer that decides
// something on this bound has to be able to see that (R7), and the gate refuses a
// bound whose effort is below the pre-registered replicate count
// (benchmark/gates.ts).
export interface SimultaneousPercentileBound {
  alpha: number;
  lower: number;
  upper: number;
  // Finite replicates the percentile was read from.
  replicates: number;
  // How many replicates lie beyond the bound: floor(alpha * (replicates - 1)).
  // One means the bound IS the second-most-extreme replicate.
  tailReplicates: number;
}

export interface BootstrapInterval {
  lower95: number;
  upper95: number;
  requestedReplicates: number;
  validReplicates: number;
  discardedReplicates: number;
  seed: number;
  method: ResampledPercentileMethod;
  /** The unit this interval was resampled over, published with the interval. */
  unit: ResamplingUnitDeclaration;
  simultaneous?: SimultaneousPercentileBound;
}

export interface ClusteredBootstrapOptions {
  /**
   * Replicates. The frozen contract pre-registers 10.000 in the pilot and
   * 100.000 in the release, and says never to reduce the count for time, so a
   * value below the pilot floor is refused rather than accepted as a cheaper
   * measurement.
   */
  readonly iterations: number;
  readonly seed: number;
  /**
   * The statistic, as a function of the per-cluster WEIGHT VECTOR. It never
   * receives record-lines: a replicate is a weight vector over the sufficient
   * statistics the caller aggregated per cluster, once, before the first draw.
   */
  readonly statistic: (weights: readonly number[]) => number;
  /**
   * One-sided alpha for a SIMULTANEOUS (Bonferroni-corrected) percentile bound,
   * taken from the same replicates as the 95% interval. Absent means no
   * simultaneous bound is published, and a gate that needs one then fails for
   * missing evidence instead of reading the 95% bound (benchmark/gates.ts).
   */
  readonly simultaneousAlpha?: number;
}

// Below one replicate in the tail the percentile is not an estimate of anything:
// it is the most extreme replicate observed, and reporting it as a bound at that
// alpha would be an extrapolation dressed as a measurement. This is a
// DEFINEDNESS floor, not a power floor — the pre-registered replicate counts of
// the frozen contract are checked by the gate, which is where policy lives.
const MINIMUM_TAIL_REPLICATES = 1;

// A definedness floor on the replicate distribution itself: below this many
// finite replicates the percentile is read from too few order statistics to mean
// anything. Unchanged from the single-axis estimator this module replaced.
const MINIMUM_VALID_REPLICATES = 1_000;

// The pre-registered pilot count. Read from the frozen contract, never written
// down here: 10.000 in the pilot and 100.000 in the release are frozen values.
const MINIMUM_REPLICATES = PREREGISTRATION_V4.bootstrapReplicates.pilot;

interface ResolvedLevel {
  axis: string;
  id: string;
}

/**
 * Maps every item onto its leaf cluster under `design`, and publishes the unit
 * that resulted. Fails on `unknown`; demotes on `notApplicable` and records it.
 */
export function resolveResampling<T>(
  items: readonly T[],
  design: ResamplingDesign<T>,
): ResamplingResolution {
  if (items.length === 0) {
    throw new RangeError(
      `resolveResampling requires at least one record-line (estimand "${design.estimand}")`,
    );
  }
  const chains =
    design.method === "hierarchical" ? design.levels : design.factors;
  if (chains.length === 0) {
    throw new RangeError(
      `resolveResampling requires at least one level (estimand "${design.estimand}")`,
    );
  }
  if (design.method === "multiway" && chains.length < 2) {
    throw new RangeError(
      `a multiway design crosses at least two factors (estimand "${design.estimand}")`,
    );
  }

  // Resolve every level of every item once. `demotions` is keyed by
  // position/from/to so a level that fell back for several rows reports one row
  // with a count, not one row per record-line.
  const resolved: ResolvedLevel[][] = [];
  const demotionCounts = new Map<string, ResamplingDemotion>();
  for (const item of items) {
    const perLevel: ResolvedLevel[] = [];
    for (let position = 0; position < chains.length; position += 1) {
      const chain = chains[position];
      const level = resolveChain(item, chain, design.estimand, position);
      if (level.axis !== chain.declared.axis) {
        const key =
          `${position}${KEY_FIELD_SEPARATOR}${chain.declared.axis}` +
          `${KEY_FIELD_SEPARATOR}${level.axis}`;
        const existing = demotionCounts.get(key);
        demotionCounts.set(key, {
          position,
          from: chain.declared.axis,
          to: level.axis,
          items: (existing?.items ?? 0) + 1,
        });
      }
      perLevel.push(level);
    }
    resolved.push(perLevel);
  }

  const declaredAxes = chains.map((chain) => chain.declared.axis);
  const demotions = [...demotionCounts.values()].sort((a, b) =>
    a.position !== b.position
      ? a.position - b.position
      : a.to < b.to
        ? -1
        : a.to > b.to
          ? 1
          : 0,
  );

  const built =
    design.method === "hierarchical"
      ? buildHierarchical(resolved)
      : buildMultiway(resolved);

  const levelReports: ResamplingLevelReport[] = built.levelCounts.map(
    (levels, position) => {
      const declared = chains[position].declared;
      return {
        position,
        axis: declaredAxes[position],
        levels,
        ...(declared.proxyFor === undefined
          ? {}
          : { proxyFor: declared.proxyFor }),
        ...(declared.proxyReason === undefined
          ? {}
          : { proxyReason: declared.proxyReason }),
        degenerate: levels === items.length,
      };
    },
  );

  return {
    declaration: {
      estimand: design.estimand,
      method: design.method,
      axes: declaredAxes,
      items: items.length,
      units: built.clusterCount,
      levels: levelReports,
      demotions,
      degenerate: levelReports.some((level) => level.degenerate),
    },
    clusterOf: built.clusterOf,
    clusterCount: built.clusterCount,
    draw: built.draw,
  };
}

// Walks one level's declared unit and then the units the source declares after
// it. `unknown` stops the walk; `notApplicable` continues to the next.
function resolveChain<T>(
  item: T,
  chain: ResamplingLevelChain<T>,
  estimand: string,
  position: number,
): ResolvedLevel {
  const candidates = [chain.declared, ...chain.fallbacks];
  for (const candidate of candidates) {
    const identity = candidate.identity(item);
    if (identity.state === "unknown") {
      throw new ResamplingUnitError(
        estimand,
        candidate.axis,
        `o nível ${position} tem estado unknown numa linha, e um eixo unknown não é ` +
          "unidade de reamostragem; o contrato congelado põe " +
          "resampling.fallbackToIndependentRows em false, logo não há queda para linhas " +
          "independentes",
      );
    }
    if (identity.state === "known") {
      return { axis: candidate.axis, id: identity.id };
    }
  }
  throw new ResamplingUnitError(
    estimand,
    chain.declared.axis,
    `o nível ${position} está notApplicable em todas as unidades declaradas ` +
      `(${candidates.map((candidate) => candidate.axis).join(" -> ")}); ` +
      "não sobrou unidade para a qual rebaixar",
  );
}

interface BuiltDesign {
  clusterOf: number[];
  clusterCount: number;
  levelCounts: number[];
  draw: DrawStructure;
}

// The nested tree. Insertion order is preserved at every depth so the structure
// is a deterministic function of the input order, and the seed is the only
// source of randomness.
interface MutableNode {
  children: Map<string, MutableNode> | null;
  cluster: number;
}

function buildHierarchical(resolved: readonly ResolvedLevel[][]): BuiltDesign {
  const depth = resolved[0].length;
  const root: MutableNode = { children: new Map(), cluster: -1 };
  const clusterOf: number[] = [];
  let clusterCount = 0;
  const prefixCounts = new Array<Set<string>>(depth);
  for (let position = 0; position < depth; position += 1) {
    prefixCounts[position] = new Set<string>();
  }

  for (const levels of resolved) {
    let node = root;
    let prefix = "";
    for (let position = 0; position < depth; position += 1) {
      prefix +=
        `${levels[position].axis}${KEY_PAIR_SEPARATOR}` +
        `${levels[position].id}${KEY_FIELD_SEPARATOR}`;
      prefixCounts[position].add(prefix);
      const children = node.children as Map<string, MutableNode>;
      let child = children.get(prefix);
      if (child === undefined) {
        const leaf = position === depth - 1;
        child = {
          children: leaf ? null : new Map(),
          cluster: leaf ? clusterCount : -1,
        };
        if (leaf) clusterCount += 1;
        children.set(prefix, child);
      }
      node = child;
    }
    clusterOf.push(node.cluster);
  }

  return {
    clusterOf,
    clusterCount,
    levelCounts: prefixCounts.map((set) => set.size),
    draw: { kind: "hierarchical", root: freezeNode(root) },
  };
}

function freezeNode(node: MutableNode): DrawNode {
  if (node.children === null) {
    return { children: null, cluster: node.cluster };
  }
  return {
    children: [...node.children.values()].map(freezeNode),
    cluster: node.cluster,
  };
}

function buildMultiway(resolved: readonly ResolvedLevel[][]): BuiltDesign {
  const factors = resolved[0].length;
  const levelIndexByFactor: Map<string, number>[] = [];
  for (let factor = 0; factor < factors; factor += 1) {
    levelIndexByFactor.push(new Map<string, number>());
  }
  const cellCluster = new Map<string, number>();
  const cells: MultiwayCell[] = [];
  const clusterOf: number[] = [];

  for (const levels of resolved) {
    const levelIndex: number[] = [];
    for (let factor = 0; factor < factors; factor += 1) {
      const key = `${levels[factor].axis}${KEY_PAIR_SEPARATOR}${levels[factor].id}`;
      const table = levelIndexByFactor[factor];
      let index = table.get(key);
      if (index === undefined) {
        index = table.size;
        table.set(key, index);
      }
      levelIndex.push(index);
    }
    const cellKey = levelIndex.join(",");
    let cluster = cellCluster.get(cellKey);
    if (cluster === undefined) {
      cluster = cells.length;
      cellCluster.set(cellKey, cluster);
      cells.push({ levelIndex, cluster });
    }
    clusterOf.push(cluster);
  }

  return {
    clusterOf,
    clusterCount: cells.length,
    levelCounts: levelIndexByFactor.map((table) => table.size),
    draw: {
      kind: "multiway",
      factorLevelCounts: levelIndexByFactor.map((table) => table.size),
      cells,
    },
  };
}

/**
 * The percentile bootstrap over a resolved design. Each replicate produces a
 * weight vector over leaf clusters — never a copy of the record-lines — and the
 * statistic is evaluated on that vector.
 */
export function clusteredPercentileBootstrap(
  resolution: ResamplingResolution,
  options: ClusteredBootstrapOptions,
): BootstrapInterval {
  const [interval] = clusteredPercentileBootstrapAll(resolution, {
    ...options,
    statistics: [options.statistic],
  });
  if (interval === null) {
    throw new RangeError(
      `clusteredPercentileBootstrap produced fewer than ${MINIMUM_VALID_REPLICATES} ` +
        "finite replicates; never fall back to a per-record bootstrap",
    );
  }
  return interval;
}

/**
 * Several statistics over ONE resample stream.
 *
 * Statistics of the same population under the same estimand share the unit and
 * the seed, so they were already drawing the identical weight vectors; drawing
 * them once and evaluating every statistic on each replicate is the same
 * computation with the draw paid once instead of once per statistic. It is not an
 * approximation: each returned interval is bit-identical to the one the
 * single-statistic call produces with the same seed.
 *
 * An entry is `null` when THAT statistic could not muster enough finite
 * replicates to read a percentile from. It is per statistic and not a thrown
 * error for the whole batch, because one undefined statistic (a replicate with a
 * single class) says nothing about the other four.
 */
export function clusteredPercentileBootstrapAll(
  resolution: ResamplingResolution,
  options: Omit<ClusteredBootstrapOptions, "statistic"> & {
    readonly statistics: readonly ((weights: readonly number[]) => number)[];
  },
): (BootstrapInterval | null)[] {
  const { iterations, seed, statistics } = options;
  if (statistics.length === 0) {
    throw new RangeError(
      "clusteredPercentileBootstrapAll needs at least one statistic",
    );
  }
  if (!Number.isInteger(iterations) || iterations < MINIMUM_REPLICATES) {
    throw new RangeError(
      `clusteredPercentileBootstrap needs at least ${MINIMUM_REPLICATES} replicates ` +
        `(the pre-registered pilot count), got ${iterations}; the frozen contract says ` +
        "never to reduce the replicate count for run time",
    );
  }
  if (resolution.clusterCount === 0) {
    throw new RangeError(
      "clusteredPercentileBootstrap requires at least one cluster",
    );
  }

  const nextUnit = xorshift32(seed);
  // One weight vector, refilled per replicate. Allocating per replicate would be
  // the only per-replicate allocation in the estimator, and at 100.000 replicates
  // it is the difference between reusing a buffer and churning one.
  const weights = new Array<number>(resolution.clusterCount).fill(0);
  // The draw tree, compiled once for the whole stream. See `compileNode`.
  const compiledRoot =
    resolution.draw.kind === "hierarchical"
      ? compileNode(resolution.draw.root)
      : null;
  const factorCounts =
    resolution.draw.kind === "multiway"
      ? resolution.draw.factorLevelCounts.map((levels) =>
          new Array<number>(levels).fill(0),
        )
      : [];
  const simultaneousAlpha = options.simultaneousAlpha;
  if (
    simultaneousAlpha !== undefined &&
    !(simultaneousAlpha > 0 && simultaneousAlpha < 0.5)
  ) {
    throw new RangeError("a one-sided alpha must lie in (0, 0.5)");
  }

  const replicates: number[][] = statistics.map(() => []);
  const discarded = statistics.map(() => 0);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    weights.fill(0);
    if (compiledRoot !== null) {
      drawChildren(compiledRoot, weights, nextUnit);
    } else {
      drawMultiway(
        resolution.draw as Extract<DrawStructure, { kind: "multiway" }>,
        weights,
        factorCounts,
        nextUnit,
      );
    }
    for (let which = 0; which < statistics.length; which += 1) {
      const value = statistics[which](weights);
      if (Number.isFinite(value)) replicates[which].push(value);
      else discarded[which] += 1;
    }
  }

  const method =
    resolution.draw.kind === "hierarchical"
      ? "hierarchical-cluster-percentile"
      : "multiway-cluster-percentile";

  return statistics.map((_, which) => {
    const sample = replicates[which];
    const validReplicates = sample.length;
    if (validReplicates < MINIMUM_VALID_REPLICATES) return null;
    const { lower, upper } = percentileInterval(sample, 0.025, 0.975);
    const interval: BootstrapInterval = {
      lower95: lower,
      upper95: upper,
      requestedReplicates: iterations,
      validReplicates,
      discardedReplicates: discarded[which],
      seed,
      method,
      unit: resolution.declaration,
    };
    if (simultaneousAlpha !== undefined) {
      // The same replicates, read at a wider pair of percentiles. Reusing them is
      // deliberate: a second resample would answer a different question and cost
      // another `iterations` statistic evaluations.
      const tailReplicates = Math.floor(
        simultaneousAlpha * (validReplicates - 1),
      );
      if (tailReplicates >= MINIMUM_TAIL_REPLICATES) {
        const wide = percentileInterval(
          sample,
          simultaneousAlpha,
          1 - simultaneousAlpha,
        );
        interval.simultaneous = {
          alpha: simultaneousAlpha,
          lower: wide.lower,
          upper: wide.upper,
          replicates: validReplicates,
          tailReplicates,
        };
      }
      // No else: with an empty tail no bound is published at all, so a gate that
      // needs one fails for missing evidence instead of reading the maximum
      // replicate as if it were a percentile.
    }
    return interval;
  });
}

/**
 * `DrawNode` with the innermost level flattened, compiled once per stream.
 *
 * The tree is walked once per replicate, so the walk is the hottest loop in the
 * estimator and almost all of it happens at the innermost level: a two-level
 * design over one source and n authors visits n + 1 nodes per replicate, n of
 * them leaves. `leafClusters` holds the cluster ids of a node whose children are
 * ALL leaves, so that level is drawn in an array loop instead of n recursive
 * calls into a body that only increments a weight.
 *
 * It is a representation change and not an estimator change: `nextUnit` is called
 * in exactly the same order and the same number of times, so every interval is
 * bit-identical to the one the un-flattened walk produced with the same seed.
 * `children` is null on a flattened node, which is why the fast path is tested
 * FIRST — a true leaf has both fields null.
 */
interface CompiledNode {
  readonly children: readonly CompiledNode[] | null;
  readonly leafClusters: Int32Array | null;
  readonly cluster: number;
}

function compileNode(node: DrawNode): CompiledNode {
  const children = node.children;
  if (children === null) {
    return { children: null, leafClusters: null, cluster: node.cluster };
  }
  if (children.every((child) => child.children === null)) {
    const leafClusters = new Int32Array(children.length);
    for (let index = 0; index < children.length; index += 1) {
      leafClusters[index] = children[index].cluster;
    }
    return { children: null, leafClusters, cluster: node.cluster };
  }
  return {
    children: children.map(compileNode),
    leafClusters: null,
    cluster: node.cluster,
  };
}

// Draws this node's children with replacement, once per child, and recurses into
// EACH DRAWN OCCURRENCE. A node drawn twice therefore gets two independent
// resamples of its own children — the property that separates a hierarchical
// bootstrap from a flattened one.
function drawChildren(
  node: CompiledNode,
  weights: number[],
  nextUnit: () => number,
): void {
  const leafClusters = node.leafClusters;
  if (leafClusters !== null) {
    const count = leafClusters.length;
    for (let draw = 0; draw < count; draw += 1) {
      const index = Math.min(count - 1, Math.floor(nextUnit() * count));
      weights[leafClusters[index]] += 1;
    }
    return;
  }
  const children = node.children;
  if (children === null) {
    weights[node.cluster] += 1;
    return;
  }
  const count = children.length;
  for (let draw = 0; draw < count; draw += 1) {
    const index = Math.min(count - 1, Math.floor(nextUnit() * count));
    drawChildren(children[index], weights, nextUnit);
  }
}

// The pigeonhole bootstrap: an independent multinomial weight vector per factor,
// multiplied per cell. Nesting the factors instead would tie the inner draws to
// the outer occurrence and understate the variance of a crossed design.
function drawMultiway(
  draw: Extract<DrawStructure, { kind: "multiway" }>,
  weights: number[],
  factorCounts: number[][],
  nextUnit: () => number,
): void {
  for (let factor = 0; factor < factorCounts.length; factor += 1) {
    const counts = factorCounts[factor];
    counts.fill(0);
    const levels = counts.length;
    for (let pick = 0; pick < levels; pick += 1) {
      const index = Math.min(levels - 1, Math.floor(nextUnit() * levels));
      counts[index] += 1;
    }
  }
  for (const cell of draw.cells) {
    let weight = 1;
    for (let factor = 0; factor < factorCounts.length; factor += 1) {
      weight *= factorCounts[factor][cell.levelIndex[factor]];
      if (weight === 0) break;
    }
    if (weight !== 0) weights[cell.cluster] += weight;
  }
}

// Deterministic 32-bit xorshift PRNG. Returns a generator producing values in
// the half-open interval [0, 1). The state is guarded against the zero fixed
// point so any integer seed yields a full-period stream.
function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    let x = state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    state = x;
    return x / 0x1_0000_0000;
  };
}
