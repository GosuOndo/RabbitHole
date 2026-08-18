import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Saved" };

/** Phase 1 shell. Phase 3 lists saved projects with filters and sorting. */
export default function SavedPage() {
  return (
    <div>
      <PageHeader eyebrow="Saved" title="Your saved projects" description="Ideas you have saved to build later." />
      <EmptyState
        title="No saved projects yet."
        description="Explore RabbitHole and save ideas you might want to build."
        action={
          <ButtonLink href="/discover" variant="primary">
            Start exploring
          </ButtonLink>
        }
      />
    </div>
  );
}
