import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  AuthenticationError,
  NotFoundError,
  PortalError,
} from "../middleware/error-handler.js";
import {
  portalMeterSearchResponseSchema,
  portalGeoSchema,
  portalEnergyResponseSchema,
  portalDtsResponseSchema,
  portalKeysResponseSchema,
  portalExportResponseSchema,
  type PortalMeterSearchItem,
  type PortalEnergyReading,
  type PortalDt,
  type PortalExportMeter,
} from "../schemas/meter.schema.js";

interface SessionInfo {
  cookieHeader: string;
  expiresAt: number; // Unix timestamp in ms
}

/**
 * Client for the legacy Urja Meter Ops portal.
 *
 * Handles:
 * - Session authentication & token caching
 * - Automatic re-authentication on session expiration
 * - Request timeouts and bounded retries
 * - Cryptographic HMAC signature generation for bulk exports
 * - Typed validation of all portal responses
 * - Sanitized logging (never leaks cookies, tokens, or passwords)
 */
export class PortalClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  private currentSession: SessionInfo | null = null;
  private sessionPromise: Promise<SessionInfo> | null = null;

  constructor(options?: {
    baseUrl?: string;
    email?: string;
    password?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    this.baseUrl = (options?.baseUrl ?? env.PORTAL_BASE_URL).replace(/\/+$/, "");
    this.email = options?.email ?? env.PORTAL_EMAIL;
    this.password = options?.password ?? env.PORTAL_PASSWORD;
    this.timeoutMs = options?.timeoutMs ?? env.PORTAL_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? env.PORTAL_MAX_RETRIES;
  }

  /* ──────────────────────────────────────────────
   * Authentication & Session Management
   * ─────────────────────────────────────────── */

  /**
   * Logs into the portal and extracts the session cookie.
   * Note: The portal requires an Origin header for SvelteKit CSRF verification.
   */
  private async authenticate(): Promise<SessionInfo> {
    logger.debug({ url: `${this.baseUrl}/login` }, "Authenticating with legacy portal");

    const body = new URLSearchParams({
      email: this.email,
      password: this.password,
    }).toString();

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/login`,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      throw new AuthenticationError(
        `Failed to reach portal login endpoint: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (res.status !== 200 && res.status !== 303) {
      throw new AuthenticationError(`Login failed with HTTP status ${res.status}`);
    }

    // Extract session cookie from Set-Cookie headers
    // Using getSetCookie() for standards compliance in Node.js fetch
    const rawSetCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie") || ""];

    let sessionToken = "";
    for (const cookieStr of rawSetCookies) {
      const match = cookieStr.match(/(__Secure-better-auth\.session_token=[^;]+)/);
      if (match) {
        sessionToken = match[1];
        break;
      }
    }

    if (!sessionToken) {
      logger.error("No __Secure-better-auth.session_token found in login response");
      throw new AuthenticationError("Session token missing in portal login response");
    }

    // Default portal session lifetime is 1 hour (Max-Age=3600); refresh conservatively after 50 minutes
    const lifetimeMs = 50 * 60 * 1000;
    const session: SessionInfo = {
      cookieHeader: sessionToken,
      expiresAt: Date.now() + lifetimeMs,
    };

    this.currentSession = session;
    logger.info("Successfully authenticated with Urja portal; session established");
    return session;
  }

  /**
   * Returns a valid session cookie, authenticating or refreshing if necessary.
   * Concurrency-safe: multiple parallel requests share a single in-flight login.
   */
  private async getValidSession(forceRefresh = false): Promise<SessionInfo> {
    if (
      !forceRefresh &&
      this.currentSession &&
      Date.now() < this.currentSession.expiresAt
    ) {
      return this.currentSession;
    }

    // If an authentication request is already in progress, await it
    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = this.authenticate().finally(() => {
      this.sessionPromise = null;
    });

    return this.sessionPromise;
  }

  /* ──────────────────────────────────────────────
   * Core HTTP Request with Retries & Expiry Handling
   * ─────────────────────────────────────────── */

  /**
   * Executes an authenticated request with bounded retries and timeout.
   * If a request indicates session expiration, it clears the token and retries once.
   */
  private async request<T>(
    path: string,
    options: {
      headers?: Record<string, string>;
      retryCount?: number;
      isRetryAfterAuth?: boolean;
    } = {}
  ): Promise<T> {
    const retryCount = options.retryCount ?? 0;
    const session = await this.getValidSession();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Cookie: session.cookieHeader,
      Accept: "application/json",
      ...options.headers,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      if (retryCount < this.maxRetries) {
        logger.warn(
          { path, retryCount: retryCount + 1, error: err instanceof Error ? err.message : String(err) },
          "Portal request failed due to network error, retrying"
        );
        await new Promise((resolve) => setTimeout(resolve, 300 * Math.pow(2, retryCount)));
        return this.request<T>(path, { ...options, retryCount: retryCount + 1 });
      }
      throw new PortalError(
        `Failed to fetch from portal at ${path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Handle session expiry: SvelteKit returns 303 redirect to /login or 401
    const location = res.headers.get("location") || "";
    const isRedirectToLogin =
      (res.status === 303 || res.status === 302 || res.status === 307) &&
      location.includes("/login");

    if ((res.status === 401 || isRedirectToLogin) && !options.isRetryAfterAuth) {
      logger.warn({ path, status: res.status }, "Session expired or rejected; re-authenticating");
      this.currentSession = null;
      await this.getValidSession(true);
      return this.request<T>(path, { ...options, isRetryAfterAuth: true });
    }

    if (res.status === 404) {
      throw new NotFoundError(`Resource at ${path} not found in Urja portal`);
    }

    if (!res.ok) {
      // 5xx errors can be retried if under retry limit
      if (res.status >= 500 && retryCount < this.maxRetries) {
        logger.warn({ path, status: res.status, retryCount: retryCount + 1 }, "Portal 5xx error, retrying");
        await new Promise((resolve) => setTimeout(resolve, 300 * Math.pow(2, retryCount)));
        return this.request<T>(path, { ...options, retryCount: retryCount + 1 });
      }
      throw new PortalError(`Urja portal returned HTTP ${res.status} for ${path}`, res.status);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const preview = (await res.text()).slice(0, 200);
      throw new PortalError(
        `Urja portal returned unexpected non-JSON response for ${path} (${contentType}): ${preview}`
      );
    }

    return (await res.json()) as T;
  }

  /* ──────────────────────────────────────────────
   * Verified Portal Operations
   * ─────────────────────────────────────────── */

  /**
   * Searches meters with pagination.
   * Endpoint: GET /portal/meters/search?q={query}&page={page}
   */
  async searchMeters(
    query = "",
    page = 1
  ): Promise<{ data: PortalMeterSearchItem[]; total: number }> {
    const encodedQ = encodeURIComponent(query);
    const path = `/portal/meters/search?q=${encodedQ}&page=${page}`;
    const raw = await this.request<unknown>(path);

    const parsed = portalMeterSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, "Portal search response schema mismatch");
      throw new PortalError("Portal returned malformed meter search data");
    }

    return parsed.data;
  }

  /**
   * Retrieves geographic coordinates (latitude, longitude) for a meter.
   * Endpoint: GET /portal/meters/:id/geo
   */
  async getMeterGeo(
    meterId: string
  ): Promise<{ latitude: number; longitude: number } | null> {
    const path = `/portal/meters/${encodeURIComponent(meterId)}/geo`;
    try {
      const raw = await this.request<unknown>(path);
      const parsed = portalGeoSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ meterId, issues: parsed.error.issues }, "Portal geo response schema mismatch");
        return null;
      }
      const lat = parseFloat(parsed.data.data.latitude);
      const lng = parseFloat(parsed.data.data.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
      }
      return { latitude: lat, longitude: lng };
    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        throw err;
      }
      logger.warn({ meterId, err }, "Failed to fetch meter geo coordinates");
      return null;
    }
  }

  /**
   * Retrieves interval energy and consumption readings for a meter.
   * Endpoint: GET /portal/meters/:id/energy
   */
  async getMeterEnergy(meterId: string): Promise<PortalEnergyReading[]> {
    const path = `/portal/meters/${encodeURIComponent(meterId)}/energy`;
    const raw = await this.request<unknown>(path);

    const parsed = portalEnergyResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ meterId, issues: parsed.error.issues }, "Portal energy response schema mismatch");
      throw new PortalError("Portal returned malformed energy reading data");
    }

    return parsed.data.data;
  }

  /**
   * Retrieves paginated distribution transformers (DTs).
   * Endpoint: GET /portal/dts?page={page}
   */
  async getDistributionTransformers(
    page = 1
  ): Promise<{ data: PortalDt[]; total: number }> {
    const path = `/portal/dts?page=${page}`;
    const raw = await this.request<unknown>(path);

    const parsed = portalDtsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, "Portal DTs response schema mismatch");
      throw new PortalError("Portal returned malformed transformer data");
    }

    return parsed.data;
  }

  /**
   * Retrieves the HMAC signing secret for the bulk export endpoint.
   * Endpoint: GET /portal/keys
   */
  async getSigningSecret(): Promise<string> {
    const path = "/portal/keys";
    const raw = await this.request<unknown>(path);

    const parsed = portalKeysResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PortalError("Portal returned invalid signing keys payload");
    }

    return parsed.data.data.signingSecret;
  }

  /**
   * Exports all meters with full network hierarchy and coordinates.
   * Uses cryptographic HMAC-SHA256 signature over HTTP request details.
   * Endpoint: GET /portal/export?page={page}
   */
  async exportMeters(page = 1): Promise<{ data: PortalExportMeter[]; total: number }> {
    const signingSecret = await this.getSigningSecret();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const queryString = `page=${page}`;
    const message = ["GET", "/portal/export", queryString, timestamp].join("\n");

    const signature = createHmac("sha256", signingSecret)
      .update(message)
      .digest("hex");

    const path = `/portal/export?${queryString}`;
    const raw = await this.request<unknown>(path, {
      headers: {
        "x-timestamp": timestamp,
        "x-signature": signature,
      },
    });

    const parsed = portalExportResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, "Portal export response schema mismatch");
      throw new PortalError("Portal returned malformed export dataset");
    }

    return parsed.data;
  }
}

export const portalClient = new PortalClient();
