"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/** "Start new session" — ends the current session server-side and opens a fresh one. */
export function SessionControls() {
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
      setMessage("New session started.");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={startNewSession} disabled={pending} aria-busy={pending}>
        Start new session
      </Button>
      <span className="text-xs text-muted" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
