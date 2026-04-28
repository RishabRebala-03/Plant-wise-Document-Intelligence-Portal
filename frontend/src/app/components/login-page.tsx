import { useState } from "react";
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
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(10,110,209,0.13),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(15,118,110,0.12),_transparent_26%),linear-gradient(180deg,_#f7f9fb,_#eef3f7)] px-5 py-8">
      <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.16)] backdrop-blur">
        <div className="h-3 bg-[linear-gradient(90deg,_#0A6ED1,_#0f766e,_#354A5F)]" />
        <div className="bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-8 py-7">
          <div className="flex items-center justify-center rounded-[22px] border border-white/10 bg-white px-6 py-5 shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
            <img src="/midwest-logo.svg" alt="Midwest logo" className="h-12 w-auto" />
          </div>
        </div>
        <div className="p-8 md:p-10">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Sign in</h1>
          </div>

          <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-[420px] space-y-5">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-[#0A6ED1] focus:ring-4 focus:ring-[#0A6ED1]/10"
              />
            </label>

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-[#0A6ED1] focus:ring-4 focus:ring-[#0A6ED1]/10"
              />
            </label>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#BB0000]">{error}</div> : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
