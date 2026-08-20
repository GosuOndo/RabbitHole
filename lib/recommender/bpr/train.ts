/**
 * BPR training (Phase 10): pairwise SGD over deterministic seeded samples.
 *
 *   x_uij = p_u · q_i − p_u · q_j
 *   loss  = −log σ(x_uij) + λ(‖p_u‖² + ‖q_i‖² + ‖q_j‖²)
 *
 * Per sampled triple (numerically stable, snapshot semantics — item updates
 * use the user's PRE-update factors):
 *
 *   g   = σ(−x_uij)
 *   p_u ← p_u + η · ( g · (q_i − q_j) − λ · p_u )
 *   q_i ← q_i + η · (  g · p_u_old    − λ · q_i )
 *   q_j ← q_j + η · ( −g · p_u_old    − λ · q_j )
 *
 * Sampling is fully deterministic (SeededRandom over sorted users/positives):
 * one negative per positive per epoch; with probability
 * `explicitNegativeProbability` an explicit DISLIKE is drawn when the user has
 * any, otherwise a never-touched project; pools fall back to each other when
 * one is empty and the pair is skipped when both are.
 */

import { SeededRandom } from "@/lib/utils/prng";
import { RECOMMENDER_CONFIG } from "../config";
import type { BprConfig, BprDataset, BprEpochDiagnostics, BprModel } from "./types";

export class BprTrainingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BprTrainingError";
  }
}

/** Numerically stable logistic sigmoid (no overflow for |x| in the thousands). */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** Stable −log σ(x) = softplus(−x); finite for extreme x. */
export function pairLoss(x: number): number {
  return x > 0 ? Math.log1p(Math.exp(-x)) : -x + Math.log1p(Math.exp(x));
}

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let f = 0; f < a.length; f++) sum += a[f]! * b[f]!;
  return sum;
}

/** Seeded uniform initialisation in [-scale, +scale) — never all-zero (symmetry would block learning). */
export function initFactors(count: number, factors: number, rng: SeededRandom, scale: number): number[][] {
  return Array.from({ length: count }, () => Array.from({ length: factors }, () => rng.float(-scale, scale)));
}

/**
 * Draws the negative index j for one (u, i) pair, or null when the user has no
 * usable negative pool at all. Consumes rng deterministically.
 */
export function sampleNegative(
  rng: SeededRandom,
  explicitNegatives: readonly number[],
  unobserved: readonly number[],
  explicitProbability: number,
): number | null {
  const useExplicit = explicitNegatives.length > 0 && (unobserved.length === 0 || rng.chance(explicitProbability));
  const pool = useExplicit ? explicitNegatives : unobserved.length > 0 ? unobserved : explicitNegatives;
  if (pool.length === 0) return null;
  return pool[rng.int(0, pool.length - 1)]!;
}

export interface TrainBprInput {
  dataset: BprDataset;
  /** Deterministic seed key, e.g. "bpr:20260820:full" or "bpr:20260820:<user>:<cutoff>". */
  seedKey: string;
  config?: BprConfig;
}

export function trainBpr({ dataset, seedKey, config = RECOMMENDER_CONFIG.bpr }: TrainBprInput): BprModel {
  const { factors, epochs, learningRate: lr, regularization: reg, samplesPerPositive, explicitNegativeProbability, initScale } = config;
  if (dataset.userIds.length === 0 || dataset.positiveCount === 0) {
    throw new BprTrainingError("BPR training requires at least one user with a strong-positive project");
  }
  const rng = new SeededRandom(seedKey);
  const userFactors = initFactors(dataset.userIds.length, factors, rng, initScale);
  const itemFactors = initFactors(dataset.projectIds.length, factors, rng, initScale);
  const userSnapshot = new Array<number>(factors);
  const diagnostics: BprEpochDiagnostics[] = [];

  for (let epoch = 1; epoch <= epochs; epoch++) {
    let pairs = 0;
    let lossSum = 0;
    let correct = 0;
    for (let u = 0; u < dataset.userIds.length; u++) {
      const positives = dataset.positives[u]!;
      const explicit = dataset.explicitNegatives[u]!;
      const unobserved = dataset.unobserved[u]!;
      const pu = userFactors[u]!;
      for (const i of positives) {
        for (let s = 0; s < samplesPerPositive; s++) {
          const j = sampleNegative(rng, explicit, unobserved, explicitNegativeProbability);
          if (j === null || j === i) continue;
          const qi = itemFactors[i]!;
          const qj = itemFactors[j]!;
          const x = dot(pu, qi) - dot(pu, qj);
          lossSum += pairLoss(x);
          if (x > 0) correct += 1;
          pairs += 1;
          const g = sigmoid(-x);
          for (let f = 0; f < factors; f++) userSnapshot[f] = pu[f]!;
          for (let f = 0; f < factors; f++) {
            const puOld = userSnapshot[f]!;
            pu[f] = pu[f]! + lr * (g * (qi[f]! - qj[f]!) - reg * pu[f]!);
            qi[f] = qi[f]! + lr * (g * puOld - reg * qi[f]!);
            qj[f] = qj[f]! + lr * (-g * puOld - reg * qj[f]!);
          }
        }
      }
    }
    diagnostics.push({ epoch, pairs, meanLoss: pairs > 0 ? lossSum / pairs : 0, pairwiseAccuracy: pairs > 0 ? correct / pairs : 0 });
  }

  // Numerical-safety assertions: finite factors, sane norms, finite diagnostics.
  let maxNormSquared = 0;
  for (const matrix of [userFactors, itemFactors]) {
    for (const vector of matrix) {
      let normSquared = 0;
      for (const value of vector) {
        if (!Number.isFinite(value)) throw new BprTrainingError("BPR training diverged: non-finite factor");
        normSquared += value * value;
      }
      maxNormSquared = Math.max(maxNormSquared, normSquared);
    }
  }
  if (maxNormSquared > 1e6) throw new BprTrainingError(`BPR training diverged: factor norm exploded (${Math.sqrt(maxNormSquared).toFixed(1)})`);
  for (const entry of diagnostics) {
    if (!Number.isFinite(entry.meanLoss) || !Number.isFinite(entry.pairwiseAccuracy)) {
      throw new BprTrainingError("BPR training diverged: non-finite diagnostics");
    }
  }

  return {
    version: config.artifactVersion,
    factors,
    userIds: dataset.userIds,
    projectIds: dataset.projectIds,
    userFactors,
    itemFactors,
    training: { seedKey, epochs, learningRate: lr, regularization: reg, samplesPerPositive, explicitNegativeProbability, initScale },
    dataFingerprint: dataset.fingerprint,
    diagnostics,
  };
}
