import { prisma } from "@/lib/db";
import type { SessionRecord, SessionRepository } from "./session-service";

export const prismaSessionRepository: SessionRepository = {
  async findLatestOpen(userId: string): Promise<SessionRecord | null> {
    return prisma.session.findFirst({
      where: { userId, endedAt: null },
      orderBy: { lastActiveAt: "desc" },
    });
  },

  async create(userId: string, at: Date): Promise<SessionRecord> {
    return prisma.session.create({ data: { userId, startedAt: at, lastActiveAt: at } });
  },

  async end(sessionId: string, endedAt: Date): Promise<void> {
    await prisma.session.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt } });
  },

  async touch(sessionId: string, at: Date): Promise<void> {
    await prisma.session.updateMany({ where: { id: sessionId, lastActiveAt: { lt: at } }, data: { lastActiveAt: at } });
  },
};
