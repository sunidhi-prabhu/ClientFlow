import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { UnauthenticatedError } from "@/lib/errors";
import { getAuth } from "@/server/auth/auth";

export type AuthSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;

export type CurrentUser = AuthSession["user"];

/**
 * The current session, validated against the database (expired or revoked
 * sessions return null). Resolved once per request.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return getAuth().api.getSession({ headers: await headers() });
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await getSession())?.user ?? null;
}

/** For Server Actions, Route Handlers and services: throws 401 when signed out. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/** For pages and layouts: redirects to sign-in when signed out. */
export async function requireSessionOrRedirect(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
