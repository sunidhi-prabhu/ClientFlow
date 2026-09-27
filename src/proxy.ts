import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { pageContentSecurityPolicy } from "@/lib/security/headers";

/** Path segments whose pages need a signed-in user. */
const PROTECTED_PATHS = ["/o", "/onboarding"];

function isProtected(pathname: string) {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Runs before every page request:
 * 1. Generates a per-request nonce and sets the page Content-Security-Policy
 *    (Next.js reads the nonce from the request header and applies it to its
 *    own scripts).
 * 2. Redirects obviously signed-out visitors away from protected pages.
 *    This only checks that a session cookie is present. It is NOT the
 *    security boundary: pages, actions and routes validate the session in
 *    the database (requireSession / getTenantContext).
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = pageContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    isHttps: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  });

  if (isProtected(request.nextUrl.pathname) && !getSessionCookie(request)) {
    const response = NextResponse.redirect(new URL("/sign-in", request.url));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes get their own CSP (next.config.ts), static
      // assets need none, and prefetches reuse the page's policy.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
