import { sessionService } from "@/lib/sessions";
import { createInteractionService } from "./interaction-service";
import { prismaInteractionRepository, prismaProjectLookup } from "./prisma-repositories";

export type { InteractionRecord, InteractionService, RecordInteractionInput, RecordInteractionResult } from "./interaction-service";
export { ProjectNotFoundError, createInteractionService } from "./interaction-service";

/** Application-wide interaction service bound to Prisma and the session service. */
export const interactionService = createInteractionService({
  sessions: sessionService,
  interactions: prismaInteractionRepository,
  projects: prismaProjectLookup,
});
