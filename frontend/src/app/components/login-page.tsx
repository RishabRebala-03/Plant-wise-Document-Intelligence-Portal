import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter both email and password.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.14),_transparent_30%),linear-gradient(180deg,_#eef4f8_0%,_#f8fbfd_100%)] px-5 py-8">
      <div className="grid w-full max-w-[840px] overflow-hidden rounded-[32px] border border-white/80 bg-white/96 shadow-[0_28px_70px_rgba(15,23,42,0.12)] backdrop-blur lg:grid-cols-[0.95fr_1.05fr]">
        <div className="hidden bg-[linear-gradient(155deg,_#0f172a_0%,_#153b56_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/55">Midwest Operations Portal</div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight">Secure access for document control and plant operations</h2>
            <p className="mt-4 text-sm leading-7 text-slate-200/85">
              Sign in to continue into your role-based workspace with governed access, scoped visibility, and monitored sessions.
            </p>
          </div>

          <div className="space-y-3">
            <div className="rounded-[24px] border border-white/12 bg-white/10 px-5 py-4 text-sm text-slate-100/90">
              Role-aware dashboards and access-controlled workflows
            </div>
            <div className="rounded-[24px] border border-white/12 bg-white/10 px-5 py-4 text-sm text-slate-100/90">
              Session, IP, and activity protections running in the background
            </div>
          </div>
        </div>

        <div className="p-8 md:p-10">
          <div className="flex flex-col items-center text-center">
            <div className="flex w-full max-w-[280px] items-center justify-center rounded-[24px] border border-slate-200 bg-white px-6 py-5 shadow-[0_14px_32px_rgba(15,23,42,0.06)]">
              <img src="/midwest-logo.svg" alt="Midwest logo" className="h-12 w-auto" />
            </div>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">Sign in</h1>
            <p className="mt-2 text-sm text-slate-500">Enter your email and password to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-[420px] space-y-5">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@midwestltd.com"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-teal-500"
              />
            </label>

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-teal-500"
              />
            </label>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#BB0000]">{error}</div> : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign in"}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
