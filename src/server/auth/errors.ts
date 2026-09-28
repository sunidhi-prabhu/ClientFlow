import "server-only";

import { isAPIError } from "better-auth/api";

import { AppError, BadRequestError, RateLimitedError, ValidationError } from "@/lib/errors";

/** A non-2xx response from a Better Auth endpoint called through its handler (see endpoint.ts). */
export class AuthEndpointError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: { code?: unknown; message?: unknown } | undefined,
  ) {
    super(typeof body?.message === "string" ? body.message : `Auth request failed (${statusCode})`);
    this.name = "AuthEndpointError";
  }
}

/**
 * Convert a Better Auth `APIError` (or `AuthEndpointError`) into the application error model. Better
 * Auth messages are written for end users (e.g. "Invalid email or password")
 * and never contain secrets; its error `code` is passed as `details.reason` so
 * the UI can react (e.g. EMAIL_NOT_VERIFIED). Anything else is returned as-is
 * for `toAppError` to handle.
 */
export function fromAuthError(error: unknown): unknown {
  if (!isAPIError(error) && !(error instanceof AuthEndpointError)) return error;

  const message = typeof error.body?.message === "string" ? error.body.message : "Request failed";
  const details = typeof error.body?.code === "string" ? { reason: error.body.code } : undefined;

  switch (error.statusCode) {
    case 400:
      return new BadRequestError(message, { details });
    case 401:
      return new AppError("UNAUTHENTICATED", message, 401, { details });
    case 403:
      return new AppError("FORBIDDEN", message, 403, { details });
    case 422:
      return new ValidationError(message, { details });
    case 429:
      return new RateLimitedError();
    default:
      return error;
  }
}
