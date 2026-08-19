/**
 * Novelty: a transparent ranking feature in [0, 1] computed for every candidate.
 *
 *   underexposure = clamp01(1 − popularityScore)
 *   x             = clamp01(contentAffinity)          (negative affinity → 0, unknown → 0)
 *   adjacency     = 4 · x · (1 − x)                  (peaks at x = 0.5: related but different)
 *   novelty       = 0.65 · underexposure + 0.35 · adjacency   (weights in RECOMMENDER_CONFIG.novelty)
 *
 * Underexposure favours projects RabbitHole users have not engaged with much;
 * adjacency favours projects that are plausibly related to the profile without
 * being what the user already knows. Disliked features never become novelty:
 * negative content affinity contributes 0 adjacency, and the terminal-state
 * exclusions apply before novelty is ever consulted.
 */

import { RECOMMENDER_CONFIG } from "./config";

export interface NoveltyBreakdown {
  novelty: number;
  underexposure: number;
  adjacency: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Adjacency term: 4·x·(1−x) over the clamped, non-negative content affinity. */
export function adjacencyNovelty(contentAffinity: number | null): number {
  if (contentAffinity === null) return 0;
  const x = clamp01(contentAffinity);
  return clamp01(4 * x * (1 - x));
}

export function computeNovelty(
  input: { popularityScore: number; contentAffinity: number | null },
  config = RECOMMENDER_CONFIG.novelty,
): NoveltyBreakdown {
  const underexposure = clamp01(1 - clamp01(input.popularityScore));
  const adjacency = adjacencyNovelty(input.contentAffinity);
  const novelty = clamp01(config.underexposureWeight * underexposure + config.adjacencyWeight * adjacency);
  return { novelty, underexposure, adjacency };
}
