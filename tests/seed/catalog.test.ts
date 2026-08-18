import { describe, expect, it } from "vitest";
import { LANGUAGES, PROJECTS, TAGS, validateCatalog } from "@/prisma/seed-data/catalog";

describe("project catalog", () => {
  it("passes integrity validation", () => {
    expect(validateCatalog(PROJECTS)).toEqual([]);
  });

  it("meets the target sizes", () => {
    expect(PROJECTS.length).toBeGreaterThanOrEqual(150);
    expect(TAGS.length).toBeGreaterThanOrEqual(25);
    expect(TAGS.length).toBeLessThanOrEqual(40);
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(10);
    expect(LANGUAGES.length).toBeLessThanOrEqual(15);
  });

  it("covers every required domain", () => {
    const usedTags = new Set(PROJECTS.flatMap((p) => p.tags));
    const required = [
      "machine-learning",
      "systems",
      "graphics",
      "web",
      "mobile",
      "security",
      "data-engineering",
      "game-development",
      "devtools",
      "networking",
      "databases",
      "distributed-systems",
      "iot",
      "creative-coding",
      "automation",
      "algorithms",
      "compilers",
      "programming-languages",
      "information-retrieval",
      "recommendation-systems",
    ];
    for (const tag of required) expect(usedTags.has(tag), `missing domain tag ${tag}`).toBe(true);
  });

  it("spans all difficulties and duration buckets", () => {
    const difficulties = new Set(PROJECTS.map((p) => p.difficulty));
    expect(difficulties).toEqual(new Set(["BEGINNER", "INTERMEDIATE", "ADVANCED"]));
    expect(PROJECTS.some((p) => p.estimatedHours <= 2)).toBe(true);
    expect(PROJECTS.some((p) => p.estimatedHours > 2 && p.estimatedHours <= 5)).toBe(true);
    expect(PROJECTS.some((p) => p.estimatedHours > 5 && p.estimatedHours <= 20)).toBe(true);
    expect(PROJECTS.some((p) => p.estimatedHours > 20)).toBe(true);
  });

  it("validation reports problems for a broken entry", () => {
    const broken = [{ ...PROJECTS[0]!, slug: "Not Kebab", tags: ["nope"], popularity: 2, concepts: [] }];
    const problems = validateCatalog(broken);
    expect(problems.some((p) => p.includes("kebab"))).toBe(true);
    expect(problems.some((p) => p.includes('unknown tag "nope"'))).toBe(true);
    expect(problems.some((p) => p.includes("popularity"))).toBe(true);
    expect(problems.some((p) => p.includes("concepts"))).toBe(true);
  });
});
