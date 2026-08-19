import { describe, expect, it } from "vitest";
import { explainRecommendation, proseLabel, type ExplanationInput } from "@/lib/recommender/explain";
import { buildSessionProfile } from "@/lib/recommender/profile";
import { cosineSimilarity } from "@/lib/recommender/similarity";
import { NOW, behaviourProfile, fixtureLabelFor, interactionsOn, onboardingProfile, projectBySlug } from "../helpers/catalog-fixture";

function baseInput(overrides: Partial<ExplanationInput>): ExplanationInput {
  const project = projectBySlug("build-your-own-redis");
  return {
    project,
    longTerm: onboardingProfile(["systems", "databases"]),
    session: null,
    contentAffinity: 0.7,
    sessionAffinity: null,
    popularityScore: 0.9,
    sources: ["content", "popular"],
    coldStart: false,
    labelFor: fixtureLabelFor,
    ...overrides,
  };
}

describe("explainRecommendation", () => {
  it("names the actual overlapping tags for a long-term taste match", () => {
    const result = explainRecommendation(baseInput({}));
    expect(result.primary).toBe("taste");
    expect(result.text).toMatch(/^Because you like (systems and databases|databases and systems) projects\./);
    const taste = result.factors.find((f) => f.kind === "taste")!;
    expect(taste.features.map((f) => f.id).sort()).toEqual(["tag:databases", "tag:systems"]);
  });

  it("uses the onboarding wording for cold-start users", () => {
    const result = explainRecommendation(baseInput({ coldStart: true }));
    expect(result.primary).toBe("onboarding");
    expect(result.text).toMatch(/^Based on the interests you selected during onboarding: /);
  });

  it("never claims taste when the profile has no overlap with the project", () => {
    const project = projectBySlug("habit-tracker-mobile-app");
    const result = explainRecommendation(baseInput({ project, contentAffinity: 0.05, sources: ["popular"], popularityScore: 0.8 }));
    expect(result.text).not.toMatch(/Because you like/);
    expect(result.primary).toBe("popularity");
    expect(result.text).toBe("Popular with RabbitHole users — a good place to start.");
  });

  it("mentions the related interest when a popular project has a weak but real overlap", () => {
    const result = explainRecommendation(baseInput({ contentAffinity: 0.1, sources: ["popular"], popularityScore: 0.9 }));
    expect(result.primary).toBe("popularity");
    expect(result.text).toMatch(/^Popular with RabbitHole users, and related to your interest in (systems|databases)\./);
  });

  it("makes no collaborative claims", () => {
    for (const affinity of [0.9, 0.3, 0.05, 0]) {
      const result = explainRecommendation(baseInput({ contentAffinity: affinity }));
      expect(result.text).not.toMatch(/similar (interests|users)|people (like|who)/i);
    }
  });

  it("describes difficulty / duration / language fit from positive profile features", () => {
    const longTerm = onboardingProfile(["systems"], { difficulty: "INTERMEDIATE", duration: "WEEKEND" });
    const project = projectBySlug("build-your-own-redis"); // INTERMEDIATE, 20h → weekend, rust/go/c
    const withBehaviour = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]), {
      topicFeatures: [{ "tag:systems": 1 }],
      chosenProjectFeatures: [],
      rejectedProjectFeatures: [],
      difficultyPreference: "INTERMEDIATE",
      durationPreference: "WEEKEND",
    });
    const result = explainRecommendation(baseInput({ project, longTerm: withBehaviour, contentAffinity: 0.8 }));
    expect(result.text).toMatch(/Fits your preference for weekend-sized intermediate (Rust|Go|C) projects\./);
    expect(result.factors.some((f) => f.kind === "fit")).toBe(true);
    // Onboarding-only profile with preferences also yields a fit sentence when tags overlap.
    const onboardingOnly = explainRecommendation(baseInput({ project, longTerm, contentAffinity: 0.6, coldStart: true }));
    expect(onboardingOnly.text).toContain("Fits your preference for weekend-sized intermediate projects.");
  });

  it("surfaces session exploration when the session profile overlaps", () => {
    const project = projectBySlug("webgl-fluid-simulation");
    const session = buildSessionProfile({ interactions: interactionsOn([{ slug: "implement-a-ray-tracer", type: "OPEN" }, { slug: "live-shader-playground", type: "SAVE" }]), now: NOW });
    const sessionAffinity = cosineSimilarity(session.vector, project.vector);
    const longTerm = onboardingProfile(["systems"]);
    const result = explainRecommendation(baseInput({ project, longTerm, session, sessionAffinity, contentAffinity: 0.3, sources: ["content"] }));
    expect(result.primary).toBe("session");
    expect(result.text).toMatch(/^You recently explored .* projects in this session\./);
    expect(result.factors.find((f) => f.kind === "session")!.features.length).toBeGreaterThan(0);
  });

  it("falls back to a neutral catalog sentence when nothing supports a claim", () => {
    const result = explainRecommendation(baseInput({ project: projectBySlug("habit-tracker-mobile-app"), contentAffinity: 0, popularityScore: 0.1, sources: ["popular"] }));
    expect(result.primary).toBe("catalog");
    expect(result.text).toBe("From the RabbitHole catalog.");
  });

  it("is deterministic and lowercases prose labels sensibly", () => {
    const a = explainRecommendation(baseInput({}));
    const b = explainRecommendation(baseInput({}));
    expect(a).toEqual(b);
    expect(proseLabel("Machine Learning")).toBe("machine learning");
    expect(proseLabel("WebGL")).toBe("WebGL");
    expect(proseLabel("Terminal UI")).toBe("terminal UI");
    expect(proseLabel("IoT")).toBe("IoT");
  });
});
