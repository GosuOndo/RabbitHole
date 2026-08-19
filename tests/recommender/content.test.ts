import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { retrieveContentCandidates, scoreContentAffinity } from "@/lib/recommender/content";
import { catalogFixture, interactionsOn, behaviourProfile, onboardingProfile, projectBySlug } from "../helpers/catalog-fixture";

const catalog = catalogFixture();

describe("retrieveContentCandidates", () => {
  it("returns systems/database projects for a systems-and-databases profile, all tagged content", () => {
    const profile = onboardingProfile(["systems", "databases"]);
    const candidates = retrieveContentCandidates(profile.vector, catalog);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(RECOMMENDER_CONFIG.candidateCounts.content);
    expect(candidates.every((c) => c.source === "content")).toBe(true);
    const top = candidates.slice(0, 10).map((c) => projectBySlug(c.projectId));
    expect(top.every((p) => p.tagSlugs.includes("systems") || p.tagSlugs.includes("databases") || p.tagSlugs.includes("operating-systems"))).toBe(true);
    for (const c of candidates) expect(c.signal).toBeGreaterThanOrEqual(RECOMMENDER_CONFIG.retrieval.minContentAffinity);
  });

  it("orders by affinity descending with popularity then slug as tie-breakers", () => {
    const profile = onboardingProfile(["graphics"]);
    const candidates = retrieveContentCandidates(profile.vector, catalog);
    for (let i = 1; i < candidates.length; i++) {
      const prev = candidates[i - 1]!;
      const curr = candidates[i]!;
      if (prev.signal === curr.signal) {
        const a = projectBySlug(prev.projectId);
        const b = projectBySlug(curr.projectId);
        expect(a.popularity > b.popularity || (a.popularity === b.popularity && a.slug < b.slug)).toBe(true);
      } else {
        expect(prev.signal).toBeGreaterThan(curr.signal);
      }
    }
  });

  it("excludes disliked, built and completed projects but keeps opened ones eligible", () => {
    const profile = behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }]));
    const excluded = new Set(["write-an-http-server", "implement-a-dns-resolver", "userspace-tcp-ip-stack"]);
    const candidates = retrieveContentCandidates(profile.vector, catalog, { excludedProjectIds: excluded });
    const ids = new Set(candidates.map((c) => c.projectId));
    for (const id of excluded) expect(ids.has(id)).toBe(false);
    // An OPEN on a project does not exclude it: the profile is only used for affinity here.
    expect(ids.has("build-your-own-redis")).toBe(true);
    expect(ids.has("implement-a-tiny-database")).toBe(true);
  });

  it("returns nothing for an empty profile and respects the limit", () => {
    expect(retrieveContentCandidates({}, catalog)).toEqual([]);
    const profile = onboardingProfile(["web"]);
    expect(retrieveContentCandidates(profile.vector, catalog, { limit: 5 })).toHaveLength(5);
    expect(retrieveContentCandidates(profile.vector, catalog, { limit: 0 })).toEqual([]);
  });

  it("gives negative affinity to projects the profile dislikes, which never become content candidates", () => {
    const profile = behaviourProfile(interactionsOn([{ slug: "habit-tracker-mobile-app", type: "DISLIKE" }, { slug: "build-your-own-redis", type: "SAVE" }]));
    const affinity = scoreContentAffinity(profile.vector, catalog);
    expect(affinity.get("habit-tracker-mobile-app")!).toBeLessThan(0);
    const ids = new Set(retrieveContentCandidates(profile.vector, catalog).map((c) => c.projectId));
    expect(ids.has("habit-tracker-mobile-app")).toBe(false);
  });

  it("is deterministic", () => {
    const profile = onboardingProfile(["security", "networking"]);
    const a = retrieveContentCandidates(profile.vector, catalog);
    const b = retrieveContentCandidates(profile.vector, catalog);
    expect(a).toEqual(b);
  });
});
