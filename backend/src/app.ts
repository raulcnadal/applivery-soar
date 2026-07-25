import cors from "cors";
import express from "express";
import path from "path";
import { env } from "./config/env";
import { rateLimiterMiddleware } from "./middleware/rateLimiter.middleware";
import { healthRouter } from "./modules/health/health.controller";

export function createApp() {
  const app = express();

  // CORS is wide open at the transport layer, same as the original app —
  // access control is entirely at the application layer (dashboard JWT +
  // RBAC), not CORS (ARCHITECTURE.md §2.1).
  app.use(cors({ origin: env.corsOrigins.includes("*") ? true : env.corsOrigins }));
  app.use(express.json({ limit: "10mb" }));
  app.use(rateLimiterMiddleware);

  app.use(healthRouter);

  // Phase 1+ modules mount their routers here as they're built:
  // app.use(authRouter); app.use(rolesRouter); app.use(devicesRouter); ...

  // Static frontend serving, mirroring the original single-image pattern
  // (ARCHITECTURE.md §2.1): serve Vue's built dist/, catch-all to
  // index.html for client-side routing, guarded against path traversal by
  // express.static + sendFile's own resolution.
  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) res.status(404).send("Frontend build not found — run `npm run build` in /frontend");
    });
  });

  return app;
}
