import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

/**
 * V1 has no authentication: every request acts as the persistent demo user.
 * The user row is created on first access so a fresh database works without a
 * seed, and the seed script creates the same row by handle. A future auth layer
 * would replace this lookup with the authenticated user's row.
 */
export const DEMO_USER_HANDLE = "demo";
export const DEMO_USER_NAME = "Demo Explorer";

export async function getOrCreateDemoUser(): Promise<User> {
  return prisma.user.upsert({
    where: { handle: DEMO_USER_HANDLE },
    update: {},
    create: {
      handle: DEMO_USER_HANDLE,
      name: DEMO_USER_NAME,
      explorationPreference: RECOMMENDER_CONFIG.exploration.defaultPreference,
      onboardingCompleted: false,
      isSynthetic: false,
    },
  });
}
