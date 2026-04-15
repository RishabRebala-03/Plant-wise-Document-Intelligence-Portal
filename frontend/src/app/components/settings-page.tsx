import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Bell, Monitor, Shield, User } from "lucide-react";
import { settingsApi } from "../lib/api";
import { useAuth } from "../lib/auth";

const SETTINGS_TABS = ["profile", "notifications", "security", "display"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [saved, setSaved] = useState("");
  const [profile, setProfile] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
  });
  const [notificationPreferences, setNotificationPreferences] = useState<Record<string, boolean>>(user?.notificationPreferences || {});
  const [displayPreferences, setDisplayPreferences] = useState({
    table_density: String(user?.displayPreferences?.table_density || "Default"),
    language: String(user?.displayPreferences?.language || "English (US)"),
    date_format: String(user?.displayPreferences?.date_format || "YYYY-MM-DD"),
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const searchParams = new URLSearchParams(location.search);
  const requestedTab = searchParams.get("tab");
  const activeTab: SettingsTab = SETTINGS_TABS.includes(requestedTab as SettingsTab) ? (requestedTab as SettingsTab) : "profile";

  useEffect(() => {
    setProfile({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: user?.email || "",
    });
    setNotificationPreferences(user?.notificationPreferences || {});
    setDisplayPreferences({
      table_density: String(user?.displayPreferences?.table_density || "Default"),
      language: String(user?.displayPreferences?.language || "English (US)"),
      date_format: String(user?.displayPreferences?.date_format || "YYYY-MM-DD"),
    });
  }, [user]);

  function setActiveTab(tab: SettingsTab) {
    navigate(`${location.pathname}?tab=${tab}`, { replace: true });
  }

  async function saveProfile() {
    try {
      await settingsApi.updateProfile(profile);
      await refreshUser();
      setSaved("Profile saved.");
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Unable to save profile.");
    }
  }

  async function savePreferences(section: "notifications" | "display") {
    try {
      if (section === "notifications") {
        await settingsApi.updatePreferences({ notificationPreferences });
      } else {
        await settingsApi.updatePreferences({ displayPreferences });
      }
      await refreshUser();
      setSaved("Preferences saved.");
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Unable to save preferences.");
    }
  }

  async function savePassword() {
    try {
      await settingsApi.updatePassword(passwords);
      await refreshUser();
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSaved("Password updated.");
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Unable to update password.");
    }
  }

  const tabs = [
    { id: "profile", label: "Profile", icon: User, note: "Identity and contact details" },
    { id: "notifications", label: "Notifications", icon: Bell, note: "Alert routing and summaries" },
    { id: "security", label: "Security", icon: Shield, note: "Password and account protection" },
    { id: "display", label: "Display", icon: Monitor, note: "Language, density, and dates" },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.2)]">
        <div className="text-xs uppercase tracking-[0.26em] text-white/55">Settings</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Profile, preferences, and security</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
          Update account details and UI behavior with the same structured layout used across the portal.
        </p>
      </section>

      {saved ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{saved}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <div className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
          <div className="mb-3 text-sm font-semibold text-slate-900">Settings sections</div>
          <div className="space-y-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SettingsTab)}
                className={`w-full rounded-3xl px-4 py-4 text-left transition ${
                  activeTab === tab.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-3">
                  <tab.icon size={16} />
                  <div>
                    <div className="font-semibold">{tab.label}</div>
                    <div className={`text-xs ${activeTab === tab.id ? "text-white/70" : "text-slate-500"}`}>{tab.note}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
          {activeTab === "profile" ? (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-900">Profile</div>
                <div className="mt-1 text-sm text-slate-500">Keep your contact and identity details current.</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <InputField label="First name" value={profile.firstName} onChange={(value) => setProfile((current) => ({ ...current, firstName: value }))} />
                <InputField label="Last name" value={profile.lastName} onChange={(value) => setProfile((current) => ({ ...current, lastName: value }))} />
                <div className="md:col-span-2">
                  <InputField label="Email" value={profile.email} onChange={(value) => setProfile((current) => ({ ...current, email: value }))} />
                </div>
              </div>
              <PrimaryButton onClick={() => void saveProfile()}>Save profile</PrimaryButton>
            </div>
          ) : null}

          {activeTab === "notifications" ? (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-900">Notifications</div>
                <div className="mt-1 text-sm text-slate-500">Choose which alerts should reach your account.</div>
              </div>
              <div className="grid gap-3">
                {[
                  ["new_document_upload", "New document upload alerts"],
                  ["document_approval", "Document approval notifications"],
                  ["weekly_summary_report", "Weekly summary reports"],
                  ["system_alerts", "System alerts"],
                  ["ceo_note_added", "CEO note updates"],
                ].map(([key, label]) => (
                  <ToggleRow
                    key={key}
                    label={label}
                    checked={Boolean(notificationPreferences[key])}
                    onChange={(checked) => setNotificationPreferences((current) => ({ ...current, [key]: checked }))}
                  />
                ))}
              </div>
              <PrimaryButton onClick={() => void savePreferences("notifications")}>Save notification preferences</PrimaryButton>
            </div>
          ) : null}

          {activeTab === "security" ? (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-900">Security</div>
                <div className="mt-1 text-sm text-slate-500">Change your password and keep your account protected.</div>
              </div>
              <InputField label="Current password" type="password" value={passwords.currentPassword} onChange={(value) => setPasswords((current) => ({ ...current, currentPassword: value }))} />
              <InputField label="New password" type="password" value={passwords.newPassword} onChange={(value) => setPasswords((current) => ({ ...current, newPassword: value }))} />
              <InputField label="Confirm password" type="password" value={passwords.confirmPassword} onChange={(value) => setPasswords((current) => ({ ...current, confirmPassword: value }))} />
              <PrimaryButton onClick={() => void savePassword()}>Update password</PrimaryButton>
            </div>
          ) : null}

          {activeTab === "display" ? (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-900">Display</div>
                <div className="mt-1 text-sm text-slate-500">Tune table density, language, and date formatting.</div>
              </div>
              <SelectField
                label="Table density"
                value={displayPreferences.table_density}
                onChange={(value) => setDisplayPreferences((current) => ({ ...current, table_density: value }))}
                options={["Compact", "Default", "Comfortable"]}
              />
              <SelectField
                label="Language"
                value={displayPreferences.language}
                onChange={(value) => setDisplayPreferences((current) => ({ ...current, language: value }))}
                options={["English (US)", "English (UK)"]}
              />
              <SelectField
                label="Date format"
                value={displayPreferences.date_format}
                onChange={(value) => setDisplayPreferences((current) => ({ ...current, date_format: value }))}
                options={["YYYY-MM-DD", "DD-MM-YYYY", "MM-DD-YYYY"]}
              />
              <PrimaryButton onClick={() => void savePreferences("display")}>Save display preferences</PrimaryButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-teal-600" />
    </label>
  );
}

function PrimaryButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">{children}</button>;
}
