import { createContext, useContext, useEffect, useState } from "react";
import { AUTH_EXPIRED_EVENT, authApi } from "./api";
import type { User } from "./types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const handleExpired = () => {
      if (active) setUser(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);

    authApi
      .me()
      .then((me) => {
        if (active) setUser(me);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    };
  }, []);

  async function login(email: string, password: string) {
    const me = await authApi.login(email, password);
    setUser(me);
  }

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  async function refreshUser() {
    const me = await authApi.me();
    setUser(me);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
