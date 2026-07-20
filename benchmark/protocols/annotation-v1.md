# Annotation protocol v1 (`annotation-v1`)

This protocol governs how every record in the PT-BR/LinkedIn benchmark is
labelled and how its ground truth is established. It contains no personal data:
all reviewers, sources and records are referenced only by pseudonymised,
opaque tokens (`[A-Za-z0-9_-]`), never by names, handles or addresses.

## Ground truth rule

The class label (`human`, `ai` or `mixed`) is derived **only** from documented
provenance — authorized contribution, a compatible license, or a controlled
generation recipe. A label is **never** derived from any detector's opinion,
including CleanFeed's own scores. If provenance cannot establish the class, the
record is rejected before it can enter the manifest.

## Two-reviewer sequence

Each record is reviewed independently by **two distinct reviewers**. Reviewers
are recorded in `annotation.reviewerIds` and must be different tokens; a record
reviewed by a single person, or by the same token twice, is invalid. Each
reviewer confirms, independently:

1. the provenance-derived class label;
2. the license / legal basis and its `evaluationUseApproved` status;
3. the lineage (source, generator family/version, prompt template, derivation
   parent) used by the split grouping;
4. that the PII review (`pii-review-v1`) passed.

## Adjudication on divergence

- When the two reviewers **agree**, `annotation.agreement` is `agree` and no
  adjudicator is recorded.
- When the two reviewers **diverge** on any of the four checks, a **third,
  independent adjudicator** resolves the record before it is sealed.
  `annotation.agreement` becomes `adjudicated` and `annotation.adjudicatorId`
  records the adjudicator's token. The adjudicator must be distinct from both
  reviewers; a self-adjudicated record is invalid.

## Sealing

A record only enters the sealed manifest once its provenance, two independent
reviews and any required adjudication are complete and mutually consistent.
`sealDataset` re-verifies the two-distinct-reviewer and independent-adjudicator
rules for every record; a violation is a hard failure with no last-write-wins.
