import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { EMPTY_PROFILE } from "@/lib/recommender/profile";
import { runRecommendationPipeline } from "@/lib/recommender/recommend";
import { SCORE_COMPONENTS } from "@/lib/recommender/types";
import {
  behaviourProfile,
  catalogFixture,
  fixtureLabelFor,
  interactionsOn,
  onboardingProfile,
  profileInput,
  projectBySlug,
  sessionOf,
} from "../helpers/catalog-fixture";
import { clusterInteractions, ev } from "../helpers/collaborative-fixture";

/**
 * Cross-phase recommender regression (Phase 9, §6): one deterministic fixture
 * that exercises every phase's signal simultaneously — long-term taste with a
 * negative preference (P2), content + popularity retrieval (P3), item-item
 * collaborative evidence (P4), exploration/novelty + MMR diversification (P5),
 * an adaptive current-session focus (P6) — through the full pipeline
 * (profile → retrieve ×4 → merge → filter → rank → diversify → explain), and
 * asserts the engine's invariants rather than fragile exact rankings.
 */
const catalog = catalogFixture();
const evidence = new Map<string, number>(catalog.map((p) => [p.id, Math.round(p.popularity * 40)]));

// Behavioural CF world plus the target user's own history.
const history = [
  ...clusterInteractions(),
  ev("target", "build-your-own-redis", "SAVE"),
  ev("target", "write-an-http-server", "BUILD"),
  ev("target", "implement-a-dns-resolver", "SAVE"),
];

// Long-term: systems/networking taste + an explicit negative (mobile dislikes).
const longTerm = behaviourProfile(
  interactionsOn([
    { slug: "build-your-own-redis", type: "SAVE", daysAgo: 3 },
    { slug: "write-an-http-server", type: "BUILD", daysAgo: 10 },
    { slug: "implement-a-dns-resolver", type: "SAVE", daysAgo: 2 },
    { slug: "toy-container-runtime", type: "SAVE", daysAgo: 1 },
    { slug: "habit-tracker-mobile-app", type: "DISLIKE", daysAgo: 4 },
    { slug: "barcode-pantry-inventory-app", type: "DISLIKE", daysAgo: 4 },
  ]),
);

// Current session: coherent graphics focus.
const session = sessionOf([
  { slug: "webgl-fluid-simulation", type: "SAVE" },
  { slug: "live-shader-playground", type: "SAVE" },
  { slug: "implement-a-ray-tracer", type: "OPEN" },
]);

// Terminal exclusions + a saved-but-eligible candidate.
const excludedProjectIds = new Set([
  "write-an-http-server", // built
  "habit-tracker-mobile-app", // disliked
  "barcode-pantry-inventory-app", // disliked
]);
const savedProjectIds = new Set(["build-your-own-redis"]);

function run(limit = 10, explorationPreference = 0.35) {
  return runRecommendationPipeline({
    userId: "target",
    profile: profileInput(longTerm, { ...session, explorationPreference, excludedProjectIds, savedProjectIds }),
    catalog,
    popularityEvidence: evidence,
    interactions: history,
    labelFor: fixtureLabelFor,
    limit,
  });
}

describe("cross-phase pipeline regression", () => {
  const output = run();

  it("activates every signal at once: all five components, four retrieval sources, session + diversification context", () => {
    expect(output.context.components).toEqual(["content", "collaborative", "session", "novelty", "popularity"]);
    expect(output.pipeline.contentCandidates).toBeGreaterThan(0);
    expect(output.pipeline.collaborativeCandidates).toBeGreaterThan(0);
    expect(output.pipeline.popularCandidates).toBeGreaterThan(0);
    expect(output.pipeline.explorationCandidates).toBeGreaterThan(0);
    expect(output.context.session.available).toBe(true);
    expect(output.context.session.blendWeight).toBeGreaterThan(0);
    expect(output.context.collaborative.available).toBe(true);
    expect(output.context.diversification.applied).toBe(true);
    const sourcesSeen = new Set(output.items.flatMap((item) => item.sources));
    expect(sourcesSeen.size).toBeGreaterThanOrEqual(3);
  });

  it("upholds the core feed invariants: unique, bounded, finite, honestly sourced and null-preserving", () => {
    expect(output.items.length).toBeLessThanOrEqual(10);
    expect(new Set(output.items.map((item) => item.projectId)).size).toBe(output.items.length);
    expect(output.pipeline.final).toBe(output.items.length);
    for (const item of output.items) {
      expect(Number.isFinite(item.score)).toBe(true);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(item.sources.length).toBeGreaterThan(0);
      for (const component of SCORE_COMPONENTS) {
        const value = item.breakdown[component];
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
      for (const value of Object.values(item.rawSignals)) expect(Number.isFinite(value)).toBe(true);
      // Sources are truthful: a collaborative source implies real evidence, exploration implies diagnostics.
      if (item.sources.includes("collaborative")) expect(item.collaborative).not.toBeNull();
      else expect(item.breakdown.collaborative).toBeNull();
      if (item.sources.includes("exploration")) expect(item.exploration).not.toBeNull();
      else expect(item.exploration).toBeNull();
      // The MMR score is a diagnostic, never the match score.
      expect(item.diversification.mmrScore).toBeLessThanOrEqual(item.score + 1e-9);
      expect(item.explanation.text.length).toBeGreaterThan(0);
    }
  });

  it("excludes terminal projects, demotes (not hides) the saved project, and never rewards the disliked topic", () => {
    const ids = new Set(output.items.map((item) => item.projectId));
    for (const excluded of excludedProjectIds) expect(ids.has(excluded)).toBe(false);
    // The saved project stays eligible in a deep list but carries the demotion flag.
    const deep = run(100);
    const saved = deep.items.find((item) => item.projectId === "build-your-own-redis");
    expect(saved).toBeDefined();
    expect(saved!.saved).toBe(true);
    // Mobile projects carry negative long-term affinity — none of them may be surfaced as
    // exploration/novelty picks (negative affinity is never converted into reward).
    for (const item of output.items) {
      const tags = projectBySlug(item.projectId).tagSlugs;
      if (tags.includes("mobile")) {
        expect(item.breakdown.content ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("keeps ranking and diversification deterministic and internally consistent", () => {
    const again = run();
    expect(again.items.map((item) => [item.projectId, item.score, item.rank, item.preDiversificationRank])).toEqual(
      output.items.map((item) => [item.projectId, item.score, item.rank, item.preDiversificationRank]),
    );
    expect(again.context).toEqual(output.context);
    // Diversified order re-orders but never re-scores: scores follow pre-diversification rank.
    const byPre = [...output.items].sort((a, b) => a.preDiversificationRank - b.preDiversificationRank);
    for (let i = 1; i < byPre.length; i++) expect(byPre[i - 1]!.score).toBeGreaterThanOrEqual(byPre[i]!.score);
  });

  it("responds to the exploration control with composition, not just labels", () => {
    const familiar = run(10, 0);
    const adventurous = run(10, 1);
    expect(familiar.context.exploration.mode).toBe("familiar");
    expect(adventurous.context.exploration.mode).toBe("adventurous");
    expect(adventurous.items.map((item) => item.projectId)).not.toEqual(familiar.items.map((item) => item.projectId));
    const meanNovelty = (items: typeof familiar.items) => items.reduce((sum, item) => sum + item.novelty.novelty, 0) / items.length;
    expect(meanNovelty(adventurous.items)).toBeGreaterThan(meanNovelty(familiar.items));
    // Adventurous is not random: every pick keeps positive content or collaborative grounding.
    for (const item of adventurous.items) {
      expect((item.breakdown.content ?? 0) > 0 || (item.breakdown.collaborative ?? 0) > 0).toBe(true);
    }
  });

  it("keeps the session temporary: the long-term profile is untouched by the session input", () => {
    expect(longTerm.signals["tag:graphics"]).toBeUndefined();
    expect(session.session.signals["tag:systems"]).toBeUndefined();
    const withoutSession = run(10, 0.35);
    expect(withoutSession.context.session.blendWeight).toBeLessThanOrEqual(RECOMMENDER_CONFIG.session.maxBlendWeight);
  });
});

describe("cold-start matrix (§7)", () => {
  const rows = clusterInteractions();
  const cases: { name: string; profile: Parameters<typeof runRecommendationPipeline>[0]["profile"]; interactions: typeof rows; expectComponents: string[] }[] = [
    {
      name: "A: completely empty user",
      profile: profileInput(EMPTY_PROFILE),
      interactions: rows,
      expectComponents: ["novelty", "popularity"],
    },
    {
      name: "B: onboarding-only user",
      profile: profileInput(onboardingProfile(["systems", "databases", "networking"])),
      interactions: rows,
      expectComponents: ["content", "novelty", "popularity"],
    },
    {
      name: "C: weak behavioural history (single OPEN)",
      profile: profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "OPEN" }]))),
      interactions: [...rows, ev("target", "build-your-own-redis", "OPEN")],
      expectComponents: ["content", "collaborative", "novelty", "popularity"],
    },
    {
      name: "D: content history but no CF evidence (no other users)",
      profile: profileInput(behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "SAVE" }, { slug: "write-an-http-server", type: "SAVE" }]))),
      interactions: [],
      expectComponents: ["content", "novelty", "popularity"],
    },
    {
      name: "F: strong current session, weak long-term",
      profile: profileInput(
        behaviourProfile(interactionsOn([{ slug: "build-your-own-redis", type: "OPEN", daysAgo: 40 }])),
        sessionOf([
          { slug: "webgl-fluid-simulation", type: "SAVE" },
          { slug: "live-shader-playground", type: "SAVE" },
          { slug: "implement-a-ray-tracer", type: "OPEN" },
        ]),
      ),
      interactions: rows,
      expectComponents: ["content", "session", "novelty", "popularity"],
    },
    {
      name: "G: strong long-term, empty current session",
      profile: profileInput(
        behaviourProfile(
          interactionsOn([
            { slug: "build-your-own-redis", type: "SAVE" },
            { slug: "write-an-http-server", type: "BUILD" },
            { slug: "implement-a-dns-resolver", type: "SAVE" },
            { slug: "implement-a-tiny-database", type: "SAVE" },
          ]),
        ),
      ),
      interactions: rows,
      expectComponents: ["content", "novelty", "popularity"],
    },
  ];

  it.each(cases)("$name produces valid finite recommendations with honest components", ({ profile, interactions, expectComponents }) => {
    const output = runRecommendationPipeline({
      userId: "target",
      profile,
      catalog,
      popularityEvidence: evidence,
      interactions,
      labelFor: fixtureLabelFor,
      limit: 10,
    });
    expect(output.items.length).toBeGreaterThanOrEqual(5);
    expect(new Set(output.items.map((item) => item.projectId)).size).toBe(output.items.length);
    for (const item of output.items) {
      expect(Number.isFinite(item.score)).toBe(true);
      expect(item.explanation.text.length).toBeGreaterThan(0);
    }
    const withoutCollaborative = expectComponents.filter((component) => component !== "collaborative");
    if (expectComponents.includes("collaborative")) expect(output.context.components).toEqual(expectComponents);
    else {
      expect(output.context.components).toEqual(withoutCollaborative);
      expect(output.items.every((item) => item.breakdown.collaborative === null)).toBe(true);
    }
  });

  it("E: a project with no interaction history anywhere can still surface (content/exploration)", () => {
    const noEvidence = new Map(evidence);
    noEvidence.set("implement-raft-consensus", 0);
    const output = runRecommendationPipeline({
      userId: "target",
      profile: profileInput(onboardingProfile(["distributed", "systems"], { chosen: ["implement-raft-consensus"] }), { explorationPreference: 0.5 }),
      catalog,
      popularityEvidence: noEvidence,
      interactions: [], // nobody has ever interacted with anything
      labelFor: fixtureLabelFor,
      limit: 40,
    });
    const raft = output.items.find((item) => item.projectId === "implement-raft-consensus");
    expect(raft).toBeDefined();
    expect(raft!.breakdown.collaborative).toBeNull();
    expect(raft!.sources.some((source) => source === "content" || source === "exploration")).toBe(true);
  });
});
