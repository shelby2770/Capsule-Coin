"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ArrowDownLeft,
  ArrowUpRight,
  Pickaxe,
  Flame,
  AlertTriangle,
  Ban,
  Inbox,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useTransactions } from "@/lib/useTransactions";
import { formatCC, formatDC, balanceStanding } from "@/lib/format";
import type { TransactionPublic, TransfersResponse } from "@/lib/types";

/** Emails are firstname.lastname@… — derive a display name without an extra fetch. */
function niceName(email: string | null): string {
  if (!email) return "someone";
  return email
    .split("@")[0]
    .split(".")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const FEED_TYPES = new Set(["MINE", "TRANSFER", "TRADE", "BURN"]);

/**
 * Notifications: a header bell with a badge for items needing action (pending
 * transfer approvals + a near-bankrupt warning) and a feed of the member's
 * recent activity (received/sent CC, offer trades, mining).
 */
export function NotificationsBell({
  transfers,
}: {
  transfers: TransfersResponse | null;
}) {
  const { member } = useAuth();
  // Recent transactions come from the shared /api/bootstrap payload (no extra fetch).
  const { transactions } = useTransactions();
  const txs = transactions ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const me = member?.email ?? "";
  const pending = transfers?.incoming ?? [];
  const standing = balanceStanding(member?.balance ?? 0, member?.banned ?? false);
  const creditAlert = standing !== "ok";
  const actionCount = pending.length + (creditAlert ? 1 : 0);

  const recent = [...txs]
    .filter((t) => FEED_TYPES.has(t.type))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 8);

  const amt = (t: TransactionPublic) =>
    t.currency === "DC" ? `${formatDC(t.amountCC)} DC` : `${formatCC(t.amountCC)} CC`;

  function describe(t: TransactionPublic) {
    const memo = t.memo ? ` · ${t.memo}` : "";
    if (t.type === "MINE")
      return { Icon: Pickaxe, tone: "text-ember-300", text: `Mined ${amt(t)}${memo}` };
    if (t.type === "BURN")
      return { Icon: Flame, tone: "text-orange-300", text: `Burned ${formatCC(t.amountCC)} CC to unlock mining` };
    if (t.toEmail === me)
      return { Icon: ArrowDownLeft, tone: "text-teal-300", text: `Received ${amt(t)} from ${niceName(t.fromEmail)}${memo}` };
    return { Icon: ArrowUpRight, tone: "text-gold-300", text: `Sent ${amt(t)} to ${niceName(t.toEmail)}${memo}` };
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-ghost relative px-2.5"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={16} />
        {actionCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-ink-900">
            {actionCount > 9 ? "9+" : actionCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(23rem,92vw)] overflow-hidden rounded-2xl border border-edge bg-ink-800 shadow-panel">
          <div className="flex items-center justify-between border-b border-white/10 bg-ink-900/60 px-4 py-3">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {actionCount > 0 && (
              <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold text-gold-300">
                {actionCount} need{actionCount === 1 ? "s" : ""} action
              </span>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {(pending.length > 0 || creditAlert) && (
              <div className="border-b border-white/5 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-mute">
                  Needs your action
                </div>
                <div className="mt-2 space-y-2">
                  {standing === "frozen" && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                      <Ban size={16} className="mt-0.5 shrink-0" />
                      <span>
                        Account frozen — you dropped below −500 CC and the recovery
                        window passed. Ask an admin to restore access.
                      </span>
                    </div>
                  )}
                  {standing === "bankrupt" && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-ember-500/40 bg-ember-500/10 p-3 text-sm text-ember-300">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        Below the −500 CC floor ({formatCC(member?.balance ?? 0)} CC) —
                        sell or convert DC → CC before the grace deadline.
                      </span>
                    </div>
                  )}
                  {standing === "warn" && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        You&apos;re near the −500 CC floor ({formatCC(member?.balance ?? 0)} CC) —
                        earn or collect CC to recover.
                      </span>
                    </div>
                  )}
                  {pending.map((p) => (
                    <Link
                      key={p.id}
                      href="/market"
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 rounded-xl border border-gold-500/25 bg-gold-500/10 p-3 text-sm text-gold-200 transition hover:bg-gold-500/15"
                    >
                      <Inbox size={16} className="mt-0.5 shrink-0 text-gold-300" />
                      <span className="flex-1">
                        <span className="font-medium">{p.toName}</span> requested{" "}
                        <span className="font-semibold">{formatCC(p.amountCC)} CC</span>
                        {p.item ? ` for ${p.item}` : ""} — tap to approve or decline
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-mute">
                Recent activity
              </div>
              {recent.length === 0 ? (
                <div className="mt-2 text-sm text-mute">
                  Nothing yet — mine or trade to get started.
                </div>
              ) : (
                <ul className="mt-1 divide-y divide-white/5">
                  {recent.map((t) => {
                    const d = describe(t);
                    return (
                      <li key={t.id} className="flex items-start gap-2.5 py-2.5">
                        <d.Icon size={15} className={`mt-0.5 shrink-0 ${d.tone}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-snug text-white/90">{d.text}</div>
                          <div className="mt-0.5 text-[11px] text-mute">
                            {timeAgo(t.createdAt)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
