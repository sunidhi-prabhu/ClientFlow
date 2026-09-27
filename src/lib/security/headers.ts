/**
 * HTTP security headers. Static headers are applied to every response by
 * next.config.ts; the page Content-Security-Policy needs a per-request nonce
 * and is set by src/proxy.ts. Exceptions are documented in
 * docs/architecture.md ("Security headers").
 */

type Header = { key: string; value: string };

export function staticSecurityHeaders({ isProduction }: { isProduction: boolean }): Header[] {
  const headers: Header[] = [
    // Clickjacking: never render inside a frame (legacy header; CSP
    // frame-ancestors covers modern browsers).
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    // Google sign-in is a full-page redirect, not a popup, so a strict
    // opener policy does not interfere with it.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }
  return headers;
}

/** CSP for JSON API responses: nothing may load or frame them. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * CSP for HTML pages.
 *
 * - Scripts: only those carrying this request's nonce ('strict-dynamic' lets
 *   Next.js's nonce-bearing loader load its chunks). Development adds
 *   'unsafe-eval', which React uses for debugging; never in production.
 * - Styles: 'unsafe-inline' is required because React/UI primitives set
 *   inline `style` attributes, which nonces cannot cover. Style injection is
 *   far lower risk than script injection.
 * - form-action: Google is allowed because the "Continue with Google" form
 *   can end in a redirect to accounts.google.com when JavaScript is off.
 * - frame-ancestors 'none': clickjacking protection.
 * - upgrade-insecure-requests only when the app is served over HTTPS; on
 *   plain-HTTP hosts (e.g. `npm start` on localhost) it would break assets.
 */
export function pageContentSecurityPolicy({
  nonce,
  isDevelopment,
  isHttps,
}: {
  nonce: string;
  isDevelopment: boolean;
  isHttps: boolean;
}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ];
  if (isHttps) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
