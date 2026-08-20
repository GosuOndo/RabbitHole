import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { EvaluationError, runEvaluation } from "@/lib/recommender/evaluation/runner";
import { EVALUATION_ALGORITHMS } from "@/lib/recommender/evaluation/types";
import { EVAL_CATALOG, datasetFrom, user, type Row } from "../../helpers/evaluation-fixture";

const SLUGS = EVAL_CATALOG.map((project) => project.slug);

function saves(userId: string, count: number, start: number, offset = 0, sessionId?: string): Row[] {
  return Array.from({ length: count }, (_, index) => [userId, SLUGS[offset + index]!, "SAVE", start + index, sessionId] as Row);
}

/** Two eligible users with distinct tastes + co-interaction structure, one skipped user. */
function fixtureDataset() {
  const rows: Row[] = [
    // u1: systems taste, 6 positives (holdout 1).
    ["u1", "build-your-own-redis", "SAVE", 1],
    ["u1", "write-an-http-server", "SAVE", 2],
    ["u1", "implement-a-dns-resolver", "SAVE", 3],
    ["u1", "implement-a-tiny-database", "SAVE", 4],
    ["u1", "toy-container-runtime", "SAVE", 5],
    ["u1", "userspace-tcp-ip-stack", "SAVE", 6],
    // u2: graphics taste, 5 positives.
    ["u2", "implement-a-ray-tracer", "SAVE", 1, "u2-s1"],
    ["u2", "webgl-fluid-simulation", "SAVE", 2, "u2-s1"],
    ["u2", "live-shader-playground", "SAVE", 3, "u2-s1"],
    ["u2", "generative-art-playground", "SAVE", 4, "u2-s1"],
    ["u2", "procedural-terrain-generator", "SAVE", 5, "u2-s1"],
    // shared co-interactions so CF has something to chew on.
    ["u3", "build-your-own-redis", "SAVE", 1, "u3-s1"],
    ["u3", "userspace-tcp-ip-stack", "SAVE", 2, "u3-s1"],
    ["u3", "distributed-key-value-store", "SAVE", 3, "u3-s1"],
    // u4: too little history → skipped.
    ["u4", SLUGS[100]!, "SAVE", 1, "u4-s1"],
  ];
  return datasetFrom([user("u1"), user("u2"), user("u3"), user("u4")], rows);
}

describe("runEvaluation", () => {
  const report = runEvaluation(fixtureDataset());

  it("evaluates every algorithm over the same split with sane dataset accounting", () => {
    expect(report.dataset.usersConsidered).toBe(4);
    expect(report.dataset.usersEvaluated).toBe(2); // u3 (2 training positives after holdout… actually eligible? 3 positives < 5) is skipped too
    expect(report.dataset.usersSkipped).toBe(2);
    expect(report.dataset.skipReasons["insufficient strong-positive projects"]).toBe(2);
    expect(report.dataset.avgHeldOut).toBeGreaterThanOrEqual(1);
    expect(report.algorithms.map((row) => row.algorithm)).toEqual([...EVALUATION_ALGORITHMS]);
    expect(report.cases.map((entry) => entry.userId)).toEqual(["u1", "u2"]);
    for (const algorithm of EVALUATION_ALGORITHMS) {
      expect(report.details[algorithm].map((entry) => entry.userId)).toEqual(["u1", "u2"]);
    }
    expect(/^[0-9a-f]{8}$/.test(report.fingerprint)).toBe(true);
    expect(report.seed).toBe(RECOMMENDER_CONFIG.evaluation.seed);
  });

  it("keeps every metric finite and in [0, 1]", () => {
    for (const row of report.algorithms) {
      for (const value of [row.precisionAt5, row.precisionAt10, row.recallAt5, row.recallAt10, row.ndcgAt10, row.hitRateAt10, row.coverage, row.diversity, row.novelty]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces lists that respect the §54 invariants (checked via the details it returns)", () => {
    for (const algorithm of EVALUATION_ALGORITHMS) {
      for (const detail of report.details[algorithm]) {
        expect(detail.recommended.length).toBeLessThanOrEqual(RECOMMENDER_CONFIG.evaluation.primaryK);
        expect(new Set(detail.recommended).size).toBe(detail.recommended.length);
        const evaluationCase = report.cases.find((entry) => entry.userId === detail.userId)!;
        for (const hit of detail.hits) expect(evaluationCase.heldOut).toContain(hit);
      }
    }
  });

  it("is deterministic end to end (§77)", () => {
    const again = runEvaluation(fixtureDataset());
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
    expect(again.fingerprint).toBe(report.fingerprint);
  });

  it("content and hybrid actually recover an on-taste held-out project in this fixture (non-degenerate)", () => {
    const content = report.algorithms.find((row) => row.algorithm === "content")!;
    expect(content.hitRateAt10).toBeGreaterThan(0);
    const full = report.algorithms.find((row) => row.algorithm === "hybrid-session-diversified")!;
    expect(full.hitRateAt10).toBeGreaterThan(0);
  });

  it("fails clearly on degenerate inputs instead of printing fake tables (§83)", () => {
    expect(() => runEvaluation({ catalog: [], interactions: [], users: [user("u1")] })).toThrow(EvaluationError);
    expect(() => runEvaluation({ catalog: EVAL_CATALOG, interactions: [], users: [] })).toThrow(EvaluationError);
    expect(() => runEvaluation(datasetFrom([user("u9")], saves("u9", 2, 1)))).toThrow(/No users qualify/);
  });
});
