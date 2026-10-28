import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { portalClient } from "../services/portal-client.js";

const router = Router();

const exportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
});

/**
 * GET /api/export
 *
 * Exposes the portal's complete bulk export dataset with cryptographic
 * HMAC signature verification handled transparently by the service.
 */
router.get("/export", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = exportQuerySchema.parse(req.query);
    const result = await portalClient.exportMeters(query.page);
    res.json({
      data: result.data,
      total: result.total,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
