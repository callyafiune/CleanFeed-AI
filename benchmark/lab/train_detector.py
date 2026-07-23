"""Fine-tunes the cleanfeed-ptbr-v1 candidate detector (T4 — Colab bench).

Binary sequence classification ({human: 0, ai: 1} — the runtime manifest's
label contract) over the T3 dataset. Designed for a Colab T4 (fp16) but runs a
CPU --smoke locally to validate the pipeline end-to-end before burning GPU
time. Class imbalance is handled with inverse-frequency loss weights; the
iteration metric is the PRODUCT metric (FPR at recall >= 0.6), not accuracy.

Bake-off usage (run once per base model):
  python train_detector.py --train ../data/dataset/train.jsonl \
    --dev ../data/dataset/dev.jsonl --model neuralmind/bert-base-portuguese-cased \
    --outdir ../data/checkpoints/bertimbau
  python train_detector.py ... --model xlm-roberta-base --outdir .../xlmr

Deps (Colab): pip install torch transformers scikit-learn
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def fpr_at_recall(labels, scores, min_recall: float = 0.6) -> tuple[float, float]:
    """Smallest FPR achievable with recall >= min_recall; returns (fpr, threshold)."""
    pairs = sorted(zip(scores, labels), reverse=True)
    positives = sum(labels)
    negatives = len(labels) - positives
    best = (1.0, 1.0)
    tp = fp = 0
    for score, label in pairs:
        if label == 1:
            tp += 1
        else:
            fp += 1
        recall = tp / positives if positives else 0.0
        fpr = fp / negatives if negatives else 1.0
        if recall >= min_recall and fpr < best[0]:
            best = (fpr, score)
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--dev", required=True, type=Path)
    parser.add_argument("--model", default="neuralmind/bert-base-portuguese-cased")
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="tiny CPU run (400 train / 200 dev, 1 epoch, max-length 128) to "
        "validate the pipeline before Colab",
    )
    args = parser.parse_args()

    import numpy as np
    import torch
    from sklearn.metrics import roc_auc_score
    from torch.utils.data import DataLoader, Dataset
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        get_linear_schedule_with_warmup,
    )

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    train_rows = read_jsonl(args.train)
    dev_rows = read_jsonl(args.dev)
    if args.smoke:
        random.Random(args.seed).shuffle(train_rows)
        random.Random(args.seed + 1).shuffle(dev_rows)
        train_rows = train_rows[:400]
        dev_rows = dev_rows[:200]
        args.epochs = 1
        args.max_length = 128
    print(f"train={len(train_rows)} dev={len(dev_rows)} model={args.model}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model, num_labels=2
    ).to(device)

    class Rows(Dataset):
        def __init__(self, rows: list[dict]):
            self.rows = rows

        def __len__(self) -> int:
            return len(self.rows)

        def __getitem__(self, index: int) -> dict:
            row = self.rows[index]
            return {"text": row["text"], "label": row["label"]}

    def collate(batch: list[dict]):
        encoding = tokenizer(
            [item["text"] for item in batch],
            truncation=True,
            max_length=args.max_length,
            padding=True,
            return_tensors="pt",
        )
        labels = torch.tensor([item["label"] for item in batch])
        return encoding, labels

    counts = [0, 0]
    for row in train_rows:
        counts[row["label"]] += 1
    weights = torch.tensor(
        [len(train_rows) / (2 * max(c, 1)) for c in counts], dtype=torch.float
    ).to(device)
    print(f"class counts human/ai = {counts} -> loss weights {weights.tolist()}")
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)

    loader = DataLoader(
        Rows(train_rows), batch_size=args.batch, shuffle=True, collate_fn=collate
    )
    dev_loader = DataLoader(
        Rows(dev_rows), batch_size=args.batch * 2, shuffle=False, collate_fn=collate
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total_steps = len(loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer, int(total_steps * 0.06), total_steps
    )
    scaler = torch.cuda.amp.GradScaler(enabled=device == "cuda")

    def evaluate() -> dict:
        model.eval()
        scores: list[float] = []
        labels: list[int] = []
        with torch.no_grad():
            for encoding, batch_labels in dev_loader:
                encoding = {k: v.to(device) for k, v in encoding.items()}
                logits = model(**encoding).logits
                probs = torch.softmax(logits.float(), dim=-1)[:, 1]
                scores.extend(probs.cpu().tolist())
                labels.extend(batch_labels.tolist())
        auc = roc_auc_score(labels, scores) if len(set(labels)) > 1 else float("nan")
        fpr, threshold = fpr_at_recall(labels, scores, 0.6)
        return {"auc": auc, "fpr_at_recall60": fpr, "threshold": threshold}

    best_auc = -1.0
    args.outdir.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        for step, (encoding, batch_labels) in enumerate(loader, start=1):
            encoding = {k: v.to(device) for k, v in encoding.items()}
            batch_labels = batch_labels.to(device)
            optimizer.zero_grad()
            with torch.autocast(device_type=device, enabled=device == "cuda"):
                logits = model(**encoding).logits
                loss = loss_fn(logits, batch_labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            running += loss.item()
            if step % 100 == 0:
                print(f"  epoch {epoch} step {step}/{len(loader)} loss={running / step:.4f}")
        metrics = evaluate()
        print(f"epoch {epoch}: {json.dumps(metrics)}")
        if metrics["auc"] > best_auc:
            best_auc = metrics["auc"]
            model.save_pretrained(args.outdir / "best")
            tokenizer.save_pretrained(args.outdir / "best")
            (args.outdir / "metrics.json").write_text(
                json.dumps({"model": args.model, "epoch": epoch, **metrics}, indent=2)
                + "\n",
                encoding="utf-8",
            )
    print(f"melhor AUC dev: {best_auc:.4f} -> {args.outdir / 'best'}")


if __name__ == "__main__":
    main()
