/**
 * "Similar projects": project-to-project content similarity.
 *
 * Answers "what resembles this project?" using only catalog features (cosine
 * between project feature vectors) — the user's profile is deliberately not
 * involved. The target itself is excluded; ties break by catalog popularity
 * prior (desc) then slug (asc).
 */

import { RECOMMENDER_CONFIG } from "./config";
import { cosineSimilarity } from "./similarity";
import type { ProjectVector } from "./types";

export interface SimilarProject {
  projectId: string;
  similarity: number;
}

export function similarProjects(
  target: ProjectVector,
  projects: readonly ProjectVector[],
  options: { limit?: number; minSimilarity?: number } = {},
): SimilarProject[] {
  const limit = options.limit ?? RECOMMENDER_CONFIG.similarProjects.count;
  const minSimilarity = options.minSimilarity ?? 0;
  const scored: { project: ProjectVector; similarity: number }[] = [];
  for (const project of projects) {
    if (project.id === target.id) continue;
    const similarity = cosineSimilarity(target.vector, project.vector);
    if (similarity > minSimilarity) scored.push({ project, similarity });
  }
  scored.sort(
    (a, b) => b.similarity - a.similarity || b.project.popularity - a.project.popularity || a.project.slug.localeCompare(b.project.slug),
  );
  return scored.slice(0, Math.max(0, limit)).map(({ project, similarity }) => ({ projectId: project.id, similarity }));
}
