import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { portalClient } from "../src/services/portal-client.js";
import { meterService } from "../src/services/meter.service.js";

describe("Network Hierarchy API Route", () => {
  beforeEach(() => {
    meterService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/network", () => {
    it("reconstructs network tree and returns summary statistics", async () => {
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
            hierarchy: {
              zone: { name: "Jaipur Zone 1", code: "Z-01" },
              circle: { name: "Circle 1", code: "C-01" },
              division: { name: "Division 1", code: "D-01" },
              subdivision: { name: "Subdivision 1", code: "SD-01" },
              substation: { name: "Substation 1", code: "SS-01" },
              feeder: { name: "Feeder 1", code: "F-001" },
              dt: { name: "Malviya Nagar DT 1", code: "DT-001" },
            },
            geo: { lat: 26.9389, lng: 75.8309 },
          },
          {
            meterId: "J100001",
            serialNo: "GE84132",
            make: "L&T",
            phaseType: "single",
            installStatus: "Installed",
            installType: "CT Operated",
            build: "legacy",
            dtCode: "DT-002",
            hierarchy: {
              zone: { name: "Jaipur Zone 2", code: "Z-02" },
              circle: { name: "Circle 2", code: "C-02" },
              division: { name: "Division 2", code: "D-02" },
              subdivision: { name: "Subdivision 2", code: "SD-02" },
              substation: { name: "Substation 2", code: "SS-02" },
              feeder: { name: "Feeder 2", code: "F-002" },
              dt: { name: "Mansarovar DT 2", code: "DT-002" },
            },
            geo: { lat: 26.85, lng: 75.76 },
          },
        ],
        total: 2,
      });

      vi.spyOn(portalClient, "getDistributionTransformers").mockResolvedValueOnce({
        data: [
          { code: "DT-001", name: "Malviya Nagar DT 1", feederCode: "F-001", capacityKva: 100 },
          { code: "DT-002", name: "Mansarovar DT 2", feederCode: "F-002", capacityKva: 250 },
        ],
        total: 2,
      });

      const res = await request(app).get("/api/network");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data.statistics).toEqual({
        totalZones: 2,
        totalCircles: 2,
        totalDivisions: 2,
        totalSubstations: 2,
        totalFeeders: 2,
        totalDts: 2,
        totalMeters: 2,
      });

      expect(res.body.data.zones).toHaveLength(2);
      const zone1 = res.body.data.zones.find((z: any) => z.code === "Z-01");
      expect(zone1).toBeDefined();
      expect(zone1.type).toBe("zone");
      expect(zone1.children[0].type).toBe("circle");
    });
  });
});
