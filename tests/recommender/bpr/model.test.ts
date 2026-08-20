import { describe, expect, it } from "vitest";
import { SeededRandom } from "@/lib/utils/prng";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildBprDataset } from "@/lib/recommender/bpr/data";
import { initFactors, pairLoss, sampleNegative, sigmoid, trainBpr, BprTrainingError } from "@/lib/recommender/bpr/train";
import { indexBprModel, normalizeBprScores, rankBprCandidates, scoreBpr } from "@/lib/recommender/bpr/score";
import { bprModelChecksum, parseBprArtifact, serializeBprModel, BprArtifactError } from "@/lib/recommender/bpr/serialize";
import type { BprInteraction } from "@/lib/recommender/bpr/types";

const CONFIG = RECOMMENDER_CONFIG.bpr;
const T0 = new Date("2026-06-01T00:00:00.000Z");
const ev = (userId: string, projectId: string, type: BprInteraction["type"], minutes: number): BprInteraction => ({
  userId,
  projectId,
  type,
  createdAt: new Date(T0.getTime() + minutes * 60_000),
});

const CATALOG = ["A", "B", "C", "D", "E", "F"];
const tiny = () => buildBprDataset([ev("u", "A", "SAVE", 1), ev("u", "B", "DISLIKE", 2)], CATALOG);
const trainTiny = (seedKey = "bpr:test:tiny") => trainBpr({ dataset: tiny(), seedKey });

describe("numerical primitives", () => {
  it("sigmoid and pairwise loss stay finite and correct for extreme inputs", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 12);
    expect(sigmoid(5000)).toBeCloseTo(1, 12);
    expect(sigmoid(-5000)).toBeCloseTo(0, 12);
    expect(Number.isFinite(pairLoss(5000))).toBe(true);
    expect(Number.isFinite(pairLoss(-5000))).toBe(true);
    expect(pairLoss(0)).toBeCloseTo(Math.log(2), 12);
    expect(pairLoss(5000)).toBeCloseTo(0, 12);
    expect(pairLoss(-5000)).toBeCloseTo(5000, 6);
    // loss = −log σ(x) identity on moderate values.
    expect(pairLoss(1.3)).toBeCloseTo(-Math.log(sigmoid(1.3)), 12);
  });

  it("seeded initialisation is small, non-zero and reproducible", () => {
    const a = initFactors(3, 4, new SeededRandom("init"), 0.05);
    const b = initFactors(3, 4, new SeededRandom("init"), 0.05);
    expect(a).toEqual(b);
    expect(a.flat().some((value) => value !== 0)).toBe(true);
    for (const value of a.flat()) {
      expect(value).toBeGreaterThanOrEqual(-0.05);
      expect(value).toBeLessThan(0.05);
    }
    expect(initFactors(3, 4, new SeededRandom("other"), 0.05)).not.toEqual(a);
  });

  it("negative sampling is deterministic, mixes explicit and unobserved pools, and falls back correctly", () => {
    const run = (seed: string) => {
      const rng = new SeededRandom(seed);
      return Array.from({ length: 40 }, () => sampleNegative(rng, [10, 11], [20, 21, 22], 0.5));
    };
    expect(run("s1")).toEqual(run("s1"));
    expect(run("s1")).not.toEqual(run("s2"));
    const samples = run("s1") as number[];
    expect(samples.some((j) => j === 10 || j === 11)).toBe(true); // explicit negatives drawn
    expect(samples.some((j) => j >= 20)).toBe(true); // unobserved drawn
    // Fallbacks: only-explicit, only-unobserved, neither.
    const rng = new SeededRandom("f");
    expect([10, 11]).toContain(sampleNegative(rng, [10, 11], [], 0.5));
    expect([20]).toContain(sampleNegative(rng, [], [20], 0.5));
    expect(sampleNegative(rng, [], [], 0.5)).toBeNull();
  });
});

describe("training (tiny fixtures)", () => {
  it("learns to rank a liked project above a disliked one, with decreasing loss and improving accuracy (§24/§26)", () => {
    const model = trainTiny();
    const indexed = indexBprModel(model);
    const scoreA = scoreBpr(indexed, "u", "A")!;
    const scoreB = scoreBpr(indexed, "u", "B")!;
    expect(scoreA).toBeGreaterThan(scoreB);
    const first = model.diagnostics[0]!;
    const last = model.diagnostics[model.diagnostics.length - 1]!;
    expect(last.meanLoss).toBeLessThan(first.meanLoss);
    expect(last.pairwiseAccuracy).toBeGreaterThanOrEqual(first.pairwiseAccuracy);
    expect(last.pairwiseAccuracy).toBe(1); // trivially separable fixture
  });

  it("separates multi-user preferences (§25)", () => {
    const dataset = buildBprDataset(
      [
        ev("u1", "A", "SAVE", 1),
        ev("u1", "B", "SAVE", 2),
        ev("u2", "C", "SAVE", 3),
        ev("u2", "D", "SAVE", 4),
      ],
      CATALOG,
    );
    const indexed = indexBprModel(trainBpr({ dataset, seedKey: "bpr:test:multi" }));
    // Each user's own positives outrank the other user's positives for them.
    expect(rankBprCandidates(indexed, "u1", CATALOG, 2).sort()).toEqual(["A", "B"]);
    expect(rankBprCandidates(indexed, "u2", CATALOG, 2).sort()).toEqual(["C", "D"]);
  });

  it("SGD updates move the pair margin in the correct direction from the very first epoch (§7)", () => {
    const dataset = tiny();
    const seedKey = "bpr:test:one";
    const config = { ...CONFIG, epochs: 1, samplesPerPositive: 4 };
    // Reproduce the trainer's exact seeded initialisation (users first, then items).
    const rng = new SeededRandom(seedKey);
    const initUsers = initFactors(dataset.userIds.length, config.factors, rng, config.initScale);
    const initItems = initFactors(dataset.projectIds.length, config.factors, rng, config.initScale);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, f) => sum + value * b[f]!, 0);
    const iA = dataset.projectIds.indexOf("A");
    const iB = dataset.projectIds.indexOf("B");
    const initialMargin = dot(initUsers[0]!, initItems[iA]!) - dot(initUsers[0]!, initItems[iB]!);

    const single = trainBpr({ dataset, seedKey, config });
    const indexed = indexBprModel(single);
    const trainedMargin = scoreBpr(indexed, "u", "A")! - scoreBpr(indexed, "u", "B")!;
    // One epoch cannot guarantee dominance from random init, but the margin
    // between the positive and the explicit negative must move upward.
    expect(trainedMargin).toBeGreaterThan(initialMargin);
    expect(single.diagnostics[0]!.pairs).toBe(4);
  });

  it("is exactly deterministic for identical data, seed and hyperparameters (§31)", () => {
    const a = trainTiny();
    const b = trainTiny();
    expect(a.userFactors).toEqual(b.userFactors);
    expect(a.itemFactors).toEqual(b.itemFactors);
    expect(a.diagnostics).toEqual(b.diagnostics);
    expect(bprModelChecksum(a)).toBe(bprModelChecksum(b));
    const different = trainBpr({ dataset: tiny(), seedKey: "bpr:test:other-seed" });
    expect(bprModelChecksum(different)).not.toBe(bprModelChecksum(a));
  });

  it("keeps every factor and diagnostic finite and refuses to train without positives (§23)", () => {
    const model = trainTiny();
    for (const value of [...model.userFactors.flat(), ...model.itemFactors.flat()]) expect(Number.isFinite(value)).toBe(true);
    expect(() => trainBpr({ dataset: buildBprDataset([ev("u", "A", "IMPRESSION", 1)], CATALOG), seedKey: "x" })).toThrow(BprTrainingError);
  });
});

describe("scoring and ranking", () => {
  const indexed = indexBprModel(trainTiny());

  it("returns null for unknown users and unknown projects — no fabricated zero (§32/§34/§35)", () => {
    expect(scoreBpr(indexed, "stranger", "A")).toBeNull();
    expect(scoreBpr(indexed, "u", "not-in-catalog")).toBeNull();
    expect(scoreBpr(indexed, "u", "A")).not.toBeNull();
    expect(rankBprCandidates(indexed, "stranger", CATALOG, 10)).toEqual([]);
  });

  it("ranks deterministically without duplicates, skipping unknown candidates and respecting the limit (§33)", () => {
    const ranked = rankBprCandidates(indexed, "u", ["A", "B", "C", "C", "not-real", "D"], 3);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked).size).toBe(3);
    expect(ranked).not.toContain("not-real");
    expect(ranked[0]).toBe("A"); // the learned positive leads
    expect(rankBprCandidates(indexed, "u", ["A", "B", "C", "C", "not-real", "D"], 3)).toEqual(ranked);
  });

  it("min–max normalisation is transparent and refuses degenerate ranges (§51)", () => {
    const normalized = normalizeBprScores(new Map([["A", 2], ["B", -1], ["C", 0.5]]))!;
    expect(normalized.get("A")).toBeCloseTo(1, 12);
    expect(normalized.get("B")).toBeCloseTo(0, 12);
    expect(normalized.get("C")).toBeCloseTo(0.5, 12);
    expect(normalizeBprScores(new Map([["A", 3]]))).toBeNull();
    expect(normalizeBprScores(new Map([["A", 3], ["B", 3]]))).toBeNull();
    expect(normalizeBprScores(new Map([["A", Number.NaN], ["B", 1]]))).toBeNull();
  });
});

describe("serialisation (§36/§40/§69)", () => {
  const model = trainTiny();

  it("round-trips through the artifact with identical predictions and checksum", () => {
    const artifact = serializeBprModel(model, new Date("2026-08-20T12:00:00.000Z"));
    const loaded = parseBprArtifact(JSON.parse(JSON.stringify(artifact)), CONFIG.artifactVersion);
    const a = indexBprModel(model);
    const b = indexBprModel(loaded);
    for (const projectId of CATALOG) expect(scoreBpr(b, "u", projectId)).toBe(scoreBpr(a, "u", projectId));
    expect(bprModelChecksum(loaded)).toBe(artifact.checksum);
    // The timestamp is informational: it never changes the checksum.
    expect(serializeBprModel(model, new Date("2027-01-01T00:00:00.000Z")).checksum).toBe(artifact.checksum);
  });

  it("rejects malformed artifacts (§40)", () => {
    const artifact = JSON.parse(JSON.stringify(serializeBprModel(model, new Date("2026-08-20T12:00:00.000Z"))));
    expect(() => parseBprArtifact(null, CONFIG.artifactVersion)).toThrow(BprArtifactError);
    expect(() => parseBprArtifact({ ...artifact, version: 99 }, CONFIG.artifactVersion)).toThrow(/version/);
    expect(() => parseBprArtifact({ ...artifact, factors: 0 }, CONFIG.artifactVersion)).toThrow(BprArtifactError);
    expect(() => parseBprArtifact({ ...artifact, userFactors: [[1, 2]] }, CONFIG.artifactVersion)).toThrow(/user factors/);
    const poisoned = JSON.parse(JSON.stringify(artifact));
    poisoned.itemFactors[0][0] = "NaN";
    expect(() => parseBprArtifact(poisoned, CONFIG.artifactVersion)).toThrow(/item factors/);
    expect(() => parseBprArtifact({ ...artifact, checksum: "deadbeef" }, CONFIG.artifactVersion)).toThrow(/checksum/);
  });
});
