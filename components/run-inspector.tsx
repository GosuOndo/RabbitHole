import Link from "next/link";
import type { RecentRunSummary, RunDetail, RunResultDetail } from "@/lib/recommendations/recommendation-run-service";
import type { PipelineStats, ScoreComponent } from "@/lib/recommender/types";

/**
 * Recommendation-run diagnostics (server components, display only).
 *
 * Everything rendered here comes from the immutable stored run snapshot — no
 * scores, weights, similarities or eligibility are recomputed in React. The
 * inspector distinguishes raw retrieval signals, component scores, effective
 * weights, weighted contributions (score x weight, precomputed by the service),
 * the recommendation score, and the MMR diagnostics that only reorder results.
 */

const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  content: "Content",
  collaborative: "Collaborative",
  session: "Session",
  novelty: "Novelty",
  popularity: "Popularity",
};
const COMPONENT_ORDER: ScoreComponent[] = ["content", "collaborative", "session", "novelty", "popularity"];

const SOURCE_LABELS: Record<string, string> = {
  content: "Content",
  collaborative: "Collaborative",
  popular: "Popular",
  exploration: "Exploration",
};

function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function formatRunTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
}

function shortId(id: string | null): string {
  return id ? `…${id.slice(-6)}` : "—";
}

/** Real stage counts of the selected run — never typical/hardcoded values. */
export function PipelineFlow({ pipeline }: { pipeline: PipelineStats }) {
  const retrieval: { key: string; label: string; value: number }[] = [
    { key: "content", label: "Content", value: pipeline.contentCandidates },
    { key: "collaborative", label: "Collaborative", value: pipeline.collaborativeCandidates },
    { key: "popular", label: "Popularity", value: pipeline.popularCandidates },
    { key: "exploration", label: "Exploration", value: pipeline.explorationCandidates },
  ];
  const flow: { key: string; label: string; value: number }[] = [
    { key: "unique", label: "Unique candidates", value: pipeline.uniqueCandidates },
    { key: "filtered", label: "After filtering", value: pipeline.afterFiltering },
    { key: "ranked", label: "Ranked (pre-diversification)", value: pipeline.preDiversificationCandidates },
    { key: "final", label: "Final diversified results", value: pipeline.diversifiedCandidates },
  ];
  const max = Math.max(1, ...retrieval.map((s) => s.value), ...flow.map((s) => s.value));
  const Row = ({ stage }: { stage: { key: string; label: string; value: number } }) => (
    <div className="grid grid-cols-[minmax(0,14rem)_1fr_3rem] items-center gap-3 text-sm" data-stage={stage.key}>
      <span className="truncate text-muted">{stage.label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <span className="block h-full rounded-full bg-info" style={{ width: `${Math.round((stage.value / max) * 100)}%` }} />
      </span>
      <span className="text-right font-mono text-xs tabular-nums" data-stage-value={stage.key}>
        {stage.value}
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="pipeline-stats">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Candidate retrieval</h3>
        {retrieval.map((stage) => (
          <Row key={stage.key} stage={stage} />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Merge → filter → rank → diversify</h3>
        {flow.map((stage) => (
          <Row key={stage.key} stage={stage} />
        ))}
      </div>
    </div>
  );
}

/** Newest-first stored runs; the selected run is highlighted and each entry is a real link. */
export function RecentRunList({ runs, selectedId }: { runs: RecentRunSummary[]; selectedId: string | null }) {
  if (runs.length === 0) return <p className="text-sm text-muted">No recommendation runs recorded yet.</p>;
  return (
    <ol className="flex flex-col gap-1" data-testid="recent-runs">
      {runs.map((run) => {
        const selected = run.id === selectedId;
        return (
          <li key={run.id}>
            <Link
              href={`/insights?run=${run.id}`}
              aria-current={selected ? "true" : undefined}
              data-testid="recent-run-link"
              data-run-id={run.id}
              className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                selected ? "border-accent bg-accent/10" : "border-border hover:border-border-strong"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{formatRunTime(run.createdAt)}</span>
                <span className="font-mono tabular-nums text-muted">
                  {run.resultCount} result{run.resultCount === 1 ? "" : "s"}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 text-muted">
                <span>
                  {run.algorithm}
                  {run.explorationMode ? ` · ${run.explorationMode}` : ""} · session {shortId(run.sessionId)}
                </span>
                <span className="font-mono tabular-nums">{run.sessionConfidence !== null ? `s-conf ${run.sessionConfidence.toFixed(2)}` : ""}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function SourceBadges({ sources }: { sources: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Candidate sources">
      {sources.map((source) => (
        <li key={source} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted">
          {SOURCE_LABELS[source] ?? source}
        </li>
      ))}
    </ul>
  );
}

function ResultDetail({ result, run }: { result: RunResultDetail; run: RunDetail }) {
  const retrievalSignals = (["content", "collaborative", "popular", "exploration"] as const).map((source) => ({
    source,
    label: SOURCE_LABELS[source],
    value: result.rawSignals[source] ?? null,
  }));
  return (
    <details className="rounded-md border border-border bg-surface" data-testid="run-result" data-project-slug={result.project.slug}>
      <summary className="flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-raised/60">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-xs tabular-nums text-muted">#{result.rank}</span>
          <span className="truncate font-medium">{result.project.title}</span>
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{fmt(result.score)}</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-sm">
        <p className="text-muted" data-testid="result-explanation">
          {result.explanation.text}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <SourceBadges sources={result.sources} />
          <span className="font-mono tabular-nums" data-testid="result-ranks">
            pre-diversification #{result.preDiversificationRank ?? "—"} → final #{result.rank}
          </span>
          {result.saved ? <span className="rounded-md border border-border px-1.5 py-0.5">saved — score ×0.6 demotion applied</span> : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-left font-mono text-xs tabular-nums" data-testid="result-components">
            <thead className="text-subtle">
              <tr>
                <th scope="col" className="py-1 pr-2 font-normal">
                  Component
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">
                  Score
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">
                  Weight
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPONENT_ORDER.map((component) => (
                <tr key={component} className="border-t border-border/60">
                  <th scope="row" className="py-1 pr-2 font-normal text-muted">
                    {COMPONENT_LABELS[component]}
                  </th>
                  <td className="py-1 pr-2 text-right">{fmt(result.breakdown[component])}</td>
                  <td className="py-1 pr-2 text-right text-subtle">{fmt(run.weights[component])}</td>
                  <td className="py-1 text-right">{fmt(result.contributions[component], 3)}</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <th scope="row" className="py-1 pr-2 font-medium">
                  Recommendation score
                </th>
                <td className="py-1 pr-2" />
                <td className="py-1 pr-2" />
                <td className="py-1 text-right font-medium">{fmt(result.score)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <div data-testid="result-retrieval">
            <h4 className="mb-1 font-medium uppercase tracking-wider text-subtle">Candidate retrieval (raw signals)</h4>
            <dl className="flex flex-col gap-0.5 font-mono tabular-nums">
              {retrievalSignals.map((signal) => (
                <div key={signal.source} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">{signal.label} source</dt>
                  <dd>{fmt(signal.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h4 className="mb-1 font-medium uppercase tracking-wider text-subtle">Signal detail</h4>
            <dl className="flex flex-col gap-0.5 font-mono tabular-nums">
              {result.novelty ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">Novelty = underexposure / adjacency</dt>
                  <dd data-testid="result-novelty">
                    {fmt(result.novelty.novelty)} = {fmt(result.novelty.underexposure)} / {fmt(result.novelty.adjacency)}
                  </dd>
                </div>
              ) : null}
              {result.session ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">Session affinity raw → score</dt>
                  <dd data-testid="result-session">
                    {fmt(result.session.raw)} → {fmt(result.session.score)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">MMR (diagnostic) · max sim to selected</dt>
                <dd data-testid="result-diversification">
                  {fmt(result.diversification?.mmrScore ?? null)} · {fmt(result.diversification?.maxSimilarityToSelected ?? null)}
                  {result.diversification?.admittedUnderRelaxation ? " · relaxed" : ""}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {result.exploration ? (
          <p className="text-xs text-subtle" data-testid="result-exploration">
            Retrieved for exploration: score {fmt(result.exploration.explorationScore)} from plausibility {fmt(result.exploration.plausibility)} (
            {result.exploration.plausibilitySource}) and novelty {fmt(result.exploration.novelty)}.
          </p>
        ) : null}

        {result.collaborative && result.collaborative.seeds.length > 0 ? (
          <div className="text-xs" data-testid="result-collaborative">
            <h4 className="mb-1 font-medium uppercase tracking-wider text-subtle">
              Collaborative signal {fmt(result.collaborative.score)} — supported by your own projects
            </h4>
            <ul className="flex flex-col gap-0.5">
              {result.collaborative.seeds.map((seed) => (
                <li key={seed.projectId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">
                    {seed.title} <span className="text-subtle">({seed.state})</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    contribution {fmt(seed.contribution)} · sim {fmt(seed.similarity)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** The selected run, exactly as generated (historical snapshot — never recomputed). */
export function RunInspector({ run }: { run: RunDetail }) {
  const context = run.context;
  const meta: { label: string; value: string }[] = [
    { label: "Snapshot generated", value: formatRunTime(run.createdAt) },
    { label: "Algorithm", value: run.algorithm },
    { label: "Session", value: shortId(run.sessionId) },
    {
      label: "Exploration",
      value: context ? `${context.exploration.mode} (e = ${context.exploration.preference.toFixed(2)})` : `e = ${run.explorationPreference.toFixed(2)}`,
    },
    { label: "Requested limit", value: String(run.requestedLimit) },
  ];
  if (context) {
    meta.push(
      { label: "Cold start", value: context.coldStart ? "yes (popularity boosted)" : "no" },
      { label: "Components", value: context.components.join(" · ") },
      {
        label: "Session influence",
        value: context.session.available
          ? `confidence ${context.session.confidence.toFixed(2)} · blend ${Math.round(context.session.blendWeight * 100)}%`
          : "none (no meaningful session)",
      },
      {
        label: "Collaborative",
        value: context.collaborative.available
          ? `${context.collaborative.seedCount} seeds · confidence ${context.collaborative.confidence.toFixed(2)}`
          : "unavailable",
      },
      {
        label: "Diversification",
        value: context.diversification.applied
          ? `λ ${context.diversification.lambda.toFixed(2)} · ≤${context.diversification.maxPerTag}/tag · ${context.diversification.relaxationLevel} relaxed`
          : "not applied",
      },
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="run-inspector">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {meta.map((entry) => (
          <div key={entry.label}>
            <dt className="text-subtle">{entry.label}</dt>
            <dd className="mt-0.5 font-medium">{entry.value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-subtle">Run id</dt>
          <dd className="mt-0.5 truncate font-mono text-[11px] text-muted" data-testid="selected-run-id" title={run.id}>
            {run.id}
          </dd>
        </div>
      </dl>
      {run.results.length === 0 ? (
        <p className="text-sm text-muted">This run returned no recommendations.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {run.results.map((result) => (
            <ResultDetail key={result.projectId} result={result} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
