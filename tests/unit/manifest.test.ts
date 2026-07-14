import { describe, expect, it } from "vitest";
import manifest from "../../manifest.config";

describe("manifest", () => {
  it("uses MV3 and only the approved permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions).toEqual([
      "storage",
      "contextMenus",
      "activeTab",
      "scripting",
      "offscreen",
    ]);
    expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/*"]);
  });

  it("packages no remote execution capability", () => {
    expect(manifest.content_security_policy?.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
    );
    expect(JSON.stringify(manifest)).not.toContain("http://");
  });
});
