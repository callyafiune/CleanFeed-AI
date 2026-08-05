"""T5 — exports the trained checkpoint to ONNX int8 (run on Colab).

Produces the artifact set the extension bundle needs (Transformers.js layout):
  out/onnx/model_int8.onnx   (dynamic-quantized int8)
  out/config.json, tokenizer.json, tokenizer_config.json, vocab.txt,
  out/special_tokens_map.json
  out/parity_report.json     (fp32-torch vs int8-onnx on real dev samples)

Parity gate: the mean |Δ P(ai)| between torch fp32 and onnx int8 must stay
small (< 0.02) and no sample may flip across 0.5 — quantization must not change
verdicts. The report ships with the artifacts for the bundle's provenance.

Colab usage (after training):
  !pip -q install optimum onnx onnxruntime
  # subir tambem benchmark/preregistration-v4.json: a politica selada e lida, nao
  # retypada, e sem ela o script recusa antes do argparse
  !python export_onnx.py --checkpoint bertimbau/best --eval dev.jsonl --out cleanfeed-ptbr-v1
  # baixe o zip gerado: cleanfeed-ptbr-v1-artifacts.zip (~110 MB)
"""

from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from collections.abc import Callable, Iterable
from pathlib import Path

POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"

# A Colab upload lands in one flat directory, so the sealed file can only sit BESIDE the
# script there. The checkout path above is tried first: inside the repository it is the
# tracked file whose bytes `EVALUATOR_FILES` watches, and a stray copy next to the script
# must never shadow it.
COLAB_POLICY_PATH = Path(__file__).resolve().parent / "preregistration-v4.json"

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

# Sealed backbone -> the shape its `config.json` declares. Closed on purpose: a backbone
# this exporter has never been shown cannot be assumed to have the shape hardcoded above,
# so an unrecognized one is refused rather than exported.
#
# `model_type` alone does not identify a model — every BERT declares "bert" — so the
# vocabulary size is carried too: BERTimbau's WordPiece vocabulary has 29 794 entries
# (`vocab.txt` of the served bundle has exactly that many lines), against 28 996 for the
# English cased BERT of the same 12x768 shape.
BACKBONE_CONFIG_SHAPE = {
    "neuralmind/bert-base-portuguese-cased": {
        "model_type": "bert",
        "vocab_size": 29_794,
        "hidden_size": 768,
        "num_hidden_layers": 12,
    },
    "xlm-roberta-base": {
        "model_type": "xlm-roberta",
        "vocab_size": 250_002,
        "hidden_size": 768,
        "num_hidden_layers": 12,
    },
}


def sealed_policy_path(policy_path: Path = POLICY_PATH) -> Path:
    if policy_path.is_file():
        return policy_path
    if policy_path == POLICY_PATH and COLAB_POLICY_PATH.is_file():
        return COLAB_POLICY_PATH
    raise ValueError(
        f"the sealed pre-registration is not at {policy_path} nor at "
        f"{COLAB_POLICY_PATH}: upload benchmark/preregistration-v4.json next to this "
        "script (the backbone and the export ceiling are policy and are not retyped "
        "here, so there is nothing to fall back to)"
    )


def sealed_policy(policy_path: Path = POLICY_PATH) -> dict:
    return json.loads(sealed_policy_path(policy_path).read_text(encoding="utf-8"))


def assert_sealed_backbone_is_exportable(policy_path: Path = POLICY_PATH) -> str:
    """Refuse to run at all when the sealed backbone is not the shape this script emits."""
    backbone = str(sealed_policy(policy_path)["backbone"])
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


def assert_checkpoint_matches_sealed_backbone(
    checkpoint: Path, policy_path: Path = POLICY_PATH
) -> str:
    """Refuse a checkpoint that is not the sealed backbone's shape AND vocabulary.

    Two different failures, refused with two different reasons. A divergent `model_type`
    means the emitted graph would have inputs the runtime never feeds. A matching
    `model_type` with a divergent vocabulary means a fine-tune of ANOTHER BERT, which
    exports cleanly, agrees with its own weights in the parity gate and fits under the
    byte ceiling — so the size check cannot be what separates them.
    """
    backbone = assert_sealed_backbone_is_exportable(policy_path)
    sealed_shape = BACKBONE_CONFIG_SHAPE[backbone]
    config_path = checkpoint / "config.json"
    if not config_path.is_file():
        raise ValueError(
            f"checkpoint {checkpoint} carries no config.json: the architecture cannot "
            f"be compared against the sealed backbone {backbone!r}"
        )
    config = json.loads(config_path.read_text(encoding="utf-8"))
    model_type = config.get("model_type")
    if model_type != sealed_shape["model_type"]:
        raise ValueError(
            f"checkpoint {checkpoint} declares model_type {model_type!r}, but the "
            f"sealed backbone {backbone!r} is "
            f"{sealed_shape['model_type']!r} ({policy_path.name}, "
            "backbone): exporting it through this script would emit a graph whose "
            "inputs the runtime does not feed"
        )
    for field in ("vocab_size", "hidden_size", "num_hidden_layers"):
        declared = config.get(field)
        if declared != sealed_shape[field]:
            raise ValueError(
                f"checkpoint {checkpoint} declares {field} {declared!r}, but the sealed "
                f"backbone {backbone!r} has {sealed_shape[field]!r} ({policy_path.name}, "
                f"backbone): model_type {model_type!r} is what every BERT declares, so a "
                "fine-tune of a different one would export cleanly, pass the parity gate "
                "against its own weights and fit under the byte ceiling"
            )
    return backbone


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
    passes, including a pruned graph. Belonging is what the config comparison and the
    graph-input assertion above are for.
    """
    ceiling = int(sealed_policy(policy_path)["onnxMaximumInt8Bytes"])
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
    """Quantize into a staging file and publish it only once the ceiling accepts it.

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


def read_jsonl(path: Path, limit: int) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
            if len(rows) >= limit:
                break
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--eval", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--parity-samples", type=int, default=120)
    parser.add_argument("--max-length", type=int, default=512)
    args = parser.parse_args()
    assert_checkpoint_matches_sealed_backbone(args.checkpoint)

    import numpy as np
    import torch
    from onnxruntime import InferenceSession
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    out = args.out
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    (out / "_fp32").mkdir(parents=True, exist_ok=True)
    fp32_path = out / "_fp32" / "model.onnx"

    tokenizer = AutoTokenizer.from_pretrained(str(args.checkpoint))
    torch_model = AutoModelForSequenceClassification.from_pretrained(
        str(args.checkpoint)
    )
    torch_model.eval()

    print("1/4 exportando fp32 ONNX…")
    try:
        from optimum.onnxruntime import ORTModelForSequenceClassification

        ort_model = ORTModelForSequenceClassification.from_pretrained(
            str(args.checkpoint), export=True
        )
        ort_model.save_pretrained(out / "_fp32")
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

        sample = tokenizer("exemplo de exportação", return_tensors="pt")
        dynamic = {name: {0: "batch", 1: "sequence"} for name in EMITTED_GRAPH_INPUTS}
        dynamic["logits"] = {0: "batch"}
        torch.onnx.export(
            LogitsOnly(torch_model),
            tuple(sample[name] for name in EMITTED_GRAPH_INPUTS),
            str(fp32_path),
            input_names=list(EMITTED_GRAPH_INPUTS),
            output_names=["logits"],
            dynamic_axes=dynamic,
            opset_version=14,
        )
        print("  via torch.onnx.export (fallback sem optimum)")

    print("2/4 quantizando int8 (dynamic)…")
    try:
        measured = quantize_within_the_ceiling(
            out / "_fp32" / "model.onnx",
            onnx_dir / "model_int8.onnx",
            lambda source, target: quantize_dynamic(
                model_input=str(source),
                model_output=str(target),
                weight_type=QuantType.QInt8,
            ),
        )
    except ValueError:
        shutil.rmtree(out / "_fp32", ignore_errors=True)
        raise
    print(f"  int8 = {measured} bytes")

    print("3/4 copiando tokenizer/config…")
    tokenizer.save_pretrained(out)
    for name in ("config.json",):
        shutil.copy2(args.checkpoint / name, out / name)
    shutil.rmtree(out / "_fp32")
    if not (out / "vocab.txt").is_file():
        raise ValueError(
            f"{out / 'vocab.txt'} was not written: the served bundle is loaded by a "
            "WordPiece tokenizer, and a checkpoint whose tokenizer saves no vocab.txt is "
            "not the sealed backbone's"
        )

    print("4/4 paridade fp32-torch vs int8-onnx…")
    rows = read_jsonl(args.eval, args.parity_samples)
    session = InferenceSession(str(onnx_dir / "model_int8.onnx"))
    assert_inputs_are_the_emitted_shape(
        (i.name for i in session.get_inputs()), "the int8 graph"
    )

    deltas: list[float] = []
    flips = 0
    with torch.no_grad():
        for row in rows:
            encoding = tokenizer(
                row["text"],
                truncation=True,
                max_length=args.max_length,
                return_tensors="pt",
            )
            p_torch = torch.softmax(torch_model(**encoding).logits.float(), dim=-1)[
                0, 1
            ].item()
            assert_inputs_are_the_emitted_shape(encoding.keys(), "the tokenizer")
            feed = {
                name: encoding[name].numpy().astype(np.int64)
                for name in EMITTED_GRAPH_INPUTS
            }
            logits = session.run(None, feed)[0]
            exp = np.exp(logits[0] - logits[0].max())
            p_onnx = float((exp / exp.sum())[1])
            deltas.append(abs(p_torch - p_onnx))
            if (p_torch >= 0.5) != (p_onnx >= 0.5):
                flips += 1

    report = {
        "samples": len(rows),
        "meanAbsDelta": float(np.mean(deltas)),
        "maxAbsDelta": float(np.max(deltas)),
        "verdictFlips": flips,
        "pass": bool(np.mean(deltas) < 0.02 and flips == 0),
    }
    (out / "parity_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    if not report["pass"]:
        raise SystemExit("PARIDADE REPROVADA — não use este artefato")

    archive = Path(f"{out}-artifacts.zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(out.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(out.parent))
    print(f"OK -> {archive} ({archive.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
