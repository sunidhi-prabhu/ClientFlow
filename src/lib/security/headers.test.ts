import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

async function headersFor(source: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  return Object.fromEntries(
    rules
      .filter((rule) => rule.source === source)
      .flatMap((rule) => rule.headers)
      .map(({ key, value }) => [key, value]),
  );
}

describe("static security headers (next.config.ts)", () => {
  it("applies clickjacking, MIME-sniffing and referrer protection to every response", async () => {
    expect(await headersFor("/:path*")).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("gives API responses a deny-all CSP", async () => {
    expect(await headersFor("/api/:path*")).toEqual({
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
  });
});
