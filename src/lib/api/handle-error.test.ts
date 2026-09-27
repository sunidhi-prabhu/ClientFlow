import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  errorResponse,
  toActionError,
  toAppError,
  withErrorHandling,
} from "@/lib/api/handle-error";
import { ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const request = () => new Request("http://localhost/api/example", { method: "POST" });

describe("withErrorHandling", () => {
  it("passes successful responses through unchanged", async () => {
    const handler = withErrorHandling(async () => Response.json({ ok: true }));
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("maps AppErrors to their status and a public error body", async () => {
    const handler = withErrorHandling(async () => {
      throw new ForbiddenError();
    });
    const response = await handler(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" },
    });
  });

  it("maps Zod errors to 422 with field details", async () => {
    const handler = withErrorHandling(async () => {
      z.object({ name: z.string() }).parse({});
      return new Response();
    });
    const response = await handler(request());
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([{ path: "name", message: expect.any(String) }]);
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error("connection string postgres://secret leaked");
    });
    const response = await handler(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(logSpy).toHaveBeenCalledWith(
      "Unhandled error",
      expect.objectContaining({ method: "POST", path: "/api/example" }),
    );
  });
});

describe("toActionError", () => {
  it("returns a failed ActionResult", () => {
    expect(toActionError(new ForbiddenError("Nope"))).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Nope" },
    });
  });
});

describe("toAppError: Prisma errors", () => {
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError("Invalid invocation", {
      code,
      clientVersion: "test",
      meta: { target: ["slug"] },
    });

  it("maps unique constraint violations (P2002) to 409 without constraint details", () => {
    const error = toAppError(prismaError("P2002"));
    expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(error.details).toBeUndefined();
  });

  it("maps missing records (P2025) to 404", () => {
    expect(toAppError(prismaError("P2025"))).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("keeps other Prisma errors as logged, generic 500s", () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(toAppError(prismaError("P2000"))).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(logSpy).toHaveBeenCalledOnce();
  });
});

describe("toAppError: foreign key violations (P2003)", () => {
  // Shape produced by Prisma 7 with @prisma/adapter-pg (see integration tests).
  const foreignKeyError = (modelName: string) =>
    new Prisma.PrismaClientKnownRequestError("Invalid invocation", {
      code: "P2003",
      clientVersion: "test",
      meta: {
        modelName,
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23503",
            originalMessage: 'insert or update on table "Project" violates foreign key constraint',
            kind: "ForeignKeyConstraintViolation",
            constraint: { index: "Project_organizationId_clientId_fkey" },
          },
        },
      },
    });

  it("maps an invalid reference on the child table to 404 without database details", async () => {
    const response = errorResponse(foreignKeyError("Project"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Referenced resource not found" },
    });
    expect(JSON.stringify(body)).not.toMatch(/fkey|Project|23503/);
  });

  it("maps deleting a still-referenced parent to 409", () => {
    expect(toAppError(foreignKeyError("Client"))).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "This record is still referenced by other records",
    });
  });

  it("treats a violation without recognisable metadata as an invalid reference", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Invalid invocation", {
      code: "P2003",
      clientVersion: "test",
    });
    expect(toAppError(error)).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not log foreign key violations as unhandled errors", () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    toAppError(foreignKeyError("Project"));
    expect(logSpy).not.toHaveBeenCalled();
  });
});
