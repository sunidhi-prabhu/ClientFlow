import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

function directives(csp: string | null) {
  return new Map(
    (csp ?? "").split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe("proxy: Content-Security-Policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets a nonce-based CSP on pages and passes the nonce to rendering", () => {
    const response = proxy(request("/sign-in"));
    const csp = response.headers.get("Content-Security-Policy");
    const scriptSrc = directives(csp).get("script-src") ?? [];
    const nonce = scriptSrc.find((value) => value.startsWith("'nonce-"))?.slice(7, -1);

    expect(nonce).toBeTruthy();
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("uses a fresh nonce for every request", () => {
    const first = proxy(request("/sign-in")).headers.get("Content-Security-Policy");
    const second = proxy(request("/sign-in")).headers.get("Content-Security-Policy");
    expect(first).not.toBe(second);
  });

  it("blocks framing, plugins and base-tag hijacking; limits form targets", () => {
    const csp = directives(proxy(request("/sign-in")).headers.get("Content-Security-Policy"));
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'", "https://accounts.google.com"]);
  });

  it("upgrades insecure requests only when the app URL is HTTPS", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    expect(proxy(request("/sign-in")).headers.get("Content-Security-Policy")).not.toContain(
      "upgrade-insecure-requests",
    );
    vi.stubEnv("BETTER_AUTH_URL", "https://app.clientflow.example");
    expect(proxy(request("/sign-in")).headers.get("Content-Security-Policy")).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("allows 'unsafe-eval' only in development", () => {
    const productionCsp = proxy(request("/sign-in")).headers.get("Content-Security-Policy");
    expect(productionCsp).not.toContain("unsafe-eval");

    vi.stubEnv("NODE_ENV", "development");
    const developmentCsp = proxy(request("/sign-in")).headers.get("Content-Security-Policy");
    expect(directives(developmentCsp).get("script-src")).toContain("'unsafe-eval'");
  });
});

describe("proxy: protected pages", () => {
  it.each(["/o/acme", "/o/acme/settings", "/onboarding"])(
    "redirects %s to sign-in without a session cookie",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
    },
  );

  it("lets requests with a session cookie through (the page then validates it)", () => {
    const response = proxy(request("/o/acme", "better-auth.session_token=abc.def"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email"])(
    "does not redirect public page %s",
    (path) => {
      expect(proxy(request(path)).headers.get("location")).toBeNull();
    },
  );

  it("does not treat look-alike paths as protected", () => {
    expect(proxy(request("/onboarding-guide")).headers.get("location")).toBeNull();
    expect(proxy(request("/organizations")).headers.get("location")).toBeNull();
  });
});
