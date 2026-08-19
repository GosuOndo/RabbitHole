import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { ProjectActions } from "@/components/project-actions";
import { ProjectCard } from "@/components/project-card";
import { ProjectMeta, TagList } from "@/components/project-meta";
import { ProjectOpenTracker } from "@/components/project-open-tracker";
import { RecommendationExplanation } from "@/components/recommendation-explanation";
import { getProjectBySlug } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { formatScore, splitParagraphs } from "@/lib/format";
import { getProjectStateForUser } from "@/lib/profile/profile-service";
import { getProjectRecommendationContext, getSimilarProjects } from "@/lib/recommendations/recommendation-service";
import { resolveRankingWeights } from "@/lib/recommender/rank";

export const dynamic = "force-dynamic";

type Params = { slug: string };
type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  if (!isDatabaseConfigured()) return { title: "Project" };
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  return { title: project?.title ?? "Project not found", description: project?.summary };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SearchParams> }) {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const project = await getProjectBySlug(slug);
  if (!project) notFound();

  const user = await getOrCreateDemoUser();
  const [actionState, recommendation, similar] = await Promise.all([
    getProjectStateForUser(user.id, project.id),
    getProjectRecommendationContext(user.id, project.id),
    getSimilarProjects(project.id),
  ]);
  const paragraphs = splitParagraphs(project.description);
  const fromFeed = (Array.isArray(query.ref) ? query.ref[0] : query.ref) === "discover";
  const feedRank = Number(Array.isArray(query.rank) ? query.rank[0] : query.rank);

  return (
    <article className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <ProjectOpenTracker projectId={project.id} />
      <div>
        <nav aria-label="Breadcrumb" className="mb-4 text-xs text-subtle">
          <Link href="/discover" className="hover:text-foreground">
            Discover
          </Link>
          <span aria-hidden="true" className="mx-1.5">
            /
          </span>
          <span className="text-muted">{project.title}</span>
        </nav>
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{project.title}</h1>
          <p className="text-base leading-relaxed text-muted text-pretty">{project.summary}</p>
          <ProjectMeta difficulty={project.difficulty} estimatedHours={project.estimatedHours} />
          <TagList tags={project.tags} />
          <div className="mt-2">
            <ProjectActions projectId={project.id} initialState={actionState} />
          </div>
        </header>

        {recommendation ? (
          <section aria-labelledby="for-you" className="mt-6 rounded-card border border-accent/40 bg-accent-soft/30 p-4" data-testid="recommendation-context">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="for-you" className="text-sm font-semibold">
                  For you
                  {fromFeed && Number.isFinite(feedRank) && feedRank > 0 ? (
                    <span className="ml-2 font-normal text-muted">· ranked #{feedRank} in your feed</span>
                  ) : null}
                </h2>
                <p className="mt-1 text-sm text-foreground/90">{recommendation.explanation.text}</p>
                {recommendation.excludedFromDiscovery ? (
                  <p className="mt-1 text-xs text-subtle">This project no longer appears in Discover because you dismissed, built or completed it.</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end" title="Match score (not a probability)">
                <span className="font-mono text-2xl font-semibold tabular-nums leading-none">{formatScore(recommendation.score)}</span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-subtle">match</span>
              </div>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted hover:text-foreground">Score breakdown</summary>
              <div className="mt-2">
                <RecommendationExplanation
                  explanation={recommendation.explanation}
                  breakdown={recommendation.breakdown}
                  weights={resolveRankingWeights(["content", "popularity"], { coldStart: recommendation.coldStart })}
                  score={recommendation.score}
                  sources={["content"]}
                />
              </div>
            </details>
          </section>
        ) : null}

        <section aria-labelledby="about" className="mt-8">
          <h2 id="about" className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">
            About this project
          </h2>
          <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90 text-pretty">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section aria-labelledby="similar" className="mt-10" data-testid="similar-projects">
          <h2 id="similar" className="mb-1 text-sm font-semibold uppercase tracking-wider text-subtle">
            Similar projects
          </h2>
          <p className="mb-3 text-xs text-subtle">Projects that resemble this one by tags, languages, difficulty and size — independent of your profile.</p>
          {similar.length === 0 ? (
            <p className="text-sm text-muted">No similar projects found.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {similar.map((entry) => (
                <li key={entry.project.id} className="relative">
                  <ProjectCard project={entry.project} />
                  <span className="pointer-events-none absolute right-3 top-3 font-mono text-[11px] tabular-nums text-subtle" title="Content similarity">
                    {entry.similarity.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <section aria-labelledby="learn" className="rounded-card border border-border bg-surface p-4">
          <h2 id="learn" className="mb-2 text-sm font-semibold">
            What you&apos;ll learn
          </h2>
          <ul className="space-y-1.5 text-sm text-muted">
            {project.concepts.map((concept) => (
              <li key={concept} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{concept}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="languages" className="rounded-card border border-border bg-surface p-4">
          <h2 id="languages" className="mb-2 text-sm font-semibold">
            Suggested languages
          </h2>
          {project.languages.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {project.languages.map((language) => (
                <li key={language.slug} className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-xs">
                  {language.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Any language you like.</p>
          )}
        </section>

        {project.sourceUrl ? (
          <section aria-labelledby="reference" className="rounded-card border border-border bg-surface p-4">
            <h2 id="reference" className="mb-2 text-sm font-semibold">
              Reference
            </h2>
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-sm text-accent-strong underline-offset-2 hover:underline"
            >
              {project.sourceUrl.replace(/^https?:\/\//, "")}
            </a>
          </section>
        ) : null}

        <p className="text-xs leading-relaxed text-subtle">
          Opening, saving, building and skipping projects feeds your taste profile (see Insights). The recommendation explanation and
          similar projects arrive with the recommender in later phases.
        </p>
      </aside>
    </article>
  );
}
