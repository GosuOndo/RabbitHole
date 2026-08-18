export default function DiscoverLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 flex flex-col gap-2">
        <div className="h-3 w-16 rounded bg-surface-raised" />
        <div className="h-7 w-72 rounded bg-surface-raised" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-raised" />
      </div>
      <p className="mb-4 text-sm text-muted">Loading the catalog…</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <li key={index} className="h-40 animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </ul>
    </div>
  );
}
