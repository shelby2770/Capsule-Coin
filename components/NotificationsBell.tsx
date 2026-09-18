"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ArrowDownLeft,
  ArrowUpRight,
  Pickaxe,
  Gamepad2,
  Flame,
  AlertTriangle,
  Ban,
  Inbox,
  Tag,
  HandCoins,
  Handshake,
  Store,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useTransactions } from "@/lib/useTransactions";
import { useBootstrap } from "@/components/BootstrapProvider";
import { formatCC, formatDC, balanceStanding } from "@/lib/format";
import type {
  TransactionPublic,
  TransfersResponse,
  OfferFeedItem,
} from "@/lib/types";

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

const FEED_TYPES = new Set(["MINE", "GAME", "TRANSFER", "TRADE", "BURN"]);

/**
 * Notifications: a header bell with a badge and three feeds —
 *  1. items needing action (pending transfer approvals + a near-bankrupt warning),
 *  2. NEW IN THE MARKET — a group-wide broadcast of offers other members just
 *     posted (sales + buy requests), so everyone hears about a new listing, with
 *     an unseen count tracked per viewer in localStorage, and
 *  3. the member's own recent activity (received/sent CC, trades, mining).
 */
export function NotificationsBell({
  transfers,
}: {
  transfers: TransfersResponse | null;
}) {
  const { member } = useAuth();
  // Recent transactions + the marketplace broadcast feed come from the shared
  // /api/bootstrap payload (no extra fetch; it auto-refreshes on focus/interval).
  const { transactions } = useTransactions();
  const { recentOffers, negotiations } = useBootstrap();
  const txs = transactions ?? [];
  const me = member?.email ?? "";
  const [open, setOpen] = useState(false);
  // Per-viewer "seen" watermark (ms) for the market feed, persisted in localStorage.
  const [lastSeen, setLastSeen] = useState(0);
  const seenAtOpenRef = useRef(0);
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

  // Load the persisted watermark. A first-ever load starts clean (watermark =
  // now), so a new member isn't greeted by a badge for every existing offer —
  // only offers posted from here on notify them.
  useEffect(() => {
    if (!me) return;
    const key = `cc:seenOffers:${me}`;
    try {
      const v = localStorage.getItem(key);
      let w: number;
      if (v != null) {
        w = Number(v) || 0;
      } else {
        w = Date.now();
        localStorage.setItem(key, String(w));
      }
      setLastSeen(w);
      seenAtOpenRef.current = w; // so the first open doesn't flash old offers as "new"
    } catch {
      // Private mode / storage blocked — treat everything as already seen so the
      // badge never gets stuck on.
      const w = Date.now();
      setLastSeen(w);
      seenAtOpenRef.current = w;
    }
  }, [me]);

  // Offers posted by OTHERS, newest first — "what the group just listed".
  const marketFeed = useMemo(
    () =>
      (recentOffers ?? [])
        .filter((o) => o.creatorEmail !== me)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [recentOffers, me],
  );
  const unseenCount = useMemo(
    () => marketFeed.filter((o) => Date.parse(o.createdAt) > lastSeen).length,
    [marketFeed, lastSeen],
  );

  // Opening the bell marks the market feed as seen. Snapshot the pre-open
  // watermark first so items stay highlighted "new" for this viewing.
  useEffect(() => {
    if (!open) return;
    seenAtOpenRef.current = lastSeen;
    const newest = marketFeed.reduce(
      (mx, o) => Math.max(mx, Date.parse(o.createdAt)),
      lastSeen,
    );
    if (newest > lastSeen) {
      setLastSeen(newest);
      try {
        localStorage.setItem(`cc:seenOffers:${me}`, String(newest));
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pending = transfers?.incoming ?? [];
  const negYourTurn = (negotiations ?? []).filter(
    (n) => n.status === "OPEN" && n.yourTurn,
  );
  const standing = balanceStanding(member?.balance ?? 0, member?.banned ?? false);
  const creditAlert = standing !== "ok";
  const actionCount = pending.length + negYourTurn.length + (creditAlert ? 1 : 0);
  // The bell badge sums everything notable: things needing action + unseen offers.
  const badgeCount = actionCount + unseenCount;

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
    if (t.type === "GAME")
      return { Icon: Gamepad2, tone: "text-ember-300", text: `Won ${amt(t)}${memo}` };
    if (t.type === "BURN")
      return { Icon: Flame, tone: "text-orange-300", text: `Burned ${formatCC(t.amountCC)} CC to unlock mining` };
    if (t.toEmail === me)
      return { Icon: ArrowDownLeft, tone: "text-teal-300", text: `Received ${amt(t)} from ${niceName(t.fromEmail)}${memo}` };
    return { Icon: ArrowUpRight, tone: "text-gold-300", text: `Sent ${amt(t)} to ${niceName(t.toEmail)}${memo}` };
  }

  const marketShown = marketFeed.slice(0, 6);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-ghost relative px-2.5"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={16} />
        {badgeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-ink-900">
            {badgeCount > 9 ? "9+" : badgeCount}
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
            {(pending.length > 0 || creditAlert || negYourTurn.length > 0) && (
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
                  {negYourTurn.map((n) => (
                    <Link
                      key={n.id}
                      href="/market"
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 rounded-xl border border-gold-500/25 bg-gold-500/10 p-3 text-sm text-gold-200 transition hover:bg-gold-500/15"
                    >
                      <Handshake size={16} className="mt-0.5 shrink-0 text-gold-300" />
                      <span className="flex-1">
                        {n.role === "seller" ? (
                          <>
                            <span className="font-medium">{n.buyerName}</span> offers{" "}
                            <span className="font-semibold">{formatCC(n.currentPriceCC)} CC</span>{" "}
                            for {n.itemName}
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{n.sellerName}</span> countered{" "}
                            <span className="font-semibold">{formatCC(n.currentPriceCC)} CC</span>{" "}
                            for {n.itemName}
                          </>
                        )}{" "}
                        — tap to respond
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {marketShown.length > 0 && (
              <div className="border-b border-white/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-mute">
                    <Store size={12} /> New in the market
                  </div>
                  {unseenCount > 0 && (
                    <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold text-gold-300">
                      {unseenCount} new
                    </span>
                  )}
                </div>
                <ul className="mt-1 divide-y divide-white/5">
                  {marketShown.map((o) => (
                    <MarketRow
                      key={o.id}
                      offer={o}
                      isNew={Date.parse(o.createdAt) > seenAtOpenRef.current}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </ul>
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

/** One broadcast offer row: a member's new sale or buy request. */
function MarketRow({
  offer,
  isNew,
  onNavigate,
}: {
  offer: OfferFeedItem;
  isNew: boolean;
  onNavigate: () => void;
}) {
  const isSell = offer.type === "SELL";
  const Icon = isSell ? Tag : HandCoins;
  const tone = isSell ? "text-gold-300" : "text-teal-300";
  return (
    <li>
      <Link
        href="/market"
        onClick={onNavigate}
        className="-mx-1 flex items-start gap-2.5 rounded-lg px-1 py-2.5 transition hover:bg-white/5"
      >
        <Icon size={15} className={`mt-0.5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug text-white/90">
            <span className="font-medium">{offer.creatorName}</span>{" "}
            {isSell ? "listed" : "wants"}{" "}
            <span className="text-white">{offer.itemName}</span>
            {" · "}
            <span className={isSell ? "text-gold-300" : "text-teal-300"}>
              {formatCC(offer.priceCC)} CC
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute">
            <span>{isSell ? "For sale" : "Wanted"}</span>
            <span className="text-mute/50">·</span>
            <span>{timeAgo(offer.createdAt)}</span>
          </div>
        </div>
        {isNew && (
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400"
            aria-label="new"
          />
        )}
      </Link>
    </li>
  );
}
