"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { StandingBanner } from "@/components/StandingBanner";
import { DcRateChart } from "@/components/DcRateChart";
import { useDcRateHistory, type DcRateRange } from "@/lib/useDcRateHistory";
import { useDcRate } from "@/lib/useDcRate";
import { formatCC, formatDC, round2 } from "@/lib/format";
import {
  Repeat,
  Flame,
  Loader2,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  LineChart,
} from "lucide-react";

type Quote = { cc: number; perDc: number; multiplier: number };
type Status = {
  dcBalance: number;
  ccBalance: number;
  supply: number;
  minConvert: number;
  dailyCapDc: number;
  convertedToday: number;
  remainingToday: number;
  quote: Quote;
};

export default function ConvertPage() {
  return (
    <AppShell>
      <Convert />
    </AppShell>
  );
}

function Convert() {
  const { authedFetch, refresh } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/convert");
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      /* ignore */
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live, debounced quote as the amount changes.
  useEffect(() => {
    const x = Number(amount);
    if (!Number.isFinite(x) || x <= 0) {
      setQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await authedFetch(`/api/convert?dc=${encodeURIComponent(x)}`);
        if (r.ok) setQuote(((await r.json()) as Status).quote);
      } catch {
        /* ignore */
      }
    }, 220);
    return () => clearTimeout(t);
  }, [amount, authedFetch]);

  const dc = status?.dcBalance ?? 0;
  const minConvert = status?.minConvert ?? 1;
  const remainingToday = status?.remainingToday ?? 0;
  const x = Number(amount);
  const capReached = status ? remainingToday <= 0 : false;
  const overCap = Number.isFinite(x) && x > remainingToday;
  const valid =
    Number.isFinite(x) && x >= minConvert && x <= dc && x <= remainingToday;

  const setPct = (p: number) =>
    setAmount(String(round2(Math.min(dc, remainingToday) * p)));

  const convert = async () => {
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dcAmount: x }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({
          kind: "ok",
          text: `Converted ${formatDC(d.dcSpent)} DC → ${formatCC(d.ccReceived)} CC.`,
        });
        setAmount("");
        setQuote(null);
        await load();
        await refresh();
      } else {
        setMsg({ kind: "err", text: d.message || "Conversion failed." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error — try again." });
    }
    setBusy(false);
  };

  return (
    <div className="stagger space-y-4">
      <StandingBanner />

      <div className="dc-card p-6">
        <div className="flex items-center gap-3">
          <DarkCoinLogo size={34} glow />
          <div>
            <h1 className="font-display text-xl font-semibold text-white">
              Convert <span className="text-gradient-ember">DC → CC</span>
            </h1>
            <p className="text-xs text-mute">
              Bigger conversions earn a better rate; scarcer DC is worth more CC.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Your DC" value={`${formatDC(dc)}`} ember />
          <Stat label="Your CC" value={formatCC(status?.ccBalance ?? 0)} />
          <Stat label="DC in market" value={formatDC(status?.supply ?? 0)} />
          <Stat label="Left today" value={formatDC(remainingToday)} />
        </div>
      </div>

      <div className="dc-card p-6">
        <label className="text-sm font-medium text-white">Amount to convert (DC)</label>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="field dc-ring"
            inputMode="decimal"
            placeholder={`min ${minConvert}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            disabled={busy || capReached}
          />
          <div className="flex gap-1">
            {[0.25, 0.5, 1].map((p) => (
              <button
                key={p}
                className="chip dc-ring hover:text-white"
                onClick={() => setPct(p)}
                disabled={busy || capReached || dc <= 0}
              >
                {p === 1 ? "Max" : `${p * 100}%`}
              </button>
            ))}
          </div>
        </div>

        {/* quote */}
        <div className="mt-4 rounded-2xl border border-ember-500/20 bg-ember-500/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-mute">You receive</span>
            <span className="font-display text-2xl font-semibold text-gradient-ember">
              {quote ? `${formatCC(quote.cc)} CC` : "—"}
            </span>
          </div>
          {quote && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
              <span>Rate {quote.perDc} CC / DC</span>
              <span className="inline-flex items-center gap-1">
                {quote.multiplier >= 1 ? (
                  <TrendingUp size={13} className="text-teal-400" />
                ) : (
                  <TrendingDown size={13} className="text-ember-400" />
                )}
                supply ×{quote.multiplier}
              </span>
            </div>
          )}
        </div>

        {overCap && !capReached && (
          <p className="mt-3 text-xs text-ember-300">
            Over today&apos;s remaining allowance ({formatDC(remainingToday)} DC).
          </p>
        )}
        {capReached && (
          <p className="mt-3 text-xs text-ember-300">
            You&apos;ve hit today&apos;s conversion cap ({formatDC(status?.dailyCapDc ?? 0)} DC). Try again tomorrow.
          </p>
        )}

        <button
          className="btn-ember dc-ring mt-4 w-full"
          onClick={convert}
          disabled={!valid || busy}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Repeat size={16} />}
          {busy ? "Converting…" : "Convert to CC"}
          {!busy && <ArrowRight size={16} />}
        </button>

        {msg && (
          <div
            className={`mt-3 rounded-xl border p-3 text-sm ${
              msg.kind === "ok"
                ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
                : "border-red-500/40 bg-red-500/10 text-red-200"
            }`}
          >
            {msg.kind === "ok" && <Flame size={14} className="mr-1 inline" />}
            {msg.text}
          </div>
        )}
      </div>

      <DcRateHistorySection />
    </div>
  );
}

const RANGES: { key: DcRateRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 days" },
  { key: "all", label: "All time" },
];

/**
 * DC->CC market-rate history — the same spot rate (CC per 1 DC) shown on the
 * dashboard card, plotted over time so members can compare today's rate against
 * the trend. The rate moves with total DC supply: mining lowers it, converting
 * DC back lifts it.
 */
function DcRateHistorySection() {
  const [range, setRange] = useState<DcRateRange>("7d");
  const { series, loading } = useDcRateHistory(range);
  const { data: dc } = useDcRate();

  const vals = series?.map((p) => p.value) ?? [];
  const high = vals.length ? Math.max(...vals) : null;
  const low = vals.length ? Math.min(...vals) : null;
  const first = series?.[0]?.value ?? null;
  const last = series?.[series.length - 1]?.value ?? null;
  const change =
    first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;

  return (
    <div className="dc-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
          <LineChart size={18} className="text-ember-400" /> Market rate history
        </h2>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-2xl font-semibold text-gradient-flame">
            {dc ? dc.ccPerDc.toFixed(2) : "—"}
          </span>
          <span className="text-sm text-mute">CC / DC now · supply ×{dc ? dc.multiplier : "—"}</span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-capsule px-4 py-2 text-sm transition ${
              range === r.key
                ? "bg-ember-500/15 text-ember-300 shadow-glow-ember"
                : "border border-edge text-mute hover:text-white"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading && !series ? (
          <div className="flex h-56 items-center justify-center gap-2 text-mute">
            <Loader2 size={20} className="animate-spin text-ember-400" /> Loading history…
          </div>
        ) : (
          <DcRateChart series={series ?? []} />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={`${RANGES.find((r) => r.key === range)?.label} change`}
          value={change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
        />
        <Stat label="Range high" value={high == null ? "—" : `${high.toFixed(2)} CC`} />
        <Stat label="Range low" value={low == null ? "—" : `${low.toFixed(2)} CC`} />
        <Stat label="DC in market" value={dc ? formatDC(dc.supply) : "—"} ember />
      </div>

      <p className="mt-4 text-xs text-mute">
        <span className="text-white">How it moves:</span> this is the rate for
        converting 1 DC. Bigger conversions earn a higher per-DC rate. The whole
        curve rises and falls with total DC in circulation — as the group mines
        more DC it eases down; converting DC back to CC lifts it.
      </p>
    </div>
  );
}

function Stat({ label, value, ember }: { label: string; value: string; ember?: boolean }) {
  return (
    <div className="rounded-2xl border border-edge/70 bg-ink-800/60 p-3">
      <div className="text-xs text-mute">{label}</div>
      <div className={`mt-1 font-display text-lg font-semibold ${ember ? "text-ember-300" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
