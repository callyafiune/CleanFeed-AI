"""The training and export scripts read the sealed backbone instead of trusting a flag.

Both guards refuse rather than warn, and both name the sealed value in the message:
the failure they exist for is a checkpoint or an artifact that looks legitimate — it
trains, it exports, it passes the parity gate — while being a different model from the
one the pre-registration froze.

The sharpest case is a checkpoint that is legitimate in shape and empty in content: a
two-class head that was never trained scores every text alike, which is the state that
MAXIMIZES the parity gate. So the guards here are about the head, the vocabulary and the
publication order, not only about the encoder's dimensions.
"""

from __future__ import annotations

import contextlib
import hashlib
import inspect
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import export_onnx
import sealed_policy
import train_detector

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"
SEALED = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
SEALED_BACKBONE = SEALED["backbone"]
SEALED_SEED = SEALED["seeds"]["publishableCheckpoint"]
SEALED_CEILING = SEALED["onnxMaximumInt8Bytes"]
SEALED_SHAPE = export_onnx.BACKBONE_CONFIG_SHAPE[SEALED_BACKBONE]
SEALED_VOCABULARY = SEALED_SHAPE["vocab_size"]

# The candidate the divergence D17 pinned by reading an example line, and the ceiling
# raised to accommodate it. Spelled here because a guard is only checkable against the
# value it has to refuse.
DISCARDED_BACKBONE = "xlm-roberta-base"
DISCARDED_CEILING = 340_000_000

# The witness the repository TRACKS by digest: `public/models/cleanfeed-ptbr-v1/` is not
# in git, but the sha256 of every file in it is, in both tracked descriptors. These two
# literals are what makes the shape above non-circular — if the bundle is ever repacked,
# the descriptors move, the assertion below fails, and the shape has to be re-derived from
# the new witness instead of quietly staying whatever the exporter's own dict says.
WITNESS_BUNDLE = REPO_ROOT / "public" / "models" / "cleanfeed-ptbr-v1"
WITNESS_CONFIG_SHA256 = (
    "06d604123f03f6eb6d51149f5b00c42df7d94824425ad9bbbeed08f4b55c67cd"
)
WITNESS_VOCABULARY_SHA256 = (
    "69c28584c67a0e5018f85ca734aa272cc38e26b5dd0d33fffa28059299f21707"
)


def write_policy(directory: Path, **overrides) -> Path:
    policy = dict(SEALED)
    policy.update(overrides)
    path = directory / "preregistration-v4.json"
    path.write_bytes((json.dumps(policy, indent=2) + "\n").encode("utf-8"))
    return path


@contextlib.contextmanager
def standing_in_for_the_sealed_policy(path: Path):
    """Let a variant policy through the digest assertion, and say so where it happens.

    The digest is what keeps a hand-edited copy out (`ClosedPolicyParse` below measures the
    hybrid it refuses), so a test that needs a different ceiling declares that its file is
    STANDING IN for the sealed one. Re-serializing the sealed values does not reproduce the
    tracked bytes — measured — so every variant needs this.
    """
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with mock.patch.object(sealed_policy, "SEALED_POLICY_SHA256", digest):
        yield path


@contextlib.contextmanager
def variant_policy(directory: Path, **overrides):
    with standing_in_for_the_sealed_policy(write_policy(directory, **overrides)) as path:
        yield path


def hybrid_policy_values() -> dict:
    """The copy the consolidated review named: sealed version, edited seed and ceiling."""
    values = dict(SEALED)
    values["seeds"] = {**SEALED["seeds"], "publishableCheckpoint": 42}
    values["onnxMaximumInt8Bytes"] = DISCARDED_CEILING
    return values


def write_eval(path: Path, rows: list[dict]) -> Path:
    path.write_bytes(
        ("".join(json.dumps(row) + "\n" for row in rows)).encode("utf-8")
    )
    return path


def both_classes(count: int = 2) -> list[dict]:
    return [
        {"text": f"documento {index}", "label": index % 2} for index in range(count)
    ]


def write_vocabulary(directory: Path, entries: int) -> Path:
    path = directory / "vocab.txt"
    tokens = [f"tok{index}" for index in range(entries)]
    path.write_bytes(("\n".join(tokens) + "\n").encode("utf-8"))
    return path


def write_checkpoint(
    directory: Path,
    model_type: str | None,
    *,
    vocabulary: int | None = SEALED_VOCABULARY,
    drop: tuple[str, ...] = (),
    **overrides,
) -> Path:
    """A checkpoint directory as `save_pretrained` leaves it, minus the weights.

    It carries the head declaration and the vocabulary FILE, because a directory holding
    only a `config.json` is not a checkpoint and accepting one as "the sealed
    architecture" is how a guard that reads four numbers passes for a guard that
    identifies a model.
    """
    checkpoint = directory / "best"
    checkpoint.mkdir(parents=True, exist_ok=True)
    config: dict = {
        "architectures": [export_onnx.SEQUENCE_CLASSIFICATION_ARCHITECTURE],
        "num_labels": 2,
        "id2label": dict(export_onnx.BINARY_LABEL_CONTRACT),
        **{
            field: value
            for field, value in SEALED_SHAPE.items()
            if field != "model_type"
        },
    }
    if model_type is not None:
        config["model_type"] = model_type
    config.update(overrides)
    for field in drop:
        config.pop(field, None)
    (checkpoint / "config.json").write_bytes(
        (json.dumps(config, indent=2) + "\n").encode("utf-8")
    )
    if vocabulary is not None:
        write_vocabulary(checkpoint, vocabulary)
    return checkpoint


class SealedPolicyValues(unittest.TestCase):
    def test_the_policy_seals_bertimbau_without_a_bake_off(self) -> None:
        self.assertEqual(SEALED_BACKBONE, "neuralmind/bert-base-portuguese-cased")
        self.assertFalse(SEALED["backboneBakeOff"])
        self.assertEqual(SEALED_SEED, 712019)
        # The ceiling is pinned as a literal on this side too, not only by the range
        # below: the TS parser freezes the value, and a lab that only checked an
        # inequality would accept anything between the measured export and the fp32 sum.
        self.assertEqual(SEALED_CEILING, 130_000_000)

    def test_both_scripts_read_the_live_policy_file(self) -> None:
        # Not a copy under the lab: the bytes of this file are in EVALUATOR_FILES, so a
        # local mirror would be an authority the evaluator digest does not watch.
        self.assertEqual(train_detector.POLICY_PATH, POLICY_PATH)
        self.assertEqual(export_onnx.POLICY_PATH, POLICY_PATH)

    def test_both_scripts_read_it_through_the_same_parser(self) -> None:
        # One reader, not two: the two scripts held copies of the resolver, and two
        # copies can disagree about which file is authoritative.
        self.assertIs(train_detector.sealed_policy, sealed_policy.read_sealed_policy)
        self.assertIs(export_onnx.sealed_policy, sealed_policy.read_sealed_policy)

    def test_neither_script_falls_back_when_the_policy_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            absent = Path(tmp) / "preregistration-v4.json"
            for module in (train_detector, export_onnx):
                with self.assertRaises(ValueError) as caught:
                    module.sealed_policy(absent)
                message = str(caught.exception)
                self.assertIn("preregistration-v4.json", message)
                self.assertIn("upload", message)
                self.assertIn("nothing to fall back to", message)

    def test_the_colab_layout_finds_the_policy_beside_the_script(self) -> None:
        # Colab uploads land flat, so the sealed file cannot be one directory up there.
        with tempfile.TemporaryDirectory() as tmp:
            beside = write_policy(Path(tmp))
            absent = Path(tmp) / "elsewhere" / "preregistration-v4.json"
            with mock.patch.object(sealed_policy, "POLICY_PATH", absent):
                with mock.patch.object(sealed_policy, "COLAB_POLICY_PATH", beside):
                    self.assertEqual(sealed_policy.sealed_policy_path(absent), beside)
                    # A path a caller passed explicitly is never redirected: only the
                    # module default may fall back to the flat layout.
                    with self.assertRaises(ValueError):
                        sealed_policy.sealed_policy_path(
                            Path(tmp) / "another" / "policy.json"
                        )


class ClosedPolicyParse(unittest.TestCase):
    """`json.loads` is not a parse: every JSON object satisfies it."""

    def test_the_sealed_file_parses_into_the_four_values_and_its_own_digest(
        self,
    ) -> None:
        policy = sealed_policy.read_sealed_policy()
        self.assertEqual(policy.path, POLICY_PATH)
        self.assertEqual(policy.backbone, SEALED_BACKBONE)
        self.assertFalse(policy.backbone_bake_off)
        self.assertEqual(policy.publishable_checkpoint_seed, SEALED_SEED)
        self.assertEqual(policy.onnx_maximum_int8_bytes, SEALED_CEILING)
        self.assertEqual(policy.origin, sealed_policy.POLICY_ORIGIN_TRACKED)
        self.assertEqual(
            policy.sha256, hashlib.sha256(POLICY_PATH.read_bytes()).hexdigest()
        )

    def test_the_pinned_digest_is_the_tracked_files(self) -> None:
        # `policyVersion` does NOT move when the pre-registration is amended, so the digest
        # is the only literal that can pin WHICH file the Colab steps may run under. This
        # assertion is the cost: an amendment fails here until someone writes it there.
        self.assertEqual(
            sealed_policy.SEALED_POLICY_SHA256,
            hashlib.sha256(POLICY_PATH.read_bytes()).hexdigest(),
            "benchmark/preregistration-v4.json moved: rewrite SEALED_POLICY_SHA256 in "
            "benchmark/lab/sealed_policy.py in the same commit",
        )

    def test_it_refuses_the_hybrid_copy_the_review_measured(self) -> None:
        # The copy the consolidated review named: the sealed `policyVersion` with
        # `seeds.publishableCheckpoint: 42` and the discarded 340 000 000 ceiling. Every
        # field check accepts it — that is asserted first, so this test fails if the digest
        # is the only thing standing between the lab and a hand-edited policy.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preregistration-v4.json"
            path.write_bytes(
                (json.dumps(hybrid_policy_values(), indent=2) + "\n").encode("utf-8")
            )
            with standing_in_for_the_sealed_policy(path):
                accepted = sealed_policy.read_sealed_policy(path)
                self.assertEqual(accepted.backbone, SEALED_BACKBONE)
                self.assertEqual(accepted.publishable_checkpoint_seed, 42)
                self.assertEqual(accepted.onnx_maximum_int8_bytes, DISCARDED_CEILING)
            with self.assertRaises(ValueError) as caught:
                sealed_policy.read_sealed_policy(path)
            message = str(caught.exception)
            self.assertIn(str(path), message)
            self.assertIn(sealed_policy.SEALED_POLICY_SHA256, message)
            self.assertIn(hashlib.sha256(path.read_bytes()).hexdigest(), message)
            self.assertIn("byte for byte", message)

    def test_it_refuses_a_reserialized_copy_of_the_sealed_values(self) -> None:
        # Measured: `json.dumps(json.loads(sealed), indent=2)` is 11 956 bytes against the
        # tracked 11 742, so a policy retyped or reformatted on the way to Colab carries the
        # sealed values and different bytes.
        with tempfile.TemporaryDirectory() as tmp:
            path = write_policy(Path(tmp))
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                json.loads(POLICY_PATH.read_text(encoding="utf-8")),
            )
            with self.assertRaises(ValueError) as caught:
                sealed_policy.read_sealed_policy(path)
        self.assertIn(sealed_policy.SEALED_POLICY_SHA256, str(caught.exception))

    def test_it_refuses_the_abandoned_v3_policy_that_is_in_the_tree(self) -> None:
        # Not hypothetical: `benchmark/rebuild-v3-policy.json` is a JSON document with a
        # `backbone` and an `onnxMaximumInt8Bytes` in it, so the previous reader accepted
        # it as sealed. It declares the 109681931 ceiling of the anchoring export.
        abandoned = POLICY_PATH.parent / "rebuild-v3-policy.json"
        with self.assertRaises(ValueError) as caught:
            sealed_policy.read_sealed_policy(abandoned)
        message = str(caught.exception)
        self.assertIn("policyVersion", message)
        self.assertIn("rebuild-v3-policy-v1", message)
        self.assertIn(sealed_policy.SEALED_POLICY_VERSION, message)

    def test_it_refuses_any_other_json_object(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preregistration-v4.json"
            path.write_bytes(b'{"backbone": "neuralmind/bert-base-portuguese-cased"}\n')
            with self.assertRaises(ValueError) as caught:
                sealed_policy.read_sealed_policy(path)
        self.assertIn("policyVersion", str(caught.exception))

    def test_it_refuses_a_truncated_upload_naming_the_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preregistration-v4.json"
            path.write_bytes(b'{"policyVersion": "preregistration-v4-v1", "back')
            with self.assertRaises(ValueError) as caught:
                sealed_policy.read_sealed_policy(path)
        message = str(caught.exception)
        self.assertIn(str(path), message)
        self.assertIn("does not parse as JSON", message)

    def test_it_refuses_a_json_array(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preregistration-v4.json"
            path.write_bytes(b"[]\n")
            with self.assertRaises(ValueError) as caught:
                sealed_policy.read_sealed_policy(path)
        self.assertIn("parses as list", str(caught.exception))

    def test_it_refuses_a_missing_nested_field_by_its_dotted_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), seeds={"split": 1}) as path:
                with self.assertRaises(ValueError) as caught:
                    sealed_policy.read_sealed_policy(path)
        self.assertIn("seeds.publishableCheckpoint", str(caught.exception))

    def test_it_refuses_the_bake_off_flag_as_a_string(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), backboneBakeOff="false") as path:
                with self.assertRaises(ValueError) as caught:
                    sealed_policy.read_sealed_policy(path)
        message = str(caught.exception)
        self.assertIn("backboneBakeOff", message)
        self.assertIn("boolean", message)

    def test_it_refuses_a_boolean_where_an_integer_is_sealed(self) -> None:
        # `isinstance(True, int)` is true in Python, so a boolean ceiling would read as 1
        # and refuse every artifact above one byte.
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), onnxMaximumInt8Bytes=True) as path:
                with self.assertRaises(ValueError) as caught:
                    sealed_policy.read_sealed_policy(path)
        message = str(caught.exception)
        self.assertIn("onnxMaximumInt8Bytes", message)
        self.assertIn("integer", message)

    def test_the_receipt_records_where_the_file_that_governed_the_run_came_from(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            beside = write_policy(Path(tmp))
            absent = Path(tmp) / "elsewhere" / "preregistration-v4.json"
            with standing_in_for_the_sealed_policy(beside):
                with mock.patch.object(sealed_policy, "POLICY_PATH", absent):
                    with mock.patch.object(sealed_policy, "COLAB_POLICY_PATH", beside):
                        policy = sealed_policy.read_sealed_policy(absent)
            self.assertEqual(
                policy.origin, sealed_policy.POLICY_ORIGIN_BESIDE_THE_SCRIPT
            )
            receipt = sealed_policy.policy_receipt(policy)
            self.assertEqual(receipt["policyPath"], str(beside))
            self.assertEqual(
                receipt["policyOrigin"], sealed_policy.POLICY_ORIGIN_BESIDE_THE_SCRIPT
            )
            self.assertEqual(
                receipt["policySha256"], hashlib.sha256(beside.read_bytes()).hexdigest()
            )
            self.assertIn("AO LADO", sealed_policy.announce(policy))

        tracked = sealed_policy.read_sealed_policy()
        self.assertEqual(
            sealed_policy.policy_receipt(tracked)["policyOrigin"],
            sealed_policy.POLICY_ORIGIN_TRACKED,
        )
        self.assertNotIn("AO LADO", sealed_policy.announce(tracked))

    def test_a_path_a_caller_passed_is_recorded_as_neither_of_the_two(self) -> None:
        # `policyOrigin` says WHERE the file was read from and nothing more: the digest is
        # what says the bytes were the sealed ones. A run under an explicit path is neither
        # the checkout nor the flat Colab layout, and reporting it as either would be false.
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp)) as path:
                policy = sealed_policy.read_sealed_policy(path)
        self.assertEqual(policy.origin, sealed_policy.POLICY_ORIGIN_EXPLICIT_PATH)
        self.assertNotIn("AO LADO", sealed_policy.announce(policy))


class BackboneIdentity(unittest.TestCase):
    """The compared shape comes from the tracked witness, not from the exporter's dict."""

    def test_the_sealed_shape_is_the_full_shape_of_the_witness_bundle(self) -> None:
        # Transcribed from `public/models/cleanfeed-ptbr-v1/config.json`, whose sha256 the
        # two tracked descriptors declare. The first four fields do not identify a model:
        # a 12 x 768 BERT with a 29 794-entry vocabulary and `intermediate_size: 16`
        # satisfies them, exports cleanly and fits under the ceiling.
        self.assertEqual(
            SEALED_SHAPE,
            {
                "model_type": "bert",
                "vocab_size": 29_794,
                "hidden_size": 768,
                "num_hidden_layers": 12,
                "intermediate_size": 3072,
                "num_attention_heads": 12,
                "max_position_embeddings": 512,
                "type_vocab_size": 2,
            },
        )

    def test_the_tracked_descriptors_still_declare_the_witness_this_shape_came_from(
        self,
    ) -> None:
        for descriptor in ("source-lock.json", "cleanfeed-model.json"):
            path = REPO_ROOT / "models" / "cleanfeed-ptbr-v1" / descriptor
            artifacts = {
                entry["path"]: entry
                for entry in json.loads(path.read_text(encoding="utf-8"))["artifacts"]
            }
            with self.subTest(descriptor=descriptor):
                self.assertEqual(
                    artifacts["config.json"]["sha256"], WITNESS_CONFIG_SHA256
                )
                self.assertEqual(
                    artifacts["vocab.txt"]["sha256"], WITNESS_VOCABULARY_SHA256
                )
                self.assertEqual(artifacts["vocab.txt"]["bytes"], 209_528)

    def test_the_witness_bundle_when_present_declares_exactly_this_shape(self) -> None:
        config_path = WITNESS_BUNDLE / "config.json"
        vocabulary_path = WITNESS_BUNDLE / "vocab.txt"
        if not config_path.is_file() or not vocabulary_path.is_file():
            self.skipTest(
                f"{WITNESS_BUNDLE} is not in this checkout (the bundle is gitignored; "
                "its digests are tracked and asserted above)"
            )
        self.assertEqual(
            hashlib.sha256(config_path.read_bytes()).hexdigest(),
            WITNESS_CONFIG_SHA256,
            "the served config is not the one the tracked descriptors declare",
        )
        self.assertEqual(
            hashlib.sha256(vocabulary_path.read_bytes()).hexdigest(),
            WITNESS_VOCABULARY_SHA256,
        )
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(
            {field: config[field] for field in export_onnx.COMPARED_CONFIG_FIELDS},
            SEALED_SHAPE,
        )
        # The vocabulary is what separates BERTimbau from the English cased BERT of the
        # same 12 x 768 shape, and it is a FILE: 29 794 lines, not a number in a config.
        self.assertEqual(
            export_onnx.count_vocabulary_entries(vocabulary_path), SEALED_VOCABULARY
        )
        self.assertEqual(config["id2label"], export_onnx.BINARY_LABEL_CONTRACT)

    def test_every_declared_backbone_declares_every_compared_field(self) -> None:
        # Totality: a backbone added to the dict without one of the fields would make the
        # comparison skip it silently.
        for backbone, shape in export_onnx.BACKBONE_CONFIG_SHAPE.items():
            with self.subTest(backbone=backbone):
                self.assertEqual(
                    tuple(shape), export_onnx.COMPARED_CONFIG_FIELDS
                )

    def test_it_refuses_a_bert_of_the_sealed_dimensions_with_a_narrow_feedforward(
        self,
    ) -> None:
        # The residue of the vocabulary fix: four fields matching is not identity. This
        # one exports cleanly, emits the three inputs, writes a 29 794-line vocab.txt,
        # lands FURTHER below the ceiling, and agrees with its own weights in parity.
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", intermediate_size=16)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("intermediate_size 16", message)
        self.assertIn("3072", message)
        self.assertIn(SEALED_BACKBONE, message)

    def test_it_refuses_the_remaining_three_witness_fields(self) -> None:
        for field, divergent in (
            ("num_attention_heads", 8),
            ("max_position_embeddings", 514),
            ("type_vocab_size", 1),
        ):
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as tmp:
                    checkpoint = write_checkpoint(
                        Path(tmp), "bert", **{field: divergent}
                    )
                    with self.assertRaises(ValueError) as caught:
                        export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
                message = str(caught.exception)
                self.assertIn(f"{field} {divergent}", message)
                self.assertIn(str(SEALED_SHAPE[field]), message)

    def test_it_refuses_a_checkpoint_whose_vocabulary_file_is_another_berts(
        self,
    ) -> None:
        # The config claims 29 794 and the vocabulary has 28 996 entries: a fine-tune of
        # `bert-base-cased` with a hand-edited config satisfies every number above.
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", vocabulary=28_996)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("28996 vocabulary entries", message)
        self.assertIn("29794", message)
        self.assertIn("this is the vocabulary", message)

    def test_it_refuses_a_checkpoint_with_no_vocabulary_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", vocabulary=None)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("vocab.txt", message)
        self.assertIn("WordPiece", message)

    def test_the_vocabulary_count_is_the_wc_l_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_vocabulary(Path(tmp), 3)
            self.assertEqual(export_onnx.count_vocabulary_entries(path), 3)
            # A file whose last line has no newline holds the same three tokens.
            path.write_bytes(b"a\nb\nc")
            self.assertEqual(export_onnx.count_vocabulary_entries(path), 3)


class ClassificationHeadContract(unittest.TestCase):
    """A checkpoint of the right shape with no trained head maximizes the parity gate."""

    def test_it_refuses_a_base_checkpoint_that_declares_a_masked_lm_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(
                Path(tmp), "bert", architectures=["BertForMaskedLM"]
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("architectures", message)
        self.assertIn("BertForMaskedLM", message)
        self.assertIn(export_onnx.SEQUENCE_CLASSIFICATION_ARCHITECTURE, message)
        # The two cases are not the same number, and the message says so: the ZEROED head
        # returns identical logits and delta 0; the RANDOM head measured a spread of
        # 0.00358 over eight texts, which is near-constant and not constant.
        self.assertIn("meanAbsDelta 0", message)
        self.assertIn("0.00358", message)

    def test_it_refuses_a_checkpoint_that_declares_no_architecture_at_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", drop=("architectures",))
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        self.assertIn("architectures None", str(caught.exception))

    def test_it_refuses_a_head_whose_class_count_is_not_declared(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(
                Path(tmp), "bert", drop=("num_labels", "id2label")
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("num_labels", message)
        self.assertIn("id2label", message)
        self.assertIn("index 1 as P(ai)", message)

    def test_it_refuses_a_head_that_is_not_binary(self) -> None:
        for overrides in (
            {"num_labels": 3, "id2label": {"0": "a", "1": "b", "2": "c"}},
            {"num_labels": 3, "drop": ("id2label",)},
            {"id2label": {"0": "a", "1": "b", "2": "c"}, "drop": ("num_labels",)},
        ):
            drop = overrides.pop("drop", ())
            with self.subTest(overrides=overrides):
                with tempfile.TemporaryDirectory() as tmp:
                    checkpoint = write_checkpoint(
                        Path(tmp), "bert", drop=drop, **overrides
                    )
                    with self.assertRaises(ValueError) as caught:
                        export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
                self.assertIn("3", str(caught.exception))

    def test_it_refuses_the_inverted_label_mapping(self) -> None:
        # `scripts/package-own-model.mjs` STAMPS {0: human, 1: ai} into the served config,
        # so a checkpoint that names them the other way round is not caught downstream:
        # it is overwritten by a claim its weights contradict.
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(
                Path(tmp), "bert", id2label={"0": "ai", "1": "human"}
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("id2label", message)
        self.assertIn("package-own-model.mjs", message)

    def test_it_accepts_the_sealed_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(
                Path(tmp), "bert", id2label=dict(export_onnx.BINARY_LABEL_CONTRACT)
            )
            self.assertEqual(
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint),
                SEALED_BACKBONE,
            )

    def test_it_refuses_the_anonymous_pair_the_library_leaves_behind(self) -> None:
        # `train_detector.py` writes the named order into the checkpoint, so a checkpoint
        # carrying `LABEL_0`/`LABEL_1` was saved by a producer this project did not seal.
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(
                Path(tmp), "bert", id2label=dict(export_onnx.TRANSFORMERS_DEFAULT_LABELS)
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("LABEL_0", message)
        self.assertIn("train_detector.py", message)

    def test_it_refuses_an_id2label_that_is_not_a_mapping(self) -> None:
        for labels, kind in ((["human", "ai"], "list"), ("ai", "str")):
            with self.subTest(labels=labels):
                with tempfile.TemporaryDirectory() as tmp:
                    checkpoint = write_checkpoint(Path(tmp), "bert", id2label=labels)
                    with self.assertRaises(ValueError) as caught:
                        export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
                message = str(caught.exception)
                self.assertIn("id2label", message)
                self.assertIn(kind, message)

    def test_the_label_contract_is_the_one_the_packaging_step_stamps(self) -> None:
        packaging = (REPO_ROOT / "scripts" / "package-own-model.mjs").read_text(
            encoding="utf-8"
        )
        self.assertIn('config.id2label = { 0: "human", 1: "ai" };', packaging)
        self.assertEqual(
            export_onnx.BINARY_LABEL_CONTRACT, {"0": "human", "1": "ai"}
        )
        self.assertEqual(train_detector.ID_TO_LABEL, {0: "human", 1: "ai"})
        self.assertEqual(train_detector.LABEL_TO_ID, {"human": 0, "ai": 1})

    def test_the_training_script_writes_the_label_order_into_the_checkpoint(
        self,
    ) -> None:
        source = inspect.getsource(train_detector.main)
        self.assertIn("id2label=ID_TO_LABEL", source)
        self.assertIn("label2id=LABEL_TO_ID", source)

    def test_a_head_the_loader_invented_is_refused_naming_the_weights(self) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_the_head_came_from_the_checkpoint(
                {
                    "missing_keys": ["classifier.weight", "classifier.bias"],
                    "mismatched_keys": [],
                },
                Path("bertimbau/best"),
            )
        message = str(caught.exception)
        self.assertIn("classifier.weight", message)
        self.assertIn("classifier.bias", message)
        self.assertIn("at random and only warned", message)

    def test_a_mismatched_head_is_refused_from_the_tuple_the_loader_reports(
        self,
    ) -> None:
        # `mismatched_keys` entries are (key, checkpoint_shape, model_shape) tuples.
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_the_head_came_from_the_checkpoint(
                {
                    "missing_keys": [],
                    "mismatched_keys": [("classifier.weight", (3, 768), (2, 768))],
                },
                Path("bertimbau/best"),
            )
        self.assertIn("classifier.weight", str(caught.exception))

    def test_a_pooler_the_loader_invented_is_refused_naming_the_weights(self) -> None:
        # `BertForSequenceClassification` feeds `bert.pooler.dense` into the classifier, so
        # a pooler built at random hands a trained head a random input — the same noise, one
        # layer earlier, and just as invisible to the parity gate.
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_the_head_came_from_the_checkpoint(
                {
                    "missing_keys": [
                        "bert.pooler.dense.weight",
                        "bert.pooler.dense.bias",
                    ],
                    "mismatched_keys": [],
                },
                Path("bertimbau/best"),
            )
        message = str(caught.exception)
        self.assertIn("bert.pooler.dense.weight", message)
        self.assertIn("at random and only warned", message)

    def test_weights_dropped_that_are_not_the_head_are_accepted(self) -> None:
        # Loading a fine-tune for classification legitimately drops the pre-training
        # heads; only the classifier being absent means the head was invented.
        self.assertEqual(
            export_onnx.assert_the_head_came_from_the_checkpoint(
                {
                    "missing_keys": ["cls.predictions.bias"],
                    "mismatched_keys": [],
                },
                Path("bertimbau/best"),
            ),
            (),
        )

    def test_a_loader_that_reports_nothing_is_refused_instead_of_trusted(self) -> None:
        for info in ({}, {"missing_keys": []}, {"mismatched_keys": []}):
            with self.subTest(info=info):
                with self.assertRaises(ValueError) as caught:
                    export_onnx.assert_the_head_came_from_the_checkpoint(
                        info, Path("bertimbau/best")
                    )
                self.assertIn("make it pass everything", str(caught.exception))


class TrainDetectorRefusals(unittest.TestCase):
    def test_the_docstring_carries_no_bake_off_instruction(self) -> None:
        docstring = train_detector.__doc__ or ""
        self.assertNotIn("Bake-off", docstring)
        self.assertNotIn(DISCARDED_BACKBONE, docstring)

    def test_the_sealed_backbone_is_accepted_and_returned(self) -> None:
        self.assertEqual(
            train_detector.assert_model_is_the_sealed_backbone(SEALED_BACKBONE),
            SEALED_BACKBONE,
        )

    def test_it_refuses_the_discarded_candidate_naming_the_sealed_one(self) -> None:
        with self.assertRaises(ValueError) as caught:
            train_detector.assert_model_is_the_sealed_backbone(DISCARDED_BACKBONE)
        message = str(caught.exception)
        self.assertIn(DISCARDED_BACKBONE, message)
        self.assertIn(SEALED_BACKBONE, message)
        self.assertIn("backboneBakeOff false", message)

    def test_it_refuses_a_policy_that_reopens_the_bake_off(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), backboneBakeOff=True) as path:
                with self.assertRaises(ValueError) as caught:
                    train_detector.assert_model_is_the_sealed_backbone(
                        SEALED_BACKBONE, path
                    )
        self.assertIn("cannot arbitrate a bake-off", str(caught.exception))

    def test_neither_flag_takes_its_default_from_the_policy(self) -> None:
        # The mirror the review named: an argparse default read out of the same object the
        # guard reads makes the guard compare a value against itself, so the absent flag
        # DELEGATES and says so instead of passing a check.
        parser = train_detector.build_parser()
        self.assertIsNone(parser.get_default("model"))
        self.assertIsNone(parser.get_default("seed"))

    def test_the_absent_flags_delegate_to_the_policy_and_announce_it(self) -> None:
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(
                train_detector.the_sealed_backbone_or_refuse(None), SEALED_BACKBONE
            )
            self.assertEqual(
                train_detector.the_publishable_seed_or_refuse(None), SEALED_SEED
            )
        announced = printed.getvalue()
        self.assertIn("DELEGADO", announced)
        self.assertIn(SEALED_BACKBONE, announced)
        self.assertIn(str(SEALED_SEED), announced)

    def test_a_flag_that_is_present_is_still_compared(self) -> None:
        for resolve, divergent in (
            (train_detector.the_sealed_backbone_or_refuse, DISCARDED_BACKBONE),
            (train_detector.the_publishable_seed_or_refuse, 42),
        ):
            with self.subTest(resolve=resolve.__name__):
                with self.assertRaises(ValueError):
                    resolve(divergent)

    def test_the_sealed_seed_is_accepted_and_returned(self) -> None:
        self.assertEqual(
            train_detector.assert_seed_is_the_publishable_one(SEALED_SEED),
            SEALED_SEED,
        )

    def test_it_refuses_the_argparse_default_that_used_to_be_shipped(self) -> None:
        with self.assertRaises(ValueError) as caught:
            train_detector.assert_seed_is_the_publishable_one(42)
        message = str(caught.exception)
        self.assertIn("42", message)
        self.assertIn(str(SEALED_SEED), message)
        self.assertIn("seeds.publishableCheckpoint", message)

    def test_the_receipt_carries_the_seed_and_the_policy_it_ran_under(self) -> None:
        receipt = train_detector.training_receipt(
            SEALED_BACKBONE,
            SEALED_SEED,
            2,
            {"auc": 0.9, "fpr_at_recall60": 0.01, "threshold": 0.7},
            sealed_policy.read_sealed_policy(),
        )
        self.assertEqual(receipt["seed"], SEALED_SEED)
        self.assertEqual(receipt["model"], SEALED_BACKBONE)
        self.assertEqual(receipt["epoch"], 2)
        self.assertEqual(receipt["auc"], 0.9)
        self.assertEqual(
            receipt["policyVersion"], sealed_policy.SEALED_POLICY_VERSION
        )
        self.assertEqual(
            receipt["policySha256"],
            hashlib.sha256(POLICY_PATH.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            receipt["policyOrigin"], sealed_policy.POLICY_ORIGIN_TRACKED
        )

    def test_the_receipt_is_what_main_writes(self) -> None:
        self.assertIn("training_receipt(", inspect.getsource(train_detector.main))


class ExportOnnxRefusals(unittest.TestCase):
    def test_the_sealed_backbone_is_exportable_by_the_shape_this_script_emits(
        self,
    ) -> None:
        self.assertEqual(
            export_onnx.assert_sealed_backbone_is_exportable(), SEALED_BACKBONE
        )
        self.assertEqual(export_onnx.EMITTED_CONFIG_MODEL_TYPE, "bert")

    def test_it_refuses_a_policy_naming_the_roberta_family_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), backbone=DISCARDED_BACKBONE) as path:
                with self.assertRaises(ValueError) as caught:
                    export_onnx.assert_sealed_backbone_is_exportable(path)
        message = str(caught.exception)
        self.assertIn(DISCARDED_BACKBONE, message)
        self.assertIn("xlm-roberta", message)
        self.assertIn("token_type_ids", message)

    def test_it_refuses_a_backbone_whose_shape_it_has_never_been_shown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), backbone="some-org/some-new-encoder") as path:
                with self.assertRaises(ValueError) as caught:
                    export_onnx.assert_sealed_backbone_is_exportable(path)
        message = str(caught.exception)
        self.assertIn("some-org/some-new-encoder", message)
        self.assertIn("never been shown", message)

    def test_it_accepts_a_checkpoint_of_the_sealed_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert")
            self.assertEqual(
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint),
                SEALED_BACKBONE,
            )

    def test_it_refuses_a_checkpoint_of_another_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "xlm-roberta")
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("xlm-roberta", message)
        self.assertIn(SEALED_BACKBONE, message)
        self.assertIn("inputs the runtime does not feed", message)

    def test_it_refuses_a_checkpoint_that_declares_no_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), None)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        self.assertIn("declares model_type None", str(caught.exception))

    def test_it_refuses_a_fine_tune_of_another_bert_by_vocabulary(self) -> None:
        # The failure a model_type check cannot see: `bert-base-cased` is the same
        # 12 x 768 shape, exports through this script cleanly, agrees with its own
        # weights in the parity gate and lands ~1.09e8 bytes — under the ceiling.
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", vocab_size=28_996)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("vocab_size 28996", message)
        self.assertIn("29794", message)
        self.assertIn(SEALED_BACKBONE, message)
        self.assertIn("fit under the byte ceiling", message)

    def test_it_refuses_a_checkpoint_with_half_the_encoder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", num_hidden_layers=6)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        message = str(caught.exception)
        self.assertIn("num_hidden_layers 6", message)
        self.assertIn("12", message)

    def test_it_refuses_a_checkpoint_that_declares_no_vocabulary_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert", drop=("vocab_size",))
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        self.assertIn("declares vocab_size None", str(caught.exception))

    def test_it_refuses_a_checkpoint_with_no_config_at_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = Path(tmp) / "best"
            checkpoint.mkdir()
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_checkpoint_matches_sealed_backbone(checkpoint)
        self.assertIn("carries no config.json", str(caught.exception))

    def test_an_artifact_at_the_ceiling_passes_and_its_size_is_returned(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), onnxMaximumInt8Bytes=64) as path:
                artifact = Path(tmp) / "model_int8.onnx"
                artifact.write_bytes(b"\x00" * 64)
                self.assertEqual(
                    export_onnx.assert_export_is_within_the_sealed_ceiling(
                        artifact, path
                    ),
                    64,
                )

    def test_it_refuses_an_artifact_one_byte_above_the_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), onnxMaximumInt8Bytes=64) as path:
                artifact = Path(tmp) / "model_int8.onnx"
                artifact.write_bytes(b"\x00" * 65)
                with self.assertRaises(ValueError) as caught:
                    export_onnx.assert_export_is_within_the_sealed_ceiling(
                        artifact, path
                    )
        message = str(caught.exception)
        self.assertIn("65 bytes", message)
        self.assertIn("64", message)
        self.assertIn("onnxMaximumInt8Bytes", message)

    def test_an_accepted_export_is_published_from_staging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), onnxMaximumInt8Bytes=64) as policy:
                fp32 = Path(tmp) / "model.onnx"
                fp32.write_bytes(b"\x00" * 8)
                published = Path(tmp) / "onnx" / "model_int8.onnx"
                published.parent.mkdir()
                measured = export_onnx.quantize_within_the_ceiling(
                    fp32,
                    published,
                    lambda _source, target: target.write_bytes(b"\x00" * 64),
                    policy,
                )
        self.assertEqual(measured, 64)

    def test_a_rejected_export_is_not_left_where_the_packaging_reads(self) -> None:
        # The guard can only run after quantization, so the rejected bytes exist by the
        # time it refuses. They must not exist under out/onnx/.
        with tempfile.TemporaryDirectory() as tmp:
            with variant_policy(Path(tmp), onnxMaximumInt8Bytes=64) as policy:
                fp32 = Path(tmp) / "model.onnx"
                fp32.write_bytes(b"\x00" * 8)
                published = Path(tmp) / "onnx" / "model_int8.onnx"
                published.parent.mkdir()
                with self.assertRaises(ValueError) as caught:
                    export_onnx.quantize_within_the_ceiling(
                        fp32,
                        published,
                        lambda _source, target: target.write_bytes(b"\x00" * 65),
                        policy,
                    )
                self.assertIn("65 bytes", str(caught.exception))
                self.assertFalse(published.is_file())
                self.assertEqual(
                    sorted(p.name for p in published.parent.iterdir()), []
                )

    def test_the_sealed_ceiling_still_refuses_an_unquantized_embedding_table(
        self,
    ) -> None:
        # 29 794 x 768 int8 is 22 881 792 bytes and fp32 is 91 527 168, so an export
        # that skips the embedding table adds 68 645 376 bytes to the 109 681 931 of a
        # measured export of this architecture. The ceiling has to stay below that sum,
        # or the failure mode it was written for walks through it.
        measured_export = 109_681_931
        embedding_left_in_fp32 = measured_export + (91_527_168 - 22_881_792)
        self.assertGreater(SEALED_CEILING, measured_export)
        self.assertLess(SEALED_CEILING, embedding_left_in_fp32)
        self.assertLess(SEALED_CEILING, DISCARDED_CEILING)


class EmittedGraphShape(unittest.TestCase):
    """The shape of the graph, observed instead of assumed.

    Only the fallback export names the inputs; via `optimum` the shape comes from the
    library. So the artifact has to be asked, and the parity gate cannot ask: it compares
    the graph against the same torch weights, so a two-input graph agrees with itself
    while the runtime's `token_type_ids` never reaches it.
    """

    def test_the_three_inputs_the_served_runtime_feeds_are_the_emitted_ones(
        self,
    ) -> None:
        self.assertEqual(
            export_onnx.EMITTED_GRAPH_INPUTS,
            ("input_ids", "attention_mask", "token_type_ids"),
        )
        self.assertEqual(
            export_onnx.assert_inputs_are_the_emitted_shape(
                ["attention_mask", "token_type_ids", "input_ids"], "the int8 graph"
            ),
            export_onnx.EMITTED_GRAPH_INPUTS,
        )

    def test_a_graph_without_segment_ids_is_refused_naming_the_missing_input(
        self,
    ) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_inputs_are_the_emitted_shape(
                ["input_ids", "attention_mask"], "the int8 graph"
            )
        message = str(caught.exception)
        self.assertIn("token_type_ids", message)
        self.assertIn("the int8 graph", message)
        self.assertIn("parity gate", message)

    def test_a_graph_with_an_extra_input_is_refused(self) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_inputs_are_the_emitted_shape(
                [*export_onnx.EMITTED_GRAPH_INPUTS, "position_ids"], "the int8 graph"
            )
        self.assertIn("position_ids", str(caught.exception))


class ParityIsNotEvidenceOfValidity(unittest.TestCase):
    """A constant detector maximizes parity, so the score spread is read too."""

    def test_a_real_spread_with_small_deltas_passes(self) -> None:
        report = export_onnx.build_parity_report(
            [0.01, 0.4, 0.6, 0.99], [0.011, 0.402, 0.599, 0.985]
        )
        self.assertEqual(report["samples"], 4)
        self.assertLess(report["meanAbsDelta"], 0.02)
        self.assertEqual(report["verdictFlips"], 0)
        self.assertAlmostEqual(report["torchScoreRange"], 0.98)
        self.assertAlmostEqual(report["torchScoreIqr"], 0.395)
        self.assertFalse(report["degenerate"])
        self.assertTrue(report["pass"])

    def test_an_untrained_head_scoring_every_text_at_one_half_is_refused(self) -> None:
        # The measured scenario: a two-class head with zeroed weights returns [0, 0] for
        # every text, both runtimes compute P(ai) = 0.5, and the deltas are exactly zero.
        constant = [0.5] * 120
        report = export_onnx.build_parity_report(constant, list(constant))
        self.assertEqual(report["meanAbsDelta"], 0.0)
        self.assertEqual(report["maxAbsDelta"], 0.0)
        self.assertEqual(report["verdictFlips"], 0)
        self.assertEqual(report["torchScoreIqr"], 0.0)
        self.assertEqual(report["torchScoreRange"], 0.0)
        self.assertTrue(report["degenerate"])
        self.assertFalse(report["pass"])

    def test_a_constant_sample_with_one_outlier_is_still_degenerate(self) -> None:
        # Measured against max−min: 119 scores at 0.5 and one at 0.9 give a RANGE of 0.4
        # with meanAbsDelta 0, zero flips and `pass: true` — one document in 120 defeated
        # the floor. The interquartile spread is 0, which is what the sample is.
        for outlier in (0.5201, 0.53, 0.9):
            with self.subTest(outlier=outlier):
                scores = [0.5] * 119 + [outlier]
                report = export_onnx.build_parity_report(scores, list(scores))
                self.assertEqual(report["meanAbsDelta"], 0.0)
                self.assertAlmostEqual(report["torchScoreRange"], outlier - 0.5)
                self.assertEqual(report["torchScoreIqr"], 0.0)
                self.assertTrue(report["degenerate"])
                self.assertFalse(report["pass"])

    def test_a_spread_at_the_tolerance_is_still_degenerate(self) -> None:
        # The bound is "the deltas are below 0.02": over a spread no wider than 0.02 that
        # holds by construction. Five samples put the two quartiles on data points, so the
        # boundary is exact and not an interpolation artifact.
        tolerance = export_onnx.PARITY_MEAN_DELTA_TOLERANCE
        at_the_tolerance = [0.0, 0.0, tolerance, tolerance, tolerance]
        report = export_onnx.build_parity_report(
            at_the_tolerance, list(at_the_tolerance)
        )
        self.assertEqual(report["torchScoreIqr"], tolerance)
        self.assertTrue(report["degenerate"])
        self.assertFalse(report["pass"])
        wider = [0.0, 0.0, tolerance + 1e-9, tolerance + 1e-9, tolerance + 1e-9]
        self.assertFalse(
            export_onnx.build_parity_report(wider, list(wider))["degenerate"]
        )

    def test_a_flat_int8_side_is_degenerate_even_with_a_live_torch_side(self) -> None:
        report = export_onnx.build_parity_report(
            [0.0, 0.0, 1.0, 1.0, 1.0], [0.5] * 5
        )
        self.assertGreater(report["torchScoreIqr"], 0.02)
        self.assertEqual(report["onnxScoreIqr"], 0.0)
        self.assertTrue(report["degenerate"])
        self.assertFalse(report["pass"])

    def test_a_verdict_flip_fails_the_gate(self) -> None:
        report = export_onnx.build_parity_report([0.01, 0.499], [0.02, 0.501])
        self.assertEqual(report["verdictFlips"], 1)
        self.assertFalse(report["pass"])

    def test_an_empty_sample_is_refused_instead_of_reported(self) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.build_parity_report([], [])
        self.assertIn("parity sample is empty", str(caught.exception))

    def test_unpaired_sides_are_refused(self) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.build_parity_report([0.1, 0.9], [0.1])
        self.assertIn("compared pairwise", str(caught.exception))

    def test_the_eval_sample_is_read_before_any_gpu_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            absent = Path(tmp) / "dev.jsonl"
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(absent, 120)
            self.assertIn(str(absent), str(caught.exception))

            # An empty sample never "passed by construction": measured, `np.mean([])` is
            # nan and `nan < 0.02` is False, and `np.max([])` RAISES. The value of the
            # refusal is that it happens before the imports instead of after the int8 has
            # been written.
            empty = write_eval(Path(tmp) / "empty.jsonl", [])
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(empty, 120)
            self.assertIn("carries no row", str(caught.exception))

            rows = write_eval(Path(tmp) / "rows.jsonl", both_classes(4))
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(rows, 1)
            self.assertIn("--parity-samples 1", str(caught.exception))
            self.assertEqual(len(export_onnx.read_parity_samples(rows, 120)), 4)


class ParitySampleCarriesBothClasses(unittest.TestCase):
    """The gate reads the score spread, so the sample decides what the spread can mean."""

    def grouped(self, humans: int, ais: int) -> list[dict]:
        # The measured layout of `benchmark/data/dataset/dev.jsonl`: every label 0 first,
        # then every label 1. Taking the first N rows of it is taking one class.
        return [{"text": f"h{index}", "label": 0} for index in range(humans)] + [
            {"text": f"a{index}", "label": 1} for index in range(ais)
        ]

    def test_it_refuses_a_single_class_sample_naming_the_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_eval(Path(tmp) / "dev.jsonl", self.grouped(200, 0))
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(path, 120)
        message = str(caught.exception)
        self.assertIn("label [1]", message)
        self.assertIn(str(path), message)
        self.assertIn("as flat as a constant one", message)

    def test_it_refuses_a_row_that_declares_no_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_eval(
                Path(tmp) / "dev.jsonl",
                [{"text": "com", "label": 0}, {"text": "sem"}],
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(path, 120)
        message = str(caught.exception)
        self.assertIn("row 1 declares no label", message)
        self.assertIn(str(path), message)

    def test_it_refuses_a_label_outside_the_binary_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_eval(
                Path(tmp) / "dev.jsonl",
                [{"text": "um", "label": 0}, {"text": "dois", "label": 2}],
            )
            with self.assertRaises(ValueError) as caught:
                export_onnx.read_parity_samples(path, 120)
        self.assertIn("row 1 declares label 2", str(caught.exception))

    def test_the_sample_is_balanced_and_drawn_from_the_whole_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_eval(Path(tmp) / "dev.jsonl", self.grouped(2640, 1478))
            sample = export_onnx.read_parity_samples(path, 120)
        self.assertEqual(len(sample), 120)
        self.assertEqual(
            export_onnx.count_sample_labels(sample), {"0": 60, "1": 60}
        )
        humans = [row["text"] for row in sample if row["label"] == 0]
        self.assertEqual(humans[0], "h0")
        # Strided, not the first 60: the last human drawn comes from the end of its class.
        self.assertEqual(humans[-1], "h2596")

    def test_a_file_smaller_than_the_limit_gives_what_each_class_has(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_eval(Path(tmp) / "dev.jsonl", self.grouped(5, 3))
            sample = export_onnx.read_parity_samples(path, 120)
        self.assertEqual(
            export_onnx.count_sample_labels(sample), {"0": 3, "1": 3}
        )

    def test_the_dev_split_in_this_checkout_is_grouped(self) -> None:
        # The measurement the guard exists for. `dev.jsonl` is gitignored, so what always
        # runs is `grouped()` above, which reproduces the layout this asserts.
        dev = REPO_ROOT / "benchmark" / "data" / "dataset" / "dev.jsonl"
        if not dev.is_file():
            self.skipTest(f"{dev} is not in this checkout (gitignored)")
        labels = [row["label"] for row in export_onnx.read_jsonl(dev)]
        self.assertEqual(set(labels[:120]), {0}, "the first 120 rows are one class")
        self.assertEqual(set(labels), {0, 1})
        sample = export_onnx.read_parity_samples(dev, 120)
        counts = export_onnx.count_sample_labels(sample)
        self.assertEqual(counts["0"], counts["1"])
        self.assertEqual(sum(counts.values()), 120)


class FakeBackend:
    """The torch/onnxruntime half, replaced by bytes: what is under test is the ORDER."""

    def __init__(
        self,
        *,
        int8_bytes: int = 32,
        vocabulary: int | None = SEALED_VOCABULARY,
        graph_inputs: tuple[str, ...] = export_onnx.EMITTED_GRAPH_INPUTS,
        tokenizer_inputs: tuple[str, ...] = export_onnx.EMITTED_GRAPH_INPUTS,
        loading_info: dict | None = None,
        scores: list[tuple[float, float]] | None = None,
    ) -> None:
        self.int8_bytes = int8_bytes
        self.vocabulary = vocabulary
        self.graph = graph_inputs
        self.tokenizer = tokenizer_inputs
        self.report = (
            {"missing_keys": [], "mismatched_keys": []}
            if loading_info is None
            else loading_info
        )
        self.scores = scores or [(0.02, 0.021), (0.97, 0.969)]
        self.scored = 0
        self.calls: list[str] = []

    def loading_info(self) -> dict:
        self.calls.append("loading_info")
        return self.report

    def tokenizer_inputs(self) -> tuple[str, ...]:
        self.calls.append("tokenizer_inputs")
        return self.tokenizer

    def export_fp32(self, fp32_dir: Path) -> Path:
        self.calls.append("export_fp32")
        path = fp32_dir / "model.onnx"
        path.write_bytes(b"\x00" * 8)
        return path

    def quantize(self, source: Path, target: Path) -> None:
        self.calls.append("quantize")
        target.write_bytes(b"\x00" * self.int8_bytes)

    def save_tokenizer(self, bundle: Path) -> None:
        self.calls.append("save_tokenizer")
        (bundle / "tokenizer.json").write_bytes(b"{}\n")
        if self.vocabulary is not None:
            write_vocabulary(bundle, self.vocabulary)

    def graph_inputs(self, model_path: Path) -> tuple[str, ...]:
        self.calls.append("graph_inputs")
        return self.graph

    def score(self, text: str) -> tuple[float, float]:
        self.calls.append("score")
        self.scored += 1
        return self.scores[self.scored - 1]


def refuse_to_build(_args) -> export_onnx.ExportBackend:
    raise AssertionError(
        "the backend was built: this refusal has to happen before torch is imported"
    )


def run_export_main(checkpoint: Path, evaluation: Path, out: Path, *, build_backend):
    """Drive `export_onnx.main` with a fake backend, under the TRACKED policy.

    Everything the real backend needs — torch, onnxruntime and a 440 MB checkpoint — is
    behind `build_backend`, which is why the wiring of `main` is testable at all.
    """
    argv = [
        "--checkpoint",
        str(checkpoint),
        "--eval",
        str(evaluation),
        "--out",
        str(out),
        "--parity-samples",
        "2",
    ]
    return export_onnx.main(argv, build_backend=build_backend)


class BundleIsPublishedOnlyAfterEveryGuard(unittest.TestCase):
    """The canonical path is written once, at the end, or not at all."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy = write_policy(self.root, onnxMaximumInt8Bytes=64)
        stand_in = standing_in_for_the_sealed_policy(self.policy)
        stand_in.__enter__()
        self.addCleanup(stand_in.__exit__, None, None, None)
        self.checkpoint = write_checkpoint(self.root, "bert")
        self.out = self.root / "cleanfeed-ptbr-v1"
        self.archive = Path(f"{self.out}-artifacts.zip")
        self.staging = self.root / "cleanfeed-ptbr-v1.staging"
        self.rows = both_classes(2)

    def publish(self, backend: FakeBackend):
        return export_onnx.publish_only_after_every_guard(
            self.out,
            lambda staging: export_onnx.build_bundle_into_staging(
                staging, self.checkpoint, self.rows, backend, self.policy
            ),
        )

    def assert_nothing_at_the_canonical_path(self) -> None:
        self.assertFalse(self.out.exists(), f"{self.out} survived a refusal")
        self.assertFalse(self.archive.exists(), f"{self.archive} survived a refusal")
        self.assertFalse((self.root / "cleanfeed-ptbr-v1.staging").exists())
        self.assertFalse(
            (self.root / "cleanfeed-ptbr-v1-artifacts.staging.zip").exists()
        )

    def test_a_bundle_that_passes_every_guard_is_promoted_with_its_zip(self) -> None:
        archive, report = self.publish(FakeBackend())
        self.assertEqual(archive, self.archive)
        self.assertTrue(self.archive.is_file())
        self.assertTrue(report["pass"])
        self.assertEqual(report["int8Bytes"], 32)
        self.assertEqual(report["vocabularyEntries"], SEALED_VOCABULARY)
        self.assertEqual(report["backbone"], SEALED_BACKBONE)
        self.assertEqual(
            report["checkpointConfigSha256"],
            hashlib.sha256(
                (self.checkpoint / "config.json").read_bytes()
            ).hexdigest(),
        )
        self.assertEqual(report["policySha256"], sealed_policy.read_sealed_policy(
            self.policy
        ).sha256)
        self.assertEqual(
            sorted(p.relative_to(self.out).as_posix() for p in self.out.rglob("*")),
            [
                "config.json",
                "onnx",
                "onnx/model_int8.onnx",
                "parity_report.json",
                "tokenizer.json",
                "vocab.txt",
            ],
        )
        with zipfile.ZipFile(self.archive) as bundle:
            self.assertIn("cleanfeed-ptbr-v1/onnx/model_int8.onnx", bundle.namelist())
            self.assertIn("cleanfeed-ptbr-v1/parity_report.json", bundle.namelist())
        self.assertFalse((self.root / "cleanfeed-ptbr-v1.staging").exists())

    def test_the_ceiling_refusal_leaves_nothing_and_stops_before_the_tokenizer(
        self,
    ) -> None:
        backend = FakeBackend(int8_bytes=65)
        with self.assertRaises(ValueError) as caught:
            self.publish(backend)
        self.assertIn("65 bytes", str(caught.exception))
        self.assertNotIn("save_tokenizer", backend.calls)
        self.assert_nothing_at_the_canonical_path()

    def test_a_bundle_without_vocab_txt_leaves_nothing(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend(vocabulary=None))
        self.assertIn("vocab.txt", str(caught.exception))
        self.assert_nothing_at_the_canonical_path()

    def test_a_bundle_whose_vocabulary_is_another_berts_leaves_nothing(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend(vocabulary=28_996))
        self.assertIn("28996 vocabulary entries", str(caught.exception))
        self.assert_nothing_at_the_canonical_path()

    def test_a_two_input_graph_leaves_nothing(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.publish(
                FakeBackend(graph_inputs=("input_ids", "attention_mask"))
            )
        self.assertIn("token_type_ids", str(caught.exception))
        self.assert_nothing_at_the_canonical_path()

    def test_a_failed_parity_leaves_no_report_at_the_canonical_path(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend(scores=[(0.49, 0.51), (0.9, 0.91)]))
        self.assertIn("PARIDADE REPROVADA", str(caught.exception))
        self.assert_nothing_at_the_canonical_path()

    def test_a_constant_detector_leaves_no_perfect_parity_report(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend(scores=[(0.5, 0.5), (0.5, 0.5)]))
        self.assertIn("ESCORE DEGENERADO", str(caught.exception))
        self.assert_nothing_at_the_canonical_path()

    def test_the_previous_zip_does_not_survive_a_refusal_on_the_next_run(self) -> None:
        # The measured second-run scenario: run A publishes, run B is refused, and the
        # operator downloads run A's ZIP believing it is run B's.
        self.publish(FakeBackend())
        first = self.archive.read_bytes()
        self.assertTrue(first)
        with self.assertRaises(ValueError):
            self.publish(FakeBackend(int8_bytes=65))
        self.assert_nothing_at_the_canonical_path()

    def test_a_second_passing_run_replaces_the_bundle_instead_of_merging_into_it(
        self,
    ) -> None:
        self.publish(FakeBackend())
        (self.out / "leftover.bin").write_bytes(b"\x00")
        self.publish(FakeBackend())
        self.assertFalse((self.out / "leftover.bin").exists())

    def test_a_directory_that_is_not_a_bundle_is_refused_instead_of_deleted(
        self,
    ) -> None:
        self.out.mkdir()
        (self.out / "tese.docx").write_bytes(b"\x00")
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend())
        self.assertIn("fresh path", str(caught.exception))
        self.assertTrue((self.out / "tese.docx").is_file())

    def test_a_training_checkpoint_is_refused_instead_of_deleted(self) -> None:
        # The measured accident: a `save_pretrained` directory carries `config.json`,
        # `vocab.txt`, `tokenizer.json`, `tokenizer_config.json` and
        # `special_tokens_map.json` — five of the bundle's seven names — so a predicate
        # written over that list accepted it and `shutil.rmtree` took the weights with it.
        for member in ("model.safetensors", "pytorch_model.bin", "training_args.bin"):
            with self.subTest(member=member):
                if self.out.exists():
                    shutil.rmtree(self.out)
                self.out.mkdir()
                for name in (
                    "config.json",
                    "vocab.txt",
                    "tokenizer.json",
                    "tokenizer_config.json",
                    "special_tokens_map.json",
                    member,
                ):
                    (self.out / name).write_bytes(b"\x00")
                with self.assertRaises(ValueError) as caught:
                    self.publish(FakeBackend())
                message = str(caught.exception)
                self.assertIn(member, message)
                self.assertIn("training checkpoint", message)
                self.assertTrue((self.out / member).is_file())

    def test_a_previous_publication_missing_one_marker_is_refused(self) -> None:
        # A published bundle carries BOTH markers this exporter writes; anything else at
        # that path is something else, and the run would delete it.
        self.out.mkdir()
        (self.out / "parity_report.json").write_bytes(b"{}\n")
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend())
        message = str(caught.exception)
        self.assertIn("onnx/model_int8.onnx", message)
        self.assertTrue((self.out / "parity_report.json").is_file())

    def test_out_pointed_at_the_checkpoint_is_refused_before_any_removal(self) -> None:
        with self.assertRaises(ValueError) as caught:
            export_onnx.assert_out_is_not_the_checkpoint(
                self.checkpoint, self.checkpoint
            )
        self.assertIn("delete the trained weights", str(caught.exception))
        for enclosing in (self.checkpoint.parent, self.checkpoint / "onnx"):
            with self.subTest(out=enclosing):
                with self.assertRaises(ValueError):
                    export_onnx.assert_out_is_not_the_checkpoint(
                        enclosing, self.checkpoint
                    )
        export_onnx.assert_out_is_not_the_checkpoint(self.out, self.checkpoint)

    def test_a_staging_directory_with_foreign_content_is_refused(self) -> None:
        self.staging.mkdir()
        (self.staging / "tese.docx").write_bytes(b"\x00")
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend())
        self.assertIn("the staging directory", str(caught.exception))
        self.assertTrue((self.staging / "tese.docx").is_file())

    def test_a_staging_directory_left_by_a_crashed_run_is_removed(self) -> None:
        self.staging.mkdir()
        (self.staging / export_onnx.FP32_STAGING_DIRECTORY).mkdir()
        self.publish(FakeBackend())
        self.assertTrue(self.archive.is_file())
        self.assertFalse(self.staging.exists())

    def test_a_zip_path_that_is_not_a_zip_is_refused(self) -> None:
        self.archive.write_bytes(b"nao e zip\n")
        with self.assertRaises(ValueError) as caught:
            self.publish(FakeBackend())
        self.assertIn("is not a ZIP", str(caught.exception))
        self.assertTrue(self.archive.is_file())

    def test_the_removal_of_the_previous_publication_is_announced(self) -> None:
        self.publish(FakeBackend())
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.publish(FakeBackend())
        announced = printed.getvalue()
        self.assertIn("saida anterior removida", announced)
        self.assertIn(str(self.out), announced)
        self.assertIn(str(self.archive), announced)

    def test_an_invented_head_leaves_nothing_and_stops_before_the_export(self) -> None:
        backend = FakeBackend(
            loading_info={
                "missing_keys": ["classifier.weight", "classifier.bias"],
                "mismatched_keys": [],
            }
        )
        with self.assertRaises(ValueError) as caught:
            self.publish(backend)
        self.assertIn("classifier.weight", str(caught.exception))
        self.assertNotIn("export_fp32", backend.calls)
        self.assert_nothing_at_the_canonical_path()

    def test_a_tokenizer_that_does_not_emit_the_three_inputs_leaves_nothing(
        self,
    ) -> None:
        backend = FakeBackend(tokenizer_inputs=("input_ids", "attention_mask"))
        with self.assertRaises(ValueError) as caught:
            self.publish(backend)
        message = str(caught.exception)
        self.assertIn("the tokenizer", message)
        self.assertIn("token_type_ids", message)
        self.assertNotIn("export_fp32", backend.calls)
        self.assert_nothing_at_the_canonical_path()

    def test_the_report_records_the_sample_composition(self) -> None:
        _, report = self.publish(FakeBackend())
        self.assertEqual(report["sampleLabelCounts"], {"0": 1, "1": 1})

    def test_an_empty_output_directory_is_reused(self) -> None:
        self.out.mkdir()
        self.publish(FakeBackend())
        self.assertTrue(self.archive.is_file())


class GuardCallSites(unittest.TestCase):
    """A guard only guards where it is called, so main() is driven, not just imported.

    Cheap on purpose: every refusal below happens BEFORE the torch/numpy imports, so no
    test here downloads a model or touches a GPU.
    """

    def _refusal_from_train_main(self, *extra: str) -> str:
        argv = [
            "train_detector.py",
            "--train",
            "train.jsonl",
            "--dev",
            "dev.jsonl",
            "--outdir",
            "out",
            *extra,
        ]
        with mock.patch.object(sys, "argv", argv):
            with self.assertRaises(ValueError) as caught:
                train_detector.main()
        return str(caught.exception)

    def test_train_main_refuses_the_discarded_candidate(self) -> None:
        message = self._refusal_from_train_main("--model", DISCARDED_BACKBONE)
        self.assertIn(DISCARDED_BACKBONE, message)
        self.assertIn(SEALED_BACKBONE, message)

    def test_train_main_refuses_a_seed_that_is_not_the_publishable_one(self) -> None:
        message = self._refusal_from_train_main("--seed", "42")
        self.assertIn("42", message)
        self.assertIn(str(SEALED_SEED), message)
        self.assertIn("seeds.publishableCheckpoint", message)

    def test_export_main_refuses_a_checkpoint_of_another_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "xlm-roberta")
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    checkpoint,
                    write_eval(Path(tmp) / "dev.jsonl", both_classes(4)),
                    Path(tmp) / "out",
                    build_backend=refuse_to_build,
                )
        self.assertIn("inputs the runtime does not feed", str(caught.exception))

    def test_export_main_refuses_a_missing_eval_before_building_the_backend(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    write_checkpoint(Path(tmp), "bert"),
                    Path(tmp) / "absent.jsonl",
                    Path(tmp) / "out",
                    build_backend=refuse_to_build,
                )
        self.assertIn("absent.jsonl", str(caught.exception))

    def test_export_main_refuses_a_single_class_eval_before_building_the_backend(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = [{"text": f"h{index}", "label": 0} for index in range(10)]
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    write_checkpoint(Path(tmp), "bert"),
                    write_eval(Path(tmp) / "dev.jsonl", rows),
                    Path(tmp) / "out",
                    build_backend=refuse_to_build,
                )
        self.assertIn("label [1]", str(caught.exception))

    def test_export_main_refuses_out_pointed_at_the_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = write_checkpoint(Path(tmp), "bert")
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    checkpoint,
                    write_eval(Path(tmp) / "dev.jsonl", both_classes(4)),
                    checkpoint,
                    build_backend=refuse_to_build,
                )
            self.assertIn("delete the trained weights", str(caught.exception))
            self.assertTrue((checkpoint / "config.json").is_file())

    def test_export_main_publishes_the_bundle_through_staging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "cleanfeed-ptbr-v1"
            backend = FakeBackend()
            run_export_main(
                write_checkpoint(Path(tmp), "bert"),
                write_eval(Path(tmp) / "dev.jsonl", both_classes(2)),
                out,
                build_backend=lambda _args: backend,
            )
            self.assertTrue((out / "onnx" / "model_int8.onnx").is_file())
            self.assertTrue((out / "parity_report.json").is_file())
            self.assertTrue(Path(f"{out}-artifacts.zip").is_file())
            self.assertFalse(out.with_name(f"{out.name}.staging").exists())
            self.assertEqual(backend.calls[0], "loading_info")
            self.assertEqual(backend.calls[1], "tokenizer_inputs")

    def test_export_main_refuses_the_head_the_loader_invented(self) -> None:
        # The guard whose only call site used to be inside the torch half, where no test
        # reached it: commenting it out left the suite green.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "cleanfeed-ptbr-v1"
            backend = FakeBackend(
                loading_info={
                    "missing_keys": ["classifier.weight"],
                    "mismatched_keys": [],
                }
            )
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    write_checkpoint(Path(tmp), "bert"),
                    write_eval(Path(tmp) / "dev.jsonl", both_classes(2)),
                    out,
                    build_backend=lambda _args: backend,
                )
            self.assertIn("classifier.weight", str(caught.exception))
            self.assertFalse(out.exists())
            self.assertFalse(Path(f"{out}-artifacts.zip").exists())
            self.assertFalse(out.with_name(f"{out.name}.staging").exists())

    def test_export_main_refuses_a_tokenizer_of_the_wrong_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "cleanfeed-ptbr-v1"
            backend = FakeBackend(tokenizer_inputs=("input_ids", "attention_mask"))
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    write_checkpoint(Path(tmp), "bert"),
                    write_eval(Path(tmp) / "dev.jsonl", both_classes(2)),
                    out,
                    build_backend=lambda _args: backend,
                )
            self.assertIn("the tokenizer", str(caught.exception))
            self.assertFalse(out.exists())

    def test_export_main_refuses_a_degenerate_detector_and_publishes_nothing(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "cleanfeed-ptbr-v1"
            backend = FakeBackend(scores=[(0.5, 0.5), (0.5, 0.5)])
            with self.assertRaises(ValueError) as caught:
                run_export_main(
                    write_checkpoint(Path(tmp), "bert"),
                    write_eval(Path(tmp) / "dev.jsonl", both_classes(2)),
                    out,
                    build_backend=lambda _args: backend,
                )
            self.assertIn("ESCORE DEGENERADO", str(caught.exception))
            self.assertFalse(out.exists())
            self.assertFalse(Path(f"{out}-artifacts.zip").exists())

    def test_the_guards_are_called_by_the_flow_and_not_by_the_torch_half(self) -> None:
        # Belt to the tests above: a guard moved back into `torch_onnx_backend` would stop
        # being reachable by any of them.
        flow = inspect.getsource(export_onnx.build_bundle_into_staging)
        for call in (
            "assert_checkpoint_matches_sealed_backbone(",
            "assert_the_head_came_from_the_checkpoint(",
            "assert_inputs_are_the_emitted_shape(",
            "quantize_within_the_ceiling(",
            "assert_vocabulary_is_the_sealed_size(",
            "build_parity_report(",
        ):
            with self.subTest(call=call):
                self.assertIn(call, flow)


if __name__ == "__main__":
    unittest.main()
