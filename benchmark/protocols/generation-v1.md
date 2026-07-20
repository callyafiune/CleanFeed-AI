# Generation protocol v1 (`generation-v1`)

This protocol governs how AI (`ai`) and the AI portion of mixed (`mixed`)
content is produced and recorded for the benchmark. It contains no personal
data: prompts are bound only by a **prompt-template digest**, never stored in
the clear, and sources, batches and seeds are opaque tokens. It complements —
and does not duplicate — `annotation-v1`, `pii-review-v1` and `corpus-v1`;
generated sources are also acquired under `collection-v1`.

## Complete generation recipe per batch

Controlled generation is organised into **batches**. Every batch
(`GenerationBatchV1`) records the complete, immutable recipe:

- `generationProtocolVersion: "generation-v1"`;
- `provider`, `family`, `model` and `version`;
- `promptTemplateDigest` — the digest of the prompt template (never the prompt
  text);
- `temperature`;
- `generatedAt` — the generation date;
- `batchId` — the batch identifier every generated record links through
  `groups.collectionBatch`;
- `seed` **or** `seedNullReason` — exactly one is present. A reproducible batch
  records its `seed`; a batch whose backend cannot expose a seed records a
  non-empty `seedNullReason` and a `null` seed. A batch with both, or with
  neither, is invalid.

A generated record's `generation` object (provider, family, model, version,
prompt digest, temperature, date and seed) MUST match its linked batch exactly;
any divergence is a `GENERATION_RECIPE_MISMATCH`, and a generated record with no
linked batch or no recipe is a `GENERATION_RECIPE_MISSING`. Human records never
link a generation batch.

## Held-out generator family

At least one **complete generator family** is selected **before ingestion** and
reserved exclusively for the blocked temporal test as an unseen generator
(`heldOutGeneratorFamilies` / `groups.generatorFamily`, marked `unseen`). A
held-out family never appears in `human` records and never crosses into
development or calibration; it exists only in `ai`/`mixed` test records. The
selection is fixed before any scoring and is never revised after the test is
observed.

## Ground truth and review

The `ai`/`mixed` label is derived from this documented generation recipe, never
from a detector's opinion. Every generated record is still confirmed by two
independent reviewers under `annotation-v1`, cleared of PII under
`pii-review-v1`, and composed under `corpus-v1`.
