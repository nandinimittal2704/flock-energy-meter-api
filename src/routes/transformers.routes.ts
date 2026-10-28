import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { transformerService } from "../services/transformer.service.js";

const router = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page must be at least 1").optional().default(1),
});

/**
 * GET /api/transformers
 *
 * Lists distribution transformers (DTs) with pagination.
 * Query parameters:
 * - page: number (optional, default 1)
 */
router.get("/transformers", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await transformerService.listTransformers(query.page);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
