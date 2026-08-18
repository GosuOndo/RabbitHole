"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Shows a friendly message and never exposes
 * server stack traces; details go to the server/console logs.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl rounded-card border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        RabbitHole hit an unexpected error while rendering this page. If you just set up the project, check that{" "}
        <code className="font-mono text-foreground">DATABASE_URL</code> points at a running PostgreSQL database and that migrations and the
        seed have been applied.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-subtle">Reference: {error.digest}</p> : null}
      <div className="mt-4">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
