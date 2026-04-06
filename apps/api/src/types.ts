import type { Context } from "hono";

export type Bindings = {
  DB: D1Database;
  OPENWISH_BOOTSTRAP_TOKEN?: string;
  OPENWISH_CORS_ORIGIN?: string;
};

export type AppContext = Context<{ Bindings: Bindings }>;

export type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  api_key: string;
  admin_token: string;
  watermark_enabled: number;
  created_at: string;
  updated_at: string;
};

export type UserRow = {
  uuid: string;
};

export type WishRow = {
  id: string;
  user_uuid: string;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
};

export type VoteRow = {
  wish_id: string;
  user_uuid: string;
};

export type CommentRow = {
  id: string;
  wish_id: string;
  user_uuid: string;
  description: string;
  created_at: string;
  is_admin: number;
};
