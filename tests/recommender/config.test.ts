import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG, STRONG_POSITIVE_INTERACTION_TYPES, interactionWeight } from "@/lib/recommender/config";
import { resolveRankingWeights } from "@/lib/recommender/rank";
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

  it("has non-negative base ranking weights that resolve to a sum of 1 for any exploration preference", () => {
    const weights = RECOMMENDER_CONFIG.rankingWeights;
    for (const component of SCORE_COMPONENTS) {
      expect(weights[component]).toBeGreaterThanOrEqual(0);
    }
    for (const e of [0, 0.35, 1]) {
      const resolved = resolveRankingWeights(["content", "collaborative", "novelty", "popularity"], { explorationPreference: e });
      const total = Object.values(resolved).reduce((sum, w) => sum + (w ?? 0), 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("configures a positive candidate count for every retrieval source", () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(RECOMMENDER_CONFIG.candidateCounts[source]).toBeGreaterThan(0);
    }
  });

  it("keeps exploration defaults inside the allowed range and its retrieval bounds ordered", () => {
    const { defaultPreference, minPreference, maxPreference, retrieval, weightSlopes } = RECOMMENDER_CONFIG.exploration;
    expect(defaultPreference).toBeGreaterThanOrEqual(minPreference);
    expect(defaultPreference).toBeLessThanOrEqual(maxPreference);
    expect(retrieval.minCandidates).toBeLessThanOrEqual(retrieval.maxCandidates);
    expect(retrieval.noveltyWeight + retrieval.plausibilityWeight).toBeCloseTo(1, 6);
    expect(weightSlopes.novelty).toBeGreaterThan(0);
    expect(weightSlopes.content).toBeLessThan(0);
    expect(RECOMMENDER_CONFIG.novelty.underexposureWeight + RECOMMENDER_CONFIG.novelty.adjacencyWeight).toBeCloseTo(1, 6);
    const { lambdaMin, lambdaMax, lambdaBase, nearDuplicateSimilarity } = RECOMMENDER_CONFIG.diversity;
    expect(lambdaMin).toBeLessThanOrEqual(lambdaBase);
    expect(lambdaBase).toBeLessThanOrEqual(lambdaMax);
    expect(nearDuplicateSimilarity).toBeGreaterThan(0.5);
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
