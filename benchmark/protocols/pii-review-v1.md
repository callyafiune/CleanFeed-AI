# PII review protocol v1 (`pii-review-v1`)

This protocol removes personal data from every record before it is labelled or
sealed. The protocol description itself contains no personal data, and neither
may any record that passes it.

**This document states what the protocol REQUIRES. It is not a claim that the
protocol ran.** Whether it ran is a per-record fact, and it lives in the record's
own `review` block (`benchmark/schema.ts`): either a receipt naming the human who
read it, or the state `automated/unreviewed`. No corpus assembled so far carries a
receipt — see "Automated filter is not an audit" below.

## Two stages, and only the second one is an audit

Every record must pass **both** stages, in order:

1. **Automated screen.** `benchmark/lab/common.py:pii_hits` matches five
   identifier shapes — e-mail, CPF, CNPJ, Brazilian phone and social handle — and
   the candidate is **dropped** on any hit. It never rewrites. It reads no
   context, so it cannot find an identifier it has no pattern for: a full name in
   running prose, a postal address, an unusual handle shape.
2. **Human audit.** A reviewer inspects the flagged candidates and the full text,
   removes or neutralises every identifier, and confirms the record is clean. A
   record that only passed stage 1 is **not** audited, and it sustains no release
   claim.

## Automated filter is not an audit

Stage 1 running is not stage 2 having run, and the two must never be recorded as
one thing. A record whose only governance is stage 1 states
`review.state: "automated/unreviewed"`, names the filters that ran
(`review.automatedFilters`) and states why no audit did
(`review.humanAuditAbsentReason`). That state is legitimate — it is honest — and
it sustains no claim: `sealDataset` refuses a **release** corpus in which any
record lacks a receipt (`DATASET_REVIEW_INVALID`).

A record that WAS audited carries, on `review.pii`:

- the protocol followed and the automated stage that produced the candidates;
- the **pseudonymised** reviewer token of the human who read them, never a name;
- the real instant of the review, in epoch milliseconds — never a partition block
  time, which the schema refuses;
- the **treatment**: no identifier found, identifier removed, or record excluded
  (the last of which cannot describe a record that is in the corpus);
- the **finding**, whenever something was found.

The previous version of this document said each record's audit "is recorded in
`provenance.piiAudit`" with a passed status and a method naming both stages. That
field no longer exists in schema v3, and the reason is C5: its type could say
nothing except passed, so 10.000 records asserted an audit that never happened.
Recording an absence has to be possible or a presence means nothing.

## Prohibited content

A record that passes this protocol must never contain:

- personal names, usernames or `@handles`;
- URLs or links of any kind;
- email addresses, phone numbers or other contact details;
- any other direct or indirect personal identifier.

## Pseudonymised references

Identity and grouping fields (author, source, reviewer, prompt, near-duplicate,
derivation parent, and so on) are stored only as opaque pseudonymised tokens
matching `[A-Za-z0-9_-]`. Raw identifiers, whitespace and PII separators such as
`@` or `.` are rejected by the record schema, so grouping stays
privacy-preserving and no PII can re-enter through metadata.

## Failure handling

If any identifier survives review, the record fails PII review and is excluded
from the corpus. There is no partial pass and no silent redaction after sealing.
An exclusion is recorded against the DROPPED row's review log with its exclusion
code; a record that is in the corpus may not carry an exclusion, and the schema
refuses one that does.
