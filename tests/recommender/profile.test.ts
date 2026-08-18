import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG, interactionWeight } from "@/lib/recommender/config";
import { MS_PER_DAY } from "@/lib/recommender/decay";
import { projectFeatureVector } from "@/lib/recommender/features";
import {
  EMPTY_PROFILE,
  aggregateInteractionSignals,
  buildLongTermProfile,
  buildSessionProfile,
  normalizeSignals,
  onboardingSignalVector,
  rankFeatures,
  type OnboardingSignals,
  type ProfileInteraction,
} from "@/lib/recommender/profile";
import { dot } from "@/lib/recommender/vector";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const CFG = RECOMMENDER_CONFIG.onboarding;

const systemsProject = projectFeatureVector({ tagSlugs: ["systems", "databases"], languageSlugs: ["rust"], difficulty: "ADVANCED", estimatedHours: 40 });
const graphicsProject = projectFeatureVector({ tagSlugs: ["graphics", "webgl"], languageSlugs: ["typescript"], difficulty: "INTERMEDIATE", estimatedHours: 12 });
const mobileProject = projectFeatureVector({ tagSlugs: ["mobile"], languageSlugs: ["kotlin", "swift"], difficulty: "BEGINNER", estimatedHours: 8 });

function interaction(type: ProfileInteraction["type"], features: Record<string, number>, daysAgo = 0, sessionId = "s1"): ProfileInteraction {
  return { type, features, createdAt: new Date(NOW.getTime() - daysAgo * MS_PER_DAY), sessionId };
}

const noOnboarding: OnboardingSignals = {
  topicFeatures: [],
  chosenProjectFeatures: [],
  rejectedProjectFeatures: [],
  difficultyPreference: null,
  durationPreference: "ANYTHING",
};

describe("aggregateInteractionSignals", () => {
  it("SAVE strengthens the saved project's tags by the configured weight", () => {
    const { signals, interactionCount } = aggregateInteractionSignals([interaction("SAVE", systemsProject)], NOW, { halfLifeDays: 30 });
    expect(signals["tag:systems"]).toBeCloseTo(interactionWeight("SAVE"), 10);
    expect(signals["tag:databases"]).toBeCloseTo(interactionWeight("SAVE"), 10);
    expect(signals["lang:rust"]).toBeCloseTo(interactionWeight("SAVE") * RECOMMENDER_CONFIG.profile.featureFamilyWeights.language, 10);
    expect(interactionCount).toBe(1);
  });

  it("DISLIKE weakens the disliked project's tags", () => {
    const { signals } = aggregateInteractionSignals([interaction("DISLIKE", mobileProject)], NOW, { halfLifeDays: 30 });
    expect(signals["tag:mobile"]).toBeCloseTo(interactionWeight("DISLIKE"), 10);
    expect(signals["tag:mobile"]).toBeLessThan(0);
  });

  it("combines multiple interactions additively and leaves unrelated tags untouched", () => {
    const { signals } = aggregateInteractionSignals(
      [interaction("SAVE", systemsProject), interaction("OPEN", systemsProject), interaction("DISLIKE", mobileProject)],
      NOW,
      { halfLifeDays: 30 },
    );
    expect(signals["tag:systems"]).toBeCloseTo(interactionWeight("SAVE") + interactionWeight("OPEN"), 10);
    expect(signals["tag:mobile"]).toBeCloseTo(interactionWeight("DISLIKE"), 10);
    expect(signals["tag:graphics"]).toBeUndefined();
  });

  it("SAVE followed by DISLIKE on the same tags nets out to the configured difference", () => {
    const { signals } = aggregateInteractionSignals([interaction("SAVE", systemsProject), interaction("DISLIKE", systemsProject)], NOW, {
      halfLifeDays: 30,
    });
    expect(signals["tag:systems"]).toBeCloseTo(interactionWeight("SAVE") + interactionWeight("DISLIKE"), 10);
  });

  it("IMPRESSION is neutral: it contributes no signal and does not count", () => {
    const { signals, interactionCount } = aggregateInteractionSignals([interaction("IMPRESSION", systemsProject)], NOW, { halfLifeDays: 30 });
    expect(signals).toEqual({});
    expect(interactionCount).toBe(0);
  });

  it("applies half-life decay so recent interactions matter more than old ones", () => {
    const { signals } = aggregateInteractionSignals(
      [interaction("SAVE", systemsProject, 30), interaction("SAVE", graphicsProject, 0)],
      NOW,
      { halfLifeDays: 30 },
    );
    expect(signals["tag:systems"]).toBeCloseTo(interactionWeight("SAVE") * 0.5, 10);
    expect(signals["tag:graphics"]).toBeCloseTo(interactionWeight("SAVE"), 10);
    expect(signals["tag:graphics"]).toBeGreaterThan(signals["tag:systems"] ?? 0);
  });

  it("can disable decay (session profiles)", () => {
    const { signals } = aggregateInteractionSignals([interaction("SAVE", systemsProject, 90)], NOW, { halfLifeDays: null });
    expect(signals["tag:systems"]).toBeCloseTo(interactionWeight("SAVE"), 10);
  });
});

describe("onboardingSignalVector", () => {
  it("topic selections initialise the mapped tag features", () => {
    const vector = onboardingSignalVector({
      ...noOnboarding,
      topicFeatures: [{ "tag:systems": 1, "tag:operating-systems": 0.8 }],
    });
    expect(vector["tag:systems"]).toBeCloseTo(CFG.topicSignal, 10);
    expect(vector["tag:operating-systems"]).toBeCloseTo(CFG.topicSignal * 0.8, 10);
  });

  it("pairwise choices strengthen chosen features and mildly weaken rejected ones", () => {
    const vector = onboardingSignalVector({
      ...noOnboarding,
      chosenProjectFeatures: [systemsProject],
      rejectedProjectFeatures: [graphicsProject],
    });
    expect(vector["tag:systems"]).toBeCloseTo(CFG.pairwiseChosenSignal, 10);
    expect(vector["tag:graphics"]).toBeCloseTo(CFG.pairwiseRejectedSignal, 10);
    expect(vector["tag:graphics"]).toBeLessThan(0);
    expect(Math.abs(vector["tag:graphics"] ?? 0)).toBeLessThan(vector["tag:systems"] ?? 0);
  });

  it("stores difficulty and duration preferences as single features, skipping surprise-me / anything", () => {
    const withPrefs = onboardingSignalVector({ ...noOnboarding, difficultyPreference: "ADVANCED", durationPreference: "WEEKEND" });
    expect(withPrefs["difficulty:ADVANCED"]).toBeCloseTo(CFG.difficultySignal, 10);
    expect(withPrefs["duration:WEEKEND"]).toBeCloseTo(CFG.durationSignal, 10);
    const without = onboardingSignalVector(noOnboarding);
    expect(Object.keys(without)).toHaveLength(0);
  });
});

describe("normalizeSignals", () => {
  it("is deterministic and orders keys", () => {
    const a = normalizeSignals({ "tag:z": 1, "tag:a": 2 });
    const b = normalizeSignals({ "tag:a": 2, "tag:z": 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a.signals)).toEqual(["tag:a", "tag:z"]);
  });

  it("produces a unit vector and max-abs strengths while preserving signs", () => {
    const { vector, strengths, norm } = normalizeSignals({ "tag:systems": 3, "tag:mobile": -4 });
    expect(norm).toBeCloseTo(5, 10);
    expect(vector["tag:systems"]).toBeCloseTo(0.6, 10);
    expect(vector["tag:mobile"]).toBeCloseTo(-0.8, 10);
    expect(strengths["tag:mobile"]).toBeCloseTo(-1, 10);
    expect(strengths["tag:systems"]).toBeCloseTo(0.75, 10);
    expect(Math.sqrt(Object.values(vector).reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 10);
  });

  it("handles empty and all-zero input without NaN or Infinity", () => {
    const empty = normalizeSignals({});
    expect(empty).toEqual({ signals: {}, vector: {}, strengths: {}, norm: 0 });
    const zeros = normalizeSignals({ "tag:a": 0, "tag:b": 0 });
    expect(zeros.norm).toBe(0);
    expect(zeros.vector).toEqual({});
    for (const value of [...Object.values(zeros.vector), ...Object.values(zeros.strengths)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("drops non-finite contributions instead of poisoning the profile", () => {
    const { signals } = normalizeSignals({ "tag:a": 1, "tag:b": Number.NaN, "tag:c": Number.POSITIVE_INFINITY });
    expect(signals).toEqual({ "tag:a": 1 });
  });
});

describe("buildLongTermProfile", () => {
  it("returns the empty profile shape for a user with no history and no onboarding", () => {
    const profile = buildLongTermProfile({ interactions: [], onboarding: null, now: NOW });
    expect(profile.norm).toBe(0);
    expect(profile.vector).toEqual({});
    expect(profile.interactionCount).toBe(0);
    expect(profile.includesOnboarding).toBe(false);
    expect(profile).toMatchObject({ signals: EMPTY_PROFILE.signals });
  });

  it("onboarding interests create a useful initial preference for a new user", () => {
    const profile = buildLongTermProfile({
      interactions: [],
      onboarding: { ...noOnboarding, topicFeatures: [{ "tag:systems": 1, "tag:operating-systems": 0.8 }], difficultyPreference: "ADVANCED" },
      now: NOW,
    });
    expect(profile.includesOnboarding).toBe(true);
    expect(profile.norm).toBeGreaterThan(0);
    const top = rankFeatures(profile, { family: "tag", limit: 1 })[0];
    expect(top?.id).toBe("tag:systems");
    expect(profile.strengths["tag:systems"]).toBeCloseTo(1, 10);
  });

  it("pairwise choices change preference strength", () => {
    const base = buildLongTermProfile({ interactions: [], onboarding: { ...noOnboarding, topicFeatures: [{ "tag:systems": 1 }] }, now: NOW });
    const withChoice = buildLongTermProfile({
      interactions: [],
      onboarding: { ...noOnboarding, topicFeatures: [{ "tag:systems": 1 }], chosenProjectFeatures: [graphicsProject], rejectedProjectFeatures: [mobileProject] },
      now: NOW,
    });
    expect(base.signals["tag:graphics"]).toBeUndefined();
    expect(withChoice.signals["tag:graphics"]).toBeCloseTo(CFG.pairwiseChosenSignal, 10);
    expect(withChoice.signals["tag:mobile"]).toBeCloseTo(CFG.pairwiseRejectedSignal, 10);
    expect(withChoice.norm).toBeGreaterThan(base.norm);
  });

  it("combines onboarding with behaviour: repeated saves overtake the onboarding prior", () => {
    const profile = buildLongTermProfile({
      interactions: [interaction("SAVE", graphicsProject), interaction("SAVE", graphicsProject), interaction("BUILD", graphicsProject)],
      onboarding: { ...noOnboarding, topicFeatures: [{ "tag:systems": 1 }] },
      now: NOW,
    });
    const ranked = rankFeatures(profile, { family: "tag" });
    // graphics and webgl tie (same project); both outrank the onboarding-only systems tag.
    expect(ranked.slice(0, 2).map((f) => f.id).sort()).toEqual(["tag:graphics", "tag:webgl"]);
    expect(ranked[2]?.id).toBe("tag:systems");
    expect(profile.signals["tag:graphics"]).toBeGreaterThan(profile.signals["tag:systems"] ?? 0);
    expect(profile.interactionCount).toBe(3);
  });
});

describe("long-term vs session profiles", () => {
  const history = [
    interaction("SAVE", systemsProject, 20, "old-session"),
    interaction("BUILD", systemsProject, 10, "old-session"),
    interaction("SAVE", systemsProject, 5, "old-session"),
  ];
  const currentSession = [interaction("OPEN", graphicsProject, 0, "current"), interaction("SAVE", graphicsProject, 0, "current")];

  it("historical interactions appear in the long-term profile", () => {
    const longTerm = buildLongTermProfile({ interactions: [...history, ...currentSession], onboarding: null, now: NOW });
    expect(longTerm.signals["tag:systems"]).toBeGreaterThan(0);
    expect(longTerm.signals["tag:graphics"]).toBeGreaterThan(0);
    expect(longTerm.signals["tag:systems"]).toBeGreaterThan(longTerm.signals["tag:graphics"] ?? 0);
    // systems and databases tie (same project) and are ranked alphabetically.
    expect(rankFeatures(longTerm, { family: "tag", limit: 2 }).map((f) => f.id)).toEqual(["tag:databases", "tag:systems"]);
  });

  it("the session profile only contains the current session's interactions", () => {
    const session = buildSessionProfile({ interactions: currentSession, now: NOW });
    expect(session.signals["tag:graphics"]).toBeGreaterThan(0);
    expect(session.signals["tag:systems"]).toBeUndefined();
    expect(session.includesOnboarding).toBe(false);
    expect(session.interactionCount).toBe(2);
  });

  it("a session profile can differ materially from long-term taste", () => {
    const longTerm = buildLongTermProfile({ interactions: history, onboarding: null, now: NOW });
    const session = buildSessionProfile({ interactions: currentSession, now: NOW });
    const cosine = dot(longTerm.vector, session.vector);
    expect(cosine).toBeLessThan(0.2);
    expect(["tag:systems", "tag:databases"]).toContain(rankFeatures(longTerm, { family: "tag", limit: 1 })[0]?.id);
    expect(["tag:graphics", "tag:webgl"]).toContain(rankFeatures(session, { family: "tag", limit: 1 })[0]?.id);
    expect(longTerm.signals["tag:graphics"]).toBeUndefined();
    expect(session.signals["tag:systems"]).toBeUndefined();
  });
});

describe("rankFeatures", () => {
  const profile = buildLongTermProfile({
    interactions: [interaction("SAVE", systemsProject), interaction("OPEN", graphicsProject), interaction("DISLIKE", mobileProject)],
    onboarding: null,
    now: NOW,
  });

  it("orders positive features by signal with a deterministic tie-break", () => {
    const tags = rankFeatures(profile, { family: "tag" });
    expect(tags.map((t) => t.id)).toEqual(["tag:databases", "tag:systems", "tag:graphics", "tag:webgl"]);
    expect(tags[0]?.strength).toBeCloseTo(profile.strengths["tag:databases"] ?? 0, 10);
  });

  it("lists negative features separately with family-relative strengths", () => {
    const negatives = rankFeatures(profile, { family: "tag", sign: "negative" });
    expect(negatives.map((t) => t.id)).toEqual(["tag:mobile"]);
    expect(negatives[0]?.familyStrength).toBeCloseTo(-1, 10);
    const languages = rankFeatures(profile, { family: "language" });
    expect(languages[0]?.familyStrength).toBeCloseTo(1, 10);
  });

  it("respects the limit", () => {
    expect(rankFeatures(profile, { limit: 2 })).toHaveLength(2);
  });
});
