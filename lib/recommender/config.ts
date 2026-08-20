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

  /**
   * Session handling and adaptive long-term/session blending (Phase 6).
   *
   *   evidence           = Σ |interactionWeight| over the session's meaningful interactions
   *                        (zero-weight impressions ignored; each (project, type) pair counted once)
   *   evidenceConfidence = evidence / (evidence + evidenceHalfSaturation)
   *   coherence          = Σ top-K |tag signals| / Σ all |tag signals|         (session profile, K = coherenceTopFeatures)
   *   confidence         = evidenceConfidence × (coherenceFloor + (1 − coherenceFloor) × coherence)
   *   blendWeight        = maxBlendWeight × confidence
   *   effectiveProfile   = normalise((1 − blendWeight) × longTerm + blendWeight × session)
   *
   * The session ranking component's raw weight is rankingWeights.session × confidence.
   */
  session: {
    /** A new session starts after this much inactivity. */
    timeoutMinutes: 30,
    /** Evidence at which evidenceConfidence reaches 0.5 (≈ two SAVEs, or one BUILD). */
    evidenceHalfSaturation: 4,
    /** Number of strongest tag features whose share of the session's tag mass defines coherence. */
    coherenceTopFeatures: 3,
    /** Share of confidence granted even to a completely diffuse session (evidence is still required). */
    coherenceFloor: 0.5,
    /** Upper bound of the session's share of the effective profile — long-term taste always keeps the majority. */
    maxBlendWeight: 0.45,
    /** Positive session features exposed in diagnostics / the "This session" indicator. */
    topFeatureCount: 5,
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
    /** Session affinity (cosine with the session profile) needed before "you've been exploring…" is claimed. */
    minSessionAffinity: 0.25,
    /** Session confidence needed before any session wording appears (one weak OPEN stays below it). */
    minSessionConfidence: 0.15,
    /** Session confidence at which session wording may lead even when long-term taste also matches. */
    strongSessionConfidence: 0.4,
    /** Popularity score needed before "popular with RabbitHole users" is claimed. */
    minPopularity: 0.5,
    /** Collaborative score needed before "people who liked … also liked this" is claimed. */
    minCollaborative: 0.3,
    /** Novelty needed before exploration wording ("a bit of a wildcard…") is used. */
    minNovelty: 0.55,
    /** Underexposure needed to call a project "less commonly explored". */
    minUnderexposure: 0.6,
    /** Adjacency needed to call a project "an adjacent area". */
    minAdjacency: 0.5,
    maxFeaturesPerSentence: 2,
  },

  /** "Similar projects" on the detail page (project-to-project cosine). */
  similarProjects: {
    count: 5,
  },

  /**
   * Base ranking weights at exploration preference 0 (Familiar). Per request
   * they are shifted by `exploration.weightSlopes × preference`, clamped at 0
   * and renormalised over the components available for the user, so they do
   * not need to sum to 1 here. `session` is the *maximum* raw session weight:
   * the effective raw weight is `session × sessionConfidence` (0 without a
   * meaningful session, approaching 0.10 for a strong coherent one).
   *   score = Σ weight[c] * normalisedScore[c]
   */
  rankingWeights: {
    content: 0.45,
    collaborative: 0.25,
    session: 0.1,
    novelty: 0.05,
    popularity: 0.1,
  } satisfies RankingWeights,

  /**
   * Exploration ↔ exploitation control (0 = familiar, 1 = adventurous).
   *
   * Ranking weights move linearly with the preference `e`:
   *   weight[c] = max(0, rankingWeights[c] + weightSlopes[c] * e)
   * i.e. content 0.45 → 0.30, collaborative 0.25 → 0.20, novelty 0.05 → 0.35,
   * popularity 0.10 → 0.10 between Familiar and Adventurous (before
   * renormalisation over available components).
   */
  exploration: {
    defaultPreference: 0.35,
    minPreference: 0,
    maxPreference: 1,
    weightSlopes: {
      content: -0.15,
      collaborative: -0.05,
      session: 0,
      novelty: 0.3,
      popularity: 0,
    } satisfies RankingWeights,
    /**
     * Exploration retrieval:
     *   plausibility     = max(positive content affinity, collaborative score)  (popularity when neither exists)
     *   explorationScore = (1 - e) * plausibility + e * (noveltyWeight * novelty + plausibilityWeight * plausibility)
     *   limit            = round(minCandidates + e * (maxCandidates - minCandidates))
     */
    retrieval: {
      minCandidates: 8,
      maxCandidates: 15,
      /** Candidates need at least this much plausibility to count as exploration (never random). */
      minPlausibility: 0.05,
      noveltyWeight: 0.65,
      plausibilityWeight: 0.35,
    },
    /** Preference at or above which explanations may mention "adventurous discovery mode". */
    adventurousThreshold: 0.6,
    /** Preference labels for the UI. */
    labels: { familiarMax: 0.3, adventurousMin: 0.7 },
  },

  /**
   * Novelty (a ranking feature in [0, 1], computed for every candidate):
   *   underexposure = 1 - popularityScore
   *   adjacency     = 4 · x · (1 - x)   with x = clamp01(contentAffinity)  (negative affinity → 0)
   *   novelty       = underexposureWeight · underexposure + adjacencyWeight · adjacency
   */
  novelty: {
    underexposureWeight: 0.65,
    adjacencyWeight: 0.35,
  },

  /**
   * Post-ranking diversification (maximal marginal relevance):
   *   mmr(c) = lambda · relevance(c) − (1 − lambda) · maxSimilarityToSelected(c)
   *   lambda = clamp(lambdaBase + lambdaSlope · e, lambdaMin, lambdaMax)
   * plus a soft tag-share cap:
   *   maxTagShare = tagShareBase + tagShareSlope · e   (per tag, of the requested limit; at least minTagCount)
   * that is relaxed deterministically when the pool is too narrow to fill the list.
   */
  diversity: {
    lambdaBase: 0.9,
    lambdaSlope: -0.2,
    lambdaMin: 0.5,
    lambdaMax: 0.95,
    /** Project-project cosine at or above which items are treated as near-duplicates. */
    nearDuplicateSimilarity: 0.9,
    tagShareBase: 0.45,
    tagShareSlope: -0.15,
    minTagCount: 2,
    /**
     * Relevance band: at each pick only candidates whose recommendation score is
     * at least this fraction of the best remaining score can be chosen, so
     * diversity re-orders comparably good projects but never lifts a much
     * weaker one. Constraints (tag cap, near-duplicates) are relaxed for a pick
     * when no band candidate satisfies them.
     */
    alternativeQualityRatio: 0.8,
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
    /** Record a RecommendationRun (+ its final results) for every user-facing feed generation. */
    persistRuns: true,
    /** Older runs beyond this count are pruned per user to avoid data explosion. */
    maxRunsPerUser: 25,
    /** Recent runs listed on /insights and in GET /api/insights. */
    recentRuns: 10,
  },

  /**
   * Offline evaluation (`npm run evaluate`) — chronological unseen-item holdout.
   *
   * Ground truth = unique projects with a strong-positive event (SAVE / BUILD /
   * COMPLETE / SHARE; never IMPRESSION or DISLIKE, and OPEN is context only).
   * Per user the latest-discovered positives are held out (cutoff = the user's
   * first interaction of any kind with the earliest held-out project, so no
   * held-out project has any pre-cutoff interaction); everything at/after the
   * cutoff — the target user's and every other user's — is invisible to training.
   */
  evaluation: {
    /** Ranking metric cutoffs (Precision/Recall at each K). */
    ks: [5, 10],
    /** K for NDCG / HitRate / coverage / diversity / novelty and the recommendation lists. */
    primaryK: 10,
    /** Interaction types that define held-out relevance (strong positives only). */
    positiveTypes: ["SAVE", "BUILD", "COMPLETE", "SHARE"] satisfies InteractionType[],
    /** Users need at least this many unique strong-positive projects to be evaluated. */
    minPositiveProjects: 5,
    /** Held-out unique projects per user: clamp(round(fraction × positives), min, max). */
    holdoutFraction: 0.2,
    minHoldout: 1,
    maxHoldout: 3,
    /** After the split, training must still contain this many unique positive projects. */
    minTrainingPositives: 2,
    /** Held-out projects must be completely unseen (no target-user interaction) before the cutoff. */
    unseenTargetsOnly: true,
    /** Seed for the deterministic random baseline and the split fingerprint hash. */
    seed: 20260818,
  },

  /**
   * Bayesian Personalized Ranking experiment (Phase 10) — OFFLINE ONLY.
   * The live recommender remains the heuristic hybrid; BPR exists as a
   * reproducible latent-factor experiment trained by `npm run train:bpr` and
   * compared through `npm run evaluate`.
   *
   *   score(u, i)  = p_u · q_i
   *   objective    = maximise Σ log σ(score(u,i) − score(u,j)) − λ‖Θ‖²
   *   positives    = unique projects whose current state is saved/built/completed/shared
   *   negatives    = explicit DISLIKE states + sampled never-touched projects
   *
   * Hyperparameters were fixed a priori (before looking at held-out metrics);
   * they are experiment constants, not tuned values.
   */
  bpr: {
    /** Latent dimensions per user/project vector. */
    factors: 16,
    epochs: 80,
    learningRate: 0.05,
    /** L2 regularisation applied to every updated vector. */
    regularization: 0.01,
    /** Sampled (u, i, j) pairs per positive project per epoch. */
    samplesPerPositive: 1,
    /** Probability of drawing an explicit DISLIKE negative when the user has any. */
    explicitNegativeProbability: 0.5,
    /** Seeded-uniform initialisation range: [-initScale, +initScale). */
    initScale: 0.05,
    /** Deterministic training seed (combined with user/cutoff for evaluation models). */
    seed: 20260820,
    /** Serialised artifact schema version. */
    artifactVersion: 1,
    /** Experimental offline blend: (1 − w)·hybridScore + w·normalisedBprScore. Fixed a priori. */
    hybridBlendWeight: 0.2,
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
