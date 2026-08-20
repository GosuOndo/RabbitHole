/**
 * Bayesian Personalized Ranking (Phase 10 experiment) — contracts.
 *
 * Pure data structures only; nothing here touches Prisma, React or routes.
 * The model is the classic matrix-factorisation BPR: score(u, i) = p_u · q_i,
 * trained with pairwise SGD on (user, positive, negative) triples.
 */

import type { InteractionType } from "@/generated/prisma/enums";

/** BPR hyperparameters/constants (RECOMMENDER_CONFIG.bpr satisfies this shape). */
export interface BprConfig {
  factors: number;
  epochs: number;
  learningRate: number;
  regularization: number;
  samplesPerPositive: number;
  explicitNegativeProbability: number;
  initScale: number;
  seed: number;
  artifactVersion: number;
  hybridBlendWeight: number;
}

/** Minimal interaction shape the dataset builder needs (chronological order matters for state derivation). */
export interface BprInteraction {
  userId: string;
  projectId: string;
  type: InteractionType;
  createdAt: Date;
}

/**
 * Deterministic training dataset. Index mappings are sorted (users by id,
 * projects by id) so latent-matrix rows never depend on Map/DB iteration order.
 */
export interface BprDataset {
  /** Users with at least one strong-positive project, sorted ascending. */
  userIds: string[];
  /** The full training-time project catalogue, sorted ascending. */
  projectIds: string[];
  /** Per user index: positive project indices (unique, sorted). */
  positives: number[][];
  /** Per user index: explicit DISLIKE project indices (unique, sorted). */
  explicitNegatives: number[][];
  /**
   * Per user index: sampled-unobserved pool — catalogue projects the user has
   * NEVER interacted with in any way (impressions and opens mark a project as
   * "known but uncertain" and keep it out of this pool; they are never
   * negatives themselves).
   */
  unobserved: number[][];
  /** Σ positives across users (pairs per epoch = this × samplesPerPositive). */
  positiveCount: number;
  explicitNegativeCount: number;
  /** Deterministic fingerprint over mappings, preference sets and config (no timestamps). */
  fingerprint: string;
}

export interface BprEpochDiagnostics {
  epoch: number;
  pairs: number;
  /** Mean of -log σ(x_uij) over the epoch's sampled pairs (before each update). */
  meanLoss: number;
  /** Fraction of sampled pairs already ranked correctly (x_uij > 0) before the update. */
  pairwiseAccuracy: number;
}

export interface BprModel {
  version: number;
  factors: number;
  userIds: string[];
  projectIds: string[];
  /** userFactors[userIndex][factor] */
  userFactors: number[][];
  /** itemFactors[projectIndex][factor] */
  itemFactors: number[][];
  /** Hyperparameters + seed key the model was trained with. */
  training: {
    seedKey: string;
    epochs: number;
    learningRate: number;
    regularization: number;
    samplesPerPositive: number;
    explicitNegativeProbability: number;
    initScale: number;
  };
  dataFingerprint: string;
  diagnostics: BprEpochDiagnostics[];
}

/** Serialised artifact (data/generated/bpr-model.json). */
export interface BprArtifact extends BprModel {
  /** Informational only — excluded from the deterministic checksum. */
  createdAt: string;
  /** fnv1a checksum over the deterministic model content. */
  checksum: string;
}
