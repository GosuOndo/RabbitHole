import { describe, expect, it } from "vitest";
import type { InteractionType } from "@/generated/prisma/enums";
import { deriveProjectStates } from "@/lib/interactions/project-state";
import { applySavedFilters, sortSavedProjects, type SavedProjectItem } from "@/lib/saved/saved-filters";
import { PROJECTS } from "@/prisma/seed-data/catalog";

const T0 = new Date("2026-08-18T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ev = (projectId: string, type: InteractionType, minutes: number) => ({ projectId, type, createdAt: at(minutes) });

function item(slug: string, savedAt: Date, matchScore: number, extra: Partial<SavedProjectItem> = {}): SavedProjectItem {
  const p = PROJECTS.find((x) => x.slug === slug)!;
  return {
    project: {
      id: slug,
      slug,
      title: p.title,
      summary: p.summary,
      difficulty: p.difficulty,
      estimatedHours: p.estimatedHours,
      popularity: p.popularity,
      tags: p.tags.map((t) => ({ slug: t, name: t })),
      languages: p.languages.map((l) => ({ slug: l, name: l })),
    },
    savedAt,
    matchScore,
    built: false,
    completed: false,
    ...extra,
  };
}

describe("saved state interpretation", () => {
  it("SAVE appears, SAVE then UNSAVE disappears, SAVE then BUILD stays saved with a built flag", () => {
    const states = deriveProjectStates([
      ev("saved", "SAVE", 0),
      ev("unsaved", "SAVE", 0),
      ev("unsaved", "UNSAVE", 5),
      ev("building", "SAVE", 0),
      ev("building", "BUILD", 3),
      ev("done", "SAVE", 0),
      ev("done", "BUILD", 1),
      ev("done", "COMPLETE", 2),
      ev("resaved", "UNSAVE", 0),
      ev("resaved", "SAVE", 1),
      ev("dropped", "SAVE", 0),
      ev("dropped", "DISLIKE", 4),
    ]);
    const savedIds = [...states.values()].filter((s) => s.saved).map((s) => s.projectId).sort();
    expect(savedIds).toEqual(["building", "done", "resaved", "saved"]);
    expect(states.get("building")).toMatchObject({ saved: true, built: true, completed: false });
    expect(states.get("done")).toMatchObject({ saved: true, built: true, completed: true });
    expect(states.get("unsaved")?.saved).toBe(false);
    expect(states.get("dropped")?.saved).toBe(false);
  });
});

describe("applySavedFilters / sortSavedProjects", () => {
  const items = [
    item("build-your-own-redis", at(0), 0.7), // INTERMEDIATE, 20h weekend, systems…, rust/go/c
    item("implement-a-ray-tracer", at(5), 0.2), // INTERMEDIATE, 12h weekend, graphics, cpp/rust/c/python
    item("markov-chain-text-generator", at(10), 0.4), // BEGINNER, 2h under-2, nlp/algorithms, python/ts/go/rust
    item("implement-raft-consensus", at(15), 0.9, { built: true }), // ADVANCED, 40h weeks, distributed…, go/rust/java
  ];

  it("filters by tag, language, difficulty and duration", () => {
    expect(applySavedFilters(items, { tag: "graphics" }).map((i) => i.project.slug)).toEqual(["implement-a-ray-tracer"]);
    expect(applySavedFilters(items, { language: "python" }).map((i) => i.project.slug).sort()).toEqual(["implement-a-ray-tracer", "markov-chain-text-generator"]);
    expect(applySavedFilters(items, { difficulty: "ADVANCED" }).map((i) => i.project.slug)).toEqual(["implement-raft-consensus"]);
    expect(applySavedFilters(items, { duration: "UNDER_2_HOURS" }).map((i) => i.project.slug)).toEqual(["markov-chain-text-generator"]);
    expect(applySavedFilters(items, { duration: "WEEKEND", language: "rust" }).map((i) => i.project.slug).sort()).toEqual(["build-your-own-redis", "implement-a-ray-tracer"]);
    expect(applySavedFilters(items, { tag: "nope" })).toEqual([]);
    expect(applySavedFilters(items, {})).toHaveLength(4);
  });

  it("sorts by recency, match, shortest and difficulty deterministically", () => {
    expect(sortSavedProjects(items, "recent").map((i) => i.project.slug)).toEqual([
      "implement-raft-consensus",
      "markov-chain-text-generator",
      "implement-a-ray-tracer",
      "build-your-own-redis",
    ]);
    expect(sortSavedProjects(items, "match").map((i) => i.project.slug)).toEqual([
      "implement-raft-consensus",
      "build-your-own-redis",
      "markov-chain-text-generator",
      "implement-a-ray-tracer",
    ]);
    expect(sortSavedProjects(items, "shortest").map((i) => i.project.slug)).toEqual([
      "markov-chain-text-generator",
      "implement-a-ray-tracer",
      "build-your-own-redis",
      "implement-raft-consensus",
    ]);
    expect(sortSavedProjects(items, "difficulty").map((i) => i.project.slug)).toEqual([
      "markov-chain-text-generator",
      "implement-a-ray-tracer", // INTERMEDIATE, saved more recently than redis
      "build-your-own-redis",
      "implement-raft-consensus",
    ]);
    expect(sortSavedProjects(items, "recent")).toEqual(sortSavedProjects(items, "recent"));
    expect(items.map((i) => i.project.slug)[0]).toBe("build-your-own-redis"); // input untouched
  });
});
