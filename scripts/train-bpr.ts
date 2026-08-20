/**
 * `npm run train:bpr` — trains the full-data BPR experiment model on the
 * seeded synthetic population and writes the reproducible artifact to
 * data/generated/bpr-model.json (gitignored; rerun this command to recreate
 * it byte-for-byte apart from the informational createdAt timestamp).
 *
 * Read-only with respect to the database (verified with before/after counts).
 * NOTE: this full-data artifact is for inspection/demo only — the offline
 * evaluation trains its own leakage-safe per-cutoff models and never uses it.
 */

import "dotenv/config";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseConfigurationError, prisma } from "@/lib/db";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildBprDataset } from "@/lib/recommender/bpr/data";
import { parseBprArtifact, serializeBprModel } from "@/lib/recommender/bpr/serialize";
import { trainBpr, BprTrainingError } from "@/lib/recommender/bpr/train";

const ARTIFACT_PATH = join("data", "generated", "bpr-model.json");

async function tableCounts(): Promise<{ interactions: number; sessions: number; recommendationRuns: number }> {
  const [interactions, sessions, recommendationRuns] = await Promise.all([
    prisma.interaction.count(),
    prisma.session.count(),
    prisma.recommendationRun.count(),
  ]);
  return { interactions, sessions, recommendationRuns };
}

async function main(): Promise<void> {
  const config = RECOMMENDER_CONFIG.bpr;
  const before = await tableCounts();

  // Deterministic training population: the seeded synthetic users (the demo
  // user's local history varies with manual browsing and would destabilise the
  // artifact fingerprint), full catalogue as the item universe.
  const [projects, syntheticUsers] = await Promise.all([
    prisma.project.findMany({ select: { id: true }, orderBy: { slug: "asc" } }),
    prisma.user.findMany({ where: { isSynthetic: true }, select: { id: true } }),
  ]);
  const syntheticIds = new Set(syntheticUsers.map((user) => user.id));
  const interactions = (
    await prisma.interaction.findMany({
      select: { userId: true, projectId: true, type: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  ).filter((interaction) => syntheticIds.has(interaction.userId));

  if (projects.length === 0) throw new Error("The project catalogue is empty — run `npm run seed` first.");
  const dataset = buildBprDataset(interactions, projects.map((project) => project.id), config);
  if (dataset.userIds.length === 0) throw new Error("No users with strong-positive projects — run `npm run seed` first.");

  console.log("RabbitHole BPR training (full-data experiment model)");
  console.log("─".repeat(60));
  console.log(`users represented         ${dataset.userIds.length}`);
  console.log(`projects represented      ${dataset.projectIds.length}`);
  console.log(`positive projects         ${dataset.positiveCount}`);
  console.log(`explicit negatives        ${dataset.explicitNegativeCount}`);
  console.log(`pairs per epoch           ${dataset.positiveCount * config.samplesPerPositive}`);
  console.log(`factors/epochs            ${config.factors} / ${config.epochs}`);
  console.log(`learning rate / L2        ${config.learningRate} / ${config.regularization}`);
  console.log(`seed                      ${config.seed}`);
  console.log(`data fingerprint          ${dataset.fingerprint}`);

  const started = performance.now();
  const model = trainBpr({ dataset, seedKey: `bpr:${config.seed}:full`, config });
  const trainingMs = performance.now() - started;

  console.log("\nepoch      pairs   mean loss   pairwise accuracy");
  const printed = new Set([1, 10, 20, 40, 60, config.epochs]);
  for (const entry of model.diagnostics) {
    if (!printed.has(entry.epoch)) continue;
    console.log(`${String(entry.epoch).padStart(5)} ${String(entry.pairs).padStart(10)}   ${entry.meanLoss.toFixed(4).padStart(9)}   ${entry.pairwiseAccuracy.toFixed(4).padStart(17)}`);
  }
  console.log(`\ntraining time             ${trainingMs.toFixed(0)} ms`);

  const artifact = serializeBprModel(model, new Date());
  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact), "utf-8");
  // Round-trip validation: the artifact on disk must load cleanly.
  parseBprArtifact(JSON.parse(JSON.stringify(artifact)), config.artifactVersion);
  const sizeKb = statSync(ARTIFACT_PATH).size / 1024;
  console.log(`artifact                  ${ARTIFACT_PATH} (${sizeKb.toFixed(1)} KB)`);
  console.log(`model checksum            ${artifact.checksum}`);

  const after = await tableCounts();
  const readOnly = JSON.stringify(before) === JSON.stringify(after);
  console.log(`read-only check: interactions ${before.interactions}→${after.interactions}, sessions ${before.sessions}→${after.sessions}, recommendation runs ${before.recommendationRuns}→${after.recommendationRuns} ${readOnly ? "✓" : "✗"}`);
  if (!readOnly) {
    console.error("training mutated the database — this is a bug");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    if (error instanceof DatabaseConfigurationError || error instanceof BprTrainingError) {
      console.error(`\nBPR training failed: ${error.message}`);
    } else {
      console.error("\nBPR training failed unexpectedly:", error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
