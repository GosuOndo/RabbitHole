/**
 * Insights: the recommender transparency view model.
 *
 * Composes the *live* profile snapshot (long-term + current-session taste,
 * adaptive session focus) with the *immutable* recommendation-run history:
 * recent run summaries plus one selected run's full diagnostics. Reading
 * insights never records a run and never recomputes historical scores — the
 * selected run is served exactly as it was generated.
 */

import { getUserProfileSnapshot, type UserProfileSnapshot } from "@/lib/profile/profile-service";
import {
  countStoredRuns,
  getRunDetail,
  listRecentRuns,
  type RecentRunSummary,
  type RunDetail,
} from "@/lib/recommendations/recommendation-run-service";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Recommendation run ${runId} was not found for this user`);
    this.name = "RunNotFoundError";
  }
}

export interface InsightsData {
  /** Live state: current learned profile + current-session focus (may be newer than any stored run). */
  profile: UserProfileSnapshot;
  /** Newest-first stored run summaries for this user. */
  recentRuns: RecentRunSummary[];
  /** The requested (or latest) stored run, as generated; null when none exist. */
  selectedRun: RunDetail | null;
  /** Retention diagnostics. */
  runs: { stored: number; maxStored: number; recentShown: number };
}

export interface InsightsOptions {
  /** Inspect a specific stored run; must belong to the user (RunNotFoundError otherwise). */
  runId?: string;
  now?: Date;
}

export async function getInsights(userId: string, options: InsightsOptions = {}): Promise<InsightsData> {
  const [profile, recentRuns, stored] = await Promise.all([
    getUserProfileSnapshot(userId, options.now ?? new Date()),
    listRecentRuns(userId),
    countStoredRuns(userId),
  ]);

  let selectedRun: RunDetail | null = null;
  if (options.runId !== undefined) {
    selectedRun = await getRunDetail(userId, options.runId);
    if (!selectedRun) throw new RunNotFoundError(options.runId);
  } else if (recentRuns[0]) {
    selectedRun = await getRunDetail(userId, recentRuns[0].id);
  }

  return {
    profile,
    recentRuns,
    selectedRun,
    runs: {
      stored,
      maxStored: RECOMMENDER_CONFIG.diagnostics.maxRunsPerUser,
      recentShown: RECOMMENDER_CONFIG.diagnostics.recentRuns,
    },
  };
}
