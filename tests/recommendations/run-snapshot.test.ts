import { describe, expect, it } from "vitest";
import {
  buildRunSnapshot,
  componentContributions,
  parseCandidateSources,
  parseRankingWeights,
  parseRawSignals,
  parseResultDiagnostics,
  parseRunDiagnostics,
  sanitizeJsonValue,
} from "@/lib/recommendations/run-snapshot";
import { runRecommendationPipeline, type RecommendationResult } from "@/lib/recommender/recommend";
import type { ScoreBreakdown } from "@/lib/recommender/types";
import { EMPTY_PROFILE } from "@/lib/recommender/profile";
import {
  NOW,
  behaviourProfile,
  catalogFixture,
  fixtureLabelFor,
  interactionsOn,
  profileInput,
  sessionOf,
} from "../helpers/catalog-fixture";
import { clusterInteractions, ev } from "../helpers/collaborative-fixture";

const catalog = catalogFixture();

/** A genuine orchestrator result: behavioural user + session + CF history, every component live. */
function generateResult(overrides: Partial<Parameters<typeof profileInput>[1]> = {}, limit = 10): RecommendationResult {
  const history = [
    ...clusterInteractions(),
    ev("target", "build-your-own-redis", "SAVE"),
    ev("target", "write-an-http-server", "BUILD"),
    ev("target", "implement-a-dns-resolver", "SAVE"),
  ];
  const longTerm = behaviourProfile(
    interactionsOn([
      { slug: "build-your-own-redis", type: "SAVE", daysAgo: 3 },
      { slug: "write-an-http-server", type: "BUILD", daysAgo: 10 },
      { slug: "implement-a-dns-resolver", type: "SAVE", daysAgo: 2 },
      { slug: "toy-container-runtime", type: "SAVE", daysAgo: 1 },
    ]),
  );
  const evidence = new Map<string, number>(catalog.map((p) => [p.id, Math.round(p.popularity * 40)]));
  const output = runRecommendationPipeline({
    userId: "target",
    profile: profileInput(longTerm, {
      ...sessionOf([
        { slug: "webgl-fluid-simulation", type: "SAVE" },
        { slug: "live-shader-playground", type: "SAVE" },
        { slug: "implement-a-ray-tracer", type: "OPEN" },
      ]),
      explorationPreference: 0.35,
      savedProjectIds: new Set(["build-your-own-redis"]),
      ...overrides,
    }),
    catalog,
    popularityEvidence: evidence,
    interactions: history,
    labelFor: fixtureLabelFor,
    limit,
  });
  return { ...output, generatedAt: NOW.toISOString(), limit };
}

describe("sanitizeJsonValue", () => {
  it("nulls non-finite numbers, drops undefined keys, preserves null and nesting", () => {
    expect(sanitizeJsonValue(Number.NaN)).toBeNull();
    expect(sanitizeJsonValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeJsonValue(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(sanitizeJsonValue(0.5)).toBe(0.5);
    expect(sanitizeJsonValue(null)).toBeNull();
    expect(sanitizeJsonValue("x")).toBe("x");
    expect(sanitizeJsonValue(false)).toBe(false);
    expect(sanitizeJsonValue({ keep: null, drop: undefined, bad: Number.NaN, nested: { fn: () => 1, ok: 2 } })).toEqual({
      keep: null,
      bad: null,
      nested: { ok: 2 },
    });
    expect(sanitizeJsonValue([1, Number.NaN, undefined, null, "a"])).toEqual([1, null, null, null, "a"]);
    expect(sanitizeJsonValue(new Date("2026-08-19T00:00:00.000Z"))).toBe("2026-08-19T00:00:00.000Z");
    // The result must survive JSON round-tripping unchanged.
    const sanitized = sanitizeJsonValue({ a: [Number.NaN, { b: undefined, c: -0.25 }], d: null });
    expect(JSON.parse(JSON.stringify(sanitized))).toEqual(sanitized);
  });
});

describe("buildRunSnapshot", () => {
  const result = generateResult();
  const snapshot = buildRunSnapshot("user-1", result);

  it("maps the run verbatim: algorithm, session, pipeline counts, weights and full context (nothing recomputed)", () => {
    expect(snapshot.run.userId).toBe("user-1");
    expect(snapshot.run.algorithm).toBe(result.algorithm);
    expect(snapshot.run.sessionId).toBe(result.context.session.sessionId);
    expect(snapshot.run.explorationPreference).toBe(result.context.exploration.preference);
    expect(snapshot.run.requestedLimit).toBe(result.limit);
    expect(snapshot.run.contentCandidateCount).toBe(result.pipeline.contentCandidates);
    expect(snapshot.run.collaborativeCandidateCount).toBe(result.pipeline.collaborativeCandidates);
    expect(snapshot.run.popularCandidateCount).toBe(result.pipeline.popularCandidates);
    expect(snapshot.run.explorationCandidateCount).toBe(result.pipeline.explorationCandidates);
    expect(snapshot.run.uniqueCandidateCount).toBe(result.pipeline.uniqueCandidates);
    expect(snapshot.run.filteredCandidateCount).toBe(result.pipeline.afterFiltering);
    expect(snapshot.run.rankedCandidateCount).toBe(result.pipeline.ranked);
    expect(snapshot.run.finalCount).toBe(result.pipeline.final);
    expect(snapshot.run.rankingWeights).toEqual(result.items[0]!.weights);
    expect(snapshot.run.diagnostics.pipeline).toEqual(result.pipeline);
    expect(snapshot.run.diagnostics.context).toEqual(result.context);
    expect(snapshot.run.diagnostics.generatedAt).toBe(result.generatedAt);
    // Session diagnostics (Phase 6) propagate untouched into the snapshot.
    expect(snapshot.run.diagnostics.context.session.evidence).toBe(result.context.session.evidence);
    expect(snapshot.run.diagnostics.context.session.coherence).toBe(result.context.session.coherence);
    expect(snapshot.run.diagnostics.context.session.confidence).toBe(result.context.session.confidence);
    expect(snapshot.run.diagnostics.context.session.blendWeight).toBe(result.context.session.blendWeight);
    expect(snapshot.run.diagnostics.context.session.topFeatures).toEqual(result.context.session.topFeatures);
  });

  it("maps every result verbatim: ranks, scores, sources, raw signals and the exact explanation", () => {
    expect(snapshot.results).toHaveLength(result.items.length);
    for (const [index, item] of result.items.entries()) {
      const stored = snapshot.results[index]!;
      expect(stored.projectId).toBe(item.projectId);
      expect(stored.rank).toBe(item.rank);
      expect(stored.preDiversificationRank).toBe(item.preDiversificationRank);
      expect(stored.finalScore).toBe(item.score);
      expect(stored.contentScore).toBe(item.breakdown.content);
      expect(stored.collaborativeScore).toBe(item.breakdown.collaborative);
      expect(stored.sessionScore).toBe(item.breakdown.session);
      expect(stored.noveltyScore).toBe(item.breakdown.novelty);
      expect(stored.popularityScore).toBe(item.breakdown.popularity);
      expect(stored.candidateSources).toEqual(item.sources);
      expect(stored.rawSignals).toEqual(item.rawSignals);
      expect(stored.explanation).toBe(item.explanation.text);
      expect(stored.diagnostics.explanation).toEqual(item.explanation);
      expect(stored.diagnostics.collaborative).toEqual(item.collaborative);
      expect(stored.diagnostics.session).toEqual(item.session);
      expect(stored.diagnostics.novelty).toEqual(item.novelty);
      expect(stored.diagnostics.exploration).toEqual(item.exploration);
      expect(stored.diagnostics.diversification).toEqual(item.diversification);
      expect(stored.diagnostics.saved).toBe(item.saved);
    }
    // The saved/demoted project keeps its flag in the snapshot.
    const saved = snapshot.results.find((entry) => entry.projectId === "build-your-own-redis");
    if (saved) expect(saved.diagnostics.saved).toBe(true);
  });

  it("preserves null semantics: unavailable components stay null, never 0 (and survive JSON round-trips)", () => {
    // No collaborative history and an empty long-term profile: content/collaborative/session all unavailable.
    const bare = runRecommendationPipeline({
      userId: "nobody",
      profile: profileInput(EMPTY_PROFILE),
      catalog,
      popularityEvidence: new Map([["implement-a-ray-tracer", 40]]),
      interactions: [],
      labelFor: fixtureLabelFor,
      limit: 5,
    });
    const bareSnapshot = buildRunSnapshot("nobody", { ...bare, generatedAt: NOW.toISOString(), limit: 5 });
    for (const stored of bareSnapshot.results) {
      expect(stored.contentScore).toBeNull();
      expect(stored.collaborativeScore).toBeNull();
      expect(stored.sessionScore).toBeNull();
      expect(stored.noveltyScore).not.toBeNull();
      expect(stored.diagnostics.collaborative).toBeNull();
      expect(stored.diagnostics.session).toBeNull();
    }
    const roundTripped = JSON.parse(JSON.stringify(bareSnapshot.results[0]!.diagnostics));
    expect(roundTripped.collaborative).toBeNull();
    expect(roundTripped.session).toBeNull();
    expect(parseResultDiagnostics(roundTripped)?.collaborative).toBeNull();
  });

  it("is a deep copy: mutating the source result afterwards never changes the snapshot (§56)", () => {
    const local = generateResult();
    const frozen = buildRunSnapshot("user-1", local);
    const before = JSON.parse(JSON.stringify(frozen));
    // Simulate "the profile changed and someone recomputed": mutate everything reachable.
    local.pipeline.final = 999;
    local.context.session.confidence = 0.999;
    local.context.exploration.preference = 1;
    (local.context.session.topFeatures as unknown[]).length = 0;
    local.items[0]!.breakdown.content = 0.001;
    local.items[0]!.explanation.text = "rewritten after the fact";
    local.items[0]!.rawSignals.contentAffinity = -1;
    local.items[0]!.sources.push("popular");
    expect(frozen).toEqual(before);
    expect(frozen.run.diagnostics.context.session.confidence).not.toBe(0.999);
    expect(frozen.results[0]!.explanation).not.toBe("rewritten after the fact");
  });

  it("passes through fabricated pipeline counts exactly — nothing is recalculated from the results (§60)", () => {
    const local = generateResult({}, 10);
    const doctored: RecommendationResult = {
      ...local,
      pipeline: {
        contentCandidates: 50,
        collaborativeCandidates: 30,
        popularCandidates: 15,
        explorationCandidates: 12,
        uniqueCandidates: 78,
        afterFiltering: 71,
        ranked: 71,
        preDiversificationCandidates: 71,
        diversifiedCandidates: 10,
        final: 10,
      },
    };
    const snap = buildRunSnapshot("u", doctored);
    expect(snap.run.contentCandidateCount).toBe(50);
    expect(snap.run.collaborativeCandidateCount).toBe(30);
    expect(snap.run.popularCandidateCount).toBe(15);
    expect(snap.run.explorationCandidateCount).toBe(12);
    expect(snap.run.uniqueCandidateCount).toBe(78);
    expect(snap.run.filteredCandidateCount).toBe(71);
    expect(snap.run.rankedCandidateCount).toBe(71);
    expect(snap.run.finalCount).toBe(10);
    expect(snap.run.diagnostics.pipeline).toEqual(doctored.pipeline);
  });

  it("stores candidate sources exactly as retrieved — every combination, no invented badges (§59)", () => {
    const local = generateResult();
    const combos: string[][] = [["content"], ["collaborative"], ["exploration"], ["content", "collaborative"], ["content", "exploration"], ["content", "collaborative", "popular", "exploration"]];
    const doctored: RecommendationResult = {
      ...local,
      items: combos.map((sources, index) => ({
        ...local.items[0]!,
        projectId: `p-${index}`,
        rank: index + 1,
        preDiversificationRank: index + 1,
        sources: sources as RecommendationResult["items"][number]["sources"],
      })),
    };
    const snap = buildRunSnapshot("u", doctored);
    expect(snap.results.map((entry) => entry.candidateSources)).toEqual(combos);
    expect(parseCandidateSources(["content", "made-up-source", "popular"])).toEqual(["content", "popular"]);
  });
});

describe("parse helpers degrade gracefully (§8)", () => {
  const result = generateResult();
  const snapshot = buildRunSnapshot("user-1", result);

  it("round-trips valid snapshots and rejects malformed ones without throwing", () => {
    const runJson = JSON.parse(JSON.stringify(snapshot.run.diagnostics));
    expect(parseRunDiagnostics(runJson)?.pipeline).toEqual(result.pipeline);
    expect(parseRunDiagnostics(null)).toBeNull();
    expect(parseRunDiagnostics(5)).toBeNull();
    expect(parseRunDiagnostics({})).toBeNull();
    expect(parseRunDiagnostics({ pipeline: {} })).toBeNull();
    const resultJson = JSON.parse(JSON.stringify(snapshot.results[0]!.diagnostics));
    expect(parseResultDiagnostics(resultJson)?.explanation.text).toBe(result.items[0]!.explanation.text);
    expect(parseResultDiagnostics(null)).toBeNull();
    expect(parseResultDiagnostics({ explanation: { text: 42 } })).toBeNull();
  });

  it("parses ranking weights and raw signals defensively (finite numbers only)", () => {
    expect(parseRankingWeights(snapshot.run.rankingWeights)).toEqual(result.items[0]!.weights);
    expect(parseRankingWeights(null)).toEqual({});
    expect(parseRankingWeights({ content: "high", session: 0.1, bogus: 0.4 })).toEqual({ session: 0.1 });
    expect(parseRawSignals({ content: 0.5, junk: "x", bad: Number.NaN })).toEqual({ content: 0.5 });
    expect(parseRawSignals(null)).toEqual({});
  });
});

describe("componentContributions (§58)", () => {
  it("multiplies score by effective weight and never fabricates a contribution for missing components", () => {
    const breakdown: ScoreBreakdown = { content: 0.8, collaborative: 0.5, session: null, novelty: 0.4, popularity: 0.6 };
    const weights = { content: 0.4, collaborative: 0.25, novelty: 0.15, popularity: 0.2 };
    const contributions = componentContributions(breakdown, weights);
    expect(contributions.content).toBeCloseTo(0.32, 10);
    expect(contributions.collaborative).toBeCloseTo(0.125, 10);
    expect(contributions.session).toBeNull(); // null score → no contribution, not 0
    expect(contributions.novelty).toBeCloseTo(0.06, 10);
    expect(contributions.popularity).toBeCloseTo(0.12, 10);
    // A component with a score but no weight in force contributes nothing (null, not 0.something).
    const partial = componentContributions({ content: 0.9, collaborative: null, session: 0.7, novelty: 0.2, popularity: 0.1 }, { content: 0.6 });
    expect(partial.content).toBeCloseTo(0.54, 10);
    expect(partial.session).toBeNull();
    expect(partial.collaborative).toBeNull();
    // Deterministic and total over all five components.
    expect(Object.keys(contributions).sort()).toEqual(["collaborative", "content", "novelty", "popularity", "session"]);
  });

  it("matches the run snapshot end-to-end: contribution sums approximate the recommendation score for non-demoted items", () => {
    const result = generateResult();
    const snapshot = buildRunSnapshot("user-1", result);
    const weights = parseRankingWeights(snapshot.run.rankingWeights);
    for (const [index, stored] of snapshot.results.entries()) {
      const item = result.items[index]!;
      const contributions = componentContributions(
        { content: stored.contentScore, collaborative: stored.collaborativeScore, session: stored.sessionScore, novelty: stored.noveltyScore, popularity: stored.popularityScore },
        weights,
      );
      const total = (Object.values(contributions) as (number | null)[]).reduce<number>((sum, value) => sum + (value ?? 0), 0);
      if (!item.saved) expect(total).toBeCloseTo(item.score, 6);
      else expect(total * 0.6).toBeCloseTo(item.score, 6); // saved demotion happens after the weighted sum
    }
  });
});

describe("signed profile ordering feeds the insights view deterministically (§61)", () => {
  it("rankFeatures keeps signs and deterministic order for positive and negative groups", async () => {
    const { rankFeatures } = await import("@/lib/recommender/profile");
    const profile = {
      ...EMPTY_PROFILE,
      signals: { "tag:systems": 0.8, "tag:databases": 0.5, "tag:graphics": -0.6, "tag:mobile": -0.3, "lang:php": -0.2, "lang:rust": 0.4 },
    };
    const positive = rankFeatures(profile, { sign: "positive" });
    const negative = rankFeatures(profile, { sign: "negative" });
    expect(positive.map((f) => f.id)).toEqual(["tag:systems", "tag:databases", "lang:rust"]);
    expect(negative.map((f) => f.id)).toEqual(["tag:graphics", "tag:mobile", "lang:php"]);
    expect(positive.every((f) => f.signal > 0)).toBe(true);
    expect(negative.every((f) => f.signal < 0)).toBe(true);
    const negativeTagsOnly = rankFeatures(profile, { family: "tag", sign: "negative" });
    expect(negativeTagsOnly.map((f) => f.id)).toEqual(["tag:graphics", "tag:mobile"]);
    expect(rankFeatures(profile, { sign: "negative" })).toEqual(negative); // deterministic
  });
});
