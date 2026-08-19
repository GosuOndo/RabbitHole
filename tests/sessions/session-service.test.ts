import { describe, expect, it } from "vitest";
import { createSessionService, isSessionActive } from "@/lib/sessions/session-service";
import { InMemorySessionRepository } from "../helpers/in-memory-repositories";

const T0 = new Date("2026-08-18T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function setup(timeoutMinutes = 30) {
  const repository = new InMemorySessionRepository();
  const service = createSessionService(repository, { timeoutMinutes });
  return { repository, service };
}

describe("isSessionActive", () => {
  it("is active within the timeout, inactive after it, and never active once ended", () => {
    const session = { lastActiveAt: T0, endedAt: null };
    expect(isSessionActive(session, minutes(0), 30)).toBe(true);
    expect(isSessionActive(session, minutes(30), 30)).toBe(true);
    expect(isSessionActive(session, minutes(31), 30)).toBe(false);
    expect(isSessionActive({ lastActiveAt: T0, endedAt: minutes(1) }, minutes(2), 30)).toBe(false);
  });
});

describe("sessionService.resolveActive", () => {
  it("creates a session when the user has none", async () => {
    const { service, repository } = setup();
    const { session, created } = await service.resolveActive("user-a", T0);
    expect(created).toBe(true);
    expect(session.userId).toBe("user-a");
    expect(session.startedAt).toEqual(T0);
    expect(repository.sessions).toHaveLength(1);
  });

  it("reuses the active session", async () => {
    const { service, repository } = setup();
    const first = await service.resolveActive("user-a", T0);
    await service.touch(first.session.id, minutes(10));
    const second = await service.resolveActive("user-a", minutes(25));
    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect(repository.sessions).toHaveLength(1);
  });

  it("replaces an expired session and closes the stale one at its last activity", async () => {
    const { service, repository } = setup();
    const first = await service.resolveActive("user-a", T0);
    await service.touch(first.session.id, minutes(5));
    const later = await service.resolveActive("user-a", minutes(36));
    expect(later.created).toBe(true);
    expect(later.session.id).not.toBe(first.session.id);
    expect(repository.get(first.session.id)?.endedAt).toEqual(minutes(5));
    expect(repository.sessions).toHaveLength(2);
  });

  it("never reuses another user's session", async () => {
    const { service } = setup();
    const a = await service.resolveActive("user-a", T0);
    const b = await service.resolveActive("user-b", minutes(1));
    expect(b.created).toBe(true);
    expect(b.session.id).not.toBe(a.session.id);
    expect(b.session.userId).toBe("user-b");
    const aAgain = await service.resolveActive("user-a", minutes(2));
    expect(aAgain.session.id).toBe(a.session.id);
  });
});

describe("sessionService.getActive", () => {
  it("returns null without creating when nothing is active", async () => {
    const { service, repository } = setup();
    expect(await service.getActive("user-a", T0)).toBeNull();
    expect(repository.sessions).toHaveLength(0);
    const { session } = await service.resolveActive("user-a", T0);
    expect((await service.getActive("user-a", minutes(10)))?.id).toBe(session.id);
    expect(await service.getActive("user-a", minutes(60))).toBeNull();
    expect(repository.sessions).toHaveLength(1);
  });
});

describe("sessionService.startNew", () => {
  it("ends the current session at 'now' and opens a fresh one", async () => {
    const { service, repository } = setup();
    const first = await service.resolveActive("user-a", T0);
    const fresh = await service.startNew("user-a", minutes(3));
    expect(fresh.id).not.toBe(first.session.id);
    expect(repository.get(first.session.id)?.endedAt).toEqual(minutes(3));
    const active = await service.getActive("user-a", minutes(4));
    expect(active?.id).toBe(fresh.id);
  });

  it("works when there is no current session", async () => {
    const { service } = setup();
    const fresh = await service.startNew("user-a", T0);
    expect(fresh.userId).toBe("user-a");
    expect(fresh.endedAt).toBeNull();
  });
});

describe("sessionService.touch", () => {
  it("moves lastActiveAt forward only", async () => {
    const { service, repository } = setup();
    const { session } = await service.resolveActive("user-a", T0);
    await service.touch(session.id, minutes(10));
    await service.touch(session.id, minutes(4));
    expect(repository.get(session.id)?.lastActiveAt).toEqual(minutes(10));
  });
});

describe("manual new session vs automatic expiry (Phase 6)", () => {
  it("manual new session: new session for the same user, old one becomes historical, next activity resolves to the new one", async () => {
    const { service, repository } = setup();
    const first = (await service.resolveActive("user-a", T0)).session;
    await service.touch(first.id, minutes(5));
    const fresh = await service.startNew("user-a", minutes(6));
    expect(fresh.userId).toBe("user-a");
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.startedAt).toEqual(minutes(6));
    expect(fresh.endedAt).toBeNull();
    // The previous session is closed but kept (history is never deleted).
    expect(repository.get(first.id)).toBeDefined();
    expect(repository.get(first.id)?.endedAt).toEqual(minutes(6));
    expect(repository.sessions.filter((s) => s.userId === "user-a")).toHaveLength(2);
    // Subsequent activity belongs to the new session, not the old one.
    const resolved = await service.resolveActive("user-a", minutes(7));
    expect(resolved.created).toBe(false);
    expect(resolved.session.id).toBe(fresh.id);
    // Another user's session is untouched.
    const other = (await service.resolveActive("user-b", T0)).session;
    await service.startNew("user-a", minutes(8));
    expect(repository.get(other.id)?.endedAt).toBeNull();
  });

  it("automatic expiry: within the threshold the same session, beyond it a new one; a recently created manual session keeps being used", async () => {
    const { service } = setup(30);
    const first = (await service.resolveActive("user-a", T0)).session;
    expect((await service.resolveActive("user-a", minutes(29))).session.id).toBe(first.id);
    expect((await service.resolveActive("user-a", minutes(30))).session.id).toBe(first.id);
    await service.touch(first.id, minutes(30));
    // 31 minutes after the last activity → expired → new session.
    const later = await service.resolveActive("user-a", minutes(61));
    expect(later.created).toBe(true);
    expect(later.session.id).not.toBe(first.id);
    expect(await service.getActive("user-a", minutes(61))).toMatchObject({ id: later.session.id });
    // Manual new session created recently: the resolver keeps using it until its own timeout elapses.
    const manual = await service.startNew("user-a", minutes(62));
    expect((await service.resolveActive("user-a", minutes(80))).session.id).toBe(manual.id);
    expect((await service.resolveActive("user-a", minutes(92))).session.id).toBe(manual.id); // 30 min after creation still active
    expect((await service.resolveActive("user-a", minutes(93))).session.id).not.toBe(manual.id);
    // No wall-clock dependence: everything above used injected timestamps.
    expect(await service.getActive("user-a", minutes(200))).not.toMatchObject({ id: manual.id });
  });
});
