"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DurationPreference } from "@/generated/prisma/enums";
import { InterestSelector, type InterestOption } from "@/components/interest-selector";
import { OptionGroup, type RadioOption } from "@/components/option-group";
import { PairwiseChoice, type PairwiseOption } from "@/components/pairwise-choice";
import { Button } from "@/components/ui/button";

export type DifficultyChoice = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "SURPRISE_ME";

export interface OnboardingPairView {
  index: number;
  left: PairwiseOption;
  right: PairwiseOption;
}

export interface OnboardingWizardProps {
  topics: InterestOption[];
  topicLimits: { min: number; max: number };
  difficultyOptions: RadioOption<DifficultyChoice>[];
  durationOptions: RadioOption<DurationPreference>[];
  pairs: OnboardingPairView[];
  initial?: {
    topics: string[];
    difficulty: DifficultyChoice | null;
    duration: DurationPreference | null;
    choices: Record<number, string>;
  };
  onCancel?: () => void;
}

const STEPS = ["Interests", "Difficulty", "Time", "Choices", "Finish"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

/**
 * Four-step onboarding: topics → difficulty → time → pairwise choices → review.
 * All controls are native buttons/radios; focus moves to the step heading on
 * every transition so keyboard and screen-reader users keep their place.
 */
export function OnboardingWizard({ topics, topicLimits, difficultyOptions, durationOptions, pairs, initial, onCancel }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [pairCursor, setPairCursor] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState<string[]>(initial?.topics ?? []);
  const [difficulty, setDifficulty] = useState<DifficultyChoice | null>(initial?.difficulty ?? null);
  const [duration, setDuration] = useState<DurationPreference | null>(initial?.duration ?? null);
  const [choices, setChoices] = useState<Record<number, string>>(initial?.choices ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip the initial mount so the page heading keeps focus on first render.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step, pairCursor]);

  const topicsValid = selectedTopics.length >= topicLimits.min && selectedTopics.length <= topicLimits.max;
  const allPairsAnswered = pairs.every((pair) => choices[pair.index] !== undefined);
  const currentPair = pairs[pairCursor];

  const goBack = () => {
    setError(null);
    if (step === 3 && pairCursor > 0) setPairCursor(pairCursor - 1);
    else if (step === 4) {
      setStep(3);
      setPairCursor(Math.max(0, pairs.length - 1));
    } else if (step > 0) setStep((step - 1) as Step);
  };

  const goNext = () => {
    setError(null);
    if (step === 0 && topicsValid) setStep(1);
    else if (step === 1 && difficulty) setStep(2);
    else if (step === 2 && duration) {
      setPairCursor(0);
      setStep(pairs.length > 0 ? 3 : 4);
    } else if (step === 3 && currentPair && choices[currentPair.index] !== undefined) {
      if (pairCursor < pairs.length - 1) setPairCursor(pairCursor + 1);
      else setStep(4);
    }
  };

  const choosePair = (slug: string) => {
    if (!currentPair) return;
    setChoices((previous) => ({ ...previous, [currentPair.index]: slug }));
    setError(null);
    // Auto-advance after a choice; the last pair moves to the review step.
    if (pairCursor < pairs.length - 1) setPairCursor(pairCursor + 1);
    else setStep(4);
  };

  const submit = async () => {
    if (!topicsValid || !difficulty || !duration || !allPairsAnswered) {
      setError("Please answer every step before finishing.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topics: selectedTopics,
          difficulty,
          duration,
          choices: pairs.map((pair) => ({ pairIndex: pair.index, chosenSlug: choices[pair.index] })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }
      const body = (await response.json()) as { redirectTo?: string };
      router.push(body.redirectTo ?? "/discover");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answers.");
      setSubmitting(false);
    }
  };

  const stepTitle: Record<Step, string> = {
    0: "What sounds interesting?",
    1: "How challenging?",
    2: "How much time do you want to spend?",
    3: "Which would you rather build?",
    4: "Ready to start exploring",
  };
  const stepHint: Record<Step, string> = {
    0: `Pick ${topicLimits.min}–${topicLimits.max} topics. They seed your taste profile; RabbitHole learns the rest from what you do.`,
    1: "This nudges the difficulty of what you see first. You can always dig deeper.",
    2: "Roughly how big should a project be? This becomes a duration preference in your profile.",
    3: `Pair ${Math.min(pairCursor + 1, Math.max(pairs.length, 1))} of ${pairs.length}. Each pick strengthens the features of the project you choose.`,
    4: "Here is what RabbitHole will start from. You can retake onboarding at any time from this page.",
  };
  const headingId = "onboarding-step-heading";

  return (
    <div className="flex flex-col gap-6">
      <ol aria-label="Onboarding progress" className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, index) => {
          const state = index < step ? "done" : index === step ? "current" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${
                  state === "current"
                    ? "border-accent bg-accent-soft/60 text-foreground"
                    : state === "done"
                      ? "border-border bg-surface-raised text-muted"
                      : "border-border text-subtle"
                }`}
              >
                <span className="font-mono tabular-nums">{index + 1}</span>
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="text-subtle">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <section aria-labelledby={headingId} className="rounded-card border border-border bg-surface p-5 sm:p-6">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          {stepTitle[step]}
        </h2>
        <p className="mt-1 mb-5 max-w-2xl text-sm leading-relaxed text-muted text-pretty">{stepHint[step]}</p>

        {step === 0 ? (
          <InterestSelector
            options={topics}
            selected={selectedTopics}
            onChange={setSelectedTopics}
            min={topicLimits.min}
            max={topicLimits.max}
            labelledBy={headingId}
          />
        ) : null}
        {step === 1 ? (
          <OptionGroup name="difficulty" options={difficultyOptions} value={difficulty} onChange={setDifficulty} labelledBy={headingId} />
        ) : null}
        {step === 2 ? (
          <OptionGroup name="duration" options={durationOptions} value={duration} onChange={setDuration} labelledBy={headingId} />
        ) : null}
        {step === 3 && currentPair ? (
          <PairwiseChoice
            pairIndex={currentPair.index}
            left={currentPair.left}
            right={currentPair.right}
            selectedSlug={choices[currentPair.index] ?? null}
            onChoose={choosePair}
            labelledBy={headingId}
          />
        ) : null}
        {step === 4 ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-border bg-surface-raised/60 p-3">
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Topics</dt>
              <dd className="mt-1">{selectedTopics.map((key) => topics.find((t) => t.key === key)?.label ?? key).join(", ")}</dd>
            </div>
            <div className="rounded-md border border-border bg-surface-raised/60 p-3">
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Difficulty · Time</dt>
              <dd className="mt-1">
                {difficultyOptions.find((o) => o.value === difficulty)?.label ?? "—"} · {durationOptions.find((o) => o.value === duration)?.label ?? "—"}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface-raised/60 p-3 sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">You would rather build</dt>
              <dd className="mt-1">
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {pairs.map((pair) => {
                    const chosen = choices[pair.index] === pair.left.slug ? pair.left : pair.right;
                    return <li key={pair.index}>{chosen.title}</li>;
                  })}
                </ul>
              </dd>
            </div>
          </dl>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger-soft/50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button variant="ghost" onClick={goBack} disabled={submitting}>
                Back
              </Button>
            ) : onCancel ? (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {step < 3 ? (
              <Button
                variant="primary"
                onClick={goNext}
                disabled={(step === 0 && !topicsValid) || (step === 1 && !difficulty) || (step === 2 && !duration)}
              >
                Next
              </Button>
            ) : null}
            {step === 3 && currentPair && choices[currentPair.index] !== undefined ? (
              <Button variant="secondary" onClick={goNext}>
                {pairCursor < pairs.length - 1 ? "Next pair" : "Review"}
              </Button>
            ) : null}
            {step === 4 ? (
              <Button variant="primary" onClick={submit} disabled={submitting} aria-busy={submitting}>
                {submitting ? "Saving…" : "Finish and start exploring"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
