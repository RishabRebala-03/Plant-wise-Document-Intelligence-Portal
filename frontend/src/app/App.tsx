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
  ChevronLeft,
  ChevronRight,
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
  MessageSquare,
  Network,
  Eye,
  EyeOff,
  Plus,
  Save,
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
import { ValueHelp, type ValueHelpOption } from "./components/ui/value-help";
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
import type { Activity, Comment, DocumentConversationMessage, DocumentRecord, GovernancePolicy, NotificationItem, OutsideHoursAttempt, Plant, SessionRecord, User, UserRole } from "./lib/types";

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
  createProjectRecord: (draft: Pick<ProjectRecord, "plantId" | "plantName" | "name" | "code" | "description" | "owner" | "dueDate">) => Promise<ProjectRecord>;
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
  badgeCount?: number;
};

const PortalContext = createContext<PortalContextValue | null>(null);
const SESSION_STORAGE_PREFIX = "midwest.activeSession";
const SESSION_WARNING_SECONDS = 60;
const CHART_COLORS = ["#0A6ED1", "#107E3E", "#5B738B", "#354A5F", "#7F97AD"];
const GOVERNANCE_TIMEZONES = [
  "Asia/Kolkata",
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];
const GOVERNANCE_TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, 0, 1, hour, 0))),
}));
const BUSINESS_DAY_OPTIONS = [
  { label: "Mon", value: 0 },
  { label: "Tue", value: 1 },
  { label: "Wed", value: 2 },
  { label: "Thu", value: 3 },
  { label: "Fri", value: 4 },
  { label: "Sat", value: 5 },
  { label: "Sun", value: 6 },
];

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

function formatBusinessHour(value: number) {
  return GOVERNANCE_TIME_OPTIONS.find((option) => option.value === value)?.label || `${value}:00`;
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function matchesValueHelpFilter(selected: string, ...candidates: Array<string | null | undefined>) {
  if (!selected) return true;
  return candidates.some((candidate) => candidate === selected);
}

function matchesTextFilter(selected: string, ...candidates: Array<string | null | undefined>) {
  if (!selected) return true;
  const query = normalizeSearchValue(selected);
  return candidates.some((candidate) => normalizeSearchValue(candidate).includes(query));
}

function buildValueHelpOptions(values: Array<string | null | undefined>, meta: string) {
  return Array.from(new Set(values.map((value) => (value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value, meta }));
}

function compareText(a?: string | null, b?: string | null) {
  return (a || "").localeCompare(b || "");
}

function compareNumber(a?: number | null, b?: number | null) {
  return (a || 0) - (b || 0);
}

function compareDateValue(a?: string | null, b?: string | null) {
  return (a || "").localeCompare(b || "");
}

function normalizeGovernancePolicy(policy: GovernancePolicy): GovernancePolicy {
  const uniqueFormats = Array.from(new Set(policy.allowedUploadFormats.map((value) => value.toLowerCase())));
  const uniqueDays = Array.from(new Set(policy.businessHours.allowedDays)).sort((a, b) => a - b);
  return {
    allowedUploadFormats: uniqueFormats,
    businessHours: {
      timezone: policy.businessHours.timezone,
      startHour: Math.min(23, Math.max(0, policy.businessHours.startHour)),
      endHour: Math.min(23, Math.max(0, policy.businessHours.endHour)),
      allowedDays: uniqueDays,
    },
  };
}

function describeBusinessHours(policy: GovernancePolicy) {
  const dayLabels = BUSINESS_DAY_OPTIONS
    .filter((day) => policy.businessHours.allowedDays.includes(day.value))
    .map((day) => day.label)
    .join(", ");
  return `${dayLabels || "No active days"} • ${formatBusinessHour(policy.businessHours.startHour)} - ${formatBusinessHour(policy.businessHours.endHour)} • ${policy.businessHours.timezone}`;
}

function getBusinessTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  return { weekday, hour };
}

function isWithinGovernanceBusinessHours(policy: GovernancePolicy, date = new Date()) {
  const normalized = normalizeGovernancePolicy(policy);
  const { weekday, hour } = getBusinessTimeParts(date, normalized.businessHours.timezone);
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const dayValue = weekdayMap[weekday] ?? 0;
  const isAllowedDay = normalized.businessHours.allowedDays.includes(dayValue);
  if (!isAllowedDay) return false;
  return hour >= normalized.businessHours.startHour && hour < normalized.businessHours.endHour;
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
    const [documentsResult, plantsResult, projectsResult, usersResult, notificationsResult, accessRulesResult] = await Promise.all([
      documentsApi.list({ page: 1, pageSize: 500 }),
      plantsApi.list(),
      projectsApi.list({ page: 1, pageSize: 500 }).catch(() => ({ items: [] as ProjectRecord[] })),
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
      const backendProjects = projectsResult.items as ProjectRecord[];
      return current.projects.length === 0 ? { ...next, projects: backendProjects.concat(next.projects) } : {
        ...next,
        accessRules: accessRulesResult.items.length ? accessRulesResult.items : next.accessRules,
        ipRules: current.ipRules,
        sessionPolicy: current.sessionPolicy,
        managerDocumentLocks: current.managerDocumentLocks,
        projects: backendProjects.concat(
          next.projects.filter((project) => project.source === "derived"),
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
    createProjectRecord: async (draft) => {
      try {
        const created = await projectsApi.create({
          plantId: draft.plantId,
          name: draft.name,
          code: draft.code,
          description: draft.description,
          dueDate: draft.dueDate,
        }) as ProjectRecord;
        await loadAll();
        return created;
      } catch {
        let created: ProjectRecord | null = null;
        setPortalState((current) => {
          const next = createProject(current, draft);
          created = next.projects[next.projects.length - 1];
          return next;
        });
        return created!;
      }
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
  const { user, notifications } = usePortal();
  const { can } = useRoleAccess();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState<NotificationItem[]>(notifications);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const navigate = useNavigate();
  const unreadNotificationCount = useMemo(
    () => notificationItems.filter((item) => !item.read).length,
    [notificationItems],
  );

  useEffect(() => {
    setNotificationItems(notifications);
  }, [notifications]);

  async function handleNotificationOpen(item: NotificationItem) {
    setNotificationsOpen(false);
    setNotificationItems((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, read: true, readAt: entry.readAt || new Date().toISOString() } : entry
    )));
    try {
      await notificationsApi.markRead(item.id);
    } catch {
      // Ignore generated notification ids that are not persisted server-side.
    }
    navigate(item.href || defaultHome(user.role));
  }

  async function handleClearNotifications() {
    setClearingNotifications(true);
    setNotificationItems((current) => current.map((item) => (
      item.read ? item : { ...item, read: true, readAt: item.readAt || new Date().toISOString() }
    )));
    try {
      await notificationsApi.markAllRead();
    } catch {
      // Keep local clear-all behavior even if some notifications are generated client-side.
    } finally {
      setClearingNotifications(false);
    }
  }

  const navGroups = useMemo<NavItem[][]>(() => {
    const common: NavItem[] = [{ label: "Settings", path: user.role === "Admin" ? "/admin/settings" : "/settings", icon: Settings }];
    if (user.role === "CEO") {
      const governance: NavItem[] = [];
      if (can("canManageUsers")) {
        governance.push({ label: "Manager Access", path: "/oversight", icon: UserCog, capability: "canManageUsers" });
        governance.push({ label: "Master Data", path: "/admin/master-data", icon: Database, capability: "canManageUsers" });
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

            <div className="relative">
              <button
                onClick={() => setNotificationsOpen((prev) => !prev)}
                className="relative rounded-full border border-white/15 bg-white/5 p-2 transition hover:bg-white/10"
              >
                <Bell size={16} />
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-[#0A6ED1] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                ) : null}
              </button>
              {notificationsOpen ? (
                <div className="absolute right-0 top-12 w-80 rounded-3xl border border-white/10 bg-slate-900 p-3 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Notifications</div>
                      <div className="mt-1 text-xs text-white/55">
                        {unreadNotificationCount} unread
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={clearingNotifications || !notificationItems.length}
                      onClick={() => void handleClearNotifications()}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {clearingNotifications ? "Clearing..." : "Clear all"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(notificationItems.length ? notificationItems : [{
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
                        onClick={() => void handleNotificationOpen(item)}
                        className={`w-full rounded-2xl border p-3 text-left ${
                          item.read
                            ? "border-white/10 bg-white/5 hover:bg-white/10"
                            : "border-[#0A6ED1]/40 bg-[#0A6ED1]/12 hover:bg-[#0A6ED1]/18"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-white">{item.title}</div>
                          {!item.read ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#2E90FF]" /> : null}
                        </div>
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

        <aside className={`hidden shrink-0 transition-[width] duration-200 lg:block ${sidebarCollapsed ? "w-20" : "w-72"}`}>
          <div className="sticky top-28 space-y-2 rounded-[28px] border border-white/70 bg-white/85 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} px-1 pb-2`}>
              {!sidebarCollapsed ? (
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Navigation</span>
              ) : null}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((current) => !current)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>

            {navGroups.map((group, index) => (
              <div key={index} className="space-y-1">
                {group.filter((item) => !item.capability || can(item.capability)).map((item) => {
                  const active = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(`${item.path}/`));
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={`flex w-full items-center gap-3 rounded-2xl py-3 text-left text-sm transition ${
                        active ? "bg-slate-950 text-white shadow-lg" : "text-slate-600 hover:bg-slate-100"
                      } ${sidebarCollapsed ? "justify-center px-0" : "px-4"}`}
                    >
                      <item.icon size={16} />
                      {!sidebarCollapsed ? <span className="flex-1">{item.label}</span> : null}
                      {!sidebarCollapsed && item.badgeCount && item.badgeCount > 0 ? (
                        <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          active ? "bg-white/18 text-white" : "bg-[#0A6ED1] text-white"
                        }`}>
                          {item.badgeCount > 99 ? "99+" : item.badgeCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
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
  const { documents, plants, projects, users, user } = usePortal();
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
  const latestDocument = [...documents].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const greetingName = user.firstName || user.name.split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0A6ED1,_#0854A0)] px-6 py-8 text-white shadow-[0_28px_80px_rgba(10,110,209,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Executive dashboard</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Welcome back, {greetingName}</h1>
            <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Latest upload</div>
                <div className="mt-1 font-semibold text-white">{latestDocument ? `${latestDocument.name} · ${formatDate(latestDocument.date)}` : "No uploads recorded"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Plants needing attention</div>
                <div className="mt-1 font-semibold text-white">{stalledPlants.length} plant{stalledPlants.length === 1 ? "" : "s"}</div>
              </div>
            </div>
          </div>
          <div className="grid min-w-[260px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => navigate("/plants")} className="rounded-2xl bg-white px-4 py-3 text-left transition hover:bg-slate-100">
                <div className="text-2xl font-semibold text-slate-950">{plants.length}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">Active plants</div>
              </button>
              <button onClick={() => navigate("/documents")} className="rounded-2xl bg-white px-4 py-3 text-left transition hover:bg-slate-100">
                <div className="text-2xl font-semibold text-slate-950">{documents.length}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">Documents</div>
              </button>
            </div>
            <button onClick={() => navigate("/analytics")} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/10">
              Open executive analytics
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

        <SectionCard title="Document portfolio" subtitle="Category-level distribution">
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
        <div className="data-table-panel">
          <div className="data-table-toolbar">
            <h2 className="text-lg font-semibold text-slate-900">Plant Performance</h2>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Documents</th>
                  <th>Projects</th>
                  <th>Locked</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {plantSummary.slice(0, 4).map((item) => (
                  <tr key={item.plantId}>
                    <td className="text-strong">{item.plant}</td>
                    <td>{item.documents}</td>
                    <td>{item.projects}</td>
                    <td>{item.locked}</td>
                    <td><Link to={`/plants/${item.plantId}`} className="font-semibold text-[#0A6ED1] hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-table-panel">
          <div className="data-table-toolbar">
            <h2 className="text-lg font-semibold text-slate-900">Executive Watchlist</h2>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Last Upload</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(stalledPlants.length ? stalledPlants : plants.slice(0, 3)).map((plant) => (
                  <tr key={plant.id}>
                    <td className="text-strong">{plant.name}</td>
                    <td>{formatDate(plant.lastUpload)}</td>
                    <td><Link to={`/plants/${plant.id}`} className="font-semibold text-[#0A6ED1] hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
            <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Projects</div>
                <div className="mt-1 font-semibold text-white">{myProjects.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Documents</div>
                <div className="mt-1 font-semibold text-white">{myDocuments.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Locked</div>
                <div className="mt-1 font-semibold text-white">{lockedDocuments.length}</div>
              </div>
            </div>
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

      <div className="grid gap-6">
        <div className="data-table-panel">
          <div className="data-table-toolbar">
            <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Code</th>
                  <th>Plant</th>
                  <th>Documents</th>
                  <th>Owner</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {myProjects.map((project) => (
                  <tr key={project.id}>
                    <td className="text-strong">{project.name}</td>
                    <td>{project.code}</td>
                    <td>{project.plantName}</td>
                    <td>{project.documentIds.length}</td>
                    <td>{project.owner}</td>
                    <td>
                      <Link to={`/plants/${project.plantId}/projects/${project.id}/documents`} className="font-semibold text-[#0A6ED1] hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {!myProjects.length ? <tr><td colSpan={6}>No projects are available.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-table-panel">
          <div className="data-table-toolbar">
            <h2 className="text-lg font-semibold text-slate-900">Access Controls</h2>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="text-strong">Edit/Delete</td><td>Disabled for manager document records</td></tr>
                <tr><td className="text-strong">Access Locking</td><td>{lockedDocuments.length} locked after access</td></tr>
                <tr><td className="text-strong">Plant Scope</td><td>{user.assignedPlants?.join(", ") || user.plant || "Assigned plants"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlantIndexPage() {
  const { user, plants, documents, projects } = usePortal();
  const allowedPlantIds = assignedPlantIds(user);
  const [plantQuery, setPlantQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [plantSort, setPlantSort] = useState("name-asc");
  const visiblePlants = user.role === "Mining Manager" && allowedPlantIds.length
    ? plants.filter((plant) => allowedPlantIds.includes(plant.id))
    : plants;
  const plantRows = useMemo(
    () =>
      visiblePlants.map((plant) => {
        const docCount = documents.filter((document) => document.plantId === plant.id).length;
        const projectCount = projects.filter((project) => project.plantId === plant.id).length;
        const activityBand = docCount >= 10 ? "High activity" : docCount >= 4 ? "Medium activity" : docCount > 0 ? "Low activity" : "No documents";
        return {
          plant,
          docCount,
          projectCount,
          activityBand,
        };
      }),
    [documents, projects, visiblePlants],
  );
  const plantQueryOptions = useMemo(
    () => {
      const registry = new Map<string, ValueHelpOption>();
      plantRows.forEach(({ plant }) => {
        [plant.name, plant.plant, plant.plantName, plant.plantName2, plant.company, plant.manager, plant.location, plant.address].forEach((value, index) => {
          if (!value) return;
          const meta = ["Plant", "Plant code", "Plant name", "Plant name 2", "Company", "Manager", "Location", "Address"][index];
          registry.set(`${meta}:${value}`, { value, label: value, meta });
        });
      });
      return Array.from(registry.values()).sort((a, b) => a.label.localeCompare(b.label) || (a.meta || "").localeCompare(b.meta || ""));
    },
    [plantRows],
  );
  const companyOptions = useMemo(() => buildValueHelpOptions(plantRows.map((row) => row.plant.company), "Company"), [plantRows]);
  const managerOptions = useMemo(() => buildValueHelpOptions(plantRows.map((row) => row.plant.manager), "Manager"), [plantRows]);
  const statusOptions = useMemo(() => buildValueHelpOptions(plantRows.map((row) => row.plant.status), "Status"), [plantRows]);
  const activityOptions = useMemo(() => buildValueHelpOptions(plantRows.map((row) => row.activityBand), "Activity"), [plantRows]);
  const plantSortOptions = useMemo(
    () => [
      { value: "name-asc", label: "Plant A-Z", meta: "Sort" },
      { value: "company-asc", label: "Company A-Z", meta: "Sort" },
      { value: "manager-asc", label: "Manager A-Z", meta: "Sort" },
      { value: "documents-desc", label: "Documents high-low", meta: "Sort" },
      { value: "projects-desc", label: "Projects high-low", meta: "Sort" },
      { value: "last-upload-desc", label: "Latest upload first", meta: "Sort" },
    ],
    [],
  );
  const filteredPlantRows = useMemo(
    () =>
      plantRows.filter(({ plant, activityBand }) => {
        const matchesQuery = !plantQuery || [
          plant.name,
          plant.plant,
          plant.plantName,
          plant.plantName2,
          plant.company,
          plant.manager,
          plant.location,
          plant.address,
        ].some((value) => normalizeSearchValue(value).includes(normalizeSearchValue(plantQuery)));
        return (
          matchesQuery &&
          matchesValueHelpFilter(companyFilter, plant.company) &&
          matchesValueHelpFilter(managerFilter, plant.manager) &&
          matchesValueHelpFilter(statusFilter, plant.status) &&
          matchesValueHelpFilter(activityFilter, activityBand)
        );
      }),
    [activityFilter, companyFilter, managerFilter, plantQuery, plantRows, statusFilter],
  );
  const sortedPlantRows = useMemo(() => {
    const next = [...filteredPlantRows];
    next.sort((left, right) => {
      switch (plantSort) {
        case "company-asc":
          return compareText(left.plant.company, right.plant.company) || compareText(left.plant.name, right.plant.name);
        case "manager-asc":
          return compareText(left.plant.manager, right.plant.manager) || compareText(left.plant.name, right.plant.name);
        case "documents-desc":
          return compareNumber(right.docCount, left.docCount) || compareText(left.plant.name, right.plant.name);
        case "projects-desc":
          return compareNumber(right.projectCount, left.projectCount) || compareText(left.plant.name, right.plant.name);
        case "last-upload-desc":
          return compareDateValue(right.plant.lastUpload, left.plant.lastUpload) || compareText(left.plant.name, right.plant.name);
        case "name-asc":
        default:
          return compareText(left.plant.name, right.plant.name);
      }
    });
    return next;
  }, [filteredPlantRows, plantSort]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Plants" }]} />
      <div className="data-table-panel">
        <div className="data-table-toolbar flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Plants</h1>
            <div className="mt-1 text-sm text-slate-500">{plantRows.length} plant{plantRows.length === 1 ? "" : "s"} available</div>
          </div>
          <div className="text-sm text-slate-600">
            {filteredPlantRows.reduce((total, row) => total + row.projectCount, 0)} projects · {filteredPlantRows.reduce((total, row) => total + row.docCount, 0)} documents
          </div>
        </div>
        <div className="grid gap-4 border-b border-slate-200 bg-slate-50/80 px-4 py-4 md:grid-cols-2 xl:grid-cols-6">
          <ValueHelp
            label="Search"
            placeholder="Plant, manager, company..."
            emptyLabel="No matching plant terms."
            options={plantQueryOptions}
            value={plantQuery}
            onChange={setPlantQuery}
            containerClassName="w-full"
          />
          <ValueHelp
            label="Company"
            placeholder="All companies"
            emptyLabel="No matching companies."
            options={companyOptions}
            value={companyFilter}
            onChange={setCompanyFilter}
            containerClassName="w-full"
          />
          <ValueHelp
            label="Manager"
            placeholder="All managers"
            emptyLabel="No matching managers."
            options={managerOptions}
            value={managerFilter}
            onChange={setManagerFilter}
            containerClassName="w-full"
          />
          <ValueHelp
            label="Status"
            placeholder="All statuses"
            emptyLabel="No matching statuses."
            options={statusOptions}
            value={statusFilter}
            onChange={setStatusFilter}
            containerClassName="w-full"
          />
          <div className="flex items-end gap-3">
            <ValueHelp
              label="Activity"
              placeholder="All activity bands"
              emptyLabel="No matching activity bands."
              options={activityOptions}
              value={activityFilter}
              onChange={setActivityFilter}
              containerClassName="w-full"
            />
          </div>
          <div className="flex items-end gap-3">
            <ValueHelp
              label="Sort By"
              placeholder="Default sort"
              emptyLabel="No sorting options."
              options={plantSortOptions}
              value={plantSort}
              onChange={setPlantSort}
              containerClassName="w-full"
              clearLabel="Plant A-Z"
              clearDescription="Reset to the default sort order"
            />
            <button
              type="button"
              onClick={() => {
                setPlantQuery("");
                setCompanyFilter("");
                setManagerFilter("");
                setStatusFilter("");
                setActivityFilter("");
                setPlantSort("name-asc");
              }}
              className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Status</th>
                <th>Company</th>
                <th>Projects</th>
                <th>Documents</th>
                <th>Activity</th>
                <th>Last Upload</th>
                <th>Manager</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlantRows.map(({ plant, docCount, projectCount, activityBand }) => (
                <tr key={plant.id}>
                  <td className="text-strong">{plant.name}</td>
                  <td>{plant.status || "-"}</td>
                  <td>{plant.company || "-"}</td>
                  <td>{projectCount}</td>
                  <td>{docCount}</td>
                  <td>{activityBand}</td>
                  <td>{formatDate(plant.lastUpload)}</td>
                  <td>{plant.manager || "Unassigned"}</td>
                  <td>
                    <Link to={`/plants/${plant.id}`} className="font-semibold text-[#0A6ED1] hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {!sortedPlantRows.length ? <tr><td colSpan={9}>No plants matched the selected filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
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
      <div className="data-table-panel">
        <div className="data-table-toolbar flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-slate-900">{plant.name}</h1>
          {canCreate ? (
            <button onClick={() => navigate(`/plants/${plant.id}/projects/new`)} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Create project
            </button>
          ) : null}
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Projects</th>
                <th>Documents</th>
                <th>Manager</th>
                <th>Company</th>
                <th>Last Upload</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-strong">{plantProjects.length}</td>
                <td>{plantDocuments.length}</td>
                <td>{plant.manager || "Unassigned"}</td>
                <td>{plant.company || "-"}</td>
                <td>{formatDate(plant.lastUpload)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="data-table-panel">
        <div className="data-table-toolbar">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Code</th>
                <th>Documents</th>
                <th>Owner</th>
                <th>Due Date</th>
                <th>Description</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plantProjects.map((project) => (
                <tr key={project.id}>
                  <td className="text-strong">{project.name}</td>
                  <td>{project.code}</td>
                  <td>{project.documentIds.length}</td>
                  <td>{project.owner}</td>
                  <td>{formatDate(project.dueDate)}</td>
                  <td className="min-w-[260px]">{project.description || "-"}</td>
                  <td>
                    <Link to={`/plants/${plant.id}/projects/${project.id}/documents`} className="font-semibold text-[#0A6ED1] hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {!plantProjects.length ? <tr><td colSpan={7}>No projects are registered for this plant.</td></tr> : null}
            </tbody>
          </table>
        </div>
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
  const [documentSort, setDocumentSort] = useState("uploaded-desc");
  const [serverDocuments, setServerDocuments] = useState<EnrichedDocument[]>(documents);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: documents.length });

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

  const queryOptions = useMemo(() => {
    const registry = new Map<string, ValueHelpOption>();
    documents.forEach((document) => {
      if (document.name) {
        registry.set(`document:${document.name}`, { value: document.name, label: document.name, meta: "Document" });
      }
      if (document.plant) {
        registry.set(`plant:${document.plant}`, { value: document.plant, label: document.plant, meta: "Plant" });
      }
      if (document.projectName) {
        registry.set(`project:${document.projectName}`, { value: document.projectName, label: document.projectName, meta: "Project" });
      }
    });
    return Array.from(registry.values()).sort((a, b) => {
      if (a.label === b.label) return (a.meta || "").localeCompare(b.meta || "");
      return a.label.localeCompare(b.label);
    });
  }, [documents]);
  const managerOptions = useMemo(
    () => Array.from(new Set(documents.map((document) => document.managerName))).sort((a, b) => a.localeCompare(b)).map((option) => ({ value: option, label: option, meta: "Manager" })),
    [documents],
  );
  const identifierOptions = useMemo(
    () => Array.from(new Set(documents.map((document) => document.identifier))).sort((a, b) => a.localeCompare(b)).map((option) => ({ value: option, label: option, meta: "Identifier" })),
    [documents],
  );
  const dateOptions = useMemo(
    () =>
      Array.from(new Set(documents.map((document) => document.date).filter((value): value is string => Boolean(value))))
        .sort((a, b) => a.localeCompare(b))
        .map((option) => ({ value: option, label: formatDate(option), meta: option })),
    [documents],
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setDocumentsLoading(true);
      const params = {
        page: 1,
        pageSize: 25,
        q: query,
        plantId,
        projectId,
        category,
        dateFrom,
        dateTo,
        sort_by: "uploaded_at",
        order: "desc",
      };
      const request = scopedProjectId ? projectsApi.documents(scopedProjectId, params) : documentsApi.list(params);
      request
        .then((result) => {
          if (!active) return;
          const enriched = enrichDocuments(result.items, projects, user, plants);
          setServerDocuments(enriched);
          setPagination(result.pagination || { page: 1, pageSize: result.items.length || 25, total: result.items.length });
        })
        .catch(() => {
          if (active) setServerDocuments(documents);
        })
        .finally(() => {
          if (active) setDocumentsLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, dateFrom, dateTo, documents, plantId, projectId, projects, scopedProjectId, plants, query, user]);

  const filtered = useMemo(() => serverDocuments.filter((document) => {
    const matchesPlant = !plantId || document.plantId === plantId;
    const matchesProject = !projectId || document.projectId === projectId;
    const matchesCategory = !category || document.category === category;
    const matchesManager = !manager || document.managerName === manager;
    const matchesIdentifier = !identifier || document.identifier === identifier;
    const matchesQuery = !query || [document.name, document.plant, document.projectName, document.category, document.uploadedBy].join(" ").toLowerCase().includes(query.toLowerCase());
    const matchesFrom = !dateFrom || Boolean(document.date && document.date >= dateFrom);
    const matchesTo = !dateTo || Boolean(document.date && document.date <= dateTo);
    return matchesPlant && matchesProject && matchesCategory && matchesManager && matchesIdentifier && matchesQuery && matchesFrom && matchesTo;
  }), [category, dateFrom, dateTo, identifier, manager, plantId, projectId, query, serverDocuments]);

  const availableProjects = projects.filter((project) => !plantId || project.plantId === plantId);
  const categories = Array.from(new Set(documents.map((document) => document.category))).sort((a, b) => a.localeCompare(b));
  const categoryOptions = categories.map((item) => ({ value: item, label: item, meta: "Category" }));
  const plantValueHelpOptions = plants
    .filter((plant) => user.role !== "Mining Manager" || assignedPlantIds(user).includes(plant.id))
    .map((plant) => ({ value: plant.id, label: plant.name, meta: "Plant" }));
  const projectValueHelpOptions = availableProjects.map((project) => ({ value: project.id, label: project.name, meta: project.code || project.plantName }));
  const documentSortOptions = useMemo(
    () => [
      { value: "uploaded-desc", label: "Latest uploaded first", meta: "Sort" },
      { value: "uploaded-asc", label: "Oldest uploaded first", meta: "Sort" },
      { value: "name-asc", label: "Document A-Z", meta: "Sort" },
      { value: "plant-asc", label: "Plant A-Z", meta: "Sort" },
      { value: "project-asc", label: "Project A-Z", meta: "Sort" },
      { value: "manager-asc", label: "Manager A-Z", meta: "Sort" },
      { value: "category-asc", label: "Category A-Z", meta: "Sort" },
    ],
    [],
  );
  const sortedDocuments = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      switch (documentSort) {
        case "uploaded-asc":
          return compareDateValue(left.date, right.date) || compareText(left.name, right.name);
        case "name-asc":
          return compareText(left.name, right.name);
        case "plant-asc":
          return compareText(left.plant, right.plant) || compareText(left.name, right.name);
        case "project-asc":
          return compareText(left.projectName, right.projectName) || compareText(left.name, right.name);
        case "manager-asc":
          return compareText(left.managerName, right.managerName) || compareText(left.name, right.name);
        case "category-asc":
          return compareText(left.category, right.category) || compareText(left.name, right.name);
        case "uploaded-desc":
        default:
          return compareDateValue(right.date, left.date) || compareText(left.name, right.name);
      }
    });
    return next;
  }, [documentSort, filtered]);
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <FilterField icon={Search} label="Search">
            <ValueHelp
              placeholder="Search documents, plants, projects..."
              emptyLabel="No matching documents, plants, or projects."
              options={queryOptions}
              value={query}
              onChange={setQuery}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={Users} label="Manager">
            <ValueHelp
              placeholder="All managers"
              emptyLabel="No matching managers."
              options={managerOptions}
              value={manager}
              onChange={setManager}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={FileText} label="Identifier">
            <ValueHelp
              placeholder="All identifiers"
              emptyLabel="No matching identifiers."
              options={identifierOptions}
              value={identifier}
              onChange={setIdentifier}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={BarChart3} label="Category">
            <ValueHelp
              placeholder="All categories"
              emptyLabel="No matching categories."
              options={categoryOptions}
              value={category}
              onChange={setCategory}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={Building2} label="Plant">
            <ValueHelp
              placeholder="All plants"
              emptyLabel="No matching plants."
              options={plantValueHelpOptions}
              value={plantId}
              onChange={setPlantId}
              disabled={user.role === "Mining Manager" || Boolean(scopedPlantId)}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={FolderKanban} label="Project">
            <ValueHelp
              placeholder="All projects"
              emptyLabel="No matching projects."
              options={projectValueHelpOptions}
              value={projectId}
              onChange={setProjectId}
              disabled={Boolean(scopedProjectId)}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={Clock3} label="From date">
            <ValueHelp
              placeholder="Any start date"
              emptyLabel="No matching dates."
              options={dateOptions}
              value={dateFrom}
              onChange={setDateFrom}
              containerClassName="w-full"
            />
          </FilterField>
          <FilterField icon={Clock3} label="To date">
            <ValueHelp
              placeholder="Any end date"
              emptyLabel="No matching dates."
              options={dateOptions}
              value={dateTo}
              onChange={setDateTo}
              containerClassName="w-full"
            />
          </FilterField>
          <div className="flex items-end">
            <ValueHelp
              label="Sort By"
              placeholder="Default sort"
              emptyLabel="No sorting options."
              options={documentSortOptions}
              value={documentSort}
              onChange={setDocumentSort}
              containerClassName="w-full"
              clearLabel="Latest uploaded first"
              clearDescription="Reset to the default sort order"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setQuery("");
                setManager("");
                setIdentifier("");
                setCategory("");
                setDateFrom("");
                setDateTo("");
                setDocumentSort("uploaded-desc");
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
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>{documentsLoading ? "Refreshing documents..." : `${pagination.total} document${pagination.total === 1 ? "" : "s"} in current scope`}</span>
          </div>
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
              {sortedDocuments.map((document) => (
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
              {!sortedDocuments.length ? (
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
  const { user, users, documents, markDocumentLocked, refreshData } = usePortal();
  const [comments, setComments] = useState<Comment[]>([]);
  const [conversationDraft, setConversationDraft] = useState("");
  const [conversationAudience, setConversationAudience] = useState<"workspace" | "executive" | "uploader">("workspace");
  const [conversationMessages, setConversationMessages] = useState<DocumentConversationMessage[]>([]);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [commentError, setCommentError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"private" | "public">("private");
  const [commentSaving, setCommentSaving] = useState(false);
  const document = documents.find((item) => item.id === documentId);

  useEffect(() => {
    if (!documentId) return;
    Promise.all([documentsApi.get(documentId), documentsApi.listConversations(documentId)])
      .then(([result, conversations]) => {
        setComments(result.comments);
        setConversationMessages(conversations);
        setCommentError("");
      })
      .catch((error) => setCommentError(error instanceof Error ? error.message : "Unable to load document comments."));
  }, [documentId]);

  useEffect(() => {
    if (user.role === "Mining Manager" && documentId) {
      markDocumentLocked(documentId);
    }
  }, [documentId, markDocumentLocked, user.role]);

  async function handleAddComment() {
    if (!documentId || !commentText.trim() || user.role !== "CEO") return;
    setCommentSaving(true);
    setCommentError("");
    try {
      const created = await documentsApi.addComment(documentId, commentText.trim(), commentVisibility);
      setComments((prev) => [created, ...prev]);
      setCommentText("");
      setCommentVisibility("private");
      await refreshData();
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Unable to save this note.");
    } finally {
      setCommentSaving(false);
    }
  }

  function toggleMention(userId: string) {
    const candidate = users.find((entry) => entry.id === userId);
    if (!candidate) return;
    setSelectedMentionIds((current) =>
      current.includes(userId)
        ? current.filter((value) => value !== userId)
        : [...current, userId],
    );
    setConversationDraft((current) => {
      const token = `@${candidate.name.split(" ")[0]}`;
      return current.includes(token) ? current : `${current}${current.trim() ? " " : ""}${token} `;
    });
  }

  async function handlePostConversation() {
    if (!documentId || !conversationDraft.trim()) return;
    try {
      const created = await documentsApi.addConversation(documentId, {
        text: conversationDraft.trim(),
        audience: conversationAudience,
        mentionIds: selectedMentionIds,
        attachments: [document?.name || "Current document"],
      });
      setConversationMessages((current) => [created, ...current]);
      setConversationDraft("");
      setSelectedMentionIds([]);
      setConversationAudience("workspace");
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Unable to post this conversation.");
    }
  }

  if (!document) return <NotFoundCard title="Document not found" body="This document is no longer available in the current filtered workspace." />;

  const mentionCandidates = users.filter((candidate) => candidate.id !== user.id);
  const conversationAudienceLabels: Record<"workspace" | "executive" | "uploader", string> = {
    workspace: "Document team",
    executive: "Executive only",
    uploader: "Uploader + leadership",
  };

  const breadcrumbs = user.role === "Admin"
    ? [
        { label: "Admin", to: "/admin" },
        { label: "Users", to: "/admin/users" },
        { label: document.uploadedBy, to: `/admin/users/${document.uploadedById}` },
        { label: document.name },
      ]
    : [
        { label: "Documents", to: "/documents" },
        { label: document.projectName, to: `/plants/${document.plantId}/projects/${document.projectId}/documents` },
        { label: document.name },
      ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#334155)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Document detail page</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{document.name}</h1>
            <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Category</div>
                <div className="mt-1 font-semibold text-white">{document.category}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Plant</div>
                <div className="mt-1 font-semibold text-white">{document.plant}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Version</div>
                <div className="mt-1 font-semibold text-white">v{document.version}</div>
              </div>
            </div>
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
          {user.role === "CEO" ? (
            <div className="mt-4 rounded-[28px] border border-[#dbe7f3] bg-[#f8fbff] p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f0fb] text-[#0A6ED1]">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-900">Add CEO note</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    Private notes are visible only to you. Public notes are visible to you and the document uploader.
                  </div>
                </div>
              </div>
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Add a note about this document..."
                rows={4}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#0A6ED1]"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setCommentVisibility("private")}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      commentVisibility === "private"
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Lock size={14} />
                      Private
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentVisibility("public")}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      commentVisibility === "public"
                        ? "bg-[#0A6ED1] text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Globe size={14} />
                      Public
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAddComment()}
                  disabled={!commentText.trim() || commentSaving}
                  className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <Save size={14} />
                    {commentSaving ? "Saving..." : "Save note"}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
          {commentError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {commentError}
            </div>
          ) : null}
          <Tabs defaultValue="notes" className="mt-4 space-y-4">
            <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-slate-100 p-1">
              <TabsTrigger value="notes" className="rounded-xl text-sm">Executive notes</TabsTrigger>
              <TabsTrigger value="conversation" className="rounded-xl text-sm">Document conversations</TabsTrigger>
            </TabsList>

            <TabsContent value="notes" className="mt-0 space-y-3">
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
            </TabsContent>

            <TabsContent value="conversation" className="mt-0 space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff,#f6f8fb)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold text-slate-900">Context-native discussion thread</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Keep conversations attached to this document, mention teammates, and preserve decision context alongside the record.
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    {conversationMessages.length} message{conversationMessages.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <textarea
                    value={conversationDraft}
                    onChange={(event) => setConversationDraft(event.target.value)}
                    rows={4}
                    placeholder="Start a document conversation, request action, or tag someone for follow-up..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#0A6ED1]"
                  />
                  <div className="grid gap-3">
                    <select
                      value={conversationAudience}
                      onChange={(event) => setConversationAudience(event.target.value as "workspace" | "executive" | "uploader")}
                      className="h-11 min-w-[190px] rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-[#0A6ED1]"
                    >
                      <option value="workspace">Document team</option>
                      <option value="uploader">Uploader + leadership</option>
                      <option value="executive">Executive only</option>
                    </select>
                    <button
                      type="button"
                      onClick={handlePostConversation}
                      disabled={!conversationDraft.trim()}
                      className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Post conversation
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {mentionCandidates.slice(0, 8).map((candidate) => (
                    <button
                      key={`mention-${candidate.id}`}
                      type="button"
                      onClick={() => toggleMention(candidate.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        selectedMentionIds.includes(candidate.id)
                          ? "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1]"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      @{candidate.name.split(" ")[0]}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                    Document attached: {document.name}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    Audience: {conversationAudienceLabels[conversationAudience]}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {conversationMessages.map((message) => (
                  <div key={message.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{message.authorName}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{message.authorRole}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#EBF4FD] px-3 py-1 text-xs font-medium text-[#0A6ED1]">
                          {conversationAudienceLabels[message.audience]}
                        </span>
                        <span className="text-xs text-slate-400">{formatDate(message.createdAt)}</span>
                      </div>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate-700">{message.text}</div>
                    {message.mentions.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.mentions.map((mention) => (
                          <span key={`${message.id}-${mention}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                            @{mention.split(" ")[0]}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.attachments.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => (
                          <span key={`${message.id}-${attachment}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                            {attachment}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {!conversationMessages.length ? (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                    No conversation has started on this document yet. Use the thread above to kick off follow-ups, tag stakeholders, and keep decisions attached to the document.
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
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
  const { documents, plants, projects, users, notifications, portalState } = usePortal();
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

  const recentDocuments = useMemo(
    () =>
      [...documents]
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .slice(0, 5),
    [documents],
  );

  const dormantPlants = useMemo(
    () =>
      plantBreakdown
        .filter((item) => item.documents <= 2)
        .slice(0, 3),
    [plantBreakdown],
  );

  const securityAlerts = useMemo(
    () =>
      notifications.filter((item) => /alert|security|session|ip|access/i.test(`${item.title} ${item.detail}`)).length,
    [notifications],
  );

  const disabledUsers = useMemo(
    () => users.filter((candidate) => candidate.status !== "Active").length,
    [users],
  );

  const reviewRules = useMemo(
    () => portalState.ipRules.filter((rule) => rule.status === "Review").length,
    [portalState.ipRules],
  );

  const blockedRules = useMemo(
    () => portalState.ipRules.filter((rule) => rule.status === "Blocked").length,
    [portalState.ipRules],
  );

  const trustScore = useMemo(() => {
    const bonuses = (portalState.sessionPolicy.enforceSingleSession ? 8 : 0) + (portalState.sessionPolicy.conflictMode === "block" ? 6 : 0);
    const penalties = (disabledUsers * 6) + (reviewRules * 7) + (securityAlerts * 4) + Math.min(20, timelineHighlights.totalLocked * 2);
    return Math.max(24, Math.min(100, 84 + bonuses - penalties - blockedRules * 2));
  }, [blockedRules, disabledUsers, portalState.sessionPolicy.conflictMode, portalState.sessionPolicy.enforceSingleSession, reviewRules, securityAlerts, timelineHighlights.totalLocked]);

  const trustPillars = [
    { label: "Identity hygiene", value: Math.max(20, 100 - disabledUsers * 15), detail: `${disabledUsers} account${disabledUsers === 1 ? "" : "s"} need attention.` },
    { label: "Network posture", value: Math.max(20, 100 - reviewRules * 18 - blockedRules * 8), detail: `${reviewRules} rules in review, ${blockedRules} blocked.` },
    { label: "Session control", value: portalState.sessionPolicy.enforceSingleSession ? 93 : 68, detail: `${portalState.sessionPolicy.autoLogoutMinutes} minute timeout with ${portalState.sessionPolicy.conflictMode} conflict mode.` },
    { label: "Document control", value: Math.max(20, 100 - timelineHighlights.totalLocked * 6), detail: `${timelineHighlights.totalLocked} records are in controlled manager-locked state.` },
  ];

  const briefingCards = [
    {
      title: "What moved",
      detail: `${recentDocuments.length} recent uploads are driving the latest activity, led by ${recentDocuments[0]?.plant || "no plant"} and ${recentDocuments[0]?.category || "no category"}.`,
      action: "/documents",
      label: "Open recent docs",
    },
    {
      title: "What needs attention",
      detail: dormantPlants.length
        ? `${dormantPlants.map((item) => item.plant).join(", ")} are under-reporting and may need follow-up.`
        : "No dormant plants are currently falling behind the rest of the network.",
      action: "/plants",
      label: "Review plants",
    },
    {
      title: "What could escalate",
      detail: securityAlerts
        ? `${securityAlerts} active trust or security signals could surface in the next executive review cycle.`
        : "No active trust alerts are crowding the executive queue right now.",
      action: "/activity-logs",
      label: "Review trust layer",
    },
  ];

  const signalWall = plantBreakdown.slice(0, 4).map((item, index) => ({
    ...item,
    intensity: Math.min(100, item.documents * 9 + item.locked * 8 + item.projects * 5),
    tone: ["from-[#DBEAFE] to-[#EFF6FF]", "from-[#DCFCE7] to-[#F0FDF4]", "from-[#FEF3C7] to-[#FFFBEB]", "from-[#FCE7F3] to-[#FFF1F2]"][index % 4],
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Analytics" }]} />
      <div className="data-table-panel">
        <div className="data-table-toolbar">
          <h1 className="text-lg font-semibold text-slate-900">Analytics</h1>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Upload Trend</th>
                <th>Top Plant</th>
                <th>Leading Category</th>
                <th>Locked Records</th>
                <th>Trust Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-strong">{timelineHighlights.growth >= 0 ? "+" : ""}{timelineHighlights.growth}%</td>
                <td>{timelineHighlights.mostDocumentedPlant?.plant || "-"}</td>
                <td>{timelineHighlights.busiestCategory?.name || "-"}</td>
                <td>{timelineHighlights.totalLocked}</td>
                <td>{trustScore}/100</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6">
        <div className="data-table-panel">
          <div className="data-table-toolbar">
            <h2 className="text-lg font-semibold text-slate-900">Executive Briefing</h2>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Detail</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {briefingCards.map((card) => (
                  <tr key={card.title}>
                    <td className="text-strong">{card.title}</td>
                    <td className="min-w-[360px]">{card.detail}</td>
                    <td>
                      <button type="button" onClick={() => navigate(card.action)} className="font-semibold text-[#0A6ED1] hover:underline">
                        {card.label}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <SectionCard title="Trust and security layer" subtitle="Live confidence score across identity, network, session, and document controls">
          <div className="rounded-[32px] bg-[linear-gradient(135deg,#0f172a,#1e293b)] p-6 text-white">
            <div className="text-xs uppercase tracking-[0.24em] text-white/50">Trust score</div>
            <div className="mt-3 text-5xl font-semibold tracking-tight">{trustScore}</div>
            <div className="mt-2 text-sm text-white/70">
              {trustScore >= 85 ? "Posture is strong and resilient." : trustScore >= 70 ? "Healthy overall, with some watchpoints." : "Attention needed across governance controls."}
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#22c55e,#38bdf8)]" style={{ width: `${trustScore}%` }} />
            </div>
          </div>
          <div className="mt-4 data-table-panel">
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Control Area</th>
                    <th>Score</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {trustPillars.map((pillar) => (
                    <tr key={pillar.label}>
                      <td className="text-strong">{pillar.label}</td>
                      <td>{pillar.value}/100</td>
                      <td className="min-w-[260px]">{pillar.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Upload trend" value={`${timelineHighlights.growth >= 0 ? "+" : ""}${timelineHighlights.growth}%`} hint="Month-over-month document movement." icon={LineChartIcon} onClick={() => navigate("/documents")} />
        <MetricCard label="Top plant" value={timelineHighlights.mostDocumentedPlant?.plant || "-"} hint={`${timelineHighlights.mostDocumentedPlant?.documents || 0} indexed documents`} icon={Building2} tone="blue" onClick={() => navigate("/plants")} />
        <MetricCard label="Busiest category" value={timelineHighlights.busiestCategory?.name || "-"} hint={`${timelineHighlights.busiestCategory?.value || 0} records`} icon={BarChart3} tone="amber" onClick={() => navigate("/documents")} />
        <MetricCard label="Locked records" value={timelineHighlights.totalLocked} hint="Manager-opened records in controlled state." icon={Lock} tone="rose" onClick={() => navigate("/activity-logs")} />
      </div>

      <div className="data-table-panel">
        <div className="data-table-toolbar">
          <h2 className="text-lg font-semibold text-slate-900">Plant Signals</h2>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Documents</th>
                <th>Projects</th>
                <th>Controlled Records</th>
                <th>Intensity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {signalWall.map((item) => (
                <tr key={item.plantId}>
                  <td className="text-strong">{item.plant}</td>
                  <td>{item.documents}</td>
                  <td>{item.projects}</td>
                  <td>{item.locked}</td>
                  <td>{item.intensity}%</td>
                  <td>
                    <button type="button" onClick={() => navigate(`/plants/${item.plantId}`)} className="font-semibold text-[#0A6ED1] hover:underline">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

        <SectionCard title="Category distribution" subtitle="Portfolio view by document category">
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

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Recent document rhythm" subtitle="The documents most recently shaping executive attention">
          <div className="space-y-3">
            {recentDocuments.map((document, index) => (
              <button
                key={document.id}
                type="button"
                onClick={() => navigate(`/documents/${document.id}`)}
                className="flex w-full items-start gap-4 rounded-[28px] border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">{document.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{document.plant} • {document.category}</div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">{document.projectName}</div>
                </div>
                <div className="text-xs text-slate-400">{formatDate(document.date)}</div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Trust watchlist" subtitle="Signals that could erode confidence if left unattended">
          <div className="grid gap-4 md:grid-cols-2">
            <button type="button" onClick={() => navigate("/activity-logs")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Network reviews</div>
              <div className="mt-2 text-sm text-slate-600">{reviewRules} IP rule entries still need a decision.</div>
            </button>
            <button type="button" onClick={() => navigate("/oversight")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Identity hygiene</div>
              <div className="mt-2 text-sm text-slate-600">{disabledUsers} accounts are inactive or disabled and should be reviewed.</div>
            </button>
            <button type="button" onClick={() => navigate("/settings")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Session enforcement</div>
              <div className="mt-2 text-sm text-slate-600">
                Single-session mode is {portalState.sessionPolicy.enforceSingleSession ? "enforced" : "advisory"} with {portalState.sessionPolicy.autoLogoutMinutes}-minute auto logout.
              </div>
            </button>
            <button type="button" onClick={() => navigate("/documents")} className="rounded-3xl bg-slate-50 p-4 text-left transition hover:bg-slate-100">
              <div className="text-sm font-semibold text-slate-900">Document control</div>
              <div className="mt-2 text-sm text-slate-600">{timelineHighlights.totalLocked} manager-locked records can be replayed for controlled review behavior.</div>
            </button>
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
            <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Users</div>
                <div className="mt-1 font-semibold text-white">{users.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">IP Rules</div>
                <div className="mt-1 font-semibold text-white">{portalState.ipRules.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <div className="text-white/55">Session Mode</div>
                <div className="mt-1 font-semibold text-white">{portalState.sessionPolicy.conflictMode}</div>
              </div>
            </div>
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
        <SectionCard title="Role distribution" subtitle="Authority profile by account type">
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
  const { user, users, plants, documents, refreshData } = usePortal();
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
  const [showUserPassword, setShowUserPassword] = useState(false);
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
    plant: "",
    plantName: "",
    plantName2: "",
    address: "",
  });
  const [plantEditDraft, setPlantEditDraft] = useState({
    plant: "",
    plantName: "",
    plantName2: "",
    address: "",
  });
  const [projectDraft, setProjectDraft] = useState({
    plantId: "",
    name: "",
    code: "",
    description: "",
    dueDate: "",
  });
  const [activeMasterTab, setActiveMasterTab] = useState("records");
  const [userFilter, setUserFilter] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [userScopeFilter, setUserScopeFilter] = useState("");
  const [userEmailFilter, setUserEmailFilter] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("");
  const [userSort, setUserSort] = useState("name-asc");
  const [plantFilter, setPlantFilter] = useState("");
  const [plantCompanyFilter, setPlantCompanyFilter] = useState("");
  const [plantManagerFilter, setPlantManagerFilter] = useState("");
  const [plantStatusFilter, setPlantStatusFilter] = useState("");
  const [plantAddressFilter, setPlantAddressFilter] = useState("");
  const [plantSort, setPlantSort] = useState("name-asc");
  const [projectFilter, setProjectFilter] = useState("");
  const [projectPlantFilter, setProjectPlantFilter] = useState("");
  const [projectOwnerFilter, setProjectOwnerFilter] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("");
  const [projectCodeFilter, setProjectCodeFilter] = useState("");
  const [projectSort, setProjectSort] = useState("created-desc");
  const [documentNameFilter, setDocumentNameFilter] = useState("");
  const [documentPlantFilter, setDocumentPlantFilter] = useState("");
  const [documentProjectFilter, setDocumentProjectFilter] = useState("");
  const [documentUploaderFilter, setDocumentUploaderFilter] = useState("");
  const [documentCategoryFilter, setDocumentCategoryFilter] = useState("");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("");
  const [documentSort, setDocumentSort] = useState("uploaded-desc");

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
        const matchesName = matchesValueHelpFilter(documentNameFilter, document.name);
        const matchesPlant = !documentPlantFilter || document.plantId === documentPlantFilter;
        const matchesProject = !documentProjectFilter || document.projectId === documentProjectFilter;
        const matchesUploader = !documentUploaderFilter || document.uploadedBy === documentUploaderFilter;
        const matchesCategory = matchesValueHelpFilter(documentCategoryFilter, document.category);
        const matchesStatus = matchesValueHelpFilter(documentStatusFilter, document.status);
        return matchesName && matchesPlant && matchesProject && matchesUploader && matchesCategory && matchesStatus;
      }),
    [documentCategoryFilter, documentNameFilter, documentPlantFilter, documentProjectFilter, documentStatusFilter, documentUploaderFilter, documents],
  );
  const userOptions = useMemo(() => buildValueHelpOptions(users.map((candidate) => candidate.name), "User"), [users]);
  const userEmailOptions = useMemo(() => buildValueHelpOptions(users.map((candidate) => candidate.email), "Email"), [users]);
  const userRoleOptions = useMemo(() => buildValueHelpOptions(users.map((candidate) => candidate.role), "Role"), [users]);
  const userStatusOptions = useMemo(() => buildValueHelpOptions(users.map((candidate) => candidate.status), "Status"), [users]);
  const userScopeOptions = useMemo(
    () => [
      { value: "enterprise", label: "Enterprise access", meta: "Scope" },
      { value: "single", label: "Single plant", meta: "Scope" },
      { value: "multi", label: "Multi plant", meta: "Scope" },
    ],
    [],
  );
  const userSortOptions = useMemo(
    () => [
      { value: "name-asc", label: "User A-Z", meta: "Sort" },
      { value: "role-asc", label: "Role A-Z", meta: "Sort" },
      { value: "status-asc", label: "Status A-Z", meta: "Sort" },
      { value: "created-desc", label: "Newest created first", meta: "Sort" },
    ],
    [],
  );
  const filteredUsers = useMemo(() => users.filter((candidate) => {
    const scopeCount = candidate.assignedPlantIds?.length || (candidate.plantId ? 1 : 0);
    const scope = scopeCount > 1 ? "multi" : scopeCount === 1 ? "single" : "enterprise";
    return matchesValueHelpFilter(userFilter, candidate.name)
      && matchesValueHelpFilter(userEmailFilter, candidate.email)
      && matchesValueHelpFilter(userRoleFilter, candidate.role)
      && matchesValueHelpFilter(userStatusFilter, candidate.status)
      && matchesValueHelpFilter(userScopeFilter, scope);
  }), [userEmailFilter, userFilter, userRoleFilter, userScopeFilter, userStatusFilter, users]);
  const sortedUsers = useMemo(() => {
    const next = [...filteredUsers];
    next.sort((left, right) => {
      switch (userSort) {
        case "role-asc":
          return compareText(left.role, right.role) || compareText(left.name, right.name);
        case "status-asc":
          return compareText(left.status, right.status) || compareText(left.name, right.name);
        case "created-desc":
          return compareDateValue(right.createdAt, left.createdAt) || compareText(left.name, right.name);
        case "name-asc":
        default:
          return compareText(left.name, right.name);
      }
    });
    return next;
  }, [filteredUsers, userSort]);
  const plantOptions = useMemo(() => buildValueHelpOptions(plants.map((plant) => plant.name), "Plant"), [plants]);
  const plantCompanyOptions = useMemo(() => buildValueHelpOptions(plants.map((plant) => plant.company), "Company"), [plants]);
  const plantManagerOptions = useMemo(() => buildValueHelpOptions(plants.map((plant) => plant.manager), "Manager"), [plants]);
  const plantStatusOptions = useMemo(() => buildValueHelpOptions(plants.map((plant) => plant.status), "Status"), [plants]);
  const plantAddressOptions = useMemo(() => buildValueHelpOptions(plants.map((plant) => plant.address || plant.location || ""), "Address"), [plants]);
  const plantSortOptions = useMemo(
    () => [
      { value: "name-asc", label: "Plant A-Z", meta: "Sort" },
      { value: "company-asc", label: "Company A-Z", meta: "Sort" },
      { value: "manager-asc", label: "Manager A-Z", meta: "Sort" },
      { value: "documents-desc", label: "Most documents first", meta: "Sort" },
    ],
    [],
  );
  const filteredPlants = useMemo(() => plants.filter((plant) =>
    matchesValueHelpFilter(plantFilter, plant.name)
    && matchesValueHelpFilter(plantCompanyFilter, plant.company)
    && matchesValueHelpFilter(plantManagerFilter, plant.manager || undefined)
    && matchesValueHelpFilter(plantStatusFilter, plant.status)
    && matchesValueHelpFilter(plantAddressFilter, plant.address || plant.location || undefined)
  ), [plantAddressFilter, plantCompanyFilter, plantFilter, plantManagerFilter, plantStatusFilter, plants]);
  const sortedPlants = useMemo(() => {
    const next = [...filteredPlants];
    next.sort((left, right) => {
      switch (plantSort) {
        case "company-asc":
          return compareText(left.company, right.company) || compareText(left.name, right.name);
        case "manager-asc":
          return compareText(left.manager, right.manager) || compareText(left.name, right.name);
        case "documents-desc":
          return compareNumber(right.documents, left.documents) || compareText(left.name, right.name);
        case "name-asc":
        default:
          return compareText(left.name, right.name);
      }
    });
    return next;
  }, [filteredPlants, plantSort]);
  const documentPlantOptions = useMemo(
    () => plants.map((plant) => ({ value: plant.id, label: plant.name, meta: "Plant" })),
    [plants],
  );
  const documentProjectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name, meta: project.code || project.plantName })),
    [projects],
  );
  const documentUploaderOptions = useMemo(() => buildValueHelpOptions(documents.map((document) => document.uploadedBy), "Uploader"), [documents]);
  const documentNameOptions = useMemo(() => buildValueHelpOptions(documents.map((document) => document.name), "Document"), [documents]);
  const documentCategoryOptions = useMemo(() => buildValueHelpOptions(documents.map((document) => document.category), "Category"), [documents]);
  const documentStatusOptions = useMemo(() => buildValueHelpOptions(documents.map((document) => document.status), "Status"), [documents]);
  const documentSortOptions = useMemo(
    () => [
      { value: "uploaded-desc", label: "Latest uploaded first", meta: "Sort" },
      { value: "name-asc", label: "Document A-Z", meta: "Sort" },
      { value: "plant-asc", label: "Plant A-Z", meta: "Sort" },
      { value: "uploader-asc", label: "Uploader A-Z", meta: "Sort" },
    ],
    [],
  );
  const sortedDocuments = useMemo(() => {
    const next = [...filteredDocuments];
    next.sort((left, right) => {
      switch (documentSort) {
        case "name-asc":
          return compareText(left.name, right.name);
        case "plant-asc":
          return compareText(left.plant, right.plant) || compareText(left.name, right.name);
        case "uploader-asc":
          return compareText(left.uploadedBy, right.uploadedBy) || compareText(left.name, right.name);
        case "uploaded-desc":
        default:
          return compareDateValue(right.date, left.date) || compareText(left.name, right.name);
      }
    });
    return next;
  }, [documentSort, filteredDocuments]);
  const projectNameOptions = useMemo(() => buildValueHelpOptions(projects.map((project) => project.name), "Project"), [projects]);
  const projectPlantOptions = useMemo(() => buildValueHelpOptions(projects.map((project) => project.plantName), "Plant"), [projects]);
  const projectOwnerOptions = useMemo(() => buildValueHelpOptions(projects.map((project) => project.owner), "Owner"), [projects]);
  const projectStatusOptions = useMemo(() => buildValueHelpOptions(projects.map((project) => project.status), "Status"), [projects]);
  const projectCodeOptions = useMemo(() => buildValueHelpOptions(projects.map((project) => project.code), "Code"), [projects]);
  const projectSortOptions = useMemo(
    () => [
      { value: "created-desc", label: "Newest created first", meta: "Sort" },
      { value: "name-asc", label: "Project A-Z", meta: "Sort" },
      { value: "plant-asc", label: "Plant A-Z", meta: "Sort" },
      { value: "documents-desc", label: "Most documents first", meta: "Sort" },
    ],
    [],
  );
  const filteredProjects = useMemo(() => projects.filter((project) =>
    matchesValueHelpFilter(projectFilter, project.name)
    && matchesValueHelpFilter(projectPlantFilter, project.plantName)
    && matchesValueHelpFilter(projectOwnerFilter, project.owner)
    && matchesValueHelpFilter(projectStatusFilter, project.status)
    && matchesValueHelpFilter(projectCodeFilter, project.code)
  ), [projectCodeFilter, projectFilter, projectOwnerFilter, projectPlantFilter, projectStatusFilter, projects]);
  const sortedProjects = useMemo(() => {
    const next = [...filteredProjects];
    next.sort((left, right) => {
      switch (projectSort) {
        case "name-asc":
          return compareText(left.name, right.name);
        case "plant-asc":
          return compareText(left.plantName, right.plantName) || compareText(left.name, right.name);
        case "documents-desc":
          return compareNumber(right.documentIds.length, left.documentIds.length) || compareText(left.name, right.name);
        case "created-desc":
        default:
          return compareDateValue(right.createdAt, left.createdAt) || compareText(left.name, right.name);
      }
    });
    return next;
  }, [filteredProjects, projectSort]);

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
    if (!plantDraft.plant.trim() || !plantDraft.plantName.trim() || !plantDraft.plantName2.trim() || !plantDraft.address.trim()) {
      setError("Plant, Plant Name, Plant Name 2, and Address are required.");
      return;
    }
    setPlantSubmitting(true);
    resetMessages();
    try {
      await plantsApi.create({
        plant: plantDraft.plant.trim(),
        plantName: plantDraft.plantName.trim(),
        plantName2: plantDraft.plantName2.trim(),
        address: plantDraft.address.trim(),
        name: plantDraft.plantName.trim(),
        company: "Midwest Limited",
        location: plantDraft.address.trim(),
      });
      setNotice(`${plantDraft.plantName.trim()} was added to master data.`);
      setPlantDraft({
        plant: "",
        plantName: "",
        plantName2: "",
        address: "",
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
    const normalizedPolicy = normalizeGovernancePolicy(governancePolicy);
    if (!normalizedPolicy.allowedUploadFormats.length) {
      setError("Select at least one allowed upload format.");
      return;
    }
    if (!normalizedPolicy.businessHours.allowedDays.length) {
      setError("Select at least one allowed business day.");
      return;
    }
    if (normalizedPolicy.businessHours.startHour === normalizedPolicy.businessHours.endHour) {
      setError("Choose different start and end times for manager business hours.");
      return;
    }
    setPolicySubmitting(true);
    resetMessages();
    try {
      const updated = await settingsApi.updateGovernancePolicy(normalizedPolicy);
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
      plant: plant.plant || "",
      plantName: plant.plantName || plant.name,
      plantName2: plant.plantName2 || "",
      address: plant.address || plant.location || "",
    });
    resetMessages();
  }

  async function savePlantEdit() {
    if (!editingPlantId) return;
    if (!plantEditDraft.plant.trim() || !plantEditDraft.plantName.trim() || !plantEditDraft.plantName2.trim() || !plantEditDraft.address.trim()) {
      setError("Plant, Plant Name, Plant Name 2, and Address are required.");
      return;
    }
    setPlantSubmitting(true);
    resetMessages();
    try {
      await plantsApi.update(editingPlantId, {
        ...plantEditDraft,
        name: plantEditDraft.plantName.trim(),
        company: "Midwest Limited",
        location: plantEditDraft.address.trim(),
      });
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
      <Breadcrumbs items={user.role === "Admin" ? [{ label: "Admin", to: "/admin" }, { label: "Master Data" }] : [{ label: "Master Data" }]} />

      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="max-w-4xl">
          <div className="text-xs uppercase tracking-[0.26em] text-white/55">Master data control room</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Create and govern the platform’s foundational records</h1>
          <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3"><div className="text-white/55">Users</div><div className="mt-1 font-semibold text-white">{users.length}</div></div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3"><div className="text-white/55">Plants</div><div className="mt-1 font-semibold text-white">{plants.length}</div></div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3"><div className="text-white/55">Projects</div><div className="mt-1 font-semibold text-white">{loadingProjects ? "..." : projects.length}</div></div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3"><div className="text-white/55">Documents</div><div className="mt-1 font-semibold text-white">{documents.length}</div></div>
          </div>
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

      <SectionCard title="Master data creation table" subtitle="Create and govern users, plants, projects, and policy controls from one detailed table">
        <div className="overflow-x-auto rounded-[24px] border border-slate-200">
          <table className="min-w-[1220px] divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Create</th>
                <th className="px-4 py-3 font-medium">Column 1</th>
                <th className="px-4 py-3 font-medium">Column 2</th>
                <th className="px-4 py-3 font-medium">Column 3</th>
                <th className="px-4 py-3 font-medium">Column 4</th>
                <th className="px-4 py-3 font-medium">Column 5</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-sm">
              <tr className="align-top bg-sky-50/60">
                <td className="px-4 py-4">
                  <div className="inline-flex rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">User</div>
                  <div className="mt-3 font-semibold text-slate-900">Account creation</div>
                  <div className="mt-1 text-xs text-slate-500">Provision Admin, CEO, or Mining Manager access.</div>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Full name</div>
                  <input value={userDraft.name} onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Full name" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Email</div>
                  <input value={userDraft.email} onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Role</div>
                  <select value={userDraft.role} onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value as UserRole, assignedPlantIds: event.target.value === "Mining Manager" ? current.assignedPlantIds : [] }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
                    <option value="Admin">Admin</option>
                    <option value="CEO">CEO</option>
                    <option value="Mining Manager">Mining Manager</option>
                  </select>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Temporary password</div>
                  <div className="relative">
                    <input
                      type={showUserPassword ? "text" : "password"}
                      value={userDraft.password}
                      onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))}
                      placeholder="Temporary password"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-12 outline-none transition focus:border-teal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowUserPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label={showUserPassword ? "Hide password" : "Show password"}
                    >
                      {showUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Assigned plants</div>
                  <div className="mb-2 text-xs text-slate-500">Optional for Admin and CEO. Active for Mining Managers.</div>
                  <div className="grid max-h-44 gap-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
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
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-3">
                    <button onClick={() => void createUserRecord()} disabled={userSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                      Create user
                    </button>
                    <button onClick={() => navigate("/admin/users")} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                      Open users
                    </button>
                  </div>
                </td>
              </tr>

              <tr className="align-top bg-emerald-50/50">
                <td className="px-4 py-4">
                  <div className="inline-flex rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Plant</div>
                  <div className="mt-3 font-semibold text-slate-900">Plant creation</div>
                  <div className="mt-1 text-xs text-slate-500">Add a new operational plant record.</div>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Plant code</div>
                  <input value={plantDraft.plant} onChange={(event) => setPlantDraft((current) => ({ ...current, plant: event.target.value }))} placeholder="Plant" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Plant name</div>
                  <input value={plantDraft.plantName} onChange={(event) => setPlantDraft((current) => ({ ...current, plantName: event.target.value }))} placeholder="Plant Name" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Plant name 2</div>
                  <input value={plantDraft.plantName2} onChange={(event) => setPlantDraft((current) => ({ ...current, plantName2: event.target.value }))} placeholder="Plant Name 2" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4" colSpan={2}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Address</div>
                  <input value={plantDraft.address} onChange={(event) => setPlantDraft((current) => ({ ...current, address: event.target.value }))} placeholder="Address" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void createPlantRecord()} disabled={plantSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                    Create plant
                  </button>
                </td>
              </tr>

              <tr className="align-top bg-amber-50/55">
                <td className="px-4 py-4">
                  <div className="inline-flex rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Project</div>
                  <div className="mt-3 font-semibold text-slate-900">Project creation</div>
                  <div className="mt-1 text-xs text-slate-500">Register a new project under a selected plant.</div>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Plant</div>
                  <select value={projectDraft.plantId} onChange={(event) => setProjectDraft((current) => ({ ...current, plantId: event.target.value }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
                    <option value="">Select plant</option>
                    {plants.map((plant) => (
                      <option key={`project-${plant.id}`} value={plant.id}>{plant.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Project name</div>
                  <input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Project name" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Project code</div>
                  <input value={projectDraft.code} onChange={(event) => setProjectDraft((current) => ({ ...current, code: event.target.value }))} placeholder="Project code" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Due date</div>
                  <input type="date" value={projectDraft.dueDate} onChange={(event) => setProjectDraft((current) => ({ ...current, dueDate: event.target.value }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Description</div>
                  <textarea value={projectDraft.description} onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Project description" rows={4} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-500" />
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void createProjectEntry()} disabled={projectSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                    Create project
                  </button>
                </td>
              </tr>

              <tr className="align-top bg-violet-50/45">
                <td className="px-4 py-4">
                  <div className="inline-flex rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-700">Policy</div>
                  <div className="mt-3 font-semibold text-slate-900">Document upload formats</div>
                  <div className="mt-1 text-xs text-slate-500">Control which file types mining managers are allowed to upload.</div>
                </td>
                <td className="px-4 py-4" colSpan={5}>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"].map((extension) => (
                      <label key={`format-${extension}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
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
                  <div className="mt-3 rounded-2xl border border-violet-100 bg-white px-4 py-3 text-xs text-slate-600">
                    Allowed now: {governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ") || "None"}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void saveGovernancePolicy()} disabled={policySubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                    Save policy
                  </button>
                </td>
              </tr>

              <tr className="align-top bg-rose-50/45">
                <td className="px-4 py-4">
                  <div className="inline-flex rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700">Policy</div>
                  <div className="mt-3 font-semibold text-slate-900">Mining manager business hours</div>
                  <div className="mt-1 text-xs text-slate-500">Set the permitted sign-in window and working days for mining managers.</div>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Timezone</div>
                  <select
                    value={governancePolicy.businessHours.timezone}
                    onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, timezone: event.target.value } }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
                  >
                    {GOVERNANCE_TIMEZONES.map((timeZone) => (
                      <option key={timeZone} value={timeZone}>{timeZone}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Start time</div>
                  <select
                    value={governancePolicy.businessHours.startHour}
                    onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, startHour: Number(event.target.value) } }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
                  >
                    {GOVERNANCE_TIME_OPTIONS.map((option) => (
                      <option key={`start-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">End time</div>
                  <select
                    value={governancePolicy.businessHours.endHour}
                    onChange={(event) => setGovernancePolicy((current) => ({ ...current, businessHours: { ...current.businessHours, endHour: Number(event.target.value) } }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500"
                  >
                    {GOVERNANCE_TIME_OPTIONS.map((option) => (
                      <option key={`end-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4" colSpan={2}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Working days</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {BUSINESS_DAY_OPTIONS.map((day) => (
                      <label key={`day-${day.value}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
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
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-white px-4 py-3 text-xs text-slate-600">
                    Active window: {describeBusinessHours(governancePolicy)}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void saveGovernancePolicy()} disabled={policySubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
                    Save hours
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-6">
        <SectionCard title="User registry" subtitle="SAP-style account master data with role, scope, status, and lifecycle visibility">
          <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <ValueHelp label="User" placeholder="All users" emptyLabel="No matching users." options={userOptions} value={userFilter} onChange={setUserFilter} containerClassName="w-full" />
            <ValueHelp label="Email" placeholder="All emails" emptyLabel="No matching emails." options={userEmailOptions} value={userEmailFilter} onChange={setUserEmailFilter} containerClassName="w-full" />
            <ValueHelp label="Role" placeholder="All roles" emptyLabel="No matching roles." options={userRoleOptions} value={userRoleFilter} onChange={setUserRoleFilter} containerClassName="w-full" />
            <ValueHelp label="Status" placeholder="All statuses" emptyLabel="No matching statuses." options={userStatusOptions} value={userStatusFilter} onChange={setUserStatusFilter} containerClassName="w-full" />
            <ValueHelp label="Scope" placeholder="All scopes" emptyLabel="No matching scopes." options={userScopeOptions} value={userScopeFilter} onChange={setUserScopeFilter} containerClassName="w-full" />
            <div className="flex items-end gap-3">
              <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={userSortOptions} value={userSort} onChange={setUserSort} containerClassName="w-full" clearLabel="User A-Z" clearDescription="Reset to the default sort order" />
              <button type="button" onClick={() => { setUserFilter(""); setUserEmailFilter(""); setUserRoleFilter(""); setUserStatusFilter(""); setUserScopeFilter(""); setUserSort("name-asc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
            </div>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned scope</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-sm">
                {sortedUsers.map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="px-4 py-4 font-medium text-slate-900">{candidate.name}</td>
                    <td className="px-4 py-4 text-slate-600">{candidate.email}</td>
                    <td className="px-4 py-4 text-slate-600">{candidate.role}</td>
                    <td className="px-4 py-4 text-slate-600">{candidate.status}</td>
                    <td className="px-4 py-4 text-slate-600">{candidate.assignedPlants?.join(", ") || candidate.plant || "Enterprise access"}</td>
                    <td className="px-4 py-4 text-slate-600">{formatDate(candidate.createdAt || null)}</td>
                  </tr>
                ))}
                {!sortedUsers.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No users matched the current filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Plant registry" subtitle="Master-data table for operational plants with edit and delete actions">
          <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <ValueHelp label="Plant" placeholder="All plants" emptyLabel="No matching plants." options={plantOptions} value={plantFilter} onChange={setPlantFilter} containerClassName="w-full" />
            <ValueHelp label="Company" placeholder="All companies" emptyLabel="No matching companies." options={plantCompanyOptions} value={plantCompanyFilter} onChange={setPlantCompanyFilter} containerClassName="w-full" />
            <ValueHelp label="Manager" placeholder="All managers" emptyLabel="No matching managers." options={plantManagerOptions} value={plantManagerFilter} onChange={setPlantManagerFilter} containerClassName="w-full" />
            <ValueHelp label="Status" placeholder="All statuses" emptyLabel="No matching statuses." options={plantStatusOptions} value={plantStatusFilter} onChange={setPlantStatusFilter} containerClassName="w-full" />
            <ValueHelp label="Address" placeholder="All addresses" emptyLabel="No matching addresses." options={plantAddressOptions} value={plantAddressFilter} onChange={setPlantAddressFilter} containerClassName="w-full" />
            <div className="flex items-end gap-3">
              <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={plantSortOptions} value={plantSort} onChange={setPlantSort} containerClassName="w-full" clearLabel="Plant A-Z" clearDescription="Reset to the default sort order" />
              <button type="button" onClick={() => { setPlantFilter(""); setPlantCompanyFilter(""); setPlantManagerFilter(""); setPlantStatusFilter(""); setPlantAddressFilter(""); setPlantSort("name-asc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
            </div>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm text-slate-500">
                  <th className="px-4 py-3 font-medium">Plant</th>
                  <th className="px-4 py-3 font-medium">Plant code</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  <th className="px-4 py-3 font-medium">Documents</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-sm">
                {sortedPlants.map((plant) => (
                  <tr key={plant.id}>
                    <td className="px-4 py-4 font-medium text-slate-900">{plant.plantName || plant.name}</td>
                    <td className="px-4 py-4 text-slate-600">{plant.plant || "-"}</td>
                    <td className="px-4 py-4 text-slate-600">{plant.company || "-"}</td>
                    <td className="px-4 py-4 text-slate-600">{plant.manager || "Unassigned"}</td>
                    <td className="px-4 py-4 text-slate-600">{plant.documents}</td>
                    <td className="px-4 py-4 text-slate-600">{plant.address || plant.location || "-"}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => openPlantEditor(plant)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">Edit</button>
                        <button onClick={() => void removePlantRecord(plant)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!sortedPlants.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No plants matched the current filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {editingPlantId ? (
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-base font-semibold text-slate-900">Edit plant</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input value={plantEditDraft.plant} onChange={(event) => setPlantEditDraft((current) => ({ ...current, plant: event.target.value }))} placeholder="Plant" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                <input value={plantEditDraft.plantName} onChange={(event) => setPlantEditDraft((current) => ({ ...current, plantName: event.target.value }))} placeholder="Plant Name" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                <input value={plantEditDraft.plantName2} onChange={(event) => setPlantEditDraft((current) => ({ ...current, plantName2: event.target.value }))} placeholder="Plant Name 2" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
                <input value={plantEditDraft.address} onChange={(event) => setPlantEditDraft((current) => ({ ...current, address: event.target.value }))} placeholder="Address" className="h-11 rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => void savePlantEdit()} disabled={plantSubmitting} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">Save plant</button>
                <button onClick={() => setEditingPlantId(null)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="Project registry" subtitle="All created projects across the platform">
        {loadingProjects ? <div className="text-sm text-slate-500">Loading project registry...</div> : null}
        {!loadingProjects && projectError ? <div className="text-sm text-amber-700">{projectError}</div> : null}
        {!loadingProjects && !projectError ? (
          <>
            <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <ValueHelp label="Project" placeholder="All projects" emptyLabel="No matching projects." options={projectNameOptions} value={projectFilter} onChange={setProjectFilter} containerClassName="w-full" />
              <ValueHelp label="Plant" placeholder="All plants" emptyLabel="No matching plants." options={projectPlantOptions} value={projectPlantFilter} onChange={setProjectPlantFilter} containerClassName="w-full" />
              <ValueHelp label="Owner" placeholder="All owners" emptyLabel="No matching owners." options={projectOwnerOptions} value={projectOwnerFilter} onChange={setProjectOwnerFilter} containerClassName="w-full" />
              <ValueHelp label="Status" placeholder="All statuses" emptyLabel="No matching statuses." options={projectStatusOptions} value={projectStatusFilter} onChange={setProjectStatusFilter} containerClassName="w-full" />
              <ValueHelp label="Code" placeholder="All codes" emptyLabel="No matching codes." options={projectCodeOptions} value={projectCodeFilter} onChange={setProjectCodeFilter} containerClassName="w-full" />
              <div className="flex items-end gap-3">
                <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={projectSortOptions} value={projectSort} onChange={setProjectSort} containerClassName="w-full" clearLabel="Newest created first" clearDescription="Reset to the default sort order" />
                <button type="button" onClick={() => { setProjectFilter(""); setProjectPlantFilter(""); setProjectOwnerFilter(""); setProjectStatusFilter(""); setProjectCodeFilter(""); setProjectSort("created-desc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
              </div>
            </div>
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
                  {sortedProjects.map((project) => (
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
                  {!sortedProjects.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No projects matched the current filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Document registry" subtitle="Plant-wise document visibility with edit and delete controls">
        <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <ValueHelp label="Document" placeholder="All documents" emptyLabel="No matching documents." options={documentNameOptions} value={documentNameFilter} onChange={setDocumentNameFilter} containerClassName="w-full" />
          <ValueHelp label="Plant" placeholder="All plants" emptyLabel="No matching plants." options={documentPlantOptions} value={documentPlantFilter} onChange={setDocumentPlantFilter} containerClassName="w-full" />
          <ValueHelp label="Project" placeholder="All projects" emptyLabel="No matching projects." options={documentProjectOptions} value={documentProjectFilter} onChange={setDocumentProjectFilter} containerClassName="w-full" />
          <ValueHelp label="Uploader" placeholder="All uploaders" emptyLabel="No matching uploaders." options={documentUploaderOptions} value={documentUploaderFilter} onChange={setDocumentUploaderFilter} containerClassName="w-full" />
          <ValueHelp label="Category" placeholder="All categories" emptyLabel="No matching categories." options={documentCategoryOptions} value={documentCategoryFilter} onChange={setDocumentCategoryFilter} containerClassName="w-full" />
          <ValueHelp label="Status" placeholder="All statuses" emptyLabel="No matching statuses." options={documentStatusOptions} value={documentStatusFilter} onChange={setDocumentStatusFilter} containerClassName="w-full" />
          <div className="flex items-end gap-3">
            <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={documentSortOptions} value={documentSort} onChange={setDocumentSort} containerClassName="w-full" clearLabel="Latest uploaded first" clearDescription="Reset to the default sort order" />
            <button type="button" onClick={() => { setDocumentNameFilter(""); setDocumentPlantFilter(""); setDocumentProjectFilter(""); setDocumentUploaderFilter(""); setDocumentCategoryFilter(""); setDocumentStatusFilter(""); setDocumentSort("uploaded-desc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
          </div>
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
              {sortedDocuments.slice(0, 20).map((document) => (
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
              {!sortedDocuments.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No documents matched the current filters.</td>
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
  const [emailFilter, setEmailFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [managerSort, setManagerSort] = useState("name-asc");
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
    () => managers.map((candidate) => candidate.name).sort((a, b) => a.localeCompare(b)).map((candidate) => ({ value: candidate, label: candidate, meta: "Manager" })),
    [managers],
  );
  const managerPlantOptions = useMemo(
    () => plants.map((plant) => ({ value: plant.id, label: plant.name, meta: "Plant" })),
    [plants],
  );
  const emailOptions = useMemo(() => buildValueHelpOptions(managers.map((candidate) => candidate.email), "Email"), [managers]);
  const statusOptions = useMemo(() => buildValueHelpOptions(managers.map((candidate) => candidate.status), "Status"), [managers]);
  const scopeOptions = useMemo(
    () => [
      { value: "unassigned", label: "Unassigned", meta: "Plant scope" },
      { value: "single", label: "Single plant", meta: "Plant scope" },
      { value: "multi", label: "Multi plant", meta: "Plant scope" },
    ],
    [],
  );
  const managerSortOptions = useMemo(
    () => [
      { value: "name-asc", label: "Manager A-Z", meta: "Sort" },
      { value: "email-asc", label: "Email A-Z", meta: "Sort" },
      { value: "status-asc", label: "Status A-Z", meta: "Sort" },
      { value: "scope-desc", label: "Most plants first", meta: "Sort" },
    ],
    [],
  );

  const filtered = useMemo(
    () =>
      managers.filter((candidate) => {
        const assignedIds = candidate.assignedPlantIds || (candidate.plantId ? [candidate.plantId] : []);
        const scope = assignedIds.length > 1 ? "multi" : assignedIds.length === 1 ? "single" : "unassigned";
        const matchesManager = matchesValueHelpFilter(managerFilter, candidate.name);
        const matchesPlant = !plantFilter || assignedIds.includes(plantFilter);
        const matchesEmail = matchesValueHelpFilter(emailFilter, candidate.email);
        const matchesStatus = matchesValueHelpFilter(statusFilter, candidate.status);
        const matchesScope = matchesValueHelpFilter(scopeFilter, scope);
        return matchesManager && matchesPlant && matchesEmail && matchesStatus && matchesScope;
      }),
    [emailFilter, managerFilter, managers, plantFilter, scopeFilter, statusFilter],
  );
  const sortedManagers = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      const leftScope = left.assignedPlantIds?.length || (left.plantId ? 1 : 0);
      const rightScope = right.assignedPlantIds?.length || (right.plantId ? 1 : 0);
      switch (managerSort) {
        case "email-asc":
          return compareText(left.email, right.email) || compareText(left.name, right.name);
        case "status-asc":
          return compareText(left.status, right.status) || compareText(left.name, right.name);
        case "scope-desc":
          return compareNumber(rightScope, leftScope) || compareText(left.name, right.name);
        case "name-asc":
        default:
          return compareText(left.name, right.name);
      }
    });
    return next;
  }, [filtered, managerSort]);

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

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <ValueHelp
            label="Manager"
            placeholder="All managers"
            emptyLabel="No matching managers."
            options={managerOptions}
            value={managerFilter}
            onChange={setManagerFilter}
            containerClassName="w-full"
            triggerClassName="h-12"
          />
          <ValueHelp
            label="Plant"
            placeholder="All plants"
            emptyLabel="No matching plants."
            options={managerPlantOptions}
            value={plantFilter}
            onChange={setPlantFilter}
            containerClassName="w-full"
            triggerClassName="h-12"
          />
          <ValueHelp
            label="Email"
            placeholder="All emails"
            emptyLabel="No matching emails."
            options={emailOptions}
            value={emailFilter}
            onChange={setEmailFilter}
            containerClassName="w-full"
            triggerClassName="h-12"
          />
          <ValueHelp
            label="Status"
            placeholder="All statuses"
            emptyLabel="No matching statuses."
            options={statusOptions}
            value={statusFilter}
            onChange={setStatusFilter}
            containerClassName="w-full"
            triggerClassName="h-12"
          />
          <div className="flex items-end gap-3">
            <ValueHelp
              label="Scope"
              placeholder="All scopes"
              emptyLabel="No matching scopes."
              options={scopeOptions}
              value={scopeFilter}
              onChange={setScopeFilter}
              containerClassName="w-full"
              triggerClassName="h-12"
            />
          </div>
          <div className="flex items-end gap-3">
            <ValueHelp
              label="Sort By"
              placeholder="Default sort"
              emptyLabel="No sorting options."
              options={managerSortOptions}
              value={managerSort}
              onChange={setManagerSort}
              containerClassName="w-full"
              triggerClassName="h-12"
              clearLabel="Manager A-Z"
              clearDescription="Reset to the default sort order"
            />
            <button
              type="button"
              onClick={() => {
                setManagerFilter("");
                setPlantFilter("");
                setEmailFilter("");
                setStatusFilter("");
                setScopeFilter("");
                setManagerSort("name-asc");
              }}
              className="h-12 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
        {message ? <div className="mt-4 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-2 text-sm text-[#BB0000]">{error}</div> : null}

        <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Plants</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {sortedManagers.map((candidate) => (
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
                  <td className="px-4 py-4 text-slate-600">{candidate.status}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {(candidate.assignedPlantIds?.length || (candidate.plantId ? 1 : 0)) > 1
                      ? "Multi plant"
                      : (candidate.assignedPlantIds?.length || (candidate.plantId ? 1 : 0)) === 1
                        ? "Single plant"
                        : "Unassigned"}
                  </td>
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
              {!sortedManagers.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No managers matched the current search.</td>
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
  const navigate = useNavigate();
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
                    <td className="px-4 py-4">
                      <button
                        onClick={() => navigate(`/documents/${document.id}`)}
                        className="font-medium text-slate-900 transition hover:text-[#0A6ED1]"
                      >
                        {document.name}
                      </button>
                    </td>
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
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleStatusFilter, setRuleStatusFilter] = useState("");
  const [personaFilter, setPersonaFilter] = useState("");
  const [personaRoleFilter, setPersonaRoleFilter] = useState("");
  const [personaIpFilter, setPersonaIpFilter] = useState("");
  const [watchIpFilter, setWatchIpFilter] = useState("");
  const [watchRoleFilter, setWatchRoleFilter] = useState("");
  const [ruleSort, setRuleSort] = useState("updated-desc");
  const [personaSort, setPersonaSort] = useState("last-seen-desc");
  const [watchSort, setWatchSort] = useState("logins-desc");
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
  const ruleSearchOptions = useMemo(
    () => {
      const registry = new Map<string, ValueHelpOption>();
      rules.forEach((rule) => {
        registry.set(`label:${rule.label}`, { value: rule.label, label: rule.label, meta: "Rule label" });
        registry.set(`address:${rule.address}`, { value: rule.address, label: rule.address, meta: "Address" });
      });
      return Array.from(registry.values()).sort((a, b) => a.label.localeCompare(b.label) || (a.meta || "").localeCompare(b.meta || ""));
    },
    [rules],
  );
  const ruleStatusOptions = useMemo(() => buildValueHelpOptions(rules.map((rule) => rule.status), "Rule status"), [rules]);
  const ruleSortOptions = useMemo(
    () => [
      { value: "updated-desc", label: "Latest updated first", meta: "Sort" },
      { value: "label-asc", label: "Label A-Z", meta: "Sort" },
      { value: "status-asc", label: "Status A-Z", meta: "Sort" },
      { value: "address-asc", label: "Address A-Z", meta: "Sort" },
    ],
    [],
  );
  const filteredRules = useMemo(
    () =>
      rules.filter((rule) => {
        const matchesSearch = !ruleSearch || [rule.label, rule.address].some((value) => normalizeSearchValue(value).includes(normalizeSearchValue(ruleSearch)));
        return matchesSearch && matchesValueHelpFilter(ruleStatusFilter, rule.status);
      }),
    [ruleSearch, ruleStatusFilter, rules],
  );
  const sortedRules = useMemo(() => {
    const next = [...filteredRules];
    next.sort((left, right) => {
      switch (ruleSort) {
        case "label-asc":
          return compareText(left.label, right.label);
        case "status-asc":
          return compareText(left.status, right.status) || compareText(left.label, right.label);
        case "address-asc":
          return compareText(left.address, right.address) || compareText(left.label, right.label);
        case "updated-desc":
        default:
          return compareDateValue(right.lastUpdated, left.lastUpdated) || compareText(left.label, right.label);
      }
    });
    return next;
  }, [filteredRules, ruleSort]);
  const personaOptions = useMemo(() => buildValueHelpOptions(personaSummaries.map((persona) => persona.name), "Persona"), [personaSummaries]);
  const personaRoleOptions = useMemo(() => buildValueHelpOptions(personaSummaries.map((persona) => persona.role), "Role"), [personaSummaries]);
  const personaIpOptions = useMemo(
    () => buildValueHelpOptions(personaSummaries.flatMap((persona) => Array.from(persona.ips)), "IP"),
    [personaSummaries],
  );
  const personaSortOptions = useMemo(
    () => [
      { value: "last-seen-desc", label: "Last seen latest", meta: "Sort" },
      { value: "name-asc", label: "Persona A-Z", meta: "Sort" },
      { value: "role-asc", label: "Role A-Z", meta: "Sort" },
      { value: "logins-desc", label: "Most logins first", meta: "Sort" },
      { value: "ip-footprint-desc", label: "Most IPs first", meta: "Sort" },
    ],
    [],
  );
  const filteredPersonas = useMemo(
    () =>
      personaSummaries.filter((persona) => (
        matchesValueHelpFilter(personaFilter, persona.name) &&
        matchesValueHelpFilter(personaRoleFilter, persona.role) &&
        (!personaIpFilter || persona.events.some((event) => loginIp(event) === personaIpFilter))
      )),
    [personaFilter, personaIpFilter, personaRoleFilter, personaSummaries],
  );
  const sortedPersonas = useMemo(() => {
    const next = [...filteredPersonas];
    next.sort((left, right) => {
      switch (personaSort) {
        case "name-asc":
          return compareText(left.name, right.name);
        case "role-asc":
          return compareText(left.role, right.role) || compareText(left.name, right.name);
        case "logins-desc":
          return compareNumber(right.total, left.total) || compareText(left.name, right.name);
        case "ip-footprint-desc":
          return compareNumber(right.ips.size, left.ips.size) || compareText(left.name, right.name);
        case "last-seen-desc":
        default:
          return compareDateValue(right.lastSeen, left.lastSeen) || compareText(left.name, right.name);
      }
    });
    return next;
  }, [filteredPersonas, personaSort]);
  const watchIpOptions = useMemo(() => buildValueHelpOptions(ipSummaries.map((entry) => entry.ip), "IP"), [ipSummaries]);
  const watchRoleOptions = useMemo(
    () => buildValueHelpOptions(ipSummaries.flatMap((entry) => Array.from(entry.roles)), "Role"),
    [ipSummaries],
  );
  const watchSortOptions = useMemo(
    () => [
      { value: "logins-desc", label: "Most logins first", meta: "Sort" },
      { value: "ip-asc", label: "IP A-Z", meta: "Sort" },
      { value: "last-seen-desc", label: "Last seen latest", meta: "Sort" },
      { value: "personas-desc", label: "Most personas first", meta: "Sort" },
    ],
    [],
  );
  const filteredIpSummaries = useMemo(
    () =>
      ipSummaries.filter((entry) => (
        matchesValueHelpFilter(watchIpFilter, entry.ip) &&
        (!watchRoleFilter || entry.roles.has(watchRoleFilter))
      )),
    [ipSummaries, watchIpFilter, watchRoleFilter],
  );
  const sortedIpSummaries = useMemo(() => {
    const next = [...filteredIpSummaries];
    next.sort((left, right) => {
      switch (watchSort) {
        case "ip-asc":
          return compareText(left.ip, right.ip);
        case "last-seen-desc":
          return compareDateValue(right.lastSeen, left.lastSeen) || compareText(left.ip, right.ip);
        case "personas-desc":
          return compareNumber(right.personas.size, left.personas.size) || compareText(left.ip, right.ip);
        case "logins-desc":
        default:
          return compareNumber(right.total, left.total) || compareText(left.ip, right.ip);
      }
    });
    return next;
  }, [filteredIpSummaries, watchSort]);

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
        <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ValueHelp
            label="Rule Search"
            placeholder="Label or address"
            emptyLabel="No matching rules."
            options={ruleSearchOptions}
            value={ruleSearch}
            onChange={setRuleSearch}
            containerClassName="w-full"
          />
          <ValueHelp
            label="Rule Status"
            placeholder="All statuses"
            emptyLabel="No matching statuses."
            options={ruleStatusOptions}
            value={ruleStatusFilter}
            onChange={setRuleStatusFilter}
            containerClassName="w-full"
          />
          <div className="flex items-end">
            <ValueHelp
              label="Sort By"
              placeholder="Default sort"
              emptyLabel="No sorting options."
              options={ruleSortOptions}
              value={ruleSort}
              onChange={setRuleSort}
              containerClassName="w-full"
              clearLabel="Latest updated first"
              clearDescription="Reset to the default sort order"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setRuleSearch("");
                setRuleStatusFilter("");
                setRuleSort("updated-desc");
              }}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Clear rule filters
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-[28px] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-sm text-slate-500">
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last updated</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {sortedRules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-4 font-medium text-slate-900">{rule.label}</td>
                  <td className="px-4 py-4 font-mono text-slate-600">{rule.address}</td>
                  <td className="px-4 py-4 text-slate-600">{rule.status}</td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(rule.lastUpdated)}</td>
                  <td className="px-4 py-4">
                    <select value={rule.status} onChange={(event) => updateRule(rule.id, event.target.value as IpRule["status"])} className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-teal-500">
                      <option value="Allowed">Allowed</option>
                      <option value="Blocked">Blocked</option>
                      <option value="Review">Review</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!sortedRules.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No IP rules matched the current filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Security operations overview" subtitle="At-a-glance posture across configured rules and observed sign-ins">
          {loading ? <div className="text-sm text-slate-500">Loading network telemetry...</div> : null}
          {!loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <MetricCard label="Allowed rules" value={allowedCount} hint="Ingress sources explicitly permitted by policy." icon={ShieldCheck} />
              <MetricCard label="Blocked rules" value={blockedCount} hint="Known endpoints currently denied from platform access." icon={Lock} tone="rose" />
              <MetricCard label="Review queue" value={reviewCount} hint="Addresses awaiting analyst disposition or follow-up." icon={TriangleAlert} tone="amber" />
              <MetricCard label="Latest sign-in time" value={latestLogin ? formatDate(latestLogin.createdAt) : "-"} hint={latestLogin ? formatDateTime(latestLogin.createdAt) : "No login telemetry is available yet."} icon={Clock3} tone="blue" />
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Network posture summary" subtitle="Quick read on rule mix, identity coverage, and active ingress">
          <div className="grid gap-3">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Configured rule mix</div>
              <div className="mt-2 text-sm text-slate-700">{allowedCount} allowed, {reviewCount} in review, {blockedCount} blocked.</div>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Observed identity spread</div>
              <div className="mt-2 text-sm text-slate-700">{personaSummaries.length} personas across {uniqueIpCount} ingress points.</div>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Latest ingress</div>
              <div className="mt-2 text-sm text-slate-700">{latestLogin ? `${latestLogin.userName || "Unknown user"} from ${loginIp(latestLogin)} at ${formatDateTime(latestLogin.createdAt)}` : "No login telemetry is available yet."}</div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Persona login matrix" subtitle="Every persona with login count, IP spread, and latest observed sign-in">
        {loading ? <div className="text-sm text-slate-500">Collecting persona login activity...</div> : null}
        {!loading && activityError ? <div className="text-sm text-[#BB0000]">{activityError}</div> : null}
        {!loading && !activityError && personaSummaries.length === 0 ? <div className="text-sm text-slate-500">No successful login events have been recorded yet.</div> : null}
        {!loading && !activityError ? (
          <>
            <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <ValueHelp label="Persona" placeholder="All personas" emptyLabel="No matching personas." options={personaOptions} value={personaFilter} onChange={setPersonaFilter} containerClassName="w-full" />
              <ValueHelp label="Role" placeholder="All roles" emptyLabel="No matching roles." options={personaRoleOptions} value={personaRoleFilter} onChange={setPersonaRoleFilter} containerClassName="w-full" />
              <ValueHelp label="IP" placeholder="All IPs" emptyLabel="No matching IPs." options={personaIpOptions} value={personaIpFilter} onChange={setPersonaIpFilter} containerClassName="w-full" />
              <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={personaSortOptions} value={personaSort} onChange={setPersonaSort} containerClassName="w-full" clearLabel="Last seen latest" clearDescription="Reset to the default sort order" />
              <div className="flex items-end">
                <button type="button" onClick={() => { setPersonaFilter(""); setPersonaRoleFilter(""); setPersonaIpFilter(""); setPersonaSort("last-seen-desc"); }} className="h-11 w-full min-w-[124px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
              </div>
            </div>
            <div className="overflow-hidden rounded-[28px] border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-sm text-slate-500">
                    <th className="px-4 py-3 font-medium">Persona</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Logins</th>
                    <th className="px-4 py-3 font-medium">IP footprint</th>
                    <th className="px-4 py-3 font-medium">Latest IP</th>
                    <th className="px-4 py-3 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm">
                  {sortedPersonas.map((persona) => (
                    <tr key={persona.id}>
                      <td className="px-4 py-4 font-medium text-slate-900">{persona.name}</td>
                      <td className="px-4 py-4 text-slate-600">{persona.role}</td>
                      <td className="px-4 py-4 text-slate-600">{persona.email || "-"}</td>
                      <td className="px-4 py-4 text-slate-600">{persona.total}</td>
                      <td className="px-4 py-4 text-slate-600">{Array.from(persona.ips).join(", ")}</td>
                      <td className="px-4 py-4 font-mono text-slate-600">{loginIp(persona.events[0])}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDateTime(persona.lastSeen)}</td>
                    </tr>
                  ))}
                  {!sortedPersonas.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No personas matched the current filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Ingress watchlist" subtitle="IP-centric view of who is entering the platform and how often">
          {loading ? <div className="text-sm text-slate-500">Collecting persona login activity...</div> : null}
        {!loading && activityError ? <div className="text-sm text-[#BB0000]">{activityError}</div> : null}
        {!loading && !activityError && ipSummaries.length === 0 ? <div className="text-sm text-slate-500">No IP activity is available yet.</div> : null}
        {!loading && !activityError ? (
          <>
            <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <ValueHelp label="IP" placeholder="All IPs" emptyLabel="No matching IPs." options={watchIpOptions} value={watchIpFilter} onChange={setWatchIpFilter} containerClassName="w-full" />
              <ValueHelp label="Role" placeholder="All roles" emptyLabel="No matching roles." options={watchRoleOptions} value={watchRoleFilter} onChange={setWatchRoleFilter} containerClassName="w-full" />
              <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={watchSortOptions} value={watchSort} onChange={setWatchSort} containerClassName="w-full" clearLabel="Most logins first" clearDescription="Reset to the default sort order" />
              <div className="flex items-end">
                <button type="button" onClick={() => { setWatchIpFilter(""); setWatchRoleFilter(""); setWatchSort("logins-desc"); }} className="h-11 w-full min-w-[124px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
              </div>
            </div>
            <div className="overflow-hidden rounded-[28px] border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-sm text-slate-500">
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">Logins</th>
                    <th className="px-4 py-3 font-medium">Personas</th>
                    <th className="px-4 py-3 font-medium">Roles</th>
                    <th className="px-4 py-3 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm">
                  {sortedIpSummaries.map((entry) => (
                    <tr key={entry.ip}>
                      <td className="px-4 py-4 font-mono text-slate-900">{entry.ip}</td>
                      <td className="px-4 py-4 text-slate-600">{entry.total}</td>
                      <td className="px-4 py-4 text-slate-600">{Array.from(entry.personas).join(", ")}</td>
                      <td className="px-4 py-4 text-slate-600">{Array.from(entry.roles).join(", ")}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDateTime(entry.lastSeen)}</td>
                    </tr>
                  ))}
                  {!sortedIpSummaries.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No IP entries matched the current filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </SectionCard>
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
  const [sessionUserFilter, setSessionUserFilter] = useState("");
  const [sessionRoleFilter, setSessionRoleFilter] = useState("");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("");
  const [sessionIpFilter, setSessionIpFilter] = useState("");
  const [outsideUserFilter, setOutsideUserFilter] = useState("");
  const [outsideIpFilter, setOutsideIpFilter] = useState("");
  const [blockedUserFilter, setBlockedUserFilter] = useState("");
  const [blockedIpFilter, setBlockedIpFilter] = useState("");
  const [sessionSort, setSessionSort] = useState("started-desc");
  const [outsideSessionSort, setOutsideSessionSort] = useState("started-desc");
  const [blockedAttemptSort, setBlockedAttemptSort] = useState("attempted-desc");

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
  const sessionUserOptions = useMemo(() => buildValueHelpOptions(sessions.map((session) => session.userName), "User"), [sessions]);
  const sessionRoleOptions = useMemo(() => buildValueHelpOptions(sessions.map((session) => session.userRole), "Role"), [sessions]);
  const sessionStatusOptions = useMemo(() => buildValueHelpOptions(sessions.map((session) => session.status), "Status"), [sessions]);
  const sessionIpOptions = useMemo(() => buildValueHelpOptions(sessions.map((session) => session.clientIp), "IP"), [sessions]);
  const sessionSortOptions = useMemo(
    () => [
      { value: "started-desc", label: "Latest started first", meta: "Sort" },
      { value: "user-asc", label: "User A-Z", meta: "Sort" },
      { value: "role-asc", label: "Role A-Z", meta: "Sort" },
      { value: "duration-desc", label: "Longest duration first", meta: "Sort" },
      { value: "idle-desc", label: "Highest idle first", meta: "Sort" },
    ],
    [],
  );
  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => (
        matchesValueHelpFilter(sessionUserFilter, session.userName || undefined) &&
        matchesValueHelpFilter(sessionRoleFilter, session.userRole || undefined) &&
        matchesValueHelpFilter(sessionStatusFilter, session.status) &&
        matchesValueHelpFilter(sessionIpFilter, session.clientIp)
      )),
    [sessionIpFilter, sessionRoleFilter, sessionStatusFilter, sessionUserFilter, sessions],
  );
  const sortedSessions = useMemo(() => {
    const next = [...filteredSessions];
    next.sort((left, right) => {
      switch (sessionSort) {
        case "user-asc":
          return compareText(left.userName, right.userName);
        case "role-asc":
          return compareText(left.userRole, right.userRole) || compareText(left.userName, right.userName);
        case "duration-desc":
          return compareNumber(right.durationSeconds, left.durationSeconds) || compareText(left.userName, right.userName);
        case "idle-desc":
          return compareNumber(right.idleSeconds, left.idleSeconds) || compareText(left.userName, right.userName);
        case "started-desc":
        default:
          return compareDateValue(right.startedAt, left.startedAt) || compareText(left.userName, right.userName);
      }
    });
    return next;
  }, [filteredSessions, sessionSort]);
  const outsideUserOptions = useMemo(() => buildValueHelpOptions(outsideHoursSessions.map((session) => session.userName), "User"), [outsideHoursSessions]);
  const outsideIpOptions = useMemo(() => buildValueHelpOptions(outsideHoursSessions.map((session) => session.clientIp), "IP"), [outsideHoursSessions]);
  const outsideSessionSortOptions = useMemo(
    () => [
      { value: "started-desc", label: "Latest started first", meta: "Sort" },
      { value: "user-asc", label: "User A-Z", meta: "Sort" },
      { value: "duration-desc", label: "Longest duration first", meta: "Sort" },
    ],
    [],
  );
  const filteredOutsideSessions = useMemo(
    () =>
      outsideHoursSessions.filter((session) => (
        matchesValueHelpFilter(outsideUserFilter, session.userName || undefined) &&
        matchesValueHelpFilter(outsideIpFilter, session.clientIp)
      )),
    [outsideHoursSessions, outsideIpFilter, outsideUserFilter],
  );
  const sortedOutsideSessions = useMemo(() => {
    const next = [...filteredOutsideSessions];
    next.sort((left, right) => {
      switch (outsideSessionSort) {
        case "user-asc":
          return compareText(left.userName, right.userName);
        case "duration-desc":
          return compareNumber(right.durationSeconds, left.durationSeconds) || compareText(left.userName, right.userName);
        case "started-desc":
        default:
          return compareDateValue(right.startedAt, left.startedAt) || compareText(left.userName, right.userName);
      }
    });
    return next;
  }, [filteredOutsideSessions, outsideSessionSort]);
  const blockedUserOptions = useMemo(() => buildValueHelpOptions(outsideHoursAttempts.map((attempt) => attempt.userName), "User"), [outsideHoursAttempts]);
  const blockedIpOptions = useMemo(() => buildValueHelpOptions(outsideHoursAttempts.map((attempt) => attempt.clientIp), "IP"), [outsideHoursAttempts]);
  const blockedAttemptSortOptions = useMemo(
    () => [
      { value: "attempted-desc", label: "Latest attempted first", meta: "Sort" },
      { value: "user-asc", label: "User A-Z", meta: "Sort" },
      { value: "ip-asc", label: "IP A-Z", meta: "Sort" },
    ],
    [],
  );
  const filteredBlockedAttempts = useMemo(
    () =>
      outsideHoursAttempts.filter((attempt) => (
        matchesValueHelpFilter(blockedUserFilter, attempt.userName || undefined) &&
        matchesValueHelpFilter(blockedIpFilter, attempt.clientIp)
      )),
    [blockedIpFilter, blockedUserFilter, outsideHoursAttempts],
  );
  const sortedBlockedAttempts = useMemo(() => {
    const next = [...filteredBlockedAttempts];
    next.sort((left, right) => {
      switch (blockedAttemptSort) {
        case "user-asc":
          return compareText(left.userName, right.userName);
        case "ip-asc":
          return compareText(left.clientIp, right.clientIp);
        case "attempted-desc":
        default:
          return compareDateValue(right.occurredAt, left.occurredAt) || compareText(left.userName, right.userName);
      }
    });
    return next;
  }, [blockedAttemptSort, filteredBlockedAttempts]);

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
                    <div className="grid gap-4 md:grid-cols-3">
                      <ValueHelp label="User" placeholder="All users" emptyLabel="No matching users." options={outsideUserOptions} value={outsideUserFilter} onChange={setOutsideUserFilter} containerClassName="w-full" />
                      <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={outsideSessionSortOptions} value={outsideSessionSort} onChange={setOutsideSessionSort} containerClassName="w-full" clearLabel="Latest started first" clearDescription="Reset to the default sort order" />
                      <div className="flex items-end gap-3">
                        <ValueHelp label="IP" placeholder="All IPs" emptyLabel="No matching IPs." options={outsideIpOptions} value={outsideIpFilter} onChange={setOutsideIpFilter} containerClassName="w-full" />
                        <button type="button" onClick={() => { setOutsideUserFilter(""); setOutsideIpFilter(""); setOutsideSessionSort("started-desc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-amber-200">
                      <table className="min-w-full divide-y divide-amber-100">
                        <thead className="bg-amber-50">
                          <tr className="text-left text-sm text-slate-500">
                            <th className="px-4 py-3 font-medium">User</th>
                            <th className="px-4 py-3 font-medium">Role</th>
                            <th className="px-4 py-3 font-medium">IP</th>
                            <th className="px-4 py-3 font-medium">Started</th>
                            <th className="px-4 py-3 font-medium">Duration</th>
                            <th className="px-4 py-3 font-medium">Device</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 bg-white text-sm">
                          {sortedOutsideSessions.map((session) => (
                            <tr key={`outside-session-${session.sessionId}`}>
                              <td className="px-4 py-4 font-medium text-slate-900">{session.userName || "Unknown user"}</td>
                              <td className="px-4 py-4 text-slate-600">{session.userRole || "Unknown role"}</td>
                              <td className="px-4 py-4 font-mono text-slate-600">{session.clientIp}</td>
                              <td className="px-4 py-4 text-slate-600">{formatDateTime(session.startedAt)}</td>
                              <td className="px-4 py-4 text-slate-600">{formatDuration(session.durationSeconds)}</td>
                              <td className="px-4 py-4 text-slate-600">{session.device || "Unknown device"} • {session.browser || "Unknown browser"}</td>
                            </tr>
                          ))}
                          {!sortedOutsideSessions.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No outside-hours sessions matched the current filters.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="text-base font-semibold text-slate-900">Blocked outside-hours login attempts</div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <ValueHelp label="User" placeholder="All users" emptyLabel="No matching users." options={blockedUserOptions} value={blockedUserFilter} onChange={setBlockedUserFilter} containerClassName="w-full" />
                      <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={blockedAttemptSortOptions} value={blockedAttemptSort} onChange={setBlockedAttemptSort} containerClassName="w-full" clearLabel="Latest attempted first" clearDescription="Reset to the default sort order" />
                      <div className="flex items-end gap-3">
                        <ValueHelp label="IP" placeholder="All IPs" emptyLabel="No matching IPs." options={blockedIpOptions} value={blockedIpFilter} onChange={setBlockedIpFilter} containerClassName="w-full" />
                        <button type="button" onClick={() => { setBlockedUserFilter(""); setBlockedIpFilter(""); setBlockedAttemptSort("attempted-desc"); }} className="h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear</button>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-rose-200">
                      <table className="min-w-full divide-y divide-rose-100">
                        <thead className="bg-rose-50">
                          <tr className="text-left text-sm text-slate-500">
                            <th className="px-4 py-3 font-medium">User</th>
                            <th className="px-4 py-3 font-medium">Role</th>
                            <th className="px-4 py-3 font-medium">IP</th>
                            <th className="px-4 py-3 font-medium">Attempted</th>
                            <th className="px-4 py-3 font-medium">Device</th>
                            <th className="px-4 py-3 font-medium">Browser</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-100 bg-white text-sm">
                          {sortedBlockedAttempts.map((attempt) => (
                            <tr key={`outside-attempt-${attempt.id}`}>
                              <td className="px-4 py-4 font-medium text-slate-900">{attempt.userName || "Unknown user"}</td>
                              <td className="px-4 py-4 text-slate-600">{attempt.userRole || "Unknown role"}</td>
                              <td className="px-4 py-4 font-mono text-slate-600">{attempt.clientIp}</td>
                              <td className="px-4 py-4 text-slate-600">{formatDateTime(attempt.occurredAt)}</td>
                              <td className="px-4 py-4 text-slate-600">{attempt.device || "Unknown device"}</td>
                              <td className="px-4 py-4 text-slate-600">{attempt.browser || "Unknown browser"}</td>
                            </tr>
                          ))}
                          {!sortedBlockedAttempts.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No blocked attempts matched the current filters.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
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

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <ValueHelp label="User" placeholder="All users" emptyLabel="No matching users." options={sessionUserOptions} value={sessionUserFilter} onChange={setSessionUserFilter} containerClassName="w-full" />
              <ValueHelp label="Role" placeholder="All roles" emptyLabel="No matching roles." options={sessionRoleOptions} value={sessionRoleFilter} onChange={setSessionRoleFilter} containerClassName="w-full" />
              <ValueHelp label="Status" placeholder="All statuses" emptyLabel="No matching statuses." options={sessionStatusOptions} value={sessionStatusFilter} onChange={setSessionStatusFilter} containerClassName="w-full" />
              <ValueHelp label="IP" placeholder="All IPs" emptyLabel="No matching IPs." options={sessionIpOptions} value={sessionIpFilter} onChange={setSessionIpFilter} containerClassName="w-full" />
              <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={sessionSortOptions} value={sessionSort} onChange={setSessionSort} containerClassName="w-full" clearLabel="Latest started first" clearDescription="Reset to the default sort order" />
              <div className="flex items-end">
                <button type="button" onClick={() => { setSessionUserFilter(""); setSessionRoleFilter(""); setSessionStatusFilter(""); setSessionIpFilter(""); setSessionSort("started-desc"); }} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Clear session filters</button>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-sm text-slate-500">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Last seen</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Idle</th>
                    <th className="px-4 py-3 font-medium">Device</th>
                    <th className="px-4 py-3 font-medium">Session ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm">
                  {sortedSessions.map((session) => (
                    <tr key={session.sessionId}>
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">{session.userName || "Unknown user"}</div>
                        <div className="mt-1 text-xs text-slate-500">{session.userEmail || "-"}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{session.userRole || "Unknown role"}</td>
                      <td className="px-4 py-4 text-slate-600">{session.status}</td>
                      <td className="px-4 py-4 font-mono text-slate-600">{session.clientIp}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDateTime(session.startedAt)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDateTime(session.lastSeenAt)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDuration(session.durationSeconds)}</td>
                      <td className="px-4 py-4 text-slate-600">{session.status === "Active" ? formatDuration(session.idleSeconds) : "-"}</td>
                      <td className="px-4 py-4 text-slate-600">{session.device || "Unknown device"} • {session.browser || "Unknown browser"}</td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-500">{session.sessionId}</td>
                    </tr>
                  ))}
                  {!sortedSessions.length ? <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No session records matched the current filters.</td></tr> : null}
                </tbody>
              </table>
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
        <div className="mt-4 grid gap-3 text-sm text-white/78 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
            <div className="text-white/55">Events</div>
            <div className="mt-1 font-semibold text-white">{activities.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
            <div className="text-white/55">User</div>
            <div className="mt-1 font-semibold text-white">{formatRole(user.role)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
            <div className="text-white/55">Status</div>
            <div className="mt-1 font-semibold text-white">{loading ? "Loading" : error ? "Error" : "Ready"}</div>
          </div>
        </div>
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
          { path: "plants", element: <RoleGate allowed={["CEO", "Mining Manager", "Admin"]}><PlantIndexPage /></RoleGate> },
          { path: "plants/:plantId", element: <RoleGate allowed={["CEO", "Mining Manager", "Admin"]}><PlantProjectsPage /></RoleGate> },
          { path: "plants/:plantId/projects/new", element: <RoleGate allowed={["Mining Manager"]} capability="canCreateProjects"><ProjectCreatePage /></RoleGate> },
          { path: "plants/:plantId/projects/:projectId/documents", element: <RoleGate allowed={["CEO", "Mining Manager", "Admin"]}><ProjectDocumentsPage /></RoleGate> },
          { path: "documents", element: <RoleGate allowed={["CEO", "Mining Manager", "Admin"]}><DocumentsPage /></RoleGate> },
          { path: "documents/:documentId", element: <RoleGate allowed={["CEO", "Mining Manager", "Admin"]}><DocumentDetailPage /></RoleGate> },
          { path: "analytics", element: <RoleGate allowed={["CEO"]}><AnalyticsPage /></RoleGate> },
          { path: "oversight", element: <RoleGate allowed={["CEO", "Admin"]} capability="canManageUsers"><ManagerOversightPage /></RoleGate> },
          { path: "oversight/:userId", element: <RoleGate allowed={["CEO", "Admin"]} capability="canManageUsers"><ManagerDetailPage /></RoleGate> },
          { path: "activity-logs", element: <RoleGate allowed={["CEO"]}><ActivityLogsPage /></RoleGate> },
          { path: "upload", element: <RoleGate allowed={["Mining Manager"]} capability="canUploadDocuments"><ManagerUpload /></RoleGate> },
          { path: "admin", element: <RoleGate allowed={["Admin"]}><AdminDashboardPage /></RoleGate> },
          { path: "admin/users", element: <RoleGate allowed={["Admin", "CEO"]} capability="canManageUsers"><ManagerOversightPage /></RoleGate> },
          { path: "admin/users/:userId", element: <RoleGate allowed={["Admin", "CEO"]} capability="canManageUsers"><ManagerDetailPage /></RoleGate> },
          { path: "admin/master-data", element: <RoleGate allowed={["Admin", "CEO"]} capability="canManageUsers"><AdminMasterDataPage /></RoleGate> },
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
