/**
 * Pure snapshot mapping for recommendation-run diagnostics (no Prisma here).
 *
 * A user-facing feed generation is persisted as one RecommendationRun plus its
 * final RecommendationResults. `buildRunSnapshot` maps the orchestrator output
 * onto that shape *without recomputing anything* — the stored values are the
 * values the user actually received, deep-copied and JSON-sanitised so the
 * snapshot is immutable diagnostic history (inspecting an old run never reruns
 * the recommender against today's profile).
 *
 * Snapshot JSON rules: `null` is preserved (Phase 4–6 use it for "signal
 * unavailable", which is distinct from a real 0), non-finite numbers become
 * null, `undefined` keys are dropped. Snapshots carry a `version` so future
 * algorithm revisions can evolve the shape; parsers degrade gracefully when a
 * stored run lacks Phase 7 fields.
 */

import type { Explanation } from "@/lib/recommender/explain";
import type { ExplorationDiagnostics } from "@/lib/recommender/exploration";
import type { NoveltyBreakdown } from "@/lib/recommender/novelty";
import type {
  CollaborativeItemDiagnostics,
  DiversificationItemDiagnostics,
  RecommendationContext,
  RecommendationResult,
} from "@/lib/recommender/recommend";
import type { SessionAffinity } from "@/lib/recommender/session";
import {
  CANDIDATE_SOURCES,
  SCORE_COMPONENTS,
  type CandidateSource,
  type PipelineStats,
  type RankingWeights,
  type ScoreBreakdown,
  type ScoreComponent,
} from "@/lib/recommender/types";

export const RUN_SNAPSHOT_VERSION = 1;

/** Immutable run-level snapshot stored in RecommendationRun.diagnostics. */
export interface RunDiagnosticsSnapshot {
  version: number;
  /** Real stage counts of this generation (all ten Phase 5 stats). */
  pipeline: PipelineStats;
  /** Full recommender context: session, exploration, diversification, collaborative, components, cold start. */
  context: RecommendationContext;
  limit: number;
  generatedAt: string;
}

/** Immutable per-result snapshot stored in RecommendationResult.diagnostics. */
export interface ResultDiagnosticsSnapshot {
  version: number;
  /** The exact explanation object returned to the user (text, primary factor, factors). */
  explanation: Explanation;
  collaborative: CollaborativeItemDiagnostics | null;
  session: SessionAffinity | null;
  novelty: NoveltyBreakdown;
  exploration: ExplorationDiagnostics | null;
  diversification: DiversificationItemDiagnostics;
  saved: boolean;
}

export interface ResultSnapshot {
  projectId: string;
  rank: number;
  preDiversificationRank: number;
  finalScore: number;
  /** Component scores; null = signal unavailable for this candidate (never coerced to 0). */
  contentScore: number | null;
  collaborativeScore: number | null;
  sessionScore: number | null;
  noveltyScore: number;
  popularityScore: number;
  candidateSources: CandidateSource[];
  rawSignals: Record<string, number>;
  /** Explanation text (denormalised column); the full object lives in diagnostics. */
  explanation: string;
  diagnostics: ResultDiagnosticsSnapshot;
}

export interface RunSnapshot {
  run: {
    userId: string;
    sessionId: string | null;
    algorithm: string;
    explorationPreference: number;
    requestedLimit: number;
    contentCandidateCount: number;
    collaborativeCandidateCount: number;
    popularCandidateCount: number;
    explorationCandidateCount: number;
    uniqueCandidateCount: number;
    filteredCandidateCount: number;
    rankedCandidateCount: number;
    finalCount: number;
    /** Effective (renormalised) ranking weights of this run — identical for every result. */
    rankingWeights: Partial<RankingWeights>;
    diagnostics: RunDiagnosticsSnapshot;
  };
  results: ResultSnapshot[];
}

/**
 * Deep-copies a value into JSON-safe form: non-finite numbers become null,
 * `undefined` object entries are dropped (null in arrays), Dates become ISO
 * strings, functions/symbols are dropped. `null` is preserved untouched.
 */
export function sanitizeJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? value : null;
    case "string":
    case "boolean":
      return value;
    case "bigint":
      return Number(value);
    case "object": {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map((entry) => sanitizeJsonValue(entry) ?? null);
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const sanitized = sanitizeJsonValue(entry);
        if (sanitized !== undefined) out[key] = sanitized;
      }
      return out;
    }
    default:
      return undefined; // functions / symbols never belong in a snapshot
  }
}

/** Typed convenience wrapper: sanitised deep copy of a snapshot-shaped value. */
export function sanitizeSnapshot<T>(value: T): T {
  return sanitizeJsonValue(value) as T;
}

/**
 * Maps one orchestrator result onto the persistable run + result snapshots.
 * Pure and side-effect free; every stored number/label comes verbatim from the
 * generated recommendations.
 */
export function buildRunSnapshot(userId: string, result: RecommendationResult): RunSnapshot {
  const { pipeline, context } = result;
  const weights = result.items[0]?.weights ?? {};
  return {
    run: {
      userId,
      sessionId: context.session.sessionId,
      algorithm: result.algorithm,
      explorationPreference: context.exploration.preference,
      requestedLimit: result.limit,
      contentCandidateCount: pipeline.contentCandidates,
      collaborativeCandidateCount: pipeline.collaborativeCandidates,
      popularCandidateCount: pipeline.popularCandidates,
      explorationCandidateCount: pipeline.explorationCandidates,
      uniqueCandidateCount: pipeline.uniqueCandidates,
      filteredCandidateCount: pipeline.afterFiltering,
      rankedCandidateCount: pipeline.ranked,
      finalCount: pipeline.final,
      rankingWeights: sanitizeSnapshot(weights),
      diagnostics: sanitizeSnapshot<RunDiagnosticsSnapshot>({
        version: RUN_SNAPSHOT_VERSION,
        pipeline,
        context,
        limit: result.limit,
        generatedAt: result.generatedAt,
      }),
    },
    results: result.items.map((item) => ({
      projectId: item.projectId,
      rank: item.rank,
      preDiversificationRank: item.preDiversificationRank,
      finalScore: item.score,
      contentScore: item.breakdown.content,
      collaborativeScore: item.breakdown.collaborative,
      sessionScore: item.breakdown.session,
      noveltyScore: item.breakdown.novelty ?? item.novelty.novelty,
      popularityScore: item.breakdown.popularity ?? 0,
      candidateSources: [...item.sources],
      rawSignals: sanitizeSnapshot(item.rawSignals),
      explanation: item.explanation.text,
      diagnostics: sanitizeSnapshot<ResultDiagnosticsSnapshot>({
        version: RUN_SNAPSHOT_VERSION,
        explanation: item.explanation,
        collaborative: item.collaborative,
        session: item.session,
        novelty: item.novelty,
        exploration: item.exploration,
        diversification: item.diversification,
        saved: item.saved,
      }),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a stored run snapshot; returns null (never throws) when the row predates Phase 7 or is malformed. */
export function parseRunDiagnostics(value: unknown): RunDiagnosticsSnapshot | null {
  if (!isRecord(value) || !isRecord(value.pipeline) || !isRecord(value.context)) return null;
  return value as unknown as RunDiagnosticsSnapshot;
}

/** Reads a stored per-result snapshot; returns null when absent/malformed. */
export function parseResultDiagnostics(value: unknown): ResultDiagnosticsSnapshot | null {
  if (!isRecord(value) || !isRecord(value.explanation) || typeof (value.explanation as Record<string, unknown>).text !== "string") {
    return null;
  }
  return value as unknown as ResultDiagnosticsSnapshot;
}

/** Stored Json to effective ranking weights (only finite numbers on known components). */
export function parseRankingWeights(value: unknown): Partial<RankingWeights> {
  if (!isRecord(value)) return {};
  const weights: Partial<RankingWeights> = {};
  for (const component of SCORE_COMPONENTS) {
    const weight = value[component];
    if (typeof weight === "number" && Number.isFinite(weight)) weights[component] = weight;
  }
  return weights;
}

/** Stored Json to raw retrieval/diagnostic signals (finite numbers only). */
export function parseRawSignals(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const signals: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) signals[key] = entry;
  }
  return signals;
}

/** Stored String[] to known candidate sources, original order, no invented badges. */
export function parseCandidateSources(values: readonly string[]): CandidateSource[] {
  return values.filter((value): value is CandidateSource => (CANDIDATE_SOURCES as readonly string[]).includes(value));
}

/**
 * contribution[c] = componentScore[c] x effectiveWeight[c].
 * Unavailable components (null score, or no weight in force) yield null — a
 * missing signal must never look like a real zero contribution; it simply did
 * not participate in the ranking.
 */
export function componentContributions(
  breakdown: ScoreBreakdown,
  weights: Partial<RankingWeights>,
): Record<ScoreComponent, number | null> {
  const contributions = {} as Record<ScoreComponent, number | null>;
  for (const component of SCORE_COMPONENTS) {
    const score = breakdown[component];
    const weight = weights[component];
    contributions[component] =
      score === null || score === undefined || weight === undefined || !Number.isFinite(score) || !Number.isFinite(weight)
        ? null
        : score * weight;
  }
  return contributions;
}
