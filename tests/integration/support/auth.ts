import { getDb } from "@/lib/db";
import { getAuth } from "@/server/auth/auth";

import { latestVerificationCode } from "./outbox";

export const BASE_URL = "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";
const SESSION_COOKIE = "better-auth.session_token";

/** Call a Better Auth endpoint exactly as the browser would (same handler as /api/auth/*). */
export async function authFetch(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: BASE_URL });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return getAuth().handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

/** `name=value` for the session cookie set by a response, if any. */
export function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`) && pair !== `${SESSION_COOKIE}=`);
}

export function signUp(email: string, password = PASSWORD, name = "Test User") {
  return authFetch("/sign-up/email", { body: { email, password, name } });
}

export function signIn(email: string, password = PASSWORD) {
  return authFetch("/sign-in/email", { body: { email, password } });
}

export function verifyEmail(email: string, otp: string) {
  return authFetch("/email-otp/verify-email", { body: { email, otp } });
}

/** Session for a cookie, validated against the database (null if invalid/expired). */
export function getSessionFor(cookie: string) {
  return getAuth().api.getSession({ headers: new Headers({ cookie }) });
}

/** Sign up, verify via the emailed code (auto sign-in), return the user and session cookie. */
export async function createVerifiedUser(email: string, password = PASSWORD) {
  await signUp(email, password);
  const response = await verifyEmail(email, latestVerificationCode(email));
  const cookie = sessionCookie(response);
  if (response.status !== 200 || !cookie) {
    throw new Error(`Could not verify ${email}: ${response.status} ${await response.text()}`);
  }
  const user = await getDb().user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, email, cookie };
}
