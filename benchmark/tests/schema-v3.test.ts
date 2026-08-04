// C1 — schema v3 with real provenance.
//
// The v2 corpus filled six of its eight grouping axes with an identifier UNIQUE
// per record ("All UNIQUE per record so the blocked split sees singleton
// components", benchmark/lab/assemble_corpus.py) and never filled the other two,
// so the leakage audit validated identifiers built never to collide and the
// author-clustered bootstrap degenerated into i.i.d. v3 closes the contract: an
// axis carries a STATE, an unknown value makes the record ineligible instead of
// being synthesized, and the human label has to name the evidence it rests on.
//
// This file holds the v3 half; benchmark/tests/schema.test.ts keeps the v2 half
// untouched, because v2 records are what the sealed corpus on disk still is.

import { describe, expect, it } from "vitest";

import {
  assertDeclaredAxesResolved,
  assertDerivedParentsResolve,
  assertLabelEvidenceResolves,
  compareEffortWithinScale,
  parseBenchmarkDataset,
  recipeTemperature,
  recordEligibility,
  V3_GROUP_AXES,
  validateBenchmarkRecord,
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkRecordV3,
} from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3Ai,
  v3ApiAi,
  v3EvidenceIndex,
  v3Human,
  v3Mixed,
  v3MixedEcological,
  v4Human,
  withAxis,
  withGeneration,
} from "./helpers/v3-record-fixture.ts";

describe("v3 grouping axes carry an explicit three-valued state", () => {
  it("accepts the three v3 records of the fixture pool", () => {
    expect(validateBenchmarkRecordV3(v3Human()).schemaVersion).toBe(3);
    expect(validateBenchmarkRecordV3(v3Ai()).label).toBe("ai");
    expect(validateBenchmarkRecordV3(v3Mixed()).label).toBe("mixed");
  });

  it("is reached by the version-dispatching validator too", () => {
    const record = validateBenchmarkRecord(v3Human());
    expect(record.schemaVersion).toBe(3);
  });

  // REFUSAL 1 — a record with a required grouping axis absent.
  it("refuses a record whose grouping axis is absent", () => {
    for (const axis of V3_GROUP_AXES) {
      expect(() =>
        validateBenchmarkRecordV3(withAxis(v3Ai(), axis, undefined)),
      ).toThrow(new RegExp(`groups\\.${axis} is required`, "u"));
    }
  });

  it("refuses a bare string where an axis value belongs", () => {
    expect(() =>
      validateBenchmarkRecordV3(withAxis(v3Ai(), "collectionBatch", "cb_1")),
    ).toThrow(/groups\.collectionBatch must be an object/u);
  });

  it("refuses an axis state outside the closed three", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Ai(), "collectionBatch", {
          state: "synthetic",
          id: "cb_1",
        }),
      ),
    ).toThrow(/groups\.collectionBatch\.state must be one of known/u);
  });

  it("requires a written reason on notApplicable and on unknown", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Ai(), "author", { state: "notApplicable" }),
      ),
    ).toThrow(/groups\.author\.reason must be a non-empty string/u);
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Ai(), "harnessVersion", { state: "unknown" }),
      ),
    ).toThrow(/groups\.harnessVersion\.reason must be a non-empty string/u);
  });

  it("refuses a raw identifier that is not pseudonymised", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Human(), "author", known("maria.silva@example.test")),
      ),
    ).toThrow(/groups\.author\.id must be a pseudonymised token/u);
  });

  // R6: `unknown` does not fail the schema — it makes the record ineligible, and
  // that is a different statement. A record dropped by the validator would be
  // invisible; an ineligible record is counted and excluded on purpose.
  it("keeps an unknown axis valid but marks the record ineligible", () => {
    const record = validateBenchmarkRecordV3(
      withAxis(v3Ai(), "harnessVersion", unknownAxis("binary not recorded")),
    );
    expect(recordEligibility(record)).toEqual({
      eligible: false,
      unknownAxes: ["harnessVersion"],
    });
    expect(recordEligibility(validateBenchmarkRecordV3(v3Ai()))).toEqual({
      eligible: true,
      unknownAxes: [],
    });
  });

  it("refuses a generated record that claims a human author", () => {
    expect(() =>
      validateBenchmarkRecordV3(withAxis(v3Ai(), "author", known("au_x"))),
    ).toThrow(/groups\.author of an ai record must be notApplicable/u);
  });

  it("refuses the two axes the v2 corpus never filled", () => {
    for (const axis of ["generatorVersion", "promptTemplate"] as const) {
      expect(() =>
        validateBenchmarkRecordV3(
          withAxis(v3Ai(), axis, notApplicable("never recorded")),
        ),
      ).toThrow(
        new RegExp(`groups\\.${axis} of an ai record must be known`, "u"),
      );
    }
  });

  it("compares the axes a source declares against the ones a record filled", () => {
    const record = validateBenchmarkRecordV3(v3Human());
    expect(() =>
      assertDeclaredAxesResolved(record, ["author", "source"]),
    ).not.toThrow();
    const collective = validateBenchmarkRecordV3(
      withAxis(v3Human(), "author", notApplicable("collective authorship")),
    );
    expect(() =>
      assertDeclaredAxesResolved(collective, ["author", "source"]),
    ).toThrow(/declares axis "author".*notApplicable/u);
    const missing = validateBenchmarkRecordV3(
      withAxis(v3Human(), "author", unknownAxis("not extracted")),
    );
    expect(() =>
      assertDeclaredAxesResolved(missing, ["author", "source"]),
    ).toThrow(/declares axis "author".*unknown/u);
  });

  it("skips an axis a v3 record's version never had, and refuses a v4 row missing its key", () => {
    // The join is ONE join with one authority, so this function reads the declaration
    // the way `auditDeclaredAxes` (benchmark/split-audit.ts) does. Every human source in
    // the reviewed inventory declares `sourceMaterialBatch`, an axis only v4 has: reading
    // the plain eligibility state would map the absent key to `unknown` and make wiring
    // this function throw on every v3 row of every human source.
    const v3 = validateBenchmarkRecordV3(v3Human());
    expect(Object.hasOwn(v3.groups, "sourceMaterialBatch")).toBe(false);
    expect(() =>
      assertDeclaredAxesResolved(v3, ["source", "sourceMaterialBatch"]),
    ).not.toThrow();

    // Within a version that DOES declare the axis, an absent key still refuses: v4
    // makes all fourteen keys mandatory, so the row answered with nothing at all.
    const v4 = validateBenchmarkRecordV4(v4Human());
    const groups = { ...(v4.groups as Record<string, unknown>) };
    delete groups.sourceMaterialBatch;
    const stripped = { ...v4, groups } as unknown as typeof v4;
    expect(() =>
      assertDeclaredAxesResolved(stripped, ["source", "sourceMaterialBatch"]),
    ).toThrow(/declares axis "sourceMaterialBatch".*unknown/u);
  });
});

describe("v3 labelBasis exists for human records and only for them", () => {
  // REFUSAL 2 — a human record without its basis, and without its reference.
  it("refuses a human record with no labelBasis", () => {
    const record = v3Human();
    delete record.labelBasis;
    expect(() => validateBenchmarkRecordV3(record)).toThrow(
      /labelBasis is required when label is human/u,
    );
  });

  it("refuses a human record with no labelEvidenceRef", () => {
    const record = v3Human();
    delete record.labelEvidenceRef;
    expect(() => validateBenchmarkRecordV3(record)).toThrow(
      /labelEvidenceRef is required whenever labelBasis is present/u,
    );
  });

  it("refuses a labelBasis outside the frozen vocabulary", () => {
    expect(() =>
      validateBenchmarkRecordV3({ ...v3Human(), labelBasis: "vibes" }),
    ).toThrow(/labelBasis must be one of date-cutoff, observed-process/u);
  });

  // REFUSAL 3 — the other direction, twice: `ai` and `mixed` may not carry it.
  it("refuses an ai record that carries labelBasis", () => {
    expect(() =>
      validateBenchmarkRecordV3({ ...v3Ai(), labelBasis: "date-cutoff" }),
    ).toThrow(/labelBasis is forbidden when label is ai/u);
  });

  it("refuses a mixed record that carries labelBasis", () => {
    expect(() =>
      validateBenchmarkRecordV3({ ...v3Mixed(), labelBasis: "date-cutoff" }),
    ).toThrow(/labelBasis is forbidden when label is mixed/u);
  });

  it("refuses an ai record that carries labelEvidenceRef alone", () => {
    expect(() =>
      validateBenchmarkRecordV3({
        ...v3Ai(),
        labelEvidenceRef: v3Human().labelEvidenceRef,
      }),
    ).toThrow(/labelEvidenceRef is forbidden when label is ai/u);
  });

  it("refuses a mixed record that carries labelEvidenceRef alone", () => {
    expect(() =>
      validateBenchmarkRecordV3({
        ...v3Mixed(),
        labelEvidenceRef: v3Human().labelEvidenceRef,
      }),
    ).toThrow(/labelEvidenceRef is forbidden when label is mixed/u);
  });
});

describe("v3 labelEvidenceRef points at a digested private-manifest entry", () => {
  function withRef(patch: Record<string, unknown>): Record<string, unknown> {
    const record = v3Human();
    return {
      ...record,
      labelEvidenceRef: {
        ...(record.labelEvidenceRef as Record<string, unknown>),
        ...patch,
      },
    };
  }

  // REFUSAL 4a — the reference describes a basis other than the record's.
  it("refuses a reference whose basis diverges from the record's", () => {
    expect(() =>
      validateBenchmarkRecordV3({
        ...v3Human(),
        labelEvidenceRef: {
          basis: "observed-process",
          entryId: "ev_ptso_0001",
          entryDigest: "1".repeat(64),
          protocol: "instrumented-writing",
          protocolVersion: "iw-v1",
          sessionLogDigest: "9".repeat(64),
          controls: ["no-llm-tooling"],
          residualRisk: "the operator could have pasted external text",
        },
      }),
    ).toThrow(/labelEvidenceRef\.basis .* diverges from labelBasis/u);
  });

  it("accepts an observed-process reference on a record that declares it", () => {
    const record = validateBenchmarkRecordV3({
      ...v3Human(),
      labelBasis: "observed-process",
      labelEvidenceRef: {
        basis: "observed-process",
        entryId: "ev_session_0001",
        entryDigest: "8".repeat(64),
        protocol: "instrumented-writing",
        protocolVersion: "iw-v1",
        sessionLogDigest: "9".repeat(64),
        controls: ["no-llm-tooling", "keystroke-log"],
        residualRisk: "the writer could have transcribed external text",
      },
    });
    expect(record.labelBasis).toBe("observed-process");
  });

  it("refuses a date-cutoff reference missing any of its four facts", () => {
    for (const key of [
      "dateField",
      "observedValue",
      "cutoff",
      "snapshot",
    ] as const) {
      const record = v3Human();
      const ref = { ...(record.labelEvidenceRef as Record<string, unknown>) };
      delete ref[key];
      expect(() =>
        validateBenchmarkRecordV3({ ...record, labelEvidenceRef: ref }),
      ).toThrow(new RegExp(`labelEvidenceRef\\.${key}`, "u"));
    }
  });

  it("refuses an observed-process reference missing any of its four facts", () => {
    const complete: Record<string, unknown> = {
      basis: "observed-process",
      entryId: "ev_session_0001",
      entryDigest: "8".repeat(64),
      protocol: "instrumented-writing",
      protocolVersion: "iw-v1",
      sessionLogDigest: "9".repeat(64),
      controls: ["no-llm-tooling"],
      residualRisk: "the writer could have transcribed external text",
    };
    for (const key of [
      "protocolVersion",
      "sessionLogDigest",
      "controls",
      "residualRisk",
    ] as const) {
      const ref = { ...complete };
      delete ref[key];
      expect(() =>
        validateBenchmarkRecordV3({
          ...v3Human(),
          labelBasis: "observed-process",
          labelEvidenceRef: ref,
        }),
      ).toThrow(new RegExp(`labelEvidenceRef\\.${key}`, "u"));
    }
  });

  it("refuses a date-cutoff reference carrying observed-process fields", () => {
    expect(() =>
      validateBenchmarkRecordV3(withRef({ sessionLogDigest: "9".repeat(64) })),
    ).toThrow(/unknown field labelEvidenceRef\.sessionLogDigest/u);
  });

  it("refuses a snapshot outside the frozen list", () => {
    expect(() =>
      validateBenchmarkRecordV3(withRef({ snapshot: "some-new-dump" })),
    ).toThrow(/labelEvidenceRef\.snapshot must be one of/u);
  });

  it("refuses an observed value at or after the declared cutoff", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withRef({ observedValue: "2024-03-01T00:00:00.000Z" }),
      ),
    ).toThrow(/labelEvidenceRef\.observedValue .* is not before the cutoff/u);
  });

  // REFUSAL 4b — the reference does not RESOLVE. The private manifest never
  // enters the schema: the caller passes an entryId -> digest index built from
  // it, so only opaque digests cross the boundary.
  it("refuses a reference whose entry is absent from the index", () => {
    const records = [validateBenchmarkRecordV3(v3Human())];
    expect(() => assertLabelEvidenceResolves(records, new Map())).toThrow(
      /labelEvidenceRef entry "ev_ptso_0001" is absent/u,
    );
  });

  it("refuses a reference whose entry digest diverges", () => {
    const records = [validateBenchmarkRecordV3(v3Human())];
    expect(() =>
      assertLabelEvidenceResolves(
        records,
        new Map([["ev_ptso_0001", "7".repeat(64)]]),
      ),
    ).toThrow(/labelEvidenceRef entry "ev_ptso_0001" digest diverges/u);
  });

  it("accepts a reference that resolves", () => {
    const records = [validateBenchmarkRecordV3(v3Human())];
    expect(() =>
      assertLabelEvidenceResolves(records, v3EvidenceIndex()),
    ).not.toThrow();
  });
});

describe("v3 derived records resolve their human parent", () => {
  // REFUSAL 5 — a derived record whose human parent does not resolve. Three
  // distinct failures, because "does not resolve" is three different facts.
  it("refuses a derived record whose humanSeed names no record", () => {
    const records = [validateBenchmarkRecordV3(v3Ai())];
    expect(() => assertDerivedParentsResolve(records)).toThrow(
      /humanSeed "h_ptso_0001" resolves to no record/u,
    );
  });

  it("refuses a derived record whose parent is not human", () => {
    // The generated row answers a bare topic prompt, so it has no human seed of
    // its own; the mixed row then names IT as a seed, which is the refusal.
    const ai = validateBenchmarkRecordV3(
      withAxis(v3Ai(), "humanSeed", notApplicable("generated from a topic")),
    );
    const derived = validateBenchmarkRecordV3(
      withAxis(
        withAxis(v3Mixed(), "humanSeed", known("a_agy_0001")),
        "derivationRoot",
        known("a_agy_0001"),
      ),
    );
    expect(() => assertDerivedParentsResolve([ai, derived])).toThrow(
      /humanSeed "a_agy_0001" resolves to a record whose label is ai/u,
    );
  });

  it("refuses a derived record whose human parent carries no labelBasis", () => {
    // The only way to reach this state is a dataset assembled outside the
    // validator, which is precisely why the dataset-level guard has to repeat
    // the check the record-level one already makes.
    const parent = {
      ...validateBenchmarkRecordV3(v3Human()),
    } as Partial<BenchmarkRecordV3>;
    delete parent.labelBasis;
    delete parent.labelEvidenceRef;
    expect(() =>
      assertDerivedParentsResolve([
        parent as BenchmarkRecordV3,
        validateBenchmarkRecordV3(v3Ai()),
      ]),
    ).toThrow(/resolves to a human record carrying no labelBasis/u);
  });

  it("accepts a derived record whose parent resolves", () => {
    const records = [
      validateBenchmarkRecordV3(v3Human()),
      validateBenchmarkRecordV3(v3Ai()),
      validateBenchmarkRecordV3(v3Mixed()),
    ];
    expect(() => assertDerivedParentsResolve(records)).not.toThrow();
  });

  it("requires a mechanistic mixed record to name the parent it edited", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Mixed(), "derivationRoot", notApplicable("unknown parent")),
      ),
    ).toThrow(
      /groups\.derivationRoot of a mechanistic mixed record must be known/u,
    );
  });

  it("refuses a derivationRoot that names the record itself", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Mixed(), "derivationRoot", known("m_ptso_0001")),
      ),
    ).toThrow(/groups\.derivationRoot must not name the record itself/u);
  });
});

describe("v3 generation records the lane, the harness and the effort", () => {
  it("refuses a lane outside the frozen list", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Ai(), "generationLane", known("vllm")),
      ),
    ).toThrow(/groups\.generationLane\.id must be one of/u);
  });

  it("refuses an ai record on a CLI lane with no harnessVersion", () => {
    // `notApplicable` on a CLI lane is a false statement about the lane, so it is
    // refused outright...
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Ai(), "harnessVersion", notApplicable("not recorded")),
      ),
    ).toThrow(/groups\.harnessVersion must be known on the CLI lane "agy"/u);
    // ...while `unknown` is a true statement that costs the record its
    // eligibility. Refusing that one too would push a producer who did not capture
    // the binary version toward writing `notApplicable` to get the row accepted,
    // which is the substitution the schema exists to prevent.
    const unrecorded = validateBenchmarkRecordV3(
      withAxis(v3Ai(), "harnessVersion", unknownAxis("binary not captured")),
    );
    expect(recordEligibility(unrecorded).eligible).toBe(false);
  });

  it("refuses a harnessVersion on the API lane, which has no harness", () => {
    const api = withGeneration(
      withAxis(v3Ai(), "generationLane", known("gemini-api")),
      {
        provider: "gemini",
        decoding: {
          configurable: true,
          strategy: "sampling",
          temperature: 0.8,
          topP: null,
          repetitionPenalty: null,
        },
        effort: { source: "not-supported", configurable: false },
      },
    );
    expect(() =>
      validateBenchmarkRecordV3(withAxis(api, "harnessVersion", known("x_1"))),
    ).toThrow(/groups\.harnessVersion must be notApplicable on the lane/u);
    // ...and the same record with the axis correctly notApplicable is accepted,
    // so what the previous assertion pins is the lane rule and not the fixture.
    expect(
      validateBenchmarkRecordV3(
        withAxis(
          api,
          "harnessVersion",
          notApplicable("the API lane runs no harness binary"),
        ),
      ).label,
    ).toBe("ai");
  });

  it("refuses a temperature on a lane that cannot accept one", () => {
    // MEASURED: generate_ai.py writes `"temperature": str(TEMPERATURE)` into the
    // meta of EVERY provider, including `agy` and `codex`, which it invokes as
    // CLIs with no sampling flag (`CLI_PROVIDERS = {"agy","codex","gemini_cli"}`).
    // The pools on disk therefore carry a temperature that was never applied.
    //
    // The refusal is now STRUCTURAL and not a cross-field check: `temperature`
    // lives inside the `configurable: true` branch of `decoding`, so there is no
    // key for it anywhere on a CLI row. Both spellings a producer could reach for
    // are refused as unknown fields against a closed object, which is the same
    // guarantee stated once instead of twice.
    expect(() =>
      validateBenchmarkRecordV3(withGeneration(v3Ai(), { temperature: 0.8 })),
    ).toThrow(/unknown field generation\.temperature/u);
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          decoding: { configurable: false, temperature: 0.8 },
        }),
      ),
    ).toThrow(/unknown field generation\.decoding\.temperature/u);
  });

  it("requires a configurable lane to state its temperature", () => {
    // Requirement 8 exists to stop a reader ASSUMING nobody recorded a sampling
    // parameter. `topP` and `repetitionPenalty` were already required-and-nullable
    // for that reason; `temperature` was optional, so an api row could omit it and
    // still validate — leaving exactly the ambiguity the requirement removes, on
    // the one field the pools are known to carry a false value for.
    const api = withGeneration(
      withAxis(
        withAxis(v3Ai(), "generationLane", known("gemini-api")),
        "harnessVersion",
        notApplicable("the API lane runs no harness binary"),
      ),
      {
        provider: "gemini",
        decoding: {
          configurable: true,
          strategy: "sampling",
          topP: null,
          repetitionPenalty: null,
        },
        effort: { source: "not-supported", configurable: false },
      },
    );
    expect(() => validateBenchmarkRecordV3(api)).toThrow(
      /generation\.decoding\.temperature is required \(use null when the provider default applied\)/u,
    );
    // `null` is accepted and MEANS something different from an absent key: the
    // provider's own default applied. That distinction is the point of the field.
    const withDefault = withGeneration(api, {
      decoding: {
        configurable: true,
        strategy: "sampling",
        temperature: null,
        topP: null,
        repetitionPenalty: null,
      },
    });
    const parsed = validateBenchmarkRecordV3(withDefault);
    expect(
      parsed.generation?.decoding.configurable === true
        ? parsed.generation.decoding.temperature
        : "absent",
    ).toBeNull();
  });

  it("refuses a decoding block that contradicts its lane", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          decoding: {
            configurable: true,
            strategy: "sampling",
            temperature: 0.8,
            topP: 0.95,
            repetitionPenalty: null,
          },
        }),
      ),
    ).toThrow(
      /generation\.decoding\.configurable must be false on the lane "agy"/u,
    );
  });

  it("refuses an effort with no scale", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          effort: { source: "model-id", configurable: false, level: "medium" },
        }),
      ),
    ).toThrow(/generation\.effort\.scale must be a non-empty string/u);
  });

  it("refuses effortSource flag combined with effortConfigurable false", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          effort: {
            source: "flag",
            configurable: false,
            scale: "codex-reasoning-effort",
            level: "high",
          },
        }),
      ),
    ).toThrow(
      /generation\.effort claims source "flag" while configurable is false/u,
    );
  });

  it("refuses an effort source the lane does not offer", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          effort: {
            source: "flag",
            configurable: true,
            scale: "agy-model-id-tier",
            level: "high",
          },
        }),
      ),
    ).toThrow(/generation\.effort\.source "flag" is not offered by the lane/u);
  });

  it("refuses an effort level outside the lane's own scale", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          effort: {
            source: "model-id",
            configurable: false,
            scale: "agy-model-id-tier",
            // `xhigh` exists on the codex lane and NOT on agy, which stops at
            // `high`. Accepting it here is what would make `effort` read as a
            // shared ordinal across providers.
            level: "xhigh",
          },
        }),
      ),
    ).toThrow(/generation\.effort\.level "xhigh" is not in the scale/u);
  });

  it("refuses a comparison of two efforts on different scales", () => {
    const agy = validateBenchmarkRecordV3(v3Ai());
    const codex = validateBenchmarkRecordV3(
      withGeneration(withAxis(v3Ai(), "generationLane", known("codex")), {
        provider: "codex",
        effort: {
          source: "flag",
          configurable: true,
          scale: "codex-reasoning-effort",
          level: "high",
        },
      }),
    );
    const agyEffort = agy.generation?.effort;
    const codexEffort = codex.generation?.effort;
    expect(agyEffort).toBeDefined();
    expect(codexEffort).toBeDefined();
    expect(() =>
      compareEffortWithinScale(agyEffort as never, codexEffort as never),
    ).toThrow(/effort is not comparable across scales/u);
    // Within one scale it answers, so what the refusal pins is the cross-scale
    // comparison and not the absence of a comparator.
    expect(
      compareEffortWithinScale(agyEffort as never, agyEffort as never),
    ).toBe(0);
  });

  it("refuses a seed that is neither present nor explicitly waived", () => {
    const record = v3Ai();
    const generation = { ...(record.generation as Record<string, unknown>) };
    delete generation.seedNullReason;
    expect(() => validateBenchmarkRecordV3({ ...record, generation })).toThrow(
      /generation must record exactly one of seed or seedNullReason/u,
    );
    expect(() =>
      validateBenchmarkRecordV3(withGeneration(v3Ai(), { seed: "1234" })),
    ).toThrow(/generation must record exactly one of seed or seedNullReason/u);
  });

  it("requires a MECHANISTIC mixed record to record the recipe that produced its AI spans", () => {
    const record = v3Mixed();
    delete record.generation;
    expect(() => validateBenchmarkRecordV3(record)).toThrow(
      /generation is required when label is mixed/u,
    );
  });
});

// ---------------------------------------------------------------------------
// The two mixed COHORTS are not one class. `mechanistic` edits are ours and their
// recipe is provenance the row must carry; `ecological` coauthorship was observed
// and no recipe of ours exists. Requiring a recipe of every mixed row made the
// only writable form of an observed row one that names our `agy` lane and our
// prompt template — fabricated provenance (R4), and the exact substitution
// pressure this schema exists to remove. The frozen table keeps the cohorts apart
// (`materialAssistance.generationModes`, `cohortsAggregated: false`) and live code
// reads `ecological` in metrics.ts, slices.ts and commands/fit.ts, so v3 has to be
// able to HOLD one.
// ---------------------------------------------------------------------------

describe("the mixed cohort decides what provenance a row must carry", () => {
  it("accepts an ecological mixed record with no recipe and no generation axis", () => {
    const record = validateBenchmarkRecordV3(v3MixedEcological());
    expect(record.label).toBe("mixed");
    expect(record.mixture?.generationMode).toBe("ecological");
    expect(record.generation).toBeUndefined();
    for (const axis of [
      "promptTemplate",
      "generatorFamily",
      "generatorVersion",
      "generationLane",
      "harnessVersion",
    ] as const) {
      expect(record.groups[axis].state).toBe("notApplicable");
    }
    // `notApplicable` costs nothing: the row is a real observation, not a gap.
    expect(recordEligibility(record).eligible).toBe(true);
  });

  it("accepts an ecological mixed record whose coauthor's tool is unknown", () => {
    // The other honest state: the coauthor used SOMETHING and we did not recover
    // which. That is `unknown` and it costs the record its eligibility (R6) —
    // never a synthesized lane, and never `notApplicable`, which would assert no
    // tool applied.
    const record = validateBenchmarkRecordV3(
      withAxis(
        v3MixedEcological(),
        "generationLane",
        unknownAxis("the coauthor's tool was not recorded during observation"),
      ),
    );
    expect(recordEligibility(record).eligible).toBe(false);
  });

  it("refuses EVERY generation axis claimed as known on an ecological row", () => {
    // One assertion per axis, over the same five the accept test iterates. The
    // previous version of this test asserted `generationLane` alone, so opening
    // any of the other four in `AXIS_STATE_RULE` left the whole benchmark suite
    // green — measured on `generatorFamily`. Nothing else catches it: the
    // generator-identity rule below is one-directional (`generation` present =>
    // family must be `known`), so a `known` family with NO recipe behind it is
    // unconstrained, which is an observed coauthored document asserting OUR
    // generator family. That is the fabricated provenance (R4) this cohort exists
    // to make unwritable.
    for (const axis of [
      "promptTemplate",
      "generatorFamily",
      "generatorVersion",
      "generationLane",
      "harnessVersion",
    ] as const) {
      // The id is deliberately a REAL one of ours per axis where the axis
      // validates its own vocabulary, so the refusal cannot be mistaken for a
      // malformed-value refusal: the axis-state rule fires before the
      // canonical-family and known-lane checks, and this pins that order too.
      const id = axis === "generationLane" ? "agy" : "gemini-3_5-flash-medium";
      expect(() =>
        validateBenchmarkRecordV3(
          withAxis(v3MixedEcological(), axis, known(id)),
        ),
      ).toThrow(
        new RegExp(
          `groups\\.${axis} of an ecological mixed record must be notApplicable or unknown, received known`,
          "u",
        ),
      );
    }
  });

  it("refuses an ecological row that names a recipe of ours", () => {
    const record = v3MixedEcological();
    record.generation = (v3Mixed() as { generation: unknown }).generation;
    expect(() => validateBenchmarkRecordV3(record)).toThrow(
      /generation is forbidden when mixture\.generationMode is ecological/u,
    );
  });

  // The two cohort guards were written as `mixture?.generationMode === …` rather
  // than scoped to the mixed cohort, and `mixture` was forbidden only on `human`.
  // So they fired on `ai` rows and misdiagnosed them. Measured on the committed
  // tree before the fix:
  //
  //   * `ai` + `generationMode: "ecological"` was refused with "generation is
  //     forbidden when mixture.generationMode is ecological: the assistance came
  //     out of the coauthor's own tool" — a sentence about a cohort the row does
  //     not belong to, blaming the recipe, while `label: "ai"` REQUIRES one. The
  //     two refusals pointed at each other and neither named the contradiction.
  //   * `ai` + `generationMode: "mechanistic"` was ACCEPTED outright. A fully
  //     generated row silently carried an `aiFraction: 0.5` human-coauthorship
  //     block. That is the sharper half and it was not in the finding.
  //   * `ai` + fractions 0.9/0.9 was refused with "mixed fractions must sum to 1",
  //     the widened check firing on a non-mixed row.
  describe("a mixture block belongs to the mixed label and nowhere else", () => {
    function aiWithMixture(
      generationMode: string,
      fractions = { aiFraction: 0.5, humanFraction: 0.5 },
    ): Record<string, unknown> {
      return {
        ...v3Ai(),
        mixture: {
          ...fractions,
          spans: [{ start: 0, end: 10, origin: "ai" }],
          generationMode,
        },
      };
    }

    for (const mode of ["mechanistic", "ecological"] as const) {
      it(`refuses a ${mode} mixture block on a fully generated row`, () => {
        // The message names the CONTRADICTION — divided origin against a label
        // that claims a single one — and not the recipe. Whether the mode is
        // mechanistic or ecological cannot change the diagnosis, because the row
        // is in neither cohort.
        expect(() => validateBenchmarkRecordV3(aiWithMixture(mode))).toThrow(
          /mixture is forbidden when label is ai/u,
        );
        expect(() =>
          validateBenchmarkRecordV3(aiWithMixture(mode)),
        ).not.toThrow(/generationMode is ecological/u);
      });
    }

    it("refuses the block before judging its fractions", () => {
      // Guard order, pinned: the widened fraction-sum check reads
      // `mixture !== undefined` rather than `label === "mixed"`, so on an `ai`
      // row it used to answer first. "The fractions do not sum to 1" invites a
      // producer to fix the fractions; the row is wrong whatever they are.
      expect(() =>
        validateBenchmarkRecordV3(
          aiWithMixture("mechanistic", {
            aiFraction: 0.9,
            humanFraction: 0.9,
          }),
        ),
      ).toThrow(/mixture is forbidden when label is ai/u);
    });

    it("keeps refusing a mixture block on a human row", () => {
      expect(() =>
        validateBenchmarkRecordV3({
          ...v3Human(),
          mixture: {
            aiFraction: 0.5,
            humanFraction: 0.5,
            spans: [{ start: 0, end: 10, origin: "ai" }],
            generationMode: "mechanistic",
          },
        }),
      ).toThrow(/mixture is forbidden when label is human/u);
    });

    it("still checks the fractions of a row that IS mixed", () => {
      // The sum check keeps its teeth where it is reachable, so generalizing the
      // guard above did not turn it into dead code.
      const record = v3Mixed();
      record.mixture = {
        aiFraction: 0.9,
        humanFraction: 0.9,
        spans: [{ start: 0, end: 10, origin: "ai" }],
        generationMode: "mechanistic",
      };
      expect(() => validateBenchmarkRecordV3(record)).toThrow(
        /mixed fractions must sum to 1/u,
      );
    });
  });

  it("still refuses a mechanistic row whose generation axes are notApplicable", () => {
    // The other direction of the same rule: relaxing `mixed` must not relax the
    // cohort whose recipe IS ours and IS on disk.
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(
          v3Mixed(),
          "promptTemplate",
          notApplicable("no template recorded"),
        ),
      ),
    ).toThrow(
      /groups\.promptTemplate of a mechanistic mixed record must be known, received notApplicable/u,
    );
  });
});

describe("v3 datasets do not mix schema versions", () => {
  it("refuses a JSONL file holding both v2 and v3 records", () => {
    const v2 = {
      schemaVersion: 2,
      id: "human_0001",
      text: Array.from({ length: 100 }, (_, i) => `palavra${i}`).join(" "),
      normalizedTextSha256: "d".repeat(64),
      label: "human",
      language: "pt-BR",
      platform: "generic",
      domain: "corporate",
      topic: "career",
      wordCount: 100,
      createdAt: 1_735_689_600_000,
      provenance: {
        sourceKind: "licensed-corpus",
        sourceId: "src_ptso",
        sourceRevision: "rev_001",
        collectedAt: 1_735_689_600_000,
        licenseId: "cc-by-sa-4.0",
        legalBasis: "license",
        piiAudit: {
          status: "passed",
          method: "manual-and-automated",
          reviewerId: "reviewer_pii",
          reviewedAt: 1_735_689_600_000,
        },
      },
      annotation: {
        protocolVersion: "annotation-v1",
        reviewerIds: ["reviewer_a", "reviewer_b"],
        agreement: "agree",
      },
      transformation: { kind: "none", severity: "none" },
      groups: {
        author: "author_001",
        source: "source_001",
        domainSource: "ds_001",
        collectionBatch: "batch_001",
        nearDuplicate: "near_001",
        derivationRoot: "human_0001",
      },
    };
    const jsonl = `${JSON.stringify(v2)}\n${JSON.stringify(v3Human())}`;
    expect(() => parseBenchmarkDataset(jsonl)).toThrow(
      /dataset mixes schemaVersion 2 and schemaVersion 3/u,
    );
  });
});

// ---------------------------------------------------------------------------
// `recipeTemperature` collapses three states into `null`, and its docstring says
// which three. The consumer test that gives the value its meaning lives in
// benchmark/tests/corpus-source-audit.test.ts (governance recipe identity); this
// pins the accessor's own contract, which is what a future reader will check the
// docstring against.
// ---------------------------------------------------------------------------

describe("recipeTemperature reads the temperature of either schema version", () => {
  it("reads a v2 record's top-level temperature", () => {
    expect(
      recipeTemperature({
        provider: "acme",
        family: "acme-large",
        model: "acme-large-2",
        version: "2026-05",
        promptId: "p",
        promptSha256: "1".repeat(64),
        generatedAt: 1,
        temperature: 0.7,
      }),
    ).toBe(0.7);
  });

  it("reads null from a v2 record that recorded none", () => {
    expect(
      recipeTemperature({
        provider: "acme",
        family: "acme-large",
        model: "acme-large-2",
        version: "2026-05",
        promptId: "p",
        promptSha256: "1".repeat(64),
        generatedAt: 1,
      }),
    ).toBeNull();
  });

  it("reads the temperature inside a v3 configurable decoding branch", () => {
    // The arm that was pinned by nothing. `0` is asserted separately from a
    // truthy value on purpose: an accessor written with `||` instead of a branch
    // would turn a deliberate greedy decode into "no temperature".
    for (const temperature of [0.8, 0]) {
      const record = validateBenchmarkRecordV3(v3ApiAi(temperature));
      expect(recipeTemperature(record.generation!)).toBe(temperature);
    }
  });

  it("reads null from a v3 configurable branch that left the provider default", () => {
    const record = validateBenchmarkRecordV3(v3ApiAi(null));
    expect(recipeTemperature(record.generation!)).toBeNull();
  });

  it("reads null from a v3 CLI lane, whose branch has no such field", () => {
    // The third collapsed state: `agy` takes no sampling flag, so the field does
    // not exist on the branch at all. Indistinguishable from the case above
    // through this accessor by design — telling them apart requires reading
    // `decoding`, and the docstring says so.
    const record = validateBenchmarkRecordV3(v3Ai());
    expect(record.generation?.decoding.configurable).toBe(false);
    expect(recipeTemperature(record.generation!)).toBeNull();
  });
});

// The `gemini-api` row builder used to live here AND in
// benchmark/tests/corpus-source-audit.test.ts, hand-built twice down to a
// byte-identical `notApplicable` reason. It is now `v3ApiAi` in
// ./helpers/v3-record-fixture.ts, beside `v3Ai`/`v3Mixed`, which is what that
// helper's header says it exists for.
