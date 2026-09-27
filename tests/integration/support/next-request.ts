/**
 * Stand-in for `next/headers` in integration tests. Test files opt in with:
 *
 *   vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);
 *
 * and then `actAs(cookie)` / `actAs(undefined)` to choose the signed-in user.
 * Everything downstream (Better Auth session lookup, tenant context, RBAC)
 * runs for real against the database.
 */
const state = { headers: new Headers() };

export function actAs(cookie: string | undefined) {
  state.headers = new Headers(cookie ? { cookie } : {});
}

export const nextHeaders = {
  headers: async () => state.headers,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
  }),
};
