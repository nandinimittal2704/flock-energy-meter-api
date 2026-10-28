import express, { type Express } from "express";
import healthRouter from "./routes/health.routes.js";
import metersRouter from "./routes/meters.routes.js";
import transformersRouter from "./routes/transformers.routes.js";
import networkRouter from "./routes/network.routes.js";
import exportRouter from "./routes/export.routes.js";
import { errorHandler, NotFoundError } from "./middleware/error-handler.js";
import { logger } from "./utils/logger.js";

/**
 * Creates and configures the Express application instance.
 * Separated from server listener to allow integration testing with Supertest.
 */
export function createApp(): Express {
  const app = express();

  // Basic middleware
  app.use(express.json());

  // Structured request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      logger.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
        },
        "HTTP request completed"
      );
    });
    next();
  });

  // Health routes
  app.use(healthRouter);
  app.use("/api", healthRouter);

  // Core API routes
  app.use("/api", metersRouter);
  app.use("/api", transformersRouter);
  app.use("/api", networkRouter);
  app.use("/api", exportRouter);

  // Serve OpenAPI specification
  app.get("/openapi.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.sendFile("openapi.json", { root: "./docs" });
  });

  // Static assets and modern web client
  app.use(express.static("public", { index: false }));

  // Root landing page: modern interactive web client dashboard or JSON API index
  app.get("/", (req, res) => {
    if (req.accepts("html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.sendFile("index.html", { root: "./public" });
    } else {
      res.json({
        service: "Flock Energy — Legacy Urja Meter Ops API",
        status: "active",
        documentation: "/openapi.json",
        endpoints: {
          health: "/health",
          meters: "/api/meters{?q,page}",
          meterDetail: "/api/meters/:id",
          consumption: "/api/meters/:id/consumption{?from,to,limit,summary}",
          transformers: "/api/transformers{?page}",
          networkHierarchy: "/api/network",
          export: "/api/export{?page}",
          query: "/api/meters/query{?make,phaseType,dtCode,nearLat,nearLng,maxDistanceKm}",
        },
      });
    }
  });

  // Catch-all route for unhandled endpoints
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Centralized error handling
  app.use(errorHandler);

  return app;
}

export const app = createApp();
