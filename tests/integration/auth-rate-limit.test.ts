import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  requestPasswordResetAction,
  resendVerificationCodeAction,
  signInAction,
} from "@/app/(auth)/actions";
import { getDb } from "@/lib/db";

import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

// Rate limiting is off under NODE_ENV=test; this file opts in before the auth
// instance is created (it is built lazily on first use, per test file).
vi.stubEnv("AUTH_RATE_LIMIT", "on");
afterAll(() => {
  vi.unstubAllEnvs();
});

async function runAction(action: Promise<unknown>) {
  try {
    return await action;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return { redirectedTo: digest.split(";")[2] };
    throw error;
  }
}

const EMAIL = "victim@example.com";

beforeEach(async () => {
  // A verified account to guess against (created directly: sign-up is rate limited here too;
  // tables are emptied before each test).
  await getDb().user.create({
    data: { id: "victim", name: "Victim", email: EMAIL, emailVerified: true },
  });
});

describe("authentication Server Actions are rate limited (regression: audit H1)", () => {
  it("stops password guessing through the sign-in form after 5 attempts per minute", async () => {
    actAs(undefined);
    const results = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      results.push(
        await runAction(signInAction({ email: EMAIL, password: `guess-number-${attempt}` })),
      );
    }
    const codes = results.map((result) => (result as { error?: { code: string } }).error?.code);
    // Better Auth's /sign-in/email rule (5 per 60 s) now applies to the form as well.
    expect(codes.slice(0, 5).every((code) => code === "UNAUTHENTICATED")).toBe(true);
    expect(codes.slice(5)).toEqual(["RATE_LIMITED", "RATE_LIMITED", "RATE_LIMITED"]);
  });

  it("stops password-reset email flooding after 3 requests per minute", async () => {
    actAs(undefined);
    const results = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      results.push(await runAction(requestPasswordResetAction({ email: EMAIL })));
    }
    expect(results.slice(0, 3)).toEqual(Array(3).fill({ ok: true, data: undefined }));
    expect(results.slice(3)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "RATE_LIMITED" }),
      }),
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "RATE_LIMITED" }),
      }),
    ]);
  });

  it("stops verification-code flooding after 5 requests per minute", async () => {
    actAs(undefined);
    const results = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      results.push(await runAction(resendVerificationCodeAction({ email: "someone@example.com" })));
    }
    const limited = results.filter(
      (result) => (result as { error?: { code: string } }).error?.code === "RATE_LIMITED",
    );
    expect(limited).toHaveLength(2);
  });
});

describe("rate-limit counters are shared through the database (production readiness)", () => {
  it("a second server instance sees the same counters", async () => {
    actAs(undefined);
    for (let attempt = 0; attempt < 5; attempt++) {
      await runAction(signInAction({ email: EMAIL, password: `shared-guess-${attempt}` }));
    }
    const rows = await getDb().rateLimit.findMany();
    expect(rows.some((row) => row.key.endsWith("/sign-in/email") && row.count === 5)).toBe(true);

    // A fresh module graph = a separate Better Auth instance (another process in production).
    vi.resetModules();
    const { getAuth: otherInstance } = await import("@/server/auth/auth");
    const response = await otherInstance().handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "sixth-guess" }),
      }),
    );
    expect(response.status).toBe(429);
  });
});
