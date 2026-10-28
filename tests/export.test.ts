import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { portalClient } from "../src/services/portal-client.js";

describe("Export API Route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/export", () => {
    it("returns exported meter records transparently signed by portalClient", async () => {
      vi.spyOn(portalClient, "exportMeters").mockResolvedValueOnce({
        data: [
          {
            meterId: "J100000",
            serialNo: "SE33962",
            make: "HPL",
            phaseType: "single",
            installStatus: "Decommissioned",
            installType: "Whole Current",
            build: "legacy",
            dtCode: "DT-001",
            hierarchy: {},
            geo: { lat: 26.9, lng: 75.8 },
          },
        ],
        total: 403,
      });

      const res = await request(app).get("/api/export?page=1");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(403);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].meterId).toBe("J100000");
    });
  });
});
