/**
 * BPR scoring and ranking (Phase 10). Pure lookups over a trained model.
 *
 * Cold start is explicit: a user or project the model was not trained on has
 * no learned vector, so `scoreBpr` returns null — never a fabricated 0 or a
 * random factor invented at recommendation time. The caller decides candidate
 * eligibility; the model never applies product exclusions itself.
 */

import type { BprModel } from "./types";

export interface IndexedBprModel {
  model: BprModel;
  userIndex: Map<string, number>;
  projectIndex: Map<string, number>;
}

/** Precomputes id → index lookups (build once, score many). */
export function indexBprModel(model: BprModel): IndexedBprModel {
  return {
    model,
    userIndex: new Map(model.userIds.map((id, index) => [id, index])),
    projectIndex: new Map(model.projectIds.map((id, index) => [id, index])),
  };
}

/** p_u · q_i, or null when the user/project is not represented in the trained model. */
export function scoreBpr(indexed: IndexedBprModel, userId: string, projectId: string): number | null {
  const u = indexed.userIndex.get(userId);
  const i = indexed.projectIndex.get(projectId);
  if (u === undefined || i === undefined) return null;
  const pu = indexed.model.userFactors[u]!;
  const qi = indexed.model.itemFactors[i]!;
  let sum = 0;
  for (let f = 0; f < pu.length; f++) sum += pu[f]! * qi[f]!;
  return sum;
}

/**
 * Top-K candidates by learned score. Only scoreable candidates are ranked
 * (unknown user → empty list; unknown projects are skipped); ties break by
 * project id ascending; no duplicates.
 */
export function rankBprCandidates(indexed: IndexedBprModel, userId: string, candidateIds: readonly string[], limit: number): string[] {
  if (!indexed.userIndex.has(userId) || !(limit > 0)) return [];
  const scored: { projectId: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const projectId of candidateIds) {
    if (seen.has(projectId)) continue;
    seen.add(projectId);
    const score = scoreBpr(indexed, userId, projectId);
    if (score !== null) scored.push({ projectId, score });
  }
  scored.sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId));
  return scored.slice(0, Math.floor(limit)).map((entry) => entry.projectId);
}

/**
 * Min–max normalisation of raw (uncalibrated) BPR scores within one candidate
 * set: (score − min) / (max − min). Returns null when fewer than two scoreable
 * candidates exist or the range is effectively zero — in that case the BPR
 * signal is unavailable/neutral and callers must not manufacture preference.
 */
export function normalizeBprScores(scores: ReadonlyMap<string, number>): Map<string, number> | null {
  if (scores.size < 2) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of scores.values()) {
    if (!Number.isFinite(value)) return null;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = max - min;
  if (!(range > 1e-9)) return null;
  const normalized = new Map<string, number>();
  for (const [projectId, value] of scores) normalized.set(projectId, (value - min) / range);
  return normalized;
}
