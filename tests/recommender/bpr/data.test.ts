import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { buildBprDataset } from "@/lib/recommender/bpr/data";
import type { BprInteraction } from "@/lib/recommender/bpr/types";

const CATALOG = ["A", "B", "C", "D", "E", "F", "G", "H"];
const T0 = new Date("2026-06-01T00:00:00.000Z");
const ev = (userId: string, projectId: string, type: BprInteraction["type"], minutes: number): BprInteraction => ({
  userId,
  projectId,
  type,
  createdAt: new Date(T0.getTime() + minutes * 60_000),
});

const project = (dataset: ReturnType<typeof buildBprDataset>, id: string) => dataset.projectIds.indexOf(id);
const userRow = (dataset: ReturnType<typeof buildBprDataset>, userId: string) => dataset.userIds.indexOf(userId);

describe("buildBprDataset", () => {
  it("extracts project-level strong positives (SAVE/BUILD/COMPLETE/SHARE) with repeated events deduplicated", () => {
    const dataset = buildBprDataset(
      [
        ev("u1", "A", "SAVE", 1),
        ev("u1", "A", "SAVE", 2),
        ev("u1", "A", "BUILD", 3),
        ev("u1", "A", "COMPLETE", 4),
        ev("u1", "B", "SHARE", 5),
        ev("u1", "C", "BUILD", 6),
      ],
      CATALOG,
    );
    const u = userRow(dataset, "u1");
    expect(dataset.positives[u]).toEqual([project(dataset, "A"), project(dataset, "B"), project(dataset, "C")]);
    expect(dataset.positiveCount).toBe(3); // four events on A are ONE positive project
  });

  it("treats DISLIKE as explicit negative, never positive, using current-state semantics", () => {
    const dataset = buildBprDataset(
      [ev("u1", "A", "SAVE", 1), ev("u1", "B", "SAVE", 2), ev("u1", "B", "DISLIKE", 3), ev("u1", "C", "DISLIKE", 4)],
      CATALOG,
    );
    const u = userRow(dataset, "u1");
    expect(dataset.positives[u]).toEqual([project(dataset, "A")]);
    expect(dataset.explicitNegatives[u]).toEqual([project(dataset, "B"), project(dataset, "C")].sort((a, b) => a - b));
    expect(dataset.explicitNegativeCount).toBe(2);
  });

  it("IMPRESSION and OPEN are neither positive nor negative, and leave the unobserved pool (known-neutral)", () => {
    const dataset = buildBprDataset(
      [ev("u1", "A", "SAVE", 1), ev("u1", "B", "IMPRESSION", 2), ev("u1", "C", "OPEN", 3)],
      CATALOG,
    );
    const u = userRow(dataset, "u1");
    expect(dataset.positives[u]).toEqual([project(dataset, "A")]);
    expect(dataset.explicitNegatives[u]).toEqual([]);
    const unobserved = dataset.unobserved[u]!;
    expect(unobserved).not.toContain(project(dataset, "A"));
    expect(unobserved).not.toContain(project(dataset, "B")); // impressed → known but uncertain
    expect(unobserved).not.toContain(project(dataset, "C")); // opened → known but uncertain
    expect(unobserved).toEqual([project(dataset, "D"), project(dataset, "E"), project(dataset, "F"), project(dataset, "G"), project(dataset, "H")]);
  });

  it("UNSAVE reverses a positive but does not become an explicit negative", () => {
    const dataset = buildBprDataset(
      [ev("u1", "A", "SAVE", 1), ev("u1", "A", "UNSAVE", 2), ev("u1", "B", "SAVE", 3)],
      CATALOG,
    );
    const u = userRow(dataset, "u1");
    expect(dataset.positives[u]).toEqual([project(dataset, "B")]);
    expect(dataset.explicitNegatives[u]).toEqual([]);
    expect(dataset.unobserved[u]).not.toContain(project(dataset, "A")); // touched → not "unobserved" either
  });

  it("keeps only users with at least one positive and uses sorted deterministic index mappings", () => {
    const rows = [ev("zeta", "B", "SAVE", 1), ev("alpha", "A", "SAVE", 2), ev("mid", "C", "IMPRESSION", 3)];
    const dataset = buildBprDataset(rows, ["C", "A", "B"]);
    expect(dataset.userIds).toEqual(["alpha", "zeta"]); // sorted; impression-only user dropped
    expect(dataset.projectIds).toEqual(["A", "B", "C"]); // sorted regardless of input order
    const again = buildBprDataset([...rows].reverse(), ["B", "C", "A"]);
    expect(again.userIds).toEqual(dataset.userIds);
    expect(again.projectIds).toEqual(dataset.projectIds);
    expect(again.fingerprint).toBe(dataset.fingerprint);
  });

  it("fingerprint is deterministic, changes with data, and ignores nothing relevant", () => {
    const base = [ev("u1", "A", "SAVE", 1), ev("u1", "B", "DISLIKE", 2)];
    const a = buildBprDataset(base, CATALOG);
    const b = buildBprDataset(base, CATALOG);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(/^[0-9a-f]{8}$/.test(a.fingerprint)).toBe(true);
    const moreData = buildBprDataset([...base, ev("u1", "C", "SAVE", 3)], CATALOG);
    expect(moreData.fingerprint).not.toBe(a.fingerprint);
    const otherConfig = buildBprDataset(base, CATALOG, { ...RECOMMENDER_CONFIG.bpr, seed: 999 });
    expect(otherConfig.fingerprint).not.toBe(a.fingerprint);
  });

  it("ignores interactions on projects outside the training catalogue", () => {
    const dataset = buildBprDataset([ev("u1", "A", "SAVE", 1), ev("u1", "ZZZ", "SAVE", 2)], CATALOG);
    const u = userRow(dataset, "u1");
    expect(dataset.positives[u]).toEqual([project(dataset, "A")]);
    expect(dataset.projectIds).not.toContain("ZZZ");
  });
});
