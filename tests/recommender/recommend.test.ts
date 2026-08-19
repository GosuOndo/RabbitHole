import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildSessionProfile, EMPTY_PROFILE } from "@/lib/recommender/profile";
import { recommendForUser, runRecommendationPipeline, type RecommenderDeps } from "@/lib/recommender/recommend";
import type { CollaborativeInteraction } from "@/lib/recommender/types";
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
import { clusterInteractions, ev } from "../helpers/collaborative-fixture";

const catalog = catalogFixture();
const noEvidence = new Map<string, number>();

function run(profile: ReturnType<typeof profileInput>, limit = 10, evidence = noEvidence, interactions: CollaborativeInteraction[] = []) {
  return runRecommendationPipeline({ userId: "target", profile, catalog, popularityEvidence: evidence, interactions, labelFor: fixtureLabelFor, limit });
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
      for (const value of Object.values(item.breakdown)) expect(value === null || Number.isFinite(value)).toBe(true);
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

describe("hybrid pipeline with collaborative filtering", () => {
  const rows = clusterInteractions();
  const systemsHistory = [
    ...rows,
    ev("target", "build-your-own-redis", "SAVE"),
    ev("target", "write-an-http-server", "BUILD"),
    ev("target", "implement-a-tiny-database", "OPEN"),
  ];

  it("adds collaborative candidates and uses the hybrid weights when the user has behavioural seeds", () => {
    const longTerm = behaviourProfile(
      interactionsOn([
        { slug: "build-your-own-redis", type: "SAVE" },
        { slug: "write-an-http-server", type: "BUILD" },
        { slug: "implement-a-tiny-database", type: "OPEN" },
      ]),
    );
    expect(longTerm.interactionCount).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.coldStart.maxInteractions);
    const output = run(profileInput(longTerm, { excludedProjectIds: new Set(["write-an-http-server"]) }), 10, noEvidence, systemsHistory);
    expect(output.pipeline.collaborativeCandidates).toBeGreaterThan(0);
    expect(output.context.collaborative.available).toBe(true);
    expect(output.context.collaborative.seedCount).toBe(3);
    expect(output.context.coldStart).toBe(false);
    expect(output.context.components).toEqual(["content", "collaborative", "popularity"]);
    const [first] = output.items;
    expect(first!.weights.content).toBeCloseTo(0.5625, 4);
    expect(first!.weights.collaborative).toBeCloseTo(0.3125, 4);
    expect(first!.weights.popularity).toBeCloseTo(0.125, 4);
    // A cold-start user with seeds keeps the popularity boost but still gets the collaborative component.
    const cold = run(profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]))), 10, noEvidence, systemsHistory);
    expect(cold.context.coldStart).toBe(true);
    expect(cold.context.components).toEqual(["content", "collaborative", "popularity"]);
    expect(cold.items[0]!.weights.popularity).toBeCloseTo(0.3, 4);
    expect(cold.items[0]!.weights.content).toBeCloseTo(0.45, 4);
    expect(cold.items[0]!.weights.collaborative).toBeCloseTo(0.25, 4);
    const collaborativeItems = output.items.filter((i) => i.sources.includes("collaborative"));
    expect(collaborativeItems.length).toBeGreaterThan(0);
    for (const item of collaborativeItems) {
      expect(item.breakdown.collaborative).not.toBeNull();
      expect(item.breakdown.collaborative!).toBeGreaterThan(0);
      expect(item.collaborative?.seeds.length).toBeGreaterThan(0);
      expect(item.collaborative!.seeds.every((s) => ["build-your-own-redis", "write-an-http-server", "implement-a-tiny-database"].includes(s.projectId))).toBe(true);
    }
    const contentOnly = output.items.find((i) => !i.sources.includes("collaborative"));
    if (contentOnly) {
      expect(contentOnly.breakdown.collaborative).toBeNull();
      expect(contentOnly.collaborative).toBeNull();
    }
    // The behavioural neighbour of the seeds is a top result and never a seed itself.
    expect(output.items.slice(0, 3).map((i) => i.projectId)).toContain("implement-a-dns-resolver");
    expect(output.items.some((i) => i.projectId === "write-an-http-server")).toBe(false);
  });

  it("with no behavioural history the collaborative component is absent (not fabricated)", () => {
    const output = run(profileInput(onboardingProfile(["systems", "databases"])), 10, noEvidence, rows);
    expect(output.pipeline.collaborativeCandidates).toBe(0);
    expect(output.context.collaborative).toMatchObject({ available: false, seedCount: 0, confidence: 0 });
    expect(output.context.components).toEqual(["content", "popularity"]);
    for (const item of output.items) {
      expect(item.breakdown.collaborative).toBeNull();
      expect(item.sources).not.toContain("collaborative");
      expect(item.explanation.text).not.toMatch(/People who liked/);
    }
  });

  it("impressions alone create no collaborative evidence", () => {
    const impressions = [...rows, ev("target", "build-your-own-redis", "IMPRESSION"), ev("target", "write-an-http-server", "IMPRESSION")];
    const output = run(profileInput(onboardingProfile(["systems"])), 10, noEvidence, impressions);
    expect(output.pipeline.collaborativeCandidates).toBe(0);
    expect(output.context.collaborative.available).toBe(false);
  });

  it("collaborative history changes the ranking even when content preferences are identical", () => {
    const sharedProfile = profileInput(onboardingProfile(["systems", "graphics"]));
    const systemsUser = [...rows, ev("target", "build-your-own-redis", "SAVE"), ev("target", "write-an-http-server", "BUILD")];
    const graphicsUser = [...rows, ev("target", "implement-a-ray-tracer", "SAVE"), ev("target", "live-shader-playground", "BUILD")];
    const a = run(sharedProfile, 10, noEvidence, systemsUser);
    const b = run(sharedProfile, 10, noEvidence, graphicsUser);
    expect(a.items.map((i) => i.projectId)).not.toEqual(b.items.map((i) => i.projectId));
    const rankOf = (items: typeof a.items, id: string) => items.findIndex((i) => i.projectId === id);
    // dns is a systems-cluster neighbour; fluid simulation a graphics-cluster neighbour.
    expect(rankOf(a.items, "implement-a-dns-resolver")).toBeGreaterThanOrEqual(0);
    expect(rankOf(b.items, "webgl-fluid-simulation")).toBeGreaterThanOrEqual(0);
    const dnsInA = rankOf(a.items, "implement-a-dns-resolver");
    const dnsInB = rankOf(b.items, "implement-a-dns-resolver");
    expect(dnsInB === -1 || dnsInA < dnsInB).toBe(true);
    const fluidInB = rankOf(b.items, "webgl-fluid-simulation");
    const fluidInA = rankOf(a.items, "webgl-fluid-simulation");
    expect(fluidInA === -1 || fluidInB < fluidInA).toBe(true);
    expect(a.items.find((i) => i.projectId === "implement-a-dns-resolver")!.breakdown.collaborative).toBeGreaterThan(0);
    expect(b.items.find((i) => i.projectId === "webgl-fluid-simulation")!.breakdown.collaborative).toBeGreaterThan(0);
  });

  it("collaborative candidates never bypass terminal-state exclusions", () => {
    const longTerm = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]));
    const excluded = new Set(["implement-a-dns-resolver", "implement-a-tiny-database"]);
    const output = run(profileInput(longTerm, { excludedProjectIds: excluded }), 30, noEvidence, systemsHistory);
    for (const id of excluded) expect(output.items.some((i) => i.projectId === id)).toBe(false);
    expect(output.pipeline.afterFiltering).toBe(output.pipeline.uniqueCandidates);
  });

  it("a project with no collaborative history is still recommendable through content", () => {
    // implement-raft-consensus never appears in the behavioural fixture.
    const longTerm = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }, { slug: "write-an-http-server", type: "BUILD" }]));
    const output = run(profileInput(onboardingProfile(["distributed", "systems"], { chosen: ["implement-raft-consensus"] })), 30, noEvidence, systemsHistory);
    void longTerm;
    const raft = output.items.find((i) => i.projectId === "implement-raft-consensus");
    expect(raft).toBeDefined();
    expect(raft!.sources).toContain("content");
    expect(raft!.sources).not.toContain("collaborative");
    expect(raft!.breakdown.collaborative).toBeNull();
    expect(raft!.breakdown.content).toBeGreaterThan(0);
  });

  it("explains collaborative recommendations by naming real seed projects, and only those", () => {
    const longTerm = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }, { slug: "write-an-http-server", type: "BUILD" }]));
    const output = run(profileInput(longTerm), 10, noEvidence, systemsHistory);
    const collaborative = output.items.filter((i) => i.explanation.factors.some((f) => f.kind === "collaborative"));
    expect(collaborative.length).toBeGreaterThan(0);
    for (const item of collaborative) {
      expect(item.sources).toContain("collaborative");
      expect(item.breakdown.collaborative!).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.explanation.minCollaborative);
      expect(item.explanation.text).toMatch(/People who liked “/);
      const named = item.explanation.factors.find((f) => f.kind === "collaborative")!.features.map((f) => f.label);
      for (const title of named) expect(["Build your own Redis", "Write an HTTP/1.1 server from raw sockets", "Implement a tiny database"]).toContain(title);
    }
    for (const item of output.items.filter((i) => !i.sources.includes("collaborative"))) {
      expect(item.explanation.text).not.toMatch(/People who liked/);
    }
  });

  it("is deterministic with the collaborative component", () => {
    const longTerm = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]));
    const a = run(profileInput(longTerm), 10, noEvidence, systemsHistory);
    const b = run(profileInput(longTerm), 10, noEvidence, systemsHistory);
    expect(a.items.map((i) => [i.projectId, i.score, i.breakdown.collaborative])).toEqual(b.items.map((i) => [i.projectId, i.score, i.breakdown.collaborative]));
  });
});

describe("recommendForUser", () => {
  it("loads through injected dependencies and clamps the limit to the configured bounds", async () => {
    const deps: RecommenderDeps = {
      loadProfile: async () => profileInput(onboardingProfile(["security", "networking"])),
      loadCatalog: async () => catalog,
      loadPopularityEvidence: async () => new Map(),
      loadCollaborativeInteractions: async () => [],
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
