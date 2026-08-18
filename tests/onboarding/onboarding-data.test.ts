import { describe, expect, it } from "vitest";
import { ONBOARDING_PAIRS, pairSlugs } from "@/lib/onboarding/pairs";
import { ONBOARDING_TOPICS, topicFeatureVector } from "@/lib/onboarding/topics";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { PROJECTS, TAGS } from "@/prisma/seed-data/catalog";

describe("onboarding topics", () => {
  const tagSlugs = new Set(TAGS.map((t) => t.slug));

  it("map only onto existing catalog tags with weights in (0, 1]", () => {
    for (const topic of ONBOARDING_TOPICS) {
      expect(Object.keys(topic.tags).length).toBeGreaterThan(0);
      for (const [slug, weight] of Object.entries(topic.tags)) {
        expect(tagSlugs.has(slug), `${topic.key} maps to unknown tag ${slug}`).toBe(true);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("include the required high-level choices and have unique keys", () => {
    const keys = ONBOARDING_TOPICS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const required of ["ai", "systems", "graphics", "games", "web", "security", "data", "mobile", "hardware", "creative", "devtools", "networking", "databases", "distributed"]) {
      expect(keys).toContain(required);
    }
    expect(keys.length).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.onboarding.maxTopics);
  });

  it("produce namespaced tag feature vectors", () => {
    const systems = ONBOARDING_TOPICS.find((t) => t.key === "systems")!;
    const vector = topicFeatureVector(systems);
    expect(vector["tag:systems"]).toBe(1);
    expect(Object.keys(vector).every((k) => k.startsWith("tag:"))).toBe(true);
  });
});

describe("onboarding pairs", () => {
  const bySlug = new Map(PROJECTS.map((p) => [p.slug, p]));

  it("reference seeded projects only and never repeat a project", () => {
    const slugs = pairSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(bySlug.has(slug), `unknown project ${slug}`).toBe(true);
  });

  it("offers 4–6 pairs whose sides share no tags (no trivially similar pairs)", () => {
    expect(ONBOARDING_PAIRS.length).toBeGreaterThanOrEqual(4);
    expect(ONBOARDING_PAIRS.length).toBeLessThanOrEqual(6);
    for (const pair of ONBOARDING_PAIRS) {
      const left = new Set(bySlug.get(pair.left)!.tags);
      const right = bySlug.get(pair.right)!.tags;
      expect(right.some((tag) => left.has(tag)), `${pair.left} and ${pair.right} share a tag`).toBe(false);
    }
  });

  it("collectively span many domains", () => {
    const primaryTags = new Set(pairSlugs().map((slug) => bySlug.get(slug)!.tags[0]));
    expect(primaryTags.size).toBeGreaterThanOrEqual(10);
  });
});
