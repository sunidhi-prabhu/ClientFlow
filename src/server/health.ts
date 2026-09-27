import "server-only";

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export type CheckStatus = "ok" | "error";

export type HealthReport = {
  status: CheckStatus;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: { status: CheckStatus; latencyMs?: number };
  };
};

const DATABASE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkDatabase(): Promise<HealthReport["checks"]["database"]> {
  const startedAt = performance.now();
  try {
    await withTimeout(getDb().$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS);
    return { status: "ok", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    // Details are logged, never returned: the health endpoint is public.
    logger.error("Health check: database unreachable", { error });
    return { status: "error" };
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const database = await checkDatabase();
  return {
    status: database.status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database },
  };
}
