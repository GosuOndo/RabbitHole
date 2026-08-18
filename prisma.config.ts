// Prisma 7 CLI configuration. Environment variables are NOT loaded automatically
// by the Prisma CLI anymore, so `.env` is loaded explicitly here via dotenv.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma db seed` and `npm run seed` run the same deterministic script.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Left undefined when DATABASE_URL is missing so that `prisma generate` and
    // `prisma validate` still work; commands that need a database fail loudly.
    url: process.env["DATABASE_URL"],
  },
});
