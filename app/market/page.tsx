"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { useOffers } from "@/lib/useOffers";
import { useValue } from "@/lib/useValue";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { useTransfers } from "@/lib/useTransfers";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatCC, round2 } from "@/lib/format";
import type {
  OfferPublic,
  OfferType,
  TransferRequestPublic,
} from "@/lib/types";
import {
  Store,
  Plus,
  Tag,
  ShoppingCart,
  HandCoins,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Ban,
  Wallet,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Send,
  Inbox,
  Search,
  ArrowUpDown,
  ChevronDown,
} from "lucide-react";

/** Compact relative time for offer age, e.g. "2h ago". */
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

type OfferSort = "new" | "price-asc" | "price-desc";
type OfferTypeFilter = "ALL" | "SELL" | "BUY";

export default function MarketPage() {
  return (
    <AppShell>
      <Market />
    </AppShell>
  );
}

type View = "offers" | "transfers";

function Market() {
  const { member } = useAuth();
  const { data: transfers } = useTransfers();
  const [view, setView] = useState<View>("offers");
  const balance = member?.balance ?? 0;
  const pendingForMe = transfers?.pendingForMe ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          <Store size={22} className="text-gold-400" /> Marketplace
        </h1>
        <span className="chip">
          <Wallet size={14} className="text-gold-400" />
          {formatCC(balance)} CC
        </span>
      </div>

      {/* view switch */}
      <div className="flex gap-2">
        <SwitchButton active={view === "offers"} onClick={() => setView("offers")}>
          <Store size={15} /> Offers
        </SwitchButton>
        <SwitchButton
          active={view === "transfers"}
          onClick={() => setView("transfers")}
        >
          <ArrowLeftRight size={15} /> Transfers
          {pendingForMe > 0 && (
            <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-ink-900">
              {pendingForMe}
            </span>
          )}
        </SwitchButton>
      </div>

      {view === "offers" ? <OffersView /> : <TransfersView />}
    </div>
  );
}

function SwitchButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-capsule px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-gold-500/15 text-gold-300 shadow-glow"
          : "border border-edge text-mute hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ── Offers marketplace ───────────────────────────────────────────────────────
type Busy = { id: string; action: "accept" | "cancel" } | null;

function OffersView() {
  const { member, refresh: refreshMe, authedFetch } = useAuth();
  const { offers, loading, error, refresh } = useOffers();
  const { data: value } = useValue();
  const floor = value?.balanceFloor ?? -500;
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<OfferTypeFilter>("ALL");
  const [sort, setSort] = useState<OfferSort>("new");

  const myEmail = member?.email ?? "";
  const balance = member?.balance ?? 0;

  const browse = useMemo(
    () =>
      (offers ?? []).filter(
        (o) => o.status === "OPEN" && o.creatorEmail !== myEmail,
      ),
    [offers, myEmail],
  );
  const mine = useMemo(
    () =>
      (offers ?? [])
        .filter((o) => o.creatorEmail === myEmail)
        .sort(
          (a, b) =>
            (a.status === "OPEN" ? -1 : 1) - (b.status === "OPEN" ? -1 : 1),
        ),
    [offers, myEmail],
  );

  async function act(id: string, action: "accept" | "cancel") {
    setBusy({ id, action });
    setActionError(null);
    try {
      const res = await authedFetch(`/api/offers/${id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.message || "That didn't work. Try refreshing.");
      } else {
        await Promise.all([refresh(), refreshMe()]);
        emitLedgerChange();
      }
    } catch {
      setActionError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const baseList = tab === "browse" ? browse : mine;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = baseList.filter((o) => {
      if (typeFilter !== "ALL" && o.type !== typeFilter) return false;
      if (!q) return true;
      return (
        o.itemName.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        o.creatorName.toLowerCase().includes(q)
      );
    });
    return [...arr].sort((a, b) => {
      if (sort === "price-asc") return a.priceCC - b.priceCC;
      if (sort === "price-desc") return b.priceCC - a.priceCC;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [baseList, query, typeFilter, sort]);
  const filtering = query.trim() !== "" || typeFilter !== "ALL";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
            Browse{offers ? ` (${browse.length})` : ""}
          </TabButton>
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
            My offers{offers ? ` (${mine.length})` : ""}
          </TabButton>
        </div>
        <button className="btn-gold" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? "Close" : "Post an offer"}
        </button>
      </div>

      {showForm && (
        <CreateOfferForm
          balance={balance}
          floor={floor}
          onDone={async () => {
            setShowForm(false);
            await Promise.all([refresh(), refreshMe()]);
            emitLedgerChange();
          }}
        />
      )}

      {actionError && (
        <div className="capsule-card flex items-center gap-2 p-3 text-sm text-red-300">
          <AlertCircle size={16} /> {actionError}
        </div>
      )}
      {error && (
        <div className="capsule-card flex items-center gap-2 p-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {offers && baseList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search item, category, member…"
              className="w-full rounded-full border border-edge bg-ink-900/60 py-2 pl-8 pr-8 text-sm text-white placeholder:text-mute focus:border-gold-500/50 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mute transition hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex gap-1.5">
            {(
              [
                ["ALL", "All"],
                ["SELL", "For sale"],
                ["BUY", "Wanted"],
              ] as [OfferTypeFilter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTypeFilter(k)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  typeFilter === k
                    ? "border-gold-500/40 bg-gold-500/20 text-gold-200"
                    : "border-edge text-mute hover:bg-white/5 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            <ArrowUpDown
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as OfferSort)}
              aria-label="Sort offers"
              className="appearance-none rounded-full border border-edge bg-ink-900/60 py-2 pl-8 pr-9 text-sm text-white focus:border-gold-500/50 focus:outline-none"
            >
              <option value="new">Newest</option>
              <option value="price-asc">Price: low → high</option>
              <option value="price-desc">Price: high → low</option>
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mute"
            />
          </div>
        </div>
      )}

      {filtering && baseList.length > 0 && (
        <p className="text-xs text-mute">
          {visible.length} of {baseList.length} offers
        </p>
      )}

      {loading && !offers ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-[28px] bg-white/5" />
          ))}
        </div>
      ) : baseList.length === 0 ? (
        <div className="capsule-card p-10 text-center text-mute">
          {tab === "browse"
            ? "No open offers right now. Be the first to post one!"
            : "You haven't posted any offers yet."}
        </div>
      ) : visible.length === 0 ? (
        <div className="capsule-card flex flex-col items-center gap-3 p-10 text-center text-mute">
          <span>No offers match your filters.</span>
          <button
            onClick={() => {
              setQuery("");
              setTypeFilter("ALL");
            }}
            className="btn-ghost"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              mine={tab === "mine"}
              balance={balance}
              floor={floor}
              busy={busy}
              onAct={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-capsule px-4 py-2 text-sm transition ${
        active
          ? "bg-gold-500/15 text-gold-300 shadow-glow"
          : "border border-edge text-mute hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function OfferCard({
  offer,
  mine,
  balance,
  floor,
  busy,
  onAct,
}: {
  offer: OfferPublic;
  mine: boolean;
  balance: number;
  floor: number;
  busy: Busy;
  onAct: (id: string, action: "accept" | "cancel") => void;
}) {
  const isSell = offer.type === "SELL";
  const working = busy?.id === offer.id;

  return (
    <div className="capsule-card card-hover flex flex-col p-5">
      <div className="flex items-center justify-between">
        <span
          className={`chip ${
            isSell
              ? "border-gold-500/40 text-gold-300"
              : "border-teal-500/40 text-teal-300"
          }`}
        >
          {isSell ? <Tag size={13} /> : <HandCoins size={13} />}
          {isSell ? "For sale" : "Wanted"}
        </span>
        <span className="chip">{offer.category}</span>
      </div>

      <h3 className="mt-3 truncate text-lg font-semibold text-white">
        {offer.itemName}
      </h3>
      {offer.description && (
        <p className="mt-1 line-clamp-2 text-sm text-mute">{offer.description}</p>
      )}

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gold-300">
          {formatCC(offer.priceCC)}
        </span>
        <span className="text-sm font-medium text-mute">CC</span>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-mute">
        <span className="truncate">
          {mine ? "Posted by you" : `by ${offer.creatorName}`}
        </span>
        <span className="text-mute/50">·</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <Clock size={11} /> {timeAgo(offer.createdAt)}
        </span>
      </p>

      <div className="mt-4 border-t border-white/5 pt-4">
        {mine ? (
          offer.status === "OPEN" ? (
            <button
              className="btn-ghost w-full text-red-300 hover:border-red-400/50 hover:text-red-200"
              disabled={working}
              onClick={() => onAct(offer.id, "cancel")}
            >
              {working ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Ban size={16} />
              )}
              Cancel{offer.type === "BUY" ? " · refund escrow" : ""}
            </button>
          ) : offer.status === "COMPLETED" ? (
            <p className="flex items-center gap-2 text-sm text-teal-300">
              <CheckCircle2 size={16} /> Completed with{" "}
              {offer.counterpartyName ?? "a member"}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-mute">
              <Ban size={16} /> Cancelled
            </p>
          )
        ) : isSell ? (
          <button
            className="btn-gold w-full"
            disabled={working || balance - offer.priceCC < floor}
            onClick={() => onAct(offer.id, "accept")}
          >
            {working ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ShoppingCart size={16} />
            )}
            {balance - offer.priceCC < floor
              ? `Over ${floor} CC limit`
              : `Buy · ${formatCC(offer.priceCC)} CC`}
          </button>
        ) : (
          <button
            className="btn-gold w-full"
            disabled={working}
            onClick={() => onAct(offer.id, "accept")}
          >
            {working ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <HandCoins size={16} />
            )}
            Fulfill · earn {formatCC(offer.priceCC)} CC
          </button>
        )}
      </div>
    </div>
  );
}

function CreateOfferForm({
  balance,
  floor,
  onDone,
}: {
  balance: number;
  floor: number;
  onDone: () => Promise<void>;
}) {
  const { authedFetch } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<OfferType>("SELL");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("Food");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Math.floor(Number(price));
  const priceValid = Number.isFinite(priceNum) && priceNum > 0;
  const escrowShort = type === "BUY" && priceValid && balance - priceNum < floor;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!itemName.trim() || !priceValid) {
      setError("Enter an item name and a positive whole-number price.");
      return;
    }
    if (escrowShort) {
      setError(`Escrowing that would drop you below the ${floor} CC floor.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          itemName: itemName.trim(),
          category: category.trim() || "Food",
          description: description.trim(),
          priceCC: priceNum,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast.show(data.message || "Too many posts — slow down.", "warn");
        } else {
          setError(data.message || "Couldn't post the offer.");
        }
        return;
      }
      setItemName("");
      setDescription("");
      setPrice("");
      await onDone();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="capsule-card space-y-4 p-6">
      <div className="grid grid-cols-2 gap-2">
        {(["SELL", "BUY"] as OfferType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              type === t
                ? "border-gold-500/60 bg-gold-500/10 text-gold-200"
                : "border-edge text-mute hover:text-white"
            }`}
          >
            {t === "SELL" ? "Sell an item" : "Buy request"}
            <span className="mt-0.5 block text-xs font-normal text-mute">
              {t === "SELL" ? "You have it, want CC" : "You want it, offer CC"}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-mute">Item</label>
          <input
            className="field"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. Homemade biryani"
            maxLength={80}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-mute">Category</label>
          <input
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Food"
            maxLength={40}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-mute">
          Description <span className="text-mute/60">(optional)</span>
        </label>
        <textarea
          className="field min-h-[70px] resize-y"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Portion size, spice level, pickup details…"
          maxLength={400}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-mute">Price (CC)</label>
        <input
          className="field"
          type="number"
          min={1}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="25"
        />
        {type === "BUY" && priceValid && (
          <p
            className={`mt-1.5 text-xs ${
              escrowShort ? "text-red-300" : "text-mute"
            }`}
          >
            {formatCC(priceNum)} CC will be escrowed from your balance until
            fulfilled or cancelled.{" "}
            {escrowShort && `— would pass your ${floor} CC floor.`}
          </p>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </p>
      )}

      <button
        type="submit"
        className="btn-gold w-full"
        disabled={submitting || escrowShort}
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Posting…
          </>
        ) : (
          <>
            <Plus size={16} /> Post {type === "SELL" ? "sale" : "buy request"}
          </>
        )}
      </button>
    </form>
  );
}

// ── Transfers (request → payer approval) ─────────────────────────────────────
function TransfersView() {
  const { member, refresh: refreshMe } = useAuth();
  const { data, loading, refresh } = useTransfers();
  const myEmail = member?.email ?? "";

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];
  const communityPending = (data?.pending ?? []).filter(
    (t) => t.fromEmail !== myEmail && t.toEmail !== myEmail,
  );
  const recent = data?.recent ?? [];

  async function afterChange() {
    await Promise.all([refresh(), refreshMe()]);
    emitLedgerChange();
  }

  return (
    <div className="space-y-5">
      <CreateTransferForm onDone={afterChange} />

      {loading && !data ? (
        <div className="capsule-card p-10 text-center text-mute">
          <Loader2 size={20} className="mx-auto animate-spin text-gold-400" />
        </div>
      ) : (
        <>
          <TransferSection
            title="Awaiting your approval"
            icon={Inbox}
            accent="gold"
            empty="No requests need your approval."
            items={incoming}
            myEmail={myEmail}
            onDone={afterChange}
          />
          <TransferSection
            title="Your pending requests"
            icon={Clock}
            empty="You have no pending requests."
            items={outgoing}
            myEmail={myEmail}
            onDone={afterChange}
          />
          <TransferSection
            title="Community pending"
            icon={ArrowLeftRight}
            empty="Nothing else pending across the group."
            items={communityPending}
            myEmail={myEmail}
            onDone={afterChange}
            readOnly
          />
          <TransferSection
            title="Recently settled"
            icon={CheckCircle2}
            empty="No settled transfers yet."
            items={recent}
            myEmail={myEmail}
            onDone={afterChange}
            readOnly
          />
        </>
      )}
    </div>
  );
}

function TransferSection({
  title,
  icon: Icon,
  accent,
  empty,
  items,
  myEmail,
  onDone,
  readOnly,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: "gold";
  empty: string;
  items: TransferRequestPublic[];
  myEmail: string;
  onDone: () => Promise<void>;
  readOnly?: boolean;
}) {
  if (items.length === 0) {
    return (
      <section>
        <SectionHead title={title} icon={Icon} accent={accent} count={0} />
        <p className="capsule-card p-5 text-center text-sm text-mute">{empty}</p>
      </section>
    );
  }
  return (
    <section>
      <SectionHead title={title} icon={Icon} accent={accent} count={items.length} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((t) => (
          <TransferCard
            key={t.id}
            t={t}
            myEmail={myEmail}
            onDone={onDone}
            readOnly={readOnly}
          />
        ))}
      </div>
    </section>
  );
}

function SectionHead({
  title,
  icon: Icon,
  accent,
  count,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: "gold";
  count: number;
}) {
  return (
    <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-white">
      <Icon size={16} className={accent === "gold" ? "text-gold-400" : "text-teal-400"} />
      {title}
      {count > 0 && <span className="text-xs font-normal text-mute">· {count}</span>}
    </h2>
  );
}

function statusChip(status: TransferRequestPublic["status"]) {
  switch (status) {
    case "APPROVED":
      return { label: "Settled", cls: "border-teal-500/40 text-teal-300" };
    case "DECLINED":
      return { label: "Declined", cls: "border-red-500/40 text-red-300" };
    case "CANCELLED":
      return { label: "Cancelled", cls: "border-white/15 text-mute" };
    case "EXPIRED":
      return { label: "Expired", cls: "border-white/15 text-mute" };
    default:
      return { label: "Pending", cls: "border-gold-500/40 text-gold-300" };
  }
}

function TransferCard({
  t,
  myEmail,
  onDone,
  readOnly,
}: {
  t: TransferRequestPublic;
  myEmail: string;
  onDone: () => Promise<void>;
  readOnly?: boolean;
}) {
  const { authedFetch } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chip = statusChip(t.status);

  async function act(action: "approve" | "decline" | "cancel") {
    setBusy(action);
    setErr(null);
    try {
      const res = await authedFetch(`/api/transfers/${t.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.message || "That didn't work.");
      } else {
        await onDone();
      }
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  const youPay = t.fromEmail === myEmail;
  const youReceive = t.toEmail === myEmail;

  return (
    <div className="capsule-card card-hover flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="truncate font-medium text-white">
              {youPay ? "You" : t.fromName}
            </span>
            <ArrowUpRight size={14} className="shrink-0 text-mute" />
            <span className="truncate font-medium text-white">
              {youReceive ? "You" : t.toName}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-mute">{t.item}</p>
        </div>
        <span className={`chip shrink-0 ${chip.cls}`}>{chip.label}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={`text-xl font-bold ${
            youReceive ? "text-teal-300" : youPay ? "text-gold-300" : "text-white"
          }`}
        >
          {youReceive ? "+" : youPay ? "−" : ""}
          {formatCC(t.amountCC)}
        </span>
        <span className="text-xs text-mute">CC</span>
      </div>
      {t.note && <p className="mt-1 line-clamp-2 text-xs text-mute">“{t.note}”</p>}

      {err && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
          <AlertCircle size={13} /> {err}
        </p>
      )}

      {!readOnly && t.status === "PENDING" && (t.canApprove || t.canCancel) && (
        <div className="mt-3 flex gap-2 border-t border-white/5 pt-3">
          {t.canApprove && (
            <>
              <button
                className="btn-gold flex-1 py-2 text-sm"
                disabled={!!busy}
                onClick={() => act("approve")}
              >
                {busy === "approve" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Approve
              </button>
              <button
                className="btn-ghost flex-1 py-2 text-sm text-red-300 hover:border-red-400/50 hover:text-red-200"
                disabled={!!busy}
                onClick={() => act("decline")}
              >
                {busy === "decline" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <X size={14} />
                )}
                Decline
              </button>
            </>
          )}
          {t.canCancel && (
            <button
              className="btn-ghost flex-1 py-2 text-sm"
              disabled={!!busy}
              onClick={() => act("cancel")}
            >
              {busy === "cancel" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Ban size={14} />
              )}
              Cancel request
            </button>
          )}
        </div>
      )}

      {t.status === "PENDING" && !t.canApprove && !t.canCancel && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-mute">
          <Clock size={13} /> Waiting on {t.fromName} to approve
        </p>
      )}
    </div>
  );
}

function CreateTransferForm({ onDone }: { onDone: () => Promise<void> }) {
  const { member, authedFetch } = useAuth();
  const toast = useToast();
  const { data: value } = useValue();
  const { data: board } = useLeaderboard();
  const floor = value?.balanceFloor ?? -500;
  const balance = member?.balance ?? 0;

  const [direction, setDirection] = useState<"REQUEST" | "SEND">("REQUEST");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [item, setItem] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const members = (board?.rows ?? []).filter((r) => !r.isYou);
  const amtNum = round2(Number(amount));
  const amtValid = Number.isFinite(amtNum) && amtNum > 0;
  const sendShort = direction === "SEND" && amtValid && balance - amtNum < floor;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!counterparty) return setError("Choose who this transfer is with.");
    if (!amtValid) return setError("Enter an amount greater than 0 CC.");
    if (!item.trim()) return setError("Say what the CC is for.");
    if (sendShort)
      return setError(`That would drop you below the ${floor} CC floor.`);
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          counterpartyEmail: counterparty,
          amountCC: amtNum,
          item: item.trim(),
          note: note.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          toast.show(d.message || "Too many requests — slow down.", "warn");
        } else {
          setError(d.message || "Couldn't create the transfer.");
        }
        return;
      }
      setAmount("");
      setItem("");
      setNote("");
      setOk(
        direction === "SEND"
          ? "Sent — CC moved and logged."
          : "Request sent — waiting for their approval.",
      );
      await onDone();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="capsule-card space-y-4 p-6">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            {
              key: "REQUEST",
              title: "Request CC",
              sub: "They pay you — needs their approval",
              icon: ArrowDownLeft,
            },
            {
              key: "SEND",
              title: "Send CC",
              sub: "You pay them — settles now",
              icon: Send,
            },
          ] as const
        ).map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDirection(d.key)}
            className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
              direction === d.key
                ? "border-gold-500/60 bg-gold-500/10 text-gold-200"
                : "border-edge text-mute hover:text-white"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <d.icon size={15} /> {d.title}
            </span>
            <span className="mt-0.5 block text-xs font-normal text-mute">
              {d.sub}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-mute">
            {direction === "REQUEST" ? "Who pays you" : "Who you pay"}
          </label>
          <select
            className="field"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          >
            <option value="">Select a member…</option>
            {members.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-mute">Amount (CC)</label>
          <input
            className="field"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="25"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-mute">For</label>
        <input
          className="field"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. Plate of biryani"
          maxLength={80}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-mute">
          Note <span className="text-mute/60">(optional)</span>
        </label>
        <input
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any detail…"
          maxLength={160}
        />
      </div>

      {direction === "SEND" && amtValid && (
        <p className={`text-xs ${sendShort ? "text-red-300" : "text-mute"}`}>
          {sendShort
            ? `That would drop you below the ${floor} CC floor.`
            : `${formatCC(amtNum)} CC will move to them immediately.`}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </p>
      )}
      {ok && (
        <p className="flex items-center gap-2 text-sm text-teal-300">
          <CheckCircle2 size={16} /> {ok}
        </p>
      )}

      <button
        type="submit"
        className="btn-gold w-full"
        disabled={submitting || sendShort}
      >
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : direction === "REQUEST" ? (
          <HandCoins size={16} />
        ) : (
          <Send size={16} />
        )}
        {direction === "REQUEST" ? "Request CC" : "Send CC"}
      </button>
    </form>
  );
}
