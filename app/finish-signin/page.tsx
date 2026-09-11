"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { CoinLogo } from "@/components/CoinLogo";
import { Loader2, AlertCircle, ArrowRight, Mail } from "lucide-react";

const EMAIL_KEY = "cpc_email_for_signin";

type State = "working" | "needEmail" | "error" | "done";

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? "");
  }
  return "";
}

export default function FinishSignInPage() {
  const router = useRouter();
  const [state, setState] = useState<State>("working");
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const ran = useRef(false);

  async function complete(value: string) {
    setState("working");
    try {
      await signInWithEmailLink(auth, value, window.location.href);
      window.localStorage.removeItem(EMAIL_KEY);
      setState("done");
      router.replace("/dashboard");
    } catch (e) {
      setState("error");
      setMsg(
        errMessage(e) ||
          "That sign-in link is invalid or has expired. Request a new one.",
      );
    }
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        if (!isSignInWithEmailLink(auth, window.location.href)) {
          setState("error");
          setMsg(
            "This link is invalid or has expired. Request a new one from the sign-in page.",
          );
          return;
        }
        const stored = window.localStorage.getItem(EMAIL_KEY);
        if (!stored) {
          setState("needEmail"); // opened on a different device/browser
          return;
        }
        await complete(stored);
      } catch (e) {
        setState("error");
        setMsg(errMessage(e) || "Something went wrong finishing sign-in.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <CoinLogo size={56} glow />

      {(state === "working" || state === "done") && (
        <div className="mt-8 flex flex-col items-center">
          <Loader2 size={26} className="animate-spin text-gold-400" />
          <p className="mt-4 text-mute">Verifying your link…</p>
        </div>
      )}

      {state === "needEmail" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void complete(email.trim().toLowerCase());
          }}
          className="capsule-card mt-8 w-full space-y-4 p-6 text-left"
        >
          <h1 className="text-lg font-semibold text-white">
            Confirm your email
          </h1>
          <p className="text-sm text-mute">
            For security, re-enter the email this link was sent to.
          </p>
          <div className="relative">
            <Mail
              size={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@orbitax.com"
              className="field pl-11"
            />
          </div>
          <button type="submit" className="btn-gold w-full">
            Finish sign-in <ArrowRight size={18} />
          </button>
        </form>
      )}

      {state === "error" && (
        <div className="capsule-card mt-8 w-full p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-capsule bg-red-500/15 text-red-300">
            <AlertCircle size={24} />
          </div>
          <p className="mt-4 text-sm text-mute">{msg}</p>
          <Link href="/login" className="btn-gold mt-6">
            Back to sign-in <ArrowRight size={18} />
          </Link>
        </div>
      )}
    </main>
  );
}
