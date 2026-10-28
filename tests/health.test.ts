import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("Health API Route", () => {
  it("GET /health should return 200 with status ok and uptime", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("uptime");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET /non-existent-route should return 404 with standard error structure", async () => {
    const res = await request(app).get("/non-existent-route");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
    expect(res.body.error).toHaveProperty("message");
  });

  it("GET / with Accept: text/html returns modern web client SPA", async () => {
    const res = await request(app)
      .get("/")
      .set("Accept", "text/html");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Urja Meter Ops");
    expect(res.text).toContain("telemetryChart");
  });

  it("GET / with Accept: application/json returns API index", async () => {
    const res = await request(app)
      .get("/")
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("service");
    expect(res.body).toHaveProperty("endpoints");
    expect(res.body.endpoints).toHaveProperty("meters");
  });
});
