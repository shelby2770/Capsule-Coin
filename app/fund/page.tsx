"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { formatBdt, formatDC, toBanglaDigits } from "@/lib/format";
import { Apple, Banknote, Crown, Loader2, Plus, Sparkles, Sprout } from "lucide-react";

type Purchase = {
  name: string;
  dc: number;
  bdt: number;
  note: string;
  createdAt: string;
};
type Fund = {
  totalBdt: number;
  contributions: number;
  ministerEmail: string;
  ministerName: string;
  recent: Purchase[];
};
type Pricing = {
  bdtPerCC: number;
  baseBdtPerDc: number;
  supply: number;
  tiers: Array<{ bdt: number; dc: number; bonusPct: number }>;
};
type Row = { name: string; email: string };

function timeAgo(iso: string) {
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

export default function FundPage() {
  return (
    <AppShell>
      <Fund />
    </AppShell>
  );
}

function Fund() {
  const { authedFetch, refresh } = useAuth();
  const [fund, setFund] = useState<Fund | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [isMinister, setIsMinister] = useState(false);
  const [members, setMembers] = useState<Row[]>([]);

  const [target, setTarget] = useState("");
  const [dcAmount, setDcAmount] = useState("");
  const [bdtPaid, setBdtPaid] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/dc/buy");
      if (r.ok) {
        const d = await r.json();
        setFund(d.fund as Fund);
        setPricing(d.pricing as Pricing);
        setIsMinister(Boolean(d.isMinister));
        if (d.isMinister) {
          const lr = await authedFetch("/api/leaderboard");
          if (lr.ok) {
            const ld = await lr.json();
            setMembers(
              (ld.rows as Row[]).map((x) => ({ name: x.name, email: x.email })),
            );
          }
        }
      }
    } catch {
      /* ignore */
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const dc = Number(dcAmount);
  const bdt = Number(bdtPaid);
  const valid =
    target && Number.isFinite(dc) && dc > 0 && Number.isFinite(bdt) && bdt >= 0;

  const record = async () => {
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/dc/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEmail: target, dcAmount: dc, bdtPaid: bdt, note }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({
          kind: "ok",
          text: `Credited ${formatDC(d.dcCredited)} DC. Fruit Fund is now ৳${toBanglaDigits(d.fruitFundBdt)}.`,
        });
        setDcAmount("");
        setBdtPaid("");
        setNote("");
        await load();
        await refresh();
      } else {
        setMsg({ kind: "err", text: d.message || "Could not record purchase." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error — try again." });
    }
    setBusy(false);
  };

  const ministerName = fund?.ministerName || "the Fruit Minister";

  return (
    <div className="stagger space-y-4">
      <div className="capsule-card overflow-hidden p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300">
            <Sprout size={22} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-white">
              Capsule Fruit Fund
            </h1>
            <p className="text-xs text-mute">
              Every DC bought with real money ripens this fund.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-end gap-3">
          <Apple size={26} className="mb-1 text-teal-400" />
          <span className="font-display text-4xl font-semibold text-white">
            ৳{fund ? toBanglaDigits(fund.totalBdt.toLocaleString()) : "—"}
          </span>
          <span className="mb-1 text-sm text-mute">
            from {fund?.contributions ?? 0} purchase{fund?.contributions === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* The Fruit Minister — keeper of the fund */}
      <div className="relative overflow-hidden rounded-[28px] border border-gold-500/25 bg-gradient-to-br from-gold-500/[0.12] via-ink-700/70 to-teal-500/[0.06] p-6 shadow-glow">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-500/30 to-teal-500/15 text-gold-300 shadow-glow">
            <Crown size={30} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300/90">
              <Sparkles size={12} /> Fruit Minister
            </div>
            <h2 className="mt-1 truncate font-display text-2xl font-bold text-white">
              {ministerName}
            </h2>
            <p className="mt-0.5 text-xs text-mute">
              Keeper of the Capsule Fruit Fund — every taka spent on DC ripens in
              his care.
            </p>
          </div>
        </div>
      </div>

      {/* Buy DC at today's market price */}
      <div className="dc-card p-6">
        <div className="flex items-center gap-2">
          <DarkCoinLogo size={20} />
          <h2 className="font-display text-lg font-semibold text-white">
            Buy DC with taka
          </h2>
        </div>
        <p className="mt-1 text-xs text-mute">
          Buy more, get more —{" "}
          <span className="font-semibold text-flame">
            the more taka you invest, the better your DC rate
          </span>
          {pricing ? <> (small buys ≈ ৳{formatBdt(pricing.baseBdtPerDc)}/DC)</> : null}. Tracks the live CC
          price and DC scarcity, so it moves with the market.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(pricing?.tiers ?? [
            { bdt: 100, dc: 0, bonusPct: 0 },
            { bdt: 200, dc: 0, bonusPct: 0 },
            { bdt: 500, dc: 0, bonusPct: 0 },
            { bdt: 1000, dc: 0, bonusPct: 0 },
          ]).map((t) => (
            <div
              key={t.bdt}
              className="relative rounded-2xl border border-ember-500/20 bg-ember-500/[0.06] p-4 text-center"
            >
              {t.bonusPct > 0 && (
                <span className="absolute right-2 top-2 rounded-full border border-ember-500/40 bg-ember-500/10 px-1.5 py-0.5 text-[10px] font-bold text-flame">
                  +{t.bonusPct}%
                </span>
              )}
              <div className="font-display text-lg font-semibold text-white">
                ৳{toBanglaDigits(t.bdt.toLocaleString())}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-mute">
                buys
              </div>
              <div className="mt-1 font-display text-xl font-bold text-gradient-flame">
                {pricing ? formatDC(t.dc) : "—"}
              </div>
              <div className="text-[11px] font-semibold text-flame/80">DC</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-mute">
          A guide only — {ministerName} records the actual DC and taka for each
          purchase.
        </p>
      </div>

      {/* Recent real-money DC purchases */}
      <div className="capsule-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Banknote size={16} className="text-teal-400" /> Recent purchases
          </h2>
          <span className="text-xs text-mute">{fund?.contributions ?? 0} total</span>
        </div>
        {(fund?.recent?.length ?? 0) === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-mute">
            No DC has been bought with real money yet.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {fund!.recent.map((p, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-ember-500/10">
                  <DarkCoinLogo size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">
                    {p.name}
                    {p.note && <span className="text-mute"> · {p.note}</span>}
                  </div>
                  <div className="text-[11px] text-mute">{timeAgo(p.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-flame">
                    +{formatDC(p.dc)} <span className="text-xs text-mute">DC</span>
                  </div>
                  <div className="text-[11px] text-teal-300/80">
                    ৳{formatBdt(p.bdt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isMinister && (
        <div className="dc-card p-6">
          <h2 className="font-display text-lg font-semibold text-white">
            Record a DC purchase
          </h2>
          <p className="mt-1 text-xs text-mute">
            Money is handled offline — this credits the buyer&apos;s DC and adds the
            taka to the fund.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-mute">Buyer</span>
              <select
                className="field dc-ring mt-1"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select a member…</option>
                {members.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-mute">DC to credit</span>
              <input
                className="field dc-ring mt-1"
                inputMode="decimal"
                value={dcAmount}
                onChange={(e) => setDcAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-mute">Taka paid (৳)</span>
              <input
                className="field dc-ring mt-1"
                inputMode="decimal"
                value={bdtPaid}
                onChange={(e) => setBdtPaid(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-mute">Note (optional)</span>
              <input
                className="field dc-ring mt-1"
                value={note}
                maxLength={80}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          <button
            className="btn-ember dc-ring mt-4"
            onClick={record}
            disabled={!valid || busy}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {busy ? "Recording…" : "Credit DC + add to fund"}
          </button>

          {msg && (
            <div
              className={`mt-3 rounded-xl border p-3 text-sm ${
                msg.kind === "ok"
                  ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200"
              }`}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
