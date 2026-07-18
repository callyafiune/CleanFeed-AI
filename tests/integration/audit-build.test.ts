import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// Regression coverage for the security gate itself: without this, a typo that
// neuters a detector would let `npm run verify` stay green while shipping an
// insecure build. We run the real auditor as a subprocess against fixtures.
// Vitest runs from the repo root, and paths stay repo-relative so this holds
// regardless of the module URL scheme Vite serves the test under.
const repoRoot = process.cwd();
const auditScript = "scripts/audit-build.mjs";

function runAudit(distRelativePath: string): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(process.execPath, [auditScript, distRelativePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("audit-build.mjs security gate", () => {
  it("passes a minimal allowlist-compliant build", () => {
    const { status, output } = runAudit("tests/fixtures/secure-dist-min");
    expect(status).toBe(0);
    expect(output).toContain("audit OK");
  });

  it("rejects the insecure fixture, and EACH detector family reports", () => {
    const { status, output } = runAudit("tests/fixtures/insecure-dist");
    expect(status).toBe(1);
    // One assertion per detector family: if any single detector regresses to a
    // no-op, its reason disappears here and this test fails — so the fixture
    // proves each detector independently, not just "some problem was found".
    for (const reason of [
      "host permission not in allowlist: <all_urls>",
      "optional_host_permissions not in allowlist",
      "content_scripts[0].matches not in allowlist: <all_urls>",
      "web_accessible_resources[0].matches not in allowlist: <all_urls>",
      "remote import",
      "eval(...) call",
      "indirect eval",
      "Function(...) constructor",
    ]) {
      expect(output, `expected the audit to report: ${reason}`).toContain(
        reason,
      );
    }
  });
});
