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

  describe("collaborative wording", () => {
    const seeds = [
      { projectId: "build-your-own-redis", title: "Build your own Redis", state: "saved" as const, contribution: 1.4 },
      { projectId: "write-an-http-server", title: "Write an HTTP/1.1 server from raw sockets", state: "built" as const, contribution: 0.9 },
    ];
    const hybridWeights = { content: 0.5625, collaborative: 0.3125, popularity: 0.125 };

    it("names real seed projects and leads when collaborative evidence dominates", () => {
      const result = explainRecommendation(
        baseInput({ contentAffinity: 0.15, collaborativeScore: 0.9, collaborativeSeeds: seeds, weights: hybridWeights, sources: ["content", "collaborative"] }),
      );
      expect(result.primary).toBe("collaborative");
      expect(result.text).toBe(
        "People who liked “Build your own Redis” (which you saved) and “Write an HTTP/1.1 server from raw sockets” (which you are building) also liked this.",
      );
      const factor = result.factors.find((f) => f.kind === "collaborative")!;
      expect(factor.features.map((f) => f.label)).toEqual(["Build your own Redis", "Write an HTTP/1.1 server from raw sockets"]);
      expect(factor.strength).toBe(0.9);
    });

    it("stays secondary when content dominates, and shares the verb when both seeds share a state", () => {
      const sameState = [seeds[0]!, { ...seeds[1]!, state: "saved" as const }];
      const result = explainRecommendation(
        baseInput({ contentAffinity: 0.8, collaborativeScore: 0.5, collaborativeSeeds: sameState, weights: hybridWeights, sources: ["content", "collaborative"] }),
      );
      expect(result.primary).toBe("taste");
      expect(result.text).toMatch(/^Because you like .* projects\. People who liked “Build your own Redis” and “Write an HTTP\/1\.1 server from raw sockets”, which you saved, also liked this\.$/);
    });

    it("never claims collaborative evidence for popularity-only, content-only or onboarding-only recommendations", () => {
      const popularityOnly = explainRecommendation(baseInput({ project: projectBySlug("habit-tracker-mobile-app"), contentAffinity: 0.05, sources: ["popular"], collaborativeScore: null, collaborativeSeeds: [] }));
      expect(popularityOnly.text).not.toMatch(/People who liked/);
      const contentOnly = explainRecommendation(baseInput({ sources: ["content"], collaborativeScore: null, collaborativeSeeds: [], weights: hybridWeights }));
      expect(contentOnly.text).not.toMatch(/People who liked/);
      expect(contentOnly.factors.some((f) => f.kind === "collaborative")).toBe(false);
      const coldStart = explainRecommendation(baseInput({ coldStart: true, sources: ["content"], collaborativeScore: null, collaborativeSeeds: [] }));
      expect(coldStart.primary).toBe("onboarding");
      expect(coldStart.text).not.toMatch(/People who liked/);
      // A collaborative score without seeds, or below the threshold, is not enough to make the claim.
      const noSeeds = explainRecommendation(baseInput({ collaborativeScore: 0.9, collaborativeSeeds: [], sources: ["content", "collaborative"], weights: hybridWeights }));
      expect(noSeeds.text).not.toMatch(/People who liked/);
      const weak = explainRecommendation(baseInput({ collaborativeScore: 0.1, collaborativeSeeds: seeds, sources: ["content", "collaborative"], weights: hybridWeights }));
      expect(weak.text).not.toMatch(/People who liked/);
    });

    it("is deterministic", () => {
      const input = baseInput({ contentAffinity: 0.2, collaborativeScore: 0.8, collaborativeSeeds: seeds, weights: hybridWeights, sources: ["collaborative"] });
      expect(explainRecommendation(input)).toEqual(explainRecommendation(input));
    });
  });

  describe("novelty / exploration wording", () => {
    const adventurousWeights = { content: 0.316, collaborative: 0.211, novelty: 0.368, popularity: 0.105 };
    const familiarWeights = { content: 0.529, collaborative: 0.294, novelty: 0.059, popularity: 0.118 };
    const highNovelty = { novelty: 0.72, underexposure: 0.8, adjacency: 0.6 };

    it("uses adventurous wording only for a high preference and an exploration-sourced, genuinely novel project", () => {
      const result = explainRecommendation(
        baseInput({ contentAffinity: 0.3, sources: ["content", "exploration"], novelty: highNovelty, explorationPreference: 0.9, weights: adventurousWeights }),
      );
      expect(result.primary).toBe("novelty");
      expect(result.text).toMatch(/^You're in a more adventurous discovery mode, so RabbitHole is showing a less familiar project related to (systems|databases)\./);
      expect(result.factors.find((f) => f.kind === "novelty")!.strength).toBe(0.72);
    });

    it("explains adjacency or underexposure honestly when the preference is low, and never claims adventurous mode", () => {
      const result = explainRecommendation(
        baseInput({ contentAffinity: 0.3, sources: ["content", "exploration"], novelty: highNovelty, explorationPreference: 0.1, weights: adventurousWeights }),
      );
      expect(result.text).not.toMatch(/adventurous/);
      expect(result.text).toMatch(/A bit of a wildcard: this explores an adjacent area while still matching your (systems|databases) interests\./);
      const underexposed = explainRecommendation(
        baseInput({ contentAffinity: 0.3, sources: ["content", "exploration"], novelty: { novelty: 0.6, underexposure: 0.9, adjacency: 0.2 }, explorationPreference: 0.1, weights: adventurousWeights }),
      );
      expect(underexposed.text).toMatch(/This is less commonly explored, but still overlaps with your interest in (systems|databases)\./);
    });

    it("stays secondary when content dominates and is omitted when the project was not an exploration pick", () => {
      const secondary = explainRecommendation(
        baseInput({ contentAffinity: 0.8, sources: ["content", "exploration"], novelty: highNovelty, explorationPreference: 0.5, weights: familiarWeights }),
      );
      expect(secondary.primary).toBe("taste");
      expect(secondary.text).toMatch(/^Because you like .* projects\. A bit of a wildcard/);
      const notExploration = explainRecommendation(baseInput({ contentAffinity: 0.8, sources: ["content"], novelty: highNovelty, explorationPreference: 0.5, weights: familiarWeights }));
      expect(notExploration.text).not.toMatch(/wildcard|less commonly|adventurous/);
      // The factor is still recorded as data for the inspector.
      expect(notExploration.factors.some((f) => f.kind === "novelty")).toBe(true);
    });

    it("never turns negative affinity or mere unpopularity into novelty wording", () => {
      const disliked = explainRecommendation(
        baseInput({ project: projectBySlug("habit-tracker-mobile-app"), contentAffinity: -0.6, sources: ["exploration"], novelty: { novelty: 0.9, underexposure: 0.95, adjacency: 0 }, explorationPreference: 1, weights: adventurousWeights }),
      );
      expect(disliked.text).not.toMatch(/wildcard|less commonly|adventurous|less familiar/);
      expect(disliked.factors.some((f) => f.kind === "novelty")).toBe(false);
      const merelyUnpopular = explainRecommendation(
        baseInput({ contentAffinity: 0.5, sources: ["content"], novelty: { novelty: 0.4, underexposure: 0.5, adjacency: 0.3 }, explorationPreference: 1, weights: adventurousWeights }),
      );
      expect(merelyUnpopular.factors.some((f) => f.kind === "novelty")).toBe(false);
    });

    it("keeps collaborative wording dependent on real seeds and is deterministic", () => {
      const withSeeds = baseInput({
        contentAffinity: 0.2,
        sources: ["collaborative", "exploration"],
        novelty: highNovelty,
        explorationPreference: 0.9,
        weights: adventurousWeights,
        collaborativeScore: 0.9,
        collaborativeSeeds: [{ projectId: "build-your-own-redis", title: "Build your own Redis", state: "saved", contribution: 1 }],
      });
      const result = explainRecommendation(withSeeds);
      expect(result.text).toMatch(/People who liked “Build your own Redis”|adventurous discovery mode/);
      expect(explainRecommendation(withSeeds)).toEqual(result);
      const noSeeds = explainRecommendation({ ...withSeeds, collaborativeSeeds: [] });
      expect(noSeeds.text).not.toMatch(/People who liked/);
    });
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
