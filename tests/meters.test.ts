import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { portalClient } from "../src/services/portal-client.js";
import { meterService } from "../src/services/meter.service.js";

describe("Meters API Routes", () => {
  beforeEach(() => {
    meterService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/meters", () => {
    it("returns paginated meter list with default pagination", async () => {
      vi.spyOn(portalClient, "searchMeters").mockResolvedValueOnce({
        data: [
          {
            meterId: "J100000",
            serialNo: "SE33962",
            make: "HPL",
            phaseType: "single",
            installStatus: "Decommissioned",
            dtCode: "DT-001",
          },
          {
            meterId: "J100001",
            serialNo: "GE84132",
            make: "L&T",
            phaseType: "single",
            installStatus: "Installed",
            dtCode: "DT-002",
          },
        ],
        total: 403,
      });

      const res = await request(app).get("/api/meters");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({
        meterId: "J100000",
        serialNo: "SE33962",
        make: "HPL",
        phaseType: "single",
        installStatus: "Decommissioned",
        dtCode: "DT-001",
      });
      expect(res.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 403,
        totalPages: 21,
      });
    });

    it("passes search query and page to portal client", async () => {
      const searchSpy = vi
        .spyOn(portalClient, "searchMeters")
        .mockResolvedValueOnce({ data: [], total: 0 });

      const res = await request(app).get("/api/meters?q=J100&page=3");

      expect(res.status).toBe(200);
      expect(searchSpy).toHaveBeenCalledWith("J100", 3);
      expect(res.body.pagination.page).toBe(3);
    });

    it("returns 400 validation error for negative or invalid page", async () => {
      const res = await request(app).get("/api/meters?page=-5");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/meters/:id", () => {
    it("returns single meter detail with geo and network hierarchy", async () => {
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
              dt: { name: "Malviya Nagar DT 1", code: "DT-001" },
            },
            geo: { lat: 26.9389, lng: 75.8309 },
          },
        ],
        total: 1,
      });

      const res = await request(app).get("/api/meters/J100000");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data.meterId).toBe("J100000");
      expect(res.body.data.serialNo).toBe("SE33962");
      expect(res.body.data.installType).toBe("Whole Current");
      expect(res.body.data.geo).toEqual({ latitude: 26.9389, longitude: 75.8309 });
      expect(res.body.data.hierarchy.zone).toEqual({ name: "Jaipur Zone 1", code: "Z-01" });
    });

    it("returns 404 when meter ID does not exist", async () => {
      vi.spyOn(portalClient, "exportMeters").mockResolvedValueOnce({
        data: [],
        total: 0,
      });
      vi.spyOn(portalClient, "getMeterGeo").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/meters/NONEXISTENT");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(res.body.error.message).toContain("NONEXISTENT");
    });
  });

  describe("GET /api/meters/:id/consumption", () => {
    it("returns normalized interval readings with parsed numeric units", async () => {
      vi.spyOn(portalClient, "getMeterEnergy").mockResolvedValueOnce([
        {
          timestamp: "23/06/2026 23:30",
          kwh: "48438.74",
          kvah: "52313.84",
          voltR: "226",
        },
        {
          timestamp: "24/06/2026 00:00",
          kwh: "48440.10",
          kvah: "52315.00",
          voltR: "228",
        },
      ]);

      const res = await request(app).get("/api/meters/J100000/consumption");

      expect(res.status).toBe(200);
      expect(res.body.data.meterId).toBe("J100000");
      expect(res.body.data.totalReadings).toBe(2);
      expect(res.body.data.readings).toHaveLength(2);
      expect(res.body.data.readings[0]).toEqual({
        timestamp: "23/06/2026 23:30",
        kwh: 48438.74,
        kvah: 52313.84,
        voltageR: 226,
      });
    });

    it("supports optional limit query parameter", async () => {
      vi.spyOn(portalClient, "getMeterEnergy").mockResolvedValueOnce([
        { timestamp: "1", kwh: "10", kvah: "10", voltR: "220" },
        { timestamp: "2", kwh: "20", kvah: "20", voltR: "220" },
        { timestamp: "3", kwh: "30", kvah: "30", voltR: "220" },
      ]);

      const res = await request(app).get("/api/meters/J100000/consumption?limit=2");

      expect(res.status).toBe(200);
      expect(res.body.data.totalReadings).toBe(3);
      expect(res.body.data.readings).toHaveLength(2);
    });

    it("returns 400 validation error for negative limit", async () => {
      const res = await request(app).get("/api/meters/J100000/consumption?limit=-1");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 validation error for invalid date format", async () => {
      const res = await request(app).get("/api/meters/J100000/consumption?from=invalid");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("filters consumption readings by date range (from/to) and computes telemetry summary", async () => {
      vi.spyOn(portalClient, "getMeterEnergy").mockResolvedValueOnce([
        { timestamp: "23/06/2026 22:00", kwh: "48400.00", kvah: "52280.00", voltR: "220" },
        { timestamp: "24/06/2026 10:00", kwh: "48420.50", kvah: "52300.00", voltR: "230" },
        { timestamp: "25/06/2026 14:00", kwh: "48450.75", kvah: "52330.00", voltR: "240" },
        { timestamp: "28/06/2026 08:00", kwh: "48500.00", kvah: "52380.00", voltR: "235" },
      ]);

      // Request window: 24/06/2026 to 26/06/2026
      const res = await request(app).get(
        "/api/meters/J100000/consumption?from=2026-06-24&to=2026-06-26"
      );

      expect(res.status).toBe(200);
      expect(res.body.data.totalReadings).toBe(4);
      expect(res.body.data.filteredCount).toBe(2);
      expect(res.body.data.readings).toHaveLength(2);
      expect(res.body.data.readings[0].timestamp).toBe("24/06/2026 10:00");
      expect(res.body.data.readings[1].timestamp).toBe("25/06/2026 14:00");

      // Verify computed analytics summary
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.summary.activeEnergyKwh).toEqual({
        start: 48420.5,
        end: 48450.75,
        totalConsumed: 30.25, // 48450.75 - 48420.50
      });
      expect(res.body.data.summary.voltageStats).toEqual({
        min: 230,
        max: 240,
        avg: 235,
      });
    });
  });

  describe("GET /api/meters/query", () => {
    const mockMeters = [
      {
        meterId: "J100000",
        serialNo: "SE33962",
        make: "HPL",
        phaseType: "single",
        installStatus: "Decommissioned",
        installType: "Whole Current",
        build: "legacy",
        dtCode: "DT-001",
        hierarchy: { feeder: { code: "F-001", name: "Feeder 1" } },
        geo: { lat: 26.9389, lng: 75.8309 },
      },
      {
        meterId: "J100001",
        serialNo: "GE84132",
        make: "L&T",
        phaseType: "three",
        installStatus: "Installed",
        installType: "CT Operated",
        build: "legacy",
        dtCode: "DT-002",
        hierarchy: { feeder: { code: "F-002", name: "Feeder 2" } },
        geo: { lat: 26.85, lng: 75.76 },
      },
    ];

    it("filters meters by multiple attributes (make, phaseType, dtCode)", async () => {
      vi.spyOn(portalClient, "exportMeters").mockResolvedValueOnce({
        data: mockMeters,
        total: 2,
      });

      const res = await request(app).get(`/api/meters/query?make=${encodeURIComponent("L&T")}&phaseType=three`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].meterId).toBe("J100001");
      expect(res.body.pagination.total).toBe(1);
    });

    it("filters by geo-proximity and calculates distanceKm sorted ascending", async () => {
      vi.spyOn(portalClient, "exportMeters").mockResolvedValueOnce({
        data: mockMeters,
        total: 2,
      });

      // Target very close to J100000 (26.9389, 75.8309) with radius 2 km
      const res = await request(app).get(
        "/api/meters/query?nearLat=26.938&nearLng=75.830&maxDistanceKm=2"
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].meterId).toBe("J100000");
      expect(typeof res.body.data[0].distanceKm).toBe("number");
      expect(res.body.data[0].distanceKm).toBeLessThan(2);
    });

    it("returns 400 validation error for invalid latitude", async () => {
      const res = await request(app).get("/api/meters/query?nearLat=150&nearLng=75");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
