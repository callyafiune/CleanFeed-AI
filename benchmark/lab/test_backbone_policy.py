"""The training and export scripts read the sealed backbone instead of trusting a flag.

Both guards refuse rather than warn, and both name the sealed value in the message:
the failure they exist for is a checkpoint or an artifact that looks legitimate — it
trains, it exports, it passes the parity gate — while being a different model from the
one the pre-registration froze.
"""

from __future__ import annotations

import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import export_onnx
import train_detector

POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"
SEALED = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
SEALED_BACKBONE = SEALED["backbone"]
SEALED_SEED = SEALED["seeds"]["publishableCheckpoint"]
SEALED_CEILING = SEALED["onnxMaximumInt8Bytes"]
SEALED_SHAPE = export_onnx.BACKBONE_CONFIG_SHAPE[SEALED_BACKBONE]

# The candidate the divergence D17 pinned by reading an example line, and the ceiling
# raised to accommodate it. Spelled here because a guard is only checkable against the
# value it has to refuse.
DISCARDED_BACKBONE = "xlm-roberta-base"
DISCARDED_CEILING = 340_000_000


def write_policy(directory: Path, **overrides) -> Path:
    policy = dict(SEALED)
    policy.update(overrides)
    path = directory / "preregistration-v4.json"
    path.write_bytes((json.dumps(policy, indent=2) + "\n").encode("utf-8"))
    return path


def write_checkpoint(directory: Path, model_type: str | None, **overrides) -> Path:
    checkpoint = directory / "best"
    checkpoint.mkdir(parents=True, exist_ok=True)
    config: dict = {
        "architectures": ["BertForSequenceClassification"],
        **{
            field: value
            for field, value in SEALED_SHAPE.items()
            if field != "model_type"
        },
    }
    if model_type is not None:
        config["model_type"] = model_type
    config.update(overrides)
    (checkpoint / "config.json").write_bytes(
        (json.dumps(config, indent=2) + "\n").encode("utf-8")
    )
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

    def test_the_exporter_pins_the_sealed_backbone_shape(self) -> None:
        # 29 794 is BERTimbau's WordPiece vocabulary; the English cased BERT of the same
        # 12 x 768 shape declares 28 996 and is the checkpoint a model_type-only check
        # lets through.
        self.assertEqual(
            SEALED_SHAPE,
            {
                "model_type": "bert",
                "vocab_size": 29_794,
                "hidden_size": 768,
                "num_hidden_layers": 12,
            },
        )

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
            for module in (train_detector, export_onnx):
                with mock.patch.object(module, "POLICY_PATH", absent):
                    with mock.patch.object(module, "COLAB_POLICY_PATH", beside):
                        self.assertEqual(module.sealed_policy_path(absent), beside)
                        # A path a caller passed explicitly is never redirected: only the
                        # module default may fall back to the flat layout.
                        with self.assertRaises(ValueError):
                            module.sealed_policy_path(
                                Path(tmp) / "another" / "policy.json"
                            )


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
            path = write_policy(Path(tmp), backboneBakeOff=True)
            with self.assertRaises(ValueError) as caught:
                train_detector.assert_model_is_the_sealed_backbone(
                    SEALED_BACKBONE, path
                )
        self.assertIn("cannot arbitrate a bake-off", str(caught.exception))

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
            path = write_policy(Path(tmp), backbone=DISCARDED_BACKBONE)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_sealed_backbone_is_exportable(path)
        message = str(caught.exception)
        self.assertIn(DISCARDED_BACKBONE, message)
        self.assertIn("xlm-roberta", message)
        self.assertIn("token_type_ids", message)

    def test_it_refuses_a_backbone_whose_shape_it_has_never_been_shown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_policy(Path(tmp), backbone="some-org/some-new-encoder")
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
            checkpoint = write_checkpoint(Path(tmp), "bert")
            config_path = checkpoint / "config.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            del config["vocab_size"]
            config_path.write_bytes(
                (json.dumps(config, indent=2) + "\n").encode("utf-8")
            )
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
            path = write_policy(Path(tmp), onnxMaximumInt8Bytes=64)
            artifact = Path(tmp) / "model_int8.onnx"
            artifact.write_bytes(b"\x00" * 64)
            self.assertEqual(
                export_onnx.assert_export_is_within_the_sealed_ceiling(artifact, path),
                64,
            )

    def test_it_refuses_an_artifact_one_byte_above_the_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_policy(Path(tmp), onnxMaximumInt8Bytes=64)
            artifact = Path(tmp) / "model_int8.onnx"
            artifact.write_bytes(b"\x00" * 65)
            with self.assertRaises(ValueError) as caught:
                export_onnx.assert_export_is_within_the_sealed_ceiling(artifact, path)
        message = str(caught.exception)
        self.assertIn("65 bytes", message)
        self.assertIn("64", message)
        self.assertIn("onnxMaximumInt8Bytes", message)

    def test_an_accepted_export_is_published_from_staging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            policy = write_policy(Path(tmp), onnxMaximumInt8Bytes=64)
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
            policy = write_policy(Path(tmp), onnxMaximumInt8Bytes=64)
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
            self.assertEqual(sorted(p.name for p in published.parent.iterdir()), [])

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
            argv = [
                "export_onnx.py",
                "--checkpoint",
                str(checkpoint),
                "--eval",
                "dev.jsonl",
                "--out",
                str(Path(tmp) / "out"),
            ]
            with mock.patch.object(sys, "argv", argv):
                with self.assertRaises(ValueError) as caught:
                    export_onnx.main()
        self.assertIn("inputs the runtime does not feed", str(caught.exception))

    def test_export_main_publishes_the_int8_artifact_through_the_ceiling_guard(
        self,
    ) -> None:
        # The behaviour of both guards is covered above; what is asserted here is their
        # CALL SITE, which no test can reach without onnxruntime, torch and a real
        # checkpoint of ~440 MB.
        source = inspect.getsource(export_onnx.main)
        self.assertIn("quantize_within_the_ceiling(", source)
        self.assertIn("assert_inputs_are_the_emitted_shape(", source)


if __name__ == "__main__":
    unittest.main()
