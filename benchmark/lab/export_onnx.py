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
  !python export_onnx.py --checkpoint bertimbau/best --eval dev.jsonl --out cleanfeed-ptbr-v1
  # baixe o zip gerado: cleanfeed-ptbr-v1-artifacts.zip (~110 MB)
"""

from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path


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

    import numpy as np
    import torch
    from onnxruntime import InferenceSession
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.onnxruntime import ORTModelForSequenceClassification
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    out = args.out
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    print("1/4 exportando fp32 ONNX (optimum)…")
    ort_model = ORTModelForSequenceClassification.from_pretrained(
        str(args.checkpoint), export=True
    )
    ort_model.save_pretrained(out / "_fp32")

    print("2/4 quantizando int8 (dynamic)…")
    quantize_dynamic(
        model_input=str(out / "_fp32" / "model.onnx"),
        model_output=str(onnx_dir / "model_int8.onnx"),
        weight_type=QuantType.QInt8,
    )

    print("3/4 copiando tokenizer/config…")
    tokenizer = AutoTokenizer.from_pretrained(str(args.checkpoint))
    tokenizer.save_pretrained(out)
    for name in ("config.json",):
        shutil.copy2(args.checkpoint / name, out / name)
    shutil.rmtree(out / "_fp32")

    print("4/4 paridade fp32-torch vs int8-onnx…")
    rows = read_jsonl(args.eval, args.parity_samples)
    torch_model = AutoModelForSequenceClassification.from_pretrained(
        str(args.checkpoint)
    )
    torch_model.eval()
    session = InferenceSession(str(onnx_dir / "model_int8.onnx"))
    input_names = {i.name for i in session.get_inputs()}

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
            feed = {
                name: encoding[name].numpy().astype(np.int64)
                for name in ("input_ids", "attention_mask", "token_type_ids")
                if name in input_names and name in encoding
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
