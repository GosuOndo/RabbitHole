/**
 * "Which would you rather build?" pairs.
 *
 * Curated from the seeded catalog so that each pair contrasts two clearly
 * different domains (the two sides share no tags — enforced by tests) and the
 * six pairs together cover systems/data, graphics/creative, ML, games/web,
 * security, hardware, languages, distributed systems and mobile. Presented in a
 * fixed order so onboarding is deterministic and testable.
 */

export interface OnboardingPairDefinition {
  /** Catalog slugs of the two options. */
  left: string;
  right: string;
}

export const ONBOARDING_PAIRS: OnboardingPairDefinition[] = [
  { left: "implement-a-tiny-database", right: "generative-art-playground" },
  { left: "write-an-http-server", right: "implement-a-ray-tracer" },
  { left: "build-a-recommendation-engine", right: "multiplayer-drawing-game" },
  { left: "create-a-password-manager", right: "esp32-weather-station" },
  { left: "build-a-tiny-programming-language", right: "real-time-collaborative-editor" },
  { left: "implement-raft-consensus", right: "habit-tracker-mobile-app" },
];

export function pairSlugs(): string[] {
  return ONBOARDING_PAIRS.flatMap((pair) => [pair.left, pair.right]);
}
