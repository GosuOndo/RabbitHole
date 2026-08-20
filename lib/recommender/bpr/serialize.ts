/**
 * BPR model artifact (Phase 10): plain JSON, tiny at this scale
 * (~30 users × ~163 projects × 16 factors), reproducible via `npm run
 * train:bpr`. The deterministic checksum covers mappings, factors, training
 * config and the data fingerprint — never the informational createdAt
 * timestamp — so repeated deterministic training yields an identical checksum.
 */

import { fnv1a } from "../evaluation/split";
import type { BprArtifact, BprModel } from "./types";

export class BprArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BprArtifactError";
  }
}

/** Deterministic checksum of meaningful model content (timestamp excluded). */
export function bprModelChecksum(model: BprModel): string {
  const canonical = JSON.stringify({
    version: model.version,
    factors: model.factors,
    userIds: model.userIds,
    projectIds: model.projectIds,
    userFactors: model.userFactors,
    itemFactors: model.itemFactors,
    training: model.training,
    dataFingerprint: model.dataFingerprint,
  });
  return fnv1a(canonical).toString(16).padStart(8, "0");
}

export function serializeBprModel(model: BprModel, createdAt: Date): BprArtifact {
  return { ...model, createdAt: createdAt.toISOString(), checksum: bprModelChecksum(model) };
}

function isFiniteMatrix(value: unknown, rows: number, columns: number): value is number[][] {
  if (!Array.isArray(value) || value.length !== rows) return false;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== columns) return false;
    for (const entry of row) if (typeof entry !== "number" || !Number.isFinite(entry)) return false;
  }
  return true;
}

/** Validates and returns a loaded artifact; throws BprArtifactError on malformed input. */
export function parseBprArtifact(value: unknown, expectedVersion: number): BprModel {
  if (typeof value !== "object" || value === null) throw new BprArtifactError("artifact is not an object");
  const artifact = value as Partial<BprArtifact>;
  if (artifact.version !== expectedVersion) throw new BprArtifactError(`unsupported artifact version ${String(artifact.version)}`);
  if (typeof artifact.factors !== "number" || !(artifact.factors > 0)) throw new BprArtifactError("invalid factor count");
  if (!Array.isArray(artifact.userIds) || artifact.userIds.length === 0 || !artifact.userIds.every((id) => typeof id === "string")) {
    throw new BprArtifactError("invalid user mapping");
  }
  if (!Array.isArray(artifact.projectIds) || artifact.projectIds.length === 0 || !artifact.projectIds.every((id) => typeof id === "string")) {
    throw new BprArtifactError("invalid project mapping");
  }
  if (!isFiniteMatrix(artifact.userFactors, artifact.userIds.length, artifact.factors)) throw new BprArtifactError("invalid user factors");
  if (!isFiniteMatrix(artifact.itemFactors, artifact.projectIds.length, artifact.factors)) throw new BprArtifactError("invalid item factors");
  if (typeof artifact.dataFingerprint !== "string" || typeof artifact.training !== "object" || artifact.training === null) {
    throw new BprArtifactError("missing training metadata");
  }
  const model: BprModel = {
    version: artifact.version,
    factors: artifact.factors,
    userIds: artifact.userIds,
    projectIds: artifact.projectIds,
    userFactors: artifact.userFactors,
    itemFactors: artifact.itemFactors,
    training: artifact.training as BprModel["training"],
    dataFingerprint: artifact.dataFingerprint,
    diagnostics: Array.isArray(artifact.diagnostics) ? (artifact.diagnostics as BprModel["diagnostics"]) : [],
  };
  if (typeof artifact.checksum === "string" && artifact.checksum !== bprModelChecksum(model)) {
    throw new BprArtifactError("artifact checksum mismatch (stale or corrupted model)");
  }
  return model;
}
