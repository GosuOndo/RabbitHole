/**
 * Interaction recording.
 *
 * The API layer validates the body; this service enforces the invariants that
 * do not depend on transport: the project must exist, the session is resolved
 * server-side, and the weight always comes from RECOMMENDER_CONFIG (a client
 * cannot supply one). Written against small repository interfaces so it can be
 * unit-tested with in-memory fakes.
 */

import type { InteractionType } from "@/generated/prisma/enums";
import { interactionWeight } from "@/lib/recommender/config";
import type { SessionRecord, SessionService } from "@/lib/sessions/session-service";

export interface InteractionRecord {
  id: string;
  userId: string;
  projectId: string;
  sessionId: string;
  type: InteractionType;
  weight: number;
  dwellMs: number | null;
  createdAt: Date;
}

export interface InteractionRepository {
  create(data: Omit<InteractionRecord, "id">): Promise<InteractionRecord>;
}

export interface ProjectLookup {
  exists(projectId: string): Promise<boolean>;
}

export interface RecordInteractionInput {
  userId: string;
  projectId: string;
  type: InteractionType;
  dwellMs?: number | null;
  now?: Date;
}

export interface RecordInteractionResult {
  interaction: InteractionRecord;
  session: SessionRecord;
  sessionCreated: boolean;
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export interface InteractionServiceDeps {
  sessions: SessionService;
  interactions: InteractionRepository;
  projects: ProjectLookup;
}

export interface InteractionService {
  record(input: RecordInteractionInput): Promise<RecordInteractionResult>;
}

export function createInteractionService(deps: InteractionServiceDeps): InteractionService {
  return {
    async record(input) {
      const now = input.now ?? new Date();
      if (!(await deps.projects.exists(input.projectId))) {
        throw new ProjectNotFoundError(input.projectId);
      }
      const { session, created } = await deps.sessions.resolveActive(input.userId, now);
      const interaction = await deps.interactions.create({
        userId: input.userId,
        projectId: input.projectId,
        sessionId: session.id,
        type: input.type,
        weight: interactionWeight(input.type),
        dwellMs: input.dwellMs ?? null,
        createdAt: now,
      });
      await deps.sessions.touch(session.id, now);
      return {
        interaction,
        session: { ...session, lastActiveAt: now },
        sessionCreated: created,
      };
    },
  };
}
