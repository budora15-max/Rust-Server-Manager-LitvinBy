import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@/types';

const STORAGE_KEY = 'rsm.session'; // "Remember me" -> localStorage
const SESSION_KEY = 'rsm.session.tmp'; // без "Remember me" -> sessionStorage

interface AuthContextValue {
  user: User | null;
  login: (identifier: string, password: string, remember: boolean) => Promise<User>;
  register: (username: string, email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUser(): User | null {
  const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser);

  const persist = (nextUser: User, remember: boolean) => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    const store = remember ? localStorage : sessionStorage;
    store.setItem(remember ? STORAGE_KEY : SESSION_KEY, JSON.stringify(nextUser));
  };

  const login = async (identifier: string, _password: string, remember: boolean) => {
    await new Promise((r) => setTimeout(r, 600)); // имитация сетевого запроса
    const raw = identifier.trim();
    const email = raw.includes('@') ? raw : `${raw}@rust.gg`;
    const nextUser: User = {
      id: `u_${Date.now()}`,
      username: raw.split('@')[0],
      email,
      license: 'Free',
      registeredAt: new Date().toISOString(),
    };
    persist(nextUser, remember);
    setUser(nextUser);
    return nextUser;
  };

  const register = async (username: string, email: string, _password: string) => {
    await new Promise((r) => setTimeout(r, 700));
    const nextUser: User = {
      id: `u_${Date.now()}`,
      username: username.trim(),
      email: email.trim(),
      license: 'Free',
      registeredAt: new Date().toISOString(),
    };
    persist(nextUser, true);
    setUser(nextUser);
    return nextUser;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, login, register, logout }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
