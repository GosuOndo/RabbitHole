/**
 * Browser-side helper for POST /api/interactions. The client only ever sends
 * the project id, the interaction type and (optionally) dwell time; the server
 * resolves the user, the session and the weight.
 */

import type { InteractionType } from "@/generated/prisma/enums";

export interface PostInteractionResult {
  ok: boolean;
  status: number;
  message?: string;
}

export async function postInteraction(
  projectId: string,
  type: InteractionType,
  options: { dwellMs?: number; keepalive?: boolean } = {},
): Promise<PostInteractionResult> {
  try {
    const response = await fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, type, ...(options.dwellMs !== undefined ? { dwellMs: options.dwellMs } : {}) }),
      keepalive: options.keepalive ?? false,
    });
    if (response.ok) return { ok: true, status: response.status };
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, status: response.status, message: body?.error?.message ?? `Request failed (${response.status})` };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : "Network error" };
  }
}
