import type { Explanation } from "@/lib/recommender/explain";
import type { CollaborativeItemDiagnostics } from "@/lib/recommender/recommend";
import type { RankingWeights, ScoreBreakdown } from "@/lib/recommender/types";

const FACTOR_LABELS: Record<Explanation["primary"], string> = {
  onboarding: "Onboarding interests",
  taste: "Long-term taste",
  session: "This session",
  collaborative: "People who liked what you liked",
  fit: "Difficulty / duration / language fit",
  popularity: "Popularity",
  catalog: "Catalog",
};

const SEED_STATE_LABEL: Record<CollaborativeItemDiagnostics["seeds"][number]["state"], string> = {
  completed: "completed",
  built: "building",
  saved: "saved",
  shared: "shared",
  opened: "opened",
};

/**
 * "Why this recommendation?" — the explanation factors plus the score
 * breakdown. Numbers are the normalised component signals and the weights
 * used; "—" means the signal was unavailable for this project (no evidence),
 * which is different from a score of 0. The final value is a match score, not
 * a probability.
 */
export function RecommendationExplanation({
  explanation,
  breakdown,
  weights,
  score,
  sources,
  collaborative,
  id,
}: {
  explanation: Explanation;
  breakdown: ScoreBreakdown;
  weights: Partial<RankingWeights>;
  score: number;
  sources: readonly string[];
  collaborative?: CollaborativeItemDiagnostics | null;
  id?: string;
}) {
  const rows: { label: string; value: number | null; weight?: number }[] = [
    { label: "Content affinity", value: breakdown.content, weight: weights.content },
    { label: "Collaborative signal", value: breakdown.collaborative, weight: weights.collaborative },
    { label: "Popularity", value: breakdown.popularity, weight: weights.popularity },
  ];
  return (
    <div id={id} className="rounded-md border border-border bg-surface-raised/60 p-3 text-sm" data-testid="recommendation-explanation">
      <p className="font-medium">Why this recommendation?</p>
      <p className="mt-1 text-muted">{explanation.text}</p>
      {explanation.factors.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {explanation.factors.map((factor, index) => (
            <li key={`${factor.kind}-${index}`} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-muted">
              <span className="font-medium text-foreground">{FACTOR_LABELS[factor.kind]}</span>
              {factor.features.length > 0 ? `: ${factor.features.map((f) => f.label).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-subtle">signal</dt>
        <dd className="text-right text-subtle">value</dd>
        <dd className="text-right text-subtle">weight</dd>
        {rows.map((row) => (
          <FragmentRow key={row.label} label={row.label} value={row.value} weight={row.weight} />
        ))}
        <dt className="border-t border-border pt-1 font-medium">Match score</dt>
        <dd className="border-t border-border pt-1 text-right font-medium">{score.toFixed(2)}</dd>
        <dd className="border-t border-border pt-1 text-right text-subtle">{sources.join(" + ")}</dd>
      </dl>
      {collaborative && collaborative.seeds.length > 0 ? (
        <div className="mt-3 text-xs" data-testid="collaborative-evidence">
          <p className="text-subtle">
            Behavioural neighbours of your own projects (confidence {collaborative.confidence.toFixed(2)}):
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {collaborative.seeds.map((seed) => (
              <li key={seed.projectId} className="flex items-baseline justify-between gap-3">
                <span className="truncate">
                  {seed.title} <span className="text-subtle">({SEED_STATE_LABEL[seed.state]})</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted">sim {seed.similarity.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FragmentRow({ label, value, weight }: { label: string; value: number | null; weight?: number }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value === null ? "—" : value.toFixed(2)}</dd>
      <dd className="text-right text-subtle">{weight !== undefined && value !== null ? `× ${weight.toFixed(2)}` : "—"}</dd>
    </>
  );
}
