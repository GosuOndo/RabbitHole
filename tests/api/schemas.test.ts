import { describe, expect, it } from "vitest";
import { MAX_DWELL_MS, recordInteractionSchema, updateProfileSchema } from "@/lib/interactions/schemas";
import { ONBOARDING_PAIRS } from "@/lib/onboarding/pairs";
import { completeOnboardingSchema } from "@/lib/onboarding/schemas";

describe("recordInteractionSchema", () => {
  it("accepts a valid body", () => {
    const parsed = recordInteractionSchema.parse({ projectId: "abc", type: "SAVE", dwellMs: 1500 });
    expect(parsed).toEqual({ projectId: "abc", type: "SAVE", dwellMs: 1500 });
  });

  it("rejects an invalid interaction type", () => {
    const result = recordInteractionSchema.safeParse({ projectId: "abc", type: "LIKE" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path.join(".") === "type")).toBe(true);
  });

  it("rejects a client-supplied weight or session id", () => {
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "SAVE", weight: 100 }).success).toBe(false);
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "SAVE", sessionId: "mine" }).success).toBe(false);
  });

  it("validates dwellMs bounds and integrality", () => {
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "OPEN", dwellMs: -1 }).success).toBe(false);
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "OPEN", dwellMs: 1.5 }).success).toBe(false);
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "OPEN", dwellMs: MAX_DWELL_MS + 1 }).success).toBe(false);
    expect(recordInteractionSchema.safeParse({ projectId: "abc", type: "OPEN", dwellMs: MAX_DWELL_MS }).success).toBe(true);
  });

  it("requires a non-empty project id", () => {
    expect(recordInteractionSchema.safeParse({ projectId: "", type: "OPEN" }).success).toBe(false);
    expect(recordInteractionSchema.safeParse({ type: "OPEN" }).success).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("accepts an exploration preference within [0, 1]", () => {
    expect(updateProfileSchema.parse({ explorationPreference: 0 })).toEqual({ explorationPreference: 0 });
    expect(updateProfileSchema.parse({ explorationPreference: 0.7 })).toEqual({ explorationPreference: 0.7 });
    expect(updateProfileSchema.parse({ explorationPreference: 1 })).toEqual({ explorationPreference: 1 });
  });

  it("rejects out-of-range or non-numeric values", () => {
    expect(updateProfileSchema.safeParse({ explorationPreference: -0.1 }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ explorationPreference: 1.5 }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ explorationPreference: "high" }).success).toBe(false);
  });

  it("rejects arbitrary fields and empty updates", () => {
    expect(updateProfileSchema.safeParse({ onboardingCompleted: true }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ isSynthetic: true }).success).toBe(false);
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
});

describe("completeOnboardingSchema", () => {
  const validChoices = ONBOARDING_PAIRS.map((pair, index) => ({ pairIndex: index, chosenSlug: index % 2 === 0 ? pair.left : pair.right }));
  const valid = { topics: ["systems", "databases", "networking"], difficulty: "ADVANCED", duration: "WEEKEND", choices: validChoices };

  it("accepts a complete valid answer set", () => {
    expect(completeOnboardingSchema.safeParse(valid).success).toBe(true);
    expect(completeOnboardingSchema.safeParse({ ...valid, difficulty: "SURPRISE_ME", duration: "ANYTHING" }).success).toBe(true);
  });

  it("enforces the topic count and known topic keys", () => {
    expect(completeOnboardingSchema.safeParse({ ...valid, topics: ["systems", "databases"] }).success).toBe(false);
    expect(completeOnboardingSchema.safeParse({ ...valid, topics: ["systems", "databases", "networking", "web", "games", "ai", "data", "mobile"] }).success).toBe(false);
    expect(completeOnboardingSchema.safeParse({ ...valid, topics: ["systems", "databases", "quantum"] }).success).toBe(false);
    expect(completeOnboardingSchema.safeParse({ ...valid, topics: ["systems", "systems", "databases"] }).success).toBe(false);
  });

  it("requires every pair to be answered with one of its own projects", () => {
    expect(completeOnboardingSchema.safeParse({ ...valid, choices: validChoices.slice(1) }).success).toBe(false);
    const wrongProject = validChoices.map((c, i) => (i === 0 ? { ...c, chosenSlug: "build-your-own-redis" } : c));
    expect(completeOnboardingSchema.safeParse({ ...valid, choices: wrongProject }).success).toBe(false);
    const duplicatePair = validChoices.map((c, i) => (i === 1 ? { ...c, pairIndex: 0 } : c));
    expect(completeOnboardingSchema.safeParse({ ...valid, choices: duplicatePair }).success).toBe(false);
  });

  it("rejects unknown difficulty / duration values and extra keys", () => {
    expect(completeOnboardingSchema.safeParse({ ...valid, difficulty: "EXPERT" }).success).toBe(false);
    expect(completeOnboardingSchema.safeParse({ ...valid, duration: "FOREVER" }).success).toBe(false);
    expect(completeOnboardingSchema.safeParse({ ...valid, onboardingCompleted: true }).success).toBe(false);
  });
});
