import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { getRecommendationFeed, type RecommendationFeed } from "@/lib/recommendations/recommendation-service";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export const dynamic = "force-dynamic";

export type RecommendationsResponse = RecommendationFeed;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(RECOMMENDER_CONFIG.feed.maxLimit).default(RECOMMENDER_CONFIG.feed.defaultLimit),
});

/**
 * GET /api/recommendations?limit=10 — personalised recommendations for the demo
 * user. Requires completed onboarding (409 otherwise). `limit` is validated and
 * capped at RECOMMENDER_CONFIG.feed.maxLimit.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined });
    const user = await getOrCreateDemoUser();
    if (!user.onboardingCompleted) {
      return jsonError(409, "onboarding_required", "Complete onboarding before requesting recommendations (see /onboarding).");
    }
    const feed = await getRecommendationFeed(user.id, { limit: query.limit });
    return Response.json(feed satisfies RecommendationsResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}
