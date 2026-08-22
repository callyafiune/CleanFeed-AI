"""T5 — exports the trained checkpoint to ONNX int8 (run on Colab).

Produces the artifact set the extension bundle needs (Transformers.js layout):
  out/onnx/model_int8.onnx   (dynamic-quantized int8)
  out/config.json, tokenizer.json, tokenizer_config.json, vocab.txt,
  out/special_tokens_map.json
  out/parity_report.json     (fp32-torch vs int8-onnx on real dev samples)

Nothing is written at `out` until every guard has accepted the bundle: the whole thing is
built in `out.staging`, the ceiling, the vocabulary, the graph shape and the parity gate
run there, and only then are the directory and the ZIP promoted. The previous publication
is removed at the start, so a refusal never leaves an approved ZIP beside a rejected
directory — and a `--out` that holds a training checkpoint is refused instead of removed.

Parity gate: the mean |Δ P(ai)| between torch fp32 and onnx int8 must stay small (< 0.02)
and no sample may flip across 0.5 — quantization must not change verdicts. The report
ships with the artifacts for the bundle's provenance. The sample it runs over is drawn
BALANCED across both labels: the gate also reads the score spread, and a single-class
sample cannot tell a trained detector's confidence from a constant one's.

Colab usage (after training):
  !pip -q install optimum onnx onnxruntime
  # upload sealed_policy.py AND benchmark/preregistration-v4.json beside this script:
  # the policy is read and parsed, never retyped, and without it the script refuses
  # before the argparse
  !python export_onnx.py --checkpoint bertimbau/best --eval dev.jsonl --out cleanfeed-ptbr-v1
  # baixe o zip gerado: cleanfeed-ptbr-v1-artifacts.zip (~110 MB)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any, Protocol

from sealed_policy import POLICY_PATH, announce, policy_receipt
from sealed_policy import read_sealed_policy as sealed_policy

# The graph this script emits is BERT-shaped: the fallback export names these three
# inputs and the tokenizer it saves writes `vocab.txt`, which is what the served bundle
# delivers. A RoBERTa-family encoder has no segment ids and carries a SentencePiece model
# instead of a WordPiece vocabulary.
#
# The trap that makes a mismatch worth refusing rather than warning about: a mismatched
# export PASSES the parity gate below. Parity compares this graph against the same torch
# weights, so a graph whose third input the runtime never feeds agrees with itself.
EMITTED_GRAPH_INPUTS = ("input_ids", "attention_mask", "token_type_ids")
EMITTED_CONFIG_MODEL_TYPE = "bert"

# The fields of `config.json` compared against the sealed backbone. The first four do not
# identify a model: every BERT declares `model_type: "bert"`, and a 12x768 encoder with a
# 29 794-entry vocabulary and an `intermediate_size` of 16 satisfies them, exports
# cleanly, agrees with its own weights in the parity gate and lands well under the byte
# ceiling. The four that follow are the rest of the shape the witness bundle declares.
COMPARED_CONFIG_FIELDS = (
    "model_type",
    "vocab_size",
    "hidden_size",
    "num_hidden_layers",
    "intermediate_size",
    "num_attention_heads",
    "max_position_embeddings",
    "type_vocab_size",
)

# Sealed backbone -> the shape its `config.json` declares. Closed on purpose: a backbone
# this exporter has never been shown cannot be assumed to have the shape hardcoded above,
# so an unrecognized one is refused rather than exported.
#
# The BERTimbau row transcribes the WITNESS whose sha256 the repository tracks —
# `public/models/cleanfeed-ptbr-v1/config.json`, pinned in
# `models/cleanfeed-ptbr-v1/source-lock.json`. Its vocabulary of 29 794 entries is what
# separates BERTimbau from the English cased BERT of the same 12x768 shape (28 996), and
# the vocabulary FILE is checked against this number rather than trusted from the config.
BACKBONE_CONFIG_SHAPE = {
    "neuralmind/bert-base-portuguese-cased": {
        "model_type": "bert",
        "vocab_size": 29_794,
        "hidden_size": 768,
        "num_hidden_layers": 12,
        "intermediate_size": 3072,
        "num_attention_heads": 12,
        "max_position_embeddings": 512,
        "type_vocab_size": 2,
    },
    "xlm-roberta-base": {
        "model_type": "xlm-roberta",
        "vocab_size": 250_002,
        "hidden_size": 768,
        "num_hidden_layers": 12,
        "intermediate_size": 3072,
        "num_attention_heads": 12,
        "max_position_embeddings": 514,
        "type_vocab_size": 1,
    },
}

# The head this exporter is allowed to ship, and the two label mappings that are legal on
# a checkpoint. `AutoModelForSequenceClassification.from_pretrained` LOADS a checkpoint
# whose architecture is `BertForMaskedLM` — it builds the classifier at random and only
# WARNS (`score_pilot_local.py` documents the same trap on the scoring side) — so the
# declared architecture has to be read.
#
# The label order is not a naming preference: index 1 is P(ai) everywhere downstream
# (parity gate, runtime manifest, `scripts/package-own-model.mjs`, which stamps
# `{0: human, 1: ai}` into the served config). A checkpoint that named them the other way
# round would be silently inverted by that stamp, so the mapping must be THIS one.
# `train_detector.py` writes it, so the `LABEL_n` pair `num_labels=2` leaves behind is a
# checkpoint the sealed producer did not save.
SEQUENCE_CLASSIFICATION_ARCHITECTURE = "BertForSequenceClassification"
BINARY_LABEL_CONTRACT = {"0": "human", "1": "ai"}
TRANSFORMERS_DEFAULT_LABELS = {"0": "LABEL_0", "1": "LABEL_1"}

# Weights that may not have been invented by the loader. `classifier.*` is the head; the
# pooler is part of the path to it — `BertForSequenceClassification` feeds
# `bert.pooler.dense` into the classifier, so a pooler built at random hands the trained
# head a random input, and the scores are noise no more visible than an untrained head's.
INVENTED_WEIGHT_PREFIXES = ("classifier", "bert.pooler")

# The files a bundle this exporter published carries. `--out` is removed at the start of a
# run so that a refusal cannot leave the previous approved ZIP beside a rejected directory,
# so the predicate that decides what may be removed matters more than the list itself:
# five of these are what `save_pretrained` leaves in a CHECKPOINT of ~440 MB, which a
# predicate written over this list accepts. So removal requires the two markers only this
# exporter writes, and any of the six `CHECKPOINT_MEMBERS` names, at any depth, refuses it.
#
# WHAT THIS IS NOT: "the exporter only removes what it published" is stronger than the
# mechanism. The mechanism is two markers plus a FINITE list of six names, so a weight file
# whose name is outside that list does not stop the removal and goes with the directory. The
# residue is declared in ESTADO.md § 7 and it is accepted, not closed — closing it would
# need a predicate over CONTENT (a file of ~440 MB that torch can load) instead of a name,
# and that predicate has to run before anything is deleted, on a path no test of this suite
# executes.
BUNDLE_MEMBERS = (
    "onnx/model_int8.onnx",
    "config.json",
    "vocab.txt",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "parity_report.json",
)
PUBLISHED_BUNDLE_MARKERS = ("onnx/model_int8.onnx", "parity_report.json")
CHECKPOINT_MEMBERS = (
    "model.safetensors",
    "pytorch_model.bin",
    "training_args.bin",
    "optimizer.pt",
    "scheduler.pt",
    "trainer_state.json",
)
FP32_STAGING_DIRECTORY = "_fp32"

# What the staging directory holds at every instant of the ASSEMBLY: `_fp32` is created
# first and is removed only after `onnx/model_int8.onnx` and `config.json` are written
# (`build_bundle_into_staging`), so a run that died mid-assembly still carries one of the
# two. The converse does NOT follow — a path carrying neither can be this exporter's own:
# it is empty between `staging.mkdir` and the first write, and the failure path removes it
# with `shutil.rmtree(..., ignore_errors=True)`, which does not guarantee the path is gone.
# So the empty case is carved out as reusable (`assert_a_member_is_present`) and a NON-EMPTY
# directory carrying neither is PRESERVED, not removed. Fail-closed on purpose, and the cost
# is that this exporter's own leftovers can outlive it and have to be deleted by hand.
#
# The rest of `BUNDLE_MEMBERS` cannot be in this pair: `config.json` and `vocab.txt` alone
# are names any model directory on disk carries, and a match here authorizes a removal.
STAGING_DIRECTORY_MARKERS = (FP32_STAGING_DIRECTORY, "onnx/model_int8.onnx")

# The parity gate's tolerance, and the floor the score spread has to clear.
#
# PARITY IS A CHECK OF SELF-CONSISTENCY, NOT OF VALIDITY, AND A DEGENERATE MODEL MAXIMIZES
# IT. Measured on a two-class head that was never trained: with ZEROED weights the logits
# are exactly [0, 0] for every text, both sides compute P(ai) = 0.5, `meanAbsDelta` is
# exactly 0, nothing flips across 0.5, and `pass` was true. With RANDOM weights the scores
# are not identical but nearly so — a spread of 0.00358 over eight texts (0.5266 to
# 0.5302) — which satisfies the delta bound just as trivially.
#
# So "the deltas are below 0.02" is only a statement about quantization when the scores
# themselves range wider than 0.02; over a narrower range every near-constant model
# satisfies it. The spread is therefore compared against the same tolerance the deltas are
# compared against, and it is measured as an INTERQUARTILE spread: max − min is defeated by
# one outlier, and 119 scores at 0.5 with one at 0.9 passed the gate with meanAbsDelta 0.
#
# What this reading does NOT catch, measured and left open: 72 scores at 0.5 with 28 at 0.9
# have an interquartile spread of 0.4 and pass.
PARITY_MEAN_DELTA_TOLERANCE = 0.02

# The two labels of the sealed dataset, and what the parity sample has to carry of each.
# A sample drawn from one class cannot separate a confident detector from a constant one:
# the spread of P(ai) over 120 human documents is small for BOTH. `dev.jsonl` is GROUPED —
# measured: rows 0..2639 are label 0 and 2640..4117 are label 1 — so the first 120 rows,
# which is what the runbook's default asked for, are single-class.
DATASET_LABELS = (0, 1)


def assert_sealed_backbone_is_exportable(policy_path: Path = POLICY_PATH) -> str:
    """Refuse to run at all when the sealed backbone is not the shape this script emits."""
    backbone = sealed_policy(policy_path).backbone
    sealed_shape = BACKBONE_CONFIG_SHAPE.get(backbone)
    declared = None if sealed_shape is None else sealed_shape["model_type"]
    if declared is None:
        raise ValueError(
            f"sealed backbone {backbone!r} ({policy_path.name}, backbone) has no "
            f"declared config model_type here: this exporter emits a "
            f"{EMITTED_CONFIG_MODEL_TYPE!r}-shaped graph with input_ids, "
            "attention_mask and token_type_ids plus vocab.txt, and it cannot assume a "
            "backbone it has never been shown has that shape"
        )
    if declared != EMITTED_CONFIG_MODEL_TYPE:
        raise ValueError(
            f"sealed backbone {backbone!r} is {declared!r} but this exporter emits a "
            f"{EMITTED_CONFIG_MODEL_TYPE!r}-shaped graph (three inputs including "
            "token_type_ids, and vocab.txt): the artifact would pass the parity gate "
            "and still not be the model the pre-registration froze"
        )
    return backbone


def assert_config_matches_sealed_shape(
    config: dict, checkpoint: Path, backbone: str, policy_path: Path = POLICY_PATH
) -> None:
    """Refuse a checkpoint whose declared shape is not the sealed backbone's.

    Two different failures, refused with two different reasons. A divergent `model_type`
    means the emitted graph would have inputs the runtime never feeds. A matching
    `model_type` with a divergent shape means a fine-tune of ANOTHER BERT, which exports
    cleanly, agrees with its own weights in the parity gate and fits under the byte
    ceiling — so neither the size check nor parity can be what separates them.
    """
    sealed_shape = BACKBONE_CONFIG_SHAPE[backbone]
    model_type = config.get("model_type")
    if model_type != sealed_shape["model_type"]:
        raise ValueError(
            f"checkpoint {checkpoint} declares model_type {model_type!r}, but the "
            f"sealed backbone {backbone!r} is "
            f"{sealed_shape['model_type']!r} ({policy_path.name}, "
            "backbone): exporting it through this script would emit a graph whose "
            "inputs the runtime does not feed"
        )
    for field in COMPARED_CONFIG_FIELDS:
        if field == "model_type":
            continue
        declared = config.get(field)
        if declared != sealed_shape[field]:
            raise ValueError(
                f"checkpoint {checkpoint} declares {field} {declared!r}, but the sealed "
                f"backbone {backbone!r} has {sealed_shape[field]!r} ({policy_path.name}, "
                f"backbone): model_type {model_type!r} is what every BERT declares, so a "
                "fine-tune of a different one would export cleanly, pass the parity gate "
                "against its own weights and fit under the byte ceiling"
            )


def assert_config_declares_a_binary_classification_head(
    config: dict, checkpoint: Path
) -> None:
    """Refuse a checkpoint that is not declared as a two-class classifier.

    This does NOT prove the head was trained — nothing readable from `config.json` does.
    It refuses the checkpoint that has no head at all, the one whose head is not binary,
    the one whose labels are named in the inverted order, and the one that declares the
    class COUNT without the order: `num_labels: 2` says nothing about which index is P(ai).
    """
    architectures = config.get("architectures")
    if architectures != [SEQUENCE_CLASSIFICATION_ARCHITECTURE]:
        raise ValueError(
            f"checkpoint {checkpoint} declares architectures {architectures!r}, not "
            f"[{SEQUENCE_CLASSIFICATION_ARCHITECTURE!r}]: a base checkpoint declares "
            "BertForMaskedLM or BertForPreTraining and "
            "AutoModelForSequenceClassification loads it anyway, building the classifier "
            "at RANDOM and only warning — a zeroed head then returns identical logits for "
            "every text (measured: [0, 0], P(ai) 0.5, meanAbsDelta 0) and a random one "
            "scores nearly alike (measured spread 0.00358)"
        )
    labels = config.get("id2label")
    declared_labels = config.get("num_labels")
    if labels is None and declared_labels is None:
        raise ValueError(
            f"checkpoint {checkpoint} declares neither num_labels nor id2label: the "
            "runtime reads index 1 as P(ai), and a head whose class count is not "
            "declared cannot be compared against that contract"
        )
    if labels is not None and not isinstance(labels, dict):
        raise ValueError(
            f"checkpoint {checkpoint} declares id2label as {type(labels).__name__} "
            f"({labels!r}): the label contract is a mapping from index to name, and the "
            "runtime reads index 1 of it as P(ai)"
        )
    counted = None if labels is None else len(labels)
    for field, value in (("num_labels", declared_labels), ("id2label", counted)):
        if value is not None and value != 2:
            raise ValueError(
                f"checkpoint {checkpoint} declares {field} {value!r}: the sealed head is "
                "binary ({human: 0, ai: 1}), and the parity gate reads index 1 as P(ai)"
            )
    if labels is None:
        raise ValueError(
            f"checkpoint {checkpoint} declares num_labels {declared_labels!r} and no "
            f"id2label, and the sealed contract is {BINARY_LABEL_CONTRACT!r}: the class "
            "count says nothing about the ORDER, the runtime reads index 1 as P(ai), and "
            "an undeclared order cannot be compared against that contract"
        )
    named = {str(key): value for key, value in labels.items()}
    if named != BINARY_LABEL_CONTRACT:
        raise ValueError(
            f"checkpoint {checkpoint} declares id2label {named!r} and not the sealed "
            f"contract {BINARY_LABEL_CONTRACT!r}: train_detector.py writes the named "
            f"order into the checkpoint, so neither an inverted mapping nor the "
            f"{TRANSFORMERS_DEFAULT_LABELS!r} pair num_labels=2 leaves behind comes "
            "from the sealed producer — and scripts/package-own-model.mjs stamps the "
            "sealed contract into the served config, so the divergence would be "
            "overwritten by a claim the weights contradict"
        )


def count_vocabulary_entries(vocab_path: Path) -> int:
    """One WordPiece token per line, counted the way `wc -l` counts them."""
    lines = vocab_path.read_text(encoding="utf-8").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return len(lines)


def assert_vocabulary_is_the_sealed_size(
    vocab_path: Path, backbone: str, where: str
) -> int:
    """Compare the vocabulary FILE against the sealed size, not the config's claim.

    The number in `config.json` is a claim about the vocabulary; `vocab.txt` is the
    vocabulary. A fine-tune of the English cased BERT with a hand-edited `vocab_size`
    satisfies the config comparison, and this is what it cannot satisfy.
    """
    sealed_size = BACKBONE_CONFIG_SHAPE[backbone]["vocab_size"]
    if not vocab_path.is_file():
        raise ValueError(
            f"{vocab_path} was not written: the served bundle is loaded by a WordPiece "
            "tokenizer, and a checkpoint whose tokenizer saves no vocab.txt is not the "
            f"sealed backbone {backbone!r}'s"
        )
    entries = count_vocabulary_entries(vocab_path)
    if entries != sealed_size:
        raise ValueError(
            f"{where} carries {entries} vocabulary entries at {vocab_path}, but the "
            f"sealed backbone {backbone!r} has {sealed_size}: the config's vocab_size is "
            "a claim about the vocabulary and this is the vocabulary"
        )
    return entries


def assert_checkpoint_matches_sealed_backbone(
    checkpoint: Path, policy_path: Path = POLICY_PATH
) -> str:
    """Refuse a checkpoint that is not the sealed backbone with a binary head.

    Everything here is readable in milliseconds, so it runs before the torch import and
    before a single byte of the export exists.
    """
    backbone = assert_sealed_backbone_is_exportable(policy_path)
    config_path = checkpoint / "config.json"
    if not config_path.is_file():
        raise ValueError(
            f"checkpoint {checkpoint} carries no config.json: the architecture cannot "
            f"be compared against the sealed backbone {backbone!r}"
        )
    config = json.loads(config_path.read_text(encoding="utf-8"))
    assert_config_matches_sealed_shape(config, checkpoint, backbone, policy_path)
    assert_config_declares_a_binary_classification_head(config, checkpoint)
    assert_vocabulary_is_the_sealed_size(
        checkpoint / "vocab.txt", backbone, f"checkpoint {checkpoint}"
    )
    return backbone


def _loaded_key(item: Any) -> str:
    # `mismatched_keys` entries are (key, checkpoint_shape, model_shape) tuples, while
    # `missing_keys` entries are plain strings.
    if isinstance(item, (tuple, list)) and item:
        return str(item[0])
    return str(item)


def _was_invented(key: str) -> bool:
    return any(
        key == prefix or key.startswith(f"{prefix}.")
        for prefix in INVENTED_WEIGHT_PREFIXES
    )


def assert_the_head_came_from_the_checkpoint(
    loading_info: dict, checkpoint: Path
) -> tuple[str, ...]:
    """Refuse a load that had to invent the classification head or the pooler under it.

    `from_pretrained` reports the weights it could not take from the checkpoint and
    initializes them at random, WARNING rather than failing. A weight reported here is a
    weight that never saw the corpus, and its scores are noise that the parity gate cannot
    see: both sides read the same invented weights.
    """
    for key in ("missing_keys", "mismatched_keys"):
        if key not in loading_info:
            raise ValueError(
                f"the loader reported no {key} for {checkpoint}: this guard reads the "
                "loading info to tell a trained head from an invented one, and an "
                "absent report would make it pass everything"
            )
    offenders = tuple(
        sorted(
            {
                _loaded_key(item)
                for item in (
                    *loading_info["missing_keys"],
                    *loading_info["mismatched_keys"],
                )
                if _was_invented(_loaded_key(item))
            }
        )
    )
    if offenders:
        raise ValueError(
            f"checkpoint {checkpoint} did not carry {list(offenders)}: "
            "AutoModelForSequenceClassification built them at random and only warned, so "
            "this artifact would score every text alike — meanAbsDelta 0 and zero verdict "
            "flips, which is the reading the delta bound cannot separate from a faithful "
            "quantization"
        )
    return offenders


def assert_inputs_are_the_emitted_shape(
    names: Iterable[str], where: str
) -> tuple[str, ...]:
    """Refuse anything but exactly the three inputs the served runtime feeds.

    The parity gate cannot catch a missing input: it compares the graph against the same
    torch weights, so a two-input graph agrees with itself while the runtime's
    `token_type_ids` never reaches it. `src/inference/onnx-classifier.ts` feeds all three.
    """
    observed = set(names)
    if observed != set(EMITTED_GRAPH_INPUTS):
        raise ValueError(
            f"{where} takes {sorted(observed)}, not the "
            f"{list(EMITTED_GRAPH_INPUTS)} this exporter emits: an artifact missing one "
            "of the three still passes the parity gate below, because parity compares "
            "the graph against the same torch weights it was exported from"
        )
    return EMITTED_GRAPH_INPUTS


def assert_export_is_within_the_sealed_ceiling(
    onnx_path: Path, policy_path: Path = POLICY_PATH
) -> int:
    """Refuse an int8 artifact above `onnxMaximumInt8Bytes`.

    An UPPER bound and nothing else: it catches an export that left the embedding table
    in fp32, or one of a larger encoder, because either exceeds it by tens of megabytes.
    It cannot certify that the bytes belong to the sealed backbone — anything smaller
    passes, including a pruned graph. Belonging is what the config comparison, the
    vocabulary count and the graph-input assertion above are for.
    """
    ceiling = sealed_policy(policy_path).onnx_maximum_int8_bytes
    measured = onnx_path.stat().st_size
    if measured > ceiling:
        raise ValueError(
            f"int8 export is {measured} bytes, above the pre-registered ceiling of "
            f"{ceiling} ({policy_path.name}, onnxMaximumInt8Bytes): the ceiling is "
            "sized for the sealed backbone with a quantized embedding table, so an "
            "artifact above it is a different model or a different quantization"
        )
    return measured


def quantize_within_the_ceiling(
    fp32_path: Path,
    int8_path: Path,
    quantize: Callable[[Path, Path], None],
    policy_path: Path = POLICY_PATH,
) -> int:
    """Quantize into a staging file and keep it only once the ceiling accepts it.

    The guard can only run after quantization, so by the time it refuses, the rejected
    bytes exist. They must not exist at `int8_path`, which is where the packaging step
    and the parity gate read from.
    """
    staging = int8_path.with_name(f"{int8_path.stem}.staging{int8_path.suffix}")
    quantize(fp32_path, staging)
    try:
        measured = assert_export_is_within_the_sealed_ceiling(staging, policy_path)
    except ValueError:
        staging.unlink(missing_ok=True)
        raise
    staging.replace(int8_path)
    return measured


def _range(values: Sequence[float]) -> float:
    return max(values) - min(values)


def _quantile(sorted_values: Sequence[float], fraction: float) -> float:
    """Linear-interpolated quantile, the `numpy.quantile` default method."""
    position = (len(sorted_values) - 1) * fraction
    below = int(position)
    above = min(below + 1, len(sorted_values) - 1)
    return sorted_values[below] + (sorted_values[above] - sorted_values[below]) * (
        position - below
    )


def _interquartile_spread(values: Sequence[float]) -> float:
    """The spread the degeneracy floor reads: robust to the outlier that defeats max−min.

    A model that scores 119 of 120 documents at 0.5 and one at 0.9 has a range of 0.4 and
    is constant — measured passing the gate with meanAbsDelta 0. The sample is drawn
    balanced across both labels (see `read_parity_samples`), so for a detector that
    separates at all the first and third quartiles fall on opposite sides.
    """
    ordered = sorted(values)
    return _quantile(ordered, 0.75) - _quantile(ordered, 0.25)


def build_parity_report(
    torch_scores: Sequence[float], onnx_scores: Sequence[float]
) -> dict:
    """The parity statistics, and whether the sample can carry them at all.

    `degenerate` is the second reading of the same numbers: see
    `PARITY_MEAN_DELTA_TOLERANCE` — a model whose scores do not range wider than the
    tolerance satisfies the delta bound by construction, so agreement between the two
    runtimes says nothing about quantization.
    """
    if len(torch_scores) != len(onnx_scores):
        raise ValueError(
            f"parity has {len(torch_scores)} torch scores and {len(onnx_scores)} onnx "
            "scores: the two sides are compared pairwise"
        )
    if not torch_scores:
        raise ValueError(
            "the parity sample is empty: --eval must name a JSONL of dev rows with a "
            "`text` field and a `label`, and --parity-samples must be at least 2. The "
            "statistics below would raise on an empty sequence rather than report "
            "agreement, and by then the int8 would already exist"
        )
    deltas = [abs(a - b) for a, b in zip(torch_scores, onnx_scores)]
    flips = sum(
        1 for a, b in zip(torch_scores, onnx_scores) if (a >= 0.5) != (b >= 0.5)
    )
    mean_delta = sum(deltas) / len(deltas)
    torch_iqr = _interquartile_spread(torch_scores)
    onnx_iqr = _interquartile_spread(onnx_scores)
    degenerate = min(torch_iqr, onnx_iqr) <= PARITY_MEAN_DELTA_TOLERANCE
    return {
        "samples": len(deltas),
        "meanAbsDelta": mean_delta,
        "maxAbsDelta": max(deltas),
        "verdictFlips": flips,
        "torchScoreIqr": torch_iqr,
        "onnxScoreIqr": onnx_iqr,
        "torchScoreRange": _range(torch_scores),
        "onnxScoreRange": _range(onnx_scores),
        "degenerate": degenerate,
        "pass": bool(
            mean_delta < PARITY_MEAN_DELTA_TOLERANCE and flips == 0 and not degenerate
        ),
    }


def assert_no_checkpoint_is_at(directory: Path, what: str) -> None:
    """Refuse to delete a directory where one of `CHECKPOINT_MEMBERS` appears, at any depth.

    A `save_pretrained` directory carries `config.json`, `vocab.txt`, `tokenizer.json`,
    `tokenizer_config.json` and `special_tokens_map.json` — five of the bundle's seven
    names — so a predicate written over the bundle's file list accepts a checkpoint as a
    previous publication. `shutil.rmtree` takes a subdirectory with it, so a checkpoint
    below the top level is the same loss and the search is recursive.

    The list is CLOSED, and weights under any other name do not stop the removal:
    `save_pretrained` shards above `max_shard_size` (5 GB by default) into
    `model-00001-of-00002.safetensors`, which is not one of the six. Declared residue,
    accepted: the sealed backbone's checkpoint is ~440 MB, an order below that threshold,
    so it is saved as a single `model.safetensors`; and `--out` aimed at or inside the
    checkpoint is refused by `assert_out_is_not_the_checkpoint` before this predicate is
    consulted at all.
    """
    if not directory.is_dir():
        raise ValueError(f"{what} {directory} exists and is not a directory")
    intruder = next(
        (
            found.relative_to(directory).as_posix()
            for member in CHECKPOINT_MEMBERS
            for found in directory.rglob(member)
        ),
        None,
    )
    if intruder is not None:
        raise ValueError(
            f"{what} {directory} carries {intruder}: it is a training checkpoint, not a "
            "bundle this exporter published, and this run would delete it. Point --out "
            "at a path outside the checkpoint"
        )


def assert_every_marker_is_present(
    directory: Path, markers: Sequence[str], what: str
) -> None:
    """A published bundle carries all of them. An empty directory the operator made is reusable."""
    if not any(directory.iterdir()):
        return
    if not all((directory / marker).exists() for marker in markers):
        raise ValueError(
            f"{what} {directory} already exists and does not carry {list(markers)}: "
            "this run would delete it, because a refusal must not leave the previous "
            "publication beside a rejected one. Point --out at a fresh path"
        )


def assert_out_is_not_the_checkpoint(out: Path, checkpoint: Path) -> None:
    """Refuse `--out` that is, contains or sits inside `--checkpoint`.

    The publication path is REMOVED at the start of the run, so the two must not overlap.
    The marker check above cannot be the only defence: it reads the directory that exists
    now, and `--out bertimbau` (the parent of `best/`) carries no checkpoint member of its
    own.
    """
    resolved_out = out.resolve()
    resolved_checkpoint = checkpoint.resolve()
    if resolved_out == resolved_checkpoint or resolved_checkpoint.is_relative_to(
        resolved_out
    ):
        raise ValueError(
            f"--out {out} is the checkpoint {checkpoint} (or holds it): --out is removed "
            "at the start of the run, so this would delete the trained weights before any "
            "guard runs"
        )
    if resolved_out.is_relative_to(resolved_checkpoint):
        raise ValueError(
            f"--out {out} is inside the checkpoint {checkpoint}: the bundle is published "
            "by replacing that path, and the checkpoint has to survive the export"
        )


def assert_archive_is_ours_to_remove(archive: Path) -> None:
    """The ZIP path is derived from `--out`, so what sits there has to carry the markers.

    `zipfile.is_zipfile` reads whether the bytes are a ZIP, which any ZIP at that path
    satisfies. The members this exporter writes are prefixed with the bundle's directory
    name (see `zip_bundle`), so the markers are looked for as SUFFIXES of a member.
    """
    if not archive.exists():
        return
    if not zipfile.is_zipfile(archive):
        raise ValueError(
            f"{archive} exists and is not a ZIP: this run would delete it. Point --out at "
            "a fresh path"
        )
    with zipfile.ZipFile(archive) as handle:
        names = handle.namelist()
    absent = [
        marker
        for marker in PUBLISHED_BUNDLE_MARKERS
        if not any(
            name == marker or name.endswith(f"/{marker}") for name in names
        )
    ]
    if absent:
        raise ValueError(
            f"the ZIP at {archive} carries no {absent}: this run would delete it. Point "
            "--out at a fresh path"
        )


def clear_previous_publication(out: Path, archive: Path, staging: Path) -> list[str]:
    """Remove the previous publication before the run, and say what was removed.

    Not housekeeping: `zipfile.ZipFile(..., "w")` only truncates if the run reaches it, so
    a refusal on a second run over the same `--out` would leave run A's approved ZIP
    beside run B's rejected directory, and nothing in either names the run it came from.
    """
    removed: list[str] = []
    if out.exists():
        assert_no_checkpoint_is_at(out, "--out")
        assert_every_marker_is_present(out, PUBLISHED_BUNDLE_MARKERS, "--out")
        shutil.rmtree(out)
        removed.append(str(out))
    if archive.exists():
        assert_archive_is_ours_to_remove(archive)
        archive.unlink()
        removed.append(str(archive))
    if staging.exists():
        # A run that died in the middle leaves a PARTIAL bundle in staging, so this
        # directory is recognized by ANY member of the pair that spans the assembly, and
        # not by the published markers.
        assert_no_checkpoint_is_at(staging, "the staging directory")
        assert_a_member_is_present(
            staging, STAGING_DIRECTORY_MARKERS, "the staging directory"
        )
        shutil.rmtree(staging)
        removed.append(str(staging))
    return removed


def assert_a_member_is_present(
    directory: Path, members: Sequence[str], what: str
) -> None:
    if not any(directory.iterdir()):
        return
    if not any((directory / member).exists() for member in members):
        raise ValueError(
            f"{what} {directory} already exists and carries none of {list(members)}: "
            "this run would delete it. Point --out at a fresh path"
        )


def zip_bundle(bundle: Path, prefix: str, archive: Path) -> Path:
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as handle:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                handle.write(path, Path(prefix) / path.relative_to(bundle))
    return archive


def publish_only_after_every_guard(
    out: Path, build_into_staging: Callable[[Path], dict]
) -> tuple[Path, dict]:
    """Build the bundle in staging, and promote the directory and the ZIP only after.

    Every guard runs against staging, so a refusal leaves nothing at the canonical path —
    not a rejected ONNX, not a partial bundle, not a `parity_report.json` with
    `pass: false`, and not the previous run's ZIP.
    """
    if not out.name:
        raise ValueError("--out must name a directory, not a filesystem root")
    archive = Path(f"{out}-artifacts.zip")
    staging = out.with_name(f"{out.name}.staging")
    staging_archive = archive.with_name(f"{archive.stem}.staging{archive.suffix}")
    removed = clear_previous_publication(out, archive, staging)
    if staging_archive.exists():
        assert_archive_is_ours_to_remove(staging_archive)
        staging_archive.unlink()
        removed.append(str(staging_archive))
    for path in removed:
        print(f"  saida anterior removida: {path}")
    staging.mkdir(parents=True)
    try:
        report = build_into_staging(staging)
        zip_bundle(staging, out.name, staging_archive)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        staging_archive.unlink(missing_ok=True)
        raise
    staging.replace(out)
    staging_archive.replace(archive)
    return archive, report


class ExportBackend(Protocol):
    """The torch/onnxruntime half, injected so the ORDER above is testable without them.

    `loading_info` and `tokenizer_inputs` are here so that the two guards that read the
    LOADED model are called from the flow below, where a test can reach them: a guard whose
    only call site is inside the torch half is a guard no test executes.
    """

    def loading_info(self) -> dict: ...

    def tokenizer_inputs(self) -> Iterable[str]: ...

    def export_fp32(self, fp32_dir: Path) -> Path: ...

    def quantize(self, source: Path, target: Path) -> None: ...

    def save_tokenizer(self, bundle: Path) -> None: ...

    def graph_inputs(self, model_path: Path) -> Iterable[str]: ...

    def score(self, text: str) -> tuple[float, float]: ...


def build_bundle_into_staging(
    staging: Path,
    checkpoint: Path,
    rows: Sequence[dict],
    backend: ExportBackend,
    policy_path: Path = POLICY_PATH,
) -> dict:
    """Assemble the whole bundle under `staging` and run every guard on it."""
    backbone = assert_checkpoint_matches_sealed_backbone(checkpoint, policy_path)
    assert_the_head_came_from_the_checkpoint(backend.loading_info(), checkpoint)
    assert_inputs_are_the_emitted_shape(backend.tokenizer_inputs(), "the tokenizer")
    fp32_dir = staging / FP32_STAGING_DIRECTORY
    fp32_dir.mkdir(parents=True)
    print("1/4 exportando fp32 ONNX…")
    fp32_path = backend.export_fp32(fp32_dir)

    print("2/4 quantizando int8 (dynamic)…")
    int8_path = staging / "onnx" / "model_int8.onnx"
    int8_path.parent.mkdir(parents=True)
    measured = quantize_within_the_ceiling(
        fp32_path, int8_path, backend.quantize, policy_path
    )
    print(f"  int8 = {measured} bytes")

    print("3/4 copiando tokenizer/config…")
    backend.save_tokenizer(staging)
    shutil.copy2(checkpoint / "config.json", staging / "config.json")
    shutil.rmtree(fp32_dir)
    entries = assert_vocabulary_is_the_sealed_size(
        staging / "vocab.txt", backbone, "the bundle"
    )

    print("4/4 paridade fp32-torch vs int8-onnx…")
    assert_inputs_are_the_emitted_shape(backend.graph_inputs(int8_path), "the int8 graph")
    torch_scores: list[float] = []
    onnx_scores: list[float] = []
    for row in rows:
        p_torch, p_onnx = backend.score(row["text"])
        torch_scores.append(p_torch)
        onnx_scores.append(p_onnx)

    report = {
        **build_parity_report(torch_scores, onnx_scores),
        "sampleLabelCounts": count_sample_labels(rows),
        "backbone": backbone,
        "int8Bytes": measured,
        "vocabularyEntries": entries,
        "checkpointConfigSha256": hashlib.sha256(
            (checkpoint / "config.json").read_bytes()
        ).hexdigest(),
        **policy_receipt(sealed_policy(policy_path)),
    }
    (staging / "parity_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    if report["degenerate"]:
        raise ValueError(
            f"ESCORE DEGENERADO — o intervalo interquartil do escore e "
            f"{report['torchScoreIqr']} (torch) e {report['onnxScoreIqr']} (onnx), dentro "
            f"da propria tolerancia de {PARITY_MEAN_DELTA_TOLERANCE} sobre uma amostra de "
            f"{report['sampleLabelCounts']}: paridade perfeita sobre escore constante e o "
            "que um modelo com cabeca nao treinada entrega, e nao e evidencia de "
            "quantizacao fiel"
        )
    if not report["pass"]:
        raise ValueError(
            f"PARIDADE REPROVADA — meanAbsDelta {report['meanAbsDelta']}, "
            f"{report['verdictFlips']} inversoes de veredito: nao use este artefato"
        )
    return report


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def count_sample_labels(rows: Sequence[dict]) -> dict[str, int]:
    counts = {str(label): 0 for label in DATASET_LABELS}
    for row in rows:
        counts[str(row["label"])] += 1
    return counts


def _strided(positions: Sequence[int], take: int) -> list[int]:
    """`take` positions spread across the whole sequence, not its first `take`."""
    if take >= len(positions):
        return list(positions)
    stride = len(positions) / take
    return [positions[int(index * stride)] for index in range(take)]


def draw_a_balanced_parity_sample(
    rows: Sequence[dict], limit: int, path: Path
) -> list[dict]:
    """Take the same number of rows from each label, spread across the whole file.

    The gate reads the score spread, so the sample decides what the spread can mean: over
    documents of one class a confident detector is as flat as a constant one, and the floor
    would refuse a legitimate export. Equal counts are what make the interquartile spread
    straddle both modes for any detector that separates at all — no minority fraction to
    pick, and none to move later.
    """
    positions: dict[int, list[int]] = {label: [] for label in DATASET_LABELS}
    for index, row in enumerate(rows):
        if "label" not in row:
            raise ValueError(
                f"--eval {path} row {index} declares no label: the parity sample is drawn "
                "balanced across both labels, and a row whose class is unknown cannot be "
                "placed in it"
            )
        label = row["label"]
        if label not in positions:
            raise ValueError(
                f"--eval {path} row {index} declares label {label!r}: the sealed dataset "
                f"is binary and its labels are {list(DATASET_LABELS)}"
            )
        positions[label].append(index)
    empty = [label for label, found in positions.items() if not found]
    if empty:
        raise ValueError(
            f"--eval {path} carries no row of label {empty}: the parity gate reads the "
            "score spread, and over a single class a trained detector is as flat as a "
            "constant one — the sample cannot tell them apart"
        )
    scarcest = min(len(found) for found in positions.values())
    per_label = min(limit // 2, scarcest)
    if per_label * 2 < limit:
        # The sample SHRINKS instead of refusing, because equal counts are what the floor
        # needs and the file cannot be made to have more of its scarcer class. What the
        # report would otherwise carry silently is `samples` below --parity-samples.
        print(
            f"  amostra de paridade reduzida a {per_label * 2} linhas de "
            f"--parity-samples {limit}: --eval {path} carrega {scarcest} linhas da "
            "classe menos numerosa"
        )
    chosen = sorted(
        index
        for label in DATASET_LABELS
        for index in _strided(positions[label], per_label)
    )
    return [rows[index] for index in chosen]


def read_parity_samples(path: Path, limit: int) -> list[dict]:
    if limit < 2:
        raise ValueError(
            f"--parity-samples {limit} is below 2: the sample is drawn balanced across "
            "both labels, so it takes at least one row of each"
        )
    if not path.is_file():
        raise ValueError(
            f"--eval {path} does not exist: the parity gate scores real dev rows, and "
            "there is no synthetic sample to fall back to"
        )
    rows = read_jsonl(path)
    if not rows:
        raise ValueError(
            f"--eval {path} carries no row: the parity gate scores real dev rows, and the "
            "gate would reach np.max over an empty array only AFTER publishing the int8"
        )
    return draw_a_balanced_parity_sample(rows, limit, path)


def torch_onnx_backend(args: argparse.Namespace) -> ExportBackend:
    """The real backend: torch, transformers and onnxruntime, imported only here.

    Every refusal that can be reached without a 440 MB checkpoint happens before this
    function is called, and the guards that read the LOADED model are called by the flow,
    not here — so `main` below can be driven with a fake and still exercise them.
    """
    import numpy as np
    import torch
    from onnxruntime import InferenceSession
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    class TorchOnnxBackend:
        def __init__(self) -> None:
            self.tokenizer = AutoTokenizer.from_pretrained(str(args.checkpoint))
            self.model, self.report = (
                AutoModelForSequenceClassification.from_pretrained(
                    str(args.checkpoint), output_loading_info=True
                )
            )
            self.model.eval()
            self.session: Any = None

        def loading_info(self) -> dict:
            return self.report

        def tokenizer_inputs(self) -> tuple[str, ...]:
            return tuple(self._encode("exemplo de exportação").keys())

        def export_fp32(self, fp32_dir: Path) -> Path:
            fp32_path = fp32_dir / "model.onnx"
            try:
                from optimum.onnxruntime import ORTModelForSequenceClassification

                ort_model = ORTModelForSequenceClassification.from_pretrained(
                    str(args.checkpoint), export=True
                )
                ort_model.save_pretrained(fp32_dir)
                print("  via optimum")
            except ImportError:
                # Fallback sem optimum: torch.onnx.export com os nomes de entrada/saída
                # que o Transformers.js espera (input_ids/attention_mask/token_type_ids
                # -> logits) e eixos dinâmicos de batch/sequência.
                class LogitsOnly(torch.nn.Module):
                    def __init__(self, inner: torch.nn.Module) -> None:
                        super().__init__()
                        self.inner = inner

                    def forward(self, input_ids, attention_mask, token_type_ids):
                        return self.inner(
                            input_ids=input_ids,
                            attention_mask=attention_mask,
                            token_type_ids=token_type_ids,
                        ).logits

                sample = self.tokenizer("exemplo de exportação", return_tensors="pt")
                dynamic = {
                    name: {0: "batch", 1: "sequence"} for name in EMITTED_GRAPH_INPUTS
                }
                dynamic["logits"] = {0: "batch"}
                torch.onnx.export(
                    LogitsOnly(self.model),
                    tuple(sample[name] for name in EMITTED_GRAPH_INPUTS),
                    str(fp32_path),
                    input_names=list(EMITTED_GRAPH_INPUTS),
                    output_names=["logits"],
                    dynamic_axes=dynamic,
                    opset_version=14,
                )
                print("  via torch.onnx.export (fallback sem optimum)")
            return fp32_path

        def quantize(self, source: Path, target: Path) -> None:
            quantize_dynamic(
                model_input=str(source),
                model_output=str(target),
                weight_type=QuantType.QInt8,
            )

        def save_tokenizer(self, bundle: Path) -> None:
            self.tokenizer.save_pretrained(str(bundle))

        def graph_inputs(self, model_path: Path) -> tuple[str, ...]:
            self.session = InferenceSession(str(model_path))
            return tuple(i.name for i in self.session.get_inputs())

        def _encode(self, text: str):
            return self.tokenizer(
                text,
                truncation=True,
                max_length=args.max_length,
                return_tensors="pt",
            )

        def score(self, text: str) -> tuple[float, float]:
            encoding = self._encode(text)
            with torch.no_grad():
                p_torch = torch.softmax(
                    self.model(**encoding).logits.float(), dim=-1
                )[0, 1].item()
            feed = {
                name: encoding[name].numpy().astype(np.int64)
                for name in EMITTED_GRAPH_INPUTS
            }
            logits = self.session.run(None, feed)[0]
            exp = np.exp(logits[0] - logits[0].max())
            return p_torch, float((exp / exp.sum())[1])

    return TorchOnnxBackend()


def main(
    argv: Sequence[str] | None = None,
    build_backend: Callable[[argparse.Namespace], ExportBackend] = torch_onnx_backend,
) -> None:
    policy = sealed_policy()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--eval", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--parity-samples", type=int, default=120)
    parser.add_argument("--max-length", type=int, default=512)
    args = parser.parse_args(argv)
    print(announce(policy))
    assert_out_is_not_the_checkpoint(args.out, args.checkpoint)
    assert_checkpoint_matches_sealed_backbone(args.checkpoint)
    rows = read_parity_samples(args.eval, args.parity_samples)
    backend = build_backend(args)
    archive, _ = publish_only_after_every_guard(
        args.out,
        lambda staging: build_bundle_into_staging(
            staging, args.checkpoint, rows, backend
        ),
    )
    print(f"OK -> {archive} ({archive.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
