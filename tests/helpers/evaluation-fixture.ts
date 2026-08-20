import type { InteractionType } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { evaluationExclusions } from "@/lib/recommender/evaluation/split";
import type { EvaluationCase, EvaluationDataset, EvaluationInteraction, EvaluationUser } from "@/lib/recommender/evaluation/types";
import { catalogFixture } from "./catalog-fixture";

/** The seeded catalog as evaluation projects (ids = slugs for readability). */
export const EVAL_CATALOG = catalogFixture();

export const T0 = new Date("2026-06-01T00:00:00.000Z");
export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

export type Row = [userId: string, slug: string, type: InteractionType, minutes: number, sessionId?: string];

/** Rows → chronological EvaluationInteractions with deterministic ids. */
export function interactionsFrom(rows: readonly Row[]): EvaluationInteraction[] {
  return rows.map(([userId, slug, type, minutes, sessionId], index) => ({
    id: `e${String(index).padStart(4, "0")}`,
    userId,
    projectId: slug,
    sessionId: sessionId ?? `${userId}-s1`,
    type,
    createdAt: at(minutes),
  }));
}

export function user(id: string, explorationPreference = 0.35): EvaluationUser {
  return { id, handle: id, explorationPreference };
}

export function datasetFrom(users: readonly EvaluationUser[], rows: readonly Row[]): EvaluationDataset {
  return { catalog: EVAL_CATALOG, interactions: interactionsFrom(rows), users };
}

/**
 * Hand-built evaluation case for baseline tests: training = every row (they are
 * all pre-cutoff by construction), exclusions/universe derived exactly like the
 * real splitter.
 */
export function makeCase(options: {
  userId: string;
  rows: readonly Row[];
  heldOut: readonly string[];
  cutoffMinutes: number;
  evaluationSessionId?: string;
  explorationPreference?: number;
}): EvaluationCase {
  const trainingInteractions = interactionsFrom(options.rows);
  const cutoff = at(options.cutoffMinutes);
  for (const interaction of trainingInteractions) {
    if (interaction.createdAt.getTime() >= cutoff.getTime()) throw new Error("fixture error: training row at/after cutoff");
  }
  const targetTraining = trainingInteractions.filter((interaction) => interaction.userId === options.userId);
  const evaluationSessionId = options.evaluationSessionId ?? `${options.userId}-s1`;
  const excludedProjectIds = evaluationExclusions(targetTraining, RECOMMENDER_CONFIG.evaluation);
  return {
    userId: options.userId,
    handle: options.userId,
    explorationPreference: options.explorationPreference ?? 0.35,
    cutoff,
    heldOut: options.heldOut,
    trainingInteractions,
    targetTraining,
    evaluationSessionId,
    sessionTraining: targetTraining.filter((interaction) => interaction.sessionId === evaluationSessionId),
    excludedProjectIds,
    universe: EVAL_CATALOG.filter((project) => !excludedProjectIds.has(project.id)).map((project) => project.id),
    trainingPositiveProjects: new Set(
      targetTraining
        .filter((interaction) => (RECOMMENDER_CONFIG.evaluation.positiveTypes as readonly string[]).includes(interaction.type))
        .map((interaction) => interaction.projectId),
    ).size,
  };
}

export function algorithmInputFor(evaluationCase: EvaluationCase) {
  return {
    evaluationCase,
    catalog: EVAL_CATALOG,
    catalogById: new Map(EVAL_CATALOG.map((project) => [project.id, project])),
    k: RECOMMENDER_CONFIG.evaluation.primaryK,
    config: RECOMMENDER_CONFIG.evaluation,
  };
}
