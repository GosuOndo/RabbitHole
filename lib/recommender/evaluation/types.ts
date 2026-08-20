/**
 * Contracts of the offline evaluation framework (Phase 8).
 *
 * Everything here is pure data: the runner receives an in-memory
 * `EvaluationDataset` (loaded once by the CLI), builds deterministic
 * chronological splits, runs every algorithm over the *same* splits and
 * aggregates metrics. Nothing in `lib/recommender/evaluation` touches Prisma
 * or the Phase 7 diagnostics tables.
 */

import type { InteractionType } from "@/generated/prisma/enums";
import type { RECOMMENDER_CONFIG } from "../config";
import type { ProjectVector } from "../types";

export type EvaluationConfig = typeof RECOMMENDER_CONFIG.evaluation;

/** One behavioural event (all users, all types), as loaded from the database. */
export interface EvaluationInteraction {
  id: string;
  userId: string;
  projectId: string;
  sessionId: string;
  type: InteractionType;
  createdAt: Date;
}

export interface EvaluationUser {
  id: string;
  handle: string;
  explorationPreference: number;
}

/** The in-memory dataset the whole evaluation runs on (read-only). */
export interface EvaluationDataset {
  catalog: readonly ProjectVector[];
  /** Chronologically ordered (createdAt asc, id asc) interactions of every user. */
  interactions: readonly EvaluationInteraction[];
  /** Users considered for evaluation (seeded synthetic users). */
  users: readonly EvaluationUser[];
}

export type SkipReason =
  | "insufficient strong-positive projects"
  | "insufficient training positives after cutoff"
  | "no training interactions before cutoff";

/** One user's deterministic chronological split — shared by every algorithm. */
export interface EvaluationCase {
  userId: string;
  handle: string;
  explorationPreference: number;
  /** Training/test boundary: the target user's first-ever interaction with the earliest held-out project. */
  cutoff: Date;
  /** Unique held-out relevant project ids (project-level ground truth, unseen before the cutoff). */
  heldOut: readonly string[];
  /** Every user's interactions strictly before the cutoff (the only training data any model may see). */
  trainingInteractions: readonly EvaluationInteraction[];
  /** The target user's own training interactions (subset of the above). */
  targetTraining: readonly EvaluationInteraction[];
  /** Session the user was in at the evaluation moment (session of the first held-out event). */
  evaluationSessionId: string;
  /** Target-user training interactions inside that session (session context; may be empty). */
  sessionTraining: readonly EvaluationInteraction[];
  /** Projects removed from the candidate universe (training-seen positives, training dislikes/terminal states). */
  excludedProjectIds: ReadonlySet<string>;
  /** Eligible candidate project ids (catalog − excluded); identical for every algorithm. */
  universe: readonly string[];
  /** Unique training positive projects (diagnostics). */
  trainingPositiveProjects: number;
}

export interface SplitResult {
  cases: EvaluationCase[];
  skipped: { userId: string; handle: string; reason: SkipReason }[];
  /** Stable fingerprint over (user, cutoff, held-out ids) — proves every algorithm saw the same split. */
  fingerprint: string;
}

export const EVALUATION_ALGORITHMS = [
  "random",
  "popularity",
  "content",
  "collaborative",
  "hybrid",
  "hybrid-session",
  "hybrid-session-diversified",
] as const;
export type EvaluationAlgorithmId = (typeof EVALUATION_ALGORITHMS)[number];

export const ALGORITHM_LABELS: Record<EvaluationAlgorithmId, string> = {
  random: "Random",
  popularity: "Popularity",
  content: "Content Only",
  collaborative: "Collaborative Only",
  hybrid: "Hybrid",
  "hybrid-session": "Hybrid + Session",
  "hybrid-session-diversified": "Hybrid + Session + Diversification",
};

/** Macro-averaged ranking metrics plus list-quality metrics for one algorithm. */
export interface AlgorithmMetrics {
  algorithm: EvaluationAlgorithmId;
  label: string;
  precisionAt5: number;
  precisionAt10: number;
  recallAt5: number;
  recallAt10: number;
  ndcgAt10: number;
  hitRateAt10: number;
  coverage: number;
  diversity: number;
  novelty: number;
}

/** Per-user, per-algorithm detail (verbose output / tests). */
export interface CaseResult {
  userId: string;
  handle: string;
  recommended: readonly string[];
  hits: readonly string[];
}

export interface EvaluationReport {
  protocol: string;
  seed: number;
  fingerprint: string;
  dataset: {
    projects: number;
    interactions: number;
    usersConsidered: number;
    usersEvaluated: number;
    usersSkipped: number;
    skipReasons: Record<string, number>;
    avgHeldOut: number;
    avgTrainingInteractions: number;
  };
  cases: {
    userId: string;
    handle: string;
    cutoff: string;
    heldOut: readonly string[];
    universeSize: number;
  }[];
  algorithms: AlgorithmMetrics[];
  /** Per-algorithm per-user detail for verbose mode. */
  details: Record<EvaluationAlgorithmId, CaseResult[]>;
  /** Project id → slug (readable verbose output). */
  projectSlugs: Record<string, string>;
}
