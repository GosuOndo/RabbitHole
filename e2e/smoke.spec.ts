import { expect, test } from "@playwright/test";
import { ensureOnboarded } from "./helpers";

/**
 * Application-shell smoke: the shell renders, the catalog is reachable, and the
 * core pages stay usable at a mobile viewport and from the keyboard. Requires a
 * migrated + seeded database; onboards the demo user itself when needed so the
 * file passes standalone.
 */
test.beforeAll(async ({ request }) => {
  await ensureOnboarded(request);
});

test.describe("application shell", () => {
  test("home redirects to onboarding or discover", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(onboarding|discover)$/);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  test("discover lists catalog projects and opens a detail page", async ({ page }) => {
    await page.goto("/discover");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("What should you build next?");
    const firstProject = page.getByRole("article").first().getByRole("link").first();
    const title = await firstProject.textContent();
    await firstProject.click();
    await expect(page).toHaveURL(/\/project\//);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title ?? "");
    await expect(page.getByRole("heading", { name: "What you'll learn" })).toBeVisible();
  });

  test("insights shows real catalog counts", async ({ page }) => {
    await page.goto("/insights");
    const catalog = page.getByTestId("catalog-stats");
    await expect(catalog).toContainText("Projects");
    const value = await catalog.locator("dd").first().textContent();
    expect(Number((value ?? "0").replace(/[^0-9]/g, ""))).toBeGreaterThan(100);
  });

  test("primary navigation is keyboard operable", async ({ page }) => {
    await page.goto("/discover");
    const savedLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" });
    await savedLink.focus();
    await expect(savedLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/saved/);
    const insightsLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Insights" });
    await insightsLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/insights/);
  });

  test("discover and insights stay usable at a mobile viewport (375px)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    try {
      await page.goto("/discover");
      const firstCard = page.getByTestId("recommendation-card").first();
      await expect(firstCard).toBeVisible();
      await expect(page.getByRole("slider", { name: "Discovery mode" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start new session" })).toBeVisible();
      // No horizontal page overflow.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // Core interactions still work on a small screen.
      await firstCard.getByRole("button", { name: "Why?" }).click();
      await expect(firstCard.getByTestId("recommendation-explanation")).toBeVisible();
      await expect(firstCard.getByTestId("recommendation-explanation")).toContainText("Match score");

      // Insights (the /discover visit above recorded a run, so the pipeline snapshot exists).
      await page.goto("/insights");
      await expect(page.getByTestId("long-term-profile")).toBeVisible();
      await expect(page.getByTestId("pipeline-panel")).toBeVisible();
      const firstResult = page.getByTestId("run-result").first();
      await firstResult.locator("summary").click();
      await expect(firstResult.getByTestId("result-components")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
});
