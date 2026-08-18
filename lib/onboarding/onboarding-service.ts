/**
 * Onboarding persistence.
 *
 * Answers are stored explicitly (OnboardingProfile + OnboardingPairwiseChoice)
 * rather than as fake interactions, so the cold-start prior stays inspectable
 * and can be re-weighted from configuration without rewriting history.
 */

import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import { getProjectsBySlugs, type ProjectDetail } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db";
import { ONBOARDING_PAIRS } from "./pairs";
import type { CompleteOnboardingBody } from "./schemas";
import { ONBOARDING_TOPICS, getOnboardingTopic } from "./topics";

export interface OnboardingPair {
  index: number;
  left: ProjectDetail;
  right: ProjectDetail;
}

export interface OnboardingStateView {
  completed: boolean;
  completedAt: string | null;
  topics: { key: string; label: string }[];
  /** Null when "surprise me" (or not onboarded). */
  difficultyPreference: Difficulty | null;
  durationPreference: DurationPreference | null;
  pairwiseChoices: { position: number; chosenProjectId: string; rejectedProjectId: string }[];
}

export class OnboardingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingConfigurationError";
  }
}

/** Loads the curated pairs with full project data (throws if the catalog is not seeded). */
export async function loadOnboardingPairs(): Promise<OnboardingPair[]> {
  const projects = await getProjectsBySlugs(ONBOARDING_PAIRS.flatMap((p) => [p.left, p.right]));
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  return ONBOARDING_PAIRS.map((pair, index) => {
    const left = bySlug.get(pair.left);
    const right = bySlug.get(pair.right);
    if (!left || !right) {
      throw new OnboardingConfigurationError(
        `Onboarding pair ${index} references projects missing from the catalog (${pair.left}, ${pair.right}). Run the seed.`,
      );
    }
    return { index, left, right };
  });
}

/** Persists onboarding answers and marks the user as onboarded. Idempotent per user (re-taking overwrites). */
export async function completeOnboarding(userId: string, body: CompleteOnboardingBody, now: Date = new Date()): Promise<void> {
  const pairs = await loadOnboardingPairs();
  const choiceRows = body.choices.map((choice) => {
    const pair = pairs[choice.pairIndex];
    if (!pair) throw new OnboardingConfigurationError(`Unknown pair index ${choice.pairIndex}`);
    const chosen = choice.chosenSlug === pair.left.slug ? pair.left : pair.right;
    const rejected = chosen === pair.left ? pair.right : pair.left;
    return { userId, chosenProjectId: chosen.id, rejectedProjectId: rejected.id, position: pair.index };
  });
  const difficultyPreference: Difficulty | null = body.difficulty === "SURPRISE_ME" ? null : body.difficulty;

  await prisma.$transaction([
    prisma.onboardingProfile.upsert({
      where: { userId },
      update: { topics: body.topics, difficultyPreference, durationPreference: body.duration, completedAt: now },
      create: { userId, topics: body.topics, difficultyPreference, durationPreference: body.duration, completedAt: now },
    }),
    prisma.onboardingPairwiseChoice.deleteMany({ where: { userId } }),
    prisma.onboardingPairwiseChoice.createMany({ data: choiceRows }),
    prisma.user.update({ where: { id: userId }, data: { onboardingCompleted: true } }),
  ]);
}

/** Current onboarding answers for display / API. */
export async function getOnboardingState(userId: string): Promise<OnboardingStateView> {
  const [user, profile, choices] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingCompleted: true } }),
    prisma.onboardingProfile.findUnique({ where: { userId } }),
    prisma.onboardingPairwiseChoice.findMany({ where: { userId }, orderBy: { position: "asc" } }),
  ]);
  return {
    completed: user.onboardingCompleted,
    completedAt: profile?.completedAt?.toISOString() ?? null,
    topics: (profile?.topics ?? []).map((key) => ({ key, label: getOnboardingTopic(key)?.label ?? key })),
    difficultyPreference: profile?.difficultyPreference ?? null,
    durationPreference: profile?.durationPreference ?? null,
    pairwiseChoices: choices.map((c) => ({ position: c.position, chosenProjectId: c.chosenProjectId, rejectedProjectId: c.rejectedProjectId })),
  };
}

export const ONBOARDING_TOPIC_OPTIONS = ONBOARDING_TOPICS.map(({ key, label, hint }) => ({ key, label, hint }));
