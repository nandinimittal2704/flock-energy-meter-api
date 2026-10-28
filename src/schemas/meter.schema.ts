import { z } from "zod";

/* ──────────────────────────────────────────────
 * Portal response schemas
 *
 * These are based on verified portal responses,
 * not guesses. See PROTOCOL.md for evidence.
 * ─────────────────────────────────────────── */

// --- Meter list item (from /portal/meters/search) ---
export const portalMeterSearchItemSchema = z.object({
  meterId: z.string(),
  serialNo: z.string(),
  make: z.string(),
  phaseType: z.string(),
  installStatus: z.string(),
  dtCode: z.string(),
});

export type PortalMeterSearchItem = z.infer<typeof portalMeterSearchItemSchema>;

export const portalMeterSearchResponseSchema = z.object({
  data: z.array(portalMeterSearchItemSchema),
  total: z.number(),
});

// --- Meter detail (from /meters/[id]/__data.json SSR) ---
export const portalMeterDetailSchema = z.object({
  meterId: z.string(),
  serialNo: z.string(),
  make: z.string(),
  phaseType: z.string(),
  installStatus: z.string(),
  installType: z.string(),
});

// --- Meter hierarchy (from detail + export) ---
export const portalMeterHierarchySchema = z.object({
  zone: z.object({ name: z.string(), code: z.string() }).optional(),
  circle: z.object({ name: z.string(), code: z.string() }).optional(),
  division: z.object({ name: z.string(), code: z.string() }).optional(),
  subdivision: z.object({ name: z.string(), code: z.string() }).optional(),
  substation: z.object({ name: z.string(), code: z.string() }).optional(),
  feeder: z.object({ name: z.string(), code: z.string() }).optional(),
  dt: z.object({ name: z.string(), code: z.string() }).optional(),
});

// --- Full export record (from /portal/export) ---
export const portalExportMeterSchema = z.object({
  meterId: z.string(),
  serialNo: z.string(),
  make: z.string(),
  phaseType: z.string(),
  installStatus: z.string(),
  installType: z.string(),
  build: z.string(),
  dtCode: z.string(),
  hierarchy: portalMeterHierarchySchema,
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
});

export type PortalExportMeter = z.infer<typeof portalExportMeterSchema>;

export const portalExportResponseSchema = z.object({
  data: z.array(portalExportMeterSchema),
  total: z.number(),
});

// --- Geo location (from /portal/meters/:id/geo) ---
export const portalGeoSchema = z.object({
  data: z.object({
    latitude: z.string(),
    longitude: z.string(),
  }),
});

// --- Energy / consumption (from /portal/meters/:id/energy) ---
export const portalEnergyReadingSchema = z.object({
  timestamp: z.string(),
  kwh: z.string(),
  kvah: z.string(),
  voltR: z.string(),
});

export type PortalEnergyReading = z.infer<typeof portalEnergyReadingSchema>;

export const portalEnergyResponseSchema = z.object({
  data: z.array(portalEnergyReadingSchema),
});

// --- DT / Transformer (from /portal/dts) ---
export const portalDtSchema = z.object({
  code: z.string(),
  name: z.string(),
  feederCode: z.string(),
  capacityKva: z.number(),
});

export type PortalDt = z.infer<typeof portalDtSchema>;

export const portalDtsResponseSchema = z.object({
  data: z.array(portalDtSchema),
  total: z.number(),
});

// --- Signing keys (from /portal/keys) ---
export const portalKeysResponseSchema = z.object({
  data: z.object({
    signingSecret: z.string(),
  }),
});

// --- Portal error response ---
export const portalErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

/* ──────────────────────────────────────────────
 * API request/response schemas
 * ─────────────────────────────────────────── */

// Query params for meter list
export const meterListQuerySchema = z.object({
  q: z.string().optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
});

// Query params for transformer list
export const transformerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
});

// Normalized meter for API responses
export interface ApiMeterSummary {
  meterId: string;
  serialNo: string;
  make: string;
  phaseType: string;
  installStatus: string;
  dtCode: string;
}

export interface ApiMeterDetail {
  meterId: string;
  serialNo: string;
  make: string;
  phaseType: string;
  installStatus: string;
  installType: string;
  hierarchy: {
    zone?: { name: string; code: string };
    circle?: { name: string; code: string };
    division?: { name: string; code: string };
    subdivision?: { name: string; code: string };
    substation?: { name: string; code: string };
    feeder?: { name: string; code: string };
    dt?: { name: string; code: string };
  };
  geo: { latitude: number; longitude: number } | null;
}

export interface ApiEnergyReading {
  timestamp: string;
  kwh: number | null;
  kvah: number | null;
  voltageR: number | null;
}

export interface ApiConsumptionSummary {
  readingCount: number;
  period: {
    from: string | null;
    to: string | null;
  };
  activeEnergyKwh: {
    start: number | null;
    end: number | null;
    totalConsumed: number | null;
  };
  voltageStats: {
    min: number | null;
    max: number | null;
    avg: number | null;
  };
}

export function isValidDateFilter(val: string): boolean {
  if (!val || typeof val !== "string") return false;
  const ddmmyyyy = val.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (ddmmyyyy) return true;
  const yyyymmdd = val.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (yyyymmdd) return true;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

export const consumptionQuerySchema = z.object({
  limit: z.coerce.number().int().positive("limit must be positive").optional(),
  from: z
    .string()
    .refine(isValidDateFilter, {
      message: "Invalid date format for 'from'. Expected YYYY-MM-DD or DD/MM/YYYY",
    })
    .optional(),
  to: z
    .string()
    .refine(isValidDateFilter, {
      message: "Invalid date format for 'to'. Expected YYYY-MM-DD or DD/MM/YYYY",
    })
    .optional(),
  summary: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? true : val !== "false")),
});

export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;

export interface ApiTransformer {
  code: string;
  name: string;
  feederCode: string;
  capacityKva: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// Multi-attribute and geo-proximity query schema
export const advancedMeterQuerySchema = z.object({
  make: z.string().optional(),
  phaseType: z.enum(["single", "three"]).optional(),
  installStatus: z.string().optional(),
  dtCode: z.string().optional(),
  feederCode: z.string().optional(),
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
  maxDistanceKm: z.coerce.number().positive().default(5).optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

export type AdvancedMeterQuery = z.infer<typeof advancedMeterQuerySchema>;

export interface ApiMeterQueryResult extends ApiMeterSummary {
  installType: string;
  feederCode?: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  distanceKm?: number;
}

