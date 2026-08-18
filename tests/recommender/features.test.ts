import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { durationBucketForHours, featureId, parseFeatureId, projectFeatureVector } from "@/lib/recommender/features";

const W = RECOMMENDER_CONFIG.profile.featureFamilyWeights;

describe("projectFeatureVector", () => {
  it("gives every tag the full tag weight and splits the language weight", () => {
    const vector = projectFeatureVector({
      tagSlugs: ["systems", "networking"],
      languageSlugs: ["rust", "go"],
      difficulty: "INTERMEDIATE",
      estimatedHours: 12,
    });
    expect(vector["tag:systems"]).toBe(W.tag);
    expect(vector["tag:networking"]).toBe(W.tag);
    expect(vector["lang:rust"]).toBeCloseTo(W.language / 2, 10);
    expect(vector["lang:go"]).toBeCloseTo(W.language / 2, 10);
    expect(vector["difficulty:INTERMEDIATE"]).toBe(W.difficulty);
    expect(vector["duration:WEEKEND"]).toBe(W.duration);
    expect(Object.keys(vector)).toHaveLength(6);
  });

  it("omits language features for language-agnostic projects and de-duplicates tags", () => {
    const vector = projectFeatureVector({ tagSlugs: ["web", "web"], languageSlugs: [], difficulty: "BEGINNER", estimatedHours: 1 });
    expect(Object.keys(vector).filter((k) => k.startsWith("lang:"))).toHaveLength(0);
    expect(vector["tag:web"]).toBe(W.tag);
    expect(vector["duration:UNDER_2_HOURS"]).toBe(W.duration);
  });

  it("maps hours to duration buckets with inclusive upper bounds", () => {
    expect(durationBucketForHours(1)).toBe("UNDER_2_HOURS");
    expect(durationBucketForHours(2)).toBe("UNDER_2_HOURS");
    expect(durationBucketForHours(3)).toBe("ONE_EVENING");
    expect(durationBucketForHours(5)).toBe("ONE_EVENING");
    expect(durationBucketForHours(20)).toBe("WEEKEND");
    expect(durationBucketForHours(21)).toBe("ONE_TO_TWO_WEEKS");
    expect(durationBucketForHours(120)).toBe("ONE_TO_TWO_WEEKS");
  });

  it("round-trips feature ids", () => {
    expect(featureId("tag", "systems")).toBe("tag:systems");
    expect(featureId("language", "rust")).toBe("lang:rust");
    expect(parseFeatureId("lang:rust")).toEqual({ family: "language", key: "rust" });
    expect(parseFeatureId("duration:WEEKEND")).toEqual({ family: "duration", key: "WEEKEND" });
    expect(parseFeatureId("nonsense")).toBeNull();
    expect(parseFeatureId("unknown:x")).toBeNull();
  });
});
