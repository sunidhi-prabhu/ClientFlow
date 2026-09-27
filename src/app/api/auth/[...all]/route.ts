import { getAuth } from "@/server/auth/auth";

// Better Auth endpoints (sign-up, sign-in, sign-out, OAuth callbacks,
// verification, password reset). Resolved lazily so builds need no secrets.
export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
