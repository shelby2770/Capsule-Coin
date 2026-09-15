"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useTransfers } from "@/lib/useTransfers";
import { useNegotiations } from "@/lib/useNegotiations";
import { CoinLogo } from "@/components/CoinLogo";
import { Skeleton } from "@/components/Skeleton";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ValueTicker } from "@/components/ValueTicker";
import { StoryMode } from "@/components/StoryMode";
import { StandingBanner } from "@/components/StandingBanner";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { formatCC, formatDC } from "@/lib/format";
import {
  LogOut,
  Wallet,
  Trophy,
  Store,
  Pickaxe,
  FileSpreadsheet,
  Loader2,
  Lock,
  Repeat,
  Sprout,
} from "lucide-react";

const NAV: Array<{
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  soon?: boolean;
}> = [
  { href: "/dashboard", label: "Wallet", icon: Wallet },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/market", label: "Market", icon: Store },
  { href: "/mine", label: "Mine", icon: Pickaxe },
  { href: "/convert", label: "Convert", icon: Repeat },
  { href: "/fund", label: "Fund", icon: Sprout },
  { href: "/ledger", label: "Ledger", icon: FileSpreadsheet },
];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {children}
    </main>
  );
}

/**
 * First-load skeleton: renders the real shell chrome (logo + nav layout)
 * immediately and shimmers only the data-dependent parts, so the app feels
 * instant instead of a full-page "Loading…" spinner while auth + /api/me resolve.
 */
function LoadingShell() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 py-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <CoinLogo size={36} />
            <span className="font-display text-lg font-semibold tracking-tight">
              Capsule<span className="text-gold-400">Coin</span>
            </span>
          </div>
          <Skeleton className="hidden h-7 w-44 rounded-capsule md:block" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="hidden h-6 w-28 rounded-capsule sm:block" />
          <div className="hidden space-y-1.5 sm:block">
            <Skeleton className="ml-auto h-3.5 w-28" />
            <Skeleton className="ml-auto h-3 w-40" />
          </div>
          <Skeleton className="h-9 w-9 rounded-capsule sm:w-24" />
        </div>
      </header>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {NAV.map((item) => (
          <Skeleton
            key={item.href}
            className="h-9 w-28 shrink-0 rounded-capsule"
          />
        ))}
      </nav>

      <main className="mt-6 space-y-4">
        <Skeleton className="h-40 w-full rounded-capsule" />
        <Skeleton className="h-28 w-full rounded-capsule" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-capsule" />
          <Skeleton className="h-24 rounded-capsule" />
          <Skeleton className="h-24 rounded-capsule" />
        </div>
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, member, email, signOut, lock, locked } = useAuth();
  const { data: transfers } = useTransfers();
  const { negotiations } = useNegotiations();
  const router = useRouter();
  const pathname = usePathname();
  const pendingForMe = transfers?.pendingForMe ?? 0;
  const negotiateForMe = (negotiations ?? []).filter((n) => n.yourTurn).length;
  // The Market nav pill flags anything on the member: transfer approvals + haggles awaiting their move.
  const marketBadge = pendingForMe + negotiateForMe;
  // Your own profile — same /member/<slug> route the leaderboard rows link to.
  const meSlug = (member?.email || email || "").split("@")[0];

  useEffect(() => {
    if (status === "signedOut" || (status === "member" && locked)) {
      router.replace("/login");
    }
  }, [status, locked, router]);

  // First load (auth + member resolving): show the skeleton shell.
  if (status === "loading") {
    return <LoadingShell />;
  }

  // Transient — the effect above redirects these to /login.
  if (status === "signedOut" || (status === "member" && locked)) {
    return (
      <Centered>
        <Loader2 size={26} className="animate-spin text-gold-400" />
      </Centered>
    );
  }

  if (status === "notMember") {
    return (
      <Centered>
        <div className="capsule-card max-w-md p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-capsule bg-red-500/15 text-red-300">
            <Lock size={26} />
          </div>
          <h1 className="mt-5 text-xl font-semibold text-white">
            Not a Capsule member
          </h1>
          <p className="mt-2 text-sm text-mute">
            <span className="text-white">{email}</span> isn&apos;t on the member
            allowlist, so there&apos;s no wallet here. If this is a mistake, ask
            an admin to check the list.
          </p>
          <button onClick={() => void signOut()} className="btn-ghost mt-6">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        {/* brand + the "money" zone: CC live value and your DC balance, grouped */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <CoinLogo size={36} />
            <span className="font-display text-lg font-semibold tracking-tight">
              Capsule<span className="text-gold-400">Coin</span>
            </span>
          </Link>
          <Link href="/value" className="hidden md:inline-flex" aria-label="CC value history">
            <ValueTicker />
          </Link>
          <Link href="/value" className="md:hidden" aria-label="CC value history">
            <ValueTicker compact />
          </Link>
          <Link
            href="/dashboard"
            className="chip border-gold-500/30 text-gold-300 hover:text-gold-200"
            title="Your Capsule Coin balance — tap for your wallet"
          >
            <CoinLogo size={15} /> {formatCC(member?.balance ?? 0)}
            <span className="hidden sm:inline">CC</span>
          </Link>
          <Link
            href="/convert"
            className="chip border-ember-500/30 text-ember-300 hover:text-ember-200"
            title="Your Dark Capsule Coin — tap to convert"
          >
            <DarkCoinLogo size={16} /> {formatDC(member?.dcBalance ?? 0)}
            <span className="hidden sm:inline">DC</span>
          </Link>
        </div>

        {/* identity + actions */}
        <div className="flex shrink-0 items-center gap-2.5">
          <Link
            href={meSlug ? `/member/${meSlug}` : "/dashboard"}
            className="group hidden text-right md:block"
            aria-label="View your profile"
            title="View your profile"
          >
            <div className="text-sm font-medium leading-tight text-white transition-colors group-hover:text-gold-300">
              {member?.name}
            </div>
            <div className="text-xs text-mute">{member?.email}</div>
          </Link>
          <NotificationsBell transfers={transfers} />
          <button
            onClick={() => {
              lock();
              router.replace("/login");
            }}
            className="btn-ghost"
            aria-label="Sign out"
            title="Sign out — this device stays trusted, so you won't need to re-verify"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* nav pills */}
      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const base =
            "inline-flex items-center gap-2 whitespace-nowrap rounded-capsule px-4 py-2 text-sm transition";
          if (item.soon) {
            return (
              <span
                key={item.href}
                className={`${base} cursor-not-allowed border border-edge/60 text-mute/50`}
                title="Coming soon"
              >
                <item.icon size={16} /> {item.label}
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  soon
                </span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? `${base} bg-gold-500/15 text-gold-300 shadow-glow`
                  : `${base} border border-edge text-mute hover:text-white`
              }
            >
              <item.icon size={16} /> {item.label}
              {item.href === "/market" && marketBadge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-ink-900">
                  {marketBadge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <main key={pathname} className="mt-6 animate-rise">
        <StandingBanner />
        {children}
      </main>

      <StoryMode />
    </div>
  );
}
