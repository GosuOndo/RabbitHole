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
    expect(output.pipeline.afterFiltering).toBe(output.pipeline.uniqueCandidates);
    // Saved projects stay eligible but are demoted (score × 0.6 with everything else equal).
    const withoutSave = run(profileInput(longTerm, { excludedProjectIds: excluded }), 100);
    const withSave = run(profileInput(longTerm, { excludedProjectIds: excluded, savedProjectIds: new Set(["build-your-own-redis"]) }), 100);
    const plain = withoutSave.items.find((i) => i.projectId === "build-your-own-redis")!;
    const demoted = withSave.items.find((i) => i.projectId === "build-your-own-redis")!;
    expect(demoted.saved).toBe(true);
    expect(demoted.score).toBeCloseTo(plain.score * RECOMMENDER_CONFIG.filtering.savedProjectScoreMultiplier, 10);
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
    expect(output.context.components).toEqual(["content", "collaborative", "novelty", "popularity"]);
    // Familiar (e = 0): 0.45 / 0.25 / 0.05 / 0.10 renormalised over the four available components.
    const [first] = output.items;
    expect(first!.weights.content).toBeCloseTo(0.45 / 0.85, 4);
    expect(first!.weights.collaborative).toBeCloseTo(0.25 / 0.85, 4);
    expect(first!.weights.novelty).toBeCloseTo(0.05 / 0.85, 4);
    expect(first!.weights.popularity).toBeCloseTo(0.1 / 0.85, 4);
    // A cold-start user with seeds keeps the popularity boost but still gets the collaborative component.
    const cold = run(profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]))), 10, noEvidence, systemsHistory);
    expect(cold.context.coldStart).toBe(true);
    expect(cold.context.components).toEqual(["content", "collaborative", "novelty", "popularity"]);
    expect(cold.items[0]!.weights.popularity).toBeCloseTo(0.3 / 1.05, 4);
    expect(cold.items[0]!.weights.content).toBeCloseTo(0.45 / 1.05, 4);
    expect(cold.items[0]!.weights.collaborative).toBeCloseTo(0.25 / 1.05, 4);
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
    expect(output.context.components).toEqual(["content", "novelty", "popularity"]);
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

describe("exploration, novelty and diversification in the pipeline", () => {
  const rows = clusterInteractions();
  const behaviour = interactionsOn([
    { slug: "build-your-own-redis", type: "SAVE" },
    { slug: "write-an-http-server", type: "BUILD" },
    { slug: "implement-a-tiny-database", type: "OPEN" },
    { slug: "implement-a-dns-resolver", type: "SAVE" },
  ]);
  const history = [
    ...rows,
    ev("target", "build-your-own-redis", "SAVE"),
    ev("target", "write-an-http-server", "BUILD"),
    ev("target", "implement-a-tiny-database", "OPEN"),
    ev("target", "implement-a-dns-resolver", "SAVE"),
  ];
  const evidence = new Map<string, number>(catalog.map((p) => [p.id, Math.round(p.popularity * 40)]));
  const at = (e: number, limit = 10) =>
    run(profileInput(behaviourProfile(behaviour), { explorationPreference: e, excludedProjectIds: new Set(["write-an-http-server"]) }), limit, evidence, history);
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);

  it("adds exploration as a genuine fourth source with breadth that grows with the preference", () => {
    const familiar = at(0);
    const adventurous = at(1);
    expect(familiar.pipeline.explorationCandidates).toBe(RECOMMENDER_CONFIG.exploration.retrieval.minCandidates);
    expect(adventurous.pipeline.explorationCandidates).toBe(RECOMMENDER_CONFIG.exploration.retrieval.maxCandidates);
    expect(familiar.context.exploration).toMatchObject({ preference: 0, mode: "familiar", candidateLimit: 8 });
    expect(adventurous.context.exploration).toMatchObject({ preference: 1, mode: "adventurous", candidateLimit: 15 });
    expect(familiar.context.components).toEqual(["content", "collaborative", "novelty", "popularity"]);
    for (const item of [...familiar.items, ...adventurous.items]) {
      expect(item.breakdown.novelty).not.toBeNull();
      expect(item.novelty.novelty).toBeGreaterThanOrEqual(0);
      expect(item.novelty.novelty).toBeLessThanOrEqual(1);
      if (item.sources.includes("exploration")) {
        expect(item.exploration).not.toBeNull();
        expect(item.exploration!.plausibility).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.exploration.retrieval.minPlausibility);
      } else {
        expect(item.exploration).toBeNull();
      }
    }
  });

  it("changes ranking weights, novelty and composition between Familiar and Adventurous while staying relevant", () => {
    const familiar = at(0);
    const adventurous = at(1);
    expect(familiar.items[0]!.weights.novelty!).toBeLessThan(adventurous.items[0]!.weights.novelty!);
    expect(familiar.items[0]!.weights.content!).toBeGreaterThan(adventurous.items[0]!.weights.content!);
    const familiarIds = new Set(familiar.items.map((i) => i.projectId));
    const adventurousIds = new Set(adventurous.items.map((i) => i.projectId));
    const overlap = [...familiarIds].filter((id) => adventurousIds.has(id)).length;
    expect(overlap).toBeLessThan(10);
    expect(mean(adventurous.items.map((i) => i.novelty.novelty))).toBeGreaterThan(mean(familiar.items.map((i) => i.novelty.novelty)));
    expect(mean(familiar.items.map((i) => i.breakdown.content ?? 0))).toBeGreaterThanOrEqual(mean(adventurous.items.map((i) => i.breakdown.content ?? 0)));
    // Adventurous picks remain plausible: every item keeps a positive content affinity or collaborative evidence.
    for (const item of adventurous.items) {
      expect((item.breakdown.content ?? 0) > 0 || (item.breakdown.collaborative ?? 0) > 0).toBe(true);
    }
    const uniqueTags = (items: typeof familiar.items) => new Set(items.flatMap((i) => projectBySlug(i.projectId).tagSlugs)).size;
    expect(uniqueTags(adventurous.items)).toBeGreaterThanOrEqual(uniqueTags(familiar.items));
  });

  it("diversifies after ranking: preserves the top item, records pre/final ranks, keeps scores and never duplicates", () => {
    const output = at(0.35);
    expect(output.items[0]!.preDiversificationRank).toBe(1);
    expect(output.items[0]!.rank).toBe(1);
    expect(output.items.some((i) => i.rank !== i.preDiversificationRank)).toBe(true);
    expect(new Set(output.items.map((i) => i.projectId)).size).toBe(output.items.length);
    expect(output.pipeline.preDiversificationCandidates).toBe(output.pipeline.ranked);
    expect(output.pipeline.diversifiedCandidates).toBe(output.items.length);
    expect(output.context.diversification.applied).toBe(true);
    expect(output.context.diversification.lambda).toBeCloseTo(0.83, 6);
    // Recommendation scores are the hybrid scores (unchanged by MMR); mmrScore is diagnostic only.
    const byRank = [...output.items].sort((a, b) => a.preDiversificationRank - b.preDiversificationRank);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1]!.score).toBeGreaterThanOrEqual(byRank[i]!.score);
    for (const item of output.items) expect(item.diversification.mmrScore).toBeLessThanOrEqual(item.score);
  });

  it("keeps terminal exclusions and the collaborative confidence scaling intact under exploration", () => {
    const sparse = [...rows, ev("target", "build-your-own-redis", "OPEN")];
    const output = run(profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "OPEN" }])), { explorationPreference: 1, excludedProjectIds: new Set(["implement-a-dns-resolver"]) }), 10, evidence, sparse);
    expect(output.context.collaborative.confidence).toBeCloseTo(0.5 / RECOMMENDER_CONFIG.collaborative.fullConfidenceSeedWeight, 6);
    expect(output.items.some((i) => i.projectId === "implement-a-dns-resolver")).toBe(false);
    for (const item of output.items) if (item.breakdown.collaborative !== null) expect(item.breakdown.collaborative).toBeLessThanOrEqual(output.context.collaborative.confidence + 1e-9);
  });

  it("is deterministic for the same preference", () => {
    const a = at(0.7);
    const b = at(0.7);
    expect(a.items.map((i) => [i.projectId, i.score, i.rank])).toEqual(b.items.map((i) => [i.projectId, i.score, i.rank]));
  });
});

describe("cold start with exploration", () => {
  const evidence = new Map<string, number>(catalog.map((p) => [p.id, Math.round(p.popularity * 40)]));
  const rows = clusterInteractions();

  it("onboarding-only user: content + popularity + exploration + novelty work and the preference changes the feed", () => {
    const profile = onboardingProfile(["systems", "databases", "networking"], { difficulty: "ADVANCED", duration: "WEEKEND" });
    const familiar = run(profileInput(profile, { explorationPreference: 0 }), 10, evidence, rows);
    const adventurous = run(profileInput(profile, { explorationPreference: 1 }), 10, evidence, rows);
    for (const output of [familiar, adventurous]) {
      expect(output.context.collaborative.available).toBe(false);
      expect(output.context.components).toEqual(["content", "novelty", "popularity"]);
      expect(output.pipeline.explorationCandidates).toBeGreaterThan(0);
      expect(output.items).toHaveLength(10);
      expect(output.items.every((i) => i.breakdown.collaborative === null)).toBe(true);
    }
    expect(familiar.items.map((i) => i.projectId)).not.toEqual(adventurous.items.map((i) => i.projectId));
    // Onboarding taste is not abandoned: adventurous items still overlap the chosen topics.
    const onTopic = adventurous.items.filter((i) => projectBySlug(i.projectId).tagSlugs.some((t) => ["systems", "databases", "networking", "operating-systems", "distributed-systems", "concurrency"].includes(t))).length;
    expect(onTopic).toBeGreaterThanOrEqual(6);
  });

  it("completely empty user: popularity + novelty with broader coverage as exploration rises", () => {
    const familiar = run(profileInput(EMPTY_PROFILE, { explorationPreference: 0 }), 10, evidence, rows);
    const adventurous = run(profileInput(EMPTY_PROFILE, { explorationPreference: 1 }), 10, evidence, rows);
    for (const output of [familiar, adventurous]) {
      expect(output.items).toHaveLength(10);
      expect(output.context.profileEmpty).toBe(true);
      expect(output.context.components).toEqual(["novelty", "popularity"]);
      expect(output.items.every((i) => i.breakdown.content === null && i.breakdown.collaborative === null)).toBe(true);
      expect(output.items.every((i) => !/Because you like|onboarding/.test(i.explanation.text))).toBe(true);
    }
    const uniqueTags = (items: typeof familiar.items) => new Set(items.flatMap((i) => projectBySlug(i.projectId).tagSlugs)).size;
    const meanNovelty = (items: typeof familiar.items) => items.reduce((s, i) => s + i.novelty.novelty, 0) / items.length;
    expect(uniqueTags(adventurous.items)).toBeGreaterThanOrEqual(uniqueTags(familiar.items));
    expect(meanNovelty(adventurous.items)).toBeGreaterThan(meanNovelty(familiar.items));
    // Familiar: mostly the reliable popular projects.
    expect(familiar.items.every((i) => i.sources.includes("popular"))).toBe(true);
  });

  it("new project with no collaborative history remains recommendable through content/exploration", () => {
    const profile = onboardingProfile(["distributed", "systems"], { chosen: ["implement-raft-consensus"] });
    const withoutRaftEvidence = new Map(evidence);
    withoutRaftEvidence.set("implement-raft-consensus", 0);
    const output = run(profileInput(profile, { explorationPreference: 0.5 }), 40, withoutRaftEvidence, rows);
    const raft = output.items.find((i) => i.projectId === "implement-raft-consensus");
    expect(raft).toBeDefined();
    expect(raft!.breakdown.collaborative).toBeNull();
    expect(raft!.breakdown.content).toBeGreaterThan(0.5);
    expect(raft!.preDiversificationRank).toBeLessThanOrEqual(15); // strong content/exploration signal despite zero popularity evidence
    expect(raft!.sources.some((s) => s === "content" || s === "exploration")).toBe(true);
    // Novelty alone must not carry an irrelevant rare project to the top.
    const irrelevantRare = "barcode-pantry-inventory-app";
    withoutRaftEvidence.set(irrelevantRare, 0);
    const adventurous = run(profileInput(profile, { explorationPreference: 1 }), 10, withoutRaftEvidence, rows);
    expect(adventurous.items.slice(0, 5).some((i) => i.projectId === irrelevantRare)).toBe(false);
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
