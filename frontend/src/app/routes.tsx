import { createBrowserRouter, Navigate } from "react-router";
import { CeoDashboard } from "./components/ceo-dashboard";
import { ManagerDashboard } from "./components/manager-dashboard";
import { ManagerUpload } from "./components/manager-upload";
import { AdminPanel } from "./components/admin-panel";

export function createAppRouter(role: string) {
  const defaultPath = role === "Admin" ? "/admin" : "/dashboard";

  return createBrowserRouter([
    {
      path: "/",
      element: <Navigate to={defaultPath} replace />,
    },
    {
      path: "/dashboard",
      element: role === "Mining Manager" ? <ManagerDashboard /> : <CeoDashboard />,
    },
    {
      path: "/documents",
      element: <CeoDashboard />,
    },
    {
      path: "/manager",
      element: <ManagerUpload />,
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
