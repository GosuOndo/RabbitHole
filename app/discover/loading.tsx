export default function DiscoverLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 flex flex-col gap-2">
        <div className="h-3 w-16 rounded bg-surface-raised" />
        <div className="h-7 w-72 rounded bg-surface-raised" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-raised" />
      </div>
      <p className="mb-4 text-sm text-muted">Learning your taste…</p>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="h-44 animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </ul>
    </div>
  );
}
