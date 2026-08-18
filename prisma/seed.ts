/**
 * Deterministic database seed.
 *
 *   npm run seed                 # or: npx prisma db seed
 *   npm run seed -- --reset-demo # also wipe the demo user's behavioural state
 *
 * What it does:
 *   1. Validates the hand-authored catalog and upserts tags, languages and
 *      projects by slug (existing rows are updated, removed slugs are deleted).
 *   2. Ensures the persistent demo user exists (left untouched on re-runs unless
 *      --reset-demo is passed).
 *   3. Recreates the synthetic population: 30 users generated from latent
 *      interest archetypes, with sessions and thousands of structured
 *      interactions produced by a seeded PRNG. Re-running produces identical
 *      rows (ids included) for the same anchor date.
 *
 * Timestamps are relative to SEED_ANCHOR_DATE or, by default, the start of the
 * current UTC day, so re-running on the same day is byte-for-byte reproducible.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { RECOMMENDER_CONFIG, interactionWeight } from "../lib/recommender/config";
import { LANGUAGES, PROJECTS, TAGS, validateCatalog } from "./seed-data/catalog";
import { generateSyntheticDataset, resolveSeedAnchor } from "./seed-data/synthetic";

export const DEMO_USER_HANDLE = "demo";
export const DEMO_USER_NAME = "Demo Explorer";

const CHUNK_SIZE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set a PostgreSQL connection string before seeding.",
    );
  }
  const resetDemo = process.argv.includes("--reset-demo");
  const anchor = resolveSeedAnchor(process.env.SEED_ANCHOR_DATE);

  const problems = validateCatalog(PROJECTS);
  if (problems.length > 0) {
    throw new Error(`Catalog validation failed:\n - ${problems.join("\n - ")}`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const startedAt = Date.now();
  console.log(`Seeding RabbitHole (anchor ${anchor.toISOString()})`);

  try {
    // ------------------------------------------------------------------ catalog
    for (const tag of TAGS) {
      await prisma.tag.upsert({ where: { slug: tag.slug }, update: { name: tag.name }, create: tag });
    }
    for (const language of LANGUAGES) {
      await prisma.language.upsert({ where: { slug: language.slug }, update: { name: language.name }, create: language });
    }
    const tagIdBySlug = new Map((await prisma.tag.findMany()).map((t) => [t.slug, t.id]));
    const languageIdBySlug = new Map((await prisma.language.findMany()).map((l) => [l.slug, l.id]));
    console.log(`  tags: ${TAGS.length}, languages: ${LANGUAGES.length}`);

    for (const project of PROJECTS) {
      const data = {
        title: project.title,
        summary: project.summary,
        description: project.description,
        difficulty: project.difficulty,
        estimatedHours: project.estimatedHours,
        popularity: project.popularity,
        concepts: project.concepts,
        sourceUrl: project.sourceUrl ?? null,
      };
      const row = await prisma.project.upsert({
        where: { slug: project.slug },
        update: data,
        create: { slug: project.slug, ...data },
        select: { id: true },
      });
      await prisma.projectTag.deleteMany({ where: { projectId: row.id } });
      await prisma.projectTag.createMany({
        data: project.tags.map((slug) => {
          const tagId = tagIdBySlug.get(slug);
          if (!tagId) throw new Error(`Unknown tag slug ${slug}`);
          return { projectId: row.id, tagId };
        }),
      });
      await prisma.projectLanguage.deleteMany({ where: { projectId: row.id } });
      if (project.languages.length > 0) {
        await prisma.projectLanguage.createMany({
          data: project.languages.map((slug) => {
            const languageId = languageIdBySlug.get(slug);
            if (!languageId) throw new Error(`Unknown language slug ${slug}`);
            return { projectId: row.id, languageId };
          }),
        });
      }
    }
    const removed = await prisma.project.deleteMany({ where: { slug: { notIn: PROJECTS.map((p) => p.slug) } } });
    console.log(`  projects: ${PROJECTS.length} upserted${removed.count > 0 ? `, ${removed.count} stale removed` : ""}`);

    // ---------------------------------------------------------------- demo user
    const demoUser = await prisma.user.upsert({
      where: { handle: DEMO_USER_HANDLE },
      update: {},
      create: {
        handle: DEMO_USER_HANDLE,
        name: DEMO_USER_NAME,
        explorationPreference: RECOMMENDER_CONFIG.exploration.defaultPreference,
        onboardingCompleted: false,
        isSynthetic: false,
      },
    });
    if (resetDemo) {
      await prisma.$transaction([
        prisma.interaction.deleteMany({ where: { userId: demoUser.id } }),
        prisma.recommendationRun.deleteMany({ where: { userId: demoUser.id } }),
        prisma.session.deleteMany({ where: { userId: demoUser.id } }),
        prisma.onboardingPairwiseChoice.deleteMany({ where: { userId: demoUser.id } }),
        prisma.onboardingProfile.deleteMany({ where: { userId: demoUser.id } }),
        prisma.user.update({
          where: { id: demoUser.id },
          data: {
            onboardingCompleted: false,
            explorationPreference: RECOMMENDER_CONFIG.exploration.defaultPreference,
          },
        }),
      ]);
      console.log(`  demo user "${DEMO_USER_HANDLE}": reset`);
    } else {
      console.log(`  demo user "${DEMO_USER_HANDLE}": ${demoUser.onboardingCompleted ? "exists (onboarded)" : "exists (needs onboarding)"}`);
    }

    // ---------------------------------------------------------- synthetic users
    const dataset = generateSyntheticDataset(PROJECTS, anchor);
    const projectIdBySlug = new Map((await prisma.project.findMany({ select: { id: true, slug: true } })).map((p) => [p.slug, p.id]));

    // Cascade removes their sessions, interactions and diagnostics.
    await prisma.user.deleteMany({ where: { isSynthetic: true } });
    await prisma.user.createMany({
      data: dataset.users.map((u) => ({
        id: u.id,
        handle: u.handle,
        name: u.name,
        explorationPreference: u.explorationPreference,
        onboardingCompleted: true,
        isSynthetic: true,
      })),
    });
    await prisma.session.createMany({
      data: dataset.sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        startedAt: s.startedAt,
        lastActiveAt: s.lastActiveAt,
        endedAt: s.endedAt,
      })),
    });
    const interactionRows = dataset.interactions.map((i) => {
      const projectId = projectIdBySlug.get(i.projectSlug);
      if (!projectId) throw new Error(`Unknown project slug ${i.projectSlug}`);
      return {
        id: i.id,
        userId: i.userId,
        projectId,
        sessionId: i.sessionId,
        type: i.type,
        weight: interactionWeight(i.type),
        dwellMs: i.dwellMs,
        createdAt: i.createdAt,
      };
    });
    for (const batch of chunk(interactionRows, CHUNK_SIZE)) {
      await prisma.interaction.createMany({ data: batch });
    }

    const byType = new Map<string, number>();
    for (const i of dataset.interactions) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
    console.log(`  synthetic users: ${dataset.users.length}, sessions: ${dataset.sessions.length}, interactions: ${dataset.interactions.length}`);
    console.log(
      `    ${[...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} ${count}`)
        .join(", ")}`,
    );
    console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
