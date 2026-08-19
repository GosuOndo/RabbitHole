import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { diversificationLambda, diversifyRanked, maxItemsPerTag, maxTagShare, type DiversifyProjectInfo } from "@/lib/recommender/diversify";
import { projectFeatureVector } from "@/lib/recommender/features";
import { cosineSimilarity } from "@/lib/recommender/similarity";

function project(tags: string[], languages: string[] = ["rust"], difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" = "INTERMEDIATE", hours = 12): DiversifyProjectInfo {
  return { vector: projectFeatureVector({ tagSlugs: tags, languageSlugs: languages, difficulty, estimatedHours: hours }), tagSlugs: tags };
}

// Four near-identical database/systems projects, then an HTTP server and a shader renderer.
const PROJECTS = new Map<string, DiversifyProjectInfo>([
  ["redis", project(["databases", "systems"])],
  ["sqlite", project(["databases", "systems"])],
  ["db-engine", project(["databases", "systems"])],
  ["btree", project(["databases", "data-structures"])],
  ["http", project(["networking", "backend"], ["go"])],
  ["shader", project(["graphics", "webgl"], ["glsl"], "INTERMEDIATE", 8)],
]);
const RANKED = [
  { projectId: "redis", score: 0.9, rank: 1 },
  { projectId: "sqlite", score: 0.88, rank: 2 },
  { projectId: "db-engine", score: 0.86, rank: 3 },
  { projectId: "btree", score: 0.84, rank: 4 },
  { projectId: "http", score: 0.8, rank: 5 },
  { projectId: "shader", score: 0.78, rank: 6 },
];

describe("diversification parameters", () => {
  it("derives lambda and tag share from the exploration preference within configured bounds", () => {
    expect(diversificationLambda(0)).toBeCloseTo(0.9, 10);
    expect(diversificationLambda(1)).toBeCloseTo(0.7, 10);
    expect(diversificationLambda(0.35)).toBeCloseTo(0.83, 10);
    expect(diversificationLambda(5)).toBeLessThanOrEqual(RECOMMENDER_CONFIG.diversity.lambdaMax);
    expect(diversificationLambda(-5)).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.diversity.lambdaMin);
    expect(maxTagShare(0)).toBeCloseTo(0.45, 10);
    expect(maxTagShare(1)).toBeCloseTo(0.3, 10);
    expect(maxItemsPerTag(10, 0)).toBe(5);
    expect(maxItemsPerTag(10, 1)).toBe(3);
    expect(maxItemsPerTag(3, 1)).toBe(RECOMMENDER_CONFIG.diversity.minTagCount);
  });
});

describe("diversifyRanked", () => {
  it("keeps the top recommendation first and breaks up the database cluster", () => {
    const result = diversifyRanked(RANKED, { limit: 6, explorationPreference: 0.5, projects: PROJECTS });
    const order = result.selected.map((s) => s.item.projectId);
    expect(order[0]).toBe("redis");
    expect(new Set(order).size).toBe(6);
    expect(result.selected).toHaveLength(6);
    // Without diversification the first four are all database projects; now a non-database project appears in the top 4.
    const topFour = order.slice(0, 4);
    expect(topFour.some((id) => id === "http" || id === "shader")).toBe(true);
    expect(result.applied).toBe(true);
    // Recommendation scores are untouched; ranks are re-assigned.
    for (const entry of result.selected) {
      expect(entry.item.score).toBe(RANKED.find((r) => r.projectId === entry.item.projectId)!.score);
      expect(entry.finalRank).toBeGreaterThanOrEqual(1);
      expect(entry.preDiversificationRank).toBe(RANKED.find((r) => r.projectId === entry.item.projectId)!.rank);
    }
    expect(result.selected.some((s) => s.finalRank !== s.preDiversificationRank)).toBe(true);
  });

  it("penalises near-duplicates and reports similarity diagnostics", () => {
    const result = diversifyRanked(RANKED, { limit: 6, explorationPreference: 0.5, projects: PROJECTS });
    const second = result.selected[1]!;
    // sqlite is a near-duplicate of redis (identical features), so it is not the second pick while alternatives exist.
    expect(cosineSimilarity(PROJECTS.get("redis")!.vector, PROJECTS.get("sqlite")!.vector)).toBeCloseTo(1, 10);
    expect(second.item.projectId).not.toBe("sqlite");
    for (const entry of result.selected.slice(1)) expect(entry.maxSimilarityToSelected).toBeGreaterThan(0);
    for (const entry of result.selected) {
      expect(Number.isFinite(entry.mmrScore)).toBe(true);
      expect(entry.mmrScore).toBeLessThanOrEqual(entry.item.score);
    }
  });

  it("diversifies more strongly as the preference rises and preserves rank order more at Familiar", () => {
    const familiar = diversifyRanked(RANKED, { limit: 6, explorationPreference: 0, projects: PROJECTS });
    const adventurous = diversifyRanked(RANKED, { limit: 6, explorationPreference: 1, projects: PROJECTS });
    const dbInTop3 = (r: typeof familiar) => r.selected.slice(0, 3).filter((s) => PROJECTS.get(s.item.projectId)!.tagSlugs.includes("databases")).length;
    const positionSumOfNonDatabase = (r: typeof familiar) =>
      r.selected.filter((s) => !PROJECTS.get(s.item.projectId)!.tagSlugs.includes("databases")).reduce((sum, s) => sum + s.finalRank, 0);
    expect(familiar.lambda).toBeGreaterThan(adventurous.lambda);
    expect(familiar.maxPerTag).toBeGreaterThan(adventurous.maxPerTag);
    expect(dbInTop3(adventurous)).toBeLessThanOrEqual(dbInTop3(familiar));
    // The non-database projects (http server, shader) surface earlier when adventurous.
    expect(positionSumOfNonDatabase(adventurous)).toBeLessThan(positionSumOfNonDatabase(familiar));
    // Both modes keep the top-ranked item first and the full set intact.
    expect(familiar.selected[0]!.item.projectId).toBe("redis");
    expect(adventurous.selected[0]!.item.projectId).toBe("redis");
    expect(new Set(adventurous.selected.map((s) => s.item.projectId)).size).toBe(6);
  });

  it("does not sacrifice relevance for variety", () => {
    const ranked = [
      { projectId: "a", score: 0.95, rank: 1 },
      { projectId: "b", score: 0.93, rank: 2 },
      { projectId: "c", score: 0.3, rank: 3 },
    ];
    const projects = new Map<string, DiversifyProjectInfo>([
      ["a", project(["databases", "systems"])],
      ["b", project(["databases", "systems"])],
      ["c", project(["graphics"], ["glsl"])],
    ]);
    for (const e of [0, 0.5, 1]) {
      const result = diversifyRanked(ranked, { limit: 3, explorationPreference: e, projects });
      expect(result.selected.map((s) => s.item.projectId)).toEqual(["a", "b", "c"]);
    }
  });

  it("caps tag concentration but relaxes deterministically to fill the requested limit", () => {
    const projects = new Map<string, DiversifyProjectInfo>();
    const ranked = [];
    for (let i = 0; i < 12; i++) {
      const id = `sys-${i}`;
      projects.set(id, project(["systems", i % 2 === 0 ? "databases" : "networking"], ["rust"], "ADVANCED", 20 + i));
      ranked.push({ projectId: id, score: 0.9 - i * 0.02, rank: i + 1 });
    }
    const result = diversifyRanked(ranked, { limit: 10, explorationPreference: 1, projects });
    expect(result.selected).toHaveLength(10);
    expect(new Set(result.selected.map((s) => s.item.projectId)).size).toBe(10);
    expect(result.maxPerTag).toBe(3);
    // Every project carries "systems", so the cap must have been relaxed to fill the list.
    expect(result.relaxationLevel).toBeGreaterThan(0);
    expect(result.selected.some((s) => s.admittedUnderRelaxation)).toBe(true);
    // Relaxation still prefers the strongest remaining candidates.
    expect(result.selected[0]!.item.projectId).toBe("sys-0");
  });

  it("returns short lists unchanged and is deterministic", () => {
    const short = diversifyRanked(RANKED.slice(0, 2), { limit: 2, explorationPreference: 1, projects: PROJECTS });
    expect(short.applied).toBe(false);
    expect(short.selected.map((s) => s.item.projectId)).toEqual(["redis", "sqlite"]);
    const a = diversifyRanked(RANKED, { limit: 6, explorationPreference: 0.7, projects: PROJECTS });
    const b = diversifyRanked(RANKED, { limit: 6, explorationPreference: 0.7, projects: PROJECTS });
    expect(a).toEqual(b);
    expect(diversifyRanked(RANKED, { limit: 4, explorationPreference: 0.7, projects: PROJECTS }).selected).toHaveLength(4);
  });
});
