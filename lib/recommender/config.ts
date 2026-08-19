/**
 * Central recommender configuration.
 *
 * Every tunable number used by the recommendation pipeline lives here so that
 * behaviour can be reasoned about (and changed) in one place. Values are
 * heuristics, not scientific truth; the tests and the offline evaluation
 * (`npm run evaluate`) are the way to judge changes.
 */

import type { DurationPreference, InteractionType } from "@/generated/prisma/enums";
import type { CandidateSource, RankingWeights } from "./types";

export const RECOMMENDER_CONFIG = {
  /**
   * Interaction weights. The interaction *type* stays authoritative everywhere
   * (filtering, evaluation labels, CF positives); the weight is only the
   * magnitude used when aggregating signals into a profile.
   */
  interactionWeights: {
    IMPRESSION: 0,
    OPEN: 0.5,
    SAVE: 2,
    UNSAVE: -1,
    DISLIKE: -3,
    BUILD: 4,
    COMPLETE: 5,
    SHARE: 3,
  } satisfies Record<InteractionType, number>,

  /**
   * Time decay for long-term profile signals:
   *   signal = interactionWeight * 0.5 ** (ageDays / halfLifeDays)
   * Interactions older than `historyWindowDays` are not loaded at all.
   */
  timeDecay: {
    halfLifeDays: 30,
    historyWindowDays: 365,
  },

  /**
   * How project attributes are turned into profile / content features.
   * Feature ids are namespaced: `tag:<slug>`, `lang:<slug>`,
   * `difficulty:<level>`, `duration:<bucket>`.
   */
  profile: {
    /**
     * Value of each feature family in a project's feature vector. Every tag
     * carries the full tag weight; languages share the language weight equally
     * (a project listing five languages says little about any one of them);
     * difficulty and duration are single features.
     */
    featureFamilyWeights: {
      tag: 1.0,
      language: 0.5,
      difficulty: 0.35,
      duration: 0.35,
    },
    /** Number of strongest features surfaced in explanations / insights. */
    topFeatureCount: 5,
  },

  /**
   * Explicit onboarding signals added to the long-term profile (they are not
   * fake interactions and do not decay). Magnitudes are deliberately modest —
   * a topic selection is worth about one SAVE — so real behaviour takes over
   * quickly.
   */
  onboarding: {
    minTopics: 3,
    maxTopics: 7,
    /** Per selected topic, scaled by the topic → tag mapping weight. */
    topicSignal: 2.0,
    /** Applied to every feature of a project chosen in a pairwise comparison. */
    pairwiseChosenSignal: 1.5,
    /** Applied to every feature of the rejected project (a mild negative). */
    pairwiseRejectedSignal: -0.5,
    /** Added to `difficulty:<pref>` unless "surprise me". */
    difficultySignal: 1.0,
    /** Added to `duration:<pref>` unless "anything". */
    durationSignal: 1.0,
  },

  /** Session handling and long-term/session profile blending. */
  session: {
    /** A new session starts after this much inactivity. */
    timeoutMinutes: 30,
    /**
     * effectiveProfile = (1 - w) * longTerm + w * session, where
     * w = min(maxWeight, baseWeight * min(1, n / fullWeightInteractionCount) + coherenceBonus * coherence).
     * `n` is the number of session interactions and `coherence` in [0, 1]
     * measures how focused the session is on a theme.
     */
    baseWeight: 0.25,
    fullWeightInteractionCount: 5,
    coherenceBonus: 0.1,
    maxWeight: 0.4,
  },

  /** How many candidates each retrieval strategy contributes. */
  candidateCounts: {
    content: 50,
    collaborative: 30,
    popular: 15,
    exploration: 15,
  } satisfies Record<CandidateSource, number>,

  /** Retrieval-stage thresholds. */
  retrieval: {
    /** Content candidates need at least this cosine affinity with the effective profile. */
    minContentAffinity: 0.01,
  },

  /**
   * Popularity = priorWeight * seedPrior + behaviorWeight * behavioralScore, where
   * behavioralScore = log1p(Σ positive interaction weights on the project) / max over catalog.
   * The log tames heavy tails from synthetic users; both terms live in [0, 1].
   */
  popularity: {
    priorWeight: 0.4,
    behaviorWeight: 0.6,
  },

  /**
   * Cold start: profiles with fewer weighted interactions than this are "cold";
   * popularity gets a heavier hand so a thin profile does not over-fit, while
   * onboarding-derived content still orders the feed.
   */
  coldStart: {
    maxInteractions: 3,
    /** Multiplies the popularity ranking weight before renormalisation. */
    popularityWeightMultiplier: 3,
  },

  /**
   * Item-item collaborative filtering.
   *
   *   signal(user, project)  = current-state positive evidence (see collaborative.ts)
   *   sim(i, j)              = cosine(v_i, v_j) × overlap / (overlap + shrinkage)
   *   evidence(candidate)    = Σ_seeds sim(seed, candidate) × seedWeight
   *   score(candidate)       = evidence / max evidence × confidence,
   *   confidence             = min(1, Σ seedWeight / fullConfidenceSeedWeight)
   */
  collaborative: {
    /** Dampens similarities backed by only a handful of overlapping users. */
    shrinkage: 2,
    /** Neighbours kept per item after similarity computation. */
    neighboursPerItem: 20,
    /** Σ seed weights at which a user's collaborative evidence is fully trusted (≈ one BUILD + one SAVE). */
    fullConfidenceSeedWeight: 6,
    /** Candidates below this normalised score are dropped from collaborative retrieval. */
    minCandidateScore: 0.02,
  },

  /** Deterministic explanation thresholds. */
  explanation: {
    /** Content affinity needed before "because you like…" is claimed. */
    minContentAffinity: 0.2,
    /** Session affinity needed before "you recently explored…" is claimed. */
    minSessionAffinity: 0.25,
    /** Popularity score needed before "popular with RabbitHole users" is claimed. */
    minPopularity: 0.5,
    /** Collaborative score needed before "people who liked … also liked this" is claimed. */
    minCollaborative: 0.3,
    maxFeaturesPerSentence: 2,
  },

  /** "Similar projects" on the detail page (project-to-project cosine). */
  similarProjects: {
    count: 5,
  },

  /**
   * Base ranking weights (sum to 1). Adjusted per request by the user's
   * exploration preference (see `exploration.weightSlopes`).
   *   finalScore = Σ weight[c] * normalisedScore[c]
   */
  rankingWeights: {
    content: 0.45,
    collaborative: 0.25,
    session: 0.1,
    novelty: 0.1,
    popularity: 0.1,
  } satisfies RankingWeights,

  /** Exploration ↔ exploitation control (0 = familiar, 1 = adventurous). */
  exploration: {
    defaultPreference: 0.35,
    minPreference: 0,
    maxPreference: 1,
    /**
     * Ranking weights are shifted linearly around `weightPivot`:
     *   weight[c] = base[c] + slope[c] * (preference - weightPivot)
     * then clamped at 0 and renormalised to sum to 1. At preference = 1 the
     * novelty weight therefore rises by ~0.125 while content/collaborative fall.
     */
    weightPivot: 0.5,
    weightSlopes: {
      content: -0.2,
      collaborative: -0.1,
      session: 0,
      novelty: 0.25,
      popularity: 0.05,
    } satisfies RankingWeights,
  },

  /** Post-ranking diversification (maximal-marginal-relevance style). */
  diversity: {
    /** diversifiedScore = relevance - lambda * maxSimilarityToSelected */
    lambda: 0.3,
    /** Hard cap on results sharing the same dominant tag in the final list. */
    maxItemsPerDominantTag: 3,
    /** Lists shorter than this are returned unchanged. */
    minListLengthToDiversify: 3,
  },

  /** Candidate filtering rules. */
  filtering: {
    /** Projects with any of these interactions never re-enter the discovery feed. */
    excludedInteractionTypes: ["DISLIKE", "BUILD", "COMPLETE"] satisfies InteractionType[],
    /** Saved projects stay eligible but are demoted so they do not dominate. */
    savedProjectScoreMultiplier: 0.6,
  },

  /** Recommendation feed request limits. */
  feed: {
    defaultLimit: 10,
    maxLimit: 30,
  },

  /** Recommendation run diagnostics (Insights page). */
  diagnostics: {
    persistRuns: true,
    /** Older runs beyond this count are pruned per user to avoid data explosion. */
    maxRunsPerUser: 25,
  },

  /** Offline evaluation settings (`npm run evaluate`). */
  evaluation: {
    ks: [5, 10],
    /** Users need at least this many positive interactions to be evaluated. */
    minPositiveInteractions: 3,
    /** Number of most-recent positive interactions held out per user. */
    holdoutPositives: 1,
    seed: 20260818,
  },

  /**
   * Duration buckets used for onboarding preferences, content features and
   * UI labels. Upper bounds are inclusive; ANYTHING matches everything.
   */
  durationBuckets: {
    UNDER_2_HOURS: { maxHours: 2, label: "Under 2 hours" },
    ONE_EVENING: { maxHours: 5, label: "One evening" },
    WEEKEND: { maxHours: 20, label: "Weekend" },
    ONE_TO_TWO_WEEKS: { maxHours: 80, label: "1–2 weeks" },
    ANYTHING: { maxHours: Number.POSITIVE_INFINITY, label: "Anything" },
  } satisfies Record<DurationPreference, { maxHours: number; label: string }>,
} as const;

export type RecommenderConfig = typeof RECOMMENDER_CONFIG;

/** Weight lookup that keeps the interaction type authoritative. */
export function interactionWeight(type: InteractionType): number {
  return RECOMMENDER_CONFIG.interactionWeights[type];
}

/** Interaction types treated as positive evidence for CF and evaluation. */
export const POSITIVE_INTERACTION_TYPES: readonly InteractionType[] = ["OPEN", "SAVE", "BUILD", "COMPLETE", "SHARE"];

/** Strong positives (used for evaluation labels and BPR positives). */
export const STRONG_POSITIVE_INTERACTION_TYPES: readonly InteractionType[] = ["SAVE", "BUILD", "COMPLETE", "SHARE"];
