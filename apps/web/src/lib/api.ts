import type {
  AdminAnalyticsResponse,
  AdminBugListResponse,
  AdminProjectResponse,
  BugState,
  DashboardLoginResponse,
  DashboardSessionResponse,
  PasskeyAvailabilityResponse,
  PasskeyListResponse,
  PasskeySummary,
  ProjectBootstrapRequest,
  ProjectCredentials,
  ProjectListResponse,
  PublicFeedbackProject,
  PublicFeedbackSubmitRequest,
  PublicFeedbackSubmitResponse,
} from "@openwish/shared";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

const apiBaseUrl =
  (import.meta.env.BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof payload.error === "string" ? payload.error : undefined) ??
      (typeof payload.reason === "string" ? payload.reason : undefined) ??
      "Request failed.";
    throw new ApiRequestError(message, response.status);
  }

  return payload as T;
}

export async function loginDashboard(username: string, password: string) {
  return request<DashboardLoginResponse>("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchDashboardSession() {
  return request<DashboardSessionResponse>("/api/auth/session");
}

export async function logoutDashboard() {
  return request<DashboardSessionResponse>("/api/auth/logout", {
    method: "POST",
  });
}

export async function fetchAdminProjects() {
  return request<ProjectListResponse>("/api/admin/projects");
}

export async function createAdminProject(
  input: ProjectBootstrapRequest,
  bootstrapToken?: string,
) {
  return request<ProjectCredentials>("/api/admin/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bootstrapToken ? { "x-openwish-bootstrap-token": bootstrapToken } : {}),
    },
    body: JSON.stringify(input),
  });
}

export async function fetchAdminProject(slug: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}`);
}

export async function fetchAdminAnalytics(slug: string) {
  return request<AdminAnalyticsResponse>(`/api/admin/projects/${slug}/analytics`);
}

export async function updateWishState(slug: string, wishId: string, state: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });
}

export async function updateAdminWish(
  slug: string,
  wishId: string,
  input: {
    title?: string;
    description?: string;
    state?: string;
  },
) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export type ProjectSettingsPatch = {
  watermarkEnabled?: boolean;
  notificationEmail?: string | null;
  publicFormEnabled?: boolean;
};

export async function updateProjectSettings(
  slug: string,
  patch: ProjectSettingsPatch | boolean,
) {
  const body =
    typeof patch === "boolean" ? { watermarkEnabled: patch } : patch;
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function sendTestProjectEmail(slug: string, to: string) {
  return request<{ ok: boolean; sentTo: string }>(
    `/api/admin/projects/${slug}/test-email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    },
  );
}

export async function createAdminComment(
  slug: string,
  wishId: string,
  description: string,
) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  });
}

export async function mergeAdminWish(
  slug: string,
  wishId: string,
  targetWishId: string,
) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}/merge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ targetWishId }),
  });
}

export async function deleteAdminWish(slug: string, wishId: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}`, {
    method: "DELETE",
  });
}

export async function deleteAdminProject(slug: string) {
  return request<void>(`/api/admin/projects/${slug}`, {
    method: "DELETE",
  });
}

export async function fetchAdminBugs(slug: string) {
  return request<AdminBugListResponse>(`/api/admin/projects/${slug}/bugs`);
}

export async function updateAdminBug(
  slug: string,
  bugId: string,
  input: { title?: string; description?: string; state?: BugState },
) {
  return request<AdminBugListResponse>(`/api/admin/projects/${slug}/bugs/${bugId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteAdminBug(slug: string, bugId: string) {
  return request<AdminBugListResponse>(`/api/admin/projects/${slug}/bugs/${bugId}`, {
    method: "DELETE",
  });
}

export async function createAdminBugComment(
  slug: string,
  bugId: string,
  description: string,
) {
  return request<AdminBugListResponse>(
    `/api/admin/projects/${slug}/bugs/${bugId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    },
  );
}

export function bugScreenshotUrl(slug: string, bugId: string, key: string) {
  return `/api/admin/projects/${slug}/bugs/${bugId}/screenshots/${encodeURIComponent(key)}`;
}

export async function fetchPasskeyAvailability() {
  return request<PasskeyAvailabilityResponse>("/api/auth/passkey/summary");
}

export async function fetchPasskeyList() {
  return request<PasskeyListResponse>("/api/auth/passkey/");
}

export async function fetchPasskeyRegisterOptions() {
  return request<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/register/options",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function verifyPasskeyRegistration(
  attestation: RegistrationResponseJSON,
  label: string | null,
) {
  return request<{ passkey: PasskeySummary }>(
    "/api/auth/passkey/register/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attestation, label }),
    },
  );
}

export async function fetchPasskeyLoginOptions() {
  return request<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/passkey/login/options",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function verifyPasskeyLogin(assertion: AuthenticationResponseJSON) {
  return request<DashboardSessionResponse>("/api/auth/passkey/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assertion }),
  });
}

export async function deletePasskey(credentialId: string) {
  return request<{ ok: boolean }>(
    `/api/auth/passkey/${encodeURIComponent(credentialId)}`,
    { method: "DELETE" },
  );
}

export async function fetchPublicFeedbackProject(slug: string) {
  return request<PublicFeedbackProject>(
    `/api/public/projects/${encodeURIComponent(slug)}`,
  );
}

export async function submitPublicFeedback(
  slug: string,
  body: PublicFeedbackSubmitRequest,
) {
  return request<PublicFeedbackSubmitResponse>(
    `/api/public/feedback/${encodeURIComponent(slug)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

