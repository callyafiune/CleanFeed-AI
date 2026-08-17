import { describe, expect, it } from "vitest";

import {
  DISABLED_THRESHOLD,
  IDENTITY_CALIBRATOR,
  parseCalibrationProfilesFileV1,
  type RuntimeCalibrationProfileV1,
} from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import {
  assertServedCutIsTheMeasuredCut,
  buildModelPublication,
  type PublicationIdentity,
} from "../profile-artifact.ts";
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
    // `hide` as a CEILING and 1 as the served action threshold are not in tension: the
    // v1 pre-inscribes no action cut, so a bucket the gates would authorize still gets
    // no number to fire on. The ceiling is what a Phase 4 promotion moves; the threshold
    // is what the measurement supports today.
    const middle = publication.profiles.profiles.find(
      (profile) => profile.lengthBucket === "80-199",
    );
    expect(middle?.thresholds.documentAction).toBe(1);
  });

  // The whole point of the unit: the SERVED cut is the MEASURED cut. The profile carries
  // pass-through calibrators, so the number the runtime compares is the raw document
  // score `evaluate` cut, and the threshold is the frozen `provisional-v1` quantile.
  it("serves the pre-registered cut behind pass-through calibrators", async () => {
    const publication = await buildModelPublication(passInput);
    expect(publication.profiles.profiles.length).toBe(3);
    for (const profile of publication.profiles.profiles) {
      expect(profile.calibrators.document).toEqual({ kind: "identity" });
      expect(profile.calibrators.localized).toEqual({ kind: "identity" });
      expect(profile.thresholds.documentIndicator).toBe(
        passInput.provisionalThreshold.threshold,
      );
      // The localized path and the action path are BOTH disabled, at the contract's own
      // sentinel: the v1 pre-inscribes one cut, and either of them below 1 would fire on
      // a path whose false-positive rate no gate of this release estimated.
      // `thresholdFires` is what makes the 1 an off switch rather than a very high cut,
      // and `assertServedCutIsTheMeasuredCut` refuses any profile that leaves it.
      expect(profile.thresholds.localizedIndicator).toBe(DISABLED_THRESHOLD);
      expect(profile.thresholds.documentAction).toBe(DISABLED_THRESHOLD);
    }
  });

  // The frozen calibration's own thresholds live on a calibrated scale this release does
  // not serve. Publishing them behind a pass-through would hand the runtime a number
  // from one scale to compare against scores from another — silently.
  it("never serves the frozen calibration's calibrated thresholds", async () => {
    const publication = await buildModelPublication(passInput);
    const served = publication.profiles.profiles.map(
      (profile) => profile.thresholds.documentIndicator,
    );
    expect(served).not.toContain(passInput.frozen.thresholds.warningDocument);
    expect(new Set(served).size).toBe(1);
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
      // Disabled at 1 unconditionally now, and not because the frozen fit sealed the
      // sentinel: the v1 pre-inscribes no localized cut at all, so the sentinel no
      // longer reaches a published threshold by any route.
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

  // The guard that makes "served cut == measured cut" an assertion instead of a habit.
  // `buildModelPublication` never validates the threshold artifact's own seal, so a
  // foreign or drifted cut reaches this check with its bytes intact — which is exactly
  // the case that has to be refused, because publishing it would serve a number the
  // evidence never measured.
  it("refuses a cut bound to another dataset, split or evaluator", async () => {
    for (const campo of [
      "datasetDigest",
      "splitDigest",
      "evaluatorDigest",
    ] as const) {
      await expect(
        buildModelPublication({
          ...passInput,
          provisionalThreshold: {
            ...passInput.provisionalThreshold,
            digests: {
              ...passInput.provisionalThreshold.digests,
              [campo]: "9".repeat(64),
            },
          },
        }),
      ).rejects.toMatchObject({ code: "PROVISIONAL_THRESHOLD_FOREIGN" });
    }
  });

  it("refuses a cut frozen over another basis or under a calibrator", async () => {
    await expect(
      buildModelPublication({
        ...passInput,
        provisionalThreshold: {
          ...passInput.provisionalThreshold,
          thresholdBasis:
            "document-calibrated-score" as unknown as typeof passInput.provisionalThreshold.thresholdBasis,
        },
      }),
    ).rejects.toMatchObject({ code: "PROVISIONAL_THRESHOLD_BASIS_DIVERGENT" });

    await expect(
      buildModelPublication({
        ...passInput,
        provisionalThreshold: {
          ...passInput.provisionalThreshold,
          preRegistration: {
            ...passInput.provisionalThreshold.preRegistration,
            probabilisticCalibrator:
              "platt" as unknown as typeof passInput.provisionalThreshold.preRegistration.probabilisticCalibrator,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PROVISIONAL_THRESHOLD_BASIS_DIVERGENT" });
  });

  // The collision the disabled encoding creates, and the reason it is refused rather than
  // clamped: `thresholdFires` reads 1 as OFF, so a measured cut whose value IS 1 would be
  // served as a document trigger that never fires while the measurement counted every
  // draw at 1 as a warning. The artifact parser admits `threshold: 1`, so this is
  // reachable input and not a theoretical edge.
  it("refuses to serve a measured cut that sits on the disabled sentinel", async () => {
    await expect(
      buildModelPublication({
        ...passInput,
        provisionalThreshold: {
          ...passInput.provisionalThreshold,
          threshold: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "PROFILE_CUT_AT_DISABLED_SENTINEL" });
  });

  // The two halves of the LAST check inside `assertServedCutIsTheMeasuredCut` — the served
  // localized indicator and the served document action — are unreachable through
  // `buildModelPublication`: it fixes both at `DISABLED_THRESHOLD` a few lines before the
  // check runs, so no input to the builder can make either of them fail. A profile
  // assembled by hand is the only thing that reaches them, which is why the guard is
  // exported and called directly here.
  //
  // The `code` is what is asserted and never the sentence: the message names both fields at
  // once, so a message match would pass for the wrong field.
  describe("a profile that serves a path the measurement never applied", () => {
    const IDENTITY: PublicationIdentity = {
      modelId: passInput.frozen.model.modelId,
      modelVersion: passInput.frozen.model.modelVersion,
      bundleDigest: passInput.frozen.model.bundleDigest,
      tokenizerDigest: passInput.frozen.model.tokenizerDigest,
      aggregationVersion: passInput.frozen.model.aggregationVersion,
      contentCompositionVersion:
        passInput.frozen.model.contentCompositionVersion,
      datasetDigest: passInput.frozen.datasetDigest,
      splitDigest: passInput.frozen.splitDigest,
      evaluatorDigest: passInput.frozen.evaluatorDigest,
    };

    /**
     * A profile that satisfies every OTHER claim of the guard: pass-through calibrators on
     * both signals and a `documentIndicator` that is the measured cut itself. Only the
     * threshold named by `overrides` is wrong, so a refusal can come from nothing else.
     */
    function servedProfile(
      overrides: Partial<RuntimeCalibrationProfileV1["thresholds"]>,
    ): RuntimeCalibrationProfileV1 {
      return {
        profileId: "cleanfeed-ptbr-v1::generic::pt-BR::200-plus",
        calibrators: {
          document: IDENTITY_CALIBRATOR,
          localized: IDENTITY_CALIBRATOR,
        },
        thresholds: {
          documentIndicator: passInput.provisionalThreshold.threshold,
          localizedIndicator: DISABLED_THRESHOLD,
          documentAction: DISABLED_THRESHOLD,
          ...overrides,
        },
      } as unknown as RuntimeCalibrationProfileV1;
    }

    it("is admitted while both unmeasured paths are switched off", () => {
      // The control: without it a refusal below could be coming from any of the guard's
      // other claims instead of the field the case is about.
      expect(() =>
        assertServedCutIsTheMeasuredCut(
          [servedProfile({})],
          passInput.provisionalThreshold,
          IDENTITY,
        ),
      ).not.toThrow();
    });

    it("refuses a served localized indicator, which no gate of this release estimated", () => {
      let thrown: unknown;
      try {
        assertServedCutIsTheMeasuredCut(
          // Below the sentinel, so `thresholdFires` really would raise a localized trigger.
          [servedProfile({ localizedIndicator: 0.9 })],
          passInput.provisionalThreshold,
          IDENTITY,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "PROFILE_CUT_DIVERGES_FROM_MEASUREMENT",
      });
    });

    it("refuses a served document action, which the v1 pre-inscribes nowhere", () => {
      let thrown: unknown;
      try {
        assertServedCutIsTheMeasuredCut(
          [servedProfile({ documentAction: 0.9 })],
          passInput.provisionalThreshold,
          IDENTITY,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "PROFILE_CUT_DIVERGES_FROM_MEASUREMENT",
      });
    });
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
