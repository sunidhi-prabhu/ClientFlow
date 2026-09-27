import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  AppError,
  ConflictError,
  NotFoundError,
  OwnerRequiredError,
  ReferenceNotFoundError,
  ValidationError,
  type ActionResult,
  type ErrorResponseBody,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Classify a P2003 foreign key violation by which side of the key the failing
 * statement was on:
 * - on the referencing (child) table, e.g. inserting a Project whose
 *   `clientId` does not exist or belongs to another organization
 *   → 404, identical to any other unknown/inaccessible reference;
 * - on the referenced (parent) table, e.g. deleting a Client that still has
 *   Projects → 409.
 *
 * Prisma names foreign keys `<Table>_<columns>_fkey` and tables are named
 * after their models (both asserted in tests/integration/schema-invariants).
 */
function foreignKeyError(error: Prisma.PrismaClientKnownRequestError): AppError {
  const meta = error.meta as
    | {
        modelName?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
      }
    | undefined;
  const model = meta?.modelName;
  const constraint = meta?.driverAdapterError?.cause?.constraint?.index;

  if (typeof model === "string" && typeof constraint === "string") {
    if (!constraint.startsWith(`${model}_`)) {
      return new ConflictError("This record is still referenced by other records", {
        cause: error,
      });
    }
  }
  return new ReferenceNotFoundError();
}

type DatabaseErrorCause = { originalCode?: unknown; originalMessage?: unknown };

/**
 * Whether `error` is the "at least one OWNER" trigger (migration
 * auth_and_memberships) firing. It arrives either as a Prisma P2039 for a
 * single statement, or as a bare DriverAdapterError when an interactive
 * transaction fails at COMMIT (the trigger is deferred).
 */
function isOwnerInvariantViolation(error: unknown): boolean {
  let cause: DatabaseErrorCause | undefined;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    cause = (error.meta as { driverAdapterError?: { cause?: DatabaseErrorCause } } | undefined)
      ?.driverAdapterError?.cause;
  } else if (error instanceof Error && error.name === "DriverAdapterError") {
    cause = error.cause as DatabaseErrorCause | undefined;
  }
  return (
    cause?.originalCode === "23514" &&
    typeof cause.originalMessage === "string" &&
    cause.originalMessage.includes("must have at least one owner")
  );
}

/**
 * Normalize any thrown value into an `AppError`. Unknown errors are logged
 * with full detail and replaced by a generic error so internals never leak.
 */
export function toAppError(error: unknown, context?: Record<string, unknown>): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new ValidationError("Validation failed", {
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      cause: error,
    });
  }

  // Backstop for the ownership check (e.g. two concurrent demotions).
  if (isOwnerInvariantViolation(error)) return new OwnerRequiredError();

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Constraint names and values in `error.meta` stay server-side.
    if (error.code === "P2002") {
      return new ConflictError("A record with these values already exists", { cause: error });
    }
    if (error.code === "P2025") {
      // Also what a tenant-scoped update/delete of another organization's row yields.
      return new NotFoundError();
    }
    if (error.code === "P2003") {
      return foreignKeyError(error);
    }
  }

  logger.error("Unhandled error", { ...context, error });
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred", 500, { cause: error });
}

export function errorResponse(error: unknown, context?: Record<string, unknown>) {
  const appError = toAppError(error, context);
  const body: ErrorResponseBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };
  return NextResponse.json(body, { status: appError.status });
}

/**
 * Wrap a Route Handler so any thrown error becomes a consistent JSON error
 * response. Handlers can simply `throw new NotFoundError()` etc.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      const { pathname } = new URL(request.url);
      return errorResponse(error, { method: request.method, path: pathname });
    }
  };
}

/** Convert a thrown error into a failed `ActionResult` for Server Actions. */
export function toActionError(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  return {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };
}
