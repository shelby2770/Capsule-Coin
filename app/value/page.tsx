"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useValue } from "@/lib/useValue";
import { formatBdt } from "@/lib/format";
import { useValueHistory, type ValueRange } from "@/lib/useValueHistory";
import { ValueChart } from "@/components/ValueChart";
import { LineChart, Loader2 } from "lucide-react";

const RANGES: { key: ValueRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 days" },
  { key: "all", label: "All time" },
];

export default function ValuePage() {
  return (
    <AppShell>
      <ValueHistory />
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="capsule-card p-4">
      <div className="text-xs text-mute">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone ?? "text-white"}`}>{value}</div>
    </div>
  );
}

function ValueHistory() {
  const [range, setRange] = useState<ValueRange>("7d");
  const { data } = useValue();
  const { series, loading } = useValueHistory(range);

  const vals = series?.map((p) => p.value) ?? [];
  const high = vals.length ? Math.max(...vals) : null;
  const low = vals.length ? Math.min(...vals) : null;
  const first = series?.[0]?.value ?? null;
  const last = series?.[series.length - 1]?.value ?? null;
  const change =
    first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;
  const up = change != null && change > 0;
  const down = change != null && change < 0;

  const c24 = data?.change24h ?? null;
  const c24tone = c24 == null ? "text-mute" : c24 > 0 ? "text-teal-300" : c24 < 0 ? "text-red-300" : "text-mute";

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
        <LineChart size={22} className="text-gold-400" /> CC Value
      </h1>

      <div className="capsule-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-mute">1 CC is worth</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-gold-300">
                ৳{data ? formatBdt(data.bdtPerCC) : "—"}
              </span>
              <span className="text-lg text-white/80">
                ${data ? data.usdPerCC.toFixed(4) : "—"}
              </span>
            </div>
          </div>
          <div className={`text-sm ${c24tone}`}>
            {c24 == null ? "new — under 24h of history" : `${c24 > 0 ? "+" : ""}${c24}% · past 24h`}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-capsule px-4 py-2 text-sm transition ${
              range === r.key
                ? "bg-gold-500/15 text-gold-300 shadow-glow"
                : "border border-edge text-mute hover:text-white"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="capsule-card p-4 sm:p-5">
        {loading && !series ? (
          <div className="flex h-56 items-center justify-center gap-2 text-mute">
            <Loader2 size={20} className="animate-spin text-gold-400" /> Loading history…
          </div>
        ) : (
          <ValueChart series={series ?? []} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label={`${RANGES.find((r) => r.key === range)?.label} change`}
          value={change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
          tone={up ? "text-teal-300" : down ? "text-red-300" : "text-white"}
        />
        <Stat label="Range high" value={high == null ? "—" : `৳${formatBdt(high)}`} />
        <Stat label="Range low" value={low == null ? "—" : `৳${formatBdt(low)}`} />
        <Stat label="Balance spread (σ)" value={data ? `${data.spread}` : "—"} />
      </div>

      <div className="capsule-card p-4 text-sm text-mute">
        <span className="text-white">How it moves:</span> 1 CC&apos;s value rises with the{" "}
        <span className="text-white">spread of everyone&apos;s balances</span> (standard deviation) —
        a lively market with big holders and debtors pushes it up; when everyone sits near zero it
        settles toward the floor. It&apos;s recomputed from the ledger after every transaction, so
        this chart is exact.
      </div>
    </div>
  );
}
