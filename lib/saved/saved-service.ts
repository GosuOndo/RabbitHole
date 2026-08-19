import type { ProjectSummary } from "@/lib/catalog/queries";
import { loadUserProfileData } from "@/lib/profile/profile-service";
import { loadCatalogItems, loadPopularityEvidence } from "@/lib/recommendations/loaders";
import { toProjectSummary } from "@/lib/recommendations/recommendation-service";
import { computeNovelty } from "@/lib/recommender/novelty";
import { computePopularityScores } from "@/lib/recommender/popularity";
import { blendProfiles } from "@/lib/recommender/session";
import { cosineSimilarity } from "@/lib/recommender/similarity";
import { applySavedFilters, sortSavedProjects, type SavedFilters, type SavedProjectItem } from "./saved-filters";

export interface SavedProjectsPage {
  /** Items after filters and sorting. */
  items: SavedProjectItem[];
  /** Number of saved projects before filtering. */
  total: number;
  /** Facets available among all saved projects (for filter controls). */
  facets: {
    tags: { slug: string; name: string }[];
    languages: { slug: string; name: string }[];
  };
  /** Whether the user has any profile signal (match sorting is meaningful). */
  hasProfile: boolean;
}

/** Saved projects for a user with live content-match and novelty scores, filters and sorting. */
export async function getSavedProjects(userId: string, filters: SavedFilters = {}, now: Date = new Date()): Promise<SavedProjectsPage> {
  const [data, catalog, popularityEvidence] = await Promise.all([loadUserProfileData(userId, now), loadCatalogItems(), loadPopularityEvidence()]);
  const effective = blendProfiles(data.longTerm, data.session);
  const hasProfile = Object.keys(effective.vector).length > 0;
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const popularity = computePopularityScores(catalog, popularityEvidence);

  const items: SavedProjectItem[] = [];
  for (const state of data.states.values()) {
    if (!state.saved || !state.savedAt) continue;
    const item = byId.get(state.projectId);
    if (!item) continue;
    const matchScore = hasProfile ? cosineSimilarity(effective.vector, item.vector) : 0;
    items.push({
      project: toProjectSummary(item),
      savedAt: state.savedAt,
      matchScore,
      noveltyScore: computeNovelty({ popularityScore: popularity.get(item.id)?.score ?? 0, contentAffinity: hasProfile ? matchScore : null }).novelty,
      built: state.built,
      completed: state.completed,
    });
  }

  const tagFacet = new Map<string, string>();
  const languageFacet = new Map<string, string>();
  for (const item of items) {
    for (const tag of item.project.tags) tagFacet.set(tag.slug, tag.name);
    for (const language of item.project.languages) languageFacet.set(language.slug, language.name);
  }
  const facet = (map: Map<string, string>) =>
    [...map.entries()].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    items: sortSavedProjects(applySavedFilters(items, filters), filters.sort),
    total: items.length,
    facets: { tags: facet(tagFacet), languages: facet(languageFacet) },
    hasProfile,
  };
}

export type { SavedFilters, SavedProjectItem, ProjectSummary };
