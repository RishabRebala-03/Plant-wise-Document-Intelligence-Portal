import { useState } from "react";
import { User, Bell, Shield, Monitor } from "lucide-react";
import { settingsApi } from "../lib/api";
import { useAuth } from "../lib/auth";

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const [saved, setSaved] = useState("");
  const [profile, setProfile] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "display", label: "Display", icon: Monitor },
  ];

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
        await settingsApi.updatePreferences({
          notificationPreferences: user?.notificationPreferences || {},
        });
      } else {
        await settingsApi.updatePreferences({
          displayPreferences: user?.displayPreferences || {},
        });
      }
      setSaved("Preferences saved.");
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Unable to save preferences.");
    }
  }

  async function savePassword() {
    try {
      await settingsApi.updatePassword(passwords);
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSaved("Password updated.");
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Unable to update password.");
    }
  }

  return (
    <div className="p-7 max-w-[900px]">
      <div className="mb-7">
        <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
          Settings
        </h1>
        <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
          Connected to your backend profile and preferences.
        </p>
      </div>

      {saved && <div className="mb-4 px-4 py-2 bg-[#EBF5EF] text-[#107E3E]" style={{ fontSize: 13 }}>{saved}</div>}

      <div className="flex gap-6">
        <div className="w-44 shrink-0">
          <div className="bg-white border border-[#e8e8e8]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-l-[3px] cursor-pointer transition-colors ${
                  activeTab === tab.id ? "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1]" : "border-transparent text-[#444] hover:bg-[#f7f7f7]"
                }`}
                style={{ fontSize: 13 }}
              >
                <tab.icon size={14} className="shrink-0" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="bg-white border border-[#e8e8e8] p-6 space-y-5">
            {activeTab === "profile" && (
              <>
                <input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} placeholder="First name" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} placeholder="Last name" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="Email" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <button onClick={() => void saveProfile()} className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0]">Save Profile</button>
              </>
            )}

            {activeTab === "notifications" && (
              <>
                <div className="text-[#333]" style={{ fontSize: 13 }}>
                  Notification preferences are loaded from your user profile.
                </div>
                <button onClick={() => void savePreferences("notifications")} className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0]">
                  Save Notification Preferences
                </button>
              </>
            )}

            {activeTab === "security" && (
              <>
                <input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} placeholder="Current password" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} placeholder="New password" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <input type="password" value={passwords.confirmPassword} onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })} placeholder="Confirm password" className="w-full h-9 px-3 border border-[#d9d9d9]" />
                <button onClick={() => void savePassword()} className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0]">
                  Update Password
                </button>
              </>
            )}

            {activeTab === "display" && (
              <>
                <div className="text-[#333]" style={{ fontSize: 13 }}>
                  Display preferences can be persisted through the backend settings endpoint.
                </div>
                <button onClick={() => void savePreferences("display")} className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0]">
                  Save Display Preferences
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
