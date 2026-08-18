import { LANGUAGES } from "./languages";
import { ALGORITHM_PROJECTS } from "./projects/algorithms";
import { AUDIO_PROJECTS } from "./projects/audio";
import { AUTOMATION_PROJECTS } from "./projects/automation";
import { DATABASE_PROJECTS } from "./projects/databases";
import { DATA_PROJECTS } from "./projects/data";
import { DEVTOOLS_PROJECTS } from "./projects/devtools";
import { DISTRIBUTED_PROJECTS } from "./projects/distributed";
import { EMULATION_PROJECTS } from "./projects/emulation";
import { GAME_PROJECTS } from "./projects/games";
import { GRAPHICS_PROJECTS } from "./projects/graphics";
import { ML_PROJECTS } from "./projects/ml";
import { MOBILE_IOT_PROJECTS } from "./projects/mobile-iot";
import { NETWORKING_PROJECTS } from "./projects/networking";
import { SECURITY_PROJECTS } from "./projects/security";
import { SYSTEMS_PROJECTS } from "./projects/systems";
import { WEB_PROJECTS } from "./projects/web";
import { TAGS } from "./tags";
import type { SeedProject } from "./types";

export { LANGUAGES, TAGS };

/** The complete hand-authored project catalog. */
export const PROJECTS: SeedProject[] = [
  ...SYSTEMS_PROJECTS,
  ...DATABASE_PROJECTS,
  ...NETWORKING_PROJECTS,
  ...DISTRIBUTED_PROJECTS,
  ...WEB_PROJECTS,
  ...GRAPHICS_PROJECTS,
  ...GAME_PROJECTS,
  ...ML_PROJECTS,
  ...DEVTOOLS_PROJECTS,
  ...SECURITY_PROJECTS,
  ...DATA_PROJECTS,
  ...MOBILE_IOT_PROJECTS,
  ...AUDIO_PROJECTS,
  ...AUTOMATION_PROJECTS,
  ...ALGORITHM_PROJECTS,
  ...EMULATION_PROJECTS,
];

/**
 * Validates catalog integrity. Returns a list of human-readable problems;
 * an empty list means the catalog is consistent. Used by the seed script (which
 * refuses to run with a broken catalog) and by unit tests.
 */
export function validateCatalog(projects: readonly SeedProject[] = PROJECTS): string[] {
  const problems: string[] = [];
  const tagSlugs = new Set(TAGS.map((t) => t.slug));
  const languageSlugs = new Set(LANGUAGES.map((l) => l.slug));
  const seenSlugs = new Set<string>();
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  for (const project of projects) {
    const where = `project "${project.slug}"`;
    if (!slugPattern.test(project.slug)) problems.push(`${where}: slug is not kebab-case`);
    if (seenSlugs.has(project.slug)) problems.push(`${where}: duplicate slug`);
    seenSlugs.add(project.slug);

    if (project.title.trim().length < 5) problems.push(`${where}: title too short`);
    if (project.summary.trim().length < 30) problems.push(`${where}: summary too short`);
    if (project.description.trim().length < 300) problems.push(`${where}: description too short`);
    if (!Number.isInteger(project.estimatedHours) || project.estimatedHours < 1 || project.estimatedHours > 200) {
      problems.push(`${where}: estimatedHours must be an integer in [1, 200]`);
    }
    if (!(project.popularity >= 0 && project.popularity <= 1)) problems.push(`${where}: popularity must be in [0, 1]`);
    if (project.tags.length < 1 || project.tags.length > 5) problems.push(`${where}: expected 1–5 tags`);
    if (new Set(project.tags).size !== project.tags.length) problems.push(`${where}: duplicate tags`);
    for (const tag of project.tags) if (!tagSlugs.has(tag)) problems.push(`${where}: unknown tag "${tag}"`);
    if (new Set(project.languages).size !== project.languages.length) problems.push(`${where}: duplicate languages`);
    for (const lang of project.languages) if (!languageSlugs.has(lang)) problems.push(`${where}: unknown language "${lang}"`);
    if (project.concepts.length < 3) problems.push(`${where}: expected at least 3 concepts`);
    if (project.sourceUrl !== undefined && !/^https?:\/\//.test(project.sourceUrl)) {
      problems.push(`${where}: sourceUrl must be http(s)`);
    }
  }

  const tagSlugList = TAGS.map((t) => t.slug);
  if (new Set(tagSlugList).size !== tagSlugList.length) problems.push("duplicate tag slugs");
  const languageSlugList = LANGUAGES.map((l) => l.slug);
  if (new Set(languageSlugList).size !== languageSlugList.length) problems.push("duplicate language slugs");

  const usedTags = new Set(projects.flatMap((p) => p.tags));
  for (const tag of tagSlugList) if (!usedTags.has(tag)) problems.push(`tag "${tag}" is not used by any project`);
  const usedLanguages = new Set(projects.flatMap((p) => p.languages));
  for (const lang of languageSlugList) if (!usedLanguages.has(lang)) problems.push(`language "${lang}" is not used by any project`);

  return problems;
}
