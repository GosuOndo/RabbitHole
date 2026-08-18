/**
 * Shapes of the hand-authored catalog used by the seed script and catalog tests.
 * Slugs (not database ids) are used for references so the data stays readable.
 */

export type SeedDifficulty = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

export interface SeedTag {
  slug: string;
  name: string;
}

export interface SeedLanguage {
  slug: string;
  name: string;
}

export interface SeedProject {
  slug: string;
  title: string;
  /** One-sentence pitch shown on cards. */
  summary: string;
  /** Multi-paragraph description (paragraphs separated by blank lines). */
  description: string;
  difficulty: SeedDifficulty;
  /** Rough time to a satisfying first version. */
  estimatedHours: number;
  /** Deterministic popularity prior in [0, 1] (how well-known / commonly built). */
  popularity: number;
  /** Tag slugs, most defining first. */
  tags: string[];
  /** Suggested language slugs (may be empty). */
  languages: string[];
  /** Concepts / skills practised ("What you'll learn"). */
  concepts: string[];
  /** Optional canonical reference (spec, tutorial, paper). */
  sourceUrl?: string;
}
