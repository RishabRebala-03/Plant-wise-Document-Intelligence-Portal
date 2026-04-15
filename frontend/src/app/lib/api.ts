import type {
  AnalyticsData,
  Activity,
  CeoDashboardData,
  Comment,
  DocumentRecord,
  ManagerDashboardData,
  NotificationItem,
  Plant,
  User,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

const ACCESS_TOKEN_KEY = "midwest.accessToken";
const REFRESH_TOKEN_KEY = "midwest.refreshToken";
export const AUTH_EXPIRED_EVENT = "midwest:auth-expired";

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
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
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
    clearTokens();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error || "Request failed", response.status);
  }

  return payload?.data as T;
}

async function apiFetchBlob(path: string, options: ApiOptions = {}): Promise<{ blob: Blob; fileName: string | null; contentType: string | null }> {
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
      return apiFetchBlob(path, { ...options, isRetry: true });
    }
    clearTokens();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.error || "Request failed", response.status);
  }

  const disposition = response.headers.get("Content-Disposition");
  const fileNameMatch = disposition?.match(/filename="?([^"]+)"?/i);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? null,
    contentType: response.headers.get("Content-Type"),
  };
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

  update(documentId: string, body: Record<string, unknown> | FormData) {
    const isFormData = body instanceof FormData;
    return apiFetch<DocumentRecord>(`/documents/${documentId}`, {
      method: "PATCH",
      headers: isFormData ? undefined : { "Content-Type": "application/json" },
      body: isFormData ? body : JSON.stringify(body),
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

  downloadFile(documentId: string) {
    return apiFetchBlob(`/documents/${documentId}/download`);
  },

  async openFileInNewTab(documentId: string) {
    const { blob } = await apiFetchBlob(`/documents/${documentId}/download`);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async exportCsv() {
    return apiFetchBlob("/documents/export.csv");
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

export const activitiesApi = {
  list(params: Record<string, string | undefined> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        search.set(key, value);
      }
    });
    return apiFetch<{ items: Activity[] }>(`/activities${search.toString() ? `?${search.toString()}` : ""}`);
  },
};

export const usersApi = {
  list(params: Record<string, string | undefined> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        search.set(key, value);
      }
    });
    return apiFetch<User[]>(`/users${search.toString() ? `?${search.toString()}` : ""}`);
  },
  get(userId: string) {
    return apiFetch<User>(`/users/${userId}`);
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
  remove(userId: string) {
    return apiFetch<{ message: string }>(`/users/${userId}`, { method: "DELETE" });
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
  listIpRules() {
    return apiFetch<{ items: Array<{ id: string; label: string; address: string; status: "Allowed" | "Blocked" | "Review"; lastUpdated: string | null }> }>("/settings/ip-rules");
  },
  createIpRule(body: Record<string, unknown>) {
    return apiFetch<{ id: string; label: string; address: string; status: "Allowed" | "Blocked" | "Review"; lastUpdated: string | null }>("/settings/ip-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  updateIpRule(ruleId: string, body: Record<string, unknown>) {
    return apiFetch<{ id: string; label: string; address: string; status: "Allowed" | "Blocked" | "Review"; lastUpdated: string | null }>(`/settings/ip-rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};

export const notificationsApi = {
  list() {
    return apiFetch<{ items: NotificationItem[]; unreadCount: number }>("/notifications");
  },
  markRead(notificationId: string) {
    return apiFetch<NotificationItem>(`/notifications/${notificationId}/read`, {
      method: "POST",
    });
  },
};
