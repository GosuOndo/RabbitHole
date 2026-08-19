/**
 * Exploration candidate retrieval — the fourth candidate source.
 *
 * Exploration is *not* random. Every candidate must be plausible for the user:
 *
 *   plausibility = max(positive content affinity, collaborative score)     when either exists
 *                = popularity score                                        (conservative fallback for an empty profile)
 *   requires plausibility ≥ minPlausibility
 *
 * and is then scored by a blend that leans toward novelty as the user's
 * exploration preference `e` rises:
 *
 *   explorationScore = (1 − e) · plausibility + e · (noveltyWeight · novelty + plausibilityWeight · plausibility)
 *
 * so at e = 0 exploration ≈ plausibility (familiar) and at e = 1 it is
 * 0.65 · novelty + 0.35 · plausibility (adventurous but anchored in relevance).
 * Breadth also grows with e: limit = round(min + e · (max − min)) (8 → 15).
 * Terminal-state projects are excluded here as in every other retriever;
 * ordering is deterministic (score desc, popularity prior desc, slug asc).
 */

import { RECOMMENDER_CONFIG } from "./config";
import type { NoveltyBreakdown } from "./novelty";
import type { ProjectVector, RetrievedCandidate } from "./types";

export type PlausibilitySource = "content" | "collaborative" | "popularity";

export interface ExplorationDiagnostics {
  explorationScore: number;
  novelty: number;
  underexposure: number;
  adjacency: number;
  plausibility: number;
  plausibilitySource: PlausibilitySource;
}

export interface ExplorationRetrievalInput {
  projects: readonly ProjectVector[];
  /** Signed content affinity per project, or null when the profile is empty. */
  contentAffinity: ReadonlyMap<string, number> | null;
  /** Normalised collaborative score per project, or null when the user has no collaborative evidence. */
  collaborativeScores: ReadonlyMap<string, number> | null;
  /** Popularity score per project in [0, 1]. */
  popularityScores: ReadonlyMap<string, number>;
  /** Precomputed novelty per project. */
  novelty: ReadonlyMap<string, NoveltyBreakdown>;
  excludedProjectIds: ReadonlySet<string>;
  explorationPreference: number;
}

export interface ExplorationRetrievalResult {
  candidates: RetrievedCandidate[];
  diagnostics: Map<string, ExplorationDiagnostics>;
  limit: number;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Number of exploration candidates for a preference: round(min + e · (max − min)). */
export function explorationCandidateLimit(
  explorationPreference: number,
  config = RECOMMENDER_CONFIG.exploration.retrieval,
): number {
  const e = clamp01(explorationPreference);
  return Math.round(config.minCandidates + e * (config.maxCandidates - config.minCandidates));
}

/** Plausibility of a project for exploration and which signal supplied it. */
export function explorationPlausibility(input: {
  contentAffinity: number | null | undefined;
  collaborativeScore: number | null | undefined;
  popularityScore: number;
}): { plausibility: number; source: PlausibilitySource } {
  const content = input.contentAffinity === null || input.contentAffinity === undefined ? null : Math.max(0, clamp01(input.contentAffinity));
  const collaborative = input.collaborativeScore === null || input.collaborativeScore === undefined ? null : clamp01(input.collaborativeScore);
  if (content === null && collaborative === null) return { plausibility: clamp01(input.popularityScore), source: "popularity" };
  if ((collaborative ?? 0) > (content ?? 0)) return { plausibility: collaborative ?? 0, source: "collaborative" };
  return { plausibility: content ?? 0, source: "content" };
}

/** Exploration score blending plausibility toward novelty as the preference rises. */
export function explorationScore(
  plausibility: number,
  novelty: number,
  explorationPreference: number,
  config = RECOMMENDER_CONFIG.exploration.retrieval,
): number {
  const e = clamp01(explorationPreference);
  const adventurous = config.noveltyWeight * clamp01(novelty) + config.plausibilityWeight * clamp01(plausibility);
  return clamp01((1 - e) * clamp01(plausibility) + e * adventurous);
}

export function retrieveExplorationCandidates(
  input: ExplorationRetrievalInput,
  options: { limit?: number; minPlausibility?: number } = {},
): ExplorationRetrievalResult {
  const config = RECOMMENDER_CONFIG.exploration.retrieval;
  const limit = Math.max(0, options.limit ?? explorationCandidateLimit(input.explorationPreference));
  const minPlausibility = options.minPlausibility ?? config.minPlausibility;
  const diagnostics = new Map<string, ExplorationDiagnostics>();
  const scored: { project: ProjectVector; score: number }[] = [];

  for (const project of input.projects) {
    if (input.excludedProjectIds.has(project.id)) continue;
    const popularity = input.popularityScores.get(project.id) ?? 0;
    const { plausibility, source } = explorationPlausibility({
      contentAffinity: input.contentAffinity ? (input.contentAffinity.get(project.id) ?? 0) : null,
      collaborativeScore: input.collaborativeScores ? input.collaborativeScores.get(project.id) : null,
      popularityScore: popularity,
    });
    if (plausibility < minPlausibility) continue;
    const novelty = input.novelty.get(project.id) ?? { novelty: 0, underexposure: 0, adjacency: 0 };
    const score = explorationScore(plausibility, novelty.novelty, input.explorationPreference);
    diagnostics.set(project.id, {
      explorationScore: score,
      novelty: novelty.novelty,
      underexposure: novelty.underexposure,
      adjacency: novelty.adjacency,
      plausibility,
      plausibilitySource: source,
    });
    scored.push({ project, score });
  }

  scored.sort((a, b) => b.score - a.score || b.project.popularity - a.project.popularity || a.project.slug.localeCompare(b.project.slug));
  const selected = scored.slice(0, limit);
  const selectedIds = new Set(selected.map((s) => s.project.id));
  for (const id of [...diagnostics.keys()]) if (!selectedIds.has(id)) diagnostics.delete(id);
  return {
    candidates: selected.map(({ project, score }) => ({ projectId: project.id, source: "exploration", signal: score })),
    diagnostics,
    limit,
  };
}
