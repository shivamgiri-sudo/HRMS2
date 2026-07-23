import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

const IS_PROD = process.env.NODE_ENV === "production";

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("API Error:", error);

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof Error) {
    const operationalError = error as Error & {
      statusCode?: number;
      code?: string;
      errorCode?: string;
    };
    const statusCode = operationalError.statusCode;
    // 4xx errors are operational (bad request, unauthorized, etc.) — safe to surface message
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({
        success: false,
        errorCode: operationalError.errorCode ?? operationalError.code ?? null,
        message: error.message
      });
    }
    // 5xx errors: never leak internal details (DB schema, stack traces) in production
    const clientMessage = IS_PROD ? "An unexpected server error occurred" : error.message;
    return res.status(statusCode && statusCode >= 500 ? statusCode : 500).json({
      success: false,
      message: clientMessage
    });
  }

  return res.status(500).json({
    success: false,
    message: IS_PROD ? "An unexpected server error occurred" : "Unexpected server error"
  });
}
