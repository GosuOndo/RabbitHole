/**
 * Project → feature vector.
 *
 * Every project is described by a sparse, namespaced feature vector that both
 * user profiles and (later) content similarity share:
 *
 *   tag:<slug>            one feature per tag, value = featureFamilyWeights.tag
 *   lang:<slug>           languages share featureFamilyWeights.language equally
 *   difficulty:<LEVEL>    single feature, value = featureFamilyWeights.difficulty
 *   duration:<BUCKET>     single feature, value = featureFamilyWeights.duration
 *
 * Keys use the raw enum values / slugs so ids are stable and need no casing rules.
 */

import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "./config";
import type { FeatureVector } from "./types";

export const FEATURE_FAMILIES = ["tag", "language", "difficulty", "duration"] as const;
export type FeatureFamily = (typeof FEATURE_FAMILIES)[number];

const FAMILY_PREFIX: Record<FeatureFamily, string> = {
  tag: "tag",
  language: "lang",
  difficulty: "difficulty",
  duration: "duration",
};

const PREFIX_FAMILY: Record<string, FeatureFamily> = Object.fromEntries(
  (Object.entries(FAMILY_PREFIX) as [FeatureFamily, string][]).map(([family, prefix]) => [prefix, family]),
);

export type FeatureFamilyWeights = Record<FeatureFamily, number>;

/** Minimal project shape needed to build features. */
export interface ProjectFeatureInput {
  tagSlugs: readonly string[];
  languageSlugs: readonly string[];
  difficulty: Difficulty;
  estimatedHours: number;
}

export function featureId(family: FeatureFamily, key: string): string {
  return `${FAMILY_PREFIX[family]}:${key}`;
}

export function parseFeatureId(id: string): { family: FeatureFamily; key: string } | null {
  const separator = id.indexOf(":");
  if (separator <= 0) return null;
  const family = PREFIX_FAMILY[id.slice(0, separator)];
  if (!family) return null;
  return { family, key: id.slice(separator + 1) };
}

/** Duration bucket (never ANYTHING) for an estimated-hours value; upper bounds are inclusive. */
export function durationBucketForHours(hours: number): Exclude<DurationPreference, "ANYTHING"> {
  const buckets = RECOMMENDER_CONFIG.durationBuckets;
  if (hours <= buckets.UNDER_2_HOURS.maxHours) return "UNDER_2_HOURS";
  if (hours <= buckets.ONE_EVENING.maxHours) return "ONE_EVENING";
  if (hours <= buckets.WEEKEND.maxHours) return "WEEKEND";
  return "ONE_TO_TWO_WEEKS";
}

/** Builds the sparse feature vector for a project. */
export function projectFeatureVector(
  project: ProjectFeatureInput,
  weights: FeatureFamilyWeights = RECOMMENDER_CONFIG.profile.featureFamilyWeights,
): FeatureVector {
  const features: Record<string, number> = {};
  for (const tag of new Set(project.tagSlugs)) {
    features[featureId("tag", tag)] = weights.tag;
  }
  const languages = [...new Set(project.languageSlugs)];
  if (languages.length > 0) {
    const share = weights.language / languages.length;
    for (const language of languages) features[featureId("language", language)] = share;
  }
  features[featureId("difficulty", project.difficulty)] = weights.difficulty;
  features[featureId("duration", durationBucketForHours(project.estimatedHours))] = weights.duration;
  return features;
}
