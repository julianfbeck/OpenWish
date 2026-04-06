import type {
  AdminProjectResponse,
  CreateWishRequest,
  ProjectBootstrapRequest,
  ProjectCredentials,
  PublicProjectResponse,
  UserRequest,
  VoteWishResponse,
  CommentResponse,
} from "@openwish/shared";

const apiBaseUrl = (import.meta.env.VITE_OPENWISH_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";

function userStorageKey(slug: string) {
  return `openwish:user:${slug}`;
}

export function getUserUuid(slug: string) {
  const existing = window.localStorage.getItem(userStorageKey(slug));
  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  window.localStorage.setItem(userStorageKey(slug), next);
  return next;
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error ?? payload.reason ?? "Request failed.";
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchPublicProject(slug: string) {
  return request<PublicProjectResponse & { states: Record<string, string> }>(
    `/api/public/projects/${slug}`,
  );
}

export async function createPublicWish(slug: string, input: CreateWishRequest) {
  return request(`/api/public/projects/${slug}/wishes`, {
    method: "POST",
    headers: {
      "x-openwish-user-uuid": getUserUuid(slug),
    },
    body: JSON.stringify(input),
  });
}

export async function voteForWish(slug: string, wishId: string) {
  return request<VoteWishResponse>(`/api/public/projects/${slug}/wishes/${wishId}/vote`, {
    method: "POST",
    headers: {
      "x-openwish-user-uuid": getUserUuid(slug),
    },
  });
}

export async function createPublicComment(slug: string, wishId: string, description: string) {
  return request<CommentResponse>(`/api/public/projects/${slug}/wishes/${wishId}/comments`, {
    method: "POST",
    headers: {
      "x-openwish-user-uuid": getUserUuid(slug),
    },
    body: JSON.stringify({ description }),
  });
}

export async function updatePublicUser(slug: string, input: UserRequest) {
  return request(`/api/public/projects/${slug}/users`, {
    method: "POST",
    headers: {
      "x-openwish-user-uuid": getUserUuid(slug),
    },
    body: JSON.stringify(input),
  });
}

export async function bootstrapProject(input: ProjectBootstrapRequest, bootstrapToken: string) {
  return request<ProjectCredentials>("/api/admin/projects/bootstrap", {
    method: "POST",
    headers: {
      "x-openwish-bootstrap-token": bootstrapToken,
    },
    body: JSON.stringify(input),
  });
}

export async function fetchAdminProject(slug: string, adminToken: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
}

export async function updateWishState(slug: string, wishId: string, state: string, adminToken: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ state }),
  });
}

export async function updateProjectSettings(slug: string, watermarkEnabled: boolean, adminToken: string) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/settings`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ watermarkEnabled }),
  });
}

export async function createAdminComment(
  slug: string,
  wishId: string,
  description: string,
  adminToken: string,
) {
  return request<AdminProjectResponse>(`/api/admin/projects/${slug}/wishes/${wishId}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ description }),
  });
}
