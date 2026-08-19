"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { InteractionType } from "@/generated/prisma/enums";
import { EmptyState } from "@/components/empty-state";
import { ExplorationSlider } from "@/components/exploration-slider";
import { RecommendationCard, type RecommendationCardState } from "@/components/recommendation-card";
import { Button } from "@/components/ui/button";
import { IMPRESSION_VISIBILITY_THRESHOLD, createImpressionTracker } from "@/lib/client/impressions";
import { postInteraction } from "@/lib/client/interactions";
import type { RecommendationFeed as RecommendationFeedData, RecommendationView } from "@/lib/recommendations/recommendation-service";

const MIN_CARDS_BEFORE_REFILL = 3;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

function describeContext(context: RecommendationFeedData["context"]): string {
  if (context.profileEmpty) {
    return context.exploration.mode === "adventurous"
      ? "No taste signal yet — showing popular and less-explored projects across the catalog."
      : "No taste signal yet — showing what is popular with RabbitHole users.";
  }
  const parts: string[] = [];
  if (context.coldStart) parts.push("Still learning your taste, so popular projects weigh a little more until you interact more");
  else parts.push(`Personalised from ${context.weightedInteractionCount} weighted interactions`);
  if (context.includesOnboarding) parts.push("your onboarding answers");
  let text = parts.length === 2 ? `${parts[0]} and ${parts[1]}.` : `${parts[0]}.`;
  if (context.sessionWeight > 0) text += " Includes a touch of what you explored this session.";
  if (context.exploration.mode === "adventurous") text += " Adventurous mode: more novel and varied picks that stay relevant.";
  else if (context.exploration.mode === "familiar") text += " Familiar mode: confident matches first.";
  return text;
}

const defaultStatus = (item: RecommendationView): RecommendationCardState => ({ saved: item.saved, built: false, pending: false, message: null });

const noopSubscribe = () => () => {};
/** False during server rendering and hydration, true once React is interactive on the client. */
const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/**
 * The Discover feed. Server-rendered recommendations come in as props; the
 * client tracks per-card state, records impressions once per surfaced card,
 * sends feedback through the interaction API, and refills from
 * /api/recommendations when the list runs low. Keyboard: ← Nope, → next,
 * S save, B build, ? explanation.
 */
export function RecommendationFeed({
  initial,
  explorationLabels,
}: {
  initial: RecommendationFeedData;
  explorationLabels: { familiarMax: number; adventurousMin: number };
}) {
  const [items, setItems] = useState<RecommendationView[]>(initial.items);
  const [context, setContext] = useState(initial.context);
  const [explorationPreference, setExplorationPreference] = useState(initial.context.exploration.preference);
  const [statuses, setStatuses] = useState<Record<string, RecommendationCardState>>(() =>
    Object.fromEntries(initial.items.map((item) => [item.project.id, defaultStatus(item)])),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [explanationFor, setExplanationFor] = useState<string | null>(null);
  const [feedMessage, setFeedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initial.items.length === 0);
  const hydrated = useHydrated();

  const dismissedRef = useRef(new Set<string>());
  const trackerRef = useRef(createImpressionTracker());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ---- impressions -------------------------------------------------------
  const registerElement = useCallback((projectId: string, element: HTMLElement | null) => {
    const previous = elementsRef.current.get(projectId);
    if (previous && observerRef.current) observerRef.current.unobserve(previous);
    if (element) {
      elementsRef.current.set(projectId, element);
      if (observerRef.current && !trackerRef.current.has(projectId)) observerRef.current.observe(element);
    } else {
      elementsRef.current.delete(projectId);
    }
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < IMPRESSION_VISIBILITY_THRESHOLD) continue;
          const projectId = [...elementsRef.current.entries()].find(([, el]) => el === entry.target)?.[0];
          if (!projectId) continue;
          observer.unobserve(entry.target);
          if (trackerRef.current.shouldRecord(projectId)) void postInteraction(projectId, "IMPRESSION");
        }
      },
      { threshold: IMPRESSION_VISIBILITY_THRESHOLD },
    );
    observerRef.current = observer;
    for (const [projectId, element] of elementsRef.current) {
      if (!trackerRef.current.has(projectId)) observer.observe(element);
    }
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // ---- data ---------------------------------------------------------------
  const loadMore = useCallback(async () => {
    setLoading(true);
    setFeedMessage(null);
    try {
      const response = await fetch(`/api/recommendations?limit=${initial.limit}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load recommendations (${response.status}).`);
      const feed = (await response.json()) as RecommendationFeedData;
      setContext(feed.context);
      const known = new Set(itemsRef.current.map((item) => item.project.id));
      const fresh = feed.items.filter((item) => !known.has(item.project.id) && !dismissedRef.current.has(item.project.id));
      if (fresh.length === 0) {
        setExhausted(true);
        if (itemsRef.current.length > 0) setFeedMessage("That's everything RabbitHole can recommend right now.");
      } else {
        setStatuses((previous) => ({ ...previous, ...Object.fromEntries(fresh.map((item) => [item.project.id, defaultStatus(item)])) }));
        setItems((previous) => [...previous, ...fresh]);
      }
    } catch (error) {
      setFeedMessage(error instanceof Error ? error.message : "Could not load more recommendations.");
    } finally {
      setLoading(false);
    }
  }, [initial.limit]);

  /** Re-requests the feed from scratch (after the exploration preference changed) and replaces the list. */
  const reloadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/recommendations?limit=${initial.limit}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not refresh recommendations (${response.status}).`);
      const feed = (await response.json()) as RecommendationFeedData;
      const fresh = feed.items.filter((item) => !dismissedRef.current.has(item.project.id));
      setContext(feed.context);
      setStatuses((previous) => Object.fromEntries(fresh.map((item) => [item.project.id, previous[item.project.id] ?? defaultStatus(item)])));
      setItems(fresh);
      setCurrentIndex(0);
      setExplanationFor(null);
      setExhausted(fresh.length === 0);
      setFeedMessage("Feed refreshed for your discovery mode.");
    } catch (error) {
      setFeedMessage(error instanceof Error ? error.message : "Could not refresh recommendations.");
    } finally {
      setLoading(false);
    }
  }, [initial.limit]);

  // ---- per-card actions ------------------------------------------------------
  const setStatus = (projectId: string, patch: Partial<RecommendationCardState>) =>
    setStatuses((previous) => ({
      ...previous,
      [projectId]: { ...(previous[projectId] ?? { saved: false, built: false, pending: false, message: null }), ...patch },
    }));

  const removeItem = (projectId: string) => {
    dismissedRef.current.add(projectId);
    const remaining = items.filter((item) => item.project.id !== projectId);
    setItems(remaining);
    setCurrentIndex((index) => Math.min(index, Math.max(0, remaining.length - 1)));
    if (explanationFor === projectId) setExplanationFor(null);
    // Refill from the handler (not an effect) when the list runs low.
    if (!loading && !exhausted && remaining.length > 0 && remaining.length < MIN_CARDS_BEFORE_REFILL) void loadMore();
  };

  const send = async (item: RecommendationView, type: InteractionType, onSuccess: () => void, successMessage: string) => {
    const projectId = item.project.id;
    setStatus(projectId, { pending: true, message: null });
    const result = await postInteraction(projectId, type);
    if (!result.ok) {
      setStatus(projectId, { pending: false, message: result.message ?? "Could not record that." });
      return;
    }
    setStatus(projectId, { pending: false });
    onSuccess();
    setFeedMessage(successMessage);
  };

  const nope = (item: RecommendationView) => send(item, "DISLIKE", () => removeItem(item.project.id), `Got it — fewer projects like “${item.project.title}”.`);
  const toggleSave = (item: RecommendationView) => {
    const saved = statuses[item.project.id]?.saved ?? item.saved;
    return send(
      item,
      saved ? "UNSAVE" : "SAVE",
      () => setStatus(item.project.id, { saved: !saved, message: saved ? "Removed from saved." : "Saved for later." }),
      saved ? `Removed “${item.project.title}” from saved.` : `Saved “${item.project.title}”.`,
    );
  };
  const build = (item: RecommendationView) =>
    send(
      item,
      "BUILD",
      () => {
        setStatus(item.project.id, { built: true });
        removeItem(item.project.id);
      },
      `You're building “${item.project.title}” — it leaves the feed.`,
    );
  const toggleExplanation = (item: RecommendationView) => setExplanationFor((current) => (current === item.project.id ? null : item.project.id));

  const focusCard = (index: number) => {
    const item = items[index];
    if (!item) return;
    setCurrentIndex(index);
    const element = elementsRef.current.get(item.project.id);
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    element?.focus({ preventScroll: true });
  };

  // ---- keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const current = items[currentIndex];
      switch (event.key) {
        case "ArrowLeft":
          if (current) {
            event.preventDefault();
            void nope(current);
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          focusCard(Math.min(currentIndex + 1, items.length - 1));
          break;
        case "s":
        case "S":
          if (current) {
            event.preventDefault();
            void toggleSave(current);
          }
          break;
        case "b":
        case "B":
          if (current) {
            event.preventDefault();
            void build(current);
          }
          break;
        case "?":
          if (current) {
            event.preventDefault();
            toggleExplanation(current);
          }
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="flex flex-col gap-4" data-testid="recommendation-feed" data-hydrated={hydrated ? "true" : "false"}>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised/50 px-4 py-3 text-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted" data-testid="feed-context">
            {describeContext(context)}
          </p>
          <p className="shrink-0 font-mono text-[11px] text-subtle" aria-label="Keyboard shortcuts">
            ← nope · → next · S save · B build · ? why
          </p>
        </div>
        <ExplorationSlider
          value={explorationPreference}
          thresholds={explorationLabels}
          onCommitted={async (value) => {
            setExplorationPreference(value);
            await reloadFeed();
          }}
        />
      </div>

      <p className="min-h-4 text-sm text-muted" aria-live="polite" data-testid="feed-message">
        {feedMessage}
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No recommendations available yet."
          description={
            <>
              Save or open a few projects, or{" "}
              <Link href="/onboarding" className="text-accent-strong underline-offset-2 hover:underline">
                retake onboarding
              </Link>
              , to teach RabbitHole what you like.
            </>
          }
          action={
            <Button variant="primary" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Try again"}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Recommendations">
          {items.map((item, index) => (
            <li key={item.project.id}>
              <RecommendationCard
                item={{ ...item, rank: index + 1 }}
                state={statuses[item.project.id] ?? defaultStatus(item)}
                isCurrent={index === currentIndex}
                explanationOpen={explanationFor === item.project.id}
                discoveryMode={context.exploration.mode}
                onNope={() => void nope(item)}
                onToggleSave={() => void toggleSave(item)}
                onBuild={() => void build(item)}
                onToggleExplanation={() => toggleExplanation(item)}
                onActivate={() => setCurrentIndex(index)}
                registerElement={registerElement}
              />
            </li>
          ))}
        </ol>
      )}

      {items.length > 0 ? (
        <div className="flex items-center justify-center gap-2 py-2">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loading || exhausted}>
            {loading ? "Loading…" : exhausted ? "No more recommendations" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
