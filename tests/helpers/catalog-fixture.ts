import { getOnboardingTopic, topicFeatureVector } from "@/lib/onboarding/topics";
import { projectFeatureVector, type FeatureFamily } from "@/lib/recommender/features";
import { buildLongTermProfile, buildSessionProfile, type InterestProfile, type OnboardingSignals, type ProfileInteraction } from "@/lib/recommender/profile";
import type { LabelResolver, RecommendationProfileInput } from "@/lib/recommender/recommend";
import type { ProjectVector } from "@/lib/recommender/types";
import { LANGUAGES, PROJECTS, TAGS } from "@/prisma/seed-data/catalog";
import type { SeedProject } from "@/prisma/seed-data/types";

/** The seeded catalog as recommender project vectors (ids = slugs for readability). */
export function catalogFixture(): ProjectVector[] {
  return PROJECTS.map((p) => toProjectVector(p));
}

export function toProjectVector(p: SeedProject): ProjectVector {
  return {
    id: p.slug,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    difficulty: p.difficulty,
    estimatedHours: p.estimatedHours,
    popularity: p.popularity,
    tagSlugs: p.tags,
    languageSlugs: p.languages,
    vector: projectFeatureVector({ tagSlugs: p.tags, languageSlugs: p.languages, difficulty: p.difficulty, estimatedHours: p.estimatedHours }),
  };
}

export function projectBySlug(slug: string): ProjectVector {
  const project = PROJECTS.find((p) => p.slug === slug);
  if (!project) throw new Error(`fixture: unknown project ${slug}`);
  return toProjectVector(project);
}

const tagNames = new Map(TAGS.map((t) => [t.slug, t.name]));
const languageNames = new Map(LANGUAGES.map((l) => [l.slug, l.name]));

export const fixtureLabelFor: LabelResolver = (family: FeatureFamily, key: string) => {
  if (family === "tag") return tagNames.get(key) ?? key;
  if (family === "language") return languageNames.get(key) ?? key;
  if (family === "difficulty") return key.charAt(0) + key.slice(1).toLowerCase();
  return key;
};

export const NOW = new Date("2026-08-18T12:00:00.000Z");

/** Onboarding-only long-term profile from topic keys (+ optional preferences). */
export function onboardingProfile(
  topicKeys: string[],
  options: { difficulty?: OnboardingSignals["difficultyPreference"]; duration?: OnboardingSignals["durationPreference"]; chosen?: string[]; rejected?: string[] } = {},
): InterestProfile {
  const onboarding: OnboardingSignals = {
    topicFeatures: topicKeys.map((key) => topicFeatureVector(getOnboardingTopic(key)!)),
    chosenProjectFeatures: (options.chosen ?? []).map((slug) => projectBySlug(slug).vector),
    rejectedProjectFeatures: (options.rejected ?? []).map((slug) => projectBySlug(slug).vector),
    difficultyPreference: options.difficulty ?? null,
    durationPreference: options.duration ?? "ANYTHING",
  };
  return buildLongTermProfile({ interactions: [], onboarding, now: NOW });
}

/** Behavioural interactions on catalog projects (by slug), all at NOW unless offset. */
export function interactionsOn(entries: { slug: string; type: ProfileInteraction["type"]; daysAgo?: number; sessionId?: string }[]): ProfileInteraction[] {
  return entries.map((e) => ({
    type: e.type,
    createdAt: new Date(NOW.getTime() - (e.daysAgo ?? 0) * 86_400_000),
    sessionId: e.sessionId ?? "s1",
    features: projectBySlug(e.slug).vector,
  }));
}

export function behaviourProfile(interactions: ProfileInteraction[], onboarding: OnboardingSignals | null = null): InterestProfile {
  return buildLongTermProfile({ interactions, onboarding, now: NOW });
}

export const emptySession = buildSessionProfile({ interactions: [], now: NOW });

export function profileInput(longTerm: InterestProfile, extra: Partial<RecommendationProfileInput> = {}): RecommendationProfileInput {
  return {
    longTerm,
    session: extra.session ?? emptySession,
    excludedProjectIds: extra.excludedProjectIds ?? new Set(),
    savedProjectIds: extra.savedProjectIds ?? new Set(),
    // Tests default to Familiar so Phase 3/4 expectations about ordering stay meaningful.
    explorationPreference: extra.explorationPreference ?? 0,
  };
}
