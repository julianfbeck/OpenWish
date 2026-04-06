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
  wishId: z.string().uuid(),
});
export type VoteWishRequest = z.infer<typeof voteWishRequestSchema>;

export const voteWishResponseSchema = z.object({
  wishId: z.string().uuid(),
  votingUsers: z.array(userResponseSchema),
});
export type VoteWishResponse = z.infer<typeof voteWishResponseSchema>;

export const createCommentRequestSchema = z.object({
  wishId: z.string().uuid(),
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

export const adminWishUpdateSchema = z.object({
  state: wishStateSchema,
});
export type AdminWishUpdate = z.infer<typeof adminWishUpdateSchema>;

export const adminProjectSettingsSchema = z.object({
  watermarkEnabled: z.boolean(),
});
export type AdminProjectSettings = z.infer<typeof adminProjectSettingsSchema>;

export const adminProjectResponseSchema = z.object({
  project: z.object({
    name: z.string(),
    slug: z.string(),
    watermarkEnabled: z.boolean(),
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
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

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
