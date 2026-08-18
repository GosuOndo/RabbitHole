import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { PageHeader } from "@/components/page-header";
import { ProfileBars } from "@/components/profile-bars";
import { SessionControls } from "@/components/session-controls";
import { Badge } from "@/components/ui/badge";
import { getCatalogStats } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { getUserProfileSnapshot, type InterestProfileView } from "@/lib/profile/profile-service";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

function Panel({ title, badge, children, testId }: { title: string; badge?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function ProfileSection({ profile, emptyLabel }: { profile: InterestProfileView; emptyLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Topics</h3>
        <ProfileBars features={profile.tags} emptyLabel={emptyLabel} />
      </div>
      {profile.dislikedTags.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Leaning away from</h3>
          <ProfileBars features={profile.dislikedTags} tone="danger" />
        </div>
      ) : null}
      {profile.difficulty.length + profile.duration.length + profile.languages.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Difficulty</h3>
            <ProfileBars features={profile.difficulty} valueKey="familyStrength" tone="info" emptyLabel="—" />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Duration</h3>
            <ProfileBars features={profile.duration} valueKey="familyStrength" tone="info" emptyLabel="—" />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Languages</h3>
            <ProfileBars features={profile.languages} valueKey="familyStrength" tone="info" emptyLabel="—" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Recommender transparency page. Phase 2 shows the computed long-term and
 * session profiles, behaviour statistics and session controls; the pipeline
 * diagnostics and recommendation inspector arrive with the recommender.
 */
export default async function InsightsPage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const user = await getOrCreateDemoUser();
  const [snapshot, catalog] = await Promise.all([getUserProfileSnapshot(user.id), getCatalogStats()]);
  const { stats, longTermProfile, sessionProfile, session, onboarding } = snapshot;

  const statCells: { label: string; value: number }[] = [
    { label: "Interactions", value: stats.totalInteractions },
    { label: "Saved", value: stats.savedProjects },
    { label: "Not interested", value: stats.dislikedProjects },
    { label: "Building", value: stats.builtProjects },
    { label: "Completed", value: stats.completedProjects },
    { label: "This session", value: stats.currentSessionInteractions },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Insights"
        title="What RabbitHole thinks you like"
        description={
          <>
            Real values computed from your behaviour. Bars show relative strength (max-normalised), not probabilities. Long-term taste decays
            with a {snapshot.config.halfLifeDays}-day half-life; the session profile only looks at the current session.
          </>
        }
        actions={<SessionControls />}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="interaction-stats">
        {statCells.map((cell) => (
          <div key={cell.label} className="rounded-card border border-border bg-surface p-3">
            <dt className="text-xs text-muted">{cell.label}</dt>
            <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{cell.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Long-term taste"
          testId="long-term-profile"
          badge={
            <span className="text-xs text-muted">
              {longTermProfile.interactionCount} weighted interaction{longTermProfile.interactionCount === 1 ? "" : "s"}
              {longTermProfile.includesOnboarding ? " + onboarding" : ""}
            </span>
          }
        >
          {longTermProfile.isEmpty ? (
            <p className="text-sm text-muted">
              No taste signal yet.{" "}
              {!onboarding.completed ? (
                <>
                  <Link href="/onboarding" className="text-accent-strong underline-offset-2 hover:underline">
                    Complete onboarding
                  </Link>{" "}
                  or
                </>
              ) : null}{" "}
              open and save a few projects to get started.
            </p>
          ) : (
            <ProfileSection profile={longTermProfile} emptyLabel="No topic signal yet." />
          )}
        </Panel>

        <Panel
          title="This session"
          testId="session-profile"
          badge={
            <span className="flex items-center gap-2">
              <Badge tone="warning">temporary</Badge>
              {session ? (
                <span className="text-xs text-muted" data-testid="session-meta">
                  {session.interactionCount} interaction{session.interactionCount === 1 ? "" : "s"} · started{" "}
                  {new Date(session.startedAt).toLocaleTimeString()}
                </span>
              ) : (
                <span className="text-xs text-muted" data-testid="session-meta">
                  no active session
                </span>
              )}
            </span>
          }
        >
          {sessionProfile.isEmpty ? (
            <p className="text-sm text-muted">
              {session
                ? "Nothing weighted in this session yet — opening, saving or skipping projects shows up here immediately."
                : `Sessions start with your first interaction and end after ${snapshot.config.sessionTimeoutMinutes} minutes of inactivity.`}
            </p>
          ) : (
            <ProfileSection profile={sessionProfile} emptyLabel="No topic signal this session." />
          )}
        </Panel>
      </div>

      <Panel title="Onboarding answers">
        {onboarding.completed ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Topics</dt>
              <dd className="mt-0.5">{onboarding.topics.map((t) => t.label).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Difficulty</dt>
              <dd className="mt-0.5">{onboarding.difficultyPreference ?? "Surprise me"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Duration</dt>
              <dd className="mt-0.5">{onboarding.durationPreference ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">
            Not completed yet —{" "}
            <Link href="/onboarding" className="text-accent-strong underline-offset-2 hover:underline">
              start onboarding
            </Link>
            .
          </p>
        )}
      </Panel>

      <Panel title="Catalog" testId="catalog-stats">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ["Projects", catalog.projects],
            ["Tags", catalog.tags],
            ["Languages", catalog.languages],
            ["Synthetic users", catalog.syntheticUsers],
            ["Interactions stored", catalog.interactions],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{Number(value).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
