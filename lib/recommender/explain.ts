/**
 * Deterministic recommendation explanations.
 *
 * Every sentence is backed by a real signal:
 *   - "Because you like X and Y projects."            long-term profile has positive
 *                                                        signal on tags the project carries
 *                                                        and content affinity is meaningful
 *   - "Based on the interests you selected during     same, but the profile is
 *      onboarding: X, Y."                                onboarding-only (cold start)
 *   - "You recently explored X projects in this        session profile has positive signal
 *      session."                                         on the project's tags
 *   - "Fits your preference for weekend-sized          positive difficulty / duration /
 *      advanced Rust projects."                          language features in the profile
 *   - "Popular with RabbitHole users…"                 popularity score above threshold
 *   - "People who liked “X”, which you saved, also     item-item collaborative evidence:
 *      liked this."                                     the candidate is a behavioural
 *                                                        neighbour of the user's own
 *                                                        positive-state projects (seeds)
 * Collaborative wording is only produced when real seeds support the candidate;
 * it becomes the primary sentence when its weighted contribution exceeds the
 * content contribution, otherwise it is a secondary sentence. Templates are
 * chosen by a fixed precedence, so the same inputs always yield the same text.
 * Factors are returned as data for the inspector UI.
 */

import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import type { CollaborativeSeedState } from "./collaborative";
import { RECOMMENDER_CONFIG } from "./config";
import { durationBucketForHours, featureId, type FeatureFamily } from "./features";
import type { InterestProfile } from "./profile";
import type { CandidateSource, RankingWeights } from "./types";

export type ExplanationFactorKind = "onboarding" | "taste" | "session" | "collaborative" | "fit" | "popularity" | "catalog";

export interface ExplanationFeature {
  id: string;
  label: string;
}

export interface ExplanationFactor {
  kind: ExplanationFactorKind;
  features: ExplanationFeature[];
  /** Signal that supports the factor (affinity, popularity score, …). */
  strength: number;
}

export interface Explanation {
  text: string;
  primary: ExplanationFactorKind;
  factors: ExplanationFactor[];
}

export interface ExplanationInput {
  project: { tagSlugs: readonly string[]; languageSlugs: readonly string[]; difficulty: Difficulty; estimatedHours: number };
  longTerm: InterestProfile;
  session: InterestProfile | null;
  /** Signed cosine affinity between the effective profile and the project. */
  contentAffinity: number;
  /** Cosine affinity between the session profile and the project (null when no session profile). */
  sessionAffinity: number | null;
  popularityScore: number;
  sources: readonly CandidateSource[];
  /** True when the profile is onboarding-only (no weighted interactions yet). */
  coldStart: boolean;
  labelFor: (family: FeatureFamily, key: string) => string;
  /** Normalised collaborative score, or null when the candidate has no collaborative evidence. */
  collaborativeScore?: number | null;
  /** The user's own positive-state projects that support the collaborative score, strongest first. */
  collaborativeSeeds?: readonly CollaborativeSeedReference[];
  /** Ranking weights in force (decides whether collaborative or content wording leads). */
  weights?: Partial<RankingWeights>;
}

export interface CollaborativeSeedReference {
  projectId: string;
  title: string;
  state: CollaborativeSeedState;
  contribution: number;
}

const SEED_VERB: Record<CollaborativeSeedState, string> = {
  completed: "completed",
  built: "are building",
  saved: "saved",
  shared: "shared",
  opened: "opened",
};

/** "People who liked “X”, which you saved, also liked this." — names real seed projects. */
export function collaborativeSentence(seeds: readonly CollaborativeSeedReference[]): string {
  const [first, second] = seeds;
  if (!first) return "";
  if (!second) return `People who liked “${first.title}”, which you ${SEED_VERB[first.state]}, also liked this.`;
  if (first.state === second.state) {
    return `People who liked “${first.title}” and “${second.title}”, which you ${SEED_VERB[first.state]}, also liked this.`;
  }
  return `People who liked “${first.title}” (which you ${SEED_VERB[first.state]}) and “${second.title}” (which you ${SEED_VERB[second.state]}) also liked this.`;
}

const DURATION_PROSE: Record<Exclude<DurationPreference, "ANYTHING">, string> = {
  UNDER_2_HOURS: "under-two-hour",
  ONE_EVENING: "one-evening",
  WEEKEND: "weekend-sized",
  ONE_TO_TWO_WEEKS: "week-long",
};

const DIFFICULTY_PROSE: Record<Difficulty, string> = {
  BEGINNER: "beginner-friendly",
  INTERMEDIATE: "intermediate",
  ADVANCED: "advanced",
};

/** Lowercases Title-case words for prose while keeping acronyms (WebGL, NLP, IoT). */
export function proseLabel(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}

function joinNatural(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Project tag features with positive signal in `profile`, strongest first. */
function positiveTagOverlap(profile: InterestProfile | null, tagSlugs: readonly string[], limit: number): { slug: string; signal: number }[] {
  if (!profile) return [];
  const overlap: { slug: string; signal: number }[] = [];
  for (const slug of new Set(tagSlugs)) {
    const signal = profile.signals[featureId("tag", slug)] ?? 0;
    if (signal > 0) overlap.push({ slug, signal });
  }
  overlap.sort((a, b) => b.signal - a.signal || a.slug.localeCompare(b.slug));
  return overlap.slice(0, limit);
}

export function explainRecommendation(input: ExplanationInput, config = RECOMMENDER_CONFIG.explanation): Explanation {
  const { project, longTerm, session, labelFor } = input;
  const factors: ExplanationFactor[] = [];

  const tasteTags = positiveTagOverlap(longTerm, project.tagSlugs, config.maxFeaturesPerSentence);
  const tasteFeatures = tasteTags.map((t) => ({ id: featureId("tag", t.slug), label: labelFor("tag", t.slug) }));
  const tasteSupported = tasteFeatures.length > 0 && input.contentAffinity >= config.minContentAffinity;
  if (tasteSupported) {
    factors.push({ kind: input.coldStart ? "onboarding" : "taste", features: tasteFeatures, strength: input.contentAffinity });
  }

  const sessionTags = positiveTagOverlap(session, project.tagSlugs, config.maxFeaturesPerSentence);
  const sessionSupported =
    sessionTags.length > 0 && input.sessionAffinity !== null && input.sessionAffinity >= config.minSessionAffinity;
  if (sessionSupported) {
    factors.push({
      kind: "session",
      features: sessionTags.map((t) => ({ id: featureId("tag", t.slug), label: labelFor("tag", t.slug) })),
      strength: input.sessionAffinity ?? 0,
    });
  }

  // Fit: difficulty / duration / language preferences that the project satisfies.
  const fitParts: string[] = [];
  const fitFeatures: ExplanationFeature[] = [];
  const durationBucket = durationBucketForHours(project.estimatedHours);
  const durationId = featureId("duration", durationBucket);
  if ((longTerm.signals[durationId] ?? 0) > 0) {
    fitParts.push(DURATION_PROSE[durationBucket]);
    fitFeatures.push({ id: durationId, label: labelFor("duration", durationBucket) });
  }
  const difficultyId = featureId("difficulty", project.difficulty);
  if ((longTerm.signals[difficultyId] ?? 0) > 0) {
    fitParts.push(DIFFICULTY_PROSE[project.difficulty]);
    fitFeatures.push({ id: difficultyId, label: labelFor("difficulty", project.difficulty) });
  }
  const languageMatches = [...new Set(project.languageSlugs)]
    .map((slug) => ({ slug, signal: longTerm.signals[featureId("language", slug)] ?? 0 }))
    .filter((l) => l.signal > 0)
    .sort((a, b) => b.signal - a.signal || a.slug.localeCompare(b.slug))
    .slice(0, 1);
  if (languageMatches.length > 0) {
    const language = languageMatches[0]!;
    fitParts.push(labelFor("language", language.slug));
    fitFeatures.push({ id: featureId("language", language.slug), label: labelFor("language", language.slug) });
  }
  const fitSupported = fitParts.length > 0 && input.contentAffinity > 0;
  if (fitSupported) factors.push({ kind: "fit", features: fitFeatures, strength: input.contentAffinity });

  const popularitySupported = input.popularityScore >= config.minPopularity && input.sources.includes("popular");
  if (popularitySupported) factors.push({ kind: "popularity", features: [], strength: input.popularityScore });

  // Collaborative: only with real seeds behind a meaningful normalised score.
  const seeds = (input.collaborativeSeeds ?? []).slice(0, config.maxFeaturesPerSentence);
  const collaborativeScore = input.collaborativeScore ?? null;
  const collaborativeSupported =
    collaborativeScore !== null && collaborativeScore >= config.minCollaborative && seeds.length > 0 && input.sources.includes("collaborative");
  if (collaborativeSupported) {
    factors.push({
      kind: "collaborative",
      features: seeds.map((s) => ({ id: `project:${s.projectId}`, label: s.title })),
      strength: collaborativeScore,
    });
  }
  const contentContribution = (input.weights?.content ?? 0) * Math.max(0, input.contentAffinity);
  const collaborativeContribution = collaborativeSupported ? (input.weights?.collaborative ?? 0) * collaborativeScore : 0;
  const collaborativeLeads = collaborativeSupported && (!tasteSupported || collaborativeContribution > contentContribution);

  // Fixed precedence: collaborative (when it dominates) → taste/onboarding → session → fit → popularity → catalog.
  const tagProse = joinNatural(tasteFeatures.map((f) => proseLabel(f.label)));
  const sessionProse = joinNatural(sessionTags.map((t) => proseLabel(labelFor("tag", t.slug))));
  const fitSentence = `Fits your preference for ${fitParts.join(" ")} projects.`;
  const collaborativeText = collaborativeSupported ? collaborativeSentence(seeds) : "";

  let text: string;
  let primary: ExplanationFactorKind;
  if (collaborativeLeads) {
    primary = "collaborative";
    text = collaborativeText;
    if (tasteSupported) text += ` It also matches your interest in ${tagProse}.`;
    else if (fitSupported) text += ` ${fitSentence}`;
  } else if (tasteSupported && input.coldStart) {
    primary = "onboarding";
    text = `Based on the interests you selected during onboarding: ${tagProse}.`;
    if (fitSupported) text += ` ${fitSentence}`;
  } else if (tasteSupported) {
    primary = "taste";
    text = `Because you like ${tagProse} projects.`;
    if (sessionSupported) text += ` You've also been exploring ${sessionProse} this session.`;
    else if (collaborativeSupported) text += ` ${collaborativeText}`;
    else if (fitSupported) text += ` ${fitSentence}`;
  } else if (sessionSupported) {
    primary = "session";
    text = `You recently explored ${sessionProse} projects in this session.`;
  } else if (fitSupported) {
    primary = "fit";
    text = fitSentence;
  } else if (popularitySupported) {
    primary = "popularity";
    const related = tasteFeatures[0] ? `, and related to your interest in ${proseLabel(tasteFeatures[0].label)}.` : " — a good place to start.";
    text = `Popular with RabbitHole users${related}`;
  } else if (input.contentAffinity > 0 && tasteFeatures[0]) {
    primary = "taste";
    text = `Related to your interest in ${proseLabel(tasteFeatures[0].label)}.`;
    factors.push({ kind: "taste", features: [tasteFeatures[0]], strength: input.contentAffinity });
  } else {
    primary = "catalog";
    text = "From the RabbitHole catalog.";
    factors.push({ kind: "catalog", features: [], strength: 0 });
  }

  return { text, primary, factors };
}
