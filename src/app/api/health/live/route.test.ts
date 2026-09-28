import { describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("@/lib/db", () => ({ getDb }));

describe("GET /api/health/live", () => {
  it("answers without touching the database", async () => {
    const { GET } = await import("./route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(getDb).not.toHaveBeenCalled();
  });
});
