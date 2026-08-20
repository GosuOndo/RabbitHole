import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildBprDataset } from "@/lib/recommender/bpr/data";
import { bprModelChecksum } from "@/lib/recommender/bpr/serialize";
import {
  bprBaseline,
  buildCaseBprModel,
  collaborativeBaseline,
  hybridBprBaseline,
  hybridSessionDiversifiedBaseline,
  trainingPositiveEvidence,
  type AlgorithmInput,
} from "@/lib/recommender/evaluation/baselines";
import { buildEvaluationSplit } from "@/lib/recommender/evaluation/split";
import { runEvaluation } from "@/lib/recommender/evaluation/runner";
import { EVALUATION_ALGORITHMS } from "@/lib/recommender/evaluation/types";
import { EVAL_CATALOG, algorithmInputFor, datasetFrom, makeCase, user, type Row } from "../../helpers/evaluation-fixture";

const SLUGS = EVAL_CATALOG.map((project) => project.slug);

function saves(userId: string, count: number, start: number, offset = 0, sessionId?: string): Row[] {
  return Array.from({ length: count }, (_, index) => [userId, SLUGS[offset + index]!, "SAVE", start + index, sessionId] as Row);
}

function inputFor(evaluationCase: ReturnType<typeof makeCase>): AlgorithmInput {
  return { ...algorithmInputFor(evaluationCase), trainingEvidence: trainingPositiveEvidence(evaluationCase.trainingInteractions) };
}

describe("leakage-safe per-cutoff BPR training (§45, §47)", () => {
  const rows: Row[] = [...saves("u1", 6, 1), ...saves("u2", 6, 1, 20)];
  const split = buildEvaluationSplit(datasetFrom([user("u1"), user("u2")], rows), RECOMMENDER_CONFIG.evaluation);
  const evaluationCase = split.cases.find((entry) => entry.userId === "u1")!;

  it("held-out positives never enter the BPR positive set but remain ordinary unobserved sampling candidates", () => {
    const dataset = buildBprDataset(evaluationCase.trainingInteractions, EVAL_CATALOG.map((project) => project.id));
    const targetRow = dataset.userIds.indexOf("u1");
    expect(targetRow).toBeGreaterThanOrEqual(0);
    for (const heldOut of evaluationCase.heldOut) {
      const heldOutIndex = dataset.projectIds.indexOf(heldOut);
      expect(dataset.positives[targetRow]).not.toContain(heldOutIndex);
      expect(dataset.explicitNegatives[targetRow]).not.toContain(heldOutIndex);
      // No test-label protection: the unseen held-out item sits in the unobserved pool (§47).
      expect(dataset.unobserved[targetRow]).toContain(heldOutIndex);
    }
    // Training data is strictly pre-cutoff, so no post-cutoff project of any user is present.
    expect(evaluationCase.trainingInteractions.every((interaction) => interaction.createdAt.getTime() < evaluationCase.cutoff.getTime())).toBe(true);
  });

  it("the same case yields the same model (deterministic case seed); different cases differ", () => {
    const a = buildCaseBprModel(evaluationCase, EVAL_CATALOG)!;
    const b = buildCaseBprModel(evaluationCase, EVAL_CATALOG)!;
    expect(bprModelChecksum(a.model)).toBe(bprModelChecksum(b.model));
    expect(a.model.training.seedKey).toContain("u1");
    expect(a.model.training.seedKey).toContain(evaluationCase.cutoff.toISOString());
    const other = split.cases.find((entry) => entry.userId === "u2")!;
    expect(bprModelChecksum(buildCaseBprModel(other, EVAL_CATALOG)!.model)).not.toBe(bprModelChecksum(a.model));
  });
});

describe("BPR baseline semantics (§48, §59)", () => {
  // The Phase 4 CF fixture: co-saves give kv-store CF evidence; the ray tracer is popular but unrelated.
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
  ];
  const evaluationCase = makeCase({ userId: "target", rows, heldOut: ["distributed-key-value-store"], cutoffMinutes: 30 });
  const input = inputFor(evaluationCase);

  it("is a genuinely different algorithm from item-item CF (not a relabelled scorer)", () => {
    const bpr = bprBaseline(input);
    const cf = collaborativeBaseline(input);
    expect(bpr).toHaveLength(10); // BPR scores the whole universe…
    expect(cf.length).toBeLessThan(10); // …while CF only ranks candidates with genuine co-interaction evidence
    expect(bpr).not.toEqual(cf);
    const universe = new Set(evaluationCase.universe);
    for (const projectId of bpr) expect(universe.has(projectId)).toBe(true);
    expect(new Set(bpr).size).toBe(bpr.length);
  });

  it("has no fallback: a target without training positives yields an empty list, never popularity", () => {
    const seedless = makeCase({
      userId: "lurker",
      rows: [...rows, ["lurker", SLUGS[70]!, "IMPRESSION", 1, "lk-s1"] as Row],
      heldOut: ["distributed-key-value-store"],
      cutoffMinutes: 30,
    });
    expect(bprBaseline(inputFor(seedless))).toEqual([]);
  });

  it("is deterministic", () => {
    expect(bprBaseline(input)).toEqual(bprBaseline(input));
  });
});

describe("Hybrid + BPR semantics (§50–§54)", () => {
  const rows: Row[] = [
    ["u1", "build-your-own-redis", "SAVE", 1, "s1"],
    ["u1", "write-an-http-server", "SAVE", 2, "s1"],
    ["u1", "implement-a-dns-resolver", "SAVE", 3, "s1"],
    ["u1", "implement-a-tiny-database", "SAVE", 4, "s1"],
    ["u1", "toy-container-runtime", "SAVE", 5, "s1"],
    ["u1", "implement-a-ray-tracer", "OPEN", 60, "s2"],
    ["u1", "webgl-fluid-simulation", "SAVE", 61, "s2"],
    ["u2", "build-a-unix-shell", "SAVE", 1, "u2-s1"],
    ["u2", "build-your-own-redis", "SAVE", 2, "u2-s1"],
  ];
  const evaluationCase = makeCase({ userId: "u1", rows, heldOut: ["userspace-tcp-ip-stack"], cutoffMinutes: 90, evaluationSessionId: "s2" });
  const input = inputFor(evaluationCase);

  it("blends real BPR scores into the hybrid ranking and re-diversifies with the production MMR", () => {
    expect(input.bprModel).not.toBeNull();
    const withBpr = hybridBprBaseline(input);
    const production = hybridSessionDiversifiedBaseline(input);
    expect(withBpr).toHaveLength(10);
    expect(new Set(withBpr).size).toBe(10);
    const universe = new Set(evaluationCase.universe);
    for (const projectId of withBpr) expect(universe.has(projectId)).toBe(true);
    // The learned signal genuinely changes the outcome for this fixture.
    expect(withBpr).not.toEqual(production);
    // Deterministic.
    expect(hybridBprBaseline(input)).toEqual(withBpr);
  });

  it("preserves the exact production hybrid output when no BPR evidence is usable (§52)", () => {
    const withoutModel: AlgorithmInput = { ...input, bprModel: null };
    expect(hybridBprBaseline(withoutModel)).toEqual(hybridSessionDiversifiedBaseline(input));
  });
});

describe("runner integration (§44, §55, §73)", () => {
  const rows: Row[] = [...saves("u1", 6, 1), ...saves("u2", 5, 1, 30)];
  const dataset = datasetFrom([user("u1"), user("u2")], rows);

  it("adds the two BPR rows over the SAME split with finite metrics, deterministically", () => {
    const report = runEvaluation(dataset);
    expect(report.algorithms.map((row) => row.algorithm)).toEqual([...EVALUATION_ALGORITHMS]);
    expect(report.algorithms).toHaveLength(9);
    const bpr = report.algorithms.find((row) => row.algorithm === "bpr")!;
    const hybridBpr = report.algorithms.find((row) => row.algorithm === "hybrid-bpr")!;
    for (const row of [bpr, hybridBpr]) {
      for (const value of [row.precisionAt10, row.recallAt10, row.ndcgAt10, row.hitRateAt10, row.coverage, row.diversity, row.novelty]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    // The split (and its fingerprint) is untouched by the added algorithms.
    const splitOnly = buildEvaluationSplit(dataset, RECOMMENDER_CONFIG.evaluation);
    expect(report.fingerprint).toBe(splitOnly.fingerprint);
    // Fully deterministic end to end, including per-case BPR training.
    expect(JSON.stringify(runEvaluation(dataset))).toBe(JSON.stringify(report));
  });
});
