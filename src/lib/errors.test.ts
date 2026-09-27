import { describe, expect, it } from "vitest";

import { AppError, ForbiddenError, NotFoundError, ValidationError, isAppError } from "@/lib/errors";

describe("AppError subclasses", () => {
  it("carry a stable code and HTTP status", () => {
    expect(new NotFoundError()).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(new ForbiddenError()).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(new ValidationError()).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("are recognised as AppErrors and keep their class name", () => {
    const error = new NotFoundError("Client not found");
    expect(isAppError(error)).toBe(true);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("Client not found");
  });

  it("does not treat plain errors as AppErrors", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
  });
});
