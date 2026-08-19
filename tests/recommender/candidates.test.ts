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

describe("mergeCandidateSets with three sources", () => {
  const collaborative: RetrievedCandidate[] = [
    { projectId: "redis", source: "collaborative", signal: 0.81 },
    { projectId: "kv", source: "collaborative", signal: 0.66 },
    { projectId: "broker", source: "collaborative", signal: 0.4 },
  ];
  const popular2: RetrievedCandidate[] = [
    { projectId: "redis", source: "popular", signal: 0.9 },
    { projectId: "raytracer", source: "popular", signal: 0.85 },
  ];
  const content2: RetrievedCandidate[] = [
    { projectId: "redis", source: "content", signal: 0.72 },
    { projectId: "dns", source: "content", signal: 0.6 },
    { projectId: "broker", source: "content", signal: 0.5 },
  ];

  it("keeps one candidate per project with every genuine source and raw signal", () => {
    const merged = mergeCandidateSets([content2, collaborative, popular2]);
    const byId = new Map(merged.map((c) => [c.projectId, c]));
    expect(merged).toHaveLength(5);
    expect(new Set(merged.map((c) => c.projectId)).size).toBe(5);
    expect(byId.get("dns")).toEqual({ projectId: "dns", sources: ["content"], signals: { content: 0.6 } });
    expect(byId.get("kv")).toEqual({ projectId: "kv", sources: ["collaborative"], signals: { collaborative: 0.66 } });
    expect(byId.get("raytracer")).toEqual({ projectId: "raytracer", sources: ["popular"], signals: { popular: 0.85 } });
    expect(byId.get("broker")).toEqual({ projectId: "broker", sources: ["content", "collaborative"], signals: { content: 0.5, collaborative: 0.4 } });
    expect(byId.get("redis")).toEqual({
      projectId: "redis",
      sources: ["content", "collaborative", "popular"],
      signals: { content: 0.72, collaborative: 0.81, popular: 0.9 },
    });
  });

  it("orders deterministically by first appearance and neutralises non-finite signals", () => {
    const merged = mergeCandidateSets([content2, collaborative, popular2]);
    expect(merged.map((c) => c.projectId)).toEqual(["redis", "dns", "broker", "kv", "raytracer"]);
    expect(mergeCandidateSets([content2, collaborative, popular2])).toEqual(merged);
    const withBadSignal = mergeCandidateSets([[{ projectId: "x", source: "collaborative", signal: Number.POSITIVE_INFINITY }], content2]);
    expect(withBadSignal.some((c) => c.projectId === "x")).toBe(false);
  });

  it("filters excluded projects regardless of which sources retrieved them", () => {
    const merged = mergeCandidateSets([content2, collaborative, popular2]);
    const { kept, removed } = filterCandidates(merged, { excludedProjectIds: new Set(["redis", "kv"]) });
    expect(kept.map((c) => c.projectId)).toEqual(["dns", "broker", "raytracer"]);
    expect(removed.map((r) => r.projectId)).toEqual(["redis", "kv"]);
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
