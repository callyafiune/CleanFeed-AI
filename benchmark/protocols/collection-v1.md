# Collection protocol v1 (`collection-v1`)

This protocol governs how human PT-BR/LinkedIn content enters the benchmark. It
contains no personal data: every source, reviewer and batch is referenced only
by an opaque pseudonymised token, never by a name, `@handle`, URL or raw consent
receipt. It complements — and does not duplicate — the annotation
(`annotation-v1`), PII (`pii-review-v1`) and corpus (`corpus-v1`) protocols;
every accepted source MUST cite those exact protocol versions.

## Two permitted human-source paths — and only two

Human LinkedIn-domain content may be acquired **only** through one of the
following authorized paths. There is no third path.

1. **Explicit contribution (`acquisition: "consent"`).** The contributor
   authorized evaluation use. The source records a **consent-receipt digest**
   (`consentReceiptDigest`) that binds the signed consent without ever storing
   the receipt itself, the contributor's name or any handle. `licenseId` is
   `null`.
2. **License-approved source (`acquisition: "licensed"`).** The source is
   covered by a compatible license whose review is **approved**
   (`evaluationUseApproved: true`). The source records the approved `licenseId`;
   `consentReceiptDigest` is `null`.

Both paths require `evaluationUseApproved: true` and two **distinct** legal
reviewers (`legalReviewerIds`). A source that is not approved, that names a
single reviewer, or that reuses the same reviewer token twice is **not**
authorized and blocks readiness.

## Prohibited acquisition

The following are forbidden and can never produce an accepted source:

- scraping authenticated or logged-in pages;
- copying a profile wholesale;
- retaining names, `@handles`, URLs, email addresses or any other direct or
  indirect identifier from the source.

Indiscriminate collection of profiles is prohibited by `corpus-v1` and is not
made permissible by any consent or license.

## Required protocol versions per accepted source

Every accepted source MUST have been processed under, and cite, the exact
versions:

- annotation under `annotation-v1` — two independent reviewers, third
  adjudicator on divergence;
- PII removal under `pii-review-v1` — automated scan followed by manual review;
- corpus composition and permitted-source rules under `corpus-v1`;
- collection under this `collection-v1`.

The reviewed source manifest (`private/source-manifest.json`) records
`collectionProtocolVersion: "collection-v1"` for every source; any other value
is a `COLLECTION_PROTOCOL_MISMATCH` and blocks readiness. Generated (AI) sources
additionally follow `generation-v1`.
