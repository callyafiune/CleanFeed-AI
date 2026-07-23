"""Scores the pilot pair set with a LOCAL model (ONNX dir or HF checkpoint).

Emits the same row shape as the go/no-go scorer (class human/ai + score) so
compare_detectors.py can build the market-style table (FPR/recall/precision/
accuracy + Wilson CIs) across models over IDENTICAL texts.

Usage:
  python score_pilot_local.py --model-dir <onnx-artifacts-or-hf-dir> \
    --ai ../data/candidates/ai_gemini.jsonl ai_anthropic.jsonl ai_openai.jsonl \
    --humans ../data/candidates/{ptso,carolina,wikipedia}.jsonl \
    --output ../data/candidates/scores_<nome>.jsonl [--hf] [--max-length 512]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="JSONL do T3 (id/text/label) — USE O reserved.jsonl: textos que o "
        "cleanfeed nunca treinou; a única base honesta para comparação",
    )
    parser.add_argument("--ai", nargs="+", type=Path, default=[])
    parser.add_argument("--humans", nargs="+", type=Path, default=[])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hf", action="store_true", help="torch/HF em vez de ONNX")
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.dataset is not None:
        rows = read_jsonl(args.dataset)
        if args.limit:
            rows = rows[: args.limit]
        work = [
            {
                "id": r["id"],
                "class": "ai" if r["label"] == 1 else "human",
                "text": r["text"],
                "family": r.get("family", "?"),
            }
            for r in rows
        ]
        ai_count = sum(1 for w in work if w["class"] == "ai")
        print(f"pontuando {len(work)} textos do dataset ({ai_count} ai)")
    else:
        ai_rows = [row for path in args.ai for row in read_jsonl(path)]
        humans_by_id = {
            row["candidateId"]: row
            for path in args.humans
            for row in read_jsonl(path)
        }
        work = [
            {"id": r["candidateId"], "class": "ai", "text": r["text"],
             "family": r["meta"].get("family", "?")}
            for r in ai_rows
        ]
        parents = {r["meta"].get("pairedWith", "") for r in ai_rows} - {""}
        for parent_id in sorted(parents):
            row = humans_by_id.get(parent_id)
            if row is not None:
                work.append({"id": parent_id, "class": "human",
                             "text": row["text"],
                             "family": row["domainSource"]})
        print(
            f"pontuando {len(work)} textos ({len(ai_rows)} ai + "
            f"{len(work) - len(ai_rows)} humanos)"
        )

    if args.hf:
        import torch
        from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(str(args.model_dir))
        # Um checkpoint com cabeça customizada (Desklib) NÃO pode passar pelo
        # AutoModelForSequenceClassification: ele "carrega" com classifier
        # ALEATÓRIO (aviso MISSING) e os scores viram ruído silencioso.
        state_keys: set[str] = set()
        safetensors_path = args.model_dir / "model.safetensors"
        if safetensors_path.exists():
            import safetensors.torch as st_probe

            state_keys = set(st_probe.load_file(str(safetensors_path)).keys())
        needs_custom = any(k.startswith("classifier.") for k in state_keys) and any(
            k.startswith("model.") for k in state_keys
        )
        try:
            if needs_custom:
                raise RuntimeError("cabeça customizada detectada — loader próprio")
            model = AutoModelForSequenceClassification.from_pretrained(
                str(args.model_dir)
            )
            custom_head = None
        except Exception:
            # Desklib v1.01: encoder + mean-pooling + Linear(hidden,1) com
            # sigmoide (arquitetura da model card, carregada SEM
            # trust_remote_code). Os pesos vivem como model.* e classifier.*.
            import safetensors.torch as st

            encoder = AutoModel.from_pretrained(str(args.model_dir))
            state = st.load_file(str(args.model_dir / "model.safetensors"))
            encoder.load_state_dict(
                {
                    k[len("model."):]: v
                    for k, v in state.items()
                    if k.startswith("model.")
                },
                strict=False,
            )
            hidden = encoder.config.hidden_size
            classifier = torch.nn.Linear(hidden, 1)
            classifier.load_state_dict(
                {
                    k[len("classifier."):]: v
                    for k, v in state.items()
                    if k.startswith("classifier.")
                }
            )
            encoder.eval()
            classifier.eval()
            model = encoder
            custom_head = classifier
        model.eval()

        def p_ai(text: str) -> float:
            with torch.no_grad():
                encoding = tokenizer(
                    text, truncation=True, max_length=args.max_length,
                    return_tensors="pt",
                )
                if custom_head is not None:
                    hidden_states = model(**encoding).last_hidden_state
                    mask = encoding["attention_mask"].unsqueeze(-1).float()
                    pooled = (hidden_states * mask).sum(1) / mask.sum(1)
                    return float(torch.sigmoid(custom_head(pooled))[0, 0])
                logits = model(**encoding).logits.float()[0]
                if logits.numel() == 1:
                    return float(torch.sigmoid(logits)[0])
                return float(torch.softmax(logits, dim=-1)[1])
    else:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(str(args.model_dir))
        session = ort.InferenceSession(
            str(args.model_dir / "onnx" / "model_int8.onnx")
        )
        input_names = {i.name for i in session.get_inputs()}

        def p_ai(text: str) -> float:
            encoding = tokenizer(
                text, truncation=True, max_length=args.max_length,
                return_tensors="np",
            )
            feed = {
                name: encoding[name].astype(np.int64)
                for name in ("input_ids", "attention_mask", "token_type_ids")
                if name in input_names and name in encoding
            }
            logits = session.run(None, feed)[0][0]
            exp = np.exp(logits - logits.max())
            return float((exp / exp.sum())[1])

    with args.output.open("w", encoding="utf-8", newline="\n") as out:
        for index, item in enumerate(work, start=1):
            record = {
                "id": item["id"],
                "class": item["class"],
                "family": item["family"],
                "score": p_ai(item["text"]),
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            if index % 50 == 0:
                print(f"  {index}/{len(work)}")
    print(f"ok -> {args.output}")


if __name__ == "__main__":
    main()
