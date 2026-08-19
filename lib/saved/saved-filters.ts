/**
 * Pure filtering / sorting for the saved-projects page.
 *
 * Saved-state interpretation: a project is "saved" when its latest
 * SAVE/UNSAVE/DISLIKE event is SAVE (see lib/interactions/project-state.ts).
 * BUILD and COMPLETE do not un-save a project; they are surfaced as status
 * badges so the queue stays truthful about what you are building.
 */

import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import type { ProjectSummary } from "@/lib/catalog/queries";
import { DIFFICULTY_ORDER } from "@/lib/format";
import { durationBucketForHours } from "@/lib/recommender/features";

export const SAVED_SORTS = ["recent", "match", "shortest", "difficulty"] as const;
export type SavedSort = (typeof SAVED_SORTS)[number];

export interface SavedProjectItem {
  project: ProjectSummary;
  savedAt: Date;
  /** Cosine match with the user's effective profile (0 when the profile is empty). */
  matchScore: number;
  built: boolean;
  completed: boolean;
}

export interface SavedFilters {
  tag?: string;
  language?: string;
  difficulty?: Difficulty;
  duration?: Exclude<DurationPreference, "ANYTHING">;
  sort?: SavedSort;
}

export function applySavedFilters(items: readonly SavedProjectItem[], filters: SavedFilters): SavedProjectItem[] {
  return items.filter((item) => {
    if (filters.tag && !item.project.tags.some((t) => t.slug === filters.tag)) return false;
    if (filters.language && !item.project.languages.some((l) => l.slug === filters.language)) return false;
    if (filters.difficulty && item.project.difficulty !== filters.difficulty) return false;
    if (filters.duration && durationBucketForHours(item.project.estimatedHours) !== filters.duration) return false;
    return true;
  });
}

/** Deterministic ordering; every sort falls back to most-recently-saved then slug. */
export function sortSavedProjects(items: readonly SavedProjectItem[], sort: SavedSort = "recent"): SavedProjectItem[] {
  const recency = (a: SavedProjectItem, b: SavedProjectItem) =>
    b.savedAt.getTime() - a.savedAt.getTime() || a.project.slug.localeCompare(b.project.slug);
  const sorted = [...items];
  switch (sort) {
    case "match":
      sorted.sort((a, b) => b.matchScore - a.matchScore || recency(a, b));
      break;
    case "shortest":
      sorted.sort((a, b) => a.project.estimatedHours - b.project.estimatedHours || recency(a, b));
      break;
    case "difficulty":
      sorted.sort((a, b) => DIFFICULTY_ORDER[a.project.difficulty] - DIFFICULTY_ORDER[b.project.difficulty] || recency(a, b));
      break;
    case "recent":
    default:
      sorted.sort(recency);
  }
  return sorted;
}

export function isSavedSort(value: string | undefined): value is SavedSort {
  return value !== undefined && (SAVED_SORTS as readonly string[]).includes(value);
}
