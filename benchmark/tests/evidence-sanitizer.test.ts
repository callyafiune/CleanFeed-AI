import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runPublishEvidence } from "../commands/publish-evidence.ts";
import { runPublishProfile } from "../commands/publish-profile.ts";
import { runVerifyPublishedEvidence } from "../commands/verify-published-evidence.ts";
import {
  assertSanitized,
  buildEvidenceBundle,
  canonicalJson,
  EVIDENCE_FILE_NAMES,
  EvidenceSanitizerError,
  FORBIDDEN_RECORD_KEYS,
  INVENTORY_FILE_NAMES,
  type EvidenceBundle,
} from "../evidence-sanitizer.ts";
import { sha256BytesHex } from "../digests.ts";
import { bundleInputFor, buildRejectScenario } from "./evidence.fixtures.ts";
import type { ReleaseDecision } from "../gates.ts";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  created.length = 0;
});

async function newRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  created.push(root);
  return root;
}

// Writes a built bundle (the seven evidence files) plus the two model-metadata
// files, so the verifier can be run against a clean-clone-shaped directory.
async function writeBundleToDisk(
  bundle: EvidenceBundle,
  release: unknown,
  profiles: unknown,
): Promise<{ evidenceDir: string; modelDir: string }> {
  const root = await newRoot("cf-evidence-verify-");
  const evidenceDir = join(root, "evidence", "tmr-ptbr-v1");
  const modelDir = join(root, "models", "cleanfeed-ptbr-v1");
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  for (const file of bundle.files) {
    await writeFile(join(evidenceDir, file.name), file.content, "utf8");
  }
  await writeFile(
    join(modelDir, "release.json"),
    `${JSON.stringify(release, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(modelDir, "calibration-profiles.json"),
    `${JSON.stringify(profiles, null, 2)}\n`,
    "utf8",
  );
  return { evidenceDir, modelDir };
}

// ---------------------------------------------------------------------------
// The privacy allowlist has teeth.
// ---------------------------------------------------------------------------

describe("assertSanitized privacy allowlist", () => {
  it("preserves the safe aggregate predictionManifestDigests field", () => {
    expect(() =>
      assertSanitized({
        predictionManifestDigests: {
          development: "1".repeat(64),
          calibration: "2".repeat(64),
          test: "3".repeat(64),
        },
      }),
    ).not.toThrow();
  });

  it("rejects each forbidden record-level key exactly", () => {
    for (const key of FORBIDDEN_RECORD_KEYS) {
      expect(() => assertSanitized({ [key]: "x" })).toThrow(
        EvidenceSanitizerError,
      );
    }
  });

  it("rejects a prediction-rows payload", () => {
    expect(() =>
      assertSanitized({
        predictionRows: [{ id: "r1", documentRawScore: 0.4 }],
      }),
    ).toThrow(/predictionRows/u);
  });

  it("rejects a shard/raw path anywhere in the tree", () => {
    expect(() =>
      assertSanitized({ nested: { manifest: "shard-000.jsonl" } }),
    ).toThrow(EvidenceSanitizerError);
    expect(() =>
      assertSanitized({
        path: "benchmark/data/ptbr-generic-v1/records.jsonl",
      }),
    ).toThrow(EvidenceSanitizerError);
    expect(() =>
      assertSanitized({ p: "benchmark/out/ptbr-v1/private/test-labels.jsonl" }),
    ).toThrow(EvidenceSanitizerError);
  });

  it("rejects a disguised record-id array of at least 100 scalar ids", () => {
    const ids = Array.from({ length: 100 }, (_unused, index) => `r${index}`);
    expect(() => assertSanitized({ cohort: ids })).toThrow(
      EvidenceSanitizerError,
    );
    // 99 scalar ids is under the closed threshold and is allowed.
    expect(() => assertSanitized({ cohort: ids.slice(0, 99) })).not.toThrow();
  });

  it("allows short digest arrays (e.g. profileDigests)", () => {
    expect(() =>
      assertSanitized({
        profileDigests: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildEvidenceBundle: closed seven-file set + cross-checked evidence digest.
// ---------------------------------------------------------------------------

describe("buildEvidenceBundle", () => {
  it("emits exactly the seven allowlisted files", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    expect(bundle.files.map((file) => file.name)).toEqual([
      ...EVIDENCE_FILE_NAMES,
    ]);
  });

  it("cross-checks scientific, calibration-set and publication digests", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    const digest = bundle.evidenceDigest;

    // scientificEvidenceDigest == release.evidenceDigest == report.reportDigest.
    expect(digest.scientificEvidenceDigest).toBe(input.report.reportDigest);
    expect(digest.scientificEvidenceDigest).toBe(input.release.evidenceDigest);

    // calibrationSetDigest mirrors the release descriptor.
    expect(digest.calibrationSetDigest).toBe(
      input.release.calibrationSetDigest,
    );

    // The inventory lists exactly the other six files, sorted, with true hashes.
    expect(digest.files.map((entry) => entry.file)).toEqual(
      [...INVENTORY_FILE_NAMES].sort(),
    );
    const byName = new Map<string, string>(
      bundle.files.map((file) => [file.name, file.content]),
    );
    for (const entry of digest.files) {
      const content = byName.get(entry.file);
      expect(content).toBeDefined();
      const observed = sha256BytesHex(
        new TextEncoder().encode(content as string),
      );
      expect(observed).toBe(entry.sha256);
    }

    // publicationDigest == sha256(canonicalJson({schemaVersion: 1, files})).
    const expected = sha256BytesHex(
      new TextEncoder().encode(
        canonicalJson({ schemaVersion: 1, files: digest.files }),
      ),
    );
    expect(digest.publicationDigest).toBe(expected);

    // The manifest never hashes itself.
    expect(digest.files.map((entry) => entry.file)).not.toContain(
      "evidence-digest.json",
    );
  });

  it("refuses to build when the release evidence digest diverges from the report", async () => {
    const { input } = await bundleInputFor("pass");
    const tampered = {
      ...input,
      release: { ...input.release, evidenceDigest: "f".repeat(64) },
    };
    await expect(buildEvidenceBundle(tampered)).rejects.toThrow(
      EvidenceSanitizerError,
    );
  });

  const decisionMap: Array<{
    decision: ReleaseDecision;
    gateDecision: string;
    rolloutState: string;
    profiles: "empty" | "present";
  }> = [
    {
      decision: "pass",
      gateDecision: "pass",
      rolloutState: "indicator",
      profiles: "present",
    },
    {
      decision: "indicator-only",
      gateDecision: "indicator-only",
      rolloutState: "indicator",
      profiles: "present",
    },
    {
      decision: "reject",
      gateDecision: "reject",
      rolloutState: "bundle-verified",
      profiles: "empty",
    },
  ];

  for (const mapping of decisionMap) {
    it(`maps the ${mapping.decision} decision into decision.json`, async () => {
      const { input } = await bundleInputFor(mapping.decision);
      const bundle = await buildEvidenceBundle(input);
      const decisionFile = bundle.files.find(
        (file) => file.name === "decision.json",
      );
      expect(decisionFile).toBeDefined();
      const decision = JSON.parse(
        (decisionFile as { content: string }).content,
      );
      expect(decision.releaseDecision).toBe(mapping.decision);
      expect(decision.gateDecision).toBe(mapping.gateDecision);
      expect(decision.rolloutState).toBe(mapping.rolloutState);
      if (mapping.profiles === "empty") {
        expect(decision.profileDigests).toEqual([]);
      } else {
        expect(decision.profileDigests.length).toBeGreaterThan(0);
      }
    });
  }

  it("keeps the safe predictionManifestDigests in the fit summary", async () => {
    const { input } = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(input);
    const fit = JSON.parse(
      (
        bundle.files.find((f) => f.name === "fit-summary.json") as {
          content: string;
        }
      ).content,
    );
    expect(fit.predictionManifestDigests).toEqual(
      input.frozenCalibration.predictionManifestDigests,
    );
  });
});

// ---------------------------------------------------------------------------
// verify-published-evidence on a clean-clone shaped directory.
// ---------------------------------------------------------------------------

describe("verifyPublishedEvidence on a clean clone", () => {
  for (const decision of ["pass", "indicator-only", "reject"] as const) {
    it(`accepts a faithful ${decision} publication`, async () => {
      const fixture = await bundleInputFor(decision);
      const bundle = await buildEvidenceBundle(fixture.input);
      const { evidenceDir, modelDir } = await writeBundleToDisk(
        bundle,
        fixture.release,
        fixture.profiles,
      );
      await expect(
        runVerifyPublishedEvidence({
          evidenceDirectory: evidenceDir,
          modelDirectory: modelDir,
        }),
      ).resolves.toContain(decision);
    });
  }

  it("accepts the monotonic pass/indicator -> pass/actions transition without rewriting evidence", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    // Phase 4 promotes the live release to actions; the evidence is untouched.
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify({ ...fixture.release, rolloutState: "actions" }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).resolves.toContain("pass");
  });

  it("rejects altered evidence (a mutated content byte)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    const target = join(evidenceDir, "dataset-summary.json");
    const original = await readFile(target, "utf8");
    await writeFile(target, original.replace("10000", "9999"), "utf8");
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toThrow();
  });

  it("rejects missing evidence (a deleted file)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await rm(join(evidenceDir, "fit-summary.json"));
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toThrow();
  });

  it("rejects extra evidence (an unexpected file)", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await writeFile(join(evidenceDir, "extra.json"), "{}\n", "utf8");
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toThrow();
  });

  it("rejects a stale model release whose evidence digest no longer matches", async () => {
    const fixture = await bundleInputFor("pass");
    const bundle = await buildEvidenceBundle(fixture.input);
    const { evidenceDir, modelDir } = await writeBundleToDisk(
      bundle,
      fixture.release,
      fixture.profiles,
    );
    await writeFile(
      join(modelDir, "release.json"),
      `${JSON.stringify({ ...fixture.release, evidenceDigest: "e".repeat(64) }, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: evidenceDir,
        modelDirectory: modelDir,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// publish-evidence end-to-end on a self-consistent reject run.
// ---------------------------------------------------------------------------

describe("publish-evidence end-to-end (reject run)", () => {
  async function scenario() {
    const root = await newRoot("cf-publish-evidence-");
    return buildRejectScenario(root, runPublishProfile);
  }

  function publishOptions(s: Awaited<ReturnType<typeof scenario>>) {
    return {
      sourceReadinessPath: s.sourceReadinessPath,
      datasetAuditPath: s.datasetAuditPath,
      splitArtifactPath: s.splitArtifactPath,
      frozenCalibrationPath: s.frozenCalibrationPath,
      fitReportPath: s.fitReportPath,
      reportPath: s.reportPath,
      ledgerPath: s.ledgerPath,
      consumptionId: s.consumptionId,
      modelDirectory: s.modelDir,
      outputDirectory: s.outputDir,
    };
  }

  it("writes only the seven allowlisted files, all free of forbidden keys, and re-verifies clean", async () => {
    const s = await scenario();
    await runPublishEvidence(publishOptions(s));

    const { readdir } = await import("node:fs/promises");
    const written = (await readdir(s.outputDir)).sort();
    expect(written).toEqual([...EVIDENCE_FILE_NAMES].sort());

    // No forbidden record-level key appears anywhere in the evidence directory.
    const forbidden = new RegExp(
      `"(${FORBIDDEN_RECORD_KEYS.join("|")})"\\s*:`,
      "u",
    );
    for (const name of written) {
      const body = await readFile(join(s.outputDir, name), "utf8");
      expect(forbidden.test(body)).toBe(false);
    }

    // decision.json reflects the reject mapping.
    const decision = JSON.parse(
      await readFile(join(s.outputDir, "decision.json"), "utf8"),
    );
    expect(decision.releaseDecision).toBe("reject");
    expect(decision.gateDecision).toBe("reject");
    expect(decision.rolloutState).toBe("bundle-verified");
    expect(decision.profileDigests).toEqual([]);

    // The published evidence re-verifies against the model metadata alone.
    await expect(
      runVerifyPublishedEvidence({
        evidenceDirectory: s.outputDir,
        modelDirectory: s.modelDir,
      }),
    ).resolves.toContain("reject");
  });

  it("refuses an unfinished ledger", async () => {
    const s = await scenario();
    // Truncate the ledger to the non-terminal `started` event only.
    const lines = (await readFile(s.ledgerPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    await writeFile(s.ledgerPath, `${lines[0]}\n`, "utf8");
    await expect(runPublishEvidence(publishOptions(s))).rejects.toThrow();
  });

  it("refuses a report digest that the ledger does not attest", async () => {
    const s = await scenario();
    const lines = (await readFile(s.ledgerPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    const completed = JSON.parse(lines[1]);
    completed.reportDigest = "0".repeat(64);
    await writeFile(
      s.ledgerPath,
      `${lines[0]}\n${JSON.stringify(completed)}\n`,
      "utf8",
    );
    await expect(runPublishEvidence(publishOptions(s))).rejects.toThrow();
  });

  it("refuses an unapproved model license", async () => {
    const s = await scenario();
    await writeFile(
      join(s.modelDir, "license-review.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          modelId: "cleanfeed-ptbr-v1",
          status: "pending",
          declaredLicense: "MIT",
          reviewedAt: null,
          reviewer: null,
          evidence: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(runPublishEvidence(publishOptions(s))).rejects.toThrow();
  });

  it("refuses a missing report", async () => {
    const s = await scenario();
    await expect(
      runPublishEvidence({
        ...publishOptions(s),
        reportPath: join(s.root, "out", "does-not-exist.json"),
      }),
    ).rejects.toThrow();
  });
});
