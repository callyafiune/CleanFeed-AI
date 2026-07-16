import {
  parseModelManifest,
  type CleanFeedModelManifest,
} from "@/inference/model-bundle";
import { CleanFeedError } from "@/shared/errors";

/** A local-only index of manifests that have passed the closed schema parser. */
export class ModelCatalog {
  private readonly manifests = new Map<string, CleanFeedModelManifest>();

  constructor(manifests: Iterable<unknown> = []) {
    for (const manifest of manifests) this.add(manifest);
  }

  add(value: unknown): CleanFeedModelManifest {
    const manifest = parseModelManifest(value);
    if (this.manifests.has(manifest.id)) {
      throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
    }
    this.manifests.set(manifest.id, manifest);
    return manifest;
  }

  get(id: string): CleanFeedModelManifest | undefined {
    return this.manifests.get(id);
  }

  list(): CleanFeedModelManifest[] {
    return [...this.manifests.values()];
  }
}
