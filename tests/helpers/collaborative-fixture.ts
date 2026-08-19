import type { InteractionType } from "@/generated/prisma/enums";
import type { CollaborativeInteraction } from "@/lib/recommender/types";

const T0 = new Date("2026-08-01T00:00:00.000Z");
let clock = 0;

/** Interaction row; each call is one minute later than the previous so ordering is explicit. */
export function ev(userId: string, projectId: string, type: InteractionType, minutes?: number): CollaborativeInteraction {
  clock += 1;
  return { userId, projectId, type, createdAt: new Date(T0.getTime() + (minutes ?? clock) * 60_000) };
}

/** Two behavioural clusters over real catalog slugs (fixture ids = slugs). */
export const SYSTEMS_CLUSTER = ["build-your-own-redis", "write-an-http-server", "implement-a-dns-resolver", "implement-a-tiny-database"];
export const GRAPHICS_CLUSTER = ["implement-a-ray-tracer", "webgl-fluid-simulation", "live-shader-playground", "procedural-terrain-generator"];

/**
 * Five users who like everything in the systems cluster, five who like the
 * graphics cluster, plus one weak cross-cluster OPEN as noise.
 */
export function clusterInteractions(): CollaborativeInteraction[] {
  const rows: CollaborativeInteraction[] = [];
  for (let u = 1; u <= 5; u++) {
    for (const slug of SYSTEMS_CLUSTER) rows.push(ev(`sys-${u}`, slug, u % 2 === 0 ? "BUILD" : "SAVE"));
  }
  for (let u = 1; u <= 5; u++) {
    for (const slug of GRAPHICS_CLUSTER) rows.push(ev(`gfx-${u}`, slug, u % 2 === 0 ? "COMPLETE" : "SAVE"));
  }
  rows.push(ev("gfx-1", "build-your-own-redis", "OPEN"));
  return rows;
}
