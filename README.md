# RabbitHole

Personalized project discovery: RabbitHole recommends interesting software-engineering, computer-science and technology projects to build next, and learns from what you open, save, build and skip.

The recommender is the product. It is a modular pipeline — user profile → candidate retrieval → ranking → session adjustment → diversification → explanation — built from understandable, testable functions with centralized configuration, offline evaluation and baseline comparison.

> **Status:** Phases 1–4 are implemented: schema, deterministic seed catalog, central recommender configuration, app shell, server-side sessions, interaction recording, onboarding, feature-based long-term/session profiles, and a genuine hybrid recommender — content similarity, item-item collaborative filtering and popularity as three separate retrieval sources merged into one candidate pool, hybrid ranking with an honest score breakdown, deterministic explanations, the personalised `/discover` feed, saved projects and similar projects. Exploration/novelty/diversification, adaptive session-aware re-ranking, Insights diagnostics and offline evaluation arrive in the following phases.

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
     → Candidate retrieval: content (~50) + item-item collaborative (~30) + popularity (~15)
     → Merge (all sources kept) / dedupe / filter (DISLIKE · BUILD · COMPLETE never surface)
     → Hybrid ranking (content · collaborative · popularity, weights renormalised over available signals)
     → Top-K + deterministic explanations → impressions / feedback → updated recommendations
```

Collaborative filtering in one paragraph: each user's *current state* per project (from `deriveProjectStates`) becomes a positive signal — `(completed ? 5 : built ? 4 : 0) + (saved ? 2 : 0) + (shared ? 3 : 0) + (opened ? 0.5 : 0)`, 0 when disliked, IMPRESSION never counts, each state counts once. Item vectors over users (target user left out) are compared with shrunk cosine `cos(v_i, v_j) × overlap / (overlap + 2)`; the user's positive projects seed retrieval, `evidence(c) = Σ sim(seed, c) × seedWeight`, normalised by the maximum and scaled by a sparse-history confidence `min(1, Σ seedWeight / 6)`; top 30 become collaborative candidates. Users without behavioural seeds simply have no collaborative component (content + popularity only) — nothing is fabricated.

Layering: React/UI → API routes → services (`lib/sessions`, `lib/interactions`, `lib/onboarding`, `lib/profile`) → pure recommender functions (`lib/recommender`) → Prisma (`lib/db.ts`).

- `lib/recommender/config.ts` — every tunable number (interaction weights, time decay, feature-family weights, onboarding signal strengths, candidate counts, ranking weights, session blending, exploration slopes, diversity, feed limits, evaluation Ks).
- `lib/recommender/types.ts` — contracts between stages (feature vectors, candidates with sources, score breakdowns, pipeline stats).
- `lib/recommender/features.ts` — project → namespaced feature vector (`tag:`, `lang:`, `difficulty:`, `duration:`).
- `lib/recommender/decay.ts` — half-life decay `0.5 ** (ageDays / halfLifeDays)`.
- `lib/recommender/profile.ts` — signed feature profiles: `raw[f] += weight(type) * decay * projectFeature[f]`, plus explicit onboarding signals; L2-normalised `vector` for similarity and max-abs `strengths` for display; long-term vs session builders.
- `lib/recommender/similarity.ts` — cosine similarity for sparse signed vectors (0 for empty/zero-norm inputs).
- `lib/recommender/session.ts` — effective profile = fixed blend of long-term and session vectors (`session.baseWeight`; adaptive weighting comes in Phase 6).
- `lib/recommender/content.ts` / `popularity.ts` — content candidates (cosine ≥ `retrieval.minContentAffinity`, top ~50) and popularity candidates (`priorWeight·seedPrior + behaviorWeight·log1p(Σ positive weights)/max`, top ~15), both excluding terminal-state projects.
- `lib/recommender/collaborative.ts` — item-item collaborative filtering: current-state collaborative signal, item vectors over users, shrunk cosine neighbours, seed-weighted evidence aggregation, top ~30 collaborative candidates with supporting-seed diagnostics.
- `lib/recommender/candidates.ts` — merge retrieval outputs per project (all sources + raw signals kept) and filter with reasons.
- `lib/recommender/rank.ts` — `score = clamp01(Σ weight[c]·signal[c])` over the components available for the user (content 0.45 / collaborative 0.25 / popularity 0.10 renormalised → 0.5625 / 0.3125 / 0.125; content + popularity only when there is no behavioural history; popularity boosted for cold start); absent evidence contributes 0 and is reported as `null`; saved projects demoted; ties: popularity prior, then slug.
- `lib/recommender/explain.ts` — deterministic explanations from real signals (taste / onboarding / session / collaborative naming the user's own seed projects / fit / popularity).
- `lib/recommender/similar.ts` — profile-independent project-to-project similarity for "Similar projects".
- `lib/recommender/recommend.ts` — the orchestrator: profile → retrieve → merge → filter → signals → rank → top-K → explain (pure pipeline + injectable loaders).
- `lib/recommendations/` — Prisma loaders (catalog with vectors, popularity evidence) and feed / similar / detail-context services.
- `lib/saved/` — saved-project state, filters and sorting.
- `lib/sessions/` — server-side session resolution (30-minute inactivity timeout, explicit "start new session").
- `lib/interactions/` — interaction recording with server-owned weights, zod schemas, per-project state derivation.
- `lib/onboarding/` — topic → tag mapping, curated cross-domain pairwise choices, persistence.
- `lib/profile/` — profile data loader + snapshot (long-term + session profiles, statistics) and settings updates.
- `prisma/schema.prisma` — users, sessions, interactions, catalog (projects/tags/languages), onboarding answers and recommendation diagnostics.
- `prisma/seed-data/` — the hand-authored catalog and the synthetic-population generator.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/recommendations?limit=10` | Personalised feed (rank, match score, score breakdown, candidate sources, explanation, project); 409 until onboarding is complete |
| `POST /api/interactions` | Record `{ projectId, type, dwellMs? }` for the demo user; the server resolves the session and the weight |
| `GET /api/profile` | Onboarding state, exploration preference, long-term and session profiles, statistics, active session |
| `PATCH /api/profile` | Update supported settings (`explorationPreference` in [0, 1]) |
| `GET /api/sessions` / `POST /api/sessions` | Current session / start a new session |
| `GET /api/onboarding` / `POST /api/onboarding` | Questionnaire definition + state / complete onboarding |

Errors are JSON `{ error: { code, message, issues? } }` with 400/404/503/500 status codes.

## Implemented algorithms

- Feature-based user profiles (Phase 2): decayed, weighted aggregation of project features from interactions, explicit onboarding prior (topics, pairwise choices, difficulty/duration), signed normalisation, separate long-term and session profiles.
- Content-based recommendation (Phase 3): cosine similarity between the effective profile and project feature vectors, content + popularity candidate retrieval, terminal-state filtering, cold-start weighting, transparent weighted ranking with deterministic tie-breaks, deterministic explanations, project-to-project similar projects.
- Item-item collaborative filtering + hybrid ranking (Phase 4): behavioural item vectors over users, shrunk cosine item similarity, seed-weighted collaborative retrieval with sparse-history confidence, three-source candidate merge, hybrid ranking with renormalised weights and a nullable per-component breakdown, collaborative explanations that name real seed projects.
- Planned: exploration retrieval + novelty, exploration-adjusted weights, MMR-style diversification, adaptive session blending, Insights pipeline diagnostics, held-out offline evaluation (Precision/Recall@K, NDCG, HitRate, coverage, diversity, novelty) with baselines, and a BPR experiment.

## Current limitations

- Exploration/novelty/diversification, adaptive session ranking, the Insights recommendation inspector and offline evaluation are not yet implemented (Phases 5–8).
- The exploration preference is stored but does not yet change recommendations (Phase 5).
- Dwell time is accepted by the API but the UI does not measure it yet.
- No authentication: everything acts as one persistent demo user (by design for V1).
- Local development only; no deployment configuration.
