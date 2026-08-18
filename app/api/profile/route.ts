import { handleRouteError, parseJsonBody } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { updateProfileSchema } from "@/lib/interactions/schemas";
import { getUserProfileSnapshot, type UserProfileSnapshot } from "@/lib/profile/profile-service";
import { updateUserSettings } from "@/lib/profile/settings-service";

export const dynamic = "force-dynamic";

export type ProfileResponse = UserProfileSnapshot;

/** GET /api/profile — onboarding state, exploration preference, long-term and session profiles, statistics. */
export async function GET(): Promise<Response> {
  try {
    const user = await getOrCreateDemoUser();
    const snapshot = await getUserProfileSnapshot(user.id);
    return Response.json(snapshot satisfies ProfileResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH /api/profile — update supported settings (currently `explorationPreference` in [0, 1]). */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = updateProfileSchema.parse(await parseJsonBody(request));
    const user = await getOrCreateDemoUser();
    const updated = await updateUserSettings(user.id, body);
    return Response.json({ user: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
