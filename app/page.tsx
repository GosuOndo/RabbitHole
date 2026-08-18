import { redirect } from "next/navigation";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";

// The home route depends on the demo user's onboarding state, so it is always
// rendered at request time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const user = await getOrCreateDemoUser();
  redirect(user.onboardingCompleted ? "/discover" : "/onboarding");
}
