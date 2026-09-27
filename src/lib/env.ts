import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "DATABASE_URL must be a PostgreSQL connection string",
  }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

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

const authEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
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
