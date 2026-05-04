export type Bindings = {
  DB: D1Database;
  BUGS_BUCKET: R2Bucket;
  RATE_LIMIT_KV: KVNamespace;
  NOTIFICATION_EMAIL: SendEmail;
  OPENWISH_BOOTSTRAP_TOKEN?: string;
  OPENWISH_CORS_ORIGIN?: string;
  OPENWISH_DASHBOARD_USERNAME?: string;
  OPENWISH_DASHBOARD_PASSWORD?: string;
  OPENWISH_DASHBOARD_SESSION_SECRET?: string;
  OPENWISH_NOTIFICATION_FROM?: string;
  OPENWISH_DASHBOARD_URL?: string;
  OPENWISH_PASSKEY_RP_ID?: string;
  OPENWISH_PASSKEY_RP_NAME?: string;
};

export type PasskeyRow = {
  credential_id: string;
  user_subject: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type AuthChallengeRow = {
  challenge: string;
  kind: string;
  user_subject: string;
  expires_at: number;
};

export type ServerRequestContext = {
  env: Bindings;
  executionContext?: ExecutionContext;
};

export type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  api_key: string;
  admin_token: string;
  watermark_enabled: number;
  notification_email: string | null;
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

export type BugRow = {
  id: string;
  user_uuid: string;
  title: string;
  description: string;
  state: string;
  screenshot_keys: string;
  reporter_email: string | null;
  created_at: string;
  updated_at: string;
};

export type BugCommentRow = {
  id: string;
  bug_id: string;
  user_uuid: string;
  description: string;
  created_at: string;
  is_admin: number;
};
