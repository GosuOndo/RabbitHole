/**
 * Impression de-duplication for the recommendation feed.
 *
 * Strategy: an IMPRESSION is recorded the first time a card becomes at least
 * half visible in the viewport, and at most once per project per feed instance
 * (a mounted feed component). The tracker is a plain Set held in a ref, so
 * React re-renders, Strict Mode's double effects and hydration never record a
 * second impression; navigating away and back mounts a new feed and therefore
 * counts as a new surfacing.
 */

export interface ImpressionTracker {
  /** Returns true exactly once per project id. */
  shouldRecord(projectId: string): boolean;
  has(projectId: string): boolean;
  readonly size: number;
}

export function createImpressionTracker(initial: Iterable<string> = []): ImpressionTracker {
  const seen = new Set<string>(initial);
  return {
    shouldRecord(projectId) {
      if (seen.has(projectId)) return false;
      seen.add(projectId);
      return true;
    },
    has(projectId) {
      return seen.has(projectId);
    },
    get size() {
      return seen.size;
    },
  };
}

/** Visibility ratio at which a card counts as surfaced. */
export const IMPRESSION_VISIBILITY_THRESHOLD = 0.5;
