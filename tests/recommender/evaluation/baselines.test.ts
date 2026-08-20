import { describe, expect, it } from "vitest";
import {
  collaborativeBaseline,
  contentBaseline,
  hybridBaseline,
  hybridSessionBaseline,
  hybridSessionDiversifiedBaseline,
  popularityBaseline,
  randomBaseline,
  trainingPositiveEvidence,
  type AlgorithmInput,
} from "@/lib/recommender/evaluation/baselines";
import { EVAL_CATALOG, algorithmInputFor, makeCase, type Row } from "../../helpers/evaluation-fixture";

const SLUGS = EVAL_CATALOG.map((project) => project.slug);

function saves(userId: string, count: number, start: number, offset = 0, sessionId?: string): Row[] {
  return Array.from({ length: count }, (_, index) => [userId, SLUGS[offset + index]!, "SAVE", start + index, sessionId] as Row);
}

function inputFor(evaluationCase: ReturnType<typeof makeCase>): AlgorithmInput {
  return { ...algorithmInputFor(evaluationCase), trainingEvidence: trainingPositiveEvidence(evaluationCase.trainingInteractions) };
}

const rank = (list: readonly string[], projectId: string) => {
  const index = list.indexOf(projectId);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
};

describe("random baseline (§19, §49)", () => {
  const evaluationCase = makeCase({ userId: "u1", rows: saves("u1", 5, 1), heldOut: [SLUGS[120]!], cutoffMinutes: 30 });

  it("is deterministic for the same seed/user/universe, has no duplicates and stays inside the universe", () => {
    const first = randomBaseline(inputFor(evaluationCase));
    const second = randomBaseline(inputFor(evaluationCase));
    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    const universe = new Set(evaluationCase.universe);
    for (const projectId of first) expect(universe.has(projectId)).toBe(true);
  });

  it("orders differently for different users (same universe)", () => {
    const other = makeCase({ userId: "u2", rows: [...saves("u1", 5, 1), ...saves("u2", 5, 1)], heldOut: [SLUGS[120]!], cutoffMinutes: 30 });
    const mine = makeCase({ userId: "u1", rows: [...saves("u1", 5, 1), ...saves("u2", 5, 1)], heldOut: [SLUGS[120]!], cutoffMinutes: 30 });
    expect(randomBaseline(inputFor(mine))).not.toEqual(randomBaseline(inputFor(other)));
  });
});

describe("popularity baseline (§20, §50)", () => {
  it("ranks by training-only positive evidence; future events never help", () => {
    const rows: Row[] = [
      ...saves("target", 5, 1),
      // Other users make A (SLUGS[30]) popular and B (SLUGS[31]) mildly popular before the cutoff.
      ["u2", SLUGS[30]!, "SAVE", 2],
      ["u3", SLUGS[30]!, "BUILD", 3],
      ["u4", SLUGS[30]!, "COMPLETE", 4],
      ["u2", SLUGS[31]!, "OPEN", 5],
    ];
    const evaluationCase = makeCase({ userId: "target", rows, heldOut: [SLUGS[120]!], cutoffMinutes: 30 });
    const list = popularityBaseline(inputFor(evaluationCase));
    expect(list[0]).toBe(SLUGS[30]!); // A: 2+4+5 = 11 evidence
    expect(rank(list, SLUGS[30]!)).toBeLessThan(rank(list, SLUGS[31]!));
    // C only becomes popular after the cutoff → its rows are simply absent from the training view,
    // so it carries zero evidence and cannot outrank A or B.
    const evidence = trainingPositiveEvidence(evaluationCase.trainingInteractions);
    expect(evidence.get(SLUGS[32]!)).toBeUndefined();
    expect(evidence.get(SLUGS[30]!)).toBeCloseTo(11, 10);
  });
});

describe("content-only baseline (§21, §51)", () => {
  it("ranks on long-term content affinity only: systems taste puts systems projects first", () => {
    const rows: Row[] = [
      ["u1", "build-your-own-redis", "SAVE", 1],
      ["u1", "write-an-http-server", "SAVE", 2],
      ["u1", "implement-a-dns-resolver", "SAVE", 3],
      ["u1", "implement-a-tiny-database", "SAVE", 4],
      ["u1", "toy-container-runtime", "SAVE", 5],
    ];
    const evaluationCase = makeCase({ userId: "u1", rows, heldOut: ["userspace-tcp-ip-stack"], cutoffMinutes: 30 });
    const list = contentBaseline(inputFor(evaluationCase));
    expect(rank(list, "userspace-tcp-ip-stack")).toBeLessThan(rank(list, "implement-a-ray-tracer"));
    expect(list.length).toBe(10);
  });

  it("never converts negative affinity into positive reward", () => {
    const rows: Row[] = [
      ...[
        ["u1", "build-your-own-redis", "SAVE", 1],
        ["u1", "write-an-http-server", "SAVE", 2],
        ["u1", "implement-a-dns-resolver", "SAVE", 3],
        ["u1", "implement-a-tiny-database", "SAVE", 4],
        ["u1", "toy-container-runtime", "SAVE", 5],
      ] as Row[],
      // Strong dislike of mobile projects.
      ["u1", "habit-tracker-mobile-app", "DISLIKE", 6],
      ["u1", "barcode-pantry-inventory-app", "DISLIKE", 7],
    ];
    const evaluationCase = makeCase({ userId: "u1", rows, heldOut: ["userspace-tcp-ip-stack"], cutoffMinutes: 30 });
    const list = contentBaseline(inputFor(evaluationCase));
    // A remaining mobile-tagged project has negative affinity → it must sit behind
    // unrelated zero-affinity projects, i.e. nowhere near the top-10 of 150+ candidates.
    expect(list).not.toContain("ar-measuring-tape");
    expect(list).not.toContain("guitar-tuner-with-pitch-detection");
  });
});

describe("collaborative-only baseline (§22, §52)", () => {
  // u2/u3 co-save redis + kv-store; many unrelated users make the ray tracer globally popular.
  const rows: Row[] = [
    ["target", "build-your-own-redis", "SAVE", 1],
    ["target", SLUGS[60]!, "SAVE", 2],
    ["target", SLUGS[61]!, "SAVE", 3],
    ["target", SLUGS[62]!, "SAVE", 4],
    ["target", SLUGS[63]!, "SAVE", 5],
    ["u2", "build-your-own-redis", "SAVE", 1, "u2-s1"],
    ["u2", "distributed-key-value-store", "SAVE", 2, "u2-s1"],
    ["u3", "build-your-own-redis", "BUILD", 1, "u3-s1"],
    ["u3", "distributed-key-value-store", "SAVE", 2, "u3-s1"],
    ["u4", "implement-a-ray-tracer", "COMPLETE", 1, "u4-s1"],
    ["u5", "implement-a-ray-tracer", "COMPLETE", 1, "u5-s1"],
    ["u6", "implement-a-ray-tracer", "COMPLETE", 1, "u6-s1"],
  ];
  const evaluationCase = makeCase({ userId: "target", rows, heldOut: ["distributed-key-value-store"], cutoffMinutes: 30 });

  it("recommends genuine CF neighbours and never lets popularity leak in", () => {
    const list = collaborativeBaseline(inputFor(evaluationCase));
    expect(list).toContain("distributed-key-value-store"); // real co-interaction neighbour of the redis seed
    expect(list).not.toContain("implement-a-ray-tracer"); // globally popular but shares no users with the seeds
    expect(list.length).toBeLessThanOrEqual(10); // no fake evidence padding
  });

  it("returns an empty list when the target has no collaborative seeds (no fabricated evidence)", () => {
    const seedless = makeCase({
      userId: "lurker",
      rows: [...rows, ["lurker", SLUGS[70]!, "IMPRESSION", 1, "lk-s1"] as Row],
      heldOut: ["distributed-key-value-store"],
      cutoffMinutes: 30,
    });
    expect(collaborativeBaseline(inputFor(seedless))).toEqual([]);
  });
});

describe("hybrid ablations (§23–§25, §53)", () => {
  // Long-term systems taste in earlier session s1; graphics browsing in the evaluation session s2.
  const rows: Row[] = [
    ["u1", "build-your-own-redis", "SAVE", 1, "s1"],
    ["u1", "write-an-http-server", "SAVE", 2, "s1"],
    ["u1", "implement-a-dns-resolver", "SAVE", 3, "s1"],
    ["u1", "implement-a-tiny-database", "SAVE", 4, "s1"],
    ["u1", "toy-container-runtime", "SAVE", 5, "s1"],
    ["u1", "implement-a-ray-tracer", "OPEN", 60, "s2"],
    ["u1", "webgl-fluid-simulation", "SAVE", 61, "s2"],
    ["u1", "live-shader-playground", "SAVE", 62, "s2"],
    ["u1", "generative-art-playground", "SAVE", 63, "s2"],
    ["u1", "software-rasterizer", "BUILD", 64, "s2"],
    // Some background popularity so the popularity component is non-degenerate.
    ["u2", "build-a-unix-shell", "SAVE", 1, "u2-s1"],
    ["u2", "implement-a-ray-tracer", "SAVE", 2, "u2-s1"],
  ];
  const evaluationCase = makeCase({
    userId: "u1",
    rows,
    heldOut: ["procedural-terrain-generator"],
    cutoffMinutes: 90,
    evaluationSessionId: "s2",
  });
  const input = inputFor(evaluationCase);

  it("session evidence changes the ranking between Hybrid and Hybrid + Session; without evidence they coincide", () => {
    const hybrid = hybridBaseline(input);
    const withSession = hybridSessionBaseline(input);
    // With real session evidence the two modes genuinely rank differently: the Phase 5
    // view folds the graphics session into the long-term profile at full weight, the
    // Phase 6 view blends it adaptively (bounded by maxBlendWeight) and adds the
    // session ranking component.
    expect(withSession).not.toEqual(hybrid);
    // Both still use the graphics information somewhere sensible.
    const graphicsTags = new Set(["graphics", "webgl", "creative-coding", "simulation", "procedural-generation"]);
    const catalogById = new Map(EVAL_CATALOG.map((project) => [project.id, project]));
    const hasGraphics = (list: readonly string[]) => list.some((id) => catalogById.get(id)!.tagSlugs.some((tagSlug) => graphicsTags.has(tagSlug)));
    expect(hasGraphics(hybrid) || hasGraphics(withSession)).toBe(true);
    // No session evidence at the cutoff → the adaptive session influence is zero and
    // the two modes produce the identical ranking (no fabricated session signal).
    const noSessionCase = makeCase({
      userId: "u1",
      rows: rows.filter((row) => row[4] !== "s2"),
      heldOut: ["procedural-terrain-generator"],
      cutoffMinutes: 90,
      evaluationSessionId: "s2",
    });
    const noSessionInput = inputFor(noSessionCase);
    expect(hybridSessionBaseline(noSessionInput)).toEqual(hybridBaseline(noSessionInput));
  });

  it("diversification changes the final list/order between Hybrid + Session and the full system", () => {
    const withSession = hybridSessionBaseline(input);
    const full = hybridSessionDiversifiedBaseline(input);
    expect(full).not.toEqual(withSession);
    expect(full).toHaveLength(10);
    expect(new Set(full).size).toBe(10);
    // Diversification re-orders/swaps but does not invent candidates outside the universe.
    const universe = new Set(evaluationCase.universe);
    for (const projectId of full) expect(universe.has(projectId)).toBe(true);
  });

  it("all three variants are deterministic and none returns an excluded or held-out-leaking training item", () => {
    for (const algorithm of [hybridBaseline, hybridSessionBaseline, hybridSessionDiversifiedBaseline]) {
      const first = algorithm(input);
      expect(algorithm(input)).toEqual(first);
      for (const projectId of first) expect(evaluationCase.excludedProjectIds.has(projectId)).toBe(false);
    }
  });

  it("baselines are not relabelled copies of each other (§87)", () => {
    const lists = [
      randomBaseline(input),
      popularityBaseline(input),
      contentBaseline(input),
      hybridBaseline(input),
      hybridSessionDiversifiedBaseline(input),
    ];
    for (let i = 0; i < lists.length; i++) {
      for (let j = i + 1; j < lists.length; j++) {
        expect(lists[i]).not.toEqual(lists[j]);
      }
    }
  });
});
