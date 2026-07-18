import type { KeywordRule } from "@/rules/rule-engine";
import type { DiagnosticReport } from "@/shared/diagnostic-types";
import type { ExtensionExport } from "@/shared/export-validation";
import type { UserSettings } from "@/shared/settings-types";
import type { HistoryEntry } from "@/shared/types";
import type { HistoryExport, HistoryQuery } from "@/storage/history";
import type {
  ApplyImportOptions,
  ExportSelection,
  ImportApplyResult,
  ImportPreview,
} from "@/storage/import-export";

/** Personal keyword-rule CRUD surface, backed by the KeywordRuleRepository. */
export interface KeywordRulesApi {
  list(): Promise<KeywordRule[]>;
  create(rule: KeywordRule): Promise<void>;
  update(rule: KeywordRule): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Local classification-history surface. Rows are always text-free. */
export interface HistoryApi {
  query(filter?: HistoryQuery): Promise<HistoryEntry[]>;
  export(): Promise<HistoryExport>;
  clear(): Promise<void>;
  /**
   * Opted-in `hash -> text` map, read only when the user enabled full-text
   * storage. Optional so the UI degrades gracefully when it is not provided.
   */
  getTexts?(): Promise<Record<string, string>>;
}

/** Namespaced settings persistence used by the sensitive history toggles. */
export interface SettingsApi {
  save(settings: UserSettings): Promise<UserSettings>;
}

/** Versioned import/export surface, mirroring createImportExport. */
export interface ImportExportApi {
  buildExport(selection: ExportSelection): Promise<ExtensionExport>;
  parseImport(input: string): Promise<ExtensionExport>;
  previewImport(parsed: ExtensionExport): ImportPreview;
  applyImport(
    preview: ImportPreview,
    options: ApplyImportOptions,
  ): Promise<ImportApplyResult>;
}

/** Sanitized diagnostics surface. */
export interface DiagnosticsApi {
  buildReport(): Promise<DiagnosticReport>;
}
