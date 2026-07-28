"""Keyed pseudonymisation for the identifiers of PEOPLE in the grouping axes.

Two axes of the v3 schema can carry a person: a Stack Exchange post's
`OwnerUserId` and a B2W review's `reviewer_id`. Both come from a PUBLIC base and
both are still personal data, because "public" describes who may read the bytes
and not whether the bytes single out a human being.

HMAC WITH A SECRET, NEVER A BARE DIGEST, and the reason is measurable rather than
ceremonial: `OwnerUserId="40"` is a small integer. An unkeyed `sha1("40")` is
therefore reversible by enumerating the integers — a rainbow table of the whole
identifier space fits in memory — so a "pseudonymised" corpus published with bare
digests would let anyone re-attach every post to its account. B2W already ships a
sha256-shaped `reviewer_id`, and that changes nothing: a digest of a digest is
still a stable join key against the original column, so the same enumeration works
from the published B2W file itself.

FAIL-CLOSED IS THE POINT. Every entry point raises {@link ClusterKeyringMissing}
when the secret is absent, and there is deliberately NO fallback path to an
unkeyed hash — not behind a flag, not behind an environment variable, not "for
tests". A fallback would be taken exactly when it must not be: on the operator's
machine, at 2am, on the run that produces the corpus that gets published.

THE KEYRING IS C3'S ARTIFACT. Its canonical location is
`benchmark/data/private/cluster-exposure-keyring.v1.json` (gitignored,
private/), and C3 owns minting and rotating it. This module only defines the
INTERFACE C3 has to satisfy:

    {
      "keyringVersion": "v1",
      "secrets": { "person": "<hex, >= 32 bytes>" }
    }

`keyringVersion` travels into the axis report so a corpus records WHICH keyring
pseudonymised it: rotating the secret renumbers every person cluster, which is a
re-partitioning of the corpus and not an implementation detail.

Python stdlib only. Deterministic: same secret + same purpose + same raw value =
same pseudonym, forever, because the split has to be reproducible.
"""

from __future__ import annotations

import hmac
import json
import os
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

# The canonical private keyring, relative to the repository's benchmark/ dir.
# NOT hardcoded as an absolute path: this file is versioned and the tree moves.
CANONICAL_KEYRING = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "private"
    / "cluster-exposure-keyring.v1.json"
)

# Override for an operator who keeps the keyring outside the tree. Reading it here
# rather than at each call site keeps "where does the secret come from" in one
# place.
KEYRING_ENV = "CLEANFEED_CLUSTER_KEYRING"

# The purpose label of the only person-carrying axis pair we have. A purpose is
# NOT decoration: it is mixed into the MAC so that one raw value seen on two axes
# does not produce one pseudonym. A reviewer whose id happens to equal a Stack
# Exchange user id must not join those two rows into one cluster, because they are
# two different people and the collision would be an invented dependence.
PERSON_PURPOSE = "person"

# 32 hex characters = 16 bytes. Below that the secret itself is brute-forceable,
# which would put us back where the bare digest was.
MINIMUM_SECRET_HEX = 32

# How much of the MAC survives into the identifier. 16 hex characters = 64 bits:
# far past any collision concern at corpus scale (10^4 rows), and short enough to
# stay readable in a cluster report.
PSEUDONYM_HEX = 16


class ClusterKeyringMissing(RuntimeError):
    """The secret needed to pseudonymise a person is not available.

    Its own type, so a caller cannot swallow it with the same `except` that
    handles a malformed source row. The correct response is always to abort the
    run: continuing means either dropping the axis (losing the dependence
    structure) or hashing without a key (publishing reversible identifiers), and
    neither is a decision an extractor gets to make silently.
    """


@dataclass(frozen=True)
class ClusterKeyring:
    """The secrets that pseudonymise person identifiers, and nothing else.

    Frozen because a keyring that changes mid-run would silently split one
    person's records into two clusters.
    """

    keyring_version: str
    secrets: dict[str, str]

    def pseudonym(self, purpose: str, raw: str) -> str:
        """`<purpose>_<hmac-sha256(secret, purpose | raw)[:16]>`.

        The purpose is BOTH the key selector and part of the MAC input. Selecting
        the key alone would not be enough: C3 may legitimately issue one secret
        for several purposes (the fixture keyring in the tests does), and then two
        axes sharing a secret would produce the same pseudonym for the same raw
        value. Mixing the purpose in makes the separation a property of the MAC
        rather than of how the keyring happens to be provisioned.

        The separator is `\\x1f` (unit separator) rather than a printable
        character, because it cannot occur in either source identifier — so no
        pair of (purpose, raw) values can be re-parenthesised into another.
        """
        secret = self.secrets.get(purpose)
        if not secret:
            raise ClusterKeyringMissing(
                f"the keyring (version {self.keyring_version!r}) carries no secret "
                f"for the purpose {purpose!r}. Add it to "
                f"{CANONICAL_KEYRING.name} — there is no unkeyed fallback, because "
                "a bare digest of a low-entropy identifier is reversible"
            )
        if len(secret) < MINIMUM_SECRET_HEX:
            raise ClusterKeyringMissing(
                f"the secret for {purpose!r} is {len(secret)} hex characters; at "
                f"least {MINIMUM_SECRET_HEX} are required, or the secret itself is "
                "the weak link"
            )
        if not raw:
            # An empty raw value is not a person, and pseudonymising it would mint
            # one shared "empty person" cluster joining every row that lacked the
            # field. The caller must state `unknown` instead (R6).
            raise ValueError(
                f"refusing to pseudonymise an empty identifier for {purpose!r}: "
                "an absent person is groups.<axis> unknown, not a pseudonym"
            )
        digest = hmac.new(
            bytes.fromhex(secret),
            f"{purpose}\x1f{raw}".encode("utf-8"),
            sha256,
        ).hexdigest()
        return f"{purpose}_{digest[:PSEUDONYM_HEX]}"


def load_cluster_keyring(path: Path | None = None) -> ClusterKeyring:
    """Reads the keyring, or fails closed.

    Resolution order: the explicit argument, then $CLEANFEED_CLUSTER_KEYRING, then
    C3's canonical path. The argument comes first so a test never depends on the
    operator's machine, and the environment variable comes before the canonical
    path so an operator who keeps secrets on a removable volume does not have to
    copy them into the tree.
    """
    candidate = path
    if candidate is None:
        override = os.environ.get(KEYRING_ENV)
        candidate = Path(override) if override else CANONICAL_KEYRING
    if not candidate.exists():
        raise ClusterKeyringMissing(
            f"no cluster-exposure keyring at {candidate}. It is C3's artifact: "
            f"write {CANONICAL_KEYRING} as "
            '{"keyringVersion": "v1", "secrets": {"person": "<hex>"}} or point '
            f"${KEYRING_ENV} at it. The person-carrying axes (Stack Exchange "
            "author, B2W reviewer) cannot be filled without it, and hashing "
            "without a secret is not an option — see this module's docstring"
        )
    try:
        parsed = json.loads(candidate.read_text(encoding="utf-8"))
    except ValueError as error:
        raise ClusterKeyringMissing(
            f"the keyring at {candidate} is not valid JSON: {error}"
        ) from error
    secrets = parsed.get("secrets")
    if not isinstance(secrets, dict) or not secrets:
        raise ClusterKeyringMissing(
            f"the keyring at {candidate} declares no secrets object"
        )
    return ClusterKeyring(
        keyring_version=str(parsed.get("keyringVersion") or "unversioned"),
        secrets={str(k): str(v) for k, v in secrets.items()},
    )


def require_keyring(keyring: ClusterKeyring | None, source: str) -> ClusterKeyring:
    """The guard an extractor whose source carries a person calls FIRST.

    Called before any row is read, deliberately: a run that will not be able to
    fill the author axis must fail on argument handling, not after streaming 780 MB
    and writing half a pool.
    """
    if keyring is None:
        raise ClusterKeyringMissing(
            f"{source} carries a person identifier on a grouping axis, so it "
            "requires the cluster-exposure keyring. Pass --keyring or set "
            f"${KEYRING_ENV}; there is no unkeyed fallback"
        )
    return keyring
