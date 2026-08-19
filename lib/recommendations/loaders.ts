/**
 * Prisma-backed data loaders for the recommender. Everything the pipeline
 * needs is fetched in a handful of batched queries (no per-project round trips).
 */

import type { ProjectSummary } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db";
import { labelForFeature, loadLabelMaps, loadUserProfileData } from "@/lib/profile/profile-service";
import { POSITIVE_INTERACTION_TYPES } from "@/lib/recommender/config";
import { projectFeatureVector } from "@/lib/recommender/features";
import { positiveEvidenceFromCounts } from "@/lib/recommender/popularity";
import type { LabelResolver, RecommendationProfileInput, RecommenderDeps } from "@/lib/recommender/recommend";
import type { CollaborativeInteraction, ProjectVector } from "@/lib/recommender/types";

/** A catalog project with card data *and* its recommender feature vector. */
export interface CatalogItem extends ProjectSummary, ProjectVector {}

const catalogInclude = {
  tags: { include: { tag: { select: { slug: true, name: true } } } },
  languages: { include: { language: { select: { slug: true, name: true } } } },
} as const;

/** The whole catalog (≈160 projects) with feature vectors, in one query. */
export async function loadCatalogItems(): Promise<CatalogItem[]> {
  const rows = await prisma.project.findMany({ include: catalogInclude, orderBy: { slug: "asc" } });
  return rows.map((row) => {
    const tagSlugs = row.tags.map((t) => t.tag.slug);
    const languageSlugs = row.languages.map((l) => l.language.slug);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      difficulty: row.difficulty,
      estimatedHours: row.estimatedHours,
      popularity: row.popularity,
      tags: row.tags.map((t) => t.tag),
      languages: row.languages.map((l) => l.language),
      tagSlugs,
      languageSlugs,
      vector: projectFeatureVector({ tagSlugs, languageSlugs, difficulty: row.difficulty, estimatedHours: row.estimatedHours }),
    };
  });
}

/** Σ positive interaction weights per project across all users (one grouped query). */
export async function loadPopularityEvidence(): Promise<Map<string, number>> {
  const rows = await prisma.interaction.groupBy({
    by: ["projectId", "type"],
    where: { type: { in: [...POSITIVE_INTERACTION_TYPES] } },
    _count: { _all: true },
  });
  return positiveEvidenceFromCounts(rows.map((row) => ({ projectId: row.projectId, type: row.type, count: row._count._all })));
}

/**
 * Every non-impression interaction across all users, oldest first — the input
 * for item-item collaborative filtering (≈ a few thousand rows, one query).
 * Impressions are excluded because they carry no positive collaborative evidence.
 */
export async function loadCollaborativeInteractions(): Promise<CollaborativeInteraction[]> {
  return prisma.interaction.findMany({
    where: { type: { not: "IMPRESSION" } },
    select: { userId: true, projectId: true, type: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function loadLabelResolver(): Promise<LabelResolver> {
  const labels = await loadLabelMaps();
  return (family, key) => labelForFeature(family, key, labels);
}

/** Maps Phase 2 profile data onto the recommender's profile input. */
export async function loadRecommendationProfile(userId: string, now: Date): Promise<RecommendationProfileInput> {
  const data = await loadUserProfileData(userId, now);
  const excludedProjectIds = new Set<string>();
  const savedProjectIds = new Set<string>();
  for (const state of data.states.values()) {
    if (state.excludedFromDiscovery) excludedProjectIds.add(state.projectId);
    if (state.saved) savedProjectIds.add(state.projectId);
  }
  return {
    longTerm: data.longTerm,
    session: data.session,
    excludedProjectIds,
    savedProjectIds,
    explorationPreference: data.user.explorationPreference,
  };
}

/** Default dependency wiring for the orchestrator. */
export const prismaRecommenderDeps: RecommenderDeps = {
  loadProfile: loadRecommendationProfile,
  loadCatalog: loadCatalogItems,
  loadPopularityEvidence,
  loadCollaborativeInteractions,
  loadLabelResolver,
};
