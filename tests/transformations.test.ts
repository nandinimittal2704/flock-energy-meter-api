import { describe, it, expect, vi } from "vitest";
import { MeterService } from "../src/services/meter.service.js";
import { TransformerService } from "../src/services/transformer.service.js";
import { PortalClient } from "../src/services/portal-client.js";

describe("Data Transformation & Normalization Tests", () => {
  describe("Consumption Normalization", () => {
    it("safely handles non-numeric strings, empty values, and nulls without throwing", async () => {
      const mockClient = {
        getMeterEnergy: vi.fn().mockResolvedValue([
          { timestamp: "01/01/2026 00:00", kwh: "123.45", kvah: "140.20", voltR: "230" },
          { timestamp: "01/01/2026 00:30", kwh: "invalid-number", kvah: "", voltR: "N/A" },
          { timestamp: "01/01/2026 01:00", kwh: null as any, kvah: undefined as any, voltR: "225" },
        ]),
      } as unknown as PortalClient;

      const service = new MeterService(mockClient);
      const result = await service.getMeterConsumption("J100000");

      expect(result.totalReadings).toBe(3);
      expect(result.readings[0]).toEqual({
        timestamp: "01/01/2026 00:00",
        kwh: 123.45,
        kvah: 140.2,
        voltageR: 230,
      });

      // Invalid values should be normalized to null rather than NaN
      expect(result.readings[1]).toEqual({
        timestamp: "01/01/2026 00:30",
        kwh: null,
        kvah: null,
        voltageR: null,
      });

      expect(result.readings[2]).toEqual({
        timestamp: "01/01/2026 01:00",
        kwh: null,
        kvah: null,
        voltageR: 225,
      });
    });
  });

  describe("Pagination Calculations", () => {
    it("correctly calculates totalPages for exact multiples and remainders", async () => {
      const mockClient = {
        searchMeters: vi.fn().mockResolvedValue({ data: [], total: 403 }),
      } as unknown as PortalClient;

      const service = new MeterService(mockClient);
      const res = await service.listMeters("", 1);

      // 403 items / 20 per page = 21 pages
      expect(res.pagination.totalPages).toBe(21);
      expect(res.pagination.pageSize).toBe(20);
    });

    it("returns at least 1 totalPage even if total items is 0", async () => {
      const mockClient = {
        searchMeters: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      } as unknown as PortalClient;

      const service = new MeterService(mockClient);
      const res = await service.listMeters("no-match", 1);

      expect(res.pagination.totalPages).toBe(1);
      expect(res.pagination.total).toBe(0);
    });
  });

  describe("Hierarchy Tree Construction with Missing Data", () => {
    it("handles meters with missing or partial hierarchy levels gracefully", async () => {
      const mockMeterService = {
        getAllMetersCached: vi.fn().mockResolvedValue([
          {
            meterId: "J999",
            serialNo: "SN999",
            make: "TestMake",
            phaseType: "single",
            installStatus: "Installed",
            installType: "Direct",
            build: "modern",
            dtCode: "DT-ORPHAN",
            hierarchy: {
              // Missing zone, circle, division, substation
              feeder: { name: "Isolated Feeder", code: "F-99" },
              dt: { name: "Isolated DT", code: "DT-ORPHAN" },
            },
            geo: { lat: 26.0, lng: 75.0 },
          },
        ]),
      } as unknown as MeterService;

      const mockClient = {
        getDistributionTransformers: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      } as unknown as PortalClient;

      const service = new TransformerService(mockClient, mockMeterService);
      const hierarchy = await service.getNetworkHierarchy();

      expect(hierarchy.statistics.totalMeters).toBe(1);
      expect(hierarchy.zones).toHaveLength(1);
      expect(hierarchy.zones[0].code).toBe("Z-UNKNOWN");
      expect(hierarchy.zones[0].name).toBe("Unknown Zone");
    });
  });
});
