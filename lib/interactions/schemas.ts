import { z } from "zod";
import { InteractionType } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

/** Upper bound for a plausible dwell time on one project (4 hours). */
export const MAX_DWELL_MS = 4 * 60 * 60 * 1000;

export const INTERACTION_TYPES = Object.values(InteractionType) as [InteractionType, ...InteractionType[]];

/**
 * POST /api/interactions body. Strict: unknown keys such as a client-supplied
 * `weight` or `sessionId` are rejected — the server owns both.
 */
export const recordInteractionSchema = z.strictObject({
  projectId: z.string().trim().min(1).max(64),
  type: z.enum(INTERACTION_TYPES),
  dwellMs: z.number().int().min(0).max(MAX_DWELL_MS).optional(),
});

export type RecordInteractionBody = z.infer<typeof recordInteractionSchema>;

/** PATCH /api/profile body: only explicitly supported settings. */
export const updateProfileSchema = z
  .strictObject({
    explorationPreference: z
      .number()
      .min(RECOMMENDER_CONFIG.exploration.minPreference)
      .max(RECOMMENDER_CONFIG.exploration.maxPreference)
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "No supported settings provided" });

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
