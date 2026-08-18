import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Onboarding" };

/**
 * Phase 1 placeholder. Phase 2 replaces this with the real onboarding flow
 * (topics, difficulty, time commitment, pairwise choices).
 */
export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Getting started"
        title="Let's learn your taste"
        description="RabbitHole will ask a few quick questions — what sounds interesting, how challenging, how much time — and a handful of “which would you rather build?” choices to seed your first recommendations. This flow arrives in the next phase; for now you can browse the catalog."
      />
      <div className="rounded-card border border-border bg-surface p-5">
        <ol className="space-y-3 text-sm text-muted">
          <li className="flex gap-3">
            <span className="font-mono text-subtle">1</span>
            <span>
              <span className="font-medium text-foreground">What sounds interesting?</span> Pick 3–7 topics.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-subtle">2</span>
            <span>
              <span className="font-medium text-foreground">How challenging?</span> Beginner friendly, intermediate, advanced or surprise me.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-subtle">3</span>
            <span>
              <span className="font-medium text-foreground">How much time?</span> From under two hours to a couple of weeks.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-subtle">4</span>
            <span>
              <span className="font-medium text-foreground">Which would you rather build?</span> A few pairwise picks that seed your profile.
            </span>
          </li>
        </ol>
        <div className="mt-5 flex items-center gap-2">
          <ButtonLink href="/discover" variant="primary">
            Browse the catalog
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
