"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { useLedger } from "@/lib/useLedger";
import type { LedgerTx } from "@/lib/types";
import {
  FileSpreadsheet,
  Download,
  Loader2,
  Layers,
  Receipt,
  Users,
  AlertCircle,
  Pickaxe,
  ArrowLeftRight,
  Lock,
  RotateCcw,
  Sparkles,
  Flame,
  Repeat,
  Banknote,
  ExternalLink,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
} from "lucide-react";
import { formatCC, formatDC } from "@/lib/format";

export default function LedgerPage() {
  return (
    <AppShell>
      <Ledger />
    </AppShell>
  );
}

const TX_ICON: Record<
  LedgerTx["type"],
  React.ComponentType<{ size?: number; className?: string }>
> = {
  MINE: Pickaxe,
  TRADE: ArrowLeftRight,
  TRANSFER: ArrowLeftRight,
  ESCROW_LOCK: Lock,
  ESCROW_REFUND: RotateCcw,
  ADJUST: Sparkles,
  BURN: Flame,
  CONVERT: Repeat,
  PURCHASE: Banknote,
  GAME: Gamepad2,
};

const TYPE_FILTERS: {
  key: string;
  label: string;
  match: (t: LedgerTx["type"]) => boolean;
}[] = [
  { key: "ALL", label: "All", match: () => true },
  { key: "TRADE", label: "Trades", match: (t) => t === "TRADE" },
  { key: "TRANSFER", label: "Transfers", match: (t) => t === "TRANSFER" },
  { key: "MINE", label: "Mining", match: (t) => t === "MINE" },
  { key: "CONVERT", label: "Convert", match: (t) => t === "CONVERT" },
  { key: "PURCHASE", label: "Buy DC", match: (t) => t === "PURCHASE" },
  { key: "GAME", label: "Games", match: (t) => t === "GAME" },
  { key: "BURN", label: "Burns", match: (t) => t === "BURN" },
];

const PAGE_SIZE = 20;

function route(tx: LedgerTx): string {
  if (tx.fromName && tx.toName) return `${tx.fromName} → ${tx.toName}`;
  if (tx.toName) return `→ ${tx.toName}`;
  if (tx.fromName) return `${tx.fromName} →`;
  return "";
}

/** Row title: the memo, or a friendly fallback by type when the memo is blank. */
function txLabel(tx: LedgerTx): string {
  if (tx.memo && tx.memo.trim()) return tx.memo;
  switch (tx.type) {
    case "BURN":
      return "Burned to unlock mining";
    case "MINE":
      return "Mined DC";
    case "GAME":
      return "Won DC in the arcade";
    case "ESCROW_LOCK":
      return "Escrow locked";
    case "ESCROW_REFUND":
      return "Escrow refunded";
    case "ADJUST":
      return "Balance adjustment";
    default:
      return "Transfer";
  }
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="capsule-card p-4">
      <div className="flex items-center gap-2 text-xs text-mute">
        <Icon size={14} className="text-gold-400" /> {label}
      </div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function Ledger() {
  const { authedFetch } = useAuth();
  const { data, loading } = useLedger();
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeKey, setTypeKey] = useState("ALL");
  const [page, setPage] = useState(1);
  const sheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;

  const totalTx = data?.transactions.length ?? 0;
  const isFiltering = query.trim() !== "" || typeKey !== "ALL";
  const filtered = useMemo(() => {
    const txs = data?.transactions ?? [];
    const q = query.trim().toLowerCase();
    const f = TYPE_FILTERS.find((x) => x.key === typeKey) ?? TYPE_FILTERS[0];
    return txs.filter((tx) => {
      if (!f.match(tx.type)) return false;
      if (!q) return true;
      return (
        tx.memo.toLowerCase().includes(q) ||
        (tx.fromName ?? "").toLowerCase().includes(q) ||
        (tx.toName ?? "").toLowerCase().includes(q) ||
        String(tx.amountCC).includes(q) ||
        tx.type.toLowerCase().includes(q)
      );
    });
  }, [data, query, typeKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const firstIdx = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastIdx = Math.min(currentPage * PAGE_SIZE, filtered.length);

  function resetFilters() {
    setQuery("");
    setTypeKey("ALL");
    setPage(1);
  }

  /** Download the current filtered view (all matching rows, not just this page) as CSV. */
  function exportCsv() {
    if (filtered.length === 0) return;
    const cols = ["Seq", "Timestamp", "Type", "Currency", "From", "To", "Amount", "Memo"];
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map((t) => [
      t.seq,
      t.createdAt,
      t.type,
      t.currency,
      t.fromName ?? "",
      t.toName ?? "",
      t.amountCC,
      t.memo,
    ]);
    const csv = [cols, ...rows]
      .map((r) => r.map(esc).join(","))
      .join("\r\n");
    // Prepend a BOM so Excel reads UTF-8 (member names) correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const parts = ["capsule-ledger"];
    if (typeKey !== "ALL") parts.push(typeKey.toLowerCase());
    a.download = parts.join("-") + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function download() {
    setDownloading(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/ledger/download");
      if (!res.ok) {
        setErr("Couldn't generate the ledger. Try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "capsule-ledger.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          <FileSpreadsheet size={22} className="text-gold-400" /> Master ledger
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              <ExternalLink size={16} /> Open Google Sheet
            </a>
          )}
          <button className="btn-gold" onClick={download} disabled={downloading}>
            {downloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Download .xlsx
          </button>
        </div>
      </div>

      {err && (
        <div className="capsule-card flex items-center gap-2 p-3 text-sm text-red-300">
          <AlertCircle size={16} /> {err}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat
          icon={Receipt}
          label="Transactions"
          value={data ? data.txCount.toLocaleString() : "—"}
        />
        <Stat
          icon={Layers}
          label="Market volume"
          value={data ? `${formatCC(data.totalVolume)} CC` : "—"}
        />
        <Stat
          icon={Users}
          label="Members"
          value={data ? String(data.memberCount) : "—"}
        />
      </div>

      <section className="capsule-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 px-5 py-3">
          <div className="font-display text-sm font-semibold text-white">
            Transaction log
          </div>
          {data && (
            <span className="text-xs text-mute">
              {isFiltering ? `${filtered.length} of ${totalTx}` : totalTx}
            </span>
          )}
          <div className="relative ml-auto">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search memo, member, amount…"
              className="w-full min-w-[12rem] rounded-full border border-edge bg-ink-900/60 py-1.5 pl-8 pr-8 text-sm text-white placeholder:text-mute focus:border-gold-500/50 focus:outline-none sm:w-64"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mute transition hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-5 py-2.5">
          {TYPE_FILTERS.map((f) => {
            const active = typeKey === f.key;
            return (
              <button
                key={f.key}
                onClick={() => {
                  setTypeKey(f.key);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-gold-500/40 bg-gold-500/20 text-gold-200"
                    : "border-edge text-mute hover:bg-white/5 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Download the current view (all matching rows) as a CSV"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-xs font-medium text-mute transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute"
          >
            <Download size={13} />
            Export CSV{isFiltering ? ` (${filtered.length})` : ""}
          </button>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-mute">
            <Loader2 size={20} className="animate-spin text-gold-400" /> Loading…
          </div>
        ) : totalTx === 0 ? (
          <p className="py-14 text-center text-sm text-mute">
            No transactions yet.
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-mute">
            <span>No transactions match your search.</span>
            <button onClick={resetFilters} className="btn-ghost">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-white/5">
              {pageItems.map((tx) => {
                const Icon = TX_ICON[tx.type] ?? ArrowLeftRight;
                const when = new Date(tx.createdAt);
                return (
                  <li key={tx.seq} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-mute">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{txLabel(tx)}</div>
                      <div className="truncate text-xs text-mute">
                        {route(tx)}
                        {route(tx) ? " · " : ""}
                        {when.toLocaleDateString()}{" "}
                        {when.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-sm font-semibold ${
                        tx.currency === "DC" ? "text-ember-300" : "text-gold-300"
                      }`}
                    >
                      {tx.currency === "DC"
                        ? formatDC(tx.amountCC)
                        : formatCC(tx.amountCC)}{" "}
                      <span className="text-mute">{tx.currency}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {pageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-5 py-3">
                <span className="text-xs text-mute">
                  Showing {firstIdx}–{lastIdx} of {filtered.length}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1.5 text-sm text-mute transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute"
                  >
                    <ChevronLeft size={15} /> Prev
                  </button>
                  <span className="text-xs text-mute">
                    Page {currentPage} of {pageCount}
                  </span>
                  <button
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= pageCount}
                    className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1.5 text-sm text-mute transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute"
                  >
                    Next <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
