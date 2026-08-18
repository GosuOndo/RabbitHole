"use client";

export interface InterestOption {
  key: string;
  label: string;
  hint?: string;
}

/**
 * Multi-select topic grid built from real buttons with aria-pressed so it is
 * fully keyboard operable (Tab to move, Space/Enter to toggle).
 */
export function InterestSelector({
  options,
  selected,
  onChange,
  min,
  max,
  labelledBy,
}: {
  options: InterestOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  min: number;
  max: number;
  labelledBy: string;
}) {
  const atMax = selected.length >= max;
  const toggle = (key: string) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else if (!atMax) onChange([...selected, key]);
  };
  return (
    <div>
      <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((option) => {
          const pressed = selected.includes(option.key);
          const disabled = !pressed && atMax;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => toggle(option.key)}
              className={`flex flex-col items-start gap-0.5 rounded-card border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                pressed
                  ? "border-accent bg-accent-soft/60 text-foreground"
                  : "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-raised"
              }`}
            >
              <span className="text-sm font-medium leading-tight">{option.label}</span>
              {option.hint ? <span className="text-xs text-muted">{option.hint}</span> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted" aria-live="polite">
        {selected.length} selected · choose {min}–{max}
        {atMax ? " (maximum reached)" : ""}
      </p>
    </div>
  );
}
