import { z } from "zod";
import { DurationPreference } from "@/generated/prisma/enums";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { ONBOARDING_PAIRS } from "./pairs";
import { ONBOARDING_TOPIC_KEYS } from "./topics";

/** Difficulty answers; SURPRISE_ME is stored as a null preference. */
export const DIFFICULTY_CHOICES = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "SURPRISE_ME"] as const;
export type DifficultyChoice = (typeof DIFFICULTY_CHOICES)[number];

export const DURATION_CHOICES = Object.values(DurationPreference) as [DurationPreference, ...DurationPreference[]];

export const pairwiseChoiceSchema = z.strictObject({
  pairIndex: z.number().int().min(0).max(Math.max(0, ONBOARDING_PAIRS.length - 1)),
  chosenSlug: z.string().trim().min(1).max(120),
});

/** POST /api/onboarding body. */
export const completeOnboardingSchema = z
  .strictObject({
    topics: z
      .array(z.enum(ONBOARDING_TOPIC_KEYS))
      .min(RECOMMENDER_CONFIG.onboarding.minTopics)
      .max(RECOMMENDER_CONFIG.onboarding.maxTopics),
    difficulty: z.enum(DIFFICULTY_CHOICES),
    duration: z.enum(DURATION_CHOICES),
    choices: z.array(pairwiseChoiceSchema).length(ONBOARDING_PAIRS.length),
  })
  .superRefine((body, ctx) => {
    if (new Set(body.topics).size !== body.topics.length) {
      ctx.addIssue({ code: "custom", path: ["topics"], message: "Topics must be unique" });
    }
    const seenPairs = new Set<number>();
    body.choices.forEach((choice, index) => {
      if (seenPairs.has(choice.pairIndex)) {
        ctx.addIssue({ code: "custom", path: ["choices", index, "pairIndex"], message: "Each pair may be answered once" });
      }
      seenPairs.add(choice.pairIndex);
      const pair = ONBOARDING_PAIRS[choice.pairIndex];
      if (pair && choice.chosenSlug !== pair.left && choice.chosenSlug !== pair.right) {
        ctx.addIssue({
          code: "custom",
          path: ["choices", index, "chosenSlug"],
          message: `chosenSlug must be one of the pair's projects (${pair.left}, ${pair.right})`,
        });
      }
    });
  });

export type CompleteOnboardingBody = z.infer<typeof completeOnboardingSchema>;
