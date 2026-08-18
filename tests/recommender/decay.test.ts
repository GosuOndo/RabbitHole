import { describe, expect, it } from "vitest";
import { RECOMMENDER_CONFIG } from "@/lib/recommender/config";
import { MS_PER_DAY, decayAt, timeDecay } from "@/lib/recommender/decay";

const HALF_LIFE = RECOMMENDER_CONFIG.timeDecay.halfLifeDays;

describe("timeDecay", () => {
  it("returns full weight for a brand-new signal", () => {
    expect(timeDecay(0)).toBe(1);
    expect(timeDecay(1)).toBeCloseTo(1, 6);
  });

  it("halves at exactly one half-life and quarters at two", () => {
    expect(timeDecay(HALF_LIFE * MS_PER_DAY)).toBeCloseTo(0.5, 10);
    expect(timeDecay(2 * HALF_LIFE * MS_PER_DAY)).toBeCloseTo(0.25, 10);
    expect(timeDecay(3 * HALF_LIFE * MS_PER_DAY)).toBeCloseTo(0.125, 10);
  });

  it("uses hand-verifiable values for a 10-day half-life", () => {
    expect(timeDecay(10 * MS_PER_DAY, 10)).toBeCloseTo(0.5, 10);
    expect(timeDecay(5 * MS_PER_DAY, 10)).toBeCloseTo(Math.SQRT1_2, 10); // 0.5 ** 0.5
    expect(timeDecay(30 * MS_PER_DAY, 10)).toBeCloseTo(0.125, 10);
  });

  it("older signals decay monotonically but never reach zero or go negative", () => {
    let previous = 1;
    for (let days = 1; days <= 400; days += 7) {
      const value = timeDecay(days * MS_PER_DAY);
      expect(value).toBeLessThan(previous);
      expect(value).toBeGreaterThan(0);
      previous = value;
    }
  });

  it("treats future timestamps (clock skew) as zero age and stays finite", () => {
    expect(timeDecay(-5 * MS_PER_DAY)).toBe(1);
    expect(Number.isFinite(timeDecay(1e15))).toBe(true);
    expect(timeDecay(Number.NaN)).toBe(1);
  });

  it("rejects a non-positive half-life", () => {
    expect(() => timeDecay(1000, 0)).toThrow(RangeError);
    expect(() => timeDecay(1000, -3)).toThrow(RangeError);
  });

  it("decayAt derives the age from two dates", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);
    expect(decayAt(now, now)).toBe(1);
    expect(decayAt(thirtyDaysAgo, now, 30)).toBeCloseTo(0.5, 10);
  });
});
