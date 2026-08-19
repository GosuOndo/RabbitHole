/**
 * Item-item collaborative filtering.
 *
 * 1. Collaborative signal (per user, per project) — from the *current state* of
 *    the user's interactions with that project (lib/interactions/project-state):
 *
 *      signal = 0                                   if disliked (latest SAVE/DISLIKE is DISLIKE)
 *      signal = (completed ? w(COMPLETE) : built ? w(BUILD) : 0)
 *             + (saved ? w(SAVE) : 0)              (SAVE reversed by UNSAVE/DISLIKE counts 0)
 *             + (shared ? w(SHARE) : 0)
 *             + (opened ? w(OPEN) : 0)             (weak; counted once, not per open)
 *
 *    with weights from RECOMMENDER_CONFIG.interactionWeights. IMPRESSION never
 *    contributes; each state counts once, so repeating an action cannot inflate
 *    the signal. Range: [0, 10.5].
 *
 * 2. Item vectors — one sparse vector per project over users, holding the
 *    positive signals above (missing = unknown, never negative). The target
 *    user's own row is left out (leave-one-out) so their history does not
 *    reinforce itself.
 *
 * 3. Item-item similarity — cosine between item vectors, shrunk for sparse
 *    overlap:  sim(i, j) = (v_i · v_j) / (‖v_i‖ ‖v_j‖) × overlap / (overlap + shrinkage).
 *    Zero-norm or non-overlapping pairs are 0. Range [0, 1]. Top-K neighbours
 *    per item are kept (ties: project id ascending).
 *
 * 4. Retrieval — the user's positive-state projects are seeds weighted by their
 *    signal. For every neighbour of every seed (excluding the seeds themselves
 *    and terminal-state projects):
 *      evidence(c) = Σ_seeds sim(seed, c) × seedWeight
 *      score(c)    = evidence(c) / max_c evidence × confidence
 *      confidence  = min(1, Σ seedWeight / fullConfidenceSeedWeight)
 *    Top-N by score (ties: slug ascending). No seeds → no candidates.
 *
 * Everything is deterministic and pure; loaders supply the interaction rows.
 */

import { deriveProjectStates, type ProjectState } from "@/lib/interactions/project-state";
import { RECOMMENDER_CONFIG, interactionWeight } from "./config";
import type { CollaborativeInteraction, RetrievedCandidate } from "./types";

// ---------------------------------------------------------------------------
// 1. Collaborative signal
// ---------------------------------------------------------------------------

export type CollaborativeSeedState = "completed" | "built" | "saved" | "shared" | "opened";

type SignalState = Pick<ProjectState, "saved" | "disliked" | "built" | "completed" | "opened" | "shared">;

/** Positive collaborative evidence for one (user, project) from its current state. */
export function collaborativeSignalFromState(state: SignalState): number {
  if (state.disliked) return 0;
  let value = 0;
  if (state.completed) value += interactionWeight("COMPLETE");
  else if (state.built) value += interactionWeight("BUILD");
  if (state.saved) value += interactionWeight("SAVE");
  if (state.shared) value += interactionWeight("SHARE");
  if (state.opened) value += interactionWeight("OPEN");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The strongest positive state, used to phrase explanations ("which you saved"). */
export function strongestSeedState(state: SignalState): CollaborativeSeedState | null {
  if (state.disliked) return null;
  if (state.completed) return "completed";
  if (state.built) return "built";
  if (state.saved) return "saved";
  if (state.shared) return "shared";
  if (state.opened) return "opened";
  return null;
}

export interface UserProjectSignal {
  value: number;
  state: CollaborativeSeedState;
}

/** userId → projectId → positive signal, derived from current states. */
export function collaborativeSignals(interactions: readonly CollaborativeInteraction[]): Map<string, Map<string, UserProjectSignal>> {
  const byUser = new Map<string, CollaborativeInteraction[]>();
  for (const interaction of interactions) {
    const rows = byUser.get(interaction.userId);
    if (rows) rows.push(interaction);
    else byUser.set(interaction.userId, [interaction]);
  }
  const signals = new Map<string, Map<string, UserProjectSignal>>();
  for (const userId of [...byUser.keys()].sort()) {
    const states = deriveProjectStates(byUser.get(userId)!);
    const perProject = new Map<string, UserProjectSignal>();
    for (const projectId of [...states.keys()].sort()) {
      const state = states.get(projectId)!;
      const value = collaborativeSignalFromState(state);
      const seedState = strongestSeedState(state);
      if (value > 0 && seedState) perProject.set(projectId, { value, state: seedState });
    }
    if (perProject.size > 0) signals.set(userId, perProject);
  }
  return signals;
}

// ---------------------------------------------------------------------------
// 2. Item vectors
// ---------------------------------------------------------------------------

/** userId → positive signal for one project. */
export type ItemVector = Map<string, number>;

export function buildItemVectors(
  signals: ReadonlyMap<string, ReadonlyMap<string, UserProjectSignal>>,
  options: { excludeUserId?: string } = {},
): Map<string, ItemVector> {
  const vectors = new Map<string, ItemVector>();
  for (const [userId, perProject] of signals) {
    if (userId === options.excludeUserId) continue;
    for (const [projectId, signal] of perProject) {
      let vector = vectors.get(projectId);
      if (!vector) {
        vector = new Map();
        vectors.set(projectId, vector);
      }
      vector.set(userId, signal.value);
    }
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// 3. Item-item similarity
// ---------------------------------------------------------------------------

function norm(vector: ItemVector): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

/** Shrunk cosine similarity between two item vectors over users. */
export function itemSimilarity(
  a: ItemVector,
  b: ItemVector,
  shrinkage: number = RECOMMENDER_CONFIG.collaborative.shrinkage,
): { similarity: number; overlap: number } {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  let overlap = 0;
  for (const [userId, value] of small) {
    const other = large.get(userId);
    if (other !== undefined) {
      dot += value * other;
      overlap += 1;
    }
  }
  if (overlap === 0) return { similarity: 0, overlap: 0 };
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return { similarity: 0, overlap };
  const cosine = dot / denominator;
  const shrink = overlap / (overlap + Math.max(0, shrinkage));
  const similarity = cosine * shrink;
  return { similarity: Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0, overlap };
}

export interface ItemNeighbour {
  projectId: string;
  similarity: number;
  overlap: number;
}

/** Top-K neighbours per item (similarity desc, project id asc). */
export function computeItemNeighbours(
  itemVectors: ReadonlyMap<string, ItemVector>,
  options: { shrinkage?: number; neighboursPerItem?: number } = {},
): Map<string, ItemNeighbour[]> {
  const shrinkage = options.shrinkage ?? RECOMMENDER_CONFIG.collaborative.shrinkage;
  const perItem = options.neighboursPerItem ?? RECOMMENDER_CONFIG.collaborative.neighboursPerItem;
  const ids = [...itemVectors.keys()].sort();
  const neighbours = new Map<string, ItemNeighbour[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const { similarity, overlap } = itemSimilarity(itemVectors.get(a)!, itemVectors.get(b)!, shrinkage);
      if (similarity <= 0) continue;
      neighbours.get(a)!.push({ projectId: b, similarity, overlap });
      neighbours.get(b)!.push({ projectId: a, similarity, overlap });
    }
  }
  for (const list of neighbours.values()) {
    list.sort((x, y) => y.similarity - x.similarity || x.projectId.localeCompare(y.projectId));
    if (list.length > perItem) list.length = perItem;
  }
  return neighbours;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface CollaborativeModel {
  itemVectors: Map<string, ItemVector>;
  neighbours: Map<string, ItemNeighbour[]>;
  /** Users contributing positive signals (after leave-one-out). */
  userCount: number;
  itemCount: number;
}

export function buildCollaborativeModel(
  interactions: readonly CollaborativeInteraction[],
  options: { excludeUserId?: string; shrinkage?: number; neighboursPerItem?: number } = {},
): CollaborativeModel {
  const signals = collaborativeSignals(interactions);
  const itemVectors = buildItemVectors(signals, { excludeUserId: options.excludeUserId });
  const users = new Set<string>();
  for (const vector of itemVectors.values()) for (const userId of vector.keys()) users.add(userId);
  return {
    itemVectors,
    neighbours: computeItemNeighbours(itemVectors, { shrinkage: options.shrinkage, neighboursPerItem: options.neighboursPerItem }),
    userCount: users.size,
    itemCount: itemVectors.size,
  };
}

// ---------------------------------------------------------------------------
// 4. Seeds, scoring and retrieval for the target user
// ---------------------------------------------------------------------------

export interface CollaborativeSeed {
  projectId: string;
  /** Positive signal of the target user for this project. */
  weight: number;
  state: CollaborativeSeedState;
}

/** The target user's positive-state projects, strongest first (ties: id asc). */
export function collaborativeSeedsForUser(interactions: readonly CollaborativeInteraction[], userId: string): CollaborativeSeed[] {
  const own = interactions.filter((i) => i.userId === userId);
  if (own.length === 0) return [];
  const states = deriveProjectStates(own);
  const seeds: CollaborativeSeed[] = [];
  for (const [projectId, state] of states) {
    const weight = collaborativeSignalFromState(state);
    const seedState = strongestSeedState(state);
    if (weight > 0 && seedState) seeds.push({ projectId, weight, state: seedState });
  }
  seeds.sort((a, b) => b.weight - a.weight || a.projectId.localeCompare(b.projectId));
  return seeds;
}

export interface CollaborativeSupport {
  projectId: string;
  similarity: number;
  /** similarity × seed weight — this seed's share of the evidence. */
  contribution: number;
}

export interface CollaborativeEvidence {
  projectId: string;
  /** Normalised score in [0, 1] (evidence / max evidence × confidence). */
  score: number;
  /** Σ sim(seed, project) × seedWeight before normalisation. */
  rawEvidence: number;
  /** Seeds that contributed, strongest contribution first. */
  supportingSeeds: CollaborativeSupport[];
}

export interface CollaborativeScoring {
  scores: Map<string, CollaborativeEvidence>;
  seeds: CollaborativeSeed[];
  seedWeightTotal: number;
  /** min(1, Σ seedWeight / fullConfidenceSeedWeight) — dampens sparse histories. */
  confidence: number;
  maxEvidence: number;
}

export function scoreCollaborativeCandidates(
  model: CollaborativeModel,
  seeds: readonly CollaborativeSeed[],
  options: { excludedProjectIds?: ReadonlySet<string>; fullConfidenceSeedWeight?: number; minCandidateScore?: number; maxSupportingSeeds?: number } = {},
): CollaborativeScoring {
  const excluded = options.excludedProjectIds ?? new Set<string>();
  const fullConfidence = options.fullConfidenceSeedWeight ?? RECOMMENDER_CONFIG.collaborative.fullConfidenceSeedWeight;
  const minScore = options.minCandidateScore ?? RECOMMENDER_CONFIG.collaborative.minCandidateScore;
  const maxSupport = options.maxSupportingSeeds ?? 3;
  const seedIds = new Set(seeds.map((s) => s.projectId));
  const seedWeightTotal = seeds.reduce((sum, s) => sum + s.weight, 0);
  const confidence = fullConfidence > 0 ? Math.min(1, seedWeightTotal / fullConfidence) : 1;

  const evidence = new Map<string, { raw: number; support: CollaborativeSupport[] }>();
  for (const seed of seeds) {
    for (const neighbour of model.neighbours.get(seed.projectId) ?? []) {
      // The user's own positive projects are inputs, not outputs; terminal states never surface.
      if (seedIds.has(neighbour.projectId) || excluded.has(neighbour.projectId)) continue;
      const contribution = neighbour.similarity * seed.weight;
      if (!Number.isFinite(contribution) || contribution <= 0) continue;
      const entry = evidence.get(neighbour.projectId) ?? { raw: 0, support: [] };
      entry.raw += contribution;
      entry.support.push({ projectId: seed.projectId, similarity: neighbour.similarity, contribution });
      evidence.set(neighbour.projectId, entry);
    }
  }

  let maxEvidence = 0;
  for (const entry of evidence.values()) maxEvidence = Math.max(maxEvidence, entry.raw);

  const scores = new Map<string, CollaborativeEvidence>();
  for (const projectId of [...evidence.keys()].sort()) {
    const entry = evidence.get(projectId)!;
    const score = maxEvidence > 0 ? (entry.raw / maxEvidence) * confidence : 0;
    if (score < minScore) continue;
    entry.support.sort((a, b) => b.contribution - a.contribution || a.projectId.localeCompare(b.projectId));
    scores.set(projectId, {
      projectId,
      score: Math.max(0, Math.min(1, score)),
      rawEvidence: entry.raw,
      supportingSeeds: entry.support.slice(0, maxSupport),
    });
  }
  return { scores, seeds: [...seeds], seedWeightTotal, confidence, maxEvidence };
}

/** Top-N collaborative candidates (score desc, slug asc). */
export function retrieveCollaborativeCandidates(
  scoring: CollaborativeScoring,
  projects: readonly { id: string; slug: string }[],
  options: { limit?: number } = {},
): RetrievedCandidate[] {
  const limit = options.limit ?? RECOMMENDER_CONFIG.candidateCounts.collaborative;
  if (limit <= 0 || scoring.scores.size === 0) return [];
  const slugById = new Map(projects.map((p) => [p.id, p.slug]));
  const eligible = [...scoring.scores.values()]
    .filter((e) => slugById.has(e.projectId))
    .map((e) => ({ projectId: e.projectId, slug: slugById.get(e.projectId)!, score: e.score }));
  eligible.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return eligible.slice(0, limit).map((e) => ({ projectId: e.projectId, source: "collaborative", signal: e.score }));
}
