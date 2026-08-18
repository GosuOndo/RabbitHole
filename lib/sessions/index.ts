import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { prismaSessionRepository } from "./prisma-session-repository";
import { createSessionService } from "./session-service";

export type { SessionRecord, SessionRepository, SessionService } from "./session-service";
export { createSessionService, isSessionActive } from "./session-service";

/** Application-wide session service bound to Prisma and the configured timeout. */
export const sessionService = createSessionService(prismaSessionRepository, {
  timeoutMinutes: RECOMMENDER_CONFIG.session.timeoutMinutes,
});
