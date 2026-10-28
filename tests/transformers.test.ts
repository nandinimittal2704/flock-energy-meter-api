import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { portalClient } from "../src/services/portal-client.js";

describe("Transformers API Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/transformers", () => {
    it("returns paginated transformers list", async () => {
      vi.spyOn(portalClient, "getDistributionTransformers").mockResolvedValueOnce({
        data: [
          {
            code: "DT-001",
            name: "Malviya Nagar DT 1",
            feederCode: "F-001",
            capacityKva: 100,
          },
          {
            code: "DT-002",
            name: "Mansarovar DT 2",
            feederCode: "F-002",
            capacityKva: 250,
          },
        ],
        total: 40,
      });

      const res = await request(app).get("/api/transformers?page=1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({
        code: "DT-001",
        name: "Malviya Nagar DT 1",
        feederCode: "F-001",
        capacityKva: 100,
      });
      expect(res.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 40,
        totalPages: 2,
      });
    });

    it("returns 400 for invalid page param", async () => {
      const res = await request(app).get("/api/transformers?page=abc");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
