/**
 * Ranking: turns per-candidate normalised signals into one comparable score.
 *
 *   score = clamp01( Σ_c weight[c] * signal[c] )          c ∈ available components
 *   score *= savedProjectScoreMultiplier                    when the project is already saved
 *
 * Weights come from RECOMMENDER_CONFIG.rankingWeights restricted to the
 * components that actually exist for this pipeline (Phase 3: content and
 * popularity; collaborative/session/novelty are added by later phases) and
 * renormalised to sum to 1. For cold-start users the popularity weight is
 * boosted before renormalisation so a thin profile does not over-fit.
 *
 * Signals: `content` is a signed cosine affinity in [-1, 1] (a negative value
 * — the profile dislikes the project's features — legitimately lowers the
 * score); every other component is in [0, 1]. Missing signals are neutral (0),
 * never NaN. Ordering is deterministic: score desc, catalog popularity prior
 * desc, slug asc.
 *
 * The score is a *match score*, not a calibrated probability.
 */

import { RECOMMENDER_CONFIG } from "./config";
import { SCORE_COMPONENTS, type CandidateSource, type RankingWeights, type ScoreBreakdown, type ScoreComponent } from "./types";

export interface RankingInput {
  projectId: string;
  slug: string;
  /** Catalog popularity prior, used only for tie-breaking. */
  popularityPrior: number;
  sources: CandidateSource[];
  /** Normalised signals present for this candidate (missing = 0). */
  signals: Partial<ScoreBreakdown>;
  saved?: boolean;
  /** Raw retrieval signals kept for diagnostics. */
  rawSignals?: Record<string, number>;
}

export interface RankedCandidate {
  projectId: string;
  slug: string;
  rank: number;
  score: number;
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  sources: CandidateSource[];
  saved: boolean;
  savedMultiplierApplied: boolean;
  rawSignals: Record<string, number>;
}

export interface ResolveWeightsOptions {
  base?: RankingWeights;
  coldStart?: boolean;
  coldStartPopularityMultiplier?: number;
}

/** Restricts base weights to the available components and renormalises them to sum to 1. */
export function resolveRankingWeights(components: readonly ScoreComponent[], options: ResolveWeightsOptions = {}): Partial<RankingWeights> {
  const base = options.base ?? RECOMMENDER_CONFIG.rankingWeights;
  const multiplier = options.coldStartPopularityMultiplier ?? RECOMMENDER_CONFIG.coldStart.popularityWeightMultiplier;
  const unique = [...new Set(components)];
  const raw: Partial<RankingWeights> = {};
  let total = 0;
  for (const component of unique) {
    let weight = Math.max(0, base[component]);
    if (options.coldStart && component === "popularity") weight *= multiplier;
    raw[component] = weight;
    total += weight;
  }
  const resolved: Partial<RankingWeights> = {};
  for (const component of unique) {
    resolved[component] = total > 0 ? (raw[component] ?? 0) / total : 1 / unique.length;
  }
  return resolved;
}

function clampSignal(component: ScoreComponent, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  const min = component === "content" ? -1 : 0;
  return Math.max(min, Math.min(1, value));
}

export function rankCandidates(
  inputs: readonly RankingInput[],
  options: { weights: Partial<RankingWeights>; savedProjectScoreMultiplier?: number },
): RankedCandidate[] {
  const savedMultiplier = options.savedProjectScoreMultiplier ?? RECOMMENDER_CONFIG.filtering.savedProjectScoreMultiplier;
  const scored = inputs.map((input) => {
    const breakdown = {} as ScoreBreakdown;
    let score = 0;
    for (const component of SCORE_COMPONENTS) {
      const signal = clampSignal(component, input.signals[component]);
      breakdown[component] = signal;
      const weight = options.weights[component];
      if (weight !== undefined && weight > 0) score += weight * signal;
    }
    score = Math.max(0, Math.min(1, score));
    const saved = input.saved ?? false;
    if (saved) score *= savedMultiplier;
    return { input, score, breakdown, saved };
  });
  scored.sort(
    (a, b) => b.score - a.score || b.input.popularityPrior - a.input.popularityPrior || a.input.slug.localeCompare(b.input.slug),
  );
  return scored.map(({ input, score, breakdown, saved }, index) => ({
    projectId: input.projectId,
    slug: input.slug,
    rank: index + 1,
    score,
    breakdown,
    weights: options.weights,
    sources: input.sources,
    saved,
    savedMultiplierApplied: saved,
    rawSignals: input.rawSignals ?? {},
  }));
}
