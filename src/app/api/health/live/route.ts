import { NextResponse } from "next/server";

/**
 * GET /api/health/live
 * Liveness probe: the process is up and serving requests. It deliberately does
 * not touch the database, so an outage does not make an orchestrator restart
 * healthy instances; use /api/health (database check, 503) for readiness.
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
