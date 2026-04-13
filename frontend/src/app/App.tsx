import { useEffect, useMemo, useState } from "react";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard, FileText, Building2, BarChart2, Settings,
  Upload, FolderOpen, Clock, Users,
  ChevronLeft, ChevronRight, Bell, LogOut, ChevronDown,
} from "lucide-react";
import { LoginPage } from "./components/login-page";
import { CeoDashboard } from "./components/ceo-dashboard";
import { CeoDocuments } from "./components/ceo-documents";
import { CeoPlants } from "./components/ceo-plants";
import { CeoAnalytics } from "./components/ceo-analytics";
import { CeoActivity } from "./components/ceo-activity";
import { ManagerDashboard } from "./components/manager-dashboard";
import { ManagerDocuments } from "./components/manager-documents";
import { AdminPanel } from "./components/admin-panel";
import { SettingsPage } from "./components/settings-page";
import { AuthProvider, useAuth } from "./lib/auth";
import { notificationsApi } from "./lib/api";
import type { NotificationItem, User } from "./lib/types";

type NavGroup = {
  label?: string;
  items: { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; path: string }[];
};

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const role = user.role;

  const ceoNav: NavGroup[] = [
    {
      label: "Main",
      items: [
        { label: "Overview", icon: LayoutDashboard, path: "/dashboard" },
        { label: "Documents", icon: FileText, path: "/documents" },
        { label: "Plants", icon: Building2, path: "/plants" },
        { label: "Analytics", icon: BarChart2, path: "/analytics" },
        { label: "Activity Logs", icon: Clock, path: "/activity" },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Settings", icon: Settings, path: "/settings" },
      ],
    },
  ];

  const managerNav: NavGroup[] = [
    {
      label: "Documents",
      items: [
        { label: "Upload Document", icon: Upload, path: "/manager" },
        { label: "My Documents", icon: FolderOpen, path: "/manager/docs" },
        { label: "All Documents", icon: FileText, path: "/manager/all" },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Settings", icon: Settings, path: "/manager/settings" },
      ],
    },
  ];

  const adminNav: NavGroup[] = [
    {
      label: "Administration",
      items: [
        { label: "User Management", icon: Users, path: "/admin" },
        { label: "Settings", icon: Settings, path: "/admin/settings" },
      ],
    },
  ];

  const navGroups =
    role === "CEO" ? ceoNav : role === "Mining Manager" ? managerNav : adminNav;

  const settingsPath =
    role === "CEO" ? "/settings" : role === "Mining Manager" ? "/manager/settings" : "/admin/settings";

  const userName = user.name;
  const initials = user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const plant = user.plant || (role === "CEO" ? "All Plants" : "System");

  useEffect(() => {
    let active = true;
    async function loadNotifications() {
      try {
        const result = await notificationsApi.list();
        if (!active) return;
        setLiveNotifications(result.items);
        setUnreadNotifications(result.unreadCount);
      } catch {
        if (!active) return;
        setLiveNotifications([]);
        setUnreadNotifications(0);
      }
    }

    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [role]);
  const visibleNotifications = liveNotifications;
  const notificationBadgeCount = unreadNotifications;

  return (
    <div className="h-screen flex flex-col" style={{ background: "#f2f4f7" }}>
      {/* Header */}
      <header className="h-12 bg-[#354A5F] flex items-center justify-between px-5 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 bg-[#0A6ED1] flex items-center justify-center text-white shrink-0"
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}
          >
            MW
          </div>
          <div className="hidden sm:block">
            <div className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>
              Midwest Ltd
            </div>
            <div className="text-white/50" style={{ fontSize: 10 }}>
              Plant-Wise Document Intelligence
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="relative">
            <button
              onClick={() => {
                setNotificationsOpen(!notificationsOpen);
                setProfileOpen(false);
              }}
              className="relative text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              <Bell size={17} />
              {notificationBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-[#E9730C] rounded-full border border-[#354A5F] text-[10px] leading-[14px] text-white text-center">
                  {notificationBadgeCount}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-10 w-80 bg-white border border-[#d9d9d9] shadow-lg z-50">
                <div className="px-4 py-3 border-b border-[#f0f0f0] flex items-center justify-between">
                  <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 600 }}>
                    Notifications
                  </div>
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate(`${settingsPath}?tab=notifications`);
                    }}
                    className="text-[#0A6ED1] cursor-pointer"
                    style={{ fontSize: 12 }}
                  >
                    Manage
                  </button>
                </div>
                {visibleNotifications.length > 0 ? (
                  <div className="py-1">
                    {visibleNotifications.map((notification) => (
                      <button
                        key={notification.id}
                        onClick={async () => {
                          if (role === "Mining Manager" && !notification.read) {
                            try {
                              await notificationsApi.markRead(notification.id);
                              setLiveNotifications((prev) =>
                                prev.map((item) => item.id === notification.id ? { ...item, read: true } : item),
                              );
                              setUnreadNotifications((prev) => Math.max(0, prev - 1));
                            } catch {
                              // Keep navigation responsive even if marking read fails.
                            }
                          }
                          setNotificationsOpen(false);
                          navigate(notification.href);
                        }}
                        className={`w-full px-4 py-3 border-b last:border-b-0 border-[#f5f5f5] text-left hover:bg-[#f7f9fc] cursor-pointer ${
                          !notification.read ? "bg-[#fff7f7]" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>
                            {notification.title}
                          </div>
                          {!notification.read && (
                            <span className="w-2.5 h-2.5 rounded-full bg-[#BB0000] shrink-0" />
                          )}
                        </div>
                        <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
                          {notification.detail}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4 text-[#6a6d70]" style={{ fontSize: 12 }}>
                    No active notifications. Turn them on in Preferences.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-white/20" />

          <div className="relative">
            <button
              onClick={() => {
                setProfileOpen(!profileOpen);
                setNotificationsOpen(false);
              }}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div
                className="w-7 h-7 rounded-full bg-[#0A6ED1] flex items-center justify-center text-white shrink-0"
                style={{ fontSize: 11, fontWeight: 600 }}
              >
                {initials}
              </div>
              <div className="hidden md:block text-left">
                <div className="text-white" style={{ fontSize: 12, fontWeight: 500 }}>
                  {userName}
                </div>
                <div className="text-white/50" style={{ fontSize: 10 }}>
                  {role}
                </div>
              </div>
              <ChevronDown size={13} className="text-white/50 hidden md:block" />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-10 w-52 bg-white border border-[#d9d9d9] shadow-lg z-50">
                <div className="px-4 py-3 border-b border-[#f0f0f0]">
                  <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>{userName}</div>
                  <div className="text-[#6a6d70]" style={{ fontSize: 11 }}>{plant}</div>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      navigate(`${settingsPath}?tab=profile`);
                    }}
                    className="w-full px-4 py-2 text-left text-[#333] hover:bg-[#f5f5f5] cursor-pointer"
                    style={{ fontSize: 13 }}
                  >
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      navigate(`${settingsPath}?tab=notifications`);
                    }}
                    className="w-full px-4 py-2 text-left text-[#333] hover:bg-[#f5f5f5] cursor-pointer"
                    style={{ fontSize: 13 }}
                  >
                    Preferences
                  </button>
                  <div className="border-t border-[#f0f0f0] mt-1 pt-1">
                    <button
                      onClick={() => { setProfileOpen(false); onLogout(); }}
                      className="w-full px-4 py-2 text-left text-[#BB0000] hover:bg-[#fff5f5] cursor-pointer inline-flex items-center gap-2"
                      style={{ fontSize: 13 }}
                    >
                      <LogOut size={13} /> Sign Out
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Side Nav */}
        <nav
          className={`${collapsed ? "w-14" : "w-56"} bg-white border-r border-[#e0e0e0] shrink-0 flex flex-col transition-[width] duration-200 overflow-hidden`}
        >
          <div className="flex-1 overflow-y-auto py-3">
            {navGroups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? "mt-2 pt-2 border-t border-[#f0f0f0]" : ""}>
                {!collapsed && group.label && (
                  <div
                    className="px-4 pb-1 pt-1 text-[#999] uppercase tracking-wider"
                    style={{ fontSize: 10, fontWeight: 600 }}
                  >
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => {
                  const active = location.pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      title={item.label}
                      className={`w-full flex items-center gap-3 h-9 cursor-pointer border-l-[3px] transition-colors ${
                        active
                          ? "bg-[#EBF4FD] text-[#0A6ED1] border-[#0A6ED1]"
                          : "text-[#4a4a4a] hover:bg-[#f7f7f7] border-transparent"
                      } ${collapsed ? "justify-center px-0" : "px-4"}`}
                      style={{ fontSize: 13 }}
                    >
                      <item.icon size={15} className="shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="h-10 flex items-center justify-center border-t border-[#f0f0f0] text-[#999] hover:text-[#333] hover:bg-[#f7f7f7] cursor-pointer shrink-0 transition-colors"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();

  const router = useMemo(() => {
    if (!user) return null;
    const role = user.role;
    const defaultPath =
      role === "CEO" ? "/dashboard" : role === "Admin" ? "/admin" : "/manager";

    return createBrowserRouter([
      {
        path: "/",
        element: <Shell user={user} onLogout={() => { void logout(); }} />,
        children: [
          { index: true, element: <Navigate to={defaultPath} replace /> },
          // CEO routes
          { path: "dashboard", element: <CeoDashboard /> },
          { path: "documents", element: <CeoDocuments /> },
          { path: "plants", element: <CeoPlants /> },
          { path: "analytics", element: <CeoAnalytics /> },
          { path: "activity", element: <CeoActivity /> },
          { path: "settings", element: <SettingsPage /> },
          // Manager routes
          { path: "manager", element: <ManagerDashboard /> },
          { path: "manager/docs", element: <ManagerDocuments mine /> },
          { path: "manager/all", element: <ManagerDocuments mine={false} /> },
          { path: "manager/settings", element: <SettingsPage /> },
          // Admin routes
          { path: "admin", element: <AdminPanel /> },
          { path: "admin/settings", element: <SettingsPage /> },
          { path: "*", element: <Navigate to={defaultPath} replace /> },
        ],
      },
    ]);
  }, [logout, user]);

  if (loading) {
    return <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center text-[#6a6d70]">Loading application...</div>;
  }

  if (!user) return <LoginPage />;
  return <RouterProvider router={router!} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
