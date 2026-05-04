import { z } from "zod";

export const wishStateValues = [
  "approved",
  "implemented",
  "pending",
  "inReview",
  "planned",
  "inProgress",
  "completed",
  "rejected",
] as const;

export const apiErrorReasonValues = [
  "requestResultedInError",
  "wrongBearerToken",
  "unknown",
  "couldNotCreateRequest",
  "couldNotDecodeBackendResponse",
  "missingApiHeaderKey",
  "missingUUIDHeaderKey",
] as const;

export const wishStateSchema = z.enum(wishStateValues);
export type WishState = z.infer<typeof wishStateSchema>;

export const apiErrorReasonSchema = z.enum(apiErrorReasonValues);
export type ApiErrorReason = z.infer<typeof apiErrorReasonSchema>;

export const userResponseSchema = z.object({
  uuid: z.string().uuid(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const commentResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  description: z.string(),
  createdAt: z.string().datetime(),
  isAdmin: z.boolean(),
});
export type CommentResponse = z.infer<typeof commentResponseSchema>;

export const wishResponseSchema = z.object({
  id: z.string().uuid(),
  userUUID: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  state: wishStateSchema,
  votingUsers: z.array(userResponseSchema),
  commentList: z.array(commentResponseSchema),
});
export type WishResponse = z.infer<typeof wishResponseSchema>;

export const listWishResponseSchema = z.object({
  list: z.array(wishResponseSchema),
  shouldShowWatermark: z.boolean(),
});
export type ListWishResponse = z.infer<typeof listWishResponseSchema>;

export const createWishRequestSchema = z.object({
  title: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  email: z.string().email().optional().or(z.literal("")),
  state: wishStateSchema.default("pending"),
});
export type CreateWishRequest = z.infer<typeof createWishRequestSchema>;

export const createWishResponseSchema = z.object({
  title: z.string(),
  description: z.string(),
  state: wishStateSchema,
});
export type CreateWishResponse = z.infer<typeof createWishResponseSchema>;

export const voteWishRequestSchema = z.object({
  wishId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
});
export type VoteWishRequest = z.infer<typeof voteWishRequestSchema>;

export const voteWishResponseSchema = z.object({
  wishId: z.string().uuid(),
  votingUsers: z.array(userResponseSchema),
});
export type VoteWishResponse = z.infer<typeof voteWishResponseSchema>;

export const createCommentRequestSchema = z.object({
  wishId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  description: z.string().min(1).max(2_000),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const userRequestSchema = z.object({
  customID: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")).optional(),
  name: z.string().nullable().optional(),
  paymentPerMonth: z.number().int().nullable().optional(),
});
export type UserRequest = z.infer<typeof userRequestSchema>;

export const apiErrorSchema = z.object({
  reason: apiErrorReasonSchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const projectBootstrapRequestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  watermarkEnabled: z.boolean().default(false),
});
export type ProjectBootstrapRequest = z.infer<typeof projectBootstrapRequestSchema>;

export const dashboardLoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type DashboardLoginRequest = z.infer<typeof dashboardLoginRequestSchema>;

export const dashboardSessionResponseSchema = z.object({
  authenticated: z.boolean(),
  username: z.string(),
});
export type DashboardSessionResponse = z.infer<typeof dashboardSessionResponseSchema>;

export const dashboardLoginResponseSchema = dashboardSessionResponseSchema.extend({
  token: z.string().optional(),
});
export type DashboardLoginResponse = z.infer<typeof dashboardLoginResponseSchema>;

export const projectCredentialsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  apiKey: z.string(),
  adminToken: z.string(),
  watermarkEnabled: z.boolean(),
});
export type ProjectCredentials = z.infer<typeof projectCredentialsSchema>;

export const publicProjectSchema = z.object({
  name: z.string(),
  slug: z.string(),
  watermarkEnabled: z.boolean(),
  shouldShowWatermark: z.boolean(),
});
export type PublicProject = z.infer<typeof publicProjectSchema>;

export const publicProjectResponseSchema = z.object({
  project: publicProjectSchema,
  list: z.array(wishResponseSchema),
});
export type PublicProjectResponse = z.infer<typeof publicProjectResponseSchema>;

export const adminWishUpdateSchema = z
  .object({
    title: z.string().min(1).max(50).optional(),
    description: z.string().min(1).max(500).optional(),
    state: wishStateSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.state !== undefined,
    {
      message: "At least one request field must be provided.",
    },
  );
export type AdminWishUpdate = z.infer<typeof adminWishUpdateSchema>;

export const adminWishMergeSchema = z.object({
  targetWishId: z.string().uuid(),
});
export type AdminWishMerge = z.infer<typeof adminWishMergeSchema>;

export const adminProjectSettingsSchema = z
  .object({
    watermarkEnabled: z.boolean().optional(),
    notificationEmail: z
      .string()
      .email()
      .or(z.literal(""))
      .or(z.null())
      .optional(),
  })
  .refine(
    (value) =>
      value.watermarkEnabled !== undefined || value.notificationEmail !== undefined,
    { message: "At least one settings field must be provided." },
  );
export type AdminProjectSettings = z.infer<typeof adminProjectSettingsSchema>;

export const adminTestEmailRequestSchema = z.object({
  to: z.string().email(),
});
export type AdminTestEmailRequest = z.infer<typeof adminTestEmailRequestSchema>;

export const adminProjectResponseSchema = z.object({
  project: z.object({
    name: z.string(),
    slug: z.string(),
    watermarkEnabled: z.boolean(),
    notificationEmail: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    totalUsers: z.number().int(),
    totalWishes: z.number().int(),
    totalVotes: z.number().int(),
  }),
  list: z.array(wishResponseSchema),
});
export type AdminProjectResponse = z.infer<typeof adminProjectResponseSchema>;

export const adminCommentRequestSchema = z.object({
  description: z.string().min(1).max(2_000),
});
export type AdminCommentRequest = z.infer<typeof adminCommentRequestSchema>;

export const projectSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  watermarkEnabled: z.boolean(),
  apiKey: z.string(),
  createdAt: z.string().datetime(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const adminAnalyticsPointSchema = z.object({
  date: z.string(),
  views: z.number().int(),
});
export type AdminAnalyticsPoint = z.infer<typeof adminAnalyticsPointSchema>;

export const adminAnalyticsResponseSchema = z.object({
  project: z.object({
    slug: z.string(),
    name: z.string(),
  }),
  totals: z.object({
    views: z.number().int(),
    votes: z.number().int(),
    featureRequests: z.number().int(),
    engagementRate: z.number(),
  }),
  series: z.array(adminAnalyticsPointSchema),
});
export type AdminAnalyticsResponse = z.infer<typeof adminAnalyticsResponseSchema>;

export const wishStateLabels: Record<WishState, string> = {
  approved: "Approved",
  implemented: "Implemented",
  pending: "Requested",
  inReview: "In review",
  planned: "Planned",
  inProgress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
};

export const bugStateValues = [
  "open",
  "confirmed",
  "inProgress",
  "fixed",
  "wontFix",
  "duplicate",
] as const;

export const bugStateSchema = z.enum(bugStateValues);
export type BugState = z.infer<typeof bugStateSchema>;

export const bugStateLabels: Record<BugState, string> = {
  open: "Open",
  confirmed: "Confirmed",
  inProgress: "In progress",
  fixed: "Fixed",
  wontFix: "Won't fix",
  duplicate: "Duplicate",
};

export const createBugRequestSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(2_000),
  email: z
    .string()
    .email()
    .max(254)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  screenshotKeys: z.array(z.string().min(1).max(256)).max(4).default([]),
});
export type CreateBugRequest = z.infer<typeof createBugRequestSchema>;

export const createBugResponseSchema = z.object({
  id: z.string().uuid(),
  state: bugStateSchema,
  createdAt: z.string().datetime(),
});
export type CreateBugResponse = z.infer<typeof createBugResponseSchema>;

export const bugScreenshotUploadResponseSchema = z.object({
  key: z.string(),
});
export type BugScreenshotUploadResponse = z.infer<typeof bugScreenshotUploadResponseSchema>;

export const bugResponseSchema = z.object({
  id: z.string().uuid(),
  userUUID: z.string(),
  title: z.string(),
  description: z.string(),
  state: bugStateSchema,
  screenshotKeys: z.array(z.string()),
  reporterEmail: z.string().nullable().optional(),
  commentList: z.array(commentResponseSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BugResponse = z.infer<typeof bugResponseSchema>;

export const adminBugListResponseSchema = z.object({
  list: z.array(bugResponseSchema),
});
export type AdminBugListResponse = z.infer<typeof adminBugListResponseSchema>;

export const userBugListResponseSchema = z.object({
  list: z.array(bugResponseSchema),
});
export type UserBugListResponse = z.infer<typeof userBugListResponseSchema>;

export const adminBugUpdateSchema = z
  .object({
    title: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(2_000).optional(),
    state: bugStateSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.state !== undefined,
    {
      message: "At least one bug field must be provided.",
    },
  );
export type AdminBugUpdate = z.infer<typeof adminBugUpdateSchema>;

export const createBugCommentRequestSchema = z.object({
  description: z.string().min(1).max(2_000),
});
export type CreateBugCommentRequest = z.infer<typeof createBugCommentRequestSchema>;

export const passkeySummarySchema = z.object({
  credentialId: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;

export const passkeyAvailabilityResponseSchema = z.object({
  hasPasskey: z.boolean(),
});
export type PasskeyAvailabilityResponse = z.infer<typeof passkeyAvailabilityResponseSchema>;

export const passkeyListResponseSchema = z.object({
  list: z.array(passkeySummarySchema),
});
export type PasskeyListResponse = z.infer<typeof passkeyListResponseSchema>;

export const passkeyRegisterVerifyRequestSchema = z.object({
  attestation: z.unknown(),
  label: z.string().min(1).max(80).nullable().optional(),
});
export type PasskeyRegisterVerifyRequest = z.infer<typeof passkeyRegisterVerifyRequestSchema>;

export const passkeyLoginVerifyRequestSchema = z.object({
  assertion: z.unknown(),
});
export type PasskeyLoginVerifyRequest = z.infer<typeof passkeyLoginVerifyRequestSchema>;
