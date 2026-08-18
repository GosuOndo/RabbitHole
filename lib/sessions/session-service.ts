/**
 * Server-side session resolution.
 *
 * A session is a bounded browsing period. The server, never the client, decides
 * which session an interaction belongs to:
 *   - the user's most recent open session is reused while it has been active
 *     within `timeoutMinutes`;
 *   - otherwise the stale session is closed (endedAt = its last activity) and a
 *     fresh session is created;
 *   - "start new session" explicitly ends the current session and opens a new one.
 *
 * The service is written against a small repository interface so the logic is
 * unit-testable with an in-memory store; `prismaSessionRepository` is the real
 * implementation.
 */

import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export interface SessionRecord {
  id: string;
  userId: string;
  startedAt: Date;
  lastActiveAt: Date;
  endedAt: Date | null;
}

export interface SessionRepository {
  /** Most recently active session of the user that has not been explicitly ended. */
  findLatestOpen(userId: string): Promise<SessionRecord | null>;
  create(userId: string, at: Date): Promise<SessionRecord>;
  end(sessionId: string, endedAt: Date): Promise<void>;
  /** Moves lastActiveAt forward to `at` (never backwards). */
  touch(sessionId: string, at: Date): Promise<void>;
}

export interface SessionServiceOptions {
  timeoutMinutes: number;
}

/** True when the session is open and was active within the timeout window. */
export function isSessionActive(
  session: Pick<SessionRecord, "lastActiveAt" | "endedAt">,
  now: Date,
  timeoutMinutes: number = RECOMMENDER_CONFIG.session.timeoutMinutes,
): boolean {
  if (session.endedAt !== null) return false;
  const idleMs = now.getTime() - session.lastActiveAt.getTime();
  return idleMs <= timeoutMinutes * 60_000;
}

export interface SessionService {
  /** Returns the active session, creating one when none is active. */
  resolveActive(userId: string, now?: Date): Promise<{ session: SessionRecord; created: boolean }>;
  /** Returns the active session or null. Never creates or mutates. */
  getActive(userId: string, now?: Date): Promise<SessionRecord | null>;
  /** Ends the current open session (if any) and starts a fresh one. */
  startNew(userId: string, now?: Date): Promise<SessionRecord>;
  /** Records activity on a session. */
  touch(sessionId: string, now?: Date): Promise<void>;
  readonly timeoutMinutes: number;
}

export function createSessionService(repository: SessionRepository, options: SessionServiceOptions): SessionService {
  const { timeoutMinutes } = options;
  if (!(timeoutMinutes > 0)) throw new RangeError("timeoutMinutes must be > 0");

  return {
    timeoutMinutes,

    async resolveActive(userId, now = new Date()) {
      const latest = await repository.findLatestOpen(userId);
      if (latest && isSessionActive(latest, now, timeoutMinutes)) {
        return { session: latest, created: false };
      }
      if (latest) {
        // Stale but never closed: close it at the moment it was last seen.
        await repository.end(latest.id, latest.lastActiveAt);
      }
      const session = await repository.create(userId, now);
      return { session, created: true };
    },

    async getActive(userId, now = new Date()) {
      const latest = await repository.findLatestOpen(userId);
      return latest && isSessionActive(latest, now, timeoutMinutes) ? latest : null;
    },

    async startNew(userId, now = new Date()) {
      const latest = await repository.findLatestOpen(userId);
      if (latest) {
        const endedAt = isSessionActive(latest, now, timeoutMinutes) ? now : latest.lastActiveAt;
        await repository.end(latest.id, endedAt);
      }
      return repository.create(userId, now);
    },

    async touch(sessionId, now = new Date()) {
      await repository.touch(sessionId, now);
    },
  };
}
