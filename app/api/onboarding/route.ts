import { handleRouteError, parseJsonBody } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import {
  ONBOARDING_TOPIC_OPTIONS,
  completeOnboarding,
  getOnboardingState,
  loadOnboardingPairs,
} from "@/lib/onboarding/onboarding-service";
import { completeOnboardingSchema } from "@/lib/onboarding/schemas";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";

export const dynamic = "force-dynamic";

/** GET /api/onboarding — current state plus the questionnaire definition. */
export async function GET(): Promise<Response> {
  try {
    const user = await getOrCreateDemoUser();
    const [state, pairs] = await Promise.all([getOnboardingState(user.id), loadOnboardingPairs()]);
    return Response.json({
      state,
      topics: ONBOARDING_TOPIC_OPTIONS,
      topicLimits: { min: RECOMMENDER_CONFIG.onboarding.minTopics, max: RECOMMENDER_CONFIG.onboarding.maxTopics },
      pairs: pairs.map((pair) => ({
        index: pair.index,
        left: { id: pair.left.id, slug: pair.left.slug, title: pair.left.title, summary: pair.left.summary },
        right: { id: pair.right.id, slug: pair.right.slug, title: pair.right.title, summary: pair.right.summary },
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/onboarding — persist answers, mark onboarding complete. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = completeOnboardingSchema.parse(await parseJsonBody(request));
    const user = await getOrCreateDemoUser();
    await completeOnboarding(user.id, body);
    const state = await getOnboardingState(user.id);
    return Response.json({ state, redirectTo: "/discover" }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
