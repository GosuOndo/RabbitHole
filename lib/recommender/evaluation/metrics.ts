/**
 * Offline ranking / list-quality metrics (Phase 8). Pure, hand-verifiable.
 *
 * Ranking metrics use binary held-out relevance and are computed per user,
 * then macro-averaged by the runner. Every function returns a finite value in
 * [0, 1] and treats degenerate inputs (empty lists, zero denominators) safely.
 */

import { cosineSimilarity } from "../similarity";
import type { FeatureVector } from "../types";

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Precision@K = |top-K ∩ relevant| / K (denominator is always K, short lists simply score lower). */
export function precisionAtK(recommended: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (!(k > 0)) return 0;
  let hits = 0;
  for (const projectId of recommended.slice(0, k)) if (relevant.has(projectId)) hits += 1;
  return clamp01(hits / k);
}

/** Recall@K = |top-K ∩ relevant| / |relevant| (0 when there is no relevant set). */
export function recallAtK(recommended: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0 || !(k > 0)) return 0;
  let hits = 0;
  for (const projectId of recommended.slice(0, k)) if (relevant.has(projectId)) hits += 1;
  return clamp01(hits / relevant.size);
}

/**
 * NDCG@K with binary relevance:
 *   DCG@K  = Σ_i rel_i / log2(i + 1)   (positions i start at 1)
 *   IDCG@K = DCG of the ideal ordering (all relevant items first)
 *   NDCG@K = DCG / IDCG, 0 when IDCG is 0.
 */
export function ndcgAtK(recommended: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0 || !(k > 0)) return 0;
  let dcg = 0;
  recommended.slice(0, k).forEach((projectId, index) => {
    if (relevant.has(projectId)) dcg += 1 / Math.log2(index + 2);
  });
  let idcg = 0;
  const idealHits = Math.min(relevant.size, k);
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? clamp01(dcg / idcg) : 0;
}

/** Hit@K = 1 if at least one relevant item appears in the top K, else 0. */
export function hitAtK(recommended: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  return recommended.slice(0, k).some((projectId) => relevant.has(projectId)) ? 1 : 0;
}

/** Catalogue coverage = |unique recommended across users| / |catalogue| (full catalogue denominator). */
export function catalogueCoverage(recommendationLists: readonly (readonly string[])[], catalogueSize: number): number {
  if (!(catalogueSize > 0)) return 0;
  const unique = new Set<string>();
  for (const list of recommendationLists) for (const projectId of list) unique.add(projectId);
  return clamp01(unique.size / catalogueSize);
}

/**
 * Intra-list diversity of one list: mean pairwise (1 − cosine) over all
 * unordered pairs of project content vectors, clamped to [0, 1].
 * Lists with fewer than two items have no pairs to diversify → 0.
 */
export function intraListDiversity(list: readonly string[], vectors: ReadonlyMap<string, FeatureVector>): number {
  const present = list.filter((projectId) => vectors.has(projectId));
  if (present.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const similarity = clamp01(cosineSimilarity(vectors.get(present[i]!)!, vectors.get(present[j]!)!));
      total += 1 - similarity;
      pairs += 1;
    }
  }
  return pairs > 0 ? clamp01(total / pairs) : 0;
}

/**
 * Popularity-based item novelty over TRAINING positive counts:
 *   itemNovelty(i) = 1 − log1p(count_i) / log1p(maxCount)     (1 when maxCount = 0)
 * so heavily consumed items score low and underexposed items score high.
 */
export function itemNovelty(count: number, maxCount: number): number {
  if (!(maxCount > 0)) return 1;
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
  return clamp01(1 - Math.log1p(safeCount) / Math.log1p(maxCount));
}

/** Mean item novelty of one recommendation list (0 for an empty list). */
export function listNovelty(list: readonly string[], positiveCounts: ReadonlyMap<string, number>, maxCount: number): number {
  if (list.length === 0) return 0;
  let total = 0;
  for (const projectId of list) total += itemNovelty(positiveCounts.get(projectId) ?? 0, maxCount);
  return clamp01(total / list.length);
}

/** Arithmetic mean (macro average); 0 for an empty input. */
export function macroMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  return sum / values.length;
}
