import type { Difficulty } from "@/generated/prisma/enums";
import { DIFFICULTY_LABELS, formatDuration } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const DIFFICULTY_TONE: Record<Difficulty, BadgeTone> = {
  BEGINNER: "accent",
  INTERMEDIATE: "info",
  ADVANCED: "warning",
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <Badge tone={DIFFICULTY_TONE[difficulty]}>{DIFFICULTY_LABELS[difficulty]}</Badge>;
}

/** Difficulty, duration and (optionally) languages in one compact row. */
export function ProjectMeta({
  difficulty,
  estimatedHours,
  languages,
  className = "",
}: {
  difficulty: Difficulty;
  estimatedHours: number;
  languages?: { slug: string; name: string }[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${className}`}>
      <DifficultyBadge difficulty={difficulty} />
      <span className="font-mono tabular-nums">{formatDuration(estimatedHours)}</span>
      {languages && languages.length > 0 ? (
        <>
          <span aria-hidden="true" className="text-subtle">
            ·
          </span>
          <span className="truncate">
            <span className="sr-only">Languages: </span>
            {languages.map((l) => l.name).join(", ")}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function TagList({ tags, max, className = "" }: { tags: { slug: string; name: string }[]; max?: number; className?: string }) {
  const visible = typeof max === "number" ? tags.slice(0, max) : tags;
  const hidden = tags.length - visible.length;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Tags">
      {visible.map((tag) => (
        <li key={tag.slug}>
          <Badge>{tag.name}</Badge>
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <Badge>+{hidden}</Badge>
        </li>
      ) : null}
    </ul>
  );
}
