import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

/**
 * Validated environment configuration.
 *
 * Fails at startup with a clear message if required variables are missing.
 * Never prints secret values.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Portal connection
  PORTAL_BASE_URL: z.string().url(),
  PORTAL_EMAIL: z.string().email(),
  PORTAL_PASSWORD: z.string().min(1, "PORTAL_PASSWORD must not be empty"),

  // Portal client tuning
  PORTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PORTAL_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\nSee .env.example for required variables.\n`
    );
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
