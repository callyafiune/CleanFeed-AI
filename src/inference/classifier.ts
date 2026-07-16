/** Stable entry point for inference backend contracts. */
export type {
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
} from "@/inference/classifier-types";

export {
  OnnxTextClassifier,
  TransformersJsModelGateway,
  type ModelTokens,
  type TransformersModelGateway,
} from "@/inference/onnx-classifier";
