// C5 — real review and PII receipts.
//
// The sealed corpus carries ONE `annotation` block repeated 10.000 times
// (`{agreement: "agree", protocolVersion: "annotation-v1", reviewerIds:
// ["reviewer_a","reviewer_b"]}`) and three `piiAudit` blocks that differ only in a
// synthetic timestamp, all `status: "passed"`, `method: "manual-and-automated"`.
// Ten thousand records assert an agreement between two reviewers and a PII audit
// that never happened, and both gates pass over it.
//
// This file pins the mechanism that makes the assertion unwritable. The named
// completion criterion is the first test: a record with no human review cannot
// carry `agreement: "agree"`.

import { describe, expect, it } from "vitest";

import {
  AUTOMATED_UNREVIEWED,
  HUMAN_REVIEWED,
  REVIEW_RECEIPT_PROTOCOL_FROM,
  reviewClaimSupport,
  reviewOf,
  validateBenchmarkRecordV3,
  type BenchmarkRecord,
  type BenchmarkRecordV3,
} from "../schema.ts";
import {
  adjudicated,
  automatedUnreviewed,
  humanReviewed,
  labelDispute,
  opinion,
  piiPatternScan,
  v3Ai,
  v3Human,
  withReview,
} from "./helpers/v3-record-fixture.ts";

/** The review block of a record the validator accepted, whatever its arm. */
function reviewedHuman(review: unknown): BenchmarkRecordV3 {
  return validateBenchmarkRecordV3(withReview(v3Human(), review));
}

describe("a record with no human review cannot claim agreement", () => {
  // THE completion criterion of C5. `agreement` is a conclusion two reviewers
  // reached; the automated filter reached nothing, so the state that says "only
  // the filter ran" must not be able to carry it.
  //
  // The refusal is explicit and not merely the closed-object one, because the
  // generic "unknown field review.agreement" names a symptom: it reads as a typo
  // in a field name, when the mistake is a state claiming a conclusion it cannot
  // have. Mutation run on the implementation (`agreement` added to the unreviewed
  // key set): this test fails and no other does.
  it("refuses agreement on an automated/unreviewed review", () => {
    expect(() =>
      reviewedHuman(automatedUnreviewed({ agreement: "agree" })),
    ).toThrow(
      /review is automated\/unreviewed and cannot carry agreement: an automated filter reaches no conclusion/u,
    );
  });

  it("refuses the same claim spelled as reviewerIds or decisions", () => {
    for (const key of ["reviewerIds", "decisions", "adjudication", "pii"]) {
      expect(
        () => reviewedHuman(automatedUnreviewed({ [key]: [] })),
        key,
      ).toThrow(
        new RegExp(
          `review is automated/unreviewed and cannot carry ${key}`,
          "u",
        ),
      );
    }
  });

  // The dual, and the reason the state is a NAMED value rather than an absent
  // field: a consumer must not be able to read "not reviewed" as "reviewed and
  // clean". A record with no `review` key at all is refused, not defaulted.
  it("refuses a record that states no review at all", () => {
    const raw = v3Human();
    delete raw.review;
    expect(() => validateBenchmarkRecordV3(raw)).toThrow(
      /review is required: a record states either a human receipt or automated\/unreviewed/u,
    );
  });

  it("keeps the automated filter from presenting itself as an audit", () => {
    // v3 has no `provenance.piiAudit` at all: the block whose type could only ever
    // say `status: "passed"` / `method: "manual-and-automated"` is gone, so the
    // filter has no field left to sign an audit with.
    const raw = v3Human();
    (raw.provenance as Record<string, unknown>).piiAudit = {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_pii",
      reviewedAt: 1_000_000,
    };
    expect(() => validateBenchmarkRecordV3(raw)).toThrow(
      /unknown field provenance\.piiAudit/u,
    );
  });
});

describe("automated/unreviewed is a first-class state", () => {
  it("accepts a record whose only governance is the automated filter", () => {
    const record = reviewedHuman(automatedUnreviewed());
    expect(record.review.state).toBe(AUTOMATED_UNREVIEWED);
  });

  it("names the filters that ran and why no human audit did", () => {
    const record = reviewedHuman(automatedUnreviewed());
    const review = record.review;
    expect(review.state).toBe(AUTOMATED_UNREVIEWED);
    if (review.state !== AUTOMATED_UNREVIEWED) throw new Error("unreachable");
    expect(review.automatedFilters[0]?.filter).toBe("pii-pattern-scan");
    expect(review.automatedFilters[0]?.implementation).toBe(
      "benchmark/lab/common.py:pii_hits",
    );
    expect(review.humanAuditAbsentReason).toMatch(/no human reviewer/u);
  });

  it("does not sustain a governance claim", () => {
    expect(reviewClaimSupport(reviewedHuman(automatedUnreviewed()))).toEqual({
      sustains: false,
      reason: "automated-filter-only",
    });
  });

  it("refuses a filter run that says it excluded the record it is on", () => {
    expect(() =>
      reviewedHuman(
        automatedUnreviewed({
          automatedFilters: [{ ...piiPatternScan(), outcome: "excluded" }],
        }),
      ),
    ).toThrow(
      /automatedFilters\[0\] says the filter excluded this record, and an excluded record is not in the corpus/u,
    );
  });

  it("refuses an unnamed filter", () => {
    expect(() =>
      reviewedHuman(
        automatedUnreviewed({
          automatedFilters: [{ ...piiPatternScan(), filter: "vibes" }],
        }),
      ),
    ).toThrow(/automatedFilters\[0\]\.filter must be one of/u);
  });
});

describe("a receipt is coherent with the claim it makes", () => {
  it("accepts a two-reviewer receipt that agrees", () => {
    const record = reviewedHuman(humanReviewed("human"));
    expect(record.review.state).toBe(HUMAN_REVIEWED);
    expect(reviewClaimSupport(record)).toEqual({ sustains: true });
  });

  it("accepts a disagreement that was adjudicated", () => {
    const record = reviewedHuman(adjudicated("human", "mixed"));
    expect(reviewClaimSupport(record)).toEqual({ sustains: true });
  });

  // INCOHERENCE 1 — the number of individual decisions against the reviewers
  // declared. One opinion for two assigned reviewers is the shape the v2 block
  // could not even express: it declared reviewers and no decisions at all.
  it("refuses fewer decisions than declared reviewers", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [opinion("rev_hmac_a1", "human")],
        }),
      ),
    ).toThrow(/review declares 2 reviewers and carries 1 individual decision/u);
  });

  it("refuses a decision by a reviewer who was not declared", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human"),
            opinion("rev_hmac_zz", "human"),
          ],
        }),
      ),
    ).toThrow(
      /review\.decisions\[1\] is by "rev_hmac_zz", who is not one of the declared reviewers/u,
    );
  });

  it("refuses one reviewer voting twice", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human"),
            opinion("rev_hmac_a1", "human"),
          ],
        }),
      ),
    ).toThrow(/review\.decisions\[1\] repeats reviewer "rev_hmac_a1"/u);
  });

  // INCOHERENCE 2 — `agree` without two independent decisions.
  it("refuses agreement declared by a single reviewer", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          reviewerIds: ["rev_hmac_a1"],
          decisions: [opinion("rev_hmac_a1", "human")],
        }),
      ),
    ).toThrow(/review\.reviewerIds must declare at least two reviewers/u);
  });

  it("refuses agreement over decisions that do not agree", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human"),
            opinion("rev_hmac_b2", "mixed"),
          ],
        }),
      ),
    ).toThrow(
      /review\.agreement is "agree" while the individual decisions are human, mixed/u,
    );
  });

  it("refuses a declared disagreement the decisions do not show", () => {
    expect(() => reviewedHuman(adjudicated("human", "human"))).toThrow(
      /review\.agreement is "disagree" while every individual decision is human/u,
    );
  });

  // INCOHERENCE 3 — disagreement with no adjudication recorded.
  it("refuses a disagreement with no adjudication", () => {
    const receipt = adjudicated("human", "mixed");
    delete receipt.adjudication;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication is required when agreement is "disagree": a disagreement with no recorded resolution is not a decision/u,
    );
  });

  it("refuses an adjudication on a receipt that agrees", () => {
    const receipt = humanReviewed("human", {
      adjudication: (adjudicated("human", "mixed") as Record<string, unknown>)
        .adjudication,
    });
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication is forbidden when agreement is "agree"/u,
    );
  });

  it("refuses an adjudicator who is one of the two reviewers", () => {
    const receipt = adjudicated("human", "mixed");
    (receipt.adjudication as Record<string, unknown>).adjudicatorId =
      "rev_hmac_b2";
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication\.adjudicatorId "rev_hmac_b2" is also a reviewer/u,
    );
  });

  it("refuses an adjudication with no rationale", () => {
    const receipt = adjudicated("human", "mixed");
    (receipt.adjudication as Record<string, unknown>).rationale = "   ";
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication\.rationale must be a non-empty string/u,
    );
  });

  it("refuses an adjudication that precedes the decisions it resolves", () => {
    const receipt = adjudicated("human", "mixed");
    (receipt.adjudication as Record<string, unknown>).decidedAt = Date.parse(
      "2026-07-27T08:00:00.000Z",
    );
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication\.decidedAt precedes the last individual decision it resolves/u,
    );
  });

  // INCOHERENCE 4 — an excluded record cannot be in the corpus, and an individual
  // exclusion needs its code.
  it("refuses a record whose review concluded exclusion", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("exclude", {
          decisions: [
            opinion("rev_hmac_a1", "exclude", {
              exclusionCode: "pii-survived",
            }),
            opinion("rev_hmac_b2", "exclude", {
              exclusionCode: "pii-survived",
            }),
          ],
        }),
      ),
    ).toThrow(
      /the review concluded "exclude", and an excluded record is not in the corpus/u,
    );
  });

  it("refuses an exclusion opinion with no exclusion code", () => {
    expect(() => reviewedHuman(adjudicated("human", "exclude"))).toThrow(
      /review\.decisions\[1\] decides "exclude" and records no exclusionCode/u,
    );
  });

  it("refuses an exclusion code on a decision that excludes nothing", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human", { exclusionCode: "pii-survived" }),
            opinion("rev_hmac_b2", "human"),
          ],
        }),
      ),
    ).toThrow(
      /review\.decisions\[0\] records an exclusionCode while deciding "human"/u,
    );
  });
});

// A divergence between the receipt's conclusion and the record's label is NOT one
// of the six incoherences the brief enumerates, and the rule is here for a reason
// the brief does not decide: the label comes from provenance and the review
// corroborates it, so if the two disagree the record makes two contradictory
// claims. What the first round got wrong was the consequence. It threw, and a
// throw deletes the dissent — the case a reviewer most exists to produce became
// the one case the schema cannot hold, leaving an operator two options (edit the
// label, or discard the review) that R4 forbids. So the divergence is now
// RECORDABLE and non-sustaining: `labelDispute` states it, and
// `reviewClaimSupport` refuses to let it sustain a claim. Nothing in the record
// resolves it — resolution is a change to the label's own evidence (`labelBasis`,
// `generation`, `mixture`) or a withdrawal of the row, which D1 and D5 own.
describe("a divergence between receipt and label is recorded, not erased", () => {
  it("refuses an undeclared divergence", () => {
    // Silence is still refused: what may not happen is preferring one of the two
    // claims without saying that the other exists.
    expect(() => reviewedHuman(humanReviewed("ai"))).toThrow(
      /the review concluded "ai" while the record's label is "human", and the receipt declares no labelDispute/u,
    );
  });

  it("refuses it through the adjudication too", () => {
    expect(() => reviewedHuman(adjudicated("mixed", "human"))).toThrow(
      /the review concluded "mixed" while the record's label is "human", and the receipt declares no labelDispute/u,
    );
  });

  it("records a declared divergence and refuses it the claim", () => {
    // THE case the previous round made unwritable: two blind reviewers conclude
    // `human` on a row whose provenance-derived label is `ai`. The record parses,
    // the dissent is in it, and it sustains nothing.
    const record = validateBenchmarkRecordV3(
      withReview(
        v3Ai(),
        humanReviewed("human", { labelDispute: labelDispute("human", "ai") }),
      ),
    );
    expect(record.label).toBe("ai");
    const review = record.review;
    if (review.state !== HUMAN_REVIEWED) throw new Error("unreachable");
    expect(review.labelDispute).toEqual({
      reviewedClass: "human",
      recordLabel: "ai",
      state: "unresolved",
      rationale: expect.stringContaining("both reviewers read"),
    });
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "label-disputed",
    });
  });

  it("records a divergence the adjudicator reached", () => {
    const record = validateBenchmarkRecordV3(
      withReview(v3Ai(), {
        ...adjudicated("human", "mixed"),
        labelDispute: labelDispute("human", "ai"),
      }),
    );
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "label-disputed",
    });
  });

  // THE ORDER between the two blindness refusals and `label-disputed`, in both
  // directions of "which fact does the operator get told".
  //
  // The order was declared load-bearing in a six-line comment in
  // `reviewClaimSupport` and in the plan, and it was pinned by NOTHING: moving the
  // `labelDispute` check from the end of the function to immediately after the
  // `automated/unreviewed` return left this file at 54/54 and `benchmark/tests/` at
  // 721/721. That is not a cosmetic gap. The reason is what an operator acts on —
  // `reviewer-saw-detector-score` means re-run the review blind, `label-disputed`
  // means go to D1/D5 and re-derive the label's own evidence (`labelBasis`,
  // `labelEvidenceRef`, `generation`) or withdraw the row — so reporting the dispute
  // for a review that was never blind buys the expensive act to settle a dissent
  // nobody has yet earned the right to raise. Same defect class as B1's ND-over-NC
  // precedence: a documented order with no competing assertion behind it.
  it("prices a reviewer who saw the score before the dispute they raised", () => {
    const record = validateBenchmarkRecordV3(
      withReview(
        v3Ai(),
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human", { blindToScore: false }),
            opinion("rev_hmac_b2", "human"),
          ],
          labelDispute: labelDispute("human", "ai"),
        }),
      ),
    );
    // The dispute IS on the record: what this pins is WHICH of the two facts the
    // support names, not that one of them went missing on the way in.
    const review = record.review;
    if (review.state !== HUMAN_REVIEWED) throw new Error("unreachable");
    expect(review.labelDispute?.reviewedClass).toBe("human");
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "reviewer-saw-detector-score",
    });
  });

  it("prices a reviewer who saw the candidate class before the dispute", () => {
    const record = validateBenchmarkRecordV3(
      withReview(
        v3Ai(),
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human"),
            opinion("rev_hmac_b2", "human", { blindToCandidateClass: false }),
          ],
          labelDispute: labelDispute("human", "ai"),
        }),
      ),
    );
    const review = record.review;
    if (review.state !== HUMAN_REVIEWED) throw new Error("unreachable");
    expect(review.labelDispute).toBeDefined();
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "reviewer-saw-candidate-class",
    });
  });

  it("refuses a dispute whose reviewedClass is not what the review concluded", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("mixed", { labelDispute: labelDispute("ai", "human") }),
      ),
    ).toThrow(
      /review\.labelDispute\.reviewedClass is "ai" while the review concluded "mixed"/u,
    );
  });

  it("refuses a dispute whose recordLabel is not the record's label", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("ai", { labelDispute: labelDispute("ai", "mixed") }),
      ),
    ).toThrow(
      /review\.labelDispute\.recordLabel is "mixed" while the record's label is "human"/u,
    );
  });

  it("refuses a dispute that invents a conflict", () => {
    // The two sides naming one class is not a dispute, and this is what makes the
    // block unwritable on a coherent receipt: it must declare a divergence, and
    // both halves are checked against the record.
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          labelDispute: labelDispute("human", "human"),
        }),
      ),
    ).toThrow(
      /review\.labelDispute names "human" on both sides, so nothing is in dispute/u,
    );
  });

  it("refuses a dispute that declares itself resolved", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("ai", {
          labelDispute: labelDispute("ai", "human", { state: "resolved" }),
        }),
      ),
    ).toThrow(/review\.labelDispute\.state must be one of unresolved/u);
  });

  it("refuses a dispute with no rationale", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("ai", {
          labelDispute: labelDispute("ai", "human", { rationale: "" }),
        }),
      ),
    ).toThrow(/review\.labelDispute\.rationale must be a non-empty string/u);
  });

  it("refuses a dispute on an automated/unreviewed record", () => {
    expect(() =>
      reviewedHuman(
        automatedUnreviewed({ labelDispute: labelDispute("ai", "human") }),
      ),
    ).toThrow(/review is automated\/unreviewed and cannot carry labelDispute/u);
  });

  it("accepts the adjudicated conclusion that agrees with the label", () => {
    // The same two opinions, resolved the other way: the adjudicator's decision is
    // what the record is judged against, not the first vote.
    const record = reviewedHuman(adjudicated("human", "mixed"));
    expect(record.label).toBe("human");
    expect(reviewClaimSupport(record)).toEqual({ sustains: true });
  });

  it("corroborates an ai record's label", () => {
    const record = validateBenchmarkRecordV3(
      withReview(v3Ai(), humanReviewed("ai")),
    );
    expect(record.review.state).toBe(HUMAN_REVIEWED);
  });
});

describe("a PII audit names its method and its date", () => {
  // INCOHERENCE 5 — a passed PII audit with no real method and no real date. The
  // v2 shape asserted `method: "manual-and-automated"` as a LITERAL, so the field
  // could not say anything else; here the automated stage is named code and the
  // human stage is a pseudonymised reviewer with a date.
  it("refuses a PII audit that names no automated stage", () => {
    const receipt = humanReviewed("human");
    delete (receipt.pii as Record<string, unknown>).automatedStage;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.pii\.automatedStage must be an object/u,
    );
  });

  it("refuses a PII audit with no human reviewer", () => {
    const receipt = humanReviewed("human");
    delete (receipt.pii as Record<string, unknown>).reviewerId;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.pii\.reviewerId must be a pseudonymised token/u,
    );
  });

  it("refuses a finding with no treatment behind it", () => {
    const receipt = humanReviewed("human");
    (receipt.pii as Record<string, unknown>).treatment = "identifier-removed";
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.pii\.finding is required when treatment is "identifier-removed"/u,
    );
  });

  it("refuses a treatment that excluded the record it is on", () => {
    const receipt = humanReviewed("human");
    (receipt.pii as Record<string, unknown>).treatment = "record-excluded";
    (receipt.pii as Record<string, unknown>).finding = "e-mail no rodapé";
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.pii\.treatment says the record was excluded, and an excluded record is not in the corpus/u,
    );
  });
});

describe("a receipt date is a real instant", () => {
  // INCOHERENCE 6 — the synthetic/impossible date. The three timestamps the
  // sealed corpus carries are 1.000.000, 2.000.000 and 3.000.000 milliseconds:
  // block times of the temporal split, which land in January 1970. They are the
  // defect itself, so they are the case pinned by name.
  const SYNTHETIC_BLOCK_TIMES = [1_000_000, 2_000_000, 3_000_000];

  it("refuses the three synthetic block times the corpus carries", () => {
    for (const stamp of SYNTHETIC_BLOCK_TIMES) {
      expect(
        () =>
          reviewedHuman(
            humanReviewed("human", {
              decisions: [
                opinion("rev_hmac_a1", "human", { decidedAt: stamp }),
                opinion("rev_hmac_b2", "human"),
              ],
            }),
          ),
        String(stamp),
      ).toThrow(
        /review\.decisions\[0\]\.decidedAt precedes the review protocol it claims to follow/u,
      );
    }
  });

  it("refuses a PII review dated before the protocol existed", () => {
    const receipt = humanReviewed("human");
    (receipt.pii as Record<string, unknown>).reviewedAt = 2_000_000;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.pii\.reviewedAt precedes the review protocol it claims to follow/u,
    );
  });

  it("refuses a receipt dated in the future", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human", {
              decidedAt: Date.parse("3000-01-01T00:00:00.000Z"),
            }),
            opinion("rev_hmac_b2", "human"),
          ],
        }),
      ),
    ).toThrow(/review\.decisions\[0\]\.decidedAt is in the future/u);
  });

  it("refuses a date that is not a whole millisecond", () => {
    expect(() =>
      reviewedHuman(
        humanReviewed("human", {
          decisions: [
            opinion("rev_hmac_a1", "human", {
              decidedAt: Date.parse(REVIEW_RECEIPT_PROTOCOL_FROM) + 0.5,
            }),
            opinion("rev_hmac_b2", "human"),
          ],
        }),
      ),
    ).toThrow(
      /review\.decisions\[0\]\.decidedAt must be a whole millisecond instant/u,
    );
  });

  it("accepts the protocol's own effective instant as the earliest date", () => {
    const floor = Date.parse(REVIEW_RECEIPT_PROTOCOL_FROM);
    const record = reviewedHuman(
      humanReviewed("human", {
        decisions: [
          opinion("rev_hmac_a1", "human", { decidedAt: floor }),
          opinion("rev_hmac_b2", "human", { decidedAt: floor }),
        ],
        pii: {
          ...(humanReviewed("human").pii as Record<string, unknown>),
          reviewedAt: floor,
        },
      }),
    );
    expect(record.review.state).toBe(HUMAN_REVIEWED);
  });
});

describe("blind review is what makes the blindness auditable", () => {
  // D1 requires the reviewer not to see the detector's prediction, and C5's
  // requirement 7 asks the receipt to RECORD it. It is recorded and not enforced
  // at the parser: a non-blind review really happened if it happened, and R4 says
  // record the truth. The price is paid where the claim is made — such a receipt
  // does not sustain a governance claim.
  it("refuses a receipt that does not say whether the reviewer was blind", () => {
    const receipt = humanReviewed("human");
    delete (
      (receipt.decisions as Record<string, unknown>[])[0] as Record<
        string,
        unknown
      >
    ).blindToScore;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.decisions\[0\]\.blindToScore must be a boolean/u,
    );
  });

  it("does not sustain a claim when a reviewer saw the detector score", () => {
    const record = reviewedHuman(
      humanReviewed("human", {
        decisions: [
          opinion("rev_hmac_a1", "human", { blindToScore: false }),
          opinion("rev_hmac_b2", "human"),
        ],
      }),
    );
    expect(record.review.state).toBe(HUMAN_REVIEWED);
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "reviewer-saw-detector-score",
    });
  });

  it("does not sustain a claim when a reviewer saw the candidate class", () => {
    const record = reviewedHuman(
      humanReviewed("human", {
        decisions: [
          opinion("rev_hmac_a1", "human"),
          opinion("rev_hmac_b2", "human", { blindToCandidateClass: false }),
        ],
      }),
    );
    expect(reviewClaimSupport(record)).toEqual({
      sustains: false,
      reason: "reviewer-saw-candidate-class",
    });
  });

  it("does not sustain a claim when the adjudicator saw the score", () => {
    const receipt = adjudicated("human", "mixed");
    (receipt.adjudication as Record<string, unknown>).blindToScore = false;
    expect(reviewClaimSupport(reviewedHuman(receipt))).toEqual({
      sustains: false,
      reason: "reviewer-saw-detector-score",
    });
  });

  // BOTH AXES ON THE ADJUDICATOR, and the adjudicator is the vote that matters
  // most: the conclusion the record is judged against is
  // `adjudication?.decision ?? decisions[0].decision`, so on every disagreement it
  // is the adjudicator's class that becomes the receipt's. The block recorded only
  // `blindToScore`, so an adjudicator shown the pipeline's candidate class before
  // deciding sustained the claim AND the receipt could not even state that it
  // happened (`unknown field review.adjudication.blindToCandidateClass`) — the
  // asymmetry ran in the direction that hides a governance failure, which is the
  // whole subject of C5.
  it("refuses an adjudication that does not say whether it saw the class", () => {
    const receipt = adjudicated("human", "mixed");
    delete (receipt.adjudication as Record<string, unknown>)
      .blindToCandidateClass;
    expect(() => reviewedHuman(receipt)).toThrow(
      /review\.adjudication\.blindToCandidateClass must be a boolean/u,
    );
  });

  it("does not sustain a claim when the adjudicator saw the candidate class", () => {
    const receipt = adjudicated("human", "mixed");
    (receipt.adjudication as Record<string, unknown>).blindToCandidateClass =
      false;
    expect(reviewClaimSupport(reviewedHuman(receipt))).toEqual({
      sustains: false,
      reason: "reviewer-saw-candidate-class",
    });
  });

  it("sustains the claim when the adjudicator was blind on both axes", () => {
    // The other direction, asserted against the fixture's own two flags so that a
    // fixture edit cannot make this test pass for the wrong reason.
    const receipt = adjudicated("human", "mixed");
    const adjudication = receipt.adjudication as Record<string, unknown>;
    expect(adjudication.blindToScore).toBe(true);
    expect(adjudication.blindToCandidateClass).toBe(true);
    expect(reviewClaimSupport(reviewedHuman(receipt))).toEqual({
      sustains: true,
    });
  });
});

describe("reviewOf reads a record of either version", () => {
  // The DOWNGRADE, in one place. A v2 record's `annotation` block is not read as a
  // receipt at all: it carries two reviewer tokens and an aggregate agreement, and
  // no individual decision, no date and no adjudication behind them, so it cannot
  // substantiate the agreement it declares. §7 of the plan puts both blocks in
  // "Descarte"; this is what discarding them means for a corpus already on disk,
  // which stays READABLE and stops being read as reviewed.
  const v2: BenchmarkRecord = {
    schemaVersion: 2,
    id: "human-0001",
    text: "palavra ".repeat(60).trim(),
    normalizedTextSha256: "a".repeat(64),
    label: "human",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "career",
    humanSourceType: "qa-informal",
    wordCount: 60,
    createdAt: 1_735_689_600_000,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "source_001",
      sourceRevision: "rev_001",
      collectedAt: 1_735_689_600_000,
      licenseId: "cc-by-sa-4.0",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: 1_000_000,
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
      nearDuplicate: "near_h_001",
      derivationRoot: "human-0001",
    },
  };

  it("reads a v2 annotation block as automated/unreviewed", () => {
    const review = reviewOf(v2);
    expect(review.state).toBe(AUTOMATED_UNREVIEWED);
    if (review.state !== AUTOMATED_UNREVIEWED) throw new Error("unreachable");
    expect(review.humanAuditAbsentReason).toMatch(
      /no individual decision, no date and no adjudication/u,
    );
    // And it does NOT carry the agreement the v2 block declares: the downgrade
    // drops the claim rather than moving it. Asserted as key absence and not as a
    // substring search, because the REASON string quotes the word "agreement" —
    // which is the point of the reason and would make a substring assertion pass
    // for the wrong cause.
    expect(Object.keys(review).sort()).toEqual([
      "automatedFilters",
      "humanAuditAbsentReason",
      "state",
    ]);
    expect(v2.annotation.agreement).toBe("agree");
  });

  it("reports that a v2 record sustains no governance claim", () => {
    expect(reviewClaimSupport(v2)).toEqual({
      sustains: false,
      reason: "automated-filter-only",
    });
  });

  it("claims no automated filter for a v2 record either", () => {
    // An EMPTY list, deliberately. The v2 assembler recorded which filters ran
    // nowhere, so naming one here would be the same invention with the opposite
    // sign — asserting a screen we cannot show. `automated/unreviewed` states
    // that no human audit happened; the filter list states what DID run, and for
    // a v2 row the honest answer is "nothing is recorded".
    const review = reviewOf(v2);
    if (review.state !== AUTOMATED_UNREVIEWED) throw new Error("unreachable");
    expect(review.automatedFilters).toEqual([]);
  });

  it("reads a v3 record's own block", () => {
    const record = reviewedHuman(humanReviewed("human"));
    expect(reviewOf(record)).toBe(record.review);
    expect(reviewOf(validateBenchmarkRecordV3(v3Ai())).state).toBe(
      AUTOMATED_UNREVIEWED,
    );
  });
});
