import Link from "next/link";

/** Small wordmark: a spiral glyph and the product name. */
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md text-foreground" aria-label="RabbitHole home">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-accent">
        <path
          d="M12 3a9 9 0 1 0 9 9c0-3.6-2.9-6.5-6.5-6.5A5 5 0 0 0 9.5 10.5 3.5 3.5 0 0 0 13 14a2 2 0 0 0 2-2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">RabbitHole</span>
    </Link>
  );
}
