"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { InteractionType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { postInteraction } from "@/lib/client/interactions";

export interface ProjectActionState {
  saved: boolean;
  disliked: boolean;
  built: boolean;
  completed: boolean;
}

/**
 * Save / Build / Not interested (+ Mark completed once building) for the
 * project detail page. Each click records one interaction through the API and
 * refreshes server-rendered data.
 */
export function ProjectActions({ projectId, initialState }: { projectId: string; initialState: ProjectActionState }) {
  const router = useRouter();
  const [state, setState] = useState<ProjectActionState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (type: InteractionType, next: Partial<ProjectActionState>, message: string) => {
    setError(null);
    startTransition(async () => {
      const result = await postInteraction(projectId, type);
      if (!result.ok) {
        setError(result.message ?? "Could not record that.");
        return;
      }
      setState((previous) => ({ ...previous, ...next }));
      setStatus(message);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="project-actions">
      <div className="flex flex-wrap items-center gap-2">
        {state.saved ? (
          <Button variant="secondary" onClick={() => send("UNSAVE", { saved: false }, "Removed from saved.")} disabled={pending} aria-pressed="true">
            Saved ✓ (unsave)
          </Button>
        ) : (
          <Button variant="primary" onClick={() => send("SAVE", { saved: true, disliked: false }, "Saved for later.")} disabled={pending}>
            Save
          </Button>
        )}
        {state.built ? (
          state.completed ? (
            <Button variant="secondary" disabled>
              Completed ✓
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => send("COMPLETE", { completed: true }, "Marked as completed — nice.")} disabled={pending}>
              Mark as completed
            </Button>
          )
        ) : (
          <Button variant="secondary" onClick={() => send("BUILD", { built: true }, "You’re building this. It leaves the discovery feed.")} disabled={pending}>
            Build this
          </Button>
        )}
        {state.disliked ? (
          <Button variant="ghost" disabled>
            Not interested ✓
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={() => send("DISLIKE", { disliked: true, saved: false }, "Got it — fewer projects like this.")}
            disabled={pending}
          >
            Not interested
          </Button>
        )}
      </div>
      <p className="min-h-4 text-xs text-muted" aria-live="polite">
        {error ? <span className="text-danger">{error}</span> : status}
      </p>
    </div>
  );
}
