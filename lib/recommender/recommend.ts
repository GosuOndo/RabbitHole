/**
 * Recommendation orchestration.
 *
 *   profile (long-term + session)  ──▶ effective profile vector
 *          │
 *          ├─▶ content candidates        (cosine affinity, ~50)
 *          ├─▶ collaborative candidates  (item-item neighbours of the user's positive projects, ~30)
 *          └─▶ popularity candidates     (seed prior + behaviour, ~15)
 *                     │
 *              merge (keep all sources) ─▶ filter (terminal states) ─▶ signals ─▶ hybrid rank ─▶ top-K ─▶ explain
 *
 * `runRecommendationPipeline` is pure (fixtures in, recommendations out) so
 * the whole lifecycle is unit-testable; `recommendForUser` only loads data
 * through injected loaders and calls it. Exploration, novelty and
 * diversification are added by later phases as extra retrieval sources /
 * ranking components without changing this shape.
 */

import { countBySource, filterCandidates, mergeCandidateSets } from "./candidates";
import {
  buildCollaborativeModel,
  collaborativeSeedsForUser,
  retrieveCollaborativeCandidates,
  scoreCollaborativeCandidates,
  type CollaborativeScoring,
  type CollaborativeSeed,
  type CollaborativeSeedState,
} from "./collaborative";
import { RECOMMENDER_CONFIG } from "./config";
import { retrieveContentCandidates, scoreContentAffinity } from "./content";
import { explainRecommendation, type CollaborativeSeedReference, type Explanation } from "./explain";
import type { FeatureFamily } from "./features";
import { computePopularityScores, retrievePopularityCandidates } from "./popularity";
import type { InterestProfile } from "./profile";
import { rankCandidates, resolveRankingWeights, type RankingInput } from "./rank";
import { blendProfiles } from "./session";
import { cosineSimilarity } from "./similarity";
import type {
  CandidateSource,
  CollaborativeInteraction,
  PipelineStats,
  ProjectVector,
  RankingWeights,
  ScoreBreakdown,
  ScoreComponent,
} from "./types";

export const RECOMMENDER_ALGORITHM = "hybrid-v1";

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
  userId: string;
  profile: RecommendationProfileInput;
  catalog: readonly ProjectVector[];
  /** Σ positive interaction weights per project across all users. */
  popularityEvidence: ReadonlyMap<string, number>;
  /** Non-impression interactions of all users (collaborative filtering input). */
  interactions: readonly CollaborativeInteraction[];
  labelFor: LabelResolver;
  limit: number;
}

export interface CollaborativeSeedView {
  projectId: string;
  slug: string;
  title: string;
  state: CollaborativeSeedState;
  /** Item-item similarity between the seed and the recommended project. */
  similarity: number;
  /** similarity × seed weight. */
  contribution: number;
}

/** Collaborative diagnostics for one recommendation (only the user's own seeds are exposed). */
export interface CollaborativeItemDiagnostics {
  score: number;
  rawEvidence: number;
  confidence: number;
  seeds: CollaborativeSeedView[];
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
  /** Present only when collaborative evidence exists for this project. */
  collaborative: CollaborativeItemDiagnostics | null;
}

export interface CollaborativeContext {
  /** Whether the collaborative component took part in ranking for this user. */
  available: boolean;
  seedCount: number;
  seedWeightTotal: number;
  confidence: number;
  candidatesWithEvidence: number;
  modelUsers: number;
  modelItems: number;
}

export interface RecommendationContext {
  coldStart: boolean;
  profileEmpty: boolean;
  weightedInteractionCount: number;
  includesOnboarding: boolean;
  sessionWeight: number;
  collaborative: CollaborativeContext;
  /** Score components that carried weight for this user. */
  components: ScoreComponent[];
}

export interface RecommendationPipelineOutput {
  algorithm: typeof RECOMMENDER_ALGORITHM;
  items: RecommendationItem[];
  pipeline: PipelineStats;
  context: RecommendationContext;
}

/** Which ranking components exist for this user (weights are renormalised over them). */
export function resolveAvailableComponents(flags: { profileEmpty: boolean; collaborativeAvailable: boolean }): ScoreComponent[] {
  const components: ScoreComponent[] = [];
  if (!flags.profileEmpty) components.push("content");
  if (flags.collaborativeAvailable) components.push("collaborative");
  components.push("popularity");
  return components;
}

/** Seed views for one candidate, with titles resolved from the catalog. */
export function describeSupportingSeeds(
  scoring: CollaborativeScoring,
  projectId: string,
  projectById: ReadonlyMap<string, ProjectVector>,
): CollaborativeSeedView[] {
  const evidence = scoring.scores.get(projectId);
  if (!evidence) return [];
  const seedById = new Map<string, CollaborativeSeed>(scoring.seeds.map((s) => [s.projectId, s]));
  return evidence.supportingSeeds.flatMap((support) => {
    const seed = seedById.get(support.projectId);
    const project = projectById.get(support.projectId);
    if (!seed || !project) return [];
    return [{ projectId: seed.projectId, slug: project.slug, title: project.title, state: seed.state, similarity: support.similarity, contribution: support.contribution }];
  });
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

  const collaborativeModel = buildCollaborativeModel(input.interactions, { excludeUserId: input.userId });
  const seeds = collaborativeSeedsForUser(input.interactions, input.userId);
  const collaborativeScoring = scoreCollaborativeCandidates(collaborativeModel, seeds, {
    excludedProjectIds: profile.excludedProjectIds,
  });
  const collaborativeCandidates = retrieveCollaborativeCandidates(collaborativeScoring, catalog);

  const popularityScores = computePopularityScores(catalog, input.popularityEvidence);
  const popularityCandidates = retrievePopularityCandidates(popularityScores, catalog, {
    excludedProjectIds: profile.excludedProjectIds,
  });
  const candidateSets = [contentCandidates, collaborativeCandidates, popularityCandidates];

  // 3. Merge (dedupe by project, keep every source) and filter.
  const merged = mergeCandidateSets(candidateSets);
  const { kept } = filterCandidates(merged, {
    excludedProjectIds: profile.excludedProjectIds,
    knownProjectIds: new Set(projectById.keys()),
  });

  // 4. Ranking signals for every surviving candidate (absent evidence stays absent).
  const contentAffinity = scoreContentAffinity(effective.vector, catalog);
  const collaborativeAvailable = seeds.length > 0 && collaborativeScoring.scores.size > 0;
  const rankingInputs: RankingInput[] = kept.map((candidate) => {
    const project = projectById.get(candidate.projectId)!;
    const collaborative = collaborativeScoring.scores.get(project.id);
    const popularity = popularityScores.get(project.id);
    return {
      projectId: project.id,
      slug: project.slug,
      popularityPrior: project.popularity,
      sources: candidate.sources,
      signals: {
        ...(profileEmpty ? {} : { content: contentAffinity.get(project.id) ?? 0 }),
        ...(collaborative ? { collaborative: collaborative.score } : {}),
        popularity: popularity?.score ?? 0,
      },
      saved: profile.savedProjectIds.has(project.id),
      rawSignals: {
        ...candidate.signals,
        contentAffinity: contentAffinity.get(project.id) ?? 0,
        popularityPrior: popularity?.prior ?? 0,
        popularityBehavioral: popularity?.behavioral ?? 0,
        collaborativeEvidence: collaborative?.rawEvidence ?? 0,
        collaborativeSeeds: collaborative?.supportingSeeds.length ?? 0,
      },
    };
  });

  // 5. Hybrid rank with weights renormalised over the components this user has.
  const components = resolveAvailableComponents({ profileEmpty, collaborativeAvailable });
  const weights = resolveRankingWeights(components, { coldStart });
  const ranked = rankCandidates(rankingInputs, { weights });
  const top = ranked.slice(0, limit);

  // 6. Explain each surfaced recommendation from its actual signals.
  const items: RecommendationItem[] = top.map((r) => {
    const project = projectById.get(r.projectId)!;
    const sessionAffinity = profile.session.norm > 0 ? cosineSimilarity(profile.session.vector, project.vector) : null;
    const evidence = collaborativeScoring.scores.get(r.projectId) ?? null;
    const seedViews = describeSupportingSeeds(collaborativeScoring, r.projectId, projectById);
    const seedReferences: CollaborativeSeedReference[] = seedViews.map((s) => ({
      projectId: s.projectId,
      title: s.title,
      state: s.state,
      contribution: s.contribution,
    }));
    const explanation = explainRecommendation({
      project,
      longTerm: profile.longTerm,
      session: profile.session.norm > 0 ? profile.session : null,
      contentAffinity: r.breakdown.content ?? 0,
      sessionAffinity,
      popularityScore: r.breakdown.popularity ?? 0,
      sources: r.sources,
      coldStart: profile.longTerm.interactionCount === 0,
      labelFor,
      collaborativeScore: r.breakdown.collaborative,
      collaborativeSeeds: seedReferences,
      weights: r.weights,
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
      collaborative: evidence
        ? { score: evidence.score, rawEvidence: evidence.rawEvidence, confidence: collaborativeScoring.confidence, seeds: seedViews }
        : null,
    };
  });

  const pipeline: PipelineStats = {
    contentCandidates: countBySource(candidateSets, "content"),
    collaborativeCandidates: countBySource(candidateSets, "collaborative"),
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
      collaborative: {
        available: collaborativeAvailable,
        seedCount: seeds.length,
        seedWeightTotal: collaborativeScoring.seedWeightTotal,
        confidence: collaborativeScoring.confidence,
        candidatesWithEvidence: collaborativeScoring.scores.size,
        modelUsers: collaborativeModel.userCount,
        modelItems: collaborativeModel.itemCount,
      },
      components,
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
  /** Non-impression interactions of all users, oldest first. */
  loadCollaborativeInteractions(): Promise<CollaborativeInteraction[]>;
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
  const [profile, catalog, popularityEvidence, interactions, labelFor] = await Promise.all([
    deps.loadProfile(request.userId, now),
    deps.loadCatalog(),
    deps.loadPopularityEvidence(),
    deps.loadCollaborativeInteractions(),
    deps.loadLabelResolver(),
  ]);
  const output = runRecommendationPipeline({ userId: request.userId, profile, catalog, popularityEvidence, interactions, labelFor, limit });
  return { ...output, generatedAt: now.toISOString(), limit };
}
