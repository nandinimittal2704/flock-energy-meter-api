import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger.js";

/* ──────────────────────────────────────────────
 * Custom error classes
 * ─────────────────────────────────────────── */

/** The upstream portal returned an error or behaved unexpectedly. */
export class PortalError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502,
    public readonly upstream?: { status?: number; body?: string }
  ) {
    super(message);
    this.name = "PortalError";
  }
}

/** A requested resource was not found in the portal. */
export class NotFoundError extends Error {
  constructor(message: string = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Authentication with the portal failed. */
export class AuthenticationError extends Error {
  constructor(message: string = "Portal authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/* ──────────────────────────────────────────────
 * Express error-handling middleware
 *
 * Maps internal errors to consistent, client-safe
 * JSON responses. Never exposes stack traces, raw
 * HTML, credentials, or internal identifiers.
 * ─────────────────────────────────────────── */

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request parameters", details },
    } satisfies ErrorResponse);
    return;
  }

  // Not found → 404
  if (err instanceof NotFoundError) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: err.message },
    } satisfies ErrorResponse);
    return;
  }

  // Auth failure → 502 (our upstream is down, not the client's fault)
  if (err instanceof AuthenticationError) {
    logger.error({ err }, "Portal authentication failed");
    res.status(502).json({
      error: {
        code: "UPSTREAM_AUTH_FAILURE",
        message: "Unable to authenticate with the upstream portal",
      },
    } satisfies ErrorResponse);
    return;
  }

  // Portal error → status from error or 502
  if (err instanceof PortalError) {
    logger.error(
      { err, upstreamStatus: err.upstream?.status },
      "Portal communication error"
    );
    res.status(err.statusCode).json({
      error: { code: "UPSTREAM_ERROR", message: err.message },
    } satisfies ErrorResponse);
    return;
  }

  // Unexpected error → 500
  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  } satisfies ErrorResponse);
}
