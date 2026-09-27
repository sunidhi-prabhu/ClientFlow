import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: queryRaw }) }));

const { GET } = await import("@/app/api/health/route");
const { logger } = await import("@/lib/logger");

const request = () => new Request("http://localhost/api/health");

describe("GET /api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns 200 when the database responds", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      checks: { database: { status: "ok", latencyMs: expect.any(Number) } },
    });
  });

  it("returns 503 without leaking error details when the database is down", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    queryRaw.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "error", checks: { database: { status: "error" } } });
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("returns 503 when the database does not answer in time", async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    queryRaw.mockReturnValue(new Promise(() => {}));

    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(3000);
    const response = await pending;
    vi.useRealTimers();

    expect(response.status).toBe(503);
  });
});
