import type { ProfileFeatureView } from "@/lib/profile/profile-service";

/**
 * Horizontal bars for profile features. Values are signed strengths in [-1, 1];
 * positive bars use the accent colour, negative (dislike) bars the danger colour.
 * Numbers shown are relative strengths, not probabilities.
 */
export function ProfileBars({
  features,
  valueKey = "strength",
  emptyLabel = "Nothing yet.",
  tone = "accent",
}: {
  features: ProfileFeatureView[];
  valueKey?: "strength" | "familyStrength";
  emptyLabel?: string;
  tone?: "accent" | "danger" | "info";
}) {
  if (features.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  const barClass = tone === "danger" ? "bg-danger" : tone === "info" ? "bg-info" : "bg-accent";
  return (
    <ul className="flex flex-col gap-1.5">
      {features.map((feature) => {
        const value = feature[valueKey];
        const width = Math.round(Math.min(1, Math.abs(value)) * 100);
        return (
          <li key={feature.id} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate" title={feature.id}>
              {feature.label}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
              <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-muted">{value.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}
