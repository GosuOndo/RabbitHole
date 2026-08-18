import type { InteractionRecord, InteractionRepository, ProjectLookup } from "@/lib/interactions/interaction-service";
import type { SessionRecord, SessionRepository } from "@/lib/sessions/session-service";

/** In-memory SessionRepository for unit tests (mirrors the Prisma semantics). */
export class InMemorySessionRepository implements SessionRepository {
  readonly sessions: SessionRecord[] = [];
  private counter = 0;

  async findLatestOpen(userId: string): Promise<SessionRecord | null> {
    const open = this.sessions.filter((s) => s.userId === userId && s.endedAt === null);
    open.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
    return open[0] ? { ...open[0] } : null;
  }

  async create(userId: string, at: Date): Promise<SessionRecord> {
    this.counter += 1;
    const session: SessionRecord = { id: `session-${this.counter}`, userId, startedAt: at, lastActiveAt: at, endedAt: null };
    this.sessions.push(session);
    return { ...session };
  }

  async end(sessionId: string, endedAt: Date): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session && session.endedAt === null) session.endedAt = endedAt;
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session && session.lastActiveAt < at) session.lastActiveAt = at;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.find((s) => s.id === sessionId);
  }
}

export class InMemoryInteractionRepository implements InteractionRepository {
  readonly interactions: InteractionRecord[] = [];
  private counter = 0;

  async create(data: Omit<InteractionRecord, "id">): Promise<InteractionRecord> {
    this.counter += 1;
    const record: InteractionRecord = { id: `interaction-${this.counter}`, ...data };
    this.interactions.push(record);
    return { ...record };
  }
}

export class InMemoryProjectLookup implements ProjectLookup {
  constructor(private readonly ids: Set<string>) {}
  async exists(projectId: string): Promise<boolean> {
    return this.ids.has(projectId);
  }
}
