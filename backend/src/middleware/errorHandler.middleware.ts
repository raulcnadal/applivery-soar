import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";

// req/next are unused but required so Express recognizes this as the
// 4-arg error-handling middleware signature (must be registered last).
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ detail: err.detail });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ detail: err.issues });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ detail: "Internal server error" });
}
