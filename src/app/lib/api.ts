import type {
  AnalyticsData,
  CeoDashboardData,
  Comment,
  DocumentRecord,
  ManagerDashboardData,
  Plant,
  User,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

const ACCESS_TOKEN_KEY = "midwest.accessToken";
const REFRESH_TOKEN_KEY = "midwest.refreshToken";

type Tokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

type ApiOptions = RequestInit & {
  skipAuth?: boolean;
  isRetry?: boolean;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getStoredTokens(): Tokens {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function persistTokens(tokens: Tokens) {
  if (tokens.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);

  if (tokens.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function clearTokens() {
  persistTokens({ accessToken: null, refreshToken: null });
}

async function tryRefreshToken() {
  const { refreshToken } = getStoredTokens();
  if (!refreshToken) return false;

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearTokens();
    return false;
  }

  const payload = await response.json();
  persistTokens({
    accessToken: payload.data.access_token,
    refreshToken: payload.data.refresh_token,
  });
  return true;
}

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  const { accessToken } = getStoredTokens();

  if (!options.skipAuth && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && !options.skipAuth && !options.isRetry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, isRetry: true });
    }
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error || "Request failed", response.status);
  }

  return payload?.data as T;
}

export const categoryOptions = [
  "Safety Report",
  "Environmental Compliance",
  "Equipment Inspection",
  "Production Log",
  "Incident Report",
  "Maintenance Record",
  "Permit",
  "Other",
];

export const authApi = {
  async login(email: string, password: string) {
    const data = await apiFetch<{ user: User; access_token: string; refresh_token: string }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });

    persistTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });

    return data.user;
  },

  async logout() {
    const { refreshToken } = getStoredTokens();
    try {
      if (refreshToken) {
        await apiFetch("/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } finally {
      clearTokens();
    }
  },

  me() {
    return apiFetch<User>("/auth/me");
  },
};

export const dashboardApi = {
  ceo() {
    return apiFetch<CeoDashboardData>("/dashboard/ceo");
  },
  manager() {
    return apiFetch<ManagerDashboardData>("/dashboard/manager");
  },
};

export const documentsApi = {
  list(params: Record<string, string | number | boolean | undefined>) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && value !== false) {
        search.set(key, String(value));
      }
    });
    return apiFetch<{ items: DocumentRecord[]; pagination: { page: number; pageSize: number; total: number } }>(
      `/documents${search.toString() ? `?${search.toString()}` : ""}`,
    );
  },

  get(documentId: string) {
    return apiFetch<{ document: DocumentRecord; comments: Comment[] }>(`/documents/${documentId}`);
  },

  create(formData: FormData) {
    return apiFetch<DocumentRecord>("/documents", {
      method: "POST",
      body: formData,
    });
  },

  update(documentId: string, body: Record<string, unknown>) {
    return apiFetch<DocumentRecord>(`/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  remove(documentId: string) {
    return apiFetch<{ message: string }>(`/documents/${documentId}`, { method: "DELETE" });
  },

  addComment(documentId: string, text: string, visibility: "private" | "public") {
    return apiFetch<Comment>(`/documents/${documentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, visibility }),
    });
  },

  exportUrl() {
    return `${API_BASE_URL}/documents/export.csv`;
  },
};

export const plantsApi = {
  async list() {
    const data = await apiFetch<{ summary: Record<string, number>; items: Plant[] }>("/plants");
    return data;
  },
};

export const analyticsApi = {
  overview(period: string) {
    return apiFetch<AnalyticsData>(`/analytics/overview?period=${encodeURIComponent(period)}`);
  },
};

export const usersApi = {
  list() {
    return apiFetch<User[]>("/users");
  },
  create(body: Record<string, unknown>) {
    return apiFetch<User>("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  update(userId: string, body: Record<string, unknown>) {
    return apiFetch<User>(`/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  toggleStatus(userId: string) {
    return apiFetch<User>(`/users/${userId}/toggle-status`, { method: "POST" });
  },
};

export const settingsApi = {
  me() {
    return apiFetch<User>("/settings/me");
  },
  updateProfile(body: Record<string, unknown>) {
    return apiFetch<User>("/settings/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  updatePreferences(body: Record<string, unknown>) {
    return apiFetch<User>("/settings/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  updatePassword(body: Record<string, unknown>) {
    return apiFetch<User>("/settings/security/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};

