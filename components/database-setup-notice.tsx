/**
 * Shown instead of page content when DATABASE_URL is missing. RabbitHole never
 * silently falls back to another database; it tells you exactly what to set.
 */
export function DatabaseSetupNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-card border border-warning/40 bg-warning-soft/40 p-6">
      <h1 className="text-lg font-semibold">Database not configured</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        RabbitHole needs a PostgreSQL connection. Copy <code className="font-mono text-foreground">.env.example</code> to{" "}
        <code className="font-mono text-foreground">.env</code> and set <code className="font-mono text-foreground">DATABASE_URL</code>, then run
        the migrations and seed:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
        {`DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/rabbithole?schema=public"

npm run db:migrate
npm run seed`}
      </pre>
      <p className="mt-3 text-xs text-subtle">Restart the dev server after editing .env.</p>
    </div>
  );
}
