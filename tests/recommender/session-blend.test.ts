import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildSessionProfile, EMPTY_PROFILE } from "@/lib/recommender/profile";
import { blendProfiles } from "@/lib/recommender/session";
import { cosineSimilarity } from "@/lib/recommender/similarity";
import { l2Norm } from "@/lib/recommender/vector";
import { NOW, interactionsOn, onboardingProfile, projectBySlug } from "../helpers/catalog-fixture";

describe("blendProfiles (Phase 3 fixed blend)", () => {
  const longTerm = onboardingProfile(["systems", "databases"]);
  const session = buildSessionProfile({ interactions: interactionsOn([{ slug: "implement-a-ray-tracer", type: "SAVE" }]), now: NOW });

  it("returns the long-term vector untouched when the session is empty", () => {
    const effective = blendProfiles(longTerm, EMPTY_PROFILE);
    expect(effective.sessionWeight).toBe(0);
    expect(effective.vector).toEqual(longTerm.vector);
  });

  it("uses the configured base weight and yields a unit vector that leans toward the session", () => {
    const effective = blendProfiles(longTerm, session);
    expect(effective.sessionWeight).toBeCloseTo(RECOMMENDER_CONFIG.session.baseWeight, 10);
    expect(l2Norm(effective.vector)).toBeCloseTo(1, 10);
    const rayTracer = projectBySlug("implement-a-ray-tracer").vector;
    expect(cosineSimilarity(effective.vector, rayTracer)).toBeGreaterThan(cosineSimilarity(longTerm.vector, rayTracer));
    // Long-term still dominates.
    const redis = projectBySlug("build-your-own-redis").vector;
    expect(cosineSimilarity(effective.vector, redis)).toBeGreaterThan(cosineSimilarity(effective.vector, rayTracer));
  });

  it("falls back to the session vector when there is no long-term taste at all", () => {
    const effective = blendProfiles(EMPTY_PROFILE, session);
    expect(effective.vector).toEqual(session.vector);
    expect(effective.sessionWeight).toBeGreaterThan(0);
  });
});
