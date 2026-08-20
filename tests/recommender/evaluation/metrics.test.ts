import { describe, expect, it } from "vitest";
import {
  catalogueCoverage,
  hitAtK,
  intraListDiversity,
  itemNovelty,
  listNovelty,
  macroMean,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from "@/lib/recommender/evaluation/metrics";
import type { FeatureVector } from "@/lib/recommender/types";

const relevant = new Set(["B", "E"]);

describe("precision / recall (hand-verifiable, §38)", () => {
  const recommended = ["A", "B", "C", "D", "E"];

  it("Precision@5 = 2/5 and Recall@5 = 2/2 for the specification fixture", () => {
    expect(precisionAtK(recommended, relevant, 5)).toBeCloseTo(0.4, 10);
    expect(recallAtK(recommended, relevant, 5)).toBeCloseTo(1, 10);
  });

  it("uses K as the precision denominator even for short lists, and bounds everything to [0, 1]", () => {
    expect(precisionAtK(["B"], relevant, 5)).toBeCloseTo(0.2, 10); // short list: 1 hit / K
    expect(recallAtK(["B"], relevant, 5)).toBeCloseTo(0.5, 10);
    expect(precisionAtK([], relevant, 5)).toBe(0);
    expect(recallAtK([], relevant, 5)).toBe(0);
    expect(precisionAtK(recommended, new Set(), 5)).toBe(0);
    expect(recallAtK(recommended, new Set(), 5)).toBe(0);
    expect(precisionAtK(["B", "E"], relevant, 2)).toBe(1);
    expect(recallAtK(["B", "E", "A"], relevant, 10)).toBe(1);
  });
});

describe("NDCG@K (§39)", () => {
  it("is 1 for the ideal ordering and for a single relevant item at rank 1", () => {
    expect(ndcgAtK(["B", "E", "A", "C"], relevant, 10)).toBeCloseTo(1, 10);
    expect(ndcgAtK(["B", "A", "C"], new Set(["B"]), 10)).toBeCloseTo(1, 10);
  });

  it("is between 0 and 1 for a later hit, exactly log-discounted", () => {
    // Single relevant item at position 3: DCG = 1/log2(4) = 0.5, IDCG = 1.
    expect(ndcgAtK(["A", "C", "B"], new Set(["B"]), 10)).toBeCloseTo(0.5, 10);
    const later = ndcgAtK(["A", "B", "C", "D", "E"], relevant, 10);
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThan(1);
    // Two relevant at ranks 2 and 5: DCG = 1/log2(3) + 1/log2(6); IDCG = 1 + 1/log2(3).
    const expected = (1 / Math.log2(3) + 1 / Math.log2(6)) / (1 + 1 / Math.log2(3));
    expect(later).toBeCloseTo(expected, 10);
  });

  it("is 0 with no hits and 0 when IDCG would be 0", () => {
    expect(ndcgAtK(["A", "C", "D"], relevant, 10)).toBe(0);
    expect(ndcgAtK(["A"], new Set(), 10)).toBe(0);
  });

  it("earlier hits beat later hits for the same relevant set", () => {
    expect(ndcgAtK(["B", "A", "C"], relevant, 10)).toBeGreaterThan(ndcgAtK(["A", "C", "B"], relevant, 10));
  });
});

describe("HitRate (§40)", () => {
  it("is 1 with at least one hit in the top K and 0 otherwise", () => {
    expect(hitAtK(["A", "B"], relevant, 10)).toBe(1);
    expect(hitAtK(["A", "C"], relevant, 10)).toBe(0);
    expect(hitAtK(["A", "B"], relevant, 1)).toBe(0); // B is outside top-1
    expect(hitAtK([], relevant, 10)).toBe(0);
  });
});

describe("catalogue coverage (§41)", () => {
  it("is unique recommended over catalogue size", () => {
    expect(
      catalogueCoverage(
        [
          ["A", "B"],
          ["B", "C", "D"],
        ],
        10,
      ),
    ).toBeCloseTo(0.4, 10);
    expect(catalogueCoverage([], 10)).toBe(0);
    expect(catalogueCoverage([["A"]], 0)).toBe(0);
    expect(catalogueCoverage([["A", "B"], ["A"]], 2)).toBe(1);
  });
});

describe("intra-list diversity (§42)", () => {
  const vectors = new Map<string, FeatureVector>([
    ["s1", { "tag:systems": 1 }],
    ["s2", { "tag:systems": 1 }],
    ["g1", { "tag:graphics": 1 }],
    ["mixed", { "tag:systems": 0.7071, "tag:graphics": 0.7071 }],
  ]);

  it("scores dissimilar lists above near-identical lists", () => {
    const similar = intraListDiversity(["s1", "s2"], vectors);
    const dissimilar = intraListDiversity(["s1", "g1"], vectors);
    expect(similar).toBeCloseTo(0, 10); // identical vectors → cosine 1 → dissimilarity 0
    expect(dissimilar).toBeCloseTo(1, 10); // orthogonal vectors
    expect(dissimilar).toBeGreaterThan(similar);
    const middle = intraListDiversity(["s1", "mixed"], vectors);
    expect(middle).toBeGreaterThan(similar);
    expect(middle).toBeLessThan(dissimilar);
  });

  it("returns 0 for empty and single-item lists (no pairs to diversify) and stays finite/bounded", () => {
    expect(intraListDiversity([], vectors)).toBe(0);
    expect(intraListDiversity(["s1"], vectors)).toBe(0);
    const value = intraListDiversity(["s1", "s2", "g1", "mixed"], vectors);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe("novelty (§43)", () => {
  it("orders items by inverse training popularity: unseen > rare > popular", () => {
    const maxCount = 40;
    const popular = itemNovelty(40, maxCount);
    const rare = itemNovelty(2, maxCount);
    const unseen = itemNovelty(0, maxCount);
    expect(unseen).toBe(1);
    expect(unseen).toBeGreaterThan(rare);
    expect(rare).toBeGreaterThan(popular);
    expect(popular).toBeCloseTo(0, 10);
    for (const value of [popular, rare, unseen]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("treats an empty training world (maxCount 0) as fully novel and averages per list", () => {
    expect(itemNovelty(0, 0)).toBe(1);
    expect(itemNovelty(5, Number.NaN)).toBe(1);
    const counts = new Map([
      ["A", 40],
      ["B", 2],
    ]);
    const value = listNovelty(["A", "B", "C"], counts, 40);
    expect(value).toBeCloseTo((itemNovelty(40, 40) + itemNovelty(2, 40) + 1) / 3, 10);
    expect(listNovelty([], counts, 40)).toBe(0);
  });
});

describe("macroMean", () => {
  it("is the arithmetic mean over users, 0 for no users, and ignores non-finite garbage", () => {
    expect(macroMean([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 10);
    expect(macroMean([])).toBe(0);
    expect(macroMean([1, Number.NaN, 1])).toBeCloseTo(2 / 3, 10);
  });
});
