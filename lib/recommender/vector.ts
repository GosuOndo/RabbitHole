/**
 * Small sparse-vector helpers shared by profiles and (later) similarity code.
 * Vectors are plain `Record<featureId, number>` maps; missing keys are zero.
 * All functions are pure and never produce NaN/Infinity for finite inputs.
 */

import type { FeatureVector } from "./types";

/** target += scale * source (in place). Non-finite contributions are ignored. */
export function addScaledInto(target: Record<string, number>, source: FeatureVector, scale: number): void {
  if (!Number.isFinite(scale) || scale === 0) return;
  for (const [key, value] of Object.entries(source)) {
    const contribution = value * scale;
    if (!Number.isFinite(contribution) || contribution === 0) continue;
    target[key] = (target[key] ?? 0) + contribution;
  }
}

export function scaleVector(vector: FeatureVector, scale: number): FeatureVector {
  const out: Record<string, number> = {};
  addScaledInto(out, vector, scale);
  return out;
}

export function l2Norm(vector: FeatureVector): number {
  let sum = 0;
  for (const value of Object.values(vector)) sum += value * value;
  return Math.sqrt(sum);
}

export function maxAbs(vector: FeatureVector): number {
  let max = 0;
  for (const value of Object.values(vector)) max = Math.max(max, Math.abs(value));
  return max;
}

export function dot(a: FeatureVector, b: FeatureVector): number {
  // Iterate the smaller map for speed.
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let sum = 0;
  for (const [key, value] of Object.entries(small)) {
    const other = large[key];
    if (other !== undefined) sum += value * other;
  }
  return sum;
}

/** Returns a copy with keys sorted (deterministic serialisation) and near-zero entries dropped. */
export function tidyVector(vector: FeatureVector, epsilon = 1e-12): FeatureVector {
  const out: Record<string, number> = {};
  for (const key of Object.keys(vector).sort()) {
    const value = vector[key] ?? 0;
    if (Number.isFinite(value) && Math.abs(value) > epsilon) out[key] = value;
  }
  return out;
}
