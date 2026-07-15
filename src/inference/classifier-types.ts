/**
 * Public inference contracts. They deliberately re-export the canonical shared
 * types so a backend can be replaced without creating a competing model API.
 */
export type {
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
} from "@/shared/types";
