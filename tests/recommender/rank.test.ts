import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { rankCandidates, resolveRankingWeights, type RankingInput } from "@/lib/recommender/rank";
import type { ScoreComponent } from "@/lib/recommender/types";

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
    // Absent signals are reported as null (no evidence), not as zeros.
    expect(ranked[0]!.breakdown).toEqual({ content: 0.8, collaborative: null, session: null, novelty: null, popularity: 0.5 });
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
      for (const value of Object.values(r.breakdown)) expect(value === null || Number.isFinite(value)).toBe(true);
    }
    expect(ranked.find((r) => r.projectId === "negative")!.score).toBe(0);
    // Non-finite signals are neutralised to 0 rather than clamped or propagated.
    expect(ranked.find((r) => r.projectId === "broken")!.breakdown).toEqual({ content: 0, collaborative: null, session: null, novelty: null, popularity: 0 });
  });
});

describe("exploration-aware ranking weights", () => {
  const all: ScoreComponent[] = ["content", "collaborative", "novelty", "popularity"];
  const at = (e: number) => resolveRankingWeights(all, { explorationPreference: e });

  it("moves weight from content/collaborative to novelty as the preference rises, keeping popularity sensible", () => {
    const familiar = at(0);
    const balanced = at(0.35);
    const adventurous = at(1);
    // Raw policy: content 0.45→0.30, collaborative 0.25→0.20, novelty 0.05→0.35, popularity 0.10 (renormalised).
    expect(familiar.content).toBeCloseTo(0.45 / 0.85, 4);
    expect(familiar.novelty).toBeCloseTo(0.05 / 0.85, 4);
    expect(adventurous.content).toBeCloseTo(0.3 / 0.95, 4);
    expect(adventurous.collaborative).toBeCloseTo(0.2 / 0.95, 4);
    expect(adventurous.novelty).toBeCloseTo(0.35 / 0.95, 4);
    expect(adventurous.popularity).toBeCloseTo(0.1 / 0.95, 4);
    expect(balanced.content!).toBeLessThan(familiar.content!);
    expect(balanced.content!).toBeGreaterThan(adventurous.content!);
    expect(balanced.collaborative!).toBeLessThan(familiar.collaborative!);
    expect(balanced.novelty!).toBeGreaterThan(familiar.novelty!);
    expect(balanced.novelty!).toBeLessThan(adventurous.novelty!);
    for (const w of [familiar, balanced, adventurous]) {
      expect(Object.values(w).reduce((s, v) => s + (v ?? 0), 0)).toBeCloseTo(1, 10);
      expect(w.popularity!).toBeGreaterThan(0.05);
      expect(w.popularity!).toBeLessThan(0.2);
    }
  });

  it("keeps the cold-start popularity boost and renormalises over available components", () => {
    const cold = resolveRankingWeights(all, { explorationPreference: 0.35, coldStart: true });
    const warm = at(0.35);
    expect(cold.popularity!).toBeGreaterThan(warm.popularity!);
    expect(cold.popularity).toBeCloseTo(0.3 / (0.45 - 0.15 * 0.35 + 0.25 - 0.05 * 0.35 + 0.05 + 0.3 * 0.35 + 0.3), 6);
    const noCollab = resolveRankingWeights(["content", "novelty", "popularity"], { explorationPreference: 1 });
    expect(noCollab.collaborative).toBeUndefined();
    expect(Object.values(noCollab).reduce((s, v) => s + (v ?? 0), 0)).toBeCloseTo(1, 10);
    const noProfile = resolveRankingWeights(["novelty", "popularity"], { explorationPreference: 1 });
    expect(noProfile.novelty).toBeCloseTo(0.35 / 0.45, 6);
  });

  it("scores with novelty as a real component while staying finite, bounded and deterministic", () => {
    const weights = at(1);
    const inputs: RankingInput[] = [
      { projectId: "novel", slug: "novel", popularityPrior: 0.2, sources: ["exploration"], signals: { content: 0.4, novelty: 0.9, popularity: 0.2 } },
      { projectId: "safe", slug: "safe", popularityPrior: 0.9, sources: ["content"], signals: { content: 0.6, novelty: 0.1, popularity: 0.9 } },
      { projectId: "saved", slug: "saved", popularityPrior: 0.5, sources: ["content"], signals: { content: 0.7, novelty: 0.5, popularity: 0.5 }, saved: true },
    ];
    const ranked = rankCandidates(inputs, { weights });
    expect(ranked[0]!.projectId).toBe("novel");
    expect(ranked.find((r) => r.projectId === "novel")!.breakdown.novelty).toBe(0.9);
    const familiarRanked = rankCandidates(inputs, { weights: at(0) });
    expect(familiarRanked[0]!.projectId).toBe("safe");
    const savedEntry = ranked.find((r) => r.projectId === "saved")!;
    expect(savedEntry.savedMultiplierApplied).toBe(true);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(rankCandidates(inputs, { weights })).toEqual(ranked);
  });
});

describe("hybrid ranking with collaborative evidence", () => {
  const base = RECOMMENDER_CONFIG.rankingWeights;
  const hybrid = resolveRankingWeights(["content", "collaborative", "popularity"]);
  const collab = (id: string, content: number, collaborative: number | undefined, popularity: number, extra: Partial<RankingInput> = {}): RankingInput => ({
    projectId: id,
    slug: id,
    popularityPrior: 0.5,
    sources: collaborative === undefined ? ["content"] : ["content", "collaborative"],
    signals: { content, ...(collaborative === undefined ? {} : { collaborative }), popularity },
    ...extra,
  });

  it("renormalises content/collaborative/popularity to ≈ 0.5625 / 0.3125 / 0.125", () => {
    const total = base.content + base.collaborative + base.popularity;
    expect(hybrid.content).toBeCloseTo(base.content / total, 10);
    expect(hybrid.collaborative).toBeCloseTo(base.collaborative / total, 10);
    expect(hybrid.popularity).toBeCloseTo(base.popularity / total, 10);
    expect(hybrid.content).toBeCloseTo(0.5625, 4);
    expect(hybrid.collaborative).toBeCloseTo(0.3125, 4);
    expect(hybrid.popularity).toBeCloseTo(0.125, 4);
  });

  it("lets sufficiently strong collaborative evidence overtake a stronger content match", () => {
    const ranked = rankCandidates([collab("A", 0.8, 0.05, 0.2), collab("B", 0.65, 0.95, 0.2)], { weights: hybrid });
    expect(ranked.map((r) => r.projectId)).toEqual(["B", "A"]);
    const b = ranked[0]!;
    expect(b.score).toBeCloseTo(hybrid.content! * 0.65 + hybrid.collaborative! * 0.95 + hybrid.popularity! * 0.2, 10);
    expect(b.breakdown.collaborative).toBe(0.95);
  });

  it("still lets strong content win when collaborative evidence is comparable", () => {
    const ranked = rankCandidates([collab("A", 0.9, 0.4, 0.2), collab("B", 0.5, 0.5, 0.2)], { weights: hybrid });
    expect(ranked[0]!.projectId).toBe("A");
  });

  it("does not let popularity alone dominate a normal user", () => {
    const ranked = rankCandidates([collab("popular", 0.1, 0.05, 1.0), collab("relevant", 0.7, 0.6, 0.1)], { weights: hybrid });
    expect(ranked[0]!.projectId).toBe("relevant");
  });

  it("treats a candidate without collaborative evidence as null (0 contribution) rather than negative", () => {
    const ranked = rankCandidates([collab("with", 0.6, 0.3, 0.3), collab("without", 0.6, undefined, 0.3)], { weights: hybrid });
    expect(ranked[0]!.projectId).toBe("with");
    const without = ranked.find((r) => r.projectId === "without")!;
    expect(without.breakdown.collaborative).toBeNull();
    expect(without.score).toBeCloseTo(hybrid.content! * 0.6 + hybrid.popularity! * 0.3, 10);
    expect(without.score).toBeGreaterThan(0);
  });

  it("keeps saved-item demotion, bounds and deterministic ties with the collaborative component present", () => {
    const ranked = rankCandidates(
      [collab("saved", 0.9, 0.9, 0.9, { saved: true }), collab("fresh", 0.9, 0.9, 0.9), collab("b", 0.4, 0.4, 0.4), collab("a", 0.4, 0.4, 0.4), collab("nan", Number.NaN, Number.NaN, 0.5)],
      { weights: hybrid },
    );
    expect(ranked.map((r) => r.projectId)).toEqual(["fresh", "saved", "a", "b", "nan"]);
    expect(ranked[1]!.score).toBeCloseTo(ranked[0]!.score * RECOMMENDER_CONFIG.filtering.savedProjectScoreMultiplier, 10);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(ranked.find((r) => r.projectId === "nan")!.breakdown.collaborative).toBe(0);
  });

  it("falls back to content + popularity weights when the user has no collaborative evidence at all", () => {
    const noCollab = resolveRankingWeights(["content", "popularity"]);
    expect(noCollab.collaborative).toBeUndefined();
    expect((noCollab.content ?? 0) + (noCollab.popularity ?? 0)).toBeCloseTo(1, 10);
    const cold = resolveRankingWeights(["content", "collaborative", "popularity"], { coldStart: true });
    expect(cold.popularity!).toBeGreaterThan(hybrid.popularity!);
    expect(cold.content!).toBeGreaterThan(cold.collaborative!);
  });
});

describe("session-aware ranking weights (Phase 6)", () => {
  const withSession: ScoreComponent[] = ["content", "collaborative", "session", "novelty", "popularity"];
  const noSession: ScoreComponent[] = ["content", "collaborative", "novelty", "popularity"];
  const sum = (weights: Partial<Record<ScoreComponent, number>>) => Object.values(weights).reduce((s, w) => s + (w ?? 0), 0);

  it("no session → the Phase 5 weights are unchanged; a session with zero confidence carries zero weight", () => {
    for (const e of [0, 0.35, 1]) {
      const phase5 = resolveRankingWeights(noSession, { explorationPreference: e });
      const zeroConfidence = resolveRankingWeights(withSession, { explorationPreference: e, sessionConfidence: 0 });
      expect(zeroConfidence.session).toBe(0);
      for (const c of noSession) expect(zeroConfidence[c]).toBeCloseTo(phase5[c]!, 10);
      expect(resolveRankingWeights(withSession, { explorationPreference: e }).session).toBe(0);
    }
  });

  it("weak session → a very small session weight; strong coherent session → raw weight approaching the configured base", () => {
    const weak = resolveRankingWeights(withSession, { sessionConfidence: 0.1 });
    const strong = resolveRankingWeights(withSession, { sessionConfidence: 0.95 });
    expect(weak.session).toBeGreaterThan(0);
    expect(weak.session).toBeLessThan(0.015);
    expect(strong.session).toBeGreaterThan(weak.session!);
    // Raw session weight = base.session × confidence, i.e. 0.095 of a 0.945 total at e = 0.
    expect(strong.session).toBeCloseTo((base.session * 0.95) / (0.45 + 0.25 + base.session * 0.95 + 0.05 + 0.1), 10);
    expect(resolveRankingWeights(withSession, { sessionConfidence: 1 }).session).toBeCloseTo(base.session / (0.85 + base.session), 10);
    expect(resolveRankingWeights(withSession, { sessionConfidence: 5 }).session).toBeCloseTo(base.session / (0.85 + base.session), 10); // clamped
    expect(resolveRankingWeights(withSession, { sessionConfidence: Number.NaN }).session).toBe(0);
  });

  it("exploration still moves content/collaborative/novelty exactly as in Phase 5 with a session present, and weights sum to 1", () => {
    for (const e of [0, 0.35, 1]) {
      const w = resolveRankingWeights(withSession, { explorationPreference: e, sessionConfidence: 0.6 });
      const rawSession = base.session * 0.6;
      const total = 0.45 - 0.15 * e + (0.25 - 0.05 * e) + rawSession + (0.05 + 0.3 * e) + 0.1;
      expect(w.content).toBeCloseTo((0.45 - 0.15 * e) / total, 10);
      expect(w.collaborative).toBeCloseTo((0.25 - 0.05 * e) / total, 10);
      expect(w.novelty).toBeCloseTo((0.05 + 0.3 * e) / total, 10);
      expect(w.popularity).toBeCloseTo(0.1 / total, 10);
      expect(w.session).toBeCloseTo(rawSession / total, 10);
      expect(sum(w)).toBeCloseTo(1, 10);
    }
    // The two controls move different dimensions: exploration changes novelty, confidence changes session.
    const lowE = resolveRankingWeights(withSession, { explorationPreference: 0, sessionConfidence: 0.6 });
    const highE = resolveRankingWeights(withSession, { explorationPreference: 1, sessionConfidence: 0.6 });
    expect(highE.novelty).toBeGreaterThan(lowE.novelty!);
    expect(highE.session! / highE.content!).toBeGreaterThan(lowE.session! / lowE.content!); // relative only, the raw session weight is unchanged
    const lowC = resolveRankingWeights(withSession, { explorationPreference: 0.35, sessionConfidence: 0.2 });
    const highC = resolveRankingWeights(withSession, { explorationPreference: 0.35, sessionConfidence: 0.9 });
    expect(highC.session).toBeGreaterThan(lowC.session!);
    expect(highC.novelty! / highC.content!).toBeCloseTo(lowC.novelty! / lowC.content!, 10);
  });

  it("keeps the cold-start popularity multiplier with a session present", () => {
    const cold = resolveRankingWeights(withSession, { coldStart: true, sessionConfidence: 0.5 });
    const warm = resolveRankingWeights(withSession, { coldStart: false, sessionConfidence: 0.5 });
    const rawSession = base.session * 0.5;
    expect(cold.popularity).toBeCloseTo((0.1 * RECOMMENDER_CONFIG.coldStart.popularityWeightMultiplier) / (0.45 + 0.25 + rawSession + 0.05 + 0.3), 10);
    expect(cold.popularity).toBeGreaterThan(warm.popularity!);
    expect(cold.session).toBeLessThan(warm.session!);
    expect(sum(cold)).toBeCloseTo(1, 10);
  });

  it("ranks with the session component: null when unavailable, real 0 when unaligned, and never rewards negative affinity", () => {
    const weights = resolveRankingWeights(withSession, { sessionConfidence: 0.8 });
    const ranked = rankCandidates(
      [
        { projectId: "aligned", slug: "aligned", popularityPrior: 0.5, sources: ["content"], signals: { content: 0.5, session: 0.9, novelty: 0.3, popularity: 0.5 } },
        { projectId: "unaligned", slug: "unaligned", popularityPrior: 0.5, sources: ["content"], signals: { content: 0.5, session: 0, novelty: 0.3, popularity: 0.5 } },
        { projectId: "negative", slug: "negative", popularityPrior: 0.5, sources: ["content"], signals: { content: 0.5, session: -0.7, novelty: 0.3, popularity: 0.5 } },
        { projectId: "unknown", slug: "unknown", popularityPrior: 0.5, sources: ["content"], signals: { content: 0.5, novelty: 0.3, popularity: 0.5 } },
      ],
      { weights },
    );
    const by = (id: string) => ranked.find((r) => r.projectId === id)!;
    expect(by("aligned").breakdown.session).toBe(0.9);
    expect(by("unaligned").breakdown.session).toBe(0);
    expect(by("negative").breakdown.session).toBe(0); // clamped, never a penalty below "no alignment"
    expect(by("unknown").breakdown.session).toBeNull();
    expect(by("aligned").score).toBeGreaterThan(by("unaligned").score);
    expect(by("unaligned").score).toBeCloseTo(by("negative").score, 10);
    expect(by("unaligned").score).toBeCloseTo(by("unknown").score, 10);
    expect(by("aligned").score - by("unaligned").score).toBeCloseTo(weights.session! * 0.9, 10);
  });
});
