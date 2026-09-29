import type { NextConfig } from "next";

import { API_CONTENT_SECURITY_POLICY, staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  logging: {
    // `next dev` otherwise prints every Server Action call with its arguments,
    // i.e. passwords, verification codes and reset tokens from the auth forms.
    serverFunctions: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders({ isProduction: process.env.NODE_ENV === "production" }),
      },
      {
        // Pages get a nonce-based CSP from src/proxy.ts.
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
      },
    ];
  },
};

export default nextConfig;
