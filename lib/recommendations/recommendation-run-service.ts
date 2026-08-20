/**
 * Recommendation-run persistence (the only place run diagnostics touch Prisma).
 *
 *   pure pipeline → RecommendationResult → buildRunSnapshot → this recorder → Prisma
 *
 * Only genuine user-facing feed generations are recorded (the feed service
 * calls `recordRecommendationRun`); unit tests, /saved match scores, similar
 * projects and the project-detail context never write diagnostics. Reading is
 * strictly read-only and always scoped to the owning user. After each recorded
 * run, runs beyond `diagnostics.maxRunsPerUser` are pruned (oldest first, this
 * user only); results are removed via the schema's cascade.
 */

import { prisma } from "@/lib/db";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import type { RecommendationContext, RecommendationResult } from "@/lib/recommender/recommend";
import type { CandidateSource, PipelineStats, RankingWeights, ScoreBreakdown, ScoreComponent } from "@/lib/recommender/types";
import type { Explanation } from "@/lib/recommender/explain";
import {
  buildRunSnapshot,
  componentContributions,
  parseCandidateSources,
  parseRankingWeights,
  parseRawSignals,
  parseResultDiagnostics,
  parseRunDiagnostics,
  type ResultDiagnosticsSnapshot,
} from "./run-snapshot";

type JsonInput = object;

export interface RecordedRun {
  id: string;
}

/**
 * Persists one feed generation (run + its final results, transactionally) and
 * prunes this user's history beyond the retention limit. Returns null when
 * persistence is disabled. Never called for internal recommender computations.
 */
export async function recordRecommendationRun(
  userId: string,
  result: RecommendationResult,
  config: typeof RECOMMENDER_CONFIG.diagnostics = RECOMMENDER_CONFIG.diagnostics,
): Promise<RecordedRun | null> {
  if (!config.persistRuns) return null;
  const snapshot = buildRunSnapshot(userId, result);
  const id = await prisma.$transaction(async (tx) => {
    const run = await tx.recommendationRun.create({
      data: {
        ...snapshot.run,
        rankingWeights: snapshot.run.rankingWeights as JsonInput,
        diagnostics: snapshot.run.diagnostics as unknown as JsonInput,
      },
      select: { id: true },
    });
    if (snapshot.results.length > 0) {
      await tx.recommendationResult.createMany({
        data: snapshot.results.map((entry) => ({
          ...entry,
          runId: run.id,
          rawSignals: entry.rawSignals as JsonInput,
          diagnostics: entry.diagnostics as unknown as JsonInput,
        })),
      });
    }
    // Retention: keep the newest maxRunsPerUser runs for this user only.
    const excess = await tx.recommendationRun.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: config.maxRunsPerUser,
      select: { id: true },
    });
    if (excess.length > 0) {
      await tx.recommendationRun.deleteMany({ where: { userId, id: { in: excess.map((row) => row.id) } } });
    }
    return run.id;
  });
  return { id };
}

export interface RecentRunSummary {
  id: string;
  createdAt: string;
  algorithm: string;
  sessionId: string | null;
  resultCount: number;
  explorationPreference: number;
  /** From the stored snapshot; null for runs without a Phase 7 snapshot. */
  explorationMode: string | null;
  sessionConfidence: number | null;
}

/** Newest-first run metadata for the recent-runs list (no result rows loaded). */
export async function listRecentRuns(userId: string, limit: number = RECOMMENDER_CONFIG.diagnostics.recentRuns): Promise<RecentRunSummary[]> {
  const rows = await prisma.recommendationRun.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { _count: { select: { results: true } } },
  });
  return rows.map((row) => {
    const diagnostics = parseRunDiagnostics(row.diagnostics);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      algorithm: row.algorithm,
      sessionId: row.sessionId,
      resultCount: row._count.results,
      explorationPreference: row.explorationPreference,
      explorationMode: diagnostics?.context.exploration.mode ?? null,
      sessionConfidence: diagnostics?.context.session?.confidence ?? null,
    };
  });
}

/** Total stored runs for the user (retention diagnostics). */
export function countStoredRuns(userId: string): Promise<number> {
  return prisma.recommendationRun.count({ where: { userId } });
}

export interface RunResultDetail {
  rank: number;
  preDiversificationRank: number | null;
  projectId: string;
  project: { id: string; slug: string; title: string };
  /** Final recommendation (match) score — never the MMR score. */
  score: number;
  /** Component scores as stored; null = signal was unavailable at generation time. */
  breakdown: ScoreBreakdown;
  /** contribution = score x effective weight; null when the component did not participate. */
  contributions: Record<ScoreComponent, number | null>;
  sources: CandidateSource[];
  /** Un-normalised retrieval/diagnostic signals recorded at generation time. */
  rawSignals: Record<string, number>;
  /** The historical explanation snapshot (never regenerated). */
  explanation: Pick<Explanation, "text" | "primary" | "factors"> | { text: string; primary: null; factors: [] };
  collaborative: ResultDiagnosticsSnapshot["collaborative"];
  session: ResultDiagnosticsSnapshot["session"];
  novelty: ResultDiagnosticsSnapshot["novelty"] | null;
  exploration: ResultDiagnosticsSnapshot["exploration"];
  diversification: ResultDiagnosticsSnapshot["diversification"] | null;
  saved: boolean | null;
}

export interface RunDetail {
  id: string;
  createdAt: string;
  algorithm: string;
  sessionId: string | null;
  requestedLimit: number;
  explorationPreference: number;
  /** Effective ranking weights of the run (identical for every result). */
  weights: Partial<RankingWeights>;
  /** Real stage counts recorded at generation time. */
  pipeline: PipelineStats;
  /** Full recommender context snapshot; null for runs without one. */
  context: RecommendationContext | null;
  results: RunResultDetail[];
}

/**
 * One stored run with its results and project labels, strictly scoped to the
 * owning user (`where: { id, userId }`) — another user's run id yields null.
 * Values come from the stored snapshot; nothing is recomputed.
 */
export async function getRunDetail(userId: string, runId: string): Promise<RunDetail | null> {
  const row = await prisma.recommendationRun.findFirst({
    where: { id: runId, userId },
    include: {
      results: {
        orderBy: { rank: "asc" },
        include: { project: { select: { id: true, slug: true, title: true } } },
      },
    },
  });
  if (!row) return null;
  const diagnostics = parseRunDiagnostics(row.diagnostics);
  const weights = parseRankingWeights(row.rankingWeights);
  const pipeline: PipelineStats = diagnostics?.pipeline ?? {
    contentCandidates: row.contentCandidateCount,
    collaborativeCandidates: row.collaborativeCandidateCount,
    popularCandidates: row.popularCandidateCount,
    explorationCandidates: row.explorationCandidateCount,
    uniqueCandidates: row.uniqueCandidateCount,
    afterFiltering: row.filteredCandidateCount,
    ranked: row.rankedCandidateCount,
    preDiversificationCandidates: row.rankedCandidateCount,
    diversifiedCandidates: row.finalCount,
    final: row.finalCount,
  };
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    algorithm: row.algorithm,
    sessionId: row.sessionId,
    requestedLimit: row.requestedLimit,
    explorationPreference: row.explorationPreference,
    weights,
    pipeline,
    context: diagnostics?.context ?? null,
    results: row.results.map((result) => {
      const detail = parseResultDiagnostics(result.diagnostics);
      const breakdown: ScoreBreakdown = {
        content: result.contentScore,
        collaborative: result.collaborativeScore,
        session: result.sessionScore,
        novelty: result.noveltyScore,
        popularity: result.popularityScore,
      };
      return {
        rank: result.rank,
        preDiversificationRank: result.preDiversificationRank,
        projectId: result.projectId,
        project: result.project,
        score: result.finalScore,
        breakdown,
        contributions: componentContributions(breakdown, weights),
        sources: parseCandidateSources(result.candidateSources),
        rawSignals: parseRawSignals(result.rawSignals),
        explanation: detail?.explanation ?? { text: result.explanation, primary: null, factors: [] },
        collaborative: detail?.collaborative ?? null,
        session: detail?.session ?? null,
        novelty: detail?.novelty ?? null,
        exploration: detail?.exploration ?? null,
        diversification: detail?.diversification ?? null,
        saved: detail?.saved ?? null,
      };
    }),
  };
}
