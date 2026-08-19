import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 2 flows. Runs serially against the reset demo user (see global-setup):
 * onboarding → persistence → interaction recording → profile → sessions → API validation.
 */
test.describe.configure({ mode: "serial" });

type ProfileResponse = {
  user: { explorationPreference: number; onboardingCompleted: boolean };
  onboarding: { completed: boolean; topics: { key: string; label: string }[]; difficultyPreference: string | null; durationPreference: string | null };
  session: { id: string; interactionCount: number } | null;
  longTermProfile: { isEmpty: boolean; includesOnboarding: boolean; tags: { key: string; label: string; strength: number; signal: number }[] };
  sessionProfile: { isEmpty: boolean; tags: { key: string; strength: number }[] };
  stats: { totalInteractions: number; byType: Record<string, number>; savedProjects: number; currentSessionInteractions: number };
};

async function fetchProfile(request: APIRequestContext): Promise<ProfileResponse> {
  const response = await request.get("/api/profile");
  expect(response.ok()).toBe(true);
  return (await response.json()) as ProfileResponse;
}

test.describe("onboarding", () => {
  test("a fresh demo user is sent to onboarding and can complete every step", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 2, name: "What sounds interesting?" })).toBeVisible();

    // Step 1 — topics (3–7). Next stays disabled until the minimum is reached.
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeDisabled();
    for (const topic of [/^Systems/, /^Databases/, /^Networking/]) {
      await page.getByRole("button", { name: topic }).click();
    }
    await expect(page.getByRole("button", { name: /^Systems/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("3 selected")).toBeVisible();
    await expect(next).toBeEnabled();
    await next.click();

    // Step 2 — difficulty.
    await expect(page.getByRole("heading", { level: 2, name: "How challenging?" })).toBeVisible();
    await page.getByRole("radio", { name: /^Advanced/ }).check();
    await next.click();

    // Step 3 — time commitment.
    await expect(page.getByRole("heading", { level: 2, name: /How much time/ })).toBeVisible();
    await page.getByRole("radio", { name: /^Weekend/ }).check();
    await next.click();

    // Step 4 — six pairwise choices; choosing auto-advances.
    await expect(page.getByRole("heading", { level: 2, name: "Which would you rather build?" })).toBeVisible();
    for (let pair = 1; pair <= 6; pair++) {
      await expect(page.getByText(`Pair ${pair} of 6`)).toBeVisible();
      await page.locator('[data-pair-option="left"]').click();
    }

    // Review + finish → redirect to /discover.
    await expect(page.getByRole("heading", { level: 2, name: "Ready to start exploring" })).toBeVisible();
    await expect(page.getByText("Systems, Databases, Networking")).toBeVisible();
    await page.getByRole("button", { name: "Finish and start exploring" }).click();
    await expect(page).toHaveURL(/\/discover$/);

    // Cold start: zero interactions, onboarding-only profile → personalised recommendations already.
    const cards = page.getByTestId("recommendation-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("feed-context")).toContainText("Still learning your taste");
    await expect(cards.first().getByTestId("recommendation-reason")).toContainText("Based on the interests you selected during onboarding");

    // The feed just recorded impressions; they must not become collaborative evidence.
    const feed = await (await request.get("/api/recommendations?limit=10")).json();
    expect(feed.context.collaborative.available).toBe(false);
    expect(feed.context.collaborative.seedCount).toBe(0);
    expect(feed.pipeline.collaborativeCandidates).toBe(0);
    for (const item of feed.items) {
      expect(item.breakdown.collaborative).toBeNull();
      expect(item.sources).not.toContain("collaborative");
      expect(item.explanation.text).not.toMatch(/People who liked/);
    }
  });

  test("onboarding persists after reload and seeds the long-term profile", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/discover$/);

    await page.goto("/onboarding");
    const summary = page.getByTestId("onboarding-complete");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Systems, Databases, Networking");
    await expect(summary).toContainText("Advanced · Weekend");
    await expect(summary.getByRole("button", { name: "Retake onboarding" })).toBeVisible();

    const profile = await fetchProfile(request);
    expect(profile.user.onboardingCompleted).toBe(true);
    expect(profile.onboarding.completed).toBe(true);
    expect(profile.onboarding.topics.map((t) => t.key).sort()).toEqual(["databases", "networking", "systems"]);
    expect(profile.onboarding.difficultyPreference).toBe("ADVANCED");
    expect(profile.onboarding.durationPreference).toBe("WEEKEND");
    expect(profile.longTermProfile.isEmpty).toBe(false);
    expect(profile.longTermProfile.includesOnboarding).toBe(true);
    const tagKeys = profile.longTermProfile.tags.map((t) => t.key);
    expect(tagKeys).toEqual(expect.arrayContaining(["systems", "databases", "networking"]));
    for (const tag of profile.longTermProfile.tags) {
      expect(Number.isFinite(tag.strength)).toBe(true);
      expect(tag.strength).toBeGreaterThan(0);
      expect(tag.strength).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("interactions and profiles", () => {
  test("saving a project through the UI records interactions and updates both profiles", async ({ page, request }) => {
    const before = await fetchProfile(request);

    await page.goto("/project/build-your-own-redis");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build your own Redis");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: /Saved ✓/ })).toBeVisible();

    await expect
      .poll(async () => (await fetchProfile(request)).stats.byType.SAVE ?? 0, { message: "SAVE recorded" })
      .toBeGreaterThanOrEqual(1);
    const after = await fetchProfile(request);
    expect(after.stats.totalInteractions).toBeGreaterThan(before.stats.totalInteractions);
    expect(after.stats.byType.OPEN).toBeGreaterThanOrEqual(1);
    expect(after.stats.savedProjects).toBe(1);
    expect(after.session).not.toBeNull();
    expect(after.session?.interactionCount).toBeGreaterThanOrEqual(2);
    expect(after.stats.currentSessionInteractions).toBe(after.session?.interactionCount);
    expect(after.sessionProfile.isEmpty).toBe(false);
    expect(after.sessionProfile.tags.map((t) => t.key)).toContain("systems");
    expect(after.longTermProfile.tags.find((t) => t.key === "systems")?.signal ?? 0).toBeGreaterThan(
      before.longTermProfile.tags.find((t) => t.key === "systems")?.signal ?? 0,
    );
  });

  test("insights shows the computed profiles and can start a new session", async ({ page, request }) => {
    await page.goto("/insights");
    await expect(page.getByTestId("long-term-profile")).toContainText("Systems");
    await expect(page.getByTestId("session-profile")).toContainText("Systems");
    await expect(page.getByTestId("session-meta")).toContainText(/\d+ interactions?/);
    await expect(page.getByTestId("interaction-stats")).toContainText("Interactions");

    const before = await fetchProfile(request);
    const previousSessionId = before.session?.id;
    expect(previousSessionId).toBeTruthy();

    await page.getByRole("button", { name: "Start new session" }).click();
    await expect(page.getByText("New session started.")).toBeVisible();
    await expect(page.getByTestId("session-meta")).toContainText("0 interactions");

    const after = await fetchProfile(request);
    expect(after.session).not.toBeNull();
    expect(after.session?.id).not.toBe(previousSessionId);
    expect(after.stats.currentSessionInteractions).toBe(0);
    expect(after.sessionProfile.isEmpty).toBe(true);
    // Long-term taste is untouched by starting a new session.
    expect(after.longTermProfile.tags.map((t) => t.key)).toContain("systems");
    expect(after.stats.totalInteractions).toBe(before.stats.totalInteractions);
  });
});

test.describe("API validation", () => {
  test("rejects invalid interactions with proper status codes", async ({ request }) => {
    const invalidType = await request.post("/api/interactions", { data: { projectId: "whatever", type: "LIKE" } });
    expect(invalidType.status()).toBe(400);
    expect((await invalidType.json()).error.code).toBe("validation_error");

    const clientWeight = await request.post("/api/interactions", { data: { projectId: "whatever", type: "SAVE", weight: 50 } });
    expect(clientWeight.status()).toBe(400);

    const missingProject = await request.post("/api/interactions", { data: { projectId: "does-not-exist", type: "SAVE" } });
    expect(missingProject.status()).toBe(404);
    expect((await missingProject.json()).error.code).toBe("project_not_found");

    const malformed = await request.post("/api/interactions", { data: "not json", headers: { "content-type": "application/json" } });
    expect(malformed.status()).toBe(400);
  });

  test("validates and persists the exploration preference", async ({ request }) => {
    const tooHigh = await request.patch("/api/profile", { data: { explorationPreference: 1.5 } });
    expect(tooHigh.status()).toBe(400);
    const wrongField = await request.patch("/api/profile", { data: { onboardingCompleted: false } });
    expect(wrongField.status()).toBe(400);

    const ok = await request.patch("/api/profile", { data: { explorationPreference: 0.8 } });
    expect(ok.status()).toBe(200);
    expect((await fetchProfile(request)).user.explorationPreference).toBeCloseTo(0.8, 6);

    const restore = await request.patch("/api/profile", { data: { explorationPreference: 0.35 } });
    expect(restore.status()).toBe(200);
  });
});
