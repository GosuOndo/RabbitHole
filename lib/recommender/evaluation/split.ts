/**
 * Deterministic chronological unseen-item holdout (Phase 8).
 *
 * Ground truth is project-level: unique projects with a strong-positive event
 * (SAVE / BUILD / COMPLETE / SHARE). For each eligible user the projects the
 * user *discovered last* (latest first-ever interaction of any type) are held
 * out, and the cutoff T is the earliest first-touch among them. Because every
 * held-out project's first touch is ≥ T, held-out projects have **zero**
 * target-user interactions before the cutoff — recovery is genuine discovery,
 * and nothing about them can leak into profiles, sessions, CF seeds,
 * popularity or filtering.
 *
 * Training data for a case is *every user's* interactions strictly before T
 * (temporal correctness for collaborative/popularity models: nobody learns
 * from the future). The same split object is shared by every algorithm; the
 * fingerprint hash over (user, cutoff, held-out ids) makes that auditable.
 */

import { RECOMMENDER_CONFIG } from "../config";
import type {
  EvaluationCase,
  EvaluationConfig,
  EvaluationDataset,
  EvaluationInteraction,
  SkipReason,
  SplitResult,
} from "./types";
import { deriveProjectStates } from "@/lib/interactions/project-state";
import type { InteractionType } from "@/generated/prisma/enums";

/** FNV-1a 32-bit hash — deterministic, dependency-free (random baseline + fingerprint). */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function isPositiveType(type: InteractionType, config: EvaluationConfig): boolean {
  return (config.positiveTypes as readonly InteractionType[]).includes(type);
}

/** Chronological order: createdAt asc, id asc (stable, deterministic). */
export function chronological(interactions: readonly EvaluationInteraction[]): EvaluationInteraction[] {
  return [...interactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

interface UserSplit {
  cutoff: Date;
  heldOut: string[];
  evaluationSessionId: string;
  trainingPositiveProjects: number;
  reason?: SkipReason;
}

/**
 * Chooses the held-out projects for one user.
 *
 *   positives    = unique projects with ≥1 strong-positive event
 *   eligibility  = |positives| ≥ minPositiveProjects
 *   holdout size = clamp(round(holdoutFraction × |positives|), minHoldout, maxHoldout)
 *   held out     = the holdout-size positives with the LATEST first-touch
 *                  (first interaction of any type by this user)
 *   cutoff T     = earliest first-touch among the held-out projects
 *
 * All held-out projects are therefore unseen before T. The split is rejected
 * (skip) when training would retain fewer than minTrainingPositives unique
 * positive projects strictly before T, or no training interactions at all.
 */
function splitUser(userInteractions: readonly EvaluationInteraction[], config: EvaluationConfig): UserSplit | { reason: SkipReason } {
  const ordered = chronological(userInteractions);
  const firstTouch = new Map<string, EvaluationInteraction>();
  const firstPositive = new Map<string, EvaluationInteraction>();
  for (const interaction of ordered) {
    if (!firstTouch.has(interaction.projectId)) firstTouch.set(interaction.projectId, interaction);
    if (!firstPositive.has(interaction.projectId) && isPositiveType(interaction.type, config)) {
      firstPositive.set(interaction.projectId, interaction);
    }
  }
  const positives = [...firstPositive.keys()];
  if (positives.length < config.minPositiveProjects) return { reason: "insufficient strong-positive projects" };

  const holdoutSize = Math.min(config.maxHoldout, Math.max(config.minHoldout, Math.round(config.holdoutFraction * positives.length)));
  // Latest-discovered positives first (first-touch time desc, project id desc as deterministic tie-break).
  const byDiscovery = [...positives].sort((a, b) => {
    const at = firstTouch.get(a)!.createdAt.getTime();
    const bt = firstTouch.get(b)!.createdAt.getTime();
    return bt - at || b.localeCompare(a);
  });
  const heldOut = byDiscovery.slice(0, holdoutSize).sort();
  const cutoffEvents = heldOut.map((projectId) => firstTouch.get(projectId)!);
  const earliest = cutoffEvents.reduce((min, event) =>
    event.createdAt.getTime() < min.createdAt.getTime() || (event.createdAt.getTime() === min.createdAt.getTime() && event.id < min.id) ? event : min,
  );
  const cutoff = earliest.createdAt;

  const training = ordered.filter((interaction) => interaction.createdAt.getTime() < cutoff.getTime());
  if (training.length === 0) return { reason: "no training interactions before cutoff" };
  const trainingPositiveProjects = new Set(training.filter((i) => isPositiveType(i.type, config)).map((i) => i.projectId)).size;
  if (trainingPositiveProjects < config.minTrainingPositives) return { reason: "insufficient training positives after cutoff" };

  return {
    cutoff,
    heldOut,
    evaluationSessionId: earliest.sessionId,
    trainingPositiveProjects,
  };
}

/**
 * Evaluation candidate exclusions from the target user's TRAINING data only:
 *   - every project with a strong-positive training event (training-seen
 *     positives are excluded — offline next-item evaluation tests discovery),
 *   - every project in a terminal training state (disliked / built / completed,
 *     via the production state semantics).
 * Held-out projects can never appear here (they have no training interactions).
 */
export function evaluationExclusions(targetTraining: readonly EvaluationInteraction[], config: EvaluationConfig = RECOMMENDER_CONFIG.evaluation): Set<string> {
  const excluded = new Set<string>();
  for (const interaction of targetTraining) {
    if (isPositiveType(interaction.type, config)) excluded.add(interaction.projectId);
  }
  for (const state of deriveProjectStates(targetTraining).values()) {
    if (state.excludedFromDiscovery) excluded.add(state.projectId);
  }
  return excluded;
}

/** Stable fingerprint over the whole split (users sorted; no run-time timestamps). */
export function splitFingerprint(cases: readonly Pick<EvaluationCase, "userId" | "cutoff" | "heldOut">[]): string {
  const canonical = [...cases]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((entry) => `${entry.userId}@${entry.cutoff.toISOString()}:${[...entry.heldOut].sort().join(",")}`)
    .join("|");
  return fnv1a(canonical).toString(16).padStart(8, "0");
}

/** Builds every eligible user's case (shared training views, universes, fingerprint). */
export function buildEvaluationSplit(dataset: EvaluationDataset, config: EvaluationConfig = RECOMMENDER_CONFIG.evaluation): SplitResult {
  const ordered = chronological(dataset.interactions);
  const byUser = new Map<string, EvaluationInteraction[]>();
  for (const interaction of ordered) {
    const list = byUser.get(interaction.userId);
    if (list) list.push(interaction);
    else byUser.set(interaction.userId, [interaction]);
  }

  const cases: EvaluationCase[] = [];
  const skipped: SplitResult["skipped"] = [];
  const users = [...dataset.users].sort((a, b) => a.handle.localeCompare(b.handle));
  for (const user of users) {
    const own = byUser.get(user.id) ?? [];
    const split = splitUser(own, config);
    if ("reason" in split && split.reason) {
      skipped.push({ userId: user.id, handle: user.handle, reason: split.reason });
      continue;
    }
    const { cutoff, heldOut, evaluationSessionId, trainingPositiveProjects } = split as UserSplit;
    const cutoffMs = cutoff.getTime();
    // Temporal correctness: EVERY user's training data stops strictly before the cutoff.
    const trainingInteractions = ordered.filter((interaction) => interaction.createdAt.getTime() < cutoffMs);
    const targetTraining = trainingInteractions.filter((interaction) => interaction.userId === user.id);
    const sessionTraining = targetTraining.filter((interaction) => interaction.sessionId === evaluationSessionId);
    const excludedProjectIds = evaluationExclusions(targetTraining, config);
    const universe = dataset.catalog.filter((project) => !excludedProjectIds.has(project.id)).map((project) => project.id);

    // Invariants: held-out targets are unseen, non-excluded, eligible candidates.
    for (const projectId of heldOut) {
      if (targetTraining.some((interaction) => interaction.projectId === projectId)) {
        throw new Error(`split invariant violated: held-out ${projectId} appears in ${user.handle}'s training data`);
      }
      if (excludedProjectIds.has(projectId)) {
        throw new Error(`split invariant violated: held-out ${projectId} was excluded from ${user.handle}'s candidate universe`);
      }
    }

    cases.push({
      userId: user.id,
      handle: user.handle,
      explorationPreference: user.explorationPreference,
      cutoff,
      heldOut,
      trainingInteractions,
      targetTraining,
      evaluationSessionId,
      sessionTraining,
      excludedProjectIds,
      universe,
      trainingPositiveProjects,
    });
  }

  return { cases, skipped, fingerprint: splitFingerprint(cases) };
}
