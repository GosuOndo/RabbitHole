/**
 * Candidate merging and filtering.
 *
 * Retrieval strategies each return `RetrievedCandidate`s (projectId, source,
 * raw signal). Merging collapses them to one `Candidate` per project while
 * keeping every contributing source and every raw signal, e.g.
 *
 *   { projectId: "redis", sources: ["content", "popular"], signals: { content: 0.71, popular: 0.9 } }
 *
 * Filtering removes candidates that must never be shown (terminal states such
 * as DISLIKE/BUILD/COMPLETE, or ids missing from the catalog) and reports what
 * it removed so pipeline diagnostics stay honest.
 */

import type { Candidate, CandidateSource, RetrievedCandidate } from "./types";

/** Merges retrieval outputs; first-seen order is preserved for determinism. */
export function mergeCandidateSets(sets: readonly (readonly RetrievedCandidate[])[]): Candidate[] {
  const byProject = new Map<string, Candidate>();
  for (const set of sets) {
    for (const retrieved of set) {
      if (!Number.isFinite(retrieved.signal)) continue;
      const existing = byProject.get(retrieved.projectId);
      if (existing) {
        if (!existing.sources.includes(retrieved.source)) existing.sources.push(retrieved.source);
        // Keep the strongest signal if the same source somehow reports twice.
        const previous = existing.signals[retrieved.source];
        existing.signals[retrieved.source] = previous === undefined ? retrieved.signal : Math.max(previous, retrieved.signal);
      } else {
        byProject.set(retrieved.projectId, {
          projectId: retrieved.projectId,
          sources: [retrieved.source],
          signals: { [retrieved.source]: retrieved.signal },
        });
      }
    }
  }
  return [...byProject.values()];
}

export type CandidateRemovalReason = "excluded_state" | "unknown_project";

export interface FilterCandidatesOptions {
  /** Projects in terminal states (DISLIKE / BUILD / COMPLETE by config). */
  excludedProjectIds?: ReadonlySet<string>;
  /** When provided, candidates outside this set are dropped. */
  knownProjectIds?: ReadonlySet<string>;
}

export interface FilterCandidatesResult {
  kept: Candidate[];
  removed: { projectId: string; reason: CandidateRemovalReason }[];
}

export function filterCandidates(candidates: readonly Candidate[], options: FilterCandidatesOptions = {}): FilterCandidatesResult {
  const kept: Candidate[] = [];
  const removed: FilterCandidatesResult["removed"] = [];
  for (const candidate of candidates) {
    if (options.knownProjectIds && !options.knownProjectIds.has(candidate.projectId)) {
      removed.push({ projectId: candidate.projectId, reason: "unknown_project" });
      continue;
    }
    if (options.excludedProjectIds?.has(candidate.projectId)) {
      removed.push({ projectId: candidate.projectId, reason: "excluded_state" });
      continue;
    }
    kept.push(candidate);
  }
  return { kept, removed };
}

/** Number of candidates retrieved by a given source (before merging). */
export function countBySource(sets: readonly (readonly RetrievedCandidate[])[], source: CandidateSource): number {
  let count = 0;
  for (const set of sets) for (const c of set) if (c.source === source) count += 1;
  return count;
}
