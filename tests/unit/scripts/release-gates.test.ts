import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertPublicationDescriptor,
  assertPublicationInputs,
  assertPublicationLicense,
  assertPublicationManifest,
  assertRealModelFiles,
  assertReleaseInputs,
  assertReleaseScriptOwners,
} from "../../../scripts/assert-release-gates.mjs";
import type { ReleasePolicyDescriptor } from "../../../scripts/release-policy.mjs";
import { runRealModelTests } from "../../../scripts/run-real-model-tests.mjs";

const REPO_ROOT = process.cwd();
const FIXTURE_ROOT = join(REPO_ROOT, "tests", "fixtures", "model-release");
// A build instant before the fixture profiles expire (2026-12-28), so the
// promoted branches resolve deterministically regardless of the wall clock.
const FUTURE = Date.parse("2026-08-01T00:00:00.000Z");

const tempDirs: string[] = [];

/** A throwaway directory, tracked for teardown. */
function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cleanfeed-release-gates-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/** Copies a fixture release branch's two canonical descriptors into a temp dir. */
function metadataDirFor(branch: string): string {
  const dir = makeTempDir(branch);
  for (const name of ["release.json", "calibration-profiles.json"]) {
    cpSync(join(FIXTURE_ROOT, branch, name), join(dir, name));
  }
  return dir;
}

/** A model directory that carries a non-empty (fake) sealed ONNX binary. */
function modelDirWithOnnx(): string {
  const dir = makeTempDir("model");
  mkdirSync(join(dir, "onnx"), { recursive: true });
  writeFileSync(join(dir, "onnx", "model_int8.onnx"), "fake-but-nonempty");
  return dir;
}

/** Reads a fixture branch's parsed release descriptor for the pure guards. */
function fixtureRelease(branch: string): ReleasePolicyDescriptor {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, branch, "release.json"), "utf8"),
  ) as ReleasePolicyDescriptor;
}

/**
 * A metadata dir for a publishable branch: the two descriptors plus an APPROVED
 * licence review and the redistribution notices.
 */
function publishableMetadataDir(branch: string): string {
  const dir = metadataDirFor(branch);
  writeFileSync(
    join(dir, "license-review.json"),
    JSON.stringify({ schemaVersion: 1, status: "approved" }),
  );
  writeFileSync(join(dir, "LICENSE"), "MIT license text");
  writeFileSync(join(dir, "NOTICE.md"), "# NOTICE\nredistribution notice");
  return dir;
}

/** A built `dist` whose manifest keeps the locked network/permission posture. */
function publishableDistDir(): string {
  const dir = makeTempDir("dist");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      content_security_policy: {
        extension_pages:
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'",
      },
    }),
  );
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("assertReleaseInputs — the real model is mandatory for every decision", () => {
  it("throws REAL_MODEL_REQUIRED when the model directory is absent", async () => {
    const metadataDirectory = metadataDirFor("indicator-only");
    const distDirectory = makeTempDir("dist");
    const missingDirectory = join(makeTempDir("missing"), "does-not-exist");

    await expect(
      assertReleaseInputs({
        modelDirectory: missingDirectory,
        metadataDirectory,
        distDirectory,
        now: FUTURE,
      }),
    ).rejects.toThrow("REAL_MODEL_REQUIRED");
  });

  it("throws MODEL_INT8_ONNX_REQUIRED when the sealed ONNX binary is missing", async () => {
    const metadataDirectory = metadataDirFor("indicator-only");
    const distDirectory = makeTempDir("dist");
    const directoryWithoutOnnx = makeTempDir("no-onnx");

    await expect(
      assertReleaseInputs({
        modelDirectory: directoryWithoutOnnx,
        metadataDirectory,
        distDirectory,
        now: FUTURE,
      }),
    ).rejects.toThrow("MODEL_INT8_ONNX_REQUIRED");
  });

  it("still requires the real model even for a reject/fallback decision", async () => {
    const rejectMetadataDirectory = metadataDirFor("reject");
    const fallbackDistDirectory = makeTempDir("fallback-dist");
    const missingDirectory = join(makeTempDir("missing"), "does-not-exist");

    await expect(
      assertReleaseInputs({
        modelDirectory: missingDirectory,
        metadataDirectory: rejectMetadataDirectory,
        distDirectory: fallbackDistDirectory,
        now: FUTURE,
      }),
    ).rejects.toThrow("REAL_MODEL_REQUIRED");
  });

  it("fails closed on a pending descriptor before touching model files", async () => {
    const metadataDirectory = metadataDirFor("pending");
    const distDirectory = makeTempDir("dist");
    const missingDirectory = join(makeTempDir("missing"), "does-not-exist");

    await expect(
      assertReleaseInputs({
        modelDirectory: missingDirectory,
        metadataDirectory,
        distDirectory,
        now: FUTURE,
      }),
    ).rejects.toThrow("RELEASE_DECISION_PENDING");
  });

  it("composes metadata -> policy -> real model -> bundle -> audit in order", async () => {
    const metadataDirectory = metadataDirFor("indicator-only");
    const distDirectory = makeTempDir("dist");
    const modelDirectory = modelDirWithOnnx();
    const order: string[] = [];

    const policy = await assertReleaseInputs({
      modelDirectory,
      metadataDirectory,
      distDirectory,
      now: FUTURE,
      dependencies: {
        verifyModelBundle: async () => {
          order.push("verifyBundle");
        },
        auditModelPackage: async () => {
          order.push("audit");
        },
      },
    });

    expect(policy).toEqual({
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "indicator",
    });
    // The real ONNX gate runs before the bundle verification and the audit.
    expect(order).toEqual(["verifyBundle", "audit"]);
  });
});

describe("assertRealModelFiles", () => {
  it("accepts a directory with a non-empty sealed ONNX binary", async () => {
    await expect(
      assertRealModelFiles(modelDirWithOnnx()),
    ).resolves.toBeUndefined();
  });

  it("rejects an empty ONNX binary with MODEL_INT8_ONNX_REQUIRED", async () => {
    const dir = makeTempDir("empty-onnx");
    mkdirSync(join(dir, "onnx"), { recursive: true });
    writeFileSync(join(dir, "onnx", "model_int8.onnx"), "");
    await expect(assertRealModelFiles(dir)).rejects.toThrow(
      "MODEL_INT8_ONNX_REQUIRED",
    );
  });
});

describe("assertReleaseScriptOwners — a single Playwright owner for the real smoke", () => {
  const basePackage = {
    scripts: {
      "build:release": "node scripts/run-release-build.mjs",
      "test:model:smoke": "node scripts/run-real-model-tests.mjs candidate",
      "test:model:release": "node scripts/run-real-model-tests.mjs release",
    },
  };

  it("accepts the repository's real package.json", () => {
    expect(() => assertReleaseScriptOwners(basePackage)).not.toThrow();
  });

  it("rejects a fixture that runs the model smoke through Vitest", () => {
    const unsafe = {
      scripts: {
        ...basePackage.scripts,
        "test:model:smoke": "vitest run tests/e2e/real-model-smoke.spec.ts",
      },
    };
    expect(() => assertReleaseScriptOwners(unsafe)).toThrow(
      "REAL_MODEL_SMOKE_MUST_USE_PLAYWRIGHT",
    );
  });

  it("rejects a build:release that does not own run-release-build.mjs", () => {
    const unsafe = {
      scripts: { ...basePackage.scripts, "build:release": "vite build" },
    };
    expect(() => assertReleaseScriptOwners(unsafe)).toThrow(
      "BUILD_RELEASE_OWNER_INVALID",
    );
  });

  it("rejects a test:model:release that does not own run-real-model-tests.mjs", () => {
    const unsafe = {
      scripts: {
        ...basePackage.scripts,
        "test:model:release": "node scripts/some-other.mjs",
      },
    };
    expect(() => assertReleaseScriptOwners(unsafe)).toThrow(
      "TEST_MODEL_RELEASE_OWNER_INVALID",
    );
  });
});

describe("release lane fails closed while the release is pending", () => {
  it("returns MODEL_RELEASE_NOT_PROMOTED for a pending gate decision", async () => {
    const result = await runRealModelTests({
      mode: "release",
      dependencies: {
        readReleaseGateDecision: async () => "pending",
        npmExecPath: "/npm",
        onnxPresent: () => true,
      },
    });
    expect(result).toEqual({ ok: false, code: "MODEL_RELEASE_NOT_PROMOTED" });
  });
});

describe("assertPublicationDescriptor — pass/indicator is the pre-activation stage", () => {
  it("blocks a pass release that has not been activated to actions", () => {
    expect(() =>
      assertPublicationDescriptor(fixtureRelease("pass-indicator")),
    ).toThrow("RELEASE_NOT_ACTIVATED");
  });

  it("accepts an activated pass release", () => {
    expect(() =>
      assertPublicationDescriptor(fixtureRelease("pass-actions")),
    ).not.toThrow();
  });

  it("accepts indicator-only and reject", () => {
    expect(() =>
      assertPublicationDescriptor(fixtureRelease("indicator-only")),
    ).not.toThrow();
    expect(() =>
      assertPublicationDescriptor(fixtureRelease("reject")),
    ).not.toThrow();
  });
});

describe("assertPublicationLicense — approved licence and notices for a packaged release", () => {
  const packagedPolicy = {
    includeTmr: true,
    activeRuntimeKind: "bundle" as const,
    maximumActionCeiling: "indicator" as const,
  };
  const fallbackPolicy = {
    includeTmr: false,
    activeRuntimeKind: "builtin" as const,
    maximumActionCeiling: "indicator" as const,
  };

  it("accepts an approved review with LICENSE and NOTICE present", async () => {
    const dir = publishableMetadataDir("indicator-only");
    await expect(
      assertPublicationLicense(dir, packagedPolicy),
    ).resolves.toBeUndefined();
  });

  it("blocks a packaged release whose licence review is not approved", async () => {
    const dir = publishableMetadataDir("indicator-only");
    writeFileSync(
      join(dir, "license-review.json"),
      JSON.stringify({ schemaVersion: 1, status: "pending" }),
    );
    await expect(assertPublicationLicense(dir, packagedPolicy)).rejects.toThrow(
      "PUBLICATION_LICENSE_NOT_APPROVED",
    );
  });

  it("blocks a packaged release missing a redistribution notice", async () => {
    const dir = publishableMetadataDir("indicator-only");
    rmSync(join(dir, "NOTICE.md"));
    await expect(assertPublicationLicense(dir, packagedPolicy)).rejects.toThrow(
      "PUBLICATION_NOTICE_MISSING",
    );
  });

  it("does not require the bundle licence for a fallback (reject) package", async () => {
    const dir = metadataDirFor("reject");
    await expect(
      assertPublicationLicense(dir, fallbackPolicy),
    ).resolves.toBeUndefined();
  });
});

describe("assertPublicationManifest — the shipped network/permission posture", () => {
  it("accepts a manifest that keeps connect-src 'self' and no optional grants", async () => {
    await expect(
      assertPublicationManifest(publishableDistDir()),
    ).resolves.toBeUndefined();
  });

  it("blocks a widened connect-src (new network origin)", async () => {
    const dir = makeTempDir("dist-net");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        content_security_policy: {
          extension_pages: "connect-src 'self' https://example.com",
        },
      }),
    );
    await expect(assertPublicationManifest(dir)).rejects.toThrow(
      "PUBLICATION_NETWORK_ORIGIN_ADDED",
    );
  });

  it("blocks an added optional permission", async () => {
    const dir = publishableDistDir();
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        content_security_policy: { extension_pages: "connect-src 'self'" },
        optional_permissions: ["tabs"],
      }),
    );
    await expect(assertPublicationManifest(dir)).rejects.toThrow(
      "PUBLICATION_PERMISSION_ADDED",
    );
  });
});

describe("assertPublicationInputs — the final publication gate", () => {
  it("fails closed on a pending descriptor before any publication check", async () => {
    const metadataDirectory = publishableMetadataDir("pending");
    const distDirectory = publishableDistDir();
    const modelDirectory = modelDirWithOnnx();

    await expect(
      assertPublicationInputs({
        modelDirectory,
        metadataDirectory,
        distDirectory,
        now: FUTURE,
        dependencies: {
          verifyModelBundle: async () => {},
          auditModelPackage: async () => {},
        },
      }),
    ).rejects.toThrow("RELEASE_DECISION_PENDING");
  });

  it("blocks a pass release still at the pre-activation indicator stage", async () => {
    const metadataDirectory = publishableMetadataDir("pass-indicator");
    const distDirectory = publishableDistDir();
    const modelDirectory = modelDirWithOnnx();

    await expect(
      assertPublicationInputs({
        modelDirectory,
        metadataDirectory,
        distDirectory,
        now: FUTURE,
        dependencies: {
          verifyModelBundle: async () => {},
          auditModelPackage: async () => {},
        },
      }),
    ).rejects.toThrow("RELEASE_NOT_ACTIVATED");
  });

  it("passes an activated pass release with approved notices and locked posture", async () => {
    const metadataDirectory = publishableMetadataDir("pass-actions");
    const distDirectory = publishableDistDir();
    const modelDirectory = modelDirWithOnnx();

    const policy = await assertPublicationInputs({
      modelDirectory,
      metadataDirectory,
      distDirectory,
      now: FUTURE,
      dependencies: {
        verifyModelBundle: async () => {},
        auditModelPackage: async () => {},
      },
    });
    expect(policy).toEqual({
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "hide",
    });
  });
});
