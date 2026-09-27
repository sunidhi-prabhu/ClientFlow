/**
 * Application error model.
 *
 * Throw an `AppError` subclass for any *expected* failure (bad input, missing
 * record, insufficient permission). Its `code` and `message` are safe to show
 * to clients. Anything that is not an `AppError` is treated as an unexpected
 * bug: it is logged in full and reported to clients as a generic 500.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options?.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", options?: { details?: unknown; cause?: unknown }) {
    super("BAD_REQUEST", message, 400, options);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options?: { details?: unknown; cause?: unknown }) {
    super("VALIDATION_ERROR", message, 422, options);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", message, 403);
  }
}

/**
 * Also use this when a record exists but belongs to another organization,
 * so that responses never reveal the existence of other tenants' data.
 */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
  }
}

/**
 * A foreign id supplied by the caller (e.g. `clientId`) does not exist or
 * belongs to another organization. Both cases deliberately look identical.
 */
export class ReferenceNotFoundError extends NotFoundError {
  constructor() {
    super("Referenced resource not found");
  }
}

/**
 * A query through the tenant-scoped database client tried to reach outside
 * its organization (a different `organizationId`, a nested relation write,
 * raw SQL, or an unclassified model). Always a bug or an attack; the query is
 * rejected, never silently rewritten.
 */
export class TenantIsolationError extends AppError {
  constructor(message = "Operation not permitted for this organization") {
    super("FORBIDDEN", message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", options?: { details?: unknown; cause?: unknown }) {
    super("CONFLICT", message, 409, options);
  }
}

/**
 * The change would leave an organization without an OWNER. Raised by the
 * application check (src/server/organizations/ownership.ts) and, as a
 * backstop, mapped from the database trigger by `toAppError`.
 */
export class OwnerRequiredError extends ConflictError {
  constructor() {
    super(
      "An organization must always have at least one owner. Make another member an owner first.",
    );
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests") {
    super("RATE_LIMITED", message, 429);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", options?: { cause?: unknown }) {
    super("SERVICE_UNAVAILABLE", message, 503, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** JSON body returned by every API route on failure. */
export type ErrorResponseBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

/**
 * Result type for Server Actions. Per Next.js guidance, expected errors in
 * Server Actions are returned as values (consumed with `useActionState`)
 * rather than thrown.
 */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: ErrorResponseBody["error"] };
