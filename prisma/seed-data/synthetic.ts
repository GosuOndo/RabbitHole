/**
 * Deterministic synthetic behaviour generator.
 *
 * Pure functions: given the catalog, an anchor date and a seed string they
 * produce the same users, sessions and interactions every time. The seed script
 * persists the output; unit tests check determinism and structure.
 *
 * Model (kept deliberately simple and inspectable):
 *   affinity(user, project) ∈ [-1, 1]  — from latent tag/language/difficulty affinities
 *   P(impression ∝ exp(temperature * affinity)) — users mostly see relevant items
 *   P(open | impression) = σ(3a − 0.5)
 *   P(save | open)       = σ(4a − 2.5)
 *   P(dislike | impr.)   = σ(−6a − 3)      (independent of opening)
 *   P(build | save)      = 0.35 (+0.15 when a > 0.7)
 *   P(complete | build)  = later session, difficulty-dependent
 *   P(share | save)      = 0.15
 */

import { SeededRandom } from "../../lib/utils/prng";
import { ARCHETYPES, SYNTHETIC_USER_NAMES, type Archetype } from "./archetypes";
import type { SeedDifficulty, SeedProject } from "./types";

export type SeedInteractionType = "IMPRESSION" | "OPEN" | "SAVE" | "UNSAVE" | "DISLIKE" | "BUILD" | "COMPLETE" | "SHARE";
export type ActivityLevel = "low" | "medium" | "high";

export interface SyntheticUser {
  id: string;
  handle: string;
  name: string;
  primaryArchetype: string;
  secondaryArchetype: string;
  explorationPreference: number;
  activity: ActivityLevel;
  tagAffinities: Record<string, number>;
  languageAffinities: Record<string, number>;
  difficultyAffinities: Record<SeedDifficulty, number>;
}

export interface SyntheticSession {
  id: string;
  userId: string;
  startedAt: Date;
  lastActiveAt: Date;
  endedAt: Date;
}

export interface SyntheticInteraction {
  id: string;
  userId: string;
  sessionId: string;
  projectSlug: string;
  type: SeedInteractionType;
  dwellMs: number | null;
  createdAt: Date;
}

export interface SyntheticDataset {
  users: SyntheticUser[];
  sessions: SyntheticSession[];
  interactions: SyntheticInteraction[];
}

export const SYNTHETIC_GENERATION = {
  userCount: 30,
  historyDays: 90,
  activity: {
    low: { sessions: [3, 5], impressions: [6, 10], weight: 0.3 },
    medium: { sessions: [6, 9], impressions: [8, 12], weight: 0.45 },
    high: { sessions: [10, 14], impressions: [10, 16], weight: 0.25 },
  } satisfies Record<ActivityLevel, { sessions: [number, number]; impressions: [number, number]; weight: number }>,
  /** Blend weight of the secondary archetype (chosen per user). */
  secondaryBlends: [0.15, 0.25, 0.4],
  /** Gaussian noise added to each blended affinity. */
  affinityNoiseSd: 0.12,
  /** Softmax temperature for impression sampling. */
  selectionTemperature: 2.2,
  /** Extra sampling weight for projects sharing the session's focus tag. */
  sessionFocusBonus: 0.35,
  /** Sampling multiplier for projects the user already saved. */
  savedResampleMultiplier: 0.3,
  /** Position weights for a project's tags ("most defining first"). */
  tagPositionWeights: [1, 0.7, 0.5, 0.4, 0.3],
} as const;

const DAY_MS = 86_400_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Blends two archetypes' affinity maps. The primary archetype defines the
 * user's identity (its values are kept, plus noise); the secondary archetype
 * only contributes scaled interests where the primary is neutral. This keeps
 * every user with clear strong interests, real secondary interests and genuine
 * dislikes.
 */
function blendMaps(
  primary: Record<string, number>,
  secondary: Record<string, number>,
  weight: number,
  rng: SeededRandom,
): Record<string, number> {
  const keys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const primaryValue = primary[key];
    const base = primaryValue !== undefined ? primaryValue : weight * (secondary[key] ?? 0);
    const value = clamp(base + rng.gaussian(0, SYNTHETIC_GENERATION.affinityNoiseSd), -1, 1);
    if (Math.abs(value) >= 0.05) out[key] = Number(value.toFixed(3));
  }
  return out;
}

/** Builds the synthetic user population deterministically. */
export function buildSyntheticUsers(count: number = SYNTHETIC_GENERATION.userCount): SyntheticUser[] {
  const users: SyntheticUser[] = [];
  const archetypeCount = ARCHETYPES.length;
  for (let i = 0; i < count; i++) {
    const handle = `synthetic-${pad(i + 1, 2)}`;
    const rng = new SeededRandom(`synthetic-user:${handle}`);
    const primary = ARCHETYPES[i % archetypeCount] as Archetype;
    let secondaryIndex = (i * 7 + 3) % archetypeCount;
    if (secondaryIndex === i % archetypeCount) secondaryIndex = (secondaryIndex + 1) % archetypeCount;
    const secondary = ARCHETYPES[secondaryIndex] as Archetype;
    const blend = rng.pick(SYNTHETIC_GENERATION.secondaryBlends);

    const activityLevels: ActivityLevel[] = ["low", "medium", "high"];
    const activity = rng.weightedPick(
      activityLevels,
      activityLevels.map((level) => SYNTHETIC_GENERATION.activity[level].weight),
    );

    const difficulty = blendMaps(primary.difficulty, secondary.difficulty, blend, rng);

    users.push({
      id: `usr_${handle.replace("-", "_")}`,
      handle,
      name: SYNTHETIC_USER_NAMES[i % SYNTHETIC_USER_NAMES.length] ?? `Synthetic ${i + 1}`,
      primaryArchetype: primary.key,
      secondaryArchetype: secondary.key,
      explorationPreference: Number(
        clamp((1 - blend) * primary.exploration + blend * secondary.exploration + rng.gaussian(0, 0.08), 0.05, 0.9).toFixed(2),
      ),
      activity,
      tagAffinities: blendMaps(primary.tags, secondary.tags, blend, rng),
      languageAffinities: blendMaps(primary.languages, secondary.languages, blend, rng),
      difficultyAffinities: {
        BEGINNER: difficulty.BEGINNER ?? 0,
        INTERMEDIATE: difficulty.INTERMEDIATE ?? 0,
        ADVANCED: difficulty.ADVANCED ?? 0,
      },
    });
  }
  return users;
}

/**
 * Latent affinity of a user for a project in [-1, 1]. This is the *ground truth*
 * used only to generate behaviour; the recommender never sees it.
 */
export function projectAffinity(user: SyntheticUser, project: SeedProject): number {
  const weights = SYNTHETIC_GENERATION.tagPositionWeights;
  let tagSum = 0;
  let tagWeight = 0;
  project.tags.forEach((tag, index) => {
    const w = weights[Math.min(index, weights.length - 1)] ?? 0.3;
    tagSum += w * (user.tagAffinities[tag] ?? 0);
    tagWeight += w;
  });
  const tagScore = tagWeight > 0 ? tagSum / tagWeight : 0;

  let langScore = 0;
  if (project.languages.length > 0) {
    let sum = 0;
    for (const lang of project.languages) sum += user.languageAffinities[lang] ?? 0;
    langScore = sum / project.languages.length;
  }

  const difficultyScore = user.difficultyAffinities[project.difficulty] ?? 0;
  return clamp(0.75 * tagScore + 0.15 * langScore + 0.1 * difficultyScore, -1, 1);
}

interface UserState {
  saved: Set<string>;
  disliked: Set<string>;
  built: Set<string>;
  completed: Set<string>;
  /** Built but not yet completed, with the affinity that drove the build. */
  pendingCompletion: Map<string, number>;
  /** Saved with lukewarm affinity; candidates for a later UNSAVE. */
  lukewarmSaves: string[];
}

/** Generates sessions and interactions for the given users. */
export function generateSyntheticActivity(
  users: readonly SyntheticUser[],
  catalog: readonly SeedProject[],
  anchor: Date,
): { sessions: SyntheticSession[]; interactions: SyntheticInteraction[] } {
  const sessions: SyntheticSession[] = [];
  const interactions: SyntheticInteraction[] = [];
  const projectBySlug = new Map(catalog.map((p) => [p.slug, p]));

  for (const user of users) {
    const rng = new SeededRandom(`synthetic-activity:${user.handle}`);
    const activity = SYNTHETIC_GENERATION.activity[user.activity];
    const sessionCount = rng.int(activity.sessions[0], activity.sessions[1]);
    const affinities = new Map(catalog.map((p) => [p.slug, projectAffinity(user, p)]));
    const positiveTags = Object.entries(user.tagAffinities)
      .filter(([, value]) => value > 0.3)
      .sort((a, b) => b[1] - a[1]);

    const state: UserState = {
      saved: new Set(),
      disliked: new Set(),
      built: new Set(),
      completed: new Set(),
      pendingCompletion: new Map(),
      lukewarmSaves: [],
    };

    // Chronological session start offsets (days before the anchor).
    const offsets = Array.from({ length: sessionCount }, () => rng.float(1, SYNTHETIC_GENERATION.historyDays)).sort(
      (a, b) => b - a,
    );

    offsets.forEach((offsetDays, sessionIndex) => {
      const sessionId = `ses_${user.handle.replace("-", "_")}_${pad(sessionIndex + 1, 3)}`;
      let clock = anchor.getTime() - offsetDays * DAY_MS;
      const startedAt = new Date(clock);
      let sequence = 0;
      const emit = (projectSlug: string, type: SeedInteractionType, dwellMs: number | null = null) => {
        sequence += 1;
        interactions.push({
          id: `ixn_${user.handle.replace("-", "_")}_${pad(sessionIndex + 1, 3)}_${pad(sequence, 4)}`,
          userId: user.id,
          sessionId,
          projectSlug,
          type,
          dwellMs,
          createdAt: new Date(clock),
        });
      };

      // Follow-ups from earlier sessions: completing a build, unsaving a lukewarm save.
      if (state.pendingCompletion.size > 0 && rng.chance(0.45)) {
        const [slug, affinity] = rng.pick([...state.pendingCompletion.entries()]);
        const project = projectBySlug.get(slug);
        const difficultyFactor = project?.difficulty === "BEGINNER" ? 0.8 : project?.difficulty === "INTERMEDIATE" ? 0.55 : 0.35;
        if (rng.chance(difficultyFactor * (0.6 + 0.4 * Math.max(0, affinity)))) {
          emit(slug, "COMPLETE");
          state.completed.add(slug);
          state.pendingCompletion.delete(slug);
          if (rng.chance(0.25)) {
            clock += rng.int(5, 40) * 1000;
            emit(slug, "SHARE");
          }
          clock += rng.int(10, 60) * 1000;
        }
      }
      if (state.lukewarmSaves.length > 0 && rng.chance(0.2)) {
        const index = rng.int(0, state.lukewarmSaves.length - 1);
        const [slug] = state.lukewarmSaves.splice(index, 1);
        if (slug && state.saved.has(slug)) {
          emit(slug, "UNSAVE");
          state.saved.delete(slug);
          clock += rng.int(5, 30) * 1000;
        }
      }

      // Session focus: a coherent theme for this session's browsing.
      const focusTag = positiveTags.length > 0 ? rng.weightedPick(positiveTags.map(([tag]) => tag), positiveTags.map(([, v]) => v)) : null;

      // Candidate pool: everything not in a terminal state for this user.
      const pool = catalog.filter((p) => !state.disliked.has(p.slug) && !state.built.has(p.slug) && !state.completed.has(p.slug));
      const weights = pool.map((p) => {
        const affinity = affinities.get(p.slug) ?? 0;
        let w = Math.exp(SYNTHETIC_GENERATION.selectionTemperature * affinity) * (0.6 + 0.8 * p.popularity);
        if (focusTag && p.tags.includes(focusTag)) w *= 1 + SYNTHETIC_GENERATION.sessionFocusBonus * 2;
        if (state.saved.has(p.slug)) w *= SYNTHETIC_GENERATION.savedResampleMultiplier;
        return w;
      });

      const impressionCount = Math.min(pool.length, rng.int(activity.impressions[0], activity.impressions[1]));
      const remaining = pool.map((p, index) => ({ project: p, weight: weights[index] ?? 0 }));

      for (let i = 0; i < impressionCount && remaining.length > 0; i++) {
        const chosen = rng.weightedPick(remaining, remaining.map((r) => r.weight));
        remaining.splice(remaining.indexOf(chosen), 1);
        const project = chosen.project;
        const a = affinities.get(project.slug) ?? 0;

        emit(project.slug, "IMPRESSION");

        if (rng.chance(sigmoid(-6 * a - 3))) {
          clock += rng.int(1, 4) * 1000;
          emit(project.slug, "DISLIKE");
          state.disliked.add(project.slug);
          state.saved.delete(project.slug);
        } else if (rng.chance(sigmoid(3 * a - 0.5))) {
          clock += rng.int(1, 5) * 1000;
          const dwellMs = Math.round(clamp(rng.gaussian(20_000 + 40_000 * Math.max(0, a), 10_000), 2_000, 240_000));
          emit(project.slug, "OPEN", dwellMs);
          clock += dwellMs;

          if (!state.saved.has(project.slug) && rng.chance(sigmoid(4 * a - 2.5))) {
            emit(project.slug, "SAVE");
            state.saved.add(project.slug);
            if (a < 0.4) state.lukewarmSaves.push(project.slug);

            if (rng.chance(0.35 + (a > 0.7 ? 0.15 : 0))) {
              clock += rng.int(1, 30) * 1000;
              emit(project.slug, "BUILD");
              state.built.add(project.slug);
              state.pendingCompletion.set(project.slug, a);
            }
            if (rng.chance(0.15)) {
              clock += rng.int(5, 60) * 1000;
              emit(project.slug, "SHARE");
            }
          }
        }
        clock += rng.int(3, 25) * 1000;
      }

      const lastActiveAt = new Date(clock);
      sessions.push({
        id: sessionId,
        userId: user.id,
        startedAt,
        lastActiveAt,
        endedAt: new Date(clock + 60_000),
      });
    });
  }

  return { sessions, interactions };
}

/** Full deterministic dataset for the given catalog and anchor date. */
export function generateSyntheticDataset(catalog: readonly SeedProject[], anchor: Date): SyntheticDataset {
  const users = buildSyntheticUsers();
  const { sessions, interactions } = generateSyntheticActivity(users, catalog, anchor);
  return { users, sessions, interactions };
}

/** Anchor date used for seed timestamps: SEED_ANCHOR_DATE or the start of the current UTC day. */
export function resolveSeedAnchor(envValue: string | undefined, now: Date = new Date()): Date {
  if (envValue) {
    const parsed = new Date(envValue);
    if (Number.isNaN(parsed.getTime())) throw new Error(`SEED_ANCHOR_DATE is not a valid date: ${envValue}`);
    return parsed;
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
