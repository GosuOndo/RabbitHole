/**
 * Feature-based user profiles.
 *
 * A profile is a sparse, *signed* vector over project features
 * (`tag:systems`, `lang:rust`, `difficulty:ADVANCED`, `duration:WEEKEND`).
 *
 * Aggregation (per interaction i on project p, evaluated at time `now`):
 *
 *   signal(i) = interactionWeight(i.type) * timeDecay(now - i.createdAt)
 *   raw[f]   += signal(i) * projectFeatures(p)[f]      for every feature f of p
 *
 * The interaction *type* is authoritative: weights are looked up in
 * RECOMMENDER_CONFIG at compute time (the stored `Interaction.weight` is only a
 * snapshot for auditing). Positive interactions (OPEN, SAVE, BUILD, COMPLETE,
 * SHARE) strengthen features; DISLIKE and UNSAVE weaken them; IMPRESSION has
 * weight 0 and contributes nothing.
 *
 * Onboarding answers are added as explicit, non-decaying signals (see
 * `onboardingSignalVector`) — they are a prior, not fake behaviour.
 *
 * Three representations are exposed and the distinction is deliberate:
 *   - `signals`   raw signed sums (internal, unbounded)
 *   - `vector`    signals / L2 norm — signed unit vector for cosine similarity
 *   - `strengths` signals / max|signal| — signed values in [-1, 1] for the UI
 * Negative values are preserved everywhere: a dislike is information, not noise.
 * An empty profile has empty maps and norm 0 (never NaN).
 */

import type { Difficulty, DurationPreference, InteractionType } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG, interactionWeight } from "./config";
import { decayAt } from "./decay";
import { featureId, parseFeatureId, type FeatureFamily } from "./features";
import type { FeatureVector } from "./types";
import { addScaledInto, l2Norm, maxAbs, tidyVector } from "./vector";

/** An interaction paired with the feature vector of its project. */
export interface ProfileInteraction {
  type: InteractionType;
  createdAt: Date;
  sessionId?: string;
  /** Project id (used to count repeated (project, type) actions once in session evidence). */
  projectId?: string;
  features: FeatureVector;
}

/** Explicit onboarding answers, already resolved to feature vectors. */
export interface OnboardingSignals {
  /** One vector per selected topic: `tag:<slug>` → mapping weight in (0, 1]. */
  topicFeatures: FeatureVector[];
  /** Feature vectors of projects chosen in pairwise comparisons. */
  chosenProjectFeatures: FeatureVector[];
  /** Feature vectors of the projects rejected in those comparisons. */
  rejectedProjectFeatures: FeatureVector[];
  /** Null means "surprise me" (no difficulty signal). */
  difficultyPreference: Difficulty | null;
  /** ANYTHING adds no duration signal. */
  durationPreference: DurationPreference;
}

export interface InterestProfile {
  /** Raw signed aggregate per feature (internal representation). */
  signals: FeatureVector;
  /** L2-normalised signed vector (for similarity computations). */
  vector: FeatureVector;
  /** Max-abs normalised signed values in [-1, 1] (for display). */
  strengths: FeatureVector;
  /** L2 norm of `signals`; 0 for an empty profile. */
  norm: number;
  /** Interactions with non-zero weight that contributed. */
  interactionCount: number;
  /** Whether onboarding signals were folded in. */
  includesOnboarding: boolean;
}

export const EMPTY_PROFILE: InterestProfile = Object.freeze({
  signals: {},
  vector: {},
  strengths: {},
  norm: 0,
  interactionCount: 0,
  includesOnboarding: false,
});

export interface AggregationOptions {
  /** Half-life in days, or null to disable decay (used for session profiles). */
  halfLifeDays: number | null;
}

/**
 * Sums decayed, weighted project features across interactions.
 * Returns the raw signal map and how many interactions contributed.
 */
export function aggregateInteractionSignals(
  interactions: readonly ProfileInteraction[],
  now: Date,
  options: AggregationOptions,
): { signals: Record<string, number>; interactionCount: number } {
  const signals: Record<string, number> = {};
  let interactionCount = 0;
  for (const interaction of interactions) {
    const weight = interactionWeight(interaction.type);
    if (weight === 0) continue;
    const decay = options.halfLifeDays === null ? 1 : decayAt(interaction.createdAt, now, options.halfLifeDays);
    addScaledInto(signals, interaction.features, weight * decay);
    interactionCount += 1;
  }
  return { signals, interactionCount };
}

/**
 * Explicit onboarding prior:
 *   topics:   topicSignal * mappingWeight on each mapped tag feature
 *   pairwise: pairwiseChosenSignal on chosen-project features,
 *             pairwiseRejectedSignal (negative) on rejected-project features
 *   difficulty / duration: single-feature signals unless "surprise me" / ANYTHING
 */
export function onboardingSignalVector(
  onboarding: OnboardingSignals,
  config = RECOMMENDER_CONFIG.onboarding,
): FeatureVector {
  const signals: Record<string, number> = {};
  for (const topic of onboarding.topicFeatures) addScaledInto(signals, topic, config.topicSignal);
  for (const chosen of onboarding.chosenProjectFeatures) addScaledInto(signals, chosen, config.pairwiseChosenSignal);
  for (const rejected of onboarding.rejectedProjectFeatures) addScaledInto(signals, rejected, config.pairwiseRejectedSignal);
  if (onboarding.difficultyPreference) {
    addScaledInto(signals, { [featureId("difficulty", onboarding.difficultyPreference)]: 1 }, config.difficultySignal);
  }
  if (onboarding.durationPreference !== "ANYTHING") {
    addScaledInto(signals, { [featureId("duration", onboarding.durationPreference)]: 1 }, config.durationSignal);
  }
  return signals;
}

/**
 * Normalises raw signals into the unit vector and display strengths.
 * Deterministic: keys are sorted, near-zero entries dropped, empty input yields
 * empty outputs and norm 0.
 */
export function normalizeSignals(rawSignals: FeatureVector): Pick<InterestProfile, "signals" | "vector" | "strengths" | "norm"> {
  const signals = tidyVector(rawSignals);
  const norm = l2Norm(signals);
  const peak = maxAbs(signals);
  const vector: Record<string, number> = {};
  const strengths: Record<string, number> = {};
  if (norm > 0 && peak > 0) {
    for (const [key, value] of Object.entries(signals)) {
      vector[key] = value / norm;
      strengths[key] = value / peak;
    }
  }
  return { signals, vector, strengths, norm };
}

/** Assembles a profile from raw signals plus metadata. */
export function buildProfile(
  rawSignals: FeatureVector,
  meta: { interactionCount: number; includesOnboarding: boolean },
): InterestProfile {
  return { ...normalizeSignals(rawSignals), ...meta };
}

/**
 * Long-term profile = decayed historical interactions + onboarding prior.
 * Interactions should already be limited to the configured history window.
 */
export function buildLongTermProfile(input: {
  interactions: readonly ProfileInteraction[];
  onboarding: OnboardingSignals | null;
  now: Date;
  halfLifeDays?: number;
}): InterestProfile {
  const { signals, interactionCount } = aggregateInteractionSignals(input.interactions, input.now, {
    halfLifeDays: input.halfLifeDays ?? RECOMMENDER_CONFIG.timeDecay.halfLifeDays,
  });
  if (input.onboarding) addScaledInto(signals, onboardingSignalVector(input.onboarding), 1);
  return buildProfile(signals, { interactionCount, includesOnboarding: input.onboarding !== null });
}

/**
 * Session profile = interactions of the current session only, no onboarding
 * prior and no decay (a session is short; recency within it is irrelevant).
 */
export function buildSessionProfile(input: { interactions: readonly ProfileInteraction[]; now: Date }): InterestProfile {
  const { signals, interactionCount } = aggregateInteractionSignals(input.interactions, input.now, { halfLifeDays: null });
  return buildProfile(signals, { interactionCount, includesOnboarding: false });
}

export interface RankedFeature {
  id: string;
  family: FeatureFamily;
  key: string;
  /** Raw signed signal. */
  signal: number;
  /** Global max-abs normalised value in [-1, 1]. */
  strength: number;
  /** Max-abs normalised within the feature's own family, in [-1, 1]. */
  familyStrength: number;
}

/**
 * Features of a profile ordered by signal (desc for positive, asc for negative),
 * with feature ids as a deterministic tie-breaker.
 */
export function rankFeatures(
  profile: InterestProfile,
  options: { family?: FeatureFamily; sign?: "positive" | "negative"; limit?: number } = {},
): RankedFeature[] {
  const familyPeaks = new Map<FeatureFamily, number>();
  const parsed: { id: string; family: FeatureFamily; key: string; signal: number }[] = [];
  for (const [id, signal] of Object.entries(profile.signals)) {
    const info = parseFeatureId(id);
    if (!info) continue;
    parsed.push({ id, family: info.family, key: info.key, signal });
    familyPeaks.set(info.family, Math.max(familyPeaks.get(info.family) ?? 0, Math.abs(signal)));
  }
  const sign = options.sign ?? "positive";
  const filtered = parsed.filter(
    (f) => (options.family === undefined || f.family === options.family) && (sign === "positive" ? f.signal > 0 : f.signal < 0),
  );
  filtered.sort((a, b) => (sign === "positive" ? b.signal - a.signal : a.signal - b.signal) || a.id.localeCompare(b.id));
  const limited = options.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
  return limited.map((f) => {
    const familyPeak = familyPeaks.get(f.family) ?? 0;
    return {
      ...f,
      strength: profile.strengths[f.id] ?? 0,
      familyStrength: familyPeak > 0 ? f.signal / familyPeak : 0,
    };
  });
}
