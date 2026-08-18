"use client";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Single-select list of cards backed by native radio inputs, so arrow-key
 * navigation and screen-reader semantics come for free.
 */
export function OptionGroup<T extends string>({
  name,
  options,
  value,
  onChange,
  labelledBy,
}: {
  name: string;
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  labelledBy: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const checked = value === option.value;
        const id = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={`flex cursor-pointer items-start gap-3 rounded-card border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2 ${
              checked ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised"
            }`}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="mt-1 h-3.5 w-3.5 accent-[var(--accent)] outline-none"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">{option.label}</span>
              {option.hint ? <span className="text-xs text-muted">{option.hint}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
