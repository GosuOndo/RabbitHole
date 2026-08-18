import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma client singleton.
 *
 * The client is created lazily on first use so that importing this module never
 * requires a database (e.g. during `next build`, which only collects route
 * config for dynamic pages), and so that a missing DATABASE_URL fails with a
 * clear, actionable message at the exact point database access is required.
 */

const globalForPrisma = globalThis as unknown as { __rabbitholePrisma?: PrismaClient };

export class DatabaseConfigurationError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Copy .env.example to .env and set DATABASE_URL to a PostgreSQL connection string " +
        "(e.g. postgresql://USER:PASSWORD@localhost:5432/rabbithole?schema=public).",
    );
    this.name = "DatabaseConfigurationError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseConfigurationError();
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** Returns the shared Prisma client, creating it on first call. */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__rabbitholePrisma) {
    globalForPrisma.__rabbitholePrisma = createPrismaClient();
  }
  return globalForPrisma.__rabbitholePrisma;
}

/**
 * Convenience proxy so call sites can write `prisma.project.findMany()` while
 * still getting lazy initialisation. Every property access is forwarded to the
 * real client.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
