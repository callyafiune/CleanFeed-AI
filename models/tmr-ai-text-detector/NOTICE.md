# NOTICE — tmr-ai-text-detector model bundle

CleanFeed AI redistributes a third-party model bundle. This notice records its
provenance and the obligations that travel with it. Redistribution of the
bundle (in the extension package or elsewhere) MUST include this notice and the
accompanying `LICENSE` file.

## Upstream source

- **Repository:** `onnx-community/tmr-ai-text-detector-ONNX`
- **Home:** https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX
- **Pinned revision (immutable):** `b9aa251e5bcda7e429fcc936767d921435945b60`
- **Runtime model file used:** `onnx/model_int8.onnx` (INT8-quantized RoBERTa
  binary AI-text classifier)
- **Declared license:** MIT (see `LICENSE`)

## Redistribution obligation

The MIT license requires that the copyright notice and permission notice in
`LICENSE` be included in all copies or substantial portions of the software.
Every distributed CleanFeed AI package that contains any artifact from this
bundle MUST ship both `LICENSE` and this `NOTICE.md` alongside the model files.

## Distributed artifacts

The exact bytes and SHA-256 of every upstream artifact are pinned in
`source-lock.json`. The seven upstream assets are: `config.json`, `merges.txt`,
`onnx/model_int8.onnx`, `special_tokens_map.json`, `tokenizer.json`,
`tokenizer_config.json` and `vocab.json`.

## License review

Distribution is gated on human license review. The current review state lives in
`license-review.json`. Until its `status` is `approved`, the bundle MUST NOT be
promoted to a release that presents model results. The exact upstream copyright
holder line in `LICENSE` must be confirmed against the pinned revision during
that review.
