import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { meterService } from "../services/meter.service.js";
import {
  advancedMeterQuerySchema,
  consumptionQuerySchema,
} from "../schemas/meter.schema.js";

const router = Router();

const listQuerySchema = z.object({
  q: z.string().optional().default(""),
  page: z.coerce.number().int().min(1, "page must be at least 1").optional().default(1),
});

/**
 * GET /api/meters
 *
 * Lists smart meters with pagination and optional search filter.
 * Query parameters:
 * - q: string (optional, search term for meter ID or serial)
 * - page: number (optional, default 1)
 */
router.get("/meters", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await meterService.listMeters(query.q, query.page);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/meters/query
 *
 * Multi-attribute indexing & geo-proximity query layer.
 * Query parameters:
 * - make: string (e.g. HPL, L&T, Allied)
 * - phaseType: single | three
 * - installStatus: string (e.g. Installed, Decommissioned)
 * - dtCode: string (e.g. DT-001)
 * - feederCode: string (e.g. F-001)
 * - nearLat: number (latitude between -90 and 90)
 * - nearLng: number (longitude between -180 and 180)
 * - maxDistanceKm: number (radius in km, default 5)
 * - page: number (default 1)
 * - pageSize: number (default 20, max 100)
 */
router.get("/meters/query", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = advancedMeterQuerySchema.parse(req.query);
    const result = await meterService.queryMeters(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/meters/:id
 *
 * Retrieves full details for a single meter, including
 * nameplate parameters, installation metadata, geographic coordinates,
 * and distribution network hierarchy.
 */
router.get("/meters/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = rawId?.trim();
    if (!id) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Meter ID is required" } });
      return;
    }
    const meter = await meterService.getMeterById(id);
    res.json({ data: meter });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/meters/:id/consumption
 *
 * Retrieves interval consumption and voltage readings for a single meter.
 * Query parameters:
 * - limit: number (optional, max readings to return)
 */
router.get("/meters/:id/consumption", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = rawId?.trim();
    if (!id) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Meter ID is required" } });
      return;
    }
    const query = consumptionQuerySchema.parse(req.query);
    const consumption = await meterService.getMeterConsumption(id, query);
    res.json({ data: consumption });
  } catch (err) {
    next(err);
  }
});

export default router;
