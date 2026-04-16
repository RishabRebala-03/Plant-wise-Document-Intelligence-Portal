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
  Database,
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
import { DetailedActivityLog } from "./components/detailed-activity-log";
import { DocumentDrawer } from "./components/document-drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { AuthProvider, useAuth } from "./lib/auth";
import { ApiError, LIVE_SYNC_INTERVAL_MS, activitiesApi, documentsApi, notificationsApi, plantsApi, projectsApi, settingsApi, usersApi } from "./lib/api";
import {
  createProject,
  defaultPortalState,
  enrichDocuments,
  formatRole,
  getAccessRuleForRole,
  hasAccessCapability,
  lockManagerDocument,
  PORTAL_STATE_KEY,
  persistPortalState,
  readPortalState,
  summarizeByPlant,
  updateAccessRules,
  updateIpRules,
  updateSessionPolicy,
  withManagerLocks,
  type AccessRule,
  type AccessCapability,
  type EnrichedDocument,
  type IpRule,
  type PortalState,
  type ProjectRecord,
  type SessionPolicy,
} from "./lib/portal";
import type { Activity, Comment, DocumentRecord, GovernancePolicy, NotificationItem, OutsideHoursAttempt, Plant, SessionRecord, User, UserRole } from "./lib/types";

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
  setAccessRules: (rules: AccessRule[]) => Promise<void>;
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
  capability?: AccessCapability;
};

const PortalContext = createContext<PortalContextValue | null>(null);
const SESSION_STORAGE_PREFIX = "midwest.activeSession";
const SESSION_WARNING_SECONDS = 60;
const CHART_COLORS = ["#0A6ED1", "#107E3E", "#5B738B", "#354A5F", "#7F97AD"];

function usePortal() {
  const value = useContext(PortalContext);
  if (!value) {
    throw new Error("usePortal must be used inside PortalProvider");
  }
  return value;
}

function useRoleAccess() {
  const { user, portalState } = usePortal();
  const accessRule = useMemo(
    () => (user.accessRule?.role ? user.accessRule as AccessRule : getAccessRuleForRole(portalState.accessRules, user.role)),
    [portalState.accessRules, user.accessRule, user.role],
  );

  function can(capability: AccessCapability) {
    if (user.role === "Admin") return true;
    if (user.capabilities && capability in user.capabilities) {
      return Boolean(user.capabilities[capability]);
    }
    return hasAccessCapability(accessRule, capability);
  }

  return { accessRule, can };
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

function assignedPlantIds(user: User) {
  return user.assignedPlantIds?.length ? user.assignedPlantIds : user.plantId ? [user.plantId] : [];
}

function primaryPlantId(user: User) {
  return assignedPlantIds(user)[0] || user.plantId || "";
}

function scopedPlantIds(user: User, plants: Plant[]) {
  if (user.role === "Admin") {
    return plants.map((plant) => plant.id);
  }
  const assigned = assignedPlantIds(user);
  if (assigned.length) return assigned;
  if (user.role === "CEO") {
    return plants.map((plant) => plant.id);
  }
  return user.plantId ? [user.plantId] : [];
}

function userHasScopedPlants(user: User) {
  return user.role !== "Admin" && assignedPlantIds(user).length > 0;
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
    const [documentsResult, plantsResult, usersResult, notificationsResult, accessRulesResult] = await Promise.all([
      documentsApi.list({ page: 1, pageSize: 500 }),
      plantsApi.list(),
      usersApi.list().catch(() => [] as User[]),
      notificationsApi.list().catch(() => emptyNotifications()),
      settingsApi.listAccessRules().catch(() => ({ items: [] as AccessRule[] })),
    ]);

    setRawDocuments(documentsResult.items);
    setPlants(plantsResult.items);
    setUsers(usersResult);
    setNotifications(notificationsResult.items);
    setPortalState((current) => {
      const next = readPortalState(plantsResult.items, documentsResult.items);
      return current.projects.length === 0 ? next : {
        ...next,
        accessRules: accessRulesResult.items.length ? accessRulesResult.items : next.accessRules,
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
    const timer = window.setInterval(() => {
      void loadAll().catch(() => undefined);
    }, LIVE_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [user.id]);

  useEffect(() => {
    if (!plants.length && !rawDocuments.length) return;
    persistPortalState(portalState);
  }, [plants.length, portalState, rawDocuments.length]);

  useEffect(() => {
    function syncPortalState(event: StorageEvent) {
      if (event.key !== PORTAL_STATE_KEY) return;
      setPortalState(readPortalState(plants, rawDocuments));
    }

    window.addEventListener("storage", syncPortalState);
    return () => window.removeEventListener("storage", syncPortalState);
  }, [plants, rawDocuments]);

  const visiblePlantIds = useMemo(() => new Set(scopedPlantIds(user, plants)), [plants, user]);
  const scopedPlants = useMemo(
    () => plants.filter((plant) => visiblePlantIds.has(plant.id)),
    [plants, visiblePlantIds],
  );
  const scopedProjects = useMemo(
    () => portalState.projects.filter((project) => visiblePlantIds.has(project.plantId)),
    [portalState.projects, visiblePlantIds],
  );
  const scopedRawDocuments = useMemo(
    () => rawDocuments.filter((document) => visiblePlantIds.has(document.plantId)),
    [rawDocuments, visiblePlantIds],
  );
  const documents = useMemo(() => {
    const enriched = enrichDocuments(scopedRawDocuments, scopedProjects, user, scopedPlants, portalState.projectAssignments);
    return withManagerLocks(enriched, portalState, user);
  }, [portalState, scopedPlants, scopedProjects, scopedRawDocuments, user]);

  const value = useMemo<PortalContextValue>(() => ({
    user,
    plants: scopedPlants,
    documents,
    rawDocuments: scopedRawDocuments,
    users,
    projects: scopedProjects,
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
    setAccessRules: async (rules) => {
      const result = await settingsApi.updateAccessRules({ rules });
      setPortalState((current) => updateAccessRules(current, result.items));
    },
    setIpRules: (rules) => setPortalState((current) => updateIpRules(current, rules)),
    setSessionPolicyValue: (policy) => setPortalState((current) => updateSessionPolicy(current, policy)),
  }), [documents, loading, notifications, portalState, scopedPlants, scopedProjects, scopedRawDocuments, user, users]);

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

function RoleGate({ allowed, capability, children }: { allowed?: UserRole[]; capability?: AccessCapability; children: ReactNode }) {
  const { user, portalState } = usePortal();
  const accessRule = getAccessRuleForRole(portalState.accessRules, user.role);

  if (allowed && !roleAllows(user.role, allowed)) {
    return <Navigate to={defaultHome(user.role)} replace />;
  }
  if (capability && !hasAccessCapability(accessRule, capability)) {
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
    teal: "from-[#107E3E]/12 to-[#D5F6DE]/40 text-[#107E3E]",
    amber: "from-[#D1E8FF]/80 to-[#EAF3FC] text-[#0A6ED1]",
    blue: "from-[#0A6ED1]/12 to-[#EAF3FC] text-[#0A6ED1]",
    rose: "from-[#EAECEE] to-[#F5F6F7] text-[#354A5F]",
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
  const { can } = useRoleAccess();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isCeo = user.role === "CEO";

  const navGroups = useMemo<NavItem[][]>(() => {
    const common: NavItem[] = [{ label: "Settings", path: user.role === "Admin" ? "/admin/settings" : "/settings", icon: Settings }];
    if (user.role === "CEO") {
      const governance: NavItem[] = [];
      if (can("canManageUsers")) {
        governance.push({ label: "Manager Access", path: "/oversight", icon: UserCog, capability: "canManageUsers" });
      }
      if (can("canConfigureIp")) {
        governance.push({ label: "IP Configuration", path: "/admin/network", icon: Network, capability: "canConfigureIp" });
      }
      return [
        [
          { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
          { label: "Plants", path: "/plants", icon: Building2 },
          { label: "Documents", path: "/documents", icon: FileText },
          { label: "Analytics", path: "/analytics", icon: LineChartIcon },
          { label: "Audit Logs", path: "/activity-logs", icon: Clock3 },
          ...governance,
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
          { label: "Project Creation", path: `/plants/${primaryPlantId(user)}/projects/new`, icon: Plus, capability: "canCreateProjects" },
          { label: "Upload", path: "/upload", icon: Upload, capability: "canUploadDocuments" },
        ],
        common,
      ];
    }
    return [
      [
        { label: "Admin Dashboard", path: "/admin", icon: LayoutDashboard },
        { label: "Users", path: "/admin/users", icon: Users, capability: "canManageUsers" },
        { label: "Master Data", path: "/admin/master-data", icon: Database, capability: "canManageUsers" },
        { label: "Access Control", path: "/admin/access", icon: ShieldCheck },
        { label: "IP Configuration", path: "/admin/network", icon: Network, capability: "canConfigureIp" },
        { label: "Sessions", path: "/admin/sessions", icon: Clock3 },
        { label: "Audit Logs", path: "/admin/activity-logs", icon: LineChartIcon },
      ],
      common,
    ];
  }, [can, user]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(10,110,209,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(91,115,139,0.10),_transparent_26%),linear-gradient(180deg,_#f7f9fb,_#eef3f7)] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-slate-950/95 px-5 py-4 text-white backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/50">Plant-wise document intelligence</div>
            <div className="mt-1 flex items-center gap-3">
              <div className="rounded-2xl bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.15)]">
                <img src="/midwest-logo.svg" alt="Midwest logo" className="h-8 w-auto" />
              </div>
              <div>
                <div className="text-lg font-semibold">Midwest Operations Portal</div>
                <div className="text-sm text-white/60">{formatRole(user.role)} workspace</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${session.conflictDetected ? "bg-[#BB0000]/20 text-white" : session.warningOpen ? "bg-[#D1E8FF]/20 text-[#D1E8FF]" : "bg-white/10 text-white/80"}`}>
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
        <div className="border-b border-[#BBD4F6] bg-[#EAF3FC] px-5 py-3 text-sm text-[#0A6ED1]">
          Your session will expire in {session.secondsRemaining} seconds.{" "}
          <button onClick={session.extendSession} className="font-semibold underline">
            Stay signed in
          </button>
        </div>
      ) : null}

      {session.conflictDetected || session.sessionExpiredReason ? (
        <div className="border-b border-[#D9D9D9] bg-[#F5F6F7] px-5 py-3 text-sm text-[#354A5F]">
          {session.sessionExpiredReason || "A newer login was detected for this account. To avoid session overlap, this tab is now locked."}
        </div>
      ) : null}

      <div className="relative mx-auto flex w-full max-w-[1600px] gap-6 px-4 py-6 lg:px-6">
        {session.conflictDetected || session.sessionExpiredReason ? (
          <div className="absolute inset-0 z-20 flex items-start justify-center px-4 pt-10">
            <div className="w-full max-w-2xl rounded-[32px] border border-[#D9D9D9] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
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
            <div className={`rounded-3xl p-4 text-white ${isCeo ? "bg-[linear-gradient(135deg,_#0A6ED1,_#0854A0)]" : "bg-[linear-gradient(135deg,_#354A5F,_#5B738B)]"}`}>
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
                {group.filter((item) => !item.capability || can(item.capability)).map((item) => {
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
                {user.accessRule?.plantsScope || portalState.accessRules.find((rule) => rule.role === user.role)?.plantsScope || "Controlled by administrator"}
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
    plantId: item.plantId,
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
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0A6ED1,_#0854A0)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(10,110,209,0.24)]">
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
        <MetricCard label="Mining Managers" value={miningManagers} hint="Managers currently configured in the system." icon={Users} tone="rose" onClick={() => navigate("/oversight")} />
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
                <Bar
                  dataKey="documents"
                  fill="#0A6ED1"
                  radius={[10, 10, 0, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string } | undefined;
                    if (payload?.plantId) navigate(`/plants/${payload.plantId}`);
                  }}
                />
                <Bar
                  dataKey="projects"
                  fill="#5B738B"
                  radius={[10, 10, 0, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string } | undefined;
                    if (payload?.plantId) navigate(`/plants/${payload.plantId}`);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Document mix" subtitle="Distribution by category">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categorySeries}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={70}
                  outerRadius={110}
                  cursor="pointer"
                  onClick={(entry) => {
                    const category = (entry as { name?: string } | undefined)?.name;
                    if (category) navigate(`/documents?category=${encodeURIComponent(category)}`);
                  }}
                >
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
              <button
                key={item.name}
                type="button"
                onClick={() => navigate(`/documents?category=${encodeURIComponent(item.name)}`)}
                className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
              >
                <span>{item.name}</span>
                <span className="font-semibold text-slate-900">{item.value}</span>
              </button>
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
                className="group rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-[#BBD4F6] hover:bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="text-base font-semibold text-slate-900">{item.plant}</div>
                  <Building2 size={18} className="text-slate-400 transition group-hover:text-[#0A6ED1]" />
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
              <div key={plant.id} className="rounded-3xl border border-[#D1E8FF] bg-[#F5FAFF] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{plant.name}</div>
                    <div className="mt-1 text-sm text-slate-600">Last upload: {formatDate(plant.lastUpload)}</div>
                  </div>
                  <Link to={`/plants/${plant.id}`} className="text-sm font-semibold text-[#0A6ED1] hover:text-[#0854A0]">
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
  const { can } = useRoleAccess();
  const navigate = useNavigate();
  const allowedPlantIds = assignedPlantIds(user);
  const myProjects = projects.filter((project) => allowedPlantIds.includes(project.plantId));
  const myDocuments = documents.filter((document) => allowedPlantIds.includes(document.plantId));
  const lockedDocuments = myDocuments.filter((document) => document.accessLocked);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#1d4ed8)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Manager dashboard</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{user.assignedPlants?.join(", ") || user.plant || "Assigned plants"} project control</h1>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Managers can create projects and upload within their plant scope, but document edit and delete actions are now removed.
              Once a document is accessed, its manager view is marked as locked for the current session.
            </p>
          </div>
          <div className="grid min-w-[260px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <button onClick={() => navigate(`/plants/${primaryPlantId(user)}`)} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Open plant workspace
            </button>
            {can("canUploadDocuments") ? (
              <button onClick={() => navigate("/upload")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
                Upload a document
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="My Projects" value={myProjects.length} hint="Project spaces under your plant." icon={FolderKanban} onClick={() => navigate("/plants")} />
        <MetricCard label="My Documents" value={myDocuments.length} hint="Documents visible inside your plant scope." icon={FileText} tone="blue" onClick={() => navigate("/documents")} />
        <MetricCard label="Locked After Access" value={lockedDocuments.length} hint="Read-only items opened in this manager session." icon={Lock} tone="rose" onClick={() => navigate("/documents")} />
        <MetricCard label="Upload Rights" value={can("canUploadDocuments") ? "Enabled" : "Disabled"} hint="Managers can upload only when the live access rule permits it." icon={Upload} tone="amber" onClick={can("canUploadDocuments") ? () => navigate("/upload") : undefined} />
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
              <div className="mt-1">All plant, project, and document pathways stay inside {user.assignedPlants?.join(", ") || user.plant || "your assigned plants"}.</div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function PlantIndexPage() {
  const { user, plants, documents, projects } = usePortal();
  const allowedPlantIds = assignedPlantIds(user);
  const visiblePlants = user.role === "Mining Manager" && allowedPlantIds.length
    ? plants.filter((plant) => allowedPlantIds.includes(plant.id))
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
  const { can } = useRoleAccess();
  const navigate = useNavigate();
  const allowedPlantIds = assignedPlantIds(user);
  const plant = plants.find((item) => item.id === plantId);
  const plantProjects = projects.filter((project) => project.plantId === plantId);
  const plantDocuments = documents.filter((document) => document.plantId === plantId);
  const canCreate = user.role === "Mining Manager" && allowedPlantIds.includes(plantId || "") && can("canCreateProjects");

  if (!plant) return <NotFoundCard title="Plant not found" body="The selected plant could not be located in the current workspace." />;
  if (user.role === "Mining Manager" && !allowedPlantIds.includes(plantId || "")) return <Navigate to={defaultHome(user.role)} replace />;

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
                <div className="mt-1 text-sm text-slate-500">{project.code}</div>
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
  const { can } = useRoleAccess();
  const navigate = useNavigate();
  const managerPlantIds = assignedPlantIds(user);
  const managerPlants = plants.filter((item) => managerPlantIds.includes(item.id));
  const [selectedPlantId, setSelectedPlantId] = useState(managerPlantIds.includes(plantId || "") ? plantId || "" : "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (managerPlantIds.includes(plantId || "")) {
      setSelectedPlantId(plantId || "");
    }
  }, [managerPlantIds, plantId]);

  const selectedPlant = managerPlants.find((item) => item.id === selectedPlantId);

  if (user.role !== "Mining Manager" || !can("canCreateProjects")) {
    return <Navigate to={defaultHome(user.role)} replace />;
  }
  if (!managerPlants.length) {
    return <NotFoundCard title="No plant assigned" body="A manager can create a project only after an admin assigns at least one plant." />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPlant) {
      return;
    }
    const created = await createProjectRecord({
      plantId: selectedPlant.id,
      plantName: selectedPlant.name,
      name,
      code: code || name.slice(0, 6).toUpperCase().replace(/\s+/g, ""),
      description,
      owner: user.name,
      dueDate: dueDate || null,
    });
    navigate(`/plants/${selectedPlant.id}/projects/${created.id}/documents`);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Plants", to: "/plants" },
          ...(selectedPlant ? [{ label: selectedPlant.name, to: `/plants/${selectedPlant.id}` }] : []),
          { label: "Create Project" },
        ]}
      />
      <SectionCard title="Create project" subtitle="Managers can create project spaces within their assigned plant">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium text-slate-700">Plant</span>
            <select
              value={selectedPlantId}
              onChange={(event) => setSelectedPlantId(event.target.value)}
              required
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
            >
              <option value="">Select plant</option>
              {managerPlants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <div className="text-xs text-slate-500">Select the plant first. The project will be created only inside that assigned plant workspace.</div>
          </label>
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
            <button type="submit" disabled={!selectedPlantId} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
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
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [manager, setManager] = useState(searchParams.get("manager") || "");
  const [identifier, setIdentifier] = useState(searchParams.get("identifier") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [plantId, setPlantId] = useState(scopedPlantId || (user.role === "Mining Manager" ? primaryPlantId(user) : searchParams.get("plantId") || ""));
  const [projectId, setProjectId] = useState(scopedProjectId || searchParams.get("projectId") || "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (scopedPlantId) setPlantId(scopedPlantId);
    if (scopedProjectId) setProjectId(scopedProjectId);
  }, [scopedPlantId, scopedProjectId]);

  useEffect(() => {
    setQuery(searchParams.get("q") || "");
    setManager(searchParams.get("manager") || "");
    setIdentifier(searchParams.get("identifier") || "");
    setCategory(searchParams.get("category") || "");
    if (!scopedPlantId && user.role !== "Mining Manager") {
      setPlantId(searchParams.get("plantId") || "");
    }
    if (!scopedProjectId) {
      setProjectId(searchParams.get("projectId") || "");
    }
  }, [scopedPlantId, scopedProjectId, searchParams, user.role]);

  const queryOptions = useMemo(
    () => Array.from(new Set(documents.map((document) => document.name))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );
  const managerOptions = useMemo(
    () => Array.from(new Set(documents.map((document) => document.managerName))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );
  const identifierOptions = useMemo(
    () => Array.from(new Set(documents.map((document) => document.identifier))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );
  const dateOptions = useMemo(
    () =>
      Array.from(new Set(documents.map((document) => document.date).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );

  const filtered = useMemo(() => documents.filter((document) => {
    const matchesPlant = !plantId || document.plantId === plantId;
    const matchesProject = !projectId || document.projectId === projectId;
    const matchesCategory = !category || document.category === category;
    const matchesManager = !manager || document.managerName === manager;
    const matchesIdentifier = !identifier || document.identifier === identifier;
    const matchesQuery = !query || document.name === query;
    const matchesFrom = !dateFrom || Boolean(document.date && document.date >= dateFrom);
    const matchesTo = !dateTo || Boolean(document.date && document.date <= dateTo);
    return matchesPlant && matchesProject && matchesCategory && matchesManager && matchesIdentifier && matchesQuery && matchesFrom && matchesTo;
  }), [category, dateFrom, dateTo, documents, identifier, manager, plantId, projectId, query]);

  const availableProjects = projects.filter((project) => !plantId || project.plantId === plantId);
  const categories = Array.from(new Set(documents.map((document) => document.category))).sort((a, b) => a.localeCompare(b));
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
            <select value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">All documents</option>
              {queryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Users} label="Manager">
            <select value={manager} onChange={(event) => setManager(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">All managers</option>
              {managerOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={FileText} label="Identifier">
            <select value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">All identifiers</option>
              {identifierOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={BarChart3} label="Category">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Building2} label="Plant">
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)} disabled={user.role === "Mining Manager" || Boolean(scopedPlantId)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500 disabled:bg-slate-100">
              <option value="">All plants</option>
              {plants.filter((plant) => user.role !== "Mining Manager" || assignedPlantIds(user).includes(plant.id)).map((plant) => (
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
            <select value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">Any start date</option>
              {dateOptions.map((option) => (
                <option key={`from-${option}`} value={option}>{formatDate(option)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Clock3} label="To date">
            <select value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">Any end date</option>
              {dateOptions.map((option) => (
                <option key={`to-${option}`} value={option}>{formatDate(option)}</option>
              ))}
            </select>
          </FilterField>
          <div className="flex items-end">
            <button
              onClick={() => {
                setQuery("");
                setManager("");
                setIdentifier("");
                setCategory("");
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
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No documents matched the selected filters.</td>
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
        </div>
      </section>

      {user.role === "Mining Manager" ? (
        <div className="rounded-3xl border border-[#BBD4F6] bg-[#EAF3FC] px-5 py-4 text-sm text-[#0A6ED1]">
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
  const navigate = useNavigate();

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
          plantId: plant.id,
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
          plantId: project.plantId,
          projectId: project.id,
          name: project.name.length > 18 ? `${project.name.slice(0, 18)}...` : project.name,
          documents: projectDocs.length,
          privateNotes,
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
        <MetricCard label="Upload trend" value={`${timelineHighlights.growth >= 0 ? "+" : ""}${timelineHighlights.growth}%`} hint="Month-over-month document movement." icon={LineChartIcon} onClick={() => navigate("/documents")} />
        <MetricCard label="Top plant" value={timelineHighlights.mostDocumentedPlant?.plant || "-"} hint={`${timelineHighlights.mostDocumentedPlant?.documents || 0} indexed documents`} icon={Building2} tone="blue" onClick={() => navigate("/plants")} />
        <MetricCard label="Busiest category" value={timelineHighlights.busiestCategory?.name || "-"} hint={`${timelineHighlights.busiestCategory?.value || 0} records`} icon={BarChart3} tone="amber" onClick={() => navigate("/documents")} />
        <MetricCard label="Locked records" value={timelineHighlights.totalLocked} hint="Manager-opened records in controlled state." icon={Lock} tone="rose" onClick={() => navigate("/activity-logs")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Monthly uploads and controlled access" subtitle="Line chart with overlay for locked records">
          <button type="button" onClick={() => navigate("/documents")} className="block h-96 w-full rounded-3xl transition hover:bg-slate-50">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="uploads" name="Uploads" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="locked" name="Locked" stroke="#5B738B" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </button>
        </SectionCard>

        <SectionCard title="Category distribution" subtitle="Pie view of document mix">
          <div className="h-96 rounded-3xl transition hover:bg-slate-50">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={70}
                  outerRadius={120}
                  cursor="pointer"
                  onClick={(entry) => {
                    const category = (entry as { name?: string } | undefined)?.name;
                    if (category) navigate(`/documents?category=${encodeURIComponent(category)}`);
                  }}
                >
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
          <div className="h-[26rem] rounded-3xl transition hover:bg-slate-50">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={plantBreakdown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="plant" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="documents"
                  name="Documents"
                  fill="#0f766e"
                  radius={[10, 10, 0, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string } | undefined;
                    if (payload?.plantId) navigate(`/plants/${payload.plantId}`);
                  }}
                />
                <Bar
                  dataKey="projects"
                  name="Projects"
                  fill="#5B738B"
                  radius={[10, 10, 0, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string } | undefined;
                    if (payload?.plantId) navigate(`/plants/${payload.plantId}`);
                  }}
                />
                <Bar
                  dataKey="avgPerProject"
                  name="Docs / Project"
                  fill="#1d4ed8"
                  radius={[10, 10, 0, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string } | undefined;
                    if (payload?.plantId) navigate(`/plants/${payload.plantId}`);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Rolling document accumulation" subtitle="Area graph showing cumulative load by month">
          <button type="button" onClick={() => navigate("/documents")} className="block h-[26rem] w-full rounded-3xl transition hover:bg-slate-50">
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
          </button>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Plant performance radar" subtitle="Multi-axis comparison across top plants">
          <button type="button" onClick={() => navigate("/plants")} className="block h-[26rem] w-full rounded-3xl transition hover:bg-slate-50">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarSeries}>
                <PolarGrid />
                <PolarAngleAxis dataKey="plant" />
                <PolarRadiusAxis />
                <Radar name="Documents" dataKey="documents" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.2} />
                <Radar name="Projects x10" dataKey="projects" stroke="#0f766e" fill="#0f766e" fillOpacity={0.2} />
                <Radar name="Locks x8" dataKey="locks" stroke="#5B738B" fill="#5B738B" fillOpacity={0.16} />
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </button>
        </SectionCard>

        <SectionCard title="Project intensity and note sensitivity" subtitle="Project comparison with document volume and private-note signals">
          <div className="h-[26rem] rounded-3xl transition hover:bg-slate-50">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectDepth} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" stroke="#64748b" />
                <YAxis type="category" dataKey="name" stroke="#64748b" width={130} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="documents"
                  name="Documents"
                  fill="#0A6ED1"
                  radius={[0, 10, 10, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string; projectId?: string } | undefined;
                    if (payload?.plantId && payload?.projectId) navigate(`/plants/${payload.plantId}/projects/${payload.projectId}/documents`);
                  }}
                />
                <Bar
                  dataKey="privateNotes"
                  name="Private note signals"
                  fill="#5B738B"
                  radius={[0, 10, 10, 0]}
                  cursor="pointer"
                  onClick={(state) => {
                    const payload = state?.payload as { plantId?: string; projectId?: string } | undefined;
                    if (payload?.plantId && payload?.projectId) navigate(`/plants/${payload.plantId}/projects/${payload.projectId}/documents`);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Top uploaders" subtitle="People driving document movement">
          <div className="space-y-3">
            {uploaderRanking.map((item, index) => (
              <button key={item.name} type="button" onClick={() => navigate("/oversight")} className="flex w-full items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300">
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
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Executive observations" subtitle="Quick reads from the expanded analytics workspace">
          <div className="grid gap-4 md:grid-cols-2">
            <button type="button" onClick={() => navigate("/plants")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Plant concentration</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.mostDocumentedPlant?.plant || "No plant"} currently leads the network with{" "}
                {timelineHighlights.mostDocumentedPlant?.documents || 0} documents and{" "}
                {timelineHighlights.mostDocumentedPlant?.projects || 0} active project spaces.
              </div>
            </button>
            <button type="button" onClick={() => navigate("/documents")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Category pressure</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.busiestCategory?.name || "No dominant category"} is the heaviest stream,
                suggesting where governance and approvals will cluster.
              </div>
            </button>
            <button type="button" onClick={() => navigate("/activity-logs")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Access governance</div>
              <div className="mt-2 text-sm text-slate-600">
                {timelineHighlights.totalLocked} records are currently in manager-locked view, which is useful for tracing controlled review behavior.
              </div>
            </button>
            <button type="button" onClick={() => navigate("/plants")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Project balance</div>
              <div className="mt-2 text-sm text-slate-600">
                Use the plant density and project intensity charts together to spot whether documentation is evenly distributed or concentrated in a few workstreams.
              </div>
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function AdminDashboardPage() {
  const { users, documents, plants, portalState } = usePortal();
  const { can } = useRoleAccess();
  const navigate = useNavigate();
  const disabledUsers = users.filter((candidate) => candidate.status !== "Active").length;
  const managerUsers = users.filter((candidate) => candidate.role === "Mining Manager");
  const multiPlantManagers = managerUsers.filter((candidate) => (candidate.assignedPlantIds?.length || 0) > 1).length;
  const executiveUsers = users.filter((candidate) => candidate.role !== "Mining Manager").length;
  const lockedDocuments = documents.filter((document) => document.accessLocked).length;
  const reviewRules = portalState.ipRules.filter((rule) => rule.status === "Review").length;
  const blockedRules = portalState.ipRules.filter((rule) => rule.status === "Blocked").length;
  const activeRules = portalState.ipRules.filter((rule) => rule.status === "Allowed").length;
  const roleMix = [
    { name: "Mining Managers", value: managerUsers.length, fill: "#B45309", route: "/admin/users" },
    { name: "Admins", value: users.filter((candidate) => candidate.role === "Admin").length, fill: "#0F766E", route: "/admin/access" },
    { name: "CEO", value: users.filter((candidate) => candidate.role === "CEO").length, fill: "#334155", route: "/admin/users" },
  ].filter((item) => item.value > 0);
  const ruleMix = [
    { name: "Allowed", value: activeRules, fill: "#0F766E" },
    { name: "Blocked", value: blockedRules, fill: "#B91C1C" },
    { name: "Review", value: reviewRules, fill: "#B45309" },
  ];
  const governanceSeries = [
    { name: "Multi-plant", value: multiPlantManagers, fill: "#B45309", route: "/admin/access" },
    { name: "Disabled", value: disabledUsers, fill: "#7C2D12", route: "/admin/users" },
    { name: "Locked docs", value: lockedDocuments, fill: "#334155", route: "/admin/activity-logs" },
    { name: "Rules review", value: reviewRules, fill: "#0F766E", route: "/admin/network" },
  ];
  const adminFocusAreas = [
    {
      title: "Identity operations",
      value: `${managerUsers.length}/${users.length}`,
      detail: `${disabledUsers} accounts need attention or reactivation.`,
      to: "/admin/users",
    },
    {
      title: "Plant access spread",
      value: `${multiPlantManagers}`,
      detail: "Managers currently span more than one plant scope.",
      to: "/admin/access",
    },
    {
      title: "Network posture",
      value: `${activeRules}/${portalState.ipRules.length || 0}`,
      detail: `${reviewRules} entries still require decision.`,
      to: "/admin/network",
    },
    {
      title: "Session enforcement",
      value: portalState.sessionPolicy.enforceSingleSession ? "Strict" : "Advisory",
      detail: `${portalState.sessionPolicy.autoLogoutMinutes} minute timeout with ${portalState.sessionPolicy.conflictMode} conflict handling.`,
      to: "/admin/sessions",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#111827,_#3f3f46)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(17,24,39,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Admin command center</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Governance analytics for identity, network policy, and platform controls</h1>
            <p className="mt-3 text-sm leading-6 text-white/72">
              This view is purpose-built for administration: less executive storytelling, more control coverage, risk posture, and direct drill-downs into enforceable settings.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 rounded-[28px] border border-white/10 bg-black/10 p-4 backdrop-blur">
            {can("canManageUsers") ? (
              <button onClick={() => navigate("/admin/users")} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-amber-50">
                Manage users
              </button>
            ) : null}
            {can("canConfigureIp") ? (
              <button onClick={() => navigate("/admin/network")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
                Review IP rules
              </button>
            ) : null}
            <button onClick={() => navigate("/admin/activity-logs")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
              Open audit logs
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Users" value={users.length} hint="Registered user accounts in the system." icon={Users} onClick={can("canManageUsers") ? () => navigate("/admin/users") : undefined} />
        <MetricCard label="Plants" value={plants.length} hint="Plants covered by governance and audit policies." icon={Building2} tone="blue" onClick={() => navigate("/admin/access")} />
        <MetricCard label="Documents" value={documents.length} hint="Records available to govern and audit." icon={FileText} tone="amber" onClick={() => navigate("/admin/activity-logs")} />
        <MetricCard label="IP Rules" value={portalState.ipRules.length} hint="Allow, block, and review network entries." icon={Network} tone="rose" onClick={can("canConfigureIp") ? () => navigate("/admin/network") : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Governance pressure points" subtitle="Clickable control metrics for the admin persona">
          <div className="grid gap-4 md:grid-cols-2">
            {governanceSeries.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => navigate(item.route)}
                className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,_#fffdf7,_#f5efe4)] p-5 text-left transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_18px_45px_rgba(120,53,15,0.12)]"
              >
                <div className="text-sm uppercase tracking-[0.2em] text-slate-500">{item.name}</div>
                <div className="mt-3 text-4xl font-semibold text-slate-950">{item.value}</div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (item.value / Math.max(1, users.length || documents.length || portalState.ipRules.length || 1)) * 100)}%`, backgroundColor: item.fill }} />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Control summary" subtitle="Direct links into admin areas">
          <div className="space-y-3">
            {adminFocusAreas.map((area) => (
              <button
                key={area.title}
                type="button"
                onClick={() => navigate(area.to)}
                className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">{area.title}</div>
                  <div className="text-lg font-semibold text-slate-900">{area.value}</div>
                </div>
                <div className="mt-1 text-sm text-slate-600">{area.detail}</div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Role mix" subtitle="Pie chart of who holds operational authority">
          <button
            type="button"
            onClick={() => navigate("/admin/users")}
            className="w-full rounded-[28px] bg-[radial-gradient(circle_at_top,_#fff7ed,_#fff_58%)] p-3 text-left transition hover:bg-[radial-gradient(circle_at_top,_#ffedd5,_#fff_58%)]"
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={roleMix} dataKey="value" nameKey="name" innerRadius={68} outerRadius={115} paddingAngle={3}>
                    {roleMix.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-3">
              {roleMix.map((item) => (
                <div key={item.name} className="rounded-2xl bg-white px-3 py-2">
                  <div className="font-semibold text-slate-900">{item.name}</div>
                  <div>{item.value} account{item.value === 1 ? "" : "s"}</div>
                </div>
              ))}
            </div>
          </button>
        </SectionCard>

        <SectionCard title="Policy status" subtitle="Bar view of admin hotspots and network rule posture">
          <div className="grid gap-4">
            <button
              type="button"
              onClick={() => navigate("/admin/network")}
              className="w-full rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#f8fafc,_#ffffff)] p-3 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ruleMix}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip />
                    <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                      {ruleMix.map((item) => (
                        <Cell key={item.name} fill={item.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate("/admin/activity-logs")}
              className="w-full rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#fff,_#f8fafc)] p-3 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={governanceSeries} layout="vertical" margin={{ left: 8, right: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" stroke="#64748b" />
                    <YAxis type="category" dataKey="name" stroke="#64748b" width={95} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 12, 12, 0]}>
                      {governanceSeries.map((item) => (
                        <Cell key={item.name} fill={item.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {can("canManageUsers") ? <AdminTile title="Manager oversight" body="Edit, remove, or inactivate manager accounts." to="/admin/users" icon={UserCog} /> : null}
        {can("canManageUsers") ? <AdminTile title="Master data" body="Create users, plants, projects, and govern documents from one admin workspace." to="/admin/master-data" icon={Database} /> : null}
        <AdminTile title="Access control" body="Adjust frontend role visibility and privileged actions." to="/admin/access" icon={ShieldCheck} />
        {can("canConfigureIp") ? <AdminTile title="IP configuration" body="Maintain allowed, blocked, and review network addresses." to="/admin/network" icon={Globe} /> : null}
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

function AdminMasterDataPage() {
  const { users, plants, documents, refreshData } = usePortal();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [plantSubmitting, setPlantSubmitting] = useState(false);
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [policySubmitting, setPolicySubmitting] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<EnrichedDocument | null>(null);
  const [documentComments, setDocumentComments] = useState<Comment[]>([]);
  const [editingPlantId, setEditingPlantId] = useState<string | null>(null);
  const [governancePolicy, setGovernancePolicy] = useState<GovernancePolicy>({
    allowedUploadFormats: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"],
    businessHours: {
      timezone: "Asia/Kolkata",
      startHour: 7,
      endHour: 20,
      allowedDays: [0, 1, 2, 3, 4],
    },
  });
  const [userDraft, setUserDraft] = useState({
    name: "",
    email: "",
    role: "Mining Manager" as UserRole,
    password: "Password123!",
    assignedPlantIds: [] as string[],
  });
  const [plantDraft, setPlantDraft] = useState({
    name: "",
    company: "Midwest Limited",
    location: "",
    capacity: "",
    manager: "",
  });
  const [plantEditDraft, setPlantEditDraft] = useState({
    name: "",
    company: "",
    location: "",
    capacity: "",
    manager: "",
  });
  const [projectDraft, setProjectDraft] = useState({
    plantId: "",
    name: "",
    code: "",
    description: "",
    dueDate: "",
  });
  const [documentPlantFilter, setDocumentPlantFilter] = useState("");
  const [documentProjectFilter, setDocumentProjectFilter] = useState("");

  async function loadProjects() {
    setLoadingProjects(true);
    try {
      const result = await projectsApi.list();
      setProjects(result.items as ProjectRecord[]);
      setProjectError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setProjectError("Project registry is not available from the backend yet. Restart the backend once to load the new projects route.");
      } else {
        setProjectError(err instanceof Error ? err.message : "Unable to load project registry.");
      }
    } finally {
      setLoadingProjects(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    settingsApi
      .getGovernancePolicy()
      .then((result) => setGovernancePolicy(result))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setError("Governance policy settings are not available from the backend yet. Restart the backend once to load the new admin policy route.");
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load governance policy.");
      });
  }, []);

  const filteredDocuments = useMemo(
    () =>
      documents.filter((document) => {
        const matchesPlant = !documentPlantFilter || document.plantId === documentPlantFilter;
        const matchesProject = !documentProjectFilter || document.projectId === documentProjectFilter;
        return matchesPlant && matchesProject;
      }),
    [documentPlantFilter, documentProjectFilter, documents],
  );

  function resetMessages() {
    setNotice("");
    setError("");
  }

  async function createUserRecord() {
    if (!userDraft.name.trim() || !userDraft.email.trim()) {
      setError("User name and email are required.");
      return;
    }
    setUserSubmitting(true);
    resetMessages();
    try {
      await usersApi.create({
        name: userDraft.name.trim(),
        email: userDraft.email.trim(),
        role: userDraft.role,
        password: userDraft.password,
        assignedPlantIds: userDraft.assignedPlantIds,
      });
      setNotice(`${userDraft.role} account created successfully.`);
      setUserDraft({
        name: "",
        email: "",
        role: "Mining Manager",
        password: "Password123!",
        assignedPlantIds: [],
      });
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create user.");
    } finally {
      setUserSubmitting(false);
    }
  }

  async function createPlantRecord() {
    if (!plantDraft.name.trim() || !plantDraft.company.trim()) {
      setError("Plant name and company are required.");
      return;
    }
    setPlantSubmitting(true);
    resetMessages();
    try {
      await plantsApi.create({
        name: plantDraft.name.trim(),
        company: plantDraft.company.trim(),
        location: plantDraft.location.trim(),
        capacity: plantDraft.capacity.trim(),
        manager: plantDraft.manager.trim(),
      });
      setNotice(`${plantDraft.name.trim()} was added to master data.`);
      setPlantDraft({
        name: "",
        company: "Midwest Limited",
        location: "",
        capacity: "",
        manager: "",
      });
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create plant.");
    } finally {
      setPlantSubmitting(false);
    }
  }

  async function createProjectEntry() {
    if (!projectDraft.plantId || !projectDraft.name.trim() || !projectDraft.description.trim()) {
      setError("Pick a plant and complete the project name and description.");
      return;
    }
    setProjectSubmitting(true);
    resetMessages();
    try {
      await projectsApi.create({
        plantId: projectDraft.plantId,
        name: projectDraft.name.trim(),
        code: projectDraft.code.trim(),
        description: projectDraft.description.trim(),
        dueDate: projectDraft.dueDate || null,
      });
      setNotice("Project created successfully.");
      setProjectError("");
      setProjectDraft({
        plantId: "",
        name: "",
        code: "",
        description: "",
        dueDate: "",
      });
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create project.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function saveGovernancePolicy() {
    setPolicySubmitting(true);
    resetMessages();
    try {
      const updated = await settingsApi.updateGovernancePolicy(governancePolicy);
      setGovernancePolicy(updated);
      setNotice("Upload format policy and manager business hours were updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update governance policy.");
    } finally {
      setPolicySubmitting(false);
    }
  }

  function openPlantEditor(plant: Plant) {
    setEditingPlantId(plant.id);
    setPlantEditDraft({
      name: plant.name,
      company: plant.company,
      location: plant.location || "",
      capacity: plant.capacity || "",
      manager: plant.manager || "",
    });
    resetMessages();
  }

  async function savePlantEdit() {
    if (!editingPlantId) return;
    setPlantSubmitting(true);
    resetMessages();
    try {
      await plantsApi.update(editingPlantId, plantEditDraft);
      setNotice("Plant details updated.");
      setEditingPlantId(null);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update plant.");
    } finally {
      setPlantSubmitting(false);
    }
  }

  async function removePlantRecord(plant: Plant) {
    if (!window.confirm(`Remove ${plant.name} from master data?`)) return;
    resetMessages();
    try {
      await plantsApi.remove(plant.id);
      setNotice(`${plant.name} was removed.`);
      if (editingPlantId === plant.id) setEditingPlantId(null);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove plant.");
    }
  }

  async function openDocumentEditor(document: EnrichedDocument) {
    setSelectedDocument(document);
    resetMessages();
    try {
      const result = await documentsApi.get(document.id);
      setDocumentComments(result.comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load document details.");
      setDocumentComments([]);
    }
  }

  async function updateDocumentRecord(documentId: string, payload: FormData) {
    await documentsApi.update(documentId, payload);
    setNotice("Document updated.");
    setSelectedDocument(null);
    await refreshData();
  }

  async function removeDocumentRecord(document: EnrichedDocument) {
    if (!window.confirm(`Delete ${document.name}? This cannot be undone.`)) return;
    resetMessages();
    try {
      await documentsApi.remove(document.id);
      setNotice(`${document.name} was deleted.`);
      if (selectedDocument?.id === document.id) setSelectedDocument(null);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete document.");
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Master Data" }]} />

      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="max-w-4xl">
          <div className="text-xs uppercase tracking-[0.26em] text-white/55">Master data control room</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Create and govern the platform’s foundational records</h1>
          <p className="mt-3 text-sm leading-6 text-white/72">
            Admin can create users, plants, and projects here, then manage documents from a plant-wise view without jumping across multiple admin screens.
          </p>
        </div>
      </section>

      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Users" value={users.length} hint="All platform accounts available for governance." icon={Users} />
        <MetricCard label="Plants" value={plants.length} hint="Operational plant records currently in master data." icon={Building2} tone="blue" />
        <MetricCard label="Projects" value={loadingProjects ? "..." : projects.length} hint="Projects registered across all plants." icon={FolderKanban} tone="amber" />
        <MetricCard label="Documents" value={documents.length} hint="Documents available for plant-wise admin control." icon={FileText} tone="teal" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Create user" subtitle="Provision Admin, CEO, or Mining Manager accounts">
          <div className="grid gap-3">
            <input value={userDraft.name} onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Full name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={userDraft.email} onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <select value={userDraft.role} onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value as UserRole, assignedPlantIds: event.target.value === "Mining Manager" ? current.assignedPlantIds : [] }))} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="Admin">Admin</option>
              <option value="CEO">CEO</option>
              <option value="Mining Manager">Mining Manager</option>
            </select>
            <input value={userDraft.password} onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))} placeholder="Temporary password" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Assigned plants</div>
              <div className="mt-1 text-xs text-slate-500">Optional for Admin and CEO. Use this to scope Mining Managers.</div>
              <div className="mt-3 grid max-h-44 gap-2 overflow-auto">
                {plants.map((plant) => (
                  <label key={`master-user-${plant.id}`} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">
                    <span>{plant.name}</span>
                    <input
                      type="checkbox"
                      checked={userDraft.assignedPlantIds.includes(plant.id)}
                      disabled={userDraft.role !== "Mining Manager"}
                      onChange={(event) => setUserDraft((current) => ({
                        ...current,
                        assignedPlantIds: event.target.checked
                          ? [...current.assignedPlantIds, plant.id]
                          : current.assignedPlantIds.filter((id) => id !== plant.id),
                      }))}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => void createUserRecord()} disabled={userSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                Create user
              </button>
              <button onClick={() => navigate("/admin/users")} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Open full user manager
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Create plant" subtitle="Add new operational plants to the platform">
          <div className="grid gap-3">
            <input value={plantDraft.name} onChange={(event) => setPlantDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Plant name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={plantDraft.company} onChange={(event) => setPlantDraft((current) => ({ ...current, company: event.target.value }))} placeholder="Company" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={plantDraft.location} onChange={(event) => setPlantDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={plantDraft.capacity} onChange={(event) => setPlantDraft((current) => ({ ...current, capacity: event.target.value }))} placeholder="Capacity" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={plantDraft.manager} onChange={(event) => setPlantDraft((current) => ({ ...current, manager: event.target.value }))} placeholder="Primary manager name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <button onClick={() => void createPlantRecord()} disabled={plantSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
              Create plant
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Create project" subtitle="Register a new project under a selected plant">
          <div className="grid gap-3">
            <select value={projectDraft.plantId} onChange={(event) => setProjectDraft((current) => ({ ...current, plantId: event.target.value }))} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="">Select plant</option>
              {plants.map((plant) => (
                <option key={`project-${plant.id}`} value={plant.id}>{plant.name}</option>
              ))}
            </select>
            <input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Project name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={projectDraft.code} onChange={(event) => setProjectDraft((current) => ({ ...current, code: event.target.value }))} placeholder="Project code" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <textarea value={projectDraft.description} onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Project description" rows={4} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-500" />
            <input type="date" value={projectDraft.dueDate} onChange={(event) => setProjectDraft((current) => ({ ...current, dueDate: event.target.value }))} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <button onClick={() => void createProjectEntry()} disabled={projectSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
              Create project
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Document upload formats" subtitle="Only these file types will be accepted in the manager upload workspace">
          <div className="grid gap-3 sm:grid-cols-2">
            {["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"].map((extension) => (
              <label key={`format-${extension}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <span>.{extension.toUpperCase()}</span>
                <input
                  type="checkbox"
                  checked={governancePolicy.allowedUploadFormats.includes(extension)}
                  onChange={(event) => setGovernancePolicy((current) => ({
                    ...current,
                    allowedUploadFormats: event.target.checked
                      ? [...current.allowedUploadFormats, extension]
                      : current.allowedUploadFormats.filter((value) => value !== extension),
                  }))}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">Managers will only be able to upload files matching the allowed formats selected here.</div>
        </SectionCard>

        <SectionCard title="Mining manager business hours" subtitle="Define the permitted working window for all mining-manager sign-ins">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Timezone</span>
              <input value={governancePolicy.businessHours.timezone} onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, timezone: event.target.value } }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Start hour</span>
              <input type="number" min={0} max={23} value={governancePolicy.businessHours.startHour} onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, startHour: Number(event.target.value) || 0 } }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">End hour</span>
              <input type="number" min={1} max={24} value={governancePolicy.businessHours.endHour} onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, endHour: Number(event.target.value) || 0 } }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Mon", value: 0 },
              { label: "Tue", value: 1 },
              { label: "Wed", value: 2 },
              { label: "Thu", value: 3 },
              { label: "Fri", value: 4 },
              { label: "Sat", value: 5 },
              { label: "Sun", value: 6 },
            ].map((day) => (
              <label key={`day-${day.value}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <span>{day.label}</span>
                <input
                  type="checkbox"
                  checked={governancePolicy.businessHours.allowedDays.includes(day.value)}
                  onChange={(event) => setGovernancePolicy((current) => ({
                    ...current,
                    businessHours: {
                      ...current.businessHours,
                      allowedDays: event.target.checked
                        ? [...current.businessHours.allowedDays, day.value].sort((a, b) => a - b)
                        : current.businessHours.allowedDays.filter((value) => value !== day.value),
                    },
                  }))}
                />
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button onClick={() => void saveGovernancePolicy()} disabled={policySubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
              Save policy controls
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="User registry snapshot" subtitle="Recent accounts and direct access into user governance">
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Assigned scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-sm">
                {users.slice(0, 8).map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{candidate.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{candidate.email}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{candidate.role}</td>
                    <td className="px-4 py-4 text-slate-600">{candidate.assignedPlants?.join(", ") || candidate.plant || "Enterprise access"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Plant registry" subtitle="Review, edit, or remove plants from master data">
          <div className="space-y-4">
            {plants.map((plant) => (
              <div key={plant.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{plant.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{plant.company}{plant.location ? ` • ${plant.location}` : ""}</div>
                    <div className="mt-1 text-xs text-slate-400">{plant.documents} document{plant.documents === 1 ? "" : "s"} linked</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openPlantEditor(plant)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                      Edit
                    </button>
                    <button onClick={() => void removePlantRecord(plant)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {editingPlantId ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <div className="text-base font-semibold text-slate-900">Edit plant</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input value={plantEditDraft.name} onChange={(event) => setPlantEditDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Plant name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                  <input value={plantEditDraft.company} onChange={(event) => setPlantEditDraft((current) => ({ ...current, company: event.target.value }))} placeholder="Company" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                  <input value={plantEditDraft.location} onChange={(event) => setPlantEditDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                  <input value={plantEditDraft.capacity} onChange={(event) => setPlantEditDraft((current) => ({ ...current, capacity: event.target.value }))} placeholder="Capacity" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                  <input value={plantEditDraft.manager} onChange={(event) => setPlantEditDraft((current) => ({ ...current, manager: event.target.value }))} placeholder="Manager" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500 md:col-span-2" />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={() => void savePlantEdit()} disabled={plantSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                    Save plant
                  </button>
                  <button onClick={() => setEditingPlantId(null)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Project registry" subtitle="All created projects across the platform">
        {loadingProjects ? <div className="text-sm text-slate-500">Loading project registry...</div> : null}
        {!loadingProjects && projectError ? <div className="text-sm text-amber-700">{projectError}</div> : null}
        {!loadingProjects && !projectError ? (
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm text-slate-500">
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Plant</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-sm">
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{project.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{project.code || project.id}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{project.plantName}</td>
                    <td className="px-4 py-4 text-slate-600">{project.owner}</td>
                    <td className="px-4 py-4 text-slate-600">{formatDate(project.createdAt)}</td>
                    <td className="px-4 py-4 text-slate-600">{project.documentIds.length}</td>
                  </tr>
                ))}
                {!projects.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No projects have been created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Document registry" subtitle="Plant-wise document visibility with edit and delete controls">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <select value={documentPlantFilter} onChange={(event) => setDocumentPlantFilter(event.target.value)} className="h-11 min-w-[220px] rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
            <option value="">All plants</option>
            {plants.map((plant) => (
              <option key={`doc-plant-${plant.id}`} value={plant.id}>{plant.name}</option>
            ))}
          </select>
          <select value={documentProjectFilter} onChange={(event) => setDocumentProjectFilter(event.target.value)} className="h-11 min-w-[220px] rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={`doc-project-${project.id}`} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
        <div className="overflow-hidden rounded-[24px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Plant</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Uploaded by</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {filteredDocuments.slice(0, 16).map((document) => (
                <tr key={document.id}>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-900">{document.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{document.category}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{document.plant}</td>
                  <td className="px-4 py-4 text-slate-600">{document.projectName || "-"}</td>
                  <td className="px-4 py-4 text-slate-600">{document.uploadedBy}</td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(document.date)}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void openDocumentEditor(document)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                        Edit
                      </button>
                      <button onClick={() => void removeDocumentRecord(document)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredDocuments.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No documents matched the current plant or project filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selectedDocument ? (
        <DocumentDrawer
          doc={selectedDocument}
          comments={documentComments}
          onClose={() => setSelectedDocument(null)}
          onUpdateDocument={(documentId, payload) => updateDocumentRecord(documentId, payload)}
          autoStartEdit
        />
      ) : null}
    </div>
  );
}

function ManagerOversightPage() {
  const { user, users, plants, refreshData } = usePortal();
  const [managerFilter, setManagerFilter] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [editor, setEditor] = useState<User | null>(null);
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ name: "", email: "", assignedPlantIds: [] as string[] });

  const managers = useMemo(
    () => users.filter((candidate) => candidate.role === "Mining Manager"),
    [users],
  );

  const managerOptions = useMemo(
    () => managers.map((candidate) => candidate.name).sort((a, b) => a.localeCompare(b)),
    [managers],
  );

  const filtered = useMemo(
    () =>
      managers.filter((candidate) => {
        const matchesManager = !managerFilter || candidate.name === managerFilter;
        const matchesPlant = !plantFilter || candidate.assignedPlantIds?.includes(plantFilter);
        return matchesManager && matchesPlant;
      }),
    [managerFilter, managers, plantFilter],
  );

  function openEditor(target: User) {
    setEditor(target);
    setDraft({
      name: target.name,
      email: target.email,
      assignedPlantIds: target.assignedPlantIds || (target.plantId ? [target.plantId] : []),
    });
    setError("");
    setMessage("");
  }

  async function saveManager() {
    if (!editor) return;
    setSubmitting(editor.id);
    setError("");
    setMessage("");
    try {
      await usersApi.update(editor.id, {
        name: draft.name,
        email: draft.email,
        assignedPlantIds: draft.assignedPlantIds,
      });
      setEditor(null);
      setMessage(`${draft.name} was updated successfully.`);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update manager.");
    } finally {
      setSubmitting(null);
    }
  }

  async function toggleManager(target: User) {
    setSubmitting(target.id);
    setError("");
    setMessage("");
    try {
      await usersApi.toggleStatus(target.id);
      setMessage(`${target.name} is now ${target.status === "Active" ? "inactive" : "active"}.`);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update manager status.");
    } finally {
      setSubmitting(null);
    }
  }

  async function removeManager(target: User) {
    const confirmed = window.confirm(`Remove ${target.name} from the platform? This cannot be undone.`);
    if (!confirmed) return;

    setSubmitting(target.id);
    setError("");
    setMessage("");
    try {
      await usersApi.remove(target.id);
      setMessage(`${target.name} was removed.`);
      if (editor?.id === target.id) setEditor(null);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove manager.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={user.role === "Admin" ? [{ label: "Admin", to: "/admin" }, { label: "Users" }] : [{ label: "Manager Access" }]} />
      <SectionCard
        title="Manager oversight"
        subtitle={user.role === "Admin" ? "Admin can update, remove, and inactivate manager accounts." : "CEO can review, edit, remove, and revoke access for mining managers."}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Managers" value={managers.length} hint="Mining manager accounts in the system." icon={Users} tone="blue" />
          <MetricCard label="Assigned plants" value={managers.reduce((total, candidate) => total + (candidate.assignedPlantIds?.length || 0), 0)} hint="Plant scopes currently distributed across manager accounts." icon={Building2} />
          <MetricCard label="Portal accounts" value={managers.length} hint="Manager records available for document coordination." icon={ShieldCheck} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <select
            value={managerFilter}
            onChange={(event) => setManagerFilter(event.target.value)}
            className="h-12 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
          >
            <option value="">All managers</option>
            {managerOptions.map((candidate) => (
              <option key={candidate} value={candidate}>{candidate}</option>
            ))}
          </select>
          <select value={plantFilter} onChange={(event) => setPlantFilter(event.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
            <option value="">All plants</option>
            {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </select>
          {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="text-sm text-[#BB0000]">{error}</div> : null}
        </div>

        <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Plant</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {filtered.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => navigate(user.role === "Admin" ? `/admin/users/${candidate.id}` : `/oversight/${candidate.id}`)}
                      className="font-semibold text-slate-900 transition hover:text-[#0A6ED1]"
                    >
                      {candidate.name}
                    </button>
                    <div className="mt-1 text-xs text-slate-500">{candidate.id}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{candidate.email}</td>
                  <td className="px-4 py-4 text-slate-600">{candidate.assignedPlants?.join(", ") || candidate.plant || "All plants"}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openEditor(candidate)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                        Edit
                      </button>
                      <button
                        onClick={() => void toggleManager(candidate)}
                        disabled={submitting === candidate.id}
                        className="rounded-full border border-[#BBD4F6] bg-[#EAF3FC] px-3 py-1 text-xs font-medium text-[#0A6ED1] transition hover:bg-[#DDEEFF] disabled:opacity-60"
                      >
                        {candidate.status === "Active" ? "Mark inactive" : "Reactivate"}
                      </button>
                      <button
                        onClick={() => void removeManager(candidate)}
                        disabled={submitting === candidate.id}
                        className="rounded-full border border-[#D9D9D9] bg-[#F5F6F7] px-3 py-1 text-xs font-medium text-[#354A5F] transition hover:bg-[#ECEFF1] disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">No managers matched the current search.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {editor ? (
          <div className="mt-6 grid gap-4 rounded-[28px] border border-slate-200 bg-slate-50 p-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="text-lg font-semibold text-slate-900">Edit manager</div>
              <div className="mt-1 text-sm text-slate-500">Update the manager record and plant assignment.</div>
            </div>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Name</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Assigned plants</span>
              <div className="grid max-h-48 gap-2 overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
                {plants.map((plant) => (
                  <label key={plant.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                    <span>{plant.name}</span>
                    <input
                      type="checkbox"
                      checked={draft.assignedPlantIds.includes(plant.id)}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        assignedPlantIds: event.target.checked
                          ? [...current.assignedPlantIds, plant.id]
                          : current.assignedPlantIds.filter((id) => id !== plant.id),
                      }))}
                    />
                  </label>
                ))}
              </div>
            </label>
            <div className="md:col-span-2 flex flex-wrap gap-3">
              <button onClick={() => void saveManager()} disabled={submitting === editor.id} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                Save changes
              </button>
              <button onClick={() => setEditor(null)} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

function ManagerDetailPage() {
  const { userId } = useParams();
  const { user, users, plants, documents } = usePortal();
  const target = users.find((candidate) => candidate.id === userId && candidate.role === "Mining Manager");

  if (!target) {
    return <NotFoundCard title="Manager not found" body="The selected manager could not be located." />;
  }

  const assignedIds = target.assignedPlantIds || (target.plantId ? [target.plantId] : []);
  const assignedPlantsList = plants.filter((plant) => assignedIds.includes(plant.id));
  const ownedDocuments = documents.filter((document) => document.uploadedById === target.id);
  const scopedDocuments = documents.filter((document) => assignedIds.includes(document.plantId));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={user.role === "Admin" ? [{ label: "Admin", to: "/admin" }, { label: "Users", to: "/admin/users" }, { label: target.name }] : [{ label: "Manager Access", to: "/oversight" }, { label: target.name }]} />
      <SectionCard title={target.name} subtitle="Manager profile, assigned plants, and scoped activity">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Assigned Plants" value={assignedPlantsList.length} hint="Plants this manager can access." icon={Building2} tone="blue" />
          <MetricCard label="Uploaded Documents" value={ownedDocuments.length} hint="Documents uploaded by this manager." icon={FileText} tone="amber" />
          <MetricCard label="Scoped Documents" value={scopedDocuments.length} hint="Documents visible inside this manager's assigned plant scope." icon={ShieldCheck} tone="teal" />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-lg font-semibold text-slate-900">Manager details</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div><span className="font-semibold text-slate-900">Email:</span> {target.email}</div>
              <div><span className="font-semibold text-slate-900">Role:</span> {target.role}</div>
              <div><span className="font-semibold text-slate-900">Primary plant:</span> {target.plant || "All plants"}</div>
              <div><span className="font-semibold text-slate-900">Updated:</span> {formatDate(target.updatedAt || null)}</div>
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="text-lg font-semibold text-slate-900">Assigned plants</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {assignedPlantsList.map((plant) => (
                <div key={plant.id} className="rounded-3xl bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{plant.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{plant.location || plant.company || "Assigned plant workspace"}</div>
                </div>
              ))}
              {!assignedPlantsList.length ? <div className="rounded-3xl bg-slate-50 p-4 text-sm text-slate-500">No plants assigned.</div> : null}
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="text-lg font-semibold text-slate-900">Documents inside assigned scope</div>
          <div className="mt-4 overflow-hidden rounded-[22px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm text-slate-500">
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Plant</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-sm">
                {scopedDocuments.slice(0, 8).map((document) => (
                  <tr key={document.id}>
                    <td className="px-4 py-4 font-medium text-slate-900">{document.name}</td>
                    <td className="px-4 py-4 text-slate-600">{document.plant}</td>
                    <td className="px-4 py-4 text-slate-600">{document.projectName || "-"}</td>
                    <td className="px-4 py-4 text-slate-600">{formatDate(document.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function AdminAccessPage() {
  const { portalState, setAccessRules, users, plants, refreshData } = usePortal();
  const [savingManagerId, setSavingManagerId] = useState<string | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesMessage, setRulesMessage] = useState("");

  async function updateRule(index: number, field: keyof AccessRule, value: string | boolean) {
    const next = portalState.accessRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [field]: value } : rule);
    setSavingRules(true);
    setRulesMessage("");
    try {
      await setAccessRules(next);
      setRulesMessage("Access rules updated.");
    } catch (error) {
      setRulesMessage(error instanceof Error ? error.message : "Unable to update access rules.");
    } finally {
      setSavingRules(false);
    }
  }

  async function togglePlantAssignment(manager: User, plantId: string, checked: boolean) {
    setSavingManagerId(manager.id);
    try {
      const current = manager.assignedPlantIds || (manager.plantId ? [manager.plantId] : []);
      const next = checked ? [...current, plantId] : current.filter((item) => item !== plantId);
      await usersApi.update(manager.id, { assignedPlantIds: next });
      await refreshData();
    } finally {
      setSavingManagerId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Access Control" }]} />
      <SectionCard title="Role-based access control" subtitle="Frontend restrictions by role">
        {rulesMessage ? <div className={`mb-4 text-sm ${rulesMessage === "Access rules updated." ? "text-emerald-700" : "text-[#BB0000]"}`}>{rulesMessage}</div> : null}
        <div className="grid gap-4">
          {portalState.accessRules.map((rule, index) => (
            <div key={rule.role} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{formatRole(rule.role)}</div>
                  <div className="mt-1 text-sm text-slate-500">{rule.plantsScope}</div>
                </div>
                <select value={rule.plantsScope} disabled={savingRules} onChange={(event) => void updateRule(index, "plantsScope", event.target.value)} className="h-11 w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500 disabled:bg-slate-100">
                  <option value="All plants">All plants</option>
                  {plants.map((plant) => <option key={`${rule.role}-${plant.id}`} value={plant.name}>{plant.name}</option>)}
                </select>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <AccessToggle label="Create projects" checked={rule.canCreateProjects} disabled={savingRules} onChange={(checked) => void updateRule(index, "canCreateProjects", checked)} />
                <AccessToggle label="Upload documents" checked={rule.canUploadDocuments} disabled={savingRules} onChange={(checked) => void updateRule(index, "canUploadDocuments", checked)} />
                <AccessToggle label="Edit documents" checked={rule.canEditDocuments} disabled={savingRules} onChange={(checked) => void updateRule(index, "canEditDocuments", checked)} />
                <AccessToggle label="Delete documents" checked={rule.canDeleteDocuments} disabled={savingRules} onChange={(checked) => void updateRule(index, "canDeleteDocuments", checked)} />
                <AccessToggle label="Manage users" checked={rule.canManageUsers} disabled={savingRules} onChange={(checked) => void updateRule(index, "canManageUsers", checked)} />
                <AccessToggle label="Configure IP" checked={rule.canConfigureIp} disabled={savingRules} onChange={(checked) => void updateRule(index, "canConfigureIp", checked)} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Assign plants to managers" subtitle="Managers can only see documents and plants within their assigned scope">
        <div className="grid gap-4">
          {users.filter((candidate) => candidate.role === "Mining Manager").map((manager) => {
            const selected = manager.assignedPlantIds || (manager.plantId ? [manager.plantId] : []);
            return (
              <div key={manager.id} className="rounded-[28px] border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{manager.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{manager.email}</div>
                  </div>
                  <div className="text-sm text-slate-500">{selected.length} plant{selected.length === 1 ? "" : "s"} assigned</div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {plants.map((plant) => (
                    <label key={`${manager.id}-${plant.id}`} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <span>{plant.name}</span>
                      <input
                        type="checkbox"
                        checked={selected.includes(plant.id)}
                        disabled={savingManagerId === manager.id}
                        onChange={(event) => void togglePlantAssignment(manager, plant.id, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

function AccessToggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; }) {
  return (
    <label className={`flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 ${disabled ? "opacity-60" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-teal-600" />
    </label>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(seconds?: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function loginIp(activity: Activity) {
  const raw = activity.metadata?.clientIp;
  return typeof raw === "string" && raw.trim() ? raw : "Unknown IP";
}

function AdminNetworkPage() {
  const [rules, setRules] = useState<IpRule[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ label: "", address: "", status: "Allowed" as IpRule["status"] });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      settingsApi.listIpRules(),
      activitiesApi.list({ action: "Login" }),
    ])
      .then(([ruleResult, activityResult]) => {
        setRules(ruleResult.items);
        setActivities(activityResult.items);
        setActivityError("");
      })
      .catch((err) => {
        const nextMessage = err instanceof Error ? err.message : "Unable to load IP rules.";
        setMessage(nextMessage);
        setActivityError(nextMessage);
      })
      .finally(() => setLoading(false));
  }, []);

  async function updateRule(id: string, status: IpRule["status"]) {
    const updated = await settingsApi.updateIpRule(id, { status });
    setRules((current) => current.map((rule) => rule.id === id ? updated : rule));
  }

  async function createRule() {
    const created = await settingsApi.createIpRule(draft);
    setRules((current) => [...current, created].sort((a, b) => a.label.localeCompare(b.label)));
    setDraft({ label: "", address: "", status: "Allowed" });
    setShowCreate(false);
    setMessage("IP rule created successfully.");
  }

  const loginActivities = useMemo(
    () => activities.filter((activity) => activity.action === "Login"),
    [activities],
  );

  const personaSummaries = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      name: string;
      role: string;
      email: string;
      total: number;
      lastSeen: string | null;
      ips: Set<string>;
      events: Activity[];
    }>();

    loginActivities.forEach((activity) => {
      const email = typeof activity.metadata?.email === "string" ? activity.metadata.email : "";
      const key = activity.userId || email || activity.userName || activity.id;
      const existing = grouped.get(key) || {
        id: key,
        name: activity.userName || "Unknown user",
        role: typeof activity.metadata?.role === "string" ? activity.metadata.role : "Unknown role",
        email,
        total: 0,
        lastSeen: activity.createdAt,
        ips: new Set<string>(),
        events: [],
      };

      existing.total += 1;
      existing.lastSeen = !existing.lastSeen || (activity.createdAt && activity.createdAt > existing.lastSeen) ? activity.createdAt : existing.lastSeen;
      existing.ips.add(loginIp(activity));
      existing.events.push(activity);
      grouped.set(key, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
  }, [loginActivities]);

  const ipSummaries = useMemo(() => {
    const grouped = new Map<string, {
      ip: string;
      total: number;
      lastSeen: string | null;
      personas: Set<string>;
      roles: Set<string>;
    }>();

    loginActivities.forEach((activity) => {
      const ip = loginIp(activity);
      const existing = grouped.get(ip) || {
        ip,
        total: 0,
        lastSeen: activity.createdAt,
        personas: new Set<string>(),
        roles: new Set<string>(),
      };

      existing.total += 1;
      existing.lastSeen = !existing.lastSeen || (activity.createdAt && activity.createdAt > existing.lastSeen) ? activity.createdAt : existing.lastSeen;
      existing.personas.add(activity.userName || "Unknown user");
      existing.roles.add(typeof activity.metadata?.role === "string" ? activity.metadata.role : "Unknown role");
      grouped.set(ip, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => b.total - a.total || (b.lastSeen || "").localeCompare(a.lastSeen || ""));
  }, [loginActivities]);

  const latestLogin = loginActivities[0];
  const uniqueIpCount = ipSummaries.length;
  const allowedCount = rules.filter((rule) => rule.status === "Allowed").length;
  const blockedCount = rules.filter((rule) => rule.status === "Blocked").length;
  const reviewCount = rules.filter((rule) => rule.status === "Review").length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "IP Configuration" }]} />
      <section className="overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.22),_transparent_28%),linear-gradient(135deg,_#0b132b_0%,_#12355b_50%,_#0f766e_100%)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(2,6,23,0.28)]">
        <div className="text-xs uppercase tracking-[0.26em] text-cyan-100/85">Network security command center</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Identity, ingress, and IP posture in one admin view</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-100/90">
          Monitor which personas are signing in, where they are signing in from, and how those login patterns align with the IP controls configured for the portal.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[28px] border border-emerald-200/40 bg-[linear-gradient(180deg,_rgba(16,185,129,0.22),_rgba(6,78,59,0.3))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-sm">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm font-medium text-emerald-50/90">Successful logins</span>
              <div className="rounded-2xl bg-white/20 p-3 text-emerald-50">
                <ShieldCheck size={18} />
              </div>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-white">{loginActivities.length}</div>
            <div className="mt-3 text-sm leading-6 text-emerald-50/85">Recent authenticated sign-ins captured in activity telemetry.</div>
          </div>
          <div className="rounded-[28px] border border-sky-200/45 bg-[linear-gradient(180deg,_rgba(59,130,246,0.24),_rgba(15,23,42,0.26))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-sm">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm font-medium text-sky-50/90">Observed personas</span>
              <div className="rounded-2xl bg-white/20 p-3 text-sky-50">
                <Users size={18} />
              </div>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-white">{personaSummaries.length}</div>
            <div className="mt-3 text-sm leading-6 text-sky-50/85">Distinct users seen in the current login stream.</div>
          </div>
          <div className="rounded-[28px] border border-cyan-100/60 bg-[linear-gradient(180deg,_rgba(224,242,254,0.95),_rgba(186,230,253,0.86))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Observed IPs</span>
              <div className="rounded-2xl bg-white/80 p-3 text-sky-700">
                <Globe size={18} />
              </div>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-slate-950">{uniqueIpCount}</div>
            <div className="mt-3 text-sm leading-6 text-slate-700">Unique ingress points currently visible to admin monitoring.</div>
          </div>
          <div className="rounded-[28px] border border-white/65 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(241,245,249,0.92))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Latest ingress</span>
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Network size={18} />
              </div>
            </div>
            <div className="text-4xl font-semibold tracking-tight text-slate-950">{latestLogin ? loginIp(latestLogin) : "-"}</div>
            <div className="mt-3 text-sm leading-6 text-slate-600">{latestLogin ? `${latestLogin.userName || "Unknown user"} at ${formatDateTime(latestLogin.createdAt)}` : "No successful logins recorded yet."}</div>
          </div>
        </div>
      </section>

      <SectionCard
        title="IP configuration"
        subtitle="Allow, block, and review network sources"
        action={<button onClick={() => setShowCreate((current) => !current)} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Add new IP configuration</button>}
      >
        {message ? <div className="mb-4 text-sm text-emerald-700">{message}</div> : null}
        {showCreate ? (
          <div className="mb-5 grid gap-3 rounded-[28px] border border-slate-200 bg-slate-50 p-5 md:grid-cols-4">
            <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Label" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <input value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} placeholder="IP address" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as IpRule["status"] }))} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
              <option value="Allowed">Allowed</option>
              <option value="Blocked">Blocked</option>
              <option value="Review">Review</option>
            </select>
            <button onClick={() => void createRule()} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Save IP</button>
          </div>
        ) : null}
        <div className="grid gap-4">
          {rules.map((rule) => (
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

      <SectionCard title="Security operations overview" subtitle="At-a-glance posture across configured rules and observed sign-ins">
        {loading ? <div className="text-sm text-slate-500">Loading network telemetry...</div> : null}
        {!loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Allowed rules" value={allowedCount} hint="Ingress sources explicitly permitted by policy." icon={ShieldCheck} />
            <MetricCard label="Blocked rules" value={blockedCount} hint="Known endpoints currently denied from platform access." icon={Lock} tone="rose" />
            <MetricCard label="Review queue" value={reviewCount} hint="Addresses awaiting analyst disposition or follow-up." icon={TriangleAlert} tone="amber" />
            <MetricCard label="Latest sign-in time" value={latestLogin ? formatDate(latestLogin.createdAt) : "-"} hint={latestLogin ? formatDateTime(latestLogin.createdAt) : "No login telemetry is available yet."} icon={Clock3} tone="blue" />
          </div>
        ) : null}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <SectionCard title="Persona login matrix" subtitle="Every persona with login count, IP spread, and latest observed sign-in">
          {loading ? <div className="text-sm text-slate-500">Collecting persona login activity...</div> : null}
          {!loading && activityError ? <div className="text-sm text-[#BB0000]">{activityError}</div> : null}
          {!loading && !activityError && personaSummaries.length === 0 ? <div className="text-sm text-slate-500">No successful login events have been recorded yet.</div> : null}
          {!loading && !activityError ? (
            <div className="space-y-4">
              {personaSummaries.map((persona) => (
                <div key={persona.id} className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-slate-950">{persona.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{persona.role}{persona.email ? ` • ${persona.email}` : ""}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-950 px-4 py-2 text-right text-white">
                      <div className="text-xs uppercase tracking-[0.22em] text-white/55">Login volume</div>
                      <div className="mt-1 text-xl font-semibold">{persona.total}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Last seen</div>
                      <div className="mt-2 text-sm font-medium text-slate-900">{formatDateTime(persona.lastSeen)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">IP footprint</div>
                      <div className="mt-2 text-sm font-medium text-slate-900">{statLabel(persona.ips.size, "IP")}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Most recent source</div>
                      <div className="mt-2 font-mono text-sm text-slate-900">{loginIp(persona.events[0])}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Array.from(persona.ips).map((ip) => (
                      <span key={`${persona.id}-${ip}`} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-900">
                        {ip}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Ingress watchlist" subtitle="IP-centric view of who is entering the platform and how often">
          {loading ? <div className="text-sm text-slate-500">Building ingress watchlist...</div> : null}
          {!loading && activityError ? <div className="text-sm text-[#BB0000]">{activityError}</div> : null}
          {!loading && !activityError && ipSummaries.length === 0 ? <div className="text-sm text-slate-500">No IP activity is available yet.</div> : null}
          {!loading && !activityError ? (
            <div className="space-y-4">
              {ipSummaries.map((entry) => (
                <div key={entry.ip} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-base font-semibold text-slate-950">{entry.ip}</div>
                      <div className="mt-1 text-sm text-slate-500">Last seen {formatDateTime(entry.lastSeen)}</div>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Logins</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{entry.total}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Personas</div>
                      <div className="mt-2 text-sm text-slate-900">{Array.from(entry.personas).join(", ")}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Roles</div>
                      <div className="mt-2 text-sm text-slate-900">{Array.from(entry.roles).join(", ")}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}

function AdminSessionsPage() {
  const { portalState, setSessionPolicyValue } = usePortal();
  const policy = portalState.sessionPolicy;
  const [activeTab, setActiveTab] = useState("session-policies");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [outsideHoursSessions, setOutsideHoursSessions] = useState<SessionRecord[]>([]);
  const [outsideHoursAttempts, setOutsideHoursAttempts] = useState<OutsideHoursAttempt[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    settingsApi
      .listSessions()
      .then((result) => {
        setSessions(result.items);
        setOutsideHoursSessions(result.outsideBusinessHours.sessions);
        setOutsideHoursAttempts(result.outsideBusinessHours.blockedAttempts);
        setSessionError("");
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          setSessionError("Session monitoring is not available from the backend yet. Restart the backend server to load the new admin sessions route.");
          return;
        }
        setSessionError(error instanceof Error ? error.message : "Unable to load sessions.");
      })
      .finally(() => setLoadingSessions(false));
  }, []);

  const activeSessions = sessions.filter((session) => session.status === "Active");
  const endedSessions = sessions.filter((session) => session.status === "Ended");
  const uniqueIps = new Set(sessions.map((session) => session.clientIp)).size;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", to: "/admin" }, { label: "Sessions" }]} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <SectionCard
          title="Admin session controls"
          subtitle="Switch between general session policy settings and outside-hours monitoring without leaving this page"
          action={(
            <TabsList className="grid w-full max-w-[460px] grid-cols-2 rounded-2xl bg-slate-100 p-1">
              <TabsTrigger value="session-policies" className="rounded-xl text-sm">
                Session policies
              </TabsTrigger>
              <TabsTrigger value="outside-business-hours" className="rounded-xl text-sm">
                Outside business hours
              </TabsTrigger>
            </TabsList>
          )}
        >
          <TabsContent value="session-policies" className="mt-0">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Auto logout minutes</span>
                <input
                  type="number"
                  min={2}
                  max={120}
                  value={policy.autoLogoutMinutes}
                  onChange={(event) => setSessionPolicyValue({ ...policy, autoLogoutMinutes: Math.max(2, Number(event.target.value) || 2) })}
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
          </TabsContent>

          <TabsContent value="outside-business-hours" className="mt-0">
            {loadingSessions ? <div className="text-sm text-slate-500">Flagging outside-hours activity...</div> : null}
            {!loadingSessions && !sessionError ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Off-hours sessions" value={outsideHoursSessions.length} hint="Actual session records that started outside business hours." icon={Clock3} tone="amber" />
                  <MetricCard label="Blocked attempts" value={outsideHoursAttempts.length} hint="Off-hours sign-ins blocked before a session was established." icon={TriangleAlert} tone="rose" />
                  <MetricCard label="Observed people" value={new Set([...outsideHoursSessions.map((item) => item.userId), ...outsideHoursAttempts.map((item) => item.userId || item.userName)]).size} hint="Distinct identities involved in off-hours access." icon={Users} tone="blue" />
                  <MetricCard label="Observed IPs" value={new Set([...outsideHoursSessions.map((item) => item.clientIp), ...outsideHoursAttempts.map((item) => item.clientIp)]).size} hint="Network origins tied to outside-hours access." icon={Network} tone="teal" />
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-2">
                  <div className="space-y-4">
                    <div className="text-base font-semibold text-slate-900">Flagged off-hours sessions</div>
                    {outsideHoursSessions.map((session) => (
                      <div key={`outside-session-${session.sessionId}`} className="rounded-[28px] border border-amber-200 bg-amber-50/60 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-semibold text-slate-950">{session.userName || "Unknown user"}</div>
                            <div className="mt-1 text-sm text-slate-500">{session.userRole || "Unknown role"}{session.userEmail ? ` • ${session.userEmail}` : ""}</div>
                          </div>
                          <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">Flagged</div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">IP</div><div className="mt-2 font-mono text-sm text-slate-900">{session.clientIp}</div></div>
                          <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Login time</div><div className="mt-2 text-sm text-slate-900">{formatDateTime(session.startedAt)}</div></div>
                          <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Duration</div><div className="mt-2 text-sm text-slate-900">{formatDuration(session.durationSeconds)}</div></div>
                          <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Device / browser</div><div className="mt-2 text-sm text-slate-900">{session.device || "Unknown device"} • {session.browser || "Unknown browser"}</div><div className="mt-1 text-xs text-slate-500 break-all">{session.userAgent || "User agent not available"}</div></div>
                        </div>
                      </div>
                    ))}
                    {!outsideHoursSessions.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No session records currently fall outside business hours.</div> : null}
                  </div>

                  <div className="space-y-4">
                    <div className="text-base font-semibold text-slate-900">Blocked outside-hours login attempts</div>
                    {outsideHoursAttempts.map((attempt) => (
                      <div key={`outside-attempt-${attempt.id}`} className="rounded-[28px] border border-rose-200 bg-rose-50/60 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-semibold text-slate-950">{attempt.userName || "Unknown user"}</div>
                            <div className="mt-1 text-sm text-slate-500">{attempt.userRole || "Unknown role"}</div>
                          </div>
                          <div className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800">Blocked</div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">IP</div><div className="mt-2 font-mono text-sm text-slate-900">{attempt.clientIp}</div></div>
                          <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Attempt time</div><div className="mt-2 text-sm text-slate-900">{formatDateTime(attempt.occurredAt)}</div></div>
                          <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Device</div><div className="mt-2 text-sm text-slate-900">{attempt.device || "Unknown device"}</div></div>
                          <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-400">Browser</div><div className="mt-2 text-sm text-slate-900">{attempt.browser || "Unknown browser"}</div></div>
                        </div>
                        <div className="mt-3 text-xs text-slate-500 break-all">{attempt.userAgent || "User agent not available"}</div>
                      </div>
                    ))}
                    {!outsideHoursAttempts.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No blocked outside-hours attempts have been captured yet.</div> : null}
                  </div>
                </div>
              </>
            ) : null}
          </TabsContent>
        </SectionCard>
      </Tabs>

      <SectionCard title="Live session monitor" subtitle="Detailed session visibility across logins, active presence, and exits">
        {loadingSessions ? <div className="text-sm text-slate-500">Loading session inventory...</div> : null}
        {!loadingSessions && sessionError ? <div className="text-sm text-[#BB0000]">{sessionError}</div> : null}
        {!loadingSessions && !sessionError ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Total sessions" value={sessions.length} hint="All active and ended sessions captured by the platform." icon={Clock3} />
              <MetricCard label="Active now" value={activeSessions.length} hint="Sessions currently open and not revoked." icon={ShieldCheck} tone="blue" />
              <MetricCard label="Ended" value={endedSessions.length} hint="Sessions closed by logout, replacement, or policy action." icon={Lock} tone="rose" />
              <MetricCard label="Observed IPs" value={uniqueIps} hint="Distinct network origins across the current session inventory." icon={Network} tone="amber" />
            </div>

            <div className="mt-6 space-y-4">
              {sessions.map((session) => (
                <div key={session.sessionId} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-slate-950">{session.userName || "Unknown user"}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {session.userRole || "Unknown role"}{session.userEmail ? ` • ${session.userEmail}` : ""}
                      </div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-medium ${session.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                      {session.status}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">IP address</div>
                      <div className="mt-2 font-mono text-sm text-slate-900">{session.clientIp}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Login time</div>
                      <div className="mt-2 text-sm text-slate-900">{formatDateTime(session.startedAt)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Logout time</div>
                      <div className="mt-2 text-sm text-slate-900">{session.endedAt ? formatDateTime(session.endedAt) : "Still active"}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Session duration</div>
                      <div className="mt-2 text-sm text-slate-900">{formatDuration(session.durationSeconds)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Last seen</div>
                      <div className="mt-2 text-sm text-slate-900">{formatDateTime(session.lastSeenAt)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Idle time</div>
                      <div className="mt-2 text-sm text-slate-900">{session.status === "Active" ? formatDuration(session.idleSeconds) : "-"}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 xl:col-span-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Close reason / device</div>
                      <div className="mt-2 text-sm text-slate-900">
                        {session.revokedReason ? `Ended because ${session.revokedReason.replace(/_/g, " ")}.` : "No forced close reason recorded."}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{session.device || "Unknown device"} • {session.browser || "Unknown browser"}</div>
                      <div className="mt-1 text-xs text-slate-500 break-all">{session.userAgent || "User agent not available"}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-slate-400">Session ID: {session.sessionId}</div>
                </div>
              ))}
              {!sessions.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No session records are available yet.</div> : null}
            </div>
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}

function ActivityLogsPage() {
  const { user } = usePortal();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    activitiesApi
      .list()
      .then((result) => setActivities(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load activity logs."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={user.role === "Admin" ? [{ label: "Admin", to: "/admin" }, { label: "Audit Logs" }] : [{ label: "Audit Logs" }]} />
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#334155)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="text-xs uppercase tracking-[0.26em] text-white/55">Security and audit visibility</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Platform activity logs</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
          Login-adjacent actions, document events, and user-driven activity are centralized here for executive and administrative review.
        </p>
      </section>

      {loading ? <SectionCard title="Loading logs"><div className="text-sm text-slate-500">Fetching the latest activity stream...</div></SectionCard> : null}
      {!loading && error ? <SectionCard title="Logs unavailable"><div className="text-sm text-[#BB0000]">{error}</div></SectionCard> : null}
      {!loading && !error ? <DetailedActivityLog activities={activities} /> : null}
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

  useEffect(() => {
    if (loading || user) return;
    if (window.location.pathname !== "/login") {
      window.history.replaceState({}, "", "/login");
    }
  }, [loading, user]);

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
          { path: "login", element: <Navigate to={defaultHome(user.role)} replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "plants", element: <RoleGate allowed={["CEO", "Mining Manager"]}><PlantIndexPage /></RoleGate> },
          { path: "plants/:plantId", element: <RoleGate allowed={["CEO", "Mining Manager"]}><PlantProjectsPage /></RoleGate> },
          { path: "plants/:plantId/projects/new", element: <RoleGate allowed={["Mining Manager"]} capability="canCreateProjects"><ProjectCreatePage /></RoleGate> },
          { path: "plants/:plantId/projects/:projectId/documents", element: <RoleGate allowed={["CEO", "Mining Manager"]}><ProjectDocumentsPage /></RoleGate> },
          { path: "documents", element: <RoleGate allowed={["CEO", "Mining Manager"]}><DocumentsPage /></RoleGate> },
          { path: "documents/:documentId", element: <RoleGate allowed={["CEO", "Mining Manager"]}><DocumentDetailPage /></RoleGate> },
          { path: "analytics", element: <RoleGate allowed={["CEO"]}><AnalyticsPage /></RoleGate> },
          { path: "oversight", element: <RoleGate allowed={["CEO", "Admin"]} capability="canManageUsers"><ManagerOversightPage /></RoleGate> },
          { path: "oversight/:userId", element: <RoleGate allowed={["CEO", "Admin"]} capability="canManageUsers"><ManagerDetailPage /></RoleGate> },
          { path: "activity-logs", element: <RoleGate allowed={["CEO"]}><ActivityLogsPage /></RoleGate> },
          { path: "upload", element: <RoleGate allowed={["Mining Manager"]} capability="canUploadDocuments"><ManagerUpload /></RoleGate> },
          { path: "admin", element: <RoleGate allowed={["Admin"]}><AdminDashboardPage /></RoleGate> },
          { path: "admin/users", element: <RoleGate allowed={["Admin", "CEO"]} capability="canManageUsers"><ManagerOversightPage /></RoleGate> },
          { path: "admin/users/:userId", element: <RoleGate allowed={["Admin", "CEO"]} capability="canManageUsers"><ManagerDetailPage /></RoleGate> },
          { path: "admin/master-data", element: <RoleGate allowed={["Admin"]} capability="canManageUsers"><AdminMasterDataPage /></RoleGate> },
          { path: "admin/access", element: <RoleGate allowed={["Admin"]}><AdminAccessPage /></RoleGate> },
          { path: "admin/network", element: <RoleGate allowed={["Admin", "CEO"]} capability="canConfigureIp"><AdminNetworkPage /></RoleGate> },
          { path: "admin/sessions", element: <RoleGate allowed={["Admin"]}><AdminSessionsPage /></RoleGate> },
          { path: "admin/activity-logs", element: <RoleGate allowed={["Admin"]}><ActivityLogsPage /></RoleGate> },
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
