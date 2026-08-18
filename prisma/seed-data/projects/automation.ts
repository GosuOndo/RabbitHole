import type { SeedProject } from "../types";

export const AUTOMATION_PROJECTS: SeedProject[] = [
  {
    slug: "deduplicating-backup-tool",
    title: "Build a deduplicating backup tool",
    summary: "Split files into content-defined chunks, store each chunk once, encrypt everything and restore any snapshot.",
    description:
      "Walk a directory tree, split each file into chunks with a rolling hash (content-defined chunking so an insert at the start of a file does not change every later chunk), hash each chunk, and store only chunks you have not seen before. A snapshot is then just a tree of file metadata pointing at chunk hashes. Backing up the same folder twice costs almost nothing, and restoring any snapshot is a matter of reassembling chunks.\n\nEncrypt chunks and metadata with a key derived from a passphrase, pack small chunks into larger blobs for storage efficiency, add a repository check that verifies every hash, and support a remote backend (SFTP or object storage). Prune snapshots and garbage-collect unreferenced chunks safely. Restic and Borg are the reference designs; building your own makes 'the backup worked' something you can prove.",
    difficulty: "INTERMEDIATE",
    estimatedHours: 12,
    popularity: 0.55,
    tags: ["automation", "systems", "cli", "cryptography"],
    languages: ["go", "rust", "python"],
    concepts: ["content-defined chunking", "content-addressed storage", "snapshot trees", "encryption at rest", "garbage collection of unreferenced data"],
    sourceUrl: "https://restic.net/",
  },
  {
    slug: "dotfiles-manager",
    title: "Build a dotfiles manager",
    summary: "Version your configuration files, template them per machine and bootstrap a fresh computer with one command.",
    description:
      "Keep your shell, editor and tool configs in a git repository and write a tool that installs them into place as symlinks or rendered copies, with templates so the same file can differ per machine (work vs personal, macOS vs Linux) and secrets that stay out of git. Add commands to add a file, diff installed files against the repo, and apply changes.\n\nThen make it a bootstrap tool: install packages via the system package manager, set OS defaults, and run it end-to-end in a fresh VM or container to prove a new machine can be ready in minutes. It is a small project with daily payoff and a nice excuse to learn templating, file system operations and idempotent scripting.",
    difficulty: "BEGINNER",
    estimatedHours: 3,
    popularity: 0.45,
    tags: ["automation", "cli", "devtools"],
    languages: ["go", "rust", "python", "typescript"],
    concepts: ["symlinks and file operations", "templating per machine", "secret handling", "idempotent scripts", "testing in a clean environment"],
    sourceUrl: "https://www.chezmoi.io/",
  },
  {
    slug: "screenshot-ocr-clipper",
    title: "Build a screenshot-to-text clipper",
    summary: "Capture a screen region with a hotkey, run OCR on it and put the recognised text on your clipboard.",
    description:
      "Register a global hotkey, let the user drag a rectangle over the screen, grab those pixels, run them through an OCR engine, and copy the text to the clipboard with a small notification. It sounds trivial and is genuinely useful dozens of times a day — text in images, videos and locked PDFs becomes copyable.\n\nThe details are where you learn: platform APIs for screen capture and hotkeys, pre-processing images (upscaling, thresholding) so OCR accuracy improves, handling multiple monitors and HiDPI, and a history window that keeps recent captures searchable. Add QR-code detection and translation as bonuses. Tesseract or the OS's built-in text recognition does the heavy lifting.",
    difficulty: "BEGINNER",
    estimatedHours: 4,
    popularity: 0.4,
    tags: ["automation", "computer-vision", "cli"],
    languages: ["python", "swift", "rust"],
    concepts: ["global hotkeys and screen capture", "image pre-processing for OCR", "OCR engine integration", "clipboard APIs", "HiDPI handling"],
    sourceUrl: "https://github.com/tesseract-ocr/tesseract",
  },
  {
    slug: "cron-expression-scheduler",
    title: "Build a cron expression parser and scheduler",
    summary: "Parse cron syntax, compute the next run times correctly across months and DST, and run jobs on time.",
    description:
      "Cron expressions are five fields of ranges, steps and lists, and computing 'the next time this matches' correctly is a surprisingly enjoyable puzzle: field-by-field search, month lengths, the day-of-month/day-of-week OR rule, and time zones with daylight-saving transitions that skip or repeat an hour. Write the parser, a next-run function with an exhaustive test suite, and a human-readable description generator ('every weekday at 09:30').\n\nThen build a small scheduler that runs registered jobs at their next times, survives restarts by persisting last-run timestamps, avoids overlapping runs, and exposes a status view. It is a two-hour core with a satisfying set of edge cases and daily utility.",
    difficulty: "BEGINNER",
    estimatedHours: 2,
    popularity: 0.5,
    tags: ["automation", "backend", "algorithms"],
    languages: ["typescript", "go", "rust", "java", "python"],
    concepts: ["cron syntax parsing", "next-occurrence algorithms", "time zones and DST", "persistent schedulers", "overlap prevention"],
  },
];
