import { cors } from "hono/cors";
import { Hono } from "hono";

import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";
import { sdkRoutes } from "./routes/sdk";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.OPENWISH_CORS_ORIGIN ?? "*",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-openwish-admin-token",
      "x-openwish-bootstrap-token",
      "x-openwish-user-uuid",
      "x-wishkit-api-key",
      "x-wishkit-uuid",
    ],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  });

  return corsMiddleware(c, next);
});

app.get("/health", (c) => c.json({ ok: true, service: "openwish-api" }));

app.route("/api", sdkRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/admin", adminRoutes);

export default app;
