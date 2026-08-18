import { describe, expect, it } from "vitest";
import { PROJECTS } from "@/prisma/seed-data/catalog";
import {
  buildSyntheticUsers,
  generateSyntheticDataset,
  projectAffinity,
  resolveSeedAnchor,
  type SeedInteractionType,
} from "@/prisma/seed-data/synthetic";

const ANCHOR = new Date("2026-08-18T00:00:00.000Z");
const TERMINAL: SeedInteractionType[] = ["DISLIKE", "BUILD", "COMPLETE"];

describe("synthetic dataset", () => {
  const dataset = generateSyntheticDataset(PROJECTS, ANCHOR);
  const bySlug = new Map(PROJECTS.map((p) => [p.slug, p]));

  it("is deterministic for the same catalog and anchor", () => {
    const again = generateSyntheticDataset(PROJECTS, ANCHOR);
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
  });

  it("meets the target volumes", () => {
    expect(dataset.users).toHaveLength(30);
    expect(dataset.interactions.length).toBeGreaterThanOrEqual(1000);
    expect(dataset.sessions.length).toBeGreaterThanOrEqual(dataset.users.length);
    const types = new Set(dataset.interactions.map((i) => i.type));
    for (const type of ["IMPRESSION", "OPEN", "SAVE", "UNSAVE", "DISLIKE", "BUILD", "COMPLETE", "SHARE"]) {
      expect(types.has(type as SeedInteractionType), `missing interaction type ${type}`).toBe(true);
    }
  });

  it("gives every user at least one session and interactions in every session", () => {
    const sessionsByUser = new Map<string, number>();
    for (const s of dataset.sessions) sessionsByUser.set(s.userId, (sessionsByUser.get(s.userId) ?? 0) + 1);
    for (const user of dataset.users) expect(sessionsByUser.get(user.id) ?? 0).toBeGreaterThan(0);
    const sessionIdsWithInteractions = new Set(dataset.interactions.map((i) => i.sessionId));
    for (const s of dataset.sessions) expect(sessionIdsWithInteractions.has(s.id)).toBe(true);
  });

  it("keeps ids unique and timestamps chronological within each session and before the anchor", () => {
    expect(new Set(dataset.interactions.map((i) => i.id)).size).toBe(dataset.interactions.length);
    expect(new Set(dataset.sessions.map((s) => s.id)).size).toBe(dataset.sessions.length);
    const sessionById = new Map(dataset.sessions.map((s) => [s.id, s]));
    let previous: { sessionId: string; time: number } | null = null;
    for (const i of dataset.interactions) {
      expect(i.createdAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime());
      const session = sessionById.get(i.sessionId)!;
      expect(i.createdAt.getTime()).toBeGreaterThanOrEqual(session.startedAt.getTime());
      expect(i.createdAt.getTime()).toBeLessThanOrEqual(session.lastActiveAt.getTime());
      if (previous && previous.sessionId === i.sessionId) expect(i.createdAt.getTime()).toBeGreaterThanOrEqual(previous.time);
      previous = { sessionId: i.sessionId, time: i.createdAt.getTime() };
    }
  });

  it("never shows a project again after a terminal interaction (dislike/build/complete)", () => {
    const terminalAt = new Map<string, number>();
    for (const i of dataset.interactions) {
      const key = `${i.userId}:${i.projectSlug}`;
      const terminalTime = terminalAt.get(key);
      if (i.type === "IMPRESSION" && terminalTime !== undefined) {
        expect(i.createdAt.getTime(), `impression after terminal state for ${key}`).toBeLessThanOrEqual(terminalTime);
      }
      if (TERMINAL.includes(i.type) && terminalTime === undefined) terminalAt.set(key, i.createdAt.getTime());
    }
  });

  it("encodes latent structure: saved projects have higher affinity than disliked or average ones", () => {
    const userById = new Map(dataset.users.map((u) => [u.id, u]));
    let savedSum = 0;
    let savedCount = 0;
    let dislikedSum = 0;
    let dislikedCount = 0;
    for (const i of dataset.interactions) {
      const affinity = projectAffinity(userById.get(i.userId)!, bySlug.get(i.projectSlug)!);
      if (i.type === "SAVE") {
        savedSum += affinity;
        savedCount++;
      } else if (i.type === "DISLIKE") {
        dislikedSum += affinity;
        dislikedCount++;
      }
    }
    const catalogMean =
      dataset.users.reduce((sum, u) => sum + PROJECTS.reduce((s, p) => s + projectAffinity(u, p), 0) / PROJECTS.length, 0) /
      dataset.users.length;
    expect(savedCount).toBeGreaterThan(50);
    expect(dislikedCount).toBeGreaterThan(20);
    expect(savedSum / savedCount).toBeGreaterThan(catalogMean + 0.1);
    expect(dislikedSum / dislikedCount).toBeLessThan(catalogMean);
  });

  it("gives users blended archetypes with strong, secondary and negative interests", () => {
    const users = buildSyntheticUsers();
    for (const user of users) {
      const values = Object.values(user.tagAffinities);
      expect(Math.max(...values)).toBeGreaterThan(0.5);
      expect(Math.min(...values)).toBeLessThan(0);
      expect(user.primaryArchetype).not.toBe(user.secondaryArchetype);
      expect(user.explorationPreference).toBeGreaterThanOrEqual(0.05);
      expect(user.explorationPreference).toBeLessThanOrEqual(0.9);
    }
    const activities = new Set(users.map((u) => u.activity));
    expect(activities.size).toBe(3);
  });

  it("resolves the seed anchor from the environment or the start of the UTC day", () => {
    expect(resolveSeedAnchor("2026-01-02T03:04:05.000Z").toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(resolveSeedAnchor(undefined, new Date("2026-08-18T15:30:00.000Z")).toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(() => resolveSeedAnchor("not-a-date")).toThrow();
  });
});
