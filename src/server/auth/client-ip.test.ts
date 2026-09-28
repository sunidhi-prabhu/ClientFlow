import { getIP } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { clientIpOptions } from "./client-ip";

// Better Auth's own resolver, with ClientFlow's options.
const ipFor = (headers: Record<string, string>, env: Parameters<typeof clientIpOptions>[0]) =>
  getIP(new Headers(headers), { advanced: { ipAddress: clientIpOptions(env) } });

describe("client IP resolution", () => {
  it("with trusted proxies, ignores addresses a client prepends to X-Forwarded-For", () => {
    const env = { AUTH_CLIENT_IP_HEADER: undefined, AUTH_TRUSTED_PROXIES: ["10.0.0.0/8"] };
    // The proxy appended the real client (198.51.100.7) and itself (10.0.0.2).
    expect(ipFor({ "x-forwarded-for": "198.51.100.7, 10.0.0.2" }, env)).toBe("198.51.100.7");
    // A forged leftmost value does not change the result.
    expect(ipFor({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" }, env)).toBe(
      "198.51.100.7",
    );
  });

  it("with a platform header, ignores X-Forwarded-For entirely", () => {
    const env = { AUTH_CLIENT_IP_HEADER: "x-real-ip", AUTH_TRUSTED_PROXIES: undefined };
    expect(ipFor({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" }, env)).toBe(
      "198.51.100.7",
    );
  });

  it("documents the default this replaces: a forged single-value header is trusted", () => {
    const env = { AUTH_CLIENT_IP_HEADER: undefined, AUTH_TRUSTED_PROXIES: undefined };
    expect(ipFor({ "x-forwarded-for": "6.6.6.6" }, env)).toBe("6.6.6.6");
  });
});
