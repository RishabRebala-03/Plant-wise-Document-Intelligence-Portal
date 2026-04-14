import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BarChart3,
  Bell,
  Building2,
  Clock3,
  FileText,
  Filter,
  FolderKanban,
  Globe,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Lock,
  LogOut,
  Network,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Upload,
  UserCog,
  Users,
} from "lucide-react";
import {
  createBrowserRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LoginPage } from "./components/login-page";
import { ManagerUpload } from "./components/manager-upload";
import { SettingsPage } from "./components/settings-page";
import { AuthProvider, useAuth } from "./lib/auth";
import { documentsApi, notificationsApi, plantsApi, usersApi } from "./lib/api";
import {
  createProject,
  defaultPortalState,
  enrichDocuments,
  formatRole,
  lockManagerDocument,
  persistPortalState,
  readPortalState,
  summarizeByPlant,
  updateAccessRules,
  updateIpRules,
  updateSessionPolicy,
  withManagerLocks,
  type AccessRule,
  type EnrichedDocument,
  type IpRule,
  type PortalState,
  type ProjectRecord,
  type SessionPolicy,
} from "./lib/portal";
import type { Comment, DocumentRecord, NotificationItem, Plant, User, UserRole } from "./lib/types";

type PortalContextValue = {
  user: User;
  plants: Plant[];
  documents: EnrichedDocument[];
  rawDocuments: DocumentRecord[];
  users: User[];
  projects: ProjectRecord[];
  notifications: NotificationItem[];
  portalState: PortalState;
  loading: boolean;
  refreshData: () => Promise<void>;
  createProjectRecord: (draft: Pick<ProjectRecord, "plantId" | "plantName" | "name" | "code" | "description" | "owner" | "dueDate">) => ProjectRecord;
  markDocumentLocked: (documentId: string) => void;
  setAccessRules: (rules: AccessRule[]) => void;
  setIpRules: (rules: IpRule[]) => void;
  setSessionPolicyValue: (policy: SessionPolicy) => void;
};

type SessionUiState = {
  warningOpen: boolean;
  secondsRemaining: number;
  conflictDetected: boolean;
  sessionExpiredReason: string | null;
  extendSession: () => void;
  dismissExpired: () => void;
};

type NavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const PortalContext = createContext<PortalContextValue | null>(null);
const SESSION_STORAGE_PREFIX = "midwest.activeSession";
const SESSION_WARNING_SECONDS = 60;
const CHART_COLORS = ["#0f766e", "#ea580c", "#1d4ed8", "#7c3aed", "#be123c"];

function usePortal() {
  const value = useContext(PortalContext);
  if (!value) {
    throw new Error("usePortal must be used inside PortalProvider");
  }
  return value;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function defaultHome(role: UserRole) {
  return role === "Admin" ? "/admin" : "/dashboard";
}

function roleAllows(role: UserRole, allowed: UserRole[]) {
  return allowed.includes(role);
}

function emptyNotifications() {
  return { items: [] as NotificationItem[], unreadCount: 0 };
}

function PortalProvider({ user, children }: { user: User; children: ReactNode }) {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [rawDocuments, setRawDocuments] = useState<DocumentRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [portalState, setPortalState] = useState<PortalState>(() => defaultPortalState([], []));
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [documentsResult, plantsResult, usersResult, notificationsResult] = await Promise.all([
      documentsApi.list({ page: 1, pageSize: 500 }),
      plantsApi.list(),
      usersApi.list().catch(() => [] as User[]),
      notificationsApi.list().catch(() => emptyNotifications()),
    ]);

    setRawDocuments(documentsResult.items);
    setPlants(plantsResult.items);
    setUsers(usersResult);
    setNotifications(notificationsResult.items);
    setPortalState((current) => {
      const next = readPortalState(plantsResult.items, documentsResult.items);
      return current.projects.length === 0 ? next : {
        ...next,
        accessRules: current.accessRules,
        ipRules: current.ipRules,
        sessionPolicy: current.sessionPolicy,
        managerDocumentLocks: current.managerDocumentLocks,
        projects: next.projects.filter((project) => project.source === "derived").concat(
          current.projects.filter((project) => project.source === "custom"),
        ),
      };
    });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadAll()
      .catch(() => {
        if (!active) return;
        setPortalState(defaultPortalState([], []));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    if (!plants.length && !rawDocuments.length) return;
    persistPortalState(portalState);
  }, [plants.length, portalState, rawDocuments.length]);

  const documents = useMemo(() => {
    const enriched = enrichDocuments(rawDocuments, portalState.projects, user, plants);
    return withManagerLocks(enriched, portalState, user);
  }, [plants, portalState, rawDocuments, user]);

  const value = useMemo<PortalContextValue>(() => ({
    user,
    plants,
    documents,
    rawDocuments,
    users,
    projects: portalState.projects,
    notifications,
    portalState,
    loading,
    refreshData: loadAll,
    createProjectRecord: (draft) => {
      let created: ProjectRecord | null = null;
      setPortalState((current) => {
        const next = createProject(current, draft);
        created = next.projects[next.projects.length - 1];
        return next;
      });
      return created!;
    },
    markDocumentLocked: (documentId) => {
      setPortalState((current) => lockManagerDocument(current, user.id, documentId));
    },
    setAccessRules: (rules) => setPortalState((current) => updateAccessRules(current, rules)),
    setIpRules: (rules) => setPortalState((current) => updateIpRules(current, rules)),
    setSessionPolicyValue: (policy) => setPortalState((current) => updateSessionPolicy(current, policy)),
  }), [documents, loading, notifications, plants, portalState, rawDocuments, user, users]);

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

function useSessionUi(user: User, logout: () => Promise<void>, policy: SessionPolicy): SessionUiState {
  const sessionId = useId();
  const sessionKey = `${SESSION_STORAGE_PREFIX}.${user.id}`;
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(policy.autoLogoutMinutes * 60);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [sessionExpiredReason, setSessionExpiredReason] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());

  function stampSession() {
    window.localStorage.setItem(sessionKey, JSON.stringify({
      sessionId,
      timestamp: Date.now(),
    }));
  }

  function extendSession() {
    setLastActivity(Date.now());
    setWarningOpen(false);
    setConflictDetected(false);
    stampSession();
  }

  useEffect(() => {
    const updateActivity = () => extendSession();
    const events = ["click", "keydown", "mousemove", "scroll"];

    events.forEach((eventName) => window.addEventListener(eventName, updateActivity, { passive: true }));
    stampSession();

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, policy.autoLogoutMinutes * 60 - Math.floor((Date.now() - lastActivity) / 1000));
      setSecondsRemaining(remaining);
      setWarningOpen(remaining <= SESSION_WARNING_SECONDS && remaining > 0);
      if (remaining === 0) {
        setSessionExpiredReason("You were logged out because the session was inactive.");
        window.clearInterval(timer);
        void logout();
      }
    }, 1000);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== sessionKey || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as { sessionId: string; timestamp: number };
        if (payload.sessionId !== sessionId && Date.now() - payload.timestamp < 15_000) {
          if (policy.enforceSingleSession) {
            setConflictDetected(true);
            if (policy.conflictMode === "block") {
              setSessionExpiredReason("A newer session took control of this account. This tab is locked until you sign in again.");
            }
          }
        }
      } catch {
        // Ignore malformed storage payloads.
      }
    };

    window.addEventListener("storage", onStorage);

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, updateActivity));
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
      const current = window.localStorage.getItem(sessionKey);
      if (!current) return;
      try {
        const payload = JSON.parse(current) as { sessionId: string };
        if (payload.sessionId === sessionId) {
          window.localStorage.removeItem(sessionKey);
        }
      } catch {
        window.localStorage.removeItem(sessionKey);
      }
    };
  }, [lastActivity, logout, policy.autoLogoutMinutes, policy.conflictMode, policy.enforceSingleSession, sessionId, sessionKey]);

  return {
    warningOpen,
    secondsRemaining,
    conflictDetected,
    sessionExpiredReason,
    extendSession,
    dismissExpired: () => setSessionExpiredReason(null),
  };
}

function RoleGate({ allowed, children }: { allowed: UserRole[]; children: ReactNode }) {
  const { user } = usePortal();
  if (!roleAllows(user.role, allowed)) {
    return <Navigate to={defaultHome(user.role)} replace />;
  }
  return <>{children}</>;
}

function SectionCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "teal",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: "teal" | "amber" | "blue" | "rose";
  icon: React.ComponentType<{ size?: number }>;
  onClick?: () => void;
}) {
  const tones = {
    teal: "from-teal-600/12 to-emerald-600/6 text-teal-700",
    amber: "from-amber-500/12 to-orange-500/6 text-amber-700",
    blue: "from-blue-600/12 to-cyan-600/6 text-blue-700",
    rose: "from-rose-600/12 to-pink-600/6 text-rose-700",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border border-white/80 bg-gradient-to-br ${tones[tone]} p-5 text-left shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_22px_48px_rgba(15,23,42,0.12)]" : "cursor-default"}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <div className="rounded-2xl bg-white/80 p-2">
          <Icon size={18} />
        </div>
      </div>
      <div className="text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{hint}</div>
    </button>
  );
}

function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-2">
          {item.to ? <Link to={item.to} className="hover:text-slate-900">{item.label}</Link> : <span className="text-slate-900">{item.label}</span>}
          {index < items.length - 1 ? <span>/</span> : null}
        </span>
      ))}
    </div>
  );
}

function Shell({ onLogout, session }: { onLogout: () => void; session: SessionUiState }) {
  const { user, notifications, portalState } = usePortal();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isCeo = user.role === "CEO";

  const navGroups = useMemo(() => {
    const common: NavItem[] = [{ label: "Settings", path: user.role === "Admin" ? "/admin/settings" : "/settings", icon: Settings }];
    if (user.role === "CEO") {
      return [
        [
          { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
          { label: "Plants", path: "/plants", icon: Building2 },
          { label: "Documents", path: "/documents", icon: FileText },
          { label: "Analytics", path: "/analytics", icon: LineChartIcon },
        ],
        common,
      ];
    }
    if (user.role === "Mining Manager") {
      return [
        [
          { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
          { label: "Plants", path: "/plants", icon: Building2 },
          { label: "Documents", path: "/documents", icon: FileText },
          { label: "Project Creation", path: `/plants/${user.plantId || ""}/projects/new`, icon: Plus },
          { label: "Upload", path: "/upload", icon: Upload },
        ],
        common,
      ];
    }
    return [
      [
        { label: "Admin Dashboard", path: "/admin", icon: LayoutDashboard },
        { label: "Users", path: "/admin/users", icon: Users },
        { label: "Access Control", path: "/admin/access", icon: ShieldCheck },
        { label: "IP Configuration", path: "/admin/network", icon: Network },
        { label: "Sessions", path: "/admin/sessions", icon: Clock3 },
      ],
      common,
    ];
  }, [user.plantId, user.role]);

  return (
    <div className={`${isCeo ? "bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.20),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_28%),linear-gradient(180deg,_#fff7ed,_#fff1e6)]" : "bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(234,88,12,0.12),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#eef4f7)]"} min-h-screen text-slate-900`}>
      <header className="sticky top-0 z-30 border-b border-white/60 bg-slate-950/95 px-5 py-4 text-white backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/50">Plant-wise document intelligence</div>
            <div className="mt-1 flex items-center gap-3">
              <div className={`rounded-2xl px-3 py-1 text-xs font-semibold text-slate-950 ${isCeo ? "bg-orange-400" : "bg-teal-500"}`}>MW</div>
              <div>
                <div className="text-lg font-semibold">Midwest Operations Portal</div>
                <div className="text-sm text-white/60">{formatRole(user.role)} workspace</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${session.conflictDetected ? "bg-rose-500/20 text-rose-100" : session.warningOpen ? "bg-amber-400/20 text-amber-100" : "bg-white/10 text-white/80"}`}>
              {session.conflictDetected
                ? "Session conflict detected"
                : session.warningOpen
                  ? `Auto logout in ${session.secondsRemaining}s`
                  : `Auto logout in ${Math.max(1, Math.floor(session.secondsRemaining / 60))}m`}
            </div>

            <div className="relative">
              <button
                onClick={() => setNotificationsOpen((prev) => !prev)}
                className="rounded-full border border-white/15 bg-white/5 p-2 transition hover:bg-white/10"
              >
                <Bell size={16} />
              </button>
              {notificationsOpen ? (
                <div className="absolute right-0 top-12 w-80 rounded-3xl border border-white/10 bg-slate-900 p-3 shadow-2xl">
                  <div className="mb-3 text-sm font-semibold text-white">Notifications</div>
                  <div className="space-y-2">
                    {(notifications.length ? notifications : [{
                      id: "placeholder",
                      userId: user.id,
                      title: "No new alerts",
                      detail: "Your next upload, access, and governance events will appear here.",
                      href: defaultHome(user.role),
                      type: "empty",
                      read: true,
                      createdAt: null,
                    }]).slice(0, 4).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setNotificationsOpen(false);
                          navigate(item.href || defaultHome(user.role));
                        }}
                        className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10"
                      >
                        <div className="text-sm font-medium text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-white/60">{item.detail}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
              {user.name}
            </div>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      {session.warningOpen ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          Your session will expire in {session.secondsRemaining} seconds.{" "}
          <button onClick={session.extendSession} className="font-semibold underline">
            Stay signed in
          </button>
        </div>
      ) : null}

      {session.conflictDetected || session.sessionExpiredReason ? (
        <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900">
          {session.sessionExpiredReason || "A newer login was detected for this account. To avoid session overlap, this tab is now locked."}
        </div>
      ) : null}

      <div className="relative mx-auto flex w-full max-w-[1600px] gap-6 px-4 py-6 lg:px-6">
        {session.conflictDetected || session.sessionExpiredReason ? (
          <div className="absolute inset-0 z-20 flex items-start justify-center px-4 pt-10">
            <div className="w-full max-w-2xl rounded-[32px] border border-rose-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
              <div className="text-lg font-semibold text-slate-900">Session attention required</div>
              <div className="mt-2 text-sm text-slate-600">
                {session.sessionExpiredReason || "Another active session was detected for this account. To prevent conflicting actions, this tab is locked."}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {!session.sessionExpiredReason ? (
                  <button onClick={session.extendSession} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                    Keep this session
                  </button>
                ) : null}
                <button onClick={onLogout} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Sign in again
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-28 space-y-4 rounded-[28px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className={`rounded-3xl p-4 text-white ${isCeo ? "bg-[linear-gradient(135deg,_#c2410c,_#fb923c)]" : "bg-[linear-gradient(135deg,_#0f766e,_#134e4a)]"}`}>
              <div className="text-xs uppercase tracking-[0.24em] text-white/60">Current scope</div>
              <div className="mt-2 text-lg font-semibold">{user.role === "CEO" ? "Enterprise view" : user.plant || "Administration"}</div>
              <div className="mt-1 text-sm text-white/70">
                {user.role === "Mining Manager"
                  ? "Project creation and plant-level document control."
                  : user.role === "Admin"
                    ? "Governance, access, and system policy controls."
                    : "Plant-wise analytics and executive visibility."}
              </div>
            </div>

            {navGroups.map((group, index) => (
              <div key={index} className="space-y-1">
                {group.map((item) => {
                  const active = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(`${item.path}/`));
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition ${
                        active ? "bg-slate-950 text-white shadow-lg" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <item.icon size={16} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Role restrictions</div>
              <div className="mt-2">
                {portalState.accessRules.find((rule) => rule.role === user.role)?.plantsScope || "Controlled by administrator"}
              </div>
            </div>
          </div>
        </aside>

        <main className={`min-w-0 flex-1 ${session.conflictDetected || session.sessionExpiredReason ? "pointer-events-none opacity-30 blur-[1px]" : ""}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user } = usePortal();
  if (user.role === "CEO") return <CeoDashboardPage />;
  if (user.role === "Admin") return <Navigate to="/admin" replace />;
  return <ManagerDashboardPage />;
}

function CeoDashboardPage() {
  const { documents, plants, projects, users } = usePortal();
  const navigate = useNavigate();
  const plantSummary = useMemo(() => summarizeByPlant(documents), [documents]);
  const topPlants = [...plantSummary].sort((a, b) => b.documents - a.documents).slice(0, 5);
  const lineSeries = topPlants.map((item, index) => ({
    name: item.plant.split(" - ")[0],
    documents: item.documents,
    projects: item.projects,
    index,
  }));
  const categorySeries = Array.from(documents.reduce((map, document) => {
    map.set(document.category, (map.get(document.category) || 0) + 1);
    return map;
  }, new Map<string, number>()).entries()).map(([name, value]) => ({ name, value }));
  const stalledPlants = plants.filter((plant) => !plant.lastUpload || new Date(plant.lastUpload).getTime() < Date.now() - 1000 * 60 * 60 * 24 * 14);
  const miningManagers = users.filter((item) => item.role === "Mining Manager").length;

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#7c2d12,_#f97316)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(124,45,18,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">CEO dashboard</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Plant-wise visibility across projects and documents</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
              The hierarchy now starts at plant level, flows into projects, and lands on dedicated document pages.
              Executive signals below highlight document volume, dormant plants, and project concentration.
            </p>
          </div>
          <div className="grid min-w-[260px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <button onClick={() => navigate("/plants")} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Open plant navigator
            </button>
            <button onClick={() => navigate("/documents")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
              Review document catalog
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Active Plants" value={plants.length} hint="Plants contributing to the current executive view." icon={Building2} tone="amber" onClick={() => navigate("/plants")} />
        <MetricCard label="Projects" value={projects.length} hint="Derived plus locally created project workspaces." icon={FolderKanban} tone="blue" onClick={() => navigate("/plants")} />
        <MetricCard label="Documents" value={documents.length} hint="All indexed records across the enterprise scope." icon={FileText} tone="amber" onClick={() => navigate("/documents")} />
        <MetricCard label="Mining Managers" value={miningManagers} hint="Managers currently configured in the system." icon={Users} tone="rose" onClick={() => navigate("/analytics")} />
        <MetricCard label="Dormant Plants" value={stalledPlants.length} hint="Plants with no upload in the past 14 days." icon={TriangleAlert} tone="rose" onClick={() => navigate("/analytics")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Plant-wise document volume" subtitle="Top plants by document count with project spread">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineSeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Bar dataKey="documents" fill="#f97316" radius={[10, 10, 0, 0]} />
                <Bar dataKey="projects" fill="#ea580c" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Document mix" subtitle="Distribution by category">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categorySeries} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110}>
                  {categorySeries.map((item, index) => (
                    <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            {categorySeries.slice(0, 5).map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                <span>{item.name}</span>
                <span className="font-semibold text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Quick insights" subtitle="Clickable pathways into plants and project workspaces">
          <div className="grid gap-4 md:grid-cols-2">
            {plantSummary.slice(0, 4).map((item) => (
              <Link
                key={item.plantId}
                to={`/plants/${item.plantId}`}
                className="group rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-orange-300 hover:bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="text-base font-semibold text-slate-900">{item.plant}</div>
                  <Building2 size={18} className="text-slate-400 transition group-hover:text-orange-600" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="font-semibold text-slate-900">{item.documents}</div>
                    <div className="text-slate-500">Docs</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{item.projects}</div>
                    <div className="text-slate-500">Projects</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{item.locked}</div>
                    <div className="text-slate-500">Locked</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Executive watchlist" subtitle="Plants that need follow-up">
          <div className="space-y-3">
            {(stalledPlants.length ? stalledPlants : plants.slice(0, 3)).map((plant) => (
              <div key={plant.id} className="rounded-3xl border border-amber-100 bg-amber-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{plant.name}</div>
                    <div className="mt-1 text-sm text-slate-600">Last upload: {formatDate(plant.lastUpload)}</div>
                  </div>
                  <Link to={`/plants/${plant.id}`} className="text-sm font-semibold text-orange-700 hover:text-orange-900">
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function ManagerDashboardPage() {
  const { user, documents, projects } = usePortal();
  const navigate = useNavigate();
  const myProjects = projects.filter((project) => project.plantId === user.plantId);
  const myDocuments = documents.filter((document) => document.plantId === user.plantId);
  const lockedDocuments = myDocuments.filter((document) => document.accessLocked);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#1d4ed8)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Manager dashboard</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{user.plant || "Assigned plant"} project control</h1>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Managers can create projects and upload within their plant scope, but document edit and delete actions are now removed.
              Once a document is accessed, its manager view is marked as locked for the current session.
            </p>
          </div>
          <div className="grid min-w-[260px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <button onClick={() => navigate(`/plants/${user.plantId}`)} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Open plant workspace
            </button>
            <button onClick={() => navigate("/upload")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
              Upload a document
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="My Projects" value={myProjects.length} hint="Project spaces under your plant." icon={FolderKanban} />
        <MetricCard label="My Documents" value={myDocuments.length} hint="Documents visible inside your plant scope." icon={FileText} tone="blue" />
        <MetricCard label="Locked After Access" value={lockedDocuments.length} hint="Read-only items opened in this manager session." icon={Lock} tone="rose" />
        <MetricCard label="Upload Rights" value="Enabled" hint="Managers can upload but not edit or delete documents." icon={Upload} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Project tiles" subtitle="Structured navigation from plant to project to documents">
          <div className="grid gap-4 md:grid-cols-2">
            {myProjects.map((project) => (
              <Link key={project.id} to={`/plants/${project.plantId}/projects/${project.id}/documents`} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-300 hover:bg-white">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-slate-900">{project.name}</div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">{project.code}</div>
                </div>
                <div className="mt-3 text-sm text-slate-600">{project.description}</div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-slate-500">{statLabel(project.documentIds.length, "document")}</span>
                  <span className="font-semibold text-blue-700">Open documents</span>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Restrictions in effect" subtitle="Current role-based guardrails">
          <div className="space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">No edit or delete actions</div>
              <div className="mt-1">Manager UI keeps document metadata and lifecycle actions read-only.</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">Access locking after open</div>
              <div className="mt-1">Opened records display a lock state so reviewers know the document has entered controlled read-only review.</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">Plant-scoped navigation</div>
              <div className="mt-1">All plant, project, and document pathways stay inside {user.plant || "your assigned plant"}.</div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function PlantIndexPage() {
  const { user, plants, documents, projects } = usePortal();
  const visiblePlants = user.role === "Mining Manager" && user.plantId
    ? plants.filter((plant) => plant.id === user.plantId)
    : plants;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Plants" }]} />
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_rgba(15,118,110,0.96),_rgba(8,47,73,0.94))] px-6 py-8 text-white shadow-[0_25px_70px_rgba(15,118,110,0.22)]">
        <div className="text-xs uppercase tracking-[0.26em] text-white/55">Hierarchy navigator</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Plant → Projects → Documents</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
          Each tile opens the plant workspace, then project workstreams, then dedicated document list and detail pages.
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visiblePlants.map((plant) => {
          const docCount = documents.filter((document) => document.plantId === plant.id).length;
          const projectCount = projects.filter((project) => project.plantId === plant.id).length;
          return (
            <Link key={plant.id} to={`/plants/${plant.id}`} className="group rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{plant.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{plant.company}</div>
                </div>
                <Building2 size={20} className="text-slate-400 transition group-hover:text-teal-600" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">{projectCount}</div>
                  <div className="mt-1 text-slate-500">Projects</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">{docCount}</div>
                  <div className="mt-1 text-slate-500">Docs</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">{formatDate(plant.lastUpload)}</div>
                  <div className="mt-1 text-slate-500">Last upload</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PlantProjectsPage() {
  const { plantId } = useParams();
  const { user, plants, projects, documents } = usePortal();
  const navigate = useNavigate();
  const plant = plants.find((item) => item.id === plantId);
  const plantProjects = projects.filter((project) => project.plantId === plantId);
  const plantDocuments = documents.filter((document) => document.plantId === plantId);
  const canCreate = user.role === "Mining Manager" && user.plantId === plantId;

  if (!plant) return <NotFoundCard title="Plant not found" body="The selected plant could not be located in the current workspace." />;
  if (user.role === "Mining Manager" && user.plantId !== plantId) return <Navigate to={defaultHome(user.role)} replace />;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Plants", to: "/plants" }, { label: plant.name }]} />
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Plant workspace</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{plant.name}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
              Project workstreams for this plant with direct document navigation and a separate detail page per record.
            </p>
          </div>
          {canCreate ? (
            <button onClick={() => navigate(`/plants/${plant.id}/projects/new`)} className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Create project
            </button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Projects" value={plantProjects.length} hint="Live project spaces for this plant." icon={FolderKanban} />
        <MetricCard label="Documents" value={plantDocuments.length} hint="Documents mapped into project workstreams." icon={FileText} tone="blue" />
        <MetricCard label="Manager" value={plant.manager || "Unassigned"} hint="Plant owner used in project-level filters." icon={Users} tone="amber" />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {plantProjects.map((project) => (
          <Link key={project.id} to={`/plants/${plant.id}/projects/${project.id}/documents`} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition hover:-translate-y-1 hover:border-teal-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">{project.name}</div>
                <div className="mt-1 text-sm text-slate-500">{project.code} · {project.status}</div>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{project.documentIds.length} docs</div>
            </div>
            <div className="mt-4 text-sm text-slate-600">{project.description}</div>
            <div className="mt-4 text-sm text-slate-500">Owner: {project.owner}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProjectCreatePage() {
  const { plantId } = useParams();
  const { user, plants, createProjectRecord } = usePortal();
  const navigate = useNavigate();
  const plant = plants.find((item) => item.id === plantId);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  if (user.role !== "Mining Manager" || user.plantId !== plantId) {
    return <Navigate to={defaultHome(user.role)} replace />;
  }
  if (!plant) return <NotFoundCard title="Plant not found" body="A project can only be created inside a valid plant workspace." />;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const created = createProjectRecord({
      plantId: plant.id,
      plantName: plant.name,
      name,
      code: code || name.slice(0, 6).toUpperCase().replace(/\s+/g, ""),
      description,
      owner: user.name,
      dueDate: dueDate || null,
    });
    navigate(`/plants/${plant.id}/projects/${created.id}/documents`);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Plants", to: "/plants" }, { label: plant.name, to: `/plants/${plant.id}` }, { label: "Create Project" }]} />
      <SectionCard title="Create project" subtitle="Managers can create project spaces within their assigned plant">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Project name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Project code</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Optional" className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </label>
          <label className="space-y-2 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} required className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-500" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Due date</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </label>
          <div className="flex items-end justify-end">
            <button type="submit" className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Create and open documents
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}

function DocumentsPage() {
  return <DocumentsWorkspace />;
}

function ProjectDocumentsPage() {
  const { projectId, plantId } = useParams();
  return <DocumentsWorkspace scopedProjectId={projectId} scopedPlantId={plantId} />;
}

function DocumentsWorkspace({ scopedProjectId, scopedPlantId }: { scopedProjectId?: string; scopedPlantId?: string }) {
  const { user, documents, projects, plants } = usePortal();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [plantId, setPlantId] = useState(scopedPlantId || (user.role === "Mining Manager" ? user.plantId || "" : ""));
  const [projectId, setProjectId] = useState(scopedProjectId || "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (scopedPlantId) setPlantId(scopedPlantId);
    if (scopedProjectId) setProjectId(scopedProjectId);
  }, [scopedPlantId, scopedProjectId]);

  const filtered = useMemo(() => documents.filter((document) => {
    const matchesPlant = !plantId || document.plantId === plantId;
    const matchesProject = !projectId || document.projectId === projectId;
    const matchesManager = !manager || document.managerName.toLowerCase().includes(manager.toLowerCase());
    const matchesIdentifier = !identifier || document.identifier.toLowerCase().includes(identifier.toLowerCase());
    const matchesQuery = !query || [document.name, document.plant, document.projectName, document.uploadedBy, document.category].join(" ").toLowerCase().includes(query.toLowerCase());
    const matchesFrom = !dateFrom || Boolean(document.date && document.date >= dateFrom);
    const matchesTo = !dateTo || Boolean(document.date && document.date <= dateTo);
    return matchesPlant && matchesProject && matchesManager && matchesIdentifier && matchesQuery && matchesFrom && matchesTo;
  }), [dateFrom, dateTo, documents, identifier, manager, plantId, projectId, query]);

  const availableProjects = projects.filter((project) => !plantId || project.plantId === plantId);
  const title = scopedProjectId
    ? `${projects.find((project) => project.id === scopedProjectId)?.name || "Project"} documents`
    : "Document listing";

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: "Documents", to: "/documents" },
        ...(scopedPlantId ? [{ label: plants.find((plant) => plant.id === scopedPlantId)?.name || "Plant", to: `/plants/${scopedPlantId}` }] : []),
        ...(scopedProjectId ? [{ label: title }] : []),
      ]} />

      <SectionCard title={title} subtitle="Separate listing page with advanced search and structured filters">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterField icon={Search} label="Search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, plant, project..." className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </FilterField>
          <FilterField icon={Users} label="Manager">
            <input value={manager} onChange={(event) => setManager(event.target.value)} placeholder="Manager name" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </FilterField>
          <FilterField icon={FileText} label="Identifier">
            <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Plant-document id" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </FilterField>
          <FilterField icon={Building2} label="Plant">
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)} disabled={user.role === "Mining Manager" || Boolean(scopedPlantId)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500 disabled:bg-slate-100">
              <option value="">All plants</option>
              {plants.filter((plant) => user.role !== "Mining Manager" || plant.id === user.plantId).map((plant) => (
                <option key={plant.id} value={plant.id}>{plant.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={FolderKanban} label="Project">
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={Boolean(scopedProjectId)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500 disabled:bg-slate-100">
              <option value="">All projects</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Clock3} label="From date">
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </FilterField>
          <FilterField icon={Clock3} label="To date">
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
          </FilterField>
          <div className="flex items-end">
            <button
              onClick={() => {
                setQuery("");
                setManager("");
                setIdentifier("");
                setDateFrom("");
                setDateTo("");
                if (!scopedPlantId && user.role !== "Mining Manager") setPlantId("");
                if (!scopedProjectId) setProjectId("");
              }}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Clear filters
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Plant</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Identifier</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {filtered.map((document) => (
                <tr key={document.id} className="transition hover:bg-slate-50">
                  <td className="px-4 py-4">
                    <button onClick={() => navigate(`/documents/${document.id}`)} className="text-left">
                      <div className="font-semibold text-slate-900">{document.name}</div>
                      <div className="mt-1 text-slate-500">{document.category}</div>
                    </button>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{document.plant}</td>
                  <td className="px-4 py-4 text-slate-600">{document.projectName}</td>
                  <td className="px-4 py-4 text-slate-600">{document.managerName}</td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-600">{document.identifier}</td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(document.date)}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${document.accessLocked ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {document.accessLocked ? "Locked after access" : "Available"}
                    </span>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">No documents matched the selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function FilterField({ icon: Icon, label, children }: { icon: React.ComponentType<{ size?: number }>; label: string; children: ReactNode }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="inline-flex items-center gap-2 font-medium text-slate-700">
        <Icon size={14} />
        {label}
      </span>
      {children}
    </label>
  );
}

function DocumentDetailPage() {
  const { documentId } = useParams();
  const { user, documents, markDocumentLocked } = usePortal();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentError, setCommentError] = useState("");
  const document = documents.find((item) => item.id === documentId);

  useEffect(() => {
    if (!documentId) return;
    documentsApi.get(documentId)
      .then((result) => setComments(result.comments))
      .catch((error) => setCommentError(error instanceof Error ? error.message : "Unable to load document comments."));
  }, [documentId]);

  useEffect(() => {
    if (user.role === "Mining Manager" && documentId) {
      markDocumentLocked(documentId);
    }
  }, [documentId, markDocumentLocked, user.role]);

  if (!document) return <NotFoundCard title="Document not found" body="This document is no longer available in the current filtered workspace." />;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: "Documents", to: "/documents" },
        { label: document.projectName, to: `/plants/${document.plantId}/projects/${document.projectId}/documents` },
        { label: document.name },
      ]} />

      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#334155)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Document detail page</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{document.name}</h1>
            <p className="mt-3 text-sm leading-6 text-white/72">
              This dedicated detail page keeps metadata, notes, and file access separate from the document listing view.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/6 px-4 py-3 text-sm">
            {document.accessLocked ? "Locked after access" : "Ready for review"}
          </div>
        </div>
      </section>

      {user.role === "Mining Manager" ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Managers now have a read-only detail experience. Edit and delete options are removed, and this record is locked once accessed.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Document details" subtitle="Core metadata and hierarchy context">
          <div className="grid gap-4 md:grid-cols-2">
            <DetailRow label="Document ID" value={document.id} />
            <DetailRow label="Identifier" value={document.identifier} mono />
            <DetailRow label="Plant" value={document.plant} />
            <DetailRow label="Project" value={document.projectName} />
            <DetailRow label="Category" value={document.category} />
            <DetailRow label="Manager" value={document.managerName} />
            <DetailRow label="Uploaded by" value={document.uploadedBy} />
            <DetailRow label="Upload date" value={formatDate(document.date)} />
            <DetailRow label="Version" value={`v${document.version}`} />
            <DetailRow label="File" value={document.file?.name || "Not attached"} />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {document.file?.storageId ? (
              <button onClick={() => void documentsApi.openFileInNewTab(document.id)} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                Open original file
              </button>
            ) : null}
            {document.file?.storageId ? (
              <button onClick={() => void documentsApi.downloadFile(document.id)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Prepare download
              </button>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Notes and access state" subtitle="Comments plus reviewer signals">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Manager lock state</div>
            <div className="mt-2 text-sm text-slate-600">
              {document.accessLocked
                ? "This record has been opened in the current manager session and remains visually locked."
                : "No lock has been applied yet."}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {comments.map((comment) => (
              <div key={comment.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">{comment.author}</div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">{comment.visibility}</div>
                </div>
                <div className="mt-2 text-sm text-slate-600">{comment.text}</div>
                <div className="mt-2 text-xs text-slate-400">{formatDate(comment.date)}</div>
              </div>
            ))}
            {!comments.length ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                {commentError || "No comments have been recorded for this document."}
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-sm font-medium text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function AnalyticsPage() {
  const { documents, plants, projects } = usePortal();

  const monthly = useMemo(() => {
    const map = documents.reduce((acc, document) => {
      const month = document.date ? document.date.slice(0, 7) : "Unknown";
      const current = acc.get(month) || { month, uploads: 0, locked: 0 };
      current.uploads += 1;
      current.locked += document.accessLocked ? 1 : 0;
      acc.set(month, current);
      return acc;
    }, new Map<string, { month: string; uploads: number; locked: number }>());

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [documents]);

  const plantBreakdown = useMemo(() => {
    return plants
      .map((plant) => {
        const plantDocs = documents.filter((document) => document.plantId === plant.id);
        const locked = plantDocs.filter((document) => document.accessLocked).length;
        const activeProjects = projects.filter((project) => project.plantId === plant.id).length;
        return {
          plant: plant.name.split(" - ")[0],
          documents: plantDocs.length,
          locked,
          projects: activeProjects,
          avgPerProject: activeProjects ? Number((plantDocs.length / activeProjects).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.documents - a.documents);
  }, [documents, plants, projects]);

  const categoryMix = useMemo(() => {
    const map = documents.reduce((acc, document) => {
      acc.set(document.category, (acc.get(document.category) || 0) + 1);
      return acc;
    }, new Map<string, number>());

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [documents]);

  const uploaderRanking = useMemo(() => {
    const map = documents.reduce((acc, document) => {
      acc.set(document.uploadedBy, (acc.get(document.uploadedBy) || 0) + 1);
      return acc;
    }, new Map<string, number>());

    return Array.from(map.entries())
      .map(([name, uploads]) => ({ name, uploads }))
      .sort((a, b) => b.uploads - a.uploads)
      .slice(0, 8);
  }, [documents]);

  const projectDepth = useMemo(() => {
    return projects
      .map((project) => {
        const projectDocs = documents.filter((document) => document.projectId === project.id);
        const privateNotes = projectDocs.filter((document) => document.noteSummary?.latest?.visibility === "private").length;
        return {
          name: project.name.length > 18 ? `${project.name.slice(0, 18)}...` : project.name,
          documents: projectDocs.length,
          privateNotes,
          statusScore:
            project.status === "Active" ? 90 :
            project.status === "At Risk" ? 55 :
            project.status === "Planned" ? 35 : 20,
        };
      })
      .sort((a, b) => b.documents - a.documents)
      .slice(0, 6);
  }, [documents, projects]);

  const radarSeries = useMemo(() => {
    return plantBreakdown.slice(0, 5).map((item) => ({
      plant: item.plant,
      documents: item.documents,
      projects: item.projects * 10,
      locks: item.locked * 8,
    }));
  }, [plantBreakdown]);

  const timelineHighlights = useMemo(() => {
    const latestMonth = monthly[monthly.length - 1];
    const previousMonth = monthly[monthly.length - 2];
    const growth = latestMonth && previousMonth && previousMonth.uploads > 0
      ? Math.round(((latestMonth.uploads - previousMonth.uploads) / previousMonth.uploads) * 100)
      : 0;
    const mostDocumentedPlant = plantBreakdown[0];
    const busiestCategory = categoryMix[0];
    return {
      growth,
      mostDocumentedPlant,
      busiestCategory,
      totalLocked: documents.filter((document) => document.accessLocked).length,
    };
  }, [categoryMix, documents, monthly, plantBreakdown]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Analytics" }]} />
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#111827,_#0f766e)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
        <div className="text-xs uppercase tracking-[0.26em] text-white/55">Dedicated analytics page</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Executive analytics workspace</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
          This route is now a deeper analytics tab page with multiple chart types, wider plant and project comparisons,
          and richer operational signals for the CEO view.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Upload trend" value={`${timelineHighlights.growth >= 0 ? "+" : ""}${timelineHighlights.growth}%`} hint="Month-over-month document movement." icon={LineChartIcon} />
        <MetricCard label="Top plant" value={timelineHighlights.mostDocumentedPlant?.plant || "-"} hint={`${timelineHighlights.mostDocumentedPlant?.documents || 0} indexed documents`} icon={Building2} tone="blue" />
        <MetricCard label="Busiest category" value={timelineHighlights.busiestCategory?.name || "-"} hint={`${timelineHighlights.busiestCategory?.value || 0} records`} icon={BarChart3} tone="amber" />
        <MetricCard label="Locked records" value={timelineHighlights.totalLocked} hint="Manager-opened records in controlled state." icon={Lock} tone="rose" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Monthly uploads and controlled access" subtitle="Line chart with overlay for locked records">
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="uploads" name="Uploads" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="locked" name="Locked" stroke="#be123c" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Category distribution" subtitle="Pie view of document mix">
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryMix} dataKey="value" nameKey="name" innerRadius={70} outerRadius={120}>
                  {categoryMix.map((item, index) => (
                    <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard title="Plant document density" subtitle="Bar chart comparing documents, projects, and average depth">
          <div className="h-[26rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={plantBreakdown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="plant" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Legend />
                <Bar dataKey="documents" name="Documents" fill="#0f766e" radius={[10, 10, 0, 0]} />
                <Bar dataKey="projects" name="Projects" fill="#ea580c" radius={[10, 10, 0, 0]} />
                <Bar dataKey="avgPerProject" name="Docs / Project" fill="#1d4ed8" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Rolling document accumulation" subtitle="Area graph showing cumulative load by month">
          <div className="h-[26rem]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={monthly.reduce<Array<{ month: string; cumulative: number; uploads: number }>>((acc, item) => {
                  const previous = acc[acc.length - 1]?.cumulative || 0;
                  acc.push({
                    month: item.month,
                    uploads: item.uploads,
                    cumulative: previous + item.uploads,
                  });
                  return acc;
                }, [])}
              >
                <defs>
                  <linearGradient id="uploadArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Area type="monotone" dataKey="cumulative" name="Cumulative documents" stroke="#0f766e" fill="url(#uploadArea)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Plant performance radar" subtitle="Multi-axis comparison across top plants">
          <div className="h-[26rem]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarSeries}>
                <PolarGrid />
                <PolarAngleAxis dataKey="plant" />
                <PolarRadiusAxis />
                <Radar name="Documents" dataKey="documents" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.2} />
                <Radar name="Projects x10" dataKey="projects" stroke="#0f766e" fill="#0f766e" fillOpacity={0.2} />
                <Radar name="Locks x8" dataKey="locks" stroke="#be123c" fill="#be123c" fillOpacity={0.16} />
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Project intensity and note sensitivity" subtitle="Project comparison with document volume and private-note signals">
          <div className="h-[26rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectDepth} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" stroke="#64748b" />
                <YAxis type="category" dataKey="name" stroke="#64748b" width={130} />
                <Tooltip />
                <Legend />
                <Bar dataKey="documents" name="Documents" fill="#7c3aed" radius={[0, 10, 10, 0]} />
                <Bar dataKey="privateNotes" name="Private note signals" fill="#f97316" radius={[0, 10, 10, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Top uploaders" subtitle="People driving document movement">
          <div className="space-y-3">
            {uploaderRanking.map((item, index) => (
              <div key={item.name} className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">{item.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{statLabel(item.uploads, "upload")}</div>
                </div>
                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-teal-600" style={{ width: `${(item.uploads / Math.max(1, uploaderRanking[0]?.uploads || 1)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Executive observations" subtitle="Quick reads from the expanded analytics workspace">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Plant concentration</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.mostDocumentedPlant?.plant || "No plant"} currently leads the network with{" "}
                {timelineHighlights.mostDocumentedPlant?.documents || 0} documents and{" "}
                {timelineHighlights.mostDocumentedPlant?.projects || 0} active project spaces.
              </div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Category pressure</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.busiestCategory?.name || "No dominant category"} is the heaviest stream,
                suggesting where governance and approvals will cluster.
              </div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Access governance</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.totalLocked} records are currently in manager-locked view, which is useful for tracing controlled review behavior.
              </div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Project balance</div>
              <div className="mt-2 text-sm text-slate-600">
                Use the plant density and project intensity charts together to spot whether documentation is evenly distributed or concentrated in a few workstreams.
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function AdminDashboardPage() {
  const { users, documents, plants, portalState } = usePortal();
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#111827,_#3f3f46)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(17,24,39,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Admin dashboard</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">User governance, access control, and network policy</h1>
            <p className="mt-3 text-sm leading-6 text-white/72">
              Administration now has its own dashboard and separate pages for user management, role access, IP configuration, and session rules.
            </p>
          </div>
          <div className="grid min-w-[260px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <button onClick={() => navigate("/admin/users")} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Manage users
            </button>
            <button onClick={() => navigate("/admin/network")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
              Review IP rules
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Users" value={users.length} hint="Registered user accounts in the system." icon={Users} />
        <MetricCard label="Plants" value={plants.length} hint="Plants covered by governance and audit policies." icon={Building2} tone="blue" />
        <MetricCard label="Documents" value={documents.length} hint="Records available to govern and audit." icon={FileText} tone="amber" />
        <MetricCard label="IP Rules" value={portalState.ipRules.length} hint="Allow, block, and review network entries." icon={Network} tone="rose" />
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <AdminTile title="User management" body="Create users, toggle status, and review role assignments." to="/admin/users" icon={UserCog} />
        <AdminTile title="Access control" body="Adjust frontend role visibility and privileged actions." to="/admin/access" icon={ShieldCheck} />
        <AdminTile title="IP configuration" body="Maintain allowed, blocked, and review network addresses." to="/admin/network" icon={Globe} />
        <AdminTile title="Session policies" body="Configure auto logout and concurrent session handling." to="/admin/sessions" icon={Clock3} />
      </div>
    </div>
  );
}

function AdminTile({ title, body, to, icon: Icon }: { title: string; body: string; to: string; icon: React.ComponentType<{ size?: number }>; }) {
  return (
    <Link to={to} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] transition hover:-translate-y-1 hover:border-slate-300">
      <div className="flex items-center justify-between gap-3">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="text-slate-400">
          <Icon size={20} />
        </div>
      </div>
      <div className="mt-3 text-sm text-slate-600">{body}</div>
    </Link>
  );
}

function AdminUsersPage() {
  const { users, refreshData } = usePortal();
  const [search, setSearch] = useState("");
  const filtered = users.filter((user) => [user.name, user.email, user.role, user.plant || ""].join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Users" }]} />
      <SectionCard title="User management" subtitle="Admin-only controls for people, roles, and account state">
        <div className="mb-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users..." className="h-12 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
        </div>
        <div className="overflow-hidden rounded-[28px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Plant</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-4 font-semibold text-slate-900">{user.name}</td>
                  <td className="px-4 py-4 text-slate-600">{formatRole(user.role)}</td>
                  <td className="px-4 py-4 text-slate-600">{user.email}</td>
                  <td className="px-4 py-4 text-slate-600">{user.plant || "All plants"}</td>
                  <td className="px-4 py-4">
                    <button
                      onClick={async () => {
                        await usersApi.toggleStatus(user.id);
                        await refreshData();
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${user.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {user.status === "Active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function AdminAccessPage() {
  const { portalState, setAccessRules } = usePortal();

  function updateRule(index: number, field: keyof AccessRule, value: string | boolean) {
    const next = portalState.accessRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [field]: value } : rule);
    setAccessRules(next);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Access Control" }]} />
      <SectionCard title="Role-based access control" subtitle="Frontend restrictions by role">
        <div className="grid gap-4">
          {portalState.accessRules.map((rule, index) => (
            <div key={rule.role} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{formatRole(rule.role)}</div>
                  <div className="mt-1 text-sm text-slate-500">{rule.plantsScope}</div>
                </div>
                <input value={rule.plantsScope} onChange={(event) => updateRule(index, "plantsScope", event.target.value)} className="h-11 w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <AccessToggle label="Create projects" checked={rule.canCreateProjects} onChange={(checked) => updateRule(index, "canCreateProjects", checked)} />
                <AccessToggle label="Upload documents" checked={rule.canUploadDocuments} onChange={(checked) => updateRule(index, "canUploadDocuments", checked)} />
                <AccessToggle label="Edit documents" checked={rule.canEditDocuments} onChange={(checked) => updateRule(index, "canEditDocuments", checked)} />
                <AccessToggle label="Delete documents" checked={rule.canDeleteDocuments} onChange={(checked) => updateRule(index, "canDeleteDocuments", checked)} />
                <AccessToggle label="Manage users" checked={rule.canManageUsers} onChange={(checked) => updateRule(index, "canManageUsers", checked)} />
                <AccessToggle label="Configure IP" checked={rule.canConfigureIp} onChange={(checked) => updateRule(index, "canConfigureIp", checked)} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function AccessToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void; }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-teal-600" />
    </label>
  );
}

function AdminNetworkPage() {
  const { portalState, setIpRules } = usePortal();

  function updateRule(id: string, status: IpRule["status"]) {
    setIpRules(portalState.ipRules.map((rule) => rule.id === id ? { ...rule, status, lastUpdated: new Date().toISOString().slice(0, 10) } : rule));
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "IP Configuration" }]} />
      <SectionCard title="IP configuration" subtitle="Allow, block, and review network sources">
        <div className="grid gap-4">
          {portalState.ipRules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-slate-200 bg-white p-5">
              <div>
                <div className="text-base font-semibold text-slate-900">{rule.label}</div>
                <div className="mt-1 font-mono text-sm text-slate-500">{rule.address}</div>
                <div className="mt-1 text-xs text-slate-400">Updated {formatDate(rule.lastUpdated)}</div>
              </div>
              <select value={rule.status} onChange={(event) => updateRule(rule.id, event.target.value as IpRule["status"])} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-teal-500">
                <option value="Allowed">Allowed</option>
                <option value="Blocked">Blocked</option>
                <option value="Review">Review</option>
              </select>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function AdminSessionsPage() {
  const { portalState, setSessionPolicyValue } = usePortal();
  const policy = portalState.sessionPolicy;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Sessions" }]} />
      <SectionCard title="Session policies" subtitle="Auto logout and session conflict behavior">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Auto logout minutes</span>
            <input
              type="number"
              min={5}
              max={120}
              value={policy.autoLogoutMinutes}
              onChange={(event) => setSessionPolicyValue({ ...policy, autoLogoutMinutes: Number(event.target.value) || 15 })}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Conflict mode</span>
            <select
              value={policy.conflictMode}
              onChange={(event) => setSessionPolicyValue({ ...policy, conflictMode: event.target.value as SessionPolicy["conflictMode"] })}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
            >
              <option value="warn">Warn user</option>
              <option value="block">Block previous session</option>
            </select>
          </label>
          <AccessToggle label="Enforce single active session" checked={policy.enforceSingleSession} onChange={(checked) => setSessionPolicyValue({ ...policy, enforceSingleSession: checked })} />
        </div>
      </SectionCard>
    </div>
  );
}

function NotFoundCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();

  const router = useMemo(() => {
    if (!user) return null;
    return createBrowserRouter([
      {
        path: "/",
        element: (
          <PortalProvider user={user}>
            <PortalRoot logout={logout} />
          </PortalProvider>
        ),
        children: [
          { index: true, element: <Navigate to={defaultHome(user.role)} replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "plants", element: <RoleGate allowed={["CEO", "Mining Manager"]}><PlantIndexPage /></RoleGate> },
          { path: "plants/:plantId", element: <RoleGate allowed={["CEO", "Mining Manager"]}><PlantProjectsPage /></RoleGate> },
          { path: "plants/:plantId/projects/new", element: <RoleGate allowed={["Mining Manager"]}><ProjectCreatePage /></RoleGate> },
          { path: "plants/:plantId/projects/:projectId/documents", element: <RoleGate allowed={["CEO", "Mining Manager"]}><ProjectDocumentsPage /></RoleGate> },
          { path: "documents", element: <RoleGate allowed={["CEO", "Mining Manager"]}><DocumentsPage /></RoleGate> },
          { path: "documents/:documentId", element: <RoleGate allowed={["CEO", "Mining Manager"]}><DocumentDetailPage /></RoleGate> },
          { path: "analytics", element: <RoleGate allowed={["CEO"]}><AnalyticsPage /></RoleGate> },
          { path: "upload", element: <RoleGate allowed={["Mining Manager"]}><ManagerUpload /></RoleGate> },
          { path: "admin", element: <RoleGate allowed={["Admin"]}><AdminDashboardPage /></RoleGate> },
          { path: "admin/users", element: <RoleGate allowed={["Admin"]}><AdminUsersPage /></RoleGate> },
          { path: "admin/access", element: <RoleGate allowed={["Admin"]}><AdminAccessPage /></RoleGate> },
          { path: "admin/network", element: <RoleGate allowed={["Admin"]}><AdminNetworkPage /></RoleGate> },
          { path: "admin/sessions", element: <RoleGate allowed={["Admin"]}><AdminSessionsPage /></RoleGate> },
          { path: "settings", element: <RoleGate allowed={["CEO", "Mining Manager"]}><SettingsPage /></RoleGate> },
          { path: "admin/settings", element: <RoleGate allowed={["Admin"]}><SettingsPage /></RoleGate> },
          { path: "*", element: <Navigate to={defaultHome(user.role)} replace /> },
        ],
      },
    ]);
  }, [logout, user]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-white/70">Loading application...</div>;
  }

  if (!user) return <LoginPage />;
  return <RouterProvider router={router!} />;
}

function PortalRoot({ logout }: { logout: () => Promise<void> }) {
  const { user, portalState } = usePortal();
  const session = useSessionUi(user, logout, portalState.sessionPolicy);

  return <Shell onLogout={() => { void logout(); }} session={session} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
