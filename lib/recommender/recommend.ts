/**
 * Recommendation orchestration.
 *
 *   profile (long-term + session) ──▶ effective profile vector          explorationPreference e ∈ [0, 1]
 *          │
 *          ├─▶ content candidates        (cosine affinity, ~50)
 *          ├─▶ collaborative candidates  (item-item neighbours of the user's positive projects, ~30)
 *          ├─▶ popularity candidates     (seed prior + behaviour, ~15)
 *          └─▶ exploration candidates    (plausible + novel, ~8–15 growing with e)
 *                     │
 *              merge (keep all sources) ─▶ filter (terminal states) ─▶ novelty + signals
 *                     ─▶ exploration-aware hybrid rank ─▶ diversify (MMR) ─▶ final top-K ─▶ explain
 *
 * `runRecommendationPipeline` is pure (fixtures in, recommendations out) so
 * the whole lifecycle is unit-testable; `recommendForUser` only loads data
 * through injected loaders and calls it. Session-aware re-ranking (Phase 6)
 * slots in as another ranking component without changing this shape.
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
import { diversifyRanked, type DiversifyResult } from "./diversify";
import { explainRecommendation, type CollaborativeSeedReference, type Explanation } from "./explain";
import { retrieveExplorationCandidates, type ExplorationDiagnostics } from "./exploration";
import type { FeatureFamily } from "./features";
import { computeNovelty, type NoveltyBreakdown } from "./novelty";
import { computePopularityScores, retrievePopularityCandidates } from "./popularity";
import type { InterestProfile } from "./profile";
import { rankCandidates, resolveRankingWeights, type RankedCandidate, type RankingInput } from "./rank";
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

export const RECOMMENDER_ALGORITHM = "hybrid-explore-v1";

export type LabelResolver = (family: FeatureFamily, key: string) => string;

export interface RecommendationProfileInput {
  longTerm: InterestProfile;
  session: InterestProfile;
  /** Projects in terminal states (DISLIKE / BUILD / COMPLETE) — never shown. */
  excludedProjectIds: ReadonlySet<string>;
  /** Currently saved projects — eligible but demoted. */
  savedProjectIds: ReadonlySet<string>;
  /** Persisted Familiar (0) ↔ Adventurous (1) preference. */
  explorationPreference: number;
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

export interface DiversificationItemDiagnostics {
  /** λ · relevance − (1 − λ) · maxSimilarityToSelected — diagnostic only, never the match score. */
  mmrScore: number;
  maxSimilarityToSelected: number;
  admittedUnderRelaxation: boolean;
}

export interface RecommendationItem {
  /** Final position after diversification (1-based). */
  rank: number;
  /** Position after hybrid ranking, before diversification (1-based). */
  preDiversificationRank: number;
  projectId: string;
  slug: string;
  /** Hybrid recommendation ("match") score in [0, 1] — not a calibrated probability, never replaced by the MMR score. */
  score: number;
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  sources: CandidateSource[];
  explanation: Explanation;
  saved: boolean;
  rawSignals: Record<string, number>;
  /** Present only when collaborative evidence exists for this project. */
  collaborative: CollaborativeItemDiagnostics | null;
  novelty: NoveltyBreakdown;
  /** Present when the exploration source retrieved this project. */
  exploration: ExplorationDiagnostics | null;
  diversification: DiversificationItemDiagnostics;
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

export type DiscoveryMode = "familiar" | "balanced" | "adventurous";

export interface ExplorationContext {
  preference: number;
  mode: DiscoveryMode;
  /** Exploration candidates requested for this preference. */
  candidateLimit: number;
}

export interface DiversificationContext {
  applied: boolean;
  lambda: number;
  maxTagShare: number;
  maxPerTag: number;
  relaxationLevel: number;
}

export interface RecommendationContext {
  coldStart: boolean;
  profileEmpty: boolean;
  weightedInteractionCount: number;
  includesOnboarding: boolean;
  sessionWeight: number;
  collaborative: CollaborativeContext;
  exploration: ExplorationContext;
  diversification: DiversificationContext;
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
  components.push("novelty", "popularity");
  return components;
}

export function discoveryMode(preference: number, labels = RECOMMENDER_CONFIG.exploration.labels): DiscoveryMode {
  if (preference <= labels.familiarMax) return "familiar";
  if (preference >= labels.adventurousMin) return "adventurous";
  return "balanced";
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
  const explorationPreference = Math.max(
    RECOMMENDER_CONFIG.exploration.minPreference,
    Math.min(RECOMMENDER_CONFIG.exploration.maxPreference, Number.isFinite(profile.explorationPreference) ? profile.explorationPreference : RECOMMENDER_CONFIG.exploration.defaultPreference),
  );

  // 1. Effective profile: long-term taste with a modest, fixed session blend.
  const effective = blendProfiles(profile.longTerm, profile.session);
  const coldStart = profile.longTerm.interactionCount < RECOMMENDER_CONFIG.coldStart.maxInteractions;
  const profileEmpty = Object.keys(effective.vector).length === 0;

  // 2. Per-project signals shared by retrieval and ranking.
  const contentAffinity = scoreContentAffinity(effective.vector, catalog);
  const popularityScores = computePopularityScores(catalog, input.popularityEvidence);
  const collaborativeModel = buildCollaborativeModel(input.interactions, { excludeUserId: input.userId });
  const seeds = collaborativeSeedsForUser(input.interactions, input.userId);
  const collaborativeScoring = scoreCollaborativeCandidates(collaborativeModel, seeds, {
    excludedProjectIds: profile.excludedProjectIds,
  });
  const collaborativeAvailable = seeds.length > 0 && collaborativeScoring.scores.size > 0;
  const noveltyByProject = new Map<string, NoveltyBreakdown>(
    catalog.map((project) => [
      project.id,
      computeNovelty({
        popularityScore: popularityScores.get(project.id)?.score ?? 0,
        contentAffinity: profileEmpty ? null : (contentAffinity.get(project.id) ?? 0),
      }),
    ]),
  );

  // 3. Retrieval (each strategy excludes terminal-state projects itself).
  const contentCandidates = retrieveContentCandidates(effective.vector, catalog, { excludedProjectIds: profile.excludedProjectIds });
  const collaborativeCandidates = retrieveCollaborativeCandidates(collaborativeScoring, catalog);
  const popularityCandidates = retrievePopularityCandidates(popularityScores, catalog, { excludedProjectIds: profile.excludedProjectIds });
  const exploration = retrieveExplorationCandidates({
    projects: catalog,
    contentAffinity: profileEmpty ? null : contentAffinity,
    collaborativeScores: collaborativeAvailable ? new Map([...collaborativeScoring.scores.entries()].map(([id, e]) => [id, e.score])) : null,
    popularityScores: new Map([...popularityScores.entries()].map(([id, p]) => [id, p.score])),
    novelty: noveltyByProject,
    excludedProjectIds: profile.excludedProjectIds,
    explorationPreference,
  });
  const candidateSets = [contentCandidates, collaborativeCandidates, popularityCandidates, exploration.candidates];

  // 4. Merge (dedupe by project, keep every source) and filter.
  const merged = mergeCandidateSets(candidateSets);
  const { kept } = filterCandidates(merged, {
    excludedProjectIds: profile.excludedProjectIds,
    knownProjectIds: new Set(projectById.keys()),
  });

  // 5. Ranking signals for every surviving candidate (absent evidence stays absent; novelty always exists).
  const rankingInputs: RankingInput[] = kept.map((candidate) => {
    const project = projectById.get(candidate.projectId)!;
    const collaborative = collaborativeScoring.scores.get(project.id);
    const popularity = popularityScores.get(project.id);
    const novelty = noveltyByProject.get(project.id)!;
    return {
      projectId: project.id,
      slug: project.slug,
      popularityPrior: project.popularity,
      sources: candidate.sources,
      signals: {
        ...(profileEmpty ? {} : { content: contentAffinity.get(project.id) ?? 0 }),
        ...(collaborative ? { collaborative: collaborative.score } : {}),
        novelty: novelty.novelty,
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
        underexposure: novelty.underexposure,
        adjacency: novelty.adjacency,
        explorationScore: exploration.diagnostics.get(project.id)?.explorationScore ?? 0,
      },
    };
  });

  // 6. Exploration-aware hybrid rank with weights renormalised over the components this user has.
  const components = resolveAvailableComponents({ profileEmpty, collaborativeAvailable });
  const weights = resolveRankingWeights(components, { coldStart, explorationPreference });
  const ranked = rankCandidates(rankingInputs, { weights });

  // 7. Diversify (MMR + tag concentration) and take the final top-K.
  const diversified: DiversifyResult<RankedCandidate> = diversifyRanked(ranked, {
    limit,
    explorationPreference,
    projects: new Map(catalog.map((p) => [p.id, { vector: p.vector, tagSlugs: p.tagSlugs }])),
  });

  // 8. Explain each surfaced recommendation from its actual signals.
  const items: RecommendationItem[] = diversified.selected.map((entry) => {
    const r = entry.item;
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
    const novelty = noveltyByProject.get(r.projectId)!;
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
      novelty,
      explorationPreference,
    });
    return {
      rank: entry.finalRank,
      preDiversificationRank: entry.preDiversificationRank,
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
      novelty,
      exploration: exploration.diagnostics.get(r.projectId) ?? null,
      diversification: {
        mmrScore: entry.mmrScore,
        maxSimilarityToSelected: entry.maxSimilarityToSelected,
        admittedUnderRelaxation: entry.admittedUnderRelaxation,
      },
    };
  });

  const pipeline: PipelineStats = {
    contentCandidates: countBySource(candidateSets, "content"),
    collaborativeCandidates: countBySource(candidateSets, "collaborative"),
    popularCandidates: countBySource(candidateSets, "popular"),
    explorationCandidates: countBySource(candidateSets, "exploration"),
    uniqueCandidates: merged.length,
    afterFiltering: kept.length,
    ranked: ranked.length,
    preDiversificationCandidates: ranked.length,
    diversifiedCandidates: diversified.selected.length,
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
      exploration: {
        preference: explorationPreference,
        mode: discoveryMode(explorationPreference),
        candidateLimit: exploration.limit,
      },
      diversification: {
        applied: diversified.applied,
        lambda: diversified.lambda,
        maxTagShare: diversified.maxTagShare,
        maxPerTag: diversified.maxPerTag,
        relaxationLevel: diversified.relaxationLevel,
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
