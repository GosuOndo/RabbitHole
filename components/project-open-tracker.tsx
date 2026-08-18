"use client";

import { useEffect, useRef } from "react";
import { postInteraction } from "@/lib/client/interactions";

/**
 * Records one OPEN interaction when a project detail page is viewed. The ref
 * guard makes it idempotent across React StrictMode's double effect in
 * development and across re-renders; a new project id records a new OPEN.
 */
export function ProjectOpenTracker({ projectId }: { projectId: string }) {
  const recordedFor = useRef<string | null>(null);

  useEffect(() => {
    if (recordedFor.current === projectId) return;
    recordedFor.current = projectId;
    void postInteraction(projectId, "OPEN");
  }, [projectId]);

  return null;
}
