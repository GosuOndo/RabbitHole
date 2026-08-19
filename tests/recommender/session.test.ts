import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildSessionProfile, EMPTY_PROFILE, type ProfileInteraction } from "@/lib/recommender/profile";
import {
  adaptiveEffectiveProfile,
  blendProfiles,
  combineSessionConfidence,
  computeSessionConfidence,
  evidenceConfidence,
  sessionAffinityFor,
  sessionBlendWeight,
  sessionCoherence,
  sessionEvidence,
  sessionTopFeatures,
} from "@/lib/recommender/session";
import { cosineSimilarity } from "@/lib/recommender/similarity";
import { l2Norm } from "@/lib/recommender/vector";
import { NOW, behaviourProfile, interactionsOn, onboardingProfile, projectBySlug } from "../helpers/catalog-fixture";

const CONFIG = RECOMMENDER_CONFIG.session;
const session = (entries: Parameters<typeof interactionsOn>[0]) => {
  const interactions = interactionsOn(entries);
  return { interactions, profile: buildSessionProfile({ interactions, now: NOW }) };
};
const confidenceOf = (entries: Parameters<typeof interactionsOn>[0]) => {
  const s = session(entries);
  return computeSessionConfidence(s.interactions, s.profile);
};

// Coherent graphics session vs. a diffuse session with the same interaction types.
const GRAPHICS = [
  { slug: "webgl-fluid-simulation", type: "SAVE" },
  { slug: "live-shader-playground", type: "SAVE" },
  { slug: "implement-a-ray-tracer", type: "OPEN" },
  { slug: "procedural-terrain-generator", type: "SAVE" },
] satisfies Parameters<typeof interactionsOn>[0];
const DIFFUSE = [
  { slug: "webgl-fluid-simulation", type: "SAVE" },
  { slug: "build-your-own-redis", type: "SAVE" },
  { slug: "end-to-end-encrypted-chat", type: "OPEN" },
  { slug: "barcode-pantry-inventory-app", type: "SAVE" },
] satisfies Parameters<typeof interactionsOn>[0];

describe("sessionEvidence", () => {
  it("sums absolute interaction weights, ignores impressions and counts repeated (project, type) pairs once", () => {
    expect(sessionEvidence([])).toEqual({ evidence: 0, meaningfulInteractions: 0 });
    expect(sessionEvidence(interactionsOn([{ slug: "build-your-own-redis", type: "IMPRESSION" }]))).toEqual({ evidence: 0, meaningfulInteractions: 0 });
    expect(sessionEvidence(interactionsOn([{ slug: "build-your-own-redis", type: "OPEN" }]))).toEqual({ evidence: 0.5, meaningfulInteractions: 1 });
    // OPEN + SAVE on one project and OPEN on another.
    const mixed = sessionEvidence(
      interactionsOn([
        { slug: "build-your-own-redis", type: "OPEN" },
        { slug: "build-your-own-redis", type: "SAVE" },
        { slug: "write-an-http-server", type: "OPEN" },
      ]),
    );
    expect(mixed.evidence).toBeCloseTo(3, 10);
    expect(mixed.meaningfulInteractions).toBe(3);
    // Re-opening the same project five times or toggling SAVE/UNSAVE/SAVE does not inflate evidence.
    const repeated = sessionEvidence(interactionsOn(Array.from({ length: 5 }, () => ({ slug: "build-your-own-redis", type: "OPEN" as const }))));
    expect(repeated.evidence).toBeCloseTo(0.5, 10);
    expect(repeated.meaningfulInteractions).toBe(5);
    const toggled = sessionEvidence(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }, { slug: "build-your-own-redis", type: "UNSAVE" }, { slug: "build-your-own-redis", type: "SAVE" }]));
    expect(toggled.evidence).toBeCloseTo(3, 10); // SAVE (2) once + UNSAVE (1) once
    // Dislikes are evidence too (their direction lives in the signed profile).
    expect(sessionEvidence(interactionsOn([{ slug: "build-your-own-redis", type: "DISLIKE" }])).evidence).toBe(3);
    // Interactions without a project id are counted individually.
    const anonymous: ProfileInteraction[] = [
      { type: "OPEN", createdAt: NOW, features: projectBySlug("build-your-own-redis").vector },
      { type: "OPEN", createdAt: NOW, features: projectBySlug("build-your-own-redis").vector },
    ];
    expect(sessionEvidence(anonymous).evidence).toBe(1);
  });

  it("evidenceConfidence saturates: 0 → 0, half-saturation → 0.5, large → close to 1, never above 1", () => {
    expect(evidenceConfidence(0)).toBe(0);
    expect(evidenceConfidence(-1)).toBe(0);
    expect(evidenceConfidence(Number.NaN)).toBe(0);
    expect(evidenceConfidence(CONFIG.evidenceHalfSaturation)).toBeCloseTo(0.5, 10);
    expect(evidenceConfidence(0.5)).toBeCloseTo(0.5 / 4.5, 10);
    expect(evidenceConfidence(1000)).toBeGreaterThan(0.99);
    expect(evidenceConfidence(1000)).toBeLessThanOrEqual(1);
    expect(evidenceConfidence(40)).toBeGreaterThan(evidenceConfidence(8));
  });
});

describe("sessionCoherence", () => {
  it("is high for a focused graphics session and lower for a diffuse one with equivalent evidence", () => {
    const focused = sessionCoherence(session(GRAPHICS).profile);
    const diffuse = sessionCoherence(session(DIFFUSE).profile);
    expect(focused).toBeGreaterThan(diffuse);
    expect(focused).toBeGreaterThan(0.5);
    expect(diffuse).toBeLessThan(0.5);
    expect(sessionEvidence(session(GRAPHICS).interactions).evidence).toBe(sessionEvidence(session(DIFFUSE).interactions).evidence);
  });

  it("is bounded in [0, 1], 1 when everything sits on ≤ K tags, 0 for an empty profile", () => {
    expect(sessionCoherence(EMPTY_PROFILE)).toBe(0);
    const single = session([{ slug: "build-your-own-redis", type: "SAVE" }]).profile;
    const redisTagCount = projectBySlug("build-your-own-redis").tagSlugs.length;
    const value = sessionCoherence(single);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
    if (redisTagCount <= CONFIG.coherenceTopFeatures) expect(value).toBeCloseTo(1, 10);
    // A hand-built profile concentrated on exactly three tags is perfectly coherent; spread over twelve it is not.
    const concentrated = { ...EMPTY_PROFILE, signals: { "tag:a": 3, "tag:b": 2, "tag:c": 1, "lang:rust": 5, "difficulty:ADVANCED": 4 }, norm: 1 };
    expect(sessionCoherence(concentrated)).toBeCloseTo(1, 10);
    const spread = { ...EMPTY_PROFILE, signals: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`tag:t${i}`, 1])), norm: 1 };
    expect(sessionCoherence(spread)).toBeCloseTo(3 / 12, 10);
    // Negative (disliked) tags count as mass too — coherence is about focus, not sign.
    const negative = { ...EMPTY_PROFILE, signals: { "tag:a": -3, "tag:b": -3, "tag:c": 1 }, norm: 1 };
    expect(sessionCoherence(negative)).toBeCloseTo(1, 10);
  });
});

describe("computeSessionConfidence / sessionBlendWeight", () => {
  it("no interactions → zero confidence and zero blend", () => {
    const none = computeSessionConfidence([], EMPTY_PROFILE);
    expect(none).toMatchObject({ available: false, meaningfulInteractions: 0, evidence: 0, evidenceConfidence: 0, coherence: 0, confidence: 0, blendWeight: 0 });
    const impressionsOnly = confidenceOf([{ slug: "build-your-own-redis", type: "IMPRESSION" }, { slug: "write-an-http-server", type: "IMPRESSION" }]);
    expect(impressionsOnly.available).toBe(false);
    expect(impressionsOnly.confidence).toBe(0);
    expect(impressionsOnly.blendWeight).toBe(0);
  });

  it("one weak OPEN → small but non-zero confidence and blend", () => {
    const weak = confidenceOf([{ slug: "webgl-fluid-simulation", type: "OPEN" }]);
    expect(weak.available).toBe(true);
    expect(weak.meaningfulInteractions).toBe(1);
    expect(weak.evidence).toBe(0.5);
    expect(weak.confidence).toBeGreaterThan(0);
    expect(weak.confidence).toBeLessThan(0.15);
    expect(weak.blendWeight).toBeGreaterThan(0);
    expect(weak.blendWeight).toBeLessThan(0.07);
  });

  it("several coherent strong actions raise confidence materially; the same evidence spread over unrelated topics scores lower", () => {
    const coherent = confidenceOf(GRAPHICS);
    const diffuse = confidenceOf(DIFFUSE);
    const weak = confidenceOf([{ slug: "webgl-fluid-simulation", type: "OPEN" }]);
    expect(coherent.evidence).toBe(diffuse.evidence);
    expect(coherent.evidenceConfidence).toBeCloseTo(diffuse.evidenceConfidence, 10);
    expect(coherent.coherence).toBeGreaterThan(diffuse.coherence);
    expect(coherent.confidence).toBeGreaterThan(diffuse.confidence);
    expect(coherent.confidence).toBeGreaterThan(weak.confidence * 3);
    expect(coherent.confidence).toBeGreaterThanOrEqual(0.4);
    expect(coherent.blendWeight).toBeGreaterThanOrEqual(0.18);
    expect(coherent.blendWeight).toBeLessThanOrEqual(CONFIG.maxBlendWeight);
    // Incoherent sessions still get some influence (coherence floor), but never no-evidence influence.
    expect(diffuse.confidence).toBeGreaterThan(0);
    expect(diffuse.confidence).toBeGreaterThanOrEqual(coherent.confidence * CONFIG.coherenceFloor * 0.9);
  });

  it("saturates: more evidence increases confidence but stays bounded by the configured maximum blend", () => {
    const four = confidenceOf(GRAPHICS);
    const more = confidenceOf([
      ...GRAPHICS,
      { slug: "software-rasterizer", type: "BUILD" },
      { slug: "physically-based-path-tracer", type: "SAVE" },
      { slug: "generative-art-playground", type: "COMPLETE" },
      { slug: "voxel-world-renderer", type: "SHARE" },
    ]);
    expect(more.evidence).toBeGreaterThan(four.evidence);
    expect(more.confidence).toBeGreaterThan(four.confidence);
    expect(more.confidence).toBeLessThanOrEqual(1);
    expect(more.blendWeight).toBeLessThanOrEqual(CONFIG.maxBlendWeight);
    expect(sessionBlendWeight(1)).toBe(CONFIG.maxBlendWeight);
    expect(sessionBlendWeight(2)).toBe(CONFIG.maxBlendWeight);
    expect(sessionBlendWeight(0)).toBe(0);
    expect(sessionBlendWeight(-1)).toBe(0);
    expect(combineSessionConfidence(1, 1)).toBe(1);
    expect(combineSessionConfidence(1, 0)).toBeCloseTo(CONFIG.coherenceFloor, 10);
    expect(combineSessionConfidence(0, 1)).toBe(0);
  });

  it("is finite and deterministic", () => {
    for (const entries of [GRAPHICS, DIFFUSE, [{ slug: "build-your-own-redis", type: "DISLIKE" as const }]]) {
      const a = confidenceOf(entries);
      const b = confidenceOf(entries);
      expect(a).toEqual(b);
      for (const value of Object.values(a)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
    expect(combineSessionConfidence(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("blendProfiles / adaptiveEffectiveProfile", () => {
  const longTerm = onboardingProfile(["systems", "databases"]);
  const rayTracer = projectBySlug("implement-a-ray-tracer").vector;
  const redis = projectBySlug("build-your-own-redis").vector;

  it("empty session → effective profile equals the long-term profile", () => {
    const { effective, confidence } = adaptiveEffectiveProfile(longTerm, EMPTY_PROFILE, []);
    expect(confidence.blendWeight).toBe(0);
    expect(effective.sessionWeight).toBe(0);
    expect(effective.vector).toEqual(longTerm.vector);
  });

  it("weak session → small shift; strong coherent session → larger shift, still a unit vector", () => {
    const weak = session([{ slug: "implement-a-ray-tracer", type: "OPEN" }]);
    const strong = session(GRAPHICS);
    const weakEffective = adaptiveEffectiveProfile(longTerm, weak.profile, weak.interactions).effective;
    const strongEffective = adaptiveEffectiveProfile(longTerm, strong.profile, strong.interactions).effective;
    const base = cosineSimilarity(longTerm.vector, rayTracer);
    const weakAffinity = cosineSimilarity(weakEffective.vector, rayTracer);
    const strongAffinity = cosineSimilarity(strongEffective.vector, rayTracer);
    expect(weakAffinity).toBeGreaterThan(base);
    expect(strongAffinity).toBeGreaterThan(weakAffinity);
    expect(weakEffective.sessionWeight).toBeLessThan(strongEffective.sessionWeight);
    expect(strongEffective.sessionWeight).toBeLessThanOrEqual(CONFIG.maxBlendWeight);
    expect(l2Norm(weakEffective.vector)).toBeCloseTo(1, 10);
    expect(l2Norm(strongEffective.vector)).toBeCloseTo(1, 10);
  });

  it("a strong session does not eliminate unrelated long-term positive features", () => {
    const strong = session(GRAPHICS);
    const { effective } = adaptiveEffectiveProfile(longTerm, strong.profile, strong.interactions);
    expect(effective.vector["tag:systems"]).toBeGreaterThan(0);
    expect(effective.vector["tag:databases"]).toBeGreaterThan(0);
    // Long-term still dominates a pure systems project over the session's graphics tilt.
    expect(cosineSimilarity(effective.vector, redis)).toBeGreaterThan(0.3);
    expect(effective.vector["tag:systems"]! / (longTerm.vector["tag:systems"] ?? 1)).toBeGreaterThan(1 - CONFIG.maxBlendWeight - 0.05);
  });

  it("signed negative session features reduce the corresponding effective preference", () => {
    const disliking = session([
      { slug: "build-your-own-redis", type: "DISLIKE" },
      { slug: "implement-a-tiny-database", type: "DISLIKE" },
      { slug: "lsm-tree-key-value-store", type: "DISLIKE" },
    ]);
    const { effective, confidence } = adaptiveEffectiveProfile(longTerm, disliking.profile, disliking.interactions);
    expect(confidence.available).toBe(true);
    expect(confidence.blendWeight).toBeGreaterThan(0);
    expect(disliking.profile.vector["tag:databases"]).toBeLessThan(0);
    expect(effective.vector["tag:databases"]!).toBeLessThan(longTerm.vector["tag:databases"]!);
    expect(cosineSimilarity(effective.vector, redis)).toBeLessThan(cosineSimilarity(longTerm.vector, redis));
  });

  it("no long-term taste but a meaningful session → the session profile is used as-is, with its confidence reported", () => {
    const strong = session(GRAPHICS);
    const { effective, confidence } = adaptiveEffectiveProfile(EMPTY_PROFILE, strong.profile, strong.interactions);
    expect(effective.vector).toEqual(strong.profile.vector);
    expect(effective.sessionWeight).toBeCloseTo(confidence.blendWeight, 10);
    expect(confidence.confidence).toBeGreaterThan(0);
    // Both empty → empty.
    expect(adaptiveEffectiveProfile(EMPTY_PROFILE, EMPTY_PROFILE, []).effective.vector).toEqual({});
  });

  it("never exceeds the maximum blend and normalises deterministically", () => {
    const strong = session(GRAPHICS);
    const forced = blendProfiles(longTerm, strong.profile, 0.9);
    expect(forced.sessionWeight).toBe(CONFIG.maxBlendWeight);
    expect(l2Norm(forced.vector)).toBeCloseTo(1, 10);
    expect(blendProfiles(longTerm, strong.profile, Number.NaN).sessionWeight).toBe(0);
    expect(blendProfiles(longTerm, strong.profile, 0.2)).toEqual(blendProfiles(longTerm, strong.profile, 0.2));
  });
});

describe("sessionAffinityFor", () => {
  const graphics = session(GRAPHICS);

  it("matching project → positive score, orthogonal → ~0, opposed → score 0 (raw negative kept for diagnostics)", () => {
    const match = sessionAffinityFor(graphics.profile, projectBySlug("software-rasterizer").vector, true)!;
    expect(match.raw).toBeGreaterThan(0.3);
    expect(match.score).toBeCloseTo(match.raw, 10);
    const orthogonal = sessionAffinityFor(graphics.profile, projectBySlug("barcode-pantry-inventory-app").vector, true)!;
    expect(orthogonal.score).toBeLessThan(0.15);
    const disliking = session([{ slug: "webgl-fluid-simulation", type: "DISLIKE" }, { slug: "live-shader-playground", type: "DISLIKE" }]);
    const opposed = sessionAffinityFor(disliking.profile, projectBySlug("software-rasterizer").vector, true)!;
    expect(opposed.raw).toBeLessThan(0);
    expect(opposed.score).toBe(0);
  });

  it("empty / unavailable session → null, never a fabricated zero; scores stay within [0, 1]", () => {
    expect(sessionAffinityFor(EMPTY_PROFILE, projectBySlug("software-rasterizer").vector, true)).toBeNull();
    expect(sessionAffinityFor(null, projectBySlug("software-rasterizer").vector, true)).toBeNull();
    expect(sessionAffinityFor(graphics.profile, projectBySlug("software-rasterizer").vector, false)).toBeNull();
    for (const slug of ["software-rasterizer", "build-your-own-redis", "barcode-pantry-inventory-app"]) {
      const affinity = sessionAffinityFor(graphics.profile, projectBySlug(slug).vector, true)!;
      expect(affinity.score).toBeGreaterThanOrEqual(0);
      expect(affinity.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(affinity.raw)).toBe(true);
    }
  });
});

describe("sessionTopFeatures", () => {
  it("lists the strongest positive session tags only, deterministically", () => {
    const graphics = session(GRAPHICS);
    const top = sessionTopFeatures(graphics.profile, 3);
    expect(top).toHaveLength(3);
    expect(top[0]!.strength).toBe(1);
    expect(top.every((f) => f.family === "tag" && f.strength > 0 && f.strength <= 1)).toBe(true);
    expect(top.map((f) => f.key)).toContain("graphics");
    expect(sessionTopFeatures(graphics.profile, 3)).toEqual(top);
    const disliking = session([{ slug: "webgl-fluid-simulation", type: "DISLIKE" }]);
    expect(sessionTopFeatures(disliking.profile)).toEqual([]);
    expect(sessionTopFeatures(EMPTY_PROFILE)).toEqual([]);
  });
});

describe("current-session profile isolation", () => {
  it("a long-term profile built from earlier sessions does not contain the current session's interactions", () => {
    const earlier = interactionsOn([{ slug: "build-your-own-redis", type: "SAVE", sessionId: "s-old" }]);
    const current = interactionsOn([{ slug: "webgl-fluid-simulation", type: "SAVE", sessionId: "s-now" }]);
    const longTerm = behaviourProfile(earlier);
    const currentSession = buildSessionProfile({ interactions: current, now: NOW });
    expect(longTerm.signals["tag:graphics"]).toBeUndefined();
    expect(currentSession.signals["tag:systems"]).toBeUndefined();
    expect(currentSession.signals["tag:graphics"]).toBeGreaterThan(0);
    // Once the session ends its interactions become history through the same builder.
    const afterSessionEnds = behaviourProfile([...earlier, ...current]);
    expect(afterSessionEnds.signals["tag:graphics"]).toBeGreaterThan(0);
  });
});
