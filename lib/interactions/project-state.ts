/**
 * Derives a user's per-project behavioural state from their interaction
 * history. Pure functions; the interaction type is authoritative.
 *
 * Rules (events ordered by time, ties by input order):
 *   saved     — the latest SAVE/UNSAVE/DISLIKE event is SAVE
 *   disliked  — the latest SAVE/DISLIKE event is DISLIKE (a later SAVE lifts it)
 *   built     — any BUILD event
 *   completed — any COMPLETE event
 *   opened    — any OPEN event
 *   shared    — any SHARE event
 *   excluded  — any of RECOMMENDER_CONFIG.filtering.excludedInteractionTypes
 */

import type { InteractionType } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export interface StateInteraction {
  projectId: string;
  type: InteractionType;
  createdAt: Date;
}

export interface ProjectState {
  projectId: string;
  saved: boolean;
  disliked: boolean;
  built: boolean;
  completed: boolean;
  /** Any OPEN event (weak engagement). */
  opened: boolean;
  /** Any SHARE event. */
  shared: boolean;
  /** Time of the SAVE that made the project saved (null when not saved). */
  savedAt: Date | null;
  /** True when a terminal interaction (DISLIKE/BUILD/COMPLETE by config) exists. */
  excludedFromDiscovery: boolean;
  interactionCount: number;
}

export function deriveProjectStates(interactions: readonly StateInteraction[]): Map<string, ProjectState> {
  const excludedTypes = new Set<InteractionType>(RECOMMENDER_CONFIG.filtering.excludedInteractionTypes);
  const ordered = interactions
    .map((interaction, index) => ({ interaction, index }))
    .sort((a, b) => a.interaction.createdAt.getTime() - b.interaction.createdAt.getTime() || a.index - b.index)
    .map((entry) => entry.interaction);

  const states = new Map<string, ProjectState>();
  for (const interaction of ordered) {
    let state = states.get(interaction.projectId);
    if (!state) {
      state = {
        projectId: interaction.projectId,
        saved: false,
        disliked: false,
        built: false,
        completed: false,
        opened: false,
        shared: false,
        savedAt: null,
        excludedFromDiscovery: false,
        interactionCount: 0,
      };
      states.set(interaction.projectId, state);
    }
    state.interactionCount += 1;
    switch (interaction.type) {
      case "SAVE":
        state.saved = true;
        state.savedAt = interaction.createdAt;
        state.disliked = false;
        break;
      case "UNSAVE":
        state.saved = false;
        state.savedAt = null;
        break;
      case "DISLIKE":
        state.disliked = true;
        state.saved = false;
        state.savedAt = null;
        break;
      case "BUILD":
        state.built = true;
        break;
      case "COMPLETE":
        state.completed = true;
        break;
      case "OPEN":
        state.opened = true;
        break;
      case "SHARE":
        state.shared = true;
        break;
      case "IMPRESSION":
        break;
    }
    if (excludedTypes.has(interaction.type)) state.excludedFromDiscovery = true;
  }
  return states;
}

export function savedProjectIds(interactions: readonly StateInteraction[]): string[] {
  return [...deriveProjectStates(interactions).values()].filter((s) => s.saved).map((s) => s.projectId);
}

export function dislikedProjectIds(interactions: readonly StateInteraction[]): string[] {
  return [...deriveProjectStates(interactions).values()].filter((s) => s.disliked).map((s) => s.projectId);
}

export function excludedProjectIds(interactions: readonly StateInteraction[]): string[] {
  return [...deriveProjectStates(interactions).values()].filter((s) => s.excludedFromDiscovery).map((s) => s.projectId);
}
