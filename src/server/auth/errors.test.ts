import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { fromAuthError } from "@/server/auth/errors";

const apiError = (
  status: ConstructorParameters<typeof APIError>[0],
  code: string,
  message: string,
) => new APIError(status, { code, message });

describe("fromAuthError", () => {
  it.each([
    ["BAD_REQUEST", 400, "BAD_REQUEST"],
    ["UNAUTHORIZED", 401, "UNAUTHENTICATED"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
    ["UNPROCESSABLE_ENTITY", 422, "VALIDATION_ERROR"],
    ["TOO_MANY_REQUESTS", 429, "RATE_LIMITED"],
  ] as const)("maps %s to %i %s", (status, httpStatus, code) => {
    const mapped = fromAuthError(apiError(status, "SOME_REASON", "Readable message"));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({ status: httpStatus, code });
  });

  it("keeps Better Auth's user-facing message and exposes its code as details.reason", () => {
    expect(
      fromAuthError(apiError("FORBIDDEN", "EMAIL_NOT_VERIFIED", "Email not verified")),
    ).toMatchObject({ message: "Email not verified", details: { reason: "EMAIL_NOT_VERIFIED" } });
  });

  it("leaves other errors for toAppError", () => {
    const error = new Error("boom");
    expect(fromAuthError(error)).toBe(error);
    const serverError = apiError("INTERNAL_SERVER_ERROR", "X", "x");
    expect(fromAuthError(serverError)).toBe(serverError);
  });
});
