import { portalClient, PortalClient } from "./portal-client.js";
import { meterService, MeterService } from "./meter.service.js";
import type {
  ApiTransformer,
  PaginatedResponse,
} from "../schemas/meter.schema.js";

export interface NetworkTreeNode {
  code: string;
  name: string;
  type: "zone" | "circle" | "division" | "subdivision" | "substation" | "feeder" | "dt";
  capacityKva?: number;
  meterCount: number;
  children?: NetworkTreeNode[];
  meters?: Array<{
    meterId: string;
    serialNo: string;
    phaseType: string;
    installStatus: string;
  }>;
}

export interface NetworkSummary {
  statistics: {
    totalZones: number;
    totalCircles: number;
    totalDivisions: number;
    totalSubstations: number;
    totalFeeders: number;
    totalDts: number;
    totalMeters: number;
  };
  zones: NetworkTreeNode[];
}

/**
 * Service orchestrating Distribution Transformer (DT) queries
 * and multi-level Network Hierarchy reconstruction.
 */
export class TransformerService {
  constructor(
    private readonly client: PortalClient = portalClient,
    private readonly meters: MeterService = meterService
  ) {}

  /**
   * Retrieves paginated distribution transformers from the portal.
   */
  async listTransformers(page = 1): Promise<PaginatedResponse<ApiTransformer>> {
    const { data, total } = await this.client.getDistributionTransformers(page);
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const normalized: ApiTransformer[] = data.map((dt) => ({
      code: dt.code,
      name: dt.name,
      feederCode: dt.feederCode,
      capacityKva: dt.capacityKva,
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
   * Reconstructs the complete hierarchical distribution network:
   * Zone -> Circle -> Division -> Subdivision -> Substation -> Feeder -> DT -> Meter.
   *
   * Reconstructed from verified portal export dataset and DT records.
   */
  async getNetworkHierarchy(): Promise<NetworkSummary> {
    const allMeters = await this.meters.getAllMetersCached();
    const dtsMap = new Map<string, ApiTransformer>();

    // Try loading DT capacity metadata
    try {
      const dtPage1 = await this.client.getDistributionTransformers(1);
      for (const dt of dtPage1.data) {
        dtsMap.set(dt.code, dt);
      }
      if (dtPage1.total > 20) {
        const dtPage2 = await this.client.getDistributionTransformers(2);
        for (const dt of dtPage2.data) {
          dtsMap.set(dt.code, dt);
        }
      }
    } catch {
      // If transformer listing fails, hierarchy will proceed with meter data alone
    }

    // Build hierarchical tree
    const zonesMap = new Map<string, {
      code: string;
      name: string;
      circles: Map<string, {
        code: string;
        name: string;
        divisions: Map<string, {
          code: string;
          name: string;
          subdivisions: Map<string, {
            code: string;
            name: string;
            substations: Map<string, {
              code: string;
              name: string;
              feeders: Map<string, {
                code: string;
                name: string;
                dts: Map<string, {
                  code: string;
                  name: string;
                  capacityKva?: number;
                  meters: Array<{
                    meterId: string;
                    serialNo: string;
                    phaseType: string;
                    installStatus: string;
                  }>;
                }>;
              }>;
            }>;
          }>;
        }>;
      }>;
    }>();

    const uniqueCircles = new Set<string>();
    const uniqueDivisions = new Set<string>();
    const uniqueSubstations = new Set<string>();
    const uniqueFeeders = new Set<string>();
    const uniqueDts = new Set<string>();

    for (const m of allMeters) {
      const h = m.hierarchy;
      const zoneCode = h.zone?.code || "Z-UNKNOWN";
      const zoneName = h.zone?.name || "Unknown Zone";
      const circleCode = h.circle?.code || "C-UNKNOWN";
      const circleName = h.circle?.name || "Unknown Circle";
      const divCode = h.division?.code || "D-UNKNOWN";
      const divName = h.division?.name || "Unknown Division";
      const subDivCode = h.subdivision?.code || "SD-UNKNOWN";
      const subDivName = h.subdivision?.name || "Unknown Subdivision";
      const subStationCode = h.substation?.code || "SS-UNKNOWN";
      const subStationName = h.substation?.name || "Unknown Substation";
      const feederCode = h.feeder?.code || "F-UNKNOWN";
      const feederName = h.feeder?.name || "Unknown Feeder";
      const dtCode = h.dt?.code || m.dtCode || "DT-UNKNOWN";
      const dtName = h.dt?.name || `DT ${dtCode}`;

      uniqueCircles.add(circleCode);
      uniqueDivisions.add(divCode);
      uniqueSubstations.add(subStationCode);
      uniqueFeeders.add(feederCode);
      uniqueDts.add(dtCode);

      // Zone level
      if (!zonesMap.has(zoneCode)) {
        zonesMap.set(zoneCode, { code: zoneCode, name: zoneName, circles: new Map() });
      }
      const zone = zonesMap.get(zoneCode)!;

      // Circle level
      if (!zone.circles.has(circleCode)) {
        zone.circles.set(circleCode, { code: circleCode, name: circleName, divisions: new Map() });
      }
      const circle = zone.circles.get(circleCode)!;

      // Division level
      if (!circle.divisions.has(divCode)) {
        circle.divisions.set(divCode, { code: divCode, name: divName, subdivisions: new Map() });
      }
      const div = circle.divisions.get(divCode)!;

      // Subdivision level
      if (!div.subdivisions.has(subDivCode)) {
        div.subdivisions.set(subDivCode, { code: subDivCode, name: subDivName, substations: new Map() });
      }
      const subDiv = div.subdivisions.get(subDivCode)!;

      // Substation level
      if (!subDiv.substations.has(subStationCode)) {
        subDiv.substations.set(subStationCode, { code: subStationCode, name: subStationName, feeders: new Map() });
      }
      const subStation = subDiv.substations.get(subStationCode)!;

      // Feeder level
      if (!subStation.feeders.has(feederCode)) {
        subStation.feeders.set(feederCode, { code: feederCode, name: feederName, dts: new Map() });
      }
      const feeder = subStation.feeders.get(feederCode)!;

      // DT level
      if (!feeder.dts.has(dtCode)) {
        const capacity = dtsMap.get(dtCode)?.capacityKva;
        feeder.dts.set(dtCode, {
          code: dtCode,
          name: dtName,
          capacityKva: capacity,
          meters: [],
        });
      }
      const dt = feeder.dts.get(dtCode)!;

      dt.meters.push({
        meterId: m.meterId,
        serialNo: m.serialNo,
        phaseType: m.phaseType,
        installStatus: m.installStatus,
      });
    }

    // Convert nested map structure to typed array tree
    const zones: NetworkTreeNode[] = Array.from(zonesMap.values()).map((z) => {
      let zoneMeterCount = 0;
      const circles: NetworkTreeNode[] = Array.from(z.circles.values()).map((c) => {
        let circleMeterCount = 0;
        const divisions: NetworkTreeNode[] = Array.from(c.divisions.values()).map((d) => {
          let divMeterCount = 0;
          const subdivisions: NetworkTreeNode[] = Array.from(d.subdivisions.values()).map((sd) => {
            let sdMeterCount = 0;
            const substations: NetworkTreeNode[] = Array.from(sd.substations.values()).map((ss) => {
              let ssMeterCount = 0;
              const feeders: NetworkTreeNode[] = Array.from(ss.feeders.values()).map((f) => {
                let feederMeterCount = 0;
                const dts: NetworkTreeNode[] = Array.from(f.dts.values()).map((dt) => {
                  feederMeterCount += dt.meters.length;
                  return {
                    code: dt.code,
                    name: dt.name,
                    type: "dt",
                    capacityKva: dt.capacityKva,
                    meterCount: dt.meters.length,
                    meters: dt.meters,
                  };
                });
                ssMeterCount += feederMeterCount;
                return {
                  code: f.code,
                  name: f.name,
                  type: "feeder",
                  meterCount: feederMeterCount,
                  children: dts,
                };
              });
              sdMeterCount += ssMeterCount;
              return {
                code: ss.code,
                name: ss.name,
                type: "substation",
                meterCount: ssMeterCount,
                children: feeders,
              };
            });
            divMeterCount += sdMeterCount;
            return {
              code: sd.code,
              name: sd.name,
              type: "subdivision",
              meterCount: sdMeterCount,
              children: substations,
            };
          });
          circleMeterCount += divMeterCount;
          return {
            code: d.code,
            name: d.name,
            type: "division",
            meterCount: divMeterCount,
            children: subdivisions,
          };
        });
        zoneMeterCount += circleMeterCount;
        return {
          code: c.code,
          name: c.name,
          type: "circle",
          meterCount: circleMeterCount,
          children: divisions,
        };
      });

      return {
        code: z.code,
        name: z.name,
        type: "zone",
        meterCount: zoneMeterCount,
        children: circles,
      };
    });

    return {
      statistics: {
        totalZones: zonesMap.size,
        totalCircles: uniqueCircles.size,
        totalDivisions: uniqueDivisions.size,
        totalSubstations: uniqueSubstations.size,
        totalFeeders: uniqueFeeders.size,
        totalDts: uniqueDts.size,
        totalMeters: allMeters.length,
      },
      zones,
    };
  }
}

export const transformerService = new TransformerService();
