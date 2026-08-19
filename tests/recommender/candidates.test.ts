import { describe, expect, it } from "vitest";
import { countBySource, filterCandidates, mergeCandidateSets } from "@/lib/recommender/candidates";
import type { RetrievedCandidate } from "@/lib/recommender/types";

const content: RetrievedCandidate[] = [
  { projectId: "redis", source: "content", signal: 0.71 },
  { projectId: "dns", source: "content", signal: 0.6 },
];
const popular: RetrievedCandidate[] = [
  { projectId: "redis", source: "popular", signal: 0.9 },
  { projectId: "raytracer", source: "popular", signal: 0.85 },
];

describe("mergeCandidateSets", () => {
  it("dedupes by project while preserving every source and its signal", () => {
    const merged = mergeCandidateSets([content, popular]);
    expect(merged.map((c) => c.projectId)).toEqual(["redis", "dns", "raytracer"]);
    const redis = merged.find((c) => c.projectId === "redis")!;
    expect(redis.sources).toEqual(["content", "popular"]);
    expect(redis.signals).toEqual({ content: 0.71, popular: 0.9 });
    expect(merged.find((c) => c.projectId === "raytracer")!.sources).toEqual(["popular"]);
  });

  it("keeps the strongest signal when the same source repeats and ignores non-finite signals", () => {
    const merged = mergeCandidateSets([
      [{ projectId: "x", source: "content", signal: 0.2 }],
      [{ projectId: "x", source: "content", signal: 0.5 }],
      [{ projectId: "y", source: "content", signal: Number.NaN }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.signals.content).toBe(0.5);
    expect(merged[0]!.sources).toEqual(["content"]);
  });

  it("is deterministic and counts sources before merging", () => {
    expect(mergeCandidateSets([content, popular])).toEqual(mergeCandidateSets([content, popular]));
    expect(countBySource([content, popular], "content")).toBe(2);
    expect(countBySource([content, popular], "popular")).toBe(2);
    expect(countBySource([content, popular], "collaborative")).toBe(0);
  });
});

describe("filterCandidates", () => {
  it("removes excluded and unknown projects and reports why", () => {
    const merged = mergeCandidateSets([content, popular]);
    const { kept, removed } = filterCandidates(merged, {
      excludedProjectIds: new Set(["dns"]),
      knownProjectIds: new Set(["redis", "dns"]),
    });
    expect(kept.map((c) => c.projectId)).toEqual(["redis"]);
    expect(removed).toEqual([
      { projectId: "dns", reason: "excluded_state" },
      { projectId: "raytracer", reason: "unknown_project" },
    ]);
  });

  it("keeps everything when no options are given", () => {
    const merged = mergeCandidateSets([content]);
    expect(filterCandidates(merged).kept).toEqual(merged);
  });
});
