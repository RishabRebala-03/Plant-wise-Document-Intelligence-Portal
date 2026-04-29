import { useEffect, useState } from "react";
import { Pencil, Ban, UserPlus } from "lucide-react";
import { plantsApi, usersApi } from "../lib/api";
import type { Plant, User } from "../lib/types";

const DATE_PRESET_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "1m", label: "Last 1 month" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
];

function formatUserDate(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "Mining Manager", plantId: "" });
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [dateField, setDateField] = useState<"created" | "updated">("created");
  const [datePreset, setDatePreset] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function resolveDatePreset(preset: string) {
    if (!preset) return { from: dateFrom || undefined, to: dateTo || undefined };
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now);
    if (preset === "1m") start.setMonth(start.getMonth() - 1);
    else if (preset === "3m") start.setMonth(start.getMonth() - 3);
    else if (preset === "6m") start.setMonth(start.getMonth() - 6);
    else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
    return { from: start.toISOString().slice(0, 10), to: end };
  }

  async function load() {
    const resolvedDateRange = resolveDatePreset(datePreset);
    const [usersResult, plantsResult] = await Promise.all([
      usersApi.list({
        q: search || undefined,
        status: statusFilter || undefined,
        role: roleFilter || undefined,
        plantId: plantFilter || undefined,
        dateField,
        dateFrom: resolvedDateRange.from,
        dateTo: resolvedDateRange.to,
      }),
      plantsApi.list(),
    ]);
    setUsers(usersResult);
    setPlants(plantsResult.items);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "Unable to load admin data."));
  }, [search, statusFilter, roleFilter, plantFilter, dateField, dateFrom, datePreset, dateTo]);

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setRoleFilter("");
    setPlantFilter("");
    setDateField("created");
    setDatePreset("");
    setDateFrom("");
    setDateTo("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    try {
      await usersApi.create({
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        plantId: newUser.plantId || undefined,
      });
      setNewUser({ name: "", email: "", role: "Mining Manager", plantId: "" });
      setShowAddForm(false);
      setMessage("User added successfully.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to add user.");
    }
  }

  async function toggleStatus(userId: string) {
    await usersApi.toggleStatus(userId);
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[#333]" style={{ fontSize: 18, fontWeight: 500 }}>User Management</h2>
          <p className="text-[#6a6d70]" style={{ fontSize: 13 }}>Manage users and role assignments</p>
        </div>
        <button
          onClick={() => setShowAddForm((prev) => !prev)}
          className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0] inline-flex items-center gap-2 cursor-pointer"
          style={{ fontSize: 13, fontWeight: 500 }}
        >
          <UserPlus size={14} /> Add User
        </button>
      </div>

      {message && <div className="mb-4 px-4 py-2 bg-[#e8f5e9] border border-[#c8e6c9] text-[#2e7d32]" style={{ fontSize: 13 }}>{message}</div>}

      {showAddForm && (
        <div className="bg-white border border-[#d9d9d9] mb-6">
          <div className="px-4 py-3 border-b border-[#d9d9d9]">
            <h3 className="text-[#333]" style={{ fontSize: 14, fontWeight: 500 }}>Add New User</h3>
          </div>
          <form onSubmit={handleAdd} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Full name" className="w-full h-9 px-3 border border-[#d9d9d9]" />
              <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email address" className="w-full h-9 px-3 border border-[#d9d9d9]" />
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full h-9 px-3 border border-[#d9d9d9]">
                <option>CEO</option>
                <option>Mining Manager</option>
                <option>Admin</option>
              </select>
              <select value={newUser.plantId} onChange={(e) => setNewUser({ ...newUser, plantId: e.target.value })} className="w-full h-9 px-3 border border-[#d9d9d9]">
                <option value="">All Plants</option>
                {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="h-8 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0] cursor-pointer" style={{ fontSize: 12 }}>Save</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="h-8 px-4 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] cursor-pointer" style={{ fontSize: 12 }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="data-table-panel">
        <div className="px-4 py-3 border-b border-[#d9d9d9]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-[#333]" style={{ fontSize: 14, fontWeight: 500 }}>All Users</h3>
              <p className="text-[#6a6d70]" style={{ fontSize: 12 }}>
                Filter users by registration or last update date to narrow admin reviews.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]"
              />
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]">
                <option value="">All Roles</option>
                <option value="CEO">CEO</option>
                <option value="Mining Manager">Mining Manager</option>
                <option value="Admin">Admin</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]">
                <option value="">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Disabled">Disabled</option>
              </select>
              <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)} className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]">
                <option value="">All Plants</option>
                {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
              </select>
              <select value={dateField} onChange={(e) => setDateField(e.target.value as "created" | "updated")} className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]">
                <option value="created">Registration Date</option>
                <option value="updated">Last Updated Date</option>
              </select>
              <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]">
                {DATE_PRESET_OPTIONS.map((option) => <option key={option.value || "any"} value={option.value}>{option.label}</option>)}
              </select>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDatePreset("");
                  setDateFrom(e.target.value);
                }}
                className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]"
                aria-label="Filter from date"
                disabled={Boolean(datePreset)}
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDatePreset("");
                  setDateTo(e.target.value);
                }}
                className="h-9 px-3 border border-[#d9d9d9] bg-white text-[#333]"
                aria-label="Filter to date"
                disabled={Boolean(datePreset)}
              />
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 px-4 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] cursor-pointer"
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>
        <div className="data-table-scroll">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr className="bg-[#f5f5f5] text-[#6a6d70] text-left">
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Name</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Role</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Email</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Plant</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Created</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Updated</th>
                <th className="px-4 py-2" style={{ fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, index) => (
                <tr key={user.id} className={index % 2 === 1 ? "bg-[#fafafa]" : ""}>
                  <td className="px-4 py-2.5 text-[#333]">{user.name}</td>
                  <td className="px-4 py-2.5">{user.role}</td>
                  <td className="px-4 py-2.5 text-[#6a6d70]">{user.email}</td>
                  <td className="px-4 py-2.5 text-[#6a6d70]">{user.plant || "All"}</td>
                  <td className="px-4 py-2.5 text-[#6a6d70]">{formatUserDate(user.createdAt)}</td>
                  <td className="px-4 py-2.5 text-[#6a6d70]">{formatUserDate(user.updatedAt)}</td>
                  <td className="px-4 py-2.5 flex gap-3">
                    <button className="text-[#0A6ED1] hover:underline inline-flex items-center gap-1 cursor-pointer" style={{ fontSize: 12 }}>
                      <Pencil size={12} /> View
                    </button>
                    <button onClick={() => void toggleStatus(user.id)} className="text-[#6a6d70] hover:text-[#333] inline-flex items-center gap-1 cursor-pointer" style={{ fontSize: 12 }}>
                      <Ban size={12} /> {user.status === "Active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[#6a6d70]">
                    No users matched the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
