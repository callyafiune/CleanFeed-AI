# PII review protocol v1 (`pii-review-v1`)

This protocol removes personal data from every record before it is labelled or
sealed. The protocol description itself contains no personal data, and neither
may any record that passes it. Each record's audit is recorded in
`provenance.piiAudit` with `status: "passed"`, `method: "manual-and-automated"`,
the reviewer token and the review timestamp.

## Two-stage review

Every record passes **both** stages, in order:

1. **Automated search.** A deterministic scan flags candidate personal data:
   person names, `@handles`, email addresses, phone numbers, URLs and any other
   direct or indirect identifier.
2. **Manual review.** A human reviewer inspects the flagged candidates and the
   full text, removes or neutralises every identifier, and confirms the record
   is clean. A record that only passed the automated stage is **not** eligible.

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
