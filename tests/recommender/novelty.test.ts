import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { adjacencyNovelty, computeNovelty } from "@/lib/recommender/novelty";

const CFG = RECOMMENDER_CONFIG.novelty;

describe("computeNovelty", () => {
  it("makes an underexposed project more novel than a popular one, all else equal", () => {
    const popular = computeNovelty({ popularityScore: 0.9, contentAffinity: 0.5 });
    const rare = computeNovelty({ popularityScore: 0.1, contentAffinity: 0.5 });
    expect(rare.underexposure).toBeCloseTo(0.9, 10);
    expect(popular.underexposure).toBeCloseTo(0.1, 10);
    expect(rare.novelty).toBeGreaterThan(popular.novelty);
    expect(rare.adjacency).toBe(popular.adjacency);
  });

  it("gives an adjacent project (moderate affinity) more adjacency novelty than an almost identical one", () => {
    const identical = computeNovelty({ popularityScore: 0.5, contentAffinity: 0.98 });
    const adjacent = computeNovelty({ popularityScore: 0.5, contentAffinity: 0.5 });
    expect(adjacent.adjacency).toBeCloseTo(1, 10);
    expect(identical.adjacency).toBeLessThan(0.1);
    expect(adjacent.novelty).toBeGreaterThan(identical.novelty);
  });

  it("gives an adjacent project more adjacency novelty than an unrelated one", () => {
    const unrelated = computeNovelty({ popularityScore: 0.5, contentAffinity: 0 });
    const adjacent = computeNovelty({ popularityScore: 0.5, contentAffinity: 0.4 });
    expect(unrelated.adjacency).toBe(0);
    expect(adjacent.adjacency).toBeCloseTo(4 * 0.4 * 0.6, 10);
    expect(adjacent.novelty).toBeGreaterThan(unrelated.novelty);
  });

  it("never rewards negative (disliked) content affinity", () => {
    const disliked = computeNovelty({ popularityScore: 0.5, contentAffinity: -0.8 });
    const neutral = computeNovelty({ popularityScore: 0.5, contentAffinity: 0 });
    expect(disliked.adjacency).toBe(0);
    expect(disliked.novelty).toBeCloseTo(neutral.novelty, 10);
    expect(adjacencyNovelty(-1)).toBe(0);
    expect(adjacencyNovelty(null)).toBe(0);
  });

  it("uses the configured formula: 0.65 · underexposure + 0.35 · adjacency", () => {
    const value = computeNovelty({ popularityScore: 0.3, contentAffinity: 0.25 });
    const adjacency = 4 * 0.25 * 0.75;
    expect(value.novelty).toBeCloseTo(CFG.underexposureWeight * 0.7 + CFG.adjacencyWeight * adjacency, 10);
  });

  it("stays finite and bounded for any input, and is deterministic", () => {
    for (const popularity of [-1, 0, 0.5, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const affinity of [-2, -0.5, 0, 0.5, 1, 3, Number.NaN, null]) {
        const value = computeNovelty({ popularityScore: popularity, contentAffinity: affinity });
        for (const v of [value.novelty, value.underexposure, value.adjacency]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(computeNovelty({ popularityScore: 0.42, contentAffinity: 0.33 })).toEqual(computeNovelty({ popularityScore: 0.42, contentAffinity: 0.33 }));
  });
});
