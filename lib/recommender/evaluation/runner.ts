/**
 * Offline evaluation runner (Phase 8). Pure: dataset in, report out.
 *
 *   projects + interactions → eligible users → chronological splits
 *     → every algorithm over the SAME splits → top-K lists
 *     → Precision / Recall / NDCG / HitRate (macro-averaged)
 *       + catalogue coverage, intra-list diversity, training-popularity novelty
 *     → comparison report (formatted by format.ts, printed by scripts/evaluate.ts)
 *
 * The runner never touches Prisma and never records Phase 7 diagnostics; it
 * also asserts the §54 invariants for every produced list (no duplicates, only
 * universe candidates, list ≤ K, finite metrics).
 */

import { RECOMMENDER_CONFIG } from "../config";
import type { FeatureVector } from "../types";
import {
  ALGORITHM_IMPLEMENTATIONS,
  trainingPositiveCounts,
  trainingPositiveEvidence,
  type AlgorithmInput,
} from "./baselines";
import {
  catalogueCoverage,
  hitAtK,
  intraListDiversity,
  listNovelty,
  macroMean,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from "./metrics";
import { buildEvaluationSplit } from "./split";
import {
  ALGORITHM_LABELS,
  EVALUATION_ALGORITHMS,
  type AlgorithmMetrics,
  type CaseResult,
  type EvaluationAlgorithmId,
  type EvaluationConfig,
  type EvaluationDataset,
  type EvaluationReport,
} from "./types";

/** A clear, actionable evaluation failure (empty catalogue, no eligible users, invariant violations). */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

function assertFinite(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new EvaluationError(`metric ${what} is not finite`);
  return value;
}

export function runEvaluation(dataset: EvaluationDataset, config: EvaluationConfig = RECOMMENDER_CONFIG.evaluation): EvaluationReport {
  if (dataset.catalog.length === 0) throw new EvaluationError("The project catalogue is empty — run `npm run seed` first.");
  if (dataset.users.length === 0) throw new EvaluationError("No users to evaluate — run `npm run seed` to create the synthetic population.");

  const split = buildEvaluationSplit(dataset, config);
  if (split.cases.length === 0) {
    const reasons = split.skipped.map((entry) => `${entry.handle}: ${entry.reason}`).join("; ");
    throw new EvaluationError(`No users qualify for evaluation (${reasons || "no interaction data"}).`);
  }

  const catalogById = new Map(dataset.catalog.map((project) => [project.id, project]));
  const vectors = new Map<string, FeatureVector>(dataset.catalog.map((project) => [project.id, project.vector]));
  const k = config.primaryK;

  // Per-case shared inputs — computed once so every algorithm sees identical training views.
  const caseInputs = split.cases.map((evaluationCase) => {
    const positiveCounts = trainingPositiveCounts(evaluationCase.trainingInteractions, config);
    const maxPositiveCount = Math.max(0, ...positiveCounts.values());
    const input: AlgorithmInput = {
      evaluationCase,
      catalog: dataset.catalog,
      catalogById,
      trainingEvidence: trainingPositiveEvidence(evaluationCase.trainingInteractions),
      k,
      config,
    };
    return { evaluationCase, input, positiveCounts, maxPositiveCount };
  });

  const algorithms: AlgorithmMetrics[] = [];
  const details = {} as Record<EvaluationAlgorithmId, CaseResult[]>;

  for (const algorithm of EVALUATION_ALGORITHMS) {
    const implementation = ALGORITHM_IMPLEMENTATIONS[algorithm];
    const perUser = { p5: [] as number[], p10: [] as number[], r5: [] as number[], r10: [] as number[], ndcg: [] as number[], hit: [] as number[], ild: [] as number[], novelty: [] as number[] };
    const lists: string[][] = [];
    const caseResults: CaseResult[] = [];

    for (const { evaluationCase, input, positiveCounts, maxPositiveCount } of caseInputs) {
      const recommended = implementation(input);

      // §54 invariants for every produced list.
      if (recommended.length > k) throw new EvaluationError(`${algorithm} returned more than ${k} items for ${evaluationCase.handle}`);
      if (new Set(recommended).size !== recommended.length) throw new EvaluationError(`${algorithm} returned duplicates for ${evaluationCase.handle}`);
      const universe = new Set(evaluationCase.universe);
      for (const projectId of recommended) {
        if (!universe.has(projectId)) throw new EvaluationError(`${algorithm} recommended excluded project ${projectId} for ${evaluationCase.handle}`);
      }
      if (evaluationCase.heldOut.length === 0) throw new EvaluationError(`case for ${evaluationCase.handle} has an empty held-out set`);

      const relevant = new Set(evaluationCase.heldOut);
      perUser.p5.push(precisionAtK(recommended, relevant, 5));
      perUser.p10.push(precisionAtK(recommended, relevant, 10));
      perUser.r5.push(recallAtK(recommended, relevant, 5));
      perUser.r10.push(recallAtK(recommended, relevant, 10));
      perUser.ndcg.push(ndcgAtK(recommended, relevant, 10));
      perUser.hit.push(hitAtK(recommended, relevant, 10));
      perUser.ild.push(intraListDiversity(recommended, vectors));
      perUser.novelty.push(listNovelty(recommended, positiveCounts, maxPositiveCount));
      lists.push([...recommended]);
      caseResults.push({
        userId: evaluationCase.userId,
        handle: evaluationCase.handle,
        recommended,
        hits: recommended.filter((projectId) => relevant.has(projectId)),
      });
    }

    algorithms.push({
      algorithm,
      label: ALGORITHM_LABELS[algorithm],
      precisionAt5: assertFinite(macroMean(perUser.p5), "P@5"),
      precisionAt10: assertFinite(macroMean(perUser.p10), "P@10"),
      recallAt5: assertFinite(macroMean(perUser.r5), "R@5"),
      recallAt10: assertFinite(macroMean(perUser.r10), "R@10"),
      ndcgAt10: assertFinite(macroMean(perUser.ndcg), "NDCG@10"),
      hitRateAt10: assertFinite(macroMean(perUser.hit), "Hit@10"),
      coverage: assertFinite(catalogueCoverage(lists, dataset.catalog.length), "coverage"),
      diversity: assertFinite(macroMean(perUser.ild), "diversity"),
      novelty: assertFinite(macroMean(perUser.novelty), "novelty"),
    });
    details[algorithm] = caseResults;
  }

  const skipReasons: Record<string, number> = {};
  for (const entry of split.skipped) skipReasons[entry.reason] = (skipReasons[entry.reason] ?? 0) + 1;

  return {
    protocol: "chronological unseen-item holdout (strong positives: SAVE/BUILD/COMPLETE/SHARE)",
    seed: config.seed,
    fingerprint: split.fingerprint,
    dataset: {
      projects: dataset.catalog.length,
      interactions: dataset.interactions.length,
      usersConsidered: dataset.users.length,
      usersEvaluated: split.cases.length,
      usersSkipped: split.skipped.length,
      skipReasons,
      avgHeldOut: macroMean(split.cases.map((entry) => entry.heldOut.length)),
      avgTrainingInteractions: macroMean(split.cases.map((entry) => entry.targetTraining.length)),
    },
    cases: split.cases.map((entry) => ({
      userId: entry.userId,
      handle: entry.handle,
      cutoff: entry.cutoff.toISOString(),
      heldOut: entry.heldOut,
      universeSize: entry.universe.length,
    })),
    algorithms,
    details,
    projectSlugs: Object.fromEntries(dataset.catalog.map((project) => [project.id, project.slug])),
  };
}
