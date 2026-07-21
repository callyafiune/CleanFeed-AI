import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeRuntimeParityDigest } from "../../scripts/runtime-parity.mjs";

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

const PARITY_FIELDS = {
  schemaVersion: 1 as const,
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  bundleDigest:
    "32cb58e1984a5c3da5745ad1c1c7fa7355e6f04f49c93f822b326511d9e3565c",
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  tokenizerDigest:
    "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
  inferenceCoreDigest: "5".repeat(64),
};

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

describe("audit-build.mjs runtime-parity integrity", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cleanfeed-audit-parity-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function runAuditAbsolute(distDir: string): {
    status: number | null;
    output: string;
  } {
    const result = spawnSync(process.execPath, [auditScript, distDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  it("passes a clean dist that carries an intact runtime-parity.json", async () => {
    const distDir = join(workDir, "dist-parity-ok");
    await cp(join(repoRoot, "tests", "fixtures", "secure-dist-min"), distDir, {
      recursive: true,
    });
    await writeFile(
      join(distDir, "runtime-parity.json"),
      JSON.stringify({
        ...PARITY_FIELDS,
        runtimeParityDigest: computeRuntimeParityDigest(PARITY_FIELDS),
      }),
    );
    const { status } = runAuditAbsolute(distDir);
    expect(status).toBe(0);
  });

  it("fails a dist whose runtime-parity.json self-digest is tampered", async () => {
    const distDir = join(workDir, "dist-parity-bad");
    await cp(join(repoRoot, "tests", "fixtures", "secure-dist-min"), distDir, {
      recursive: true,
    });
    await writeFile(
      join(distDir, "runtime-parity.json"),
      JSON.stringify({
        ...PARITY_FIELDS,
        runtimeParityDigest: "0".repeat(64),
      }),
    );
    const { status, output } = runAuditAbsolute(distDir);
    expect(status).toBe(1);
    expect(output).toContain("runtime-parity");
  });
});
