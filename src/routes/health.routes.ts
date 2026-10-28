import { Router } from "express";

const router = Router();

/**
 * GET /health
 *
 * Returns a simple health check response.
 * Useful for load balancers, monitoring, and smoke tests.
 */
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
