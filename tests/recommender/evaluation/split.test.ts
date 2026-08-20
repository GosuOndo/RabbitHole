import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { trainingPositiveEvidence } from "@/lib/recommender/evaluation/baselines";
import { buildEvaluationSplit, evaluationExclusions, fnv1a, splitFingerprint } from "@/lib/recommender/evaluation/split";
import { EVAL_CATALOG, at, datasetFrom, interactionsFrom, user, type Row } from "../../helpers/evaluation-fixture";

const CONFIG = RECOMMENDER_CONFIG.evaluation;
const SLUGS = EVAL_CATALOG.map((project) => project.slug);

/** N distinct SAVEs, one per minute starting at `start`. */
function saves(userId: string, count: number, start: number, offset = 0): Row[] {
  return Array.from({ length: count }, (_, index) => [userId, SLUGS[offset + index]!, "SAVE", start + index] as Row);
}

describe("chronological holdout (§9, §44)", () => {
  it("holds out the latest-discovered positive; training is strictly before the cutoff and never contains the target", () => {
    const rows: Row[] = [
      ["u1", SLUGS[0]!, "OPEN", 1],
      ["u1", SLUGS[1]!, "SAVE", 2],
      ["u1", SLUGS[2]!, "SAVE", 3],
      ["u1", SLUGS[3]!, "SAVE", 4],
      ["u1", SLUGS[4]!, "SAVE", 5],
      ["u1", SLUGS[5]!, "SAVE", 6],
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1")], rows), CONFIG);
    expect(split.skipped).toEqual([]);
    expect(split.cases).toHaveLength(1);
    const evaluationCase = split.cases[0]!;
    // 5 positives → round(0.2 × 5) = 1 held out; the latest first-touch positive is SLUGS[5] at minute 6.
    expect(evaluationCase.heldOut).toEqual([SLUGS[5]!]);
    expect(evaluationCase.cutoff).toEqual(at(6));
    expect(evaluationCase.trainingInteractions).toHaveLength(5);
    for (const interaction of evaluationCase.trainingInteractions) {
      expect(interaction.createdAt.getTime()).toBeLessThan(evaluationCase.cutoff.getTime());
      expect(interaction.projectId).not.toBe(SLUGS[5]!);
    }
    expect(evaluationCase.trainingPositiveProjects).toBe(4);
    // The held-out project is a valid candidate (kept in the universe, §16).
    expect(evaluationCase.universe).toContain(SLUGS[5]!);
    expect(evaluationCase.excludedProjectIds.has(SLUGS[5]!)).toBe(false);
  });

  it("holdout size follows clamp(round(0.2 × positives), 1, 3)", () => {
    const five = buildEvaluationSplit(datasetFrom([user("u1")], saves("u1", 5, 1)), CONFIG).cases[0]!;
    expect(five.heldOut).toHaveLength(1);
    const fifteen = buildEvaluationSplit(datasetFrom([user("u1")], saves("u1", 15, 1)), CONFIG).cases[0]!;
    expect(fifteen.heldOut).toHaveLength(3);
    const twentyFive = buildEvaluationSplit(datasetFrom([user("u1")], saves("u1", 25, 1)), CONFIG).cases[0]!;
    expect(twentyFive.heldOut).toHaveLength(3); // capped
    // Held out = the latest-discovered positives; cutoff = earliest first touch among them.
    expect(new Set(fifteen.heldOut)).toEqual(new Set([SLUGS[12]!, SLUGS[13]!, SLUGS[14]!]));
    expect(fifteen.cutoff).toEqual(at(13));
  });
});

describe("unseen-target rule (§10, §45)", () => {
  it("never selects a previously-touched project as an unseen holdout and discards its post-cutoff events", () => {
    const rows: Row[] = [
      ["u1", SLUGS[9]!, "OPEN", 1], // G touched early…
      ["u1", SLUGS[1]!, "SAVE", 2],
      ["u1", SLUGS[2]!, "SAVE", 3],
      ["u1", SLUGS[3]!, "SAVE", 4],
      ["u1", SLUGS[4]!, "SAVE", 5],
      ["u1", SLUGS[5]!, "SAVE", 6], // H — latest first-touch positive
      ["u1", SLUGS[9]!, "SAVE", 10], // …but only saved after everything (future w.r.t. cutoff)
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1")], rows), CONFIG);
    const evaluationCase = split.cases[0]!;
    // G (SLUGS[9]) has firstTouch minute 1 → it is NOT the latest discovery, H is.
    expect(evaluationCase.heldOut).toEqual([SLUGS[5]!]);
    expect(evaluationCase.cutoff).toEqual(at(6));
    // G's future SAVE is gone from training; its early OPEN remains (ordinary history).
    const trainingOfG = evaluationCase.targetTraining.filter((interaction) => interaction.projectId === SLUGS[9]!);
    expect(trainingOfG.map((interaction) => interaction.type)).toEqual(["OPEN"]);
    // No held-out project has ANY training interaction (strict unseen requirement).
    for (const held of evaluationCase.heldOut) {
      expect(evaluationCase.targetTraining.some((interaction) => interaction.projectId === held)).toBe(false);
    }
  });

  it("skips users whose split would leave too little training signal", () => {
    // All five positives are first touched via early OPENs and only saved later:
    // the latest discovery is minute 5, so training (minutes 1–4) has 0 positives.
    const rows: Row[] = [
      ["u1", SLUGS[0]!, "OPEN", 1],
      ["u1", SLUGS[1]!, "OPEN", 2],
      ["u1", SLUGS[2]!, "OPEN", 3],
      ["u1", SLUGS[3]!, "OPEN", 4],
      ["u1", SLUGS[4]!, "OPEN", 5],
      ["u1", SLUGS[0]!, "SAVE", 6],
      ["u1", SLUGS[1]!, "SAVE", 7],
      ["u1", SLUGS[2]!, "SAVE", 8],
      ["u1", SLUGS[3]!, "SAVE", 9],
      ["u1", SLUGS[4]!, "SAVE", 10],
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1")], rows), CONFIG);
    expect(split.cases).toEqual([]);
    expect(split.skipped).toEqual([{ userId: "u1", handle: "u1", reason: "insufficient training positives after cutoff" }]);

    const few = buildEvaluationSplit(datasetFrom([user("u2")], saves("u2", 4, 1)), CONFIG);
    expect(few.skipped[0]!.reason).toBe("insufficient strong-positive projects");
  });
});

describe("leakage prevention (§12, §13, §47)", () => {
  it("removes other users' future interactions from the training view (CF + popularity)", () => {
    const rows: Row[] = [
      // Target: 5 positives, holdout = SLUGS[4] touched at minute 5 → cutoff minute 5.
      ...saves("u1", 5, 1),
      // Another user pumps SLUGS[30] BEFORE the cutoff…
      ["u2", SLUGS[30]!, "SAVE", 2, "u2-s1"],
      ["u2", SLUGS[30]!, "BUILD", 3, "u2-s1"],
      // …and floods SLUGS[31] AFTER the cutoff.
      ["u2", SLUGS[31]!, "SAVE", 50, "u2-s2"],
      ["u2", SLUGS[31]!, "COMPLETE", 51, "u2-s2"],
      ["u2", SLUGS[31]!, "SHARE", 52, "u2-s2"],
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1"), user("u2")], rows), CONFIG);
    const evaluationCase = split.cases.find((entry) => entry.userId === "u1")!;
    expect(evaluationCase.cutoff).toEqual(at(5));
    expect(evaluationCase.trainingInteractions.some((interaction) => interaction.createdAt.getTime() >= at(5).getTime())).toBe(false);
    expect(evaluationCase.trainingInteractions.some((interaction) => interaction.projectId === SLUGS[31]!)).toBe(false);
    const evidence = trainingPositiveEvidence(evaluationCase.trainingInteractions);
    expect(evidence.get(SLUGS[30]!)).toBeGreaterThan(0);
    expect(evidence.get(SLUGS[31]!)).toBeUndefined(); // the future never boosts popularity
  });
});

describe("session split (§14, §48)", () => {
  it("separates earlier-session long-term context from the evaluation-session context, held-out excluded from both", () => {
    const rows: Row[] = [
      // Earlier session: systems.
      ["u1", "build-your-own-redis", "SAVE", 1, "s1"],
      ["u1", "write-an-http-server", "SAVE", 2, "s1"],
      ["u1", "implement-a-dns-resolver", "SAVE", 3, "s1"],
      ["u1", "implement-a-tiny-database", "SAVE", 4, "s1"],
      // Evaluation session: graphics browsing before the cutoff…
      ["u1", "implement-a-ray-tracer", "OPEN", 60, "s2"],
      ["u1", "webgl-fluid-simulation", "SAVE", 61, "s2"],
      // …then the held-out discovery in the same session.
      ["u1", "procedural-terrain-generator", "SAVE", 62, "s2"],
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1")], rows), CONFIG);
    const evaluationCase = split.cases[0]!;
    expect(evaluationCase.heldOut).toEqual(["procedural-terrain-generator"]);
    expect(evaluationCase.cutoff).toEqual(at(62));
    expect(evaluationCase.evaluationSessionId).toBe("s2");
    expect(evaluationCase.sessionTraining.map((interaction) => interaction.projectId)).toEqual([
      "implement-a-ray-tracer",
      "webgl-fluid-simulation",
    ]);
    const earlier = evaluationCase.targetTraining.filter((interaction) => interaction.sessionId === "s1");
    expect(earlier).toHaveLength(4);
    expect(evaluationCase.sessionTraining.some((interaction) => interaction.projectId === "procedural-terrain-generator")).toBe(false);
    expect(evaluationCase.targetTraining.some((interaction) => interaction.projectId === "procedural-terrain-generator")).toBe(false);
  });
});

describe("candidate universe (§16, §17)", () => {
  it("excludes training positives and training terminal states, keeps held-out targets and mere OPENs", () => {
    const rows: Row[] = [
      ...saves("u1", 5, 1),
      ["u1", SLUGS[40]!, "OPEN", 1.5],
      ["u1", SLUGS[41]!, "DISLIKE", 2.5],
    ];
    const split = buildEvaluationSplit(datasetFrom([user("u1")], rows), CONFIG);
    const evaluationCase = split.cases[0]!;
    const universe = new Set(evaluationCase.universe);
    for (const slug of [SLUGS[0]!, SLUGS[1]!, SLUGS[2]!, SLUGS[3]!]) expect(universe.has(slug)).toBe(false); // training positives out
    expect(universe.has(SLUGS[41]!)).toBe(false); // training dislike out
    expect(universe.has(SLUGS[40]!)).toBe(true); // an OPEN stays discoverable
    expect(universe.has(evaluationCase.heldOut[0]!)).toBe(true); // the answer is never filtered out
    expect(evaluationCase.universe.length).toBe(EVAL_CATALOG.length - evaluationCase.excludedProjectIds.size);
    // Exclusion helper agrees with production state semantics for UNSAVE.
    const toggled = evaluationExclusions(
      interactionsFrom([
        ["u1", SLUGS[50]!, "SAVE", 1],
        ["u1", SLUGS[50]!, "UNSAVE", 2],
      ]),
      CONFIG,
    );
    expect(toggled.has(SLUGS[50]!)).toBe(true); // it was positively consumed in training regardless of the later unsave
  });
});

describe("same split for every algorithm + fingerprint (§46, §76)", () => {
  const rows: Row[] = [...saves("u1", 7, 1), ...saves("u2", 6, 1, 20)];

  it("is fully deterministic: identical cases, universes and fingerprint across rebuilds", () => {
    const a = buildEvaluationSplit(datasetFrom([user("u1"), user("u2")], rows), CONFIG);
    const b = buildEvaluationSplit(datasetFrom([user("u2"), user("u1")], rows), CONFIG); // user order must not matter
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.cases.map((entry) => [entry.userId, entry.cutoff.toISOString(), entry.heldOut, entry.universe.length])).toEqual(
      b.cases.map((entry) => [entry.userId, entry.cutoff.toISOString(), entry.heldOut, entry.universe.length]),
    );
    expect(/^[0-9a-f]{8}$/.test(a.fingerprint)).toBe(true);
  });

  it("changes the fingerprint when the split changes and keeps fnv1a stable", () => {
    const base = buildEvaluationSplit(datasetFrom([user("u1")], saves("u1", 7, 1)), CONFIG);
    const moved = buildEvaluationSplit(datasetFrom([user("u1")], saves("u1", 8, 1)), CONFIG);
    expect(base.fingerprint).not.toBe(moved.fingerprint);
    expect(fnv1a("rabbit")).toBe(fnv1a("rabbit"));
    expect(fnv1a("rabbit")).not.toBe(fnv1a("hole"));
    expect(splitFingerprint(base.cases)).toBe(base.fingerprint);
  });
});
