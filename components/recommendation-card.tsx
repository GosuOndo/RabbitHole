"use client";

import Link from "next/link";
import { ProjectMeta, TagList } from "@/components/project-meta";
import { RecommendationExplanation } from "@/components/recommendation-explanation";
import { Button, ButtonLink } from "@/components/ui/button";
import { formatScore } from "@/lib/format";
import type { RecommendationView } from "@/lib/recommendations/recommendation-service";

export interface RecommendationCardState {
  saved: boolean;
  built: boolean;
  pending: boolean;
  message: string | null;
}

/**
 * One recommendation: project facts, match score, one-line explanation and the
 * feed actions (Nope / Save / Build / Open / Why?). Every action is a real
 * button; keyboard shortcuts in the feed call the same handlers.
 */
export function RecommendationCard({
  item,
  state,
  isCurrent,
  explanationOpen,
  onNope,
  onToggleSave,
  onBuild,
  onToggleExplanation,
  onActivate,
  registerElement,
}: {
  item: RecommendationView;
  state: RecommendationCardState;
  isCurrent: boolean;
  explanationOpen: boolean;
  onNope: () => void;
  onToggleSave: () => void;
  onBuild: () => void;
  onToggleExplanation: () => void;
  onActivate: () => void;
  registerElement: (projectId: string, element: HTMLElement | null) => void;
}) {
  const { project } = item;
  const explanationId = `explanation-${project.id}`;
  return (
    <article
      ref={(element) => registerElement(project.id, element)}
      data-testid="recommendation-card"
      data-project-slug={project.slug}
      data-rank={item.rank}
      aria-current={isCurrent ? "true" : undefined}
      tabIndex={-1}
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
      className={`flex flex-col gap-3 rounded-card border bg-surface p-4 transition-colors sm:p-5 ${
        isCurrent ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs text-subtle">
            <span className="font-mono tabular-nums">#{item.rank}</span>
            {item.saved || state.saved ? <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent-strong">Saved</span> : null}
          </div>
          <h3 className="text-lg font-semibold leading-snug tracking-tight text-balance">
            <Link href={`/project/${project.slug}?ref=discover&rank=${item.rank}`} className="hover:text-accent-strong focus-visible:underline">
              {project.title}
            </Link>
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted text-pretty">{project.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end" aria-label={`Match score ${formatScore(item.score)} out of 100`} title="Match score (not a probability)">
          <span className="font-mono text-2xl font-semibold tabular-nums leading-none">{formatScore(item.score)}</span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-subtle">match</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <TagList tags={project.tags} max={4} />
        <ProjectMeta difficulty={project.difficulty} estimatedHours={project.estimatedHours} languages={project.languages} />
      </div>

      <p className="text-sm text-foreground/90" data-testid="recommendation-reason">
        <span className="text-subtle">Why: </span>
        {item.explanation.text}
      </p>

      {explanationOpen ? (
        <RecommendationExplanation
          id={explanationId}
          explanation={item.explanation}
          breakdown={item.breakdown}
          weights={item.weights}
          score={item.score}
          sources={item.sources}
          collaborative={item.collaborative}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="danger" size="sm" onClick={onNope} disabled={state.pending} aria-keyshortcuts="ArrowLeft" title="Not interested (←)">
          Nope
        </Button>
        <Button
          variant={state.saved ? "secondary" : "primary"}
          size="sm"
          onClick={onToggleSave}
          disabled={state.pending}
          aria-pressed={state.saved}
          aria-keyshortcuts="s"
          title={state.saved ? "Unsave (S)" : "Save (S)"}
        >
          {state.saved ? "Saved ✓" : "Save"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onBuild} disabled={state.pending || state.built} aria-keyshortcuts="b" title="Build this (B)">
          {state.built ? "Building ✓" : "Build this"}
        </Button>
        <ButtonLink href={`/project/${project.slug}?ref=discover&rank=${item.rank}`} variant="ghost" size="sm">
          Open details
        </ButtonLink>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleExplanation}
          aria-expanded={explanationOpen}
          aria-controls={explanationId}
          aria-keyshortcuts="?"
          title="Why recommended? (?)"
          className="ml-auto"
        >
          Why?
        </Button>
      </div>
      <p className="min-h-4 text-xs text-muted" aria-live="polite">
        {state.message}
      </p>
    </article>
  );
}
