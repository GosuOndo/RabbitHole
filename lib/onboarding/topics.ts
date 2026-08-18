/**
 * Onboarding topics ("What sounds interesting?").
 *
 * Topics are deliberately not a separate taxonomy: each one maps onto existing
 * catalog tags with weights in (0, 1], so a selection becomes ordinary
 * `tag:<slug>` profile features (scaled by RECOMMENDER_CONFIG.onboarding.topicSignal).
 */

import { featureId } from "@/lib/recommender/features";
import type { FeatureVector } from "@/lib/recommender/types";

export interface OnboardingTopic {
  key: string;
  label: string;
  /** Short hint shown under the label. */
  hint: string;
  /** Tag slug → mapping weight. */
  tags: Record<string, number>;
}

export const ONBOARDING_TOPICS: OnboardingTopic[] = [
  {
    key: "ai",
    label: "AI / Machine Learning",
    hint: "Models, embeddings, recommenders",
    tags: { "machine-learning": 1, nlp: 0.7, "computer-vision": 0.7, "recommendation-systems": 0.6 },
  },
  {
    key: "systems",
    label: "Systems",
    hint: "OS internals, memory, concurrency",
    tags: { systems: 1, "operating-systems": 0.8, concurrency: 0.6, emulation: 0.4 },
  },
  {
    key: "graphics",
    label: "Graphics",
    hint: "Rendering, shaders, WebGL",
    tags: { graphics: 1, webgl: 0.8, "procedural-generation": 0.5, visualization: 0.4 },
  },
  {
    key: "games",
    label: "Games",
    hint: "Engines, multiplayer, simulation",
    tags: { "game-development": 1, multiplayer: 0.7, simulation: 0.4, "procedural-generation": 0.4 },
  },
  {
    key: "web",
    label: "Web",
    hint: "Frontend, backend, full-stack",
    tags: { web: 1, frontend: 0.9, backend: 0.7 },
  },
  {
    key: "security",
    label: "Security",
    hint: "Crypto, hardening, defence",
    tags: { security: 1, cryptography: 0.8 },
  },
  {
    key: "data",
    label: "Data",
    hint: "Pipelines, search, analytics",
    tags: { "data-engineering": 1, "information-retrieval": 0.7, databases: 0.4, visualization: 0.4 },
  },
  {
    key: "mobile",
    label: "Mobile",
    hint: "iOS, Android, cross-platform",
    tags: { mobile: 1 },
  },
  {
    key: "hardware",
    label: "Hardware / IoT",
    hint: "Microcontrollers, sensors, firmware",
    tags: { iot: 1, embedded: 1 },
  },
  {
    key: "creative",
    label: "Creative Coding",
    hint: "Generative art, audio, play",
    tags: { "creative-coding": 1, "procedural-generation": 0.6, audio: 0.6, graphics: 0.4 },
  },
  {
    key: "devtools",
    label: "Developer Tools",
    hint: "CLIs, editors, build systems",
    tags: { devtools: 1, cli: 0.8, terminal: 0.6, compilers: 0.3 },
  },
  {
    key: "networking",
    label: "Networking",
    hint: "Protocols, servers, peer-to-peer",
    tags: { networking: 1, p2p: 0.6 },
  },
  {
    key: "databases",
    label: "Databases",
    hint: "Storage engines, query engines",
    tags: { databases: 1, "data-structures": 0.4 },
  },
  {
    key: "distributed",
    label: "Distributed Systems",
    hint: "Consensus, queues, replication",
    tags: { "distributed-systems": 1, backend: 0.4, concurrency: 0.3 },
  },
  {
    key: "languages",
    label: "Languages & Compilers",
    hint: "Interpreters, type systems, VMs",
    tags: { "programming-languages": 1, compilers: 1, algorithms: 0.3 },
  },
  {
    key: "algorithms",
    label: "Algorithms",
    hint: "Data structures, puzzles, search",
    tags: { algorithms: 1, "data-structures": 0.8 },
  },
];

export const ONBOARDING_TOPIC_KEYS = ONBOARDING_TOPICS.map((t) => t.key) as [string, ...string[]];

const TOPIC_BY_KEY = new Map(ONBOARDING_TOPICS.map((t) => [t.key, t]));

export function getOnboardingTopic(key: string): OnboardingTopic | undefined {
  return TOPIC_BY_KEY.get(key);
}

/** Feature vector for one topic: `tag:<slug>` → mapping weight. */
export function topicFeatureVector(topic: OnboardingTopic): FeatureVector {
  return Object.fromEntries(Object.entries(topic.tags).map(([slug, weight]) => [featureId("tag", slug), weight]));
}
