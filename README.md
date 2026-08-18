# RabbitHole

Personalized project discovery: RabbitHole recommends interesting software-engineering, computer-science and technology projects to build next, and learns from what you open, save, build and skip.

The recommender is the product. It is a modular pipeline — user profile → candidate retrieval → ranking → session adjustment → diversification → explanation — built from understandable, testable functions with centralized configuration, offline evaluation and baseline comparison.

> **Status:** Phase 1 (foundation) is implemented: schema, deterministic seed catalog, central recommender configuration, app shell and tooling. Recommendation logic arrives in the following phases (see *Roadmap*).

## Technology stack

- Next.js (App Router, TypeScript strict), Tailwind CSS
- PostgreSQL via Prisma ORM (Prisma 7, `@prisma/adapter-pg`)
- Vitest (unit tests), Playwright (end-to-end tests)
- npm

## Prerequisites

- Node.js 20.19+ (developed on Node 22)
- npm 10+
- A local PostgreSQL server (any recent version) and a database for RabbitHole

## Environment variables

Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, e.g. `postgresql://USER:PASSWORD@localhost:5432/rabbithole?schema=public` |
| `SEED_ANCHOR_DATE` | no | ISO date used as "now" for seeded timestamps. Defaults to the start of the current UTC day so re-seeding on the same day is byte-for-byte reproducible. |

If `DATABASE_URL` is missing, the app renders a setup notice and database commands fail with an explicit message. RabbitHole never falls back to another database.

## Installation

```bash
npm install
```

`npm install` also runs `prisma generate` (client output: `generated/prisma`, git-ignored).

## Database migration

```bash
npm run db:migrate
```

Applies `prisma/migrations` (the initial migration is committed) and regenerates the client. Use `npm run db:reset` to drop and recreate the schema.

## Seed

```bash
npm run seed
```

Deterministically loads the catalog (≈160 hand-written project ideas, 39 tags, 13 languages), creates the persistent demo user and generates 30 synthetic users with latent-interest archetypes plus several thousand structured interactions (seeded PRNG; re-running recreates identical data). Add `-- --reset-demo` to also wipe the demo user's behavioural state.

## Development

```bash
npm run dev
```

Open http://localhost:3000. A demo user without completed onboarding is sent to `/onboarding`; otherwise `/discover`.

## Tests

```bash
npm test          # Vitest unit tests (recommender + seed + utilities)
npm run test:e2e  # Playwright (needs a migrated + seeded database; run `npx playwright install chromium` once)
```

## Evaluation

```bash
npm run evaluate   # (Phase 8) offline metrics and baseline comparison
```

## Production build

```bash
npm run build
npm start
```

## Other scripts

| Script | Purpose |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Prisma Studio |

## Recommendation architecture

```
User → Interactions → User profile (long-term + session)
     → Candidate retrieval (content · collaborative · popular · exploration)
     → Merge / dedupe / filter → Ranking (weighted, explainable score breakdown)
     → Session adjustment → Diversification → Top-K + explanations
     → New feedback → updated recommendations
```

- `lib/recommender/config.ts` — every tunable number (interaction weights, time decay, candidate counts, ranking weights, session blending, exploration slopes, diversity, feed limits, evaluation Ks).
- `lib/recommender/types.ts` — contracts between stages (feature vectors, candidates with sources, score breakdowns, pipeline stats).
- `lib/recommender/*` — retrieval, ranking, session, diversification, explanation, evaluation modules (added phase by phase).
- `prisma/schema.prisma` — users, sessions, interactions, catalog (projects/tags/languages), onboarding answers and recommendation diagnostics.
- `prisma/seed-data/` — the hand-authored catalog and the synthetic-population generator.

## Implemented algorithms

Phase 1 ships the foundation only. Planned V1 algorithms: feature-based user profiles with half-life decay, cosine content similarity, item-item collaborative filtering, popularity priors, exploration retrieval, weighted hybrid ranking with exploration-adjusted weights, session/long-term profile blending, MMR-style diversification, deterministic explanations, held-out offline evaluation (Precision/Recall@K, NDCG, HitRate, coverage, diversity, novelty) with Random/Popularity/Content/Collaborative/Hybrid baselines, and a BPR experiment.

## Current limitations

- Recommendations, onboarding, interaction recording, saved projects and Insights diagnostics are not yet implemented (Phases 2–8).
- No authentication: everything acts as one persistent demo user (by design for V1).
- Local development only; no deployment configuration.
