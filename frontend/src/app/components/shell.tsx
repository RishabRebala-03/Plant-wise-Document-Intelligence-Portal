import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard, Upload, Users, ChevronLeft, ChevronRight,
  Bell, LogOut, FileText
} from "lucide-react";

interface ShellProps {
  role: string;
  onLogout: () => void;
}

export function Shell({ role, onLogout }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    ...(role === "CEO" ? [{ label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" }] : []),
    ...(role === "Mining Manager" ? [{ label: "Documents", icon: Upload, path: "/manager" }] : []),
    ...(role === "Admin" ? [{ label: "User Management", icon: Users, path: "/admin" }] : []),
    ...(role === "CEO" ? [{ label: "All Documents", icon: FileText, path: "/documents" }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7f7]">
      {/* Top Header */}
      <header className="h-11 bg-[#354A5F] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-[#0A6ED1] flex items-center justify-center text-white" style={{ fontSize: 9, fontWeight: 600 }}>MW</div>
          <span className="text-white" style={{ fontSize: 13, fontWeight: 500 }}>Plant-Wise Document Intelligence & Tracking</span>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-white/70 hover:text-white cursor-pointer"><Bell size={16} /></button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#0A6ED1] flex items-center justify-center text-white" style={{ fontSize: 11, fontWeight: 500 }}>
              {role === "CEO" ? "DR" : role === "Admin" ? "AU" : "JC"}
            </div>
            <span className="text-white/90 hidden sm:inline" style={{ fontSize: 12 }}>{role}</span>
          </div>
          <button onClick={onLogout} className="text-white/70 hover:text-white cursor-pointer"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Nav */}
        <nav className={`${collapsed ? "w-12" : "w-52"} bg-white border-r border-[#d9d9d9] shrink-0 flex flex-col transition-all duration-150`}>
          <div className="flex-1 pt-2">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-3 h-10 cursor-pointer ${
                    active ? "bg-[#e8f0fb] text-[#0A6ED1] border-l-3 border-[#0A6ED1]" : "text-[#333] hover:bg-[#f5f5f5]"
                  }`}
                  style={{ fontSize: 13 }}
                >
                  <item.icon size={16} />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="h-10 flex items-center justify-center border-t border-[#d9d9d9] text-[#6a6d70] hover:text-[#333] cursor-pointer"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
