import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DatabaseSetupNotice } from "@/components/database-setup-notice";
import { PageHeader } from "@/components/page-header";
import { RecommendationFeed } from "@/components/recommendation-feed";
import { isDatabaseConfigured } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { getRecommendationFeed } from "@/lib/recommendations/recommendation-service";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/**
 * The personalised feed. Recommendations are computed server-side through the
 * recommender pipeline and handed to the client feed component, which records
 * impressions, sends feedback and refills from /api/recommendations.
 */
export default async function DiscoverPage() {
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />;
  }
  const user = await getOrCreateDemoUser();
  if (!user.onboardingCompleted) redirect("/onboarding");

  const feed = await getRecommendationFeed(user.id);

  return (
    <div>
      <PageHeader
        eyebrow="Discover"
        title="What should you build next?"
        description="Ranked by how well each project matches your taste profile. Scores are match scores, not probabilities — open “Why?” on any card to see the signals."
      />
      <RecommendationFeed initial={feed} />
    </div>
  );
}
