import { describe, expect, it } from "vitest";
import { cosineSimilarity, cosineWithUnitVector } from "@/lib/recommender/similarity";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors (and for any positive scaling of them)", () => {
    const v = { "tag:systems": 1, "tag:databases": 0.5, "lang:rust": 0.25 };
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
    expect(cosineSimilarity(v, { "tag:systems": 3, "tag:databases": 1.5, "lang:rust": 0.75 })).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity({ "tag:systems": 1 }, { "tag:graphics": 1 })).toBe(0);
    expect(cosineSimilarity({ "tag:a": 1, "tag:b": 1 }, { "tag:c": 2 })).toBe(0);
  });

  it("is negative for opposite signed vectors", () => {
    expect(cosineSimilarity({ "tag:mobile": 1 }, { "tag:mobile": -1 })).toBeCloseTo(-1, 10);
    // A profile that dislikes mobile but likes systems vs. a mobile project → negative.
    expect(cosineSimilarity({ "tag:mobile": -0.8, "tag:systems": 0.6 }, { "tag:mobile": 1 })).toBeCloseTo(-0.8, 10);
  });

  it("returns a hand-verifiable intermediate value for partial overlap", () => {
    // a = (1, 1, 0), b = (1, 0, 1) → dot 1, norms √2 √2 → 0.5
    expect(cosineSimilarity({ "tag:a": 1, "tag:b": 1 }, { "tag:a": 1, "tag:c": 1 })).toBeCloseTo(0.5, 10);
    // a = (3, 4), b = (4, 3) → 24 / 25
    expect(cosineSimilarity({ x: 3, y: 4 }, { x: 4, y: 3 })).toBeCloseTo(0.96, 10);
  });

  it("is safely 0 for empty vectors and zero norms, never NaN or Infinity", () => {
    expect(cosineSimilarity({}, { "tag:a": 1 })).toBe(0);
    expect(cosineSimilarity({ "tag:a": 1 }, {})).toBe(0);
    expect(cosineSimilarity({}, {})).toBe(0);
    expect(cosineSimilarity({ "tag:a": 0 }, { "tag:a": 1 })).toBe(0);
    for (const value of [cosineSimilarity({ a: 1e-200 }, { a: 1e-200 }), cosineSimilarity({ a: 1e200 }, { a: 1e200 })]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("is symmetric, bounded and deterministic", () => {
    const a = { "tag:a": 0.3, "tag:b": -0.7, "lang:x": 0.2 };
    const b = { "tag:a": 1, "tag:c": 1, "lang:x": 0.5 };
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
    expect(cosineSimilarity(a, b)).toBe(cosineSimilarity(a, b));
    expect(Math.abs(cosineSimilarity(a, b))).toBeLessThanOrEqual(1);
  });

  it("cosineWithUnitVector matches cosineSimilarity when the first vector is unit length", () => {
    const unit = { "tag:a": Math.SQRT1_2, "tag:b": Math.SQRT1_2 };
    const other = { "tag:a": 1, "tag:c": 1 };
    expect(cosineWithUnitVector(unit, other)).toBeCloseTo(cosineSimilarity(unit, other), 10);
    expect(cosineWithUnitVector(unit, {})).toBe(0);
  });
});
