import type { Difficulty } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/** Card-level project shape with tags and languages resolved. */
export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  estimatedHours: number;
  popularity: number;
  tags: { slug: string; name: string }[];
  languages: { slug: string; name: string }[];
}

/** Detail-page shape. */
export interface ProjectDetail extends ProjectSummary {
  description: string;
  concepts: string[];
  sourceUrl: string | null;
}

const projectInclude = {
  tags: { include: { tag: { select: { slug: true, name: true } } } },
  languages: { include: { language: { select: { slug: true, name: true } } } },
} as const;

type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  difficulty: Difficulty;
  estimatedHours: number;
  popularity: number;
  concepts: string[];
  sourceUrl: string | null;
  tags: { tag: { slug: string; name: string } }[];
  languages: { language: { slug: string; name: string } }[];
};

function toDetail(row: ProjectRow): ProjectDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    difficulty: row.difficulty,
    estimatedHours: row.estimatedHours,
    popularity: row.popularity,
    concepts: row.concepts,
    sourceUrl: row.sourceUrl,
    tags: row.tags.map((t) => t.tag),
    languages: row.languages.map((l) => l.language),
  };
}

/** All projects with relations in one query (no N+1), most popular first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await prisma.project.findMany({
    include: projectInclude,
    orderBy: [{ popularity: "desc" }, { title: "asc" }],
  });
  return rows.map(toDetail);
}

export async function getProjectBySlug(slug: string): Promise<ProjectDetail | null> {
  const row = await prisma.project.findUnique({ where: { slug }, include: projectInclude });
  return row ? toDetail(row) : null;
}

export interface CatalogStats {
  projects: number;
  tags: number;
  languages: number;
  syntheticUsers: number;
  interactions: number;
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const [projects, tags, languages, syntheticUsers, interactions] = await Promise.all([
    prisma.project.count(),
    prisma.tag.count(),
    prisma.language.count(),
    prisma.user.count({ where: { isSynthetic: true } }),
    prisma.interaction.count(),
  ]);
  return { projects, tags, languages, syntheticUsers, interactions };
}
