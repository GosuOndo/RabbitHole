import Link from "next/link";
import type { ProjectSummary } from "@/lib/catalog/queries";
import { ProjectMeta, TagList } from "@/components/project-meta";

/**
 * Compact catalog card. The recommendation card (Phase 3) builds on the same
 * pieces and adds score, explanation and feedback actions.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-balance">
          <Link
            href={`/project/${project.slug}`}
            className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline group-hover:text-accent-strong"
          >
            {project.title}
          </Link>
        </h3>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted text-pretty">{project.summary}</p>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <TagList tags={project.tags} max={3} />
        <ProjectMeta difficulty={project.difficulty} estimatedHours={project.estimatedHours} languages={project.languages} />
      </div>
    </article>
  );
}
