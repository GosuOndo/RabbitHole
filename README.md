# RabbitHole

Personalized project discovery: RabbitHole recommends interesting software-engineering, computer-science and technology projects to build next, and learns from what you open, save, build and skip.

The recommender is the product. It is a modular pipeline — user profile → candidate retrieval → ranking → session adjustment → diversification → explanation — built from understandable, testable functions with centralized configuration, offline evaluation and baseline comparison.

> **Status:** Phases 1–2 are implemented: schema, deterministic seed catalog, central recommender configuration, app shell, server-side sessions, interaction recording, onboarding, and feature-based long-term/session profiles. Candidate retrieval, ranking and the recommendation feed arrive in the following phases.

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
npm test          # Vitest unit tests (recommender + services + seed + utilities)
npm run test:e2e  # Playwright (needs a migrated database; run `npx playwright install chromium` once)
```

`npm run test:e2e` re-runs the seed and **resets the demo user's onboarding and behaviour** before the suite so flows are deterministic.

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

Layering: React/UI → API routes → services (`lib/sessions`, `lib/interactions`, `lib/onboarding`, `lib/profile`) → pure recommender functions (`lib/recommender`) → Prisma (`lib/db.ts`).

- `lib/recommender/config.ts` — every tunable number (interaction weights, time decay, feature-family weights, onboarding signal strengths, candidate counts, ranking weights, session blending, exploration slopes, diversity, feed limits, evaluation Ks).
- `lib/recommender/types.ts` — contracts between stages (feature vectors, candidates with sources, score breakdowns, pipeline stats).
- `lib/recommender/features.ts` — project → namespaced feature vector (`tag:`, `lang:`, `difficulty:`, `duration:`).
- `lib/recommender/decay.ts` — half-life decay `0.5 ** (ageDays / halfLifeDays)`.
- `lib/recommender/profile.ts` — signed feature profiles: `raw[f] += weight(type) * decay * projectFeature[f]`, plus explicit onboarding signals; L2-normalised `vector` for similarity and max-abs `strengths` for display; long-term vs session builders.
- `lib/sessions/` — server-side session resolution (30-minute inactivity timeout, explicit "start new session").
- `lib/interactions/` — interaction recording with server-owned weights, zod schemas, per-project state derivation.
- `lib/onboarding/` — topic → tag mapping, curated cross-domain pairwise choices, persistence.
- `lib/profile/` — profile snapshot (long-term + session profiles, statistics) and settings updates.
- `prisma/schema.prisma` — users, sessions, interactions, catalog (projects/tags/languages), onboarding answers and recommendation diagnostics.
- `prisma/seed-data/` — the hand-authored catalog and the synthetic-population generator.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/interactions` | Record `{ projectId, type, dwellMs? }` for the demo user; the server resolves the session and the weight |
| `GET /api/profile` | Onboarding state, exploration preference, long-term and session profiles, statistics, active session |
| `PATCH /api/profile` | Update supported settings (`explorationPreference` in [0, 1]) |
| `GET /api/sessions` / `POST /api/sessions` | Current session / start a new session |
| `GET /api/onboarding` / `POST /api/onboarding` | Questionnaire definition + state / complete onboarding |

Errors are JSON `{ error: { code, message, issues? } }` with 400/404/503/500 status codes.

## Implemented algorithms

- Feature-based user profiles (Phase 2): decayed, weighted aggregation of project features from interactions, explicit onboarding prior (topics, pairwise choices, difficulty/duration), signed normalisation, separate long-term and session profiles.
- Planned: cosine content similarity, item-item collaborative filtering, popularity priors, exploration retrieval, weighted hybrid ranking with exploration-adjusted weights, session/long-term blending, MMR-style diversification, deterministic explanations, held-out offline evaluation (Precision/Recall@K, NDCG, HitRate, coverage, diversity, novelty) with baselines, and a BPR experiment.

## Current limitations

- The recommendation feed, saved-projects page and recommendation diagnostics are not yet implemented (Phases 3–8); `/discover` shows a catalog preview.
- Dwell time is accepted by the API but the UI does not measure it yet.
- No authentication: everything acts as one persistent demo user (by design for V1).
- Local development only; no deployment configuration.
