import { NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/api/handle-error";
import { getHealthReport } from "@/server/health";

/**
 * GET /api/health
 * Liveness + readiness probe. Returns 200 when all dependencies are healthy,
 * 503 otherwise. Public and unauthenticated; exposes no internal details.
 */
export const GET = withErrorHandling(async () => {
  const report = await getHealthReport();
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
});
