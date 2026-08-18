/**
 * Core data contracts shared by every recommender stage.
 *
 * Retrieval, ranking, session adjustment, diversification and explanation are
 * separate modules; these types are the interfaces between them. Keeping them
 * here means a later experiment (embeddings, matrix factorisation, a learned
 * ranker) can swap one stage without touching the others.
 */

import type { Difficulty, InteractionType } from "@/generated/prisma/enums";

/** Retrieval strategies that can surface a candidate. */
export const CANDIDATE_SOURCES = ["content", "collaborative", "popular", "exploration"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** Score components combined by the ranker. Every component is normalised to [0, 1]. */
export const SCORE_COMPONENTS = ["content", "collaborative", "session", "novelty", "popularity"] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

export type RankingWeights = Record<ScoreComponent, number>;
export type ScoreBreakdown = Record<ScoreComponent, number>;

/**
 * Sparse feature vector. Keys are namespaced feature ids such as
 * `tag:systems`, `lang:rust`, `difficulty:advanced`, `duration:weekend`.
 */
export type FeatureVector = Readonly<Record<string, number>>;

/** Minimal project shape the recommender needs (decoupled from Prisma rows). */
export interface CatalogProject {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  estimatedHours: number;
  /** Deterministic seed prior in [0, 1]. */
  popularity: number;
  tagSlugs: readonly string[];
  languageSlugs: readonly string[];
}

/** Minimal interaction shape used by profile building, CF and evaluation. */
export interface InteractionEvent {
  userId: string;
  projectId: string;
  sessionId: string;
  type: InteractionType;
  weight: number;
  createdAt: Date;
}

/** Output of candidate retrieval; one entry per (project, source) before merging. */
export interface RetrievedCandidate {
  projectId: string;
  source: CandidateSource;
  /** Raw, un-normalised retrieval signal (e.g. cosine similarity, CF score). */
  signal: number;
}

/** A merged candidate: one per project, keeping every contributing source. */
export interface Candidate {
  projectId: string;
  sources: CandidateSource[];
  /** Raw retrieval signal per source that surfaced the project. */
  signals: Partial<Record<CandidateSource, number>>;
}

/** Real counts recorded by the pipeline for the Insights page. */
export interface PipelineStats {
  contentCandidates: number;
  collaborativeCandidates: number;
  popularCandidates: number;
  explorationCandidates: number;
  uniqueCandidates: number;
  afterFiltering: number;
  ranked: number;
  final: number;
}
