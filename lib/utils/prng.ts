/**
 * Small, dependency-free seeded pseudo-random generator.
 *
 * Used wherever RabbitHole needs reproducible randomness: the database seed,
 * evaluation baselines (Random), sampling in experiments (BPR). The generator
 * is mulberry32 (32-bit state, period ~2^32) seeded from a number or a string
 * hash. It is deliberately simple; it is not cryptographically secure.
 */

/** cyrb53-style string hash reduced to a 32-bit unsigned integer. */
export function hashSeed(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(): max (${max}) < min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly chosen element. Throws on empty input. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick(): empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * Element chosen with probability proportional to its weight. Non-positive
   * weights are treated as zero. Throws if all weights are zero.
   */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("weightedPick(): items and weights must be non-empty and equal length");
    }
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) throw new RangeError("weightedPick(): all weights are zero");
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Fisher–Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = tmp;
    }
    return copy;
  }

  /** `count` distinct elements sampled without replacement (order random). */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count >= items.length) return this.shuffle(items);
    return this.shuffle(items).slice(0, Math.max(0, count));
  }

  /** Normally distributed value (Box–Muller). */
  gaussian(mean = 0, standardDeviation = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * standardDeviation;
  }

  /** Independent generator derived deterministically from this one and a label. */
  fork(label: string): SeededRandom {
    return new SeededRandom(hashSeed(`${label}:${this.int(0, 0x7fffffff)}`));
  }
}
