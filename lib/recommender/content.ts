/**
 * Content-based candidate retrieval.
 *
 * Input:  the user's effective (signed, L2-normalised) profile vector and the
 *         catalog with project feature vectors.
 * Output: up to `limit` candidates whose cosine affinity with the profile is at
 *         least `minAffinity`, ordered by affinity (desc), then catalog
 *         popularity prior (desc), then slug (asc) for determinism.
 *
 * This is retrieval, not final ranking: the ranker combines the affinity with
 * other signals later. Projects in terminal states are excluded here so they
 * never become candidates; the caller supplies that set.
 */

import { RECOMMENDER_CONFIG } from "./config";
import { cosineSimilarity } from "./similarity";
import type { FeatureVector, ProjectVector, RetrievedCandidate } from "./types";

export interface ContentRetrievalOptions {
  limit?: number;
  excludedProjectIds?: ReadonlySet<string>;
  minAffinity?: number;
}

/** Cosine affinity of every project with the profile vector (0 for an empty profile). */
export function scoreContentAffinity(profileVector: FeatureVector, projects: readonly ProjectVector[]): Map<string, number> {
  const scores = new Map<string, number>();
  const empty = Object.keys(profileVector).length === 0;
  for (const project of projects) {
    scores.set(project.id, empty ? 0 : cosineSimilarity(profileVector, project.vector));
  }
  return scores;
}

export function retrieveContentCandidates(
  profileVector: FeatureVector,
  projects: readonly ProjectVector[],
  options: ContentRetrievalOptions = {},
): RetrievedCandidate[] {
  const limit = options.limit ?? RECOMMENDER_CONFIG.candidateCounts.content;
  const minAffinity = options.minAffinity ?? RECOMMENDER_CONFIG.retrieval.minContentAffinity;
  const excluded = options.excludedProjectIds ?? new Set<string>();
  if (Object.keys(profileVector).length === 0 || limit <= 0) return [];

  const scored: { project: ProjectVector; affinity: number }[] = [];
  for (const project of projects) {
    if (excluded.has(project.id)) continue;
    const affinity = cosineSimilarity(profileVector, project.vector);
    if (affinity >= minAffinity) scored.push({ project, affinity });
  }
  scored.sort(
    (a, b) => b.affinity - a.affinity || b.project.popularity - a.project.popularity || a.project.slug.localeCompare(b.project.slug),
  );
  return scored.slice(0, limit).map(({ project, affinity }) => ({ projectId: project.id, source: "content", signal: affinity }));
}
