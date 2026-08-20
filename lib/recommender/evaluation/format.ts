/**
 * CLI presentation of an EvaluationReport (display only — no metric formulas,
 * no recomputation). All numbers arrive pre-calculated from the runner.
 */

import type { EvaluationReport } from "./types";

const METRIC_COLUMNS: { header: string; value: (row: EvaluationReport["algorithms"][number]) => number }[] = [
  { header: "P@5", value: (row) => row.precisionAt5 },
  { header: "P@10", value: (row) => row.precisionAt10 },
  { header: "R@5", value: (row) => row.recallAt5 },
  { header: "R@10", value: (row) => row.recallAt10 },
  { header: "NDCG@10", value: (row) => row.ndcgAt10 },
  { header: "Hit@10", value: (row) => row.hitRateAt10 },
  { header: "Coverage", value: (row) => row.coverage },
  { header: "Diversity", value: (row) => row.diversity },
  { header: "Novelty", value: (row) => row.novelty },
];

function fixed(value: number): string {
  return value.toFixed(3);
}

export function formatReport(report: EvaluationReport, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const rule = "─".repeat(60);
  lines.push("RabbitHole Offline Evaluation", rule);
  const header: [string, string][] = [
    ["projects", String(report.dataset.projects)],
    ["interactions", String(report.dataset.interactions)],
    ["users considered", String(report.dataset.usersConsidered)],
    ["users evaluated", String(report.dataset.usersEvaluated)],
    ["users skipped", String(report.dataset.usersSkipped)],
    ["avg held-out items", report.dataset.avgHeldOut.toFixed(2)],
    ["avg training interactions", report.dataset.avgTrainingInteractions.toFixed(1)],
    ["evaluation protocol", report.protocol],
    ["random/fingerprint seed", String(report.seed)],
    ["split fingerprint", report.fingerprint],
  ];
  for (const [label, value] of header) lines.push(`${label.padEnd(26)}${value}`);
  const skipEntries = Object.entries(report.dataset.skipReasons);
  if (skipEntries.length > 0) {
    lines.push("", "skipped users by reason:");
    for (const [reason, count] of skipEntries.sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${reason.padEnd(42)}${count}`);
    }
  }

  // Comparison table (macro-averaged ranking metrics; coverage is global).
  const labelWidth = Math.max("Algorithm".length, ...report.algorithms.map((row) => row.label.length)) + 2;
  const columnWidth = 10;
  lines.push("", "Algorithm".padEnd(labelWidth) + METRIC_COLUMNS.map((column) => column.header.padStart(columnWidth)).join(""));
  lines.push("-".repeat(labelWidth + columnWidth * METRIC_COLUMNS.length));
  for (const row of report.algorithms) {
    lines.push(row.label.padEnd(labelWidth) + METRIC_COLUMNS.map((column) => fixed(column.value(row)).padStart(columnWidth)).join(""));
  }
  lines.push("", "P/R/NDCG/Hit are macro-averaged over evaluated users; Coverage counts unique top-10", "recommendations across users over the full catalogue; Diversity/Novelty are macro-averaged", "top-10 list metrics (content-vector dissimilarity / training-popularity novelty).");

  if (options.verbose) {
    const slug = (projectId: string) => report.projectSlugs[projectId] ?? projectId;
    lines.push("", rule, "Per-user detail (verbose)", rule);
    for (const entry of report.cases) {
      lines.push("", `${entry.handle}  cutoff=${entry.cutoff}  universe=${entry.universeSize}`, `  held-out: ${entry.heldOut.map(slug).join(", ")}`);
      for (const row of report.algorithms) {
        const detail = report.details[row.algorithm].find((candidate) => candidate.userId === entry.userId);
        if (!detail) continue;
        const marked = detail.recommended.map((projectId) => (detail.hits.includes(projectId) ? `*${slug(projectId)}` : slug(projectId)));
        lines.push(`  ${row.label.padEnd(36)} hits=${detail.hits.length}  [${marked.join(", ")}]`);
      }
    }
  }
  return lines.join("\n");
}
