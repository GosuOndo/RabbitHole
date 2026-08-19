import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProjectActions } from "@/components/project-actions";
import { ProjectMeta, TagList } from "@/components/project-meta";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import type { Difficulty, DurationPreference } from "@/generated/prisma/enums";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { DIFFICULTY_LABELS, formatScore } from "@/lib/format";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { getSavedProjects } from "@/lib/saved/saved-service";
import { SAVED_SORTS, isSavedSort, type SavedFilters, type SavedSort } from "@/lib/saved/saved-filters";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

const DIFFICULTIES: Difficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const DURATIONS: Exclude<DurationPreference, "ANYTHING">[] = ["UNDER_2_HOURS", "ONE_EVENING", "WEEKEND", "ONE_TO_TWO_WEEKS"];
const SORT_LABELS: Record<SavedSort, string> = {
  recent: "Recently saved",
  match: "Best match",
  shortest: "Shortest first",
  difficulty: "Difficulty",
  adventurous: "Most adventurous",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: SearchParams): SavedFilters {
  const difficulty = first(params.difficulty);
  const duration = first(params.duration);
  const sort = first(params.sort);
  return {
    tag: first(params.tag) || undefined,
    language: first(params.language) || undefined,
    difficulty: difficulty && (DIFFICULTIES as string[]).includes(difficulty) ? (difficulty as Difficulty) : undefined,
    duration: duration && (DURATIONS as string[]).includes(duration) ? (duration as Exclude<DurationPreference, "ANYTHING">) : undefined,
    sort: isSavedSort(sort) ? sort : "recent",
  };
}

const selectClass =
  "h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";

/** Saved projects with filters and sorting; the state comes from interaction history (latest SAVE/UNSAVE wins). */
export default async function SavedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const filters = parseFilters(await searchParams);
  const user = await getOrCreateDemoUser();
  const page = await getSavedProjects(user.id, filters);
  const filtersActive = Boolean(filters.tag || filters.language || filters.difficulty || filters.duration);
  const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div>
      <PageHeader
        eyebrow="Saved"
        title="Your saved projects"
        description={
          page.total > 0
            ? `${page.total} project${page.total === 1 ? "" : "s"} saved to build later. Match scores are live content matches against your current profile.`
            : "Ideas you have saved to build later."
        }
      />

      {page.total === 0 ? (
        <EmptyState
          title="No saved projects yet."
          description="Explore RabbitHole and save ideas you might want to build."
          action={
            <ButtonLink href="/discover" variant="primary">
              Start exploring
            </ButtonLink>
          }
        />
      ) : (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3" aria-label="Filter saved projects">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Tag
              <select name="tag" defaultValue={filters.tag ?? ""} className={selectClass}>
                <option value="">All tags</option>
                {page.facets.tags.map((tag) => (
                  <option key={tag.slug} value={tag.slug}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Language
              <select name="language" defaultValue={filters.language ?? ""} className={selectClass}>
                <option value="">All languages</option>
                {page.facets.languages.map((language) => (
                  <option key={language.slug} value={language.slug}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Difficulty
              <select name="difficulty" defaultValue={filters.difficulty ?? ""} className={selectClass}>
                <option value="">Any difficulty</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Duration
              <select name="duration" defaultValue={filters.duration ?? ""} className={selectClass}>
                <option value="">Any duration</option>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {RECOMMENDER_CONFIG.durationBuckets[d].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Sort by
              <select name="sort" defaultValue={filters.sort ?? "recent"} className={selectClass}>
                {SAVED_SORTS.map((sort) => (
                  <option key={sort} value={sort} disabled={sort === "match" && !page.hasProfile}>
                    {SORT_LABELS[sort]}
                    {sort === "match" && !page.hasProfile ? " (needs a profile)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button type="submit" className={buttonClasses("primary", "md")}>
                Apply
              </button>
              {filtersActive || (filters.sort && filters.sort !== "recent") ? (
                <Link href="/saved" className={buttonClasses("ghost", "md")}>
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          {page.items.length === 0 ? (
            <EmptyState
              title="No saved projects match these filters."
              description="Try clearing a filter or two."
              action={
                <ButtonLink href="/saved" variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3" data-testid="saved-list">
              {page.items.map((item) => (
                <li key={item.project.id} data-testid="saved-item" data-project-slug={item.project.slug}>
                  <article className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
                          <span>Saved {dateFormat.format(item.savedAt)}</span>
                          {item.built ? <Badge tone="warning">{item.completed ? "Completed" : "Building"}</Badge> : null}
                        </div>
                        <h2 className="text-base font-semibold leading-snug tracking-tight">
                          <Link href={`/project/${item.project.slug}`} className="hover:text-accent-strong focus-visible:underline">
                            {item.project.title}
                          </Link>
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{item.project.summary}</p>
                      </div>
                      {page.hasProfile ? (
                        <div className="flex shrink-0 flex-col items-end" title="Live content match against your profile">
                          <span className="font-mono text-xl font-semibold tabular-nums leading-none">{formatScore(Math.max(0, item.matchScore))}</span>
                          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-subtle">match</span>
                        </div>
                      ) : null}
                    </div>
                    <TagList tags={item.project.tags} max={4} />
                    <ProjectMeta difficulty={item.project.difficulty} estimatedHours={item.project.estimatedHours} languages={item.project.languages} />
                    <ProjectActions
                      projectId={item.project.id}
                      initialState={{ saved: true, disliked: false, built: item.built, completed: item.completed }}
                    />
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
