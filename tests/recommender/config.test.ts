import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG, STRONG_POSITIVE_INTERACTION_TYPES, interactionWeight } from "@/lib/recommender/config";
import { CANDIDATE_SOURCES, SCORE_COMPONENTS } from "@/lib/recommender/types";

describe("RECOMMENDER_CONFIG", () => {
  it("uses the specified interaction weighting table", () => {
    expect(RECOMMENDER_CONFIG.interactionWeights).toEqual({
      IMPRESSION: 0,
      OPEN: 0.5,
      SAVE: 2,
      UNSAVE: -1,
      DISLIKE: -3,
      BUILD: 4,
      COMPLETE: 5,
      SHARE: 3,
    });
    expect(interactionWeight("SAVE")).toBe(2);
    expect(interactionWeight("IMPRESSION")).toBe(0);
  });

  it("has ranking weights for every score component that sum to 1", () => {
    const weights = RECOMMENDER_CONFIG.rankingWeights;
    for (const component of SCORE_COMPONENTS) {
      expect(weights[component]).toBeGreaterThanOrEqual(0);
    }
    const total = SCORE_COMPONENTS.reduce((sum, component) => sum + weights[component], 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("configures a positive candidate count for every retrieval source", () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(RECOMMENDER_CONFIG.candidateCounts[source]).toBeGreaterThan(0);
    }
  });

  it("keeps exploration defaults inside the allowed range", () => {
    const { defaultPreference, minPreference, maxPreference, weightPivot } = RECOMMENDER_CONFIG.exploration;
    expect(defaultPreference).toBeGreaterThanOrEqual(minPreference);
    expect(defaultPreference).toBeLessThanOrEqual(maxPreference);
    expect(weightPivot).toBeGreaterThanOrEqual(minPreference);
    expect(weightPivot).toBeLessThanOrEqual(maxPreference);
  });

  it("uses a positive half-life and a session timeout of about 30 minutes", () => {
    expect(RECOMMENDER_CONFIG.timeDecay.halfLifeDays).toBeGreaterThan(0);
    expect(RECOMMENDER_CONFIG.session.timeoutMinutes).toBe(30);
  });

  it("filters terminal states from the discovery feed", () => {
    expect(RECOMMENDER_CONFIG.filtering.excludedInteractionTypes).toEqual(["DISLIKE", "BUILD", "COMPLETE"]);
    expect(STRONG_POSITIVE_INTERACTION_TYPES).not.toContain("DISLIKE");
  });

  it("defines modest, well-signed onboarding signals", () => {
    const { onboarding } = RECOMMENDER_CONFIG;
    expect(onboarding.minTopics).toBeGreaterThanOrEqual(1);
    expect(onboarding.minTopics).toBeLessThanOrEqual(onboarding.maxTopics);
    expect(onboarding.topicSignal).toBeGreaterThan(0);
    expect(onboarding.pairwiseChosenSignal).toBeGreaterThan(0);
    expect(onboarding.pairwiseRejectedSignal).toBeLessThan(0);
    expect(Math.abs(onboarding.pairwiseRejectedSignal)).toBeLessThan(onboarding.pairwiseChosenSignal);
    expect(onboarding.difficultySignal).toBeGreaterThan(0);
    expect(onboarding.durationSignal).toBeGreaterThan(0);
  });

  it("keeps feed limits and evaluation Ks sensible", () => {
    expect(RECOMMENDER_CONFIG.feed.defaultLimit).toBeLessThanOrEqual(RECOMMENDER_CONFIG.feed.maxLimit);
    expect(RECOMMENDER_CONFIG.evaluation.ks).toEqual([5, 10]);
  });
});
