/**
 * Triggers a client-side download of `data` serialized as pretty-printed JSON.
 * Uses an object URL and a transient anchor; no network request is made and the
 * URL is revoked immediately after the click. Guarded so a runtime without
 * `URL.createObjectURL` (e.g. a test environment) is a silent no-op rather than
 * a thrown error.
 */
export function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Download is unsupported in this environment; nothing else to do.
  }
}
