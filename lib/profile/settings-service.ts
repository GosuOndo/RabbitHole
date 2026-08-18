import { prisma } from "@/lib/db";
import type { UpdateProfileBody } from "@/lib/interactions/schemas";

export interface UserSettingsView {
  id: string;
  explorationPreference: number;
  onboardingCompleted: boolean;
  updatedAt: string;
}

/** Applies validated, explicitly supported settings to the user row. */
export async function updateUserSettings(userId: string, body: UpdateProfileBody): Promise<UserSettingsView> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(body.explorationPreference !== undefined ? { explorationPreference: body.explorationPreference } : {}),
    },
    select: { id: true, explorationPreference: true, onboardingCompleted: true, updatedAt: true },
  });
  return { ...updated, updatedAt: updated.updatedAt.toISOString() };
}
