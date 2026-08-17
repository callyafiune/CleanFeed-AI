"""Fine-tunes the cleanfeed-ptbr-v1 candidate detector (T4 — Colab bench).

Binary sequence classification ({human: 0, ai: 1} — the runtime manifest's
label contract) over the T3 dataset. Designed for a Colab T4 (fp16) but runs a
CPU --smoke locally to validate the pipeline end-to-end before burning GPU
time. Class imbalance is handled with inverse-frequency loss weights; the
iteration metric is the PRODUCT metric (FPR at recall >= 0.6), not accuracy.

Usage (one base model, one seed — both frozen by the pre-registration):
  python train_detector.py --train ../data/dataset/train.jsonl \
    --dev ../data/dataset/dev.jsonl --outdir ../data/checkpoints/bertimbau

On Colab, upload sealed_policy.py AND benchmark/preregistration-v4.json next to this
script: the backbone and the seed are READ and PARSED from the policy, and without it the
script refuses before the argparse.

Deps (Colab): pip install torch transformers scikit-learn
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from sealed_policy import POLICY_PATH, SealedPolicy, announce, policy_receipt
from sealed_policy import read_sealed_policy as sealed_policy

# The label contract the runtime reads and `scripts/package-own-model.mjs` stamps into the
# served config: index 1 is P(ai) everywhere downstream. Written into the checkpoint here
# so the exported config declares the order instead of leaving `num_labels=2`'s anonymous
# `LABEL_0`/`LABEL_1` for the packaging step to overwrite with a claim.
ID_TO_LABEL = {0: "human", 1: "ai"}
LABEL_TO_ID = {"human": 0, "ai": 1}


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
    sealed = policy.backbone
    if policy.backbone_bake_off:
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


def the_sealed_backbone_or_refuse(
    requested: str | None, policy_path: Path = POLICY_PATH
) -> str:
    """`--model` absent DELEGATES to the policy; `--model` present is compared against it.

    The argparse default cannot be read out of the policy object: a default taken from the
    same object the guard reads makes the guard compare a value against itself, and the run
    then reports "the sealed backbone" for whatever that file happened to declare.
    """
    if requested is None:
        sealed = sealed_policy(policy_path).backbone
        print(f"--model ausente: DELEGADO ao backbone selado {sealed} (nao conferido)")
        return sealed
    return assert_model_is_the_sealed_backbone(requested, policy_path)


def the_publishable_seed_or_refuse(
    requested: int | None, policy_path: Path = POLICY_PATH
) -> int:
    """`--seed` absent delegates to the policy; `--seed` present is compared against it."""
    if requested is None:
        sealed = sealed_policy(policy_path).publishable_checkpoint_seed
        print(f"--seed ausente: DELEGADO a seed selada {sealed} (nao conferida)")
        return sealed
    return assert_seed_is_the_publishable_one(requested, policy_path)


def assert_seed_is_the_publishable_one(
    seed: int, policy_path: Path = POLICY_PATH
) -> int:
    """Refuse any seed other than `seeds.publishableCheckpoint`.

    A second seed is a second draw, and choosing the better of two draws is selection
    on the dev metric with no correction for it. A retry after a technical failure
    reruns THIS seed.
    """
    sealed = sealed_policy(policy_path).publishable_checkpoint_seed
    if seed != sealed:
        raise ValueError(
            f"--seed {seed} is not the pre-registered publishable-checkpoint seed "
            f"{sealed} ({policy_path.name}, seeds.publishableCheckpoint): a second "
            "seed is a second draw, and the release publishes one"
        )
    return sealed


def training_receipt(
    model: str, seed: int, epoch: int, metrics: dict, policy: SealedPolicy
) -> dict:
    """What `metrics.json` records about the run, beyond the dev numbers.

    The seed and the identity of the policy file are facts about the RUN, and without them
    a receipt produced under a hand-edited copy of the policy — which the flat Colab
    layout admits by design — is indistinguishable from one produced under the tracked
    file. This is not the F6 receipt: it does not tie the weights to the dataset or to
    the split.
    """
    return {
        "model": model,
        "seed": seed,
        "epoch": epoch,
        **metrics,
        **policy_receipt(policy),
    }


def sealed_head_kwargs() -> dict:
    """The head `from_pretrained` is asked to build: two classes AND the named order.

    `num_labels=2` alone saves the anonymous `LABEL_0`/`LABEL_1` pair, which export_onnx.py
    refuses: the order is what the runtime reads as P(ai), and a checkpoint that declares
    only the count leaves it to the packaging step to stamp a claim over.
    """
    return {"num_labels": 2, "id2label": ID_TO_LABEL, "label2id": LABEL_TO_ID}


def write_metrics(outdir: Path, receipt: dict) -> Path:
    """Write `metrics.json`, and refuse to write a receipt JSON cannot carry.

    `json.dumps` runs before the file is opened, so a value it cannot serialize — the
    LOADED torch model, when the receipt is handed the rebound name instead of the backbone
    string — raises instead of leaving a truncated receipt beside the saved weights.
    """
    path = outdir / "metrics.json"
    serialized = json.dumps(receipt, indent=2) + "\n"
    path.write_text(serialized, encoding="utf-8")
    return path


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--dev", required=True, type=Path)
    parser.add_argument("--model", default=None)
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="tiny CPU run (400 train / 200 dev, 1 epoch, max-length 128) to "
        "validate the pipeline before Colab",
    )
    return parser


def main() -> None:
    policy = sealed_policy()
    args = build_parser().parse_args()
    print(announce(policy))
    backbone = the_sealed_backbone_or_refuse(args.model)
    seed = the_publishable_seed_or_refuse(args.seed)

    import numpy as np
    import torch
    from sklearn.metrics import roc_auc_score
    from torch.utils.data import DataLoader, Dataset
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        get_linear_schedule_with_warmup,
    )

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    train_rows = read_jsonl(args.train)
    dev_rows = read_jsonl(args.dev)
    if args.smoke:
        random.Random(seed).shuffle(train_rows)
        random.Random(seed + 1).shuffle(dev_rows)
        train_rows = train_rows[:400]
        dev_rows = dev_rows[:200]
        args.epochs = 1
        args.max_length = 128
    print(f"train={len(train_rows)} dev={len(dev_rows)} model={backbone}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(backbone)
    # A separate name from `backbone`: the receipt below records the backbone STRING, and a
    # rebind here would hand `json.dumps` the loaded module instead.
    detector = AutoModelForSequenceClassification.from_pretrained(
        backbone, **sealed_head_kwargs()
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
    optimizer = torch.optim.AdamW(detector.parameters(), lr=args.lr, weight_decay=0.01)
    total_steps = len(loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer, int(total_steps * 0.06), total_steps
    )
    scaler = torch.cuda.amp.GradScaler(enabled=device == "cuda")

    def evaluate() -> dict:
        detector.eval()
        scores: list[float] = []
        labels: list[int] = []
        with torch.no_grad():
            for encoding, batch_labels in dev_loader:
                encoding = {k: v.to(device) for k, v in encoding.items()}
                logits = detector(**encoding).logits
                probs = torch.softmax(logits.float(), dim=-1)[:, 1]
                scores.extend(probs.cpu().tolist())
                labels.extend(batch_labels.tolist())
        auc = roc_auc_score(labels, scores) if len(set(labels)) > 1 else float("nan")
        fpr, threshold = fpr_at_recall(labels, scores, 0.6)
        return {"auc": auc, "fpr_at_recall60": fpr, "threshold": threshold}

    best_auc = -1.0
    args.outdir.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.epochs + 1):
        detector.train()
        running = 0.0
        for step, (encoding, batch_labels) in enumerate(loader, start=1):
            encoding = {k: v.to(device) for k, v in encoding.items()}
            batch_labels = batch_labels.to(device)
            optimizer.zero_grad()
            with torch.autocast(device_type=device, enabled=device == "cuda"):
                logits = detector(**encoding).logits
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
            detector.save_pretrained(args.outdir / "best")
            tokenizer.save_pretrained(args.outdir / "best")
            write_metrics(
                args.outdir,
                training_receipt(backbone, seed, epoch, metrics, policy),
            )
    print(f"melhor AUC dev: {best_auc:.4f} -> {args.outdir / 'best'}")


if __name__ == "__main__":
    main()
