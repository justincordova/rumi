import { describe, expect, it } from "bun:test";
import { AppError, AuthError, envelope } from "./errors";

describe("AppError", () => {
  it("sets code, message, statusCode", () => {
    const err = new AppError("validation_failed", "Bad input", 422);
    expect(err.code).toBe("validation_failed");
    expect(err.message).toBe("Bad input");
    expect(err.statusCode).toBe(422);
    expect(err).toBeInstanceOf(Error);
  });
  it("defaults statusCode to 400", () => {
    expect(new AppError("slug_taken", "taken").statusCode).toBe(400);
  });
});

describe("AuthError", () => {
  it("maps unauthorized → 401", () => {
    expect(new AuthError("unauthorized", "Nope").statusCode).toBe(401);
  });
  it("maps forbidden → 403", () => {
    expect(new AuthError("forbidden", "Nope").statusCode).toBe(403);
  });
  it("maps not_found → 404", () => {
    expect(new AuthError("not_found", "Nope").statusCode).toBe(404);
  });
  it("is instanceof AppError and Error", () => {
    const err = new AuthError("unauthorized", "Nope");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("envelope", () => {
  it("wraps error in { error: { code, message } }", () => {
    const err = new AppError("tab_limit_reached", "Max 3", 422);
    const result = envelope(err);
    expect(result).toEqual({
      error: { code: "tab_limit_reached", message: "Max 3", details: undefined },
    });
  });
  it("includes details when provided", () => {
    const err = new AppError("validation_failed", "Bad", 422, { field: "name" });
    expect(envelope(err).error.details).toEqual({ field: "name" });
  });
});
