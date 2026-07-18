// A trivially clean fixture module: no remote imports, no dynamic-code forms.
// It exists only so scripts/audit-build.mjs can prove a compliant build passes.
globalThis.addEventListener?.("install", () => {
  // no-op
});
