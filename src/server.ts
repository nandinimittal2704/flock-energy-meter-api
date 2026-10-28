import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const host = env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";

const server = app.listen(env.PORT, host, () => {
  logger.info(
    {
      host,
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      portalBaseUrl: env.PORTAL_BASE_URL,
    },
    "Flock Energy API service started"
  );
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Initiating graceful shutdown");
  server.close(() => {
    logger.info("HTTP server closed. Exiting process.");
    process.exit(0);
  });

  // Force shutdown after timeout if pending requests don't finish
  setTimeout(() => {
    logger.error("Forced shutdown due to timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
