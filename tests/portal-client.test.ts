import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PortalClient } from "../src/services/portal-client.js";
import {
  AuthenticationError,
  NotFoundError,
  PortalError,
} from "../src/middleware/error-handler.js";

describe("PortalClient Unit Tests (Mocked Upstream)", () => {
  const originalFetch = globalThis.fetch;
  let client: PortalClient;

  beforeEach(() => {
    client = new PortalClient({
      baseUrl: "https://mock.portal.local",
      email: "test@example.com",
      password: "secret-password",
      timeoutMs: 1000,
      maxRetries: 1,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("authenticates and retrieves meter search list", async () => {
    const mockFetch = vi.fn();

    // 1. Login response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "redirect", status: 303 }), {
        status: 200,
        headers: {
          "Set-Cookie":
            "__Secure-better-auth.session_token=mock-token-xyz; Path=/; HttpOnly; Secure",
          "Content-Type": "application/json",
        },
      })
    );

    // 2. Meters search response
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              meterId: "J100000",
              serialNo: "SE33962",
              make: "HPL",
              phaseType: "single",
              installStatus: "Decommissioned",
              dtCode: "DT-001",
            },
          ],
          total: 1,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    globalThis.fetch = mockFetch;

    const result = await client.searchMeters("J100", 1);

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].meterId).toBe("J100000");

    // Verify login was called with Origin header and URL-encoded credentials
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const loginCall = mockFetch.mock.calls[0];
    expect(loginCall[0]).toBe("https://mock.portal.local/login");
    expect(loginCall[1].headers.Origin).toBe("https://mock.portal.local");

    // Verify search was called with session Cookie
    const searchCall = mockFetch.mock.calls[1];
    expect(searchCall[0]).toBe("https://mock.portal.local/portal/meters/search?q=J100&page=1");
    expect(searchCall[1].headers.Cookie).toContain("__Secure-better-auth.session_token=mock-token-xyz");
  });

  it("throws AuthenticationError if login fails with 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(client.searchMeters()).rejects.toThrow(AuthenticationError);
  });

  it("throws NotFoundError when portal returns 404 for meter geo", async () => {
    const mockFetch = vi.fn();

    // Login success
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=tok; Path=/",
        },
      })
    );

    // 404 response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not_found", message: "Meter not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    globalThis.fetch = mockFetch;

    await expect(client.getMeterGeo("NONEXISTENT")).rejects.toThrow(NotFoundError);
  });

  it("computes HMAC-SHA256 signature and includes headers for exportMeters", async () => {
    const mockFetch = vi.fn();

    // 1. Login
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=tok; Path=/",
        },
      })
    );

    // 2. /portal/keys
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { signingSecret: "test-secret-123" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // 3. /portal/export?page=1
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
          total: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    globalThis.fetch = mockFetch;

    const result = await client.exportMeters(1);

    expect(result.total).toBe(1);
    expect(result.data[0].meterId).toBe("J100000");

    // Verify export call headers contained x-timestamp and x-signature
    const exportCall = mockFetch.mock.calls[2];
    expect(exportCall[0]).toBe("https://mock.portal.local/portal/export?page=1");
    expect(exportCall[1].headers).toHaveProperty("x-timestamp");
    expect(exportCall[1].headers).toHaveProperty("x-signature");
    expect(typeof exportCall[1].headers["x-signature"]).toBe("string");
    expect(exportCall[1].headers["x-signature"].length).toBe(64); // SHA-256 hex string length
  });

  it("handles session expiry with re-authentication and retry", async () => {
    const mockFetch = vi.fn();

    // Initial Login
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=token-1; Path=/",
        },
      })
    );

    // First request returns 303 redirect to /login (session expired upstream)
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        status: 303,
        headers: { location: "/login" },
      })
    );

    // Re-login
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=token-2; Path=/",
        },
      })
    );

    // Retried request succeeds
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    globalThis.fetch = mockFetch;

    const result = await client.searchMeters();
    expect(result.total).toBe(0);
    // 4 calls: login -> search (303) -> re-login -> search (200)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
