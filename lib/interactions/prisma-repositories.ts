import { prisma } from "@/lib/db";
import type { InteractionRecord, InteractionRepository, ProjectLookup } from "./interaction-service";

export const prismaInteractionRepository: InteractionRepository = {
  async create(data): Promise<InteractionRecord> {
    return prisma.interaction.create({ data });
  },
};

export const prismaProjectLookup: ProjectLookup = {
  async exists(projectId: string): Promise<boolean> {
    const count = await prisma.project.count({ where: { id: projectId } });
    return count > 0;
  },
};
