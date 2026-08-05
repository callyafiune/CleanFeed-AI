"""Fine-tunes the cleanfeed-ptbr-v1 candidate detector (T4 — Colab bench).

Binary sequence classification ({human: 0, ai: 1} — the runtime manifest's
label contract) over the T3 dataset. Designed for a Colab T4 (fp16) but runs a
CPU --smoke locally to validate the pipeline end-to-end before burning GPU
time. Class imbalance is handled with inverse-frequency loss weights; the
iteration metric is the PRODUCT metric (FPR at recall >= 0.6), not accuracy.

Usage (one base model, one seed — both frozen by the pre-registration):
  python train_detector.py --train ../data/dataset/train.jsonl \
    --dev ../data/dataset/dev.jsonl --outdir ../data/checkpoints/bertimbau

On Colab, upload benchmark/preregistration-v4.json next to this script: the backbone and
the seed are READ from it, and without it the script refuses before the argparse.

Deps (Colab): pip install torch transformers scikit-learn
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

# The frozen pre-registration, READ and never retyped: the backbone and the
# publishable-checkpoint seed are policy, and a copy on this side would be a second
# authority able to disagree with the sealed one. It has to be the LIVE file — its
# bytes are in EVALUATOR_FILES, so a value read from anywhere else is a value the
# evaluator digest does not watch.
POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"

# A Colab upload lands in one flat directory, so the sealed file can only sit BESIDE the
# script there. The checkout path above is tried first: inside the repository it is the
# tracked file whose bytes `EVALUATOR_FILES` watches, and a stray copy next to the script
# must never shadow it.
COLAB_POLICY_PATH = Path(__file__).resolve().parent / "preregistration-v4.json"


def sealed_policy_path(policy_path: Path = POLICY_PATH) -> Path:
    if policy_path.is_file():
        return policy_path
    if policy_path == POLICY_PATH and COLAB_POLICY_PATH.is_file():
        return COLAB_POLICY_PATH
    raise ValueError(
        f"the sealed pre-registration is not at {policy_path} nor at "
        f"{COLAB_POLICY_PATH}: upload benchmark/preregistration-v4.json next to this "
        "script (the backbone and the seed are policy and are not retyped here, so "
        "there is nothing to fall back to)"
    )


def sealed_policy(policy_path: Path = POLICY_PATH) -> dict:
    return json.loads(sealed_policy_path(policy_path).read_text(encoding="utf-8"))


def assert_model_is_the_sealed_backbone(
    model: str, policy_path: Path = POLICY_PATH
) -> str:
    """Refuse any base model other than the pre-registered one.

    `backboneBakeOff: false` is the decision this enforces. A second base model is not
    an extra run: the checkpoint it produces is eligible for the same export gate and
    the same certifying measurement, and picking between two of them after seeing dev
    is the selection the pre-registration exists to forbid.
    """
    policy = sealed_policy(policy_path)
    sealed = str(policy["backbone"])
    if bool(policy["backboneBakeOff"]):
        raise ValueError(
            "backboneBakeOff is true in the sealed pre-registration: this script "
            "refuses one base model at a time and cannot arbitrate a bake-off"
        )
    if model != sealed:
        raise ValueError(
            f"--model {model!r} is not the sealed backbone {sealed!r} "
            f"({policy_path.name}, backbone, backboneBakeOff false): the v3 runs no "
            "bake-off, and a checkpoint from another base model is not the artifact "
            "the export ceiling and the certifying measurement were frozen for"
        )
    return sealed


def assert_seed_is_the_publishable_one(
    seed: int, policy_path: Path = POLICY_PATH
) -> int:
    """Refuse any seed other than `seeds.publishableCheckpoint`.

    A second seed is a second draw, and choosing the better of two draws is selection
    on the dev metric with no correction for it. A retry after a technical failure
    reruns THIS seed.
    """
    sealed = int(sealed_policy(policy_path)["seeds"]["publishableCheckpoint"])
    if seed != sealed:
        raise ValueError(
            f"--seed {seed} is not the pre-registered publishable-checkpoint seed "
            f"{sealed} ({policy_path.name}, seeds.publishableCheckpoint): a second "
            "seed is a second draw, and the release publishes one"
        )
    return sealed


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
    policy = sealed_policy()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--dev", required=True, type=Path)
    parser.add_argument("--model", default=policy["backbone"])
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument(
        "--seed", type=int, default=int(policy["seeds"]["publishableCheckpoint"])
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="tiny CPU run (400 train / 200 dev, 1 epoch, max-length 128) to "
        "validate the pipeline before Colab",
    )
    args = parser.parse_args()
    assert_model_is_the_sealed_backbone(args.model)
    assert_seed_is_the_publishable_one(args.seed)

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
