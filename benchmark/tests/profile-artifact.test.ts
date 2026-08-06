import { describe, expect, it } from "vitest";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import { buildModelPublication } from "../profile-artifact.ts";
import {
  indicatorInput,
  neverThresholdInput,
  passInput,
  passWithoutMiddleBandGateInput,
  rejectInput,
  unmappedBandGateInput,
} from "./profile-artifact.fixtures.ts";

describe("calibration profile artifact", () => {
  it("binds every evidence digest and expires after exactly 180 days", async () => {
    const publication = await buildModelPublication(passInput);
    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    const release = await parseModelReleaseDescriptorV1(publication.release);
    const profile = profiles.profiles[0];
    expect(Date.parse(profile.expiresAt) - Date.parse(profile.issuedAt)).toBe(
      180 * 86_400_000,
    );
    expect(profile.tokenizerDigest).toBe(
      passInput.frozen.model.tokenizerDigest,
    );
    expect(release.tokenizerDigest).toBe(
      passInput.frozen.model.tokenizerDigest,
    );
    expect(profile.actionCeiling).toBe("hide");
    expect(release.profileDigests).toEqual(
      profiles.profiles.map((item) => item.profileDigest),
    );
    expect(release.rolloutState).toBe("indicator");
  });

  // X1 — the ceiling of EVERY one of the three published buckets, not just the first.
  //
  // The suite used to assert `profiles.profiles[0]` alone, and BUILD_ORDER puts
  // `200-plus` first: measured, the length-band vocabulary change moved `80-199` from
  // `hide` to `indicator` in the published bundle with 2 801 tests green. One assertion
  // per bucket is what makes that visible.
  it("publishes the ceiling of each of the three buckets, and only 50-79 is unconditional", async () => {
    const publication = await buildModelPublication(passInput);
    const ceilings = new Map(
      publication.profiles.profiles.map((profile) => [
        profile.lengthBucket,
        profile.actionCeiling,
      ]),
    );
    expect([...ceilings.keys()]).toEqual(["200-plus", "80-199", "50-79"]);
    expect(ceilings.get("200-plus")).toBe("hide");
    expect(ceilings.get("80-199")).toBe("hide");
    expect(ceilings.get("50-79")).toBe("indicator");
    const middle = publication.profiles.profiles.find(
      (profile) => profile.lengthBucket === "80-199",
    );
    expect(middle?.thresholds.documentAction).toBe(0.85);
  });

  // No evidence, no authorization: the bucket whose constituent bands produced no action
  // gate keeps `indicator` while the bucket that has one keeps `hide`.
  it("caps a bucket whose constituent bands produced no action gate", async () => {
    const publication = await buildModelPublication(
      passWithoutMiddleBandGateInput,
    );
    const ceilings = new Map(
      publication.profiles.profiles.map((profile) => [
        profile.lengthBucket,
        profile.actionCeiling,
      ]),
    );
    expect(ceilings.get("80-199")).toBe("indicator");
    expect(ceilings.get("200-plus")).toBe("hide");
    const middle = publication.profiles.profiles.find(
      (profile) => profile.lengthBucket === "80-199",
    );
    expect(middle?.thresholds.documentAction).toBe(1);
  });

  // The fail-closed direction, and it is the one the aggregation used to get wrong: a
  // band outside RUNTIME_BUCKET_CONSTITUENTS was FILTERED OUT of every bucket's
  // evidence, so it authorized nothing and capped nothing while the mapped buckets went
  // on publishing `hide`.
  it("refuses to publish while a length band belongs to no runtime bucket", async () => {
    await expect(
      buildModelPublication(unmappedBandGateInput),
    ).rejects.toMatchObject({ code: "LENGTH_BAND_UNMAPPED" });
    await expect(buildModelPublication(unmappedBandGateInput)).rejects.toThrow(
      /600_PLUS/u,
    );
  });

  it("publishes indicator-only without a visual threshold", async () => {
    const publication = await buildModelPublication(indicatorInput);
    expect(
      publication.profiles.profiles.every(
        (profile) => profile.actionCeiling === "indicator",
      ),
    ).toBe(true);
    expect(
      publication.profiles.profiles.every(
        (profile) => profile.thresholds.documentAction === 1,
      ),
    ).toBe(true);
    expect(publication.release.rolloutState).toBe("indicator");
    expect(publication.release.gateDecision).toBe("indicator-only");
  });

  it("publishes a rejected bundle-verified descriptor and empty profiles", async () => {
    const publication = await buildModelPublication(rejectInput);
    expect(publication.profiles.profiles).toEqual([]);
    expect(publication.release.rolloutState).toBe("bundle-verified");
    expect(publication.release.gateDecision).toBe("reject");
    expect(publication.release.profileDigests).toEqual([]);
  });

  it("maps the NEVER_THRESHOLD sentinel into a valid [0,1] threshold, never a 2", async () => {
    const publication = await buildModelPublication(neverThresholdInput);
    // Round-trips through the fail-closed parser (would reject a 2 as out of [0,1]).
    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    for (const profile of profiles.profiles) {
      const { documentIndicator, localizedIndicator, documentAction } =
        profile.thresholds;
      for (const threshold of [
        documentIndicator,
        localizedIndicator,
        documentAction,
      ]) {
        expect(Number.isFinite(threshold)).toBe(true);
        expect(threshold).toBeGreaterThanOrEqual(0);
        expect(threshold).toBeLessThanOrEqual(1);
        expect(threshold).not.toBe(2);
      }
      // The localized warning path never fired (sentinel) → disabled at 1.
      expect(localizedIndicator).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// As tres recusas que a auditoria por mutacao mediu em zero.
//
// A ORDEM dentro de `buildModelPublication` decide cada forja: os templates sao parseados,
// depois a identidade e cruzada, depois `issuedAt` vira expiracao, e so entao a evidencia de
// gate e montada. Nenhuma delas valida o auto-digest do artefato congelado — o modulo nao chama
// `validateFrozenCalibrationArtifact` —, entao aqui o congelado pode ser mexido sem re-selar, ao
// contrario do que outros comandos exigem.
// ---------------------------------------------------------------------------

describe("profile artifact — recusas de identidade, data e evidencia", () => {
  it("refuses a frozen artifact whose digests diverge from the report", async () => {
    // O cruzamento cobre tres digests, e cada um sozinho basta: dataset, split e avaliador. Se
    // apenas um fosse conferido, um artefato congelado de outra corrida passaria pelos outros.
    for (const campo of [
      "datasetDigest",
      "splitDigest",
      "evaluatorDigest",
    ] as const) {
      await expect(
        buildModelPublication({
          ...passInput,
          frozen: { ...passInput.frozen, [campo]: "d".repeat(64) },
        }),
      ).rejects.toMatchObject({ code: "IDENTITY_DIVERGENCE" });
    }
  });

  it("refuses an issuedAt that is not a timestamp", async () => {
    // A expiracao e exatamente `issuedAt + 180 dias`, entao um `issuedAt` ilegivel produziria
    // uma validade que ninguem pode conferir.
    await expect(
      buildModelPublication({ ...passInput, issuedAt: "ontem de manha" }),
    ).rejects.toMatchObject({ code: "ISSUED_AT_INVALID" });
  });

  it("refuses gate evidence with a non-finite ECE-15", async () => {
    // NaN e expressavel aqui porque a entrada e um OBJETO, nao um arquivo: JSON nao carrega NaN,
    // e por isso esta guarda so tem estado alcancavel no caminho em memoria.
    const relatorio = passInput.report;
    await expect(
      buildModelPublication({
        ...passInput,
        report: {
          ...relatorio,
          metrics: {
            ...relatorio.metrics,
            ece15: { ...relatorio.metrics.ece15, value: Number.NaN },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GATE_EVIDENCE_INCOMPLETE" });
  });
});
