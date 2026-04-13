import { createBrowserRouter, Navigate } from "react-router";
import { CeoDashboard } from "./components/ceo-dashboard";
import { ManagerDashboard } from "./components/manager-dashboard";
import { AdminPanel } from "./components/admin-panel";

export function createAppRouter(role: string) {
  const defaultPath = role === "CEO" ? "/dashboard" : role === "Admin" ? "/admin" : "/manager";

  return createBrowserRouter([
    {
      path: "/",
      element: <Navigate to={defaultPath} replace />,
    },
    {
      path: "/dashboard",
      element: <CeoDashboard />,
    },
    {
      path: "/documents",
      element: <CeoDashboard />,
    },
    {
      path: "/manager",
      element: <ManagerDashboard />,
    },
    {
      path: "/admin",
      element: <AdminPanel />,
    },
    {
      path: "*",
      element: <Navigate to={defaultPath} replace />,
    },
  ]);
}
