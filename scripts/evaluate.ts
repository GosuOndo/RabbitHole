/**
 * `npm run evaluate` — offline recommender evaluation over the seeded database.
 *
 * Read-only: loads the catalogue, the seeded synthetic users and every
 * interaction in a handful of queries, then runs the pure evaluation runner in
 * memory. It never writes — no Interaction/Session mutations and no Phase 7
 * RecommendationRun diagnostics — and verifies that with before/after counts.
 *
 * Flags: --verbose  per-user cutoffs, held-out projects, lists and hits.
 */

import "dotenv/config";
import { DatabaseConfigurationError, prisma } from "@/lib/db";
import { loadCatalogItems } from "@/lib/recommendations/loaders";
import { formatReport } from "@/lib/recommender/evaluation/format";
import { EvaluationError, runEvaluation } from "@/lib/recommender/evaluation/runner";
import type { EvaluationDataset } from "@/lib/recommender/evaluation/types";

async function tableCounts(): Promise<{ interactions: number; sessions: number; recommendationRuns: number }> {
  const [interactions, sessions, recommendationRuns] = await Promise.all([
    prisma.interaction.count(),
    prisma.session.count(),
    prisma.recommendationRun.count(),
  ]);
  return { interactions, sessions, recommendationRuns };
}

async function loadDataset(): Promise<EvaluationDataset> {
  const [catalog, users, interactions] = await Promise.all([
    loadCatalogItems(),
    // Evaluation is restricted to the deterministic seeded synthetic population;
    // the demo user's local history varies with manual browsing and would make
    // the split fingerprint unstable.
    prisma.user.findMany({
      where: { isSynthetic: true },
      select: { id: true, handle: true, explorationPreference: true },
      orderBy: { handle: "asc" },
    }),
    prisma.interaction.findMany({
      select: { id: true, userId: true, projectId: true, sessionId: true, type: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const syntheticIds = new Set(users.map((user) => user.id));
  return { catalog, users, interactions: interactions.filter((interaction) => syntheticIds.has(interaction.userId)) };
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose");
  const before = await tableCounts();
  const dataset = await loadDataset();
  const report = runEvaluation(dataset);
  console.log(formatReport(report, { verbose }));
  const after = await tableCounts();
  const readOnly = before.interactions === after.interactions && before.sessions === after.sessions && before.recommendationRuns === after.recommendationRuns;
  console.log(
    `\nread-only check: interactions ${before.interactions}→${after.interactions}, sessions ${before.sessions}→${after.sessions}, recommendation runs ${before.recommendationRuns}→${after.recommendationRuns} ${readOnly ? "✓" : "✗"}`,
  );
  if (!readOnly) {
    console.error("evaluation mutated the database — this is a bug");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    if (error instanceof DatabaseConfigurationError || error instanceof EvaluationError) {
      console.error(`\nevaluation failed: ${error.message}`);
    } else {
      console.error("\nevaluation failed unexpectedly:", error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
