import { handleRouteError } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { sessionService } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export interface SessionResponse {
  session: { id: string; startedAt: string; lastActiveAt: string; endedAt: string | null } | null;
  timeoutMinutes: number;
}

function toView(session: { id: string; startedAt: Date; lastActiveAt: Date; endedAt: Date | null } | null) {
  return session
    ? {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      }
    : null;
}

/** GET /api/sessions — the currently active session (if any). Never creates one. */
export async function GET(): Promise<Response> {
  try {
    const user = await getOrCreateDemoUser();
    const session = await sessionService.getActive(user.id);
    const response: SessionResponse = { session: toView(session), timeoutMinutes: sessionService.timeoutMinutes };
    return Response.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/sessions — "Start new session": ends the current session and opens a fresh one. */
export async function POST(): Promise<Response> {
  try {
    const user = await getOrCreateDemoUser();
    const session = await sessionService.startNew(user.id);
    const response: SessionResponse = { session: toView(session), timeoutMinutes: sessionService.timeoutMinutes };
    return Response.json(response, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
