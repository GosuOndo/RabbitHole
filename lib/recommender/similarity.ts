/**
 * Cosine similarity for sparse feature vectors.
 *
 *   cosine(a, b) = (a · b) / (‖a‖ ‖b‖)
 *
 * Signed vectors are supported: a user profile with negative (disliked)
 * features yields a negative similarity to projects carrying those features,
 * which is exactly the information the ranker wants. If either vector is empty
 * or has zero norm the similarity is defined as 0 (no evidence), so the result
 * is always a finite number in [-1, 1].
 */

import type { FeatureVector } from "./types";
import { dot, l2Norm } from "./vector";

export function cosineSimilarity(a: FeatureVector, b: FeatureVector): number {
  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0) return 0;
  const value = dot(a, b) / (normA * normB);
  if (!Number.isFinite(value)) return 0;
  // Guard against floating-point drift just outside the mathematical range.
  return Math.max(-1, Math.min(1, value));
}

/**
 * Cosine similarity when `unit` is already L2-normalised (e.g. a profile
 * vector); avoids recomputing its norm across a whole catalog.
 */
export function cosineWithUnitVector(unit: FeatureVector, other: FeatureVector): number {
  const normOther = l2Norm(other);
  if (normOther === 0) return 0;
  const value = dot(unit, other) / normOther;
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}
