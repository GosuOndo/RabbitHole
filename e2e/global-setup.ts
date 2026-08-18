import { execFileSync } from "node:child_process";

/**
 * Puts the database into a known state before the e2e suite: re-runs the
 * deterministic seed and resets the demo user's behavioural/onboarding state
 * (`--reset-demo`), so onboarding starts from scratch and counts are predictable.
 */
export default function globalSetup(): void {
  execFileSync("npx", ["tsx", "prisma/seed.ts", "--reset-demo"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
}
