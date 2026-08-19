/**
 * Popularity scoring and retrieval.
 *
 *   behavioralRaw[p]   = Σ interactionWeight(type) over positive interactions on p (all users)
 *   behavioral[p]      = log1p(behavioralRaw[p]) / max_q log1p(behavioralRaw[q])      ∈ [0, 1]
 *   popularity[p]      = priorWeight * seedPrior[p] + behaviorWeight * behavioral[p]  ∈ [0, 1]
 *
 * The seed prior keeps cold catalogs sensible; the log-scaled behavioural term
 * lets real (or synthetic) engagement move projects without a handful of
 * heavy users producing absurd unnormalised scores. Only positive interaction
 * types count as evidence; DISLIKE/UNSAVE are not "popularity".
 *
 * Retrieval returns the top `limit` projects by popularity (ties: slug asc),
 * excluding terminal-state projects. It primarily serves cold start, sparse
 * profiles and fallback coverage.
 */

import type { InteractionType } from "@/generated/prisma/enums";
import { POSITIVE_INTERACTION_TYPES, RECOMMENDER_CONFIG, interactionWeight } from "./config";
import type { RetrievedCandidate } from "./types";

export interface PopularityScore {
  projectId: string;
  /** Final blended score in [0, 1]. */
  score: number;
  /** Seed/catalog prior in [0, 1]. */
  prior: number;
  /** Log-normalised behavioural evidence in [0, 1]. */
  behavioral: number;
  /** Raw Σ positive interaction weights. */
  positiveWeightSum: number;
}

export interface PopularityRetrievalOptions {
  limit?: number;
  excludedProjectIds?: ReadonlySet<string>;
}

const POSITIVE = new Set<InteractionType>(POSITIVE_INTERACTION_TYPES);

/** Turns (projectId, type, count) aggregates into Σ positive weights per project. */
export function positiveEvidenceFromCounts(
  counts: readonly { projectId: string; type: InteractionType; count: number }[],
): Map<string, number> {
  const evidence = new Map<string, number>();
  for (const row of counts) {
    if (!POSITIVE.has(row.type)) continue;
    const weight = interactionWeight(row.type);
    if (weight <= 0 || !Number.isFinite(row.count) || row.count <= 0) continue;
    evidence.set(row.projectId, (evidence.get(row.projectId) ?? 0) + weight * row.count);
  }
  return evidence;
}

export function computePopularityScores(
  projects: readonly { id: string; popularity: number }[],
  evidence: ReadonlyMap<string, number>,
  config = RECOMMENDER_CONFIG.popularity,
): Map<string, PopularityScore> {
  let maxLog = 0;
  for (const project of projects) {
    const raw = evidence.get(project.id) ?? 0;
    if (raw > 0) maxLog = Math.max(maxLog, Math.log1p(raw));
  }
  const scores = new Map<string, PopularityScore>();
  for (const project of projects) {
    const raw = Math.max(0, evidence.get(project.id) ?? 0);
    const behavioral = maxLog > 0 ? Math.log1p(raw) / maxLog : 0;
    const prior = Math.max(0, Math.min(1, Number.isFinite(project.popularity) ? project.popularity : 0));
    const score = Math.max(0, Math.min(1, config.priorWeight * prior + config.behaviorWeight * behavioral));
    scores.set(project.id, { projectId: project.id, score, prior, behavioral, positiveWeightSum: raw });
  }
  return scores;
}

export function retrievePopularityCandidates(
  scores: ReadonlyMap<string, PopularityScore>,
  projects: readonly { id: string; slug: string }[],
  options: PopularityRetrievalOptions = {},
): RetrievedCandidate[] {
  const limit = options.limit ?? RECOMMENDER_CONFIG.candidateCounts.popular;
  const excluded = options.excludedProjectIds ?? new Set<string>();
  if (limit <= 0) return [];
  const eligible = projects
    .filter((p) => !excluded.has(p.id) && scores.has(p.id))
    .map((p) => ({ projectId: p.id, slug: p.slug, score: scores.get(p.id)!.score }));
  eligible.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return eligible.slice(0, limit).map((e) => ({ projectId: e.projectId, source: "popular", signal: e.score }));
}
