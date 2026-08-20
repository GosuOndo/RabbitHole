import { z } from "zod";
import { handleRouteError } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { getInsights, type InsightsData } from "@/lib/insights/insights-service";

export const dynamic = "force-dynamic";

export type InsightsResponse = InsightsData;

const querySchema = z.object({
  /** Inspect a specific stored run (must belong to the current user → 404 otherwise). */
  runId: z.string().trim().min(1).max(128).optional(),
});

/**
 * GET /api/insights[?runId=] — recommender transparency data: the live profile
 * (long-term + current-session + session focus), recent recommendation runs and
 * one selected run's immutable diagnostics. Strictly read-only: viewing
 * insights never records a run. The user is resolved server-side.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const user = await getOrCreateDemoUser();
    const insights: InsightsResponse = await getInsights(user.id, { runId: query.runId });
    return Response.json(insights);
  } catch (error) {
    return handleRouteError(error);
  }
}
