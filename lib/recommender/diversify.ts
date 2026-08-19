/**
 * Post-ranking diversification (maximal marginal relevance).
 *
 * Input: candidates already ranked by the hybrid score. Output: the final
 * top-K order, chosen greedily:
 *
 *   mmr(c) = λ · relevance(c) − (1 − λ) · maxSimilarityToSelected(c)
 *   λ      = clamp(0.90 − 0.20 · e, 0.5, 0.95)          e = exploration preference
 *
 * where relevance is the hybrid recommendation score (unchanged) and the
 * similarity is the non-negative project-to-project cosine over content
 * feature vectors (the same representation "Similar projects" uses — never the
 * user's signed profile). Two soft constraints shape the pick at each step:
 *
 *   - near-duplicates (similarity ≥ 0.9 to an already selected item) are held
 *     back while alternatives exist;
 *   - a per-tag cap of round((0.45 − 0.15 · e) · limit) items (at least 2)
 *     limits topic concentration.
 *
 * Relevance stays in charge: at each step only candidates whose relevance is
 * at least `alternativeQualityRatio` (0.8) of the best remaining relevance are
 * considered (the "relevance band"), so variety can re-order comparably good
 * projects but never lifts a much weaker one over a strong one. Within the
 * band the best MMR candidate that respects both constraints wins; if none
 * does, the constraints are relaxed for that pick (deterministically), so the
 * requested limit is always filled when the pool allows. Ties break by the
 * pre-diversification rank. The recommendation score is never overwritten;
 * `mmrScore` is diagnostic only.
 */

import { RECOMMENDER_CONFIG } from "./config";
import { cosineSimilarity } from "./similarity";
import type { FeatureVector } from "./types";

export interface DiversifiableCandidate {
  projectId: string;
  /** Hybrid recommendation score (relevance). */
  score: number;
  /** Pre-diversification rank (1-based). */
  rank: number;
}

export interface DiversifyProjectInfo {
  vector: FeatureVector;
  tagSlugs: readonly string[];
}

export interface DiversifiedItem<T extends DiversifiableCandidate> {
  item: T;
  preDiversificationRank: number;
  finalRank: number;
  mmrScore: number;
  maxSimilarityToSelected: number;
  /** True when a relaxed constraint level was needed to admit this item. */
  admittedUnderRelaxation: boolean;
}

export interface DiversifyOptions {
  limit: number;
  explorationPreference: number;
  projects: ReadonlyMap<string, DiversifyProjectInfo>;
  config?: typeof RECOMMENDER_CONFIG.diversity;
}

export interface DiversifyResult<T extends DiversifiableCandidate> {
  selected: DiversifiedItem<T>[];
  lambda: number;
  maxTagShare: number;
  maxPerTag: number;
  /** Number of picks admitted with a constraint relaxed (0 = constraints held throughout). */
  relaxationLevel: number;
  applied: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function diversificationLambda(explorationPreference: number, config = RECOMMENDER_CONFIG.diversity): number {
  const e = clamp(Number.isFinite(explorationPreference) ? explorationPreference : 0, 0, 1);
  return clamp(config.lambdaBase + config.lambdaSlope * e, config.lambdaMin, config.lambdaMax);
}

export function maxTagShare(explorationPreference: number, config = RECOMMENDER_CONFIG.diversity): number {
  const e = clamp(Number.isFinite(explorationPreference) ? explorationPreference : 0, 0, 1);
  return clamp(config.tagShareBase + config.tagShareSlope * e, 0, 1);
}

export function maxItemsPerTag(limit: number, explorationPreference: number, config = RECOMMENDER_CONFIG.diversity): number {
  return Math.max(config.minTagCount, Math.round(maxTagShare(explorationPreference, config) * limit));
}

export function diversifyRanked<T extends DiversifiableCandidate>(ranked: readonly T[], options: DiversifyOptions): DiversifyResult<T> {
  const config = options.config ?? RECOMMENDER_CONFIG.diversity;
  const limit = Math.max(0, Math.floor(options.limit));
  const lambda = diversificationLambda(options.explorationPreference, config);
  const share = maxTagShare(options.explorationPreference, config);
  const perTag = maxItemsPerTag(limit, options.explorationPreference, config);

  const passthrough = (): DiversifyResult<T> => ({
    selected: ranked.slice(0, limit).map((item, index) => ({
      item,
      preDiversificationRank: item.rank,
      finalRank: index + 1,
      mmrScore: lambda * item.score,
      maxSimilarityToSelected: 0,
      admittedUnderRelaxation: false,
    })),
    lambda,
    maxTagShare: share,
    maxPerTag: perTag,
    relaxationLevel: 0,
    applied: false,
  });
  if (limit === 0 || ranked.length < config.minListLengthToDiversify) return passthrough();

  const remaining = ranked.map((item) => ({ item, maxSim: 0 }));
  const selected: DiversifiedItem<T>[] = [];
  const tagCounts = new Map<string, number>();
  let relaxedPicks = 0;

  while (selected.length < limit && remaining.length > 0) {
    // Only candidates within the relevance band of the best remaining score may be re-ordered by diversity.
    let bestRemainingScore = Number.NEGATIVE_INFINITY;
    for (const entry of remaining) bestRemainingScore = Math.max(bestRemainingScore, entry.item.score);
    const floor = config.alternativeQualityRatio * bestRemainingScore;

    // Best by MMR within the band, and best by MMR among band candidates that respect the soft constraints.
    let bestAny = -1;
    let bestAnyMmr = Number.NEGATIVE_INFINITY;
    let bestEligible = -1;
    let bestEligibleMmr = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i]!;
      if (entry.item.score < floor) continue;
      const info = options.projects.get(entry.item.projectId);
      const tags = info?.tagSlugs ?? [];
      const mmr = lambda * entry.item.score - (1 - lambda) * entry.maxSim;
      const better = (current: number, currentIndex: number) =>
        mmr > current || (mmr === current && currentIndex >= 0 && entry.item.rank < remaining[currentIndex]!.item.rank);
      if (better(bestAnyMmr, bestAny)) {
        bestAnyMmr = mmr;
        bestAny = i;
      }
      const overCap = tags.some((tag) => (tagCounts.get(tag) ?? 0) >= perTag);
      const nearDuplicate = entry.maxSim >= config.nearDuplicateSimilarity;
      if (overCap || nearDuplicate) continue;
      if (better(bestEligibleMmr, bestEligible)) {
        bestEligibleMmr = mmr;
        bestEligible = i;
      }
    }
    if (bestAny === -1) break;
    const relaxed = bestEligible === -1;
    const pickIndex = relaxed ? bestAny : bestEligible;
    const pickMmr = relaxed ? bestAnyMmr : bestEligibleMmr;
    if (relaxed) relaxedPicks += 1;

    const [chosen] = remaining.splice(pickIndex, 1);
    const chosenInfo = options.projects.get(chosen!.item.projectId);
    for (const tag of chosenInfo?.tagSlugs ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    selected.push({
      item: chosen!.item,
      preDiversificationRank: chosen!.item.rank,
      finalRank: selected.length + 1,
      mmrScore: pickMmr,
      maxSimilarityToSelected: chosen!.maxSim,
      admittedUnderRelaxation: relaxed,
    });
    // Update every remaining candidate's similarity to the selected set.
    if (chosenInfo) {
      for (const entry of remaining) {
        const info = options.projects.get(entry.item.projectId);
        if (!info) continue;
        const similarity = Math.max(0, Math.min(1, cosineSimilarity(info.vector, chosenInfo.vector)));
        if (similarity > entry.maxSim) entry.maxSim = similarity;
      }
    }
  }

  return { selected, lambda, maxTagShare: share, maxPerTag: perTag, relaxationLevel: relaxedPicks, applied: true };
}
