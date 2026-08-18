/**
 * User profile snapshot: loads behavioural + onboarding data from the database,
 * runs the pure profile functions, and returns labelled views for the API and
 * the Insights page. No scoring or profile maths lives here — see
 * lib/recommender/profile.ts.
 */

import type { InteractionType } from "@/generated/prisma/enums";
import { InteractionType as InteractionTypeEnum } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DIFFICULTY_LABELS } from "@/lib/format";
import { deriveProjectStates } from "@/lib/interactions/project-state";
import { getOnboardingState, type OnboardingStateView } from "@/lib/onboarding/onboarding-service";
import { getOnboardingTopic, topicFeatureVector } from "@/lib/onboarding/topics";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { MS_PER_DAY } from "@/lib/recommender/decay";
import { projectFeatureVector, type FeatureFamily } from "@/lib/recommender/features";
import {
  buildLongTermProfile,
  buildSessionProfile,
  rankFeatures,
  type InterestProfile,
  type OnboardingSignals,
  type ProfileInteraction,
} from "@/lib/recommender/profile";
import type { FeatureVector } from "@/lib/recommender/types";
import { sessionService } from "@/lib/sessions";

export interface ProfileFeatureView {
  id: string;
  family: FeatureFamily;
  key: string;
  label: string;
  /** Raw signed signal (internal scale). */
  signal: number;
  /** Signed, max-abs normalised across the whole profile, in [-1, 1]. */
  strength: number;
  /** Signed, max-abs normalised within the family, in [-1, 1]. */
  familyStrength: number;
}

export interface InterestProfileView {
  isEmpty: boolean;
  interactionCount: number;
  includesOnboarding: boolean;
  norm: number;
  /** Tag features the user leans towards, strongest first. */
  tags: ProfileFeatureView[];
  /** Tag features with negative signal (dislikes), strongest dislike first. */
  dislikedTags: ProfileFeatureView[];
  languages: ProfileFeatureView[];
  difficulty: ProfileFeatureView[];
  duration: ProfileFeatureView[];
}

export interface ProfileStats {
  totalInteractions: number;
  byType: Record<InteractionType, number>;
  distinctProjects: number;
  savedProjects: number;
  dislikedProjects: number;
  builtProjects: number;
  completedProjects: number;
  currentSessionInteractions: number;
}

export interface SessionView {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  /** When the session will expire if nothing else happens. */
  expiresAt: string;
  interactionCount: number;
}

export interface UserProfileSnapshot {
  user: { id: string; name: string; explorationPreference: number; onboardingCompleted: boolean };
  onboarding: OnboardingStateView;
  session: SessionView | null;
  longTermProfile: InterestProfileView;
  sessionProfile: InterestProfileView;
  stats: ProfileStats;
  config: { halfLifeDays: number; historyWindowDays: number; sessionTimeoutMinutes: number };
  computedAt: string;
}

const PROFILE_FEATURE_LIMIT = 12;

type LabelMaps = { tags: Map<string, string>; languages: Map<string, string> };

function labelFor(family: FeatureFamily, key: string, labels: LabelMaps): string {
  switch (family) {
    case "tag":
      return labels.tags.get(key) ?? key;
    case "language":
      return labels.languages.get(key) ?? key;
    case "difficulty":
      return DIFFICULTY_LABELS[key as keyof typeof DIFFICULTY_LABELS] ?? key;
    case "duration":
      return RECOMMENDER_CONFIG.durationBuckets[key as keyof typeof RECOMMENDER_CONFIG.durationBuckets]?.label ?? key;
  }
}

function toProfileView(profile: InterestProfile, labels: LabelMaps): InterestProfileView {
  const view = (features: ReturnType<typeof rankFeatures>): ProfileFeatureView[] =>
    features.map((f) => ({ ...f, label: labelFor(f.family, f.key, labels) }));
  return {
    isEmpty: profile.norm === 0,
    interactionCount: profile.interactionCount,
    includesOnboarding: profile.includesOnboarding,
    norm: profile.norm,
    tags: view(rankFeatures(profile, { family: "tag", sign: "positive", limit: PROFILE_FEATURE_LIMIT })),
    dislikedTags: view(rankFeatures(profile, { family: "tag", sign: "negative", limit: PROFILE_FEATURE_LIMIT })),
    languages: view(rankFeatures(profile, { family: "language", sign: "positive", limit: 6 })),
    difficulty: view(rankFeatures(profile, { family: "difficulty", sign: "positive" })),
    duration: view(rankFeatures(profile, { family: "duration", sign: "positive" })),
  };
}

function emptyByType(): Record<InteractionType, number> {
  return Object.fromEntries(Object.values(InteractionTypeEnum).map((t) => [t, 0])) as Record<InteractionType, number>;
}

/** Loads feature vectors for a set of project ids in one query. */
async function loadProjectFeatures(projectIds: readonly string[]): Promise<Map<string, FeatureVector>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.project.findMany({
    where: { id: { in: [...projectIds] } },
    select: {
      id: true,
      difficulty: true,
      estimatedHours: true,
      tags: { select: { tag: { select: { slug: true } } } },
      languages: { select: { language: { select: { slug: true } } } },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      projectFeatureVector({
        tagSlugs: row.tags.map((t) => t.tag.slug),
        languageSlugs: row.languages.map((l) => l.language.slug),
        difficulty: row.difficulty,
        estimatedHours: row.estimatedHours,
      }),
    ]),
  );
}

export async function getUserProfileSnapshot(userId: string, now: Date = new Date()): Promise<UserProfileSnapshot> {
  const [user, interactions, onboarding, activeSession, tagRows, languageRows] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, explorationPreference: true, onboardingCompleted: true },
    }),
    prisma.interaction.findMany({
      where: { userId },
      select: { projectId: true, sessionId: true, type: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    getOnboardingState(userId),
    sessionService.getActive(userId, now),
    prisma.tag.findMany({ select: { slug: true, name: true } }),
    prisma.language.findMany({ select: { slug: true, name: true } }),
  ]);
  const labels: LabelMaps = {
    tags: new Map(tagRows.map((t) => [t.slug, t.name])),
    languages: new Map(languageRows.map((l) => [l.slug, l.name])),
  };

  // One batched fetch for every project referenced by history or onboarding.
  const projectIds = new Set<string>(interactions.map((i) => i.projectId));
  for (const choice of onboarding.pairwiseChoices) {
    projectIds.add(choice.chosenProjectId);
    projectIds.add(choice.rejectedProjectId);
  }
  const features = await loadProjectFeatures([...projectIds]);

  const windowStart = now.getTime() - RECOMMENDER_CONFIG.timeDecay.historyWindowDays * MS_PER_DAY;
  const toProfileInteraction = (i: (typeof interactions)[number]): ProfileInteraction | null => {
    const projectFeatures = features.get(i.projectId);
    return projectFeatures ? { type: i.type, createdAt: i.createdAt, sessionId: i.sessionId, features: projectFeatures } : null;
  };
  const historical = interactions
    .filter((i) => i.createdAt.getTime() >= windowStart)
    .map(toProfileInteraction)
    .filter((i): i is ProfileInteraction => i !== null);
  const sessionInteractions = activeSession
    ? interactions
        .filter((i) => i.sessionId === activeSession.id)
        .map(toProfileInteraction)
        .filter((i): i is ProfileInteraction => i !== null)
    : [];

  const onboardingSignals: OnboardingSignals | null = onboarding.completed
    ? {
        topicFeatures: onboarding.topics
          .map((t) => getOnboardingTopic(t.key))
          .filter((t): t is NonNullable<typeof t> => t !== undefined)
          .map(topicFeatureVector),
        chosenProjectFeatures: onboarding.pairwiseChoices
          .map((c) => features.get(c.chosenProjectId))
          .filter((f): f is FeatureVector => f !== undefined),
        rejectedProjectFeatures: onboarding.pairwiseChoices
          .map((c) => features.get(c.rejectedProjectId))
          .filter((f): f is FeatureVector => f !== undefined),
        difficultyPreference: onboarding.difficultyPreference,
        durationPreference: onboarding.durationPreference ?? "ANYTHING",
      }
    : null;

  const longTerm = buildLongTermProfile({ interactions: historical, onboarding: onboardingSignals, now });
  const session = buildSessionProfile({ interactions: sessionInteractions, now });

  // Statistics from the full history (not just the decay window).
  const byType = emptyByType();
  for (const i of interactions) byType[i.type] += 1;
  const states = deriveProjectStates(interactions);
  const currentSessionInteractions = activeSession ? interactions.filter((i) => i.sessionId === activeSession.id).length : 0;
  const stats: ProfileStats = {
    totalInteractions: interactions.length,
    byType,
    distinctProjects: states.size,
    savedProjects: [...states.values()].filter((s) => s.saved).length,
    dislikedProjects: [...states.values()].filter((s) => s.disliked).length,
    builtProjects: [...states.values()].filter((s) => s.built).length,
    completedProjects: [...states.values()].filter((s) => s.completed).length,
    currentSessionInteractions,
  };

  return {
    user,
    onboarding,
    session: activeSession
      ? {
          id: activeSession.id,
          startedAt: activeSession.startedAt.toISOString(),
          lastActiveAt: activeSession.lastActiveAt.toISOString(),
          expiresAt: new Date(activeSession.lastActiveAt.getTime() + sessionService.timeoutMinutes * 60_000).toISOString(),
          interactionCount: currentSessionInteractions,
        }
      : null,
    longTermProfile: toProfileView(longTerm, labels),
    sessionProfile: toProfileView(session, labels),
    stats,
    config: {
      halfLifeDays: RECOMMENDER_CONFIG.timeDecay.halfLifeDays,
      historyWindowDays: RECOMMENDER_CONFIG.timeDecay.historyWindowDays,
      sessionTimeoutMinutes: sessionService.timeoutMinutes,
    },
    computedAt: now.toISOString(),
  };
}

/** Per-project behavioural state for the detail page actions. */
export async function getProjectStateForUser(
  userId: string,
  projectId: string,
): Promise<{ saved: boolean; disliked: boolean; built: boolean; completed: boolean }> {
  const interactions = await prisma.interaction.findMany({
    where: { userId, projectId },
    select: { projectId: true, type: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const state = deriveProjectStates(interactions).get(projectId);
  return {
    saved: state?.saved ?? false,
    disliked: state?.disliked ?? false,
    built: state?.built ?? false,
    completed: state?.completed ?? false,
  };
}
