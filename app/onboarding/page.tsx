import type { Metadata } from "next";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { OnboardingScreen, type CompletedSummary } from "@/components/onboarding-screen";
import type { DifficultyChoice, OnboardingWizardProps } from "@/components/onboarding-wizard";
import { PageHeader } from "@/components/page-header";
import type { DurationPreference } from "@/generated/prisma/enums";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { DIFFICULTY_LABELS } from "@/lib/format";
import { ONBOARDING_TOPIC_OPTIONS, getOnboardingState, loadOnboardingPairs } from "@/lib/onboarding/onboarding-service";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export const metadata: Metadata = { title: "Onboarding" };
export const dynamic = "force-dynamic";

const DIFFICULTY_OPTIONS: OnboardingWizardProps["difficultyOptions"] = [
  { value: "BEGINNER", label: "Beginner friendly", hint: "Gentle scope, quick wins" },
  { value: "INTERMEDIATE", label: "Intermediate", hint: "Real engineering at a manageable size" },
  { value: "ADVANCED", label: "Advanced", hint: "Deep, multi-week rabbit holes" },
  { value: "SURPRISE_ME", label: "Surprise me", hint: "Mix it up across levels" },
];

function durationOptions(): OnboardingWizardProps["durationOptions"] {
  const buckets = RECOMMENDER_CONFIG.durationBuckets;
  const hint = (max: number, previousMax: number) =>
    Number.isFinite(max) ? (previousMax > 0 ? `${previousMax}–${max} hours` : `up to ${max} hours`) : "no preference";
  return [
    { value: "UNDER_2_HOURS", label: buckets.UNDER_2_HOURS.label, hint: hint(buckets.UNDER_2_HOURS.maxHours, 0) },
    { value: "ONE_EVENING", label: buckets.ONE_EVENING.label, hint: hint(buckets.ONE_EVENING.maxHours, buckets.UNDER_2_HOURS.maxHours) },
    { value: "WEEKEND", label: buckets.WEEKEND.label, hint: hint(buckets.WEEKEND.maxHours, buckets.ONE_EVENING.maxHours) },
    { value: "ONE_TO_TWO_WEEKS", label: buckets.ONE_TO_TWO_WEEKS.label, hint: hint(buckets.ONE_TO_TWO_WEEKS.maxHours, buckets.WEEKEND.maxHours) },
    { value: "ANYTHING", label: buckets.ANYTHING.label, hint: hint(buckets.ANYTHING.maxHours, 0) },
  ];
}

export default async function OnboardingPage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const user = await getOrCreateDemoUser();
  const [state, pairs] = await Promise.all([getOnboardingState(user.id), loadOnboardingPairs()]);
  const durations = durationOptions();

  const pairViews: OnboardingWizardProps["pairs"] = pairs.map((pair) => ({
    index: pair.index,
    left: {
      id: pair.left.id,
      slug: pair.left.slug,
      title: pair.left.title,
      summary: pair.left.summary,
      difficulty: pair.left.difficulty,
      estimatedHours: pair.left.estimatedHours,
      tags: pair.left.tags,
    },
    right: {
      id: pair.right.id,
      slug: pair.right.slug,
      title: pair.right.title,
      summary: pair.right.summary,
      difficulty: pair.right.difficulty,
      estimatedHours: pair.right.estimatedHours,
      tags: pair.right.tags,
    },
  }));

  const initialChoices: Record<number, string> = {};
  for (const choice of state.pairwiseChoices) {
    const pair = pairs[choice.position];
    if (!pair) continue;
    if (pair.left.id === choice.chosenProjectId) initialChoices[pair.index] = pair.left.slug;
    else if (pair.right.id === choice.chosenProjectId) initialChoices[pair.index] = pair.right.slug;
  }
  const initialDifficulty: DifficultyChoice | null = state.completed ? (state.difficultyPreference ?? "SURPRISE_ME") : null;
  const initialDuration: DurationPreference | null = state.completed ? (state.durationPreference ?? "ANYTHING") : null;

  const completed: CompletedSummary | null = state.completed
    ? {
        completedLabel: state.completedAt
          ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(state.completedAt))
          : null,
        topics: state.topics.map((t) => t.label),
        difficulty: state.difficultyPreference ? DIFFICULTY_LABELS[state.difficultyPreference] : "Surprise me",
        duration: durations.find((d) => d.value === (state.durationPreference ?? "ANYTHING"))?.label ?? "Anything",
        choices: pairViews
          .map((pair) => (initialChoices[pair.index] === pair.left.slug ? pair.left.title : initialChoices[pair.index] === pair.right.slug ? pair.right.title : null))
          .filter((title): title is string => title !== null),
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Getting started"
        title="Let's learn your taste"
        description="A few quick questions seed your first recommendations. RabbitHole keeps learning from what you open, save, build and skip."
      />
      <OnboardingScreen
        completed={completed}
        wizard={{
          topics: ONBOARDING_TOPIC_OPTIONS,
          topicLimits: { min: RECOMMENDER_CONFIG.onboarding.minTopics, max: RECOMMENDER_CONFIG.onboarding.maxTopics },
          difficultyOptions: DIFFICULTY_OPTIONS,
          durationOptions: durations,
          pairs: pairViews,
          initial: state.completed
            ? { topics: state.topics.map((t) => t.key), difficulty: initialDifficulty, duration: initialDuration, choices: initialChoices }
            : undefined,
        }}
      />
    </div>
  );
}
