"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { formatDC, toBanglaDigits } from "@/lib/format";
import { Apple, Loader2, Plus, Sprout } from "lucide-react";

type Fund = { totalBdt: number; contributions: number; ministerEmail: string };
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

  const ministerName =
    members.find((m) => m.email === fund?.ministerEmail)?.name ||
    fund?.ministerEmail ||
    "the Fruit Minister";

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
              Every DC bought with real money feeds this fund, kept by {ministerName}.
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
