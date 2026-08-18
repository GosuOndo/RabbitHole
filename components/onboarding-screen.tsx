"use client";

import { useState } from "react";
import { OnboardingWizard, type OnboardingWizardProps } from "@/components/onboarding-wizard";
import { Button, ButtonLink } from "@/components/ui/button";

export interface CompletedSummary {
  /** Pre-formatted on the server so server and client markup match. */
  completedLabel: string | null;
  topics: string[];
  difficulty: string;
  duration: string;
  choices: string[];
}

/**
 * Shows the wizard for new users. Onboarded users see their answers with a
 * "Retake onboarding" option instead of being pushed through the flow again.
 */
export function OnboardingScreen({ completed, wizard }: { completed: CompletedSummary | null; wizard: OnboardingWizardProps }) {
  const [retaking, setRetaking] = useState(false);

  if (completed && !retaking) {
    return (
      <div className="rounded-card border border-border bg-surface p-5 sm:p-6" data-testid="onboarding-complete">
        <h2 className="text-lg font-semibold tracking-tight">You&apos;re all set</h2>
        <p className="mt-1 text-sm text-muted">
          Onboarding is complete{completed.completedLabel ? ` (${completed.completedLabel})` : ""}. Your answers seed your long-term taste
          profile; everything you open, save and skip refines it.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Topics</dt>
            <dd className="mt-1">{completed.topics.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Difficulty · Time</dt>
            <dd className="mt-1">
              {completed.difficulty} · {completed.duration}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wider text-subtle">You would rather build</dt>
            <dd className="mt-1">{completed.choices.join(" · ") || "—"}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ButtonLink href="/discover" variant="primary">
            Go to Discover
          </ButtonLink>
          <Button variant="secondary" onClick={() => setRetaking(true)}>
            Retake onboarding
          </Button>
        </div>
      </div>
    );
  }

  return <OnboardingWizard {...wizard} onCancel={completed ? () => setRetaking(false) : undefined} />;
}
