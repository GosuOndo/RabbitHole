import { describe, expect, it } from "vitest";
import { SeededRandom, hashSeed } from "@/lib/utils/prng";

describe("SeededRandom", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRandom("rabbithole");
    const b = new SeededRandom("rabbithole");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new SeededRandom("seed-a");
    const b = new SeededRandom("seed-b");
    expect(Array.from({ length: 5 }, () => a.next())).not.toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it("next() stays within [0, 1) and looks roughly uniform", () => {
    const rng = new SeededRandom(42);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10_000).toBeGreaterThan(0.47);
    expect(sum / 10_000).toBeLessThan(0.53);
  });

  it("int() is inclusive of both bounds and never leaves the range", () => {
    const rng = new SeededRandom("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("weightedPick never returns zero-weight items", () => {
    const rng = new SeededRandom("weights");
    for (let i = 0; i < 500; i++) {
      expect(rng.weightedPick(["a", "b", "c"], [0, 5, 0])).toBe("b");
    }
  });

  it("weightedPick follows the weights approximately", () => {
    const rng = new SeededRandom("weights-2");
    let heavy = 0;
    for (let i = 0; i < 5_000; i++) if (rng.weightedPick(["light", "heavy"], [1, 3]) === "heavy") heavy++;
    expect(heavy / 5_000).toBeGreaterThan(0.7);
    expect(heavy / 5_000).toBeLessThan(0.8);
  });

  it("shuffle returns a permutation without mutating the input", () => {
    const rng = new SeededRandom("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const output = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...output].sort((a, b) => a - b)).toEqual(input);
  });

  it("gaussian has the requested mean and spread", () => {
    const rng = new SeededRandom("gauss");
    const values = Array.from({ length: 20_000 }, () => rng.gaussian(10, 2));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 1);
  });

  it("fork() derives an independent but deterministic stream", () => {
    const a = new SeededRandom("root").fork("child");
    const b = new SeededRandom("root").fork("child");
    const c = new SeededRandom("root").fork("other");
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });

  it("hashSeed is stable and 32-bit", () => {
    expect(hashSeed("rabbithole")).toBe(hashSeed("rabbithole"));
    expect(hashSeed("rabbithole")).not.toBe(hashSeed("rabbithole2"));
    expect(hashSeed("x")).toBeGreaterThanOrEqual(0);
    expect(hashSeed("x")).toBeLessThanOrEqual(0xffffffff);
  });
});
