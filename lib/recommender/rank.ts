/**
 * Ranking: turns per-candidate normalised signals into one comparable score.
 *
 *   score = clamp01( Σ_c weight[c] * signal[c] )          c ∈ available components
 *   score *= savedProjectScoreMultiplier                    when the project is already saved
 *
 * Weights come from RECOMMENDER_CONFIG.rankingWeights restricted to the
 * components that actually exist for this user/pipeline (novelty and popularity
 * always; content when the profile has signal; collaborative when the user has
 * behavioural seeds; session when the current session carries meaningful
 * evidence — its raw weight scales with the session confidence) and
 * renormalised to sum to 1. For cold-start users the popularity weight is
 * boosted before renormalisation so a thin profile does not over-fit.
 *
 * Signals: `content` is a signed cosine affinity in [-1, 1] (a negative value
 * — the profile dislikes the project's features — legitimately lowers the
 * score); every other component is in [0, 1]. A signal that is *absent* for a
 * candidate (e.g. no collaborative evidence) contributes 0 to the weighted sum
 * and is reported as `null` in the breakdown, so "no evidence" stays
 * distinguishable from "evidence of zero"; non-finite inputs are neutralised
 * to 0. Ordering is deterministic: score desc, catalog popularity prior desc,
 * slug asc.
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
  /** Normalised signals present for this candidate (absent = no evidence → null in the breakdown). */
  signals: Partial<Record<ScoreComponent, number>>;
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
  /** Per-unit-of-preference change of each weight (defaults to RECOMMENDER_CONFIG.exploration.weightSlopes). */
  slopes?: RankingWeights;
  /** Exploration preference in [0, 1]; omitted = 0 (Familiar). */
  explorationPreference?: number;
  coldStart?: boolean;
  coldStartPopularityMultiplier?: number;
  /** Session confidence in [0, 1]; scales the session component's raw weight (omitted = 0 → no session weight). */
  sessionConfidence?: number;
}

/**
 * Raw (un-normalised) weight of one component for a preference `e`:
 *   max(0, base[c] + slope[c] · e); popularity additionally × multiplier for
 *   cold-start users; session additionally × sessionConfidence (so a session
 *   without evidence carries no weight and a strong coherent one approaches base.session).
 */
export function rawRankingWeight(component: ScoreComponent, options: ResolveWeightsOptions = {}): number {
  const base = options.base ?? RECOMMENDER_CONFIG.rankingWeights;
  const slopes = options.slopes ?? RECOMMENDER_CONFIG.exploration.weightSlopes;
  const multiplier = options.coldStartPopularityMultiplier ?? RECOMMENDER_CONFIG.coldStart.popularityWeightMultiplier;
  const e = Math.max(0, Math.min(1, Number.isFinite(options.explorationPreference ?? 0) ? (options.explorationPreference ?? 0) : 0));
  let weight = Math.max(0, base[component] + slopes[component] * e);
  if (options.coldStart && component === "popularity") weight *= multiplier;
  if (component === "session") {
    const confidence = options.sessionConfidence ?? 0;
    weight *= Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  }
  return weight;
}

/**
 * Restricts the exploration-adjusted weights to the available components and
 * renormalises them to sum to 1 (equal weights if everything is zero).
 */
export function resolveRankingWeights(components: readonly ScoreComponent[], options: ResolveWeightsOptions = {}): Partial<RankingWeights> {
  const unique = [...new Set(components)];
  const raw: Partial<RankingWeights> = {};
  let total = 0;
  for (const component of unique) {
    const weight = rawRankingWeight(component, options);
    raw[component] = weight;
    total += weight;
  }
  const resolved: Partial<RankingWeights> = {};
  for (const component of unique) {
    resolved[component] = total > 0 ? (raw[component] ?? 0) / total : 1 / unique.length;
  }
  return resolved;
}

/** Clamps a present signal into its valid range; non-finite values are neutralised to 0. */
function clampSignal(component: ScoreComponent, value: number): number {
  if (!Number.isFinite(value)) return 0;
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
      const raw = input.signals[component];
      const signal = raw === undefined ? null : clampSignal(component, raw);
      breakdown[component] = signal;
      const weight = options.weights[component];
      if (signal !== null && weight !== undefined && weight > 0) score += weight * signal;
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
