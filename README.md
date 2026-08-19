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
User → Interactions → User profile (long-term + session) + exploration preference e ∈ [0, 1]
     → Candidate retrieval: content (~50) + item-item collaborative (~30) + popularity (~15) + exploration (8–15, plausibility-anchored)
     → Merge (all sources kept) / dedupe / filter (DISLIKE · BUILD · COMPLETE never surface)
     → Hybrid ranking (content · collaborative · novelty · popularity; exploration-aware weights renormalised over available signals)
     → MMR diversification (λ = 0.90 − 0.20e, near-duplicate and per-tag limits, relevance band) → final ranks
     → Top-K + deterministic explanations → impressions / feedback → updated recommendations
```

Collaborative filtering in one paragraph: each user's *current state* per project (from `deriveProjectStates`) becomes a positive signal — `(completed ? 5 : built ? 4 : 0) + (saved ? 2 : 0) + (shared ? 3 : 0) + (opened ? 0.5 : 0)`, 0 when disliked, IMPRESSION never counts, each state counts once. Item vectors over users (target user left out) are compared with shrunk cosine `cos(v_i, v_j) × overlap / (overlap + 2)`; the user's positive projects seed retrieval, `evidence(c) = Σ sim(seed, c) × seedWeight`, normalised by the maximum and scaled by a sparse-history confidence `min(1, Σ seedWeight / 6)`; top 30 become collaborative candidates. Users without behavioural seeds simply have no collaborative component (content + popularity only) — nothing is fabricated.

Exploration, novelty and diversification in one paragraph: the persisted `explorationPreference` `e` (Familiar 0 … Adventurous 1, default 0.35, `PATCH /api/profile`, the slider on `/discover`) drives three transparent mechanisms. **Novelty** `= 0.65 × underexposure + 0.35 × adjacency`, where `underexposure = 1 − popularityScore` and `adjacency = 4x(1 − x)` with `x = clamp01(contentAffinity)` (peaks for projects adjacent to the user's taste, 0 for perfect matches, for negative affinity and when no profile exists). **Exploration retrieval** is a fourth candidate source — `explorationScore = (1 − e)·plausibility + e·(0.65·novelty + 0.35·plausibility)`, plausibility = max(positive content affinity, collaborative evidence) or the popularity score when the user has neither — limited to `round(8 + 7e)` candidates with plausibility ≥ 0.05, so it is never random. **Exploration-aware weights**: `content 0.45 − 0.15e`, `collaborative 0.25 − 0.05e`, `novelty 0.05 + 0.30e`, `popularity 0.10` (×3 for cold start), renormalised over the components that exist for the user; the match score stays `clamp01(Σ weight·signal)`. **Diversification** re-orders the ranked list with MMR: each pick maximises `λ·score − (1 − λ)·maxSimilarityToSelected` (project-project cosine) among candidates within 80 % of the best remaining score, skipping near-duplicates (cosine ≥ 0.9) and projects that would push a tag over `max(2, round((0.45 − 0.15e) × limit))` slots; constraints relax when nothing else qualifies, and scores are never changed — `preDiversificationRank` vs `rank` and the MMR score are reported as diagnostics only.

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
- `lib/recommender/novelty.ts` — transparent novelty (`0.65 × underexposure + 0.35 × adjacency`) with its two components reported separately.
- `lib/recommender/exploration.ts` — exploration candidate retrieval (fourth source): plausibility anchor, exploration score, preference-dependent candidate limit, per-candidate diagnostics.
- `lib/recommender/diversify.ts` — MMR diversification over the ranked list (λ from the preference, near-duplicate and per-tag limits, relevance band, relaxation diagnostics); never changes scores.
- `lib/recommender/candidates.ts` — merge retrieval outputs per project (all sources + raw signals kept) and filter with reasons.
- `lib/recommender/rank.ts` — `score = clamp01(Σ weight[c]·signal[c])` over the components available for the user; exploration-aware base weights `content 0.45 − 0.15e / collaborative 0.25 − 0.05e / novelty 0.05 + 0.30e / popularity 0.10` renormalised by `resolveRankingWeights` (with every component: e = 0 → 0.529 / 0.294 / 0.059 / 0.118, e = 0.35 → 0.449 / 0.263 / 0.175 / 0.113, e = 1 → 0.316 / 0.211 / 0.368 / 0.105); content + novelty + popularity when there is no behavioural history, novelty + popularity for an empty profile; popularity ×3 for cold start; absent evidence contributes 0 and is reported as `null`; saved projects demoted; ties: popularity prior, then slug.
- `lib/recommender/explain.ts` — deterministic explanations from real signals (taste / onboarding / session / collaborative naming the user's own seed projects / novelty & exploration wording gated on real underexposure/adjacency / fit / popularity).
- `lib/recommender/similar.ts` — profile-independent project-to-project similarity for "Similar projects".
- `lib/recommender/recommend.ts` — the orchestrator: profile → signals (affinity, popularity, collaborative, novelty) → retrieve (4 sources) → merge → filter → rank → diversify → top-K → explain (pure pipeline + injectable loaders).
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
| `GET /api/recommendations?limit=10` | Personalised feed (rank, pre-diversification rank, match score, score breakdown incl. novelty, candidate sources, exploration + diversification diagnostics, explanation, project) plus pipeline stats and context (exploration preference/mode, diversification λ and limits); 409 until onboarding is complete |
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
- Exploration, novelty, diversification and cold-start improvements (Phase 5): persisted Familiar ↔ Adventurous preference (slider on `/discover`), transparent novelty (underexposure + adjacency), plausibility-anchored exploration retrieval as a fourth candidate source, exploration-aware ranking weights with a Novelty row in every score breakdown, MMR diversification with pre/final rank diagnostics, novelty/exploration explanations gated on real signals, and a "Most adventurous" sort on `/saved`.
- Planned: adaptive session blending, Insights pipeline diagnostics, held-out offline evaluation (Precision/Recall@K, NDCG, HitRate, coverage, diversity, novelty) with baselines, and a BPR experiment.

## Current limitations

- Adaptive session ranking, the Insights recommendation inspector and offline evaluation are not yet implemented (Phases 6–8).
- Dwell time is accepted by the API but the UI does not measure it yet.
- No authentication: everything acts as one persistent demo user (by design for V1).
- Local development only; no deployment configuration.
