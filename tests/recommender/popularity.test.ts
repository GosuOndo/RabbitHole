import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG, interactionWeight } from "@/lib/recommender/config";
import { computePopularityScores, positiveEvidenceFromCounts, retrievePopularityCandidates } from "@/lib/recommender/popularity";

const projects = [
  { id: "a", slug: "a", popularity: 0.9 },
  { id: "b", slug: "b", popularity: 0.5 },
  { id: "c", slug: "c", popularity: 0.5 },
  { id: "d", slug: "d", popularity: 0.1 },
];

describe("positiveEvidenceFromCounts", () => {
  it("sums configured weights for positive types only", () => {
    const evidence = positiveEvidenceFromCounts([
      { projectId: "a", type: "SAVE", count: 2 },
      { projectId: "a", type: "OPEN", count: 4 },
      { projectId: "a", type: "DISLIKE", count: 10 },
      { projectId: "a", type: "IMPRESSION", count: 100 },
      { projectId: "b", type: "UNSAVE", count: 3 },
    ]);
    expect(evidence.get("a")).toBeCloseTo(2 * interactionWeight("SAVE") + 4 * interactionWeight("OPEN"), 10);
    expect(evidence.has("b")).toBe(false);
  });
});

describe("computePopularityScores", () => {
  it("blends the seed prior with log-normalised behavioural evidence and stays in [0, 1]", () => {
    const evidence = new Map([
      ["b", 20],
      ["c", 5],
    ]);
    const scores = computePopularityScores(projects, evidence);
    const { priorWeight, behaviorWeight } = RECOMMENDER_CONFIG.popularity;
    // b has the maximum evidence → behavioural 1.
    expect(scores.get("b")!.behavioral).toBeCloseTo(1, 10);
    expect(scores.get("b")!.score).toBeCloseTo(priorWeight * 0.5 + behaviorWeight * 1, 10);
    // c: log1p(5)/log1p(20)
    expect(scores.get("c")!.behavioral).toBeCloseTo(Math.log1p(5) / Math.log1p(20), 10);
    // a has no behaviour: prior only.
    expect(scores.get("a")!.behavioral).toBe(0);
    expect(scores.get("a")!.score).toBeCloseTo(priorWeight * 0.9, 10);
    for (const s of scores.values()) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.score)).toBe(true);
    }
  });

  it("lets positive interactions lift a project above one with a higher prior", () => {
    const scores = computePopularityScores(projects, new Map([["d", 50]]));
    expect(scores.get("d")!.score).toBeGreaterThan(scores.get("b")!.score);
  });

  it("falls back to the prior alone with no evidence and tolerates absurd or invalid inputs", () => {
    const noEvidence = computePopularityScores(projects, new Map());
    expect(noEvidence.get("a")!.score).toBeCloseTo(RECOMMENDER_CONFIG.popularity.priorWeight * 0.9, 10);
    const huge = computePopularityScores([{ id: "x", popularity: Number.NaN }, { id: "y", popularity: 2 }], new Map([["y", 1e12]]));
    expect(huge.get("x")!.score).toBeGreaterThanOrEqual(0);
    expect(huge.get("y")!.score).toBeLessThanOrEqual(1);
    for (const s of huge.values()) expect(Number.isFinite(s.score)).toBe(true);
  });
});

describe("retrievePopularityCandidates", () => {
  it("returns the top-N by score with deterministic slug tie-breaks and excludes terminal projects", () => {
    const scores = computePopularityScores(projects, new Map());
    const candidates = retrievePopularityCandidates(scores, projects, { limit: 3 });
    expect(candidates.map((c) => c.projectId)).toEqual(["a", "b", "c"]);
    expect(candidates.every((c) => c.source === "popular")).toBe(true);
    const filtered = retrievePopularityCandidates(scores, projects, { limit: 3, excludedProjectIds: new Set(["a"]) });
    expect(filtered.map((c) => c.projectId)).toEqual(["b", "c", "d"]);
  });
});
