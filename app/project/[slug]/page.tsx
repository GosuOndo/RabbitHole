import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { ProjectMeta, TagList } from "@/components/project-meta";
import { getProjectBySlug } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";
import { splitParagraphs } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  if (!isDatabaseConfigured()) return { title: "Project" };
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  return { title: project?.title ?? "Project not found", description: project?.summary };
}

export default async function ProjectPage({ params }: { params: Promise<Params> }) {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();

  const paragraphs = splitParagraphs(project.description);

  return (
    <article className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
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
        </header>

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
          Save, Build and Not-interested actions, the recommendation explanation and similar projects arrive with the recommender in later
          phases.
        </p>
      </aside>
    </article>
  );
}
