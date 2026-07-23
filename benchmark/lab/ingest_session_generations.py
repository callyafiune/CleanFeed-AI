"""Assembles SESSION-generated (no-API) AI texts into the candidate pipeline.

For the pilot, the Anthropic class can be written by the interactive Claude
session itself instead of the Messages API. The recipe is recorded honestly:
provider/model from the CLI, and `seedNullReason` documents that an interactive
session exposes neither a sampling seed nor a temperature — which is exactly
why the RELEASE corpus regenerates this class through the API later.

Input: one or more JSON files, each an array of {"pairedWith", "text"}.
Everything still passes the shared pipeline (normalize -> word window -> PII
drop), so a generated text that leaks an e-mail or handle is dropped, not fixed.

Usage:
  python ingest_session_generations.py \
    --generated ../data/candidates/_session/gen_*.json \
    --output ../data/candidates/ai_anthropic.jsonl \
    --model claude-fable-5 --prompt-note "sessão interativa; instrução fixa"
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from common import CandidateWriter

LICENSE_ID = "geracao-propria-v1"
SEED_NULL_REASON = (
    "interactive Claude session: sampling seed and temperature are not exposed"
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generated", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--provider", default="anthropic")
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt-note", required=True)
    parser.add_argument("--mode", default="interactive-session")
    parser.add_argument("--recipe", default="original")
    args = parser.parse_args()

    prompt_digest = hashlib.sha256(args.prompt_note.encode("utf-8")).hexdigest()
    done: set[str] = set()
    if args.output.exists():
        with args.output.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    done.add(json.loads(line)["meta"].get("pairedWith", ""))

    writer = CandidateWriter(
        args.output,
        source_id=f"src_ai_{args.provider}",
        limit=10**9,
        sample_rate=1,
        date_cutoff=None,
        append=True,
        start_sequence=len(done),
    )
    generated_at = datetime.now(timezone.utc)
    try:
        for path in args.generated:
            for item in json.loads(path.read_text(encoding="utf-8")):
                paired = item["pairedWith"]
                if paired in done:
                    continue
                done.add(paired)
                writer.offer(
                    natural_key=f"ai:{args.provider}:{paired}",
                    license_id=LICENSE_ID,
                    created_at=generated_at,
                    raw_text=item["text"],
                    domain_source=f"ai_{args.provider}",
                    meta={
                        "provider": args.provider,
                        "family": args.model,
                        "model": args.model,
                        "version": args.model,
                        "temperature": "",
                        "seed": "",
                        "seedNullReason": SEED_NULL_REASON,
                        "promptId": f"pair_{paired}",
                        "promptSha256": prompt_digest,
                        "promptTemplateDigest": prompt_digest,
                        "generatedAt": generated_at.isoformat(),
                        "pairedWith": paired,
                        "generationMode": args.mode,
                        "recipe": args.recipe,
                    },
                )
    finally:
        writer.close()
    print(
        f"session/{args.model}: kept={writer.stats.kept} "
        f"pii_dropped={writer.stats.drop_pii} words_dropped={writer.stats.drop_words}"
    )


if __name__ == "__main__":
    main()
