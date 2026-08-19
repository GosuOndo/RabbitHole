import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildSessionProfile, EMPTY_PROFILE } from "@/lib/recommender/profile";
import { recommendForUser, runRecommendationPipeline, type RecommenderDeps } from "@/lib/recommender/recommend";
import {
  NOW,
  behaviourProfile,
  catalogFixture,
  fixtureLabelFor,
  interactionsOn,
  onboardingProfile,
  profileInput,
  projectBySlug,
} from "../helpers/catalog-fixture";

const catalog = catalogFixture();
const noEvidence = new Map<string, number>();

function run(profile: ReturnType<typeof profileInput>, limit = 10, evidence = noEvidence) {
  return runRecommendationPipeline({ profile, catalog, popularityEvidence: evidence, labelFor: fixtureLabelFor, limit });
}

describe("runRecommendationPipeline", () => {
  it("returns unique projects, respects the limit and keeps every score finite", () => {
    const output = run(profileInput(onboardingProfile(["systems", "databases", "networking"])), 10);
    expect(output.items).toHaveLength(10);
    expect(new Set(output.items.map((i) => i.projectId)).size).toBe(10);
    output.items.forEach((item, index) => {
      expect(item.rank).toBe(index + 1);
      expect(Number.isFinite(item.score)).toBe(true);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      for (const value of Object.values(item.breakdown)) expect(Number.isFinite(value)).toBe(true);
      expect(item.explanation.text.length).toBeGreaterThan(0);
      expect(item.sources.length).toBeGreaterThan(0);
    });
    expect(run(profileInput(onboardingProfile(["systems"])), 3).items).toHaveLength(3);
  });

  it("excludes disliked, built and completed projects but not merely opened ones", () => {
    const longTerm = behaviourProfile(
      interactionsOn([
        { slug: "build-your-own-redis", type: "SAVE" },
        { slug: "write-an-http-server", type: "OPEN" },
        { slug: "implement-a-dns-resolver", type: "DISLIKE" },
        { slug: "implement-a-tiny-database", type: "BUILD" },
        { slug: "sqlite-file-format-reader", type: "COMPLETE" },
      ]),
    );
    const excluded = new Set(["implement-a-dns-resolver", "implement-a-tiny-database", "sqlite-file-format-reader"]);
    const output = run(profileInput(longTerm, { excludedProjectIds: excluded, savedProjectIds: new Set(["build-your-own-redis"]) }), 30);
    const ids = new Set(output.items.map((i) => i.projectId));
    for (const id of excluded) expect(ids.has(id)).toBe(false);
    expect(ids.has("write-an-http-server")).toBe(true);
    // Saved projects stay eligible but are demoted.
    const redis = output.items.find((i) => i.projectId === "build-your-own-redis");
    expect(redis?.saved).toBe(true);
    expect(output.pipeline.afterFiltering).toBe(output.pipeline.uniqueCandidates);
  });

  it("gives a brand-new onboarded user personalised recommendations, not just the popularity list", () => {
    const output = run(profileInput(onboardingProfile(["graphics", "creative", "games"], { difficulty: "BEGINNER", duration: "ONE_EVENING" })));
    expect(output.context.coldStart).toBe(true);
    expect(output.context.profileEmpty).toBe(false);
    expect(output.items.length).toBe(10);
    const topTags = output.items.slice(0, 5).flatMap((i) => projectBySlug(i.projectId).tagSlugs);
    expect(topTags.some((t) => ["graphics", "creative-coding", "webgl", "game-development", "procedural-generation"].includes(t))).toBe(true);
    const popularityOnly = run(profileInput(EMPTY_PROFILE));
    expect(output.items.map((i) => i.projectId)).not.toEqual(popularityOnly.items.map((i) => i.projectId));
    expect(output.items[0]!.explanation.primary).toBe("onboarding");
  });

  it("gives two users with different onboarding interests materially different recommendations", () => {
    const systems = run(profileInput(onboardingProfile(["systems", "databases", "networking"])));
    const creative = run(profileInput(onboardingProfile(["graphics", "creative", "games"])));
    const a = new Set(systems.items.map((i) => i.projectId));
    const b = new Set(creative.items.map((i) => i.projectId));
    const overlap = [...a].filter((id) => b.has(id)).length;
    expect(overlap).toBeLessThanOrEqual(2);
    expect(projectBySlug(systems.items[0]!.projectId).tagSlugs.some((t) => ["systems", "databases", "networking", "operating-systems"].includes(t))).toBe(true);
    expect(projectBySlug(creative.items[0]!.projectId).tagSlugs.some((t) => ["graphics", "creative-coding", "game-development", "webgl"].includes(t))).toBe(true);
  });

  it("falls back to popularity for a completely empty profile and explains it honestly", () => {
    const evidence = new Map([["implement-a-ray-tracer", 40]]);
    const output = run(profileInput(EMPTY_PROFILE), 5, evidence);
    expect(output.context.profileEmpty).toBe(true);
    expect(output.pipeline.contentCandidates).toBe(0);
    expect(output.items.length).toBe(5);
    expect(output.items[0]!.projectId).toBe("implement-a-ray-tracer");
    expect(output.items.every((i) => i.sources.includes("popular"))).toBe(true);
    expect(output.items.every((i) => !/Because you like/.test(i.explanation.text))).toBe(true);
  });

  it("merges sources: a project retrieved by both content and popularity keeps both", () => {
    const evidence = new Map([["build-your-own-redis", 60]]);
    const output = run(profileInput(onboardingProfile(["systems", "networking"])), 10, evidence);
    const redis = output.items.find((i) => i.projectId === "build-your-own-redis");
    expect(redis?.sources).toEqual(["content", "popular"]);
    expect(output.pipeline.contentCandidates).toBe(RECOMMENDER_CONFIG.candidateCounts.content);
    expect(output.pipeline.popularCandidates).toBe(RECOMMENDER_CONFIG.candidateCounts.popular);
    expect(output.pipeline.uniqueCandidates).toBeLessThanOrEqual(output.pipeline.contentCandidates + output.pipeline.popularCandidates);
    expect(output.pipeline.final).toBe(10);
  });

  it("modestly blends the current session into retrieval without erasing long-term taste", () => {
    const longTerm = onboardingProfile(["systems", "databases"]);
    const session = buildSessionProfile({
      interactions: interactionsOn([
        { slug: "implement-a-ray-tracer", type: "OPEN" },
        { slug: "webgl-fluid-simulation", type: "SAVE" },
        { slug: "live-shader-playground", type: "SAVE" },
      ]),
      now: NOW,
    });
    const withSession = run(profileInput(longTerm, { session }), 10);
    const without = run(profileInput(longTerm), 10);
    expect(withSession.context.sessionWeight).toBeCloseTo(RECOMMENDER_CONFIG.session.baseWeight, 10);
    expect(without.context.sessionWeight).toBe(0);
    const graphicsRank = withSession.items.filter((i) => projectBySlug(i.projectId).tagSlugs.includes("graphics")).length;
    const graphicsRankBefore = without.items.filter((i) => projectBySlug(i.projectId).tagSlugs.includes("graphics")).length;
    expect(graphicsRank).toBeGreaterThanOrEqual(graphicsRankBefore);
    // Long-term taste still leads the feed.
    expect(projectBySlug(withSession.items[0]!.projectId).tagSlugs.some((t) => ["systems", "databases"].includes(t))).toBe(true);
  });

  it("is deterministic given the same inputs", () => {
    const profile = profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }, { slug: "chip-8-emulator", type: "OPEN" }])));
    const a = run(profile, 10);
    const b = run(profile, 10);
    expect(a.items.map((i) => [i.projectId, i.score])).toEqual(b.items.map((i) => [i.projectId, i.score]));
  });
});

describe("recommendForUser", () => {
  it("loads through injected dependencies and clamps the limit to the configured bounds", async () => {
    const deps: RecommenderDeps = {
      loadProfile: async () => profileInput(onboardingProfile(["security", "networking"])),
      loadCatalog: async () => catalog,
      loadPopularityEvidence: async () => new Map(),
      loadLabelResolver: async () => fixtureLabelFor,
    };
    const result = await recommendForUser(deps, { userId: "u", limit: 999, now: NOW });
    expect(result.limit).toBe(RECOMMENDER_CONFIG.feed.maxLimit);
    expect(result.items.length).toBeLessThanOrEqual(RECOMMENDER_CONFIG.feed.maxLimit);
    expect(result.generatedAt).toBe(NOW.toISOString());
    const defaulted = await recommendForUser(deps, { userId: "u", now: NOW });
    expect(defaulted.limit).toBe(RECOMMENDER_CONFIG.feed.defaultLimit);
    const floor = await recommendForUser(deps, { userId: "u", limit: 0, now: NOW });
    expect(floor.limit).toBe(1);
  });
});
