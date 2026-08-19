import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { rankCandidates, resolveRankingWeights, type RankingInput } from "@/lib/recommender/rank";

const base = RECOMMENDER_CONFIG.rankingWeights;

function input(id: string, content: number, popularity: number, extra: Partial<RankingInput> = {}): RankingInput {
  return { projectId: id, slug: id, popularityPrior: 0.5, sources: ["content"], signals: { content, popularity }, ...extra };
}

describe("resolveRankingWeights", () => {
  it("restricts to available components and renormalises to 1 with content dominating", () => {
    const weights = resolveRankingWeights(["content", "popularity"]);
    expect(weights.content).toBeCloseTo(base.content / (base.content + base.popularity), 10);
    expect(weights.popularity).toBeCloseTo(base.popularity / (base.content + base.popularity), 10);
    expect((weights.content ?? 0) + (weights.popularity ?? 0)).toBeCloseTo(1, 10);
    expect(weights.collaborative).toBeUndefined();
    expect(weights.content!).toBeGreaterThan(weights.popularity! * 3);
  });

  it("boosts popularity for cold-start users while content still leads", () => {
    const cold = resolveRankingWeights(["content", "popularity"], { coldStart: true });
    const warm = resolveRankingWeights(["content", "popularity"]);
    expect(cold.popularity!).toBeGreaterThan(warm.popularity!);
    expect(cold.content!).toBeLessThan(warm.content!);
    expect(cold.content!).toBeGreaterThan(cold.popularity!);
    expect((cold.content ?? 0) + (cold.popularity ?? 0)).toBeCloseTo(1, 10);
  });

  it("falls back to equal weights when the base weights are all zero", () => {
    const weights = resolveRankingWeights(["content", "popularity"], { base: { ...base, content: 0, popularity: 0 } });
    expect(weights.content).toBeCloseTo(0.5, 10);
    expect(weights.popularity).toBeCloseTo(0.5, 10);
  });
});

describe("rankCandidates", () => {
  const weights = resolveRankingWeights(["content", "popularity"]);

  it("ranks the stronger content match higher when popularity is equal", () => {
    const ranked = rankCandidates([input("weak", 0.2, 0.5), input("strong", 0.8, 0.5)], { weights });
    expect(ranked.map((r) => r.projectId)).toEqual(["strong", "weak"]);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.score).toBeCloseTo(weights.content! * 0.8 + weights.popularity! * 0.5, 10);
    expect(ranked[0]!.breakdown).toEqual({ content: 0.8, collaborative: 0, session: 0, novelty: 0, popularity: 0.5 });
  });

  it("uses deterministic tie-breaks: popularity prior desc, then slug asc", () => {
    const ranked = rankCandidates(
      [input("b", 0.5, 0.5, { popularityPrior: 0.3 }), input("a", 0.5, 0.5, { popularityPrior: 0.3 }), input("c", 0.5, 0.5, { popularityPrior: 0.9 })],
      { weights },
    );
    expect(ranked.map((r) => r.projectId)).toEqual(["c", "a", "b"]);
    expect(rankCandidates([input("b", 0.5, 0.5), input("a", 0.5, 0.5)], { weights })).toEqual(
      rankCandidates([input("b", 0.5, 0.5), input("a", 0.5, 0.5)], { weights }),
    );
  });

  it("keeps cold-start rankings useful: onboarding content still orders projects with equal popularity", () => {
    const cold = resolveRankingWeights(["content", "popularity"], { coldStart: true });
    const ranked = rankCandidates([input("popular-but-off", 0.05, 0.9), input("on-topic", 0.6, 0.6)], { weights: cold });
    expect(ranked[0]!.projectId).toBe("on-topic");
  });

  it("demotes saved projects and never produces NaN or Infinity", () => {
    const ranked = rankCandidates(
      [input("saved", 0.9, 0.9, { saved: true }), input("fresh", 0.9, 0.9), input("broken", Number.NaN, Number.POSITIVE_INFINITY), input("negative", -1, 0)],
      { weights },
    );
    expect(ranked[0]!.projectId).toBe("fresh");
    const saved = ranked.find((r) => r.projectId === "saved")!;
    expect(saved.savedMultiplierApplied).toBe(true);
    expect(saved.score).toBeCloseTo(ranked[0]!.score * RECOMMENDER_CONFIG.filtering.savedProjectScoreMultiplier, 10);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      for (const value of Object.values(r.breakdown)) expect(Number.isFinite(value)).toBe(true);
    }
    expect(ranked.find((r) => r.projectId === "negative")!.score).toBe(0);
    // Non-finite signals are neutralised to 0 rather than clamped or propagated.
    expect(ranked.find((r) => r.projectId === "broken")!.breakdown).toEqual({ content: 0, collaborative: 0, session: 0, novelty: 0, popularity: 0 });
  });
});
