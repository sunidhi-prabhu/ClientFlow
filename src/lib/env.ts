import "server-only";

import { isIP } from "node:net";

import { z } from "zod";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** Encrypted transport to the database: required for any non-local database in production. */
function usesTls(databaseUrl: string) {
  const mode = new URL(databaseUrl).searchParams.get("sslmode");
  return mode === "require" || mode === "verify-ca" || mode === "verify-full";
}

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    }),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Connections per server process (keep instances × this below the database limit). */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Fail instead of waiting forever when the database is unreachable or the pool is exhausted. */
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    /** Server-side limit per statement, so a runaway query cannot hold a connection. */
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      LOCAL_HOSTS.includes(new URL(env.DATABASE_URL).hostname) ||
      usesTls(env.DATABASE_URL),
    {
      message:
        "DATABASE_URL must use TLS in production (add sslmode=require, verify-ca or verify-full)",
      path: ["DATABASE_URL"],
    },
  );

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseEnv<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/**
 * Validated server-side environment. Parsed lazily on first use so that
 * `next build` does not require runtime secrets, but any request that needs
 * configuration fails fast with a readable message if it is invalid.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema);
  return cached;
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** `10.0.0.0/8`, `203.0.113.7` or `2001:db8::/32`. */
function isIpOrCidr(entry: string) {
  const [address, prefix, ...rest] = entry.split("/");
  const family = isIP(address ?? "");
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

const authEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    /**
     * Client IP resolution (rate limiting, audit IPs). Either a header that
     * the platform's edge sets and overwrites (e.g. `cf-connecting-ip`), or
     * the reverse proxies whose addresses are stripped from the right of
     * `X-Forwarded-For`. Required in production: without it, a client can
     * choose its own IP (and rate-limit bucket) with a forged header.
     */
    AUTH_CLIENT_IP_HEADER: optionalString.pipe(
      z
        .string()
        .regex(/^[a-z0-9-]+$/, "AUTH_CLIENT_IP_HEADER must be a lowercase header name")
        .optional(),
    ),
    AUTH_TRUSTED_PROXIES: optionalString.transform((value, context) => {
      if (!value) return undefined;
      const entries = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const invalid = entries.filter((entry) => !isIpOrCidr(entry));
      if (invalid.length > 0) {
        context.addIssue({
          code: "custom",
          message: `AUTH_TRUSTED_PROXIES has invalid IP/CIDR entries: ${invalid.join(", ")}`,
        });
        return z.NEVER;
      }
      return entries;
    }),
    /** Tests only: rate limiting is off under NODE_ENV=test unless this is "on". */
    AUTH_RATE_LIMIT: optionalString.pipe(z.literal("on").optional()),
  })
  .refine((env) => Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET), {
    message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
    path: ["GOOGLE_CLIENT_ID"],
  })
  .refine(
    (env) => {
      if (env.NODE_ENV !== "production") return true;
      const url = new URL(env.BETTER_AUTH_URL);
      return url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname);
    },
    {
      message: "BETTER_AUTH_URL must use https:// in production (session cookies are Secure)",
      path: ["BETTER_AUTH_URL"],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      Boolean(env.AUTH_CLIENT_IP_HEADER) ||
      Boolean(env.AUTH_TRUSTED_PROXIES?.length),
    {
      message:
        "Set AUTH_CLIENT_IP_HEADER or AUTH_TRUSTED_PROXIES in production so client IPs cannot be forged (see docs/architecture.md, Rate limiting)",
      path: ["AUTH_TRUSTED_PROXIES"],
    },
  );

export type AuthEnv = z.infer<typeof authEnvSchema>;

let cachedAuth: AuthEnv | undefined;

/** Authentication configuration (Better Auth, OAuth providers). */
export function getAuthEnv(): AuthEnv {
  cachedAuth ??= parseEnv(authEnvSchema);
  return cachedAuth;
}

const emailEnvSchema = z.object({
  SMTP_URL: z.url().refine((value) => /^smtps?:\/\//.test(value), {
    message: "SMTP_URL must start with smtp:// or smtps://",
  }),
  EMAIL_FROM: z.string().min(3),
});

export type EmailEnv = z.infer<typeof emailEnvSchema>;

let cachedEmail: EmailEnv | undefined;

/** Outgoing email (verification codes, password reset links). */
export function getEmailEnv(): EmailEnv {
  cachedEmail ??= parseEnv(emailEnvSchema);
  return cachedEmail;
}
