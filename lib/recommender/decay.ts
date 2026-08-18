/**
 * Time decay for behavioural signals.
 *
 * Exponential half-life decay:
 *   decay(age) = 0.5 ** (ageDays / halfLifeDays)
 *
 * so an interaction that just happened counts fully (1.0), one that is exactly
 * one half-life old counts half, two half-lives old a quarter, and so on.
 * Ages in the future (clock skew) are treated as zero age. The function is
 * pure and deterministic; the half-life lives in RECOMMENDER_CONFIG.
 */

import { RECOMMENDER_CONFIG } from "./config";

export const MS_PER_DAY = 86_400_000;

/** Decay multiplier in (0, 1] for a signal `ageMs` milliseconds old. */
export function timeDecay(ageMs: number, halfLifeDays: number = RECOMMENDER_CONFIG.timeDecay.halfLifeDays): number {
  if (!(halfLifeDays > 0)) throw new RangeError(`halfLifeDays must be > 0, got ${halfLifeDays}`);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const ageDays = ageMs / MS_PER_DAY;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Decay multiplier for something that happened at `occurredAt`, evaluated at `now`. */
export function decayAt(
  occurredAt: Date,
  now: Date,
  halfLifeDays: number = RECOMMENDER_CONFIG.timeDecay.halfLifeDays,
): number {
  return timeDecay(now.getTime() - occurredAt.getTime(), halfLifeDays);
}
