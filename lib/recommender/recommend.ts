/**
 * Recommendation orchestration.
 *
 *   profile (long-term + session)  ──▶ effective profile vector
 *          │
 *          ├─▶ content candidates   (cosine affinity, ~50)
 *          └─▶ popularity candidates (seed prior + behaviour, ~15)
 *                     │
 *              merge (keep all sources) ─▶ filter (terminal states) ─▶ signals ─▶ rank ─▶ top-K ─▶ explain
 *
 * `runRecommendationPipeline` is pure (fixtures in, recommendations out) so
 * the whole lifecycle is unit-testable; `recommendForUser` only loads data
 * through injected loaders and calls it. Collaborative filtering, exploration,
 * novelty and diversification are added by later phases as extra retrieval
 * sources / ranking components without changing this shape.
 */

import { countBySource, filterCandidates, mergeCandidateSets } from "./candidates";
import { RECOMMENDER_CONFIG } from "./config";
import { retrieveContentCandidates, scoreContentAffinity } from "./content";
import { explainRecommendation, type Explanation } from "./explain";
import type { FeatureFamily } from "./features";
import { computePopularityScores, retrievePopularityCandidates } from "./popularity";
import type { InterestProfile } from "./profile";
import { rankCandidates, resolveRankingWeights, type RankingInput } from "./rank";
import { blendProfiles } from "./session";
import { cosineSimilarity } from "./similarity";
import type { CandidateSource, PipelineStats, ProjectVector, RankingWeights, ScoreBreakdown } from "./types";

export const RECOMMENDER_ALGORITHM = "content-v1";

export type LabelResolver = (family: FeatureFamily, key: string) => string;

export interface RecommendationProfileInput {
  longTerm: InterestProfile;
  session: InterestProfile;
  /** Projects in terminal states (DISLIKE / BUILD / COMPLETE) — never shown. */
  excludedProjectIds: ReadonlySet<string>;
  /** Currently saved projects — eligible but demoted. */
  savedProjectIds: ReadonlySet<string>;
}

export interface RecommendationPipelineInput {
  profile: RecommendationProfileInput;
  catalog: readonly ProjectVector[];
  /** Σ positive interaction weights per project across all users. */
  popularityEvidence: ReadonlyMap<string, number>;
  labelFor: LabelResolver;
  limit: number;
}

export interface RecommendationItem {
  rank: number;
  projectId: string;
  slug: string;
  /** Match score in [0, 1] (not a calibrated probability). */
  score: number;
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  sources: CandidateSource[];
  explanation: Explanation;
  saved: boolean;
  rawSignals: Record<string, number>;
}

export interface RecommendationContext {
  coldStart: boolean;
  profileEmpty: boolean;
  weightedInteractionCount: number;
  includesOnboarding: boolean;
  sessionWeight: number;
}

export interface RecommendationPipelineOutput {
  algorithm: typeof RECOMMENDER_ALGORITHM;
  items: RecommendationItem[];
  pipeline: PipelineStats;
  context: RecommendationContext;
}

export function runRecommendationPipeline(input: RecommendationPipelineInput): RecommendationPipelineOutput {
  const { profile, catalog, labelFor } = input;
  const limit = Math.max(0, Math.floor(input.limit));
  const projectById = new Map(catalog.map((p) => [p.id, p]));

  // 1. Effective profile: long-term taste with a modest, fixed session blend.
  const effective = blendProfiles(profile.longTerm, profile.session);
  const coldStart = profile.longTerm.interactionCount < RECOMMENDER_CONFIG.coldStart.maxInteractions;
  const profileEmpty = Object.keys(effective.vector).length === 0;

  // 2. Retrieval (each strategy excludes terminal-state projects itself).
  const contentCandidates = retrieveContentCandidates(effective.vector, catalog, {
    excludedProjectIds: profile.excludedProjectIds,
  });
  const popularityScores = computePopularityScores(catalog, input.popularityEvidence);
  const popularityCandidates = retrievePopularityCandidates(popularityScores, catalog, {
    excludedProjectIds: profile.excludedProjectIds,
  });
  const candidateSets = [contentCandidates, popularityCandidates];

  // 3. Merge (dedupe by project, keep every source) and filter.
  const merged = mergeCandidateSets(candidateSets);
  const { kept } = filterCandidates(merged, {
    excludedProjectIds: profile.excludedProjectIds,
    knownProjectIds: new Set(projectById.keys()),
  });

  // 4. Ranking signals for every surviving candidate.
  const contentAffinity = scoreContentAffinity(effective.vector, catalog);
  const rankingInputs: RankingInput[] = kept.map((candidate) => {
    const project = projectById.get(candidate.projectId)!;
    return {
      projectId: project.id,
      slug: project.slug,
      popularityPrior: project.popularity,
      sources: candidate.sources,
      signals: {
        content: contentAffinity.get(project.id) ?? 0,
        popularity: popularityScores.get(project.id)?.score ?? 0,
      },
      saved: profile.savedProjectIds.has(project.id),
      rawSignals: {
        ...candidate.signals,
        contentAffinity: contentAffinity.get(project.id) ?? 0,
        popularityPrior: popularityScores.get(project.id)?.prior ?? 0,
        popularityBehavioral: popularityScores.get(project.id)?.behavioral ?? 0,
      },
    };
  });

  // 5. Rank with weights restricted to the components this phase has.
  const weights = resolveRankingWeights(["content", "popularity"], { coldStart });
  const ranked = rankCandidates(rankingInputs, { weights });
  const top = ranked.slice(0, limit);

  // 6. Explain each surfaced recommendation from its actual signals.
  const items: RecommendationItem[] = top.map((r) => {
    const project = projectById.get(r.projectId)!;
    const sessionAffinity = profile.session.norm > 0 ? cosineSimilarity(profile.session.vector, project.vector) : null;
    const explanation = explainRecommendation({
      project,
      longTerm: profile.longTerm,
      session: profile.session.norm > 0 ? profile.session : null,
      contentAffinity: r.breakdown.content,
      sessionAffinity,
      popularityScore: r.breakdown.popularity,
      sources: r.sources,
      coldStart: profile.longTerm.interactionCount === 0,
      labelFor,
    });
    return {
      rank: r.rank,
      projectId: r.projectId,
      slug: r.slug,
      score: r.score,
      breakdown: r.breakdown,
      weights: r.weights,
      sources: r.sources,
      explanation,
      saved: r.saved,
      rawSignals: r.rawSignals,
    };
  });

  const pipeline: PipelineStats = {
    contentCandidates: countBySource(candidateSets, "content"),
    collaborativeCandidates: 0,
    popularCandidates: countBySource(candidateSets, "popular"),
    explorationCandidates: 0,
    uniqueCandidates: merged.length,
    afterFiltering: kept.length,
    ranked: ranked.length,
    final: items.length,
  };

  return {
    algorithm: RECOMMENDER_ALGORITHM,
    items,
    pipeline,
    context: {
      coldStart,
      profileEmpty,
      weightedInteractionCount: profile.longTerm.interactionCount,
      includesOnboarding: profile.longTerm.includesOnboarding,
      sessionWeight: effective.sessionWeight,
    },
  };
}

// ---------------------------------------------------------------------------
// Async orchestrator with injectable data loaders (no Prisma in this module).
// ---------------------------------------------------------------------------

export interface RecommenderDeps {
  loadProfile(userId: string, now: Date): Promise<RecommendationProfileInput>;
  loadCatalog(): Promise<ProjectVector[]>;
  loadPopularityEvidence(): Promise<Map<string, number>>;
  loadLabelResolver(): Promise<LabelResolver>;
}

export interface RecommendationRequest {
  userId: string;
  limit?: number;
  now?: Date;
}

export interface RecommendationResult extends RecommendationPipelineOutput {
  generatedAt: string;
  limit: number;
}

export async function recommendForUser(deps: RecommenderDeps, request: RecommendationRequest): Promise<RecommendationResult> {
  const now = request.now ?? new Date();
  const limit = Math.min(RECOMMENDER_CONFIG.feed.maxLimit, Math.max(1, request.limit ?? RECOMMENDER_CONFIG.feed.defaultLimit));
  const [profile, catalog, popularityEvidence, labelFor] = await Promise.all([
    deps.loadProfile(request.userId, now),
    deps.loadCatalog(),
    deps.loadPopularityEvidence(),
    deps.loadLabelResolver(),
  ]);
  const output = runRecommendationPipeline({ profile, catalog, popularityEvidence, labelFor, limit });
  return { ...output, generatedAt: now.toISOString(), limit };
}
