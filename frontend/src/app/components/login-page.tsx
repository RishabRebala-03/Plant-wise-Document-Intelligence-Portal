import { useState } from "react";
import { BarChart3, HardHat, ArrowRight, ShieldCheck, MapPinned } from "lucide-react";
import { useAuth } from "../lib/auth";

const personas = [
  {
    role: "CEO",
    name: "David Richardson",
    title: "Chief Executive Officer",
    description: "Executive analytics dashboard, plant-wide document overview, and private commentary.",
    icon: BarChart3,
    accent: "#0A6ED1",
    bg: "#EBF4FD",
    hint: "d.richardson@midwestltd.com",
  },
  {
    role: "Admin",
    name: "Admin User",
    title: "Platform Administrator",
    description: "User governance, access configuration, IP policy, and security operations.",
    icon: ShieldCheck,
    accent: "#354A5F",
    bg: "#EEF2F5",
    hint: "admin@midwestltd.com",
  },
  {
    role: "Mining Manager",
    name: "John Carter",
    title: "Mining Manager - Plant Alpha",
    description: "Create projects, upload within project workspaces, and track controlled document status.",
    icon: HardHat,
    accent: "#107E3E",
    bg: "#EBF5EF",
    hint: "j.carter@midwestltd.com",
  },
  {
    role: "Mining Manager",
    name: "Sarah Miller",
    title: "Mining Manager - Plant Beta",
    description: "Alternate manager perspective for plant-scoped navigation, projects, and document filtering.",
    icon: MapPinned,
    accent: "#5B738B",
    bg: "#EEF2F5",
    hint: "s.miller@midwestltd.com",
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(nextEmail: string, nextPassword: string) {
    setSubmitting(true);
    setError("");
    try {
      await login(nextEmail, nextPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter both email and password.");
      return;
    }
    await submitLogin(email.trim(), password);
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
      <div className="h-11 bg-[#354A5F] flex items-center px-6 gap-3 shrink-0">
        <div className="w-7 h-7 bg-[#0A6ED1] flex items-center justify-center text-white" style={{ fontSize: 10, fontWeight: 700 }}>
          MW
        </div>
        <span className="text-white" style={{ fontSize: 13, fontWeight: 500 }}>
          Plant-Wise Document Intelligence &amp; Tracking - Midwest Ltd
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[760px]">
          <div className="mb-7 text-center">
            <h1 className="text-[#333]" style={{ fontSize: 22, fontWeight: 600 }}>
              Sign In
            </h1>
            <p className="text-[#6a6d70] mt-1" style={{ fontSize: 13 }}>
              Sign in by perspective to review the CEO, Admin, or Mining Manager experience against the local Flask backend.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
            {personas.map((persona) => (
              <button
                key={`${persona.role}-${persona.hint}`}
                onClick={() => {
                  setEmail(persona.hint);
                  setPassword("Password123!");
                  void submitLogin(persona.hint, "Password123!");
                }}
                disabled={submitting}
                className="bg-white border border-[#d9d9d9] hover:border-[#0A6ED1] hover:shadow-sm text-left transition-all group cursor-pointer disabled:opacity-60"
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 flex items-center justify-center shrink-0" style={{ background: persona.bg }}>
                      <persona.icon size={20} style={{ color: persona.accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[#333]" style={{ fontSize: 14, fontWeight: 600 }}>
                            {persona.name}
                          </div>
                          <div className="text-[#6a6d70]" style={{ fontSize: 12 }}>
                            {persona.title}
                          </div>
                        </div>
                        <ArrowRight size={16} className="text-[#bbb] group-hover:text-[#0A6ED1] transition-colors shrink-0" />
                      </div>
                      <p className="text-[#6a6d70] mt-2" style={{ fontSize: 12, lineHeight: 1.5 }}>
                        {persona.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-2.5 border-t border-[#f0f0f0] flex items-center justify-between" style={{ background: persona.bg }}>
                  <span style={{ fontSize: 11, color: persona.accent, fontWeight: 500 }}>
                    Perspective Sign-In
                  </span>
                  <span className="text-[#999]" style={{ fontSize: 11 }}>
                    {persona.hint}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-[#d9d9d9]" />
            <span className="text-[#999]" style={{ fontSize: 12 }}>
              or sign in manually
            </span>
            <div className="flex-1 h-px bg-[#d9d9d9]" />
          </div>

          <div className="bg-white border border-[#d9d9d9] p-6 max-w-[420px] mx-auto">
            <h3 className="text-[#333] mb-4" style={{ fontSize: 14, fontWeight: 500 }}>
              Sign In
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[#333] mb-1" style={{ fontSize: 13, fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. d.richardson@midwestltd.com"
                  className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
                  style={{ fontSize: 13 }}
                />
              </div>
              <div>
                <label className="block text-[#333] mb-1" style={{ fontSize: 13, fontWeight: 500 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
                  style={{ fontSize: 13 }}
                />
              </div>
              {error && (
                <p className="text-[#BB0000]" style={{ fontSize: 12 }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-9 bg-[#0A6ED1] text-white hover:bg-[#0854A0] cursor-pointer disabled:opacity-60"
                style={{ fontSize: 13, fontWeight: 500 }}
              >
                {submitting ? "Signing In..." : "Sign In"}
              </button>
            </form>
            <p className="text-[#6a6d70] mt-3" style={{ fontSize: 11 }}>
              Seeded backend users default to `Password123!` unless you changed `DEFAULT_DEMO_PASSWORD`.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
