import { Router, type Request, type Response, type NextFunction } from "express";
import { transformerService } from "../services/transformer.service.js";

const router = Router();

/**
 * GET /api/network
 *
 * Reconstructs and returns the full electricity distribution hierarchy:
 * Zone -> Circle -> Division -> Subdivision -> Substation -> Feeder -> DT -> Meter.
 * Includes network-wide statistics (counts of zones, feeders, DTs, and meters).
 */
router.get("/network", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const hierarchy = await transformerService.getNetworkHierarchy();
    res.json({ data: hierarchy });
  } catch (err) {
    next(err);
  }
});

export default router;
