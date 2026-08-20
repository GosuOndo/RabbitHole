import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Shared e2e setup: completes onboarding for the demo user through the real
 * API when it has not happened yet, so every spec file is order-independent
 * (each prepares the state it needs instead of relying on another spec).
 */
export async function ensureOnboarded(request: APIRequestContext): Promise<void> {
  const profile = await (await request.get("/api/profile")).json();
  if (profile.onboarding?.completed) return;
  const definition = await (await request.get("/api/onboarding")).json();
  const response = await request.post("/api/onboarding", {
    data: {
      topics: ["systems", "databases", "networking"],
      difficulty: "ADVANCED",
      duration: "WEEKEND",
      choices: definition.pairs.map((pair: { index: number; left: { slug: string } }) => ({ pairIndex: pair.index, chosenSlug: pair.left.slug })),
    },
  });
  expect(response.ok()).toBe(true);
}
