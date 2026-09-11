"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import type { MemberPublic } from "@/lib/types";

export type AuthStatus = "loading" | "signedOut" | "notMember" | "member";

const LOCK_KEY = "cpc_locked";
/** Set once a member has authenticated on this device; a hint that a session should restore. */
export const TRUSTED_KEY = "cpc_trusted_email";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  member: MemberPublic | null;
  email: string | null;
  locked: boolean;
  lock: () => void; // soft logout — keeps the device trusted (no re-verify needed)
  unlock: () => void; // resume from a soft logout
  refresh: () => Promise<void>;
  signOut: () => Promise<void>; // hard logout — clears the device (re-verify next time)
  getToken: () => Promise<string | null>;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<MemberPublic | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [locked, setLocked] = useState(false);

  // Read the soft-lock flag on the client (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      setLocked(localStorage.getItem(LOCK_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const lock = useCallback(() => {
    try {
      localStorage.setItem(LOCK_KEY, "1");
    } catch {
      /* ignore */
    }
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      /* ignore */
    }
    setLocked(false);
  }, []);

  const getToken = useCallback(async () => {
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  }, []);

  const authedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = await getToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers, cache: "no-store" });
    },
    [getToken],
  );

  const loadMe = useCallback(async (u: User | null) => {
    if (!u) {
      setMember(null);
      setStatus("signedOut");
      return;
    }
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 200) {
        const data = await res.json();
        setMember(data.member as MemberPublic);
        setStatus("member");
        // Remember this device as trusted so re-entry never needs a new link.
        try {
          localStorage.setItem(TRUSTED_KEY, (data.member?.email as string) || "");
        } catch {
          /* ignore */
        }
      } else if (res.status === 403) {
        setMember(null);
        setStatus("notMember");
      } else {
        setMember(null);
        setStatus("signedOut");
      }
    } catch {
      setMember(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setStatus("loading");
      void loadMe(u);
    });
    return () => unsub();
  }, [loadMe]);

  const refresh = useCallback(async () => {
    await loadMe(auth.currentUser);
  }, [loadMe]);

  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem(LOCK_KEY);
      localStorage.removeItem(TRUSTED_KEY);
    } catch {
      /* ignore */
    }
    setLocked(false);
    await fbSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        member,
        email: user?.email ?? null,
        locked,
        lock,
        unlock,
        refresh,
        signOut,
        getToken,
        authedFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
