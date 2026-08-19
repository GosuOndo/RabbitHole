/**
 * Effective profile: long-term taste blended with the current session.
 *
 * Phase 3 uses a fixed blend from configuration:
 *   effective = normalise((1 - w) * longTerm.vector + w * session.vector),  w = session.baseWeight
 * and w = 0 when the session profile is empty, so a fresh session changes
 * nothing. Phase 6 replaces the fixed weight with the adaptive rule described
 * next to `RECOMMENDER_CONFIG.session` (interaction count + coherence).
 */

import { RECOMMENDER_CONFIG } from "./config";
import type { InterestProfile } from "./profile";
import type { FeatureVector } from "./types";
import { addScaledInto, l2Norm, scaleVector, tidyVector } from "./vector";

export interface EffectiveProfile {
  /** L2-normalised signed vector used for content retrieval and scoring. */
  vector: FeatureVector;
  /** Session weight actually applied (0 when the session profile is empty). */
  sessionWeight: number;
}

export function blendProfiles(
  longTerm: InterestProfile,
  session: InterestProfile,
  sessionWeight: number = RECOMMENDER_CONFIG.session.baseWeight,
): EffectiveProfile {
  const w = session.norm > 0 ? Math.max(0, Math.min(1, sessionWeight)) : 0;
  if (w === 0) return { vector: longTerm.vector, sessionWeight: 0 };
  if (longTerm.norm === 0) return { vector: session.vector, sessionWeight: w };

  const blended: Record<string, number> = {};
  addScaledInto(blended, longTerm.vector, 1 - w);
  addScaledInto(blended, session.vector, w);
  const norm = l2Norm(blended);
  return { vector: norm > 0 ? tidyVector(scaleVector(blended, 1 / norm)) : {}, sessionWeight: w };
}
