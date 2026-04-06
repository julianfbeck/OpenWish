import {
  createCommentRequestSchema,
  createWishRequestSchema,
  userRequestSchema,
  voteWishRequestSchema,
} from "@openwish/shared";
import { Hono } from "hono";

import { requireProjectFromApiKey, requireUserUuid } from "../lib/auth";
import {
  createComment,
  createWish,
  loadWishesForProject,
  toggleVote,
  upsertUser,
} from "../lib/db";
import { parseJson, sdkError } from "../lib/http";
import type { Bindings } from "../types";

export const sdkRoutes = new Hono<{ Bindings: Bindings }>();

sdkRoutes.get("/wish/list", async (c) => {
  const projectResult = await requireProjectFromApiKey(c);
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const response = await loadWishesForProject(c.env.DB, projectResult.project);
  return c.json(response);
});

sdkRoutes.post("/wish/create", async (c) => {
  const projectResult = await requireProjectFromApiKey(c);
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "sdk");
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
  return c.json(response);
});

sdkRoutes.post("/wish/vote", async (c) => {
  const projectResult = await requireProjectFromApiKey(c);
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "sdk");
  if (!userResult.ok) {
    return userResult.response;
  }

  const bodyResult = await parseJson(c, voteWishRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  const response = await toggleVote(
    c.env.DB,
    projectResult.project.id,
    bodyResult.data.wishId,
    userResult.uuid,
  );

  if (!response) {
    return sdkError(c, "unknown", 404);
  }

  return c.json(response);
});

sdkRoutes.post("/comment/create", async (c) => {
  const projectResult = await requireProjectFromApiKey(c);
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "sdk");
  if (!userResult.ok) {
    return userResult.response;
  }

  const bodyResult = await parseJson(c, createCommentRequestSchema);
  if (!bodyResult.success) {
    return bodyResult.response;
  }

  const response = await createComment(
    c.env.DB,
    projectResult.project.id,
    bodyResult.data.wishId,
    userResult.uuid,
    bodyResult.data.description,
    false,
  );

  if (!response) {
    return sdkError(c, "unknown", 404);
  }

  return c.json(response);
});

sdkRoutes.post("/user/update", async (c) => {
  const projectResult = await requireProjectFromApiKey(c);
  if (!projectResult.ok) {
    return projectResult.response;
  }

  const userResult = requireUserUuid(c, "sdk");
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
