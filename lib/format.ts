import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { durationBucketForHours } from "@/lib/recommender/features";

export { durationBucketForHours };

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  BEGINNER: 0,
  INTERMEDIATE: 1,
  ADVANCED: 2,
};

export function durationBucketLabel(bucket: DurationPreference): string {
  return RECOMMENDER_CONFIG.durationBuckets[bucket].label;
}

/** Compact hours label, e.g. "~2h", "~40h". */
export function formatHours(hours: number): string {
  return `~${hours}h`;
}

/** Human duration, e.g. "Weekend · ~12h". */
export function formatDuration(hours: number): string {
  return `${durationBucketLabel(durationBucketForHours(hours))} · ${formatHours(hours)}`;
}

/** Formats a 0–1 score as a percentage string without implying calibration. */
export function formatScore(score: number): string {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}`;
}

/** Splits a description stored with blank-line paragraph breaks. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
