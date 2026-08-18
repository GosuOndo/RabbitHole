"use client";

import type { Difficulty } from "@/generated/prisma/enums";
import { DifficultyBadge } from "@/components/project-meta";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";

export interface PairwiseOption {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  estimatedHours: number;
  tags: { slug: string; name: string }[];
}

/**
 * One "Which would you rather build?" comparison: two large option buttons.
 * Button content is span-only (valid phrasing content); the accessible name is
 * the title and the summary is exposed as the description.
 */
export function PairwiseChoice({
  pairIndex,
  left,
  right,
  selectedSlug,
  onChoose,
  labelledBy,
}: {
  pairIndex: number;
  left: PairwiseOption;
  right: PairwiseOption;
  selectedSlug: string | null;
  onChoose: (slug: string) => void;
  labelledBy: string;
}) {
  const renderOption = (option: PairwiseOption, position: "left" | "right") => {
    const selected = selectedSlug === option.slug;
    const titleId = `pair-${pairIndex}-${position}-title`;
    const summaryId = `pair-${pairIndex}-${position}-summary`;
    return (
      <button
        type="button"
        onClick={() => onChoose(option.slug)}
        aria-pressed={selected}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        data-pair-option={position}
        className={`flex h-full flex-col gap-3 rounded-card border p-4 text-left transition-colors ${
          selected ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised"
        }`}
      >
        <span id={titleId} className="text-base font-semibold leading-snug tracking-tight text-balance">
          {option.title}
        </span>
        <span id={summaryId} className="text-sm leading-relaxed text-muted text-pretty">
          {option.summary}
        </span>
        <span className="mt-auto flex flex-col gap-2">
          <span className="flex flex-wrap gap-1">
            {option.tags.slice(0, 3).map((tag) => (
              <Badge key={tag.slug}>{tag.name}</Badge>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <DifficultyBadge difficulty={option.difficulty} />
            <span className="font-mono tabular-nums">{formatDuration(option.estimatedHours)}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div role="group" aria-labelledby={labelledBy} className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
      {renderOption(left, "left")}
      <div aria-hidden="true" className="hidden items-center justify-center text-xs font-semibold uppercase tracking-wider text-subtle sm:flex">
        vs
      </div>
      {renderOption(right, "right")}
    </div>
  );
}
