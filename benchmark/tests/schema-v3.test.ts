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
  recordEligibility,
  V3_GROUP_AXES,
  validateBenchmarkRecord,
  validateBenchmarkRecordV3,
  type BenchmarkRecordV3,
} from "../schema.ts";
import {
  known,
  notApplicable,
  unknownAxis,
  v3Ai,
  v3EvidenceIndex,
  v3Human,
  v3Mixed,
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

  it("requires a mixed record to name the parent it edited", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Mixed(), "derivationRoot", notApplicable("unknown parent")),
      ),
    ).toThrow(/groups\.derivationRoot of a mixed record must be known/u);
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
          topP: null,
          repetitionPenalty: null,
        },
        temperature: 0.8,
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
    expect(() =>
      validateBenchmarkRecordV3(withGeneration(v3Ai(), { temperature: 0.8 })),
    ).toThrow(
      /generation\.temperature is forbidden when generation\.decoding\.configurable is false/u,
    );
  });

  it("refuses a decoding block that contradicts its lane", () => {
    expect(() =>
      validateBenchmarkRecordV3(
        withGeneration(v3Ai(), {
          decoding: {
            configurable: true,
            strategy: "sampling",
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

  it("requires a mixed record to record the recipe that produced its AI spans", () => {
    const record = v3Mixed();
    delete record.generation;
    expect(() => validateBenchmarkRecordV3(record)).toThrow(
      /generation is required when label is mixed/u,
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
