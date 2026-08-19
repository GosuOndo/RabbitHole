import { describe, expect, it } from "vitest";
import { IMPRESSION_VISIBILITY_THRESHOLD, createImpressionTracker } from "@/lib/client/impressions";

describe("createImpressionTracker", () => {
  it("records each project at most once per tracker, regardless of how many times it becomes visible", () => {
    const tracker = createImpressionTracker();
    expect(tracker.shouldRecord("a")).toBe(true);
    expect(tracker.shouldRecord("a")).toBe(false);
    expect(tracker.shouldRecord("a")).toBe(false);
    expect(tracker.shouldRecord("b")).toBe(true);
    expect(tracker.has("a")).toBe(true);
    expect(tracker.has("c")).toBe(false);
    expect(tracker.size).toBe(2);
  });

  it("can be seeded so re-observing already-surfaced cards (e.g. after a Strict Mode remount) is a no-op", () => {
    const tracker = createImpressionTracker(["a", "b"]);
    expect(tracker.shouldRecord("a")).toBe(false);
    expect(tracker.shouldRecord("c")).toBe(true);
  });

  it("uses a half-visible threshold", () => {
    expect(IMPRESSION_VISIBILITY_THRESHOLD).toBe(0.5);
  });
});
