import { expect, test } from "@playwright/test";

/**
 * Phase 1 smoke test: the shell renders and the catalog is reachable.
 * Requires a migrated + seeded database.
 */
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
});
