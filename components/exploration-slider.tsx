"use client";

import { useEffect, useRef, useState } from "react";
import { DISCOVERY_MODE_LABEL } from "@/components/recommendation-explanation";
import type { DiscoveryMode } from "@/lib/recommender/recommend";

const COMMIT_DEBOUNCE_MS = 350;

/** Mirrors RECOMMENDER_CONFIG.exploration.labels without shipping the config to the client. */
export function discoveryModeFor(value: number, thresholds: { familiarMax: number; adventurousMin: number }): DiscoveryMode {
  if (value <= thresholds.familiarMax) return "familiar";
  if (value >= thresholds.adventurousMin) return "adventurous";
  return "balanced";
}

/**
 * Familiar ↔ Adventurous control bound to the persisted `explorationPreference`.
 * A native range input (keyboard + screen-reader friendly); changes are
 * debounced and committed through PATCH /api/profile, then the parent refreshes
 * the feed so the setting reaches the recommender.
 */
export function ExplorationSlider({
  value,
  thresholds,
  onCommitted,
}: {
  value: number;
  thresholds: { familiarMax: number; adventurousMin: number };
  onCommitted: (value: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRef = useRef(value);

  useEffect(() => {
    committedRef.current = value;
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const commit = async (next: number) => {
    if (next === committedRef.current) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ explorationPreference: next }),
      });
      if (!response.ok) throw new Error(`Could not save (${response.status}).`);
      committedRef.current = next;
      setMessage(`Saved — discovery mode: ${DISCOVERY_MODE_LABEL[discoveryModeFor(next, thresholds)]}.`);
      await onCommitted(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your preference.");
      setDraft(committedRef.current);
    } finally {
      setSaving(false);
    }
  };

  const schedule = (next: number) => {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void commit(next), COMMIT_DEBOUNCE_MS);
  };

  const mode = discoveryModeFor(draft, thresholds);
  const hint =
    mode === "familiar"
      ? "More confident matches based on what RabbitHole already knows."
      : mode === "adventurous"
        ? "More novel and varied projects that are still relevant to you."
        : "A balance of confident matches and fresh, adjacent ideas.";

  return (
    <div className="flex flex-col gap-1.5" data-testid="exploration-slider">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="exploration-preference" className="text-sm font-medium">
          Discovery mode
        </label>
        <span className="font-mono text-xs tabular-nums text-muted" aria-live="polite">
          {DISCOVERY_MODE_LABEL[mode]} · {draft.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span aria-hidden="true">Familiar</span>
        <input
          id="exploration-preference"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={draft}
          disabled={saving}
          onChange={(event) => schedule(Number(event.target.value))}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={draft}
          aria-valuetext={`${DISCOVERY_MODE_LABEL[mode]} (${draft.toFixed(2)})`}
          aria-describedby="exploration-preference-hint"
          className="h-2 w-full flex-1 cursor-pointer accent-[var(--accent)] disabled:opacity-60"
        />
        <span aria-hidden="true">Adventurous</span>
      </div>
      <p id="exploration-preference-hint" className="text-xs text-subtle" aria-live="polite">
        {message ?? hint}
      </p>
    </div>
  );
}
