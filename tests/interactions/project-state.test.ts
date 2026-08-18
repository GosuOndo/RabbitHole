import { describe, expect, it } from "vitest";
import type { InteractionType } from "@/generated/prisma/enums";
import { deriveProjectStates, dislikedProjectIds, excludedProjectIds, savedProjectIds } from "@/lib/interactions/project-state";

const T0 = new Date("2026-08-18T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ev = (projectId: string, type: InteractionType, minutes: number) => ({ projectId, type, createdAt: at(minutes) });

describe("deriveProjectStates", () => {
  it("treats the latest SAVE/UNSAVE as authoritative for saved state", () => {
    const states = deriveProjectStates([ev("p1", "SAVE", 0), ev("p1", "UNSAVE", 5), ev("p2", "SAVE", 1), ev("p3", "UNSAVE", 0), ev("p3", "SAVE", 9)]);
    expect(states.get("p1")?.saved).toBe(false);
    expect(states.get("p2")?.saved).toBe(true);
    expect(states.get("p2")?.savedAt).toEqual(at(1));
    expect(states.get("p3")?.saved).toBe(true);
    expect(savedProjectIds([ev("p1", "SAVE", 0), ev("p1", "UNSAVE", 5), ev("p2", "SAVE", 1)])).toEqual(["p2"]);
  });

  it("orders by time regardless of input order", () => {
    const states = deriveProjectStates([ev("p1", "UNSAVE", 5), ev("p1", "SAVE", 0)]);
    expect(states.get("p1")?.saved).toBe(false);
  });

  it("dislike removes saved state; a later save lifts the dislike", () => {
    expect(deriveProjectStates([ev("p1", "SAVE", 0), ev("p1", "DISLIKE", 1)]).get("p1")).toMatchObject({ saved: false, disliked: true });
    expect(deriveProjectStates([ev("p1", "DISLIKE", 0), ev("p1", "SAVE", 1)]).get("p1")).toMatchObject({ saved: true, disliked: false });
    expect(dislikedProjectIds([ev("p1", "DISLIKE", 0), ev("p2", "OPEN", 0)])).toEqual(["p1"]);
  });

  it("marks built and completed projects and excludes terminal states from discovery", () => {
    const states = deriveProjectStates([ev("p1", "BUILD", 0), ev("p2", "COMPLETE", 0), ev("p3", "DISLIKE", 0), ev("p4", "SAVE", 0), ev("p5", "OPEN", 0)]);
    expect(states.get("p1")).toMatchObject({ built: true, excludedFromDiscovery: true });
    expect(states.get("p2")).toMatchObject({ completed: true, excludedFromDiscovery: true });
    expect(states.get("p3")).toMatchObject({ disliked: true, excludedFromDiscovery: true });
    expect(states.get("p4")).toMatchObject({ saved: true, excludedFromDiscovery: false });
    expect(states.get("p5")?.excludedFromDiscovery).toBe(false);
    expect(excludedProjectIds([ev("p1", "BUILD", 0), ev("p4", "SAVE", 0)])).toEqual(["p1"]);
  });

  it("counts interactions per project", () => {
    const states = deriveProjectStates([ev("p1", "IMPRESSION", 0), ev("p1", "OPEN", 1), ev("p1", "SAVE", 2)]);
    expect(states.get("p1")?.interactionCount).toBe(3);
  });
});
