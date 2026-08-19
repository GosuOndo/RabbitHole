/**
 * Recommendation views for the API and pages: runs the orchestrator with the
 * Prisma loaders and attaches card-level project data.
 */

import type { ProjectSummary } from "@/lib/catalog/queries";
import {
  buildCollaborativeModel,
  collaborativeSeedsForUser,
  scoreCollaborativeCandidates,
} from "@/lib/recommender/collaborative";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { explainRecommendation, type Explanation } from "@/lib/recommender/explain";
import { computePopularityScores } from "@/lib/recommender/popularity";
import { rankCandidates, resolveRankingWeights } from "@/lib/recommender/rank";
import type { ExplorationDiagnostics } from "@/lib/recommender/exploration";
import { computeNovelty, type NoveltyBreakdown } from "@/lib/recommender/novelty";
import {
  describeSupportingSeeds,
  recommendForUser,
  resolveAvailableComponents,
  type CollaborativeItemDiagnostics,
  type DiversificationItemDiagnostics,
  type RecommendationContext,
  type RecommenderDeps,
} from "@/lib/recommender/recommend";
import { blendProfiles } from "@/lib/recommender/session";
import { cosineSimilarity } from "@/lib/recommender/similarity";
import { similarProjects } from "@/lib/recommender/similar";
import type { CandidateSource, PipelineStats, RankingWeights, ScoreBreakdown } from "@/lib/recommender/types";
import {
  loadCatalogItems,
  loadCollaborativeInteractions,
  loadLabelResolver,
  loadPopularityEvidence,
  loadRecommendationProfile,
  type CatalogItem,
} from "./loaders";

export interface RecommendationView {
  /** Final position after diversification. */
  rank: number;
  /** Position after hybrid ranking, before diversification. */
  preDiversificationRank: number;
  /** Match score in [0, 1] — not a calibrated probability, never the MMR score. */
  score: number;
  /** Per-component signals; `null` = no evidence for this candidate. */
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  sources: CandidateSource[];
  explanation: Explanation;
  saved: boolean;
  /** Collaborative evidence behind this recommendation (null when none). */
  collaborative: CollaborativeItemDiagnostics | null;
  novelty: NoveltyBreakdown;
  /** Exploration retrieval diagnostics (null unless the exploration source retrieved it). */
  exploration: ExplorationDiagnostics | null;
  diversification: DiversificationItemDiagnostics;
  project: ProjectSummary;
}

export interface RecommendationFeed {
  algorithm: string;
  generatedAt: string;
  limit: number;
  items: RecommendationView[];
  pipeline: PipelineStats;
  context: RecommendationContext;
}

export function toProjectSummary(item: CatalogItem): ProjectSummary {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    difficulty: item.difficulty,
    estimatedHours: item.estimatedHours,
    popularity: item.popularity,
    tags: item.tags,
    languages: item.languages,
  };
}

/** Personalised feed for a user (content + collaborative + popularity). */
export async function getRecommendationFeed(userId: string, options: { limit?: number; now?: Date } = {}): Promise<RecommendationFeed> {
  const catalog = await loadCatalogItems();
  const deps: RecommenderDeps = {
    loadProfile: loadRecommendationProfile,
    loadCatalog: async () => catalog,
    loadPopularityEvidence,
    loadCollaborativeInteractions,
    loadLabelResolver,
  };
  const result = await recommendForUser(deps, { userId, limit: options.limit, now: options.now });
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return {
    algorithm: result.algorithm,
    generatedAt: result.generatedAt,
    limit: result.limit,
    pipeline: result.pipeline,
    context: result.context,
    items: result.items.flatMap((item) => {
      const project = byId.get(item.projectId);
      if (!project) return [];
      return [
        {
          rank: item.rank,
          preDiversificationRank: item.preDiversificationRank,
          score: item.score,
          breakdown: item.breakdown,
          weights: item.weights,
          sources: item.sources,
          explanation: item.explanation,
          saved: item.saved,
          collaborative: item.collaborative,
          novelty: item.novelty,
          exploration: item.exploration,
          diversification: item.diversification,
          project: toProjectSummary(project),
        },
      ];
    }),
  };
}

export interface SimilarProjectView {
  project: ProjectSummary;
  similarity: number;
}

/** Content-based "similar projects" for a detail page (profile-independent). */
export async function getSimilarProjects(projectId: string, limit?: number): Promise<SimilarProjectView[]> {
  const catalog = await loadCatalogItems();
  const target = catalog.find((item) => item.id === projectId);
  if (!target) return [];
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return similarProjects(target, catalog, { limit }).flatMap((match) => {
    const project = byId.get(match.projectId);
    return project ? [{ project: toProjectSummary(project), similarity: match.similarity }] : [];
  });
}

export interface ProjectRecommendationContext {
  score: number;
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  sources: CandidateSource[];
  explanation: Explanation;
  collaborative: CollaborativeItemDiagnostics | null;
  novelty: NoveltyBreakdown;
  explorationPreference: number;
  coldStart: boolean;
  excludedFromDiscovery: boolean;
}

/**
 * "Why would RabbitHole recommend this to me?" for a single project, computed
 * with the same signals, weights and explanation logic as the feed. Returns
 * null when the user has no profile signal at all.
 */
export async function getProjectRecommendationContext(userId: string, projectId: string, now: Date = new Date()): Promise<ProjectRecommendationContext | null> {
  const [profile, catalog, popularityEvidence, interactions, labelFor] = await Promise.all([
    loadRecommendationProfile(userId, now),
    loadCatalogItems(),
    loadPopularityEvidence(),
    loadCollaborativeInteractions(),
    loadLabelResolver(),
  ]);
  const project = catalog.find((item) => item.id === projectId);
  if (!project) return null;
  const effective = blendProfiles(profile.longTerm, profile.session);
  const profileEmpty = Object.keys(effective.vector).length === 0;
  if (profileEmpty) return null;
  const projectById = new Map(catalog.map((item) => [item.id, item]));

  const coldStart = profile.longTerm.interactionCount < RECOMMENDER_CONFIG.coldStart.maxInteractions;
  const popularity = computePopularityScores(catalog, popularityEvidence).get(project.id);
  const contentAffinity = cosineSimilarity(effective.vector, project.vector);

  // Collaborative evidence for this project from the same model the feed uses.
  const model = buildCollaborativeModel(interactions, { excludeUserId: userId });
  const seeds = collaborativeSeedsForUser(interactions, userId);
  const scoring = scoreCollaborativeCandidates(model, seeds, { excludedProjectIds: profile.excludedProjectIds });
  const evidence = scoring.scores.get(project.id) ?? null;
  const collaborativeAvailable = seeds.length > 0 && scoring.scores.size > 0;
  const seedViews = describeSupportingSeeds(scoring, project.id, projectById);

  const novelty = computeNovelty({ popularityScore: popularity?.score ?? 0, contentAffinity });
  const sources: CandidateSource[] = evidence ? ["content", "collaborative"] : ["content"];
  const explorationPreference = profile.explorationPreference;
  const weights = resolveRankingWeights(resolveAvailableComponents({ profileEmpty, collaborativeAvailable }), { coldStart, explorationPreference });
  const [ranked] = rankCandidates(
    [
      {
        projectId: project.id,
        slug: project.slug,
        popularityPrior: project.popularity,
        sources,
        signals: {
          content: contentAffinity,
          ...(evidence ? { collaborative: evidence.score } : {}),
          novelty: novelty.novelty,
          popularity: popularity?.score ?? 0,
        },
        saved: profile.savedProjectIds.has(project.id),
      },
    ],
    { weights },
  );
  if (!ranked) return null;
  const explanation = explainRecommendation({
    project,
    longTerm: profile.longTerm,
    session: profile.session.norm > 0 ? profile.session : null,
    contentAffinity,
    sessionAffinity: profile.session.norm > 0 ? cosineSimilarity(profile.session.vector, project.vector) : null,
    popularityScore: popularity?.score ?? 0,
    sources,
    coldStart: profile.longTerm.interactionCount === 0,
    labelFor,
    collaborativeScore: evidence?.score ?? null,
    collaborativeSeeds: seedViews.map((s) => ({ projectId: s.projectId, title: s.title, state: s.state, contribution: s.contribution })),
    weights,
    novelty,
    explorationPreference,
  });
  return {
    score: ranked.score,
    breakdown: ranked.breakdown,
    weights,
    sources,
    explanation,
    collaborative: evidence ? { score: evidence.score, rawEvidence: evidence.rawEvidence, confidence: scoring.confidence, seeds: seedViews } : null,
    novelty,
    explorationPreference,
    coldStart,
    excludedFromDiscovery: profile.excludedProjectIds.has(project.id),
  };
}
