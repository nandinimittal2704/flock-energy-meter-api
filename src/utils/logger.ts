import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logger using Pino.
 *
 * In development, uses pino-pretty for human-readable output.
 * In production, outputs newline-delimited JSON.
 *
 * IMPORTANT: Never log credentials, cookies, tokens, or authorization headers.
 * Use logger.child({ component: "..." }) to add context.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : {}),
  // Redact sensitive fields that might accidentally appear
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "token",
      "sessionToken",
      "cookie",
    ],
    censor: "[REDACTED]",
  },
});
