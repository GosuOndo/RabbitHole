import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { similarProjects } from "@/lib/recommender/similar";
import { catalogFixture, projectBySlug } from "../helpers/catalog-fixture";

const catalog = catalogFixture();

describe("similarProjects", () => {
  it("excludes the project itself and returns the configured count", () => {
    const target = projectBySlug("build-your-own-redis");
    const similar = similarProjects(target, catalog);
    expect(similar).toHaveLength(RECOMMENDER_CONFIG.similarProjects.count);
    expect(similar.some((s) => s.projectId === target.id)).toBe(false);
    expect(similarProjects(target, catalog, { limit: 3 })).toHaveLength(3);
  });

  it("ranks high-overlap projects first, ordered by similarity", () => {
    const target = projectBySlug("build-your-own-redis"); // systems, networking, databases, backend · rust/go/c
    const similar = similarProjects(target, catalog, { limit: 8 });
    for (let i = 1; i < similar.length; i++) expect(similar[i - 1]!.similarity).toBeGreaterThanOrEqual(similar[i]!.similarity);
    const top = similar.slice(0, 4).map((s) => projectBySlug(s.projectId));
    for (const project of top) {
      const shared = project.tagSlugs.filter((t) => target.tagSlugs.includes(t));
      expect(shared.length).toBeGreaterThanOrEqual(2);
    }
    // A mobile UI project must not outrank the systems neighbours.
    const mobileIndex = similar.findIndex((s) => s.projectId === "habit-tracker-mobile-app");
    expect(mobileIndex).toBe(-1);
  });

  it("is symmetric-ish and deterministic", () => {
    const a = similarProjects(projectBySlug("implement-a-ray-tracer"), catalog);
    const b = similarProjects(projectBySlug("implement-a-ray-tracer"), catalog);
    expect(a).toEqual(b);
    expect(a.every((s) => s.similarity > 0 && s.similarity <= 1)).toBe(true);
    const graphicsNeighbours = a.map((s) => projectBySlug(s.projectId).tagSlugs);
    expect(graphicsNeighbours.every((tags) => tags.includes("graphics") || tags.includes("webgl") || tags.includes("creative-coding") || tags.includes("simulation"))).toBe(true);
  });
});
