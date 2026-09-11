"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth, TRUSTED_KEY } from "@/components/AuthProvider";
import { CoinLogo } from "@/components/CoinLogo";
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldCheck,
  LogOut,
} from "lucide-react";

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { status, locked, unlock, signOut, member, email: authEmail } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleErr, setGoogleErr] = useState<string | null>(null);
  // Hint (read synchronously on the client) that this device has signed in before,
  // so we can show a "trusted device" state while the session restores instead of
  // a clickable Google button — which, if clicked mid-restore, opens a stray popup.
  const [hadTrustedSession, setHadTrustedSession] = useState(false);
  useEffect(() => {
    try {
      setHadTrustedSession(!!localStorage.getItem(TRUSTED_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    if (status === "member" && !locked) router.replace("/dashboard");
  }, [status, locked, router]);

  async function googleSignIn() {
    // Never open a popup if a session is already present or one is being established.
    if (googleBusy || auth.currentUser) return;
    setGoogleBusy(true);
    setGoogleErr(null);
    try {
      const provider = new GoogleAuthProvider();
      // Prefer the member's Orbitax Workspace account; the allowlist still gates access.
      provider.setCustomParameters({ hd: "orbitax.com", prompt: "select_account" });
      await signInWithPopup(auth, provider);
      unlock(); // the effect redirects once the member loads
    } catch (e) {
      const codeStr = (e as { code?: string })?.code ?? "";
      if (codeStr === "auth/popup-closed-by-user" || codeStr === "auth/cancelled-popup-request") {
        setGoogleErr(null); // user dismissed the popup — not an error
      } else if (codeStr === "auth/popup-blocked") {
        setGoogleErr("Your browser blocked the sign-in popup — allow popups for this site, then try again.");
      } else if (codeStr === "auth/unauthorized-domain") {
        setGoogleErr(
          "This address isn't authorized for Google sign-in yet — the admin needs to add it in Firebase → Authentication → Settings → Authorized domains.",
        );
      } else {
        setGoogleErr("Google sign-in didn't work. Please try again.");
      }
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
      <div className="animate-rise mb-8 flex flex-col items-center text-center">
        <CoinLogo size={64} glow />
        <h1 className="mt-5 text-3xl font-bold">
          <span className="text-gradient-gold">Capsule Coin</span>
        </h1>
        <p className="mt-2 text-sm text-mute">
          Sign in with your <span className="text-white">@orbitax.com</span> account.
        </p>
      </div>

      <div className="animate-rise capsule-card w-full p-6 sm:p-8">
        {status === "member" && locked ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-capsule bg-gold-500/15 text-gold-300">
              <ShieldCheck size={28} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">
              Welcome back{member?.name ? `, ${member.name.split(" ")[0]}` : ""}
            </h2>
            <p className="mt-2 text-sm text-mute">
              This device is trusted — no need to sign in again.
            </p>
            <button
              onClick={() => {
                unlock();
                router.replace("/dashboard");
              }}
              className="btn-gold mt-6 w-full"
            >
              Continue <ArrowRight size={18} />
            </button>
            <button onClick={() => void signOut()} className="btn-ghost mt-3 text-sm">
              Not you? Sign out completely
            </button>
          </div>
        ) : status === "notMember" ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-capsule bg-red-500/15 text-red-300">
              <AlertCircle size={28} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Not a Capsule member</h2>
            <p className="mt-2 text-sm text-mute">
              <span className="text-white">{authEmail}</span> isn&apos;t one of the 16 Capsule
              members. Ask Adnan to add you, or sign in with a different account.
            </p>
            <button onClick={() => void signOut()} className="btn-ghost mt-6">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        ) : status === "signedOut" ? (
          <div className="space-y-5">
            <button
              onClick={googleSignIn}
              disabled={googleBusy}
              className="flex w-full items-center justify-center gap-2.5 rounded-capsule bg-white px-4 py-3 font-medium text-ink-900 transition hover:brightness-95 disabled:opacity-60"
            >
              {googleBusy ? (
                <Loader2 size={18} className="animate-spin text-ink-900" />
              ) : (
                <GoogleG />
              )}
              Continue with Google
            </button>
            {googleErr && (
              <p className="flex items-start gap-2 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{googleErr}</span>
              </p>
            )}
            <p className="text-center text-xs text-mute">
              Use your Orbitax Google account. Only the 16 Capsule members can enter.
            </p>
          </div>
        ) : (
          // status === "loading" (restoring a session) or member&&!locked (redirect
          // pending). Show a trusted/"signing in" state — never a clickable button —
          // so an impatient tap can't open a redundant Google popup.
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-capsule bg-gold-500/15 text-gold-300">
              {hadTrustedSession ? (
                <ShieldCheck size={28} />
              ) : (
                <Loader2 size={28} className="animate-spin" />
              )}
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">
              {hadTrustedSession ? "Trusted device" : "One moment"}
            </h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-mute">
              <Loader2 size={14} className="animate-spin" />
              {hadTrustedSession ? "Signing you back in…" : "Checking your session…"}
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-mute">
        <ShieldCheck size={14} className="text-teal-400" />
        Allowlisted members only. Verified once, then remembered on this device.
      </p>
    </main>
  );
}
