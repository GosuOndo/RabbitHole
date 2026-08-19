import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Phase 3 flows: the personalised feed, feedback from the feed, saved page,
 * project detail context + similar projects, keyboard controls and impressions.
 * Runs after onboarding-and-profile.spec.ts (alphabetical order), but ensures
 * onboarding is complete anyway so it is order-independent.
 */
test.describe.configure({ mode: "serial" });

type FeedResponse = {
  items: {
    rank: number;
    score: number;
    project: { id: string; slug: string; title: string };
    explanation: { text: string; primary: string; factors: { kind: string; features: { id: string; label: string }[] }[] };
    preDiversificationRank: number;
    sources: string[];
    breakdown: { content: number | null; collaborative: number | null; novelty: number | null; popularity: number | null };
    weights: { content?: number; collaborative?: number; novelty?: number; popularity?: number };
    collaborative: { score: number; confidence: number; seeds: { projectId: string; slug: string; title: string; state: string; similarity: number }[] } | null;
    novelty: { novelty: number; underexposure: number; adjacency: number };
    exploration: { explorationScore: number; plausibility: number; plausibilitySource: string } | null;
    diversification: { mmrScore: number; maxSimilarityToSelected: number; admittedUnderRelaxation: boolean };
  }[];
  pipeline: {
    contentCandidates: number;
    collaborativeCandidates: number;
    popularCandidates: number;
    explorationCandidates: number;
    uniqueCandidates: number;
    afterFiltering: number;
    ranked: number;
    preDiversificationCandidates: number;
    diversifiedCandidates: number;
    final: number;
  };
  context: {
    coldStart: boolean;
    profileEmpty: boolean;
    collaborative: { available: boolean; seedCount: number; confidence: number; candidatesWithEvidence: number };
    exploration: { preference: number; mode: string; candidateLimit: number };
    diversification: { applied: boolean; lambda: number; maxTagShare: number; maxPerTag: number; relaxationLevel: number };
    components: string[];
  };
};

async function setExplorationPreference(request: APIRequestContext, value: number): Promise<void> {
  const response = await request.patch("/api/profile", { data: { explorationPreference: value } });
  expect(response.ok()).toBe(true);
  const profile = await (await request.get("/api/profile")).json();
  expect(profile.user.explorationPreference).toBeCloseTo(value, 6);
}

async function ensureOnboarded(request: APIRequestContext): Promise<void> {
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

async function fetchFeed(request: APIRequestContext, limit = 10): Promise<FeedResponse> {
  const response = await request.get(`/api/recommendations?limit=${limit}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as FeedResponse;
}

async function firstCardSlug(page: Page): Promise<string> {
  const slug = await page.getByTestId("recommendation-card").first().getAttribute("data-project-slug");
  expect(slug).toBeTruthy();
  return slug!;
}

test.beforeAll(async ({ request }) => {
  await ensureOnboarded(request);
});

test.describe("recommendation API", () => {
  test("returns typed personalised recommendations and validates the limit", async ({ request }) => {
    const feed = await fetchFeed(request, 5);
    expect(feed.items).toHaveLength(5);
    expect(new Set(feed.items.map((i) => i.project.id)).size).toBe(5);
    expect(feed.pipeline.contentCandidates).toBeGreaterThan(0);
    expect(feed.pipeline.popularCandidates).toBeGreaterThan(0);
    for (const item of feed.items) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(item.explanation.text.length).toBeGreaterThan(0);
      expect(item.sources.length).toBeGreaterThan(0);
    }
    expect((await request.get("/api/recommendations?limit=0")).status()).toBe(400);
    expect((await request.get("/api/recommendations?limit=abc")).status()).toBe(400);
    const capped = await fetchFeed(request, 999).catch(() => null);
    expect(capped).toBeNull();
    expect((await request.get("/api/recommendations?limit=999")).status()).toBe(400);
  });

  test("exposes a typed hybrid score breakdown and collaborative evidence for a user with behavioural history", async ({ request }) => {
    // By now the demo user has saved / opened projects (onboarding-and-profile.spec.ts), so seeds exist.
    const profile = await (await request.get("/api/profile")).json();
    expect(profile.stats.savedProjects + profile.stats.byType.OPEN).toBeGreaterThan(0);

    const feed = await fetchFeed(request, 10);
    expect(typeof feed.pipeline.collaborativeCandidates).toBe("number");
    expect(feed.context.collaborative.available).toBe(true);
    expect(feed.context.collaborative.seedCount).toBeGreaterThan(0);
    expect(feed.context.components).toEqual(["content", "collaborative", "novelty", "popularity"]);
    for (const item of feed.items) {
      for (const key of ["content", "collaborative", "novelty", "popularity"] as const) {
        const value = item.breakdown[key];
        expect(value === null || (typeof value === "number" && Number.isFinite(value))).toBe(true);
      }
      expect(item.weights.content).toBeGreaterThan(item.weights.collaborative ?? 0);
      if (item.sources.includes("collaborative")) {
        expect(item.breakdown.collaborative).not.toBeNull();
        expect(item.breakdown.collaborative!).toBeGreaterThan(0);
        expect(item.collaborative).not.toBeNull();
        expect(item.collaborative!.seeds.length).toBeGreaterThan(0);
      } else {
        expect(item.breakdown.collaborative).toBeNull();
        expect(item.collaborative).toBeNull();
        expect(item.explanation.text).not.toMatch(/People who liked/);
      }
    }
    const collaborativeItems = feed.items.filter((item) => item.sources.includes("collaborative"));
    expect(collaborativeItems.length).toBeGreaterThan(0);
    // Popularity-only items exist independently of collaborative evidence.
    expect(feed.pipeline.popularCandidates).toBeGreaterThan(0);
  });

  test("is deterministic for the same state", async ({ request }) => {
    const a = await fetchFeed(request);
    const b = await fetchFeed(request);
    // Time decay uses the request time, so scores can drift in the far decimals
    // between two calls; ordering and rounded scores must be identical.
    expect(a.items.map((i) => [i.project.slug, i.score.toFixed(4)])).toEqual(b.items.map((i) => [i.project.slug, i.score.toFixed(4)]));
  });

  test("exposes exploration, novelty and diversification diagnostics, and the exploration preference changes the feed", async ({ request }) => {
    const original = (await (await request.get("/api/profile")).json()).user.explorationPreference as number;
    try {
      await setExplorationPreference(request, 0);
      const familiar = await fetchFeed(request, 10);
      await setExplorationPreference(request, 1);
      const adventurous = await fetchFeed(request, 10);

      expect(familiar.context.exploration).toMatchObject({ preference: 0, mode: "familiar", candidateLimit: 8 });
      expect(adventurous.context.exploration).toMatchObject({ preference: 1, mode: "adventurous", candidateLimit: 15 });
      expect(familiar.pipeline.explorationCandidates).toBe(8);
      expect(adventurous.pipeline.explorationCandidates).toBe(15);
      for (const feed of [familiar, adventurous]) {
        expect(feed.context.diversification.applied).toBe(true);
        expect(feed.pipeline.preDiversificationCandidates).toBe(feed.pipeline.ranked);
        expect(feed.pipeline.diversifiedCandidates).toBe(feed.items.length);
        expect(new Set(feed.items.map((i) => i.project.id)).size).toBe(feed.items.length);
        expect(feed.items[0]!.rank).toBe(1);
        expect(feed.items[0]!.preDiversificationRank).toBe(1);
        for (const item of feed.items) {
          expect(item.breakdown.novelty).not.toBeNull();
          expect(item.novelty.novelty).toBeGreaterThanOrEqual(0);
          expect(item.novelty.novelty).toBeLessThanOrEqual(1);
          expect(item.diversification.mmrScore).toBeLessThanOrEqual(item.score + 1e-9);
          if (item.sources.includes("exploration")) expect(item.exploration).not.toBeNull();
          else expect(item.exploration).toBeNull();
        }
      }
      // Weights move with the preference and remain normalised.
      const sum = (w: FeedResponse["items"][number]["weights"]) => Object.values(w).reduce((s, v) => s + (v ?? 0), 0);
      expect(sum(familiar.items[0]!.weights)).toBeCloseTo(1, 6);
      expect(sum(adventurous.items[0]!.weights)).toBeCloseTo(1, 6);
      expect(adventurous.items[0]!.weights.novelty!).toBeGreaterThan(familiar.items[0]!.weights.novelty!);
      expect(adventurous.items[0]!.weights.content!).toBeLessThan(familiar.items[0]!.weights.content!);
      expect(adventurous.context.diversification.lambda).toBeLessThan(familiar.context.diversification.lambda);
      // Composition changes but relevance is kept: not the same top-10, more novelty on average, no dislikes resurface.
      const familiarIds = new Set(familiar.items.map((i) => i.project.id));
      const overlap = adventurous.items.filter((i) => familiarIds.has(i.project.id)).length;
      expect(overlap).toBeLessThan(familiar.items.length);
      const meanNovelty = (feed: FeedResponse) => feed.items.reduce((s, i) => s + i.novelty.novelty, 0) / feed.items.length;
      expect(meanNovelty(adventurous)).toBeGreaterThan(meanNovelty(familiar));
      for (const item of adventurous.items) expect((item.breakdown.content ?? 0) > 0 || (item.breakdown.collaborative ?? 0) > 0).toBe(true);
    } finally {
      await setExplorationPreference(request, original);
    }
  });

  test("rejects invalid exploration preferences and keeps dislikes/builds excluded for every preference", async ({ request }) => {
    const original = (await (await request.get("/api/profile")).json()).user.explorationPreference as number;
    expect((await request.patch("/api/profile", { data: { explorationPreference: 1.5 } })).status()).toBe(400);
    expect((await request.patch("/api/profile", { data: { explorationPreference: -0.1 } })).status()).toBe(400);
    expect((await request.patch("/api/profile", { data: { explorationPreference: "high" } })).status()).toBe(400);
    expect((await (await request.get("/api/profile")).json()).user.explorationPreference).toBeCloseTo(original, 6);

    // Create real terminal states from the current feed: dislike one recommendation, mark another as built.
    const seedFeed = await fetchFeed(request, 30);
    const [toDislike, toBuild] = seedFeed.items.slice(-2);
    expect(toDislike && toBuild).toBeTruthy();
    for (const [item, type] of [
      [toDislike!, "DISLIKE"],
      [toBuild!, "BUILD"],
    ] as const) {
      const response = await request.post("/api/interactions", { data: { projectId: item.project.id, type } });
      expect(response.ok()).toBe(true);
    }
    const excluded = new Set([toDislike!.project.id, toBuild!.project.id]);
    try {
      for (const value of [0, 1]) {
        await setExplorationPreference(request, value);
        const feed = await fetchFeed(request, 30);
        for (const item of feed.items) expect(excluded.has(item.project.id)).toBe(false);
      }
    } finally {
      await setExplorationPreference(request, original);
    }
  });
});

test.describe("discover feed", () => {
  test("shows personalised cards with real scores and explanations, and records impressions once per card", async ({ page, request }) => {
    const before = await (await request.get("/api/profile")).json();
    await page.goto("/discover");
    const cards = page.getByTestId("recommendation-card");
    await expect(cards.first()).toBeVisible();
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(5);
    const feed = await fetchFeed(request);
    await expect(cards.first()).toHaveAttribute("data-project-slug", feed.items[0]!.project.slug);
    await expect(cards.first()).toContainText(String(Math.round(feed.items[0]!.score * 100)));
    await expect(cards.first().getByTestId("recommendation-reason")).toContainText(feed.items[0]!.explanation.text);

    const impressionsSoFar = async () =>
      ((await (await request.get("/api/profile")).json()).stats.byType.IMPRESSION as number) - (before.stats.byType.IMPRESSION as number);
    const scrollThrough = async (direction: 1 | -1) => {
      for (let step = 0; step < 16; step++) {
        await page.mouse.wheel(0, direction * 320);
        await page.waitForTimeout(120);
      }
    };

    // Scrolling through the feed surfaces every card exactly once.
    await scrollThrough(1);
    await expect.poll(impressionsSoFar, { timeout: 10_000 }).toBeGreaterThanOrEqual(cardCount);
    const afterFirstPass = await impressionsSoFar();
    expect(afterFirstPass).toBeLessThanOrEqual(cardCount);

    // Re-surfacing the same cards in the same feed instance records nothing new.
    await scrollThrough(-1);
    await scrollThrough(1);
    await page.waitForTimeout(500);
    expect(await impressionsSoFar()).toBe(afterFirstPass);

    // A reload is a new surfacing: impressions grow again, but never beyond one per card per load.
    await page.reload();
    await expect(page.getByTestId("recommendation-card").first()).toBeVisible();
    await scrollThrough(1);
    await expect.poll(impressionsSoFar, { timeout: 10_000 }).toBeGreaterThan(afterFirstPass);
    expect(await impressionsSoFar()).toBeLessThanOrEqual(cardCount * 2);
  });

  test("Why? reveals the score breakdown including the Novelty row", async ({ page }) => {
    await page.goto("/discover");
    const first = page.getByTestId("recommendation-card").first();
    await first.getByRole("button", { name: "Why?" }).click();
    const explanation = first.getByTestId("recommendation-explanation");
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText("Content affinity");
    await expect(explanation).toContainText("Collaborative signal");
    await expect(explanation).toContainText("Novelty");
    await expect(explanation).toContainText("Popularity");
    await expect(explanation).toContainText("Match score");
    await expect(explanation).toContainText("Discovery mode:");
    await first.getByRole("button", { name: "Why?" }).click();
    await expect(explanation).toBeHidden();
  });

  test("the discovery-mode slider loads the persisted preference, saves changes, refreshes the feed and survives reload", async ({ page, request }) => {
    const original = (await (await request.get("/api/profile")).json()).user.explorationPreference as number;
    try {
      await setExplorationPreference(request, 0);
      await page.goto("/discover");
      const slider = page.getByRole("slider", { name: "Discovery mode" });
      await expect(slider).toBeVisible();
      await expect(slider).toHaveValue("0");
      await expect(page.getByTestId("exploration-slider")).toContainText("Familiar");
      await expect(page.getByTestId("recommendation-feed")).toHaveAttribute("data-hydrated", "true");
      const familiarFirst = await firstCardSlug(page);
      const familiarSlugs = await page.getByTestId("recommendation-card").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-project-slug")));

      // Move to fully adventurous with the keyboard (accessible range input), then wait for the debounced PATCH + refetch.
      await slider.focus();
      const patch = page.waitForResponse((response) => response.url().includes("/api/profile") && response.request().method() === "PATCH");
      const refetch = page.waitForResponse((response) => response.url().includes("/api/recommendations") && response.request().method() === "GET");
      await slider.press("End");
      await expect(slider).toHaveValue("1");
      expect((await patch).ok()).toBe(true);
      expect((await refetch).ok()).toBe(true);
      await expect(page.getByTestId("feed-message")).toContainText("Feed refreshed for your discovery mode.");
      await expect(page.getByTestId("exploration-slider")).toContainText("Adventurous");
      await expect(page.getByTestId("feed-context")).toContainText("Adventurous");

      // The preference is persisted server-side and the feed composition actually changed.
      const profile = await (await request.get("/api/profile")).json();
      expect(profile.user.explorationPreference).toBeCloseTo(1, 6);
      const adventurousSlugs = await page.getByTestId("recommendation-card").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-project-slug")));
      expect(new Set(adventurousSlugs).size).toBe(adventurousSlugs.length);
      expect(adventurousSlugs).not.toEqual(familiarSlugs);
      const feed = await fetchFeed(request, 10);
      await expect(page.getByTestId("recommendation-card").first()).toHaveAttribute("data-project-slug", feed.items[0]!.project.slug);
      expect(feed.context.exploration.mode).toBe("adventurous");

      // Reload: the slider reflects the stored value and the feed is served for it.
      await page.reload();
      await expect(page.getByRole("slider", { name: "Discovery mode" })).toHaveValue("1");
      await expect(page.getByTestId("recommendation-card").first()).toBeVisible();
      await expect(page.getByTestId("feed-context")).toContainText("Adventurous");
      expect(typeof familiarFirst).toBe("string");
    } finally {
      await setExplorationPreference(request, original);
    }
  });

  test("a card with collaborative evidence lists the user's own seed projects in the breakdown", async ({ page, request }) => {
    const feed = await fetchFeed(request, 10);
    const collaborative = feed.items.find((item) => item.sources.includes("collaborative"));
    expect(collaborative).toBeDefined();
    await page.goto("/discover");
    const card = page.locator(`[data-testid="recommendation-card"][data-project-slug="${collaborative!.project.slug}"]`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Why?" }).click();
    const evidence = card.getByTestId("collaborative-evidence");
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText(collaborative!.collaborative!.seeds[0]!.title);
  });

  test("saving from the feed puts the project on /saved with working filters", async ({ page, request }) => {
    await page.goto("/discover");
    const first = page.getByTestId("recommendation-card").first();
    const slug = await firstCardSlug(page);
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.getByRole("button", { name: /Saved ✓/ })).toBeVisible();

    await page.goto("/saved");
    const savedItem = page.locator(`[data-testid="saved-item"][data-project-slug="${slug}"]`);
    await expect(savedItem).toBeVisible();
    const profile = await (await request.get("/api/profile")).json();
    expect(profile.stats.savedProjects).toBeGreaterThanOrEqual(1);

    // Filters: a facet value that exists keeps at least one item; a bogus tag empties the list; sorting keeps the list.
    const firstTagSlug = await page.locator("select[name='tag'] option").nth(1).getAttribute("value");
    expect(firstTagSlug).toBeTruthy();
    await page.goto(`/saved?tag=${firstTagSlug}`);
    await expect(page.getByTestId("saved-list")).toBeVisible();
    expect(await page.getByTestId("saved-item").count()).toBeGreaterThanOrEqual(1);
    await page.goto("/saved?sort=shortest");
    await expect(page.getByTestId("saved-list")).toBeVisible();
    await page.goto("/saved?tag=this-tag-does-not-exist");
    await expect(page.getByText("No saved projects match these filters.")).toBeVisible();
  });

  test("disliking a recommendation removes it from the feed and from subsequent recommendations", async ({ page, request }) => {
    await page.goto("/discover");
    const cards = page.getByTestId("recommendation-card");
    await expect(cards.first()).toBeVisible();
    // Choose the second card so the first (saved) card is untouched.
    const target = cards.nth(1);
    const slug = await target.getAttribute("data-project-slug");
    expect(slug).toBeTruthy();
    await target.getByRole("button", { name: "Nope" }).click();
    await expect(page.locator(`[data-testid="recommendation-card"][data-project-slug="${slug}"]`)).toHaveCount(0);
    await expect(page.getByTestId("feed-message")).toContainText("fewer projects like");

    const feed = await fetchFeed(request, 30);
    expect(feed.items.some((item) => item.project.slug === slug)).toBe(false);
    const profile = await (await request.get("/api/profile")).json();
    expect(profile.stats.dislikedProjects).toBeGreaterThanOrEqual(1);
  });

  test("opening a recommendation shows the recommendation context and similar projects", async ({ page }) => {
    await page.goto("/discover");
    const first = page.getByTestId("recommendation-card").first();
    const slug = await firstCardSlug(page);
    await first.getByRole("link", { name: "Open details" }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${slug}\\?ref=discover&rank=1$`));
    await expect(page.getByTestId("recommendation-context")).toBeVisible();
    await expect(page.getByTestId("recommendation-context")).toContainText("ranked #1 in your feed");
    const similar = page.getByTestId("similar-projects");
    await expect(similar).toBeVisible();
    const similarCards = similar.getByRole("article");
    expect(await similarCards.count()).toBeGreaterThanOrEqual(3);
    expect(await similar.locator(`a[href="/project/${slug}"]`).count()).toBe(0);
  });

  test("keyboard: → moves the current card, ? toggles the explanation, S saves, and typing in inputs is ignored", async ({ page }) => {
    await page.goto("/discover");
    const cards = page.getByTestId("recommendation-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute("aria-current", "true");
    // Keyboard shortcuts are client-side: wait until React has hydrated the feed.
    await expect(page.getByTestId("recommendation-feed")).toHaveAttribute("data-hydrated", "true");

    await page.keyboard.press("ArrowRight");
    await expect(cards.nth(1)).toHaveAttribute("aria-current", "true");

    await page.keyboard.press("?");
    await expect(cards.nth(1).getByTestId("recommendation-explanation")).toBeVisible();
    await page.keyboard.press("?");
    await expect(cards.nth(1).getByTestId("recommendation-explanation")).toBeHidden();

    const secondSlug = await cards.nth(1).getAttribute("data-project-slug");
    await page.keyboard.press("s");
    await expect(cards.nth(1).getByRole("button", { name: /Saved ✓/ })).toBeVisible();
    await page.keyboard.press("s");
    await expect(cards.nth(1).getByRole("button", { name: "Save", exact: true })).toBeVisible();
    expect(secondSlug).toBeTruthy();

    // Shortcuts must not fire while typing in a form control.
    await page.goto("/saved");
    const select = page.locator("select[name='sort']");
    if (await select.count()) {
      await select.focus();
      await page.keyboard.press("s");
      await expect(page).toHaveURL(/\/saved/);
    }
  });
});
