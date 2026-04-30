import type { ErrorCode } from "@rumi/protocol";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthError extends AppError {
  constructor(code: "unauthorized" | "forbidden" | "not_found", message: string) {
    const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : 404;
    super(code, message, status);
    this.name = "AuthError";
  }
}

export function envelope(err: AppError) {
  return { error: { code: err.code, message: err.message, details: err.details } };
}
