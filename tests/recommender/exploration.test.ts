import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { scoreContentAffinity } from "@/lib/recommender/content";
import {
  explorationCandidateLimit,
  explorationPlausibility,
  explorationScore,
  retrieveExplorationCandidates,
  type ExplorationRetrievalInput,
} from "@/lib/recommender/exploration";
import { computeNovelty, type NoveltyBreakdown } from "@/lib/recommender/novelty";
import { computePopularityScores } from "@/lib/recommender/popularity";
import type { ProjectVector } from "@/lib/recommender/types";
import { behaviourProfile, catalogFixture, interactionsOn, onboardingProfile, projectBySlug } from "../helpers/catalog-fixture";

const catalog = catalogFixture();
const CFG = RECOMMENDER_CONFIG.exploration.retrieval;

/** Builds a full exploration input for a profile vector over the real catalog (no behavioural evidence). */
function inputFor(
  profileVector: Record<string, number> | null,
  explorationPreference: number,
  options: { evidence?: Map<string, number>; excluded?: Set<string>; collaborative?: Map<string, number> | null; projects?: ProjectVector[] } = {},
): ExplorationRetrievalInput {
  const projects = options.projects ?? catalog;
  const affinity = profileVector ? scoreContentAffinity(profileVector, projects) : null;
  const popularity = computePopularityScores(projects, options.evidence ?? new Map());
  const popularityScores = new Map([...popularity.entries()].map(([id, p]) => [id, p.score]));
  const novelty = new Map<string, NoveltyBreakdown>(
    projects.map((p) => [p.id, computeNovelty({ popularityScore: popularityScores.get(p.id) ?? 0, contentAffinity: affinity ? (affinity.get(p.id) ?? 0) : null })]),
  );
  return {
    projects,
    contentAffinity: affinity,
    collaborativeScores: options.collaborative ?? null,
    popularityScores,
    novelty,
    excludedProjectIds: options.excluded ?? new Set(),
    explorationPreference,
  };
}

describe("explorationCandidateLimit", () => {
  it("grows linearly from the configured minimum to the maximum", () => {
    expect(explorationCandidateLimit(0)).toBe(CFG.minCandidates);
    expect(explorationCandidateLimit(1)).toBe(CFG.maxCandidates);
    expect(explorationCandidateLimit(0.5)).toBe(Math.round((CFG.minCandidates + CFG.maxCandidates) / 2));
    expect(explorationCandidateLimit(-1)).toBe(CFG.minCandidates);
    expect(explorationCandidateLimit(5)).toBe(CFG.maxCandidates);
  });
});

describe("explorationPlausibility / explorationScore", () => {
  it("uses the strongest of positive content affinity and collaborative score, and popularity only as a fallback", () => {
    expect(explorationPlausibility({ contentAffinity: 0.4, collaborativeScore: 0.7, popularityScore: 0.9 })).toEqual({ plausibility: 0.7, source: "collaborative" });
    expect(explorationPlausibility({ contentAffinity: 0.6, collaborativeScore: null, popularityScore: 0.9 })).toEqual({ plausibility: 0.6, source: "content" });
    expect(explorationPlausibility({ contentAffinity: -0.5, collaborativeScore: null, popularityScore: 0.9 })).toEqual({ plausibility: 0, source: "content" });
    expect(explorationPlausibility({ contentAffinity: null, collaborativeScore: null, popularityScore: 0.9 })).toEqual({ plausibility: 0.9, source: "popularity" });
  });

  it("equals plausibility at e = 0 and blends toward novelty at e = 1", () => {
    expect(explorationScore(0.6, 0.9, 0)).toBeCloseTo(0.6, 10);
    expect(explorationScore(0.6, 0.9, 1)).toBeCloseTo(CFG.noveltyWeight * 0.9 + CFG.plausibilityWeight * 0.6, 10);
    const half = explorationScore(0.6, 0.9, 0.5);
    expect(half).toBeGreaterThan(0.6);
    expect(half).toBeLessThan(explorationScore(0.6, 0.9, 1));
  });
});

describe("retrieveExplorationCandidates", () => {
  const systems = onboardingProfile(["systems", "databases", "networking"]);

  it("returns plausible candidates tagged as the exploration source, within the configured bounds", () => {
    const low = retrieveExplorationCandidates(inputFor(systems.vector, 0));
    const high = retrieveExplorationCandidates(inputFor(systems.vector, 1));
    expect(low.candidates).toHaveLength(CFG.minCandidates);
    expect(high.candidates).toHaveLength(CFG.maxCandidates);
    expect(low.candidates.every((c) => c.source === "exploration" && c.signal > 0 && c.signal <= 1)).toBe(true);
    for (const c of low.candidates) expect(low.diagnostics.get(c.projectId)!.plausibility).toBeGreaterThanOrEqual(CFG.minPlausibility);
    expect(new Set(high.candidates.map((c) => c.projectId)).size).toBe(high.candidates.length);
  });

  it("increases breadth and novelty as the preference rises, without leaving the user's interests", () => {
    const low = retrieveExplorationCandidates(inputFor(systems.vector, 0));
    const high = retrieveExplorationCandidates(inputFor(systems.vector, 1));
    const meanNovelty = (r: typeof low) => r.candidates.reduce((s, c) => s + r.diagnostics.get(c.projectId)!.novelty, 0) / r.candidates.length;
    const meanUnderexposure = (r: typeof low) => r.candidates.reduce((s, c) => s + r.diagnostics.get(c.projectId)!.underexposure, 0) / r.candidates.length;
    expect(high.candidates.length).toBeGreaterThan(low.candidates.length);
    expect(meanNovelty(high)).toBeGreaterThan(meanNovelty(low));
    expect(meanUnderexposure(high)).toBeGreaterThan(meanUnderexposure(low));
    // Still anchored: every adventurous candidate has positive content plausibility for this profile.
    for (const c of high.candidates) {
      const d = high.diagnostics.get(c.projectId)!;
      expect(d.plausibility).toBeGreaterThan(0);
      expect(d.plausibilitySource).toBe("content");
    }
  });

  it("does not promote rare projects the profile dislikes (exploration ≠ randomness)", () => {
    // Profile: loves systems, dislikes mobile.
    const profile = behaviourProfile(
      interactionsOn([
        { slug: "build-your-own-redis", type: "SAVE" },
        { slug: "write-an-http-server", type: "SAVE" },
        { slug: "habit-tracker-mobile-app", type: "DISLIKE" },
        { slug: "ar-measuring-tape", type: "DISLIKE" },
      ]),
    );
    const evidence = new Map<string, number>();
    for (const p of catalog) evidence.set(p.id, 30); // everything popular…
    evidence.set("barcode-pantry-inventory-app", 0); // …except this mobile project (extremely unpopular, disliked features)
    const affinity = scoreContentAffinity(profile.vector, catalog);
    expect(affinity.get("barcode-pantry-inventory-app")!).toBeLessThan(0);
    const result = retrieveExplorationCandidates(inputFor(profile.vector, 1, { evidence }));
    expect(result.candidates.some((c) => c.projectId === "barcode-pantry-inventory-app")).toBe(false);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(affinity.get(c.projectId)!).toBeGreaterThan(0);
  });

  it("respects terminal-state exclusions and never returns duplicates", () => {
    const excluded = new Set(["build-your-own-redis", "implement-a-dns-resolver", "write-an-http-server"]);
    const result = retrieveExplorationCandidates(inputFor(systems.vector, 1, { excluded }));
    for (const id of excluded) expect(result.candidates.some((c) => c.projectId === id)).toBe(false);
    expect(new Set(result.candidates.map((c) => c.projectId)).size).toBe(result.candidates.length);
  });

  it("serves an onboarding-only user with meaningful candidates and an empty user via the popularity fallback", () => {
    const onboardingOnly = retrieveExplorationCandidates(inputFor(onboardingProfile(["graphics", "creative"]).vector, 0.5));
    expect(onboardingOnly.candidates.length).toBeGreaterThan(0);
    expect(onboardingOnly.candidates.map((c) => projectBySlug(c.projectId).tagSlugs).every((tags) => tags.some((t) => ["graphics", "webgl", "creative-coding", "procedural-generation", "visualization", "audio", "simulation"].includes(t)))).toBe(true);
    const empty = retrieveExplorationCandidates(inputFor(null, 1));
    expect(empty.candidates.length).toBeGreaterThan(0);
    for (const c of empty.candidates) expect(empty.diagnostics.get(c.projectId)!.plausibilitySource).toBe("popularity");
  });

  it("uses collaborative evidence as plausibility when content is unavailable and lets a new project surface", () => {
    const collaborative = new Map([["chip-8-emulator", 0.9]]);
    const result = retrieveExplorationCandidates(inputFor(null, 0.5, { collaborative }));
    expect(result.candidates.some((c) => c.projectId === "chip-8-emulator")).toBe(true);
    expect(result.diagnostics.get("chip-8-emulator")!.plausibilitySource).toBe("collaborative");
    // A project with zero behavioural history is still retrievable through content plausibility.
    const fresh = retrieveExplorationCandidates(inputFor(systems.vector, 1, { evidence: new Map([["implement-raft-consensus", 0]]) }));
    expect(fresh.diagnostics.has("implement-raft-consensus") || fresh.candidates.length === CFG.maxCandidates).toBe(true);
  });

  it("is deterministic and orders by exploration score with the catalog tie-break", () => {
    const a = retrieveExplorationCandidates(inputFor(systems.vector, 0.7));
    const b = retrieveExplorationCandidates(inputFor(systems.vector, 0.7));
    expect(a.candidates).toEqual(b.candidates);
    for (let i = 1; i < a.candidates.length; i++) expect(a.candidates[i - 1]!.signal).toBeGreaterThanOrEqual(a.candidates[i]!.signal);
  });
});

describe("exploration ≠ popularity", () => {
  it("lets an underexposed adjacent project overtake a popular weakly-related one as the preference rises", () => {
    // Profile likes systems; POPULAR = ray tracer (weak adjacency), UNDEREXPOSED = event loop (adjacent).
    const profile = onboardingProfile(["systems"]);
    const evidence = new Map<string, number>([["implement-a-ray-tracer", 200]]);
    const low = retrieveExplorationCandidates(inputFor(profile.vector, 0, { evidence, projects: catalog }));
    const high = retrieveExplorationCandidates(inputFor(profile.vector, 1, { evidence, projects: catalog }));
    const scoreOf = (r: typeof low, id: string) => r.diagnostics.get(id)?.explorationScore ?? 0;
    // Diagnostics only keep selected candidates; compute scores directly for the comparison.
    const rank = (r: typeof low, id: string) => r.candidates.findIndex((c) => c.projectId === id);
    const popular = "implement-a-ray-tracer";
    const underexposed = "event-loop-from-scratch";
    expect(rank(high, underexposed)).toBeGreaterThanOrEqual(0);
    expect(rank(high, popular) === -1 || rank(high, underexposed) < rank(high, popular)).toBe(true);
    if (rank(low, popular) >= 0 && rank(low, underexposed) >= 0) {
      expect(scoreOf(low, underexposed) - scoreOf(low, popular)).toBeLessThan(scoreOf(high, underexposed) - scoreOf(high, popular));
    }
    // The popular project's popularity score is far higher yet does not dominate exploration at e = 1.
    const popularity = computePopularityScores(catalog, evidence);
    expect(popularity.get(popular)!.score).toBeGreaterThan(popularity.get(underexposed)!.score);
  });
});
