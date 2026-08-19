import { describe, expect, it } from "vitest";
import { ProjectNotFoundError, createInteractionService } from "@/lib/interactions/interaction-service";
import { RECOMMENDER_CONFIG, interactionWeight } from "@/lib/recommender/config";
import { createSessionService } from "@/lib/sessions/session-service";
import { InMemoryInteractionRepository, InMemoryProjectLookup, InMemorySessionRepository } from "../helpers/in-memory-repositories";

const T0 = new Date("2026-08-18T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function setup() {
  const sessionRepository = new InMemorySessionRepository();
  const interactions = new InMemoryInteractionRepository();
  const sessions = createSessionService(sessionRepository, { timeoutMinutes: RECOMMENDER_CONFIG.session.timeoutMinutes });
  const service = createInteractionService({
    sessions,
    interactions,
    projects: new InMemoryProjectLookup(new Set(["project-1", "project-2"])),
  });
  return { service, sessionRepository, interactions };
}

describe("interactionService.record", () => {
  it("persists the interaction with the server-configured weight and a server-resolved session", async () => {
    const { service, interactions } = setup();
    const result = await service.record({ userId: "user-a", projectId: "project-1", type: "SAVE", now: T0 });
    expect(result.interaction.weight).toBe(interactionWeight("SAVE"));
    expect(result.interaction.weight).toBe(2);
    expect(result.interaction.sessionId).toBe(result.session.id);
    expect(result.sessionCreated).toBe(true);
    expect(interactions.interactions).toHaveLength(1);
  });

  it("ignores any client-supplied weight: the config table is authoritative", async () => {
    const { service } = setup();
    // The input type has no weight field; simulate a hostile caller anyway.
    const hostile = { userId: "user-a", projectId: "project-1", type: "DISLIKE" as const, weight: 999, now: T0 };
    const result = await service.record(hostile);
    expect(result.interaction.weight).toBe(interactionWeight("DISLIKE"));
    expect(result.interaction.weight).toBe(-3);
  });

  it("rejects interactions on projects that do not exist", async () => {
    const { service, interactions, sessionRepository } = setup();
    await expect(service.record({ userId: "user-a", projectId: "missing", type: "OPEN", now: T0 })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(interactions.interactions).toHaveLength(0);
    expect(sessionRepository.sessions).toHaveLength(0);
  });

  it("reuses the active session for consecutive interactions and touches lastActiveAt", async () => {
    const { service, sessionRepository } = setup();
    const first = await service.record({ userId: "user-a", projectId: "project-1", type: "OPEN", now: T0 });
    const second = await service.record({ userId: "user-a", projectId: "project-2", type: "SAVE", now: minutes(10) });
    expect(second.session.id).toBe(first.session.id);
    expect(second.sessionCreated).toBe(false);
    expect(sessionRepository.get(first.session.id)?.lastActiveAt).toEqual(minutes(10));
  });

  it("starts a new session after the inactivity timeout", async () => {
    const { service } = setup();
    const first = await service.record({ userId: "user-a", projectId: "project-1", type: "OPEN", now: T0 });
    const later = await service.record({ userId: "user-a", projectId: "project-1", type: "SAVE", now: minutes(RECOMMENDER_CONFIG.session.timeoutMinutes + 1) });
    expect(later.session.id).not.toBe(first.session.id);
    expect(later.sessionCreated).toBe(true);
  });

  it("stores dwell time when provided and null otherwise", async () => {
    const { service } = setup();
    const withDwell = await service.record({ userId: "user-a", projectId: "project-1", type: "OPEN", dwellMs: 12_000, now: T0 });
    const withoutDwell = await service.record({ userId: "user-a", projectId: "project-1", type: "IMPRESSION", now: T0 });
    expect(withDwell.interaction.dwellMs).toBe(12_000);
    expect(withoutDwell.interaction.dwellMs).toBeNull();
    expect(withoutDwell.interaction.weight).toBe(0);
  });
});

describe("interactions after a manual new session (Phase 6)", () => {
  it("keep previous interactions intact and attach new ones to the new session", async () => {
    const { service, sessionRepository, interactions } = setup();
    const sessions = createSessionService(sessionRepository, { timeoutMinutes: RECOMMENDER_CONFIG.session.timeoutMinutes });
    const before = await service.record({ userId: "user-a", projectId: "project-1", type: "SAVE", now: T0 });
    const fresh = await sessions.startNew("user-a", minutes(2));
    const after = await service.record({ userId: "user-a", projectId: "project-2", type: "OPEN", now: minutes(3) });
    expect(after.session.id).toBe(fresh.id);
    expect(after.interaction.sessionId).toBe(fresh.id);
    expect(after.interaction.sessionId).not.toBe(before.interaction.sessionId);
    expect(interactions.interactions).toHaveLength(2);
    expect(interactions.interactions[0]!.sessionId).toBe(before.session.id); // history untouched
    expect(sessionRepository.get(before.session.id)?.endedAt).toEqual(minutes(2));
  });
});
