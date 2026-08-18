/**
 * Shared helpers for route handlers: typed JSON errors, body parsing and a
 * single place that maps known error classes to HTTP status codes without ever
 * leaking stack traces to the client.
 */

import { ZodError } from "zod";
import { DatabaseConfigurationError } from "@/lib/db";
import { ProjectNotFoundError } from "@/lib/interactions/interaction-service";
import { OnboardingConfigurationError } from "@/lib/onboarding/onboarding-service";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    issues?: { path: string; message: string }[];
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, code: string, message: string, issues?: ApiErrorBody["error"]["issues"]): Response {
  const body: ApiErrorBody = { error: { code, message, ...(issues ? { issues } : {}) } };
  return Response.json(body, { status });
}

/** Parses a JSON body, turning malformed JSON into a 400. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof ZodError) {
    return jsonError(
      400,
      "validation_error",
      "Request body failed validation",
      error.issues.map((issue) => ({ path: issue.path.map(String).join(".") || "(root)", message: issue.message })),
    );
  }
  if (error instanceof ApiError) return jsonError(error.status, error.code, error.message);
  if (error instanceof ProjectNotFoundError) return jsonError(404, "project_not_found", error.message);
  if (error instanceof DatabaseConfigurationError) return jsonError(503, "database_not_configured", error.message);
  if (error instanceof OnboardingConfigurationError) return jsonError(503, "onboarding_unavailable", error.message);
  console.error("[api] unhandled error", error);
  return jsonError(500, "internal_error", "Something went wrong");
}
