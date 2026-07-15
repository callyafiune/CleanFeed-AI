/**
 * Platform adapters keep site-specific DOM knowledge outside the content
 * orchestration layer. The shared contract intentionally contains no DOM
 * selectors, so adapters may be replaced as a platform changes its markup.
 */
export type { PlatformAdapter } from "@/shared/types";
