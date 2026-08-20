import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { PageHeader } from "@/components/page-header";
import { ProfileBars } from "@/components/profile-bars";
import { PipelineFlow, RecentRunList, RunInspector, formatRunTime } from "@/components/run-inspector";
import { SessionControls } from "@/components/session-controls";
import { Badge } from "@/components/ui/badge";
import { getCatalogStats } from "@/lib/catalog/queries";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { getInsights, RunNotFoundError, type InsightsData } from "@/lib/insights/insights-service";
import type { InterestProfileView, SessionFocusView } from "@/lib/profile/profile-service";

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
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Strongest positive signals</h3>
        <ProfileBars features={profile.tags} emptyLabel={emptyLabel} />
      </div>
      {profile.dislikedTags.length + profile.dislikedLanguages.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">Negative signals</h3>
          <ProfileBars features={[...profile.dislikedTags, ...profile.dislikedLanguages]} tone="danger" />
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

function SessionFocusMetrics({ focus }: { focus: SessionFocusView }) {
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3" data-testid="session-focus-metrics">
      {focus.available ? (
        <dl className="grid grid-cols-2 gap-2 font-mono text-xs tabular-nums sm:grid-cols-4">
          {[
            ["Evidence", focus.evidence.toFixed(1)],
            ["Coherence", focus.coherence.toFixed(2)],
            ["Confidence", focus.confidence.toFixed(2)],
            ["Feed influence", `${Math.round(focus.blendWeight * 100)}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-surface-raised/50 px-2 py-1.5">
              <dt className="text-[11px] font-sans text-subtle">{label}</dt>
              <dd className="mt-0.5 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">No strong session focus yet.</p>
      )}
      <p className="text-xs text-subtle">
        Session interests steer recommendations temporarily ({focus.available ? `${focus.meaningfulInteractions} meaningful action${focus.meaningfulInteractions === 1 ? "" : "s"} this session; ` : ""}
        at most 45% of the effective profile) and are folded into historical taste once the session ends.
      </p>
    </div>
  );
}

/**
 * Recommender transparency and debugging: the live learned profile (long-term
 * vs current session), the adaptive session focus, and immutable recommendation
 * run snapshots — real pipeline counts, per-result score breakdowns, effective
 * weights, weighted contributions, raw retrieval signals, sources and the
 * explanation exactly as generated. Viewing this page never records a run.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ run?: string | string[] }> }) {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const params = await searchParams;
  const runParam = Array.isArray(params.run) ? params.run[0] : params.run;
  if (runParam !== undefined && (runParam.length === 0 || runParam.length > 128)) notFound();

  const user = await getOrCreateDemoUser();
  let insights: InsightsData;
  try {
    insights = await getInsights(user.id, runParam !== undefined ? { runId: runParam } : {});
  } catch (error) {
    if (error instanceof RunNotFoundError) notFound();
    throw error;
  }
  const catalog = await getCatalogStats();
  const { profile, recentRuns, selectedRun, runs } = insights;
  const { stats, longTermProfile, sessionProfile, sessionFocus, session, onboarding } = profile;

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
            Real recommender state, not decorative statistics. The profile panels are <strong>live</strong>; the pipeline and inspector show an{" "}
            <strong>immutable snapshot</strong> of a recorded recommendation run exactly as it was generated. Long-term taste is your onboarding
            answers plus earlier sessions (decaying with a {profile.config.halfLifeDays}-day half-life); the current session steers the feed with an
            adaptive weight (currently {Math.round(sessionFocus.blendWeight * 100)}% of the effective profile, at most{" "}
            {Math.round(profile.config.maxSessionBlendWeight * 100)}%).
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
              current learned profile · {longTermProfile.interactionCount} weighted interaction{longTermProfile.interactionCount === 1 ? "" : "s"}
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
          title="Current session"
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
                : `Sessions start with your first interaction and end after ${profile.config.sessionTimeoutMinutes} minutes of inactivity.`}
            </p>
          ) : (
            <ProfileSection profile={sessionProfile} emptyLabel="No topic signal this session." />
          )}
          <SessionFocusMetrics focus={sessionFocus} />
        </Panel>
      </div>

      {selectedRun ? (
        <>
          <Panel
            title="Recommendation pipeline"
            testId="pipeline-panel"
            badge={
              <span className="text-xs text-muted">
                snapshot generated {formatRunTime(selectedRun.createdAt)} · {selectedRun.algorithm}
              </span>
            }
          >
            <PipelineFlow pipeline={selectedRun.pipeline} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Panel
              title="Recent recommendation runs"
              testId="recent-runs-panel"
              badge={
                <span className="text-xs text-muted">
                  {runs.stored} stored · keeps {runs.maxStored}
                </span>
              }
            >
              <RecentRunList runs={recentRuns} selectedId={selectedRun.id} />
            </Panel>
            <Panel title="Recommendation inspector" testId="inspector-panel" badge={<span className="text-xs text-muted">historical snapshot — not recomputed</span>}>
              <RunInspector run={selectedRun} />
            </Panel>
          </div>
        </>
      ) : (
        <Panel title="Recommendation pipeline" testId="no-runs">
          <p className="text-sm text-muted">
            No recommendation run recorded yet.{" "}
            <Link href="/discover" className="text-accent-strong underline-offset-2 hover:underline">
              Visit Discover
            </Link>{" "}
            to generate recommendations, then return here to inspect how they were produced.
          </p>
        </Panel>
      )}

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
