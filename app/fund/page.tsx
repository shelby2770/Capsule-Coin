"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { formatBdt, formatDC, toBanglaDigits } from "@/lib/format";
import { Apple, Crown, Loader2, Plus, Sparkles, Sprout } from "lucide-react";

type Fund = {
  totalBdt: number;
  contributions: number;
  ministerEmail: string;
  ministerName: string;
};
type Pricing = {
  bdtPerCC: number;
  perDcCc: number;
  bdtPerDc: number;
  multiplier: number;
  supply: number;
  tiers: Array<{ bdt: number; dc: number }>;
};
type Row = { name: string; email: string };

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
          At today&apos;s market price —{" "}
          <span className="font-semibold text-ember-300">
            1 DC ≈ ৳{pricing ? formatBdt(pricing.bdtPerDc) : "—"}
          </span>{" "}
          {pricing && (
            <>({pricing.perDcCc} CC each · scarcity ×{pricing.multiplier})</>
          )}
          . Tracks the live CC rate and DC scarcity, so it moves with the market.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(pricing?.tiers ?? [{ bdt: 100, dc: 0 }, { bdt: 200, dc: 0 }, { bdt: 500, dc: 0 }, { bdt: 1000, dc: 0 }]).map(
            (t) => (
              <div
                key={t.bdt}
                className="rounded-2xl border border-ember-500/20 bg-ember-500/[0.06] p-4 text-center"
              >
                <div className="font-display text-lg font-semibold text-white">
                  ৳{toBanglaDigits(t.bdt.toLocaleString())}
                </div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-mute">
                  buys
                </div>
                <div className="mt-1 font-display text-xl font-bold text-gradient-ember">
                  {pricing ? formatDC(t.dc) : "—"}
                </div>
                <div className="text-[11px] font-semibold text-ember-300/80">DC</div>
              </div>
            ),
          )}
        </div>

        <p className="mt-3 text-[11px] text-mute">
          A guide only — {ministerName} records the actual DC and taka for each
          purchase.
        </p>
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
