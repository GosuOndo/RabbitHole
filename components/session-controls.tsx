"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Start new session" — ends the current session server-side (POST /api/sessions)
 * and opens a fresh one. History is kept; only current-session influence resets.
 * By default the surrounding server component is refreshed; pass `onStarted`
 * (e.g. the Discover feed's reload) to refresh client state instead.
 */
export function SessionControls({ onStarted }: { onStarted?: (session: { id: string; startedAt: string }) => void | Promise<void> } = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const startNewSession = () => {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/sessions", { method: "POST" });
      if (!response.ok) {
        setMessage("Could not start a new session.");
        return;
      }
      const body = (await response.json()) as { session: { id: string; startedAt: string } | null };
      setMessage("New session started.");
      if (onStarted && body.session) await onStarted(body.session);
      else router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={startNewSession} disabled={pending} aria-busy={pending}>
        Start new session
      </Button>
      <span className="text-xs text-muted" aria-live="polite" data-testid="session-message">
        {message}
      </span>
    </div>
  );
}

/**
 * Concise current-session indicator for the Discover feed: the strongest
 * positive session tags (or an honest "no focus yet"), never the raw vector.
 */
export function SessionFocus({
  session,
}: {
  session: { available: boolean; confidence: number; blendWeight: number; topFeatures: { id: string; label: string }[] };
}) {
  const focus = session.topFeatures.slice(0, 3).map((f) => f.label);
  return (
    <p className="text-xs text-muted" data-testid="session-focus" aria-live="polite">
      <span className="font-medium text-foreground">This session:</span>{" "}
      {session.available && focus.length > 0 ? (
        <>
          {focus.join(" · ")}
          <span className="text-subtle"> · session influence {Math.round(session.blendWeight * 100)}%</span>
        </>
      ) : (
        "No strong session focus yet."
      )}
    </p>
  );
}
