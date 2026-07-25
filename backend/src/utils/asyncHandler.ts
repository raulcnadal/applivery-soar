import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't catch rejected promises from async handlers on its
 * own — every async route in this codebase is wrapped in this so a thrown
 * HttpError (or anything else) reaches errorHandler.middleware.ts instead
 * of crashing the process / hanging the request.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
