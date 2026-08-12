"""The sealed pre-registration, resolved, PARSED and IDENTIFIED (T4/T5 — the Colab steps).

Both Colab scripts read the same file and the same four values out of it, through this one
module: the resolver admits a copy the operator uploaded by hand, and two copies of the
resolver could disagree about which file is authoritative — which is the failure the
sealed policy exists to prevent.

`json.loads` is not a parse. Every JSON object satisfies it, including the abandoned v3
policy, which declares the discarded backbone and the discarded 340 000 000 ceiling and
would be read here as if it were the sealed one. So the read below is closed over the
fields the lab consumes: it names the field and the path it refuses, and it pins
`policyVersion`.

Naming the fields is still not identity. A copy that carries the sealed `policyVersion`
with a hand-edited seed or ceiling satisfies every field check — measured: a hybrid with
`seeds.publishableCheckpoint: 42` and a 340 000 000 ceiling was accepted, and the seed
guard then compared 42 against 42. So the BYTES are asserted too: the values come out of
the file, and WHICH file is a constant here.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# The tracked pre-registration, READ and never retyped: the backbone, the ceiling and the
# publishable-checkpoint seed are policy, and a copy on this side would be a second
# authority able to disagree with the sealed one. It has to be the LIVE file — its bytes
# are in `EVALUATOR_FILES`, so a value read from anywhere else is a value the evaluator
# digest does not watch.
POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"

# A Colab upload lands in one flat directory, so the sealed file can only sit BESIDE the
# script there. The checkout path above is tried first: inside the repository it is the
# tracked file, and a stray copy next to the script must never shadow it.
COLAB_POLICY_PATH = Path(__file__).resolve().parent / "preregistration-v4.json"

# The identity of the sealed policy, asserted instead of assumed. The flat-layout fallback
# accepts a file nothing in this repository produced, so the version is the one field that
# separates "the sealed pre-registration" from "a JSON document with a backbone in it".
SEALED_POLICY_VERSION = "preregistration-v4-v1"

# The bytes of the sealed pre-registration. `policyVersion` does NOT move when the
# pre-registration is amended, so it cannot separate one amendment from another, and the
# digest is the only thing that can: this literal pins WHICH file the lab may run under.
#
# It is therefore coupled to the tracked file by construction — amending
# `benchmark/preregistration-v4.json` moves this literal, and the lab test that compares
# the two fails until it does. That failure is the point: an amendment reaches the Colab
# steps only when someone writes it here.
SEALED_POLICY_SHA256 = (
    "1b392d3b9cb731c562448eadeab398be4308de820f248a4c9a2e454347a61ae8"
)

# Where the file that governed the run was read from. `tracked` is the checkout; the other
# two are the divergences the flat Colab layout and an explicit path allow, and an artifact
# that does not say which one it ran under cannot be told apart from one run under the
# tracked file.
POLICY_ORIGIN_TRACKED = "tracked"
POLICY_ORIGIN_BESIDE_THE_SCRIPT = "beside-the-script"
POLICY_ORIGIN_EXPLICIT_PATH = "explicit-path"


@dataclass(frozen=True)
class SealedPolicy:
    """The four values the lab reads, plus the identity of the file they came from."""

    path: Path
    sha256: str
    origin: str
    backbone: str
    backbone_bake_off: bool
    publishable_checkpoint_seed: int
    onnx_maximum_int8_bytes: int


def sealed_policy_path(policy_path: Path = POLICY_PATH) -> Path:
    if policy_path.is_file():
        return policy_path
    if policy_path == POLICY_PATH and COLAB_POLICY_PATH.is_file():
        return COLAB_POLICY_PATH
    raise ValueError(
        f"the sealed pre-registration is not at {policy_path} nor at "
        f"{COLAB_POLICY_PATH}: upload benchmark/preregistration-v4.json next to this "
        "script (the backbone, the seed and the export ceiling are policy and are not "
        "retyped here, so there is nothing to fall back to)"
    )


def _at(values: dict, path: Path, *field: str) -> Any:
    dotted = ".".join(field)
    cursor: Any = values
    for key in field:
        if not isinstance(cursor, dict) or key not in cursor:
            raise ValueError(
                f"{path} declares no {dotted}: the sealed pre-registration carries it, "
                f"and a document that does not is not {SEALED_POLICY_VERSION}"
            )
        cursor = cursor[key]
    return cursor


def _string(values: dict, path: Path, *field: str) -> str:
    found = _at(values, path, *field)
    if not isinstance(found, str) or not found:
        raise ValueError(
            f"{path} declares {'.'.join(field)} as {found!r}: a non-empty string is "
            "what the sealed pre-registration carries there"
        )
    return found


def _bool(values: dict, path: Path, *field: str) -> bool:
    found = _at(values, path, *field)
    if not isinstance(found, bool):
        raise ValueError(
            f"{path} declares {'.'.join(field)} as {found!r}: a boolean is what the "
            "sealed pre-registration carries there"
        )
    return found


def _int(values: dict, path: Path, *field: str) -> int:
    found = _at(values, path, *field)
    # `isinstance(True, int)` is true in Python, so a boolean has to be excluded by hand
    # or `backboneBakeOff: true` would read as the seed 1.
    if isinstance(found, bool) or not isinstance(found, int):
        raise ValueError(
            f"{path} declares {'.'.join(field)} as {found!r}: an integer is what the "
            "sealed pre-registration carries there"
        )
    return found


def _policy_origin(path: Path) -> str:
    if path == POLICY_PATH:
        return POLICY_ORIGIN_TRACKED
    if path == COLAB_POLICY_PATH:
        return POLICY_ORIGIN_BESIDE_THE_SCRIPT
    return POLICY_ORIGIN_EXPLICIT_PATH


def assert_bytes_are_the_sealed_policy(path: Path, raw: bytes) -> str:
    """Refuse a policy file whose bytes are not the sealed pre-registration's."""
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SEALED_POLICY_SHA256:
        raise ValueError(
            f"{path} has sha256 {digest}, not the sealed {SEALED_POLICY_SHA256}: "
            "naming the fields is not identity — a copy carrying "
            f"policyVersion {SEALED_POLICY_VERSION!r} with a hand-edited seed or ceiling "
            "satisfies every field check below. Upload benchmark/preregistration-v4.json "
            "itself, byte for byte; a file retyped or pasted through an editor is not it"
        )
    return digest


def read_sealed_policy(policy_path: Path = POLICY_PATH) -> SealedPolicy:
    """Resolve the sealed file and parse the fields the lab consumes, or refuse by name."""
    path = sealed_policy_path(policy_path)
    raw = path.read_bytes()
    try:
        values = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(
            f"{path} does not parse as JSON ({error}): the sealed pre-registration is "
            "the tracked benchmark/preregistration-v4.json, and a truncated upload is "
            "not it"
        ) from error
    if not isinstance(values, dict):
        raise ValueError(
            f"{path} parses as {type(values).__name__} and not as an object: the sealed "
            "pre-registration is a JSON object"
        )
    declared_version = values.get("policyVersion")
    if declared_version != SEALED_POLICY_VERSION:
        raise ValueError(
            f"{path} declares policyVersion {declared_version!r}, not "
            f"{SEALED_POLICY_VERSION!r}: any JSON document satisfies json.loads, "
            "including the abandoned v3 policy, which names the discarded backbone and "
            "the discarded 340000000 ceiling"
        )
    return SealedPolicy(
        path=path,
        sha256=assert_bytes_are_the_sealed_policy(path, raw),
        origin=_policy_origin(path),
        backbone=_string(values, path, "backbone"),
        backbone_bake_off=_bool(values, path, "backboneBakeOff"),
        publishable_checkpoint_seed=_int(
            values, path, "seeds", "publishableCheckpoint"
        ),
        onnx_maximum_int8_bytes=_int(values, path, "onnxMaximumInt8Bytes"),
    )


def policy_receipt(policy: SealedPolicy) -> dict:
    """The identity of the policy this run read, for the artifact's receipt.

    `policyOrigin` is WHERE it was read from, and nothing else: the digest above is what
    says the bytes were the sealed ones. `tracked` is not a claim about a checkout the
    reader cannot see — on Colab there is none — it is the path that resolved.
    """
    return {
        "policyVersion": SEALED_POLICY_VERSION,
        "policyPath": str(policy.path),
        "policySha256": policy.sha256,
        "policyOrigin": policy.origin,
    }


def announce(policy: SealedPolicy) -> str:
    line = (
        f"politica selada: {policy.path} sha256={policy.sha256} "
        f"origem={policy.origin}"
    )
    if policy.origin == POLICY_ORIGIN_BESIDE_THE_SCRIPT:
        line += " (copia AO LADO do script — layout plano do Colab)"
    return line
