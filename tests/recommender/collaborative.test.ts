import { describe, expect, it } from "vitest";
import {
  buildCollaborativeModel,
  buildItemVectors,
  collaborativeSeedsForUser,
  collaborativeSignalFromState,
  collaborativeSignals,
  computeItemNeighbours,
  itemSimilarity,
  retrieveCollaborativeCandidates,
  scoreCollaborativeCandidates,
  strongestSeedState,
  type ItemVector,
} from "@/lib/recommender/collaborative";
import { RECOMMENDER_CONFIG, interactionWeight } from "@/lib/recommender/config";
import { positiveEvidenceFromCounts } from "@/lib/recommender/popularity";
import type { CollaborativeInteraction } from "@/lib/recommender/types";
import { catalogFixture } from "../helpers/catalog-fixture";
import { GRAPHICS_CLUSTER as GRAPHICS, SYSTEMS_CLUSTER as SYSTEMS, clusterInteractions, ev } from "../helpers/collaborative-fixture";

const vec = (entries: Record<string, number>): ItemVector => new Map(Object.entries(entries));
const catalog = catalogFixture();
const projects = catalog.map((p) => ({ id: p.id, slug: p.slug }));

describe("collaborative signal (current-state semantics)", () => {
  const signalFor = (rows: CollaborativeInteraction[]) => collaborativeSeedsForUser(rows, "u")[0]?.weight ?? 0;

  it("SAVE, SHARE, BUILD and COMPLETE are positive evidence with BUILD > SAVE and COMPLETE strongest", () => {
    expect(signalFor([ev("u", "p", "SAVE")])).toBe(interactionWeight("SAVE"));
    expect(signalFor([ev("u", "p", "SHARE")])).toBe(interactionWeight("SHARE"));
    expect(signalFor([ev("u", "p", "BUILD")])).toBe(interactionWeight("BUILD"));
    expect(signalFor([ev("u", "p", "COMPLETE")])).toBe(interactionWeight("COMPLETE"));
    expect(signalFor([ev("u", "p", "BUILD")])).toBeGreaterThan(signalFor([ev("u", "p", "SAVE")]));
    expect(signalFor([ev("u", "p", "COMPLETE")])).toBeGreaterThan(signalFor([ev("u", "p", "BUILD")]));
  });

  it("OPEN is weak evidence and IMPRESSION contributes nothing", () => {
    expect(signalFor([ev("u", "p", "OPEN")])).toBe(interactionWeight("OPEN"));
    expect(signalFor([ev("u", "p", "OPEN")])).toBeLessThan(signalFor([ev("u", "p", "SAVE")]) / 3);
    expect(collaborativeSeedsForUser([ev("u", "p", "IMPRESSION"), ev("u", "p", "IMPRESSION")], "u")).toEqual([]);
  });

  it("DISLIKE is never positive evidence, even after a SAVE; a later SAVE lifts it", () => {
    expect(collaborativeSeedsForUser([ev("u", "p", "DISLIKE")], "u")).toEqual([]);
    expect(collaborativeSeedsForUser([ev("u", "p", "SAVE"), ev("u", "p", "DISLIKE")], "u")).toEqual([]);
    expect(collaborativeSeedsForUser([ev("u", "p", "BUILD"), ev("u", "p", "DISLIKE")], "u")).toEqual([]);
    expect(signalFor([ev("u", "p", "DISLIKE"), ev("u", "p", "SAVE")])).toBe(interactionWeight("SAVE"));
  });

  it("UNSAVE reverses a SAVE instead of leaving the old SAVE as evidence", () => {
    expect(collaborativeSeedsForUser([ev("u", "p", "SAVE"), ev("u", "p", "UNSAVE")], "u")).toEqual([]);
    expect(signalFor([ev("u", "p", "SAVE"), ev("u", "p", "UNSAVE"), ev("u", "p", "SAVE")])).toBe(interactionWeight("SAVE"));
    // An UNSAVE does not erase other positive states such as OPEN.
    expect(signalFor([ev("u", "p", "OPEN"), ev("u", "p", "SAVE"), ev("u", "p", "UNSAVE")])).toBe(interactionWeight("OPEN"));
  });

  it("counts each state once, so repeating an action cannot inflate evidence", () => {
    expect(signalFor([ev("u", "p", "SAVE"), ev("u", "p", "SAVE"), ev("u", "p", "SAVE")])).toBe(interactionWeight("SAVE"));
    expect(signalFor(Array.from({ length: 12 }, () => ev("u", "p", "OPEN")))).toBe(interactionWeight("OPEN"));
    expect(signalFor([ev("u", "p", "BUILD"), ev("u", "p", "COMPLETE")])).toBe(interactionWeight("COMPLETE"));
    const everything = signalFor([ev("u", "p", "OPEN"), ev("u", "p", "SAVE"), ev("u", "p", "SHARE"), ev("u", "p", "BUILD"), ev("u", "p", "COMPLETE")]);
    expect(everything).toBe(interactionWeight("COMPLETE") + interactionWeight("SAVE") + interactionWeight("SHARE") + interactionWeight("OPEN"));
    expect(Number.isFinite(everything)).toBe(true);
  });

  it("orders seeds by weight and reports the strongest state deterministically", () => {
    const rows = [ev("u", "b", "SAVE"), ev("u", "a", "SAVE"), ev("u", "c", "BUILD"), ev("u", "d", "OPEN")];
    const seeds = collaborativeSeedsForUser(rows, "u");
    expect(seeds.map((s) => [s.projectId, s.state])).toEqual([
      ["c", "built"],
      ["a", "saved"],
      ["b", "saved"],
      ["d", "opened"],
    ]);
    expect(collaborativeSeedsForUser(rows, "u")).toEqual(seeds);
    expect(strongestSeedState({ saved: true, disliked: false, built: true, completed: true, opened: true, shared: true })).toBe("completed");
    expect(collaborativeSignalFromState({ saved: false, disliked: false, built: false, completed: false, opened: false, shared: false })).toBe(0);
  });

  it("derives per-user signals for every user in one pass", () => {
    const signals = collaborativeSignals([ev("a", "p", "SAVE"), ev("b", "p", "DISLIKE"), ev("b", "q", "BUILD"), ev("c", "q", "IMPRESSION")]);
    expect([...signals.keys()]).toEqual(["a", "b"]);
    expect(signals.get("a")!.get("p")!.value).toBe(interactionWeight("SAVE"));
    expect(signals.get("b")!.has("p")).toBe(false);
    expect(signals.get("b")!.get("q")!.state).toBe("built");
  });
});

describe("item vectors", () => {
  it("place only positive signals in item vectors and support leave-one-out", () => {
    const signals = collaborativeSignals([ev("a", "p", "SAVE"), ev("b", "p", "BUILD"), ev("b", "q", "DISLIKE"), ev("c", "q", "SAVE")]);
    const vectors = buildItemVectors(signals);
    expect([...vectors.get("p")!.entries()]).toEqual([
      ["a", interactionWeight("SAVE")],
      ["b", interactionWeight("BUILD")],
    ]);
    expect(vectors.get("q")!.has("b")).toBe(false);
    const withoutB = buildItemVectors(signals, { excludeUserId: "b" });
    expect(withoutB.get("p")!.has("b")).toBe(false);
    expect(withoutB.get("p")!.get("a")).toBe(interactionWeight("SAVE"));
  });
});

describe("item-item similarity", () => {
  it("is maximal for identical audiences (1.0 unshrunk; dampened by overlap/(overlap+shrinkage))", () => {
    const a = vec({ u1: 2, u2: 4 });
    const b = vec({ u1: 2, u2: 4 });
    expect(itemSimilarity(a, b, 0).similarity).toBeCloseTo(1, 10);
    const shrunk = itemSimilarity(a, b, 2);
    expect(shrunk.overlap).toBe(2);
    expect(shrunk.similarity).toBeCloseTo(2 / (2 + 2), 10);
    expect(itemSimilarity(a, vec({ u1: 1, u2: 2 }), 0).similarity).toBeCloseTo(1, 10);
  });

  it("is 0 for disjoint audiences and empty vectors", () => {
    expect(itemSimilarity(vec({ u1: 2 }), vec({ u2: 2 }))).toEqual({ similarity: 0, overlap: 0 });
    expect(itemSimilarity(vec({}), vec({ u1: 2 }))).toEqual({ similarity: 0, overlap: 0 });
    expect(itemSimilarity(vec({}), vec({}))).toEqual({ similarity: 0, overlap: 0 });
    expect(itemSimilarity(vec({ u1: 0 }), vec({ u1: 2 })).similarity).toBe(0);
  });

  it("ranks partial overlap between identical and unrelated", () => {
    const a = vec({ u1: 2, u2: 2 });
    const identical = itemSimilarity(a, vec({ u1: 2, u2: 2 }), 0).similarity;
    const partial = itemSimilarity(a, vec({ u1: 2, u3: 2 }), 0).similarity;
    const unrelated = itemSimilarity(a, vec({ u3: 2, u4: 2 }), 0).similarity;
    expect(partial).toBeCloseTo(0.5, 10);
    expect(partial).toBeLessThan(identical);
    expect(partial).toBeGreaterThan(unrelated);
  });

  it("does not give a globally popular item maximal similarity to everything", () => {
    const niche = vec({ u1: 2, u2: 2 });
    const twin = vec({ u1: 2, u2: 2 });
    const popular = vec({ u1: 2, u2: 2, u3: 2, u4: 2, u5: 2, u6: 2 });
    const toTwin = itemSimilarity(niche, twin).similarity;
    const toPopular = itemSimilarity(niche, popular).similarity;
    expect(toPopular).toBeLessThan(toTwin);
    expect(toPopular).toBeGreaterThan(0);
  });

  it("dampens single-user coincidences via shrinkage", () => {
    const one = itemSimilarity(vec({ u1: 2 }), vec({ u1: 2 })).similarity; // cosine 1 × 1/(1+2)
    const two = itemSimilarity(vec({ u1: 2, u2: 2 }), vec({ u1: 2, u2: 2 })).similarity; // 1 × 2/4
    const five = itemSimilarity(vec({ u1: 1, u2: 1, u3: 1, u4: 1, u5: 1 }), vec({ u1: 1, u2: 1, u3: 1, u4: 1, u5: 1 })).similarity;
    expect(one).toBeCloseTo(1 / 3, 10);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(five);
    expect(five).toBeCloseTo(5 / 7, 10);
  });

  it("stays finite, bounded, symmetric and deterministic", () => {
    const a = vec({ u1: 1e6, u2: 3 });
    const b = vec({ u1: 2, u3: 5 });
    const ab = itemSimilarity(a, b);
    expect(ab.similarity).toBeGreaterThanOrEqual(0);
    expect(ab.similarity).toBeLessThanOrEqual(1);
    expect(Number.isFinite(ab.similarity)).toBe(true);
    expect(itemSimilarity(b, a)).toEqual(ab);
    expect(itemSimilarity(a, b)).toEqual(itemSimilarity(a, b));
  });

  it("keeps top-K neighbours per item ordered by similarity then id", () => {
    const vectors = new Map<string, ItemVector>([
      ["a", vec({ u1: 2, u2: 2, u3: 2 })],
      ["b", vec({ u1: 2, u2: 2, u3: 2 })],
      ["c", vec({ u1: 2 })],
      ["d", vec({ u9: 2 })],
    ]);
    const neighbours = computeItemNeighbours(vectors, { neighboursPerItem: 1 });
    expect(neighbours.get("a")!.map((n) => n.projectId)).toEqual(["b"]);
    expect(neighbours.get("d")).toEqual([]);
    const all = computeItemNeighbours(vectors, { neighboursPerItem: 10 });
    expect(all.get("a")!.map((n) => n.projectId)).toEqual(["b", "c"]);
    expect(all.get("c")!.map((n) => n.projectId)).toEqual(["a", "b"]); // tie → id asc
  });
});

describe("collaborative candidate retrieval", () => {
  const rows = clusterInteractions();

  it("retrieves behavioural neighbours of the user's positive projects, never the seeds themselves", () => {
    const target = [...rows, ev("target", "build-your-own-redis", "SAVE"), ev("target", "write-an-http-server", "BUILD")];
    const model = buildCollaborativeModel(target, { excludeUserId: "target" });
    const seeds = collaborativeSeedsForUser(target, "target");
    expect(seeds.map((s) => s.projectId)).toEqual(["write-an-http-server", "build-your-own-redis"]);
    const scoring = scoreCollaborativeCandidates(model, seeds);
    const candidates = retrieveCollaborativeCandidates(scoring, projects);
    const ids = candidates.map((c) => c.projectId);
    expect(ids).toEqual(expect.arrayContaining(["implement-a-dns-resolver", "implement-a-tiny-database"]));
    expect(ids).not.toContain("build-your-own-redis");
    expect(ids).not.toContain("write-an-http-server");
    for (const slug of GRAPHICS) expect(ids).not.toContain(slug);
    expect(candidates.every((c) => c.source === "collaborative" && c.signal > 0 && c.signal <= 1)).toBe(true);
    expect(candidates[0]!.signal).toBeCloseTo(1 * scoring.confidence, 10);
    expect(scoring.scores.get("implement-a-dns-resolver")!.supportingSeeds.map((s) => s.projectId).sort()).toEqual([
      "build-your-own-redis",
      "write-an-http-server",
    ]);
  });

  it("gives more evidence to a candidate supported by several liked seeds than by one weak neighbour", () => {
    // Extra project co-liked only with redis, by a single user who likes nothing else.
    const extra = [
      ...rows,
      ev("solo", "build-your-own-redis", "SAVE"),
      ev("solo", "chip-8-emulator", "SAVE"),
      ev("target", "build-your-own-redis", "SAVE"),
      ev("target", "write-an-http-server", "SAVE"),
    ];
    const model = buildCollaborativeModel(extra, { excludeUserId: "target" });
    const scoring = scoreCollaborativeCandidates(model, collaborativeSeedsForUser(extra, "target"));
    const dns = scoring.scores.get("implement-a-dns-resolver")!;
    const chip8 = scoring.scores.get("chip-8-emulator")!;
    expect(dns.rawEvidence).toBeGreaterThan(chip8.rawEvidence);
    expect(dns.supportingSeeds.length).toBe(2);
    expect(chip8.supportingSeeds.length).toBe(1);
  });

  it("returns at most the configured number of candidates and respects exclusions", () => {
    const target = [...rows, ev("target", "build-your-own-redis", "SAVE")];
    const model = buildCollaborativeModel(target, { excludeUserId: "target" });
    const seeds = collaborativeSeedsForUser(target, "target");
    const excluded = new Set(["implement-a-dns-resolver"]);
    const scoring = scoreCollaborativeCandidates(model, seeds, { excludedProjectIds: excluded });
    expect(scoring.scores.has("implement-a-dns-resolver")).toBe(false);
    const limited = retrieveCollaborativeCandidates(scoring, projects, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(retrieveCollaborativeCandidates(scoring, projects).length).toBeLessThanOrEqual(RECOMMENDER_CONFIG.candidateCounts.collaborative);
  });

  it("returns nothing for users without positive behavioural history, onboarding-only users and impression-only users", () => {
    const model = buildCollaborativeModel(rows, { excludeUserId: "target" });
    expect(retrieveCollaborativeCandidates(scoreCollaborativeCandidates(model, collaborativeSeedsForUser(rows, "target")), projects)).toEqual([]);
    const impressions = [...rows, ev("target", "build-your-own-redis", "IMPRESSION"), ev("target", "write-an-http-server", "IMPRESSION")];
    expect(collaborativeSeedsForUser(impressions, "target")).toEqual([]);
    const disliker = [...rows, ev("target", "build-your-own-redis", "DISLIKE")];
    expect(collaborativeSeedsForUser(disliker, "target")).toEqual([]);
  });

  it("dampens sparse histories through confidence while keeping scores in [0, 1]", () => {
    const weak = [...rows, ev("target", "build-your-own-redis", "OPEN")];
    const strong = [...rows, ev("target", "build-your-own-redis", "BUILD"), ev("target", "write-an-http-server", "SAVE")];
    const weakScoring = scoreCollaborativeCandidates(buildCollaborativeModel(weak, { excludeUserId: "target" }), collaborativeSeedsForUser(weak, "target"));
    const strongScoring = scoreCollaborativeCandidates(buildCollaborativeModel(strong, { excludeUserId: "target" }), collaborativeSeedsForUser(strong, "target"));
    expect(weakScoring.confidence).toBeCloseTo(interactionWeight("OPEN") / RECOMMENDER_CONFIG.collaborative.fullConfidenceSeedWeight, 10);
    expect(strongScoring.confidence).toBe(1);
    const weakTop = Math.max(...[...weakScoring.scores.values()].map((s) => s.score));
    const strongTop = Math.max(...[...strongScoring.scores.values()].map((s) => s.score));
    expect(weakTop).toBeLessThan(strongTop);
    for (const s of [...weakScoring.scores.values(), ...strongScoring.scores.values()]) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.score)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const target = [...rows, ev("target", "implement-a-ray-tracer", "SAVE"), ev("target", "webgl-fluid-simulation", "COMPLETE")];
    const run = () => {
      const model = buildCollaborativeModel(target, { excludeUserId: "target" });
      return retrieveCollaborativeCandidates(scoreCollaborativeCandidates(model, collaborativeSeedsForUser(target, "target")), projects);
    };
    expect(run()).toEqual(run());
    expect(run().map((c) => c.projectId)).toEqual(expect.arrayContaining(["live-shader-playground", "procedural-terrain-generator"]));
  });
});

describe("collaborative ≠ popularity", () => {
  it("prefers a behavioural neighbour over a globally popular project with weaker co-occurrence", () => {
    const rows: CollaborativeInteraction[] = [];
    // NEIGHBOUR is liked by exactly the systems users who also like redis; POPULAR by everyone.
    for (let u = 1; u <= 5; u++) {
      rows.push(ev(`sys-${u}`, "build-your-own-redis", "SAVE"));
      rows.push(ev(`sys-${u}`, "implement-a-dns-resolver", "SAVE")); // NEIGHBOUR
    }
    for (let u = 1; u <= 20; u++) rows.push(ev(`any-${u}`, "implement-a-ray-tracer", "BUILD")); // POPULAR
    for (let u = 1; u <= 5; u++) rows.push(ev(`sys-${u}`, "implement-a-ray-tracer", "SAVE"));
    const target = [...rows, ev("target", "build-your-own-redis", "SAVE")];

    // Popularity evidence says POPULAR is far more engaged with overall.
    const counts = new Map<string, number>();
    for (const r of target) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
    const evidence = positiveEvidenceFromCounts([...counts.entries()].map(([projectId, count]) => ({ projectId, type: "SAVE" as const, count })));
    expect(evidence.get("implement-a-ray-tracer")!).toBeGreaterThan(evidence.get("implement-a-dns-resolver")!);

    // …but collaborative retrieval ranks the true neighbour first.
    const model = buildCollaborativeModel(target, { excludeUserId: "target" });
    const scoring = scoreCollaborativeCandidates(model, collaborativeSeedsForUser(target, "target"));
    const candidates = retrieveCollaborativeCandidates(scoring, projects);
    expect(candidates[0]!.projectId).toBe("implement-a-dns-resolver");
    expect(scoring.scores.get("implement-a-dns-resolver")!.score).toBeGreaterThan(scoring.scores.get("implement-a-ray-tracer")!.score);
  });
});

describe("collaborative personalisation", () => {
  it("gives users with different behavioural clusters materially different collaborative candidates", () => {
    const rows = clusterInteractions();
    const a = [...rows, ev("A", "build-your-own-redis", "SAVE"), ev("A", "implement-a-tiny-database", "BUILD")];
    const b = [...rows, ev("B", "implement-a-ray-tracer", "SAVE"), ev("B", "live-shader-playground", "BUILD")];
    const forA = retrieveCollaborativeCandidates(
      scoreCollaborativeCandidates(buildCollaborativeModel(a, { excludeUserId: "A" }), collaborativeSeedsForUser(a, "A")),
      projects,
    ).map((c) => c.projectId);
    const forB = retrieveCollaborativeCandidates(
      scoreCollaborativeCandidates(buildCollaborativeModel(b, { excludeUserId: "B" }), collaborativeSeedsForUser(b, "B")),
      projects,
    ).map((c) => c.projectId);
    expect(forA.length).toBeGreaterThan(0);
    expect(forB.length).toBeGreaterThan(0);
    expect(forA.filter((id) => forB.includes(id))).toHaveLength(0);
    expect(forA.every((id) => SYSTEMS.includes(id))).toBe(true);
    expect(forB.every((id) => GRAPHICS.includes(id))).toBe(true);
  });
});
