import { portalClient, PortalClient } from "./portal-client.js";
import { NotFoundError } from "../middleware/error-handler.js";
import type {
  ApiMeterSummary,
  ApiMeterDetail,
  ApiEnergyReading,
  PaginatedResponse,
  PortalExportMeter,
  AdvancedMeterQuery,
  ApiMeterQueryResult,
  ConsumptionQuery,
  ApiConsumptionSummary,
} from "../schemas/meter.schema.js";

interface ExportCache {
  data: Map<string, PortalExportMeter>;
  allMeters: PortalExportMeter[];
  timestamp: number;
}

/**
 * Service orchestrating meter data retrieval, normalization,
 * search, and consumption aggregation.
 */
export class MeterService {
  private exportCache: ExportCache | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5-minute cache TTL for network hierarchy/details

  constructor(private readonly client: PortalClient = portalClient) {}

  /**
   * Helper to fetch and cache all meters with hierarchy and geo information.
   * Concurrency-safe, refreshed every 5 minutes.
   */
  async getAllMetersCached(): Promise<PortalExportMeter[]> {
    if (this.exportCache && Date.now() - this.exportCache.timestamp < this.cacheTtlMs) {
      return this.exportCache.allMeters;
    }

    const { data } = await this.client.exportMeters(1);
    const map = new Map<string, PortalExportMeter>();
    for (const meter of data) {
      map.set(meter.meterId, meter);
    }

    this.exportCache = {
      data: map,
      allMeters: data,
      timestamp: Date.now(),
    };

    return data;
  }

  /**
   * Lists meters with pagination and optional search filter.
   * Directly uses verified upstream search endpoint /portal/meters/search.
   */
  async listMeters(
    query = "",
    page = 1
  ): Promise<PaginatedResponse<ApiMeterSummary>> {
    const { data, total } = await this.client.searchMeters(query, page);
    const pageSize = 20; // Verified Urja portal default page size
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const normalized: ApiMeterSummary[] = data.map((item) => ({
      meterId: item.meterId,
      serialNo: item.serialNo,
      make: item.make,
      phaseType: item.phaseType,
      installStatus: item.installStatus,
      dtCode: item.dtCode,
    }));

    return {
      data: normalized,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /**
   * Retrieves complete details for a specific meter by ID,
   * including nameplate parameters, installation status, full network hierarchy,
   * and geographic coordinates.
   */
  async getMeterById(meterId: string): Promise<ApiMeterDetail> {
    const allMeters = await this.getAllMetersCached();
    const meter = allMeters.find((m) => m.meterId.toLowerCase() === meterId.toLowerCase());

    if (!meter) {
      // Fallback: check geo endpoint directly in case export is delayed or partial
      try {
        const geo = await this.client.getMeterGeo(meterId);
        if (!geo) {
          throw new NotFoundError(`Meter with ID '${meterId}' not found`);
        }
      } catch {
        throw new NotFoundError(`Meter with ID '${meterId}' not found`);
      }
      throw new NotFoundError(`Meter with ID '${meterId}' not found`);
    }

    return {
      meterId: meter.meterId,
      serialNo: meter.serialNo,
      make: meter.make,
      phaseType: meter.phaseType,
      installStatus: meter.installStatus,
      installType: meter.installType,
      hierarchy: meter.hierarchy,
      geo: {
        latitude: meter.geo.lat,
        longitude: meter.geo.lng,
      },
    };
  }

  /**
   * Retrieves interval consumption and voltage readings for a specific meter.
   * Supports optional date-range filtering (from/to), reading limits,
   * and telemetry analytics summary (total kWh consumed, min/max/avg voltage).
   */
  async getMeterConsumption(
    meterId: string,
    options?: Partial<ConsumptionQuery> | number
  ): Promise<{
    meterId: string;
    totalReadings: number;
    filteredCount: number;
    summary?: ApiConsumptionSummary;
    readings: ApiEnergyReading[];
  }> {
    // Normalise options if a plain number was passed (backward compatibility)
    const query: Partial<ConsumptionQuery> =
      typeof options === "number" ? { limit: options } : options ?? {};

    const rawReadings = await this.client.getMeterEnergy(meterId);

    const normalized: ApiEnergyReading[] = rawReadings.map((reading) => {
      const kwh = reading.kwh ? parseFloat(reading.kwh) : null;
      const kvah = reading.kvah ? parseFloat(reading.kvah) : null;
      const voltR = reading.voltR ? parseFloat(reading.voltR) : null;

      return {
        timestamp: reading.timestamp,
        kwh: Number.isNaN(kwh) ? null : kwh,
        kvah: Number.isNaN(kvah) ? null : kvah,
        voltageR: Number.isNaN(voltR) ? null : voltR,
      };
    });

    // Date range filtering
    let filtered = normalized;
    const fromDate = query.from ? parseDateFilter(query.from) : null;
    const toDate = query.to ? parseDateFilter(query.to) : null;

    if (fromDate || toDate) {
      filtered = filtered.filter((r) => {
        const d = parsePortalTimestamp(r.timestamp);
        if (!d) return true;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }

    // Telemetry summary calculation over the filtered window
    let summary: ApiConsumptionSummary | undefined;
    if (query.summary !== false && filtered.length > 0) {
      const validKwh = filtered.map((r) => r.kwh).filter((v): v is number => v !== null);
      const validVoltages = filtered
        .map((r) => r.voltageR)
        .filter((v): v is number => v !== null);

      const startKwh = validKwh[0] ?? null;
      const endKwh = validKwh[validKwh.length - 1] ?? null;
      const consumed =
        startKwh !== null && endKwh !== null
          ? Math.round((endKwh - startKwh) * 100) / 100
          : null;

      const minV = validVoltages.length ? Math.min(...validVoltages) : null;
      const maxV = validVoltages.length ? Math.max(...validVoltages) : null;
      const avgV = validVoltages.length
        ? Math.round(
            (validVoltages.reduce((a, b) => a + b, 0) / validVoltages.length) * 10
          ) / 10
        : null;

      summary = {
        readingCount: filtered.length,
        period: {
          from: filtered[0]?.timestamp ?? null,
          to: filtered[filtered.length - 1]?.timestamp ?? null,
        },
        activeEnergyKwh: {
          start: startKwh,
          end: endKwh,
          totalConsumed: consumed,
        },
        voltageStats: {
          min: minV,
          max: maxV,
          avg: avgV,
        },
      };
    }

    const readings =
      typeof query.limit === "number" && query.limit > 0
        ? filtered.slice(0, query.limit)
        : filtered;

    return {
      meterId,
      totalReadings: normalized.length,
      filteredCount: filtered.length,
      ...(summary ? { summary } : {}),
      readings,
    };
  }

  /**
   * Advanced multi-attribute search and geo-proximity query layer.
   * Supports filtering across make, phase, status, DT, feeder, and radius from coordinates.
   */
  async queryMeters(
    query: AdvancedMeterQuery
  ): Promise<PaginatedResponse<ApiMeterQueryResult>> {
    const allMeters = await this.getAllMetersCached();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // Filter across attributes
    let filtered = allMeters.filter((m) => {
      if (query.make && m.make.toLowerCase() !== query.make.toLowerCase()) {
        return false;
      }
      if (query.phaseType && m.phaseType.toLowerCase() !== query.phaseType.toLowerCase()) {
        return false;
      }
      if (
        query.installStatus &&
        m.installStatus.toLowerCase() !== query.installStatus.toLowerCase()
      ) {
        return false;
      }
      if (query.dtCode && m.dtCode.toLowerCase() !== query.dtCode.toLowerCase()) {
        return false;
      }
      if (
        query.feederCode &&
        m.hierarchy.feeder?.code.toLowerCase() !== query.feederCode.toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    // Geo-proximity calculation if coordinates provided
    let results: ApiMeterQueryResult[];
    if (typeof query.nearLat === "number" && typeof query.nearLng === "number") {
      const maxDist = query.maxDistanceKm ?? 5;
      const withDistance = filtered
        .map((m) => {
          const dist = haversineDistanceKm(
            query.nearLat!,
            query.nearLng!,
            m.geo.lat,
            m.geo.lng
          );
          return { meter: m, distanceKm: dist };
        })
        .filter((item) => item.distanceKm <= maxDist);

      // Sort by closest distance
      withDistance.sort((a, b) => a.distanceKm - b.distanceKm);

      results = withDistance.map(({ meter, distanceKm }) => ({
        meterId: meter.meterId,
        serialNo: meter.serialNo,
        make: meter.make,
        phaseType: meter.phaseType,
        installStatus: meter.installStatus,
        installType: meter.installType,
        dtCode: meter.dtCode,
        feederCode: meter.hierarchy.feeder?.code,
        coordinates: {
          latitude: meter.geo.lat,
          longitude: meter.geo.lng,
        },
        distanceKm,
      }));
    } else {
      // Natural sort by meterId
      filtered.sort((a, b) => a.meterId.localeCompare(b.meterId));
      results = filtered.map((meter) => ({
        meterId: meter.meterId,
        serialNo: meter.serialNo,
        make: meter.make,
        phaseType: meter.phaseType,
        installStatus: meter.installStatus,
        installType: meter.installType,
        dtCode: meter.dtCode,
        feederCode: meter.hierarchy.feeder?.code,
        coordinates: {
          latitude: meter.geo.lat,
          longitude: meter.geo.lng,
        },
      }));
    }

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedData = results.slice(offset, offset + pageSize);

    return {
      data: paginatedData,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /**
   * Clears internal cache (primarily for tests).
   */
  clearCache(): void {
    this.exportCache = null;
  }
}

/**
 * Calculates the great-circle distance between two points on Earth using the Haversine formula.
 * Returns distance in kilometers rounded to 2 decimal places.
 */
function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Parses timestamps in portal format "DD/MM/YYYY HH:mm" or ISO-8601 into a Date object.
 */
function parsePortalTimestamp(ts: string): Date | null {
  const match = ts.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (match) {
    const [, day, month, year, hours, minutes] = match;
    return new Date(Date.UTC(+year, +month - 1, +day, +hours, +minutes));
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parses query filter dates ("YYYY-MM-DD", "DD/MM/YYYY", or ISO strings) into a Date object.
 */
function parseDateFilter(str: string): Date | null {
  const ddmmyyyy = str.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(Date.UTC(+year, +month - 1, +day, 0, 0, 0));
  }
  const yyyymmdd = str.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return new Date(Date.UTC(+year, +month - 1, +day, 0, 0, 0));
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const meterService = new MeterService();

