/**
 * BPR dataset extraction (Phase 10).
 *
 * Preference semantics reuse the production project-state derivation, so BPR
 * sees exactly what the rest of RabbitHole sees:
 *
 *   positive  = current state saved / built / completed / shared
 *               (project-level: repeated events are one positive; SAVE→UNSAVE
 *               is NOT positive — the state was reversed)
 *   explicit negative = current state disliked (DISLIKE events)
 *   known-neutral     = any other touched project (OPEN / IMPRESSION /
 *                       UNSAVE-reversed) — never a positive, never a negative,
 *                       and excluded from the unobserved sampling pool because
 *                       the user has seen it ("known but uncertain")
 *   sampled unobserved negatives = catalogue projects the user never touched
 *               (missing feedback, not proof of dislike — they are sampling
 *               candidates for pairwise learning, not "true negatives")
 *
 * Index mappings sort user ids and project ids ascending so the latent matrix
 * layout is independent of database/Map iteration order.
 */

import { deriveProjectStates } from "@/lib/interactions/project-state";
import { RECOMMENDER_CONFIG } from "../config";
import { fnv1a } from "../evaluation/split";
import type { BprConfig, BprDataset, BprInteraction } from "./types";

export function buildBprDataset(
  interactions: readonly BprInteraction[],
  catalogProjectIds: readonly string[],
  config: BprConfig = RECOMMENDER_CONFIG.bpr,
): BprDataset {
  const projectIds = [...new Set(catalogProjectIds)].sort();
  const projectIndex = new Map(projectIds.map((id, index) => [id, index]));

  // Group chronologically-ordered interactions per user (catalog projects only).
  const byUser = new Map<string, BprInteraction[]>();
  const ordered = [...interactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.projectId.localeCompare(b.projectId));
  for (const interaction of ordered) {
    if (!projectIndex.has(interaction.projectId)) continue;
    const list = byUser.get(interaction.userId);
    if (list) list.push(interaction);
    else byUser.set(interaction.userId, [interaction]);
  }

  const perUser = new Map<string, { positives: number[]; explicitNegatives: number[]; touched: Set<number> }>();
  for (const [userId, rows] of byUser) {
    const positives: number[] = [];
    const explicitNegatives: number[] = [];
    const touched = new Set<number>();
    for (const state of deriveProjectStates(rows).values()) {
      const index = projectIndex.get(state.projectId);
      if (index === undefined) continue;
      touched.add(index);
      if (state.disliked) explicitNegatives.push(index);
      else if (state.completed || state.built || state.saved || state.shared) positives.push(index);
      // opened / impressed / unsaved-reversed projects stay known-neutral.
    }
    if (positives.length > 0) perUser.set(userId, { positives: positives.sort((a, b) => a - b), explicitNegatives: explicitNegatives.sort((a, b) => a - b), touched });
  }

  const userIds = [...perUser.keys()].sort();
  const allIndices = projectIds.map((_, index) => index);
  const positives: number[][] = [];
  const explicitNegatives: number[][] = [];
  const unobserved: number[][] = [];
  let positiveCount = 0;
  let explicitNegativeCount = 0;
  for (const userId of userIds) {
    const entry = perUser.get(userId)!;
    positives.push(entry.positives);
    explicitNegatives.push(entry.explicitNegatives);
    unobserved.push(allIndices.filter((index) => !entry.touched.has(index)));
    positiveCount += entry.positives.length;
    explicitNegativeCount += entry.explicitNegatives.length;
  }

  const canonical = [
    `seed=${config.seed}`,
    `factors=${config.factors}`,
    `epochs=${config.epochs}`,
    `lr=${config.learningRate}`,
    `reg=${config.regularization}`,
    `spp=${config.samplesPerPositive}`,
    `enp=${config.explicitNegativeProbability}`,
    `init=${config.initScale}`,
    `projects=${projectIds.join(",")}`,
    ...userIds.map((userId, index) => `${userId}+${positives[index]!.join(",")}-${explicitNegatives[index]!.join(",")}`),
  ].join("|");

  return {
    userIds,
    projectIds,
    positives,
    explicitNegatives,
    unobserved,
    positiveCount,
    explicitNegativeCount,
    fingerprint: fnv1a(canonical).toString(16).padStart(8, "0"),
  };
}
