# Corpus protocol v1 (`corpus-v1`)

This protocol defines the composition, permitted sources and local layout of the
generic PT-BR release corpus `ptbr-generic-v1`. It contains no personal data.
Raw data, predictions and labels never enter Git; only schemas, protocols,
policies, digests and approved descriptors are versioned.

## Sealed composition (4k / 4k / 2k)

The release corpus contains **exactly 10,000 records**:

- **4,000** `human`;
- **4,000** `ai`;
- **2,000** `mixed`.

`sealDataset` enforces this composition against `RELEASE_CORPUS_POLICY` per
class; any other count is a hard failure. A release corpus must also cover every
required human source type (qa-informal, encyclopedic, social-media, university,
institutional) and every required hard-negative family (formulaic, motivational,
highly-polished, repetitive, non-native, corporate-structure), and reserve at
least one whole generator family, declared in `heldOutGeneratorFamilies`, as an
unseen generator for the temporal test.

## Permitted sources — no indiscriminate scraping

- Human pt-BR content may come **only** from authorized contribution
  or from a source under a compatible license. Indiscriminate scraping of
  profiles is prohibited.
- Every license appears in the manifest inventory with
  `evaluationUseApproved: true`. Because raw text stays local, `not-published`
  redistribution is valid; only an `allowed` source could ever have its text
  redistributed, and this phase publishes no source text.
- AI content records its full generation recipe (provider, family, model,
  version, prompt, temperature, seed when available, date).
- Mixed content records its parent, edit method, approximate human/AI
  contribution fractions and annotated spans when possible.

## Ground truth and review

The class label is derived from documented provenance, never from a detector.
Every record is confirmed by two independent reviewers, with a third adjudicator
on divergence, following `annotation-v1`; PII is removed following
`pii-review-v1`.

## Local layout (outside Git)

```text
benchmark/data/ptbr-generic-v1/
  manifest.json
  records.jsonl
  private/review-ledger.jsonl
  private/source-manifest.json
  private/test-labels.jsonl
```

`manifest.json` records the SHA-256 of `records.jsonl`, of
`private/review-ledger.jsonl` and of `private/source-manifest.json`; sealing
recomputes those digests from the local bytes and fails closed on any drift.
