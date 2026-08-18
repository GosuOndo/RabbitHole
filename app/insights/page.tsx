import type { Metadata } from "next";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { PageHeader } from "@/components/page-header";
import { getCatalogStats } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

/**
 * Phase 1 shell: real catalog and behaviour counts from the database. Phase 7
 * turns this into the recommender transparency page (taste profiles, pipeline
 * counts, recommendation inspector).
 */
export default async function InsightsPage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const stats = await getCatalogStats();
  const cells: { label: string; value: number }[] = [
    { label: "Projects in catalog", value: stats.projects },
    { label: "Tags", value: stats.tags },
    { label: "Languages", value: stats.languages },
    { label: "Synthetic users", value: stats.syntheticUsers },
    { label: "Interactions stored", value: stats.interactions },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Recommender state"
        description="Real counts from the database. Taste profiles, pipeline diagnostics and the recommendation inspector are added as the recommender comes online."
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-card border border-border bg-surface p-4">
            <dt className="text-xs text-muted">{cell.label}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{cell.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
