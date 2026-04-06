import {
  adminCommentRequestSchema,
  adminProjectSettingsSchema,
  adminWishUpdateSchema,
  projectBootstrapRequestSchema,
} from "@openwish/shared";
import { Hono } from "hono";

import { requireAdminProject } from "../lib/auth";
import {
  bootstrapProject,
  createComment,
  loadAdminProject,
  updateProjectWatermark,
  updateWishState,
} from "../lib/db";
import { parseJson, publicError } from "../lib/http";
import type { Bindings } from "../types";

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

adminRoutes.post("/projects/bootstrap", async (c) => {
  const bootstrapToken = c.req.header("x-openwish-bootstrap-token");
  if (!c.env.OPENWISH_BOOTSTRAP_TOKEN || bootstrapToken !== c.env.OPENWISH_BOOTSTRAP_TOKEN) {
    return publicError(c, 401, "Bootstrap token is invalid.");
  }

  const bodyResult = await parseJson(c, projectBootstrapRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  try {
    const response = await bootstrapProject(c.env.DB, bodyResult.data);
    return c.json(response, 201);
  } catch (error) {
    return publicError(
      c,
      409,
      error instanceof Error ? error.message : "Could not create project.",
    );
  }
});

adminRoutes.get("/projects/:slug", async (c) => {
  const projectResult = await requireAdminProject(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const response = await loadAdminProject(c.env.DB, projectResult.project);
  return c.json(response);
});

adminRoutes.patch("/projects/:slug/settings", async (c) => {
  const projectResult = await requireAdminProject(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const bodyResult = await parseJson(c, adminProjectSettingsSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  await updateProjectWatermark(c.env.DB, projectResult.project.id, bodyResult.data.watermarkEnabled);
  const response = await loadAdminProject(c.env.DB, {
    ...projectResult.project,
    watermark_enabled: bodyResult.data.watermarkEnabled ? 1 : 0,
  });
  return c.json(response);
});

adminRoutes.patch("/projects/:slug/wishes/:wishId", async (c) => {
  const projectResult = await requireAdminProject(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const bodyResult = await parseJson(c, adminWishUpdateSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  await updateWishState(c.env.DB, projectResult.project.id, c.req.param("wishId"), bodyResult.data.state);
  const response = await loadAdminProject(c.env.DB, projectResult.project);
  return c.json(response);
});

adminRoutes.post("/projects/:slug/wishes/:wishId/comments", async (c) => {
  const projectResult = await requireAdminProject(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const bodyResult = await parseJson(c, adminCommentRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  const comment = await createComment(
    c.env.DB,
    projectResult.project.id,
    c.req.param("wishId"),
    crypto.randomUUID(),
    bodyResult.data.description,
    true,
  );

  if (!comment) {
    return publicError(c, 404, "Wish not found.");
  }

  const response = await loadAdminProject(c.env.DB, projectResult.project);
  return c.json(response, 201);
});
