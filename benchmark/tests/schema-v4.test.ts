// Schema v4 — the three facts `collectionBatch` was conflating.
//
// v3 recorded ONE batch axis and let the row's class decide what it meant: `gb_*`
// on a generated row (a recipe a reviewed manifest publishes), `extraction_*` on a
// human one (an execution of an extractor), and the MATERIAL a human row came from
// recorded nowhere at all. v4 separates the acquisition event, the generation batch
// and the extraction run, and the state table refuses the combinations the single
// axis could not even express.
//
// This file holds the v4 half only. benchmark/tests/schema-v3.test.ts stays as it
// is: the v3 contract is unchanged, and the dead corpus is still read against it.

import { describe, expect, it } from "vitest";

import {
  assertDerivedParentsResolve,
  assertLabelEvidenceResolves,
  assertMaterialBatchesResolve,
  parseBenchmarkDataset,
  reviewOf,
  recordEligibility,
  recordGroupAxes,
  V3_GROUP_AXES,
  V4_GROUP_AXES,
  validateBenchmarkRecord,
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkRecordV4,
} from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3EvidenceIndex,
  v3Human,
  v4Ai,
  v4BatchNamespace,
  v4Human,
  v4Mixed,
  v4MixedEcological,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

describe("the v4 axis tuple", () => {
  it("is v3 minus the conflated axis plus the three that separate it", () => {
    expect(V4_GROUP_AXES).toHaveLength(14);
    expect(V3_GROUP_AXES).toHaveLength(12);
    expect(
      V3_GROUP_AXES.filter(
        (axis) => !(V4_GROUP_AXES as readonly string[]).includes(axis),
      ),
    ).toEqual(["collectionBatch"]);
    expect(
      V4_GROUP_AXES.filter(
        (axis) => !(V3_GROUP_AXES as readonly string[]).includes(axis),
      ),
    ).toEqual(["sourceMaterialBatch", "generationBatch", "extractionRun"]);
  });

  // The v3 tuple is not vestigial: the 10.000 records of the dead corpus are still
  // read to seed `drop_seen`, and mutilating the tuple in place would make an
  // artifact that already exists unparseable.
  it("leaves the v3 contract able to validate a v3 record", () => {
    expect(validateBenchmarkRecordV3(v3Human()).schemaVersion).toBe(3);
    expect(recordGroupAxes(validateBenchmarkRecordV3(v3Human()))).toEqual(
      V3_GROUP_AXES,
    );
    expect(recordGroupAxes(validateBenchmarkRecordV4(v4Human()))).toEqual(
      V4_GROUP_AXES,
    );
  });

  it("accepts the four v4 records of the fixture pool", () => {
    expect(validateBenchmarkRecordV4(v4Human()).schemaVersion).toBe(4);
    expect(validateBenchmarkRecordV4(v4Ai()).label).toBe("ai");
    expect(validateBenchmarkRecordV4(v4Mixed()).label).toBe("mixed");
    expect(validateBenchmarkRecordV4(v4MixedEcological()).label).toBe("mixed");
  });

  it("is reached by the version-dispatching validator", () => {
    expect(validateBenchmarkRecord(v4Human()).schemaVersion).toBe(4);
  });

  it("names 4 among the admitted versions when the version is unknown", () => {
    expect(() =>
      validateBenchmarkRecord({ ...v4Human(), schemaVersion: 5 }),
    ).toThrow(/schemaVersion must be 2, 3 or 4/u);
  });

  // The tuples close each other's `groups` block: a v4 axis on a v3 record and the
  // v3 axis on a v4 record are both unknown fields, so a half-migrated row cannot
  // validate as either version.
  it("refuses a v4 record that still carries collectionBatch", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(v4Human(), "collectionBatch", known("cb_ptso_20260727")),
      ),
    ).toThrow(/unknown field groups\.collectionBatch/u);
  });

  it("refuses a v3 record that already carries a v4 axis", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Human(), "extractionRun", known("er_ptwiki_20260727")),
      ),
    ).toThrow(/unknown field groups\.extractionRun/u);
  });

  it("refuses a dataset that mixes v3 and v4 rows", () => {
    const jsonl = `${JSON.stringify(v3Human())}\n${JSON.stringify(v4Ai())}\n`;
    expect(() => parseBenchmarkDataset(jsonl)).toThrow(
      /dataset mixes schemaVersion 3 and schemaVersion 4/u,
    );
  });
});

// T7 — the three refusals the axis split exists to make possible. Each names the
// reason, because "it throws" would pass on the wrong refusal.
describe("the state table refuses what the single batch axis could not express", () => {
  it("refuses a v4 record with no sourceMaterialBatch at all", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(v4Human(), "sourceMaterialBatch", undefined),
      ),
    ).toThrow(/groups\.sourceMaterialBatch is required/u);
    // Every axis of the tuple, so a key dropped from the fixture cannot pass here by
    // being the one axis nobody asks for.
    for (const axis of V4_GROUP_AXES) {
      expect(() =>
        validateBenchmarkRecordV4(withAxis(v4Ai(), axis, undefined)),
      ).toThrow(new RegExp(`groups\\.${axis} is required`, "u"));
    }
  });

  // A generated row that names an acquisition event claims its text was ACQUIRED.
  // The dependence on material is not lost by the refusal: it travels through
  // humanSeed/derivationRoot to the human row that was acquired.
  it("refuses an ai record whose sourceMaterialBatch is known", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(v4Ai(), "sourceMaterialBatch", known("smb_ptwiki_20220301")),
      ),
    ).toThrow(
      /groups\.sourceMaterialBatch of an ai record must be notApplicable, received known/u,
    );
    // `unknown` is refused too, and for a different reason than a bad value: there is
    // no acquisition to have failed to recover, so `unknown` would price eligibility
    // for a gap that does not exist.
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(v4Ai(), "sourceMaterialBatch", unknownAxis("not recovered")),
      ),
    ).toThrow(
      /groups\.sourceMaterialBatch of an ai record must be notApplicable, received unknown/u,
    );
  });

  it("refuses a human record whose extractionRun is not known", () => {
    for (const value of [
      notApplicable("no extractor ran"),
      unknownAxis("the run was not recorded"),
    ]) {
      expect(() =>
        validateBenchmarkRecordV4(withAxis(v4Human(), "extractionRun", value)),
      ).toThrow(
        /groups\.extractionRun of a human record must be known, received (notApplicable|unknown)/u,
      );
    }
  });

  // The refusal a naming convention used to buy. v3 kept a human row off a declared
  // generation batch by making `extraction_` unable to collide with `gb_`; here the
  // row class decides, so there is no value at all a human record could carry.
  it("refuses a human record that names a generation batch", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(v4Human(), "generationBatch", known("gb_agy_20260724")),
      ),
    ).toThrow(
      /groups\.generationBatch of a human record must be notApplicable, received known/u,
    );
  });

  it("refuses a human record with no material batch", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(
          v4Human(),
          "sourceMaterialBatch",
          unknownAxis("not recovered"),
        ),
      ),
    ).toThrow(
      /groups\.sourceMaterialBatch of a human record must be known, received unknown/u,
    );
  });

  // The one class where an acquisition is real and its RECORD may not be: an
  // observed coauthored document exists, and whether we hold the acquisition
  // evidence is a fact about our records. So `unknown` is admitted, at the cost of
  // eligibility, rather than dodged with `notApplicable`.
  it("admits unknown on an ecological mixed row and prices it in eligibility", () => {
    const record = validateBenchmarkRecordV4(
      withAxis(
        v4MixedEcological(),
        "sourceMaterialBatch",
        unknownAxis(
          "the coauthor's document was not acquired through a batch of ours",
        ),
      ),
    );
    expect(recordEligibility(record).unknownAxes).toEqual([
      "sourceMaterialBatch",
    ]);
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(
          v4MixedEcological(),
          "sourceMaterialBatch",
          notApplicable("no acquisition"),
        ),
      ),
    ).toThrow(
      /groups\.sourceMaterialBatch of an ecological mixed record must be known or unknown, received notApplicable/u,
    );
  });

  // Eligibility is judged against the record's OWN tuple. Judged against v3's it
  // would report `collectionBatch` unknown on every v4 row and call the whole corpus
  // ineligible; judged against v4's, every v3 row would lose three axes the same way.
  it("judges eligibility against the tuple the record's version declares", () => {
    expect(recordEligibility(validateBenchmarkRecordV4(v4Human()))).toEqual({
      eligible: true,
      unknownAxes: [],
    });
    expect(recordEligibility(validateBenchmarkRecordV3(v3Human()))).toEqual({
      eligible: true,
      unknownAxes: [],
    });
  });
});

// The twelve cells the three axes add to `AXIS_STATE_RULE`, one assertion per cell
// per state — thirty-six in all, none of them derived from the table under test.
//
// Naming the axis in ONE refusal is what schema-v3.test.ts measured to be
// insufficient: asserting `generationLane` alone left opening any of the other four
// cells green across the whole benchmark suite. Two of these cells were decided by
// the implementer rather than dictated by the contract (`generationBatch` on an
// ecological row, `extractionRun` on both mixed cohorts), and each declared its
// reversal cost as "one row of the table plus a test" — this is that test.
describe("every state of every batch-axis cell is decided", () => {
  const CLASS_FIXTURE = {
    human: v4Human,
    ai: v4Ai,
    "mixed-mechanistic": v4Mixed,
    "mixed-ecological": v4MixedEcological,
  } as const;

  const CLASS_LABEL = {
    human: "a human record",
    ai: "an ai record",
    "mixed-mechanistic": "a mechanistic mixed record",
    "mixed-ecological": "an ecological mixed record",
  } as const;

  // A value per state that is otherwise VALID, so a refusal can only be the
  // axis-state rule and never a malformed id or a missing reason.
  const VALUE_OF = {
    known: () => known("smb_ptwiki_20220301"),
    notApplicable: () =>
      notApplicable("the fixture states this axis does not apply"),
    unknown: () => unknownAxis("the fixture did not recover this axis"),
  } as const;

  const ADMITTED: Record<
    "sourceMaterialBatch" | "generationBatch" | "extractionRun",
    Record<keyof typeof CLASS_FIXTURE, readonly (keyof typeof VALUE_OF)[]>
  > = {
    // The acquisition event. `known` wherever a row's text was acquired, and on an
    // ecological row `unknown` too, because whether WE hold the acquisition is a fact
    // about our records rather than about the document.
    sourceMaterialBatch: {
      human: ["known"],
      ai: ["notApplicable"],
      "mixed-mechanistic": ["known"],
      "mixed-ecological": ["known", "unknown"],
    },
    // The generation apparatus, and therefore the same shape as the other four
    // apparatus axes: `known` only where a recipe of ours ran. `known` on an
    // ecological row would tie a batch of ours to text no tool of ours produced.
    generationBatch: {
      human: ["notApplicable"],
      ai: ["known"],
      "mixed-mechanistic": ["known"],
      "mixed-ecological": ["notApplicable", "unknown"],
    },
    // Diagnostic, and `known` wherever an extractor of ours read the row out of a
    // source document: the human cohort and the ECOLOGICAL one, which is an observed
    // document we acquired. The two rows written from a generation pool state
    // `notApplicable`, and there the reason is true.
    extractionRun: {
      human: ["known"],
      ai: ["notApplicable"],
      "mixed-mechanistic": ["notApplicable"],
      "mixed-ecological": ["known", "unknown"],
    },
  };

  for (const [axis, byClass] of Object.entries(ADMITTED)) {
    for (const [axisClass, admitted] of Object.entries(byClass) as [
      keyof typeof CLASS_FIXTURE,
      readonly (keyof typeof VALUE_OF)[],
    ][]) {
      for (const state of ["known", "notApplicable", "unknown"] as const) {
        const verb = admitted.includes(state) ? "admits" : "refuses";
        it(`${verb} ${state} for groups.${axis} on ${CLASS_LABEL[axisClass]}`, () => {
          let fixture = CLASS_FIXTURE[axisClass]();
          // The one cell the cross rule below would answer first: on an ecological
          // row a `known` material batch REQUIRES a `known` run, so the cell's own
          // verdict on the other two states is only observable once the batch says
          // `unknown`. Relaxed here rather than skipped, so the cell stays covered.
          if (axis === "extractionRun" && axisClass === "mixed-ecological") {
            fixture = withAxis(
              fixture,
              "sourceMaterialBatch",
              unknownAxis("the coauthor's document was not acquired by us"),
            );
          }
          const candidate = withAxis(fixture, axis, VALUE_OF[state]());
          if (admitted.includes(state)) {
            expect(validateBenchmarkRecordV4(candidate).schemaVersion).toBe(4);
            return;
          }
          expect(() => validateBenchmarkRecordV4(candidate)).toThrow(
            new RegExp(
              `groups\\.${axis} of ${CLASS_LABEL[axisClass]} must be ` +
                `${admitted.join(" or ")}, received ${state}`,
              "u",
            ),
          );
        });
      }
    }
  }
});

// The pair no single cell can decide, because the ecological class admits both halves
// independently. Without it the canonical fixture instantiated the contradiction: a
// batch of ours asserting the document was acquired, beside a run saying "the row was
// written from a generation pool", which is false of an observed document.
describe("an acquisition we hold was read out by a run of ours", () => {
  it("refuses an ecological row holding the batch and not the run", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(
          v4MixedEcological(),
          "extractionRun",
          unknownAxis("the run was not recorded"),
        ),
      ),
    ).toThrow(
      /groups\.sourceMaterialBatch is known \("smb_ptwiki_20220301"\) but groups\.extractionRun is unknown: an observed row whose acquisition event we hold was read out by an execution of ours/u,
    );
  });

  // ORDER, pinned: the cell answers before the pair. `notApplicable` on an ecological
  // run is refused by the class rule, which is the more specific statement — reaching
  // the pair rule with it would tell an operator the batch is the problem when the
  // state itself is not writable there at all.
  it("lets the cell answer first when the state is not writable at all", () => {
    expect(() =>
      validateBenchmarkRecordV4(
        withAxis(
          v4MixedEcological(),
          "extractionRun",
          notApplicable("the row was written from a generation pool"),
        ),
      ),
    ).toThrow(
      /groups\.extractionRun of an ecological mixed record must be known or unknown, received notApplicable/u,
    );
  });

  it("accepts an ecological row that holds neither", () => {
    // The honest pair for a document we observed and did not acquire through a batch
    // of ours: both `unknown`, and the row is ineligible for both.
    const record = validateBenchmarkRecordV4(
      withAxis(
        withAxis(
          v4MixedEcological(),
          "sourceMaterialBatch",
          unknownAxis("the coauthor's document was not acquired by us"),
        ),
        "extractionRun",
        unknownAxis("no run of ours read it out"),
      ),
    );
    expect(recordEligibility(record).unknownAxes).toEqual([
      "sourceMaterialBatch",
      "extractionRun",
    ]);
  });

  // The scoping, pinned: a mechanistic mixed row inherits its PARENT's acquisition,
  // so the execution that read the material out belongs to the parent's row. Applying
  // the rule there would refuse every valid mechanistic mixed record.
  it("does not ask it of a mechanistic mixed row, whose batch is its parent's", () => {
    const record = validateBenchmarkRecordV4(v4Mixed());
    expect(record.groups.sourceMaterialBatch.state).toBe("known");
    expect(record.groups.extractionRun.state).toBe("notApplicable");
  });
});

describe("a material batch resolves against the reviewed inventory", () => {
  const records = (raw: Record<string, unknown>[]): BenchmarkRecordV4[] =>
    raw.map((value) => validateBenchmarkRecordV4(value));

  it("accepts a row whose batch is declared for its own source", () => {
    expect(() =>
      assertMaterialBatchesResolve(
        records([v4Human(), v4Ai(), v4Mixed()]),
        v4BatchNamespace(),
      ),
    ).not.toThrow();
  });

  it("refuses a batch the inventory does not declare", () => {
    expect(() =>
      assertMaterialBatchesResolve(
        records([
          withAxis(v4Human(), "sourceMaterialBatch", known("smb_absent")),
        ]),
        v4BatchNamespace(),
      ),
    ).toThrow(/"smb_absent" resolves to no declared material batch/u);
  });

  // Namespace exclusivity, spent: an id belongs to exactly one of the two lists, so
  // a row naming a generation batch where the axis asks for a material one is a
  // decidable contradiction rather than a lookup miss.
  it("names the generation batch as the reason when the id is one", () => {
    expect(() =>
      assertMaterialBatchesResolve(
        records([
          withAxis(v4Human(), "sourceMaterialBatch", known("gb_agy_20260724")),
        ]),
        v4BatchNamespace(),
      ),
    ).toThrow(/"gb_agy_20260724" is a declared GENERATION batch/u);
  });

  it("refuses a human row whose batch is declared for another source", () => {
    const namespace = v4BatchNamespace();
    namespace.material.set("smb_other", "src_carolina");
    expect(() =>
      assertMaterialBatchesResolve(
        records([
          withAxis(v4Human(), "sourceMaterialBatch", known("smb_other")),
        ]),
        namespace,
      ),
    ).toThrow(
      /declared for sourceId "src_carolina".*names "src_wikipedia_pt"/u,
    );
  });

  // A mixed row's material is the PARENT's, while its own provenance is a controlled
  // generation, so the two names legitimately differ. Comparing them would refuse
  // every valid mechanistic mixed record.
  it("does not compare sources on a mixed row", () => {
    expect(() =>
      assertMaterialBatchesResolve(records([v4Mixed()]), v4BatchNamespace()),
    ).not.toThrow();
  });

  // What takes the source comparison's place on a derived row, and the reason the
  // exemption above is not a hole: the row is asked to agree with the acquisition its
  // OWN lineage resolves to. Without this a mechanistic mixed row could name any
  // declared batch of any other cell and pass both this guard and
  // `assertDerivedParentsResolve`, which only checks that the parent exists.
  it("refuses a derived row whose batch disagrees with its parent's", () => {
    const namespace = v4BatchNamespace();
    namespace.material.set("smb_carolina_judicial", "src_carolina");
    expect(() =>
      assertMaterialBatchesResolve(
        records([
          v4Human(),
          withAxis(
            v4Mixed(),
            "sourceMaterialBatch",
            known("smb_carolina_judicial"),
          ),
        ]),
        namespace,
      ),
    ).toThrow(
      /"smb_carolina_judicial" disagrees with the batch "smb_ptwiki_20220301" of the parent groups\.humanSeed names \("h_ptso_0001"\)/u,
    );
  });

  // The parent's ABSENCE is a different question, and it belongs to
  // `assertDerivedParentsResolve`. Answering it here too would report one gap as two
  // defects with two messages, and it would refuse a legitimate single-partition file.
  it("stays silent about a parent that is not in this array", () => {
    expect(() =>
      assertMaterialBatchesResolve(
        records([
          withAxis(
            v4Mixed(),
            "sourceMaterialBatch",
            known("smb_ptwiki_20220301"),
          ),
        ]),
        v4BatchNamespace(),
      ),
    ).not.toThrow();
  });

  // `derivationRoot` may name a GENERATED parent — a paraphrase of a generation is a
  // legitimate chain — and a generated row states `notApplicable` for its acquisition.
  // There is nothing to agree with at that link, so the comparison says nothing rather
  // than reading `notApplicable` as a disagreement.
  it("compares only against a parent that names an acquisition", () => {
    const child = withAxis(v4Mixed(), "derivationRoot", known("a_ptso_0001"));
    expect(() =>
      assertMaterialBatchesResolve(
        records([v4Human(), { ...v4Ai(), id: "a_ptso_0001" }, child]),
        v4BatchNamespace(),
      ),
    ).not.toThrow();
  });

  // Nothing to resolve is not a failure: an `ai` row states `notApplicable`, and a v3
  // row has no such axis at all.
  it("passes rows that name no batch", () => {
    expect(() =>
      assertMaterialBatchesResolve(records([v4Ai()]), {
        material: new Map(),
        generation: new Set(),
      }),
    ).not.toThrow();
    expect(() =>
      assertMaterialBatchesResolve([validateBenchmarkRecordV3(v3Human())], {
        material: new Map(),
        generation: new Set(),
      }),
    ).not.toThrow();
  });
});

// Every dataset-level guard asks "is this v2", never "is this v3". A guard that
// compares against ONE version number excludes the other in silence, and each of
// these three fails in a direction that reads as a fact about the record rather
// than as the version mismatch it is.
describe("the dataset-level guards reach a v4 record", () => {
  it("reads a v4 review receipt instead of downgrading it", () => {
    const record = validateBenchmarkRecordV4(v4Human());
    // The v2 downgrade says "nobody looked", which would be a false statement about
    // a record that carries a real `review` block.
    expect(reviewOf(record)).toEqual(record.review);
    expect(reviewOf(record).state).toBe("automated/unreviewed");
  });

  it("resolves the label evidence of a v4 human row", () => {
    const record = validateBenchmarkRecordV4(v4Human());
    expect(() =>
      assertLabelEvidenceResolves([record], v3EvidenceIndex()),
    ).not.toThrow();
    // Skipping v4 would make the reference unchecked rather than checked-and-valid.
    expect(() => assertLabelEvidenceResolves([record], new Map())).toThrow(
      /is absent from the private source manifest/u,
    );
  });

  it("resolves the parent of a v4 derived row", () => {
    const parent = validateBenchmarkRecordV4(v4Human());
    const child = validateBenchmarkRecordV4(v4Mixed());
    expect(() => assertDerivedParentsResolve([parent, child])).not.toThrow();
    expect(() => assertDerivedParentsResolve([child])).toThrow(
      /resolves to no record in the dataset/u,
    );
  });
});
