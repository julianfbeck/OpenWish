import {
  adminCommentRequestSchema,
  createWishRequestSchema,
  userRequestSchema,
  wishStateLabels,
} from "@openwish/shared";
import { Hono } from "hono";

import { requireProjectBySlug, requireUserUuid } from "../lib/auth";
import {
  createComment,
  createWish,
  loadWishesForProject,
  toggleVote,
  upsertUser,
} from "../lib/db";
import { parseJson, publicError } from "../lib/http";
import type { Bindings } from "../types";

export const publicRoutes = new Hono<{ Bindings: Bindings }>();

publicRoutes.get("/projects/:slug", async (c) => {
  const projectResult = await requireProjectBySlug(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const list = await loadWishesForProject(c.env.DB, projectResult.project);
  return c.json({
    project: {
      name: projectResult.project.name,
      slug: projectResult.project.slug,
      watermarkEnabled: projectResult.project.watermark_enabled === 1,
      shouldShowWatermark: projectResult.project.watermark_enabled === 1,
    },
    list: list.list,
    states: wishStateLabels,
  });
});

publicRoutes.post("/projects/:slug/wishes", async (c) => {
  const projectResult = await requireProjectBySlug(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "public");
  if (!userResult.ok) {
    return userResult.response;
  }

  const bodyResult = await parseJson(c, createWishRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  if (bodyResult.data.email) {
    await upsertUser(c.env.DB, projectResult.project.id, userResult.uuid, {
      email: bodyResult.data.email,
    });
  }

  const response = await createWish(c.env.DB, projectResult.project, userResult.uuid, bodyResult.data);
  return c.json(response, 201);
});

publicRoutes.post("/projects/:slug/wishes/:wishId/vote", async (c) => {
  const projectResult = await requireProjectBySlug(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "public");
  if (!userResult.ok) {
    return userResult.response;
  }

  const response = await toggleVote(
    c.env.DB,
    projectResult.project.id,
    c.req.param("wishId"),
    userResult.uuid,
  );

  if (!response) {
    return publicError(c, 404, "Wish not found.");
  }

  return c.json(response);
});

publicRoutes.post("/projects/:slug/wishes/:wishId/comments", async (c) => {
  const projectResult = await requireProjectBySlug(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "public");
  if (!userResult.ok) {
    return userResult.response;
  }

  const bodyResult = await parseJson(c, adminCommentRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  const response = await createComment(
    c.env.DB,
    projectResult.project.id,
    c.req.param("wishId"),
    userResult.uuid,
    bodyResult.data.description,
    false,
  );

  if (!response) {
    return publicError(c, 404, "Wish not found.");
  }

  return c.json(response, 201);
});

publicRoutes.post("/projects/:slug/users", async (c) => {
  const projectResult = await requireProjectBySlug(c, c.req.param("slug"));
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "public");
  if (!userResult.ok) {
    return userResult.response;
  }

  const bodyResult = await parseJson(c, userRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  const response = await upsertUser(c.env.DB, projectResult.project.id, userResult.uuid, bodyResult.data);
  return c.json(response);
});
