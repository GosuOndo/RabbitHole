import type { Metadata } from "next";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProjectCard } from "@/components/project-card";
import { listProjects } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/**
 * Phase 1: catalog preview so the app has real content end to end. Phase 3
 * replaces this grid with the personalised recommendation feed.
 */
export default async function DiscoverPage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const projects = await listProjects();

  return (
    <div>
      <PageHeader
        eyebrow="Discover"
        title="What should you build next?"
        description={
          <>
            Catalog preview: {projects.length} project ideas, most popular first. Personalised recommendations, explanations and feedback
            actions arrive in Phase 3.
          </>
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          title="The catalog is empty."
          description={
            <>
              Run <code className="font-mono text-foreground">npm run seed</code> to load the project catalog.
            </>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
